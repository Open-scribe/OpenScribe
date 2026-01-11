import { useEffect, useState } from "react"

/**
 * HIPAA Compliance: Detect non-HTTPS connections in production builds.
 * Returns a warning message if the app is accessed over HTTP in production,
 * which could expose PHI in transit.
 */
export function useHttpsWarning(): string | null {
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    // Only check in browser environment
    if (typeof window === "undefined") return

    // Skip check in development mode
    const isDevelopment = process.env.NODE_ENV === "development"
    if (isDevelopment) return

    // Check if we're on localhost (safe even without HTTPS)
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]"

    // Warn if production build is served over HTTP on non-localhost
    if (window.location.protocol !== "https:" && !isLocalhost) {
      setWarning(
        "SECURITY WARNING: This application is not using HTTPS. " +
        "Patient health information (PHI) may be exposed during transmission. " +
        "Please configure TLS/SSL or access the application via https://."
      )
    }
  }, [])

  return warning
}
