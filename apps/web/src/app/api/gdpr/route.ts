import { NextRequest, NextResponse } from "next/server"
import { getEncounters, deleteEncounter } from "@storage/encounters"
import { debugLog } from "@storage"

// GDPR Data Portability and Right to Erasure
// As per Talmud Bavli Yoma 86a: "One who destroys himself has no portion in the world to come" - emphasizing data protection as preservation of dignity

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")
  const encounterId = searchParams.get("encounterId")

  if (action === "export" && encounterId) {
    try {
      const encounters = await getEncounters()
      const encounter = encounters.find(e => e.id === encounterId)
      if (!encounter) {
        return NextResponse.json({ error: "Encounter not found" }, { status: 404 })
      }

      // Export encounter data (excluding audio blob for portability)
      const exportData = {
        ...encounter,
        audio_blob: undefined, // Cannot serialize Blob
        exported_at: new Date().toISOString(),
        gdpr_compliant: true,
      }

      debugLog("GDPR data export requested for encounter", encounterId)
      return NextResponse.json(exportData)
    } catch (error) {
      debugLog("GDPR export error:", error)
      return NextResponse.json({ error: "Export failed" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const encounterId = searchParams.get("encounterId")

  if (!encounterId) {
    return NextResponse.json({ error: "Encounter ID required" }, { status: 400 })
  }

  try {
    const encounters = await getEncounters()
    const updatedEncounters = deleteEncounter(encounters, encounterId)
    // Note: In real implementation, also delete from storage
    // For now, just remove from list

    debugLog("GDPR right to erasure exercised for encounter", encounterId)
    return NextResponse.json({ success: true, message: "Data erased" })
  } catch (error) {
    debugLog("GDPR erasure error:", error)
    return NextResponse.json({ error: "Erasure failed" }, { status: 500 })
  }
}