export interface PipelineError {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, unknown>
}

export class PipelineStageError extends Error implements PipelineError {
  code: string
  recoverable: boolean
  details?: Record<string, unknown>

  constructor(code: string, message: string, recoverable: boolean, details?: Record<string, unknown>) {
    super(message)
    this.name = "PipelineStageError"
    this.code = code
    this.recoverable = recoverable
    this.details = details
  }
}

export function createPipelineError(
  code: string,
  message: string,
  recoverable: boolean,
  details?: Record<string, unknown>,
): PipelineError {
  return { code, message, recoverable, details }
}

export function isPipelineError(error: unknown): error is PipelineError {
  if (!error || typeof error !== "object") return false
  const candidate = error as Partial<PipelineError>
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.recoverable === "boolean"
  )
}

export function toPipelineError(
  error: unknown,
  fallback: {
    code: string
    message: string
    recoverable: boolean
    details?: Record<string, unknown>
  },
): PipelineError {
  if (error instanceof PipelineStageError) {
    return createPipelineError(error.code, error.message, error.recoverable, error.details)
  }

  if (isPipelineError(error)) {
    return createPipelineError(error.code, error.message, error.recoverable, error.details)
  }

  if (error instanceof Error) {
    return createPipelineError(
      fallback.code,
      error.message || fallback.message,
      fallback.recoverable,
      fallback.details,
    )
  }

  return createPipelineError(
    fallback.code,
    typeof error === "string" ? error : fallback.message,
    fallback.recoverable,
    fallback.details,
  )
}

export function toPipelineStageError(
  error: unknown,
  fallback: {
    code: string
    message: string
    recoverable: boolean
    details?: Record<string, unknown>
  },
): PipelineStageError {
  if (error instanceof PipelineStageError) {
    return error
  }
  const normalized = toPipelineError(error, fallback)
  return new PipelineStageError(normalized.code, normalized.message, normalized.recoverable, normalized.details)
}
