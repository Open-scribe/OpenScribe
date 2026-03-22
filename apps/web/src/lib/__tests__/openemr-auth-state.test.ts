import { describe, it } from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtempSync } from "node:fs"
import {
  getOpenEMRTokenState,
  persistOpenEMRRefreshToken,
  recordOpenEMRRefreshAttempt,
} from "../openemr-auth-state.js"

describe("openemr-auth-state", () => {
  it("prefers persisted token over env fallback", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openemr-auth-state-"))
    process.env.OPENEMR_AUTH_STATE_FILE = path.join(dir, "state.json")

    const before = await getOpenEMRTokenState("env-token")
    assert.equal(before.source, "env")
    assert.equal(before.refreshToken, "env-token")

    await persistOpenEMRRefreshToken("persisted-token")
    const after = await getOpenEMRTokenState("env-token")
    assert.equal(after.source, "persisted")
    assert.equal(after.refreshToken, "persisted-token")
  })

  it("records last refresh attempt metadata", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openemr-auth-state-"))
    process.env.OPENEMR_AUTH_STATE_FILE = path.join(dir, "state.json")
    await persistOpenEMRRefreshToken("persisted-token")
    await recordOpenEMRRefreshAttempt("user_auth_failure")
    const state = await getOpenEMRTokenState("env-token")
    assert.equal(state.lastRefreshError, "user_auth_failure")
    assert.ok(state.lastRefreshAttempt)
  })
})
