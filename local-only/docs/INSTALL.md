# Local-Only Install

This keeps the main OpenScribe setup intact and adds a **fully local** option.

## Prereqs (Mac M1/M2)
- Python 3.11
- Node 18+
- Homebrew

## 1) Python env
```bash
cd /path/to/repo
python3.11 -m venv .venv-med
. .venv-med/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 2) Install llama.cpp
```bash
brew install llama.cpp
```

## 3) Download models (Hugging Face)
You must accept the MedASR + MedGemma license terms on Hugging Face.

```bash
. .venv-med/bin/activate
hf auth login
```

Then run once with `--allow-download` to fetch models locally:
```bash
python ./scripts/local_medscribe.py \
  --audio /path/to/audio.wav \
  --allow-download
```

## 4) Convert and quantize MedGemma
This step is required for local LLM inference:

```bash
. .venv-med/bin/activate
mkdir ./models
SCRIPT_PATH=$(ls $(brew --cellar)/llama.cpp/*/libexec/convert_hf_to_gguf.py | head -n 1)
python "$SCRIPT_PATH" \
  ~/.cache/huggingface/hub/models--google--medgemma-1.5-4b-it/snapshots/* \
  --outfile ./models/medgemma-1.5-4b-it-f16.gguf \
  --outtype f16

SCRIPT_PATH=$(ls $(brew --cellar)/llama.cpp/*/libexec/llama-quantize | head -n 1)
$SCRIPT_PATH \
  ./models/medgemma-1.5-4b-it-f16.gguf \
  ./models/medgemma-1.5-4b-it-q4_k_m.gguf \
  Q4_K_M
```

## 5) Run local-only pipeline
```bash
python ./scripts/local_medscribe.py \
  --audio /path/to/audio.wav
```

Outputs:
- `./build/medgemma-artifacts.json`
- `./build/medgemma-note.txt`

## Notes
- This path does **not** alter the default hosted setup.
- For long audio, ASR runs in chunks; the LLM prompt is capped by `--max-transcript-chars`.
