# Local-Only Option (MedASR + MedGemma)

This folder contains the **fully local** pipeline option. The default project setup
still uses hosted APIs (OpenAI/Anthropic). Nothing in here changes that default.

Use this local-only path if you want *all inference on-device*.

## What this does
- **Transcription**: local MedASR (no OpenAI key)
- **Note generation**: local MedGemma via llama.cpp
- **No cloud inference**

## Where to start
- Install/usage: `local-only/docs/INSTALL.md`
- Troubleshooting: `local-only/docs/TROUBLESHOOTING.md`
- Runner script: `local-only/scripts/run-local-medscribe.sh`

## Safety note
This is a draft note generator. It is not a clinical device and must be reviewed.
