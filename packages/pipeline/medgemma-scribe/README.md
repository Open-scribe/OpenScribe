# MedGemma Local Scribe (Text-Only)

This package implements a **fully local, text-only medical scribe** using **MedGemma only**.
It does **not** perform speech-to-text. You must provide **pre-transcribed text**.

## Constraints (Non-Negotiable)

- MedGemma does **not** do speech recognition.
- This pipeline accepts **text transcripts only**.
- No cloud inference. No non-MedGemma models.

If you need audio ingestion, use a separate ASR model (out of scope here).

## Model Selection

Recommended:
- `MedGemma 1.5 4B (instruction-tuned)`

Not recommended for local laptops:
- `MedGemma 27B` (GPU VRAM heavy, slow for incremental scribing)

## Model Acquisition (Local)

1. Create a Hugging Face account.
2. Accept the MedGemma license.
3. Download weights locally:

```bash
pip install huggingface_hub
huggingface-cli login
git lfs install
git clone https://huggingface.co/google/medgemma-1.5-4b-it
```

## Local Inference Stack

### Option A: llama.cpp (recommended)

Run llama.cpp with OpenAI-compatible API:

```bash
./llama-server \
  -m /path/to/medgemma-1.5-4b-it.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --api
```

### Option B: Transformers (CPU/GPU)

Use a local Python service that exposes an OpenAI-compatible `/v1/chat/completions` endpoint.

## Quantization Targets

- 4-bit GGUF: best for laptops
- INT8: acceptable if memory allows

Approximate weights only:
- 4B @ FP16: ~8 GB
- 4B @ INT8: ~4 GB
- 4B @ 4-bit: ~2 GB

## Architecture (Text-Only)

```
[Transcript Input]
      |
      v
[Rolling Transcript Window]
      |
      v
[Encounter State JSON]
      |
      v
[MedGemma 4B]
      |
      v
[Draft Note Sections]
```

## Incremental Scribing (Required)

Large transcripts cannot be replayed every turn. Use rolling updates:

Artifacts maintained locally:
- `EncounterState` (JSON)
- `DraftNoteSections` (JSON)
- `RecentTranscriptWindow` (last N chars/turns)

Update loop:
1. Append new transcript chunk.
2. Update encounter state and only affected sections.
3. Discard older transcript text.

## Prompting Rules

- Output **JSON only**.
- No hallucinated vitals, labs, diagnoses, or meds.
- If missing, output `"not documented"`.
- Update only the sections impacted by new text.

## Output Format

- Internal: JSON schema enforced by `zod`.
- External: rendered note text from JSON.

## Safety Guardrails

Enforced outside the model:
- Vitals must appear in transcript window.
- Dosing must appear in transcript window.
- ROS contradictions detected.

## Testing Strategy

- Unit tests for rolling window, rendering, safety checks.
- Integration tests should mock local LLM responses.
- Stress tests: long visits, contradictions, corrections.

## Local Run (CLI)

```bash
pnpm medgemma:scribe --transcript /path/to/transcript.txt --out build/medgemma-artifacts.json
```

Environment variables:
- `MEDGEMMA_BASE_URL` (default `http://127.0.0.1:8080`)
- `MEDGEMMA_MODEL` (default `medgemma-1.5-4b-it`)
- `MEDGEMMA_API_KEY` (optional)

## Performance Expectations

On a modern laptop CPU with 4-bit quantization:
- 5-15 tokens/sec

This is adequate for incremental updates, not full-note regeneration per turn.

## Summary

You now have:
- Fully local, text-only, MedGemma-only scribing
- Rolling state updates
- Structured JSON output with guardrails

You do **not** have:
- Live dictation
- Audio ingestion
- Real-time transcription
