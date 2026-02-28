export type { Claim, ClaimKind, Evidence, Verdict, VerificationResult, VerificationSummary, VerificationOptions } from './types'
export { verifyNote } from './note-verifier'
export { tokenize, extractNumbers, calculateOverlap, classifyClaim } from './verifier'
