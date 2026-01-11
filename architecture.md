# OpenScribe Architecture

This document describes how the repository is structured today, why each
folder exists, and where new code should live as the system grows.

---

## Top-Level Layout

| Path | Purpose |
| --- | --- |
| `apps/` | Runtime entry points (Next.js, future apps). Each subfolder is an independently deployable UI or service. |
| `packages/` | Reusable domain modules shared across apps. Every non-Next TypeScript package lives here. |
| `config/` | Centralized tool configuration (Next, PostCSS, TypeScript test config, shadcn). Apps import from here. |
| `build/` | The **only** location for generated artifacts (Next standalone output, packaged binaries, compiled tests, etc.). Safe to delete between builds. |
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `.env*` | Root-level project metadata and shared TypeScript config. |

No other source files should sit at the root—add them to the appropriate
`apps/` or `packages/` subtree.

---

## apps/

### `apps/web`

* Next.js (App Router) implementation of OpenScribe.
* Directory tree:

  ```
  apps/web/
    .env.local              # app-specific secrets (OPENAI_API_KEY, NEXT_PUBLIC_SECURE_STORAGE_KEY)
    next-env.d.ts
    next.config.mjs         # re-exports config/next.config.mjs
    postcss.config.mjs      # re-exports config/postcss.config.mjs
    tailwind.config.ts      # Tailwind v4 config (scans app + packages)
    src/
      app/                  # routes, layouts, server actions, CSS entry point
      middleware.ts
      types/
    public/                 # images, icons, worklets
  ```

* All UI composition, routing, and server actions belong here.
* Future web-only features (e.g., marketing pages, admin panels) can live
  inside `apps/web/src/app`.
* If another frontend appears (mobile/desktop), add another folder under
  `apps/` and import the same packages.

---

## packages/

The `packages/` directory acts like a pnpm workspace. Each folder hosts an
isolated TypeScript package with its own `src/` tree. Path aliases defined in
`tsconfig.json` (e.g., `@audio`, `@storage`, `@ui`) map into these packages,
so apps can import domain logic without relative paths.

### `packages/pipeline`

Ordered processing stages that reflect the end-to-end workflow. Every stage
exposes a small API/contract so it can be tested and swapped individually.

```
packages/pipeline/
  audio-ingest/
  transcribe/
  assemble/
  note-core/
  render/
  eval/
```

* **audio-ingest** – microphone/system audio capture hooks, resamplers,
  worklets, permission helpers.
* **transcribe** – Whisper adapters, segment uploader hook, WAV parsing.
* **assemble** – streaming session store, SSE helpers, overlap
  trimming, diarization scaffolding.
* **note-core** – markdown-based clinical note generation using templates,
  parsing/formatting logic, LLM orchestration (calls into `@llm`).
  Uses `.md` templates for easy customization.
* **render** – React components for presenting structured notes and
  exporters (SOAP renderer, specialty variants).
* **eval** – regression/evaluation harness plus anonymized fixtures and
  test cases (`pnpm test:audio` compiles this package).

When expanding the pipeline (e.g., add “07_quality_control” or “08_storage”),
create another subdirectory and add a new path alias if needed.
#### Customizing Clinical Note Templates

Contributors can customize note formats by editing markdown templates in
`packages/llm/src/prompts/clinical-note/templates/`:

* `default.md` – Standard clinical note (Chief Complaint, HPI, ROS, PE, Assessment, Plan)
* `soap.md` – SOAP note format (Subjective/Objective/Assessment/Plan)

To add a custom template:
1. Create `packages/llm/src/prompts/clinical-note/templates/my-template.md`
2. Add to `templates/index.ts`: `export function getMyTemplate(): string { return loadTemplate('my-template') }`
3. Use in note generation:
   ```typescript
   await createClinicalNoteText({
     transcript,
     patient_name,
     visit_reason,
     template: 'my-template'
   })
   ```

No JSON schemas or TypeScript interfaces required—just edit the markdown structure.
See [MIGRATION_MARKDOWN.md](MIGRATION_MARKDOWN.md) for complete migration details.
### `packages/ui`

