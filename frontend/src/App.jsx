import { useRef, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

function randomColor() {
  return '#' + Math.floor(Math.random() * 16777215).toString(16)
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
      <div className="flex flex-col justify-center items-center h-screen bg-gray-900 text-white">
        <h1 className="text-6xl font-mono text-amber-300 mb-9 pb-10">LivePDF</h1>
        <h2 className="text-xl mb-4">Enter Password</h2>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && (password === 'room' ? setLogin(true) : alert('Wrong password'))}
          className="p-2 bg-white/10 text-white rounded mb-4 border"
          placeholder="Enter password..."
        />
        <label className="text-white mb-2">Room ID:</label>
        <input
          value={roomId}
          onChange={e => setRoomId(e.target.value)}
          className="p-2 bg-white/10 text-white rounded mb-4 border"
          placeholder="Room ID..."
        />
        <button
          type="submit"
          onClick={() => (password === 'room' ? setLogin(true) : alert('Wrong password'))}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded hover:opacity-80 transition-opacity"
        >
          Enter
        </button>
      </div>
    )

  return (
    <div className="flex flex-col items-center h-screen bg-gray-900 p-4 select-none">
      <div className="mb-4">
        <button
          onClick={reset}
          className="px-4 py-2 bg-gradient-to-br from-blue-700 to-fuchsia-800 text-white m-2 rounded hover:opacity-80 transition-opacity"
        >
          Reset
        </button>
        <button
          onClick={toggleMode}
          className="px-4 py-2 bg-gradient-to-br from-blue-700 to-fuchsia-700 text-white m-2 rounded hover:opacity-80 transition-opacity"
        >
          {mode === 'draw' ? 'Switch to Erase' : 'Switch to Draw'}
        </button>
        {pdfDoc && (
          <>
            <button
              onClick={() => changePage(-1)}
              disabled={currentPage <= 1}
              className="px-4 py-2 bg-gray-600 text-white m-2 rounded disabled:opacity-50 hover:bg-gray-500 transition-colors"
            >
              Prev
            </button>
            <span className="text-white mx-2">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => changePage(1)}
              disabled={currentPage >= totalPages}
              className="px-4 py-2 bg-gray-600 text-white m-2 rounded disabled:opacity-50 hover:bg-gray-500 transition-colors"
            >
              Next
            </button>
          </>
        )}
      </div>
      <label className="bg-gradient-to-br from-orange-700 to-red-900 text-white px-4 py-2 rounded cursor-pointer mb-4 hover:opacity-80 transition-opacity">
        Upload PDF
        <input type="file" accept="application/pdf" onChange={handleUpload} className="hidden" />
      </label>
      {loading && <div className="text-white">Loading PDF...</div>}
      <div className="text-white mt-4 text-sm">
        Mode: <span className="font-bold text-blue-300">{mode}</span> | Logged in as:{' '}
        <span style={{ color: userColor }}>{userName}</span>
        {socketRef.current?.connected ? (
          <span className="text-green-400 ml-2">● Connected</span>
        ) : (
          <span className="text-red-400 ml-2">● Disconnected</span>
        )}
      </div>
      <div style={{ position: 'relative', userSelect: 'none' }}>
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
          className="border w-[600px] h-[800px] bg-white cursor-crosshair"
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
