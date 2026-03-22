/**
 * Trust boundary tests for openemr-push-handler.ts
 *
 * Boundaries tested:
 *  ① Auth identity check  — unauthenticated requests return 401 before any push
 *  ② Input validation     — missing required fields return 400 before any push
 *  ③ Identity binding     — all 4 params flow to pushFn unchanged
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { handlePushRequest } from "../openemr-push-handler.js"
import type { PushResult } from "../openemr-client.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePushFn(result: PushResult) {
  let called = false
  let calledWith: unknown = null
  const fn = async (params: unknown) => {
    called = true
    calledWith = params
    return result
  }
  return {
    fn: fn as Parameters<typeof handlePushRequest>[2],
    wasCalled: () => called,
    calledWith: () => calledWith,
  }
}

const AUTHENTICATED = { isAuthenticated: true }
const UNAUTHENTICATED = { isAuthenticated: false }

const VALID_BODY = {
  encounterId: "enc-001",
  patientId: "42",
  noteMarkdown: "# Note",
  patientName: "Jane Doe",
  visitReason: "Annual physical",
}

// ---------------------------------------------------------------------------
// Auth boundary (①)
// ---------------------------------------------------------------------------

describe("handlePushRequest — auth boundary ①", () => {
  it("returns 401 when not authenticated", async () => {
    const { fn, wasCalled } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    const result = await handlePushRequest(UNAUTHENTICATED, VALID_BODY, fn)
    assert.equal(result.status, 401)
    assert.equal(wasCalled(), false, "pushFn must not be called when unauthenticated")
  })

  it("proceeds past auth check when authenticated", async () => {
    const { fn, wasCalled } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    const result = await handlePushRequest(AUTHENTICATED, VALID_BODY, fn)
    assert.equal(result.status, 200)
    assert.equal(wasCalled(), true)
  })
})

// ---------------------------------------------------------------------------
// Input guard (②)
// ---------------------------------------------------------------------------

describe("handlePushRequest — input guard ②", () => {
  it("returns 400 when body is null", async () => {
    const { fn, wasCalled } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    const result = await handlePushRequest(AUTHENTICATED, null, fn)
    assert.equal(result.status, 400)
    assert.equal(wasCalled(), false)
  })

  it("returns 400 when patientId is missing", async () => {
    const { fn, wasCalled } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    const body = { ...VALID_BODY, patientId: undefined }
    const result = await handlePushRequest(AUTHENTICATED, body, fn)
    assert.equal(result.status, 400)
    assert.equal(wasCalled(), false)
  })

  it("returns 400 when noteMarkdown is missing", async () => {
    const { fn, wasCalled } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    const body = { ...VALID_BODY, noteMarkdown: undefined }
    const result = await handlePushRequest(AUTHENTICATED, body, fn)
    assert.equal(result.status, 400)
    assert.equal(wasCalled(), false)
  })
})

// ---------------------------------------------------------------------------
// Identity binding (③)
// ---------------------------------------------------------------------------

describe("handlePushRequest — identity binding ③", () => {
  it("passes all 4 required fields to pushFn unchanged", async () => {
    const { fn, calledWith } = makePushFn({
      success: true,
      id: "doc-1",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 123,
      openEMRDocumentUrl: null,
    })
    await handlePushRequest(AUTHENTICATED, VALID_BODY, fn)
    const params = calledWith() as Record<string, unknown>
    assert.equal(params.patientId, VALID_BODY.patientId)
    assert.equal(params.noteMarkdown, VALID_BODY.noteMarkdown)
    assert.equal(params.patientName, VALID_BODY.patientName)
    assert.equal(params.visitReason, VALID_BODY.visitReason)
  })
})

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

describe("handlePushRequest — response shape", () => {
  it("returns 200 with id on success", async () => {
    const { fn } = makePushFn({
      success: true,
      id: "doc-777",
      uploadedAt: "2026-03-17T00:00:00.000Z",
      verifiedPreview: "preview",
      verifiedLength: 456,
      openEMRDocumentUrl: "http://localhost:8080/controller.php?document&retrieve&patient_id=3&document_id=777&",
    })
    const result = await handlePushRequest(AUTHENTICATED, VALID_BODY, fn)
    assert.equal(result.status, 200)
    const json = result.json as {
      success: boolean
      id: string
      uploadedAt: string
      verifiedPreview: string
      verifiedLength: number
      openEMRDocumentUrl: string | null
    }
    assert.equal(json.success, true)
    assert.equal(json.id, "doc-777")
    assert.equal(json.verifiedLength, 456)
    assert.equal(json.verifiedPreview, "preview")
  })

  it("returns 500 with error on push failure", async () => {
    const { fn } = makePushFn({
      success: false,
      error: "Patient not found",
      code: "OPENEMR_PATIENT_NOT_FOUND",
    })
    const result = await handlePushRequest(AUTHENTICATED, VALID_BODY, fn)
    assert.equal(result.status, 500)
    const json = result.json as { success: boolean; error: string; code: string }
    assert.equal(json.success, false)
    assert.equal(json.error, "Patient not found")
    assert.equal(json.code, "OPENEMR_PATIENT_NOT_FOUND")
  })
})
