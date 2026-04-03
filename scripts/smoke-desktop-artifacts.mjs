#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

const distDir = resolve(process.cwd(), "build", "dist")
if (!existsSync(distDir)) {
  console.error("Missing build/dist directory")
  process.exit(1)
}

const files = readdirSync(distDir)
  .map((name) => join(distDir, name))
  .filter((p) => statSync(p).isFile())

const installerFiles = files.filter((f) =>
  [".dmg", ".zip", ".exe", ".AppImage", ".deb", ".rpm"].some((ext) => f.endsWith(ext)),
)

if (installerFiles.length === 0) {
  console.error("No installer artifacts found in build/dist")
  process.exit(1)
}

console.log("Smoke check passed. Found installers:")
for (const file of installerFiles) {
  console.log(` - ${file}`)
}
