import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { acceptTerms, hasAcceptedTerms, TERMS_VERSION } from "@/lib/compliance"
import { requireAuthenticatedUser } from "@/lib/auth-guard"

export async function GET() {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  const accepted = await hasAcceptedTerms(auth.userId)
  return NextResponse.json({ accepted, termsVersion: TERMS_VERSION })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  await acceptTerms(auth.userId, req)
  return NextResponse.json({ accepted: true, termsVersion: TERMS_VERSION })
}
