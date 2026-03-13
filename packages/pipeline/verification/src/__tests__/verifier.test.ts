import { describe, it } from 'node:test'
import assert from 'node:assert'
import { tokenize, extractNumbers, calculateOverlap, classifyClaim } from '../verifier'

describe('tokenize', () => {
  it('extracts tokens, filters stopwords', () => {
    const tokens = tokenize('Patient reports headache for 3 days')
    assert.ok(tokens.includes('headache'))
    assert.ok(!tokens.includes('for'))
  })

  it('handles empty', () => {
    assert.deepStrictEqual(tokenize(''), [])
  })
})

describe('extractNumbers', () => {
  it('extracts numbers and decimals', () => {
    const numbers = extractNumbers('BP 120/80, temp 98.6')
    assert.ok(numbers.includes('120'))
    assert.ok(numbers.includes('98.6'))
  })
})

describe('calculateOverlap', () => {
  it('returns 1.0 for same text', () => {
    assert.strictEqual(calculateOverlap('severe headache', 'severe headache'), 1.0)
  })

  it('returns 0 for no match', () => {
    assert.strictEqual(calculateOverlap('headache pain', 'cardiac issues'), 0)
  })
})

describe('classifyClaim', () => {
  it('identifies facts', () => {
    assert.strictEqual(classifyClaim('Patient has hypertension.'), 'fact')
  })

  it('identifies questions', () => {
    assert.strictEqual(classifyClaim('Does the patient smoke?'), 'question')
  })

  it('identifies inferences', () => {
    assert.strictEqual(classifyClaim('I think this might be migraine.'), 'inference')
  })
})
