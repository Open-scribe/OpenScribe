#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
import re
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from transformers import AutoProcessor, pipeline

MEDASR_MODEL = "google/medasr"
MEDGEMMA_MODEL = "google/medgemma-1.5-4b-it"

JSON_SCHEMA = {
    "encounter_state": {
        "problems": [],
        "medications": [],
        "allergies": [],
        "ros_positive": [],
        "ros_negative": [],
        "timeline": [],
    },
    "draft_note": {
        "hpi": "",
        "ros": "",
        "assessment": "",
        "plan": "",
    },
    "recent_transcript_window": "",
    "warnings": [],
}

SYSTEM_PROMPT = (
    "You are a medical scribe. Use ONLY facts explicitly stated in the transcript.\n"
    "Do NOT invent vitals, labs, diagnoses, or medications.\n"
    "If information is missing, write \"not documented\".\n"
    "Return VALID JSON only. No markdown. No prose.\n"
    "Wrap the JSON in <BEGIN_JSON> and <END_JSON> tags.\n"
    "Set recent_transcript_window to an empty string; the system will fill it.\n"
    f"The JSON must match this schema exactly:\n{json.dumps(JSON_SCHEMA, indent=2)}"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local MedASR + MedGemma medical scribe")
    parser.add_argument("--audio", help="Path to input audio file (wav/mp3/m4a)")
    parser.add_argument("--out", default="build/medgemma-artifacts.json", help="Path to output JSON artifacts")
    parser.add_argument("--note-out", default="build/medgemma-note.txt", help="Path to rendered note output")
    parser.add_argument("--hf-token", default=os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACEHUB_API_TOKEN"))
    parser.add_argument("--transcript", help="Bypass ASR with a provided transcript string")
    parser.add_argument("--transcript-file", help="Bypass ASR with a transcript file")
    parser.add_argument("--chunk-seconds", type=int, default=20, help="ASR chunk length in seconds")
    parser.add_argument("--stride-seconds", type=int, default=2, help="ASR stride overlap in seconds")
    parser.add_argument("--max-new-tokens", type=int, default=256, help="Max tokens for MedGemma output")
    parser.add_argument(
        "--max-transcript-chars",
        type=int,
        default=3000,
        help="Max characters to include from transcript (tail) for MedGemma prompt",
    )
    parser.add_argument("--backend", choices=["llama.cpp", "transformers"], default="llama.cpp")
    parser.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    parser.add_argument("--llama-model", default="models/medgemma-1.5-4b-it-q4_k_m.gguf")
    parser.add_argument("--llama-cli", default="/opt/homebrew/Cellar/llama.cpp/7950/libexec/llama-completion")
    parser.add_argument("--llama-ctx", type=int, default=4096)
    parser.add_argument("--llama-threads", type=int, default=8)
    parser.add_argument("--llama-device", default="BLAS")
    parser.add_argument("--allow-download", action="store_true", help="Allow downloading models if missing")
    return parser.parse_args()


def render_note(draft_note: dict) -> str:
    draft_note = normalize_draft_note(draft_note)
    return "\n".join(
        [
            "HPI:",
            draft_note.get("hpi", "not documented"),
            "",
            "ROS:",
            draft_note.get("ros", "not documented"),
            "",
            "Assessment:",
            draft_note.get("assessment", "not documented"),
            "",
            "Plan:",
            draft_note.get("plan", "not documented"),
        ]
    )


def normalize_draft_note(draft_note: dict) -> dict:
    normalized = dict(draft_note or {})
    for key in ("hpi", "ros", "assessment", "plan"):
        value = normalized.get(key, "")
        if not isinstance(value, str) or not value.strip():
            normalized[key] = "not documented"
        else:
            normalized[key] = value.strip()
    return normalized


def build_prompt(transcript: str, max_chars: int) -> str:
    if max_chars and len(transcript) > max_chars:
        transcript = transcript[-max_chars:]
    return "\n".join(
        [
            "NEW TRANSCRIPT CHUNK:",
            transcript or "(empty)",
            "",
            "RECENT TRANSCRIPT WINDOW:",
            transcript or "(empty)",
            "",
            "CURRENT ENCOUNTER STATE (JSON):",
            json.dumps(JSON_SCHEMA["encounter_state"], indent=2),
            "",
            "CURRENT DRAFT NOTE (JSON):",
            json.dumps(JSON_SCHEMA["draft_note"], indent=2),
            "",
            "Return updated JSON now.",
            "Remember: wrap JSON in <BEGIN_JSON> and <END_JSON> tags.",
            "Do NOT copy the transcript into recent_transcript_window; leave it empty.",
        ]
    )


def extract_json(text: str) -> str:
    text = text.strip()
    if "<BEGIN_JSON>" in text and "<END_JSON>" in text:
        start = text.find("<BEGIN_JSON>") + len("<BEGIN_JSON>")
        end = text.find("<END_JSON>", start)
        if end != -1:
            return text[start:end].strip()
    if text.startswith("{") and text.endswith("}"):
        return text
    if "```" in text:
        start = text.find("```json")
        if start != -1:
            end = text.find("```", start + 1)
            if end != -1:
                return text[start + 7 : end].strip()
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first : last + 1]
    raise RuntimeError("Failed to extract JSON from model output")


def clean_transcript(text: str) -> str:
    text = text.replace("<epsilon>", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def ensure_snapshot(model_id: str, hf_token: str | None, allow_download: bool) -> str:
    try:
        return snapshot_download(model_id, token=hf_token, local_files_only=not allow_download)
    except Exception as exc:
        if allow_download:
            raise
        raise RuntimeError(
            f"Missing local files for {model_id}. Re-run with --allow-download to fetch them."
        ) from exc


def run_llama_completion(
    prompt_text: str,
    llama_cli: str,
    llama_model: str,
    max_new_tokens: int,
    ctx_size: int,
    threads: int,
    device: str,
) -> str:
    prompt_path = Path("build/medgemma-prompt.txt")
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    if prompt_text.startswith("<bos>"):
        prompt_text = prompt_text[len("<bos>") :]
    prompt_path.write_text(prompt_text)

    log_path = Path("build/llama-completion.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        llama_cli,
        "-m",
        llama_model,
        "-c",
        str(ctx_size),
        "--device",
        device,
        "-f",
        str(prompt_path),
        "-n",
        str(max_new_tokens),
        "--no-display-prompt",
        "-no-cnv",
        "--temp",
        "0",
        "-t",
        str(threads),
        "--log-file",
        str(log_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "llama-completion failed. stderr:\n" + (result.stderr.strip() or "<empty>")
        )
    return result.stdout.strip()


def has_required_schema(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    required = {"encounter_state", "draft_note", "recent_transcript_window", "warnings"}
    return required.issubset(payload.keys())


def map_legacy_schema(payload: dict, transcript: str) -> dict:
    def pick_first(*values: str) -> str:
        for value in values:
            if value and value.strip():
                return value.strip()
        return "not documented"

    draft_note = {
        "hpi": pick_first(
            payload.get("history_of_present_illness"),
            payload.get("chief_complaint"),
        ),
        "ros": pick_first(payload.get("review_of_systems")),
        "assessment": pick_first(payload.get("assessment")),
        "plan": pick_first(payload.get("plan")),
    }
    return {
        "encounter_state": JSON_SCHEMA["encounter_state"],
        "draft_note": draft_note,
        "recent_transcript_window": transcript,
        "warnings": ["Model output schema mismatch; mapped to expected schema."],
    }


def main() -> None:
    args = parse_args()
    device = args.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("MPS not available; falling back to CPU.")
        device = "cpu"

    if args.hf_token:
        os.environ["HF_TOKEN"] = args.hf_token
        os.environ["HUGGINGFACEHUB_API_TOKEN"] = args.hf_token

    medgemma_path = ensure_snapshot(MEDGEMMA_MODEL, args.hf_token, args.allow_download)
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    transcript = ""
    if args.transcript_file:
        transcript_path = Path(args.transcript_file)
        transcript = clean_transcript(transcript_path.read_text())
    elif args.transcript:
        transcript = clean_transcript(args.transcript)
    else:
        if not args.audio:
            raise RuntimeError("Provide --audio or use --transcript / --transcript-file")
        medasr_path = ensure_snapshot(MEDASR_MODEL, args.hf_token, args.allow_download)
        audio_path = Path(args.audio)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        print("Loading MedASR...")
        if device == "cuda":
            asr_device = 0
        elif device == "mps":
            asr_device = "mps"
        else:
            asr_device = -1

        asr = pipeline(
            "automatic-speech-recognition",
            model=medasr_path,
            device=asr_device,
            chunk_length_s=args.chunk_seconds,
            stride_length_s=args.stride_seconds,
            token=args.hf_token,
        )

        print("Transcribing audio...")
        asr_result = asr(str(audio_path))
        transcript = clean_transcript(asr_result.get("text", ""))
        if transcript.endswith("</s>"):
            transcript = transcript.replace("</s>", "").strip()
    print("Transcript:")
    print(transcript)

    if not transcript:
        raise RuntimeError("Transcript is empty; aborting")

    print("Loading MedGemma...")
    processor = AutoProcessor.from_pretrained(medgemma_path, token=args.hf_token)
    prompt = build_prompt(transcript, args.max_transcript_chars)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    print("Generating note JSON...")
    prompt_text = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)

    if args.backend == "llama.cpp":
        decoded = run_llama_completion(
            prompt_text=prompt_text,
            llama_cli=args.llama_cli,
            llama_model=args.llama_model,
            max_new_tokens=args.max_new_tokens,
            ctx_size=args.llama_ctx,
            threads=args.llama_threads,
            device=args.llama_device,
        )
    else:
        raise RuntimeError("transformers backend is disabled in this build; use llama.cpp")

    debug_path = Path("build/medgemma-decoded.txt")
    debug_path.parent.mkdir(parents=True, exist_ok=True)
    debug_path.write_text(decoded)
    try:
        json_text = extract_json(decoded)
        parsed = json.loads(json_text)
    except Exception as exc:
        raw_path = Path("build/medgemma-raw.txt")
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(decoded)
        raise RuntimeError(f"Failed to parse JSON. Raw output saved to {raw_path}") from exc

    window = transcript[-args.max_transcript_chars :] if args.max_transcript_chars else transcript

    if has_required_schema(parsed):
        artifacts = parsed
    elif isinstance(parsed, dict):
        artifacts = map_legacy_schema(parsed, window)
    else:
        raise RuntimeError("MedGemma output was JSON but did not match expected schema.")

    artifacts["recent_transcript_window"] = window
    if not isinstance(artifacts.get("warnings"), list):
        artifacts["warnings"] = []
    artifacts["draft_note"] = normalize_draft_note(artifacts.get("draft_note", {}))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(artifacts, indent=2))

    note_text = render_note(artifacts.get("draft_note", {}))
    note_out = Path(args.note_out)
    note_out.parent.mkdir(parents=True, exist_ok=True)
    note_out.write_text(note_text)

    print(f"Artifacts saved: {out_path}")
    print(f"Note saved: {note_out}")
    print(note_text)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)
