import assert from "node:assert/strict"
import test from "node:test"
import {
  createFinalUploadFailure,
  toFinalUploadWorkflowError,
  createPipelineError,
  PipelineStageError,
  isPipelineError,
  toPipelineError,
  type PipelineError,
} from "../index.js"

test("server-provided PipelineError preserves code, recoverable, and details through catch", () => {
  const serverError = new PipelineStageError(
    "transcription_limit_exceeded",
    "Monthly transcription limit reached",
    false,
    { limit: 1000, used: 1000 },
  )

  let caughtError: unknown
  try {
    throw serverError
  } catch (error) {
    caughtError = error
  }

  assert.ok(isPipelineError(caughtError), "caught error should pass isPipelineError check")

  const pe = caughtError as PipelineStageError
  assert.equal(pe.code, "transcription_limit_exceeded")
  assert.equal(pe.message, "Monthly transcription limit reached")
  assert.equal(pe.recoverable, false, "unrecoverable error must stay unrecoverable")
  assert.deepEqual(pe.details, { limit: 1000, used: 1000 })
})

test("toPipelineError does not overwrite when input is already a PipelineError", () => {
  const original = new PipelineStageError("auth_error", "Token expired", false, { userId: "abc" })

  const result = toPipelineError(original, {
    code: "api_error",
    message: "Generic fallback",
    recoverable: true,
  })

  assert.equal(result.code, "auth_error")
  assert.equal(result.message, "Token expired")
  assert.equal(result.recoverable, false, "must not reclassify to recoverable")
  assert.deepEqual(result.details, { userId: "abc" })
})

test("final-upload failure propagation keeps server error unchanged in workflow state", () => {
  const serverError = createPipelineError(
    "transcription_limit_exceeded",
    "Monthly transcription limit reached",
    false,
    { limit: 1000, used: 1000 },
  )
  const failure = createFinalUploadFailure(400, serverError)
  let workflowError: PipelineError | null = null
  if (failure.parsedError) {
    workflowError = failure.parsedError
  }
  const normalizedFromCatch = toFinalUploadWorkflowError(failure.error)
  assert.ok(isPipelineError(workflowError), "workflow error should remain a PipelineError")
  assert.equal(normalizedFromCatch, null, "catch should not re-normalize existing PipelineError")
  assert.equal(workflowError?.code, "transcription_limit_exceeded")
  assert.equal(workflowError?.message, "Monthly transcription limit reached")
  assert.equal(workflowError?.recoverable, false)
  assert.deepEqual(workflowError?.details, { limit: 1000, used: 1000 })
})
