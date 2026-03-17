# OpenEMR Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Push to OpenEMR" button to the note editor that sends a completed clinical note to an OpenEMR patient chart as a FHIR R4 DocumentReference.

**Architecture:** A standalone `openemr-client.ts` module in `apps/web/src/lib/` owns all OpenEMR API logic (token fetch, patient validation, DocumentReference creation). A thin Next.js API route at `/api/integrations/openemr/push` calls that module. The note editor gets a new button wired to that route. The new encounter form gets a required patient ID field, gated on the `NEXT_PUBLIC_OPENEMR_ENABLED` flag.

**Tech Stack:** Next.js App Router (TypeScript), native `fetch` (Node 18+), FHIR R4, OpenEMR OAuth2 client_credentials, Node.js built-in test runner (`node:test`)

---

## Spec Reference

`docs/superpowers/specs/2026-03-16-openemr-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/lib/openemr-client.ts` | **Create** | OpenEMR token fetch (with cache), patient validation, DocumentReference creation |
| `apps/web/src/lib/__tests__/openemr-client.test.ts` | **Create** | Unit tests for the client module (mocked fetch) |
| `apps/web/src/app/api/integrations/openemr/push/route.ts` | **Create** | Thin POST handler: auth guard → parse body → call client → return response |
| `packages/ui/src/components/new-encounter-form.tsx` | **Modify** | Add conditional required `patient_id` input field |
| `packages/pipeline/render/src/components/note-editor.tsx` | **Modify** | Add "Push to OpenEMR" button with push states and error display |
| `apps/web/.env.local.example` | **Modify** | Document the four new env vars |
| `config/tsconfig.test.json` | **Modify** | Add openemr-client source + test to includes so test compiler picks them up |

---

## Chunk 1: OpenEMR Client Module

### Task 1: Update env var documentation

**Files:**
- Modify: `apps/web/.env.local.example`

- [ ] **Step 1: Add OpenEMR vars to the example file**

Append to `apps/web/.env.local.example`:

```bash
# OpenEMR Integration (optional — enables "Push to OpenEMR" in the note editor)
# Register an OAuth2 client in OpenEMR Admin → System → API Clients
# with scopes: system/DocumentReference.write system/Patient.read
OPENEMR_BASE_URL=""
OPENEMR_CLIENT_ID=""
OPENEMR_CLIENT_SECRET=""
# Set to "true" at BUILD TIME to show the Push to OpenEMR button.
# NEXT_PUBLIC_* vars are inlined by Next.js at build — changing this requires a rebuild.
NEXT_PUBLIC_OPENEMR_ENABLED="false"
```

- [ ] **Step 2: Verify `.env.local` is in `.gitignore`**

```bash
grep -n "\.env\.local" /Users/sammargolis/projects/apps/OpenScribe/.gitignore
```

Expected: at least one matching line. If missing, add `.env.local` to `.gitignore` before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/.env.local.example
git commit -m "docs: document OpenEMR env vars in .env.local.example"
```

---

### Task 2: Extend test tsconfig to compile openemr-client

**Files:**
- Modify: `config/tsconfig.test.json`

- [ ] **Step 1: Add the two new files to the includes array**

In `config/tsconfig.test.json`, add to the `"include"` array:

```json
"../apps/web/src/lib/openemr-client.ts",
"../apps/web/src/lib/__tests__/openemr-client.test.ts"
```

The final include array should look like:

```json
"include": [
  "../packages/pipeline/eval/src/**/*.ts",
  "../packages/pipeline/audio-ingest/src/**/*.ts",
  "../packages/pipeline/transcribe/src/**/*.ts",
  "../packages/pipeline/assemble/src/**/*.ts",
  "../packages/pipeline/note-core/src/**/*.ts",
  "../packages/pipeline/shared/src/**/*.ts",
  "../packages/pipeline/medgemma-scribe/src/**/*.ts",
  "../packages/llm/src/**/*.ts",
  "../packages/llm-medgemma/src/**/*.ts",
  "../packages/storage/src/**/*.ts",
  "../apps/web/src/lib/openemr-client.ts",
  "../apps/web/src/lib/__tests__/openemr-client.test.ts"
]
```

**Why only these two files:** The rest of `apps/web/src/lib/` imports from Next.js (`next/server`, `next-auth`) which the NodeNext test compiler cannot resolve. The openemr-client module uses only built-in Node.js APIs.

- [ ] **Step 2: Commit**

```bash
git add config/tsconfig.test.json
git commit -m "build: add openemr-client to test tsconfig includes"
```

---

### Task 3: Write failing tests for openemr-client

**Files:**
- Create: `apps/web/src/lib/__tests__/openemr-client.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/src/lib/__tests__/openemr-client.test.ts
import assert from "node:assert/strict"
import test from "node:test"
import { pushNoteToOpenEMR, isOpenEMRConfigured, _resetTokenCacheForTesting } from "../openemr-client.js"

