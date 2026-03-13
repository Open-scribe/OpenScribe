#!/usr/bin/env bash

set -euo pipefail

# Minimal HIPAA-oriented deployment path for OpenScribe web on Cloud Run.
# Assumes BAA and org-level policy decisions are already handled.

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-openscribe-web-prod}"
REPOSITORY="${REPOSITORY:-openscribe-web}"
IMAGE_NAME="${IMAGE_NAME:-openscribe-web}"
RUNTIME_SA="${RUNTIME_SA:-openscribe-web-runtime}"
AUDIT_BUCKET="${AUDIT_BUCKET:-${PROJECT_ID}-openscribe-hipaa-audit-logs}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required"
  exit 1
fi

echo "Using PROJECT_ID=${PROJECT_ID} REGION=${REGION} SERVICE_NAME=${SERVICE_NAME}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Enabling required Google APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  iam.googleapis.com >/dev/null

echo "Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="OpenScribe production web images"
fi

echo "Ensuring runtime service account exists..."
if ! gcloud iam service-accounts describe "${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SA}" \
    --display-name="OpenScribe Web Runtime"
fi

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo "Ensuring audit bucket exists..."
if ! gcloud storage buckets describe "gs://${AUDIT_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${AUDIT_BUCKET}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
fi

# 6-year retention target for compliance/audit records.
gcloud storage buckets update "gs://${AUDIT_BUCKET}" \
  --retention-period=189216000 >/dev/null

echo "Ensuring Cloud Logging sink exists..."
if ! gcloud logging sinks describe openscribe-hipaa-audit-sink >/dev/null 2>&1; then
  gcloud logging sinks create openscribe-hipaa-audit-sink \
    "storage.googleapis.com/${AUDIT_BUCKET}" \
    --description="OpenScribe Cloud Run + audit logs for HIPAA evidence" \
    --log-filter='resource.type="cloud_run_revision" OR logName:("cloudaudit.googleapis.com")'
fi

SINK_WRITER="$(gcloud logging sinks describe openscribe-hipaa-audit-sink --format='value(writerIdentity)')"
gcloud storage buckets add-iam-policy-binding "gs://${AUDIT_BUCKET}" \
  --member="${SINK_WRITER}" \
  --role="roles/storage.objectCreator" >/dev/null

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:$(git rev-parse --short HEAD)"

echo "Building image ${IMAGE_URI}..."
gcloud builds submit --tag "${IMAGE_URI}" -f docker/web-cloudrun.Dockerfile .

DEPLOY_AUTH_FLAG="--allow-unauthenticated"
if [[ "${ALLOW_UNAUTHENTICATED}" != "true" ]]; then
  DEPLOY_AUTH_FLAG="--no-allow-unauthenticated"
fi

echo "Deploying Cloud Run service ${SERVICE_NAME}..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --service-account "${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ingress all \
  --execution-environment gen2 \
  --cpu 1 \
  --memory 2Gi \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production" \
  ${DEPLOY_AUTH_FLAG}

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
echo "Deployment complete: ${SERVICE_URL}"
echo "Add required secrets in Secret Manager and bind them to Cloud Run before production traffic."
