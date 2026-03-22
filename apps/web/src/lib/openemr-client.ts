/**
 * OpenEMR FHIR client
 *
 * Push-only integration: OpenScribe → OpenEMR via FHIR R4 DocumentReference.
 *
 * Auth: OAuth2 client_credentials with RS384 JWT client assertion
 *   (RFC 7523 / SMART Backend Services).
 *
 * Trust boundaries implemented here:
 *  ④ Credential boundary   — JWT assertion token fetch; auth failure stops execution
 *  ⑤ Patient existence     — GET Patient/{uuid}; rejects non-UUID ids and missing patients
 *  ⑥ Identity binding      — patientId and noteMarkdown land in DocumentReference payload verbatim
 */

import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import {
  getOpenEMRTokenState,
  persistOpenEMRRefreshToken,
  recordOpenEMRRefreshAttempt,
  type OpenEMRTokenState,
} from "./openemr-auth-state"

export interface PushParams {
  patientId: string
  noteMarkdown: string
  patientName: string
  visitReason: string
  encounterId: string
}

export type PushResult =
  | {
      success: true
      id: string
      uploadedAt: string
      verifiedPreview: string
      verifiedLength: number
      openEMRDocumentUrl: string | null
    }
  | { success: false; error: string; code?: string }

export interface OpenEMRStatusBlocker {
  code: string
  message: string
}

export interface OpenEMRPushStatus {
  configured: boolean
  auth_ok: boolean
  patient_id_valid: boolean
  patient_resolvable: boolean
  note_ok: boolean
  can_push: boolean
  document_verified: boolean | null
  blockers: OpenEMRStatusBlocker[]
  token_state: {
    has_token: boolean
    source: OpenEMRTokenState["source"]
    last_refresh_attempt: string | null
    last_refresh_error: string | null
  }
}

export type OpenEMRAuthSetupResult =
  | {
      success: true
      message: string
      mode: "user" | "service"
    }
  | {
      success: false
      error: string
      code?: string
    }

interface Config {
  base: string
  clientId: string
  tokenUrl: string
  privateKeyPem: string
  scope: string
  userRefreshToken: string | null
  userRefreshTokenSource: OpenEMRTokenState["source"]
  tokenState: OpenEMRTokenState
  userScope: string
  documentPath: string
  pushAuthMode: "service_first" | "user_first"
  passwordGrantFallbackEnabled: boolean
  username: string | null
  password: string | null
  userRole: "users" | "patient"
}

interface TokenCache {
  token: string
  expiresAt: number
}

interface CapabilityCache {
  supportsDocumentReferenceCreate: boolean
  expiresAt: number
}

interface UserTokenCache {
  token: string
  expiresAt: number
}

const DEFAULT_SCOPE = "system/DocumentReference.write system/Patient.read"
const DEFAULT_USER_SCOPE = "api:oemr user/document.write user/document.read user/patient.read"
const DEFAULT_DOCUMENT_PATH = "/Categories/Medical_Record"
const DEFAULT_PUSH_AUTH_MODE: Config["pushAuthMode"] = "service_first"
const FETCH_TIMEOUT_MS = 15_000
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000
const CAPABILITY_CACHE_MS = 5 * 60 * 1000
const FHIR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENEMR_PID_PATTERN = /^[1-9]\d*$/

let _tokenCache: TokenCache | null = null
let _capabilityCache: CapabilityCache | null = null
let _userTokenCache: UserTokenCache | null = null
let _userRefreshTokenOverride: string | null = null

export function isOpenEMRConfigured(): boolean {
  return !!(
    process.env.OPENEMR_BASE_URL &&
    process.env.OPENEMR_CLIENT_ID &&
    process.env.OPENEMR_JWT_PRIVATE_KEY_PEM
  )
}

export function _resetTokenCacheForTesting(): void {
  _tokenCache = null
  _capabilityCache = null
  _userTokenCache = null
  _userRefreshTokenOverride = null
}

