const http = require('http');
const { Server } = require('socket.io');
const express = require('express');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;
let drawingData = [];
let pdfData = null; // store latest pdf buffer

io.on('connection', (socket) => {
  console.log("A user connected:", socket.id);
  
  // Send existing drawing data to new user
  socket.emit('init-canvas', drawingData);
  
  // Send existing PDF to new user if available
  if (pdfData) {
    socket.emit('pdf-upload', pdfData);
  }
  
  socket.on('draw', (data) => {
    drawingData.push(data);
    socket.broadcast.emit('draw', data);
  });
  
  socket.on('reset-canvas', () => {
    drawingData = [];
    io.emit('reset-canvas');
  });
  
  socket.on('mode-change', (newMode) => {
    socket.broadcast.emit('mode-change', newMode);
  });
  
  socket.on("pdf-upload", (data) => {
    // Store the PDF data for new users
    pdfData = data;
    // Clear drawing data when new PDF is uploaded
    drawingData = [];
    // Broadcast to OTHER users only (sender handles their own PDF)
    socket.broadcast.emit("pdf-upload", data);
    // Also emit reset-canvas to clear drawings for everyone
    io.emit('reset-canvas');
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log("Server is listening on port", PORT);
});