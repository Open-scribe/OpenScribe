#!/usr/bin/env python3
"""
Simple Audio Recorder & Transcriber for Electron App

Backend script that handles:
1. Recording system/microphone audio
2. Transcribing with Whisper  
3. Summarizing with Ollama
4. Saving everything locally

Usage (called by Electron):
    python simple_recorder.py start "Meeting Name"
    python simple_recorder.py stop  
    python simple_recorder.py process recording.wav --name "Session"
    python simple_recorder.py status
"""

import click
import asyncio
import logging
import json
import os
import sys
import time
import threading
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

# Import modules with graceful fallback for missing dependencies
try:
    from src.audio_recorder import AudioRecorder
except ImportError:
    AudioRecorder = None

try:
    from src.transcriber import WhisperTranscriber  
except ImportError:
    WhisperTranscriber = None
    
try:
    from src.summarizer import OllamaSummarizer
except ImportError:
    OllamaSummarizer = None
from src.config import get_config, get_backend_data_dir

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DEFAULT_WHISPER_MODEL = "tiny.en"

class SimpleRecorder:
    """Simple audio recorder and transcriber."""
    
    def __init__(self):
        # Only initialize if dependencies are available
        self.audio_recorder = AudioRecorder() if AudioRecorder else None
        
        # Only initialize transcriber/summarizer when needed to save memory
        self.transcriber = None
        self.summarizer = None
        
        # In packaged builds, use OS-native app data; in development keep project-local dirs.
        if getattr(sys, "frozen", False):
            backend_dir = get_backend_data_dir()
            self.recordings_dir = backend_dir / "recordings"
            self.transcripts_dir = backend_dir / "transcripts"
            self.output_dir = backend_dir / "output"
        else:
            self.recordings_dir = Path("recordings")
            self.transcripts_dir = Path("transcripts")
            self.output_dir = Path("output")
        
        # Create directories (including parent directories)
        for dir_path in [self.recordings_dir, self.transcripts_dir, self.output_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
        
        # State file lives with runtime data for packaged builds.
        self.state_file = get_backend_data_dir() / "recorder_state.json"
        
        # Global AudioRecorder instance to maintain state across CLI calls
        self.persistent_recorder = None

    def prewarm_pipeline(self, note_type: str = "history_physical"):
        """
        Best-effort prewarm during active recording to reduce stop->result latency.
        Runs in background and must never fail the recording flow.
        """
        try:
            print("🔥 Prewarming transcription model...")
            if self.transcriber is None and WhisperTranscriber:
                t0 = time.perf_counter()
                self.transcriber = WhisperTranscriber()
                print(f"✅ Transcription model warmed in {time.perf_counter() - t0:.2f}s")
        except Exception as e:
            print(f"⚠️ Transcription prewarm skipped: {e}")

        try:
            print("🔥 Prewarming note generation engine...")
            if self.summarizer is None and OllamaSummarizer:
                t0 = time.perf_counter()
                self.summarizer = OllamaSummarizer()
                print(f"✅ Note engine warmed in {time.perf_counter() - t0:.2f}s")
        except Exception as e:
            print(f"⚠️ Note engine prewarm skipped: {e}")
        
    def get_state(self) -> dict:
        """Get current recorder state."""
        if self.state_file.exists():
            try:
                with open(self.state_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {"recording": False, "current_file": None, "session_name": None}
    
    def save_state(self, state: dict):
        """Save recorder state."""
        with open(self.state_file, 'w') as f:
            json.dump(state, f, indent=2)
    
    def start_recording(self, session_name: str = "Recording") -> str:
        """Start recording audio."""
        state = self.get_state()
        if state.get("recording"):
            raise Exception(f"Already recording: {state.get('current_file', 'unknown file')}")
        
        # Create filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = "".join(c for c in session_name if c.isalnum() or c in (' ', '-', '_')).strip()
        filename = f"{timestamp}_{safe_name}.wav"
        
        recording_path = self.recordings_dir / filename
        
        print(f"🎤 Starting recording: {session_name}")
        print(f"📁 File: {recording_path}")
        
        # Start recording
        self.audio_recorder.start_recording()
        
        # Update state
        new_state = {
            "recording": True,
            "current_file": str(recording_path), 
            "session_name": session_name,
            "start_time": datetime.now().isoformat()
        }
        self.save_state(new_state)
        
        return str(recording_path)
    
    def stop_recording(self) -> Optional[str]:
        """Stop current recording."""
        state = self.get_state()
        if not state.get("recording"):
            print("⚠️ No active recording to stop")
            return None
        
        print("🔴 Stopping recording")
        
        # Stop recording
        self.audio_recorder.stop_recording()
        
        # Wait a moment for recording to fully stop
        import time
        time.sleep(0.5)
        
        # Get the planned file path from state
        recording_path = state.get("current_file")
        if not recording_path:
            print("⚠️ No recording file path found in state")
            # Try to create a default path
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            recording_path = str(self.recordings_dir / f"{timestamp}_recording.wav")
        
        # Save the recording to the planned file
        from pathlib import Path
        if self.audio_recorder.save_recording(Path(recording_path)):
            print(f"✅ Recording saved: {recording_path}")
        else:
            print("❌ Failed to save recording")
            recording_path = None
        
        # Update state (always clear recording state)
        new_state = {
            "recording": False,
            "current_file": None,
            "session_name": None,
            "stop_time": datetime.now().isoformat()
        }
        if recording_path:
            new_state["last_recording"] = recording_path
        
        self.save_state(new_state)
        return recording_path
    
    async def transcribe_audio(self, audio_file: str, session_name: str = "Recording") -> dict:
        """Transcribe audio file."""
        audio_path = Path(audio_file)
        
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")
        
        print(f"📝 Transcribing: {audio_path.name}", flush=True)
        
        # Initialize transcriber only when needed
        if self.transcriber is None:
            self.transcriber = WhisperTranscriber()
        
        # Transcribe (pass Path object, not string)
        transcript_result = self.transcriber.transcribe_audio(audio_path)
        
        # Handle different return types
        if hasattr(transcript_result, 'text'):
            transcript_text = transcript_result.text
        elif isinstance(transcript_result, str):
            transcript_text = transcript_result
        else:
            transcript_text = str(transcript_result)
        
        # Save transcript
        transcript_path = self.transcripts_dir / f"{audio_path.stem}_transcript.txt"
        transcript_content = f"""Session: {session_name}
File: {audio_path.name}
Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

{'='*60}

{transcript_text}
"""
        
        with open(transcript_path, 'w') as f:
            f.write(transcript_content)
        
        print(f"📄 Transcript saved: {transcript_path}")
        
        return {
            "audio_file": str(audio_path),
            "transcript_file": str(transcript_path), 
            "transcript_text": transcript_text,
            "session_name": session_name
        }
    
    async def summarize_transcript(
        self,
        transcript_text: str,
        session_name: str = "Recording",
        duration_minutes: int = 10,
        note_type: str = "history_physical",
    ) -> dict:
        """Summarize transcript text."""
        print("🧠 Generating summary...", flush=True)
        
        # Initialize summarizer only when needed
        if self.summarizer is None:
            self.summarizer = OllamaSummarizer()
        
        include_summary = os.getenv("OPENSCRIBE_ENABLE_MEETING_SUMMARY", "0").lower() in {"1", "true", "yes", "on"}
        summary_result = None
        if include_summary:
            summary_result = self.summarizer.summarize_transcript(transcript_text, duration_minutes)
        else:
            logger.info("Skipping meeting-summary generation (OPENSCRIBE_ENABLE_MEETING_SUMMARY is disabled)")
        clinical_note = self.summarizer.generate_clinical_note(transcript_text, note_type)
        
        if summary_result is None:
            return {
                "summary": "",
                "participants": [],
                "discussion_areas": [],
                "key_points": [],
                "action_items": [],
                "clinical_note": clinical_note,
            }
        
        # Defensive extraction from summary_result
        try:
            return {
                "summary": getattr(summary_result, 'overview', '') or '',
                "participants": getattr(summary_result, 'participants', []) or [],
                "discussion_areas": [
                    {
                        "title": getattr(area, 'title', ''),
                        "analysis": getattr(area, 'analysis', '')
                    } for area in getattr(summary_result, 'discussion_areas', [])
                ],
                "key_points": [getattr(decision, 'decision', '') for decision in getattr(summary_result, 'key_points', [])],
                "action_items": [getattr(action, 'description', '') for action in getattr(summary_result, 'next_steps', [])],
                "clinical_note": clinical_note,
            }
        except Exception as e:
            print(f"⚠️ Error extracting summary data: {e}")
            return {
                "summary": "Summary extraction failed",
                "participants": [],
                "discussion_areas": [],
                "key_points": [],
                "action_items": [],
                "clinical_note": clinical_note,
            }
    
    async def process_recording(self, audio_file: str, session_name: str = "Recording", note_type: str = "history_physical") -> dict:
        """Complete processing: transcribe + summarize."""
        print(f"🔄 Processing recording: {audio_file}", flush=True)
        pipeline_t0 = time.perf_counter()
        
        # If no audio file provided, use the last recording
        if not audio_file:
            state = self.get_state()
            audio_file = state.get("last_recording")
            if not audio_file:
                raise Exception("No audio file specified and no recent recording found")
        
        # Ensure we have a proper path
        audio_file = str(audio_file)  # Convert to string if it's a Path object
        audio_path = Path(audio_file)
        
        # Calculate actual recording duration from file
        duration_minutes = 10  # Default fallback
        try:
            import wave
            with wave.open(str(audio_path), 'rb') as wav_file:
                frame_rate = wav_file.getframerate()
                num_frames = wav_file.getnframes()
                duration_seconds = num_frames / frame_rate
                if duration_seconds < 60:
                    duration_display = f"{int(duration_seconds)}s"
                    duration_minutes = 0  # Store as 0 for sub-minute recordings
                else:
                    duration_minutes = int(duration_seconds / 60)
                    duration_display = f"{duration_minutes}m"
                print(f"📏 Audio duration: {duration_seconds:.1f} seconds ({duration_display})", flush=True)
        except Exception as e:
            print(f"⚠️ Could not determine audio duration: {e}")
            # Try to get duration from state file timestamps
            try:
                state = self.get_state()
                start_time = state.get("start_time")
                stop_time = state.get("stop_time")
                if start_time and stop_time:
                    from dateutil.parser import parse
                    start_dt = parse(start_time)
                    stop_dt = parse(stop_time)
                    duration_seconds = (stop_dt - start_dt).total_seconds()
                    duration_minutes = max(1, int(duration_seconds / 60))
                    print(f"📏 Duration from timestamps: {duration_seconds:.1f} seconds ({duration_minutes} minutes)", flush=True)
            except Exception:
                pass
        
        # Step 1: Transcribe
        transcribe_t0 = time.perf_counter()
        transcript_data = await self.transcribe_audio(audio_file, session_name)
        transcribe_elapsed = time.perf_counter() - transcribe_t0
        print(f"⏱️ Transcription stage completed in {transcribe_elapsed:.2f}s", flush=True)
        
        # Step 2: Summarize with actual duration
        summarize_t0 = time.perf_counter()
        summary_data = await self.summarize_transcript(
            transcript_data["transcript_text"],
            session_name,
            duration_minutes,
            note_type,
        )
        summarize_elapsed = time.perf_counter() - summarize_t0
        print(f"⏱️ Note generation stage completed in {summarize_elapsed:.2f}s", flush=True)
        
        # Step 3: Save complete summary
        summary_path = self.output_dir / f"{audio_path.stem}_summary.json"
        
        complete_data = {
            "session_info": {
                "name": session_name,
                "audio_file": str(audio_path),
                "transcript_file": transcript_data["transcript_file"],
                "summary_file": str(summary_path),
                "processed_at": datetime.now().isoformat(),
                "duration_seconds": int(duration_seconds) if 'duration_seconds' in locals() else None,
                "duration_minutes": duration_minutes,
                "note_type": note_type,
            },
            "summary": summary_data.get("summary", "") or "",
            "participants": summary_data.get("participants", []) or [],
            "discussion_areas": summary_data.get("discussion_areas", []) or [],
            "key_points": summary_data.get("key_points", []) or [],
            "action_items": summary_data.get("action_items", []) or [],
            "clinical_note": summary_data.get("clinical_note", "") or "",
            "transcript": transcript_data["transcript_text"]
        }
        
        with open(summary_path, 'w') as f:
            json.dump(complete_data, f, indent=2)
        
        print(f"✅ Complete processing saved: {summary_path}", flush=True)
        
        # Clean up WAV file after successful processing
        try:
            audio_path.unlink()
            print(f"🗑️ Cleaned up audio file: {audio_path}", flush=True)
        except Exception as e:
            print(f"⚠️ Could not delete audio file: {e}")
        
        # Clear any recording state after successful processing
        state_file = Path("recorder_state.json")
        if state_file.exists():
            try:
                state_file.unlink()
                print(f"🧹 Cleared recording state", flush=True)
            except Exception as e:
                print(f"⚠️ Could not clear state: {e}")
        
        print(f"📋 Processing complete - meeting available in list", flush=True)
        print(f"⏱️ Total processing pipeline time: {time.perf_counter() - pipeline_t0:.2f}s", flush=True)

        return complete_data


# CLI Commands for Electron
@click.group()
def cli():
    """Simple Audio Recorder & Transcriber Backend"""
    pass


@cli.command()
@click.argument('session_name', default='Recording')
@click.option('--note-type', default='history_physical', help='Note type template (history_physical, problem_visit, consult_note)')
def start(session_name, note_type):
    """Start recording audio (stop with Ctrl+C to auto-process)"""
    import signal
    import time
    
    recorder = SimpleRecorder()
    recording_path = None
    recording_started = False
    processing_started = False
    
    def signal_handler(signum, frame):
        """Handle SIGTERM/SIGINT gracefully by stopping recording and processing"""
        nonlocal processing_started
        
        # Different handling for different signals
        signal_name = "SIGINT" if signum == 2 else f"SIGTERM" if signum == 15 else f"Signal {signum}"
        print(f"\n🛑 Received {signal_name} - stopping recording and processing...")
        
        # Prevent double processing if multiple signals received
        if processing_started:
            print("⚠️ Processing already started - please wait for completion...")
            if signum == 15:  # SIGTERM - ignore it during processing
                print("🔄 Ignoring SIGTERM during transcription/summarization")
                return
            sys.exit(0)
            
        if recording_started and recorder:
            processing_started = True
            try:
                final_path = recorder.stop_recording()
                if final_path:
                    print(f"✅ Recording saved: {final_path}")
                    
                    # Check file size
                    from pathlib import Path
                    file_size = Path(final_path).stat().st_size
                    print(f"📏 File size: {file_size / 1024:.1f} KB")
                    
                    if file_size >= 1000:  # At least 1KB of audio data
                        print("🔄 Starting transcription and summarization pipeline...")
                        
                        # Process recording with proper async handling
                        try:
                            import asyncio
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            
                            print("📝 Transcribing...")
                            result = loop.run_until_complete(recorder.process_recording(final_path, session_name, note_type))
                            
                            print("✅ Complete processing finished!")
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")
                            
                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}")
                            import traceback
                            traceback.print_exc()
                    else:
                        print("⚠️ Recording too short - skipping processing")
                else:
                    print("❌ No recording data to save")
            except Exception as e:
                print(f"❌ Error during signal handling: {e}")
                import traceback
                traceback.print_exc()
        
        print("🏁 Recording session ended")
        sys.exit(0)
    
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        recording_path = recorder.start_recording(session_name)
        recording_started = True
        if os.getenv("OPENSCRIBE_PREWARM", "1").lower() in {"1", "true", "yes", "on"}:
            threading.Thread(
                target=recorder.prewarm_pipeline,
                args=(note_type,),
                daemon=True,
            ).start()
        print(f"🎤 Recording '{session_name}' - Press Ctrl+C to stop and process")
        print(f"📁 File: {recording_path}")
        print("📢 Speak now...")
        
        # Wait indefinitely until interrupted
        while True:
            time.sleep(1)
            
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)


