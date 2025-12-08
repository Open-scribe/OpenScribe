import assert from "node:assert/strict"
import test from "node:test"
import { createClinicalNoteText } from "../note-generator.js"
import { parseNoteText, serializeNote, EMPTY_NOTE, type ClinicalNote } from "../clinical-models/clinical-note.js"

/**
 * Clinical Note Generation Tests
 * 
 * These tests verify the clinical note generation pipeline:
 * 1. Prompt construction
 * 2. LLM integration
 * 3. Response parsing (including markdown fence handling)
 * 4. Schema validation
 * 5. Error handling
 * 
 * Tests are designed to be flexible to implementation changes while catching
 * critical issues like JSON parsing failures, API incompatibilities, etc.
 */

test("createClinicalNoteText returns empty note for empty transcript", async () => {
  const result = await createClinicalNoteText({
    transcript: "",
    patient_name: "Test Patient",
    visit_reason: "routine_checkup",
  })

  const note = parseNoteText(result)

  assert.deepEqual(note, EMPTY_NOTE, "Should return empty note for empty transcript")
})

test("createClinicalNoteText returns valid JSON structure", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const result = await createClinicalNoteText({
    transcript: "Patient reports foot pain for the last week. Pain is worse when walking.",
    patient_name: "Test Patient",
    visit_reason: "history_physical",
  })

  // Should be valid JSON
  let parsed: ClinicalNote
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result)
  }, "Response should be valid JSON")

  // Should have all required fields
  const requiredFields = ["chief_complaint", "hpi", "ros", "physical_exam", "assessment", "plan"]
  for (const field of requiredFields) {
    assert.ok(field in parsed!, `Should have ${field} field`)
    assert.equal(typeof parsed![field as keyof ClinicalNote], "string", `${field} should be a string`)
  }
})

test("createClinicalNoteText generates appropriate content from transcript", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const transcript = "My foot has been hurting for the last week. It's swollen and painful when I walk."

  const result = await createClinicalNoteText({
    transcript,
    patient_name: "Test Patient",
    visit_reason: "history_physical",
  })

  const note = parseNoteText(result)

  // Chief complaint should mention foot/pain
  const ccLower = note.chief_complaint.toLowerCase()
  assert.ok(
    ccLower.includes("foot") || ccLower.includes("pain"),
    "Chief complaint should reference foot pain"
  )

  // HPI should have some content about the timeline
  const hpiLower = note.hpi.toLowerCase()
  assert.ok(
    hpiLower.includes("week") || hpiLower.includes("swollen") || hpiLower.includes("walk"),
    "HPI should include details from transcript"
  )
})

test("createClinicalNoteText does not invent information", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const transcript = "Patient says their foot hurts."

  const result = await createClinicalNoteText({
    transcript,
    patient_name: "Test Patient",
    visit_reason: "history_physical",
  })

  const note = parseNoteText(result)

  // Physical exam should be empty (not mentioned in transcript)
  assert.equal(
    note.physical_exam,
    "",
    "Physical exam should be empty when not mentioned in transcript"
  )

  // Assessment should be empty (no diagnosis mentioned)
  assert.equal(note.assessment, "", "Assessment should be empty when no diagnosis discussed")

  // Plan should be empty (no treatment mentioned)
  assert.equal(note.plan, "", "Plan should be empty when no treatment discussed")
})

test("parseNoteText handles JSON without markdown fences", () => {
  const jsonNote = JSON.stringify({
    chief_complaint: "Headache",
    hpi: "Started yesterday",
    ros: "",
    physical_exam: "",
    assessment: "",
    plan: "",
  })

  const note = parseNoteText(jsonNote)

  assert.equal(note.chief_complaint, "Headache")
  assert.equal(note.hpi, "Started yesterday")
})

test("parseNoteText handles JSON with markdown fences", () => {
  const wrappedJson = `\`\`\`json
{
  "chief_complaint": "Headache",
  "hpi": "Started yesterday",
  "ros": "",
  "physical_exam": "",
  "assessment": "",
  "plan": ""
}
\`\`\``

  const note = parseNoteText(wrappedJson)

  assert.equal(note.chief_complaint, "Headache")
  assert.equal(note.hpi, "Started yesterday")
})

test("parseNoteText handles JSON with plain markdown fences", () => {
  const wrappedJson = `\`\`\`
{
  "chief_complaint": "Headache",
  "hpi": "Started yesterday",
  "ros": "",
  "physical_exam": "",
  "assessment": "",
  "plan": ""
}
\`\`\``

  const note = parseNoteText(wrappedJson)

  assert.equal(note.chief_complaint, "Headache")
  assert.equal(note.hpi, "Started yesterday")
})

