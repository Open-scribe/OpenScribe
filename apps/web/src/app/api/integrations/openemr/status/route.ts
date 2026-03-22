import { NextRequest, NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/auth-guard"
import { getOpenEMRPushStatus } from "@/lib/openemr-client"

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response

  const patientId = req.nextUrl.searchParams.get("patientId") ?? ""
  const noteMarkdown = req.nextUrl.searchParams.get("noteMarkdown") ?? ""
  const documentId = req.nextUrl.searchParams.get("documentId") ?? undefined

  const status = await getOpenEMRPushStatus({ patientId, noteMarkdown, documentId })
  return NextResponse.json(status, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  })
}
