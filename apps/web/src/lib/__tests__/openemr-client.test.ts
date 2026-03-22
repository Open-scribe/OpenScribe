import { afterEach, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import { mkdtempSync } from "node:fs"
import {
  _resetTokenCacheForTesting,
  getOpenEMRPushStatus,
  isOpenEMRConfigured,
  pushNoteToOpenEMR,
} from "../openemr-client.js"

type FetchCall = {
  url: string
  init?: RequestInit
  body?: Record<string, unknown>
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function makeFetch(responses: Response[]): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let index = 0
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString()
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        try {
          body = Object.fromEntries(new URLSearchParams(init.body).entries())
        } catch {
          body = undefined
        }
      }
    }
    calls.push({ url: urlStr, init, body })
    const response = responses[index++]
    if (!response) {
      throw new Error(`Unexpected fetch call #${index} to ${urlStr}`)
    }
    return response
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

const PUSH_PARAMS = {
  patientId: "a1392bc9-b9b8-4dc0-aa48-d1df64f98773",
  noteMarkdown:
    "# Clinical Note\n\n## Chief Complaint\nPatient reports mild headache and dizziness for several days with intermittent nausea.\n\n## History of Present Illness\nSymptoms started three days ago, worsen with sudden position changes, and improve with rest and hydration.",
  patientName: "Jane Doe",
  visitReason: "annual_exam",
  encounterId: "enc-1",
}

let TEST_PRIVATE_KEY_PEM = ""

before(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  TEST_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string
})

afterEach(() => {
  _resetTokenCacheForTesting()
})

