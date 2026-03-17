import { NextRequest, NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { handlePushRequest } from "@/lib/openemr-push-handler"
import { pushNoteToOpenEMR } from "@/lib/openemr-client"

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const result = await handlePushRequest(
    { isAuthenticated: auth.ok },
    body,
    pushNoteToOpenEMR
  )

  // When unauthenticated, defer to the auth guard's response (may include redirect headers)
  if (!auth.ok && result.status === 401) {
    return auth.response
  }

  return NextResponse.json(result.json, { status: result.status })
}
