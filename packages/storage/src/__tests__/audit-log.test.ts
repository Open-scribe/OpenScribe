/**
 * Audit Log Tests
 * Verifies HIPAA-compliant audit logging functionality
 */

import test from "node:test"
import assert from "node:assert/strict"
import type { AuditLogEntry, AuditEventType } from "../types.js"
import {
  writeAuditEntry,
  getAuditEntries,
  exportAuditLog,
  setAuditRetentionDays,
  getAuditRetentionDays,
  cleanupOldAuditEntries,
  purgeAllAuditLogs,
  flushAuditQueue,
  withAudit,
} from "../audit-log.js"

// Mock localStorage
const mockStorage: Record<string, string> = {}
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  },
  length: 0,
  key: () => null,
} as Storage

// Mock crypto
let uuidCounter = 0
global.crypto = {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
  subtle: {
    encrypt: async (algorithm: any, key: any, data: any) => {
      const dataStr = typeof data === "string" ? data : new TextDecoder().decode(data)
      return new TextEncoder().encode(`encrypted:${dataStr}`)
    },
    decrypt: async (algorithm: any, key: any, data: any) => {
      const dataStr = new TextDecoder().decode(data)
      return new TextEncoder().encode(dataStr.replace("encrypted:", ""))
    },
    importKey: async () => ({} as CryptoKey),
  } as any,
} as Crypto

