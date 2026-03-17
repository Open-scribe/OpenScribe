/**
 * Trust boundary tests for openemr-client.ts
 *
 * Boundaries tested:
 *  ④ Credential boundary — JWT client assertion auth; auth failure stops execution
 *  ⑤ Patient resolution  — GET /apis/default/patient/{pid}; 404 / missing uuid stops execution
 *  ⑥ Identity binding    — pid in document URL, noteMarkdown in FormData file
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { describe, it, before, afterEach } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import {
  isOpenEMRConfigured,
  pushNoteToOpenEMR,
  _resetTokenCacheForTesting,
} from "../openemr-client.js"

// ---------------------------------------------------------------------------
// Test RSA key — generated once before all suites
// ---------------------------------------------------------------------------

let TEST_PRIVATE_KEY_PEM = ""

before(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  TEST_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit }
type FetchCallWithBody = FetchCall & {
  body?: Record<string, unknown>
  formData?: FormData
}

function makeFetch(responses: Response[]): {
  calls: FetchCallWithBody[]
  fn: typeof fetch
} {
  const calls: FetchCallWithBody[] = []
  let idx = 0
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString()
    let body: Record<string, unknown> | undefined
    let formData: FormData | undefined

    if (init?.body) {
      if (typeof init.body === "string") {
        // Try JSON first, then URL-encoded (token endpoint body)
        try {
          body = JSON.parse(init.body)
        } catch {
          try {
            body = Object.fromEntries(new URLSearchParams(init.body).entries())
          } catch {
            // not parseable
          }
        }
      } else if (init.body instanceof FormData) {
        formData = init.body as FormData
      }
    }

    calls.push({ url: urlStr, init, body, formData })
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

/** OpenEMR standard REST patient response */
function patientResp(pid: string, uuid: string): Response {
  return jsonResp(200, {
    validationErrors: [],
    internalErrors: [],
    data: { pid, uuid },
  })
}

/** OpenEMR standard REST document upload response */
function documentResp(id: string): Response {
  return jsonResp(200, {
    validationErrors: [],
    internalErrors: [],
    data: { id, uuid: id },
  })
}

function tokenResp(): Response {
  return jsonResp(200, { access_token: "tok-abc", expires_in: 3600 })
}

const PUSH_PARAMS = {
  patientId: "42",
  noteMarkdown: "# Note\nSOAP note content",
  patientName: "Jane Doe",
  visitReason: "Annual physical",
  encounterId: "enc-001",
}

const PATIENT_UUID = "550e8400-e29b-41d4-a716-446655440042"

// ---------------------------------------------------------------------------
// Configuration boundary
// ---------------------------------------------------------------------------

describe("isOpenEMRConfigured", () => {
  it("returns true when BASE_URL, CLIENT_ID, and JWT_PRIVATE_KEY_PEM are all set", () => {
    const saved = {
      OPENEMR_BASE_URL: process.env.OPENEMR_BASE_URL,
      OPENEMR_CLIENT_ID: process.env.OPENEMR_CLIENT_ID,
      OPENEMR_JWT_PRIVATE_KEY_PEM: process.env.OPENEMR_JWT_PRIVATE_KEY_PEM,
    }
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
    assert.equal(isOpenEMRConfigured(), true)
    // restore
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v
      else delete process.env[k]
    }
  })

  it("returns false when OPENEMR_BASE_URL is missing", () => {
    const orig = process.env.OPENEMR_BASE_URL
    delete process.env.OPENEMR_BASE_URL
    assert.equal(isOpenEMRConfigured(), false)
    if (orig !== undefined) process.env.OPENEMR_BASE_URL = orig
  })
})

describe("pushNoteToOpenEMR — configuration missing", () => {
  it("returns failure when OpenEMR is not configured", async () => {
    const orig = process.env.OPENEMR_BASE_URL
    delete process.env.OPENEMR_BASE_URL
    _resetTokenCacheForTesting()

    const result = await pushNoteToOpenEMR(PUSH_PARAMS)
    assert.equal(result.success, false)
    assert.ok(typeof result.error === "string" && result.error.length > 0)

    if (orig !== undefined) process.env.OPENEMR_BASE_URL = orig
  })
})

