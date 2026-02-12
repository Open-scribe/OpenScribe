import { runMedGemmaRequest } from "@llm-medgemma"
import { buildScribePrompt, SCRIBE_SYSTEM_PROMPT } from "./prompts"
import { runSafetyChecks } from "./safety"
import { scribeOutputSchema } from "./schema"
import { updateRecentTranscriptWindow } from "./state"
import type { ScribeArtifacts, ScribeUpdateRequest, ScribeUpdateResult } from "./types"

function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }

  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim()
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  throw new Error("Unable to extract JSON from MedGemma output")
}

function normalizeArtifacts(modelOutput: ReturnType<typeof scribeOutputSchema.parse>, fallbackWindow: string): ScribeArtifacts {
  return {
    encounterState: modelOutput.encounter_state,
    draftNote: modelOutput.draft_note,
    recentTranscriptWindow: modelOutput.recent_transcript_window || fallbackWindow,
  }
}

export async function updateScribeArtifacts(request: ScribeUpdateRequest): Promise<ScribeUpdateResult> {
  const {
    transcriptChunk,
    artifacts,
    maxWindowChars,
    model,
    baseUrl,
    apiKey,
  } = request

  const recentTranscriptWindow = updateRecentTranscriptWindow(
    artifacts.recentTranscriptWindow,
    transcriptChunk,
    maxWindowChars
  )

  const prompt = buildScribePrompt({
    transcriptChunk,
    recentTranscriptWindow,
    encounterState: artifacts.encounterState,
    draftNote: artifacts.draftNote,
  })

  const rawModelOutput = await runMedGemmaRequest({
    system: SCRIBE_SYSTEM_PROMPT,
    prompt,
    model,
    baseUrl,
    apiKey,
  })

  const jsonText = extractJson(rawModelOutput)
  const parsed = scribeOutputSchema.parse(JSON.parse(jsonText))
  const nextArtifacts = normalizeArtifacts(parsed, recentTranscriptWindow)

  const warnings = [
    ...(parsed.warnings ?? []),
    ...runSafetyChecks({
      transcript: nextArtifacts.recentTranscriptWindow,
      draftNote: nextArtifacts.draftNote,
      encounterState: nextArtifacts.encounterState,
    }),
  ]

  return {
    artifacts: nextArtifacts,
    warnings,
    rawModelOutput,
  }
}
