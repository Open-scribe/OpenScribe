#!/usr/bin/env node
import { rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

const platform = process.platform
const home = os.homedir()

const targets = []
if (platform === "darwin") {
  targets.push(join(home, "Library", "Application Support", "openscribe-backend"))
  targets.push(join(home, "Library", "Application Support", "pywhispercpp"))
}
if (platform === "win32") {
  const appData = process.env.APPDATA || join(home, "AppData", "Roaming")
  const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local")
  targets.push(join(appData, "openscribe-backend"))
  targets.push(join(localAppData, "pywhispercpp"))
}
if (platform === "linux") {
  const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share")
  targets.push(join(xdgData, "openscribe-backend"))
  targets.push(join(home, ".cache", "pywhispercpp"))
}
targets.push(join(home, ".ollama"))

for (const target of targets) {
  if (!existsSync(target)) continue
  rmSync(target, { recursive: true, force: true })
  console.log(`Removed: ${target}`)
}

console.log("Clean environment provisioning complete.")
