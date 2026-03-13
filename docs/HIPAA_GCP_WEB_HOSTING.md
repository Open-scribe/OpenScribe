# HIPAA Web Hosting (Simple GCP Path)

This is the shortest path to host OpenScribe web on Google Cloud in a HIPAA-oriented production setup.

## Scope
- Runtime: Cloud Run (web app)
- Image registry: Artifact Registry
- Secrets: Secret Manager
- Audit evidence: Cloud Logging sink to a retained Cloud Storage bucket

## 1. Create production branch
```bash
git checkout -b codex/prod-hipaa
git push -u origin codex/prod-hipaa
```

## 2. One-time project setup + deploy
From repo root:
```bash
chmod +x scripts/deploy-gcp-hipaa-web.sh
PROJECT_ID="your-gcp-project-id" \
REGION="us-central1" \
SERVICE_NAME="openscribe-web-prod" \
REPOSITORY="openscribe-web" \
RUNTIME_SA="openscribe-web-runtime" \
ALLOW_UNAUTHENTICATED="true" \
./scripts/deploy-gcp-hipaa-web.sh
```

## 3. Set required app secret
Create `ANTHROPIC_API_KEY` in Secret Manager:
```bash
echo -n "sk-ant-..." | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
```
If the secret exists:
```bash
echo -n "sk-ant-..." | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
```

## 4. Configure GitHub Actions deploy (recommended)
Workflow file: `.github/workflows/deploy-web-gcp-hipaa.yml`

Set repository secrets:
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_ARTIFACT_REPO`
- `GCP_CLOUD_RUN_SERVICE`
- `GCP_RUNTIME_SERVICE_ACCOUNT` (full email, for example `openscribe-web-runtime@PROJECT.iam.gserviceaccount.com`)

Push to `codex/prod-hipaa` to deploy.

## 5. Audit evidence to retain
- Cloud Run revision/deploy history
- Cloud Audit Logs exported via `openscribe-hipaa-audit-sink`
- CI run logs for each production deployment
- Service account IAM policy bindings
- Secret version update history

## 6. Minimal release gate
Before each production merge:
- `lint` green
- `typecheck` green
- `test` green
- `no-phi-log-check` green
- Deployment workflow green on `codex/prod-hipaa`

## Notes
- This is a technical hosting baseline, not legal certification.
- Keep all PHI-bearing integrations in BAA-covered services only.
