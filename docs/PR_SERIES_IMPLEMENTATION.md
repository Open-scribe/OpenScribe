# PR Series Implementation Guide

This repository currently contains a combined working tree for hosted-mode hardening.
Use the following PR lanes to split and merge safely.

## PR order
1. `ci/harden-checks-and-scope`
2. `fix/auth-bootstrap-deadlock`
3. `fix/sse-auth-without-query-token`
4. `feat/authz-note-generation-route`
5. `refactor/session-store-redis-reliability`
6. `feat/gcp-stt-provider-hardening`
7. `fix/hosted-api-key-and-audit-sanitization`
8. `docs/local-first-and-hosted-ops`
9. `feat/terraform-minimum-viable-stack`
10. `ci/release-tag-prod-deploy`

## Suggested split by file groups

### 1) CI hardening
- `.github/workflows/ci.yml`
- `config/eslint.config.mjs`
- `docs/BRANCH_PROTECTION.md`

### 2) Auth bootstrap deadlock
- `apps/web/src/lib/auth.ts`
- `apps/web/src/app/api/auth/bootstrap/route.ts`

### 3) SSE auth without query token
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/api/transcription/stream/[sessionId]/route.ts`
- `packages/pipeline/transcribe/src/hooks/segment-upload-controller.ts`

### 4) Authenticated notes route
- `apps/web/src/app/api/notes/generate/route.ts`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/actions.ts`

### 5) Session store reliability
- `packages/pipeline/assemble/src/session-store.ts`
- `apps/web/src/app/api/transcription/segment/route.ts`
- `apps/web/src/app/api/transcription/final/route.ts`
- `packages/pipeline/eval/src/tests/e2e-basic.test.ts`
- `packages/pipeline/eval/src/tests/e2e-real-api.test.ts`

### 6) GCP STT hardening
- `packages/pipeline/transcribe/src/providers/gcp-stt-transcriber.ts`
- `packages/pipeline/transcribe/src/providers/provider-resolver.ts`
- `packages/pipeline/transcribe/src/__tests__/provider-resolver.test.ts`
- `packages/pipeline/transcribe/src/__tests__/gcp-stt-transcriber.test.ts`

### 7) Hosted API key + audit sanitization
- `apps/web/src/app/api/settings/api-keys/route.ts`
- `packages/storage/src/server-api-keys.ts`
- `packages/storage/src/server-audit.ts`
- `packages/storage/src/__tests__/server-audit.test.ts`
- `scripts/check-no-phi-logs.mjs`

### 8) Docs updates
- `README.md`
- `CONTRIBUTING.md`
- `docs/compliance/HOSTED_OPERATIONS_RUNBOOK.md`

### 9) Terraform MVP stack
- `infra/terraform/modules/**`
- `infra/terraform/environments/**`
- `infra/terraform/README.md`
- `.github/workflows/terraform-plan.yml`
- `.github/workflows/terraform-apply.yml`

### 10) Release deploy workflow
- `.github/workflows/release.yml`
