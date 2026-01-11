import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import crypto from "crypto"
import { writeAuditEntry } from "@storage/audit-log"

// Encryption configuration
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

/**
 * Get or generate encryption key for API key file.
 * In Electron, we could use safeStorage, but Next.js API routes run in Node.js
 * so we store an encrypted key in a separate file.
 */
async function getEncryptionKey(): Promise<Buffer> {
  const configDir = path.dirname(getConfigPath())
  const keyPath = path.join(configDir, ".encryption-key")
  
  try {
    // Try to read existing key
    const keyData = await fs.readFile(keyPath)
    return keyData
  } catch {
    // Generate new key
    const key = crypto.randomBytes(KEY_LENGTH)
    
    // Ensure directory exists
    try {
      await fs.mkdir(configDir, { recursive: true })
    } catch {}
    
    // Store key with restrictive permissions
    await fs.writeFile(keyPath, key, { mode: 0o600 })
    return key
  }
}

/**
 * Encrypt API keys using AES-256-GCM
 */
async function encryptData(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, "utf8")
  encrypted = Buffer.concat([encrypted, cipher.final()])
  
  const authTag = cipher.getAuthTag()
  
  // Format: enc.v2.<iv>.<authTag>.<ciphertext> (all base64)
  return `enc.v2.${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`
}

/**
 * Decrypt API keys using AES-256-GCM
 */
async function decryptData(payload: string): Promise<string> {
  const parts = payload.split(".")
  
  // Check for encrypted format
  if (parts.length === 5 && parts[0] === "enc" && parts[1] === "v2") {
    const key = await getEncryptionKey()
    const iv = Buffer.from(parts[2], "base64")
    const authTag = Buffer.from(parts[3], "base64")
    const encrypted = Buffer.from(parts[4], "base64")
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    
    return decrypted.toString("utf8")
  }
  
  // Legacy unencrypted format - return as-is and will be re-encrypted on next save
  return payload
}

// Get the app data directory for storing config
function getConfigPath(): string {
  try {
    const { app } = require("electron")
    if (app && app.getPath) {
      // Electron environment
      const userDataPath = app.getPath("userData")
      return path.join(userDataPath, "api-keys.json")
    }
  } catch (error) {
    // Electron not available (development or build time)
  }
  // Development environment - use temp directory
  return path.join(process.cwd(), ".api-keys.json")
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { openaiApiKey, anthropicApiKey } = body

    const configPath = getConfigPath()

    // Prepare data
    const data = JSON.stringify(
      {
        openaiApiKey: openaiApiKey || "",
        anthropicApiKey: anthropicApiKey || "",
      },
      null,
      2
    )
    
    // Encrypt before saving
    const encrypted = await encryptData(data)
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    
    // Save encrypted data
    await fs.writeFile(configPath, encrypted, { mode: 0o600 })

    // Audit log: API keys configured
    await writeAuditEntry({
      event_type: "settings.api_key_configured",
      success: true,
      metadata: {
        has_openai_key: !!openaiApiKey,
        has_anthropic_key: !!anthropicApiKey,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to save API keys:", error)

    // Audit log: API key configuration failed
    await writeAuditEntry({
      event_type: "settings.api_key_configured",
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      { error: "Failed to save API keys" },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const configPath = getConfigPath()

    try {
      const fileContent = await fs.readFile(configPath, "utf-8")
      
      // Decrypt the data
      const decrypted = await decryptData(fileContent)
      const keys = JSON.parse(decrypted)
      
      return NextResponse.json(keys)
    } catch (error) {
      // File doesn't exist or is invalid, return empty keys
      return NextResponse.json({
        openaiApiKey: "",
        anthropicApiKey: "",
      })
    }
  } catch (error) {
    console.error("Failed to load API keys:", error)
    return NextResponse.json(
      { error: "Failed to load API keys" },
      { status: 500 }
    )
  }
}
