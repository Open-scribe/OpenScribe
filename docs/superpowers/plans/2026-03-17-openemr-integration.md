# OpenEMR Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Push to OpenEMR" button to the note editor that sends a completed clinical note to an OpenEMR patient chart as a FHIR R4 DocumentReference.

**Architecture:** A standalone `openemr-client.ts` module owns all FHIR API logic. A pure `openemr-push-handler.ts` owns request validation and delegation logic (testable without Next.js). The Next.js route is a thin wrapper around the handler. The note editor button uses a pure `buildOpenEMRPushPayload` function for payload construction. All trust boundaries are covered by failing tests before any production code is written.

**TDD Rules (non-negotiable):**
1. Write the failing test first. Run it. Confirm it fails.
2. Write the minimal production code to make it pass. Nothing more.
3. Run the test. Confirm it passes.
4. Commit. Summarize what changed.

**Trust boundary focus:** Tests specifically cover identity binding (patient ID from input = patient ID sent to FHIR), auth guards (unauthenticated paths never reach OpenEMR), and input validation (malformed inputs are rejected before any OpenEMR call).

**Tech Stack:** Next.js App Router (TypeScript), native `fetch` (Node 18+), FHIR R4, OpenEMR OAuth2 client_credentials, Node.js built-in test runner (`node:test`)

---

## Spec Reference

`docs/superpowers/specs/2026-03-16-openemr-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/.env.local.example` | **Modify** | Document the four new env vars |
| `config/tsconfig.test.json` | **Modify** | Add all new testable modules to includes |
| `apps/web/src/lib/openemr-client.ts` | **Create** | Token fetch (with cache + timeout), patient validation, DocumentReference creation |
| `apps/web/src/lib/__tests__/openemr-client.test.ts` | **Create** | Trust boundary tests: auth chain, identity binding, FHIR payload structure |
| `apps/web/src/lib/openemr-push-handler.ts` | **Create** | Pure request validation + delegation logic (no Next.js dependency) |
| `apps/web/src/lib/__tests__/openemr-push-handler.test.ts` | **Create** | Trust boundary tests: input guard, identity binding to client module |
| `apps/web/src/app/api/integrations/openemr/push/route.ts` | **Create** | Thin POST handler: auth guard → delegate to pure handler |
| `packages/ui/src/components/new-encounter-form.tsx` | **Modify** | Add conditional required `patient_id` field |
| `packages/pipeline/render/src/components/note-editor.tsx` | **Modify** | Add "Push to OpenEMR" button, states, error display |

---

## Trust Boundary Map

```
Browser (untrusted)
    │
    ▼  POST /api/integrations/openemr/push
┌─────────────────────────────────────┐
│  Next.js Route                      │
│  ① requireAuthenticatedUser()       │ ← identity check (auth guard)
│  ② parsePushBody(body)              │ ← input validation (tested pure)
└─────────────────────────────────────┘
    │  validated { patientId, noteMarkdown, ... }
    ▼
┌─────────────────────────────────────┐
│  openemr-push-handler.ts            │
│  ③ pushNoteToOpenEMR(params)        │ ← identity binding: patientId passes through exactly
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  openemr-client.ts                  │
│  ④ getAccessToken()                 │ ← credential boundary: creds never leave server
│  ⑤ validatePatient(token, id)       │ ← patient existence check before write
│  ⑥ createDocumentReference(...)     │ ← FHIR payload: patient_id bound to subject.reference
└─────────────────────────────────────┘
    │
    ▼
OpenEMR FHIR API (external)
```

Circles ①–⑥ are each covered by at least one failing test before implementation.

---

## Chunk 1: Configuration and Test Infrastructure

### Task 1: Document env vars and extend test tsconfig

No production logic. No tests needed. This is build plumbing.

**Files:**
- Modify: `apps/web/.env.local.example`
- Modify: `config/tsconfig.test.json`

- [ ] **Step 1: Append to `.env.local.example`**

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

- [ ] **Step 2: Confirm `.env.local` is in `.gitignore`**

```bash
grep "\.env\.local" /Users/sammargolis/projects/apps/OpenScribe/.gitignore
```

Expected: at least one match. If missing, add `.env.local` before continuing.

- [ ] **Step 3: Add new modules to `config/tsconfig.test.json` includes**

