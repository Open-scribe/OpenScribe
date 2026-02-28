#!/usr/bin/env python3
"""
Whisper Local Transcription Server

A local FastAPI server that provides speech-to-text transcription using the
same Whisper backend used by the OpenScribe local runtime.

Start the server:
    python scripts/whisper_server.py --port 8002 --model tiny.en

The server exposes:
    POST /v1/audio/transcriptions - OpenAI Whisper-compatible response format
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

try:
    import uvicorn
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
except ImportError as e:
    print(f"ERROR: Missing required package: {e}")
    print("\nPlease install dependencies:")
    print("  pip install fastapi uvicorn python-multipart")
    sys.exit(1)

LOCAL_BACKEND_SRC = Path(__file__).resolve().parent.parent / "local-only" / "openscribe-backend" / "src"
if str(LOCAL_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(LOCAL_BACKEND_SRC))

try:
    from transcriber import WhisperTranscriber  # type: ignore
except Exception as e:
    print(f"ERROR: Unable to import local Whisper transcriber: {e}")
    print("\nInstall backend dependencies:")
    print("  cd local-only/openscribe-backend && python -m pip install -r requirements.txt")
    sys.exit(1)

app = FastAPI(
    title="Whisper Local Transcription Server",
    description="Local Whisper transcription service for OpenScribe mixed web mode",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

transcriber: Optional[WhisperTranscriber] = None


def initialize_transcriber(model_size: str = "tiny.en", backend: str = "cpp", gpu: bool = False) -> None:
    global transcriber
    if transcriber is not None:
        return

    os.environ["OPENSCRIBE_WHISPER_MODEL"] = model_size
    os.environ["OPENSCRIBE_WHISPER_BACKEND"] = backend
    os.environ["OPENSCRIBE_WHISPER_GPU"] = "1" if gpu else "0"

    print(f"Initializing Whisper transcriber (model={model_size}, backend={backend}, gpu={gpu})")
    transcriber = WhisperTranscriber(model_size=model_size)
    print("✓ Whisper transcriber ready")


@app.get("/")
async def root():
    return {
        "status": "running",
        "ready": transcriber is not None,
        "backend": transcriber.get_backend_info() if transcriber else None,
    }


@app.get("/health")
async def health():
    if transcriber is None:
        raise HTTPException(status_code=503, detail="Whisper transcriber not initialized")
    return {"status": "healthy", **transcriber.get_backend_info()}


@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    response_format: Optional[str] = Form("json"),
    temperature: Optional[float] = Form(None),
):
    del prompt, temperature
    if transcriber is None:
        raise HTTPException(status_code=503, detail="Whisper transcriber not initialized")

    if model and model != transcriber.model_size:
        print(f"Request model '{model}' differs from loaded model '{transcriber.model_size}', ignoring request value")

    if language == "auto":
        language = None

    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = Path(tmp.name)

    try:
        print(f"Transcribing file: {file.filename} ({len(audio_data)} bytes, language: {language})")
        transcript = transcriber.transcribe_audio(tmp_path, language)
        if transcript is None:
            raise HTTPException(status_code=500, detail="Transcription failed")

        if response_format == "text":
            return transcript

        if response_format in {"json", "verbose_json"}:
            payload = {"text": transcript}
            if response_format == "verbose_json":
                payload["language"] = language or "auto"
            return JSONResponse(content=payload)

        raise HTTPException(status_code=400, detail=f"Unsupported response format: {response_format}")
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


@app.on_event("startup")
async def startup_event():
    model_size = os.environ.get("WHISPER_LOCAL_MODEL", "tiny.en")
    backend = os.environ.get("WHISPER_LOCAL_BACKEND", "cpp")
    gpu_enabled = os.environ.get("WHISPER_LOCAL_GPU", "1").strip().lower() in {"1", "true", "yes", "on"}
    initialize_transcriber(model_size=model_size, backend=backend, gpu=gpu_enabled)


def main():
    parser = argparse.ArgumentParser(description="Whisper local transcription server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8002, help="Port to bind to (default: 8002)")
    parser.add_argument("--model", default=os.environ.get("WHISPER_LOCAL_MODEL", "tiny.en"), help="Whisper model size (default: tiny.en)")
    parser.add_argument(
        "--backend",
        choices=["cpp", "whisper.cpp", "pywhispercpp", "openai", "openai-whisper"],
        default=os.environ.get("WHISPER_LOCAL_BACKEND", "cpp"),,
        help="Transcriber backend (default: cpp)",
    )
    parser.add_argument("--gpu", action="store_true", help="Enable GPU/Metal for whisper.cpp")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload on code changes")
    args = parser.parse_args()

    os.environ["WHISPER_LOCAL_MODEL"] = args.model
    os.environ["WHISPER_LOCAL_BACKEND"] = args.backend
    os.environ["WHISPER_LOCAL_GPU"] = "1" if args.gpu else "0"

    print("=" * 60)
    print("Whisper Local Transcription Server")
    print("=" * 60)
    print(f"Host: {args.host}")
    print(f"Port: {args.port}")
    print(f"Model: {args.model}")
    print(f"Backend: {args.backend}")
    print(f"GPU: {'enabled' if args.gpu else 'disabled'}")
    print(f"Endpoint: http://{args.host}:{args.port}/v1/audio/transcriptions")
    print("=" * 60)

    if not args.model.endswith(".en"):
        print("🌍 Multilingual Whisper model enabled")

    uvicorn.run(
        "whisper_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
