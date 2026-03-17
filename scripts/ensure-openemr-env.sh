#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

# Defaults for local OpenEMR Docker setup.
OPENEMR_BASE_URL_DEFAULT="http://localhost:8080"
OPENEMR_CLIENT_ID_DEFAULT="PrtJj7quPrrsxcE75PmbwZKW9hISBJVBtoFjbjQ5_a0"
OPENEMR_CLIENT_SECRET_DEFAULT="007hoLom2sQISJ/Z9DXbbGbCDPmgllSxdCeUpDAWiRss04wGe7L2VTC3/juYNXXPF8MoikZX8DRqbNn7oUozLN93QuOc8PVQc0fGk5Pzy62jqsN4UzUSBLZmvWRa3NICpfk9piPTenomh/A0ACOHOTP/AfuvucPpUhfLygYcGK8xEWeSvoOD5N1ygye62GFoL0uOa6y/v4DtFj6HkSwLYrZfg=="
NEXT_PUBLIC_OPENEMR_ENABLED_DEFAULT="true"

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

upsert() {
  local key="$1"
  local value="$2"
  if rg -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

upsert "OPENEMR_BASE_URL" "$OPENEMR_BASE_URL_DEFAULT"
upsert "OPENEMR_CLIENT_ID" "$OPENEMR_CLIENT_ID_DEFAULT"
upsert "OPENEMR_CLIENT_SECRET" "$OPENEMR_CLIENT_SECRET_DEFAULT"
upsert "NEXT_PUBLIC_OPENEMR_ENABLED" "$NEXT_PUBLIC_OPENEMR_ENABLED_DEFAULT"

echo "Ensured OpenEMR env vars in $ENV_FILE"
