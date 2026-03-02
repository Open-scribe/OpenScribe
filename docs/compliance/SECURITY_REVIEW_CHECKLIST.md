# Security Review Checklist

## Access Control
- Auth required for all PHI-processing endpoints
- Authorization checks include org scope
- No anonymous access in hosted mode

## PHI Handling
- No durable server-side transcript/audio/note persistence
- No PHI fields in logs
- Error messages are sanitized

## Secrets and Keys
- Secrets sourced from Secret Manager / env only
- No plaintext keys stored on disk in hosted mode
- Rotation procedure documented

## Infrastructure
- TLS enforced end-to-end
- Least-privilege IAM applied
- Audit logs exported with retention policy

## Release and Change Control
- Change merged via PR with approvals
- Required checks passed
- Rollback plan documented
