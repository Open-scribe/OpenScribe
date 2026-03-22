# OpenScribe GCP Deployment Plan (prod-hipaa)

## GCP Organization & Billing
- **Org:** `trymentat.com` (ID: `551180838370`) — BAA signed here
- **Billing account:** `01BAE9-727C79-2A06A1`

## GitHub Repo
- `sammargolis/OpenScribe` (origin remote)
- Workflow triggers on push to `codex/prod-hipaa`

---

## Naming Conventions

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | `openscribe-prod` |
| `GCP_REGION` | `us-central1` |
| `GCP_CLOUD_RUN_SERVICE` | `openscribe-web` |
| `GCP_WHISPER_CLOUD_RUN_SERVICE` | `openscribe-whisper` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `openscribe-web-runner@openscribe-prod.iam.gserviceaccount.com` |
| `GCP_WHISPER_RUNTIME_SERVICE_ACCOUNT` | `openscribe-whisper-runner@openscribe-prod.iam.gserviceaccount.com` |
| `GCP_ARTIFACT_REPO` | `openscribe-images` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `openscribe-deployer@openscribe-prod.iam.gserviceaccount.com` |

---

## Secret Values — COLLECTED STATUS

| Secret | Value | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-d8kvayVY-YgYPX_...` (from .env.local) | ✅ Have it |
| `AUTH_SECRET` | `9xJFyyBVCstL/6tel/9dfaw02cegWQCXuoKTp0fEIA8=` | ✅ Generated |
| `NEXT_PUBLIC_SECURE_STORAGE_KEY` | `jWky4LpBHyrC/WjtEDr01ajC/misy6IkVfsNYytqFHo=` (from .env.local) | ✅ Have it |
| `GOOGLE_CLIENT_ID` | — | ❌ Needs OAuth setup (browser) |
| `GOOGLE_CLIENT_SECRET` | — | ❌ Needs OAuth setup (browser) |
| `DATABASE_URL` | `postgresql://openscribe_app:PASSWORD@HOST/openscribe` | ❌ After Cloud SQL created |
| `REDIS_URL` | `redis://10.X.X.X:6379` | ❌ After Memorystore created |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | — | ❌ After WIF setup |

---

## ⚠️ Issues Found in Workflow — Must Resolve

### 1. DB Migrations run from GitHub Actions runner
The workflow runs `pnpm db:migrate` by fetching `DATABASE_URL` from Secret Manager and running it
directly on the GitHub Actions runner (not inside Cloud Run). This means Cloud SQL needs either:
- **Public IP with authorized networks** — simplest; add `0.0.0.0/0` or a specific CIDR for GitHub IPs
- **Cloud SQL Auth Proxy on the runner** — more secure; add a workflow step