// Helpers
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0
  globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit): Promise<Response> => {
    const resp = responses[callIndex++]
    if (!resp) throw new Error(`Unexpected fetch call #${callIndex}`)
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response
  }
}

const SAMPLE_PARAMS = {
  patientId: "42",
  noteMarkdown: "# Note\nPatient is well.",
  patientName: "Jane Doe",
  visitReason: "problem_visit",
}

// Ensure env vars are set for the whole file
process.env.OPENEMR_BASE_URL = "http://localhost:8080"
process.env.OPENEMR_CLIENT_ID = "test-client"
process.env.OPENEMR_CLIENT_SECRET = "test-secret"

test("isOpenEMRConfigured returns true when all vars are set", () => {
  assert.equal(isOpenEMRConfigured(), true)
})

test("isOpenEMRConfigured returns false when OPENEMR_BASE_URL is missing", () => {
  const saved = process.env.OPENEMR_BASE_URL
  delete process.env.OPENEMR_BASE_URL
  assert.equal(isOpenEMRConfigured(), false)
  process.env.OPENEMR_BASE_URL = saved!
})

test("pushNoteToOpenEMR succeeds on happy path", async () => {
  _resetTokenCacheForTesting()
  mockFetch([
    // Step 1: token endpoint
    { status: 200, body: { access_token: "tok-123", expires_in: 3600 } },
    // Step 2: patient validation
    { status: 200, body: { resourceType: "Patient", id: "42" } },
    // Step 3: DocumentReference creation
    { status: 201, body: { resourceType: "DocumentReference", id: "doc-99" } },
  ])

  const result = await pushNoteToOpenEMR(SAMPLE_PARAMS)

  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.id, "doc-99")
  }
})

test("pushNoteToOpenEMR reuses cached token on second call", async () => {
  _resetTokenCacheForTesting()
  let tokenCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString()
    if (urlStr.includes("/oauth2/")) tokenCalls++
    // Patient + DocRef succeed
    return { ok: true, status: urlStr.includes("DocumentReference") ? 201 : 200, json: async () => ({
      access_token: "tok-cached", expires_in: 3600,
      resourceType: urlStr.includes("DocumentReference") ? "DocumentReference" : "Patient",
      id: urlStr.includes("DocumentReference") ? "doc-1" : "42",
    }), text: async () => "" } as Response
  }

  await pushNoteToOpenEMR(SAMPLE_PARAMS)  // fetches token
  await pushNoteToOpenEMR(SAMPLE_PARAMS)  // reuses token
  globalThis.fetch = originalFetch

  assert.equal(tokenCalls, 1, "Token endpoint should only be called once")
})

test("pushNoteToOpenEMR returns auth_failure error on 401 from token endpoint", async () => {
  _resetTokenCacheForTesting()
  mockFetch([
    { status: 401, body: { error: "invalid_client" } },
  ])

  const result = await pushNoteToOpenEMR(SAMPLE_PARAMS)

  assert.equal(result.success, false)
  if (!result.success) {
    assert.match(result.error, /authentication failed/i)
  }
})

test("pushNoteToOpenEMR returns patient_not_found error on 404 from Patient endpoint", async () => {
  _resetTokenCacheForTesting()
  mockFetch([
    { status: 200, body: { access_token: "tok-123", expires_in: 3600 } },
    { status: 404, body: { resourceType: "OperationOutcome" } },
  ])

  const result = await pushNoteToOpenEMR(SAMPLE_PARAMS)

  assert.equal(result.success, false)
  if (!result.success) {
    assert.match(result.error, /not found in openemr/i)
  }
})

