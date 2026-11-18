"""Firma masiva de documentos: API de carga, conversión, firma y descarga."""
import base64
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

import pymupdf as fitz
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

DATA = Path(os.getenv("DATA_DIR", Path(tempfile.gettempdir()) / "firma-masiva"))
TTL_SECONDS = int(os.getenv("TEMP_TTL_MINUTES", "120")) * 60
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_MB", "25")) * 1024 * 1024
MAX_SIGNATURE_BYTES = 5 * 1024 * 1024
SOFFICE = os.getenv("SOFFICE", "soffice")
DATA.mkdir(parents=True, exist_ok=True)


def purge_expired():
    cutoff = time.time() - TTL_SECONDS
    for p in DATA.iterdir():
        if p.stat().st_mtime < cutoff:
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)


def cleaner():
    while True:
        purge_expired()
        time.sleep(300)


@asynccontextmanager
async def lifespan(_):
    threading.Thread(target=cleaner, daemon=True).start()
    yield


app = FastAPI(title="Firma masiva", lifespan=lifespan)
# Frontend hosted elsewhere (e.g. GitHub Pages) needs CORS; comma-separated origins.
if origins := os.getenv("ALLOWED_ORIGINS"):
    app.add_middleware(CORSMiddleware, allow_origins=origins.split(","), allow_methods=["*"], allow_headers=["*"])


def doc_dir(doc_id: str) -> Path:
    d = DATA / doc_id
    if not re.fullmatch(r"[0-9a-f]{32}", doc_id) or not d.is_dir():
        raise HTTPException(404, "Documento no encontrado o expirado")
    return d


def docx_to_pdf(src: Path):
    # Own LibreOffice profile per conversion so parallel uploads don't lock each other.
    profile = src.parent / "lo-profile"
    try:
        subprocess.run(
            [SOFFICE, f"-env:UserInstallation={profile.as_uri()}", "--headless",
             "--convert-to", "pdf", "--outdir", str(src.parent), str(src)],
            capture_output=True, timeout=180, check=True,
        )
    except (subprocess.SubprocessError, OSError):
        raise HTTPException(422, "No se pudo convertir el DOCX a PDF")
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not src.with_suffix(".pdf").exists():
        raise HTTPException(422, "No se pudo convertir el DOCX a PDF")


@app.post("/api/documents")
def upload_document(file: UploadFile = File(...)):
    name = Path(file.filename or "documento").name
    ext = Path(name).suffix.lower()
    if ext not in (".pdf", ".docx"):
        raise HTTPException(400, "Formato no permitido: solo PDF o DOCX")
    data = file.file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, f"El archivo supera {MAX_FILE_BYTES // 1024 // 1024} MB")
    if not data.startswith(b"%PDF" if ext == ".pdf" else b"PK"):
        raise HTTPException(400, f"El contenido no corresponde a un archivo {ext[1:].upper()} válido")

    doc_id = uuid.uuid4().hex
    d = DATA / doc_id
    d.mkdir()
    try:
        (d / f"original{ext}").write_bytes(data)
        if ext == ".docx":
            docx_to_pdf(d / "original.docx")
        try:
            with fitz.open(d / "original.pdf") as pdf:
                if pdf.needs_pass:
                    raise HTTPException(422, "El PDF está protegido con contraseña")
                pages = pdf.page_count
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "El PDF está dañado o no se puede leer")
        if pages == 0:
            raise HTTPException(422, "El documento no tiene páginas")
        (d / "meta.json").write_text(json.dumps({"name": name}))
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    return {"id": doc_id, "name": name, "format": ext[1:], "size": len(data), "pages": pages}


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    shutil.rmtree(doc_dir(doc_id), ignore_errors=True)
    return {"ok": True}


@app.get("/api/documents/{doc_id}/pdf")
def document_pdf(doc_id: str):
    return FileResponse(doc_dir(doc_id) / "original.pdf", media_type="application/pdf")