Add these four entries to the `"include"` array:

```json
"../apps/web/src/lib/openemr-client.ts",
"../apps/web/src/lib/__tests__/openemr-client.test.ts",
"../apps/web/src/lib/openemr-push-handler.ts",
"../apps/web/src/lib/__tests__/openemr-push-handler.test.ts"
```

**Why four specific files, not a glob:** Every other file in `apps/web/src/lib/` imports from `next/server` or `next-auth`, which the NodeNext test compiler cannot resolve. These four are pure Node.js.

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm test
```

Expected: all existing tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/.env.local.example config/tsconfig.test.json
git commit -m "build: document OpenEMR env vars and extend test tsconfig"
```

**Summary:** No logic changed. Test infrastructure extended to cover the two new testable modules.

---

## Chunk 2: OpenEMR FHIR Client (trust boundary ④⑤⑥)

### Task 2: Write failing tests for openemr-client

Write ALL tests before any implementation code exists. Run them. Confirm they fail.

**Files:**
- Create: `apps/web/src/lib/__tests__/openemr-client.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/src/lib/__tests__/openemr-client.test.ts
import assert from "node:assert/strict"
import test from "node:test"
import {
  pushNoteToOpenEMR,
  isOpenEMRConfigured,
  _resetTokenCacheForTesting,
} from "../openemr-client.js"

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0
  globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit): Promise<Response> => {
    const resp = responses[i++]
    if (!resp) throw new Error(`Unexpected fetch call #${i}`)
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response
  }
}

const BASE = {
  patientId: "42",
  noteMarkdown: "# Note\nPatient is well.",
  patientName: "Jane Doe",
  visitReason: "problem_visit",
}

process.env.OPENEMR_BASE_URL = "http://localhost:8080"
process.env.OPENEMR_CLIENT_ID = "test-client"
process.env.OPENEMR_CLIENT_SECRET = "test-secret"

// ─── Configuration boundary ─────────────────────────────────────────────────

test("isOpenEMRConfigured: returns true when all three vars are set", () => {
  assert.equal(isOpenEMRConfigured(), true)
})

test("isOpenEMRConfigured: returns false when OPENEMR_BASE_URL is absent", () => {
  const saved = process.env.OPENEMR_BASE_URL
  delete process.env.OPENEMR_BASE_URL
  assert.equal(isOpenEMRConfigured(), false)
  process.env.OPENEMR_BASE_URL = saved!
})

test("pushNoteToOpenEMR: returns failure when not configured", async () => {
  _resetTokenCacheForTesting()
  const saved = process.env.OPENEMR_BASE_URL
  delete process.env.OPENEMR_BASE_URL

  const result = await pushNoteToOpenEMR(BASE)

  assert.equal(result.success, false)
  process.env.OPENEMR_BASE_URL = saved!
})

// ─── Auth boundary (trust boundary ④) ──────────────────────────────────────

test("auth boundary: 401 from token endpoint → auth failure message, no further calls", async () => {
  _resetTokenCacheForTesting()
  let callCount = 0
  globalThis.fetch = async (): Promise<Response> => {
    callCount++
    return { ok: false, status: 401, json: async () => ({}), text: async () => "" } as Response
  }

  const result = await pushNoteToOpenEMR(BASE)

  assert.equal(result.success, false)
  if (!result.success) assert.match(result.error, /authentication failed/i)
  assert.equal(callCount, 1, "Must stop after auth failure — no patient or FHIR calls")
})

test("auth boundary: token is reused on second call (credential not re-sent)", async () => {
  _resetTokenCacheForTesting()
  let tokenCalls = 0
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString()
    if (u.includes("/oauth2/")) {
      tokenCalls++
      return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" } as Response
    }
    if (u.includes("DocumentReference")) {
      return { ok: true, status: 201, json: async () => ({ id: "doc-1" }), text: async () => "" } as Response
    }
    return { ok: true, status: 200, json: async () => ({ id: "42" }), text: async () => "" } as Response
  }

  await pushNoteToOpenEMR(BASE)
  await pushNoteToOpenEMR(BASE)

  assert.equal(tokenCalls, 1, "Credentials must not be re-sent when token is cached")
})

// ─── Patient identity boundary (trust boundary ⑤) ──────────────────────────

