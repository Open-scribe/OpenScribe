import { NextResponse } from "next/server"
import { getAnthropicApiKeyStatus } from "@storage/server-api-keys"
import { requireAuthenticatedUser } from "@/lib/auth-guard"

export async function GET() {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

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