@cli.command()
def stop():
    """Stop current recording and trigger processing"""
    import subprocess
    import signal
    import os
    import time
    
    # First check if there's a recording process running
    try:
        # Find running start processes
        result = subprocess.run(
            ['pgrep', '-f', 'simple_recorder.py start'],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0 and result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            print(f"🔍 Found {len(pids)} recording process(es)")
            
            for pid in pids:
                if pid.strip():
                    try:
                        pid_int = int(pid.strip())
                        print(f"🛑 Sending SIGINT to recording process (PID: {pid_int})")
                        os.kill(pid_int, signal.SIGINT)
                        
                        print(f"✅ Stop signal sent to process {pid_int}")
                        print(f"🔄 Recording will stop and processing will begin automatically")
                        print(f"💡 Processing may take a few minutes - check output files when complete")
                            
                    except (ValueError, ProcessLookupError) as e:
                        print(f"⚠️ Could not signal process {pid}: {e}")
            
            print("✅ Stop signal sent - recording will be processed automatically")
            
        else:
            # Fallback to old method if no start process found
            print("🔍 No start process found, checking recording state...")
            recorder = SimpleRecorder()
            state = recorder.get_state()
            
            if state.get("recording"):
                print("⚠️ Recording state shows active but no process found")
                print("🔧 Clearing stuck state...")
                recorder.save_state({
                    "recording": False,
                    "current_file": None,
                    "session_name": None
                })
                print("✅ State cleared")
            else:
                print("ℹ️ No active recording found")
                
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)


