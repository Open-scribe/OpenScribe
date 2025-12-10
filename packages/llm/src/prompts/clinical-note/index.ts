/**
 * Clinical Note Prompt Exports
 * Central location for managing prompt versions
 */

import * as v1 from "./v1"

// Default to latest version
export const currentVersion = v1

// Export all versions for A/B testing
export { v1 }

// Re-export types
export type { ClinicalNotePromptParams, NoteLength } from "./v1"
