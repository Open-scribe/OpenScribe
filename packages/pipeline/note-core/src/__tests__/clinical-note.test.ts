import assert from "node:assert/strict"
import test from "node:test"
import { parseNoteText, serializeNote, formatNoteText, EMPTY_NOTE, type ClinicalNote } from "../clinical-models/clinical-note.js"

/**
 * Clinical Note Models Tests
 * 
 * These tests verify the core data models and parsing logic for clinical notes.
 * They don't require API integration and focus on data transformation and validation.
 */

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
  assert.equal(note.ros, "")
  assert.equal(note.physical_exam, "")
  assert.equal(note.assessment, "")
  assert.equal(note.plan, "")
})

test("parseNoteText handles JSON with markdown fences (```json)", () => {
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

test("parseNoteText handles JSON with plain markdown fences (```)", () => {
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

test("parseNoteText handles JSON with extra whitespace and newlines", () => {
  const messyJson = `

  \`\`\`json
  
  {
    "chief_complaint": "Headache",
    "hpi": "Started yesterday",
    "ros": "",
    "physical_exam": "",
    "assessment": "",
    "plan": ""
  }
  
  \`\`\`
  
  `

  const note = parseNoteText(messyJson)

  assert.equal(note.chief_complaint, "Headache")
  assert.equal(note.hpi, "Started yesterday")
})

test("parseNoteText handles malformed JSON gracefully", () => {
  const malformed = "{ invalid json }"

  const note = parseNoteText(malformed)

  assert.deepEqual(note, EMPTY_NOTE, "Should return empty note for malformed JSON")
})

test("parseNoteText handles empty string", () => {
  const note = parseNoteText("")

  assert.deepEqual(note, EMPTY_NOTE)
})

test("parseNoteText handles null/undefined input", () => {
  // @ts-expect-error - testing invalid input
  const note1 = parseNoteText(null)
  assert.deepEqual(note1, EMPTY_NOTE)

  // @ts-expect-error - testing invalid input
  const note2 = parseNoteText(undefined)
  assert.deepEqual(note2, EMPTY_NOTE)
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
  assert.equal(note.physical_exam, "", "Missing fields should default to empty string")
  assert.equal(note.assessment, "", "Missing fields should default to empty string")
  assert.equal(note.plan, "", "Missing fields should default to empty string")
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
  // Non-string values should be coerced to empty strings
  assert.equal(typeof note.hpi, "string")
  assert.equal(typeof note.ros, "string")
  assert.equal(typeof note.physical_exam, "string")
  assert.equal(typeof note.assessment, "string")
  assert.equal(typeof note.plan, "string")
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

test("serializeNote produces properly formatted JSON", () => {
  const note: ClinicalNote = {
    chief_complaint: "Test",
    hpi: "Test",
    ros: "",
    physical_exam: "",
    assessment: "",
    plan: "",
  }

  const serialized = serializeNote(note)

  // Should be pretty-printed (have newlines and indentation)
  assert.ok(serialized.includes("\n"), "Should have newlines")
  assert.ok(serialized.includes("  "), "Should have indentation")
})

test("formatNoteText produces human-readable format", () => {
  const note: ClinicalNote = {
    chief_complaint: "Headache",
    hpi: "Started yesterday, throbbing pain",
    ros: "Denies nausea",
    physical_exam: "Alert and oriented",
    assessment: "Tension headache",
    plan: "Acetaminophen as needed",
  }

  const formatted = formatNoteText(note)

  assert.ok(formatted.includes("Chief Complaint:"))
  assert.ok(formatted.includes("Headache"))
  assert.ok(formatted.includes("HPI:"))
  assert.ok(formatted.includes("Started yesterday"))
  assert.ok(formatted.includes("ROS:"))
  assert.ok(formatted.includes("Physical Exam:"))
  assert.ok(formatted.includes("Assessment:"))
  assert.ok(formatted.includes("Plan:"))
})

test("formatNoteText handles empty fields", () => {
  const formatted = formatNoteText(EMPTY_NOTE)

  // Should have all section headers even if empty
  assert.ok(formatted.includes("Chief Complaint:"))
  assert.ok(formatted.includes("HPI:"))
  assert.ok(formatted.includes("ROS:"))
  assert.ok(formatted.includes("Physical Exam:"))
  assert.ok(formatted.includes("Assessment:"))
  assert.ok(formatted.includes("Plan:"))
})

test("parseNoteText and serializeNote are reversible", () => {
  const original: ClinicalNote = {
    chief_complaint: "Foot pain",
    hpi: "Patient reports pain for 1 week",
    ros: "Negative",
    physical_exam: "Foot appears swollen",
    assessment: "Possible sprain",
    plan: "Rest, ice, follow up in 1 week",
  }

  const serialized = serializeNote(original)
  const parsed = parseNoteText(serialized)

  assert.deepEqual(parsed, original)
})

test("parseNoteText handles all required fields", () => {
  const allFields = JSON.stringify({
    chief_complaint: "CC",
    hpi: "HPI",
    ros: "ROS",
    physical_exam: "PE",
    assessment: "Assess",
    plan: "Plan",
  })

  const note = parseNoteText(allFields)

  assert.equal(note.chief_complaint, "CC")
  assert.equal(note.hpi, "HPI")
  assert.equal(note.ros, "ROS")
  assert.equal(note.physical_exam, "PE")
  assert.equal(note.assessment, "Assess")
  assert.equal(note.plan, "Plan")
})

test("EMPTY_NOTE has all fields as empty strings", () => {
  assert.equal(EMPTY_NOTE.chief_complaint, "")
  assert.equal(EMPTY_NOTE.hpi, "")
  assert.equal(EMPTY_NOTE.ros, "")
  assert.equal(EMPTY_NOTE.physical_exam, "")
  assert.equal(EMPTY_NOTE.assessment, "")
  assert.equal(EMPTY_NOTE.plan, "")
})

test("parseNoteText handles Unicode characters", () => {
  const note = {
    chief_complaint: "Patients état de santé",
    hpi: "Symptoms include: 头痛, 発熱",
    ros: "Système nerveux: normal",
    physical_exam: "",
    assessment: "",
    plan: "",
  }

  const serialized = JSON.stringify(note)
  const parsed = parseNoteText(serialized)

  assert.deepEqual(parsed, note)
})

test("parseNoteText handles special characters and quotes", () => {
  const note = {
    chief_complaint: `Patient says "my foot hurts"`,
    hpi: "Pain described as 'sharp'",
    ros: "",
    physical_exam: "",
    assessment: "Diagnosis: it's complicated",
    plan: "",
  }

  const serialized = JSON.stringify(note)
  const parsed = parseNoteText(serialized)

  assert.deepEqual(parsed, note)
})
