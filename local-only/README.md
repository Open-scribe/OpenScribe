# Local-Only Runtime (Current)

This directory contains the **current local runtime** used by the Electron app backend.

## What It Uses Today

- Transcription: `local-only/openscribe-backend/src/transcriber.py`
  - Primary local backend: `whisper.cpp` via `pywhispercpp`
  - Optional backend (if installed/selected): `openai-whisper`
  - Default Whisper model size: `base` (override with `OPENSCRIBE_WHISPER_MODEL`)

- Note generation: `local-only/openscribe-backend/src/summarizer.py`
  - Ollama local models
  - Config default model: `llama3.2:1b`
  - Supported/recommended: `llama3.2:1b`, `llama3.2:3b`, `gemma3:4b`
  - First-run setup flow in Electron uses curated model selection and download

- Telemetry
  - Desktop telemetry is disabled by default.
  - Users can opt in later in app settings.

## Important Clarification

Legacy MedASR/MedGemma docs and scripts still exist in parts of this repo, but the active Electron local backend path is the `openscribe-backend` stack above (Whisper + Ollama).

## Entry Points

- Backend CLI: `local-only/openscribe-backend/simple_recorder.py`
- Backend source: `local-only/openscribe-backend/src/`
- Backend build output used by app: `local-only/openscribe-backend/dist/openscribe-backend/`
