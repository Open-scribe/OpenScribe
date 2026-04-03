#!/usr/bin/env python3
"""
MedASR Local Transcription Server

A local FastAPI server that provides speech-to-text transcription using Google's MedASR model.
Compatible with OpenScribe's transcription API interface.

Start the server:
    python scripts/medasr_server.py --port 8001

The server will expose:
    POST /v1/audio/transcriptions - Compatible with OpenAI Whisper API format
"""

import argparse
import io
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

try:
    import torch
    import uvicorn
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from huggingface_hub import snapshot_download
    from transformers import pipeline
except ImportError as e:
    print(f"ERROR: Missing required package: {e}")
    print("\nPlease install dependencies:")
    print("  pip install fastapi uvicorn torch transformers huggingface_hub")
    sys.exit(1)

MEDASR_MODEL = "google/medasr"

app = FastAPI(
    title="MedASR Transcription Server",
    description="Local medical speech-to-text using Google MedASR",
    version="1.0.0",
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global ASR pipeline
asr_pipeline = None
device_name = None


def initialize_asr(device: str = "auto", chunk_seconds: int = 30, stride_seconds: int = 5):
    """Initialize the MedASR pipeline with the specified device."""
    global asr_pipeline, device_name

    if asr_pipeline is not None:
        print("ASR pipeline already initialized")
        return

    print(f"Initializing MedASR model: {MEDASR_MODEL}")

    # Determine device
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    device_name = device
    print(f"Using device: {device}")

    # Set environment variable for MPS fallback
    if device == "mps":
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    # Download model if needed
    try:
        model_path = snapshot_download(MEDASR_MODEL, local_files_only=False)
        print(f"Model loaded from: {model_path}")
    except Exception as e:
        print(f"ERROR downloading model: {e}")
        raise

    # Map device to pipeline format
    if device == "cuda":
        pipeline_device = 0
    elif device == "mps":
        pipeline_device = "mps"
    else:
        pipeline_device = -1

    # Initialize pipeline
    print("Creating ASR pipeline...")
    asr_pipeline = pipeline(
        "automatic-speech-recognition",
        model=model_path,
        device=pipeline_device,
        chunk_length_s=chunk_seconds,
        stride_length_s=stride_seconds,
    )
    print("✓ MedASR pipeline ready")


def clean_transcript(text: str) -> str:
    """
    Clean MedASR output comprehensively:
    - Remove <epsilon> tokens
    - Remove character-level repetitions (e.g., "chchest" -> "chest")
    - Fix split words (e.g., "ha vingving" -> "having")
    - Remove word-level repetitions (e.g., "and and" -> "and")
    - Normalize whitespace
    """
    import re

    # Step 1: Remove special tokens
    text = text.replace("<epsilon>", " ")
    
    # Remove trailing </s> if present
    if text.endswith("</s>"):
        text = text[: -len("</s>")].strip()
    
    # Step 2: Remove character-level repetitions iteratively
    # Try longer patterns first (3 chars, then 2, then 1) to avoid over-matching
    # Pattern: (.{N})\1+ matches a sequence of N characters repeated 1+ times
    for pattern_len in [3, 2, 1]:
        # Repeat until no more matches (some patterns may emerge after first pass)
        prev = ""
        while prev != text:
            prev = text
            text = re.sub(r'(.{' + str(pattern_len) + r'})\1+', r'\1', text)
    
    # Step 3: Fix split words with repeated suffixes
    # Pattern: "ha vingving" -> "having" (merge prefix with deduplicated suffix)
    # This handles cases where a word is split and the second part has character repetitions
    text = re.sub(r'(\w{1,3})\s+(\w+)\2+', r'\1\2', text)
    
    # Step 4: Remove word-level repetitions (multiple passes to handle "pain pain pain" -> "pain")
    prev = ""
    iteration = 0
    while prev != text and iteration < 5:  # Max 5 iterations to avoid infinite loops
        prev = text
        # Match whole words that repeat immediately (e.g., "pain pain" -> "pain")
        text = re.sub(r'\b(\w+)\s+\1\b', r'\1', text)
        iteration += 1
    
    # Step 5: Normalize whitespace
    text = re.sub(r"\s+", " ", text)
    text = text.strip()
    
    # Step 6: Clean up common artifacts
    # Remove double punctuation
    text = re.sub(r'\.\.+', '.', text)
    text = re.sub(r',,+', ',', text)
    
    return text


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "running",
        "model": MEDASR_MODEL,
        "device": device_name,
        "ready": asr_pipeline is not None,
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    if asr_pipeline is None:
        raise HTTPException(status_code=503, detail="ASR pipeline not initialized")
    return {"status": "healthy", "model": MEDASR_MODEL, "device": device_name}


@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    response_format: Optional[str] = Form("json"),
    temperature: Optional[float] = Form(None),
):
    """
    Transcribe audio file using MedASR.

    Compatible with OpenAI Whisper API format:
    - file: Audio file (wav, mp3, m4a, etc.)
    - model: Ignored (always uses MedASR)
    - response_format: json (default), text, srt, verbose_json, or vtt

    Returns:
        {"text": "transcribed text here"}
    """
    if asr_pipeline is None:
        raise HTTPException(status_code=503, detail="ASR pipeline not initialized")

    try:
        # Read audio file
        audio_data = await file.read()

        # Save to temporary file (transformers pipeline expects file path or bytes)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # Transcribe
            print(f"Transcribing file: {file.filename} ({len(audio_data)} bytes)")
            result = asr_pipeline(tmp_path)
            raw_text = result.get("text", "")
            transcript = clean_transcript(raw_text)

            print(f"✓ Transcription complete: {len(transcript)} chars")

            # Return in requested format
            if response_format == "text":
                return transcript
            elif response_format in ["json", "verbose_json"]:
                response = {"text": transcript}
                if response_format == "verbose_json":
                    response["language"] = "en"  # MedASR is English-only
                    response["duration"] = None  # Not available
                return JSONResponse(content=response)
            else:
                # SRT/VTT not implemented yet
                raise HTTPException(
                    status_code=400, detail=f"Response format '{response_format}' not supported"
                )

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass

    except Exception as e:
        print(f"ERROR during transcription: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@app.on_event("startup")
async def startup_event():
    """Initialize ASR pipeline on startup."""
    # Get config from environment or defaults
    device = os.environ.get("MEDASR_DEVICE", "auto")
    chunk_seconds = int(os.environ.get("MEDASR_CHUNK_SECONDS", "20"))
    stride_seconds = int(os.environ.get("MEDASR_STRIDE_SECONDS", "2"))

    initialize_asr(device=device, chunk_seconds=chunk_seconds, stride_seconds=stride_seconds)


def main():
    parser = argparse.ArgumentParser(description="MedASR Local Transcription Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8001, help="Port to bind to (default: 8001)")
    parser.add_argument(
        "--device",
        choices=["auto", "cpu", "cuda", "mps"],
        default="auto",
        help="Device to use (default: auto)",
    )
    parser.add_argument(
        "--chunk-seconds", type=int, default=30, help="ASR chunk length in seconds (default: 30)"
    )
    parser.add_argument(
        "--stride-seconds", type=int, default=5, help="ASR stride overlap in seconds (default: 5)"
    )
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload on code changes")

    args = parser.parse_args()

    # Set environment variables for startup
    os.environ["MEDASR_DEVICE"] = args.device
    os.environ["MEDASR_CHUNK_SECONDS"] = str(args.chunk_seconds)
    os.environ["MEDASR_STRIDE_SECONDS"] = str(args.stride_seconds)

    print("=" * 60)
    print("MedASR Local Transcription Server")
    print("=" * 60)
    print(f"Host: {args.host}")
    print(f"Port: {args.port}")
    print(f"Device: {args.device}")
    print(f"Chunk: {args.chunk_seconds}s, Stride: {args.stride_seconds}s")
    print(f"Endpoint: http://{args.host}:{args.port}/v1/audio/transcriptions")
    print("=" * 60)

    uvicorn.run(
        "medasr_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
