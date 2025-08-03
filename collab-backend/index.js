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
mongoose.connect(mongoUri) 

mongoose.connection.on('connected', () => console.log('MongoDB connected'))
mongoose.connection.on('error', err => console.error('MongoDB connection error:', err))
mongoose.connection.on('disconnected', () => console.log('MongoDB disconnected'))

const sessionSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  pdfData: Buffer,
  drawingData: [{
    x: Number,
    y: Number,
    mode: { type: String, enum: ['draw', 'erase'] },
    type: { type: String, enum: ['start', 'move'] },
  }],
  currentPage: { type: Number, default: 1 },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true })

// Removed duplicate index on roomId to avoid warnings
sessionSchema.index({ updatedAt: -1 })

const Session = mongoose.model('Session', sessionSchema)
const usersInRoom = {}

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

function isValidDrawingData(data) {
  return data && typeof data === 'object' && typeof data.x === 'number' && typeof data.y === 'number' &&
    (data.mode === 'draw' || data.mode === 'erase') &&
    (data.type === 'start' || data.type === 'move') &&
    !isNaN(data.x) && !isNaN(data.y)
}

function isValidCursorPosition(pos) {
  return pos && typeof pos === 'object' && typeof pos.x === 'number' && typeof pos.y === 'number' &&
    !isNaN(pos.x) && !isNaN(pos.y)
}

io.on('connection', (socket) => {
  let currentRoom = null
  let userName = null
  let userColor = null

  socket.on('join-room', async (roomId, name, color) => {
    try {
      if (!roomId || typeof roomId !== 'string') {
        socket.emit('error', 'Invalid room ID')
        return
      }
      if (currentRoom) {
        socket.leave(currentRoom)
        if (usersInRoom[currentRoom]) {
          delete usersInRoom[currentRoom][socket.id]
          io.in(currentRoom).emit('user-list', usersInRoom[currentRoom])
        }
      }
      currentRoom = roomId.trim()
      socket.join(currentRoom)
      userName = (name && typeof name === 'string') ? name.trim() : `User-${Math.floor(Math.random() * 10000)}`
      userColor = (color && typeof color === 'string' && color.match(/^#[0-9A-F]{6}$/i)) 
        ? color 
        : '#' + Math.floor(Math.random() * 16777215).toString(16)
      if (!usersInRoom[currentRoom]) usersInRoom[currentRoom] = {}
      usersInRoom[currentRoom][socket.id] = { name: userName, color: userColor, x: 0, y: 0 }
      let session = await Session.findOne({ roomId: currentRoom })
      if (!session) session = await Session.create({
        roomId: currentRoom,
        drawingData: [],
        currentPage: 1,
        updatedAt: new Date(),
      })
      socket.emit('init-state', {
        drawingData: session.drawingData || [],
        pdfData: session.pdfData ? Array.from(session.pdfData) : null,
        currentPage: session.currentPage || 1,
        userId: socket.id,
        userName,
        userColor,
        usersInRoom: usersInRoom[currentRoom],
      })
      io.in(currentRoom).emit('user-list', usersInRoom[currentRoom])
    } catch (error) {
      socket.emit('error', 'Failed to join room')
    }
  })

  socket.on('draw', async (data) => {
    if (!currentRoom) {
      socket.emit('error', 'Not in a room')
      return
    }
    try {
      let drawData = data
      if (typeof data === 'string') {
        try { drawData = JSON.parse(data) } catch { return }
      }
      if (!isValidDrawingData(drawData)) return
      await Session.updateOne(
        { roomId: currentRoom },
        { $push: { drawingData: drawData }, $set: { updatedAt: new Date() } },
        { upsert: true }
      )
      socket.to(currentRoom).emit('draw', drawData)
    } catch {
      socket.emit('error', 'Failed to process drawing')
    }
  })

  socket.on('reset-canvas', async () => {
    if (!currentRoom) {
      socket.emit('error', 'Not in a room')
      return
    }
    try {
      await Session.updateOne(
        { roomId: currentRoom }, 
        { $set: { drawingData: [], updatedAt: new Date() } },
        { upsert: true }
      )
      io.in(currentRoom).emit('reset-canvas')
    } catch {
      socket.emit('error', 'Failed to reset canvas')
    }
  })

  socket.on('mode-change', (mode) => {
    if (!currentRoom) {
      socket.emit('error', 'Not in a room')
      return
    }
    if (mode !== 'draw' && mode !== 'erase') return
    socket.to(currentRoom).emit('mode-change', mode)
  })

  socket.on('page-change', async (pageNum) => {
    if (!currentRoom) {
      socket.emit('error', 'Not in a room')
      return
    }
    try {
      if (typeof pageNum !== 'number' || pageNum < 1 || !Number.isInteger(pageNum)) return
      await Session.updateOne(
        { roomId: currentRoom }, 
        { $set: { currentPage: pageNum, updatedAt: new Date() } },
        { upsert: true }
      )
      socket.to(currentRoom).emit('page-change', pageNum)
    } catch {
      socket.emit('error', 'Failed to change page')
    }
  })

  socket.on('pdf-upload', async (data) => {
    if (!currentRoom) {
      socket.emit('error', 'Not in a room')
      return
    }
    try {
      if (!data || !(data instanceof ArrayBuffer) && !Buffer.isBuffer(data)) {
        socket.emit('error', 'Invalid PDF data')
        return
      }
      const pdfBuffer = Buffer.from(data)
      if (pdfBuffer.length > 50 * 1024 * 1024) {
        socket.emit('error', 'PDF file too large')
        return
      }
      await Session.updateOne(
        { roomId: currentRoom }, 
        { $set: { pdfData: pdfBuffer, currentPage: 1, drawingData: [], updatedAt: new Date() } },
        { upsert: true }
      )
      socket.to(currentRoom).emit('pdf-upload', data)
      io.in(currentRoom).emit('reset-canvas')
    } catch {
      socket.emit('error', 'Failed to upload PDF')
    }
  })

  socket.on('cursor-move', (pos) => {
    if (!currentRoom) return
    if (!isValidCursorPosition(pos)) return
    if (usersInRoom[currentRoom] && usersInRoom[currentRoom][socket.id]) {
      usersInRoom[currentRoom][socket.id].x = pos.x
      usersInRoom[currentRoom][socket.id].y = pos.y
    }
    socket.to(currentRoom).emit('user-cursor', {
      socketId: socket.id,
      name: userName,
      color: userColor,
      x: pos.x,
      y: pos.y,
    })
  })

  socket.on('disconnect', () => {
    if (currentRoom && usersInRoom[currentRoom]) {
      delete usersInRoom[currentRoom][socket.id]
      if (Object.keys(usersInRoom[currentRoom]).length === 0) {
        delete usersInRoom[currentRoom]
      } else {
        io.in(currentRoom).emit('user-list', usersInRoom[currentRoom])
      }
    }
  })

  socket.on('error', (error) => {
    console.error('Socket error:', error)
  })
})

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  })
})

process.on('SIGTERM', () => {
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0)
    })
  })
})

process.on('SIGINT', () => {
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0)
    })
  })
})

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})
