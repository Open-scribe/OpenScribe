import { NextResponse } from "next/server"
import { getAnthropicApiKeyStatus } from "@storage/server-api-keys"

export async function GET() {
  try {
    const status = getAnthropicApiKeyStatus()
    return NextResponse.json({
      hasAnthropicKeyConfigured: status.hasAnthropicKeyConfigured,
      source: status.source,
    })
  } catch {
    return NextResponse.json(
      {
        hasAnthropicKeyConfigured: false,
        source: "none",
      },
      { status: 200 },
    )
  }
}
