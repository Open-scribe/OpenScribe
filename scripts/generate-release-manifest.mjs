#!/usr/bin/env node
import { readdirSync, statSync, createReadStream, writeFileSync, mkdirSync } from "node:fs"
import { join, basename, resolve, dirname } from "node:path"
import { createHash } from "node:crypto"

const distDir = resolve(process.cwd(), process.env.DIST_DIR || "build/dist")
const outPath = resolve(
  process.cwd(),
  process.env.RELEASE_MANIFEST_OUT || `${process.env.DIST_DIR || "build/dist"}/release-manifest.json`,
)
const version = process.env.RELEASE_VERSION || process.env.npm_package_version || "0.0.0"
const baseDownloadUrl = process.env.RELEASE_BASE_URL || ""
const signatureStatus = process.env.SIGNATURE_STATUS || "UNVERIFIED"

function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolveHash(hash.digest("hex")))
    stream.on("error", rejectHash)
  })
}

function detectPlatform(name) {
  const lower = name.toLowerCase()
  if (lower.includes("mac") || lower.endsWith(".dmg") || lower.endsWith(".pkg")) return "mac"
  if (lower.includes("win") || lower.endsWith(".exe") || lower.endsWith(".msi")) return "windows"
  if (lower.includes("linux") || lower.endsWith(".appimage") || lower.endsWith(".deb")) return "linux"
  return "unknown"
}

function detectArch(name) {
  const lower = name.toLowerCase()
  if (lower.includes("arm64") || lower.includes("aarch64")) return "arm64"
  if (lower.includes("x64") || lower.includes("amd64")) return "x64"
  return "unknown"
}

async function main() {
  mkdirSync(dirname(outPath), { recursive: true })
  const files = readdirSync(distDir)
    .map((name) => join(distDir, name))
    .filter((p) => statSync(p).isFile())
    .filter((p) => !p.endsWith(".blockmap") && !p.endsWith(".yml") && !p.endsWith("release-manifest.json"))

  const artifacts = []
  for (const file of files) {
    const name = basename(file)
    artifacts.push({
      file: name,
      platform: detectPlatform(name),
      arch: detectArch(name),
      sha256: await sha256(file),
      signatureStatus,
      downloadUrl: baseDownloadUrl ? `${baseDownloadUrl.replace(/\/+$/, "")}/${name}` : name,
    })
  }

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    artifacts,
  }

  writeFileSync(outPath, JSON.stringify(manifest, null, 2))
  console.log(`Wrote release manifest: ${outPath}`)
}

main().catch((error) => {
  console.error("Failed to generate release manifest:", error)
  process.exit(1)
})
