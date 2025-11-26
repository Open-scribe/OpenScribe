"use client"

import { useState } from "react"
import { useApiKey } from "@/lib/api-key-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Settings, Key, Check, X } from "lucide-react"

export function ApiKeyDialog() {
  const { apiKey, setApiKey, isConfigured } = useApiKey()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setInputValue(apiKey || "")
    }
    setOpen(isOpen)
  }

  const handleSave = () => {
    if (inputValue.trim()) {
      setApiKey(inputValue.trim())
    }
    setOpen(false)
  }

  const handleClear = () => {
    setApiKey(null)
    setInputValue("")
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
          {isConfigured ? (
            <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-foreground">
              <Check className="h-3 w-3 text-background" />
            </span>
          ) : (
            <span className="ml-auto flex h-2 w-2 rounded-full bg-destructive" />
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            OpenAI API Key
          </DialogTitle>
          <DialogDescription>
            Enter your OpenAI API key to enable transcription and note generation. Your key is stored locally in your
            browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex items-center justify-between">
            {isConfigured && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="text-destructive hover:text-destructive"
              >
                <X className="mr-2 h-4 w-4" />
                Remove Key
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!inputValue.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
