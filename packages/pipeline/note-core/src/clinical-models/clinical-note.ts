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
  if (!noteText || typeof noteText !== "string") {
    return { ...EMPTY_NOTE }
  }

  try {
    // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    let cleanText = noteText.trim()
    const jsonFencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/
    const match = cleanText.match(jsonFencePattern)
    
    if (match) {
      cleanText = match[1].trim()
    }

    const parsed = JSON.parse(cleanText) as Partial<ClinicalNote>
    return {
      chief_complaint: typeof parsed.chief_complaint === "string" ? parsed.chief_complaint : "",
      hpi: typeof parsed.hpi === "string" ? parsed.hpi : "",
      ros: typeof parsed.ros === "string" ? parsed.ros : "",
      physical_exam: typeof parsed.physical_exam === "string" ? parsed.physical_exam : "",
      assessment: typeof parsed.assessment === "string" ? parsed.assessment : "",
      plan: typeof parsed.plan === "string" ? parsed.plan : "",
    }
  } catch {
    return { ...EMPTY_NOTE }
  }
}

export function serializeNote(note: ClinicalNote): string {
  return JSON.stringify(
    {
      chief_complaint: note.chief_complaint || "",
      hpi: note.hpi || "",
      ros: note.ros || "",
      physical_exam: note.physical_exam || "",
      assessment: note.assessment || "",
      plan: note.plan || "",
    },
    null,
    2,
  )
}

export function formatNoteText(note: ClinicalNote): string {
  return `Chief Complaint:
${note.chief_complaint || ""}

HPI:
${note.hpi || ""}

ROS:
${note.ros || ""}

Physical Exam:
${note.physical_exam || ""}

Assessment:
${note.assessment || ""}

Plan:
${note.plan || ""}`
}
