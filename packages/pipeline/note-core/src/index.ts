// Keep old JSON-based exports for backward compatibility during migration
export * from "./clinical-models/clinical-note"

// New markdown-based exports (primary)
export * from "./clinical-models/markdown-note"

// Note generation
export { createClinicalNoteText } from "./note-generator"
export type { ClinicalNoteRequest } from "./note-generator"
