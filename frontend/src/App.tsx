import { useEffect, useState } from 'react'
import {
  type Box,
  type Doc,
  type Placement,
  MAX_FILE_MB,
  deleteDocument,
  formatSize,
  pdfUrl,
  signDocument,
  signedUrl,
  uploadDocument,
  zipUrl,
} from './api'
import PdfViewer from './PdfViewer'
import SignatureInput from './SignatureInput'

const STEPS = ['Cargar documentos', 'Ubicar firmas', 'Agregar firma', 'Procesar y descargar']
type Upload = { key: number; name: string; error?: string }
/** Last saved placement, reused for other documents. `onLast` keeps "last page" meaning across page counts. */
type Template = { placement: Placement; onLast: boolean }

const adapt = (t: Template, doc: Doc): Placement => ({
  ...t.placement,
  page: t.onLast ? doc.pages - 1 : Math.min(t.placement.page, doc.pages - 1),
})

export default function App() {
  const [step, setStep] = useState(0)
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploads, setUploads] = useState<Upload[]>([])
  const [signature, setSignatureRaw] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [processing, setProcessing] = useState(false)

  const patch = (id: string, p: Partial<Doc>) => setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)))
  const resetStatus = (d: Doc): Doc => ({ ...d, status: undefined, error: undefined })

  const setSignature = (s: string | null) => {
    setSignatureRaw(s)
    setDocs((ds) => ds.map(resetStatus)) // signed outputs are stale once the signature changes
  }

  async function uploadFiles(files: File[]) {
    const queue = files.map((file, i) => ({ file, key: Date.now() + i }))
    setUploads((u) => [...u, ...queue.map(({ file, key }) => ({ key, name: file.name }))])
    const fail = (key: number, error: string) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error } : x)))
    // A few at a time: DOCX conversion with LibreOffice is CPU-heavy.
    const worker = async () => {
      for (let item; (item = queue.shift()); ) {
        const { file, key } = item
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (ext !== 'pdf' && ext !== 'docx') fail(key, 'Formato no permitido: solo PDF o DOCX')
        else if (file.size > MAX_FILE_MB * 1024 * 1024) fail(key, `El archivo supera ${MAX_FILE_MB} MB`)
        else if (file.size === 0) fail(key, 'El archivo está vacío')
        else
          try {
            const doc = await uploadDocument(file)
            setDocs((ds) => [...ds, doc])
            setUploads((u) => u.filter((x) => x.key !== key))
          } catch (e) {
            fail(key, (e as Error).message)
          }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }

  function removeDoc(id: string) {
    deleteDocument(id)
    setDocs((ds) => ds.filter((d) => d.id !== id))
  }

  async function signAll() {
    setProcessing(true)
    setDocs((ds) => ds.map(resetStatus))
    for (const d of docs) {
      patch(d.id, { status: 'processing' })
      try {
        await signDocument(d.id, d.placement!, signature!)
        patch(d.id, { status: 'done', signedAt: Date.now() })
      } catch (e) {
        patch(d.id, { status: 'error', error: (e as Error).message })
      }
    }
    setProcessing(false)
  }

  const canGo = (i: number) => !processing && (i === 0 || docs.length > 0)

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Signify <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-800">BETA</span></h1>
          <nav className="flex flex-wrap gap-1">
            {STEPS.map((s, i) => (
              <button
                key={s}
                disabled={!canGo(i)}
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${
                  step === i ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    step === i ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {i + 1}
                </span>
                {s}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {step === 0 && (
          <UploadStep docs={docs} uploads={uploads} onFiles={uploadFiles} onRemove={removeDoc}
            onDismiss={(key) => setUploads((u) => u.filter((x) => x.key !== key))} />
        )}
        {step === 1 && (
          <PlaceStep
            docs={docs}
            selected={selected}
            setSelected={setSelected}
            template={template}
            signature={signature}
            onSave={(id, placement) => {
              const doc = docs.find((d) => d.id === id)!
              patch(id, { placement, status: undefined, error: undefined })
              setTemplate({ placement, onLast: placement.page === doc.pages - 1 })
            }}
            onApplyAll={(t) =>
              setDocs((ds) => ds.map((d) => (d.placement ? d : { ...resetStatus(d), placement: adapt(t, d) })))
            }
          />
        )}
        {step === 2 && (
          <>
            <StepTitle title="Agregar firma" text="Dibuja tu firma o carga una imagen PNG. Se usará en todos los documentos." />
            <SignatureInput value={signature} onChange={setSignature} />
          </>
        )}
        {step === 3 && (
          <ProcessStep docs={docs} signature={signature} processing={processing} selected={selected}
            setSelected={setSelected} onSign={signAll} goTo={setStep} />
        )}

        <div className="mt-8 flex justify-between border-t border-slate-200 pt-4">
          <button className="btn-secondary" disabled={step === 0 || processing} onClick={() => setStep(step - 1)}>
            ← Anterior
          </button>
          {step < 3 && (
            <button className="btn-primary" disabled={!canGo(step + 1)} onClick={() => setStep(step + 1)}>
              Siguiente →
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

function StepTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  )
}

function FormatBadge({ format }: { format: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${format === 'pdf' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
      {format}
    </span>
  )
}

function UploadStep({ docs, uploads, onFiles, onRemove, onDismiss }: {
  docs: Doc[]
  uploads: Upload[]
  onFiles: (f: File[]) => void
  onRemove: (id: string) => void
  onDismiss: (key: number) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <>
      <StepTitle title="Cargar documentos" text={`Archivos PDF o DOCX, hasta ${MAX_FILE_MB} MB cada uno. Los DOCX se convierten a PDF automáticamente.`} />
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFiles([...e.dataTransfer.files])
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          over ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400'
        }`}
      >
        <svg className="mb-3 h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span className="font-medium text-slate-700">Arrastra y suelta tus archivos aquí</span>
        <span className="mt-1 text-sm text-slate-500">o</span>
        <span className="btn-primary mt-2">Seleccionar archivos</span>
        <input type="file" multiple accept=".pdf,.docx" className="hidden"
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </label>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm">
          <span className="font-semibold text-slate-700">Documentos cargados</span>
          <span className="text-slate-500">Total: {docs.length}</span>
        </div>
        {docs.length === 0 && uploads.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Aún no hay documentos</p>}
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <FormatBadge format={d.format} />
              <span className="flex-1 truncate" title={d.name}>{d.name}</span>
              <span className="text-slate-500">{d.pages} pág.</span>
              <span className="w-16 text-right text-slate-500">{formatSize(d.size)}</span>
              <button onClick={() => onRemove(d.id)} className="text-slate-400 hover:text-red-600" aria-label={`Eliminar ${d.name}`}>✕</button>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.key} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${u.error ? 'bg-red-50' : ''}`}>
              <span className="flex-1 truncate">{u.name}</span>
              {u.error ? (
                <>
                  <span className="text-red-600">{u.error}</span>
                  <button onClick={() => onDismiss(u.key)} className="text-slate-400 hover:text-slate-700" aria-label="Descartar">✕</button>
                </>
              ) : (
                <span className="animate-pulse text-slate-500">Subiendo y procesando…</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function DocList({ docs, selected, onSelect, right }: {
  docs: Doc[]
  selected?: string
  onSelect: (id: string) => void
  right: (d: Doc) => React.ReactNode
}) {
  return (
    <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 bg-white">
      {docs.map((d) => (
        <li key={d.id}>
          <button onClick={() => onSelect(d.id)}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${d.id === selected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
            <FormatBadge format={d.format} />
            <span className="flex-1 truncate" title={d.name}>{d.name}</span>
            {right(d)}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Toolbar({ page, pages, setPage, zoom, setZoom, children }: {
  page: number
  pages: number
  setPage: (p: number) => void
  zoom: number
  setZoom: (z: number) => void
  children?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <button className="btn-icon" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">‹</button>
      <select value={page} onChange={(e) => setPage(+e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2" aria-label="Página">
        {Array.from({ length: pages }, (_, i) => (
          <option key={i} value={i}>Página {i + 1} de {pages}</option>
        ))}
      </select>
      <button className="btn-icon" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Página siguiente">›</button>
      <span className="mx-2 h-5 w-px bg-slate-300" />
      <button className="btn-icon" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Alejar">−</button>
      <span className="w-12 text-center text-slate-600">{Math.round(zoom * 100)}%</span>
      <button className="btn-icon" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Acercar">+</button>
      <div className="ml-auto flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function PlaceStep({ docs, selected, setSelected, template, signature, onSave, onApplyAll }: {
  docs: Doc[]
  selected: string | null
  setSelected: (id: string) => void
  template: Template | null
  signature: string | null
  onSave: (id: string, p: Placement) => void
  onApplyAll: (t: Template) => void
}) {
  const doc = docs.find((d) => d.id === selected) ?? docs[0]
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [draft, setDraft] = useState<Box | null>(null)

  useEffect(() => {
    const p = doc.placement ?? (template && adapt(template, doc))
    setPage(p ? p.page : doc.pages - 1) // signatures usually go on the last page
    setDraft(p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null)
  }, [doc.id])

  const pl = doc.placement
  const saved = !!pl && !!draft && pl.page === page && pl.x === draft.x && pl.y === draft.y && pl.w === draft.w && pl.h === draft.h
  const missing = docs.filter((d) => !d.placement).length

  return (
    <>
      <StepTitle title="Ubicar firmas" text="Haz clic o arrastra sobre la página para crear el recuadro de firma. Muévelo o cambia su tamaño desde la esquina." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div>
          <DocList docs={docs} selected={doc.id} onSelect={setSelected}
            right={(d) => d.placement
              ? <span className="text-xs text-emerald-600">✓ Pág. {d.placement.page + 1}</span>
              : <span className="text-xs text-amber-600">Sin ubicar</span>} />
          <p className="mt-3 text-xs text-slate-500">{docs.length - missing} de {docs.length} documentos con posición.</p>
          {template && missing > 0 && (
            <button className="btn-secondary mt-3 w-full" onClick={() => onApplyAll(template)}>
              Usar la última posición en los {missing} sin ubicar
            </button>
          )}
        </div>
        <div className="min-w-0">
          <Toolbar page={page} pages={doc.pages} setPage={setPage} zoom={zoom} setZoom={setZoom}>
            {draft && <button className="btn-secondary" onClick={() => setDraft(null)}>Quitar recuadro</button>}
            <button className="btn-primary" disabled={!draft || saved} onClick={() => draft && onSave(doc.id, { ...draft, page })}>
              {saved ? '✓ Posición guardada' : 'Guardar posición'}
            </button>
          </Toolbar>
          <div className="overflow-auto rounded-xl bg-slate-200/60 p-4">
            <PdfViewer url={pdfUrl(doc.id)} page={page} zoom={zoom} box={draft} onBox={setDraft} signature={signature} />
          </div>
        </div>
      </div>
    </>
  )
}

function ProcessStep({ docs, signature, processing, selected, setSelected, onSign, goTo }: {
  docs: Doc[]
  signature: string | null
  processing: boolean
  selected: string | null
  setSelected: (id: string) => void
  onSign: () => void
  goTo: (step: number) => void
}) {
  const doc = docs.find((d) => d.id === selected) ?? docs[0]
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(doc.placement?.page ?? 0), [doc.id, doc.placement?.page])

  const unplaced = docs.filter((d) => !d.placement)
  const finished = docs.filter((d) => d.status === 'done' || d.status === 'error').length
  const done = docs.filter((d) => d.status === 'done')
  const failed = docs.filter((d) => d.status === 'error')
  const ready = !!signature && unplaced.length === 0
  const statusLabel = (d: Doc) =>
    d.status === 'done' ? <span className="text-xs text-emerald-600">✓ Firmado</span>
    : d.status === 'error' ? <span className="text-xs text-red-600">Error</span>
    : d.status === 'processing' ? <span className="animate-pulse text-xs text-indigo-600">Procesando…</span>
    : !d.placement ? <span className="text-xs text-amber-600">Sin ubicar</span>
    : <span className="text-xs text-slate-400">Pendiente</span>

  return (
    <>
      <StepTitle title="Procesar y descargar" text="Revisa la vista previa de cada documento y firma todo el lote." />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Documentos" value={docs.length} />
        <Stat label="Firmados" value={done.length} tone="text-emerald-600" />
        <Stat label="Con errores" value={failed.length} tone={failed.length ? 'text-red-600' : undefined} />
      </div>

      {!signature && (
        <Warn>Aún no has agregado tu firma. <button className="underline" onClick={() => goTo(2)}>Agregar firma</button></Warn>
      )}
      {unplaced.length > 0 && (
        <Warn>{unplaced.length} documento(s) sin posición de firma. <button className="underline" onClick={() => goTo(1)}>Ubicar firmas</button></Warn>
      )}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!ready || processing} onClick={onSign}>
            {processing ? 'Firmando…' : finished ? 'Volver a firmar todos' : `Firmar todos (${docs.length})`}
          </button>
          {done.length > 0 && !processing && (
            <a className="btn-secondary" href={zipUrl(done.map((d) => d.id))}>Descargar todos (ZIP)</a>
          )}
          <span className="ml-auto text-sm text-slate-500">{finished} / {docs.length} procesados</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={finished} aria-valuemax={docs.length}>
          <div className={`h-full transition-all ${failed.length ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${(finished / docs.length) * 100}%` }} />
        </div>
        {failed.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-red-600">
            {failed.map((d) => <li key={d.id}><b>{d.name}:</b> {d.error}</li>)}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <DocList docs={docs} selected={doc.id} onSelect={setSelected}
          right={(d) => (
            <>
              {statusLabel(d)}
              {d.status === 'done' && (
                <a href={signedUrl(d)} download onClick={(e) => e.stopPropagation()}
                  className="rounded px-1.5 text-indigo-600 hover:bg-indigo-100" aria-label={`Descargar ${d.name}`} title="Descargar">⬇</a>
              )}
            </>
          )} />
        <div className="min-w-0">
          <Toolbar page={page} pages={doc.pages} setPage={setPage} zoom={zoom} setZoom={setZoom}>
            <span className="self-center text-xs font-medium text-slate-500">
              {doc.status === 'done' ? 'Documento firmado' : 'Vista previa'}
            </span>
          </Toolbar>
          <div className="overflow-auto rounded-xl bg-slate-200/60 p-4">
            {doc.status === 'done' ? (
              <PdfViewer url={signedUrl(doc)} page={page} zoom={zoom} />
            ) : (
              <PdfViewer url={pdfUrl(doc.id)} page={page} zoom={zoom}
                box={doc.placement?.page === page ? doc.placement : null} signature={signature} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{children}</div>
}