Reusable React components, hooks, and UI utilities consumed by the apps.
Examples: encounter list, recording view, shared buttons, Radix wrappers,
`useEncounters` hook. UI-only work that is not tied to Next-specific routing
belongs here so other apps (Electron, mobile) can reuse it.

### `packages/storage`

Secure storage utilities and repositories:

* `secure-storage.ts` – AES-GCM helpers (requires `NEXT_PUBLIC_SECURE_STORAGE_KEY`).
* `encounters.ts` – CRUD helpers for encounter objects.
* `types.ts` – domain types shared between frontend and backend.

Future persistence layers (SQLite, filesystem, remote sync) can live alongside
the current browser implementation; apps keep importing `@storage/*`.

### `packages/llm`

Provider-agnostic LLM abstraction plus versioned prompt templates.
Today it exposes a thin wrapper around Anthropic Claude via `runLLMRequest`,
and includes markdown-based clinical note templates in
`src/prompts/clinical-note/templates/`. Contributors can customize note
formats by editing `.md` template files without touching code.

Future expansion:
* Additional providers (OpenAI, Azure, local models).
* More template variants (SOAP, DAP, specialty-specific).
* Retry/rate-limiting/shared logging for LLM calls.

### `packages/shell`

Electron "main" process, preload scripts, IPC contracts, desktop packaging
scripts (`scripts/prepare-next.js`, `next-server.js`). When the desktop app
gains new OS integrations (screen capture, auto-update, etc.), the code lives
here. Renderer UI should continue to import from `packages/ui`/pipeline rather
than duplicating logic.

#### Desktop Build: node_modules Workaround

