import Anthropic from "@anthropic-ai/sdk"

export interface LLMRequest {
  system: string
  prompt: string
  model?: string
  apiKey?: string
  /**
   * @deprecated JSON schema tool calling is no longer used.
   * The system now generates markdown directly.
   */
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
  }
}

/**
 * HIPAA Compliance: Validate that Anthropic SDK uses HTTPS.
 * The Anthropic SDK defaults to https://api.anthropic.com, but we validate
 * to prevent future configuration overrides that could expose PHI.
 */
function validateAnthropicHttps(client: Anthropic): void {
  // The Anthropic SDK uses https://api.anthropic.com by default
  // We validate the baseURL if it's been customized
  const baseURL = (client as any).baseURL || "https://api.anthropic.com"
  
  try {
    const parsed = new URL(baseURL)
    if (parsed.protocol !== "https:") {
      throw new Error(
        `SECURITY ERROR: Anthropic API endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid Anthropic API URL: ${baseURL}`)
    }
    throw error
  }
}

export async function runLLMRequest({ system, prompt, model, apiKey, jsonSchema }: LLMRequest): Promise<string> {
  const anthropicApiKey = apiKey || process.env.ANTHROPIC_API_KEY

  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. " +
      "Please configure it in Settings."
    )
  }

  const defaultModel = "claude-sonnet-4-5-20250929"
  const resolvedModel = model ?? defaultModel

  const client = new Anthropic({
    apiKey: anthropicApiKey,
  })

  // Validate HTTPS before sending any PHI
  validateAnthropicHttps(client)

  // Build request parameters
  const requestParams: Anthropic.MessageCreateParams = {
    model: resolvedModel,
    max_tokens: 4096,
    system: system,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  }

  // JSON schema is deprecated - we now generate markdown directly
  if (jsonSchema) {
    console.warn("⚠️  jsonSchema parameter is deprecated and will be ignored. The system now generates markdown directly.")
  }

  const message = await client.messages.create(requestParams)

  // Extract text content from response
  const textContent = message.content.find((block) => block.type === "text")
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in Anthropic response")
  }

  return textContent.text
}

// Export prompts for versioned prompt management
export * as prompts from "./prompts"