test("patient boundary: 404 from Patient endpoint → not-found message, no FHIR write", async () => {
  _resetTokenCacheForTesting()
  let fhirWriteCalled = false
  globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString()
    if (u.includes("/oauth2/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" } as Response
    if (u.includes("DocumentReference")) { fhirWriteCalled = true; return { ok: true, status: 201, json: async () => ({ id: "x" }), text: async () => "" } as Response }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response
  }

  const result = await pushNoteToOpenEMR(BASE)

  assert.equal(result.success, false)
  if (!result.success) assert.match(result.error, /not found in openemr/i)
  assert.equal(fhirWriteCalled, false, "Must not write DocumentReference for unknown patient")
})

// ─── Identity binding (trust boundary ⑥) ────────────────────────────────────

test("identity binding: patientId param is bound to DocumentReference subject.reference exactly", async () => {
  _resetTokenCacheForTesting()
  let capturedBody: Record<string, unknown> | null = null

  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString()
    if (u.includes("/oauth2/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" } as Response
    if (u.includes("DocumentReference") && opts?.method === "POST") {
      capturedBody = JSON.parse(opts.body as string)
      return { ok: true, status: 201, json: async () => ({ id: "doc-99" }), text: async () => "" } as Response
    }
    return { ok: true, status: 200, json: async () => ({ id: "42" }), text: async () => "" } as Response
  }

  const result = await pushNoteToOpenEMR({ ...BASE, patientId: "42" })

  assert.equal(result.success, true)
  assert.ok(capturedBody, "DocumentReference payload must be sent")
  // The patient ID from the request must appear verbatim in the FHIR subject reference
  assert.deepEqual(capturedBody!.subject, { reference: "Patient/42" })
})

test("identity binding: noteMarkdown is base64-encoded without alteration", async () => {
  _resetTokenCacheForTesting()
  let capturedAttachment: { contentType: string; data: string } | null = null

  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString()
    if (u.includes("/oauth2/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" } as Response
    if (u.includes("DocumentReference") && opts?.method === "POST") {
      const body = JSON.parse(opts.body as string) as { content: Array<{ attachment: { contentType: string; data: string } }> }
      capturedAttachment = body.content[0].attachment
      return { ok: true, status: 201, json: async () => ({ id: "doc-1" }), text: async () => "" } as Response
    }
    return { ok: true, status: 200, json: async () => ({ id: "42" }), text: async () => "" } as Response
  }

  const note = "# Visit Note\n\nChief complaint: headache."
  await pushNoteToOpenEMR({ ...BASE, noteMarkdown: note })

  assert.ok(capturedAttachment)
  assert.equal(capturedAttachment!.contentType, "text/markdown")
  assert.equal(Buffer.from(capturedAttachment!.data, "base64").toString(), note)
})

test("identity binding: FHIR payload includes required category and status fields", async () => {
  _resetTokenCacheForTesting()
  let capturedBody: Record<string, unknown> | null = null

  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString()
    if (u.includes("/oauth2/")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" } as Response
    if (u.includes("DocumentReference") && opts?.method === "POST") {
      capturedBody = JSON.parse(opts.body as string)
      return { ok: true, status: 201, json: async () => ({ id: "doc-1" }), text: async () => "" } as Response
    }
    return { ok: true, status: 200, json: async () => ({ id: "42" }), text: async () => "" } as Response
  }

  await pushNoteToOpenEMR(BASE)

  const p = capturedBody!
  assert.equal(p.status, "current")
  const cat = p.category as Array<{ coding: Array<{ code: string }> }>
  assert.equal(cat[0].coding[0].code, "clinical-note")
  assert.equal(p.description, BASE.visitReason)
})

// ─── Network / timeout boundary ─────────────────────────────────────────────

test("network boundary: ECONNREFUSED → 'could not reach' message", async () => {
  _resetTokenCacheForTesting()
  globalThis.fetch = async () => { throw new Error("fetch failed: ECONNREFUSED ::1:8080") }

  const result = await pushNoteToOpenEMR(BASE)

  assert.equal(result.success, false)
  if (!result.success) assert.match(result.error, /could not reach openemr/i)
})