test("pushNoteToOpenEMR returns network error when fetch throws", async () => {
  _resetTokenCacheForTesting()
  globalThis.fetch = async () => { throw new Error("fetch failed: ECONNREFUSED") }

  const result = await pushNoteToOpenEMR(SAMPLE_PARAMS)

  assert.equal(result.success, false)
  if (!result.success) {
    assert.match(result.error, /could not reach openemr/i)
  }
})

test("pushNoteToOpenEMR returns config error when vars are missing", async () => {
  _resetTokenCacheForTesting()
  const saved = process.env.OPENEMR_BASE_URL
  delete process.env.OPENEMR_BASE_URL

  const result = await pushNoteToOpenEMR(SAMPLE_PARAMS)

  assert.equal(result.success, false)
  process.env.OPENEMR_BASE_URL = saved!
})
```

- [ ] **Step 2: Confirm tests do not yet compile (openemr-client.ts doesn't exist)**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | grep openemr
```

Expected: error about `openemr-client.ts` not found or `_resetTokenCacheForTesting` not exported.

---

### Task 4: Implement openemr-client.ts to pass tests

**Files:**
- Create: `apps/web/src/lib/openemr-client.ts`

- [ ] **Step 1: Create the module**

```typescript
// apps/web/src/lib/openemr-client.ts

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

function getConfig() {
  return {
    baseUrl: process.env.OPENEMR_BASE_URL?.replace(/\/$/, "") ?? "",
    clientId: process.env.OPENEMR_CLIENT_ID ?? "",
    clientSecret: process.env.OPENEMR_CLIENT_SECRET ?? "",
  }
}

export function isOpenEMRConfigured(): boolean {
  const { baseUrl, clientId, clientSecret } = getConfig()
  return Boolean(baseUrl && clientId && clientSecret)
}

export function _resetTokenCacheForTesting(): void {
  tokenCache = null
}

async function getAccessToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getConfig()
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error("not_configured")
  }

  // Return cached token if still valid (5-minute early expiry buffer)
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    return tokenCache.accessToken
  }

  const response = await fetch(`${baseUrl}/oauth2/default/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "system/DocumentReference.write system/Patient.read",
    }).toString(),
  })

  if (!response.ok) {
    throw new Error("auth_failure")
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }
  return tokenCache.accessToken
}

async function validatePatient(token: string, baseUrl: string, patientId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/apis/default/fhir/Patient/${patientId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error("patient_not_found")
  }
}

async function createDocumentReference(
  token: string,
  baseUrl: string,
  params: { patientId: string; noteMarkdown: string; patientName: string; visitReason: string }
): Promise<string> {
  const resource = {
    resourceType: "DocumentReference",
    status: "current",
    type: {
      coding: [{ system: "http://loinc.org", code: "34109-9", display: "Note" }],
    },
    category: [
      {
        coding: [
          {
            system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
            code: "clinical-note",
            display: "Clinical Note",
          },
        ],
      },
    ],
    subject: { reference: `Patient/${params.patientId}` },
    date: new Date().toISOString(),
    description: params.visitReason,
    content: [
      {
        attachment: {
          contentType: "text/markdown",
          data: Buffer.from(params.noteMarkdown).toString("base64"),
          title: `Clinical Note — ${params.patientName}`,
        },
      },
    ],
  }

  const response = await fetch(`${baseUrl}/apis/default/fhir/DocumentReference`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/fhir+json",
    },
    body: JSON.stringify(resource),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`fhir_error:${response.status}:${errorText.slice(0, 200)}`)
  }

  const created = (await response.json()) as { id: string }
  return created.id
}

export type PushNoteParams = {
  patientId: string
  noteMarkdown: string
  patientName: string
  visitReason: string
}

export type PushNoteResult = { success: true; id: string } | { success: false; error: string }

