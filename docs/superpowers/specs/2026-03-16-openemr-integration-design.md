# OpenEMR Integration Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Push-only, web app (`apps/web`), per-clinic credentials, FHIR R4 DocumentReference

---

## Overview

Enable clinicians using OpenScribe's web app to push a completed, reviewed clinical note directly into an OpenEMR patient chart as a FHIR R4 DocumentReference. The integration is additive — it does not replace or affect the existing OpenClaw demo path.

---

## Requirements

- A clinician records an encounter, reviews the generated note, and clicks "Push to OpenEMR" to send it to the patient's chart.
- The OpenEMR patient must be identified by their OpenEMR patient ID, entered at the start of the encounter.
- Authentication uses a single per-clinic OAuth2 client credential pair configured by a clinic admin — no per-user login.
- The integration is silently inactive when `OPENEMR_BASE_URL` is not set, so existing deployments are unaffected.
- The OpenClaw integration coexists unchanged.

---

## Out of Scope

- Patient search or auto-matching by name
- Pulling patient or prior-note context from OpenEMR into OpenScribe
- Bidirectional sync
- Desktop (Electron) support
- Retry logic (clinician retries manually on failure)
- Extending the HIPAA audit log for push events (future work)

---

## Prerequisites (Manual — Clinic Admin)

Before the integration can be used, a clinic admin must register an OAuth2 client in OpenEMR:

1. Navigate to `Admin → System → API Clients` in OpenEMR.
2. Create a new client with scopes: `system/DocumentReference.write system/Patient.read`.
3. Record the generated **Client ID** and **Client Secret**.
4. Add the following to `apps/web/.env.local`:

```
OPENEMR_BASE_URL=http://localhost:8080
OPENEMR_CLIENT_ID=<client id from step 3>
OPENEMR_CLIENT_SECRET=<client secret from step 3>
```

---

## Configuration

### Server-side env vars (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `OPENEMR_BASE_URL` | Yes (to enable) | Base URL of the OpenEMR instance, e.g. `http://localhost:8080` |
| `OPENEMR_CLIENT_ID` | Yes (to enable) | OAuth2 client ID registered in OpenEMR |
| `OPENEMR_CLIENT_SECRET` | Yes (to enable) | OAuth2 client secret |

These are server-side only. They are never sent to the browser.

### Public feature flag (`apps/web/next.config.mjs`)

Derive a single public boolean from the server env at build/start time:

```js
NEXT_PUBLIC_OPENEMR_ENABLED: process.env.OPENEMR_BASE_URL ? "true" : "false"
```

This flag controls conditional rendering of the "Push to OpenEMR" button in the client-side note editor.

---

## Data Model Change

**File:** `packages/ui/src/components/new-encounter-form.tsx`

`patient_id` is promoted from an optional field (previously hardcoded to `""`) to a **required** field with form validation. The clinician cannot start recording without entering a patient ID.

- Input label: "OpenEMR Patient ID"
- Placeholder: "Enter OpenEMR patient ID"
- Validation: non-empty string; inline error message if submitted blank
- No format validation (OpenEMR patient IDs are numeric strings but format enforcement is deferred)

No changes to the `Encounter` type in `packages/storage/src/types.ts` — `patient_id: string` already exists.

---

## API Route

**File:** `apps/web/src/app/api/integrations/openemr/push/route.ts`

### Request

`POST /api/integrations/openemr/push`

```ts
{
  encounterId: string      // OpenScribe encounter ID (for error context)
  patientId: string        // OpenEMR patient ID
  noteMarkdown: string     // Reviewed clinical note text
  patientName: string      // For DocumentReference title
  visitReason: string      // For DocumentReference description
}
```

### Response

Success:
```ts
{ success: true, id: string }   // FHIR DocumentReference resource ID
```

Failure:
```ts
{ success: false, error: string }
```

### Implementation Steps

**Step 1 — OAuth2 token (client_credentials)**

