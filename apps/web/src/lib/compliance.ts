import crypto from "crypto"
import type { NextRequest } from "next/server"
import { ensureComplianceTables, getDbPool } from "./db"

export const TERMS_VERSION = "2026-03-hipaa-hosted-v1"

function hashValue(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function requestIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  if (xff) return xff.split(",")[0]?.trim() || "unknown"
  return "unknown"
}

function requestUa(req: NextRequest): string {
  return req.headers.get("user-agent") || "unknown"
}

export async function hasAcceptedTerms(userId: string): Promise<boolean> {
  await ensureComplianceTables()
  const db = getDbPool()
  const result = await db.query(
    `SELECT id FROM user_terms_acceptance WHERE user_id = $1 AND terms_version = $2 LIMIT 1`,
    [userId, TERMS_VERSION],
  )
  return result.rowCount > 0
}

export async function acceptTerms(userId: string, req: NextRequest): Promise<void> {
  await ensureComplianceTables()
  const db = getDbPool()
  await db.query(
    `INSERT INTO user_terms_acceptance (user_id, terms_version, ip_hash, ua_hash)
     VALUES ($1, $2, $3, $4)`,
    [userId, TERMS_VERSION, hashValue(requestIp(req)), hashValue(requestUa(req))],
  )
}

export async function writeAuthEvent(params: {
  userId?: string
  eventType: string
  provider?: string
  success: boolean
  req: NextRequest
}): Promise<void> {
  await ensureComplianceTables()
  const db = getDbPool()
  await db.query(
    `INSERT INTO auth_events (user_id, event_type, provider, success, ip_hash, ua_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.userId || null,
      params.eventType,
      params.provider || null,
      params.success,
      hashValue(requestIp(params.req)),
      hashValue(requestUa(params.req)),
    ],
  )
}