export async function pushNoteToOpenEMR(params: PushNoteParams): Promise<PushNoteResult> {
  const { baseUrl } = getConfig()
  if (!isOpenEMRConfigured()) {
    return { success: false, error: "OpenEMR is not configured." }
  }

  try {
    const token = await getAccessToken()
    await validatePatient(token, baseUrl, params.patientId)
    const id = await createDocumentReference(token, baseUrl, params)
    return { success: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message === "auth_failure") {
      return {
        success: false,
        error: "OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_CLIENT_SECRET.",
      }
    }
    if (message === "patient_not_found") {
      return {
        success: false,
        error: `Patient ID ${params.patientId} was not found in OpenEMR. Verify the ID and try again.`,
      }
    }
    // Internal sentinel strings ("auth_failure", "patient_not_found", "fhir_error:") are
    // caught above and mapped to the four spec-prescribed user-facing messages below.
    // Network errors from fetch use raw Node/fetch error text, detected by substring match.
    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND")
    ) {
      // → spec message: "Could not reach OpenEMR at {URL}. Check that the server is running."
      return {
        success: false,
        error: `Could not reach OpenEMR at ${baseUrl}. Check that the server is running.`,
      }
    }
    if (message.startsWith("fhir_error:")) {
      // → spec message: "OpenEMR push failed: {error message from server}"
      const statusCode = message.split(":")[1]
      return { success: false, error: `OpenEMR push failed: FHIR error ${statusCode}` }
    }

    // Catch-all → spec message: "OpenEMR push failed: {error message from server}"
    return { success: false, error: `OpenEMR push failed: ${message}` }
  }
}
```

- [ ] **Step 2: Build the tests**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | tail -20
```

Expected: compilation succeeds with no errors.

- [ ] **Step 3: Run the tests**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && node --test build/tests-dist/web/src/lib/__tests__/openemr-client.test.js
```

Expected: all 6 tests pass (✓ `isOpenEMRConfigured returns true…` etc.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/openemr-client.ts apps/web/src/lib/__tests__/openemr-client.test.ts
git commit -m "feat: add OpenEMR FHIR client module with tests"
```

---

## Chunk 2: API Route + UI

### Task 5: Push API route

**Files:**
- Create: `apps/web/src/app/api/integrations/openemr/push/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// apps/web/src/app/api/integrations/openemr/push/route.ts
import { NextRequest, NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { pushNoteToOpenEMR } from "@/lib/openemr-client"

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  let body: {
    encounterId?: string
    patientId?: string
    noteMarkdown?: string
    patientName?: string
    visitReason?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  // encounterId is accepted for API contract completeness but not forwarded —
  // the openemr-client module does not need it (DocumentReference has no OpenScribe encounter reference)
  const { patientId, noteMarkdown, patientName, visitReason } = body

  if (!patientId || !noteMarkdown) {
    return NextResponse.json(
      { success: false, error: "patientId and noteMarkdown are required" },
      { status: 400 }
    )
  }

  const result = await pushNoteToOpenEMR({
    patientId,
    noteMarkdown,
    patientName: patientName ?? "",
    visitReason: visitReason ?? "",
  })

  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
```

- [ ] **Step 2: Smoke-test the route compiles (TypeScript check)**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep openemr
```

Expected: no errors for openemr files.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/integrations/openemr/push/route.ts
git commit -m "feat: add POST /api/integrations/openemr/push route"
```

---

### Task 6: New encounter form — conditional patient_id field

**Files:**
- Modify: `packages/ui/src/components/new-encounter-form.tsx`

- [ ] **Step 1: Add state + conditional field to the form**

The `NEXT_PUBLIC_OPENEMR_ENABLED` env var is inlined at build time by Next.js. Read it as `process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"`.

Replace the current `NewEncounterForm` component (full file rewrite):

```typescript
"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Mic } from "lucide-react"

interface NewEncounterFormProps {
  onStart: (data: { patient_name: string; patient_id: string; visit_reason: string }) => void
  onCancel: () => void
}

const VISIT_TYPE_OPTIONS = [
  { label: "History & Physical", value: "history_physical" },
  { label: "Problem Visit", value: "problem_visit" },
  { label: "Consult Note", value: "consult_note" },
]

const OPENEMR_ENABLED = process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [patientId, setPatientId] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")
  const [patientIdError, setPatientIdError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (OPENEMR_ENABLED && !patientId.trim()) {
      setPatientIdError("OpenEMR Patient ID is required")
      return
    }
    onStart({
      patient_name: patientName,
      patient_id: patientId,
      visit_reason: visitType,
    })
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="text-xl font-medium text-foreground mb-6 text-center">New Interview</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="patient-name" className="text-sm text-muted-foreground">
            Patient Name
          </Label>
          <Input
            id="patient-name"
            placeholder="Enter patient name (optional)"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="rounded-xl border-border bg-secondary"
          />
        </div>

        {OPENEMR_ENABLED && (
          <div className="space-y-2">
            <Label htmlFor="patient-id" className="text-sm text-muted-foreground">
              OpenEMR Patient ID
            </Label>
            <Input
              id="patient-id"
              placeholder="Enter OpenEMR patient ID"
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value)
                if (e.target.value.trim()) setPatientIdError("")
              }}
              className="rounded-xl border-border bg-secondary"
              aria-describedby={patientIdError ? "patient-id-error" : undefined}
            />
            {patientIdError && (
              <p id="patient-id-error" className="text-xs text-destructive">
                {patientIdError}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="visit-type" className="text-sm text-muted-foreground">
            Note Type
          </Label>
          <select
            id="visit-type"
            value={visitType}
            onChange={(e) => setVisitType(e.target.value)}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {VISIT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="flex-1 rounded-full text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90">
            <Mic className="mr-2 h-4 w-4" />
            Start Recording
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification (start dev server)**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev &
```