async function getConfig(): Promise<Config | null> {
  const base = process.env.OPENEMR_BASE_URL
  const clientId = process.env.OPENEMR_CLIENT_ID
  const rawKey = process.env.OPENEMR_JWT_PRIVATE_KEY_PEM
  if (!base || !clientId || !rawKey) return null
  const tokenState = await getOpenEMRTokenState(process.env.OPENEMR_USER_REFRESH_TOKEN ?? null)

  return {
    base: base.replace(/\/+$/, ""),
    clientId,
    tokenUrl: process.env.OPENEMR_TOKEN_URL ?? `${base.replace(/\/+$/, "")}/oauth2/default/token`,
    privateKeyPem: loadPrivateKey(rawKey),
    scope: process.env.OPENEMR_TOKEN_SCOPE ?? DEFAULT_SCOPE,
    userRefreshToken: tokenState.refreshToken,
    userRefreshTokenSource: tokenState.source,
    tokenState,
    userScope: process.env.OPENEMR_USER_TOKEN_SCOPE ?? DEFAULT_USER_SCOPE,
    documentPath: process.env.OPENEMR_DOCUMENT_PATH ?? DEFAULT_DOCUMENT_PATH,
    pushAuthMode:
      process.env.OPENEMR_PUSH_AUTH_MODE === "user_first"
        ? "user_first"
        : DEFAULT_PUSH_AUTH_MODE,
    passwordGrantFallbackEnabled: process.env.OPENEMR_ENABLE_PASSWORD_GRANT_FALLBACK === "true",
    username: process.env.OPENEMR_USERNAME ?? null,
    password: process.env.OPENEMR_PASSWORD ?? null,
    userRole: process.env.OPENEMR_USER_ROLE === "patient" ? "patient" : "users",
  }
}

function loadPrivateKey(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n")
  if (normalized.trimStart().startsWith("-----BEGIN")) {
    return normalized
  }
  return readFileSync(raw.trim(), "utf-8")
}

function buildClientAssertion(clientId: string, tokenUrl: string, privateKeyPem: string): string {
  const header = { alg: "RS384", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: tokenUrl,
    exp: now + 300,
    iat: now,
    jti: crypto.randomUUID(),
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signingInput = `${headerB64}.${payloadB64}`

  const sign = crypto.createSign("RSA-SHA384")
  sign.update(signingInput)
  const signature = sign.sign(privateKeyPem).toString("base64url")
  return `${signingInput}.${signature}`
}

async function fetchWithTimeout(url: string, init: RequestInit, fetchFn: typeof fetch): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getAccessToken(config: Config, fetchFn: typeof fetch): Promise<string> {
  const now = Date.now()
  if (_tokenCache && _tokenCache.expiresAt > now) {
    return _tokenCache.token
  }

  const assertion = buildClientAssertion(config.clientId, config.tokenUrl, config.privateKeyPem)
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: config.scope,
  })

  const resp = await fetchWithTimeout(
    config.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    fetchFn,
  )

  if (!resp.ok) {
    throw Object.assign(new Error("auth_failure"), { type: "auth_failure" })
  }

  const json = (await resp.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token || !json.expires_in) {
    throw Object.assign(new Error("auth_failure"), { type: "auth_failure" })
  }

  _tokenCache = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  }

  return _tokenCache.token
}

function parsePatientIdentifier(patientId: string): { kind: "uuid" | "pid"; value: string } {
  const normalized = patientId.trim()
  if (FHIR_UUID_PATTERN.test(normalized)) {
    return { kind: "uuid", value: normalized }
  }
  if (OPENEMR_PID_PATTERN.test(normalized)) {
    return { kind: "pid", value: normalized }
  }
  throw Object.assign(new Error(`patient_id_format:${patientId}`), {
    type: "patient_id_format",
    patientId,
  })
}

