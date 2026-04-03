/* eslint-env node */

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "production" ? "" : "'unsafe-eval'"} https://va.vercel-scripts.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' https://api.openai.com https://va.vercel-scripts.com https://vitals.vercel-insights.com;
  media-src 'self' blob:;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  worker-src 'self' blob:;
  manifest-src 'self';
  block-all-mixed-content;
`.replace(/\s{2,}/g, ' ').trim()

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'off',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), payment=(), usb=()',
  },
]

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  webpack: (config) => {
    // Add aliases for monorepo packages to match tsconfig.json paths
    // Note: Webpack aliases are simple prefix replacements, not glob patterns
    // Don't use wildcards (*) - point to directories and webpack appends the rest
    config.resolve.alias = {
      ...config.resolve.alias,
      '@audio': path.resolve(__dirname, '../packages/pipeline/audio-ingest/src'),
      '@transcription': path.resolve(__dirname, '../packages/pipeline/transcribe/src'),
      '@transcript-assembly': path.resolve(__dirname, '../packages/pipeline/assemble/src'),
      '@note-core': path.resolve(__dirname, '../packages/pipeline/note-core/src'),
      '@note-rendering': path.resolve(__dirname, '../packages/pipeline/render/src'),
      '@llm': path.resolve(__dirname, '../packages/llm/src'),
      '@llm-medgemma': path.resolve(__dirname, '../packages/llm-medgemma/src'),
      '@medgemma-scribe': path.resolve(__dirname, '../packages/pipeline/medgemma-scribe/src'),
      '@pipeline-errors': path.resolve(__dirname, '../packages/pipeline/shared/src'),
      '@storage': path.resolve(__dirname, '../packages/storage/src'),
      '@ui': path.resolve(__dirname, '../packages/ui/src'),
      '@ui/lib': path.resolve(__dirname, '../packages/ui/src/lib'),
    }
    return config
  },
}

export default nextConfig