// ---------------------------------------------------------------------------
// Auth boundary (④)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — auth boundary ④", () => {
  before(() => {
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
    delete process.env.OPENEMR_CLIENT_SECRET
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

  it("token request uses JWT client assertion — not client_secret", async () => {
    const { calls, fn } = makeFetch([jsonResp(401, { error: "unauthorized" })])
    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const tokenCall = calls[0]
    assert.equal(
      tokenCall.body?.client_assertion_type,
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      "client_assertion_type must be JWT bearer"
    )
    assert.ok(
      typeof tokenCall.body?.client_assertion === "string" &&
        (tokenCall.body.client_assertion as string).split(".").length === 3,
      "client_assertion must be a 3-part JWT"
    )
    assert.equal(
      tokenCall.body?.client_secret,
      undefined,
      "client_secret must NOT appear in request body"
    )
  })

  it("reuses cached token on second call (token endpoint called only once across two pushes)", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      patientResp("42", PATIENT_UUID),
      documentResp("doc-1"),
      patientResp("42", PATIENT_UUID),
      documentResp("doc-2"),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const tokenCalls = calls.filter((c) => c.url.includes("/oauth2/"))
    assert.equal(tokenCalls.length, 1, "token endpoint should be called only once")
    assert.equal(calls.length, 5, "total: 1 token + 2 patient + 2 document")
  })
})

// ---------------------------------------------------------------------------
// Patient resolution boundary (⑤)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — patient boundary ⑤", () => {
  before(() => {
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("uses /apis/default/patient/{pid} (not FHIR) for patient lookup", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      jsonResp(404, { validationErrors: [], data: null }),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const patientCall = calls.find((c) => c.url.includes("/patient/"))
    assert.ok(patientCall, "patient lookup call should exist")
    assert.ok(
      patientCall.url.includes("/apis/default/patient/42"),
      `should call standard REST patient endpoint, got: ${patientCall.url}`
    )
    assert.ok(
      !patientCall.url.includes("/fhir/"),
      "must NOT use FHIR endpoint for patient lookup"
    )
  })

  it("returns patient_not_found and makes NO document write when patient lookup returns 404", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      jsonResp(404, { validationErrors: [], data: null }),
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, false)
    assert.ok(result.error?.includes("42"), `error should contain patientId, got: ${result.error}`)
    const docCalls = calls.filter((c) => c.url.includes("/document"))
    assert.equal(docCalls.length, 0, "must not write document when patient not found")
  })

  it("returns patient_not_found when patient response has no uuid", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      jsonResp(200, { validationErrors: [], data: { pid: "42" } }), // uuid missing
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, false)
    assert.ok(result.error?.includes("42"))
    const docCalls = calls.filter((c) => c.url.includes("/document"))
    assert.equal(docCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Identity binding (⑥)
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — identity binding ⑥", () => {
  before(() => {
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("document upload URL contains the numeric patient pid", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      patientResp("42", PATIENT_UUID),
      documentResp("doc-uuid-1"),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const docCall = calls.find((c) => c.url.includes("/document"))
    assert.ok(docCall, "document upload call should exist")
    assert.ok(
      docCall.url.includes("/apis/default/patient/42/document"),
      `document URL should contain pid, got: ${docCall?.url}`
    )
  })

  it("note markdown appears verbatim in FormData file", async () => {
    const { calls, fn } = makeFetch([
      tokenResp(),
      patientResp("42", PATIENT_UUID),
      documentResp("doc-uuid-1"),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const docCall = calls.find((c) => c.url.includes("/document"))
    assert.ok(docCall?.formData, "document upload must use FormData body")

    const file = docCall.formData.get("file") as File
    assert.ok(file, "FormData must contain 'file' entry")
    const text = await file.text()
    assert.equal(text, PUSH_PARAMS.noteMarkdown, "file content must equal original noteMarkdown")
  })

  it("returns success:true and the document id on success", async () => {
    const { fn } = makeFetch([
      tokenResp(),
      patientResp("42", PATIENT_UUID),
      documentResp("doc-uuid-777"),
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    assert.equal(result.success, true)
    assert.equal((result as { success: true; id: string }).id, "doc-uuid-777")
  })
})

// ---------------------------------------------------------------------------
// Network / timeout
// ---------------------------------------------------------------------------

describe("pushNoteToOpenEMR — network failures", () => {
  before(() => {
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
  })

  afterEach(() => {
    _resetTokenCacheForTesting()
  })

  it("returns network error message on ECONNREFUSED", async () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), {
      code: "ECONNREFUSED",
    })
    const fn = async () => { throw err }

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn as unknown as typeof fetch)

    assert.equal(result.success, false)
    assert.ok(
      result.error?.toLowerCase().includes("reach"),
      `error should mention 'reach', got: ${result.error}`
    )
  })

  it("returns timeout error message on AbortError", async () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    const fn = async () => { throw err }

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn as unknown as typeof fetch)

    assert.equal(result.success, false)
    assert.ok(
      result.error?.toLowerCase().includes("timed out"),
      `error should mention 'timed out', got: ${result.error}`
    )
  })
})
