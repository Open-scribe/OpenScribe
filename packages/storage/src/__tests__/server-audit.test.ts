import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeAuditErrorMessage, sanitizeAuditMetadata } from '../server-audit.js'

test('sanitizeAuditMetadata removes likely PHI fields', () => {
  const sanitized = sanitizeAuditMetadata({
    patient_name: 'Jane Doe',
    transcript_text: 'sensitive',
    note_text: 'sensitive note',
    duration_ms: 12000,
    provider: 'gcp_stt_v2',
  })

  assert.ok(sanitized)
  assert.equal('patient_name' in sanitized!, false)
  assert.equal('transcript_text' in sanitized!, false)
  assert.equal('note_text' in sanitized!, false)
  assert.equal(sanitized!.duration_ms, 12000)
  assert.equal(sanitized!.provider, 'gcp_stt_v2')
})

test('sanitizeAuditErrorMessage redacts email addresses', () => {
  const input = 'failed for test.user@example.com due to upstream error'
  const result = sanitizeAuditErrorMessage(input)
  assert.ok(result)
  assert.equal(result!.includes('example.com'), false)
  assert.equal(result!.includes('[redacted-email]'), true)
})