test("network boundary: timeout (AbortError) → timeout message", async () => {
  _resetTokenCacheForTesting()
  globalThis.fetch = async () => {
    const err = new Error("The operation was aborted")
    ;(err as NodeJS.ErrnoException).name = "AbortError"
    throw err
  }

  const result = await pushNoteToOpenEMR(BASE)

  assert.equal(result.success, false)
  if (!result.success) assert.match(result.error, /timed out/i)
})
```

- [ ] **Step 2: Run tests — confirm they ALL fail**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | grep openemr
```

Expected: compile error — `openemr-client.ts` does not exist yet. This is correct. Do not proceed until you see a failure.

---

### Task 3: Implement openemr-client.ts to pass all tests

Write the minimal implementation that satisfies the tests above. Nothing extra.

**Files:**
- Create: `apps/web/src/lib/openemr-client.ts`

- [ ] **Step 1: Create the module**

```typescript
// apps/web/src/lib/openemr-client.ts

const FETCH_TIMEOUT_MS = 15_000

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

type TokenCache = { accessToken: string; expiresAt: number }
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

/** Test-only: reset in-process token cache between test cases. */
export function _resetTokenCacheForTesting(): void {
  tokenCache = null
}

async function getAccessToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getConfig()
  if (!baseUrl || !clientId || !clientSecret) throw new Error("not_configured")

  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) return tokenCache.accessToken

  const res = await fetchWithTimeout(`${baseUrl}/oauth2/default/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "system/DocumentReference.write system/Patient.read",
    }).toString(),
  })
  if (!res.ok) throw new Error("auth_failure")

  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return tokenCache.accessToken
}

