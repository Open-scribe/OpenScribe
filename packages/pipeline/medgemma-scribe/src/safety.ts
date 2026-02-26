import type { DraftNoteSections, EncounterState } from "./types"

const VITALS_REGEX = /\b(bp|blood pressure|hr|heart rate|rr|respiratory rate|temp|temperature|spo2|oxygen saturation)\b/i
const DOSING_REGEX = /\b(\d+\s?(mg|mcg|ml|units)|q\d+h|bid|tid|qid|qd)\b/i

function hasTerm(regex: RegExp, text: string): boolean {
  return regex.test(text)
}

function normalize(text: string): string {
  return text.toLowerCase()
}

export function runSafetyChecks(params: {
  transcript: string
  draftNote: DraftNoteSections
  encounterState: EncounterState
}): string[] {
  const { transcript, draftNote, encounterState } = params
  const warnings: string[] = []
  const transcriptNormalized = normalize(transcript || "")
  const noteText = normalize([draftNote.hpi, draftNote.ros, draftNote.assessment, draftNote.plan].join(" "))

  if (hasTerm(VITALS_REGEX, noteText) && !hasTerm(VITALS_REGEX, transcriptNormalized)) {
    warnings.push("Vitals mentioned in note but not found in transcript window.")
  }

  if (hasTerm(DOSING_REGEX, noteText) && !hasTerm(DOSING_REGEX, transcriptNormalized)) {
    warnings.push("Medication dosing appears in note but not found in transcript window.")
  }

  const rosOverlap = encounterState.ros_positive.filter((item) => encounterState.ros_negative.includes(item))
  if (rosOverlap.length > 0) {
    warnings.push(`ROS contradiction detected for: ${rosOverlap.join(", ")}.`)
  }

  return warnings
}
