import { useRef, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function App() {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const socketRef = useRef();
  const [mode, setMode] = useState('draw');
  const [file, setFile] = useState(null);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!login) return;
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected:', socket.id);
    });

    socket.on('draw', (data) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      
      // Set drawing properties
      ctx.lineWidth = data.mode === 'draw' ? 2 : 20;
      ctx.strokeStyle = data.mode === 'draw' ? 'black' : 'white';
      ctx.lineCap = 'round';
      
      if (data.type === 'start') {
        // Start new path
        ctx.beginPath();
        ctx.moveTo(data.x, data.y);
      } else if (data.type === 'move') {
        // Continue drawing
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
      }
    });

    socket.on('init-canvas', (alldata) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      
      // Clear canvas first
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Redraw all points
      alldata.forEach(point => {
        ctx.lineWidth = point.mode === 'draw' ? 2 : 20;
        ctx.strokeStyle = point.mode === 'draw' ? 'black' : 'white';
        ctx.lineCap = 'round';
        
        if (point.type === 'start') {
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
        } else if (point.type === 'move') {
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
      });
    });

    socket.on('reset-canvas', () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('mode-change', (newMode) => {
      setMode(newMode);
    });

    return () => socket.disconnect();
  }, [login]);

  useEffect(() => {
    if (!login) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'black';
    ctx.lineCap = 'round';
  }, [login]);

  const handleMouseDown = (e) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Set current drawing properties
    ctx.lineWidth = mode === 'draw' ? 2 : 20;
    ctx.strokeStyle = mode === 'draw' ? 'black' : 'white';
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    
    // Emit start point to server
    socketRef.current.emit('draw', {
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      mode: mode,
      type: 'start'
    });
  };

  const handleMouseMove = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Draw locally
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
    
    // Emit line segment to server
    socketRef.current.emit('draw', {
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      mode: mode,
      type: 'move'
    });
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.closePath();
  };

  const reset = () => {
    // Clear local canvas immediately
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Emit reset to server
    socketRef.current.emit('reset-canvas');
  };

  const toggleMode = () => {
    const newMode = mode === 'draw' ? 'erase' : 'draw';
    setMode(newMode);
    socketRef.current.emit('mode-change', newMode);
  };

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setFile(file);
    }
  };

  if (!login) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-gray-900 text-white">
        <h2 className="text-2xl mb-4">Enter Password</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="p-2 bg-white/10 text-black rounded mb-4 border"
          placeholder="Password"
        />
        <button
          onClick={() => {
            if (password === 'room') setLogin(true);
            else alert("Wrong password");
          }}
          className="px-4 py-2 bg-green-600 rounded"
        >
          Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center h-screen bg-gray-900 p-4">
      <div className="mb-4">
        <button onClick={reset} className="px-4 py-2 bg-red-600 text-white m-2 rounded">Reset</button>
        <button onClick={toggleMode} className="px-4 py-2 bg-blue-600 text-white m-2 rounded">
          {mode === 'draw' ? 'Erase' : 'Draw'}
        </button>
      </div>

      <div className="m-4">
        <label className="inline-block bg-blue-600 text-white px-4 py-2 rounded cursor-pointer">
          Upload PDF
          <input type="file" accept="application/pdf" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="border bg-white border-black w-[800px] h-[500px]"
      />
    </div>
  );
}