"use server"

import type { ClinicalNoteRequest } from "@/features/encounters/services/clinical-note-generator"
import { createClinicalNoteText } from "@/features/encounters/services/clinical-note-generator"

export async function generateClinicalNote(params: ClinicalNoteRequest): Promise<string> {
  return createClinicalNoteText(params)
}
