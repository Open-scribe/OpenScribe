type LogLevel = "info" | "warn" | "error"

function toSafeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata) return {}
  const redactedKeys = new Set(["transcript", "note", "patient_name", "patient_id", "audio", "file", "text"])
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    safe[key] = redactedKeys.has(key.toLowerCase()) ? "[REDACTED]" : value
  }
  return safe
}

export function logServer(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    metadata: toSafeMetadata(metadata),
    ts: new Date().toISOString(),
  }

  if (level === "error") {
    console.error(JSON.stringify(payload))
    return
  }
  if (level === "warn") {
    console.warn(JSON.stringify(payload))
    return
  }
  console.log(JSON.stringify(payload))
}
