#!/usr/bin/env node
import { readdirSync, statSync, createReadStream, writeFileSync } from "node:fs"
import { join, resolve, basename } from "node:path"
import { createHash } from "node:crypto"

const distDir = resolve(process.cwd(), "build", "dist")
const outPath = resolve(process.cwd(), "build", "dist", "checksums.txt")

function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolveHash(hash.digest("hex")))
    stream.on("error", rejectHash)
  })
}

async function main() {
  const files = readdirSync(distDir)
    .map((name) => join(distDir, name))
    .filter((p) => statSync(p).isFile())
    .filter((p) => !p.endsWith(".blockmap") && !p.endsWith(".yml") && !p.endsWith(".txt"))

  const lines = []
  for (const filePath of files) {
    const hash = await sha256(filePath)
    lines.push(`${hash}  ${basename(filePath)}`)
  }

  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8")
  console.log(`Wrote checksums: ${outPath}`)
}

main().catch((error) => {
  console.error("Failed to generate checksums:", error)
  process.exit(1)
})
