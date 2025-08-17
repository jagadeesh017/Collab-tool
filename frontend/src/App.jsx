import { useRef, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

function randomColor() {
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#84cc16']
  return colors[Math.floor(Math.random() * colors.length)]
}

function randomUserName() {
  return 'User' + Math.floor(Math.random() * 10000)
}

export default function App() {
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const socketRef = useRef(null)
  const [mode, setMode] = useState('draw')
  const [login, setLogin] = useState(false)
  const [password, setPassword] = useState('')
  const [roomId, setRoomId] = useState('default-room')
  const [userName] = useState(randomUserName())
  const [userColor] = useState(randomColor())
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [drawingLayer, setDrawingLayer] = useState(null)
  const [pdfLayer, setPdfLayer] = useState(null)
  const [loading, setLoading] = useState(false)
  const drawingDataRef = useRef([])
  const [otherUsers, setOtherUsers] = useState({})

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
    if (!login) return
    const canvas = canvasRef.current
    if (!canvas) return
    const width = 600
    const height = 800
    const pdfCanvas = document.createElement('canvas')
    const drawCanvas = document.createElement('canvas')
    pdfCanvas.width = drawCanvas.width = canvas.width = width
    pdfCanvas.height = drawCanvas.height = canvas.height = height
    setPdfLayer(pdfCanvas)
    setDrawingLayer(drawCanvas)
  }, [login])

  useEffect(() => {
    if (!login || !drawingLayer) return
    const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000', { transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.emit('join-room', roomId, userName, userColor)

    const initStateHandler = async ({ drawingData, pdfData, currentPage }) => {
      drawingDataRef.current = drawingData || []
      if (pdfData) {
        const pdfjsLib = window.pdfjsLib
        if (!pdfjsLib) return
        setLoading(true)
        try {
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfData) }).promise
          setPdfDoc(pdf)
          setTotalPages(pdf.numPages)
          setCurrentPage(currentPage || 1)
          setTimeout(() => { redrawFromDrawingData(drawingDataRef.current) }, 100)
        } catch { } finally { setLoading(false) }
      } else {
        setPdfDoc(null)
        setCurrentPage(1)
        setTotalPages(0)
        redrawFromDrawingData(drawingDataRef.current)
      }
    }
    socket.on('init-state', initStateHandler)
    socket.on('draw', (data) => {
      if (data && typeof data === 'object') {
        drawOnLayer(data.x, data.y, data.mode, data.type)
        drawingDataRef.current.push(data)
        redrawCanvas()
      }
    })
    socket.on('reset-canvas', () => { clearDrawingLayerLocal(false) })
    socket.on('pdf-upload', async (arrayBuffer) => {
      const pdfjsLib = window.pdfjsLib
      if (!pdfjsLib) return
      setLoading(true)
      drawingDataRef.current = []
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
        setPdfDoc(pdf)
        setTotalPages(pdf.numPages)
        setCurrentPage(1)
      } catch { } finally { setLoading(false) }
    })
    socket.on('page-change', (pageNum) => {
      if (typeof pageNum === 'number' && pageNum > 0) setCurrentPage(pageNum)
    })
    socket.on('mode-change', (newMode) => {
      if (newMode === 'draw' || newMode === 'erase') setMode(newMode)
    })
    socket.on('user-cursor', ({ socketId, x, y, name, color }) => {
      if (socketId && typeof x === 'number' && typeof y === 'number') {
        setOtherUsers(prev => ({ ...prev, [socketId]: { x, y, name, color } }))
      }
    })
    socket.on('user-list', (users) => {
      if (users && typeof users === 'object') setOtherUsers(users)
    })
    socket.on('connect_error', () => {})

    return () => {
      socket.off('init-state')
      socket.off('draw')
      socket.off('reset-canvas')
      socket.off('pdf-upload')
      socket.off('page-change')
      socket.off('mode-change')
      socket.off('user-cursor')
      socket.off('user-list')
      socket.off('connect_error')
      socket.disconnect()
      socketRef.current = null
    }
  }, [login, drawingLayer, roomId, userName, userColor])

  useEffect(() => {
    if (pdfDoc && pdfLayer && drawingLayer && currentPage > 0) renderPage(currentPage)
  }, [pdfDoc, currentPage, pdfLayer, drawingLayer])

  const clearDrawingLayerLocal = (emit = true) => {
    if (!drawingLayer) return
    const ctx = drawingLayer.getContext('2d')
    ctx.clearRect(0, 0, drawingLayer.width, drawingLayer.height)
    drawingDataRef.current = []
    redrawCanvas()
    if (emit && socketRef.current && socketRef.current.connected) socketRef.current.emit('reset-canvas')
  }

  const redrawFromDrawingData = (data) => {
    if (!drawingLayer || !Array.isArray(data)) return
    const ctx = drawingLayer.getContext('2d')
    ctx.clearRect(0, 0, drawingLayer.width, drawingLayer.height)
    data.forEach(point => {
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        drawOnLayer(point.x, point.y, point.mode, point.type)
      }
    })
    redrawCanvas()
  }

  const renderPage = async (pageNumber) => {
    if (!pdfDoc || !pdfLayer || !drawingLayer || !pageNumber) return
    setLoading(true)
    try {
      const page = await pdfDoc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1.5 })
      pdfLayer.width = viewport.width
      pdfLayer.height = viewport.height
      drawingLayer.width = viewport.width
      drawingLayer.height = viewport.height
      canvasRef.current.width = viewport.width
      canvasRef.current.height = viewport.height
      canvasRef.current.style.width = `${viewport.width}px`
      canvasRef.current.style.height = `${viewport.height}px`
      const ctx = pdfLayer.getContext('2d')
      ctx.clearRect(0, 0, pdfLayer.width, pdfLayer.height)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, pdfLayer.width, pdfLayer.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      setTimeout(() => { redrawFromDrawingData(drawingDataRef.current) }, 50)
    } catch {} finally { setLoading(false) }
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') {
      alert('Please upload a PDF file')
      return
    }
    const pdfjsLib = window.pdfjsLib
    if (!pdfjsLib) { alert('PDF.js not loaded'); return }
    setLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('pdf-upload', arrayBuffer)
      }
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      clearDrawingLayerLocal(false)
    } catch {
      alert('Error uploading PDF')
    } finally { setLoading(false) }
  }

  const redrawCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (pdfLayer) ctx.drawImage(pdfLayer, 0, 0)
    if (drawingLayer) ctx.drawImage(drawingLayer, 0, 0)
    drawOtherUsersCursors(ctx)
  }

  const drawOnLayer = (x, y, mode, type) => {
    const ctx = drawingLayer?.getContext('2d')
    if (!ctx || typeof x !== 'number' || typeof y !== 'number') return
    ctx.lineWidth = mode === 'draw' ? 2 : 20
    ctx.strokeStyle = mode === 'draw' ? 'red' : 'rgba(0,0,0,1)'
    ctx.globalCompositeOperation = mode === 'draw' ? 'source-over' : 'destination-out'
    ctx.lineCap = 'round'
    if (type === 'start') {
      ctx.beginPath()
      ctx.moveTo(x, y)
    } else if (type === 'move') {
      ctx.lineTo(x, y)
      ctx.stroke()
    }
  }

  const getCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    if ('touches' in e && e.touches.length > 0) {
      const touch = e.touches[0]
      const scaleX = canvasRef.current.width / rect.width
      const scaleY = canvasRef.current.height / rect.height
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    } else {
      const scaleX = canvasRef.current.width / rect.width
      const scaleY = canvasRef.current.height / rect.height
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
    }
  }

  const handlePointerDown = (e) => {
    e.preventDefault()
    if (!socketRef.current || !socketRef.current.connected) return
    isDrawing.current = true
    const coords = getCoords(e)
    const drawData = { ...coords, mode, type: 'start' }
    drawOnLayer(coords.x, coords.y, mode, 'start')
    redrawCanvas()
    socketRef.current.emit('draw', drawData)
    socketRef.current.emit('cursor-move', coords)
    drawingDataRef.current.push(drawData)
  }

  const handlePointerMove = (e) => {
    e.preventDefault()
    const coords = getCoords(e)
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('cursor-move', coords)
    }
    if (!isDrawing.current || !socketRef.current || !socketRef.current.connected) return
    const drawData = { ...coords, mode, type: 'move' }
    drawOnLayer(coords.x, coords.y, mode, 'move')
    redrawCanvas()
    socketRef.current.emit('draw', drawData)
    drawingDataRef.current.push(drawData)
  }

  const handlePointerUp = (e) => {
    e.preventDefault()
    isDrawing.current = false
  }

  const reset = () => clearDrawingLayerLocal()

  const toggleMode = () => {
    const newMode = mode === 'draw' ? 'erase' : 'draw'
    setMode(newMode)
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('mode-change', newMode)
    }
  }

  const changePage = (dir) => {
    const newPage = currentPage + dir
    if (newPage < 1 || newPage > totalPages) return
    setCurrentPage(newPage)
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('page-change', newPage)
    }
  }

  const drawOtherUsersCursors = (ctx) => {
    if (!ctx) return
    Object.entries(otherUsers).forEach(([id, user]) => {
      if (!user || typeof user.x !== 'number' || typeof user.y !== 'number') return
      ctx.save()
      ctx.beginPath()
      ctx.fillStyle = user.color || 'blue'
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 1
      const size = 10
      ctx.arc(user.x, user.y, size, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'black'
      ctx.font = '12px Arial'
      ctx.fillText(user.name || 'User', user.x + size + 2, user.y + size / 2)
      ctx.restore()
    })
  }

  if (!login)
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute top-1/2 left-1/2 w-60 h-60 bg-cyan-500/5 rounded-full blur-3xl animate-pulse delay-500"></div>
        </div>
        
        <div className="relative z-10 w-full max-w-md">
          {/* Glassmorphic login card */}
          <div className="backdrop-blur-xl bg-white/[0.02] border border-white/10 rounded-3xl p-8 shadow-2xl animate-fadeInUp">
            {/* Logo with glow effect */}
            <div className="text-center mb-8">
              <h1 className="text-5xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2 animate-shimmer">
                LivePDF
              </h1>
              <div className="w-20 h-1 bg-gradient-to-r from-purple-400 to-cyan-400 mx-auto rounded-full opacity-60"></div>
            </div>
            
            {/* Login form */}
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && (password === 'room' ? setLogin(true) : alert('Wrong password'))}
                  className="w-full px-4 py-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:border-transparent transition-all duration-200 hover:bg-white/10"
                  placeholder="Enter password..."
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 block">Room ID</label>
                <input
                  value={roomId}
                  onChange={e => setRoomId(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:border-transparent transition-all duration-200 hover:bg-white/10"
                  placeholder="Room ID..."
                />
              </div>
              
              <button
                onClick={() => (password === 'room' ? setLogin(true) : alert('Wrong password'))}
                className="w-full py-3 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-purple-500/25 hover:scale-105 transition-all duration-200 active:scale-95"
              >
                Enter Workspace
              </button>
            </div>
            
            {/* User info preview */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userColor }}></div>
                <span>Joining as {userName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white select-none">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      {/* Header */}
      <div className="relative z-10 backdrop-blur-xl bg-white/[0.02] border-b border-white/10 sticky top-0">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            {/* Logo */}
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              LivePDF
            </h1>
            
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Tool buttons */}
              <div className="flex items-center gap-2 p-1 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
                <button
                  onClick={toggleMode}
                  className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    mode === 'draw' 
                      ? 'bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg' 
                      : 'bg-gradient-to-r from-gray-600 to-gray-700 text-white shadow-lg'
                  }`}
                >
                  {mode === 'draw' ? '✏️ Draw' : '🧽 Erase'}
                </button>
                
                <button
                  onClick={reset}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium rounded-lg hover:scale-105 transition-all duration-200 shadow-lg active:scale-95"
                >
                  🗑️ Clear
                </button>
              </div>
              
              {/* PDF controls */}
              {pdfDoc && (
                <div className="flex items-center gap-2 p-1 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
                  <button
                    onClick={() => changePage(-1)}
                    disabled={currentPage <= 1}
                    className="px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:opacity-50 text-white rounded-lg transition-all duration-200 font-medium"
                  >
                    ←
                  </button>
                  <span className="px-3 py-2 text-sm font-medium text-slate-300 min-w-[80px] text-center">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => changePage(1)}
                    disabled={currentPage >= totalPages}
                    className="px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:opacity-50 text-white rounded-lg transition-all duration-200 font-medium"
                  >
                    →
                  </button>
                </div>
              )}
              
              {/* Upload button */}
              <label className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium rounded-lg cursor-pointer hover:scale-105 transition-all duration-200 shadow-lg active:scale-95 flex items-center gap-2">
                📄 Upload PDF
                <input type="file" accept="application/pdf" onChange={handleUpload} className="hidden" />
              </label>
            </div>
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div className="relative z-10 container mx-auto px-4 py-8">
        <div className="flex flex-col xl:flex-row gap-8">
          {/* Canvas section */}
          <div className="flex-1 flex flex-col items-center">
            {/* Loading indicator */}
            {loading && (
              <div className="mb-4 p-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="animate-spin w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full"></div>
                  <span className="text-slate-300">Loading PDF...</span>
                </div>
              </div>
            )}
            
            {/* Canvas container */}
            <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 shadow-2xl">
              <canvas
                ref={canvasRef}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                onTouchCancel={handlePointerUp}
                className="bg-white rounded-xl shadow-lg cursor-crosshair max-w-full h-auto"
                style={{ touchAction: 'none', width: '600px', height: '800px' }}
              />
            </div>
          </div>
          
          {/* Sidebar */}
          <div className="xl:w-80">
            <div className="space-y-6">
              {/* Status card */}
              <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl">
                <h3 className="text-lg font-semibold mb-4 text-white">Session Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Mode:</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      mode === 'draw' ? 'bg-red-500/20 text-red-300' : 'bg-gray-500/20 text-gray-300'
                    }`}>
                      {mode === 'draw' ? 'Drawing' : 'Erasing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">User:</span>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userColor }}></div>
                      <span className="text-white font-medium">{userName}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Connection:</span>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        socketRef.current?.connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                      }`}></div>
                      <span className={socketRef.current?.connected ? 'text-green-300' : 'text-red-300'}>
                        {socketRef.current?.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Room:</span>
                    <span className="text-cyan-300 font-mono text-sm">{roomId}</span>
                  </div>
                </div>
              </div>
              
              {/* Active users */}
              {Object.keys(otherUsers).length > 0 && (
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl">
                  <h3 className="text-lg font-semibold mb-4 text-white">Active Users ({Object.keys(otherUsers).length})</h3>
                  <div className="space-y-2">
                    {Object.entries(otherUsers).map(([id, user]) => (
                      <div key={id} className="flex items-center gap-3 p-2 bg-white/5 rounded-lg">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: user.color }}></div>
                        <span className="text-slate-300 text-sm">{user.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      
    </div>
  )
}