#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const DEFAULT_BASE_URL = "http://127.0.0.1:8080"
const DEFAULT_MODEL = "medgemma-1.5-4b-it"
const DEFAULT_WINDOW_CHARS = 2400

function createEmptyArtifacts() {
  return {
    encounterState: {
      problems: [],
      medications: [],
      allergies: [],
      ros_positive: [],
      ros_negative: [],
      timeline: [],
    },
    draftNote: {
      hpi: "not documented",
      ros: "not documented",
      assessment: "not documented",
      plan: "not documented",
    },
    recentTranscriptWindow: "",
  }
}

function updateRecentTranscriptWindow(previous, chunk, maxChars = DEFAULT_WINDOW_CHARS) {
  const combined = [previous, chunk].filter((value) => value && value.trim().length > 0).join("\n")
  if (combined.length <= maxChars) return combined
  return combined.slice(combined.length - maxChars)
}

function buildScribePrompt({ transcriptChunk, recentTranscriptWindow, encounterState, draftNote }) {
  return [
    "You are updating an existing encounter state and draft note.",
    "Only update fields affected by the new transcript chunk.",
    "If a field is unchanged, keep it identical.",
    "",
    "NEW TRANSCRIPT CHUNK:",
    transcriptChunk || "(empty)",
    "",
    "RECENT TRANSCRIPT WINDOW:",
    recentTranscriptWindow || "(empty)",
    "",
    "CURRENT ENCOUNTER STATE (JSON):",
    JSON.stringify(encounterState, null, 2),
    "",
    "CURRENT DRAFT NOTE (JSON):",
    JSON.stringify(draftNote, null, 2),
    "",
    "Return updated JSON now.",
  ].join("\n")
}

const JSON_SCHEMA = `{
  "encounter_state": {
    "problems": [],
    "medications": [],
    "allergies": [],
    "ros_positive": [],
    "ros_negative": [],
    "timeline": []
  },
  "draft_note": {
    "hpi": "",
    "ros": "",
    "assessment": "",
    "plan": ""
  },
  "recent_transcript_window": "",
  "warnings": []
}`

const SCRIBE_SYSTEM_PROMPT = `You are a medical scribe. Use ONLY facts explicitly stated in the transcript.
Do NOT invent vitals, labs, diagnoses, or medications.
If information is missing, write "not documented".
Return VALID JSON only. No markdown. No prose.
The JSON must match this schema exactly:\n${JSON_SCHEMA}`

function extractJson(text) {
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

function renderDraftNote(draft) {
  return [
    "HPI:",
    draft.hpi,
    "",
    "ROS:",
    draft.ros,
    "",
    "Assessment:",
    draft.assessment,
    "",
    "Plan:",
    draft.plan,
  ].join("\n")
}

const VITALS_REGEX = /\b(bp|blood pressure|hr|heart rate|rr|respiratory rate|temp|temperature|spo2|oxygen saturation)\b/i
const DOSING_REGEX = /\b(\d+\s?(mg|mcg|ml|units)|q\d+h|bid|tid|qid|qd)\b/i

function runSafetyChecks({ transcript, draftNote, encounterState }) {
  const warnings = []
  const transcriptNormalized = (transcript || "").toLowerCase()
  const noteText = [draftNote.hpi, draftNote.ros, draftNote.assessment, draftNote.plan].join(" ").toLowerCase()

  if (VITALS_REGEX.test(noteText) && !VITALS_REGEX.test(transcriptNormalized)) {
    warnings.push("Vitals mentioned in note but not found in transcript window.")
  }
  if (DOSING_REGEX.test(noteText) && !DOSING_REGEX.test(transcriptNormalized)) {
    warnings.push("Medication dosing appears in note but not found in transcript window.")
  }

  const rosOverlap = encounterState.ros_positive.filter((item) => encounterState.ros_negative.includes(item))
  if (rosOverlap.length > 0) {
    warnings.push(`ROS contradiction detected for: ${rosOverlap.join(", ")}.`)
  }
  return warnings
}

async function runMedGemmaRequest({ system, prompt, model, baseUrl, apiKey }) {
  if (!system?.trim()) throw new Error("system is required")
  if (!prompt?.trim()) throw new Error("prompt is required")

  const urlBase = (baseUrl || process.env.MEDGEMMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "")
  const modelName = model || process.env.MEDGEMMA_MODEL || DEFAULT_MODEL
  const headers = { "Content-Type": "application/json" }
  if (apiKey || process.env.MEDGEMMA_API_KEY) {
    headers.Authorization = `Bearer ${apiKey || process.env.MEDGEMMA_API_KEY}`
  }

  const response = await fetch(`${urlBase}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
      top_p: 0.9,
      stream: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`MedGemma request failed (${response.status}): ${errorText || response.statusText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text
  if (!content) {
    throw new Error("No content returned from MedGemma response")
  }
  return content
}

function readArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function ensureValue(value, message) {
  if (!value) {
    console.error(message)
    process.exit(1)
  }
}

const transcriptPath = readArg("--transcript")
const statePath = readArg("--state")
const outPath = readArg("--out") || path.resolve("build/medgemma-artifacts.json")

ensureValue(transcriptPath, "Missing --transcript /path/to/transcript.txt")

const transcriptChunk = fs.readFileSync(transcriptPath, "utf-8").trim()
const artifacts = statePath
  ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
  : createEmptyArtifacts()

const recentTranscriptWindow = updateRecentTranscriptWindow(
  artifacts.recentTranscriptWindow,
  transcriptChunk
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
})

const jsonText = extractJson(rawModelOutput)
const parsed = JSON.parse(jsonText)

const nextArtifacts = {
  encounterState: parsed.encounter_state,
  draftNote: parsed.draft_note,
  recentTranscriptWindow: parsed.recent_transcript_window || recentTranscriptWindow,
}

const warnings = [
  ...(parsed.warnings || []),
  ...runSafetyChecks({
    transcript: nextArtifacts.recentTranscriptWindow,
    draftNote: nextArtifacts.draftNote,
    encounterState: nextArtifacts.encounterState,
  }),
]

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(nextArtifacts, null, 2))

if (warnings.length > 0) {
  console.warn("Warnings:\n" + warnings.map((warning) => `- ${warning}`).join("\n"))
}

console.log(renderDraftNote(nextArtifacts.draftNote))
