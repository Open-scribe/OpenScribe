"""
Ollama manager for bundled Ollama binary.

Handles finding and running the bundled Ollama binary that ships with OpenScribe,
eliminating the need for users to install Ollama separately.
"""

import logging
import os
import json
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Ollama download URL for macOS
OLLAMA_DOWNLOAD_URL = "https://github.com/ollama/ollama/releases/download/v0.15.4/ollama-darwin.tgz"
OLLAMA_HEALTH_URL = "http://127.0.0.1:11434/api/tags"
OLLAMA_VERSION_URL = "http://127.0.0.1:11434/api/version"
OLLAMA_PROBE_TIMEOUT_S = 3

_startup_lock = threading.Lock()
_selected_ollama_binary: Optional[Path] = None
_last_startup_report: Dict[str, Any] = {}


def _is_mlx_crash(stderr: str) -> bool:
    text = (stderr or "").lower()
    crash_markers = [
        "nsrangeexception",
        "libmlx",
        "mlx_random_key",
        "metalallocator",
        "index 0 beyond bounds for empty array",
    ]
    return any(marker in text for marker in crash_markers)


def _tail(text: str, max_chars: int = 4000) -> str:
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def _get_state_dir() -> Path:
    """Return directory used for persisted runtime diagnostics."""
    candidates: List[Path] = []
    if getattr(sys, "frozen", False):
        candidates.append(Path.home() / "Library" / "Application Support" / "openscribe-backend")
        candidates.append(Path.cwd())
        candidates.append(Path("/tmp/openscribe-backend"))
    else:
        candidates.append(Path(__file__).parent.parent)
        candidates.append(Path.cwd())

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except Exception:
            continue

    # Last resort: current directory without mkdir attempt
    return Path.cwd()


def _startup_report_path() -> Path:
    return _get_state_dir() / "ollama_startup_report.json"


