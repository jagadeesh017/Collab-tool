
const http= require('http');
const { Server } = require('socket.io');

const express = require('express');
const app= express();
const server = http.createServer(app);
const io= new  Server(server,{
    cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});


const PORT =3000;

const drawingdata=[];
io.on('connection',(socket)=>{
    console.log("a user logged");
    socket.emit('init-canvas', drawingdata);
    socket.on('draw',(data)=>{
      drawingdata.push(data);
    socket.broadcast.emit('draw',data);
});
  socket.on('disconnect', () => {
    console.log(' User disconnected:', socket.id);
  });
});

server.listen(PORT,()=>{
    console.log("socket connected");
});


