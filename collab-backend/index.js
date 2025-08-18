require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const { Server } = require('socket.io')
const mongoose = require('mongoose')

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3000

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

const mongoUri = process.env.MONGO_URI
console.log('Connecting to MongoDB:', mongoUri)
mongoose.connect(mongoUri)

mongoose.connection.on('connected', () => console.log('MongoDB connected'))
mongoose.connection.on('error', err => console.error('MongoDB error:', err))
mongoose.connection.on('disconnected', () => console.log('MongoDB disconnected'))

const sessionSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  pdfData: Buffer,
  drawingData: [{
    x: Number,
    y: Number,
    mode: { type: String, enum: ['draw', 'erase'] },
    type: { type: String, enum: ['start', 'move', 'end'] },
    color: String,
    timestamp: { type: Date, default: Date.now }
  }],
  currentPage: { type: Number, default: 1 },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true })

sessionSchema.index({ updatedAt: -1 })

const Session = mongoose.model('Session', sessionSchema)
const activeUsers = {}
const drawLimitMap = new Map()

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket'],
  upgrade: true,
  compression: true,
  httpCompression: true
})

const validateDrawData = d =>
  d && typeof d.x === 'number' && typeof d.y === 'number'
  && ['draw', 'erase'].includes(d.mode)
  && ['start', 'move', 'end'].includes(d.type)
  && !isNaN(d.x) && !isNaN(d.y)
  && d.x >= 0 && d.y >= 0 && d.x <= 10000 && d.y <= 10000

const validateCursor = p =>
  p && typeof p.x === 'number' && typeof p.y === 'number'
  && !isNaN(p.x) && !isNaN(p.y)
  && p.x >= 0 && p.y >= 0 && p.x <= 10000 && p.y <= 10000

function rateLimit(socketId, max = 100, windowMs = 1000) {
  const now = Date.now()
  let entry = drawLimitMap.get(socketId) || { count: 0, reset: now + windowMs }
  if (now > entry.reset) {
    entry.count = 0
    entry.reset = now + windowMs
  }
  entry.count++
  drawLimitMap.set(socketId, entry)
  return entry.count <= max
}

setInterval(() => {
  const now = Date.now()
  for (const [id, limit] of drawLimitMap) {
    if (now > limit.reset) drawLimitMap.delete(id)
  }
}, 60000)