**Recommendation:** Enable public IP on Cloud SQL and add `--authorized-networks=0.0.0.0/0` during
creation (or restrict to GitHub's IP ranges). For HIPAA stricter posture, use Cloud SQL Auth Proxy.

### 2. Redis VPC connectivity
The workflow does NOT set `--vpc-connector` on Cloud Run. Memorystore Redis has no public IP, so
Cloud Run can't reach it without a VPC connector. Must either:
- Add `--vpc-connector=openscribe-connector --vpc-egress=private-ranges-only` to both `gcloud run deploy` commands in the workflow, OR
- Use a publicly accessible Redis (e.g., Redis Enterprise Cloud) — not recommended for HIPAA

**Recommendation:** Update the workflow to add VPC connector flags, and create the VPC connector
in Step 6 below.

### 3. `NEXT_PUBLIC_SECURE_STORAGE_KEY` not passed to Cloud Build
This `NEXT_PUBLIC_*` variable is baked into the Next.js bundle at build time. The workflow uses
`gcloud builds submit` but doesn't pass this key. It must be provided as a Cloud Build substitution
or build arg. Must update the workflow's `gcloud builds submit` command to add:
```
--substitutions="_NEXT_PUBLIC_SECURE_STORAGE_KEY=VALUE"
```
And update `docker/web-cloudrun.Dockerfile` to use `ARG NEXT_PUBLIC_SECURE_STORAGE_KEY` at build time.

### 4. Deployer SA needs Cloud Build permissions
The workflow uses `gcloud builds submit` (Cloud Build), not local Docker push. The deployer SA needs:
- `roles/cloudbuild.builds.editor` — to submit builds
- The Cloud Build service account (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`) needs
  `roles/artifactregistry.writer` automatically (GCP handles this), but confirm after project creation.

---

## Steps

### Step 1 — Create project under org + link billing
```bash
gcloud projects create openscribe-prod \
  --name="OpenScribe Production" \
  --organization=551180838370 \
  --account=sam@trymentat.com

gcloud billing projects link openscribe-prod \
  --billing-account=01BAE9-727C79-2A06A1 \
  --account=sam@trymentat.com
```

### Step 2 — Enable required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  logging.googleapis.com \
  --project=openscribe-prod \
  --account=sam@trymentat.com
```

### Step 3 — Create Artifact Registry repo
The workflow auto-creates this if missing, but pre-creating is cleaner:
```bash
gcloud artifacts repositories create openscribe-images \
  --repository-format=docker \
  --location=us-central1 \
  --description="OpenScribe production Docker images" \
  --project=openscribe-prod \
  --account=sam@trymentat.com
```
→ `GCP_ARTIFACT_REPO=openscribe-images`

### Step 4 — Create service accounts + IAM bindings
```bash
PROJECT=openscribe-prod

# Runtime SAs
gcloud iam service-accounts create openscribe-web-runner \
  --display-name="OpenScribe Web Runtime" --project=$PROJECT

gcloud iam service-accounts create openscribe-whisper-runner \
  --display-name="OpenScribe Whisper Runtime" --project=$PROJECT

# Deploy SA
gcloud iam service-accounts create openscribe-deployer \
  --display-name="OpenScribe GitHub Actions Deployer" --project=$PROJECT

# Runtime SAs: Secret Manager + Cloud SQL access
for SA in openscribe-web-runner openscribe-whisper-runner; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:${SA}@${PROJECT}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:${SA}@${PROJECT}.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"
done

# Deploy SA: Cloud Build + Artifact Registry + Cloud Run + act as runtime SAs
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:openscribe-deployer@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:openscribe-deployer@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:openscribe-deployer@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:openscribe-deployer@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.viewer"

for RUNTIME_SA in openscribe-web-runner openscribe-whisper-runner; do
  gcloud iam service-accounts add-iam-policy-binding \
    ${RUNTIME_SA}@${PROJECT}.iam.gserviceaccount.com \
    --member="serviceAccount:openscribe-deployer@${PROJECT}.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser" \
    --project=$PROJECT
done
```

### Step 5 — Create Cloud SQL Postgres 15 ⏱ ~10 min
```bash
PROJECT=openscribe-prod

gcloud sql instances create openscribe-db \
  --database-version=POSTGRES_15 \
  --tier=db-g1-small \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=20GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --enable-point-in-time-recovery \
  --deletion-protection \
  --authorized-networks=0.0.0.0/0 \
  --project=$PROJECT

gcloud sql databases create openscribe \
  --instance=openscribe-db --project=$PROJECT

# Choose a strong password and save it
gcloud sql users create openscribe_app \
  --instance=openscribe-db \
  --password=CHOOSE_STRONG_PASSWORD \
  --project=$PROJECT

# Get the public IP
gcloud sql instances describe openscribe-db \
  --project=$PROJECT \
  --format="value(ipAddresses[0].ipAddress)"
```
→ `DATABASE_URL=postgresql://openscribe_app:PASSWORD@PUBLIC_IP/openscribe?sslmode=require`

Note: sslmode=require is important since we're using public IP.

### Step 6 — Create VPC connector + Memorystore Redis ⏱ ~10 min
```bash
PROJECT=openscribe-prod

# VPC connector (needed for Cloud Run → Redis)
gcloud compute networks vpc-access connectors create openscribe-connector \
  --region=us-central1 \
  --range=10.8.0.0/28 \
  --project=$PROJECT

# Redis instance
gcloud redis instances create openscribe-redis \
  --size=1 \
  --region=us-central1 \
  --tier=BASIC \
  --redis-version=redis_7_0 \
  --project=$PROJECT

# Get Redis IP (run after ~10 min)
gcloud redis instances describe openscribe-redis \
  --region=us-central1 --project=$PROJECT \
  --format="value(host,port)"
```
→ `REDIS_URL=redis://10.X.X.X:6379`

### Step 7 — Workload Identity Federation for GitHub Actions
```bash
PROJECT=openscribe-prod
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')

gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --project=$PROJECT

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project=$PROJECT

# Bind deploy SA to sammargolis/OpenScribe repo
gcloud iam service-accounts add-iam-policy-binding \
  openscribe-deployer@${PROJECT}.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/sammargolis/OpenScribe" \
  --project=$PROJECT

# Get the provider resource name
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --project=$PROJECT \
  --format="value(name)"
```
→ `GCP_WORKLOAD_IDENTITY_PROVIDER=projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider`

### Step 8 — Google OAuth ⚠️ Browser required
1. Configure consent screen:
   https://console.cloud.google.com/apis/credentials/consent?project=openscribe-prod
   - App name: `OpenScribe`, support email: `sam@trymentat.com`
   - Scopes: `openid`, `email`, `profile`

2. Create OAuth 2.0 Client ID:
   https://console.cloud.google.com/apis/credentials?project=openscribe-prod
   - Type: **Web application**, Name: `OpenScribe Web`
   - Authorized redirect URIs: `https://<web-cloud-run-url>/api/auth/callback/google`
     (use a placeholder now; update after Step 10)
   - Copy **Client ID** and **Client Secret**

→ Collects: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### Step 9 — Store all secrets in Secret Manager
```bash
PROJECT=openscribe-prod

# ANTHROPIC_API_KEY (from .env.local)
echo -n "sk-ant-api03-d8kvayVY-YgYPX_GRiOaeQ1lfd2jMn9z55zv43Q6oz3Atyo_Id1f6Xv8qAejTDGjYaUpyf92inlXm6mxZmjd8A-QR_RuwAA" | \
  gcloud secrets create ANTHROPIC_API_KEY --data-file=- --replication-policy=automatic --project=$PROJECT

# AUTH_SECRET (generated)
echo -n "9xJFyyBVCstL/6tel/9dfaw02cegWQCXuoKTp0fEIA8=" | \
  gcloud secrets create AUTH_SECRET --data-file=- --replication-policy=automatic --project=$PROJECT

# GOOGLE_CLIENT_ID (from Step 8)
echo -n "PASTE_VALUE" | \
  gcloud secrets create GOOGLE_CLIENT_ID --data-file=- --replication-policy=automatic --project=$PROJECT

# GOOGLE_CLIENT_SECRET (from Step 8)
echo -n "PASTE_VALUE" | \
  gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=- --replication-policy=automatic --project=$PROJECT

# DATABASE_URL (from Step 5 — use public IP)
echo -n "postgresql://openscribe_app:PASSWORD@PUBLIC_IP/openscribe?sslmode=require" | \
  gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic --project=$PROJECT

# REDIS_URL (from Step 6)
echo -n "redis://10.X.X.X:6379" | \
  gcloud secrets create REDIS_URL --data-file=- --replication-policy=automatic --project=$PROJECT
```

### Step 10 — Fix workflow issues before first deploy
Before pushing to trigger the workflow, apply these fixes:

**Fix A:** Add VPC connector to both `gcloud run deploy` commands in
`.github/workflows/deploy-web-gcp-hipaa.yml`:
```yaml
--vpc-connector=openscribe-connector \
--vpc-egress=private-ranges-only \
```

**Fix B:** Pass `NEXT_PUBLIC_SECURE_STORAGE_KEY` to Cloud Build. Update the
`gcloud builds submit` commands:
```bash
gcloud builds submit \
  --tag "$WEB_IMAGE_URI" \
  -f docker/web-cloudrun.Dockerfile \
  --substitutions="_NEXT_PUBLIC_SECURE_STORAGE_KEY=jWky4LpBHyrC/WjtEDr01ajC/misy6IkVfsNYytqFHo=" \
  .
```
And update `docker/web-cloudrun.Dockerfile` to declare:
```dockerfile
ARG _NEXT_PUBLIC_SECURE_STORAGE_KEY
ENV NEXT_PUBLIC_SECURE_STORAGE_KEY=$_NEXT_PUBLIC_SECURE_STORAGE_KEY
```

### Step 11 — Add GitHub Actions secrets
Go to: https://github.com/sammargolis/OpenScribe/settings/secrets/actions

| Secret Name | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | from Step 7 |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `openscribe-deployer@openscribe-prod.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | `openscribe-prod` |
| `GCP_REGION` | `us-central1` |
| `GCP_ARTIFACT_REPO` | `openscribe-images` |
| `GCP_CLOUD_RUN_SERVICE` | `openscribe-web` |
| `GCP_WHISPER_CLOUD_RUN_SERVICE` | `openscribe-whisper` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `openscribe-web-runner@openscribe-prod.iam.gserviceaccount.com` |
| `GCP_WHISPER_RUNTIME_SERVICE_ACCOUNT` | `openscribe-whisper-runner@openscribe-prod.iam.gserviceaccount.com` |

### Step 12 — First deploy
After all above steps + OAuth redirect URI updated:
```bash
git push origin codex/prod-hipaa
```
Then:
1. Watch GitHub Actions for the deploy
2. Get the web service URL from the workflow output
3. Go back to OAuth console and add the real redirect URI:
   `https://<actual-web-url>/api/auth/callback/google`

---

## Dependency Order

```
Step 1 (project + billing)
  └─ Step 2 (APIs)
       ├─ Step 3 (Artifact Registry)
       ├─ Step 4 (Service Accounts + IAM)
       ├─ Step 5 (Cloud SQL) ──────────────┐
       ├─ Step 6 (VPC + Redis) ────────────┤
       └─ Step 7 (WIF) [parallel w/ 5+6]   │
                                            │
            Step 8 (OAuth) [browser, parallel ok]
                                            │
                                 Step 9 (Secrets) ← needs values from 5, 6, 8
                                            │
                                 Step 10 (Fix workflow)
                                            │
                                 Step 11 (GitHub secrets) ← needs WIF from Step 7
                                            │
                                 Step 12 (Push → first deploy)
                                            │
                                 Update OAuth redirect URI with real Cloud Run URL
```

---

## HIPAA Notes
- All resources under `trymentat.com` org — BAA applies
- Cloud SQL has `--deletion-protection` and PITR enabled
- Enable Data Access Audit Logs post-setup:
  IAM & Admin → Audit Logs → enable DATA_READ/DATA_WRITE for Cloud SQL, Secret Manager, Cloud Run
- `--authorized-networks=0.0.0.0/0` on Cloud SQL is pragmatic for migrations but consider
  tightening to specific CIDR ranges in steady state
