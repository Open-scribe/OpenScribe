import type { Claim, Evidence, VerificationOptions, VerificationResult, VerificationSummary } from "./types"
import { classifyClaim, determineVerdict, looksSupported } from "./verifier"

function extractClaims(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 10)
}

function chunkTranscript(transcript: string): { text: string; ref: string }[] {
  return transcript
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => ({ text: line.trim(), ref: `line:${index + 1}` }))
}

function findEvidence(
  claim: string,
  chunks: { text: string; ref: string }[],
  options: VerificationOptions,
): { evidence: Evidence[]; bestScore: number } {
  const evidence: Evidence[] = []
  let bestScore = 0

  for (const chunk of chunks) {
    const [, score] = looksSupported(claim, chunk.text, options.minTokenOverlap, options.minNumberCoverage)
    if (score > 0.1) {
      evidence.push({ ref: chunk.ref, text: chunk.text, score })
      if (score > bestScore) bestScore = score
    }
  }

  return {
    evidence: evidence.sort((left, right) => right.score - left.score).slice(0, 3),
    bestScore,
  }
}

function calculateSummary(claims: Claim[]): VerificationSummary {
  const facts = claims.filter((claim) => claim.kind === "fact")
  const supported = facts.filter((claim) => claim.verdict === "supported").length
  const unsupported = facts.filter((claim) => claim.verdict === "unsupported").length
  const totalConfidence = facts.reduce((sum, claim) => sum + claim.confidence, 0)

  return {
    totalClaims: claims.length,
    supportedClaims: supported,
    unsupportedClaims: unsupported,
    overallConfidence: facts.length > 0 ? Math.round((totalConfidence / facts.length) * 100) / 100 : 1,
  }
}

export async function verifyNote(
  noteText: string,
  transcript: string,
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  const startTime = performance.now()
  const { minTokenOverlap = 0.25, minNumberCoverage = 1, factsOnly = false } = options

  const claimTexts = extractClaims(noteText)
  const transcriptChunks = chunkTranscript(transcript)
  const claims: Claim[] = []

  for (let index = 0; index < claimTexts.length; index++) {
    const text = claimTexts[index]
    const kind = classifyClaim(text)
    if (factsOnly && kind !== "fact") continue

    const { evidence, bestScore } = findEvidence(text, transcriptChunks, { minTokenOverlap, minNumberCoverage })
    claims.push({
      id: `claim_${index + 1}`,
      text,
      kind,
      verdict: determineVerdict(bestScore, kind),
      confidence: Math.round(bestScore * 100) / 100,
      evidence,
    })
  }

  const summary = calculateSummary(claims)
  const totalResolvedFacts = summary.supportedClaims + summary.unsupportedClaims
  let status: "verified" | "partial" | "failed" = "verified"

  if (totalResolvedFacts > 0) {
    const supportRate = summary.supportedClaims / totalResolvedFacts
    const unsupportedRate = summary.unsupportedClaims / totalResolvedFacts
    if (unsupportedRate > 0.3) status = "failed"
    else if (supportRate < 0.8 || summary.unsupportedClaims > 0) status = "partial"
  }

  return {
    status,
    summary,
    claims,
    processingTimeMs: Math.round(performance.now() - startTime),
  }
}
