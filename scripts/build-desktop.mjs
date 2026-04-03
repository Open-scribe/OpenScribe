#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const target = (process.argv[2] || "current").toLowerCase()
const arch = (process.argv[3] || "").toLowerCase()
const mode = (process.argv[4] || "installer").toLowerCase()

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function resolveElectronBuilderArgs(selectedTarget) {
  const args = ["--publish", "never"]
  if (selectedTarget === "all") args.unshift("--mac", "--win", "--linux")
  else if (selectedTarget === "mac") args.unshift("--mac")
  else if (selectedTarget === "win" || selectedTarget === "windows") args.unshift("--win")
  else if (selectedTarget === "linux") args.unshift("--linux")

  if (arch === "x64") args.push("--x64")
  if (arch === "arm64") args.push("--arm64")
  if (mode === "dir") args.push("--dir")
  return args
}

console.log(`Building desktop target=${target} arch=${arch || "default"} mode=${mode}`)
run("pnpm", ["build"])
run("pnpm", ["build:backend"])
run("node", ["packages/shell/scripts/prepare-next.js"])
run("electron-builder", resolveElectronBuilderArgs(target))
