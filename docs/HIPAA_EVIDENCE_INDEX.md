# HIPAA Evidence Index

## Ownership
- Security/Compliance owner: `TBD` (required)
- Engineering owner: `TBD`

## Recurring controls
- Daily: authentication and abuse log review
- Weekly: access review (users, service accounts, elevated roles)
- Monthly: secret rotation verification
- Quarterly: incident response tabletop drill

## Evidence map
| Control | Evidence | Location |
|---|---|---|
| Auth enforced for PHI APIs | API auth tests + route guards | CI logs + code review |
| Secret-managed credentials only | Secret Manager versions + deploy config | GCP Secret Manager + workflow logs |
| Audit logging retention | Log sink + bucket retention policy | Cloud Logging + Cloud Storage |
| Deployment traceability | Build/deploy runs and image tags | GitHub Actions + Artifact Registry |
| Access governance | IAM policy snapshots | GCP IAM exports |

## Collection cadence
- Keep exported evidence snapshots monthly and before each major release.
