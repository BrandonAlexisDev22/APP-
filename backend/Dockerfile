FROM python:3.12-slim
# Carlito/Caladea/Liberation are metric-compatible with Calibri/Cambria/Arial/Times, so Word layouts don't shift.
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-dejavu \
    fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV PYTHONUNBUFFERED=1
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
