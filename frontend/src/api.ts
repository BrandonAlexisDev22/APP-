export type Box = { x: number; y: number; w: number; h: number } // relative to page (0–1)
export type Placement = Box & { page: number } // page is 0-based

export type Doc = {
  id: string
  name: string
  format: 'pdf' | 'docx'
  size: number
  pages: number
  placement?: Placement
  status?: 'processing' | 'done' | 'error'
  error?: string
  signedAt?: number
}

export const MAX_FILE_MB = 25

// Backend base URL; empty = same origin (dev proxy / backend serving the build).
const API = import.meta.env.VITE_API_URL ?? ''

async function check(r: Response): Promise<Response> {
  if (r.ok) return r
  let msg = `Error ${r.status}`
  try {
    const { detail } = await r.json()
    msg = typeof detail === 'string' ? detail : detail.map((d: { msg: string }) => d.msg).join('; ')
  } catch {
    /* non-JSON error body */
  }
  throw new Error(msg)
}

const form = (blob: Blob, name: string) => {
  const f = new FormData()
  f.append('file', blob, name)
  return f
}

export async function uploadDocument(file: File): Promise<Doc> {
  return (await check(await fetch(`${API}/api/documents`, { method: 'POST', body: form(file, file.name) }))).json()
}

export const deleteDocument = (id: string) => fetch(`${API}/api/documents/${id}`, { method: 'DELETE' }).catch(() => {})

/** Validates/trims the PNG on the server; returns it as a data URL. */
export async function normalizeSignature(png: Blob): Promise<string> {
  const blob = await (await check(await fetch(`${API}/api/signature`, { method: 'POST', body: form(png, 'firma.png') }))).blob()
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

export async function signDocument(id: string, placement: Placement, signature: string) {
  await check(
    await fetch(`${API}/api/documents/${id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...placement, signature }),
    }),
  )
}

export const pdfUrl = (id: string) => `${API}/api/documents/${id}/pdf`
export const signedUrl = (d: Doc) => `${API}/api/documents/${d.id}/signed?v=${d.signedAt ?? 0}`
export const zipUrl = (ids: string[]) => `${API}/api/zip?ids=${ids.join(',')}`

export const formatSize = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
