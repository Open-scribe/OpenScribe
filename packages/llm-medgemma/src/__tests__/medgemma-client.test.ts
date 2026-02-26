import assert from "node:assert/strict"
import test from "node:test"
import { runMedGemmaRequest } from "../index.js"

test("runMedGemmaRequest throws when system is missing", async () => {
  await assert.rejects(() => runMedGemmaRequest({ system: "", prompt: "hello" }), /system is required/i)
})

test("runMedGemmaRequest throws when prompt is missing", async () => {
  await assert.rejects(() => runMedGemmaRequest({ system: "sys", prompt: "" }), /prompt is required/i)
})

test("runMedGemmaRequest calls local endpoint", async () => {
  const originalFetch = globalThis.fetch
  const captured: { url?: string; init?: RequestInit } = {}

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.url = url
    captured.init = init
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    } as Response
  }) as typeof fetch

  try {
    const result = await runMedGemmaRequest({
      system: "sys",
      prompt: "hello",
      baseUrl: "http://127.0.0.1:8080",
      model: "medgemma-1.5-4b-it",
    })

    assert.equal(result, "ok")
    assert.equal(captured.url, "http://127.0.0.1:8080/v1/chat/completions")
    const body = JSON.parse(String(captured.init?.body))
    assert.equal(body.model, "medgemma-1.5-4b-it")
    assert.equal(body.messages[0].role, "system")
  } finally {
    globalThis.fetch = originalFetch
  }
})
