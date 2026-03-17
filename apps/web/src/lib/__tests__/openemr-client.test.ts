/**
 * Trust boundary tests for openemr-client.ts
 *
 * Boundaries tested:
 *  ④ Credential boundary — auth failure stops execution
 *  ⑤ Patient existence check — 404 stops before FHIR write
 *  ⑥ Identity binding — patientId/noteMarkdown/fields reach the FHIR payload verbatim
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { describe, it, before, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  isOpenEMRConfigured,
  pushNoteToOpenEMR,
  _resetTokenCacheForTesting,
} from "../openemr-client.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit }
type FetchCallWithBody = FetchCall & { body?: Record<string, unknown> }

function makeFetch(responses: Response[]): {
  calls: FetchCallWithBody[]
  fn: typeof fetch
} {
  const calls: FetchCallWithBody[] = []
  let idx = 0
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString()
    let body: Record<string, unknown> | undefined
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        // not JSON
      }
    }
    calls.push({ url: urlStr, init, body })
    const resp = responses[idx++]
    if (!resp) throw new Error(`Unexpected fetch call #${idx} to ${urlStr}`)
    return resp
  }
  return { calls, fn: fn as unknown as typeof fetch }
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const BASE_ENV = {
  OPENEMR_BASE_URL: "http://localhost:8080",
  OPENEMR_CLIENT_ID: "test-client-id",
  OPENEMR_CLIENT_SECRET: "test-client-secret",
}

const PUSH_PARAMS = {
  patientId: "42",
  noteMarkdown: "# Note\nSOAP note content",
  patientName: "Jane Doe",
  visitReason: "Annual physical",
  encounterId: "enc-001",
}

// ---------------------------------------------------------------------------
// Configuration boundary
// ---------------------------------------------------------------------------

describe("isOpenEMRConfigured", () => {
  it("returns true when all three env vars are set", () => {
    const orig = { ...process.env }
    Object.assign(process.env, BASE_ENV)
    assert.equal(isOpenEMRConfigured(), true)
    Object.assign(process.env, orig)
    // restore deletions
    if (!orig.OPENEMR_BASE_URL) delete process.env.OPENEMR_BASE_URL
    if (!orig.OPENEMR_CLIENT_ID) delete process.env.OPENEMR_CLIENT_ID
    if (!orig.OPENEMR_CLIENT_SECRET) delete process.env.OPENEMR_CLIENT_SECRET
  })

  it("returns false when any env var is missing", () => {
    const origUrl = process.env.OPENEMR_BASE_URL
    delete process.env.OPENEMR_BASE_URL
    assert.equal(isOpenEMRConfigured(), false)
    if (origUrl) process.env.OPENEMR_BASE_URL = origUrl
  })
})

describe("pushNoteToOpenEMR — configuration missing", () => {
  it("returns failure when OpenEMR is not configured", async () => {
    const origUrl = process.env.OPENEMR_BASE_URL
    delete process.env.OPENEMR_BASE_URL
    _resetTokenCacheForTesting()

    const result = await pushNoteToOpenEMR(PUSH_PARAMS)
    assert.equal(result.success, false)
    assert.ok(
      typeof result.error === "string" && result.error.length > 0,
      "error message should be non-empty"
    )

    if (origUrl) process.env.OPENEMR_BASE_URL = origUrl
  })
})

// ---------------------------------------------------------------------------
// Auth boundary (④)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — auth boundary ④", () => {
  before(() => {
    Object.assign(process.env, BASE_ENV)
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("returns auth_failure and makes only the token call when token fetch returns 401", async () => {
    const { calls, fn } = makeFetch([jsonResp(401, { error: "unauthorized" })])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, false)
    assert.ok(result.error?.includes("authentication failed"), `error was: ${result.error}`)
    assert.equal(calls.length, 1, "should stop after token call")
    assert.ok(calls[0].url.includes("/oauth2/"), `first call should be token endpoint, got: ${calls[0].url}`)
  })

  it("reuses cached token on second call (token endpoint called only once across two pushes)", async () => {
    const tokenResp = jsonResp(200, { access_token: "tok-abc", expires_in: 3600 })
    const patientResp1 = jsonResp(200, { resourceType: "Patient", id: "42" })
    const fhirResp1 = jsonResp(201, { resourceType: "DocumentReference", id: "doc-1" })
    const patientResp2 = jsonResp(200, { resourceType: "Patient", id: "42" })
    const fhirResp2 = jsonResp(201, { resourceType: "DocumentReference", id: "doc-2" })

    const { calls, fn } = makeFetch([tokenResp, patientResp1, fhirResp1, patientResp2, fhirResp2])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const tokenCalls = calls.filter((c) => c.url.includes("/oauth2/"))
    assert.equal(tokenCalls.length, 1, "token endpoint should be called only once")
    assert.equal(calls.length, 5, "total calls: 1 token + 2 patient + 2 fhir")
  })
})

// ---------------------------------------------------------------------------
// Patient existence boundary (⑤)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — patient boundary ⑤", () => {
  before(() => {
    Object.assign(process.env, BASE_ENV)
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("returns patient_not_found and makes NO FHIR write when patient lookup returns 404", async () => {
    const { calls, fn } = makeFetch([
      jsonResp(200, { access_token: "tok-abc", expires_in: 3600 }),
      jsonResp(404, { resourceType: "OperationOutcome" }),
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, false)
    assert.ok(result.error?.includes("42"), `error should contain patientId, got: ${result.error}`)
    const fhirCalls = calls.filter((c) => c.url.includes("/DocumentReference"))
    assert.equal(fhirCalls.length, 0, "must not write DocumentReference when patient not found")
  })
})

// ---------------------------------------------------------------------------
// Identity binding (⑥)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — identity binding ⑥", () => {
  before(() => {
    Object.assign(process.env, BASE_ENV)
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("binds patientId to subject.reference in DocumentReference payload", async () => {
    const { calls, fn } = makeFetch([
      jsonResp(200, { access_token: "tok-abc", expires_in: 3600 }),
      jsonResp(200, { resourceType: "Patient", id: "42" }),
      jsonResp(201, { resourceType: "DocumentReference", id: "doc-999" }),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const fhirCall = calls.find((c) => c.url.includes("/DocumentReference"))
    assert.ok(fhirCall, "DocumentReference call should exist")
    const subject = fhirCall?.body?.subject as { reference?: string } | undefined
    assert.equal(
      subject?.reference,
      "Patient/42",
      "subject.reference must equal Patient/{patientId}"
    )
  })

  it("base64-encodes noteMarkdown verbatim in attachment.data", async () => {
    const { calls, fn } = makeFetch([
      jsonResp(200, { access_token: "tok-abc", expires_in: 3600 }),
      jsonResp(200, { resourceType: "Patient", id: "42" }),
      jsonResp(201, { resourceType: "DocumentReference", id: "doc-999" }),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const fhirCall = calls.find((c) => c.url.includes("/DocumentReference"))
    const content = fhirCall?.body?.content as Array<{ attachment: { data: string; contentType: string } }>
    assert.ok(Array.isArray(content) && content.length > 0, "content array must exist")
    const attachment = content[0].attachment
    assert.equal(attachment.contentType, "text/markdown")
    const decoded = Buffer.from(attachment.data, "base64").toString("utf8")
    assert.equal(decoded, PUSH_PARAMS.noteMarkdown, "decoded attachment must equal original noteMarkdown")
  })

  it("includes US Core clinical-note category and status:current", async () => {
    const { calls, fn } = makeFetch([
      jsonResp(200, { access_token: "tok-abc", expires_in: 3600 }),
      jsonResp(200, { resourceType: "Patient", id: "42" }),
      jsonResp(201, { resourceType: "DocumentReference", id: "doc-999" }),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const fhirCall = calls.find((c) => c.url.includes("/DocumentReference"))
    const body = fhirCall?.body as Record<string, unknown>
    assert.equal(body?.status, "current")
    const category = body?.category as Array<{ coding: Array<{ code: string }> }>
    assert.ok(Array.isArray(category) && category.length > 0, "category must exist")
    assert.equal(
      category[0].coding[0].code,
      "clinical-note",
      "US Core clinical-note category code must be present"
    )
  })

  it("returns success:true and the DocumentReference id on success", async () => {
    const { fn } = makeFetch([
      jsonResp(200, { access_token: "tok-abc", expires_in: 3600 }),
      jsonResp(200, { resourceType: "Patient", id: "42" }),
      jsonResp(201, { resourceType: "DocumentReference", id: "doc-777" }),
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, true)
    assert.equal((result as { success: true; id: string }).id, "doc-777")
  })
})

// ---------------------------------------------------------------------------
// Network / timeout
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — network failures", () => {
  before(() => {
    Object.assign(process.env, BASE_ENV)
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("returns network error message on ECONNREFUSED", async () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), { code: "ECONNREFUSED" })
    const fn = async () => { throw err }

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn as unknown as typeof fetch)

    assert.equal(result.success, false)
    assert.ok(result.error?.toLowerCase().includes("reach"), `error should mention 'reach', got: ${result.error}`)
  })

  it("returns timeout error message on AbortError", async () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    const fn = async () => { throw err }

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn as unknown as typeof fetch)

    assert.equal(result.success, false)
    assert.ok(result.error?.toLowerCase().includes("timed out"), `error should mention 'timed out', got: ${result.error}`)
  })
})
