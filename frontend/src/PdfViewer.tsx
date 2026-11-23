import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { Box } from './api'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
type Drag = { mode: 'draw' | 'move' | 'resize'; x0: number; y0: number; start: Box }

/**
 * Renders one PDF page with PDF.js. The overlay box uses coordinates relative to the
 * rendered (rotation-aware) page, which is exactly what the backend's page.rect uses.
 */
export default function PdfViewer({
  url,
  page,
  zoom,
  box,
  onBox,
  signature,
}: {
  url: string
  page: number
  zoom: number
  box?: Box | null
  onBox?: (b: Box) => void
  signature?: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [error, setError] = useState('')

  useEffect(() => {
    setPdf(null)
    setError('')
    let cancelled = false
    const task = pdfjs.getDocument({ url })
    task.promise.then(
      (p) => !cancelled && setPdf(p),
      () => !cancelled && setError('No se pudo cargar el documento'), // destroy() rejects in-flight loads
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [url])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    let render: pdfjs.RenderTask | undefined
    pdf.getPage(Math.min(page, pdf.numPages - 1) + 1).then((p) => {
      if (cancelled) return
      const viewport = p.getViewport({ scale: zoom })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current!
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      setSize({ w: viewport.width, h: viewport.height })
      render = p.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] })
      render.promise.catch(() => {}) // cancelled renders reject
    })
    return () => {
      cancelled = true
      render?.cancel()
    }
  }, [pdf, page, zoom])

  const point = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
  }

  const start = (mode: Drag['mode']) => (e: React.PointerEvent) => {
    if (!onBox) return
    e.stopPropagation()
    e.preventDefault()
    const p = point(e)
    drag.current = { mode, x0: p.x, y0: p.y, start: box ?? { x: p.x, y: p.y, w: 0, h: 0 } }
    overlayRef.current!.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !onBox) return
    const p = point(e)
    const dx = p.x - d.x0
    const dy = p.y - d.y0
    const s = d.start
    if (d.mode === 'draw')
      onBox({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(dx), h: Math.abs(dy) })
    else if (d.mode === 'move')
      onBox({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) })
    else onBox({ ...s, w: clamp(s.w + dx, 0.02, 1 - s.x), h: clamp(s.h + dy, 0.01, 1 - s.y) })
  }

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.mode !== 'draw' || !onBox) return
    const p = point(e)
    // A click (or tiny drag) drops a default-sized box centred on the click.
    if (Math.abs(p.x - d.x0) < 0.02 || Math.abs(p.y - d.y0) < 0.01) {
      const w = 0.25
      const h = Math.min(0.2, (w * size.w) / size.h / 3) // ~3:1 box on screen
      onBox({ x: clamp(p.x - w / 2, 0, 1 - w), y: clamp(p.y - h / 2, 0, 1 - h), w, h })
    }
  }

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>

  return (
    <div className="relative mx-auto shadow-lg ring-1 ring-slate-200 bg-white" style={{ width: size.w, height: size.h }}>
      {!pdf && <div className="p-8 text-slate-400">Cargando…</div>}
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} className="block" />
      <div
        ref={overlayRef}
        className={`absolute inset-0 touch-none ${onBox ? 'cursor-crosshair' : ''}`}
        onPointerDown={start('draw')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {box && box.w > 0 && (
          <div
            className={`absolute ${onBox ? 'cursor-move border-2 border-dashed border-brand-500 bg-brand-500/10' : ''}`}
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
            onPointerDown={start('move')}
          >
            {signature ? (
              <img src={signature} alt="Firma" draggable={false} className="pointer-events-none h-full w-full object-contain" />
            ) : (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-brand-600">
                Firma
              </span>
            )}
            {onBox && (
              <div
                aria-label="Redimensionar"
                className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-600"
                onPointerDown={start('resize')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
