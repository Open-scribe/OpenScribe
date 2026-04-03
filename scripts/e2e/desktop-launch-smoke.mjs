#!/usr/bin/env node
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { detectExecutable } from "./helpers.mjs"

const timeoutMs = Number(process.env.OPENSCRIBE_E2E_TIMEOUT_MS || 90000)
const exe = detectExecutable(process.platform)
const preferredPort = String(4300 + Math.floor(Math.random() * 1000))
console.log(`Launching packaged app smoke: ${exe}`)

const child = spawn(exe, [], {
  stdio: "pipe",
  env: {
    ...process.env,
    DESKTOP_SERVER_PORT: preferredPort,
    OPENSCRIBE_E2E_SMOKE: "1",
    OPENSCRIBE_E2E_STUB_PIPELINE: "1",
  },
})

let stdout = ""
let stderr = ""
child.stdout.on("data", (chunk) => {
  const text = chunk.toString()
  stdout += text
  process.stdout.write(text)
})
child.stderr.on("data", (chunk) => {
  const text = chunk.toString()
  stderr += text
  process.stderr.write(text)
})

const timedOut = delay(timeoutMs).then(() => {
  child.kill("SIGKILL")
  throw new Error(`Smoke launch timed out after ${timeoutMs}ms`)
})

const completed = new Promise((resolve, reject) => {
  child.on("close", (code) => {
    if (code !== 0) {
      reject(new Error(`Smoke launch failed with exit ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`))
      return
    }
    if (!stdout.includes("OPENSCRIBE_E2E_SMOKE_PASS")) {
      reject(new Error(`Smoke launch missing pass marker.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`))
      return
    }
    resolve()
  })
  child.on("error", reject)
})

Promise.race([completed, timedOut])
  .then(() => {
    console.log("Desktop launch smoke passed.")
  })
  .catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
