import {useRef, useEffect } from 'react';
import { io } from 'socket.io-client';

export default function App() {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  useEffect(() => {
    const socket = io('http://localhost:3000');

    socket.on('connect', () => {
      console.log('Connected to backend:', socket.id);
    });

    return () => socket.disconnect();

  }, []);
  useEffect(()=>{

    const canvas= canvasRef.current;
   canvas.width= 800;
     canvas.height=500;
     const ctx = canvas.getContext('2d');
     ctx.lineWidth = 2;
    ctx.strokeStyle = 'black';
    ctx.lineCap = 'round';
  });
    const handleMouseDown=(e)=>{
      isDrawing.current=true;
      const canvas=canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    };
    const handleMouseMove= (e)=>{
      if(!isDrawing.current)return;
       const canvas=canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      ctx.stroke();

    };
    const handleMouseUp= (e)=>
    {
      isDrawing.current=false;
       const canvas=canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.closePath();
    };
  return (
    <div className='flex justify-center items-center h-screen bg-gray-900'>
    <canvas id="myCanvas" 
    ref={canvasRef}
    onMouseDown={handleMouseDown}
    onMouseMove={handleMouseMove}
    onMouseUp={handleMouseUp}
     className="border bg-amber-50 border-black w-[800px] h-[500px]">
      
    </canvas>

    </div>
  );
}