import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureHostedUserBootstrap, getHostedUserContext } from '../firestore-metadata.js'

type FirestoreDoc = Record<string, unknown>

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((v) => toFirestoreValue(v)) } }
  if (typeof value === 'object') {
    const fields: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      fields[key] = toFirestoreValue(nested)
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
  if (typed.nullValue !== undefined) return null
  const mapValue = typed.mapValue as { fields?: Record<string, unknown> } | undefined
  if (mapValue?.fields) {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(mapValue.fields)) {
      out[key] = fromFirestoreValue(nested)
    }
    return out
  }
  const arrayValue = typed.arrayValue as { values?: unknown[] } | undefined
  if (arrayValue?.values) return arrayValue.values.map(fromFirestoreValue)
  return undefined
}

function encodeDocument(fields: FirestoreDoc): Record<string, unknown> {
  return {
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toFirestoreValue(value)])),
  }
}

function decodeBodyFields(bodyText: string): FirestoreDoc {
  const parsed = JSON.parse(bodyText) as { fields?: Record<string, unknown> }
  const out: FirestoreDoc = {}
  for (const [key, value] of Object.entries(parsed.fields || {})) {
    out[key] = fromFirestoreValue(value)
  }
  return out
}

function setupFirestoreFetch(documents: Map<string, FirestoreDoc>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = String(input)
    const marker = '/documents/'
    const idx = rawUrl.indexOf(marker)
    if (idx < 0) {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    }
    const path = rawUrl.slice(idx + marker.length).split('?')[0]
    const method = (init?.method || 'GET').toUpperCase()

    if (method === 'GET') {
      const doc = documents.get(path)
      if (!doc) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(encodeDocument(doc)), { status: 200 })
    }

    if (method === 'PATCH') {
      const current = documents.get(path) || {}
      const bodyText = String(init?.body || '{}')
      const patch = decodeBodyFields(bodyText)
      documents.set(path, { ...current, ...patch })
      return new Response(JSON.stringify(encodeDocument(documents.get(path) || {})), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'unsupported method' }), { status: 405 })
  }) as typeof fetch
}

test('getHostedUserContext returns null when membership is missing', async () => {
  const docs = new Map<string, FirestoreDoc>()
  docs.set('users/user-1', {
    id: 'user-1',
    email: 'clinician@example.com',
    orgId: 'org-1',
    role: 'org_owner',
  })

  process.env = {
    ...originalEnv,
    HOSTED_MODE: 'true',
    GCP_PROJECT_ID: 'test-project',
    GOOGLE_OAUTH_ACCESS_TOKEN: 'test-token',
  }
  setupFirestoreFetch(docs)

  const context = await getHostedUserContext('user-1')
  assert.equal(context, null)
})

test('getHostedUserContext requires membership and uses membership role', async () => {
  const docs = new Map<string, FirestoreDoc>()
  docs.set('users/user-2', {
    id: 'user-2',
    email: 'clinician@example.com',
    orgId: 'org-2',
    role: 'org_owner',
  })
  docs.set('memberships/user-2_org-2', {
    id: 'user-2_org-2',
    userId: 'user-2',
    orgId: 'org-2',
    role: 'staff_viewer',
  })

  process.env = {
    ...originalEnv,
    HOSTED_MODE: 'true',
    GCP_PROJECT_ID: 'test-project',
    GOOGLE_OAUTH_ACCESS_TOKEN: 'test-token',
  }
  setupFirestoreFetch(docs)

  const context = await getHostedUserContext('user-2')
  assert.ok(context)
  assert.equal(context?.orgId, 'org-2')
  assert.equal(context?.role, 'staff_viewer')
})

test('ensureHostedUserBootstrap backfills missing membership for existing user', async () => {
  const docs = new Map<string, FirestoreDoc>()
  docs.set('users/user-3', {
    id: 'user-3',
    email: 'owner@example.com',
    orgId: 'org-3',
    role: 'org_owner',
  })

  process.env = {
    ...originalEnv,
    HOSTED_MODE: 'true',
    GCP_PROJECT_ID: 'test-project',
    GOOGLE_OAUTH_ACCESS_TOKEN: 'test-token',
  }
  setupFirestoreFetch(docs)

  const context = await ensureHostedUserBootstrap({ userId: 'user-3', email: 'owner@example.com' })
  assert.equal(context.orgId, 'org-3')
  assert.equal(context.role, 'org_owner')
  assert.ok(docs.get('memberships/user-3_org-3'))
})

test.after(() => {
  process.env = originalEnv
  globalThis.fetch = originalFetch
})
