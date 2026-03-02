"use server"

import type { ClinicalNoteRequest } from "@note-core"
import { createClinicalNoteText } from "@note-core"
import { isHostedMode } from "@storage/hosted-mode"
import { getAnthropicApiKey } from "@storage/server-api-keys"
import { writeServerAuditEntry } from "@storage/server-audit"

export async function generateClinicalNote(params: ClinicalNoteRequest): Promise<string> {
  if (isHostedMode()) {
    throw new Error("generateClinicalNote server action is disabled in hosted mode. Use /api/notes/generate instead.")
  }

  const apiKey = getAnthropicApiKey()

  try {
    // Audit log: note generation started
    await writeServerAuditEntry({
      event_type: "note.generation_started",
      success: true,
      metadata: {
        template: params.template || "default",
        transcript_length: params.transcript?.length || 0,
      },
    })

    const result = await createClinicalNoteText({ ...params, apiKey })

    // Audit log: note generated successfully
    await writeServerAuditEntry({
      event_type: "note.generated",
      success: true,
      metadata: {
        template: params.template || "default",
        note_length: result.length,
      },
    })

    return result
  } catch (error) {
    // Audit log: note generation failed
    await writeServerAuditEntry({
      event_type: "note.generation_failed",
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        template: params.template || "default",
      },
    })

    throw error
  }
}
