import { useRef, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

export default function App() {
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const socketRef = useRef()
  const [mode, setMode] = useState('draw')
  const [login, setLogin] = useState(false)
  const [password, setPassword] = useState('')
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [drawingLayer, setDrawingLayer] = useState(null)
  const [pdfLayer, setPdfLayer] = useState(null)
  const [loading, setLoading] = useState(false)
  const drawingDataRef = useRef([])

  useEffect(() => {
    if (!login) return
    socketRef.current = io(import.meta.env.VITE_BACKEND_URL, { transports: ['websocket', 'polling'] });

    socketRef.current.on('draw', (data) => {
      drawOnLayer(data.x, data.y, data.mode, data.type)
      redrawCanvas()
      drawingDataRef.current.push(data)
    })
    socketRef.current.on('init-canvas', (alldata) => {
      if (!drawingLayer) return
      drawingDataRef.current = alldata
      const ctx = drawingLayer.getContext('2d')
      ctx.clearRect(0, 0, drawingLayer.width, drawingLayer.height)
      alldata.forEach(point => {
        drawOnLayer(point.x, point.y, point.mode, point.type)
      })
      redrawCanvas()
    })
    socketRef.current.on('reset-canvas', () => {
      const ctx = drawingLayer?.getContext('2d')
      ctx?.clearRect(0, 0, drawingLayer.width, drawingLayer.height)
      redrawCanvas()
      drawingDataRef.current = []
    })
    socketRef.current.on("pdf-upload", async (arrayBuffer) => {
      const pdfjsLib = window.pdfjsLib
      if (!pdfjsLib) return alert("PDF.js not loaded")
      setLoading(true)
      drawingDataRef.current = []
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
        setPdfDoc(pdf)
        setTotalPages(pdf.numPages)
        setCurrentPage(1)
      } catch {
        alert("Error loading shared PDF")
      } finally {
        setLoading(false)
      }
    })
    socketRef.current.on('page-change', (pageNum) => {
      setCurrentPage(pageNum)
    })
    socketRef.current.on('mode-change', setMode)
    return () => socketRef.current.disconnect()
  }, [login, drawingLayer])

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
    if (pdfDoc && pdfLayer && drawingLayer) {
      clearDrawingLayer()
      renderPage(currentPage)
    }
  }, [pdfDoc, currentPage, pdfLayer, drawingLayer])

  useEffect(() => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
  }, [])

  const clearDrawingLayer = () => {
    if (!drawingLayer) return
    const ctx = drawingLayer.getContext('2d')
    ctx.clearRect(0, 0, drawingLayer.width, drawingLayer.height)
    redrawCanvas()
    drawingDataRef.current = []
    socketRef.current.emit('reset-canvas')
  }

  const renderPage = async (pageNumber) => {
    if (!pdfDoc || !pdfLayer || !drawingLayer) return
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
      redrawCanvas()
    } catch {
      // ignore or alert error if needed
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return alert('Upload PDF')
    const pdfjsLib = window.pdfjsLib
    if (!pdfjsLib) return alert('PDF.js not loaded')
    setLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      socketRef.current.emit("pdf-upload", arrayBuffer)
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      clearDrawingLayer()
    } catch {
      alert('PDF load error')
    } finally {
      setLoading(false)
    }
  }

  const redrawCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (pdfLayer) ctx.drawImage(pdfLayer, 0, 0)
    if (drawingLayer) ctx.drawImage(drawingLayer, 0, 0)
  }

  const drawOnLayer = (x, y, mode, type) => {
    const ctx = drawingLayer?.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = mode === 'draw' ? 2 : 20
    ctx.strokeStyle = mode === 'draw' ? 'red' : 'rgba(0,0,0,1)'
    ctx.globalCompositeOperation = mode === 'draw' ? 'source-over' : 'destination-out'
    ctx.lineCap = 'round'
    if (type === 'start') ctx.beginPath(), ctx.moveTo(x, y)
    else ctx.lineTo(x, y), ctx.stroke()
  }

  const getCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  const handleMouseDown = (e) => {
    isDrawing.current = true
    const coords = getCoords(e)
    drawOnLayer(coords.x, coords.y, mode, 'start')
    redrawCanvas()
    socketRef.current.emit('draw', { ...coords, mode, type: 'start' })
    drawingDataRef.current.push({ ...coords, mode, type: 'start' })
  }

  const handleMouseMove = (e) => {
    if (!isDrawing.current) return
    const coords = getCoords(e)
    drawOnLayer(coords.x, coords.y, mode, 'move')
    redrawCanvas()
    socketRef.current.emit('draw', { ...coords, mode, type: 'move' })
    drawingDataRef.current.push({ ...coords, mode, type: 'move' })
  }

  const handleMouseUp = () => {
    isDrawing.current = false
  }

  const reset = () => {
    clearDrawingLayer()
  }

  const toggleMode = () => {
    const newMode = mode === 'draw' ? 'erase' : 'draw'
    setMode(newMode)
    socketRef.current.emit('mode-change', newMode)
  }

  const changePage = (dir) => {
    const newPage = currentPage + dir
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      socketRef.current.emit("page-change", newPage)
    }
  }

  if (!login) return (
    <div className="flex flex-col justify-center items-center h-screen bg-gray-900 text-white">
      <h2 className="text-2xl mb-4">Enter Password</h2>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="p-2 bg-white/10 text-white rounded mb-4 border" />
      <button onClick={() => password === 'room' ? setLogin(true) : alert("Wrong password")} className="px-4 py-2 bg-green-600 rounded">Login</button>
    </div>
  )

  return (
    <div className="flex flex-col items-center 2*h-screen bg-gray-900 p-4">
      <div className="mb-4">
        <button onClick={reset} className="px-4 py-2 bg-red-600 text-white m-2 rounded">Reset</button>
        <button onClick={toggleMode} className="px-4 py-2 bg-blue-600 text-white m-2 rounded">{mode === 'draw' ? 'Erase' : 'Draw'}</button>
        {pdfDoc && (
          <>
            <button onClick={() => changePage(-1)} disabled={currentPage <= 1} className="px-4 py-2 bg-gray-600 text-white m-2 rounded disabled:opacity-50">Prev</button>
            <span className="text-white mx-2">Page {currentPage} / {totalPages}</span>
            <button onClick={() => changePage(1)} disabled={currentPage >= totalPages} className="px-4 py-2 bg-gray-600 text-white m-2 rounded disabled:opacity-50">Next</button>
          </>
        )}
      </div>
      <label className="bg-blue-600 text-white px-4 py-2 rounded cursor-pointer mb-4">Upload PDF<input type="file" accept="application/pdf" onChange={handleUpload} className="hidden" /></label>
      {loading && <div className="text-white">Loading PDF...</div>}
      <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} className="border w-[600px] h-[800px] bg-white" />
      <div className="text-white mt-4 text-sm">Mode: <span className="font-bold text-blue-300">{mode}</span></div>
    </div>
  )
}
