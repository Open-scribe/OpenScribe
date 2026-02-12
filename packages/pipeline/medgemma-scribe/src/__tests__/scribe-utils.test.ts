import assert from "node:assert/strict"
import test from "node:test"
import { createEmptyArtifacts, updateRecentTranscriptWindow } from "../state.js"
import { renderDraftNote } from "../render.js"
import { runSafetyChecks } from "../safety.js"

test("updateRecentTranscriptWindow trims to max length", () => {
  const previous = "A".repeat(10)
  const next = "B".repeat(10)
  const updated = updateRecentTranscriptWindow(previous, next, 12)
  assert.equal(updated.length, 12)
  assert.equal(updated, "AAAAAAAAAABBBB".slice(-12))
})

test("renderDraftNote formats sections", () => {
  const artifacts = createEmptyArtifacts()
  const text = renderDraftNote(artifacts.draftNote)
  assert.ok(text.includes("HPI:"))
  assert.ok(text.includes("Plan:"))
})

test("runSafetyChecks flags ros contradictions", () => {
  const warnings = runSafetyChecks({
    transcript: "",
    draftNote: {
      hpi: "not documented",
      ros: "not documented",
      assessment: "not documented",
      plan: "not documented",
    },
    encounterState: {
      problems: [],
      medications: [],
      allergies: [],
      ros_positive: ["nausea"],
      ros_negative: ["nausea"],
      timeline: [],
    },
  })
  assert.ok(warnings.some((warning) => warning.includes("ROS contradiction")))
})
