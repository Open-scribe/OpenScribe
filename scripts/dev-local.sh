#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/local-only/openscribe-backend"
BACKEND_VENV="$BACKEND_DIR/.venv-backend"
BACKEND_PYTHON="$BACKEND_VENV/bin/python"

ensure_backend_python() {
  if [[ -x "$BACKEND_PYTHON" ]]; then
    return
  fi

  echo "Creating backend virtual environment..."
  python3 -m venv "$BACKEND_VENV"
}

backend_deps_installed() {
  "$BACKEND_PYTHON" - <<'PY'
import importlib
import sys

required = [
    "pywhispercpp",
    "fastapi",
    "uvicorn",
    "multipart",  # python-multipart import path
]

missing = []
for module in required:
    try:
        importlib.import_module(module)
    except Exception:
        missing.append(module)

if missing:
    print("Missing backend dependencies:", ", ".join(missing))
    sys.exit(1)

print("Backend dependencies are ready.")
PY
}

install_backend_deps() {
  echo "Installing backend dependencies..."
  "$BACKEND_PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt"
}

ensure_web_env() {
  if [[ -f "$ROOT_DIR/apps/web/.env.local" ]]; then
    return
  fi

  echo "Creating apps/web/.env.local..."
  (cd "$ROOT_DIR" && pnpm setup >/dev/null)
}

run_local_stack() {
  export TRANSCRIPTION_PROVIDER="${TRANSCRIPTION_PROVIDER:-whisper_local}"
  export WHISPER_LOCAL_URL="${WHISPER_LOCAL_URL:-http://127.0.0.1:8002/v1/audio/transcriptions}"
  export WHISPER_LOCAL_MODEL="${WHISPER_LOCAL_MODEL:-tiny.en}"
  export WHISPER_LOCAL_BACKEND="${WHISPER_LOCAL_BACKEND:-cpp}"
  export WHISPER_LOCAL_GPU="${WHISPER_LOCAL_GPU:-1}"
  export WHISPER_LOCAL_TIMEOUT_MS="${WHISPER_LOCAL_TIMEOUT_MS:-15000}"
  export WHISPER_LOCAL_MAX_RETRIES="${WHISPER_LOCAL_MAX_RETRIES:-2}"

  cd "$ROOT_DIR"
  exec pnpm exec concurrently -k "pnpm whisper:server" "pnpm dev"
}

main() {
  ensure_backend_python
  if ! backend_deps_installed; then
    install_backend_deps
  fi
  ensure_web_env
  run_local_stack
}

main "$@"
