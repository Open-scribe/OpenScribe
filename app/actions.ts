"use server"

import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

export async function transcribeAudio(audioBlob: Blob, apiKey: string | null): Promise<string> {
  // For demo purposes, we'll simulate transcription
  // In production, you would use Whisper API with the provided apiKey

  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // For now, return a sample transcript
  // In production: send audioBlob to Whisper API with apiKey
  const sampleTranscript = `
Doctor: Good morning, how are you feeling today?

Patient: Not great, doctor. I've been having this persistent headache for about a week now.

Doctor: I see. Can you describe the headache? Where is it located and how severe is it?

Patient: It's mostly on the right side of my head, kind of behind my eye. I'd say it's about a 6 or 7 out of 10 on bad days.

Doctor: Does anything make it better or worse?

Patient: It gets worse when I'm looking at screens for too long. Resting in a dark room helps a bit.

Doctor: Any other symptoms? Nausea, sensitivity to light, visual changes?

Patient: Yeah, I've been a bit sensitive to bright lights. No nausea though.

Doctor: Have you been under any unusual stress lately? Any changes in sleep patterns?

Patient: Work has been pretty stressful. I've been sleeping maybe 5-6 hours a night instead of my usual 8.

Doctor: Let me check your blood pressure and do a quick neurological exam.

[Physical exam performed]

Doctor: Your blood pressure is slightly elevated at 135/85. Neurological exam is normal. Based on your symptoms - the unilateral headache, photophobia, and association with stress and sleep deprivation - this appears to be a tension-type headache with some migraine features.

Patient: Is that serious?

Doctor: It's very manageable. I'd recommend starting with lifestyle modifications - prioritizing sleep, taking regular breaks from screens, and stress management. I'll also prescribe a mild pain reliever for acute episodes. If it doesn't improve in two weeks, we'll discuss preventive options.
  `.trim()

  return sampleTranscript
}

export async function generateClinicalNote(params: {
  transcript: string
  patient_name: string
  visit_reason: string
  apiKey: string | null
}): Promise<string> {
  const { transcript, patient_name, visit_reason, apiKey } = params

  const systemPrompt = `You are a clinical documentation assistant that converts patient encounter transcripts into structured clinical notes.

IMPORTANT INSTRUCTIONS:
- Output ONLY plain text in the exact format shown below
- Do NOT use JSON, markdown code blocks, or any special formatting
- Use ONLY information explicitly stated in the transcript
- If a section has no relevant information, write "Not discussed"
- Use professional medical terminology while keeping notes concise
- This is a DRAFT that requires clinician review

OUTPUT FORMAT (follow exactly):

Chief Complaint:
[Primary reason for visit in 1-2 sentences]

HPI:
[History of present illness - onset, duration, character, severity, modifying factors]

ROS:
[Review of systems - symptoms mentioned, organized by system]

Physical Exam:
[Any exam findings mentioned, or "Not documented" if none]

Assessment:
[Clinical assessment/diagnosis mentioned by clinician]

Plan:
[Treatment plan discussed with patient]`

  const userPrompt = `Convert this clinical encounter into a structured note.

Patient Name: ${patient_name || "Not provided"}
Visit Reason: ${visit_reason || "Not provided"}

TRANSCRIPT:
${transcript}

Generate the clinical note now, following the exact format specified.`

  try {
    if (apiKey) {
      const openai = createOpenAI({ apiKey })
      const { text } = await generateText({
        model: openai("gpt-4o"),
        system: systemPrompt,
        prompt: userPrompt,
      })
      return text
    } else {
      // Fallback to AI Gateway (no API key needed)
      const { text } = await generateText({
        model: "openai/gpt-4o",
        system: systemPrompt,
        prompt: userPrompt,
      })
      return text
    }
  } catch (error) {
    console.error("AI generation error:", error)
    throw new Error(`Failed to generate note: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}
