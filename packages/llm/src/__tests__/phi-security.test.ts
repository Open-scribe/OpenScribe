import assert from "node:assert/strict"
import test from "node:test"
import { prompts } from "../index.js"

/**
 * PHI (Protected Health Information) Security Tests
 * 
 * HIPAA Compliance: Verify that prompts sent to external LLM providers
 * follow the Minimum Necessary principle - only transcript data is sent,
 * not patient names or other direct identifiers.
 */

test("getUserPrompt does NOT include patient_name in the prompt text", () => {
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript: "Patient reports headache for 3 days.",
    patient_name: "John Doe",
    visit_reason: "Headache evaluation",
    noteLength: "long",
  })

  // The prompt should NOT contain the patient name
  assert.ok(
    !userPrompt.includes("John Doe"),
    "User prompt must NOT include patient_name to minimize PHI exposure"
  )
})

test("getUserPrompt does NOT include visit_reason in the prompt text", () => {
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript: "Patient reports headache for 3 days.",
    patient_name: "Jane Smith",
    visit_reason: "Migraine assessment and treatment",
    noteLength: "long",
  })

  // The prompt should NOT contain the visit reason
  assert.ok(
    !userPrompt.includes("Migraine assessment"),
    "User prompt must NOT include visit_reason to minimize PHI exposure"
  )
})

test("getUserPrompt ONLY includes transcript data", () => {
  const transcript = "Patient presents with fever, cough, and shortness of breath for 5 days."
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript,
    patient_name: "Alice Johnson",
    visit_reason: "Respiratory symptoms",
    noteLength: "short",
  })

  // The prompt should contain the transcript
  assert.ok(
    userPrompt.includes(transcript),
    "User prompt must include the transcript"
  )

  // But NOT the patient name or visit reason
  assert.ok(
    !userPrompt.includes("Alice Johnson"),
    "User prompt must NOT include patient_name"
  )
  assert.ok(
    !userPrompt.includes("Respiratory symptoms"),
    "User prompt must NOT include visit_reason"
  )
})

test("getSystemPrompt does NOT include PHI parameters", () => {
  const systemPrompt = prompts.clinicalNote.currentVersion.getSystemPrompt("long")

  // System prompt should never contain PHI - it's just instructions
  // Verify it doesn't accidentally leak parameters
  assert.ok(
    typeof systemPrompt === "string" && systemPrompt.length > 0,
    "System prompt should be a non-empty string"
  )

  // Verify common PHI-related strings are not present
  const phiKeywords = ["patient_name", "visit_reason", "John Doe", "Jane Smith"]
  for (const keyword of phiKeywords) {
    assert.ok(
      !systemPrompt.includes(keyword),
      `System prompt must NOT contain "${keyword}"`
    )
  }
})

test("Prompt construction follows Minimum Necessary principle", () => {
  // HIPAA Minimum Necessary: Only send what's needed for the task
  // For clinical note generation, we only need the transcript
  const params = {
    transcript: "Patient denies chest pain. Blood pressure 120/80.",
    patient_name: "Bob Williams",
    visit_reason: "Annual physical",
    noteLength: "long" as const,
  }

  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt(params)

  // Verify transcript is present (necessary for note generation)
  assert.ok(
    userPrompt.includes(params.transcript),
    "Transcript must be included (necessary for task)"
  )

  // Verify PHI identifiers are NOT present (not necessary for task)
  assert.ok(
    !userPrompt.includes(params.patient_name),
    "Patient name must NOT be included (not necessary for task)"
  )
  assert.ok(
    !userPrompt.includes(params.visit_reason),
    "Visit reason must NOT be included (not necessary for task)"
  )
})
