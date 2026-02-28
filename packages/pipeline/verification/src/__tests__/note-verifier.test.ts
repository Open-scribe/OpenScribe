import { describe, it } from 'node:test'
import assert from 'node:assert'
import { verifyNote } from '../note-verifier'

const sampleTranscript = `
Doctor: Good morning, what brings you in today?
Patient: I've been having this really bad headache for the past 3 days.
Doctor: Pain severity?
Patient: About 7 or 8 out of 10.
Doctor: Blood pressure is 128/82, temperature 98.4.
`

const goodNote = `Patient presents with headache for 3 days. Pain severity 7-8/10. Vitals: BP 128/82.`
const badNote = `Patient presents with chest pain for 5 days. BP 180/110.`

describe('verifyNote', () => {
  it('verifies matching note', async () => {
    const result = await verifyNote(goodNote, sampleTranscript)
    assert.ok(['verified', 'partial'].includes(result.status))
    assert.ok(result.summary.overallConfidence > 0.3)
    assert.ok(result.claims.length > 0)
  })

  it('flags mismatch', async () => {
    const result = await verifyNote(badNote, sampleTranscript)
    assert.ok(result.summary.overallConfidence < 0.3)
  })

  it('handles empty note', async () => {
    const result = await verifyNote('', sampleTranscript)
    assert.strictEqual(result.claims.length, 0)
    assert.strictEqual(result.status, 'verified')
  })

  it('handles empty transcript', async () => {
    const result = await verifyNote(goodNote, '')
    assert.ok(result.summary.overallConfidence < 0.5)
  })

  it('respects factsOnly', async () => {
    const result = await verifyNote(goodNote, sampleTranscript, { factsOnly: true })
    for (const claim of result.claims) {
      assert.strictEqual(claim.kind, 'fact')
    }
  })
})
