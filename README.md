# OpenScribe

## Project Overview

OpenScribe is a privacy-conscious, local-first AI Scribe that helps clinicians record patient encounters, transcribe audio, and generate structured draft clinical notes using LLMs. The tool stores all data locally by default and requires explicit clinician review and approval before any note can be used. **All AI-generated output is draft-only and must be reviewed by a licensed clinician who accepts full responsibility for accuracy and completeness.**

## Purpose and Philosophy

OpenScribe exists to provide a simple, modular, privacy-conscious alternative to cloud-dependent clinical documentation tools. The project is built on core principles:

- **Local-first**: All data (audio recordings, transcripts, notes) is stored locally in the browser by default
- **Privacy-conscious**: No data collection, no analytics, no cloud dependency unless explicitly configured by the user
- **Modular**: Components can be swapped or extended (e.g., different LLM providers, transcription services)
- **Transparent**: Clear boundaries between AI assistance and clinician responsibility

## Project Resources

- **GitHub**: [sammargolis/OpenScribe](https://github.com/sammargolis/OpenScribe)
- **Project Board**: [Trello](https://trello.com/b/9ytGVZU4/openscribe)
- **Maintainer**: [@sammargolis](https://github.com/sammargolis)
- **Architecture**: [architecture.md](./architecture.md)
- **Tests**: [packages/llm](./packages/llm/src/__tests__/), [packages/pipeline](./packages/pipeline/)

## Features

- ✅ Record patient encounters with pause/resume
- ✅ Audio transcription (Whisper API integration planned)
- ✅ AI-generated structured notes (GPT-4o)
- ✅ Editable note sections (CC, HPI, ROS, PE, Assessment, Plan)
- ✅ AES-GCM encrypted local storage
- ✅ Export to clipboard or text files

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- OpenAI API key (for note generation)

### Installation

```bash
git clone https://github.com/sammargolis/OpenScribe.git
cd OpenScribe
pnpm install
pnpm dev
```

Open `http://localhost:3000`

### Environment Variables

Create `apps/web/.env.local`:

```
OPENAI_API_KEY=your-key-here
NEXT_PUBLIC_SECURE_STORAGE_KEY=<base64-encoded-32-bytes>
```

Generate the storage key: `openssl rand -base64 32`

## Roadmap

### Current Status (v0)
- ✅ Core recording, transcription, and note generation
- ✅ AES-GCM encrypted local storage
- ✅ Browser-based audio capture
- 🔄 Simulated transcription (Whisper API integration in progress)

### Near-term (v0.1-0.5)
- Real Whisper API integration
- Error handling improvements
- Audio playback for review
- Comprehensive test coverage
- Basic audit logging


**Physical Controls**:
- User responsibility (device security, physical access)

See the [Trello board](https://trello.com/b/9ytGVZU4/openscribe) for detailed progress.

### Future Goals (v2.0+)
- Multiple LLM providers (Anthropic, local models)
- Custom note templates
- Optional cloud sync (user-controlled)
- Multi-language support
- mobile app
- EHR integration

## Architecture

See [architecture.md](./architecture.md) for complete details.

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (Next.js)                   │
│  ┌──────────────┐              ┌─────────────────────┐  │
│  │ Encounter    │              │  Workflow States    │  │
│  │ Sidebar      │◄────────────►│  - Idle             │  │
│  │              │              │  - Recording        │  │
│  │              │              │  - Processing       │  │
│  │              │              │  - Note Editor      │  │
│  └──────────────┘              └─────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Processing Pipeline                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────┐  │
│  │  Audio   │──►│Transcribe│──►│   LLM    │──►│Note │  │
│  │  Ingest  │   │ (Whisper)│   │          │   │Core │  │
│  └──────────┘   └──────────┘   └──────────┘   └─────┘  │
│       │                                           │     │
│       └───────────────┐         ┌─────────────────┘     │
└───────────────────────┼─────────┼───────────────────────┘
                        ▼         ▼
┌─────────────────────────────────────────────────────────┐
│                  Storage Layer                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Encrypted LocalStorage (AES-GCM)                │   │
│  │  - Encounters (patient data, transcripts, notes) │   │
│  │  - Metadata (timestamps, status)                 │   │
│  │  - Audio (in-memory only, not persisted)        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key Components:**
- **UI Layer**: React components in `apps/web/` using Next.js App Router
- **Audio Ingest**: Browser MediaRecorder API → WebM/MP4 blob
- **Transcription**: OpenAI Whisper API (currently simulated)
- **LLM**: OpenAI GPT-4o via provider-agnostic client
- **Note Core**: Structured clinical note generation and validation
- **Storage**: AES-GCM encrypted browser localStorage

**Monorepo Structure:**
- `apps/web/` – Next.js frontend + Electron renderer
- `packages/pipeline/` – Audio ingest, transcription, assembly, evaluation
- `packages/ui/` – Shared React components
- `packages/storage/` – Encrypted storage + encounter management
- `packages/llm/` – Provider-agnostic LLM client
- `packages/shell/` – Electron main process
- `config/` – Shared configuration files
- `build/` – Build artifacts

## macOS Desktop App

Run the Electron wrapper in development:

```bash
pnpm dev:desktop
```

Build a production `.app` and `.dmg`:

```bash
pnpm build:desktop
```

Output: `dist/OpenScribe.app`, `dist/OpenScribe-0.1.0-arm64.dmg`

## Usage

1. **Create Encounter**: Click microphone button, enter patient info, start recording
2. **Record Audio**: Pause/resume as needed, monitor duration
3. **End Recording**: Processing generates transcript and note
4. **Edit Note**: Review AI draft, edit sections (CC, HPI, ROS, PE, Assessment, Plan)
5. **Export**: Copy to clipboard or download as `.txt`

## Privacy & Data Handling

**Storage**: AES-GCM encrypted localStorage. Audio processed in-memory, not persisted.  
**Transmission**: Audio → Whisper API, Transcripts → OpenAI API (note generation only)  
**No Tracking**: Zero analytics, telemetry, or cloud sync

⚠️ **HIPAA Status**: OpenScribe is **NOT currently HIPAA compliant**. See [Roadmap](#roadmap) for compliance path.

⚠️ **Clinician Responsibility**  
- All AI notes are drafts requiring review
- You accept full responsibility for accuracy and completeness
- Do not use with PHI until HIPAA compliance is achieved
- Ensure regulatory compliance for your use case

## Limitations & Disclaimers

**Not a Medical Device**: Documentation tool only, not for diagnosis or treatment  
**Not HIPAA Certified**: Users ensure their own compliance  
**No EHR Integration**: Standalone tool  
**Browser Storage Limits**: ~5-10MB typical  
**No Warranty**: Provided as-is under MIT License

This tool does not provide medical advice. Users are solely responsible for regulatory compliance and clinical accuracy.

## Contributing

Contributions welcome! Check the [Trello board](https://trello.com/b/9ytGVZU4/openscribe) for current tasks.

**How to Contribute:**
1. Open a GitHub issue or discussion first
2. Fork and create a descriptive branch (`feature/whisper-integration`)
3. Use TypeScript with full type annotations
4. Follow existing code style
5. Submit a PR

**Priority Areas**: Whisper integration, error handling, testing, accessibility, documentation

## License

MIT License - see [LICENSE](LICENSE) for details.

Free for commercial use, modification, distribution, and private use. No warranty provided.

## Citation

```
OpenScribe: A Privacy-Conscious Clinical Documentation Assistant
GitHub: https://github.com/sammargolis/OpenScribe
Maintainer: Sam Margolis (@sammargolis)
```

---

**⚠️ Important**: AI-generated notes require review by a licensed clinician who accepts full responsibility for accuracy and completeness.
