#!/usr/bin/env node
/**
 * Setup environment file with auto-generated NEXT_PUBLIC_SECURE_STORAGE_KEY
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const envPath = path.join(__dirname, '../apps/web/.env.local')
const envExamplePath = path.join(__dirname, '../apps/web/.env.local.example')

// Check if .env.local already exists
if (fs.existsSync(envPath)) {
  console.log('✅ .env.local already exists')
  
  // Check if it has the NEXT_PUBLIC_SECURE_STORAGE_KEY
  const envContent = fs.readFileSync(envPath, 'utf-8')
  if (envContent.includes('NEXT_PUBLIC_SECURE_STORAGE_KEY=') && 
      !envContent.includes('NEXT_PUBLIC_SECURE_STORAGE_KEY="base64-secret"') &&
      !envContent.includes('NEXT_PUBLIC_SECURE_STORAGE_KEY=PASTE_OUTPUT_FROM_OPENSSL_COMMAND')) {
    console.log('✅ NEXT_PUBLIC_SECURE_STORAGE_KEY already configured')
    process.exit(0)
  }
}

// Generate a secure random 32-byte key
const secureKey = crypto.randomBytes(32).toString('base64')

// Read the example file
let envContent = ''
if (fs.existsSync(envExamplePath)) {
  envContent = fs.readFileSync(envExamplePath, 'utf-8')
  
  // Replace the placeholder with the generated key
  envContent = envContent.replace(
    'NEXT_PUBLIC_SECURE_STORAGE_KEY="base64-secret"',
    `NEXT_PUBLIC_SECURE_STORAGE_KEY="${secureKey}"`
  )
} else {
  // Create from scratch if example doesn't exist
  envContent = `# OpenAI API key for transcription (Whisper API)
# Get your key at: https://platform.openai.com/api-keys
OPENAI_API_KEY="sk-proj-your-key"

# Anthropic API key for clinical note generation
# Get your key at: https://console.anthropic.com/
ANTHROPIC_API_KEY="sk-ant-your-key"

# Auto-generated secure storage key (do not modify)
NEXT_PUBLIC_SECURE_STORAGE_KEY="${secureKey}"

# Hosted mode toggles
HOSTED_MODE="false"
NEXT_PUBLIC_HOSTED_MODE="false"
ALLOW_USER_API_KEYS="true"
PERSIST_SERVER_PHI="false"
`
}

// Write the .env.local file
fs.writeFileSync(envPath, envContent)

console.log('✅ Created .env.local with auto-generated storage key')
console.log('')
console.log('Next steps:')
console.log('1. Edit apps/web/.env.local')
console.log('2. Add your OPENAI_API_KEY')
console.log('3. Add your ANTHROPIC_API_KEY')
console.log('')
