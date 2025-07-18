const http = require('http')
const { Server } = require('socket.io')
const express = require('express')
const cors = require('cors')  
const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3000;
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL ||"http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

let drawingData = []
let pdfData = null
let currentPage = 1
io.on('connection', (socket) => {
  socket.emit('init-canvas', drawingData)
  if (pdfData) {
    socket.emit('pdf-upload', pdfData)
    setTimeout(() => {
      socket.emit('page-change', currentPage)
    }, 100)
  }
  socket.on('draw', (data) => {
    drawingData.push(data)
    socket.broadcast.emit('draw', data)
  })
  socket.on('reset-canvas', () => {
    drawingData = []
    io.emit('reset-canvas')
  })
  socket.on('mode-change', (newMode) => {
    socket.broadcast.emit('mode-change', newMode)
  })
  socket.on('page-change', (pageNumber) => {
    currentPage = pageNumber
    socket.broadcast.emit('page-change', pageNumber)
  })
  socket.on("pdf-upload", (data) => {
    pdfData = data
    currentPage = 1
    drawingData = []
    socket.broadcast.emit("pdf-upload", data)
    io.emit('reset-canvas')
  })
})

server.listen(PORT, () => {
  console.log("Server is listening on port", PORT)
})