function validateNoteQuality(noteMarkdown: string): { ok: boolean; blocker?: OpenEMRStatusBlocker } {
  const trimmed = noteMarkdown.trim()
  const headerMatches = trimmed.match(/^##\s+/gm) ?? []
  if (trimmed.length < 120 || headerMatches.length < 2) {
    return {
      ok: false,
      blocker: {
        code: "OPENEMR_NOTE_TOO_SHORT",
        message: "Note must be at least 120 characters and include at least 2 section headers (##).",
      },
    }
  }
  return { ok: true }
}

function buildDocumentUrl(base: string, pid: number, docId: string): string {
  return `${base}/controller.php?document&retrieve&patient_id=${pid}&document_id=${docId}&`
}

async function validatePatientPid(config: Config, pid: number, token: string, fetchFn: typeof fetch): Promise<void> {
  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/api/patient/${pid}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    fetchFn,
  )
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw Object.assign(new Error("openemr_access_denied"), { type: "openemr_access_denied" })
    }
    throw Object.assign(new Error(`patient_not_found:${pid}`), {
      type: "patient_not_found",
      patientId: String(pid),
    })
  }
  const json = (await resp.json()) as {
    data?: { id?: number }
  }
  if (!json.data?.id || !Number.isInteger(json.data.id)) {
    throw Object.assign(new Error("patient_resolution_error"), { type: "patient_resolution_error" })
  }
}

async function ensurePatientDocumentPathAccessible(
  config: Config,
  pid: number,
  token: string,
  fetchFn: typeof fetch,
): Promise<void> {
  const url = new URL(`${config.base}/apis/default/api/patient/${pid}/document`)
  url.searchParams.set("path", config.documentPath)
  const resp = await fetchWithTimeout(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    fetchFn,
  )
  if (resp.ok) return
  if (resp.status === 404) {
    throw Object.assign(new Error(`patient_not_found:${pid}`), {
      type: "patient_not_found",
      patientId: String(pid),
    })
  }
  if (resp.status === 401 || resp.status === 403) {
    throw Object.assign(new Error("openemr_access_denied"), { type: "openemr_access_denied" })
  }
  throw Object.assign(new Error(`fhir_error:patient_document_path_unavailable:${resp.status}`), { type: "fhir_error" })
}

async function ensurePatientResolvableForDocumentFlow(
  config: Config,
  pid: number,
  token: string,
  fetchFn: typeof fetch,
): Promise<void> {
  try {
    await validatePatientPid(config, pid, token, fetchFn)
    return
  } catch (err) {
    const type = (err as { type?: string }).type
    if (type !== "patient_not_found" && type !== "user_auth_failure" && type !== "openemr_access_denied") {
      throw err
    }
  }

  await ensurePatientDocumentPathAccessible(config, pid, token, fetchFn)
}

async function ensureDocumentReferenceCreateSupported(config: Config, token: string, fetchFn: typeof fetch): Promise<void> {
  const now = Date.now()
  if (_capabilityCache && _capabilityCache.expiresAt > now) {
    if (_capabilityCache.supportsDocumentReferenceCreate) return
    throw Object.assign(new Error("unsupported_endpoint"), { type: "unsupported_endpoint" })
  }

  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/fhir/metadata`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchFn,
  )

  if (!resp.ok) {
    throw Object.assign(new Error(`capability_error:${resp.status}`), { type: "capability_error" })
  }

  const json = (await resp.json()) as {
    rest?: Array<{
      resource?: Array<{
        type?: string
        interaction?: Array<{ code?: string }>
      }>
    }>
  }

  const supportsCreate = Boolean(
    json.rest?.some((rest) =>
      rest.resource?.some(
        (resource) =>
          resource.type === "DocumentReference" &&
          resource.interaction?.some((interaction) => interaction.code === "create"),
      ),
    ),
  )

  _capabilityCache = {
    supportsDocumentReferenceCreate: supportsCreate,
    expiresAt: now + CAPABILITY_CACHE_MS,
  }

  if (!supportsCreate) {
    throw Object.assign(new Error("unsupported_endpoint"), { type: "unsupported_endpoint" })
  }
}

async function validatePatient(config: Config, patientId: string, token: string, fetchFn: typeof fetch): Promise<void> {
  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/fhir/Patient/${patientId}`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchFn,
  )

  if (!resp.ok) {
    throw Object.assign(new Error(`patient_not_found:${patientId}`), {
      type: "patient_not_found",
      patientId,
    })
  }
}

