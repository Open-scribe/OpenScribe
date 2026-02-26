import { z } from "zod"

export const encounterStateSchema = z.object({
  problems: z.array(z.string()),
  medications: z.array(z.string()),
  allergies: z.array(z.string()),
  ros_positive: z.array(z.string()),
  ros_negative: z.array(z.string()),
  timeline: z.array(z.string()),
})

export const draftNoteSchema = z.object({
  hpi: z.string(),
  ros: z.string(),
  assessment: z.string(),
  plan: z.string(),
})

export const scribeOutputSchema = z.object({
  encounter_state: encounterStateSchema,
  draft_note: draftNoteSchema,
  recent_transcript_window: z.string().optional(),
  warnings: z.array(z.string()).optional(),
})

export type ScribeModelOutput = z.infer<typeof scribeOutputSchema>