@cli.command()
@click.argument('audio_file', default='')
@click.option('--name', '-n', default='Recording', help='Session name for the recording')
@click.option('--note-type', default='history_physical', help='Note type template (history_physical, problem_visit, consult_note)')
def process(audio_file, name, note_type):
    """Process audio file: transcribe + summarize"""
    
    async def run_process():
        recorder = SimpleRecorder()
        
        try:
            result = await recorder.process_recording(audio_file, name, note_type)
            
            print("SUCCESS: Processing complete!")
            print(f"Transcript: {result['session_info']['transcript_file']}")
            print(f"Summary: {result['session_info']['summary_file']}")
            
        except Exception as e:
            print(f"ERROR: {e}")
            sys.exit(1)
    
    asyncio.run(run_process())


@cli.command()
def status():
    """Show recorder status"""
    recorder = SimpleRecorder()
    state = recorder.get_state()
    
    print("🎙️ OpenScribe Recorder Status")
    print("=" * 25)
    
    if state.get("recording"):
        print("STATUS: RECORDING")
        print(f"Session: {state.get('session_name')}")
        print(f"File: {state.get('current_file')}")
        print(f"Started: {state.get('start_time')}")
    else:
        print("STATUS: READY")
    
    # Show recent recordings
    recordings = list(recorder.recordings_dir.glob("*.wav"))
    if recordings:
        recent = sorted(recordings, key=lambda x: x.stat().st_mtime, reverse=True)[:3]
        print(f"\nRecent recordings ({len(recordings)} total):")
        for recording in recent:
            size_mb = recording.stat().st_size / (1024 * 1024)
            print(f"  • {recording.name} ({size_mb:.1f}MB)")


