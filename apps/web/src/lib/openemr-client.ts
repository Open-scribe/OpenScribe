/**
 * OpenEMR FHIR client
 *
 * Push-only integration: OpenScribe → OpenEMR via FHIR R4 DocumentReference.
 *
 * Trust boundaries implemented here:
 *  ④ Credential boundary   — client_credentials token fetch; auth failure stops execution
 *  ⑤ Patient existence     — GET Patient/{id}; 404 stops before any FHIR write
 *  ⑥ Identity binding      — patientId/noteMarkdown/fields land in FHIR payload verbatim
 *
 * Token caching: module-level memory (best-effort; no-op in serverless).
 * See spec: docs/superpowers/specs/2026-03-16-openemr-integration-design.md
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushParams {
  patientId: string
  noteMarkdown: string
  patientName: string
  visitReason: string
  encounterId: string
}

export type PushResult =
  | { success: true; id: string }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function isOpenEMRConfigured(): boolean {
  return !!(
    process.env.OPENEMR_BASE_URL &&
    process.env.OPENEMR_CLIENT_ID &&
    process.env.OPENEMR_CLIENT_SECRET
  )
}

function getConfig() {
  const base = process.env.OPENEMR_BASE_URL
  const clientId = process.env.OPENEMR_CLIENT_ID
  const clientSecret = process.env.OPENEMR_CLIENT_SECRET
  if (!base || !clientId || !clientSecret) return null
  return { base, clientId, clientSecret }
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
// OAuth2 token (client_credentials) — boundary ④
// ---------------------------------------------------------------------------

async function getAccessToken(
  config: ReturnType<typeof getConfig> & object,
  fetchFn: typeof fetch
): Promise<string> {
  const now = Date.now()
  if (_tokenCache && _tokenCache.expiresAt > now) {
    return _tokenCache.token
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "system/DocumentReference.write system/Patient.read",
  })

  const resp = await fetchWithTimeout(
    `${config.base}/oauth2/default/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    fetchFn
  )

  if (!resp.ok) {
    // Sentinel consumed internally; mapped to user-facing message in pushNoteToOpenEMR
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
// Patient validation — boundary ⑤
// ---------------------------------------------------------------------------

async function validatePatient(
  config: ReturnType<typeof getConfig> & object,
  patientId: string,
  token: string,
  fetchFn: typeof fetch
): Promise<void> {
  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/fhir/Patient/${patientId}`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchFn
  )

  if (!resp.ok) {
    throw Object.assign(new Error(`patient_not_found:${patientId}`), {
      type: "patient_not_found",
      patientId,
    })
  }
}

// ---------------------------------------------------------------------------
// Create DocumentReference — boundary ⑥
// ---------------------------------------------------------------------------

async function createDocumentReference(
  config: ReturnType<typeof getConfig> & object,
  params: PushParams,
  token: string,
  fetchFn: typeof fetch
): Promise<string> {
  const noteBase64 = Buffer.from(params.noteMarkdown, "utf8").toString("base64")

  const resource = {
    resourceType: "DocumentReference",
    status: "current",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "34109-9",
          display: "Note",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system:
              "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
            code: "clinical-note",
            display: "Clinical Note",
          },
        ],
      },
    ],
    subject: { reference: `Patient/${params.patientId}` },
    date: new Date().toISOString(),
    description: params.visitReason,
    content: [
      {
        attachment: {
          contentType: "text/markdown",
          data: noteBase64,
          title: `Clinical Note — ${params.patientName}`,
        },
      },
    ],
  }

  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/fhir/DocumentReference`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/fhir+json",
      },
      body: JSON.stringify(resource),
    },
    fetchFn
  )

  if (!resp.ok) {
    const text = await resp.text()
    throw Object.assign(new Error(`fhir_error:${text}`), { type: "fhir_error" })
  }

  const created = (await resp.json()) as { id: string }
  return created.id
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push a clinical note to OpenEMR as a FHIR R4 DocumentReference.
 *
 * @param params   Push parameters (patient, note, metadata)
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
    await validatePatient(config, params.patientId, token, fetchFn)
    const id = await createDocumentReference(config, params, token, fetchFn)
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

  // AbortController timeout
  if (err.name === "AbortError") {
    return `OpenEMR request timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
  }

  // Network unreachable (ECONNREFUSED / ENOTFOUND)
  const code = (err as NodeJS.ErrnoException).code
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return `Could not reach OpenEMR at ${baseUrl}. Check that the server is running.`
  }

  // Sentinel errors thrown internally
  const type = (err as { type?: string }).type
  if (type === "auth_failure") {
    return "OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_CLIENT_SECRET."
  }
  if (type === "patient_not_found") {
    return `Patient ID ${patientId} was not found in OpenEMR. Verify the ID and try again.`
  }
  if (type === "fhir_error") {
    return `OpenEMR push failed: ${err.message.replace("fhir_error:", "")}`
  }

  return `OpenEMR push failed: ${err.message}`
}
