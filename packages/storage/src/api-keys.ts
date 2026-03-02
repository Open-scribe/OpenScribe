/**
 * API Keys storage
 * Uses secure storage for sensitive API keys
 */

import { loadSecureItem, saveSecureItem } from "./secure-storage"
import { allowUserApiKeys, isHostedMode } from "./hosted-mode"

export interface ApiKeys {
  openaiApiKey: string
  anthropicApiKey: string
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
  if (isHostedMode() && !allowUserApiKeys()) {
    throw new Error("User-managed API keys are disabled in hosted mode.")
  }

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
