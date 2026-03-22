#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
POLICY_NAME="${POLICY_NAME:-openscribe-hipaa-rate-limit}"
BACKEND_SERVICE="${BACKEND_SERVICE:-}"

if [[ -z "$PROJECT_ID" || -z "$BACKEND_SERVICE" ]]; then
  echo "PROJECT_ID and BACKEND_SERVICE are required"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud compute security-policies describe "$POLICY_NAME" >/dev/null 2>&1 || \
  gcloud compute security-policies create "$POLICY_NAME" --description="OpenScribe HIPAA public signup/API rate limit"

# Throttle auth and PHI API paths.
gcloud compute security-policies rules create 1000 \
  --security-policy "$POLICY_NAME" \
  --expression='request.path.matches("^/api/(auth|transcription|compliance)/.*")' \
  --action="throttle" \
  --rate-limit-threshold-count=120 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP >/dev/null 2>&1 || true

# Baseline global per-IP throttle.
gcloud compute security-policies rules create 1100 \
  --security-policy "$POLICY_NAME" \
  --expression='true' \
  --action="throttle" \
  --rate-limit-threshold-count=600 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP >/dev/null 2>&1 || true

gcloud compute backend-services update "$BACKEND_SERVICE" \
  --global \
  --security-policy "$POLICY_NAME"

echo "Cloud Armor policy applied: $POLICY_NAME"
