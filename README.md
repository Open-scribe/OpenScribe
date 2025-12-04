# OpenScribe

## Project Overview

OpenScribe is a privacy-conscious, local-first clinical documentation assistant that helps clinicians record patient encounters, transcribe audio with Whisper, and generate structured draft clinical notes using LLMs. The tool stores all data locally by default and requires explicit clinician review and approval before any note can be used. **All AI-generated output is draft-only and must be reviewed by a licensed clinician who accepts full responsibility for accuracy and completeness.**

## Purpose and Philosophy

OpenScribe exists to provide a simple, modular, privacy-conscious alternative to cloud-dependent clinical documentation tools. The project is built on core principles:

- **Local-first**: All data (audio recordings, transcripts, notes) is stored locally in the browser by default
- **Privacy-conscious**: No data collection, no analytics, no cloud dependency unless explicitly configured by the user
- **Modular**: Components can be swapped or extended (e.g., different LLM providers, transcription services)
- **Transparent**: Clear boundaries between AI assistance and clinician responsibility

The tool is designed for clinicians who want AI assistance without surrendering control of their data or workflow to third-party services.

## Feature Summary (Current)

The following features are implemented in v0:

- ✅ **Encounter Management**: Create new patient encounters with patient name, ID, and visit reason
- ✅ **Audio Recording**: Browser-based audio recording with pause/resume functionality
- ✅ **Transcription**: Audio-to-text transcription (currently simulated, designed for Whisper API integration)
- ✅ **Note Generation**: Automatic generation of structured clinical notes from transcripts using GPT-4o
- ✅ **Editable Draft Notes**: Structured note editor with sections (Chief Complaint, HPI, ROS, Physical Exam, Assessment, Plan)
- ✅ **Local Storage**: All encounters stored in browser localStorage (no server required)
- ✅ **Simple UI**: Left-hand sidebar with encounter history, right-hand side for workflow
- ✅ **Export/Copy**: Copy notes to clipboard or export as text files

## Demo or Screenshots

*[Add GIF or screenshots showing: encounter list, recording state, note generation state, and note editor]*

## Roadmap

### v0 (Current)
- Core recording and transcription workflow
- Basic note generation
- Local storage
- Simple UI

### v0.1 (Planned Fixes)
- Real Whisper API integration (currently simulated)
- Error handling improvements
- Audio playback for review
- Better transcription accuracy feedback

### v1 (Future Goals)
- Multiple LLM provider support (Anthropic, local models)
- Custom note templates
- Search and filtering for encounters
- Export to common formats (PDF, DOCX)
- Optional cloud sync (user-controlled)
- Multi-language support

### Non-Goals
- EHR integration (out of scope)
- Real-time collaboration
- Mobile app (web-first)
- HIPAA compliance certification (users must ensure their own compliance)
- Medical device classification (documentation tool only)

## Architecture Overview

OpenScribe is built as a Next.js application with the following components:

