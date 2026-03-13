#!/usr/bin/env node
/* eslint-env node */
import fs from "fs"
import path from "path"
import pg from "pg"

const { Client } = pg

const databaseUrl = (process.env.DATABASE_URL || "").trim()
if (!databaseUrl) {
  console.error("Missing DATABASE_URL")
  process.exit(1)
}

const migrationsDir = path.join(process.cwd(), "config", "db", "migrations")
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b))

const client = new Client({ connectionString: databaseUrl })

try {
  await client.connect()
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const file of files) {
    const already = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file])
    if (already.rowCount > 0) {
      console.log(`skip ${file}`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
    console.log(`apply ${file}`)
    await client.query("BEGIN")
    try {
      await client.query(sql)
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file])
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  }

  console.log("migrations complete")
} catch (error) {
  console.error("migration failed", error)
  process.exit(1)
} finally {
  await client.end()
}
