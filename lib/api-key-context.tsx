"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface ApiKeyContextType {
  apiKey: string | null
  setApiKey: (key: string | null) => void
  isConfigured: boolean
}

const ApiKeyContext = createContext<ApiKeyContextType | undefined>(undefined)

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem("openai_api_key")
    if (stored) {
      setApiKeyState(stored)
    }
  }, [])

  const setApiKey = (key: string | null) => {
    if (key) {
      localStorage.setItem("openai_api_key", key)
    } else {
      localStorage.removeItem("openai_api_key")
    }
    setApiKeyState(key)
  }

  return (
    <ApiKeyContext.Provider value={{ apiKey, setApiKey, isConfigured: !!apiKey }}>{children}</ApiKeyContext.Provider>
  )
}

export function useApiKey() {
  const context = useContext(ApiKeyContext)
  if (context === undefined) {
    throw new Error("useApiKey must be used within an ApiKeyProvider")
  }
  return context
}
