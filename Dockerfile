FROM python:3.12-slim
# Carlito/Caladea/Liberation are metric-compatible with Calibri/Cambria/Arial/Times, so Word layouts don't shift.
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-dejavu \
    fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app.py .
ENV PYTHONUNBUFFERED=1
# CORS origin is scheme+host only (no /APP- path); override on the host if the frontend moves.
ENV ALLOWED_ORIGINS=https://brandonalexisdev22.github.io
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
