# Using Local Tiny Whisper for Mixed Web Mode

OpenScribe mixed web mode supports fast local transcription with Whisper and separate larger-model note generation.

## 1. Configure environment

Edit `apps/web/.env.local`:

```bash
TRANSCRIPTION_PROVIDER=whisper_local
WHISPER_LOCAL_URL=http://127.0.0.1:8002/v1/audio/transcriptions
WHISPER_LOCAL_MODEL=tiny.en
WHISPER_LOCAL_BACKEND=cpp
WHISPER_LOCAL_TIMEOUT_MS=15000
WHISPER_LOCAL_MAX_RETRIES=2
```

## 2. Start everything (one command)

```bash
pnpm dev:local
```

This command will:
- create/check backend venv
- install backend deps if missing
- create `apps/web/.env.local` if missing
- start local Whisper (`tiny.en + whisper.cpp + GPU`)
- start Next.js web app

## 3. Verify health

```bash
curl http://127.0.0.1:8002/health
```

You should see JSON including the active backend and model.

## Notes

- Tiny English model maximizes speed; use `WHISPER_LOCAL_MODEL=base` if you need more accuracy.
- Keep note-generation model settings independent from transcription settings.
