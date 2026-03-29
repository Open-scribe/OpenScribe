// Keep old JSON-based exports for backward compatibility during migration
export * from "./clinical-models/clinical-note"

// New markdown-based exports (primary)
export * from "./clinical-models/markdown-note"

// Note generation
export { createClinicalNoteText } from "./note-generator"
export type { ClinicalNoteRequest } from "./note-generator"

// Note verification
export { verifyNote } from "./verification/note-verifier"
export { tokenize, extractNumbers, calculateOverlap, classifyClaim } from "./verification/verifier"
export type {
  Claim,
  ClaimKind,
  Evidence,
  Verdict,
  VerificationOptions,
  VerificationResult,
  VerificationSummary,
} from "./verification/types"
