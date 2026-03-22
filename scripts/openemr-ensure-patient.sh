#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

FIRST_NAME="${1:-Sammy}"
LAST_NAME="${2:-Margo}"
DOB="${3:-1969-07-01}"
SEX="${4:-Male}"

read_env() {
  local key="$1"
  local value
  value="$(rg "^${key}=" "$ENV_FILE" | sed "s/^${key}=//" || true)"
  printf "%s" "$value"
}

OPENEMR_BASE_URL="$(read_env OPENEMR_BASE_URL)"
OPENEMR_CLIENT_ID="$(read_env OPENEMR_CLIENT_ID)"
OPENEMR_TOKEN_URL="$(read_env OPENEMR_TOKEN_URL)"
OPENEMR_JWT_PRIVATE_KEY_PEM="$(read_env OPENEMR_JWT_PRIVATE_KEY_PEM)"
OPENEMR_USER_REFRESH_TOKEN="$(read_env OPENEMR_USER_REFRESH_TOKEN)"
OPENEMR_USER_TOKEN_SCOPE="$(read_env OPENEMR_USER_TOKEN_SCOPE)"

if [[ -z "$OPENEMR_BASE_URL" || -z "$OPENEMR_CLIENT_ID" || -z "$OPENEMR_JWT_PRIVATE_KEY_PEM" || -z "$OPENEMR_USER_REFRESH_TOKEN" ]]; then
  echo "Missing required OpenEMR env vars. Need OPENEMR_BASE_URL, OPENEMR_CLIENT_ID, OPENEMR_JWT_PRIVATE_KEY_PEM, OPENEMR_USER_REFRESH_TOKEN." >&2
  exit 1
fi

if [[ -z "$OPENEMR_TOKEN_URL" ]]; then
  OPENEMR_TOKEN_URL="${OPENEMR_BASE_URL%/}/oauth2/default/token"
fi

if [[ -z "$OPENEMR_USER_TOKEN_SCOPE" ]]; then
  OPENEMR_USER_TOKEN_SCOPE="api:oemr user/patient.read user/patient.write"
fi

build_client_assertion() {
  OPENEMR_CLIENT_ID="$OPENEMR_CLIENT_ID" \
  OPENEMR_TOKEN_URL="$OPENEMR_TOKEN_URL" \
  OPENEMR_JWT_PRIVATE_KEY_PEM="$OPENEMR_JWT_PRIVATE_KEY_PEM" \
  node -e '
const fs = require("fs");
const crypto = require("crypto");
const clientId = process.env.OPENEMR_CLIENT_ID;
const aud = process.env.OPENEMR_TOKEN_URL;
const raw = process.env.OPENEMR_JWT_PRIVATE_KEY_PEM;
const key = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : fs.readFileSync(raw, "utf8");
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: "RS384", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({
  iss: clientId,
  sub: clientId,
  aud,
  exp: now + 300,
  iat: now,
  jti: crypto.randomUUID(),
})).toString("base64url");
const sign = crypto.createSign("RSA-SHA384");
sign.update(`${header}.${payload}`);
const sig = sign.sign(key).toString("base64url");
process.stdout.write(`${header}.${payload}.${sig}`);
'
}

upsert_env() {
  local key="$1"
  local value="$2"
  if rg -q "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { replaced = 0 }
      $0 ~ "^" k "=" {
        print k "=" v
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) print k "=" v
      }
    ' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

ASSERTION="$(build_client_assertion)"

TOKEN_RESPONSE="$(curl -sS -X POST "$OPENEMR_TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=$OPENEMR_USER_REFRESH_TOKEN" \
  --data-urlencode "scope=$OPENEMR_USER_TOKEN_SCOPE" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$ASSERTION")"

ACCESS_TOKEN="$(printf "%s" "$TOKEN_RESPONSE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const j = JSON.parse(raw);
  if (!j.access_token) {
    console.error(raw);
    process.exit(1);
  }
  process.stdout.write(j.access_token);
});
')"

NEW_REFRESH_TOKEN="$(printf "%s" "$TOKEN_RESPONSE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const j = JSON.parse(raw);
  if (j.refresh_token) process.stdout.write(j.refresh_token);
});
')"

if [[ -n "$NEW_REFRESH_TOKEN" && "$NEW_REFRESH_TOKEN" != "$OPENEMR_USER_REFRESH_TOKEN" ]]; then
  upsert_env "OPENEMR_USER_REFRESH_TOKEN" "$NEW_REFRESH_TOKEN"
fi

Q_FIRST="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$FIRST_NAME")"
Q_LAST="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$LAST_NAME")"
Q_DOB="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DOB")"

SEARCH_URL="${OPENEMR_BASE_URL%/}/apis/default/api/patient?fname=${Q_FIRST}&lname=${Q_LAST}&DOB=${Q_DOB}"
SEARCH_RESPONSE="$(curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$SEARCH_URL")"

FOUND="$(printf "%s" "$SEARCH_RESPONSE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const j = JSON.parse(raw);
  const row = Array.isArray(j?.data) && j.data.length > 0 ? j.data[0] : null;
  if (!row) {
    process.stdout.write("");
    return;
  }
  process.stdout.write(JSON.stringify({ id: row.id, uuid: row.uuid, fname: row.fname, lname: row.lname, DOB: row.DOB }));
});
')"

if [[ -n "$FOUND" ]]; then
  echo "{\"status\":\"exists\",\"patient\":$FOUND}"
  exit 0
fi

CREATE_RESPONSE="$(curl -sS -X POST "${OPENEMR_BASE_URL%/}/apis/default/api/patient" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fname\":\"$FIRST_NAME\",\"lname\":\"$LAST_NAME\",\"DOB\":\"$DOB\",\"sex\":\"$SEX\"}")"

CREATE_PID="$(printf "%s" "$CREATE_RESPONSE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const j = JSON.parse(raw);
  const pid = j?.data?.pid ?? j?.data?.id ?? null;
  if (!pid) {
    console.error(raw);
    process.exit(1);
  }
  process.stdout.write(String(pid));
});
')"

POST_SEARCH_RESPONSE="$(curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$SEARCH_URL")"
POST_FOUND="$(printf "%s" "$POST_SEARCH_RESPONSE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const j = JSON.parse(raw);
  const row = Array.isArray(j?.data) && j.data.length > 0 ? j.data[0] : null;
  if (!row) {
    process.stdout.write(JSON.stringify({ id: process.argv[1], uuid: null }));
    return;
  }
  process.stdout.write(JSON.stringify({ id: row.id, uuid: row.uuid, fname: row.fname, lname: row.lname, DOB: row.DOB }));
});
' "$CREATE_PID")"

echo "{\"status\":\"created\",\"patient\":$POST_FOUND}"