def normalize_signature(data: bytes) -> bytes:
    try:
        img = Image.open(io.BytesIO(data))
        if img.format != "PNG":
            raise ValueError
        img = img.convert("RGBA")
    except Exception:
        raise HTTPException(400, "La firma debe ser una imagen PNG válida")
    alpha = img.getchannel("A")
    if alpha.getextrema()[0] == 255:
        # Opaque PNG (e.g. a scan): turn the light paper background transparent so it doesn't hide the document.
        alpha = img.convert("L").point(lambda v: max(0, min(255, (235 - v) * 4)))
        img.putalpha(alpha)
    bbox = alpha.getbbox()
    if not bbox:
        raise HTTPException(400, "La firma está vacía")
    out = io.BytesIO()
    img.crop(bbox).save(out, "PNG")
    return out.getvalue()


@app.post("/api/signature")
def signature(file: UploadFile = File(...)):
    data = file.file.read(MAX_SIGNATURE_BYTES + 1)
    if len(data) > MAX_SIGNATURE_BYTES:
        raise HTTPException(413, "La imagen de la firma supera 5 MB")
    return Response(normalize_signature(data), media_type="image/png")


class SignRequest(BaseModel):
    page: int = Field(ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)
    signature: str  # PNG en base64 (data URL o base64 plano)


@app.post("/api/documents/{doc_id}/sign")
def sign_document(doc_id: str, req: SignRequest):
    d = doc_dir(doc_id)
    try:
        png = base64.b64decode(req.signature.split(",")[-1], validate=True)
    except Exception:
        raise HTTPException(400, "Firma inválida")
    if len(png) > MAX_SIGNATURE_BYTES:
        raise HTTPException(413, "La firma es demasiado grande")
    png = normalize_signature(png)
    with fitz.open(d / "original.pdf") as pdf:
        if req.page >= pdf.page_count:
            raise HTTPException(400, f"La página {req.page + 1} no existe en el documento")
        page = pdf[req.page]
        r = page.rect  # visible page, already accounts for /Rotate and CropBox
        x0, y0 = r.x0 + req.x * r.width, r.y0 + req.y * r.height
        x1 = min(r.x1, x0 + req.w * r.width)
        y1 = min(r.y1, y0 + req.h * r.height)
        # insert_image works in unrotated coordinates; rotate=page.rotation keeps the signature upright as displayed.
        page.insert_image(fitz.Rect(x0, y0, x1, y1) * page.derotation_matrix, stream=png,
                          keep_proportion=True, rotate=page.rotation)
        pdf.save(d / "signed.pdf", garbage=3, deflate=True)
    return {"ok": True}


def signed_name(d: Path) -> str:
    return Path(json.loads((d / "meta.json").read_text())["name"]).stem + "_firmado.pdf"


@app.get("/api/documents/{doc_id}/signed")
def download_signed(doc_id: str):
    d = doc_dir(doc_id)
    if not (d / "signed.pdf").exists():
        raise HTTPException(404, "El documento aún no ha sido firmado")
    return FileResponse(d / "signed.pdf", media_type="application/pdf", filename=signed_name(d))


@app.get("/api/zip")
def download_zip(ids: str = Query(...)):
    zip_path = DATA / f"lote-{uuid.uuid4().hex}.zip"
    used: set[str] = set()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for doc_id in ids.split(","):
            d = DATA / doc_id
            if not re.fullmatch(r"[0-9a-f]{32}", doc_id) or not (d / "signed.pdf").exists():
                continue
            name, n = signed_name(d), 1
            while name in used:
                n += 1
                name = signed_name(d).replace("_firmado.pdf", f"_firmado ({n}).pdf")
            used.add(name)
            z.write(d / "signed.pdf", name)
    if not used:
        zip_path.unlink()
        raise HTTPException(404, "No hay documentos firmados para descargar")
    return FileResponse(zip_path, media_type="application/zip", filename="documentos_firmados.zip",
                        background=BackgroundTask(zip_path.unlink, missing_ok=True))


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
