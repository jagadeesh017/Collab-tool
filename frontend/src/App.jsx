import { useRef, useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

function getRandomColor() {
  const palette = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#84cc16']
  return palette[Math.floor(Math.random() * palette.length)]
}

function getRandomUserName() {
  return 'User' + Math.floor(Math.random() * 10000)
}

export default function App() {
  const canvasRef = useRef(null)
  const pdfLayerRef = useRef(null)
  const drawingLayerRef = useRef(null)

  const socketRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPoint = useRef(null)
  const batchBuffer = useRef([])
  const batchTimer = useRef(null)
  const drawingDataRef = useRef([])

  const [connectedUsers, setConnectedUsers] = useState({})
  const [mode, setMode] = useState('draw')
  const [roomId, setRoomId] = useState('default-room')
  const [userName] = useState(getRandomUserName())
  const [userColor] = useState(getRandomColor())
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)

  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)

  const flushBatch = useCallback(() => {
    if (batchBuffer.current.length > 0 && socketRef.current?.connected) {
      socketRef.current.emit('draw-batch', [...batchBuffer.current])
      batchBuffer.current = []
    }
  }, [])

  
  useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      }
      document.head.appendChild(script)
    } else {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
  }, [])

  
  useEffect(() => {
    if (!loggedIn) return
    const canvas = canvasRef.current
    if (!canvas) return
    const width = 600, height = 800
    const pdf = document.createElement('canvas')
    const draw = document.createElement('canvas')
    pdf.width = draw.width = canvas.width = width
    pdf.height = draw.height = canvas.height = height
    pdfLayerRef.current = pdf
    drawingLayerRef.current = draw
  }, [loggedIn])

 
  useEffect(() => {
    if (!loggedIn || !drawingLayerRef.current) return

    const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000', {
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true
    })
    socketRef.current = socket

    socket.emit('join-room', roomId, userName, userColor)

    socket.on('init-state', async ({ drawingData, pdfData, currentPage }) => {
      drawingDataRef.current = drawingData || []
      if (pdfData) {
        const pdfjs = window.pdfjsLib
        if (!pdfjs) return
        setLoading(true)
        try {
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfData) }).promise
          setPdfDoc(pdf)
          setTotalPages(pdf.numPages)
          setCurrentPage(currentPage || 1)
          setTimeout(() => replayDrawData(drawingDataRef.current), 100)
        } finally {
          setLoading(false)
        }
      } else {
        setPdfDoc(null)
        setCurrentPage(1)
        setTotalPages(0)
        replayDrawData(drawingDataRef.current)
      }
    })

    socket.on('draw', d => {
      if (d && typeof d === 'object') {
        drawPoint(d)
        drawingDataRef.current.push(d)
        updateCanvas()
      }
    })

    socket.on('draw-batch', batch => {
      if (Array.isArray(batch)) {
        batch.forEach(drawPoint)
        drawingDataRef.current.push(...batch)
        updateCanvas()
      }
    })

    socket.on('reset-canvas', () => clearDrawing(false))
    socket.on('pdf-upload', async buf => {
      const pdfjs = window.pdfjsLib
      if (!pdfjs) return
      setLoading(true)
      drawingDataRef.current = []
      try {
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        setPdfDoc(pdf)
        setTotalPages(pdf.numPages)
        setCurrentPage(1)
      } finally {
        setLoading(false)
      }
    })
    socket.on('page-change', page => { if (page > 0) setCurrentPage(page) })
    socket.on('mode-change', m => ['draw','erase'].includes(m) && setMode(m))
    socket.on('user-cursor', u => setConnectedUsers(prev => ({ ...prev, [u.socketId]: u })))
    socket.on('user-list', u => setConnectedUsers(u))

    return () => {
      if (batchTimer.current) { clearTimeout(batchTimer.current); flushBatch() }
      socket.disconnect()
      socketRef.current = null
    }
  }, [loggedIn, roomId, userName, userColor, flushBatch])

 
  useEffect(() => {
    if (pdfDoc && currentPage > 0) renderPdfPage(currentPage)
  }, [pdfDoc, currentPage])

  function clearDrawing(emit = true) {
    const ctx = drawingLayerRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, drawingLayerRef.current.width, drawingLayerRef.current.height)
    drawingDataRef.current = []
    updateCanvas()
    if (emit && socketRef.current?.connected) socketRef.current.emit('reset-canvas')
  }

  function replayDrawData(data) {
    const ctx = drawingLayerRef.current?.getContext('2d')
    if (!ctx || !Array.isArray(data)) return
    ctx.clearRect(0, 0, drawingLayerRef.current.width, drawingLayerRef.current.height)

    let path = null
    data.forEach(p => {
      if (p.type === 'start') {
        path = { mode: p.mode, color: p.color, points: [p] }
      } else if (p.type === 'move' && path) {
        path.points.push(p)
      } else if (p.type === 'end' && path) {
        drawSmooth(path.points, path.mode, path.color)
        path = null
      }
    })
    updateCanvas()
  }

  function drawSmooth(points, mode, color) {
    if (points.length < 2) return
    const ctx = drawingLayerRef.current.getContext('2d')
    ctx.lineWidth = mode === 'draw' ? 3 : 20
    ctx.strokeStyle = mode === 'draw' ? (color || 'red') : 'rgba(0,0,0,1)'
    ctx.globalCompositeOperation = mode === 'draw' ? 'source-over' : 'destination-out'
    ctx.lineCap = ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(points[0].x, points.y)
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i+1].x) / 2
      const yc = (points[i].y + points[i+1].y) / 2
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc)
    }
    ctx.lineTo(points[points.length-1].x, points[points.length-1].y)
    ctx.stroke()
  }

  async function renderPdfPage(pageNum) {
    if (!pdfDoc) return
    setLoading(true)
    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1.5 })
      const pdfLayer = pdfLayerRef.current
      const drawLayer = drawingLayerRef.current
      const canvas = canvasRef.current

      pdfLayer.width = drawLayer.width = canvas.width = viewport.width
      pdfLayer.height = drawLayer.height = canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const ctx = pdfLayer.getContext('2d')
      ctx.clearRect(0, 0, pdfLayer.width, pdfLayer.height)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, pdfLayer.width, pdfLayer.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      setTimeout(() => replayDrawData(drawingDataRef.current), 50)
    } finally {
      setLoading(false)
    }
  }

  function drawPoint({ x, y, mode, type, color }) {
    const ctx = drawingLayerRef.current?.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = mode === 'draw' ? 3 : 20
    ctx.strokeStyle = mode === 'draw' ? color : 'rgba(0,0,0,1)'
    ctx.globalCompositeOperation = mode === 'draw' ? 'source-over' : 'destination-out'
    ctx.lineCap = ctx.lineJoin = 'round'

    if (type === 'start') {
      ctx.beginPath()
      ctx.moveTo(x, y)
      lastPoint.current = { x, y }
    } else if (type === 'move' && lastPoint.current) {
      ctx.beginPath()
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      lastPoint.current = { x, y }
    }
  }

  function updateCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0,0,canvas.width,canvas.height)
    if (pdfLayerRef.current) ctx.drawImage(pdfLayerRef.current,0,0)
    if (drawingLayerRef.current) ctx.drawImage(drawingLayerRef.current,0,0)
    drawUserCursors(ctx)
  }

  function drawUserCursors(ctx) {
    Object.values(connectedUsers).forEach(u => {
      ctx.save()
      ctx.beginPath()
      ctx.fillStyle = u.color || 'blue'
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 2
      ctx.arc(u.x, u.y, 8, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'black'
      ctx.font = '11px Arial'
      ctx.fillText(u.name, u.x + 10, u.y + 4)
      ctx.restore()
    })
  }

  function handlePointerDown(e) {
    e.preventDefault()
    if (!socketRef.current?.connected) return
    isDrawing.current = true
    const coords = getCoords(e)
    const d = { ...coords, mode, type: 'start', color: userColor }
    drawPoint(d); updateCanvas()
    bufferDraw(d)
    socketRef.current.emit('cursor-move', coords)
  }

  function handlePointerMove(e) {
    e.preventDefault()
    const coords = getCoords(e)
    socketRef.current?.emit('cursor-move', coords)
    if (!isDrawing.current || !socketRef.current?.connected) return

    if (lastPoint.current) {
      const dx = coords.x - lastPoint.current.x
      const dy = coords.y - lastPoint.current.y
      if (dx*dx + dy*dy < 4) return
    }
    const d = { ...coords, mode, type: 'move', color: userColor }
    drawPoint(d); updateCanvas()
    bufferDraw(d)
  }

  function handlePointerUp(e) {
    e.preventDefault()
    if (isDrawing.current) {
      const coords = getCoords(e)
      const d = { ...coords, mode, type: 'end', color: userColor }
      bufferDraw(d)
      if (batchTimer.current) { clearTimeout(batchTimer.current); flushBatch() }
    }
    isDrawing.current = false
    lastPoint.current = null
  }

  function bufferDraw(d) {
    batchBuffer.current.push(d)
    drawingDataRef.current.push(d)
    if (batchBuffer.current.length >= 10) {
      flushBatch()
    } else {
      if (batchTimer.current) clearTimeout(batchTimer.current)
      batchTimer.current = setTimeout(flushBatch, 16)
    }
  }

  function getCoords(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    if ('touches' in e && e.touches.length > 0) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    } else {
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
    }
  }

  function switchMode() {
    const newMode = mode === 'draw' ? 'erase' : 'draw'
    setMode(newMode)
    socketRef.current?.emit('mode-change', newMode)
  }

  function changePage(dir) {
    const p = currentPage + dir
    if (p < 1 || p > totalPages) return
    setCurrentPage(p)
    socketRef.current?.emit('page-change', p)
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return alert('Please upload a PDF')
    const pdfjs = window.pdfjsLib
    if (!pdfjs) return alert('PDF.js not loaded')
    setLoading(true)
    try {
      const buf = await file.arrayBuffer()
      socketRef.current?.emit('pdf-upload', buf)
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      clearDrawing(false)
    } finally {
      setLoading(false)
    }
  }

 
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="relative z-10 w-full max-w-md bg-white/[0.02] border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-500 bg-clip-text text-transparent mb-2">
              LivePDF
            </h1>
          </div>
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-slate-300">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && (password === 'room' ? setLoggedIn(true) : alert('Wrong password'))}
                className="w-full mt-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-400/50"
                placeholder="Enter password..."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Room ID</label>
              <input
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                className="w-full mt-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:ring-2 focus:ring-cyan-400/50"
                placeholder="Room ID..."
              />
            </div>
            <button
              onClick={() => (password === 'room' ? setLoggedIn(true) : alert('Wrong password'))}
              className="w-full py-3 bg-gradient-to-r from-purple-500 via-blue-500 to-fuchsia-500 text-white font-semibold rounded-xl"
            >
              Enter Workspace
            </button>
          </div>
          <div className="mt-6 pt-6 border-t border-white/10 text-slate-400 flex items-center gap-2 justify-center">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userColor }}></div>
            <span>Joining as {userName}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="sticky top-0 backdrop-blur-xl bg-white/[0.02] border-b border-white/10 px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">LivePDF</h1>
        <div className="flex items-center gap-3">
          <button onClick={switchMode} className={`px-4 py-2 rounded-lg ${mode === 'draw' ? 'bg-red-500 text-white' : 'bg-gray-600 text-white'}`}>
            {mode === 'draw' ? '✏️ Draw' : '🧽 Erase'}
          </button>
          <button onClick={clearDrawing} className="px-4 py-2 bg-orange-500 text-white rounded-lg">🗑️ Clear</button>
          {pdfDoc &&
            <>
              <button onClick={() => changePage(-1)} disabled={currentPage<=1}>←</button>
              <span>{currentPage} / {totalPages}</span>
              <button onClick={() => changePage(1)} disabled={currentPage>=totalPages}>→</button>
            </>
          }
          <label className="cursor-pointer bg-emerald-500 px-4 py-2 rounded-lg">
            📄 Upload PDF
            <input type="file" accept="application/pdf" onChange={handleUpload} hidden />
          </label>
        </div>
      </header>
      <main className="p-6 flex gap-8">
        <div className="flex-1 flex flex-col items-center">
          {loading && <div>Loading PDF...</div>}
          <canvas
            ref={canvasRef}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            className="bg-white rounded-xl"
            style={{ width: '600px', height: '800px', touchAction: 'none' }}
          />
        </div>
        <aside className="w-64 bg-white/5 p-4 rounded-xl">
          <h3 className="mb-2">Session Info</h3>
          <div>Mode: {mode}</div>
          <div>User: {userName}</div>
          <div>Status: {socketRef.current?.connected ? '🟢 Connected' : '🔴 Disconnected'}</div>
          <div>Room: {roomId}</div>
          {Object.keys(connectedUsers).length > 0 &&
            <div className="mt-4">
              <h4>Active Users</h4>
              <ul>
                {Object.values(connectedUsers).map(u => (
                  <li key={u.socketId}>{u.name}</li>
                ))}
              </ul>
            </div>
          }
        </aside>
      </main>
    </div>
  )
}
