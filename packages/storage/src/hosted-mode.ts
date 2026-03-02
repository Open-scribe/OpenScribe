export function isHostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.HOSTED_MODE || '').toLowerCase() === 'true'
}

export function allowUserApiKeys(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isHostedMode(env)) return true
  return String(env.ALLOW_USER_API_KEYS || '').toLowerCase() === 'true'
}

export function persistServerPhi(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isHostedMode(env)) return true
  return String(env.PERSIST_SERVER_PHI || '').toLowerCase() === 'true'
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
}
