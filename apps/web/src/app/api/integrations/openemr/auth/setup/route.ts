import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { setupOpenEMRAuth } from "@/lib/openemr-client"

export async function POST() {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  const result = await setupOpenEMRAuth()
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
