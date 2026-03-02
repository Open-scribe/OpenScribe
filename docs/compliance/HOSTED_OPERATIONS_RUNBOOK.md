# Hosted Operations Runbook

## Local-first default
OpenScribe remains local-first by default. Hosted behavior is only enabled when both:
- `HOSTED_MODE=true`
- `NEXT_PUBLIC_HOSTED_MODE=true`

## Required runtime env vars (hosted)
- `HOSTED_MODE=true`
- `NEXT_PUBLIC_HOSTED_MODE=true`
- `ALLOW_USER_API_KEYS=false`
- `PERSIST_SERVER_PHI=false`
- `AUTH_SESSION_SECRET=<strong-random-secret>`
- `TRANSCRIPTION_PROVIDER=gcp_stt_v2`
- `GCP_PROJECT_ID=<project-id>`
- `GCP_STT_LOCATION=us-central1`
- `GCP_STT_MODEL=chirp_2`
- `GCP_STT_LANGUAGE_CODE=en-US`
- `ANTHROPIC_API_KEY=<from Secret Manager/env injection>`

## Hosted auth flow
1. User authenticates with Identity Platform and obtains ID token.
2. Client sends token to `POST /api/auth/bootstrap`.
3. Backend verifies token, creates/loads org membership, sets HttpOnly session cookie.
4. Protected routes authorize via session cookie (or bearer token fallback).

## Redis session store (optional for multi-instance)
- `SESSION_STORE_BACKEND=redis`
- `REDIS_HOST=<memorystore-ip-or-dns>`
- `REDIS_PORT=6379`
- `REDIS_PASSWORD=<if configured>`
- `REDIS_TLS=true|false`

## Release process
1. Merge via PR to `main` with required checks passing.
2. Create release tag: `vX.Y.Z`.
3. `release.yml` builds image, pushes Artifact Registry, deploys Cloud Run.
4. Validate health and authentication in production.

## Security checks before release
- `pnpm build:test`
- `pnpm test:no-phi-logs`
- CI secret scan and dependency scan pass

## Incident response baseline
- Revoke compromised credentials in Secret Manager.
- Rotate `AUTH_SESSION_SECRET`.
- Invalidate sessions by rotating secret and redeploying.
- Review Cloud Logging and audit events for affected window.
