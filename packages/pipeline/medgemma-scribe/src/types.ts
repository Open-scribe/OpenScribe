export interface EncounterState {
  problems: string[]
  medications: string[]
  allergies: string[]
  ros_positive: string[]
  ros_negative: string[]
  timeline: string[]
}

export interface DraftNoteSections {
  hpi: string
  ros: string
  assessment: string
  plan: string
}

export interface ScribeArtifacts {
  encounterState: EncounterState
  draftNote: DraftNoteSections
  recentTranscriptWindow: string
}

export interface ScribeUpdateRequest {
  transcriptChunk: string
  artifacts: ScribeArtifacts
  maxWindowChars?: number
  model?: string
  baseUrl?: string
  apiKey?: string
}

export interface ScribeUpdateResult {
  artifacts: ScribeArtifacts
  warnings: string[]
  rawModelOutput: string
}
