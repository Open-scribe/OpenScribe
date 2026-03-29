import assert from "node:assert/strict"
import test from "node:test"
import { calculateOverlap, classifyClaim, extractNumbers, tokenize } from "../verification/verifier.js"

test("tokenize extracts tokens and filters stop words", () => {
  const tokens = tokenize("Patient reports headache for 3 days")
  assert.ok(tokens.includes("headache"))
  assert.ok(!tokens.includes("for"))
})

test("tokenize handles empty string", () => {
  assert.deepEqual(tokenize(""), [])
})

test("extractNumbers extracts integer and decimal values", () => {
  const numbers = extractNumbers("BP 120/80, temp 98.6")
  assert.ok(numbers.includes("120"))
  assert.ok(numbers.includes("98.6"))
})

test("calculateOverlap returns 1 for identical text", () => {
  assert.equal(calculateOverlap("severe headache", "severe headache"), 1)
})

test("calculateOverlap returns 0 with no shared tokens", () => {
  assert.equal(calculateOverlap("headache pain", "cardiac issues"), 0)
})

test("classifyClaim identifies fact claims", () => {
  assert.equal(classifyClaim("Patient has hypertension."), "fact")
})

test("classifyClaim identifies question claims", () => {
  assert.equal(classifyClaim("Does the patient smoke?"), "question")
})

test("classifyClaim identifies inference claims", () => {
  assert.equal(classifyClaim("I think this might be migraine."), "inference")
})
