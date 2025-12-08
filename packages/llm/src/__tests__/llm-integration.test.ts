import assert from "node:assert/strict"
import test from "node:test"
import { runLLMRequest } from "../index.js"

/**
 * LLM Integration Tests
 * 
 * These tests verify the LLM integration layer works correctly with the Anthropic API.
 * They are designed to be flexible to allow implementation changes while catching
 * critical errors like API incompatibilities, response parsing issues, etc.
 */

test("runLLMRequest throws when ANTHROPIC_API_KEY is missing", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY

  try {
    await assert.rejects(
      async () => {
        await runLLMRequest({
          system: "Test system prompt",
          prompt: "Test prompt",
        })
      },
      {
        message: /ANTHROPIC_API_KEY.*required/i,
      },
      "Should throw error when API key is missing"
    )
  } finally {
    // Restore the original key
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  }
})

test("runLLMRequest requires system and prompt parameters", async () => {
  // Skip if no API key (don't want to fail on CI without secrets)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping test - ANTHROPIC_API_KEY not set")
    return
  }

  await assert.rejects(
    async () => {
      // @ts-expect-error - Testing invalid input
      await runLLMRequest({})
    },
    /system|prompt/i,
    "Should validate required parameters"
  )
})

test("runLLMRequest returns string response for simple prompts", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const response = await runLLMRequest({
    system: "You are a helpful assistant. Respond with exactly one word.",
    prompt: "Say 'hello'",
    model: "claude-3-haiku-20240307", // Use cheaper model for tests
  })

  assert.equal(typeof response, "string", "Response should be a string")
  assert.ok(response.length > 0, "Response should not be empty")
  assert.ok(response.toLowerCase().includes("hello"), "Response should contain 'hello'")
})

test("runLLMRequest with jsonSchema returns valid JSON", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name", "age"],
  }

  const response = await runLLMRequest({
    system: "You are a data generator. Generate test data following the schema.",
    prompt: "Generate a person with name 'Alice' and age 30",
    model: "claude-3-haiku-20240307",
    jsonSchema: {
      name: "PersonData",
      schema,
    },
  })

  // Response should be valid JSON
  let parsed: any
  assert.doesNotThrow(() => {
    parsed = JSON.parse(response)
  }, "Response should be valid JSON")

  // Should match schema
  assert.equal(typeof parsed.name, "string", "name should be a string")
  assert.equal(typeof parsed.age, "number", "age should be a number")
  assert.ok(parsed.name.length > 0, "name should not be empty")
})

test("runLLMRequest with jsonSchema enforces schema structure", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  const schema = {
    type: "object",
    properties: {
      field_a: { type: "string" },
      field_b: { type: "string" },
      field_c: { type: "string" },
    },
    required: ["field_a", "field_b", "field_c"],
    additionalProperties: false,
  }

  const response = await runLLMRequest({
    system: "Generate structured data.",
    prompt: "Generate data with three fields: field_a, field_b, field_c",
    model: "claude-3-haiku-20240307",
    jsonSchema: {
      name: "TestData",
      schema,
    },
  })

  const parsed = JSON.parse(response)

  // All required fields should exist
  assert.ok("field_a" in parsed, "field_a should exist")
  assert.ok("field_b" in parsed, "field_b should exist")
  assert.ok("field_c" in parsed, "field_c should exist")

  // All should be strings
  assert.equal(typeof parsed.field_a, "string")
  assert.equal(typeof parsed.field_b, "string")
  assert.equal(typeof parsed.field_c, "string")
})

test("runLLMRequest handles errors gracefully", async () => {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Skipping live API test - ANTHROPIC_API_KEY not set")
    return
  }

  // Test with invalid model name
  await assert.rejects(
    async () => {
      await runLLMRequest({
        system: "Test",
        prompt: "Test",
        model: "invalid-model-name-12345",
      })
    },
    /404|not found|model/i,
    "Should throw error for invalid model"
  )
})
