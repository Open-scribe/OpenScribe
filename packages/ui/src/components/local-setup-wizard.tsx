"use client"

import { Button } from "@ui/lib/ui/button"

type SetupCheck = [string, string]

interface LocalSetupWizardProps {
  isOpen: boolean
  checks: SetupCheck[]
  selectedModel: string
  supportedModels: string[]
  isBusy: boolean
  statusMessage: string
  onSelectedModelChange: (model: string) => void
  onRunCheck: () => Promise<void>
  onDownloadWhisper: () => Promise<void>
  onDownloadModel: () => Promise<void>
  onComplete: () => Promise<void>
  onSkip: () => void
}

export function LocalSetupWizard({
  isOpen,
  checks,
  selectedModel,
  supportedModels,
  isBusy,
  statusMessage,
  onSelectedModelChange,
  onRunCheck,
  onDownloadWhisper,
  onDownloadModel,
  onComplete,
  onSkip,
}: LocalSetupWizardProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-foreground">Local Setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Required only for Local-only mode. Mixed mode remains your default until you switch.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium text-foreground">1) System Check</div>
            <Button variant="outline" onClick={onRunCheck} disabled={isBusy}>Run Check</Button>
            {checks.length > 0 && (
              <div className="mt-3 max-h-32 overflow-y-auto text-xs text-muted-foreground">
                {checks.map((entry, idx) => (
                  <div key={`${entry[0]}-${idx}`} className="py-0.5">{entry[0]} {entry[1]}</div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium text-foreground">2) Whisper Model</div>
            <Button variant="outline" onClick={onDownloadWhisper} disabled={isBusy}>Download Whisper</Button>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium text-foreground">3) Local Note Model</div>
            <select
              className="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedModel}
              onChange={(e) => onSelectedModelChange(e.target.value)}
              disabled={isBusy}
            >
              {supportedModels.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <Button variant="outline" onClick={onDownloadModel} disabled={isBusy}>Download Selected Model</Button>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {statusMessage}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onSkip} disabled={isBusy}>Later</Button>
          <Button onClick={onComplete} disabled={isBusy}>Mark Setup Complete</Button>
        </div>
      </div>
    </div>
  )
}
