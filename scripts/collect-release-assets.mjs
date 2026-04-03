#!/usr/bin/env node
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, resolve, basename } from "node:path"

const sourceRoot = resolve(process.cwd(), process.env.RELEASE_ASSET_SOURCE || "build/release-artifacts")
const outputDir = resolve(process.cwd(), process.env.RELEASE_ASSET_OUT || "build/publish")
const allowedExtensions = new Set([".dmg", ".zip", ".exe", ".appimage", ".deb", ".rpm"])

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(fullPath))
    else files.push(fullPath)
  }
  return files
}

function isInstallerAsset(filePath) {
  const lower = filePath.toLowerCase()
  for (const extension of allowedExtensions) {
    if (lower.endsWith(extension)) return true
  }
  return false
}

if (!existsSync(sourceRoot)) {
  console.error(`Release asset source not found: ${sourceRoot}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })
const files = walk(sourceRoot).filter((filePath) => statSync(filePath).isFile()).filter(isInstallerAsset)

if (files.length === 0) {
  console.error(`No installer assets found in ${sourceRoot}`)
  process.exit(1)
}

const copied = new Set()
for (const filePath of files) {
  const fileName = basename(filePath)
  const destination = join(outputDir, fileName)
  if (copied.has(fileName)) continue
  copyFileSync(filePath, destination)
  copied.add(fileName)
}

console.log(`Collected ${copied.size} release assets into ${outputDir}`)
