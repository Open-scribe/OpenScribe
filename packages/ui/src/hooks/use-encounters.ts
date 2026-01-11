"use client"

import useSWR from "swr"
import type { Encounter } from "@storage/types"
import {
  getEncounters,
  saveEncounters,
  createEncounter,
  updateEncounter,
  deleteEncounter,
} from "@storage/encounters"
import { writeAuditEntry } from "@storage/audit-log"

export function useEncounters() {
  const { data: encounters = [], mutate } = useSWR<Encounter[]>("encounters", () => getEncounters(), {
    fallbackData: [],
    revalidateOnFocus: false,
  })

  const addEncounter = async (data: Partial<Encounter>) => {
    try {
      const newEncounter = createEncounter(data)
      const updated = [newEncounter, ...encounters]
      await saveEncounters(updated)
      await mutate(updated, false)

      // Audit log: encounter created
      await writeAuditEntry({
        event_type: "encounter.created",
        resource_id: newEncounter.id,
        success: true,
        metadata: {
          status: newEncounter.status,
          has_patient_name: !!newEncounter.patient_name,
        },
      })

      return newEncounter
    } catch (error) {
      // Audit log: encounter creation failed
      await writeAuditEntry({
        event_type: "encounter.created",
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  const update = async (id: string, updates: Partial<Encounter>) => {
    try {
      const updated = updateEncounter(encounters, id, updates)
      await saveEncounters(updated)
      await mutate(updated, false)

      // Audit log: encounter updated
      await writeAuditEntry({
        event_type: "encounter.updated",
        resource_id: id,
        success: true,
        metadata: {
          fields_updated: Object.keys(updates),
          status_changed: updates.status ? true : false,
        },
      })
    } catch (error) {
      // Audit log: encounter update failed
      await writeAuditEntry({
        event_type: "encounter.updated",
        resource_id: id,
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  const remove = async (id: string) => {
    try {
      const updated = deleteEncounter(encounters, id)
      await saveEncounters(updated)
      await mutate(updated, false)

      // Audit log: encounter deleted
      await writeAuditEntry({
        event_type: "encounter.deleted",
        resource_id: id,
        success: true,
      })
    } catch (error) {
      // Audit log: encounter deletion failed
      await writeAuditEntry({
        event_type: "encounter.deleted",
        resource_id: id,
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  return {
    encounters,
    addEncounter,
    updateEncounter: update,
    deleteEncounter: remove,
    refresh: mutate,
  }
}