Open `http://localhost:3001`, click "New Encounter". Verify:
- Without `NEXT_PUBLIC_OPENEMR_ENABLED=true`: no patient ID field appears
- With `NEXT_PUBLIC_OPENEMR_ENABLED=true` (set in `.env.local` + rebuild): field appears, submitting blank shows inline error

- [ ] **Step 3: Kill dev server, commit**

```bash
kill %1 2>/dev/null; git add packages/ui/src/components/new-encounter-form.tsx
git commit -m "feat: add required OpenEMR patient ID field to encounter form (gated on NEXT_PUBLIC_OPENEMR_ENABLED)"
```

---

### Task 7: Note editor — Push to OpenEMR button

**Files:**
- Modify: `packages/pipeline/render/src/components/note-editor.tsx`

- [ ] **Step 1: Add the Upload icon import**

In the imports line (line 9), add `Upload` to the lucide-react destructure:

```typescript
import { Save, Copy, Download, Check, AlertTriangle, Send, X, MessageSquare, Loader2, Upload } from "lucide-react"
```

- [ ] **Step 2: Add push state declarations**

After the existing OpenClaw state declarations (after line 67, before the first `useEffect`), add:

```typescript
type OpenEMRPushState = "idle" | "pushing" | "success" | "failed"
const OPENEMR_ENABLED = process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"

const [openEMRPushState, setOpenEMRPushState] = useState<OpenEMRPushState>("idle")
const [openEMRError, setOpenEMRError] = useState("")
```

- [ ] **Step 3: Reset push state when encounter changes**

In the existing `useEffect` that resets OpenClaw state on `[encounter.id, encounter.note_text]` (around line 70), add the two new state resets:

```typescript
setOpenEMRPushState("idle")
setOpenEMRError("")
```

- [ ] **Step 4: Add the push handler**

After the `handleExport` function, add:

```typescript
const handlePushToOpenEMR = async () => {
  if (!noteMarkdown.trim() || !encounter.patient_id) return
  setOpenEMRPushState("pushing")
  setOpenEMRError("")

  try {
    const response = await fetch("/api/integrations/openemr/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encounterId: encounter.id,
        patientId: encounter.patient_id,
        noteMarkdown,
        patientName: encounter.patient_name ?? "",
        visitReason: encounter.visit_reason ?? "",
      }),
    })
    const result = (await response.json()) as { success: boolean; id?: string; error?: string }

    if (result.success) {
      setOpenEMRPushState("success")
      setTimeout(() => setOpenEMRPushState("idle"), 3000)
    } else {
      setOpenEMRError(result.error ?? "OpenEMR push failed.")
      setOpenEMRPushState("failed")
    }
  } catch {
    setOpenEMRError("Could not reach the OpenEMR push endpoint. Check your network connection.")
    setOpenEMRPushState("failed")
  }
}
```

- [ ] **Step 5: Add the button to the toolbar**

In the toolbar, after the "Send to OpenClaw" button block (after the closing `)}` of that conditional, before the "Save" button conditional), add:

