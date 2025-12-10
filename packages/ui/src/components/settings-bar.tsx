"use client"

import { Settings } from "lucide-react"
import { Button } from "@ui/lib/ui/button"

interface SettingsBarProps {
  onOpenSettings: () => void
}

export function SettingsBar({ onOpenSettings }: SettingsBarProps) {
  return (
    <div className="shrink-0 border-t border-sidebar-border bg-sidebar p-4">
      <Button
        variant="ghost"
        onClick={onOpenSettings}
        className="w-full justify-start gap-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
      >
        <Settings className="h-4 w-4" />
        <span>Settings</span>
      </Button>
    </div>
  )
}
