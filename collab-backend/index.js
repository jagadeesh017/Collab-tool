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

io.on('connection', (socket) => {
  console.log("A user connected:", socket.id);

  // Send existing drawing data to new user
  socket.emit('init-canvas', drawingData);

  socket.on('draw', (data) => {
    drawingData.push(data);
    socket.broadcast.emit('draw', data); // Send to all other users
  });

  socket.on('reset-canvas', () => {
    drawingData = []; // Clear the server data
    io.emit('reset-canvas'); // Notify ALL users (including sender)
  });

  socket.on('mode-change', (newMode) => {
    socket.broadcast.emit('mode-change', newMode);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log("Server is listening on port", PORT);
});