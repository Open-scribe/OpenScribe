#!/usr/bin/env node
/* eslint-env node */
import { readFileSync } from 'fs'
import { join } from 'path'

const targets = [
  'apps/web/src/app/api/transcription/final/route.ts',
  'apps/web/src/app/api/transcription/segment/route.ts',
  'apps/web/src/app/api/transcription/stream/[sessionId]/route.ts',
  'apps/web/src/app/api/notes/generate/route.ts',
  'apps/web/src/app/api/compliance/terms/route.ts',
  'apps/web/src/app/api/compliance/session/route.ts',
  'apps/web/src/app/actions.ts',
  'apps/web/src/lib/auth.ts',
  'apps/web/src/lib/auth-guard.ts',
  'apps/web/src/lib/server-logger.ts',
  'apps/web/src/middleware.ts',
  'packages/pipeline/assemble/src/session-store.ts',
  'packages/pipeline/transcribe/src/providers/whisper-transcriber.ts',
  'packages/pipeline/transcribe/src/providers/whisper-local-transcriber.ts',
  'packages/pipeline/transcribe/src/providers/medasr-transcriber.ts',
]

const bannedPatterns = [
  { regex: /debugLogPHI\s*\(/g, reason: 'PHI debug logger is not allowed in server runtime files.' },
  { regex: /\[PHI DEBUG\]/g, reason: 'PHI debug marker is not allowed in server runtime files.' },
]

const suspiciousPatterns = [
  /console\.log\([^\n]*(patient|transcript|note|phi)/i,
  /console\.error\([^\n]*(patient|transcript|note|phi)/i,
]

const requestedTargets = process.argv.slice(2)
const filesToScan =
  requestedTargets.length > 0
    ? targets.filter((target) => requestedTargets.includes(target))
    : targets

let failed = false

for (const relPath of filesToScan) {
  const filePath = join(process.cwd(), relPath)
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    continue
  }

  for (const { regex, reason } of bannedPatterns) {
    if (regex.test(text)) {
      console.error(`FAIL ${relPath}: ${reason}`)
      failed = true
    }
  }

  for (const regex of suspiciousPatterns) {
    const match = text.match(regex)
    if (match) {
      console.error(`FAIL ${relPath}: suspicious logging pattern detected: ${match[0].slice(0, 120)}`)
      failed = true
    }
  }
}

if (failed) {
  process.exit(1)
}

console.log('PASS no PHI logging patterns detected in guarded server files')