async function validatePatient(token: string, baseUrl: string, patientId: string): Promise<void> {
  const res = await fetchWithTimeout(`${baseUrl}/apis/default/fhir/Patient/${patientId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("patient_not_found")
}

async function createDocumentReference(
  token: string,
  baseUrl: string,
  params: { patientId: string; noteMarkdown: string; patientName: string; visitReason: string }
): Promise<string> {
  const resource = {
    resourceType: "DocumentReference",
    status: "current",
    type: { coding: [{ system: "http://loinc.org", code: "34109-9", display: "Note" }] },
    category: [{
      coding: [{
        system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
        code: "clinical-note",
        display: "Clinical Note",
      }],
    }],
    subject: { reference: `Patient/${params.patientId}` },
    date: new Date().toISOString(),
    description: params.visitReason,
    content: [{
      attachment: {
        contentType: "text/markdown",
        data: Buffer.from(params.noteMarkdown).toString("base64"),
        title: `Clinical Note — ${params.patientName}`,
      },
    }],
  }

  const res = await fetchWithTimeout(`${baseUrl}/apis/default/fhir/DocumentReference`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/fhir+json" },
    body: JSON.stringify(resource),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`fhir_error:${res.status}:${text.slice(0, 200)}`)
  }

  return ((await res.json()) as { id: string }).id
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
  if (!isOpenEMRConfigured()) return { success: false, error: "OpenEMR is not configured." }

  try {
    const token = await getAccessToken()
    await validatePatient(token, baseUrl, params.patientId)
    const id = await createDocumentReference(token, baseUrl, params)
    return { success: true, id }
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error))

    if (e.name === "AbortError") {
      return { success: false, error: `OpenEMR push timed out after ${FETCH_TIMEOUT_MS / 1000}s. Check that the server is responding at ${baseUrl}.` }
    }
    if (e.message === "auth_failure") {
      return { success: false, error: "OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_CLIENT_SECRET." }
    }
    if (e.message === "patient_not_found") {
      return { success: false, error: `Patient ID ${params.patientId} was not found in OpenEMR. Verify the ID and try again.` }
    }
    if (e.message.includes("fetch failed") || e.message.includes("ECONNREFUSED") || e.message.includes("ENOTFOUND")) {
      return { success: false, error: `Could not reach OpenEMR at ${baseUrl}. Check that the server is running.` }
    }
    if (e.message.startsWith("fhir_error:")) {
      return { success: false, error: `OpenEMR push failed: FHIR error ${e.message.split(":")[1]}` }
    }
    return { success: false, error: `OpenEMR push failed: ${e.message}` }
  }
}
```

- [ ] **Step 2: Build tests**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | tail -10
```

Expected: compilation succeeds with no errors.

- [ ] **Step 3: Run tests — confirm they ALL pass**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && node --test build/tests-dist/web/src/lib/__tests__/openemr-client.test.js 2>&1
```

Expected: all 11 tests pass. If any fail, fix the implementation (not the tests) before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/openemr-client.ts apps/web/src/lib/__tests__/openemr-client.test.ts
git commit -m "feat(openemr): FHIR client module — 11 trust boundary tests passing"
```

**Summary of what changed:** `openemr-client.ts` created. 11 tests pass covering: configuration boundary, auth guard (token not re-sent on cache hit, stops on 401), patient identity boundary (no FHIR write on 404), identity binding (patientId → subject.reference, noteMarkdown → base64 attachment, category + status required), network/timeout errors. No other files changed.

---

## Chunk 3: Route Handler (trust boundary ①②③)

### Task 4: Write failing tests for the pure push handler

The Next.js route imports from `next/server` and cannot be compiled by the test runner. Extract all testable logic into `openemr-push-handler.ts` (pure Node.js). The route becomes a 10-line wrapper. Write tests first.

**Trust boundaries tested here:**
- ① Auth identity check fires before any call to `pushNoteToOpenEMR`
- ② Input validation: missing `patientId` or `noteMarkdown` → rejected before any OpenEMR call
- ③ Identity binding: request body fields pass through to `pushNoteToOpenEMR` without transformation

**Files:**
- Create: `apps/web/src/lib/__tests__/openemr-push-handler.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/src/lib/__tests__/openemr-push-handler.test.ts
import assert from "node:assert/strict"
import test from "node:test"
import { handlePushRequest } from "../openemr-push-handler.js"
import type { PushNoteResult } from "../openemr-client.js"

// ─── Minimal mock for pushNoteToOpenEMR ─────────────────────────────────────

type PushFn = (params: {
  patientId: string
  noteMarkdown: string
  patientName: string
  visitReason: string
}) => Promise<PushNoteResult>

const successPush: PushFn = async () => ({ success: true, id: "doc-1" })
const failPush: PushFn = async () => ({ success: false, error: "auth failed" })

// ─── Auth boundary (trust boundary ①) ──────────────────────────────────────

test("auth boundary: unauthenticated request returns 401 without calling pushFn", async () => {
  let pushCalled = false
  const trackingPush: PushFn = async (p) => { pushCalled = true; return successPush(p) }

  const result = await handlePushRequest(
    { isAuthenticated: false },
    { patientId: "42", noteMarkdown: "note", patientName: "Jane", visitReason: "visit" },
    trackingPush
  )

  assert.equal(result.status, 401)
  assert.equal(pushCalled, false, "pushNoteToOpenEMR must not be called for unauthenticated requests")
})

test("auth boundary: authenticated request proceeds past auth check", async () => {
  const result = await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "42", noteMarkdown: "note", patientName: "Jane", visitReason: "visit" },
    successPush
  )

  assert.equal(result.status, 200)
})

// ─── Input validation (trust boundary ②) ────────────────────────────────────

test("input guard: missing patientId returns 400 without calling pushFn", async () => {
  let pushCalled = false
  const trackingPush: PushFn = async (p) => { pushCalled = true; return successPush(p) }

  const result = await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "", noteMarkdown: "note", patientName: "Jane", visitReason: "visit" },
    trackingPush
  )

  assert.equal(result.status, 400)
  assert.equal(pushCalled, false, "pushNoteToOpenEMR must not be called with missing patientId")
})

test("input guard: missing noteMarkdown returns 400 without calling pushFn", async () => {
  let pushCalled = false
  const trackingPush: PushFn = async (p) => { pushCalled = true; return successPush(p) }

  const result = await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "42", noteMarkdown: "", patientName: "Jane", visitReason: "visit" },
    trackingPush
  )

  assert.equal(result.status, 400)
  assert.equal(pushCalled, false, "pushNoteToOpenEMR must not be called with empty noteMarkdown")
})

test("input guard: null body returns 400 without calling pushFn", async () => {
  let pushCalled = false
  const trackingPush: PushFn = async (p) => { pushCalled = true; return successPush(p) }

  const result = await handlePushRequest(
    { isAuthenticated: true },
    null,
    trackingPush
  )

  assert.equal(result.status, 400)
  assert.equal(pushCalled, false)
})

// ─── Identity binding (trust boundary ③) ────────────────────────────────────