io.on('connection', socket => {
  let roomId = null
  let name = null
  let color = null
  let lastCursor = 0

  socket.on('join-room', async (rid, userName, userColor) => {
    try {
      if (!rid || typeof rid !== 'string') return socket.emit('error', 'Invalid room ID')
      if (roomId) {
        socket.leave(roomId)
        if (activeUsers[roomId]) {
          delete activeUsers[roomId][socket.id]
          io.in(roomId).emit('user-list', activeUsers[roomId])
        }
      }
      roomId = rid.trim()
      socket.join(roomId)
      name = typeof userName === 'string' ? userName.trim() : `User-${Math.floor(Math.random() * 10000)}`
      color = typeof userColor === 'string' && /^#[0-9A-F]{6}$/i.test(userColor)
        ? userColor
        : `#${Math.floor(Math.random() * 16777215).toString(16)}`
      if (!activeUsers[roomId]) activeUsers[roomId] = {}
      activeUsers[roomId][socket.id] = { name, color, x: 0, y: 0 }

      let session = await Session.findOne({ roomId })
      if (!session) {
        session = await Session.create({ roomId, drawingData: [], currentPage: 1, updatedAt: new Date() })
      }

      socket.emit('init-state', {
        drawingData: session.drawingData || [],
        pdfData: session.pdfData ? Array.from(session.pdfData) : null,
        currentPage: session.currentPage || 1,
        userId: socket.id,
        userName: name,
        userColor: color,
        usersInRoom: activeUsers[roomId]
      })

      io.in(roomId).emit('user-list', activeUsers[roomId])
    } catch (err) {
      console.error('Join error:', err)
      socket.emit('error', 'Join failed')
    }
  })

  socket.on('draw', async data => {
    if (!roomId || !rateLimit(socket.id)) return
    try {
      let payload = typeof data === 'string' ? JSON.parse(data) : data
      if (!validateDrawData(payload)) return
      const entry = { ...payload, color: payload.color || color, timestamp: new Date() }
      await Session.updateOne({ roomId }, { $push: { drawingData: entry }, $set: { updatedAt: new Date() } }, { upsert: true })
      socket.to(roomId).emit('draw', entry)
    } catch (err) {
      console.error('Draw error:', err)
      socket.emit('error', 'Draw failed')
    }
  })

  socket.on('draw-batch', async batch => {
    if (!roomId || !rateLimit(socket.id, 200, 1000)) return
    try {
      if (!Array.isArray(batch) || !batch.length) return
      const entries = batch.filter(validateDrawData).map(d => ({
        ...d, color: d.color || color, timestamp: new Date()
      }))
      if (!entries.length) return
      await Session.updateOne(
        { roomId },
        { $push: { drawingData: { $each: entries } }, $set: { updatedAt: new Date() } },
        { upsert: true }
      )
      socket.to(roomId).emit('draw-batch', entries)
    } catch (err) {
      console.error('Batch error:', err)
      socket.emit('error', 'Batch failed')
    }
  })

  socket.on('reset-canvas', async () => {
    if (!roomId) return
    try {
      await Session.updateOne({ roomId }, { $set: { drawingData: [], updatedAt: new Date() } }, { upsert: true })
      io.in(roomId).emit('reset-canvas')
    } catch (err) {
      console.error('Reset error:', err)
      socket.emit('error', 'Reset failed')
    }
  })

  socket.on('mode-change', m => {
    if (roomId && ['draw', 'erase'].includes(m)) socket.to(roomId).emit('mode-change', m)
  })

  socket.on('page-change', async page => {
    if (!roomId || typeof page !== 'number' || page < 1 || !Number.isInteger(page)) return
    try {
      await Session.updateOne({ roomId }, { $set: { currentPage: page, updatedAt: new Date() } }, { upsert: true })
      socket.to(roomId).emit('page-change', page)
    } catch (err) {
      console.error('Page error:', err)
    }
  })

  socket.on('pdf-upload', async data => {
    if (!roomId) return
    try {
      const buffer = Buffer.from(data)
      if (buffer.length > 50 * 1024 * 1024) return socket.emit('error', 'PDF too large')
      await Session.updateOne(
        { roomId },
        { $set: { pdfData: buffer, currentPage: 1, drawingData: [], updatedAt: new Date() } },
        { upsert: true }
      )
      socket.to(roomId).emit('pdf-upload', data)
      io.in(roomId).emit('reset-canvas')
    } catch (err) {
      console.error('PDF upload error:', err)
      socket.emit('error', 'Upload failed')
    }
  })

  socket.on('cursor-move', pos => {
    if (!roomId) return
    const now = Date.now()
    if (now - lastCursor < 16) return
    lastCursor = now
    if (!validateCursor(pos)) return
    if (activeUsers[roomId] && activeUsers[roomId][socket.id]) {
      activeUsers[roomId][socket.id].x = pos.x
      activeUsers[roomId][socket.id].y = pos.y
    }
    socket.to(roomId).emit('user-cursor', { socketId: socket.id, name, color, x: pos.x, y: pos.y })
  })

  socket.on('disconnect', () => {
    drawLimitMap.delete(socket.id)
    if (roomId && activeUsers[roomId]) {
      delete activeUsers[roomId][socket.id]
      if (!Object.keys(activeUsers[roomId]).length) delete activeUsers[roomId]
      else io.in(roomId).emit('user-list', activeUsers[roomId])
    }
  })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    activeRooms: Object.keys(activeUsers).length,
    totalUsers: Object.values(activeUsers).reduce((a, r) => a + Object.keys(r).length, 0)
  })
})

setInterval(async () => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await Session.deleteMany({ updatedAt: { $lt: weekAgo } })
  } catch (err) {
    console.error('Cleanup error:', err)
  }
}, 24 * 60 * 60 * 1000)

function gracefulExit() {
  server.close(() => mongoose.connection.close(false, () => process.exit(0)))
}
process.on('SIGTERM', gracefulExit)
process.on('SIGINT', gracefulExit)

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
