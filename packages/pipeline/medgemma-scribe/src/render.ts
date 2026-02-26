import type { DraftNoteSections } from "./types"

export function renderDraftNote(draft: DraftNoteSections): string {
  return [
    "HPI:",
    draft.hpi,
    "",
    "ROS:",
    draft.ros,
    "",
    "Assessment:",
    draft.assessment,
    "",
    "Plan:",
    draft.plan,
  ].join("\n")
}
