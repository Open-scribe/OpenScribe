import { isHostedMode } from './hosted-mode'

export type OrgRole = 'org_owner' | 'clinician' | 'staff_viewer'

export interface HostedUserContext {
  userId: string
  email?: string
  orgId?: string
  role?: OrgRole
}

function membershipId(userId: string, orgId: string): string {
  return `${userId}_${orgId}`
}

function getProjectId(env: NodeJS.ProcessEnv = process.env): string {
  const projectId = env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT
  if (!projectId) {
    throw new Error('Missing GCP project id. Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT.')
  }
  return projectId
}

async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  }

  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
  const res = await fetch(metadataUrl, {
    headers: { 'Metadata-Flavor': 'Google' },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch metadata token: ${res.status}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Metadata token response missing access_token')
  }

  return data.access_token
}

function firestoreBase(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((v) => toFirestoreValue(v)) } }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'object') {
    const fields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v)
    }
    return { mapValue: { fields } }
  }
  return { stringValue: String(value) }
}

function fromFirestoreValue(value: unknown): unknown {
  const typed = value as Record<string, unknown> | undefined
  if (!typed || typeof typed !== 'object') return undefined
  if (typed.stringValue !== undefined) return typed.stringValue
  if (typed.booleanValue !== undefined) return typed.booleanValue
  if (typed.integerValue !== undefined) return Number(typed.integerValue)
  if (typed.doubleValue !== undefined) return typed.doubleValue
  if (typed.timestampValue !== undefined) return typed.timestampValue
  if (typed.nullValue !== undefined) return null
  const arrayValue = typed.arrayValue as { values?: unknown[] } | undefined
  if (arrayValue?.values) return arrayValue.values.map(fromFirestoreValue)
  const mapValue = typed.mapValue as { fields?: Record<string, unknown> } | undefined
  if (mapValue?.fields) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(mapValue.fields)) {
      out[k] = fromFirestoreValue(v)
    }
    return out
  }
  return undefined
}

function decodeDocument(document: unknown): Record<string, unknown> {
  const fields = ((document as { fields?: Record<string, unknown> } | undefined)?.fields) || {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v)
  }
  return out
}

async function patchDocument(path: string, fields: Record<string, unknown>): Promise<void> {
  const projectId = getProjectId()
  const token = await getGoogleAccessToken()
  const base = firestoreBase(projectId)

  const updateMask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
  const query = updateMask ? `?${updateMask}` : ''

  const body = {
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFirestoreValue(v)])),
  }

  const res = await fetch(`${base}/${path}${query}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Firestore patch failed (${res.status}): ${errorBody}`)
  }
}

async function getDocument(path: string): Promise<Record<string, unknown> | null> {
  const projectId = getProjectId()
  const token = await getGoogleAccessToken()
  const base = firestoreBase(projectId)

  const res = await fetch(`${base}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Firestore get failed (${res.status}): ${errorBody}`)
  }

  const document = await res.json()
  return decodeDocument(document)
}

export async function ensureHostedUserBootstrap(user: { userId: string; email?: string }): Promise<HostedUserContext> {
  if (!isHostedMode()) {
    return { userId: user.userId, email: user.email, orgId: 'local-org', role: 'org_owner' }
  }

  const existing = await getDocument(`users/${user.userId}`)
  if (existing?.orgId && existing?.role) {
    const orgId = String(existing.orgId)
    const role = String(existing.role) as OrgRole
    const membershipDocId = membershipId(user.userId, orgId)
    const membership = await getDocument(`memberships/${membershipDocId}`)
    if (!membership?.role) {
      const now = new Date().toISOString()
      await patchDocument(`memberships/${membershipDocId}`, {
        id: membershipDocId,
        userId: user.userId,
        orgId,
        role,
        createdAt: now,
        updatedAt: now,
      })
    }

    return {
      userId: user.userId,
      email: user.email,
      orgId,
      role,
    }
  }

  const orgId = crypto.randomUUID()
  const now = new Date().toISOString()

  await patchDocument(`organizations/${orgId}`, {
    id: orgId,
    name: user.email ? `${user.email.split('@')[0]}'s Organization` : 'OpenScribe Organization',
    createdAt: now,
    updatedAt: now,
    hostedMode: true,
  })

  await patchDocument(`users/${user.userId}`, {
    id: user.userId,
    email: user.email || '',
    orgId,
    role: 'org_owner',
    createdAt: now,
    updatedAt: now,
  })

  const membershipDocId = membershipId(user.userId, orgId)
  await patchDocument(`memberships/${membershipDocId}`, {
    id: membershipDocId,
    userId: user.userId,
    orgId,
    role: 'org_owner',
    createdAt: now,
    updatedAt: now,
  })

  return {
    userId: user.userId,
    email: user.email,
    orgId,
    role: 'org_owner',
  }
}

export async function getHostedUserContext(userId: string): Promise<HostedUserContext | null> {
  if (!isHostedMode()) {
    return { userId, orgId: 'local-org', role: 'org_owner' }
  }

  const user = await getDocument(`users/${userId}`)
  if (!user?.orgId) {
    return null
  }

  const orgId = String(user.orgId)
  const membership = await getDocument(`memberships/${membershipId(userId, orgId)}`)
  if (!membership?.role) return null

  return {
    userId,
    email: typeof user.email === 'string' ? user.email : undefined,
    orgId,
    role: String(membership.role) as OrgRole,
  }
}
