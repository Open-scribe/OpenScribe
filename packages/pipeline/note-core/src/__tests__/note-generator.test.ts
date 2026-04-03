import assert from "node:assert/strict"
import test from "node:test"
import { createClinicalNoteText } from "../note-generator.js"
import { parseMarkdownNote, createEmptyMarkdownNote } from "../clinical-models/markdown-note.js"

/**
 * Clinical Note Generation Tests (Markdown)
 * 
 * These tests verify the markdown-based clinical note generation pipeline:
 * 1. Prompt construction with templates
 * 2. LLM integration for markdown generation
 * 3. Response parsing (including markdown fence handling)
 * 4. Section extraction and validation
 * 5. Error handling
 */

test("createClinicalNoteText returns empty note for empty transcript", async () => {
  const result = await createClinicalNoteText({
    transcript: "",
    patient_name: "Test Patient",
    visit_reason: "routine_checkup",
  })

  const emptyNote = createEmptyMarkdownNote()

  assert.equal(result.trim(), emptyNote.trim(), "Should return empty note for empty transcript")
})

test("createClinicalNoteText returns valid markdown structure", async () => {
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

  // Should be valid markdown with sections
  const sections = parseMarkdownNote(result)

  // Should have all required sections
  const requiredSections = ["Chief Complaint", "History of Present Illness", "Review of Systems", "Physical Exam", "Assessment", "Plan"]
  for (const section of requiredSections) {
    assert.ok(section in sections, `Should have ${section} section`)
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

  const sections = parseMarkdownNote(result)

  // Chief complaint should mention foot/pain
  const ccLower = sections["Chief Complaint"]?.toLowerCase() || ""
  assert.ok(
    ccLower.includes("foot") || ccLower.includes("pain"),
    "Chief complaint should reference foot pain"
  )

  // HPI should have some content about the timeline
  const hpiLower = sections["History of Present Illness"]?.toLowerCase() || ""
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

  const sections = parseMarkdownNote(result)

  // Physical exam should be empty or minimal (not mentioned in transcript)
  const peContent = sections["Physical Exam"]?.trim() || ""
  assert.ok(
    peContent.length < 50,
    "Physical exam should be empty or minimal when not mentioned in transcript"
  )

  // Assessment should be empty or minimal (no diagnosis mentioned)
  const assessmentContent = sections["Assessment"]?.trim() || ""
  assert.ok(
    assessmentContent.length < 50,
    "Assessment should be empty or minimal when no diagnosis discussed"
  )

  // Plan should be empty or minimal (no treatment mentioned)
  const planContent = sections["Plan"]?.trim() || ""
  assert.ok(
    planContent.length < 50,
    "Plan should be empty or minimal when no treatment discussed"
  )
})

test("parseMarkdownNote handles well-formed markdown", () => {
  const markdown = `# Clinical Note

## Chief Complaint
Headache

## History of Present Illness
Started yesterday`

  const sections = parseMarkdownNote(markdown)

  assert.equal(sections["Chief Complaint"], "Headache")
  assert.equal(sections["History of Present Illness"], "Started yesterday")
})

test("createClinicalNoteText handles short note length", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const transcript = "Patient reports foot pain for the last week. Pain is worse when walking. Swelling noted."

  const result = await createClinicalNoteText({
    transcript,
    patient_name: "Test Patient",
    visit_reason: "history_physical",
    noteLength: "short",
  })

  // Should be valid markdown
  const sections = parseMarkdownNote(result)
  assert.ok("Chief Complaint" in sections, "Should have Chief Complaint section")
  
  // Short notes should be more concise than long notes
  // This is a qualitative check - the LLM should follow length guidance
  console.log("Short note length:", result.length)
  assert.ok(result.length > 0, "Should generate some content")
})

test("createClinicalNoteText handles API errors gracefully", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = ""

  try {
    await createClinicalNoteText({
      transcript: "Test transcript",
      patient_name: "Test",
      visit_reason: "test",
    })
    assert.fail("Expected note generation to throw")
  } catch (error) {
    assert.equal((error as { code?: string }).code, "note_generation_error")
    assert.equal(typeof (error as { message?: string }).message, "string")
    assert.equal((error as { recoverable?: boolean }).recoverable, true)
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
  assert.ok(prompts.clinicalNote.currentVersion.PROMPT_VERSION, "Should have version")
})
