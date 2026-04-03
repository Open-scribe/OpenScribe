#!/usr/bin/env node
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { join, resolve, basename } from "node:path"

const artifactsRoot = resolve(process.cwd(), "build", "evidence")
if (!existsSync(artifactsRoot)) {
  console.error(`Missing evidence root: ${artifactsRoot}`)
  process.exit(1)
}

const requiredTargets = [
  "mac:x64",
  "mac:arm64",
  "windows:x64",
  "linux:x64",
  "linux:arm64",
]

const walk = (dir) => {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const allFiles = walk(artifactsRoot)
const manifests = allFiles
  .filter((p) => basename(p) === "release-manifest.json")
  .map((p) => JSON.parse(readFileSync(p, "utf8")))

if (manifests.length === 0) {
  console.error("No release-manifest.json files found in downloaded artifacts")
  process.exit(1)
}

const discovered = new Set()
for (const manifest of manifests) {
  for (const artifact of manifest.artifacts || []) {
    if (!artifact.platform || !artifact.arch) continue
    discovered.add(`${artifact.platform}:${artifact.arch}`)
  }
}

const missing = requiredTargets.filter((target) => !discovered.has(target))
if (missing.length > 0) {
  console.error(`Missing required release evidence targets: ${missing.join(", ")}`)
  process.exit(1)
}

const hasChecksums = allFiles.some((p) => basename(p) === "checksums.txt" && statSync(p).size > 0)

if (!hasChecksums) {
  console.error("No non-empty checksums.txt found in evidence artifacts")
  process.exit(1)
}

console.log("Release evidence validation passed.")
