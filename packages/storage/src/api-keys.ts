/**
 * API Keys storage
 * Uses secure storage for sensitive API keys
 */

import { loadSecureItem, saveSecureItem } from "./secure-storage"

export interface ApiKeys {
  openaiApiKey: string
  anthropicApiKey: string
}

export interface MixedModeAuthStatus {
  hasAnthropicKeyConfigured: boolean
  source: "server_file" | "env" | "none"
}

const API_KEYS_STORAGE_KEY = "openscribe_api_keys"

const DEFAULT_API_KEYS: ApiKeys = {
  openaiApiKey: "",
  anthropicApiKey: "",
}

export async function getApiKeys(): Promise<ApiKeys> {
  try {
    const stored = await loadSecureItem<ApiKeys>(API_KEYS_STORAGE_KEY)
    if (!stored) {
      return DEFAULT_API_KEYS
    }
    return {
      ...DEFAULT_API_KEYS,
      ...stored,
    }
  } catch (error) {
    console.error("Failed to load API keys:", error)
    return DEFAULT_API_KEYS
  }
}

export async function setApiKeys(keys: Partial<ApiKeys>): Promise<void> {
  try {
    const current = await getApiKeys()
    const updated = {
      ...current,
      ...keys,
    }

    // Save to secure storage (client-side)
    await saveSecureItem(API_KEYS_STORAGE_KEY, updated)

    // Also save to server-side config file
    if (typeof window !== "undefined") {
      try {
        const response = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updated),
        })

        if (response.status === 410) {
          return
        }
        if (!response.ok) {
          console.error("Failed to sync API keys to server")
        }
      } catch (error) {
        console.error("Failed to sync API keys to server:", error)
        // Don't throw - client-side storage succeeded
      }
    }
  } catch (error) {
    console.error("Failed to save API keys:", error)
    throw error
  }
}

export async function getMixedModeAuthStatus(): Promise<MixedModeAuthStatus> {
  try {
    const response = await fetch("/api/settings/mixed-auth-status", { method: "GET" })
    if (!response.ok) {
      return { hasAnthropicKeyConfigured: false, source: "none" }
    }
    const parsed = (await response.json()) as Partial<MixedModeAuthStatus>
    return {
      hasAnthropicKeyConfigured: !!parsed.hasAnthropicKeyConfigured,
      source: parsed.source === "server_file" || parsed.source === "env" ? parsed.source : "none",
    }
  } catch {
    return { hasAnthropicKeyConfigured: false, source: "none" }
  }
}

export function validateApiKey(key: string, type: "openai" | "anthropic"): boolean {
  if (!key || typeof key !== "string") return false

  if (type === "openai") {
    // OpenAI keys start with "sk-" or "sk-proj-"
    return key.startsWith("sk-")
  } else if (type === "anthropic") {
    // Anthropic keys start with "sk-ant-"
    return key.startsWith("sk-ant-")
  }

  return false
}
