import { readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"

export function listFilesRecursively(dir) {
  const results = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else results.push(full)
    }
  }
  walk(dir)
  return results
}

export function detectExecutable(platform, rootDir = resolve(process.cwd(), "build", "dist")) {
  if (!existsSync(rootDir)) {
    throw new Error(`Missing dist dir: ${rootDir}`)
  }
  const candidates = listFilesRecursively(rootDir).filter((p) => statSync(p).isFile())
  if (platform === "darwin") {
    const appBinary = candidates.find((p) => /OpenScribe\.app\/Contents\/MacOS\/OpenScribe$/.test(p))
    if (appBinary) return appBinary
  }
  if (platform === "win32") {
    const winExe = candidates.find((p) => /win-unpacked[\\/].*\.exe$/i.test(p))
    if (winExe) return winExe
  }
  const linuxBin = candidates.find((p) => /linux-unpacked[\\/](OpenScribe|openscribe)$/.test(p))
  if (linuxBin) return linuxBin
  throw new Error(`Could not detect packaged executable for platform=${platform} under ${rootDir}`)
}

export function detectInstallRoot(executablePath, platform = process.platform) {
  if (platform === "darwin") {
    const idx = executablePath.indexOf(".app")
    if (idx > 0) {
      return executablePath.slice(0, idx + 4)
    }
  }
  return dirname(executablePath)
}
