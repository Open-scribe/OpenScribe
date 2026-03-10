import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

const backendModule = await import(path.resolve("packages/shell/openscribe-backend.js"))
const { compareVersions, getDownloadUrl, getDownloadUrlFor } = backendModule.default.__test

test("compareVersions handles semantic ordering", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1)
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1)
  assert.equal(compareVersions("1.2.0", "1.2"), 0)
})

test("getDownloadUrl returns fallback when no platform match", () => {
  const assets = [{ name: "OpenScribe-latest.zip", browser_download_url: "https://example.com/latest.zip" }]
  assert.equal(getDownloadUrl(assets), "https://example.com/latest.zip")
})

test("getDownloadUrlFor picks mac dmg by arch", () => {
  const assets = [
    { name: "OpenScribe-1.0.0-arm64.dmg", browser_download_url: "https://example.com/mac-arm64.dmg" },
    { name: "OpenScribe-1.0.0-x64.dmg", browser_download_url: "https://example.com/mac-x64.dmg" },
  ]
  assert.equal(getDownloadUrlFor(assets, "darwin", "arm64"), "https://example.com/mac-arm64.dmg")
  assert.equal(getDownloadUrlFor(assets, "darwin", "x64"), "https://example.com/mac-x64.dmg")
})

test("getDownloadUrlFor picks windows setup exe", () => {
  const assets = [
    { name: "OpenScribe Setup 1.0.0.exe", browser_download_url: "https://example.com/setup.exe" },
    { name: "OpenScribe-win-x64.zip", browser_download_url: "https://example.com/win.zip" },
  ]
  assert.equal(getDownloadUrlFor(assets, "win32", "x64"), "https://example.com/setup.exe")
})

test("getDownloadUrlFor picks linux appimage by arch", () => {
  const assets = [
    { name: "OpenScribe-1.0.0-x64.AppImage", browser_download_url: "https://example.com/linux-x64.AppImage" },
    { name: "OpenScribe-1.0.0-arm64.AppImage", browser_download_url: "https://example.com/linux-arm64.AppImage" },
  ]
  assert.equal(getDownloadUrlFor(assets, "linux", "x64"), "https://example.com/linux-x64.AppImage")
  assert.equal(getDownloadUrlFor(assets, "linux", "arm64"), "https://example.com/linux-arm64.AppImage")
})
