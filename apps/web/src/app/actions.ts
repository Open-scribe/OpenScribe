"use server"

import type { ClinicalNoteRequest } from "@note-core"
import { createClinicalNoteText } from "@note-core"
import { getAnthropicApiKey } from "@storage/server-api-keys"
import { writeAuditEntry } from "@storage/audit-log"
import { getServerSession } from "next-auth"
import { hasAcceptedTerms } from "@/lib/compliance"

export async function generateClinicalNote(params: ClinicalNoteRequest): Promise<string> {
  let userId = "local-user"
  if (process.env.HIPAA_HOSTED_MODE === "true") {
    const { authOptions } = await import("@/lib/auth")
    const session = await getServerSession(authOptions)
    userId = session?.user?.id || ""
    if (!userId) {
      throw new Error("Unauthorized")
    }
    const accepted = await hasAcceptedTerms(userId)
    if (!accepted) {
      throw new Error("Terms acceptance required")
    }
  }

  const apiKey = getAnthropicApiKey()

  try {
    // Audit log: note generation started
    await writeAuditEntry({
      event_type: "note.generation_started",
      success: true,
      user_id: userId,
      metadata: {
        template: params.template || "default",
        transcript_length: params.transcript?.length || 0,
      },
    })

    const result = await createClinicalNoteText({ ...params, apiKey })

    // Audit log: note generated successfully
    await writeAuditEntry({
      event_type: "note.generated",
      success: true,
      user_id: userId,
      metadata: {
        template: params.template || "default",
        note_length: result.length,
      },
    })

    return result
  } catch (error) {
    // Audit log: note generation failed
    await writeAuditEntry({
      event_type: "note.generation_failed",
      success: false,
      user_id: userId,
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        template: params.template || "default",
      },
    })

    throw error
  }
}
