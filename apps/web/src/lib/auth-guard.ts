import type { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { hasAcceptedTerms } from "./compliance"
import { isHipaaHostedMode } from "./hipaa-config"

export async function requireAuthenticatedUser() {
  if (!isHipaaHostedMode()) {
    return { ok: true as const, userId: "local-user", session: { user: { id: "local-user" } } }
  }
  const { authOptions } = await import("./auth")
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) {
    return { ok: false as const, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) }
  }
  return { ok: true as const, userId, session }
}

export async function requireAcceptedTerms(userId: string, req: NextRequest) {
  if (!isHipaaHostedMode()) {
    return { ok: true as const }
  }
  const accepted = await hasAcceptedTerms(userId)
  if (!accepted) {
    return {
      ok: false as const,
      response: new Response(JSON.stringify({ error: "Terms acceptance required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    }
  }
  return { ok: true as const }
}
