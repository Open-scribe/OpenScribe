#!/usr/bin/env node
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const venvDir = join(projectRoot, ".venv-backend")
const isWin = process.platform === "win32"

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function getSystemPython() {
  if (isWin) return "python"
  return "python3"
}

function getVenvPython() {
  if (isWin) return join(venvDir, "Scripts", "python.exe")
  return join(venvDir, "bin", "python")
}

console.log("===================================")
console.log("  OpenScribe Backend Builder")
console.log("===================================")

const systemPython = getSystemPython()
if (!existsSync(venvDir)) {
  console.log(`Creating virtual environment at ${venvDir}...`)
  run(systemPython, ["-m", "venv", venvDir], projectRoot)
}

const py = getVenvPython()
run(py, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], projectRoot)
run(py, ["-m", "pip", "install", "pyinstaller"], projectRoot)
run(py, ["-m", "pip", "install", "-r", "requirements.txt"], projectRoot)
run(py, ["-m", "pip", "install", "-e", "."], projectRoot)
run(py, ["-m", "PyInstaller", "openscribe-backend.spec", "--noconfirm"], projectRoot)

const outputDir = join(projectRoot, "dist", "openscribe-backend")
if (!existsSync(outputDir)) {
  console.error("Build failed: missing dist/openscribe-backend")
  process.exit(1)
}

console.log("Build successful:", outputDir)
