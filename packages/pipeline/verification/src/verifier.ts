import type { ClaimKind, Verdict } from './types'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'at', 'from', 'not', 'can', 'do', 'does',
  'we', 'you', 'they', 'i', 'he', 'she', 'has', 'have', 'had', 'will', 'patient', 'reports', 'denies'
])

export function tokenize(text: string): string[] {
  const normalized = (text || '').toLowerCase().replace(/[^\w\-]+/g, ' ').trim()
  if (!normalized) return []
  return normalized.split(/\s+/).filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

export function extractNumbers(text: string): string[] {
  return (text || '').match(/(?<![\w])\d+(?:[.,]\d+)?(?![\w])/g) || []
}

// returns overlap ratio 0-1
export function calculateOverlap(claim: string, evidence: string): number {
  const claimTokens = new Set(tokenize(claim))
  const evidenceTokens = new Set(tokenize(evidence))
  if (claimTokens.size === 0 || evidenceTokens.size === 0) return 0
  
  let overlap = 0
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) overlap++
  }
  return overlap / claimTokens.size
}

function numberCoverage(claim: string, evidence: string): number {
  const claimNums = extractNumbers(claim).map(n => n.replace(',', '.'))
  if (claimNums.length === 0) return 1.0
  
  const evidenceNums = new Set(extractNumbers(evidence).map(n => n.replace(',', '.')))
  if (evidenceNums.size === 0) return 0
  
  let hits = 0
  for (const n of claimNums) if (evidenceNums.has(n)) hits++
  return hits / claimNums.length
}

export function looksSupported(claim: string, evidence: string, minOverlap = 0.25, minNumCov = 1.0): [boolean, number] {
  const overlap = calculateOverlap(claim, evidence)
  const numCov = numberCoverage(claim, evidence)
  const score = overlap * 0.7 + numCov * 0.3
  return [overlap >= minOverlap && numCov >= minNumCov, score]
}

export function classifyClaim(text: string): ClaimKind {
  const lower = text.toLowerCase().trim()
  if (lower.endsWith('?')) return 'question'
  if (['i think', 'i believe', 'probably', 'likely'].some(p => lower.includes(p))) return 'inference'
  if (['in my opinion', 'i feel'].some(p => lower.includes(p))) return 'opinion'
  if (['do ', 'please ', 'recommend ', 'consider '].some(p => lower.startsWith(p))) return 'instruction'
  return 'fact'
}

export function determineVerdict(score: number, kind: ClaimKind): Verdict {
  if (kind !== 'fact') return 'uncertain'
  if (score >= 0.5) return 'supported'
  if (score >= 0.25) return 'uncertain'
  return 'unsupported'
}