async function getUserAccessTokenFromRefreshToken(config: Config, fetchFn: typeof fetch): Promise<string> {
  const now = Date.now()
  if (_userTokenCache && _userTokenCache.expiresAt > now) {
    return _userTokenCache.token
  }

  const refreshToken = _userRefreshTokenOverride ?? config.userRefreshToken
  const tryPasswordGrantFallback = async () => {
    if (!config.passwordGrantFallbackEnabled || !config.username || !config.password) {
      throw Object.assign(new Error("user_auth_failure"), { type: "user_auth_failure" })
    }

    const scopeParts = config.userScope.split(/\s+/).filter(Boolean)
    if (!scopeParts.includes("offline_access")) scopeParts.unshift("offline_access")
    if (!scopeParts.includes("openid")) scopeParts.unshift("openid")
    if (!scopeParts.includes("api:oemr")) scopeParts.push("api:oemr")

    const assertion = buildClientAssertion(config.clientId, config.tokenUrl, config.privateKeyPem)
    const passwordBody = new URLSearchParams({
      grant_type: "password",
      client_id: config.clientId,
      scope: scopeParts.join(" "),
      user_role: config.userRole,
      username: config.username,
      password: config.password,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    })
    const passwordResp = await fetchWithTimeout(
      config.tokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: passwordBody.toString(),
      },
      fetchFn,
    )

    if (!passwordResp.ok) {
      throw Object.assign(new Error("user_auth_failure"), { type: "user_auth_failure" })
    }

    const passwordJson = (await passwordResp.json()) as {
      access_token?: string
      expires_in?: number
      refresh_token?: string
    }
    if (!passwordJson.access_token) {
      throw Object.assign(new Error("user_auth_failure"), { type: "user_auth_failure" })
    }

    if (passwordJson.refresh_token) {
      _userRefreshTokenOverride = passwordJson.refresh_token
      await persistOpenEMRRefreshToken(passwordJson.refresh_token)
    }
    await recordOpenEMRRefreshAttempt(null)

    if (passwordJson.expires_in) {
      _userTokenCache = {
        token: passwordJson.access_token,
        expiresAt: now + passwordJson.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
      }
    } else {
      _userTokenCache = null
    }
    return passwordJson.access_token
  }

  if (!refreshToken) {
    return tryPasswordGrantFallback()
  }
  await recordOpenEMRRefreshAttempt(null)

  const assertion = buildClientAssertion(config.clientId, config.tokenUrl, config.privateKeyPem)
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: config.userScope,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  })

  const resp = await fetchWithTimeout(
    config.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    fetchFn,
  )

  if (!resp.ok) {
    await recordOpenEMRRefreshAttempt("user_auth_failure")
    return tryPasswordGrantFallback()
  }

  const json = (await resp.json()) as { access_token?: string; expires_in?: number; refresh_token?: string }
  if (!json.access_token) {
    await recordOpenEMRRefreshAttempt("user_auth_failure")
    return tryPasswordGrantFallback()
  }

  if (json.refresh_token) {
    _userRefreshTokenOverride = json.refresh_token
    await persistOpenEMRRefreshToken(json.refresh_token)
  }
  await recordOpenEMRRefreshAttempt(null)

  if (json.expires_in) {
    _userTokenCache = {
      token: json.access_token,
      expiresAt: now + json.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
    }
  } else {
    _userTokenCache = null
  }

  return json.access_token
}

