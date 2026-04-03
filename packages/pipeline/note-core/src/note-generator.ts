import { runLLMRequest, prompts } from "../../../llm/src/index"
import { toPipelineStageError } from "../../shared/src/error"
import { 
  extractMarkdownFromResponse, 
  normalizeMarkdownSections,
  createEmptyMarkdownNote 
} from "./clinical-models/markdown-note"
import { debugLog, debugLogPHI, debugError, debugWarn } from "../../../storage/src/index"

export type NoteLength = "short" | "long"

export interface ClinicalNoteRequest {
  transcript: string
  patient_name: string
  visit_reason: string
  noteLength?: NoteLength
  template?: string
  apiKey?: string
}

export async function createClinicalNoteText(params: ClinicalNoteRequest): Promise<string> {
  const { transcript, patient_name, visit_reason, noteLength = "long", template, apiKey } = params

  debugLog("=".repeat(80))
  debugLog("GENERATING CLINICAL NOTE (MARKDOWN)")
  debugLog("=".repeat(80))
  debugLogPHI(`Patient Name: ${patient_name || "Not provided"}`)
  debugLogPHI(`Visit Reason: ${visit_reason || "Not provided"}`)
  debugLog(`Note Length: ${noteLength}`)
  debugLog(`Template: ${template || "default"}`)
  debugLog(`Transcript length: ${transcript.length} characters`)

  if (!transcript || transcript.trim().length === 0) {
    debugLog("⚠️  Transcript is empty - returning empty note structure")
    const emptyNote = createEmptyMarkdownNote()
    debugLog("=".repeat(80))
    debugLog("FINAL CLINICAL NOTE (EMPTY):")
    debugLog("-".repeat(80))
    debugLogPHI(emptyNote)
    debugLog("-".repeat(80))
    debugLog("=".repeat(80))
    return emptyNote
  }

  debugLog("📝 Transcript being used for note generation:")
  debugLog("-".repeat(80))
  debugLogPHI(transcript)
  debugLog("-".repeat(80))

  // Use versioned prompts with markdown template
  const systemPrompt = prompts.clinicalNote.currentVersion.getSystemPrompt(noteLength, template)
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript,
    patient_name,
    visit_reason,
    noteLength,
    template,
  })

  try {
    debugLog("🤖 Calling LLM to generate markdown clinical note...")
    debugLog(`📌 Using prompt version: ${prompts.clinicalNote.currentVersion.PROMPT_VERSION}`)
    debugLog(`🤖 Model: ${prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR}`)
    
    const text = await runLLMRequest({
      system: systemPrompt,
      prompt: userPrompt,
      model: prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR,
      apiKey,
      // No JSON schema - direct text generation
    })

    // Extract markdown from response (handles code fences)
    const cleanedMarkdown = extractMarkdownFromResponse(text)
    
    // Normalize section headings to standard format
    const normalizedMarkdown = normalizeMarkdownSections(cleanedMarkdown)

    debugLog("=".repeat(80))
    debugLog("FINAL CLINICAL NOTE:")
    debugLog("=".repeat(80))
    debugLogPHI(normalizedMarkdown)
    debugLog("=".repeat(80))

    return normalizedMarkdown
  } catch (error) {
    debugError("❌ Failed to generate clinical note:", error)
    debugWarn("⚠️  Propagating note generation error")
    throw toPipelineStageError(error, {
      code: "note_generation_error",
      message: "Failed to generate clinical note",
      recoverable: true,
      details: {
        template: template || "default",
      },
    })
  }
}
