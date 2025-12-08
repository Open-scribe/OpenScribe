import { runLLMRequest, prompts } from "@llm"
import { EMPTY_NOTE, serializeNote } from "./clinical-models/clinical-note"

export interface ClinicalNoteRequest {
  transcript: string
  patient_name: string
  visit_reason: string
}

/**
 * Strips markdown code fences from LLM response
 * Handles cases where Claude returns ```json ... ``` wrapped responses
 */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim()
  
  // Remove ```json ... ``` or ``` ... ``` wrappers
  const jsonFencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/
  const match = trimmed.match(jsonFencePattern)
  
  if (match) {
    return match[1].trim()
  }
  
  return trimmed
}

export async function createClinicalNoteText(params: ClinicalNoteRequest): Promise<string> {
  const { transcript, patient_name, visit_reason } = params

  console.log("=".repeat(80))
  console.log("GENERATING CLINICAL NOTE")
  console.log("=".repeat(80))
  console.log(`Patient Name: ${patient_name || "Not provided"}`)
  console.log(`Visit Reason: ${visit_reason || "Not provided"}`)
  console.log(`Transcript length: ${transcript.length} characters`)

  if (!transcript || transcript.trim().length === 0) {
    console.log("⚠️  Transcript is empty - returning empty note structure")
    const emptyNote = serializeNote(EMPTY_NOTE)
    console.log("=".repeat(80))
    console.log("FINAL CLINICAL NOTE (EMPTY):")
    console.log("-".repeat(80))
    console.log(emptyNote)
    console.log("-".repeat(80))
    console.log("=".repeat(80))
    return emptyNote
  }

  console.log("📝 Transcript being used for note generation:")
  console.log("-".repeat(80))
  console.log(transcript)
  console.log("-".repeat(80))

  // Use versioned prompts
  const systemPrompt = prompts.clinicalNote.currentVersion.getSystemPrompt()
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript,
    patient_name,
    visit_reason,
  })

  try {
    console.log("🤖 Calling LLM to generate clinical note...")
    console.log(`📌 Using prompt version: ${prompts.clinicalNote.currentVersion.PROMPT_VERSION}`)
    console.log(`🤖 Model: ${prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR}`)
    
    const text = await runLLMRequest({
      system: systemPrompt,
      prompt: userPrompt,
      model: prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR,
      jsonSchema: {
        name: "ClinicalNote",
        schema: prompts.clinicalNote.currentVersion.CLINICAL_NOTE_SCHEMA,
      },
    })

    // Strip markdown fences if present
    const cleanedText = stripMarkdownFences(text)

    let formattedResponse: string
    try {
      const parsed = JSON.parse(cleanedText)
      
      // Validate all required fields are present and are strings
      const requiredFields = ["chief_complaint", "hpi", "ros", "physical_exam", "assessment", "plan"]
      const missingFields = requiredFields.filter((field) => !(field in parsed))
      
      if (missingFields.length > 0) {
        console.warn(`⚠️  Missing required fields: ${missingFields.join(", ")}`)
        throw new Error(`Invalid note structure: missing fields ${missingFields.join(", ")}`)
      }

      // Ensure all fields are strings
      for (const field of requiredFields) {
        if (typeof parsed[field] !== "string") {
          console.warn(`⚠️  Field '${field}' is not a string: ${typeof parsed[field]}`)
          parsed[field] = String(parsed[field] || "")
        }
      }

      formattedResponse = JSON.stringify(parsed, null, 2)
    } catch (parseError) {
      console.error("❌ Failed to parse LLM response as JSON:", parseError)
      console.log("Raw response:", text)
      console.log("Cleaned response:", cleanedText)
      console.warn("⚠️  Received non-JSON response from LLM, returning empty note")
      formattedResponse = serializeNote(EMPTY_NOTE)
    }

    console.log("=".repeat(80))
    console.log("FINAL CLINICAL NOTE:")
    console.log("=".repeat(80))
    console.log(formattedResponse)
    console.log("=".repeat(80))
    console.log(`Note length: ${formattedResponse.length} characters`)
    console.log("=".repeat(80))

    return formattedResponse
  } catch (error) {
    console.error("❌ AI generation error:", error)
    throw new Error(`Failed to generate note: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}
