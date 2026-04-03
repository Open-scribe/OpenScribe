#!/usr/bin/env node
const platform = process.env.CI_PLATFORM || process.platform
const requiredByPlatform = {
  darwin: ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  win32: ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"],
  linux: ["LINUX_SIGNING_KEY"],
}

const required = requiredByPlatform[platform] || []
const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(`Missing signing/notarization env vars for ${platform}: ${missing.join(", ")}`)
  process.exit(1)
}

console.log(`Signing gate vars present for ${platform}.`)
