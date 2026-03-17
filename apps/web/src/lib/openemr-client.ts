/**
 * OpenEMR client
 *
 * Push-only integration: OpenScribe → OpenEMR via standard REST document API.
 *
 * Auth: OAuth2 client_credentials with RS384 JWT client assertion
 *   (RFC 7521 / SMART Backend Services — no client_secret in request body).
 *
 * Trust boundaries implemented here:
 *  ④ Credential boundary   — JWT assertion token fetch; auth failure stops execution
 *  ⑤ Patient resolution    — GET /apis/default/patient/{pid}; resolves numeric pid → FHIR UUID;
 *                             404 / missing uuid stops before any document write
 *  ⑥ Identity binding      — patientId (pid in URL) and noteMarkdown (FormData file)
 *                             reach the document endpoint verbatim
 *
 * Token caching: module-level memory (best-effort; no-op in serverless).
 */

import crypto from "node:crypto"
import { readFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushParams {
  patientId: string      // numeric OpenEMR pid (from encounter form)
  noteMarkdown: string
  patientName: string
  visitReason: string
  encounterId: string
}

export type PushResult =
  | { success: true; id: string }
  | { success: false; error: string }

interface PatientInfo {
  pid: string
  uuid: string           // FHIR patient UUID resolved from pid
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface Config {
  base: string
  clientId: string
  tokenUrl: string
  privateKeyPem: string
}

export function isOpenEMRConfigured(): boolean {
  return !!(
    process.env.OPENEMR_BASE_URL &&
    process.env.OPENEMR_CLIENT_ID &&
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM
  )
}

function getConfig(): Config | null {
  const base = process.env.OPENEMR_BASE_URL
  const clientId = process.env.OPENEMR_CLIENT_ID
  const rawKey = process.env.OPENEMR_JWT_PRIVATE_KEY_PEM
  if (!base || !clientId || !rawKey) return null
  const tokenUrl = process.env.OPENEMR_TOKEN_URL ?? `${base}/oauth2/default/token`
  const privateKeyPem = loadPrivateKey(rawKey)
  return { base, clientId, tokenUrl, privateKeyPem }
}

/**
 * Load a private key from either an inline PEM string or a file path.
 * Handles escaped \\n from .env files.
 */
function loadPrivateKey(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n")
  if (normalized.trimStart().startsWith("-----BEGIN")) return normalized
  // Treat as file path
  return readFileSync(raw.trim(), "utf-8")
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string
  expiresAt: number // Unix ms
}

let _tokenCache: TokenCache | null = null
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

/** Exposed for testing only — resets module-level token cache. */
export function _resetTokenCacheForTesting(): void {
  _tokenCache = null
}

// ---------------------------------------------------------------------------
// JWT client assertion (RS384) — boundary ④
// ---------------------------------------------------------------------------

function buildClientAssertion(
  clientId: string,
  tokenUrl: string,
  privateKeyPem: string
): string {
  const header = { alg: "RS384", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: tokenUrl,
    exp: now + 300, // 5-minute expiry
    iat: now,
    jti: crypto.randomUUID(),
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signingInput = `${headerB64}.${payloadB64}`

  const sign = crypto.createSign("RSA-SHA384")
  sign.update(signingInput)
  const sig: Buffer = sign.sign(privateKeyPem)

  return `${signingInput}.${sig.toString("base64url")}`
}

// ---------------------------------------------------------------------------
// Fetch with timeout (15 s)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// OAuth2 token (client_credentials + JWT assertion) — boundary ④
// ---------------------------------------------------------------------------

async function getAccessToken(
  config: Config,
  fetchFn: typeof fetch
): Promise<string> {
  const now = Date.now()
  if (_tokenCache && _tokenCache.expiresAt > now) {
    return _tokenCache.token
  }

  const assertion = buildClientAssertion(
    config.clientId,
    config.tokenUrl,
    config.privateKeyPem
  )

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: "api:oemr",
  })

  const resp = await fetchWithTimeout(
    config.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    fetchFn
  )

  if (!resp.ok) {
    throw Object.assign(new Error("auth_failure"), { type: "auth_failure" })
  }

  const json = (await resp.json()) as { access_token: string; expires_in: number }
  _tokenCache = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  }
  return _tokenCache.token
}

