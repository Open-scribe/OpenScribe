export { updateScribeArtifacts } from "./scribe"
export { renderDraftNote } from "./render"
export {
  createEmptyArtifacts,
  createEmptyDraftNote,
  createEmptyEncounterState,
  updateRecentTranscriptWindow,
  DEFAULT_WINDOW_CHARS,
} from "./state"
export type {
  EncounterState,
  DraftNoteSections,
  ScribeArtifacts,
  ScribeUpdateRequest,
  ScribeUpdateResult,
} from "./types"