@cli.command()
@click.argument('duration', type=int, default=10)
@click.argument('session_name', default='Recording')
@click.option('--note-type', default='history_physical', help='Note type template (history_physical, problem_visit, consult_note)')
def record(duration, session_name, note_type):
    """Record audio for specified duration and process it"""
    import signal
    import sys

    print(f"🎤 Recording {duration} seconds of audio for '{session_name}'...")

    recorder = SimpleRecorder()
    recording_path = None
    recording_started = False
    is_paused = False

    def pause_handler(signum, frame):
        """Handle SIGUSR1 to pause recording"""
        nonlocal is_paused
        print(f"📨 Received SIGUSR1 signal (pause request)")
        print(f"   recording_started={recording_started}, has_recorder={recorder is not None}, has_audio={recorder.audio_recorder is not None if recorder else False}")
        if recording_started and recorder and recorder.audio_recorder:
            if not is_paused:
                recorder.audio_recorder.pause_recording()
                is_paused = True
                print("⏸️ Recording paused successfully")
            else:
                print("⏸️ Already paused - ignoring")
        else:
            print("⚠️ Cannot pause - recording not active")

    def resume_handler(signum, frame):
        """Handle SIGUSR2 to resume recording"""
        nonlocal is_paused
        print(f"📨 Received SIGUSR2 signal (resume request)")
        print(f"   recording_started={recording_started}, is_paused={is_paused}")
        if recording_started and recorder and recorder.audio_recorder:
            if is_paused:
                recorder.audio_recorder.resume_recording()
                is_paused = False
                print("▶️ Recording resumed successfully")
            else:
                print("▶️ Not paused - ignoring")
        else:
            print("⚠️ Cannot resume - recording not active")

    # Register pause/resume signal handlers (Unix only)
    if sys.platform != 'win32':
        try:
            signal.signal(signal.SIGUSR1, pause_handler)
            signal.signal(signal.SIGUSR2, resume_handler)
        except (AttributeError, ValueError) as e:
            print(f"⚠️ Could not register pause/resume signals: {e}")

    def signal_handler(signum, frame):
        """Handle SIGTERM gracefully by stopping recording and processing"""
        print(f"\n🛑 Received termination signal ({signum})")
        if recording_started and recorder:
            print("⏹️ Stopping recording and starting processing pipeline...")
            try:
                final_path = recorder.stop_recording()
                if final_path:
                    print(f"✅ Recording saved: {final_path}")
                    
                    # Check file size
                    from pathlib import Path
                    file_size = Path(final_path).stat().st_size
                    print(f"📏 File size: {file_size / 1024:.1f} KB")
                    
                    if file_size >= 1000:  # At least 1KB of audio data
                        print("🔄 Starting transcription and summarization pipeline...")
                        
                        # Create new event loop for signal handler
                        try:
                            # Process recording synchronously in signal handler
                            import asyncio
                            if hasattr(asyncio, '_get_running_loop') and asyncio._get_running_loop():
                                loop = asyncio._get_running_loop()
                            else:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                            
                            print("🔄 Starting processing pipeline...")
                            result = loop.run_until_complete(recorder.process_recording(final_path, session_name, note_type))
                            
                            print("✅ Complete processing finished!")
                            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
                            print(f"📋 Summary: {result['session_info']['summary_file']}")
                            print(f"📊 Meeting: {result['session_info']['name']}")
                            
                        except Exception as e:
                            print(f"❌ Processing pipeline failed: {e}")
                            import traceback
                            traceback.print_exc()
                    else:
                        print("⚠️ Recording too short - skipping processing")
                else:
                    print("❌ No recording data to save")
            except Exception as e:
                print(f"❌ Error during signal handling: {e}")
                import traceback
                traceback.print_exc()
        
        print("🏁 Recording session ended - process complete")
        sys.exit(0)
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        # Start recording
        recording_path = recorder.start_recording(session_name)
        recording_started = True
        print(f"📁 Recording to: {recording_path}")
        print("📢 Speak into your microphone now!")
        
        # For very long durations (like 999999), just wait indefinitely until signal
        if duration > 86400:  # More than a day
            print("🔄 Recording indefinitely (until stopped)...")
            try:
                while True:
                    time.sleep(5)  # Check every 5 seconds
            except KeyboardInterrupt:
                signal_handler(signal.SIGINT, None)
        else:
            # Count down for normal durations (log every 10 minutes to reduce spam)
            for i in range(duration, 0, -1):
                if i % 600 == 0:  # Every 10 minutes
                    print(f"Recording... {i // 60} minutes remaining")
                time.sleep(1)
        
        # Normal completion (if not interrupted)
        final_path = recorder.stop_recording()
        if not final_path:
            print("❌ Recording failed - no audio data collected")
            return
            
        print(f"✅ Recording saved: {final_path}")
        
        # Check file size
        from pathlib import Path
        file_size = Path(final_path).stat().st_size
        print(f"📏 File size: {file_size / 1024:.1f} KB")
        
        if file_size < 1000:  # Less than 1KB indicates empty recording
            print("⚠️ Recording appears to be empty - check microphone")
            return
        
        # Process recording
        print("🔄 Processing recording (transcribe + summarize)...")
        
        async def process_recording():
            result = await recorder.process_recording(final_path, session_name, note_type)
            print("✅ Processing complete!")
            print(f"📄 Transcript: {result['session_info']['transcript_file']}")  
            print(f"📋 Summary: {result['session_info']['summary_file']}")
            
            # Show quick preview
            if result.get('transcript'):
                preview = result['transcript'][:200] + "..." if len(result['transcript']) > 200 else result['transcript']
                print(f"📝 Preview: {preview}")
        
        asyncio.run(process_recording())
        
    except Exception as e:
        print(f"❌ Recording failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
def test():
    """Quick system test - check components can initialize"""
    print("🧪 Quick system test...")
    
    try:
        # Test audio recording capability
        print("🎤 Testing audio recording...")
        recorder = SimpleRecorder()
        if not recorder.audio_recorder:
            print("❌ Audio recording not available")
            print("ERROR: Audio dependencies missing")
            return
        print("✅ Audio recording ready")
        
        # Test transcriber availability
        print("🗣️ Testing Whisper transcriber...")
        if not WhisperTranscriber:
            print("❌ Whisper transcriber not available")
            print("ERROR: Whisper not installed")
            return
            
        try:
            transcriber = WhisperTranscriber()
            print("✅ Whisper transcriber ready")
        except Exception as e:
            print(f"❌ Whisper initialization failed: {e}")
            print(f"ERROR: {e}")
            return
        
        # Test Ollama availability (lightweight check)
        print("🧠 Testing Ollama availability...")
        if not OllamaSummarizer:
            print("❌ Ollama summarizer not available")
            print("ERROR: Ollama dependencies missing")
            return
            
        try:
            # Just check if we can initialize without making API calls
            summarizer = OllamaSummarizer()
            print("✅ Ollama summarizer ready")
        except Exception as e:
            print(f"❌ Ollama initialization failed: {e}")
            print(f"ERROR: {e}")
            return
        
        print("🎉 System check passed!")
        print("SUCCESS: All components are working correctly")
        
    except Exception as e:
        print(f"❌ System test failed: {e}")
        print(f"ERROR: {e}")
        return


@cli.command()
def list_meetings():
    """List all processed meetings - optimized for fast loading"""
    # Don't initialize SimpleRecorder to avoid Ollama checks - just get the output directory
    if getattr(sys, "frozen", False):
        output_dir = get_backend_data_dir() / "output"
    else:
        output_dir = Path("output")
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Get all summary files - use glob pattern for speed
    summaries = list(output_dir.glob("*_summary.json"))
    meetings = []
    
    # Sort by actual meeting date, with fallback to modification time
    def get_meeting_date(summary_file):
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('session_info', {}).get('processed_at', '')
        except:
            # Fallback to file modification time if JSON read fails
            return summary_file.stat().st_mtime
    
    summaries.sort(key=get_meeting_date, reverse=True)
    
    for summary_file in summaries:
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Only include essential fields for faster loading
                essential_meeting = {
                    "session_info": data.get("session_info", {}),
                    "summary": data.get("summary", ""),
                    "participants": data.get("participants", []),
                    "discussion_areas": data.get("discussion_areas", []),
                    "key_points": data.get("key_points", []),
                    "action_items": data.get("action_items", []),
                    "clinical_note": data.get("clinical_note", ""),
                    "transcript": data.get("transcript", "")
                }
                meetings.append(essential_meeting)
        except Exception as e:
            # Log warning but continue processing other files
            logger.warning(f"Failed to load {summary_file}: {e}")
            continue
    
    # Output as compact JSON for Electron (no indentation for speed)
    print(json.dumps(meetings, separators=(',', ':')))


@cli.command()
@click.argument('summary_file', required=True)
def reprocess(summary_file):
    """Reprocess a failed summary by re-running Ollama analysis on existing transcript"""
    import json
    from pathlib import Path
    
    async def run_reprocess():
        recorder = SimpleRecorder()
        summary_path = Path(summary_file)
        
        if not summary_path.exists():
            print(f"ERROR: Summary file not found: {summary_file}")
            return
        
        try:
            # Load existing summary file
            with open(summary_path, 'r') as f:
                existing_data = json.load(f)
            
            # Get transcript from the data
            transcript = existing_data.get('transcript', '')
            if not transcript:
                print("ERROR: No transcript found in summary file")
                return
            
            session_name = existing_data.get('session_info', {}).get('name', 'Reprocessed')
            duration_minutes = existing_data.get('session_info', {}).get('duration_minutes', 10)
            note_type = existing_data.get('session_info', {}).get('note_type', 'history_physical')
            
            print(f"🔄 Reprocessing summary for: {session_name}")
            print(f"📝 Transcript length: {len(transcript)} characters")
            
            # Re-run summarization
            summary_data = await recorder.summarize_transcript(transcript, session_name, duration_minutes, note_type)
            
            # Update the existing data with new summary
            existing_data.update({
                "summary": summary_data.get("summary", "") or "",
                "participants": summary_data.get("participants", []) or [],
                "discussion_areas": summary_data.get("discussion_areas", []) or [],
                "key_points": summary_data.get("key_points", []) or [],
                "action_items": summary_data.get("action_items", []) or [],
                "clinical_note": summary_data.get("clinical_note", "") or "",
            })
            
            # Add reprocess timestamp
            existing_data["session_info"]["reprocessed_at"] = datetime.now().isoformat()
            
            # Save updated summary
            with open(summary_path, 'w') as f:
                json.dump(existing_data, f, indent=2)
            
            print(f"✅ Summary reprocessed successfully: {summary_path}")
            print(f"📋 New summary: {existing_data['summary'][:100]}...")
            
        except Exception as e:
            print(f"ERROR: Failed to reprocess summary: {e}")
    
    asyncio.run(run_reprocess())


@cli.command()
@click.argument('transcript_file')
@click.option('--question', '-q', required=True, help='Question to ask about the transcript')
def query(transcript_file, question):
    """Query a transcript with AI."""
    from pathlib import Path

    transcript_path = Path(transcript_file)

    # Handle summary JSON files (extract transcript from them)
    if transcript_file.endswith('.json'):
        if not transcript_path.exists():
            print(json.dumps({"success": False, "error": f"File not found: {transcript_file}"}))
            return

        try:
            with open(transcript_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                transcript_text = data.get('transcript', '')
                if not transcript_text:
                    print(json.dumps({"success": False, "error": "No transcript found in summary file"}))
                    return
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to read summary file: {e}"}))
            return
    else:
        # Handle plain text transcript files
        if not transcript_path.exists():
            print(json.dumps({"success": False, "error": f"File not found: {transcript_file}"}))
            return

        try:
            with open(transcript_path, 'r', encoding='utf-8') as f:
                transcript_text = f.read()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to read transcript: {e}"}))
            return

    if not transcript_text or transcript_text.strip() == "":
        print(json.dumps({"success": False, "error": "Transcript is empty"}))
        return

    # Always use llama3.2:3b for queries (fastest response times)
    try:
        summarizer = OllamaSummarizer(model_name="llama3.2:3b")
        answer = summarizer.query_transcript(transcript_text, question)

        if answer:
            print(json.dumps({"success": True, "answer": answer}))
        else:
            print(json.dumps({"success": False, "error": "Failed to get response from AI"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Query failed: {e}"}))


@cli.command()
def list_failed():
    """List summary files that failed processing (have fallback summaries)"""
    import json
    # Don't initialize SimpleRecorder to avoid Ollama checks - just get the output directory
    if getattr(sys, "frozen", False):
        output_dir = get_backend_data_dir() / "output"
    else:
        output_dir = Path("output")
    
    # Get all summary files
    summaries = list(output_dir.glob("*_summary.json"))
    failed_summaries = []
    
    for summary_file in summaries:
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                # Check for signs of failed processing
                summary_text = data.get("summary", "")
                if (summary_text.startswith("Meeting transcript recorded but detailed analysis failed") or 
                    summary_text.startswith("No transcript was generated") or
                    len(data.get("participants", [])) == 0 and len(data.get("key_points", [])) == 0):
                    failed_summaries.append({
                        "file": str(summary_file),
                        "name": data.get("session_info", {}).get("name", "Unknown"),
                        "processed_at": data.get("session_info", {}).get("processed_at", "Unknown"),
                        "summary": summary_text[:100] + "..." if len(summary_text) > 100 else summary_text
                    })
        except Exception as e:
            continue
    
    if failed_summaries:
        print("🔍 Failed Summaries Found:")
        print("=" * 50)
        for failed in failed_summaries:
            print(f"📁 File: {failed['file']}")
            print(f"📊 Name: {failed['name']}")
            print(f"🕐 Processed: {failed['processed_at']}")
            print(f"📝 Summary: {failed['summary']}")
            print(f"🔄 Reprocess: python simple_recorder.py reprocess \"{failed['file']}\"")
            print("-" * 50)
        print(f"Total failed summaries: {len(failed_summaries)}")
    else:
        print("✅ No failed summaries found - all processing completed successfully!")


@cli.command()
def clear_state():
    """Clear recording state (useful for resetting stuck recordings)"""
    recorder = SimpleRecorder()
    
    if recorder.state_file.exists():
        recorder.state_file.unlink()
        print("SUCCESS: Recording state cleared")
    else:
        print("SUCCESS: No state file found - already clear")


@cli.command()
def setup_check():
    """Check system setup and dependencies"""
    import subprocess
    import sys
    import os
    
    print("🔧 OpenScribe Setup Check")
    print("=" * 25)
    
    checks = []
    
    # Check Python version
    try:
        version = sys.version_info
        if version.major >= 3 and version.minor >= 8:
            checks.append(("✅ Python", f"{version.major}.{version.minor}.{version.micro}"))
        else:
            checks.append(("❌ Python", f"{version.major}.{version.minor}.{version.micro} (need 3.8+)"))
    except Exception as e:
        checks.append(("❌ Python", f"Error: {e}"))
    
    # Check required directories - use same logic as SimpleRecorder.__init__
    if getattr(sys, "frozen", False):
        app_support = get_backend_data_dir()
        base_dirs = {
            "recordings": app_support / "recordings",
            "transcripts": app_support / "transcripts",
            "output": app_support / "output",
        }
    else:
        base_dirs = {
            "recordings": Path("recordings"),
            "transcripts": Path("transcripts"),
            "output": Path("output"),
        }
    
    for dir_name, dir_path in base_dirs.items():
        if dir_path.exists():
            checks.append((f"✅ {dir_name}/", f"exists at {dir_path}"))
        else:
            dir_path.mkdir(parents=True, exist_ok=True)
            checks.append((f"✅ {dir_name}/", f"created at {dir_path}"))
    
    # Check Ollama - use bundled or system Ollama
    try:
        from src.ollama_manager import get_ollama_binary
        ollama_path = get_ollama_binary()
        if ollama_path:
            if 'bin/ollama' in str(ollama_path) or '_internal/ollama' in str(ollama_path):
                checks.append(("✅ Ollama", "bundled"))
            else:
                checks.append(("✅ Ollama", f"found at {ollama_path}"))
        else:
            checks.append(("❌ Ollama", "not found"))
    except Exception as e:
        checks.append(("❌ Ollama", f"Error: {e}"))
    
    # Check ffmpeg
    try:
        ffmpeg_found = False
        possible_ffmpeg_paths = [
            'ffmpeg',  # Try PATH first
            '/opt/homebrew/bin/ffmpeg',  # Homebrew on Apple Silicon
            '/usr/local/bin/ffmpeg',     # Homebrew on Intel
            '/usr/bin/ffmpeg',           # System installation
        ]
        
        for path in possible_ffmpeg_paths:
            try:
                result = subprocess.run([path, '-version'], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    checks.append(("✅ ffmpeg", f"found at {path}"))
                    ffmpeg_found = True
                    break
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue
        
        if not ffmpeg_found:
            checks.append(("❌ ffmpeg", "not found in PATH or common locations"))
    except Exception as e:
        checks.append(("❌ ffmpeg", f"Error: {e}"))
    
    # Skip Ollama model check during setup - service starts automatically when needed
    # Just verify Ollama binary is installed
    # The model will be downloaded during setup if needed
    
    # Check Python dependencies
    try:
        import sounddevice
        checks.append(("✅ sounddevice", "audio recording"))
    except ImportError:
        checks.append(("❌ sounddevice", "pip install sounddevice"))
    
    # Check for whisper backend (prefer pywhispercpp, fallback to openai-whisper)
    whisper_found = False
    try:
        import pywhispercpp
        checks.append(("✅ whisper", "pywhispercpp (fast)"))
        whisper_found = True
    except ImportError:
        pass

    if not whisper_found:
        try:
            import whisper
            checks.append(("✅ whisper", "openai-whisper"))
            whisper_found = True
        except ImportError:
            pass

    if not whisper_found:
        checks.append(("❌ whisper", "pip install pywhispercpp"))
    
    try:
        import ollama
        checks.append(("✅ ollama-python", "LLM client"))
    except ImportError:
        checks.append(("❌ ollama-python", "pip install ollama"))

    # Check if whisper model is downloaded (path varies by OS/install).
    whisper_model_dirs = [
        Path.home() / "Library" / "Application Support" / "pywhispercpp" / "models",
        Path.home() / ".cache" / "pywhispercpp" / "models",
        Path.home() / ".cache" / "whisper",
        Path.home() / "AppData" / "Local" / "pywhispercpp" / "models",
    ]
    whisper_models = []
    for whisper_model_path in whisper_model_dirs:
        if whisper_model_path.exists():
            whisper_models = list(whisper_model_path.glob("ggml-*.bin"))
            if whisper_models:
                break
    if whisper_models:
        model_name = whisper_models[0].stem.replace("ggml-", "")
        checks.append(("✅ whisper-model", f"{model_name} downloaded"))
    else:
        checks.append(("⚠️ whisper-model", "will download on first use (~500MB)"))

    # Check if configured LLM model is installed.
    try:
        from src.ollama_manager import list_models
        configured_model = get_config().get_model()
        installed_models = list_models()
        if configured_model in installed_models:
            checks.append(("✅ llm-model", f"{configured_model} installed"))
        elif installed_models:
            checks.append(("⚠️ llm-model", f"{configured_model} not installed; found: {', '.join(installed_models[:2])}"))
        else:
            checks.append(("❌ llm-model", "no model installed - needed for summaries"))
    except Exception as e:
        checks.append(("⚠️ llm-model", f"unable to detect installed models: {e}"))

    # Print results
    all_good = True
    for status, detail in checks:
        print(f"{status:<20} {detail}")
        if status.startswith("❌"):
            all_good = False
    
    print("\n" + "=" * 25)
    if all_good:
        print("🎉 System check passed! Ready to record meetings.")
    else:
        print("⚠️ Setup incomplete. Please install missing dependencies.")
    
    return {"success": all_good, "checks": checks}


@cli.command()
def list_models():
    """List all supported models with metadata"""
    config = get_config()
    models = config.list_supported_models()
    current_model = config.get_model()

    result = {
        "current_model": current_model,
        "supported_models": models
    }

    print(json.dumps(result, indent=2))


@cli.command()
def get_model():
    """Get the currently configured model"""
    config = get_config()
    current_model = config.get_model()
    model_info = config.get_model_info(current_model)

    result = {
        "model": current_model,
        "info": model_info
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('model_name')
def set_model(model_name):
    """Set the preferred model for summarization"""
    config = get_config()

    if model_name not in config.SUPPORTED_MODELS:
        print(f"ERROR: Unsupported model '{model_name}'.")
        print(f"Supported models: {', '.join(config.SUPPORTED_MODELS.keys())}")
        print(json.dumps({"success": False, "error": "unsupported_model", "supported_models": list(config.SUPPORTED_MODELS.keys())}))
        return

    success = config.set_model(model_name)

    if success:
        print(f"SUCCESS: Model set to {model_name}")
        print(json.dumps({"success": True, "model": model_name}))
    else:
        print(f"ERROR: Failed to save model configuration")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_notifications():
    """Get the current notification preference"""
    config = get_config()
    enabled = config.get_notifications_enabled()

    result = {
        "notifications_enabled": enabled
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('enabled', type=bool)
def set_notifications(enabled):
    """Set notification preference (True/False)"""
    config = get_config()
    success = config.set_notifications_enabled(enabled)

    if success:
        print(f"SUCCESS: Notifications {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "notifications_enabled": enabled}))
    else:
        print(f"ERROR: Failed to save notification preference")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def get_telemetry():
    """Get the current telemetry preference and anonymous ID"""
    config = get_config()
    enabled = config.get_telemetry_enabled()
    anonymous_id = config.get_anonymous_id()

    result = {
        "telemetry_enabled": enabled,
        "anonymous_id": anonymous_id
    }

    print(json.dumps(result, indent=2))


@cli.command()
@click.argument('enabled', type=bool)
def set_telemetry(enabled):
    """Set telemetry preference (True/False)"""
    config = get_config()
    success = config.set_telemetry_enabled(enabled)

    if success:
        print(f"SUCCESS: Telemetry {'enabled' if enabled else 'disabled'}")
        print(json.dumps({"success": True, "telemetry_enabled": enabled}))
    else:
        print(f"ERROR: Failed to save telemetry preference")
        print(json.dumps({"success": False, "error": "Failed to save config"}))


@cli.command()
def download_whisper_model():
    """Download the Whisper transcription model"""
    print("Downloading Whisper model...")

    try:
        from pywhispercpp.model import Model as WhisperCppModel

        # This will trigger the model download if not present
        print("Initializing Whisper model (will download if needed)...")
        model = WhisperCppModel(DEFAULT_WHISPER_MODEL)
        print("SUCCESS: Whisper model ready")

    except Exception as e:
        print(f"ERROR: Failed to download Whisper model: {e}")
        import sys
        sys.exit(1)


@cli.command()
def setup_status():
    """Return first-run setup status and runtime preference."""
    config = get_config()
    result = {
        "setup_completed": config.is_setup_completed(),
        "runtime_preference": config.get_runtime_preference(),
        "selected_model": config.get_model(),
        "model_catalog_version": config.get("model_catalog_version", "v1"),
    }
    print(json.dumps(result, indent=2))


@cli.command()
@click.argument("completed", type=bool)
def set_setup_completed(completed):
    """Set first-run setup completion status."""
    config = get_config()
    success = config.set_setup_completed(completed)
    print(json.dumps({"success": success, "setup_completed": bool(completed)}))


@cli.command()
@click.argument("runtime_preference")
def set_runtime_preference(runtime_preference):
    """Set runtime preference (mixed|local)."""
    config = get_config()
    success = config.set_runtime_preference(runtime_preference)
    if not success:
        print(json.dumps({"success": False, "error": "invalid_runtime_preference"}))
        return
    print(json.dumps({"success": True, "runtime_preference": runtime_preference}))


@cli.command()
@click.argument('model_name')
def check_model(model_name):
    """Check if a model is installed in Ollama (uses HTTP API)."""
    from src.ollama_manager import start_ollama_server
    start_ollama_server()
    try:
        import ollama
        response = ollama.list()
        models = getattr(response, 'models', []) or []
        model_names = [getattr(m, 'model', '') for m in models]
        installed = model_name in model_names
        print(json.dumps({"installed": installed, "model": model_name}))
    except Exception as e:
        print(json.dumps({"installed": False, "model": model_name, "error": str(e)}))


@cli.command()
def warmup():
    """Warm note-generation engine (starts Ollama + preloads model)."""
    if not OllamaSummarizer:
        print(json.dumps({"success": False, "error": "summarizer_unavailable"}))
        import sys
        sys.exit(1)
    try:
        os.environ["OPENSCRIBE_OLLAMA_WARMUP"] = "1"
        t0 = time.perf_counter()
        _ = OllamaSummarizer()
        elapsed = round(time.perf_counter() - t0, 2)
        print(json.dumps({"success": True, "warmed": True, "elapsed_s": elapsed}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        import sys
        sys.exit(1)


@cli.command()
def ollama_status():
    """Return Ollama health and most recent startup diagnostics."""
    from src.ollama_manager import (
        get_last_startup_report,
        get_ollama_binary_candidates,
        is_ollama_running,
    )

    payload = {
        "running": is_ollama_running(),
        "binary_candidates": [str(p) for p in get_ollama_binary_candidates()],
        "startup_report": get_last_startup_report(),
    }
    print(json.dumps(payload, indent=2))


@cli.command()
@click.argument('model_name')
def pull_model(model_name):
    """Download an Ollama model (uses HTTP API)."""
    from src.ollama_manager import start_ollama_server
    if not start_ollama_server():
        print(json.dumps({"success": False, "error": "Ollama server failed to start"}))
        import sys
        sys.exit(1)
    try:
        import ollama
        for progress in ollama.pull(model_name, stream=True):
            status = getattr(progress, 'status', '') or ''
            total = getattr(progress, 'total', 0) or 0
            completed = getattr(progress, 'completed', 0) or 0
            if total > 0:
                pct = int(completed / total * 100)
                print(f"{status} {pct}%", flush=True)
            elif status:
                print(status, flush=True)
        print(json.dumps({"success": True, "model": model_name}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        import sys
        sys.exit(1)


@cli.command()
def e2e_self_test():
    """Deterministic CI self-test for packaged backend integration."""
    if os.getenv("OPENSCRIBE_E2E_STUB_PIPELINE") != "1":
        print(json.dumps({"success": False, "error": "e2e_stub_pipeline_disabled"}))
        return

    recorder = SimpleRecorder()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    transcript_path = recorder.transcripts_dir / f"{timestamp}_e2e_transcript.txt"
    summary_path = recorder.output_dir / f"{timestamp}_e2e_summary.json"

    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    transcript_path.write_text("e2e deterministic transcript", encoding="utf-8")

    config = get_config()
    payload = {
        "session_info": {
            "name": "E2E Smoke",
            "processed_at": datetime.now().isoformat(),
            "summary_file": str(summary_path),
            "transcript_file": str(transcript_path),
        },
        "summary": "e2e deterministic summary",
        "participants": ["speaker-a", "speaker-b"],
        "key_points": ["pipeline_ok", "storage_ok"],
        "action_items": ["none"],
        "clinical_note": "e2e deterministic note",
        "transcript": "e2e deterministic transcript",
        "model": config.get_model(),
    }
    summary_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"success": True, "summary_file": str(summary_path), "transcript_file": str(transcript_path)}))


@cli.command(name='whisper-server')
@click.option('--host', default='127.0.0.1', show_default=True, help='Host to bind')
@click.option('--port', default=8002, show_default=True, type=int, help='Port to bind')
@click.option('--model', 'model_size', default='tiny.en', show_default=True, help='Whisper model size')
@click.option('--backend', default='cpp', show_default=True, help='Whisper backend preference')
def whisper_server(host, port, model_size, backend):
    """Run a local Whisper transcription server for mixed mode."""
    if not WhisperTranscriber:
        print("ERROR: Whisper transcriber unavailable")
        import sys
        sys.exit(1)

    try:
        from fastapi import FastAPI, File, Form, HTTPException, UploadFile
        from fastapi.responses import JSONResponse
        import uvicorn
    except Exception as e:
        print(f"ERROR: Missing server dependencies: {e}")
        print("Install with: python -m pip install fastapi uvicorn[standard] python-multipart")
        import sys
        sys.exit(1)

    os.environ["OPENSCRIBE_WHISPER_MODEL"] = model_size
    os.environ["OPENSCRIBE_WHISPER_BACKEND"] = backend
    os.environ.setdefault("OPENSCRIBE_WHISPER_GPU", "1")

    transcriber = WhisperTranscriber(model_size=model_size)
    app = FastAPI(title="OpenScribe Whisper Server")

    @app.get("/health")
    async def health():
        return {"status": "healthy", **transcriber.get_backend_info()}

    @app.post("/v1/audio/transcriptions")
    async def transcribe_audio(
        file: UploadFile = File(...),
        model: str | None = Form(default=None),
        response_format: str | None = Form(default="json"),
    ):
        del model
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty audio file")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)

        try:
            text = transcriber.transcribe_audio(tmp_path)
            if text is None:
                raise HTTPException(status_code=500, detail="Transcription failed")

            if response_format == "text":
                return text
            return JSONResponse(content={"text": text})
        finally:
            try:
                tmp_path.unlink()
            except Exception:
                pass

    print(f"Starting Whisper server on http://{host}:{port} (model={model_size}, backend={backend})")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == '__main__':
    cli()