```
┌─────────────────────────────────────────────────────────┐
│                    UI Client (Next.js)                  │
│  ┌──────────────┐              ┌─────────────────────┐  │
│  │ Encounter   │              │  Workflow Views     │  │
│  │ List        │              │  - Idle             │  │
│  │ (LHS)       │              │  - Recording        │  │
│  │             │              │  - Processing       │  │
│  │             │              │  - Note Editor      │  │
│  └──────────────┘              └─────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Audio Pipeline (Browser)                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  MediaRecorder API → Audio Blob → Server Action  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Backend Service (Next.js Server)           │
│  ┌──────────────┐              ┌──────────────────┐   │
│  │ Whisper      │              │  LLM Module      │   │
│  │ Module       │              │  (OpenAI GPT-4o) │   │
│  │ (Planned)    │              │                  │   │
│  └──────────────┘              └──────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Storage Model (Browser localStorage)        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Encounters: {                                   │   │
│  │    id, patient_name, patient_id,                │   │
│  │    transcript_text, note_text,                   │   │
│  │    status, created_at, updated_at                │   │
│  │  }                                               │   │
│  │  Audio: Stored as Blob (in-memory only)         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key Components:**

- **UI Client**: React components managing state and user interactions
- **Audio Pipeline**: Browser MediaRecorder API captures audio, converts to Blob
- **Whisper Module**: Transcription service (currently simulated, designed for OpenAI Whisper API)
- **LLM Module**: OpenAI GPT-4o generates structured clinical notes from transcripts
- **Storage Model**: Browser localStorage stores encounter metadata; audio blobs are kept in-memory during processing

## Installation

### Prerequisites

- **Node.js**: v18 or higher
- **pnpm**: Package manager (install via `npm install -g pnpm` or use Corepack)
- **OpenAI API Key**: Required for note generation (optional for development with simulated transcription)

### Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd OpenScribe
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run the development server**
   ```bash
   pnpm dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:3000`

5. **Configure API key** (optional for development)
   - Click the settings icon in the UI
   - Enter your OpenAI API key
   - The key is stored locally in browser localStorage

## Configuration

### LLM Endpoint and API Key

- **Provider**: OpenAI (GPT-4o)
- **Configuration**: Set via UI dialog (stored in `localStorage` as `openai_api_key`)
- **Fallback**: If no API key is provided, the app attempts to use AI Gateway (may not work in all environments)
- **Location**: Stored client-side only, never transmitted except to OpenAI API

### Whisper Mode

- **Current Status**: Simulated (returns sample transcript)
- **Planned**: OpenAI Whisper API integration
- **Future**: Support for local Whisper models
- **Configuration**: Will be configurable via UI settings

### Audio Input Device

- **Default**: Browser's default microphone
- **Selection**: Managed by browser's `getUserMedia()` API
- **Settings**: Can be changed via browser/system audio settings
- **Format**: WebM or MP4 (browser-dependent)
- **Sample Rate**: 16kHz (optimized for speech recognition)

### Storage Directory

- **Location**: Browser `localStorage` (client-side only)
- **Key**: `openscribe_encounters`
- **Format**: JSON array of encounter objects
- **Limitations**: 
  - Browser storage limits (typically 5-10MB)
  - Audio blobs are not persisted (in-memory only during processing)
  - Data is browser-specific (not synced across devices)

## Usage Guide

### 1. Create New Encounter

1. Click the microphone button on the idle screen (or "New Encounter" in the sidebar)
2. Fill in the form:
   - Patient Name
   - Patient ID (optional)
   - Visit Reason
3. Click "Start Recording"

### 2. Start Recording

1. Grant microphone permissions when prompted
2. Recording begins automatically
3. Use pause/resume button to control recording
4. Monitor recording duration in real-time

### 3. End Recording

1. Click "End Interview" button
2. Recording stops and processing begins
3. Audio is processed for transcription

### 4. View Transcription

1. After transcription completes, the transcript is available
2. Currently shown in the processing view (will be accessible in note editor in future versions)

### 5. View and Edit Note

1. After note generation completes, the note editor opens automatically
2. Review the AI-generated draft note
3. Edit any section using the tabbed interface:
   - **CC**: Chief Complaint
   - **HPI**: History of Present Illness
   - **ROS**: Review of Systems
   - **PE**: Physical Exam
   - **Assessment**: Clinical Assessment
   - **Plan**: Treatment Plan
4. Click "Save" to persist changes

### 6. Copy/Export Note

1. **Copy**: Click the copy icon to copy the full note to clipboard
2. **Export**: Click the download icon to export as a `.txt` file
3. File naming: `{patient_name}_{date}.txt`

## Data Handling and Privacy

### Data Storage

- **Default**: All data stored locally in browser `localStorage`
- **Audio**: Processed in-memory, not persisted to disk
- **Transcripts**: Stored as plain text in `localStorage`
- **Notes**: Stored as plain text in `localStorage`

### Data Transmission

- **Audio**: Sent to Whisper API (when implemented) for transcription only
- **Transcripts**: Sent to OpenAI API for note generation only
- **No Analytics**: No tracking, analytics, or telemetry
- **No Cloud Sync**: No automatic cloud backup or sync (unless user explicitly configures)

### Privacy Guarantees

- ✅ No data collection by the application
- ✅ No third-party analytics
- ✅ API keys stored locally only
- ✅ All processing happens on user's device or explicitly configured APIs
- ⚠️ **User Responsibility**: Users must ensure their own HIPAA compliance and data handling requirements

### Clinician Responsibility

- **Review Required**: All AI-generated notes are drafts requiring clinician review
- **Accuracy**: Clinician accepts full responsibility for note accuracy and completeness
- **Legal**: Notes must meet local documentation requirements
- **Compliance**: Users must ensure their use complies with applicable regulations (HIPAA, GDPR, etc.)

## Limitations and Disclaimers

### Output Limitations

- **Draft Only**: All AI-generated notes are drafts and must be reviewed
- **No Guarantee**: No guarantee of accuracy, completeness, or clinical correctness
- **Context Limited**: AI only sees the transcript, not full patient history or context

### Scope Limitations

- **Not an EHR**: Does not replace Electronic Health Records systems
- **Not a Medical Device**: Documentation tool only, not intended for diagnosis or treatment decisions
- **Not HIPAA Certified**: Users must ensure their own compliance
- **No Integration**: Does not integrate with existing EHR or practice management systems

### Technical Limitations

- **Browser Storage**: Limited by browser storage quotas
- **Audio Persistence**: Audio recordings not persisted (in-memory only)
- **Single User**: No multi-user or collaboration features
- **No Offline Mode**: Requires internet for API calls (when configured)

### Legal Disclaimers

- **No Medical Advice**: This tool does not provide medical advice
- **No Warranty**: Provided "as-is" without warranty
- **User Liability**: Users are solely responsible for their use of this tool
- **Regulatory Compliance**: Users must ensure compliance with all applicable laws and regulations

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

### Quick Start for Contributors

1. **Open Issues**: Use GitHub Issues to report bugs or propose features
2. **Branch Naming**: Use descriptive branch names (e.g., `feature/whisper-integration`, `fix/audio-recording`)
3. **Coding Standards**: 
   - TypeScript for all code
   - Follow existing code style
   - Add types for all functions and components
4. **Propose Features**: Open a discussion or issue before major changes

### Areas Needing Contribution

- Whisper API integration
- Error handling improvements
- Testing infrastructure
- Documentation improvements
- Accessibility enhancements
- Multi-language support

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) file for details.

The MIT License allows for:
- Commercial use
- Modification
- Distribution
- Private use

With the conditions:
- License and copyright notice must be included
- No liability or warranty provided

## Citation / Attribution

If you use OpenScribe in research or academic work, please cite:

```
OpenScribe: A Privacy-Conscious Clinical Documentation Assistant
https://github.com/sammargolis/OpenScribe
```

For derivative works or forks, please maintain attribution to the original project.

## Maintainers and Contact

- **Maintainer**: [Your GitHub Handle]
- **GitHub**: [https://github.com/sammargolis](https://github.com/sammargolis)
- **Issues**: [https://github.com/your-org/OpenScribe/issues](https://github.com/sammargolis/OpenScribe/issues)
- **Discussions**: [https://github.com/your-org/OpenScribe/discussions](https://github.com/sammargolis/OpenScribe/discussions)

For questions, bug reports, or feature requests, please use GitHub Issues or Discussions.

---

**Important**: This tool generates draft clinical notes that require review by a licensed clinician. The clinician accepts full responsibility for the accuracy and completeness of all documentation produced using this tool.
