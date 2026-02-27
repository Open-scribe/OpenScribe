import { toPipelineError, type PipelineError } from "../../shared/src/error"

export function toAudioIngestError(error: unknown, code: "capture_error" | "processing_error"): PipelineError {
  return toPipelineError(error, {
    code,
    message: code === "capture_error" ? "Failed to start audio capture" : "Failed to finalize recording",
    recoverable: true,
  })
}
