/**
 * Clinical Note Generation Prompt - Version 1
 * Optimized for Claude models with JSON output
 */

export interface ClinicalNotePromptParams {
  transcript: string
  patient_name?: string
  visit_reason?: string
}

export const PROMPT_VERSION = "v1"
export const MODEL_OPTIMIZED_FOR = "claude-sonnet-4-5-20250929"

/**
 * JSON Schema for clinical note structure
 * All fields are required strings to ensure consistent output
 */
export const CLINICAL_NOTE_SCHEMA = {
  type: "object",
  properties: {
    chief_complaint: { 
      type: "string",
      description: "The patient's primary concern or reason for visit, in their own words when possible"
    },
    hpi: { 
      type: "string",
      description: "History of Present Illness - chronological narrative of the current condition"
    },
    ros: { 
      type: "string",
      description: "Review of Systems - systematic review of body systems"
    },
    physical_exam: { 
      type: "string",
      description: "Physical examination findings documented during the encounter"
    },
    assessment: { 
      type: "string",
      description: "Clinical assessment, diagnoses, and medical decision-making"
    },
    plan: { 
      type: "string",
      description: "Treatment plan, prescriptions, follow-up, and patient instructions"
    },
  },
  required: ["chief_complaint", "hpi", "ros", "physical_exam", "assessment", "plan"],
  additionalProperties: false,
} as const

/**
 * System prompt for clinical note generation
 * Emphasizes Claude's strengths: careful reasoning, medical knowledge, and structured output
 */
export function getSystemPrompt(): string {
  return `You are an expert clinical documentation assistant with deep medical knowledge. Your role is to convert patient encounter transcripts into accurate, well-structured clinical notes.

CORE PRINCIPLES:
- Accuracy: Only document information explicitly stated in the transcript
- Precision: Use appropriate medical terminology while maintaining clarity
- Completeness: Extract all relevant clinical information for each section
- Conservatism: Empty sections should contain empty strings, not placeholder text

OUTPUT FORMAT:
- Return valid JSON matching the schema exactly
- All fields are required and must be strings
- Use empty string ("") for sections with no relevant information
- Do NOT use placeholders like "Not discussed", "Not documented", or "None noted"
- Do NOT add markdown formatting, code fences, or explanatory text

CLINICAL SECTIONS:
1. Chief Complaint: Patient's primary concern in their own words
2. HPI: Chronological narrative with onset, location, duration, characteristics, aggravating/relieving factors
3. ROS: Systematic review organized by body system (only if discussed)
4. Physical Exam: Objective findings from examination (only if documented)
5. Assessment: Clinical reasoning, differential diagnosis, impressions
6. Plan: Diagnostic workup, treatments, medications, follow-up, patient education

IMPORTANT CONSTRAINTS:
- Do NOT infer information not stated in the transcript
- Do NOT use patient name or visit reason to generate content
- Do NOT add assumptions or standard medical practices unless mentioned
- If the transcript is empty or lacks clinical content, return all empty strings
- This is a DRAFT requiring clinician review and approval

Your output will be parsed as JSON, so ensure strict JSON formatting with double quotes and no trailing commas.`
}

/**
 * User prompt for clinical note generation
 * Provides clear instructions and the transcript to analyze
 */
export function getUserPrompt(params: ClinicalNotePromptParams): string {
  const { transcript } = params
  
  return `Convert this clinical encounter transcript into a structured note following the schema provided in the system message.

TRANSCRIPT:
${transcript}

Generate a JSON object with all six required fields. Extract only information explicitly stated in the transcript above. Use empty strings for any sections that have no relevant information in the transcript.`
}

/**
 * Metadata for prompt versioning and A/B testing
 */
export const PROMPT_METADATA = {
  version: PROMPT_VERSION,
  created_at: "2025-12-08",
  optimized_for: MODEL_OPTIMIZED_FOR,
  description: "Initial version optimized for Claude Sonnet 4.5 with JSON mode",
  changelog: [
    "Initial release with emphasis on accuracy and conservative documentation",
  ],
} as const
