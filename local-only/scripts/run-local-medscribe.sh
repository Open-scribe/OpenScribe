#!/usr/bin/env bash
set -euo pipefail

AUDIO_PATH="${1:-}"
if [[ -z "$AUDIO_PATH" ]]; then
  echo "Usage: $0 /path/to/audio.wav"
  exit 1
fi

cd /Users/sammargolis/OpenScribe
. .venv-med/bin/activate

python /Users/sammargolis/OpenScribe/scripts/local_medscribe.py \
  --audio "$AUDIO_PATH"
