import SignaturePad from 'signature_pad'
import { useEffect, useRef, useState } from 'react'
import { normalizeSignature } from './api'

export default function SignatureInput({ value, onChange }: { value: string | null; onChange: (s: string | null) => void }) {
  const [tab, setTab] = useState<'upload' | 'draw'>('draw')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pad = useRef<SignaturePad | null>(null)

  useEffect(() => {
    if (tab !== 'draw') return
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * dpr
    canvas.height = canvas.offsetHeight * dpr
    canvas.getContext('2d')!.scale(dpr, dpr)
    pad.current = new SignaturePad(canvas, { penColor: '#000000', minWidth: 1, maxWidth: 3 }) // transparent background by default
    return () => pad.current?.off()
  }, [tab])

  const use = async (blob: Blob) => {
    setError('')
    setBusy(true)
    try {
      onChange(await normalizeSignature(blob))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (t: typeof tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === t ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          {tabBtn('draw', 'Dibujar firma')}
          {tabBtn('upload', 'Cargar PNG')}
        </div>

        {tab === 'draw' ? (
          <>
            <canvas ref={canvasRef} className="h-48 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white" />
            <div className="mt-3 flex gap-2">
              <button onClick={() => pad.current?.clear()} className="btn-secondary">
                Borrar
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  if (!pad.current || pad.current.isEmpty()) return setError('Dibuja tu firma primero')
                  use(await (await fetch(pad.current.toDataURL('image/png'))).blob())
                }}
                className="btn-primary"
              >
                Usar esta firma
              </button>
            </div>
          </>
        ) : (
          <label className="flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/40">
            <span className="font-medium text-slate-700">{value ? 'Reemplazar imagen' : 'Seleccionar imagen PNG'}</span>
            <span className="mt-1">Preferiblemente con fondo transparente (máx. 5 MB)</span>
            <input
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (f.type !== 'image/png') return setError('La firma debe ser un archivo PNG')
                use(f)
              }}
            />
          </label>
        )}
        {busy && <p className="mt-3 text-sm text-slate-500">Procesando firma…</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Vista previa</h3>
        <div className="checker flex h-48 items-center justify-center rounded-lg p-4">
          {value ? (
            <img src={value} alt="Firma" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-slate-400">Aún no hay firma</span>
          )}
        </div>
        {value && (
          <button onClick={() => onChange(null)} className="btn-secondary mt-3">
            Quitar firma
          </button>
        )}
        <p className="mt-3 text-xs text-slate-500">Esta firma se usará en todos los documentos del lote.</p>
      </div>
    </div>
  )
}
