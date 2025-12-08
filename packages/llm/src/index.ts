import Anthropic from "@anthropic-ai/sdk"

export interface LLMRequest {
  system: string
  prompt: string
  model?: string
  /**
   * JSON schema for structured output
   * Set to enable JSON mode with schema validation
   */
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
  }
}

export async function runLLMRequest({ system, prompt, model, jsonSchema }: LLMRequest): Promise<string> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. " +
      "Please set it in your .env.local file or environment."
    )
  }

  const defaultModel = "claude-sonnet-4-5-20250929"
  const resolvedModel = model ?? defaultModel

  const client = new Anthropic({
    apiKey: anthropicApiKey,
  })

  // Build request parameters
  const requestParams: Anthropic.MessageCreateParams = {
    model: resolvedModel,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  }

  // Add system message - can be string or array
  if (jsonSchema) {
    // For structured output, we add tool use that enforces the schema
    requestParams.system = [
      {
        type: "text",
        text: system,
      },
    ]
    requestParams.tools = [
      {
        name: jsonSchema.name,
        description: `Generate a clinical note following this exact structure`,
        input_schema: jsonSchema.schema as Anthropic.Tool.InputSchema,
      },
    ]
    requestParams.tool_choice = {
      type: "tool",
      name: jsonSchema.name,
    }
  } else {
    requestParams.system = system
  }

  const message = await client.messages.create(requestParams)

  // Extract text from response
  // If we used tool calling for structured output, extract from tool use
  if (jsonSchema) {
    const toolUseBlock = message.content.find((block) => block.type === "tool_use")
    if (toolUseBlock && toolUseBlock.type === "tool_use") {
      // Return the tool input as JSON string
      return JSON.stringify(toolUseBlock.input, null, 2)
    }
  }

  // Otherwise, extract regular text content
  const textContent = message.content.find((block) => block.type === "text")
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in Anthropic response")
  }

  return textContent.text
}

// Export prompts for versioned prompt management
export * as prompts from "./prompts"