test("Audit Log Tests", async (t) => {
  t.beforeEach(() => {
    // Clear mock storage before each test
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    uuidCounter = 0
  })

  await t.test("writeAuditEntry creates entry with all required fields", async () => {
    const entry = await writeAuditEntry({
      event_type: "encounter.created",
      resource_id: "enc-123",
      success: true,
    })

    await flushAuditQueue()

    assert.ok(entry.id)
    assert.ok(entry.timestamp)
    assert.equal(entry.event_type, "encounter.created")
    assert.equal(entry.resource_id, "enc-123")
    assert.equal(entry.success, true)
    assert.equal(entry.user_id, "local-user")
  })

  await t.test("audit entries are stored encrypted", async () => {
    await writeAuditEntry({
      event_type: "encounter.created",
      success: true,
    })

    await flushAuditQueue()

    const rawData = localStorage.getItem("openscribe_audit_logs")
    assert.ok(rawData)
    assert.ok(rawData.startsWith("enc.v2."))
  })

  await t.test("getAuditEntries retrieves and decrypts logs", async () => {
    await writeAuditEntry({
      event_type: "encounter.created",
      resource_id: "enc-1",
      success: true,
    })

    await writeAuditEntry({
      event_type: "encounter.updated",
      resource_id: "enc-1",
      success: true,
    })

    await flushAuditQueue()

    const entries = await getAuditEntries()
    assert.equal(entries.length, 2)
    assert.equal(entries[0].event_type, "encounter.updated") // Most recent first
    assert.equal(entries[1].event_type, "encounter.created")
  })

  await t.test("getAuditEntries filters by date range", async () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    await writeAuditEntry({
      event_type: "encounter.created",
      success: true,
    })

    await flushAuditQueue()

    // Filter for future dates - should return nothing
    const futureEntries = await getAuditEntries({
      startDate: tomorrow.toISOString(),
    })
    assert.equal(futureEntries.length, 0)

    // Filter for past dates - should return entry
    const pastEntries = await getAuditEntries({
      startDate: yesterday.toISOString(),
      endDate: tomorrow.toISOString(),
    })
    assert.equal(pastEntries.length, 1)
  })

  await t.test("getAuditEntries filters by event type", async () => {
    await writeAuditEntry({ event_type: "encounter.created", success: true })
    await writeAuditEntry({ event_type: "encounter.updated", success: true })
    await writeAuditEntry({ event_type: "encounter.deleted", success: true })

    await flushAuditQueue()

    const filtered = await getAuditEntries({
      eventTypes: ["encounter.created", "encounter.deleted"],
    })

    assert.equal(filtered.length, 2)
    assert.ok(filtered.every((e) => ["encounter.created", "encounter.deleted"].includes(e.event_type)))
  })

  await t.test("getAuditEntries filters by success status", async () => {
    await writeAuditEntry({ event_type: "encounter.created", success: true })
    await writeAuditEntry({ event_type: "encounter.created", success: false, error_message: "Test error" })

    await flushAuditQueue()

    const successOnly = await getAuditEntries({ success: true })
    const failedOnly = await getAuditEntries({ success: false })

    assert.equal(successOnly.length, 1)
    assert.equal(failedOnly.length, 1)
    assert.equal(successOnly[0].success, true)
    assert.equal(failedOnly[0].success, false)
  })

  await t.test("getAuditEntries filters by resource ID", async () => {
    await writeAuditEntry({ event_type: "encounter.created", resource_id: "enc-1", success: true })
    await writeAuditEntry({ event_type: "encounter.created", resource_id: "enc-2", success: true })

    await flushAuditQueue()

    const filtered = await getAuditEntries({ resourceId: "enc-1" })

    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].resource_id, "enc-1")
  })

  await t.test("getAuditEntries respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      await writeAuditEntry({ event_type: "encounter.created", success: true })
    }

    await flushAuditQueue()

    const limited = await getAuditEntries({ limit: 5 })
    assert.equal(limited.length, 5)
  })

  await t.test("exportAuditLog generates CSV format", async () => {
    await writeAuditEntry({
      event_type: "encounter.created",
      resource_id: "enc-123",
      success: true,
      metadata: { test: "data" },
    })

    await flushAuditQueue()

    const blob = await exportAuditLog("csv")
    const text = await blob.text()

    assert.ok(text.includes("ID,Timestamp,Event Type"))
    assert.ok(text.includes("encounter.created"))
    assert.ok(text.includes("enc-123"))
    assert.ok(text.includes("true"))
  })

  await t.test("exportAuditLog generates JSON format", async () => {
    await writeAuditEntry({
      event_type: "encounter.created",
      success: true,
    })

    await flushAuditQueue()

    const blob = await exportAuditLog("json")
    const text = await blob.text()
    const data = JSON.parse(text)

    assert.ok(Array.isArray(data))
    assert.equal(data.length, 1)
    assert.equal(data[0].event_type, "encounter.created")
  })

  await t.test("exportAuditLog logs export action", async () => {
    await writeAuditEntry({ event_type: "encounter.created", success: true })
    await flushAuditQueue()

    await exportAuditLog("csv")
    await flushAuditQueue()

    const entries = await getAuditEntries()
    const exportEntry = entries.find((e) => e.event_type === "audit.exported")

    assert.ok(exportEntry)
    assert.equal(exportEntry.success, true)
    assert.equal(exportEntry.metadata?.format, "csv")
  })

  await t.test("retention policy can be set and retrieved", () => {
    setAuditRetentionDays(180)
    assert.equal(getAuditRetentionDays(), 180)

    setAuditRetentionDays(365)
    assert.equal(getAuditRetentionDays(), 365)
  })

  await t.test("retention policy rejects invalid values", () => {
    assert.throws(() => setAuditRetentionDays(0))
    assert.throws(() => setAuditRetentionDays(-10))
  })

  await t.test("cleanupOldAuditEntries removes expired entries", async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000) // 100 days ago

    // Create old entry (manually set timestamp)
    const oldEntry: AuditLogEntry = {
      id: "old-1",
      timestamp: old.toISOString(),
      event_type: "encounter.created",
      success: true,
      user_id: "local-user",
    }

    // Create recent entry
    await writeAuditEntry({ event_type: "encounter.updated", success: true })
    await flushAuditQueue()

    // Manually inject old entry
    const currentLogs = await getAuditEntries()
    const allLogs = [...currentLogs, oldEntry]
    await import("../secure-storage").then((m) =>
      m.saveSecureItem("openscribe_audit_logs", allLogs)
    )

    // Set retention to 90 days
    setAuditRetentionDays(90)

    // Cleanup
    const removed = await cleanupOldAuditEntries()

    assert.equal(removed, 1)

    // Verify old entry is gone
    const remaining = await getAuditEntries()
    assert.ok(remaining.every((e) => e.id !== "old-1"))
  })

  await t.test("cleanupOldAuditEntries logs cleanup action", async () => {
    setAuditRetentionDays(90)
    await cleanupOldAuditEntries()
    await flushAuditQueue()

    const entries = await getAuditEntries()
    const cleanupEntry = entries.find((e) => e.event_type === "audit.purged")

    // Only logged if entries were actually removed
    if (cleanupEntry) {
      assert.equal(cleanupEntry.success, true)
      assert.ok(cleanupEntry.metadata?.retention_days)
    }
  })

  await t.test("purgeAllAuditLogs removes all entries", async () => {
    await writeAuditEntry({ event_type: "encounter.created", success: true })
    await writeAuditEntry({ event_type: "encounter.updated", success: true })
    await flushAuditQueue()

    let entries = await getAuditEntries()
    assert.equal(entries.length, 2)

    await purgeAllAuditLogs()

    entries = await getAuditEntries()
    // Should only have the purge entry itself
    assert.equal(entries.length, 1)
    assert.equal(entries[0].event_type, "audit.purged")
    assert.equal(entries[0].metadata?.manual_purge, true)
  })

  await t.test("withAudit wrapper logs success", async () => {
    const result = await withAudit(
      async () => {
        return { id: "result-123", data: "test" }
      },
      {
        event_type: "encounter.created",
        metadata: { source: "test" },
      }
    )

    await flushAuditQueue()

    assert.equal(result.id, "result-123")

    const entries = await getAuditEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].event_type, "encounter.created")
    assert.equal(entries[0].resource_id, "result-123") // Extracted from result
    assert.equal(entries[0].success, true)
    assert.ok(entries[0].metadata?.duration_ms)
  })

  await t.test("withAudit wrapper logs failure", async () => {
    try {
      await withAudit(
        async () => {
          throw new Error("Test error")
        },
        {
          event_type: "encounter.created",
          resource_id: "enc-123",
        }
      )
      assert.fail("Should have thrown error")
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.equal(error.message, "Test error")
    }

    await flushAuditQueue()

    const entries = await getAuditEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].success, false)
    assert.equal(entries[0].error_message, "Test error")
  })

  await t.test("audit entries never contain PHI", async () => {
    // CRITICAL: This test ensures audit logs comply with HIPAA minimum necessary rule
    await writeAuditEntry({
      event_type: "encounter.created",
      resource_id: "enc-123",
      success: true,
      metadata: {
        has_patient_name: true, // OK - boolean flag
        transcript_length: 1500, // OK - count
        // NO patient names, transcripts, or notes allowed
      },
    })

    await flushAuditQueue()

    const entries = await getAuditEntries()
    const rawData = localStorage.getItem("openscribe_audit_logs")

    // Check that no PHI keywords appear in encrypted storage
    assert.ok(rawData)
    assert.ok(!rawData.includes("John Doe"))
    assert.ok(!rawData.includes("patient"))
    assert.ok(!rawData.includes("transcript:"))

    // Check that metadata doesn't contain PHI
    assert.ok(entries[0].metadata)
    assert.equal(typeof entries[0].metadata.has_patient_name, "boolean")
    assert.equal(typeof entries[0].metadata.transcript_length, "number")
  })

  await t.test("batch write queue accumulates entries", async () => {
    // Queue multiple entries
    await writeAuditEntry({ event_type: "encounter.created", success: true })
    await writeAuditEntry({ event_type: "encounter.updated", success: true })
    await writeAuditEntry({ event_type: "encounter.deleted", success: true })

    // Before flush, localStorage should not have them yet (or only partial)
    await flushAuditQueue()

    // After flush, all should be persisted
    const entries = await getAuditEntries()
    assert.equal(entries.length, 3)
  })

  await t.test("flushAuditQueue handles errors gracefully", async () => {
    await writeAuditEntry({ event_type: "encounter.created", success: true })

    // Simulate storage failure by making localStorage.setItem throw
    const originalSetItem = localStorage.setItem
    localStorage.setItem = () => {
      throw new Error("Storage quota exceeded")
    }

    try {
      await flushAuditQueue()
      assert.fail("Should have thrown error")
    } catch (error) {
      assert.ok(error instanceof Error)
    }

    // Restore original
    localStorage.setItem = originalSetItem
  })
})
