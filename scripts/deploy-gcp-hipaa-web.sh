#!/usr/bin/env bash

set -euo pipefail

# HIPAA-hosted OpenScribe deployment (web + whisper) on Cloud Run.

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-openscribe-web}"
WEB_SERVICE_NAME="${WEB_SERVICE_NAME:-openscribe-web-prod}"
WHISPER_SERVICE_NAME="${WHISPER_SERVICE_NAME:-openscribe-whisper-prod}"
WEB_RUNTIME_SA="${WEB_RUNTIME_SA:-openscribe-web-runtime}"
WHISPER_RUNTIME_SA="${WHISPER_RUNTIME_SA:-openscribe-whisper-runtime}"
AUDIT_BUCKET="${AUDIT_BUCKET:-${PROJECT_ID}-openscribe-hipaa-audit-logs}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required"
  exit 1
fi

echo "Using PROJECT_ID=${PROJECT_ID} REGION=${REGION}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Enabling required Google APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  iam.googleapis.com >/dev/null

echo "Validating required secrets..."
for name in ANTHROPIC_API_KEY AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET DATABASE_URL REDIS_URL; do
  gcloud secrets describe "$name" >/dev/null
 done

echo "Running DB migrations..."
DATABASE_URL="$(gcloud secrets versions access latest --secret DATABASE_URL | tr -d '\n')"
DATABASE_URL="$DATABASE_URL" pnpm db:migrate

echo "Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="OpenScribe production images"
fi

for sa in "${WEB_RUNTIME_SA}" "${WHISPER_RUNTIME_SA}"; do
  if ! gcloud iam service-accounts describe "${sa}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${sa}" --display-name="${sa}"
  fi
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/logging.logWriter" >/dev/null
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
 done

echo "Ensuring audit bucket exists..."
if ! gcloud storage buckets describe "gs://${AUDIT_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${AUDIT_BUCKET}" --location="${REGION}" --uniform-bucket-level-access
fi
gcloud storage buckets update "gs://${AUDIT_BUCKET}" --retention-period=189216000 >/dev/null

if ! gcloud logging sinks describe openscribe-hipaa-audit-sink >/dev/null 2>&1; then
  gcloud logging sinks create openscribe-hipaa-audit-sink \
    "storage.googleapis.com/${AUDIT_BUCKET}" \
    --description="OpenScribe Cloud Run + audit logs for HIPAA evidence" \
    --log-filter='resource.type="cloud_run_revision" OR logName:("cloudaudit.googleapis.com")'
fi
SINK_WRITER="$(gcloud logging sinks describe openscribe-hipaa-audit-sink --format='value(writerIdentity)')"
gcloud storage buckets add-iam-policy-binding "gs://${AUDIT_BUCKET}" \
  --member="${SINK_WRITER}" --role="roles/storage.objectCreator" >/dev/null

WEB_IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/openscribe-web:$(git rev-parse --short HEAD)"
WHISPER_IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/openscribe-whisper:$(git rev-parse --short HEAD)"

echo "Building web image ${WEB_IMAGE_URI}..."
gcloud builds submit --tag "${WEB_IMAGE_URI}" -f docker/web-cloudrun.Dockerfile .

echo "Building whisper image ${WHISPER_IMAGE_URI}..."
gcloud builds submit --tag "${WHISPER_IMAGE_URI}" -f docker/whisper-cloudrun.Dockerfile .

echo "Deploying whisper service ${WHISPER_SERVICE_NAME}..."
gcloud run deploy "${WHISPER_SERVICE_NAME}" \
  --image "${WHISPER_IMAGE_URI}" \
  --region "${REGION}" \
  --platform managed \
  --port 8081 \
  --service-account "${WHISPER_RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ingress all \
  --execution-environment gen2 \
  --cpu 4 \
  --memory 8Gi \
  --min-instances 1 \
  --max-instances 4 \
  --set-env-vars "WHISPER_LOCAL_MODEL=tiny.en,WHISPER_LOCAL_BACKEND=cpp,WHISPER_LOCAL_GPU=1" \
  --no-allow-unauthenticated

WHISPER_URL="$(gcloud run services describe "${WHISPER_SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"

gcloud run services add-iam-policy-binding "${WHISPER_SERVICE_NAME}" \
  --region "${REGION}" \
  --member "serviceAccount:${WEB_RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker >/dev/null

echo "Deploying web service ${WEB_SERVICE_NAME}..."
gcloud run deploy "${WEB_SERVICE_NAME}" \
  --image "${WEB_IMAGE_URI}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --service-account "${WEB_RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ingress all \
  --execution-environment gen2 \
  --cpu 1 \
  --memory 2Gi \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production,HIPAA_HOSTED_MODE=true,NEXT_PUBLIC_HIPAA_HOSTED_MODE=true,TRANSCRIPTION_PROVIDER=whisper_local,WHISPER_LOCAL_URL=${WHISPER_URL}/v1/audio/transcriptions,WHISPER_LOCAL_AUTH_TYPE=identity_token" \
  --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,AUTH_SECRET=AUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,DATABASE_URL=DATABASE_URL:latest,REDIS_URL=REDIS_URL:latest" \
  --allow-unauthenticated

WEB_URL="$(gcloud run services describe "${WEB_SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
echo "Deployment complete"
echo "Web URL: ${WEB_URL}"
echo "Whisper URL: ${WHISPER_URL}"
