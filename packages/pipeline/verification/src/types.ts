// types for note verification

export type ClaimKind = 'fact' | 'inference' | 'opinion' | 'instruction' | 'question'
export type Verdict = 'supported' | 'uncertain' | 'unsupported'

export interface Claim {
  id: string
  text: string
  kind: ClaimKind
  verdict: Verdict
  confidence: number
  evidence: Evidence[]
}

export interface Evidence {
  ref: string
  text: string
  score: number
}

export interface VerificationResult {
  status: 'verified' | 'partial' | 'failed'
  summary: VerificationSummary
  claims: Claim[]
  processingTimeMs: number
}

export interface VerificationSummary {
  totalClaims: number
  supportedClaims: number
  unsupportedClaims: number
  overallConfidence: number
}

export interface VerificationOptions {
  minTokenOverlap?: number
  minNumberCoverage?: number
  factsOnly?: boolean
}
