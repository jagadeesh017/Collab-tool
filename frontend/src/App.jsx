import { useRef, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function App() {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const socketRef = useRef();
  const [mode, setMode] = useState('draw');
  const[file,setfile]= useState(null);

  useEffect(() => {
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to backend:', socket.id);
    });

    socket.on('draw', (data) => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = data.mode === 'draw' ? 2 : 20;
      ctx.strokeStyle = data.mode === 'draw' ? 'black' : 'white';
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
    });
    socket.on('init-canvas',(alldata)=>
    {
      const canvas=canvasRef.current;
      const ctx =canvas.getContext('2d');
        alldata.forEach(point => {
        ctx.lineWidth = point.mode === 'draw' ? 2 : 20;
        ctx.strokeStyle = point.mode === 'draw' ? 'black' : 'white';
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        
      });

    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'red';
    ctx.lineCap = 'round';
  }, []);

  const handleMouseDown = (e) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = mode === 'draw' ? 2 : 20;
    ctx.strokeStyle = mode === 'draw' ? 'black' : 'white';
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();

    socketRef.current.emit('draw', {
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      mode: mode,
    });
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.closePath();
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  const handleupload= (e)=>{
    const file=e.target.file[0];
    if(file && file.type === 'application/pdf')
    {
      setfile(file);
      console.log("file uploaded");
    }
    else
    console.log("Please upload a valid PDF file");

  }
  return (
    <div className='flex flex-col items-center h-screen bg-gray-900 p-4'>
      <div className="mb-4">
        <button
          onClick={reset}
          className='px-4 py-2 bg-red-600 text-white m-2 rounded'
        >
          Reset
        </button>
        <button
          className='px-4 py-2 bg-blue-600 text-white m-2 rounded'
          onClick={() => setMode(mode === 'draw' ? 'erase' : 'draw')}
        >
          {mode === 'draw' ? 'Erase' : 'Draw'}
        </button>
      </div>
      <div className="m-4">
  <label className="inline-block bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700 transition">
    Upload PDF
    <input
      type="file"
      accept="application/pdf"
      onChange={handleupload}
      className="hidden"
    />
  </label>
</div>

       <canvas
        id="myCanvas"
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="border bg-white border-black w-[800px] h-[500px]"
      ></canvas>
    </div>
  );
}