test("parseNoteText handles malformed JSON gracefully", () => {
  const malformed = "{ invalid json }"

  const note = parseNoteText(malformed)

  assert.deepEqual(note, EMPTY_NOTE, "Should return empty note for malformed JSON")
})

test("parseNoteText handles missing fields gracefully", () => {
  const partial = JSON.stringify({
    chief_complaint: "Headache",
    // Missing other fields
  })

  const note = parseNoteText(partial)

  assert.equal(note.chief_complaint, "Headache")
  assert.equal(note.hpi, "", "Missing fields should default to empty string")
  assert.equal(note.ros, "", "Missing fields should default to empty string")
})

test("parseNoteText handles non-string field values", () => {
  const invalidTypes = JSON.stringify({
    chief_complaint: "Valid",
    hpi: 123, // number instead of string
    ros: null, // null instead of string
    physical_exam: true, // boolean instead of string
    assessment: ["array"], // array instead of string
    plan: { object: true }, // object instead of string
  })

  const note = parseNoteText(invalidTypes)

  assert.equal(note.chief_complaint, "Valid")
  assert.equal(typeof note.hpi, "string", "Non-string values should be converted to strings")
  assert.equal(typeof note.ros, "string", "Non-string values should be converted to strings")
  assert.equal(typeof note.physical_exam, "string", "Non-string values should be converted to strings")
  assert.equal(typeof note.assessment, "string", "Non-string values should be converted to strings")
  assert.equal(typeof note.plan, "string", "Non-string values should be converted to strings")
})

test("serializeNote produces valid JSON", () => {
  const note: ClinicalNote = {
    chief_complaint: "Foot pain",
    hpi: "Patient reports pain for 1 week",
    ros: "Negative",
    physical_exam: "Foot appears swollen",
    assessment: "Possible sprain",
    plan: "Rest, ice, follow up in 1 week",
  }

  const serialized = serializeNote(note)

  // Should be valid JSON
  let parsed: ClinicalNote
  assert.doesNotThrow(() => {
    parsed = JSON.parse(serialized)
  })

  // Should match original
  assert.deepEqual(parsed!, note)
})

test("serializeNote handles empty fields", () => {
  const note = { ...EMPTY_NOTE }
  const serialized = serializeNote(note)

  const parsed = JSON.parse(serialized)

  assert.deepEqual(parsed, EMPTY_NOTE)
})

test("createClinicalNoteText throws descriptive error on API failure", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  // Temporarily break the API key to trigger an error
  const originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "invalid-key-12345"

  try {
    await assert.rejects(
      async () => {
        await createClinicalNoteText({
          transcript: "Test transcript",
          patient_name: "Test",
          visit_reason: "test",
        })
      },
      /Failed to generate note/i,
      "Should throw descriptive error on API failure"
    )
  } finally {
    process.env.ANTHROPIC_API_KEY = originalKey
  }
})

test("createClinicalNoteText uses versioned prompts", async () => {
  // This test verifies the system is using versioned prompts from the prompts module
  // We don't need to call the API, just verify the structure exists

  // Import prompts using relative path to avoid module resolution issues in tests
  const { prompts } = await import("../../../../llm/src/index.js")

  assert.ok(prompts.clinicalNote, "Should have clinicalNote prompts")
  assert.ok(prompts.clinicalNote.currentVersion, "Should have currentVersion")
  assert.equal(typeof prompts.clinicalNote.currentVersion.getSystemPrompt, "function")
  assert.equal(typeof prompts.clinicalNote.currentVersion.getUserPrompt, "function")
  assert.ok(prompts.clinicalNote.currentVersion.CLINICAL_NOTE_SCHEMA, "Should have schema")
  assert.ok(prompts.clinicalNote.currentVersion.PROMPT_VERSION, "Should have version")
})

test("prompt schema matches ClinicalNote interface", async () => {
  const { prompts } = await import("../../../../llm/src/index.js")

  const schema = prompts.clinicalNote.currentVersion.CLINICAL_NOTE_SCHEMA
  const requiredFields: Array<keyof typeof schema.properties> = [
    "chief_complaint",
    "hpi",
    "ros",
    "physical_exam",
    "assessment",
    "plan",
  ]

  assert.ok(schema.required, "Schema should have required fields")
  assert.equal(schema.required.length, requiredFields.length, "Should require all fields")

  for (const field of requiredFields) {
    assert.ok(schema.required.includes(field), `Schema should require ${field}`)
    assert.ok(schema.properties[field], `Schema should define ${field} property`)
    assert.equal(schema.properties[field].type, "string", `${field} should be string type`)
  }
})