describe("isOpenEMRConfigured", () => {
  it("returns true when required env vars are set", () => {
    const saved = {
      OPENEMR_BASE_URL: process.env.OPENEMR_BASE_URL,
      OPENEMR_CLIENT_ID: process.env.OPENEMR_CLIENT_ID,
      OPENEMR_JWT_PRIVATE_KEY_PEM: process.env.OPENEMR_JWT_PRIVATE_KEY_PEM,
    }
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
    assert.equal(isOpenEMRConfigured(), true)
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
})

describe("pushNoteToOpenEMR", () => {
  before(() => {
    process.env.OPENEMR_BASE_URL = "http://localhost:8080"
    process.env.OPENEMR_CLIENT_ID = "test-client-id"
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_PEM
    process.env.OPENEMR_TOKEN_SCOPE = "system/DocumentReference.write system/Patient.read"
    delete process.env.OPENEMR_CLIENT_SECRET
  })

  beforeEach(() => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "openemr-client-test-"))
    process.env.OPENEMR_AUTH_STATE_FILE = path.join(tmpDir, "state.json")
    delete process.env.OPENEMR_USER_REFRESH_TOKEN
    delete process.env.OPENEMR_USER_TOKEN_SCOPE
  })

  it("returns auth failure when token exchange fails", async () => {
    const { fn, calls } = makeFetch([jsonResp(401, { error: "unauthorized" })])
    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    assert.equal(result.success, false)
    assert.ok(result.error?.includes("authentication failed"))
    assert.equal(calls.length, 1)
  })

  it("token request uses JWT assertion and not client_secret", async () => {
    const { fn, calls } = makeFetch([jsonResp(401, { error: "unauthorized" })])
    await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    const body = calls[0]?.body
    assert.equal(body?.grant_type, "client_credentials")
    assert.equal(
      body?.client_assertion_type,
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    )
    assert.equal(body?.scope, "system/DocumentReference.write system/Patient.read")
    assert.equal(body?.client_secret, undefined)
    assert.ok(
      typeof body?.client_assertion === "string" &&
        (body.client_assertion as string).split(".").length === 3,
    )
  })

  it("reuses cached token on second push", async () => {
    const { fn, calls } = makeFetch([
      jsonResp(200, { access_token: "tok", expires_in: 3600 }),
      jsonResp(200, {
        rest: [{ resource: [{ type: "DocumentReference", interaction: [{ code: "create" }] }] }],
      }),
      jsonResp(200, { resourceType: "Patient", id: PUSH_PARAMS.patientId }),
      jsonResp(201, { id: "doc-1" }),
      jsonResp(200, { resourceType: "Patient", id: PUSH_PARAMS.patientId }),
      jsonResp(201, { id: "doc-2" }),
    ])

    await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    await pushNoteToOpenEMR(PUSH_PARAMS, fn)

    const tokenCalls = calls.filter((call) => call.url.includes("/oauth2/"))
    assert.equal(tokenCalls.length, 1)
  })

  it("rejects non-UUID patient ids before network calls", async () => {
    const { fn, calls } = makeFetch([])
    const result = await pushNoteToOpenEMR({ ...PUSH_PARAMS, patientId: "abc" }, fn)
    assert.equal(result.success, false)
    assert.ok(result.error?.includes("numeric PID"))
    assert.equal(calls.length, 0)
  })

  it("supports numeric PID when user refresh-token mode is enabled", async () => {
    process.env.OPENEMR_USER_REFRESH_TOKEN = "test-refresh"
    process.env.OPENEMR_USER_TOKEN_SCOPE = "api:oemr user/document.write user/document.read user/patient.read"

    const { fn, calls } = makeFetch([
      jsonResp(200, { access_token: "user-tok", expires_in: 3600 }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(500, { error: "RestControllerHelper::getResponseForPayload() expects a string, array, numeric, or JsonSerializable object, bool given." }),
      jsonResp(200, [{ filename: "openscribe-note-final.txt", id: 123 }]),
      jsonResp(200, [{ filename: "openscribe-note-final.txt", id: 123 }]),
    ])

    const result = await pushNoteToOpenEMR({ ...PUSH_PARAMS, patientId: "3" }, fn)
    assert.equal(result.success, true, JSON.stringify(result))
    assert.equal((result as { success: true; id: string }).id, "123")
    assert.equal((result as { success: true; verifiedLength: number }).verifiedLength, PUSH_PARAMS.noteMarkdown.length)
    const resolveCalls = calls.filter((call) => call.url.endsWith("/api/patient/3"))
    assert.equal(resolveCalls.length, 1)

    delete process.env.OPENEMR_USER_REFRESH_TOKEN
    delete process.env.OPENEMR_USER_TOKEN_SCOPE
  })

  it("verifies latest uploaded doc id when filename already exists", async () => {
    process.env.OPENEMR_USER_REFRESH_TOKEN = "test-refresh"
    process.env.OPENEMR_USER_TOKEN_SCOPE = "api:oemr user/document.write user/document.read user/patient.read"

    const { fn } = makeFetch([
      jsonResp(200, { access_token: "user-tok", expires_in: 3600 }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(500, {
        error:
          "RestControllerHelper::getResponseForPayload() expects a string, array, numeric, or JsonSerializable object, bool given.",
      }),
      jsonResp(200, [
        { filename: "openscribe-note-final.txt", id: 15 },
        { filename: "openscribe-note-final.txt", id: 18 },
      ]),
      jsonResp(200, [{ filename: "openscribe-note-final.txt", id: 18 }]),
    ])

    const result = await pushNoteToOpenEMR({ ...PUSH_PARAMS, patientId: "3" }, fn)
    assert.equal(result.success, true, JSON.stringify(result))
    assert.equal((result as { success: true; id: string }).id, "18")

    delete process.env.OPENEMR_USER_REFRESH_TOKEN
    delete process.env.OPENEMR_USER_TOKEN_SCOPE
  })

  it("fails with OPENEMR_NOTE_TOO_SHORT when note quality gate is not met", async () => {
    const { fn, calls } = makeFetch([])
    const result = await pushNoteToOpenEMR(
      {
        ...PUSH_PARAMS,
        patientId: "3",
        noteMarkdown: "too short",
      },
      fn,
    )
    assert.equal(result.success, false)
    assert.equal((result as { success: false; code?: string }).code, "OPENEMR_NOTE_TOO_SHORT")
    assert.equal(calls.length, 0)
  })

  it("status returns blockers when note and patient id are invalid", async () => {
    const status = await getOpenEMRPushStatus({ patientId: "bad-id", noteMarkdown: "short" })
    assert.equal(status.patient_id_valid, false)
    assert.equal(status.note_ok, false)
    assert.equal(status.can_push, false)
    assert.ok(status.blockers.some((b) => b.code === "OPENEMR_PATIENT_ID_INVALID"))
    assert.ok(status.blockers.some((b) => b.code === "OPENEMR_NOTE_TOO_SHORT"))
  })

  it("returns patient not found when Patient endpoint fails", async () => {
    const { fn, calls } = makeFetch([
      jsonResp(200, { access_token: "tok", expires_in: 3600 }),
      jsonResp(404, { error: "not found" }),
      jsonResp(404, { error: "not found" }),
    ])
    const result = await pushNoteToOpenEMR({ ...PUSH_PARAMS, patientId: "3" }, fn)
    assert.equal(result.success, false)
    assert.ok(result.error?.includes("3"))
    const docCalls = calls.filter((call) => call.url.includes("/DocumentReference"))
    assert.equal(docCalls.length, 0)
  })

  it("returns explicit error when server does not support DocumentReference create", async () => {
    const { fn, calls } = makeFetch([
      jsonResp(200, { access_token: "tok", expires_in: 3600 }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(500, { error: "upload failed" }),
      jsonResp(200, {
        rest: [{ resource: [{ type: "DocumentReference", interaction: [{ code: "read" }] }] }],
      }),
    ])
    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    assert.equal(result.success, false)
    assert.ok(result.error?.includes("does not support"))
    assert.equal(calls.length, 5)
  })

  it("binds patient id and note markdown in DocumentReference payload", async () => {
    const { fn, calls } = makeFetch([
      jsonResp(200, { access_token: "tok", expires_in: 3600 }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(200, { data: { id: 3 } }),
      jsonResp(500, { error: "upload failed" }),
      jsonResp(200, {
        rest: [{ resource: [{ type: "DocumentReference", interaction: [{ code: "create" }] }] }],
      }),
      jsonResp(200, { resourceType: "Patient", id: PUSH_PARAMS.patientId }),
      jsonResp(201, { id: "doc-777" }),
    ])

    const result = await pushNoteToOpenEMR(PUSH_PARAMS, fn)
    assert.equal(result.success, true)
    assert.equal((result as { success: true; id: string }).id, "doc-777")

    const docCall = calls.find((call) => call.url.endsWith("/fhir/DocumentReference"))
    assert.ok(docCall?.body)
    const payload = docCall.body as Record<string, unknown>
    assert.equal((payload.subject as { reference: string }).reference, `Patient/${PUSH_PARAMS.patientId}`)
    const attachment = (
      (
        (payload.content as Array<{ attachment: { data: string } }>)[0] ?? {
          attachment: { data: "" },
        }
      ).attachment
    )
    const decoded = Buffer.from(attachment.data, "base64").toString("utf8")
    assert.equal(decoded, PUSH_PARAMS.noteMarkdown)
  })
})
