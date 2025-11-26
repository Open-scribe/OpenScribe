export type EncounterStatus =
  | "idle"
  | "recording"
  | "processing"
  | "transcription_failed"
  | "note_generation_failed"
  | "completed"

export interface Encounter {
  id: string
  patient_name: string
  patient_id: string
  visit_reason: string
  created_at: string
  updated_at: string
  audio_blob?: Blob
  transcript_text: string
  note_text: string
  status: EncounterStatus
  language: string
  recording_duration?: number
}

export interface ClinicalNote {
  chief_complaint: string
  hpi: string
  ros: string
  physical_exam: string
  assessment: string
  plan: string
}

export const EMPTY_NOTE: ClinicalNote = {
  chief_complaint: "",
  hpi: "",
  ros: "",
  physical_exam: "",
  assessment: "",
  plan: "",
}

export function parseNoteText(noteText: string): ClinicalNote {
  const sections: ClinicalNote = { ...EMPTY_NOTE }

  const patterns = {
    chief_complaint: /Chief Complaint:\s*([\s\S]*?)(?=(?:HPI:|History of Present Illness:|$))/i,
    hpi: /(?:HPI|History of Present Illness):\s*([\s\S]*?)(?=(?:ROS:|Review of Systems:|$))/i,
    ros: /(?:ROS|Review of Systems):\s*([\s\S]*?)(?=(?:Physical Exam:|PE:|$))/i,
    physical_exam: /(?:Physical Exam|PE):\s*([\s\S]*?)(?=(?:Assessment:|$))/i,
    assessment: /Assessment:\s*([\s\S]*?)(?=(?:Plan:|$))/i,
    plan: /Plan:\s*([\s\S]*?)$/i,
  }

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = noteText.match(pattern)
    if (match && match[1]) {
      sections[key as keyof ClinicalNote] = match[1].trim()
    }
  }

  return sections
}

export function formatNoteText(note: ClinicalNote): string {
  return `Chief Complaint:
${note.chief_complaint || "Not documented"}

HPI:
${note.hpi || "Not documented"}

ROS:
${note.ros || "Not discussed"}

Physical Exam:
${note.physical_exam || "Not performed"}

Assessment:
${note.assessment || "Not documented"}

Plan:
${note.plan || "Not documented"}`
}
