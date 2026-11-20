# Firma masiva de documentos

Carga PDF/Word (DOCX, DOC) → ubica la firma → dibuja o sube la firma → firma todo el lote → descarga (individual o ZIP).

## Requisitos
- Python 3.10+, Node 20+, LibreOffice (`soffice` en el PATH) para convertir Word (DOCX/DOC).

## Instalación
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && npm run build && cd ..
```

## Ejecutar
```bash
cd backend && .venv/bin/uvicorn app:app --port 8000
```
Abrir http://localhost:8000 (el backend sirve el frontend compilado).

Desarrollo con recarga en caliente: además del backend, `cd frontend && npm run dev` y abrir http://localhost:5173.

## Configuración (variables de entorno del backend)
| Variable | Por defecto | Uso |
|---|---|---|
| `TEMP_TTL_MINUTES` | `120` | Minutos que se conservan los archivos temporales |
| `MAX_FILE_MB` | `25` | Tamaño máximo por documento |
| `DATA_DIR` | `<tmp>/firma-masiva` | Carpeta de archivos temporales |
| `SOFFICE` | `soffice` | Ruta al ejecutable de LibreOffice |
| `ALLOWED_ORIGINS` | — | Orígenes permitidos por CORS, separados por coma (frontend en otro dominio) |

## Cómo funciona
- Cada documento se guarda en una carpeta temporal; los Word (DOCX/DOC) se convierten a PDF con LibreOffice **al subirlos**, así el visor y el motor de firma usan exactamente el mismo PDF.
- La posición se guarda como coordenadas relativas (0–1) a la página visible (respeta rotación y CropBox); PyMuPDF inserta la firma manteniendo proporciones y centrada en el recuadro.
- Cada documento se firma en una petición independiente: un error no detiene el lote y el progreso es real. El original nunca se modifica (`signed.pdf` es un archivo aparte).
- Si la firma PNG no tiene transparencia, el fondo claro se vuelve transparente automáticamente.

## Despliegue (beta)
El backend guarda archivos temporales entre peticiones y usa LibreOffice, así que el frontend (GitHub Pages) y el backend se despliegan por separado:

1. **Backend** (Render, Railway, Fly… cualquier host Docker): imagen en `backend/Dockerfile` (incluye LibreOffice, escucha en `$PORT`). Una sola instancia (los archivos viven en su disco). `ALLOWED_ORIGINS` ya viene en la imagen como `https://brandonalexisdev22.github.io` (el origen no lleva la ruta `/APP-`).
2. **Frontend** (GitHub Pages): en el repo, *Settings → Pages → Source* = **GitHub Actions**, y en *Settings → Secrets and variables → Actions → Variables* crea `VITE_API_URL` = URL del backend (sin `/` final). Cada push a `main` publica en https://brandonalexisdev22.github.io/APP-/ con `.github/workflows/pages.yml`.

## Pruebas
```bash
cd backend && .venv/bin/pytest -q
```
