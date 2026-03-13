import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { writeAuthEvent } from "@/lib/compliance"

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  await writeAuthEvent({
    userId: auth.userId,
    eventType: "session_checked",
    provider: "google",
    success: true,
    req,
  })

  return NextResponse.json({
    authenticated: true,
    user: {
      id: auth.userId,
      email: auth.session.user?.email || null,
      name: auth.session.user?.name || null,
    },
  })
}