def _set_startup_report(report: Dict[str, Any]) -> None:
    """Update in-memory startup report and persist it to disk."""
    global _last_startup_report
    _last_startup_report = report
    try:
        with open(_startup_report_path(), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    except Exception as exc:
        logger.debug("Unable to persist startup report: %s", exc)


def _load_startup_report_from_disk() -> Dict[str, Any]:
    path = _startup_report_path()
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def get_bundled_ollama_dir() -> Optional[Path]:
    """
    Get the path to the bundled Ollama directory.

    Returns:
        Path to the ollama directory, or None if not found
    """
    # When running from PyInstaller bundle
    if getattr(sys, 'frozen', False):
        # PyInstaller sets _MEIPASS to the temp directory where files are extracted
        base_path = Path(sys._MEIPASS)
        ollama_dir = base_path / 'ollama'
        if ollama_dir.exists():
            return ollama_dir

        # Also check relative to executable
        exe_dir = Path(sys.executable).parent
        ollama_dir = exe_dir / 'ollama'
        if ollama_dir.exists():
            return ollama_dir

    # Development mode - check bin directory
    dev_ollama_dir = Path(__file__).parent.parent / 'bin'
    if dev_ollama_dir.exists() and (dev_ollama_dir / 'ollama').exists():
        return dev_ollama_dir

    return None


def get_ollama_binary_candidates() -> List[Path]:
    """Get ordered Ollama binary candidates (deduplicated)."""
    candidates: List[Path] = []

    # Explicit override for diagnostics or testing
    override_binary = os.getenv("OPENSCRIBE_OLLAMA_BINARY")
    if override_binary:
        candidates.append(Path(override_binary))

    bundled_dir = get_bundled_ollama_dir()
    if bundled_dir:
        candidates.append(bundled_dir / "ollama")
        # Optional fallback binary slot for compatibility rollbacks.
        candidates.append(bundled_dir / "ollama-fallback")

    # PATH lookup
    try:
        result = subprocess.run(["which", "ollama"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            path = Path(result.stdout.strip())
            candidates.append(path)
    except Exception:
        pass

    # Common system locations
    candidates.extend(
        [
            Path("/opt/homebrew/bin/ollama"),
            Path("/usr/local/bin/ollama"),
            Path("/usr/bin/ollama"),
        ]
    )

    deduped: List[Path] = []
    seen = set()
    for candidate in candidates:
        if not candidate:
            continue
        as_str = str(candidate)
        if as_str in seen:
            continue
        seen.add(as_str)
        if candidate.exists() and os.access(candidate, os.X_OK):
            deduped.append(candidate)

    # Reorder candidates so the last successful binary is tried first,
    # unless an explicit override was supplied.
    if override_binary:
        return deduped

    prefer_system_env = os.getenv("OPENSCRIBE_PREFER_SYSTEM_OLLAMA")
    if prefer_system_env is None:
        # Prefer system Ollama first for faster startup/perf when available.
        # Fallback to bundled candidate automatically.
        prefer_system = True
    else:
        prefer_system = prefer_system_env.lower() in {"1", "true", "yes", "on"}

    if prefer_system and deduped:
        bundled_dir = get_bundled_ollama_dir()

        def is_system_path(p: Path) -> bool:
            if bundled_dir and str(p).startswith(str(bundled_dir)):
                return False
            return True

        system_candidates = [p for p in deduped if is_system_path(p)]
        bundled_candidates = [p for p in deduped if not is_system_path(p)]
        deduped = system_candidates + bundled_candidates

    preferred = None
    if _selected_ollama_binary and _selected_ollama_binary.exists():
        preferred = str(_selected_ollama_binary)
    else:
        startup_report = _load_startup_report_from_disk()
        selected_from_report = startup_report.get("selected_binary")
        if isinstance(selected_from_report, str) and selected_from_report:
            preferred = selected_from_report

    if preferred:
        preferred_path = Path(preferred)
        if preferred_path in deduped:
            deduped.remove(preferred_path)
            deduped.insert(0, preferred_path)

    return deduped


def get_ollama_binary() -> Optional[Path]:
    """
    Get the path to the Ollama binary.

    Checks in order:
    1. Bundled Ollama (in PyInstaller bundle or dev bin/)
    2. System Ollama (in PATH or common locations)

    Returns:
        Path to ollama binary, or None if not found
    """
    global _selected_ollama_binary

    if _selected_ollama_binary and _selected_ollama_binary.exists():
        return _selected_ollama_binary

    candidates = get_ollama_binary_candidates()
    if not candidates:
        logger.warning("No Ollama binary found")
        return None

    _selected_ollama_binary = candidates[0]
    logger.info(f"Using Ollama binary candidate: {_selected_ollama_binary}")
    return _selected_ollama_binary


def get_ollama_env(binary: Optional[Path] = None) -> dict:
    """
    Get environment variables needed to run bundled Ollama.

    Sets up library paths for the bundled dylibs.

    Returns:
        Dictionary of environment variables
    """
    env = os.environ.copy()

    bundled_dir = get_bundled_ollama_dir()
    use_bundled_libs = False
    if bundled_dir and binary:
        try:
            use_bundled_libs = str(binary.resolve()).startswith(str(bundled_dir.resolve()))
        except Exception:
            use_bundled_libs = str(binary).startswith(str(bundled_dir))

    if bundled_dir and use_bundled_libs:
        # Add bundled directory to library path for dylibs
        ollama_dir_str = str(bundled_dir)

        # macOS uses DYLD_LIBRARY_PATH
        existing = env.get('DYLD_LIBRARY_PATH', '')
        if existing:
            env['DYLD_LIBRARY_PATH'] = f"{ollama_dir_str}:{existing}"
        else:
            env['DYLD_LIBRARY_PATH'] = ollama_dir_str

        # Also set for Metal library
        env['MLX_METAL_PATH'] = str(bundled_dir / 'mlx.metallib')

        logger.debug(f"Set DYLD_LIBRARY_PATH: {env['DYLD_LIBRARY_PATH']}")

    # Force local host binding for predictability.
    env.setdefault("OLLAMA_HOST", "127.0.0.1:11434")

    return env


def _http_get_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        from urllib.request import urlopen

        with urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def probe_ollama_binary(binary: Path, timeout: int = OLLAMA_PROBE_TIMEOUT_S) -> Dict[str, Any]:
    """Run a quick probe command to catch immediate runtime crashes."""
    env = get_ollama_env(binary)
    start = time.time()
    try:
        result = subprocess.run(
            [str(binary), "--version"],
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stderr_tail = _tail(result.stderr or "")
        return {
            "binary": str(binary),
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "duration_s": round(time.time() - start, 3),
            "stdout": _tail(result.stdout or "", 500),
            "stderr_tail": stderr_tail,
            "mlx_crash": _is_mlx_crash(stderr_tail),
        }
    except subprocess.TimeoutExpired:
        return {
            "binary": str(binary),
            "ok": False,
            "returncode": None,
            "duration_s": round(time.time() - start, 3),
            "stdout": "",
            "stderr_tail": f"Probe timed out after {timeout}s",
            "mlx_crash": False,
        }
    except Exception as exc:
        return {
            "binary": str(binary),
            "ok": False,
            "returncode": None,
            "duration_s": round(time.time() - start, 3),
            "stdout": "",
            "stderr_tail": str(exc),
            "mlx_crash": False,
        }


@contextmanager
def _with_startup_lock(timeout_s: int = 20):
    """Process-local lock to avoid concurrent `ollama serve` races."""
    start = time.time()
    acquired = False
    while time.time() - start < timeout_s:
        acquired = _startup_lock.acquire(blocking=False)
        if acquired:
            break
        time.sleep(0.1)
    if not acquired:
        raise TimeoutError("Timed out acquiring Ollama startup lock")
    try:
        yield
    finally:
        _startup_lock.release()


def is_ollama_running() -> bool:
    """
    Check if Ollama server is running.

    Returns:
        True if Ollama is responding, False otherwise
    """
    # Version endpoint is typically available sooner than /api/tags at cold start.
    if _http_get_ok(OLLAMA_VERSION_URL, timeout=1.5):
        return True
    return _http_get_ok(OLLAMA_HEALTH_URL, timeout=1.5)


def start_ollama_server(wait: bool = True, timeout: int = 30) -> bool:
    """
    Start the Ollama server if not already running.

    Args:
        wait: If True, wait for server to be ready
        timeout: Maximum seconds to wait for server

    Returns:
        True if server is running, False if failed to start
    """
    global _selected_ollama_binary, _last_startup_report

    if is_ollama_running():
        _set_startup_report({
            "success": True,
            "already_running": True,
            "timestamp": int(time.time()),
        })
        logger.info("Ollama server is already running")
        return True

    candidates = get_ollama_binary_candidates()
    if not candidates:
        _set_startup_report({
            "success": False,
            "error": "binary_not_found",
            "timestamp": int(time.time()),
        })
        logger.error("Cannot start Ollama - binary not found")
        return False

    attempts: List[Dict[str, Any]] = []
    started_proc = None

    try:
        with _with_startup_lock():
            # A concurrent caller may already have started the server.
            if is_ollama_running():
                _set_startup_report({
                    "success": True,
                    "already_running": True,
                    "timestamp": int(time.time()),
                })
                return True

            for candidate in candidates:
                attempt: Dict[str, Any] = {"binary": str(candidate)}
                probe = probe_ollama_binary(candidate)
                attempt["probe"] = probe
                attempts.append(attempt)

                if not probe.get("ok"):
                    logger.warning(
                        "Skipping Ollama candidate %s due to failed probe (rc=%s)",
                        candidate,
                        probe.get("returncode"),
                    )
                    continue

                env = get_ollama_env(candidate)
                logger.info(f"Starting Ollama server: {candidate}")
                started_proc = subprocess.Popen(
                    [str(candidate), "serve"],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    start_new_session=True,
                )

                attempt["pid"] = started_proc.pid

                if not wait:
                    _selected_ollama_binary = candidate
                    _set_startup_report({
                        "success": True,
                        "waited": False,
                        "selected_binary": str(candidate),
                        "attempts": attempts,
                        "timestamp": int(time.time()),
                    })
                    return True

                start_time = time.time()
                while time.time() - start_time < timeout:
                    if is_ollama_running():
                        _selected_ollama_binary = candidate
                        _set_startup_report({
                            "success": True,
                            "waited": True,
                            "selected_binary": str(candidate),
                            "ready_after_s": round(time.time() - start_time, 3),
                            "attempts": attempts,
                            "timestamp": int(time.time()),
                        })
                        logger.info("Ollama server is ready")
                        return True

                    if started_proc.poll() is not None:
                        attempt["returncode"] = started_proc.returncode
                        stderr_text = ""
                        try:
                            _, proc_stderr = started_proc.communicate(timeout=0.2)
                            stderr_text = _tail(proc_stderr or "")
                        except Exception:
                            stderr_text = ""
                        attempt["stderr_tail"] = stderr_text
                        attempt["mlx_crash"] = _is_mlx_crash(stderr_text)
                        logger.warning(
                            "Ollama candidate %s exited early (rc=%s)",
                            candidate,
                            started_proc.returncode,
                        )
                        break

                    time.sleep(0.5)

                # Timed out waiting for readiness; terminate this candidate before trying next.
                if started_proc.poll() is None:
                    attempt["timeout"] = True
                    try:
                        started_proc.terminate()
                        started_proc.wait(timeout=2)
                    except Exception:
                        try:
                            started_proc.kill()
                        except Exception:
                            pass

            _set_startup_report({
                "success": False,
                "error": "startup_failed",
                "attempts": attempts,
                "timestamp": int(time.time()),
            })
            logger.error("Ollama server failed to start after trying %d candidate(s)", len(attempts))
            return False

    except Exception as exc:
        _set_startup_report({
            "success": False,
            "error": str(exc),
            "attempts": attempts,
            "timestamp": int(time.time()),
        })
        logger.error(f"Failed to start Ollama server: {exc}")
        return False


def run_ollama_command(args: list, timeout: int = 300) -> Tuple[bool, str, str]:
    """
    Run an Ollama CLI command.

    Args:
        args: Command arguments (e.g., ['pull', 'llama3.2:3b'])
        timeout: Command timeout in seconds

    Returns:
        Tuple of (success, stdout, stderr)
    """
    ollama_binary = get_ollama_binary()
    if not ollama_binary:
        return False, "", "Ollama binary not found"

    try:
        env = get_ollama_env(ollama_binary)
        result = subprocess.run(
            [str(ollama_binary)] + args,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out after {timeout} seconds"
    except Exception as e:
        return False, "", str(e)


def pull_model(model_name: str, progress_callback=None) -> bool:
    """
    Pull an Ollama model.

    Args:
        model_name: Name of model to pull (e.g., 'llama3.2:3b')
        progress_callback: Optional callback function for progress updates

    Returns:
        True if model was pulled successfully
    """
    if not start_ollama_server():
        return False

    try:
        logger.info(f"Pulling model: {model_name}")
        import ollama

        for progress in ollama.pull(model_name, stream=True):
            if isinstance(progress, dict):
                status = str(progress.get("status", "")).strip()
                total = progress.get("total", 0) or 0
                completed = progress.get("completed", 0) or 0
            else:
                status = str(getattr(progress, "status", "")).strip()
                total = getattr(progress, "total", 0) or 0
                completed = getattr(progress, "completed", 0) or 0

            if total:
                text = f"{status} {int((completed / total) * 100)}%"
            else:
                text = status or str(progress)

            logger.debug(f"Ollama pull: {text}")
            if progress_callback:
                progress_callback(text)

        logger.info(f"Successfully pulled model: {model_name}")
        return True

    except Exception as e:
        logger.error(f"Error pulling model: {e}")
        return False


def _extract_model_names(list_response: Any) -> List[str]:
    """Normalize `ollama.list()` response across client versions."""
    models: List[Any] = []
    if isinstance(list_response, dict):
        models = list_response.get("models", []) or []
    else:
        models = getattr(list_response, "models", []) or []

    names: List[str] = []
    for model in models:
        if isinstance(model, dict):
            name = model.get("model") or model.get("name")
        else:
            name = getattr(model, "model", None) or getattr(model, "name", None)
        if name:
            names.append(str(name))
    return names


def list_models() -> list:
    """
    List available Ollama models.

    Returns:
        List of model names, or empty list if failed
    """
    if not is_ollama_running():
        if not start_ollama_server():
            return []

    import ollama
    last_error: Optional[Exception] = None
    for _ in range(3):
        try:
            response = ollama.list()
            return _extract_model_names(response)
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)

    logger.warning("Failed to list Ollama models via API: %s", last_error)
    return []


def has_model(model_name: str) -> bool:
    """
    Check if a model is available locally.

    Args:
        model_name: Name of model to check

    Returns:
        True if model is available
    """
    models = list_models()
    return model_name in models


def get_last_startup_report() -> Dict[str, Any]:
    """
    Return the latest Ollama startup diagnostics.

    Useful for UI diagnostics and test assertions.
    """
    if _last_startup_report:
        return dict(_last_startup_report)
    return _load_startup_report_from_disk()
