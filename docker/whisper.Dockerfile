FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY scripts ./scripts
COPY local-only/openscribe-backend/src ./local-only/openscribe-backend/src

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir pywhispercpp fastapi "uvicorn[standard]" python-multipart

EXPOSE 8002

CMD ["python", "scripts/whisper_server.py", "--host", "0.0.0.0", "--port", "8002", "--model", "tiny.en", "--backend", "cpp"]