```
POST {OPENEMR_BASE_URL}/oauth2/default/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={OPENEMR_CLIENT_ID}
&client_secret={OPENEMR_CLIENT_SECRET}
&scope=system/DocumentReference.write system/Patient.read
```

Token is cached in module-level memory with the expiry timestamp minus a 5-minute buffer. On each request, if the cached token is still valid it is reused; otherwise a new one is fetched. No Redis or file I/O required.

**Step 2 — Patient validation**

```
GET {OPENEMR_BASE_URL}/apis/default/fhir/Patient/{patientId}
Authorization: Bearer {token}
```

If the response is not HTTP 200, abort and return a patient-not-found error. This prevents creating a DocumentReference linked to a non-existent patient.

**Step 3 — Create DocumentReference**

```
POST {OPENEMR_BASE_URL}/apis/default/fhir/DocumentReference
Authorization: Bearer {token}
Content-Type: application/fhir+json

{
  "resourceType": "DocumentReference",
  "status": "current",
  "type": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "34109-9",
      "display": "Note"
    }]
  },
  "subject": { "reference": "Patient/{patientId}" },
  "date": "<ISO 8601 timestamp>",
  "description": "{visitReason}",
  "content": [{
    "attachment": {
      "contentType": "text/markdown",
      "data": "<base64-encoded noteMarkdown>",
      "title": "Clinical Note — {patientName}"
    }
  }]
}
```

Return the created resource's `id` on success.

---

## UI — Note Editor Button

**File:** `packages/pipeline/render/src/components/note-editor.tsx`

A "Push to OpenEMR" button is added to the existing toolbar row alongside the copy, download, and "Send to OpenClaw" controls. It is conditionally rendered only when `NEXT_PUBLIC_OPENEMR_ENABLED === "true"`.

### Button states

| State | Label | Icon |
|---|---|---|
| Idle | "Push to OpenEMR" | `Upload` (lucide) |
| Pushing | "Pushing..." | `Loader2` spinning |
| Success | "Pushed to OpenEMR" | `Check` (resets to idle after 3s) |

### Disabled conditions

The button is disabled when:
- Note markdown is empty
- `encounter.patient_id` is empty
- A push is already in flight

### Error display

On failure, an inline error message appears below the editor using the same styling as the existing OpenClaw error display (`border-destructive/30 bg-destructive/10 text-destructive`). The error dismisses when the clinician edits the note or clicks away.

---

## Error Messages

| Condition | User-facing message |
|---|---|
| OpenEMR unreachable | `Could not reach OpenEMR at {OPENEMR_BASE_URL}. Check that the server is running.` |
| Patient not found | `Patient ID {patientId} was not found in OpenEMR. Verify the ID and try again.` |
| Auth failure | `OpenEMR authentication failed. Check OPENEMR_CLIENT_ID and OPENEMR_CLIENT_SECRET.` |
| Unexpected server error | `OpenEMR push failed: {error message from server}` |

---

## File Changelist

| File | Change |
|---|---|
| `apps/web/.env.local` | Add `OPENEMR_BASE_URL`, `OPENEMR_CLIENT_ID`, `OPENEMR_CLIENT_SECRET` |
| `apps/web/.env.local.example` | Document the three new vars |
| `apps/web/next.config.mjs` | Derive and expose `NEXT_PUBLIC_OPENEMR_ENABLED` |
| `apps/web/src/app/api/integrations/openemr/push/route.ts` | New — push API route |
| `packages/ui/src/components/new-encounter-form.tsx` | Require `patient_id` field |
| `packages/pipeline/render/src/components/note-editor.tsx` | Add "Push to OpenEMR" button and state |

---

## OpenEMR Docker Reference

For local development, the OpenEMR instance is at `http://localhost:8080` via `/Users/sammargolis/openemr-docker/docker-compose.yml`. Default admin credentials: `admin` / `adminpass`. The OAuth2 client must be registered through the admin UI before first use.