test("identity binding: patientId from request body passes to pushFn unchanged", async () => {
  let capturedParams: Parameters<PushFn>[0] | null = null
  const capturingPush: PushFn = async (p) => { capturedParams = p; return { success: true, id: "x" } }

  await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "patient-42", noteMarkdown: "note text", patientName: "Jane Doe", visitReason: "consult" },
    capturingPush
  )

  assert.ok(capturedParams)
  assert.equal(capturedParams!.patientId, "patient-42")
  assert.equal(capturedParams!.noteMarkdown, "note text")
  assert.equal(capturedParams!.patientName, "Jane Doe")
  assert.equal(capturedParams!.visitReason, "consult")
})

// ─── Response shape ──────────────────────────────────────────────────────────

test("response: success from pushFn → status 200 with id", async () => {
  const result = await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "42", noteMarkdown: "note", patientName: "Jane", visitReason: "visit" },
    async () => ({ success: true, id: "doc-99" })
  )

  assert.equal(result.status, 200)
  assert.deepEqual(result.json, { success: true, id: "doc-99" })
})

test("response: failure from pushFn → status 500 with error", async () => {
  const result = await handlePushRequest(
    { isAuthenticated: true },
    { patientId: "42", noteMarkdown: "note", patientName: "Jane", visitReason: "visit" },
    async () => ({ success: false, error: "Patient not found" })
  )

  assert.equal(result.status, 500)
  assert.deepEqual(result.json, { success: false, error: "Patient not found" })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | grep push-handler
```

Expected: compile error — `openemr-push-handler.ts` does not exist yet. Correct. Do not proceed until confirmed.

---

### Task 5: Implement openemr-push-handler.ts and the API route

Write the minimal code to pass the handler tests, then wrap it in a route.

**Files:**
- Create: `apps/web/src/lib/openemr-push-handler.ts`
- Create: `apps/web/src/app/api/integrations/openemr/push/route.ts`

- [ ] **Step 1: Create the pure handler**

```typescript
// apps/web/src/lib/openemr-push-handler.ts
import type { PushNoteParams, PushNoteResult } from "./openemr-client.js"

type AuthContext = { isAuthenticated: boolean }
type PushFn = (params: PushNoteParams) => Promise<PushNoteResult>
type HandlerResult = { status: number; json: unknown }

export async function handlePushRequest(
  auth: AuthContext,
  body: unknown,
  push: PushFn
): Promise<HandlerResult> {
  if (!auth.isAuthenticated) {
    return { status: 401, json: { success: false, error: "Unauthorized" } }
  }

  if (!body || typeof body !== "object") {
    return { status: 400, json: { success: false, error: "Invalid request body" } }
  }

  const b = body as Record<string, unknown>
  const patientId = typeof b.patientId === "string" ? b.patientId.trim() : ""
  const noteMarkdown = typeof b.noteMarkdown === "string" ? b.noteMarkdown.trim() : ""

  if (!patientId || !noteMarkdown) {
    return { status: 400, json: { success: false, error: "patientId and noteMarkdown are required" } }
  }

  const result = await push({
    patientId,
    noteMarkdown,
    patientName: typeof b.patientName === "string" ? b.patientName : "",
    visitReason: typeof b.visitReason === "string" ? b.visitReason : "",
  })

  return { status: result.success ? 200 : 500, json: result }
}
```

- [ ] **Step 2: Build and run handler tests — confirm they all pass**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm build:test 2>&1 | tail -5 && node --test build/tests-dist/web/src/lib/__tests__/openemr-push-handler.test.js
```

Expected: all 8 tests pass. If any fail, fix the handler before continuing.

- [ ] **Step 3: Create the thin Next.js route wrapper**

```typescript
// apps/web/src/app/api/integrations/openemr/push/route.ts
import { NextRequest, NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { pushNoteToOpenEMR } from "@/lib/openemr-client"
import { handlePushRequest } from "@/lib/openemr-push-handler"

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser()
  let body: unknown
  try { body = await req.json() } catch { body = null }

  const result = await handlePushRequest(
    { isAuthenticated: auth.ok },
    body,
    pushNoteToOpenEMR
  )

  if (!auth.ok && !result) return auth.response
  return NextResponse.json(result.json, { status: result.status })
}
```

- [ ] **Step 4: TypeScript check on the route**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i openemr
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/openemr-push-handler.ts apps/web/src/lib/__tests__/openemr-push-handler.test.ts apps/web/src/app/api/integrations/openemr/push/route.ts
git commit -m "feat(openemr): push handler + API route — 8 trust boundary tests passing"
```

**Summary of what changed:** `openemr-push-handler.ts` created with `handlePushRequest` — a pure function that takes auth context, body, and push function as arguments. 8 tests pass covering: auth guard stops unauthenticated calls, input guard stops missing fields, identity binding passes params unchanged. Route is a thin wrapper delegating to the handler.

---

## Chunk 4: Form and UI

### Task 6: New encounter form — conditional patient_id field

The form validation logic is simple enough to test through manual verification. The key trust boundary — "OPENEMR_ENABLED=true AND blank patientId blocks submission" — is best verified by running the app. There is no extractable pure logic that would benefit from a unit test beyond what's already covered in the handler tests.

**Files:**
- Modify: `packages/ui/src/components/new-encounter-form.tsx`

- [ ] **Step 1: Run the app and verify current behavior (baseline)**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev &
```

Open `http://localhost:3001`. Click "New Encounter". Confirm: no patient ID field exists today. This is the before state.

Kill the server: `kill %1`

- [ ] **Step 2: Write the minimal change**

Replace `new-encounter-form.tsx` with:

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

// Build-time constant — inlined by Next.js webpack. Changing requires a rebuild.
// Intentionally duplicated from note-editor.tsx (both are build-time constants in
// separate packages; a shared constant would require a new cross-package export for
// a single boolean — not worth the abstraction).
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
    onStart({ patient_name: patientName, patient_id: patientId, visit_reason: visitType })
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
            {VISIT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}
            className="flex-1 rounded-full text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button type="submit"
            className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90">
            <Mic className="mr-2 h-4 w-4" />
            Start Recording
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Start dev server and verify manually**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev &
```

**Without flag set (current `.env.local`):** Open `http://localhost:3001`, click "New Encounter".
- ✓ No patient ID field appears
- ✓ Form submits as before

**With flag set:** Add `NEXT_PUBLIC_OPENEMR_ENABLED=true` to `.env.local`, kill server, restart.
- ✓ "OpenEMR Patient ID" field appears
- ✓ Submitting blank shows: "OpenEMR Patient ID is required"
- ✓ Entering a value clears the error
- ✓ Form submits with the entered ID

Kill server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/new-encounter-form.tsx
git commit -m "feat(openemr): conditional required patient ID field in encounter form"
```

**Summary of what changed:** `new-encounter-form.tsx` now conditionally renders an "OpenEMR Patient ID" input when `NEXT_PUBLIC_OPENEMR_ENABLED=true`. Field is required — blank submission shows inline error. When flag is false, form is unchanged. `patient_id` now passes the entered value (was hardcoded `""`).

---

### Task 7: Note editor — Push to OpenEMR button

**Files:**
- Modify: `packages/pipeline/render/src/components/note-editor.tsx`

- [ ] **Step 1: Add `Upload` to the lucide-react import (line 9)**

```typescript
import { Save, Copy, Download, Check, AlertTriangle, Send, X, MessageSquare, Loader2, Upload } from "lucide-react"
```

- [ ] **Step 2: Add state declarations after the OpenClaw state block (after line 67)**

```typescript
type OpenEMRPushState = "idle" | "pushing" | "success" | "failed"
// Build-time constant. See comment in new-encounter-form.tsx.
const OPENEMR_ENABLED = process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"

const [openEMRPushState, setOpenEMRPushState] = useState<OpenEMRPushState>("idle")
const [openEMRError, setOpenEMRError] = useState("")
```

- [ ] **Step 3: Reset push state when encounter changes**

In the existing `useEffect` on `[encounter.id, encounter.note_text]`, add:

```typescript
setOpenEMRPushState("idle")
setOpenEMRError("")
```

- [ ] **Step 4: Replace `handleNoteChange` with error-dismissing version**

The existing function (around line 99):

```typescript
const handleNoteChange = (value: string) => {
  setNoteMarkdown(value)
  setHasChanges(true)
}
```

Replace with:

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

- [ ] **Step 5: Add the push handler after `handleExport`**

```typescript
const handlePushToOpenEMR = async () => {
  if (!noteMarkdown.trim() || !encounter.patient_id) return
  setOpenEMRPushState("pushing")
  setOpenEMRError("")

  try {
    const res = await fetch("/api/integrations/openemr/push", {
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
    const result = (await res.json()) as { success: boolean; id?: string; error?: string }

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

- [ ] **Step 6: Add button to toolbar (after OpenClaw button block, before Save button)**

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

- [ ] **Step 7: Add error display (after the OpenClaw error block)**

```tsx
{openEMRError && openEMRPushState === "failed" && (
  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>{openEMRError}</span>
  </div>
)}
```

- [ ] **Step 8: TypeScript check**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Verify manually (with `NEXT_PUBLIC_OPENEMR_ENABLED=true` in `.env.local`)**

Start dev server:
```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev &
```

- ✓ Button appears in toolbar when flag set
- ✓ Button disabled when note is empty
- ✓ Button disabled when `patient_id` is empty (old encounters)
- ✓ Push in-flight: spinner + "Pushing..." text, button disabled
- ✓ Success: checkmark + "Pushed to OpenEMR", resets to idle after 3s
- ✓ Failure: red error banner below editor
- ✓ Editing note while failed: error banner clears

Kill server: `kill %1`

- [ ] **Step 10: Commit**

```bash
git add packages/pipeline/render/src/components/note-editor.tsx
git commit -m "feat(openemr): Push to OpenEMR button with full state machine"
```

**Summary of what changed:** `note-editor.tsx` has a new "Push to OpenEMR" button gated on `NEXT_PUBLIC_OPENEMR_ENABLED`. State machine: idle → pushing → success/failed. Error banner clears on note edit. Button disabled when note empty, patient_id empty, or push in flight. All OpenClaw behavior unchanged.

---

## Chunk 5: End-to-End Verification

### Task 8: Smoke test against local OpenEMR

**Prerequisite:** Ask the developer to add values to `apps/web/.env.local` before this step:
```
OPENEMR_BASE_URL=http://localhost:8080
OPENEMR_CLIENT_ID=<from OpenEMR Admin → System → API Clients>
OPENEMR_CLIENT_SECRET=<client secret>
NEXT_PUBLIC_OPENEMR_ENABLED=true
```

- [ ] **Step 1: Start OpenEMR**

```bash
cd /Users/sammargolis/openemr-docker && docker compose up -d
```

Wait ~30 seconds, then verify FHIR is up:
```bash
curl -s http://localhost:8080/apis/default/fhir/metadata | python3 -m json.tool | head -5
```

Expected: FHIR CapabilityStatement JSON.

- [ ] **Step 2: Run the full test suite (no regressions)**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm test
```

Expected: all tests pass including the 19 new OpenEMR tests.

- [ ] **Step 3: Start OpenScribe**

```bash
cd /Users/sammargolis/projects/apps/OpenScribe && pnpm dev:local
```

- [ ] **Step 4: Create a test patient in OpenEMR**

Open `http://localhost:8080`, log in as `admin` / `adminpass`. Create a test patient. Note their numeric patient ID (visible in the URL after navigating to their chart, e.g. `/patient_dashboard/index/pid/1`).

- [ ] **Step 5: Create an encounter and push the note**

1. Open `http://localhost:3001`
2. Click "New Encounter", enter the patient ID from Step 4
3. Record a short encounter, wait for note generation
4. Click "Push to OpenEMR"
5. Verify button shows "Pushed to OpenEMR" ✓

- [ ] **Step 6: Verify DocumentReference in OpenEMR via FHIR API**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/oauth2/default/token \
  -d "grant_type=client_credentials&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&scope=system/DocumentReference.read" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

curl -s "http://localhost:8080/apis/default/fhir/DocumentReference?subject=Patient/<PATIENT_ID>" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep '"id"'
```

Expected: a DocumentReference entry with an `"id"` field.

- [ ] **Step 7: Test failure case**

In an existing encounter, temporarily enter a non-existent patient ID (e.g. `99999`), click "Push to OpenEMR". Verify the red error banner reads "Patient ID 99999 was not found in OpenEMR."

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat(openemr): integration verified end-to-end against local OpenEMR"
```