// ---------------------------------------------------------------------------
// Patient resolution — boundary ⑤
// ---------------------------------------------------------------------------

/**
 * Resolve a numeric OpenEMR pid to a PatientInfo containing the FHIR UUID.
 * Uses the standard REST patient endpoint (not FHIR GET by id, which
 * requires a UUID and rejects numeric pids).
 */
async function resolvePatient(
  config: Config,
  pid: string,
  token: string,
  fetchFn: typeof fetch
): Promise<PatientInfo> {
  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/patient/${pid}`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchFn
  )

  if (!resp.ok) {
    throw Object.assign(new Error(`patient_not_found:${pid}`), {
      type: "patient_not_found",
      patientId: pid,
    })
  }

  const json = (await resp.json()) as { data?: { uuid?: string; pid?: string } }
  const uuid = json.data?.uuid

  if (!uuid) {
    throw Object.assign(new Error(`patient_not_found:${pid}`), {
      type: "patient_not_found",
      patientId: pid,
    })
  }

  return { pid, uuid }
}

// ---------------------------------------------------------------------------
// Document creation — boundary ⑥
// ---------------------------------------------------------------------------

/**
 * Upload the clinical note as a document via the standard OpenEMR REST API.
 * Uses multipart/form-data; pid is bound in the URL path (boundary ⑥).
 *
 * FHIR DocumentReference POST is not used because it is not available in all
 * OpenEMR configurations. The resolved patient UUID is embedded in the
 * filename for traceability.
 */
async function createDocument(
  config: Config,
  patient: PatientInfo,
  params: PushParams,
  token: string,
  fetchFn: typeof fetch
): Promise<string> {
  const filename = `clinical-note-${params.encounterId}-${patient.uuid}.md`
  const noteBlob = new Blob([params.noteMarkdown], { type: "text/markdown" })

  const formData = new FormData()
  formData.append("file", noteBlob, filename)
  formData.append("filename", filename)

  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/patient/${patient.pid}/document`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
    fetchFn
  )

  if (!resp.ok) {
    const text = await resp.text()
    throw Object.assign(new Error(`document_error:${text}`), {
      type: "document_error",
    })
  }

  const json = (await resp.json()) as {
    data?: { uuid?: string; id?: string | number }
  }
  const id = json.data?.uuid ?? json.data?.id
  if (!id) {
    throw Object.assign(new Error("document_error:no id in response"), {
      type: "document_error",
    })
  }
  return String(id)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push a clinical note to OpenEMR as a patient document.
 *
 * @param params   Push parameters (numeric pid, note, metadata)
 * @param fetchFn  Fetch implementation — injected for testing, defaults to global fetch
 */
export async function pushNoteToOpenEMR(
  params: PushParams,
  fetchFn: typeof fetch = fetch
): Promise<PushResult> {
  const config = getConfig()
  if (!config) {
    return { success: false, error: "OpenEMR is not configured." }
  }

  try {
    const token = await getAccessToken(config, fetchFn)
    const patient = await resolvePatient(config, params.patientId, token, fetchFn)
    const id = await createDocument(config, patient, params, token, fetchFn)
    return { success: true, id }
  } catch (err: unknown) {
    return { success: false, error: mapError(err, config.base, params.patientId) }
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapError(err: unknown, baseUrl: string, patientId: string): string {
  if (!(err instanceof Error)) return "Unexpected error."

  if (err.name === "AbortError") {
    return `OpenEMR request timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
  }

  const code = (err as NodeJS.ErrnoException).code
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return `Could not reach OpenEMR at ${baseUrl}. Check that the server is running.`
  }

  const type = (err as { type?: string }).type
  if (type === "auth_failure") {
    return "OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_JWT_PRIVATE_KEY_PEM."
  }
  if (type === "patient_not_found") {
    return `Patient ID ${patientId} was not found in OpenEMR. Verify the ID and try again.`
  }
  if (type === "document_error") {
    return `OpenEMR push failed: ${err.message.replace("document_error:", "")}`
  }

  return `OpenEMR push failed: ${err.message}`
}
