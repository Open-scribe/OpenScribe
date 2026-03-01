import {
  isPipelineError,
  PipelineStageError,
  toPipelineError,
  type PipelineError,
} from "./error"

export function createFinalUploadFailure(
  responseStatus: number,
  serverError: unknown,
): {
  parsedError: PipelineError | null
  error: PipelineStageError
} {
  if (isPipelineError(serverError)) {
    return {
      parsedError: serverError,
      error: new PipelineStageError(
        serverError.code,
        serverError.message,
        serverError.recoverable,
        serverError.details,
      ),
    }
  }

  const retryable = responseStatus === 429 || responseStatus >= 500
  return {
    parsedError: null,
    error: new PipelineStageError(
      "api_error",
      `Final upload failed (${responseStatus})`,
      retryable,
    ),
  }
}

export function toFinalUploadWorkflowError(error: unknown): PipelineError | null {
  if (isPipelineError(error)) {
    return null
  }

  return toPipelineError(error, {
    code: "api_error",
    message: "Failed to upload final recording",
    recoverable: true,
  })
}
