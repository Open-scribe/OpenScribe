import assert from "node:assert/strict"
import test from "node:test"
import { transcriptionSessionStore } from "../session-store.js"

test("transcriptionSessionStore emits standardized pipeline error shape", async () => {
  const sessionId = `test-session-${Date.now()}`
  const received: Record<string, unknown>[] = []

  const unsubscribe = transcriptionSessionStore.subscribe(sessionId, (event) => {
    if (event.event === "error") {
      received.push(event.data)
    }
  })

  transcriptionSessionStore.emitError(sessionId, new Error("Assembler failure"))
  unsubscribe()

  assert.equal(received.length, 1)
  assert.equal(received[0].code, "assembly_error")
  assert.equal(received[0].message, "Assembler failure")
  assert.equal(received[0].recoverable, true)
})
