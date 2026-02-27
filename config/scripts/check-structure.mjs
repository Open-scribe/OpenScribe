#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs"
import path from "node:path"

const root = path.resolve(process.cwd())

const allowedRootDirs = new Set(["apps", "packages", "config", "build", "docker", "node_modules"])
const allowedRootFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "README.md",
  "architecture.md",
  ".gitignore",
  "BUILD_STATUS.md",
  "MONITORING_GUIDE.md",
  "QUICK_START.md",
  "STABILITY_FIXES.md",
  "TEST_SESSION.md",
  ".dockerignore",
  "docker-compose.sam.yml",
])
const buildArtifacts = new Set([".next", ".tests-dist", "dist"])
const configPattern = /\.config\.(?:js|cjs|mjs|ts)$/
const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const pipelineStages = new Set([
  "audio-ingest",
  "transcribe",
  "assemble",
  "note-core",
  "render",
  "medgemma-scribe",
  "eval",
])

const errors = []

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  const name = entry.name
  if (buildArtifacts.has(name)) {
    errors.push(`Build artifact "${name}" should live under build/ and must not be committed.`)
    continue
  }
  if (name.startsWith(".") && ![".gitignore"].includes(name)) {
    continue
  }
  if (entry.isDirectory()) {
    if (!allowedRootDirs.has(name)) {
      errors.push(`Unexpected top-level directory: ${name}`)
    }
  } else {
    if (name.startsWith(".env")) {
      continue
    }
    if (configPattern.test(name)) {
      errors.push(`Config file "${name}" must live in the config/ directory.`)
    }
    if (!allowedRootFiles.has(name)) {
      errors.push(`Unexpected top-level file: ${name}`)
    }
  }
}

const ensureKebabCase = (dirPath) => {
  if (!fs.existsSync(dirPath)) return
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!kebabCase.test(entry.name)) {
      errors.push(`Folder "${path.relative(root, path.join(dirPath, entry.name))}" must use kebab-case.`)
    }
  }
}

ensureKebabCase(path.join(root, "apps"))
ensureKebabCase(path.join(root, "packages"))

const pipelineDir = path.join(root, "packages", "pipeline")
if (fs.existsSync(pipelineDir)) {
  const stageDirs = fs
    .readdirSync(pipelineDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const stage of stageDirs) {
    if (!pipelineStages.has(stage)) {
      errors.push(`Pipeline stage "${stage}" is not in the approved list ${Array.from(pipelineStages).join(", ")}.`)
    }
  }
}

if (errors.length > 0) {
  console.error("\nRepository structure violations:\n")
  for (const error of errors) {
    console.error(` - ${error}`)
  }
  console.error("\nFix the issues above before committing.\n")
  process.exit(1)
}
