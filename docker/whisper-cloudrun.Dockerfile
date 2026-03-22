FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
COPY local-only/openscribe-backend/requirements.txt ./local-backend-requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r local-backend-requirements.txt

COPY scripts ./scripts
COPY local-only ./local-only

EXPOSE 8081

CMD ["sh", "-c", "python scripts/whisper_server.py --host 0.0.0.0 --port ${PORT:-8081} --model ${WHISPER_LOCAL_MODEL:-tiny.en} --backend ${WHISPER_LOCAL_BACKEND:-cpp} --gpu"]
