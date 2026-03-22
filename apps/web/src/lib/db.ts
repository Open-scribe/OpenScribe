import { Pool } from "pg"

let pool: Pool | null = null

export function getDbPool(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL")
  }
  pool = new Pool({ connectionString })
  return pool
}

let initialized = false

export async function ensureComplianceTables(): Promise<void> {
  if (initialized) return
  const db = getDbPool()
  await db.query("SELECT 1 FROM user_terms_acceptance LIMIT 1")
  await db.query("SELECT 1 FROM auth_events LIMIT 1")

  initialized = true
}
