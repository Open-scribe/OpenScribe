# OpenScribe

## Project Overview

OpenScribe is a local first MIT license open source AI Medical Scribe that helps clinicians record patient encounters, transcribe audio, and generate structured draft clinical notes using LLMs. The tool stores all data locally by default.

- [Demo](https://www.loom.com/share/659d4f09fc814243addf8be64baf10aa)
- [Architecture](./architecture.md)
- [Contributing](./CONTRIBUTING.md)

## Quick Start (5 minutes)

### 1. Install Prerequisites

```bash
node --version  # Check you have Node.js 18+
# If not installed: brew install node if version < 18: brew upgrade node  (macOS) or download latest from nodejs.org
npm install -g pnpm
```

### 2. Clone and Install

```bash
git clone https://github.com/sammargolis/OpenScribe.git
cd OpenScribe
pnpm install
```

### 3. Configure Environment

```bash
pnpm setup  # Auto-generates .env.local with secure storage key
```

Edit `apps/web/.env.local` and add your API keys:

```bash
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
# NEXT_PUBLIC_SECURE_STORAGE_KEY is auto-generated, don't modify
```

### 4. Start the App

```bash
pnpm dev          # Web app → http://localhost:3001
pnpm dev:desktop  # OR desktop app (Electron)
```

### FYI Getting API Keys

**OpenAI** (transcription): [platform.openai.com/api-keys](https://platform.openai.com/api-keys) - Sign up → API Keys → Create new secret key

**Anthropic** (note generation): [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) - Sign up → API Keys → Create Key

Both services offer $5 free credits for new accounts

### Staying Updated

```bash
git pull origin main  # Pull latest changes
pnpm install          # Update dependencies

# If you encounter issues after updating:
rm -rf node_modules pnpm-lock.yaml && pnpm install
```

---

## Demo

[Demo](https://www.loom.com/share/659d4f09fc814243addf8be64baf10aa)

[![Watch Demo](.github/demo.png)](https://www.loom.com/share/659d4f09fc814243addf8be64baf10aa)


## Purpose and Philosophy

OpenScribe exists to provide a simple, open-source alternative to cloud dependent clinical documentation tools. The project is built on core principles:

- **Local-first**: All data (audio recordings, transcripts, notes) is stored locally in the browser by default
- **Privacy-conscious**: No data collection, no analytics, no cloud dependency unless explicitly configured by the user
- **Modular**: Components can be swapped or extended (e.g., different LLM providers, transcription services)

## Project Resources

- **GitHub**: [sammargolis/OpenScribe](https://github.com/sammargolis/OpenScribe)
- **Project Board**: [Trello](https://trello.com/b/9ytGVZU4/openscribe)
- **Maintainer**: [@sammargolis](https://github.com/sammargolis)
- **Architecture**: [architecture.md](./architecture.md)
- **Tests**: [packages/llm](./packages/llm/src/__tests__/), [packages/pipeline](./packages/pipeline/)

## Roadmap

### Current Status (v0)
- Core recording, transcription, and note generation
- AES-GCM encrypted local storage
- Browser-based audio capture

### Near-term (v0.1-0.5)
- Error handling improvements
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
- Mobile app
- EHR integration
- RCM integration

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
- **Transcription**: OpenAI Whisper API
- **LLM**: Provider-agnostic client (defaults to Anthropic Claude via `packages/llm`)
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

## Privacy & Data Handling

**Storage**: AES-GCM encrypted localStorage. Audio processed in-memory, not persisted.  
**Transmission**: All external API calls (audio → Whisper API, transcripts → Anthropic Claude) use HTTPS/TLS encryption. The application enforces HTTPS-only connections and displays a security warning if accessed over HTTP in production builds.  
**No Tracking**: Zero analytics, telemetry, or cloud sync

**Use Responsibility**  
- All AI notes are drafts requiring review
- Ensure regulatory compliance for your use case
- For production deployments serving PHI, ensure the application is accessed via HTTPS or served from localhost only

## Limitations & Disclaimers
 
**HIPAA Compliance**: Self hosted users ensure their own compliance  
**No EHR Integration**: Standalone tool  
**Browser Storage Limits**: ~5-10MB typical  
**No Warranty**: Provided as-is under MIT License

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

**Quick Start:**
1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a PR

Check the [Trello board](https://trello.com/b/9ytGVZU4/openscribe) for current priorities.

## License

MIT

```
MIT License

Copyright (c) 2026 Sam Margolis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Citation

```
OpenScribe
GitHub: https://github.com/sammargolis/OpenScribe
Maintainer: Sam Margolis (@sammargolis)
```
