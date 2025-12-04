"use client"

import useSWR from "swr"
import type { Encounter } from "../core/types"
import { getEncounters, saveEncounters, createEncounter, updateEncounter, deleteEncounter } from "../services/local-storage"

export function useEncounters() {
  const { data: encounters = [], mutate } = useSWR<Encounter[]>("encounters", () => getEncounters(), {
    fallbackData: [],
    revalidateOnFocus: false,
  })

  const addEncounter = async (data: Partial<Encounter>) => {
    const newEncounter = createEncounter(data)
    const updated = [newEncounter, ...encounters]
    saveEncounters(updated)
    await mutate(updated, false)
    return newEncounter
  }

  const update = async (id: string, updates: Partial<Encounter>) => {
    const updated = updateEncounter(encounters, id, updates)
    saveEncounters(updated)
    await mutate(updated, false)
  }

  const remove = async (id: string) => {
    const updated = deleteEncounter(encounters, id)
    saveEncounters(updated)
    await mutate(updated, false)
  }

  return {
    encounters,
    addEncounter,
    updateEncounter: update,
    deleteEncounter: remove,
    refresh: mutate,
  }
}
