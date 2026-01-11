/**
 * Debug logging utility that gates PHI-sensitive console output behind an environment flag.
 * 
 * NEVER use console.log directly for PHI data. Use these functions instead.
 * They will only output in development when NEXT_PUBLIC_ENABLE_DEBUG_LOGS=true.
 * 
 * @example
 * debugLog("Processing transcript:", transcript.length, "chars") // Safe: only logs length
 * debugLogPHI("Full transcript:", transcript) // Gated: only in dev with flag enabled
 */

const isDebugEnabled = (): boolean => {
  // Only enable debug logging when explicitly set to "true"
  // In production builds, this should always be disabled
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === "true") {
    return true
  }
  return false
}

/**
 * Log non-PHI debug information. Use for metadata like counts, IDs, status.
 * This will always log in development mode but never in production.
 */
export function debugLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === "development") {
    console.log(...args)
  }
}

/**
 * Log PHI-sensitive information (patient names, transcripts, clinical notes).
 * Only logs when NEXT_PUBLIC_ENABLE_DEBUG_LOGS=true AND in development mode.
 * NEVER use this in production.
 */
export function debugLogPHI(...args: unknown[]): void {
  if (process.env.NODE_ENV === "development" && isDebugEnabled()) {
    console.log("[PHI DEBUG]", ...args)
  }
}

/**
 * Log errors. Always enabled regardless of debug flags.
 */
export function debugError(...args: unknown[]): void {
  console.error(...args)
}

/**
 * Log warnings. Always enabled regardless of debug flags.
 */
export function debugWarn(...args: unknown[]): void {
  console.warn(...args)
}
