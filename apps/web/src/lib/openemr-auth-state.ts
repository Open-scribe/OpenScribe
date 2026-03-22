import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const KEY_LENGTH = 32

type PersistedAuthState = {
  refreshToken: string
  lastRefreshAttempt: string | null
  lastRefreshError: string | null
  updatedAt: string
}

export type OpenEMRTokenState = {
  hasToken: boolean
  source: "persisted" | "env" | "none"
  refreshToken: string | null
  lastRefreshAttempt: string | null
  lastRefreshError: string | null
}

async function getStatePath(): Promise<string> {
  const explicit = process.env.OPENEMR_AUTH_STATE_FILE?.trim()
  if (explicit) return explicit
  try {
    const electron = await import("electron")
    const app = electron.app
    if (app?.getPath) {
      return path.join(app.getPath("userData"), "openemr-auth-state.json")
    }
  } catch {
    // noop
  }
  return path.join(process.cwd(), ".openemr-auth-state.json")
}

async function getKeyPath(): Promise<string> {
  const statePath = await getStatePath()
  return path.join(path.dirname(statePath), ".openemr-auth-state.key")
}

async function getEncryptionKey(): Promise<Uint8Array> {
  const keyPath = await getKeyPath()
  try {
    const existing = new Uint8Array(await fs.readFile(keyPath))
    if (existing.length === KEY_LENGTH) return existing
  } catch {
    // noop
  }

  const key = new Uint8Array(crypto.randomBytes(KEY_LENGTH))
  await fs.mkdir(path.dirname(keyPath), { recursive: true })
  await fs.writeFile(keyPath, key, { mode: 0o600 })
  return key
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = new Uint8Array(crypto.randomBytes(IV_LENGTH))
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = cipher.update(plaintext, "utf8", "base64") + cipher.final("base64")
  const authTag = cipher.getAuthTag()
  return `enc.v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(authTag as Uint8Array).toString("base64")}.${encrypted}`
}

async function decrypt(payload: string): Promise<string> {
  const parts = payload.split(".")
  if (parts.length === 5 && parts[0] === "enc" && parts[1] === "v1") {
    const key = await getEncryptionKey()
    const iv = new Uint8Array(Buffer.from(parts[2] ?? "", "base64"))
    const authTag = new Uint8Array(Buffer.from(parts[3] ?? "", "base64"))
    const ciphertext = parts[4] ?? ""
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext, "base64", "utf8") + decipher.final("utf8")
  }
  return payload
}

async function loadPersistedAuthState(): Promise<PersistedAuthState | null> {
  const statePath = await getStatePath()
  try {
    const raw = await fs.readFile(statePath, "utf8")
    const decrypted = await decrypt(raw)
    const parsed = JSON.parse(decrypted) as Partial<PersistedAuthState>
    if (!parsed.refreshToken || typeof parsed.refreshToken !== "string") return null
    return {
      refreshToken: parsed.refreshToken,
      lastRefreshAttempt: parsed.lastRefreshAttempt ?? null,
      lastRefreshError: parsed.lastRefreshError ?? null,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

async function savePersistedAuthState(next: PersistedAuthState): Promise<void> {
  const statePath = await getStatePath()
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const encrypted = await encrypt(JSON.stringify(next, null, 2))
  await fs.writeFile(statePath, encrypted, { mode: 0o600 })
}

export async function getOpenEMRTokenState(envRefreshToken: string | null | undefined): Promise<OpenEMRTokenState> {
  const persisted = await loadPersistedAuthState()
  if (persisted?.refreshToken) {
    return {
      hasToken: true,
      source: "persisted",
      refreshToken: persisted.refreshToken,
      lastRefreshAttempt: persisted.lastRefreshAttempt,
      lastRefreshError: persisted.lastRefreshError,
    }
  }

  const envToken = envRefreshToken?.trim() || null
  if (envToken) {
    return {
      hasToken: true,
      source: "env",
      refreshToken: envToken,
      lastRefreshAttempt: null,
      lastRefreshError: null,
    }
  }

  return {
    hasToken: false,
    source: "none",
    refreshToken: null,
    lastRefreshAttempt: null,
    lastRefreshError: null,
  }
}

export async function persistOpenEMRRefreshToken(refreshToken: string): Promise<void> {
  const now = new Date().toISOString()
  const current = await loadPersistedAuthState()
  await savePersistedAuthState({
    refreshToken,
    lastRefreshAttempt: now,
    lastRefreshError: null,
    updatedAt: now,
  })
  if (current && current.refreshToken === refreshToken) {
    return
  }
}

export async function recordOpenEMRRefreshAttempt(error: string | null): Promise<void> {
  const current = await loadPersistedAuthState()
  if (!current?.refreshToken) return
  await savePersistedAuthState({
    ...current,
    lastRefreshAttempt: new Date().toISOString(),
    lastRefreshError: error,
    updatedAt: new Date().toISOString(),
  })
}