```tsx
{activeTab === "note" && OPENEMR_ENABLED && (
  <Button
    variant="ghost"
    size="sm"
    onClick={handlePushToOpenEMR}
    disabled={!noteMarkdown.trim() || !encounter.patient_id || openEMRPushState === "pushing"}
    className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
    title="Push clinical note to OpenEMR"
  >
    {openEMRPushState === "pushing" ? (
      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
    ) : openEMRPushState === "success" ? (
      <Check className="h-4 w-4 mr-1.5" />
    ) : (
      <Upload className="h-4 w-4 mr-1.5" />
    )}
    <span className="text-xs">
      {openEMRPushState === "pushing"
        ? "Pushing..."
        : openEMRPushState === "success"
          ? "Pushed to OpenEMR"
          : "Push to OpenEMR"}
    </span>
  </Button>
)}
```

- [ ] **Step 6: Add the error display**

In the note tab content area, after the existing OpenClaw error block (`{openClawError && openClawInitState === "failed" && ...}`), add:

```tsx
{openEMRError && openEMRPushState === "failed" && (
  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>{openEMRError}</span>
  </div>
)}
```

- [ ] **Step 7: Dismiss error on note edit**

In `handleNoteChange` (around line 99), the existing function looks like:

```typescript
const handleNoteChange = (value: string) => {
  setNoteMarkdown(value)
  setHasChanges(true)
}
```

Replace it with:

```typescript
const handleNoteChange = (value: string) => {
  setNoteMarkdown(value)
  setHasChanges(true)
  if (openEMRPushState === "failed") {
    setOpenEMRPushState("idle")
    setOpenEMRError("")
  }
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/pipeline/render/src/components/note-editor.tsx
git commit -m "feat: add Push to OpenEMR button to note editor"
```

---

## Final Verification

### Task 8: End-to-end smoke test against local OpenEMR

**Prerequisites:**
- OpenEMR running: `cd /Users/sammargolis/openemr-docker && docker compose up -d`
- OAuth2 client registered in OpenEMR admin UI (Admin → System → API Clients)
  - Scopes: `system/DocumentReference.write system/Patient.read`
- `apps/web/.env.local` updated with real values (ask the developer to add these):
  ```
  OPENEMR_BASE_URL=http://localhost:8080
  OPENEMR_CLIENT_ID=<from OpenEMR admin UI>
  OPENEMR_CLIENT_SECRET=<from OpenEMR admin UI>
  NEXT_PUBLIC_OPENEMR_ENABLED=true
  ```

- [ ] **Step 1: Start OpenEMR**

```bash
cd /Users/sammargolis/openemr-docker && docker compose up -d
```

Wait ~30 seconds for OpenEMR to be ready, then verify:
```bash
curl -s http://localhost:8080/apis/default/fhir/metadata | python3 -m json.tool | head -10
```
Expected: FHIR CapabilityStatement JSON.

- [ ] **Step 2: Start the OpenScribe dev server**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev:local
```

- [ ] **Step 3: Create a test patient in OpenEMR**

Navigate to `http://localhost:8080`, log in as `admin` / `adminpass`, create a test patient. Note the patient's numeric ID from the URL or patient list.

- [ ] **Step 4: Create an encounter in OpenScribe, push the note**

1. Open `http://localhost:3001`
2. Click "New Encounter", enter the OpenEMR patient ID from step 3
3. Record a short encounter and wait for the note to generate
4. In the note editor, click "Push to OpenEMR"
5. Verify: button shows "Pushed to OpenEMR" ✓ with check icon

- [ ] **Step 5: Verify the DocumentReference appears in OpenEMR**

```bash
# Get a token first
TOKEN=$(curl -s -X POST http://localhost:8080/oauth2/default/token \
  -d "grant_type=client_credentials&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&scope=system/DocumentReference.read" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Search for the DocumentReference by patient
curl -s "http://localhost:8080/apis/default/fhir/DocumentReference?subject=Patient/<PATIENT_ID>" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep '"id"'
```

Expected: a DocumentReference resource with the note content.

- [ ] **Step 6: Test the failure case**

In the note editor, edit the encounter to use a non-existent patient ID (e.g., `99999`), click "Push to OpenEMR". Verify the red error banner appears below the editor with "Patient ID 99999 was not found in OpenEMR."

- [ ] **Step 7: Final commit and run full test suite**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm test
```

Expected: all existing tests pass. The openemr-client tests run and pass.

```bash
git add .
git commit -m "feat: OpenEMR FHIR push integration — end-to-end verified"
```
