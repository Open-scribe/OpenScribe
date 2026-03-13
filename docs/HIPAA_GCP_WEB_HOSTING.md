# HIPAA Web Hosting (Simple GCP Path)

This is the shortest path to host OpenScribe web on Google Cloud in a HIPAA-oriented production setup.

## Scope
- Runtime: Cloud Run web + Cloud Run whisper service
- Identity: Google OAuth via Auth.js
- Secrets: Secret Manager only (no in-app key management)
- Audit evidence: Cloud Logging sink to retained Cloud Storage bucket

## 1. Production branch
```bash
git checkout codex/prod-hipaa
git pull --ff-only
```

## 2. Required Secret Manager secrets
Create or update:
- `ANTHROPIC_API_KEY`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL`

Example:
```bash
echo -n "value" | gcloud secrets versions add AUTH_SECRET --data-file=-
```

## 3. One-time setup + deploy
From repo root:
```bash
PROJECT_ID="your-gcp-project-id" \
REGION="us-central1" \
WEB_SERVICE_NAME="openscribe-web-prod" \
WHISPER_SERVICE_NAME="openscribe-whisper-prod" \
./scripts/deploy-gcp-hipaa-web.sh
```

This deploys:
- `openscribe-whisper-prod` (private, IAM-invoked only)
- `openscribe-web-prod` (public sign-in surface, authenticated PHI endpoints)

## 4. GitHub Actions deploy (recommended)
Workflow file: `.github/workflows/deploy-web-gcp-hipaa.yml`

Set repository secrets:
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_ARTIFACT_REPO`
- `GCP_CLOUD_RUN_SERVICE`
- `GCP_RUNTIME_SERVICE_ACCOUNT`
- `GCP_WHISPER_CLOUD_RUN_SERVICE`
- `GCP_WHISPER_RUNTIME_SERVICE_ACCOUNT`

Push to `codex/prod-hipaa` to deploy.

## 5. Hosted-mode behavior
When `HIPAA_HOSTED_MODE=true`:
- Google sign-in is required.
- Terms acceptance is required before PHI actions.
- `/api/settings/api-keys` returns `410` (disabled).
- Transcription is forced to internal whisper service.

## 6. Audit evidence to retain
- Cloud Run revision/deploy history (web + whisper)
- Cloud Audit Logs export via `openscribe-hipaa-audit-sink`
- CI run logs for each production deployment
- IAM policy bindings for runtime/deploy service accounts
- Secret version history and rotation records

## 7. Apply Cloud Armor rate limits (required for open signup)
```bash
PROJECT_ID="your-gcp-project-id" \
BACKEND_SERVICE="your-https-lb-backend-service" \
./scripts/setup-cloud-armor-rate-limit.sh
```

## 8. Minimal release gate
Before each production merge:
- `lint` green
- `typecheck` green
- `test` green
- `no-phi-log-check` green
- `Deploy Web (GCP HIPAA) / deploy` green

## Notes
- This is a technical hosting baseline, not legal certification.
- Open signup + rate limits only is accepted risk for this launch configuration.
