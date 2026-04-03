import type { ClaimKind, Verdict } from "./types"

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in", "on", "for", "with", "by", "as",
  "is", "are", "was", "were", "be", "been", "it", "this", "that", "at", "from", "not", "can", "do", "does",
  "we", "you", "they", "i", "he", "she", "has", "have", "had", "will", "patient", "reports", "denies",
])

export function tokenize(text: string): string[] {
  const normalized = (text || "").toLowerCase().replace(/[^\w-]+/g, " ").trim()
  if (!normalized) return []
  return normalized.split(/\s+/).filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
}

export function extractNumbers(text: string): string[] {
  return (text || "").match(/(?<![\w])\d+(?:[.,]\d+)?(?![\w])/g) || []
}

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

function calculateNumberCoverage(claim: string, evidence: string): number {
  const claimNumbers = extractNumbers(claim).map((num) => num.replace(",", "."))
  if (claimNumbers.length === 0) return 1

  const evidenceNumbers = new Set(extractNumbers(evidence).map((num) => num.replace(",", ".")))
  if (evidenceNumbers.size === 0) return 0

  let hits = 0
  for (const num of claimNumbers) {
    if (evidenceNumbers.has(num)) hits++
  }

  return hits / claimNumbers.length
}

export function looksSupported(
  claim: string,
  evidence: string,
  minOverlap = 0.25,
  minNumberCoverage = 1,
): [boolean, number] {
  const overlap = calculateOverlap(claim, evidence)
  const numberCoverage = calculateNumberCoverage(claim, evidence)
  const score = overlap * 0.7 + numberCoverage * 0.3
  return [overlap >= minOverlap && numberCoverage >= minNumberCoverage, score]
}

export function classifyClaim(text: string): ClaimKind {
  const lower = text.toLowerCase().trim()
  if (lower.endsWith("?")) return "question"
  if (["i think", "i believe", "probably", "likely"].some((phrase) => lower.includes(phrase))) return "inference"
  if (["in my opinion", "i feel"].some((phrase) => lower.includes(phrase))) return "opinion"
  if (["do ", "please ", "recommend ", "consider "].some((phrase) => lower.startsWith(phrase))) return "instruction"
  return "fact"
}

export function determineVerdict(score: number, kind: ClaimKind): Verdict {
  if (kind !== "fact") return "uncertain"
  if (score >= 0.5) return "supported"
  if (score >= 0.25) return "uncertain"
  return "unsupported"
}