**Problem**: electron-builder has a known issue ([#3104](https://github.com/electron-userland/electron-builder/issues/3104))
where it ignores directories named `node_modules` in `extraResources`, even when
explicitly configured. This caused the packaged Electron app to be missing the
Next.js standalone `node_modules`, resulting in "Next.js server did not start
after 20s" errors.

**Solution**: A rename workaround implemented across three files:

1. **`packages/shell/scripts/prepare-next.js` (lines 35-47)**
   During build (`pnpm build:desktop`), this script renames
   `apps/web/.next/standalone/node_modules` → `_node_modules` BEFORE
   electron-builder packages the app. electron-builder successfully copies
   `_node_modules` since it doesn't trigger the ignore pattern.

2. **`packages/shell/next-server.js` (lines 17-41)**
   At runtime when the app launches, `resolveStandaloneDir()` checks if
   `_node_modules` exists and renames it back to `node_modules` so the Next.js
   server can find its dependencies.

3. **`.electronignore`**
   Created to provide more specific ignore rules for electron-builder (ignores
   root `/node_modules` but not nested ones).

**Build Flow**:
```
pnpm build:desktop
  ↓
Next.js creates standalone output with node_modules
  ↓
prepare-next.js renames: node_modules → _node_modules
  ↓
electron-builder packages everything (including _node_modules)
  ↓
DMG/ZIP/App created successfully
```

**Runtime Flow**:
```
User launches OpenScribe.app
  ↓
main.js runs → next-server.js calls resolveStandaloneDir()
  ↓
Detects _node_modules exists, renames to node_modules (once)
  ↓
Next.js server starts successfully with proper dependencies
  ↓
App window loads
```

**Why This Works Long-Term**:
- The workaround is automatic—no manual steps needed for each build
- Every `pnpm build:desktop` applies the rename during `prepare-next.js`
- Every app launch restores `node_modules` at runtime (idempotent, safe)
- Documented with code comments referencing electron-builder issue #3104
- If electron-builder ever fixes the issue, the runtime rename becomes a no-op

### `packages/tests`

Placeholder for shared test harnesses outside the pipeline packages. Use this
when introducing cross-cutting integration tests, mocks, or helpers that are
not tied to a specific pipeline stage.

---

## config/

Holds all shared tool configuration. Current files:

* `next.config.mjs` – base Next configuration (CSP, headers, standalone
  output inside `apps/web/.next`).
* `postcss.config.mjs` – Tailwind v4 plugin setup.
* `tsconfig.test.json` – TypeScript config used by `pnpm build:test`.
* `components.json` – shadcn UI CLI settings (points to `@ui` aliases).

Add future configs (ESLint, Jest/Vitest, Storybook) here and have apps import
them via small stubs (similar to `apps/web/next.config.mjs`).

---

## build/

Generated artifacts only. Expected subfolders:

* `build/tests-dist/` – compiled test sources (`pnpm build:test`).
* `build/dist/` – packaged binaries (Electron DMG/ZIP) when running
  `pnpm build:desktop`.

Next.js generates its standalone bundle under `apps/web/.next` (ignored by Git),
so it no longer sits inside `build/`.

To smoke test the standalone server without packaging the Electron app:

```
pnpm build
node packages/shell/scripts/prepare-next.js
PORT=4123 node apps/web/.next/standalone/apps/web/server.js
```

Then curl a static asset (e.g. `curl -I http://127.0.0.1:4123/_next/static/css/<file>.css`)
to confirm Next is serving files correctly before running `pnpm build:desktop`.

This directory should be safe to delete at any time and is git-ignored.

---

## TypeScript Configuration

* Root `tsconfig.json` sets `baseUrl` and the aliases for every package
  (`@audio`, `@transcription`, `@storage`, `@ui`, etc.). Apps inherit from
  this file.
* `apps/web/tsconfig.json` extends the root config and only overrides
  `baseUrl`/paths for `@/*` so Next.js tooling works locally.
* Tests compile using `config/tsconfig.test.json`, which emits to
  `build/tests-dist`.

---

## Environment Variables

* App-specific secrets live in `apps/web/.env.local` (ignored by Git). For
  example:
  ```
  OPENAI_API_KEY=...
  NEXT_PUBLIC_SECURE_STORAGE_KEY=base64-32-byte-secret
  ```
* Provide defaults/template via `apps/web/.env.local.example`.
* Future apps should follow the same pattern (keep `.env.local` next to the
  app, not at the repo root).

---

## Security & HIPAA Compliance

### Encryption in Transit (TLS/HTTPS)

**Requirement**: All external API calls transmitting PHI must use HTTPS to ensure data is encrypted during transmission.

**Implementation**:

1. **External API Enforcement**:
   - Whisper transcription API (`packages/pipeline/transcribe/src/providers/whisper-transcriber.ts`) validates HTTPS before sending audio data
   - LLM API client (`packages/llm/src/index.ts`) validates HTTPS before sending transcript data
   - Both services reject non-HTTPS URLs with explicit security errors

2. **Production UI Warning**:
   - The application displays a security banner if accessed over HTTP in production builds (non-localhost)
   - Warning implemented via `useHttpsWarning` hook (`packages/ui/src/hooks/use-https-warning.ts`)
   - Development builds skip this check for local testing convenience

3. **Testing**:
   - Unit tests verify HTTPS enforcement in `packages/pipeline/transcribe/src/__tests__/transcribe.test.ts`
   - Integration tests validate HTTPS usage in `packages/llm/src/__tests__/llm-integration.test.ts`

**Deployment Recommendations**:
- **Desktop app (Electron)**: Automatically uses `localhost` (HTTPS not required for local IPC)
- **Self-hosted web**: Configure reverse proxy (nginx/Apache) with TLS certificates
- **Development**: HTTP on localhost is acceptable (PHI stays local)
- **Production web**: Always serve via HTTPS or block non-localhost access

For complete security implementation details, see [ENCRYPTION-GUIDE.md](ENCRYPTION-GUIDE.md) and [HIPAA-SECURITY-GAPS.md](HIPAA-SECURITY-GAPS.md).

---

## Naming & Linting Rules

These conventions are enforced by ESLint (`pnpm lint`) and the structure check (`pnpm lint:structure`):

- **Folders** – always kebab-case (`audio-ingest`, `note-core`). Pipeline stages must use the numbered order shown earlier (`audio-ingest`, `transcribe`, `assemble`, `note-core`, `render`, `eval`).
- **Source files** – kebab-case as well (`note-editor.tsx`, `secure-storage.ts`). Generated files belong in `build/`.
- **React components/classes/exported functions** – PascalCase (`NoteEditor`, `BadgeVariants`, `ButtonVariants`).
- **Config files** – live under `config/` and end in `.config.mjs` when the tool allows it. App-level stubs simply re-export from `config/`.
- **Top-level allowlist** – only `apps/`, `packages/`, `config/`, `build/`, `node_modules/`, and the root metadata files (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `.env*`). Everything else should move into an app/package.
- **ESLint ignores** – `build/**` and `apps/web/public/**` are ignored, so never put source there. If you need to add a new generated directory, point it into `build/`.

Breaking these rules causes CI/local `pnpm lint` to fail, so prefer renaming/moving files before adding exceptions.

---

## Adding New Functionality

1. Decide whether it is **app-specific** or **shared**.
   * App UI, routing, server actions → `apps/<app-name>/src/...`
   * Shared React components/hooks → `packages/ui`
   * Pipeline/domain logic → the appropriate `packages/pipeline/0x_*`
   * Persistence → `packages/storage`
   * LLM providers/prompts → `packages/llm`
   * Desktop-only features → `packages/shell`
2. Update aliases in `tsconfig.json` if a new package is added.
3. Keep generated assets confined to `build/`.

By following this structure, the project stays modular: each domain evolves in
its own package, apps consume those packages, and tooling sits in `config/`.

---

## Quick Reference: Where to Edit

This section provides a practical guide for day-to-day development work.

### Primary Development Locations

**`apps/web/src/app/page.tsx`** ⭐⭐⭐  
Main application orchestrator (~570 lines)
- State management and workflow logic
- View transitions (idle → recording → processing → viewing)
- Integration point for all UI components
- Edit when: changing app behavior, adding features, fixing workflow bugs

**`apps/web/src/app/actions.ts`**  
Server-side functions
- Clinical note generation endpoint
- Edit when: changing server-side logic, note generation flow

**`apps/web/src/app/api/`**  
Next.js API routes
- `settings/api-keys/` - API key management
- `transcription/segment/` - Segment uploads
- `transcription/final/` - Final transcription
- `transcription/stream/[sessionId]/` - SSE streaming
- Edit when: changing API endpoints, adding new routes

**`packages/ui/src/components/`** ⭐⭐⭐  
Reusable React components (edit frequently)
- `encounter-list.tsx` - Encounter history list
- `recording-view.tsx` - Recording interface
- `processing-view.tsx` - Processing status display
- `settings-dialog.tsx` - Settings modal
- `new-encounter-form.tsx` - New encounter form
- `permissions-dialog.tsx` - Permission requests
- `error-boundary.tsx` - Error handling
- `idle-view.tsx` - Initial/idle state
- `settings-bar.tsx` - Settings toolbar
- Edit when: UI changes, new components, component behavior changes

**`packages/llm/src/prompts/clinical-note/templates/`** ⭐⭐⭐  
Clinical note formats (markdown files, no code required)
- `default.md` - Standard clinical note format
- `soap.md` - SOAP note format
- `README.md` - Template documentation
- `index.ts` - Template loader
- Edit when: changing note structure, adding new note formats

### Occational Development Locations

**`packages/pipeline/audio-ingest/src/`**  
Audio recording and capture
- `capture/` - Recording implementation
- `devices/` - Microphone/system audio device management
- `__tests__/` - Audio capture tests
- Edit when: recording bugs, new audio features, device support

**`packages/pipeline/transcribe/src/`**  
Whisper transcription integration
- `core/` - Transcription engine
- `hooks/` - React hooks (useSegmentUpload)
- `providers/` - Whisper API adapters
- `__tests__/` - Transcription tests
- Edit when: transcription service changes, provider updates

**`packages/pipeline/note-core/src/`**  
Clinical note generation engine
- `note-generator.ts` - Note generation logic
- `clinical-models/` - Note structure definitions
- `preprocessing/` - Input processing
- `postprocessing/` - Output formatting
- `__tests__/` - Note generation tests
- Edit when: note generation logic, LLM orchestration

**`packages/pipeline/assemble/src/`**  
Transcript assembly and streaming
- `session-store.ts` - SSE session management
- `index.ts` - Assembly logic
- Edit when: streaming logic, transcript assembly changes

**`packages/storage/src/`**  
Data persistence layer
- `encounters.ts` - Encounter CRUD operations
- `api-keys.ts` - API key storage
- `preferences.ts` - User preferences
- `secure-storage.ts` - AES-GCM encryption utilities
- `server-api-keys.ts` - Server-side key management
- `types.ts` - Shared TypeScript types
- Edit when: data structure changes, storage logic updates

**`packages/llm/src/`**  
LLM abstraction layer
- `index.ts` - Main LLM wrapper (Anthropic Claude)
- `prompts/index.ts` - Prompt management
- `providers/` - (Future) Additional providers
- `__tests__/` - LLM integration tests
- Edit when: LLM provider changes, adding new providers

**`packages/ui/src/hooks/`**  
Shared React hooks
- `use-encounters.ts` - Encounter management hook
- Edit when: shared state logic, new hooks

**`packages/ui/src/lib/`**  
UI utilities
- `ui/` - shadcn/ui component wrappers
- `utils/` - Helper functions (cn, etc.)
- Edit when: new utilities, UI library updates

### 🛠️ Rarely Edit

**`packages/pipeline/render/src/`**  
Note display components
- `components/` - Note display components
- `renderers/` - Format-specific renderers (SOAP variants)
- Edit when: note display format changes

**`packages/pipeline/eval/src/`**  
Testing and evaluation framework
- `cases/encounter/` - Encounter test data
- `cases/testMP3/` - Audio test files
- `runtime/` - Test execution
- `tests/` - Test implementations
- `types/` - Test type definitions
- Edit when: adding tests, evaluation criteria

**`packages/shell/`**  
Electron desktop wrapper
- `main.js` - Electron main process (window management, ~150 lines)
- `next-server.js` - Next.js server startup (~150 lines)
- `preload.js` - IPC bridge between renderer and main
- `scripts/prepare-next.js` - Build prep (node_modules rename workaround)
- `buildResources/` - App icons, installer assets
- Edit when: desktop features, OS integrations, window behavior

**`config/`**  
Centralized tool configuration
- `next.config.mjs` - Next.js config (CSP, headers, webpack aliases)
- `eslint.config.mjs` - Linting rules
- `postcss.config.mjs` - Tailwind setup
- `tsconfig.test.json` - Test compilation config
- `components.json` - shadcn UI settings
- `scripts/check-structure.mjs` - Structure linting
- Edit when: build configuration, webpack aliases, tool setup

### 🚫 Never Edit (Generated/System)

**Auto-generated folders** (safe to delete and rebuild)
- `build/` - Compiled output (tests, binaries)
- `apps/web/.next/` - Next.js build output
- `node_modules/` - Installed dependencies
- `.pnpm-store/` - pnpm package cache
- `.git/` - Git data (DO NOT DELETE)

### 🗺️ Navigation Quick Reference

**"I want to change..."**
| Goal | Location |
|------|----------|
| Main app behavior | `apps/web/src/app/page.tsx` |
| UI component | `packages/ui/src/components/<component>.tsx` |
| Note format/structure | `packages/llm/src/prompts/clinical-note/templates/<template>.md` |
| Recording logic | `packages/pipeline/audio-ingest/src/` |
| Transcription | `packages/pipeline/transcribe/src/` |
| Data storage | `packages/storage/src/` |
| API endpoint | `apps/web/src/app/api/` |
| Desktop window | `packages/shell/main.js` |
| Server action | `apps/web/src/app/actions.ts` |
| Shared hook | `packages/ui/src/hooks/` |


