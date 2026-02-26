# Using Local MedASR for Transcription (Legacy)

> Note: mixed web mode now defaults to local Whisper (`TRANSCRIPTION_PROVIDER=whisper_local`).
> This MedASR guide is retained as a fallback path.

OpenScribe supports **Google's MedASR** for local speech-to-text transcription, eliminating the need for OpenAI API keys and keeping all audio data on your machine.

## Quick Start

### 1. Install Python Dependencies

```bash
. .venv-med/bin/activate
pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt
```

### 2. Start Both Servers

```bash
pnpm dev:local
```

This starts:
- **MedASR Server** on `http://127.0.0.1:8001` (local transcription)
- **Next.js App** on `http://localhost:3001` (web interface)

### 3. Use OpenScribe

Open http://localhost:3001 in your browser and start recording!

## Manual Setup

### Start MedASR Server Only

```bash
pnpm medasr:server
# OR
. .venv-med/bin/activate && python scripts/medasr_server.py --port 8001
```

### Start Next.js App Only

```bash
pnpm dev
```

## Configuration

### Environment Variables (when using MedASR)

Create or edit `apps/web/.env.local`:

```bash
# MedASR Configuration (optional - defaults shown)
MEDASR_URL=http://127.0.0.1:8001/v1/audio/transcriptions

# Note: You still need ANTHROPIC_API_KEY for clinical note generation if using hosted notes
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
NEXT_PUBLIC_SECURE_STORAGE_KEY=your-base64-key
```

### Server Options

```bash
python scripts/medasr_server.py --help

Options:
  --host TEXT              Host to bind to (default: 127.0.0.1)
  --port INTEGER           Port to bind to (default: 8001)
  --device [auto|cpu|cuda|mps]  Device to use (default: auto)
  --chunk-seconds INTEGER  ASR chunk length (default: 20)
  --stride-seconds INTEGER ASR stride overlap (default: 2)
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser (http://localhost:3001)       │
│  ┌────────────────────────────────────┐ │
│  │ OpenScribe Web App                 │ │
│  │ - Record Audio                     │ │
│  │ - Display UI                       │ │
│  └───────────┬────────────────────────┘ │
└────────────┼─────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Next.js API Routes                     │
│  /api/transcription/segment             │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  MedASR Server (127.0.0.1:8001)        │
│  ┌────────────────────────────────────┐ │
│  │ FastAPI Server                     │ │
│  │ - Receives WAV audio segments      │ │
│  │ - Returns transcript text          │ │
│  └───────────┬────────────────────────┘ │
│              │                           │
│              ▼                           │
│  ┌────────────────────────────────────┐ │
│  │ Google MedASR Model                │ │
│  │ (Hugging Face Transformers)        │ │
│  │ - Runs on CPU/GPU/MPS              │ │
│  │ - Medical domain optimized         │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Benefits of MedASR

✅ **Fully Local** - Audio never leaves your machine  
✅ **No API Keys Required** - No OpenAI account needed for transcription  
✅ **Medical Domain** - Trained on medical terminology  
✅ **Free** - No per-minute transcription costs  
✅ **Privacy** - Complete data control  

**Note:** You still need an Anthropic API key for hosted clinical note generation (LLM).

## Switching to MedASR in the app

If you prefer to use MedASR locally instead of OpenAI Whisper:

1. Edit `packages/pipeline/transcribe/src/index.ts`:

```typescript
// Change the default export from:
export { transcribeWavBuffer } from "./providers/whisper-transcriber"

// To:
export { transcribeWavBuffer } from "./providers/medasr-transcriber"
```

2. Ensure `MEDASR_URL` is set in `apps/web/.env.local`

3. Restart the dev server

## Performance

**MedASR Performance** (on Apple Silicon M1/M2):
- Device: MPS (Metal Performance Shaders)
- Speed: ~15-30 seconds per 10-second audio segment
- Memory: ~2-4GB RAM

For faster transcription, use a CUDA GPU or accept slightly slower CPU transcription.

## Troubleshooting

### MedASR Server Won't Start

```bash
# Check if port 8001 is already in use
lsof -i :8001

# Use a different port
python scripts/medasr_server.py --port 8002
# Update MEDASR_URL in .env.local accordingly
```

### Connection Errors in Browser

- Ensure MedASR server is running (`python scripts/medasr_server.py`)
- Check server logs for errors
- Verify `MEDASR_URL` in `.env.local` matches the server port

### Model Download Issues

The MedASR model (~2GB) will download automatically on first run. If download fails:

```bash
# Manual download with Hugging Face CLI
. .venv-med/bin/activate
huggingface-cli download google/medasr
```

### Transcription Quality

MedASR is optimized for medical terminology. If you encounter issues:

- Speak clearly and at a moderate pace
- Use good quality microphone
- Minimize background noise
- Check audio input levels

## Model Information

- **Model:** Google MedASR
- **Source:** https://huggingface.co/google/medasr
- **Language:** English only
- **Domain:** Medical/Clinical
- **Size:** ~2GB download
