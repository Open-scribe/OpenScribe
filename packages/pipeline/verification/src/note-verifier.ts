import type { Claim, Evidence, VerificationResult, VerificationSummary, VerificationOptions } from './types'
import { looksSupported, classifyClaim, determineVerdict } from './verifier'

function extractClaims(text: string): string[] {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10)
}

function chunkTranscript(transcript: string): { text: string; ref: string }[] {
  return transcript.split('\n').filter(l => l.trim()).map((text, i) => ({ text: text.trim(), ref: `line:${i + 1}` }))
}

function findEvidence(claim: string, chunks: { text: string; ref: string }[], opts: VerificationOptions): { evidence: Evidence[]; bestScore: number } {
  const evidence: Evidence[] = []
  let bestScore = 0
  for (const chunk of chunks) {
    const [, score] = looksSupported(claim, chunk.text, opts.minTokenOverlap, opts.minNumberCoverage)
    if (score > 0.1) {
      evidence.push({ ref: chunk.ref, text: chunk.text, score })
      if (score > bestScore) bestScore = score
    }
  }
  return { evidence: evidence.sort((a, b) => b.score - a.score).slice(0, 3), bestScore }
}

function calculateSummary(claims: Claim[]): VerificationSummary {
  const facts = claims.filter(c => c.kind === 'fact')
  const supported = facts.filter(c => c.verdict === 'supported').length
  const unsupported = facts.filter(c => c.verdict === 'unsupported').length
  const totalConf = facts.reduce((sum, c) => sum + c.confidence, 0)
  return {
    totalClaims: claims.length,
    supportedClaims: supported,
    unsupportedClaims: unsupported,
    overallConfidence: facts.length > 0 ? Math.round((totalConf / facts.length) * 100) / 100 : 1.0
  }
}

export async function verifyNote(noteText: string, transcript: string, options: VerificationOptions = {}): Promise<VerificationResult> {
  const startTime = performance.now()
  const { minTokenOverlap = 0.25, minNumberCoverage = 1.0, factsOnly = false } = options
  
  const claimTexts = extractClaims(noteText)
  const chunks = chunkTranscript(transcript)
  const claims: Claim[] = []
  
  for (let i = 0; i < claimTexts.length; i++) {
    const text = claimTexts[i]
    const kind = classifyClaim(text)
    if (factsOnly && kind !== 'fact') continue
    
    const { evidence, bestScore } = findEvidence(text, chunks, { minTokenOverlap, minNumberCoverage })
    claims.push({
      id: `claim_${i + 1}`,
      text,
      kind,
      verdict: determineVerdict(bestScore, kind),
      confidence: Math.round(bestScore * 100) / 100,
      evidence
    })
  }
  
  const summary = calculateSummary(claims)
  const factTotal = summary.supportedClaims + summary.unsupportedClaims
  let status: 'verified' | 'partial' | 'failed' = 'verified'
  if (factTotal > 0) {
    const supportRate = summary.supportedClaims / factTotal
    const unsupportRate = summary.unsupportedClaims / factTotal
    if (unsupportRate > 0.3) status = 'failed'
    else if (supportRate < 0.8 || summary.unsupportedClaims > 0) status = 'partial'
  }
  
  return { status, summary, claims, processingTimeMs: Math.round(performance.now() - startTime) }
}
