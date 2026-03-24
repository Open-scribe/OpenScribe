# Download and Use OpenScribe Desktop

Use this if you want to install and run OpenScribe without cloning the repo.

## 1. Download the Installer
- Open the latest release page: `https://github.com/sammargolis/OpenScribe/releases/latest`
- Download the file that matches your OS:
  - macOS Apple Silicon: `OpenScribe-<version>-arm64.dmg`
  - macOS Intel: `OpenScribe-<version>.dmg` (x64)
  - Windows x64: `OpenScribe Setup <version>.exe`
  - Linux x64: `OpenScribe-<version>.AppImage` or `.deb`
  - Linux arm64: `OpenScribe-<version>-arm64.AppImage` or `.deb`

## 2. Install
- macOS: open `.dmg`, drag OpenScribe to Applications.
- Windows: run `.exe`, complete installer wizard.
- Linux AppImage: `chmod +x OpenScribe-*.AppImage` then run it.
- Linux deb: `sudo dpkg -i OpenScribe-*.deb`.

## 3. First Launch and Setup
- Open OpenScribe and allow microphone permission when prompted.
- Complete the first-run setup wizard:
  - runtime checks
  - local Whisper setup
  - curated local model selection
  - model download with progress
- Keep mixed mode as the default if you have cloud keys; switch to local-only after setup if preferred.

## 4. Basic Validation After Install
- Start a short recording.
- Stop recording and confirm transcription appears.
- Generate a note and verify output is saved in encounter history.
- Restart the app and confirm your selected model persists.

## 5. Troubleshooting
- If setup fails during model download, retry from the setup screen.
- If audio fails, re-check microphone permission in OS settings and relaunch.
- If startup is slow on first run, wait for model warmup and retry once.
