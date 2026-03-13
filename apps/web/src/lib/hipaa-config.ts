export function isHipaaHostedMode(): boolean {
  return process.env.HIPAA_HOSTED_MODE === "true"
}

export function requireHipaaEnv(name: string): string {
  const value = (process.env[name] || "").trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