async function resolvePatientPid(config: Config, patientUuid: string, token: string, fetchFn: typeof fetch): Promise<number> {
  const resp = await fetchWithTimeout(
    `${config.base}/apis/default/api/patient/${patientUuid}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    fetchFn,
  )

  if (!resp.ok) {
    throw Object.assign(new Error(`patient_not_found:${patientUuid}`), {
      type: "patient_not_found",
      patientId: patientUuid,
    })
  }

  const json = (await resp.json()) as {
    data?: {
      id?: number
    }
  }
  const pid = json.data?.id
  if (!pid || !Number.isInteger(pid)) {
    throw Object.assign(new Error("patient_resolution_error"), { type: "patient_resolution_error" })
  }
  return pid
}

async function verifyUploadedDocument(
  config: Config,
  pid: number,
  filename: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ id: string; date: string | null } | null> {
  const url = new URL(`${config.base}/apis/default/api/patient/${pid}/document`)
  url.searchParams.set("path", config.documentPath)

  const resp = await fetchWithTimeout(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    fetchFn,
  )
  if (!resp.ok) return null

  const json = (await resp.json()) as Array<{ filename?: string; id?: number; date?: string }>
  const latestMatch = json
    .filter((item) => item.filename === filename && Number.isInteger(item.id))
    .reduce<{ filename?: string; id?: number; date?: string } | null>((best, item) => {
      if (!best) return item
      return (item.id as number) > (best.id as number) ? item : best
    }, null)
  return latestMatch?.id ? { id: String(latestMatch.id), date: latestMatch.date ?? null } : null
}

async function verifyDocumentById(
  config: Config,
  pid: number,
  documentId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ found: boolean; date: string | null }> {
  const url = new URL(`${config.base}/apis/default/api/patient/${pid}/document`)
  url.searchParams.set("path", config.documentPath)
  const resp = await fetchWithTimeout(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    fetchFn,
  )
  if (!resp.ok) return { found: false, date: null }
  const json = (await resp.json()) as Array<{ id?: number; date?: string }>
  const match = json.find((item) => String(item.id) === documentId)
  return { found: Boolean(match), date: match?.date ?? null }
}

async function uploadNoteAsPatientDocument(
  config: Config,
  params: PushParams,
  pid: number,
  token: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const filename = "openscribe-note-final.txt"
  const url = new URL(`${config.base}/apis/default/api/patient/${pid}/document`)
  url.searchParams.set("path", config.documentPath)

  const form = new FormData()
  form.append("document", new Blob([params.noteMarkdown], { type: "text/plain" }), filename)

  const resp = await fetchWithTimeout(
    url.toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
    fetchFn,
  )

  if (resp.ok) {
    const verifiedId = await verifyUploadedDocument(config, pid, filename, token, fetchFn)
    return verifiedId?.id ?? filename
  }

  const text = await resp.text()
  const boolBugSignature = "bool given"
  if (resp.status === 500 && text.includes(boolBugSignature)) {
    const verifiedId = await verifyUploadedDocument(config, pid, filename, token, fetchFn)
    if (verifiedId) return verifiedId.id
    throw Object.assign(new Error("upload_verification_failed"), { type: "upload_verification_failed" })
  }

  throw Object.assign(new Error(`fhir_error:${text}`), { type: "fhir_error" })
}

async function createDocumentReference(
  config: Config,
  params: PushParams,
  token: string,
  fetchFn: typeof fetch,
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
            system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
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
    fetchFn,
  )

  if (!resp.ok) {
    const text = await resp.text()
    throw Object.assign(new Error(`fhir_error:${text}`), { type: "fhir_error" })
  }

  const created = (await resp.json()) as { id?: string }
  if (!created.id) {
    throw Object.assign(new Error("fhir_error:missing id"), { type: "fhir_error" })
  }
  return created.id
}

async function pushViaPatientDocumentFlow(
  config: Config,
  params: PushParams,
  patientIdentifier: { kind: "uuid" | "pid"; value: string },
  token: string,
  fetchFn: typeof fetch,
): Promise<Extract<PushResult, { success: true }>> {
  const pid =
    patientIdentifier.kind === "pid"
      ? Number(patientIdentifier.value)
      : await resolvePatientPid(config, patientIdentifier.value, token, fetchFn)
  await ensurePatientResolvableForDocumentFlow(config, pid, token, fetchFn)
  const id = await uploadNoteAsPatientDocument(config, params, pid, token, fetchFn)
  const verification = await verifyDocumentById(config, pid, id, token, fetchFn)
  if (!verification.found) {
    throw Object.assign(new Error("upload_verification_failed"), { type: "upload_verification_failed" })
  }
  const uploadedAt = verification.date ?? new Date().toISOString()
  return {
    success: true,
    id,
    uploadedAt,
    verifiedPreview: params.noteMarkdown.slice(0, 200),
    verifiedLength: params.noteMarkdown.length,
    openEMRDocumentUrl: buildDocumentUrl(config.base, pid, id),
  }
}

export async function getOpenEMRPushStatus(
  params: Pick<PushParams, "patientId" | "noteMarkdown"> & { documentId?: string },
  fetchFn: typeof fetch = fetch,
): Promise<OpenEMRPushStatus> {
  const config = await getConfig()
  const blockers: OpenEMRStatusBlocker[] = []
  const noteCheck = validateNoteQuality(params.noteMarkdown)
  const note_ok = noteCheck.ok
  if (!noteCheck.ok && noteCheck.blocker) blockers.push(noteCheck.blocker)

  let patient_id_valid = false
  let patient_resolvable = false
  let auth_ok = false
  let authTokenForVerification: string | null = null
  let patientIdentifier: { kind: "uuid" | "pid"; value: string } | null = null
  let resolvedPid: number | null = null

  if (!config) {
    blockers.push({
      code: "OPENEMR_NOT_CONFIGURED",
      message: "OpenEMR is not configured. Set OpenEMR environment variables and restart OpenScribe.",
    })
    return {
      configured: false,
      auth_ok: false,
      patient_id_valid: false,
      patient_resolvable: false,
      note_ok,
      can_push: false,
      document_verified: null,
      blockers,
      token_state: {
        has_token: false,
        source: "none",
        last_refresh_attempt: null,
        last_refresh_error: null,
      },
    }
  }

  try {
    patientIdentifier = parsePatientIdentifier(params.patientId)
    patient_id_valid = true
  } catch {
    blockers.push({
      code: "OPENEMR_PATIENT_ID_INVALID",
      message: "Patient ID must be a numeric PID (for example: 3) or a valid FHIR UUID.",
    })
  }

  const tryServiceAuth = async () => {
    const serviceToken = await getAccessToken(config, fetchFn)
    auth_ok = true
    authTokenForVerification = serviceToken
    if (patientIdentifier) {
      if (patientIdentifier.kind === "pid") {
        resolvedPid = Number(patientIdentifier.value)
        await ensurePatientResolvableForDocumentFlow(config, resolvedPid, serviceToken, fetchFn)
      } else {
        resolvedPid = await resolvePatientPid(config, patientIdentifier.value, serviceToken, fetchFn)
      }
      patient_resolvable = true
    }
  }
  const tryUserAuth = async () => {
    if (!config.userRefreshToken) {
      throw Object.assign(new Error("user_refresh_token_missing"), { type: "user_refresh_token_missing" })
    }
    const userToken = await getUserAccessTokenFromRefreshToken(config, fetchFn)
    auth_ok = true
    authTokenForVerification = userToken
    if (patientIdentifier) {
      if (patientIdentifier.kind === "pid") {
        resolvedPid = Number(patientIdentifier.value)
        await ensurePatientResolvableForDocumentFlow(config, resolvedPid, userToken, fetchFn)
      } else {
        resolvedPid = await resolvePatientPid(config, patientIdentifier.value, userToken, fetchFn)
      }
      patient_resolvable = true
    }
  }

  const hasUserRefreshToken = Boolean(config.userRefreshToken)
  const attempts: Array<() => Promise<void>> =
    config.pushAuthMode === "user_first"
      ? hasUserRefreshToken
        ? [tryUserAuth, tryServiceAuth]
        : [tryServiceAuth]
      : [tryServiceAuth]
  let lastAuthError: { message: string; code?: string } | null = null
  for (const attempt of attempts) {
    if (patient_resolvable) break
    try {
      await attempt()
    } catch (err) {
      lastAuthError = mapError(err, config.base, params.patientId)
    }
  }
  if (!patient_resolvable && lastAuthError) {
    blockers.push({
      code: lastAuthError.code ?? "OPENEMR_AUTH_INVALID",
      message: lastAuthError.message,
    })
  }

  let document_verified: boolean | null = null
  if (params.documentId && auth_ok && patient_resolvable && resolvedPid && authTokenForVerification) {
    try {
      const verification = await verifyDocumentById(
        config,
        resolvedPid,
        params.documentId,
        authTokenForVerification,
        fetchFn,
      )
      document_verified = verification.found
      if (!verification.found) {
        blockers.push({
          code: "OPENEMR_UPLOAD_VERIFY_FAILED",
          message: `OpenEMR document ${params.documentId} was not found for this patient.`,
        })
      }
    } catch {
      document_verified = false
      blockers.push({
        code: "OPENEMR_UPLOAD_VERIFY_FAILED",
        message: "Could not verify document existence in OpenEMR.",
      })
    }
  }

  return {
    configured: true,
    auth_ok,
    patient_id_valid,
    patient_resolvable,
    note_ok,
    can_push: Boolean(auth_ok && patient_id_valid && patient_resolvable && note_ok),
    document_verified,
    blockers,
    token_state: {
      has_token: config.tokenState.hasToken,
      source: config.tokenState.source,
      last_refresh_attempt: config.tokenState.lastRefreshAttempt,
      last_refresh_error: config.tokenState.lastRefreshError,
    },
  }
}

export async function setupOpenEMRAuth(fetchFn: typeof fetch = fetch): Promise<OpenEMRAuthSetupResult> {
  const config = await getConfig()
  if (!config) {
    return {
      success: false,
      error: "OpenEMR is not configured. Set OpenEMR environment variables and restart OpenScribe.",
      code: "OPENEMR_NOT_CONFIGURED",
    }
  }

  try {
    if (config.pushAuthMode === "user_first") {
      await getUserAccessTokenFromRefreshToken(config, fetchFn)
      return {
        success: true,
        message: "OpenEMR user auth is now ready.",
        mode: "user",
      }
    }

    await getAccessToken(config, fetchFn)
    return {
      success: true,
      message: "OpenEMR service auth is now ready.",
      mode: "service",
    }
  } catch (err) {
    const mapped = mapError(err, config.base, "")
    return {
      success: false,
      error: mapped.message,
      code: mapped.code,
    }
  }
}

export async function pushNoteToOpenEMR(params: PushParams, fetchFn: typeof fetch = fetch): Promise<PushResult> {
  const config = await getConfig()
  if (!config) {
    return { success: false, error: "OpenEMR is not configured.", code: "OPENEMR_NOT_CONFIGURED" }
  }

  const noteCheck = validateNoteQuality(params.noteMarkdown)
  if (!noteCheck.ok) {
    return {
      success: false,
      error: noteCheck.blocker?.message ?? "Note quality requirements not met.",
      code: "OPENEMR_NOTE_TOO_SHORT",
    }
  }

  try {
    const patientIdentifier = parsePatientIdentifier(params.patientId)
    const serviceAttempt = async () => {
      const serviceToken = await getAccessToken(config, fetchFn)
      return pushViaPatientDocumentFlow(config, params, patientIdentifier, serviceToken, fetchFn)
    }
    const userAttempt = async () => {
      const userToken = await getUserAccessTokenFromRefreshToken(config, fetchFn)
      return pushViaPatientDocumentFlow(config, params, patientIdentifier, userToken, fetchFn)
    }
    const hasUserRefreshToken = Boolean(config.userRefreshToken)
    const attempts: Array<() => Promise<Extract<PushResult, { success: true }>>> =
      config.pushAuthMode === "user_first"
        ? hasUserRefreshToken
          ? [userAttempt, serviceAttempt]
          : [serviceAttempt]
        : [serviceAttempt]
    let lastError: unknown = null
    for (const attempt of attempts) {
      try {
        return await attempt()
      } catch (err) {
        lastError = err
      }
    }

    const lastErrorType = (lastError as { type?: string } | null)?.type
    if (
      patientIdentifier.kind === "uuid" &&
      lastErrorType !== "auth_failure" &&
      lastErrorType !== "user_auth_failure"
    ) {
      const systemToken = await getAccessToken(config, fetchFn)
      await ensureDocumentReferenceCreateSupported(config, systemToken, fetchFn)
      await validatePatient(config, patientIdentifier.value, systemToken, fetchFn)
      const id = await createDocumentReference(config, params, systemToken, fetchFn)
      return {
        success: true,
        id,
        uploadedAt: new Date().toISOString(),
        verifiedPreview: params.noteMarkdown.slice(0, 200),
        verifiedLength: params.noteMarkdown.length,
        openEMRDocumentUrl: null,
      }
    }

    throw lastError ?? Object.assign(new Error("push_failed"), { type: "fhir_error" })
  } catch (err: unknown) {
    const mapped = mapError(err, config.base, params.patientId)
    return { success: false, error: mapped.message, code: mapped.code }
  }
}

function mapError(err: unknown, baseUrl: string, patientId: string): { message: string; code?: string } {
  if (!(err instanceof Error)) return { message: "Unexpected error." }

  if (err.name === "AbortError") {
    return {
      message: `OpenEMR request timed out after ${FETCH_TIMEOUT_MS / 1000}s.`,
      code: "OPENEMR_TIMEOUT",
    }
  }

  const code = (err as NodeJS.ErrnoException).code
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return {
      message: `Could not reach OpenEMR at ${baseUrl}. Check that the server is running.`,
      code: "OPENEMR_NETWORK_ERROR",
    }
  }

  const type = (err as { type?: string }).type
  if (type === "auth_failure") {
    return {
      message: "OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_JWT_PRIVATE_KEY_PEM.",
      code: "OPENEMR_AUTH_INVALID",
    }
  }
  if (type === "openemr_access_denied") {
    return {
      message:
        "OpenEMR token does not have required patient/document API permissions. Ensure scopes include system/Patient.read and system/DocumentReference.write, or switch to OPENEMR_PUSH_AUTH_MODE=user_first with a valid refresh token.",
      code: "OPENEMR_AUTH_INVALID",
    }
  }
  if (type === "user_refresh_token_missing") {
    return {
      message: "OpenEMR user OAuth is enabled but no refresh token is available. Reconnect OpenEMR.",
      code: "OPENEMR_AUTH_INVALID",
    }
  }
  if (type === "user_auth_failure") {
    return {
      message: "OpenEMR user token refresh failed. Re-authorize and retry push.",
      code: "OPENEMR_AUTH_EXPIRED",
    }
  }
  if (type === "patient_id_format") {
    return {
      message: "OpenEMR Patient ID must be a numeric PID (for example: 3) or a FHIR UUID.",
      code: "OPENEMR_PATIENT_ID_INVALID",
    }
  }
  if (type === "patient_id_format_uuid_required") {
    return {
      message: "This OpenEMR mode requires a FHIR UUID patient identifier.",
      code: "OPENEMR_PATIENT_ID_INVALID",
    }
  }
  if (type === "patient_not_found") {
    return {
      message: `Patient ID ${patientId} was not found in OpenEMR. Verify the ID and try again.`,
      code: "OPENEMR_PATIENT_NOT_FOUND",
    }
  }
  if (type === "patient_resolution_error") {
    return {
      message: "OpenEMR returned an invalid patient record while resolving UUID to PID.",
      code: "OPENEMR_PATIENT_NOT_FOUND",
    }
  }
  if (type === "upload_verification_failed") {
    return {
      message: "OpenEMR returned an ambiguous upload response and verification failed. Check document list in OpenEMR.",
      code: "OPENEMR_UPLOAD_VERIFY_FAILED",
    }
  }
  if (type === "unsupported_endpoint") {
    return {
      message:
        "This OpenEMR instance does not support FHIR DocumentReference create. Enable a server that supports POST /fhir/DocumentReference.",
      code: "OPENEMR_UNSUPPORTED",
    }
  }
  if (type === "fhir_error") {
    return {
      message: `OpenEMR push failed: ${err.message.replace("fhir_error:", "")}`,
      code: "OPENEMR_PUSH_FAILED",
    }
  }

  return { message: `OpenEMR push failed: ${err.message}`, code: "OPENEMR_PUSH_FAILED" }
}
