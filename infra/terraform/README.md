# Terraform Foundation

This folder contains environment-scoped Terraform entrypoints for `dev`, `staging`, and `prod`.

## Conventions
- Shared modules live in `infra/terraform/modules/`
- Environment roots live in `infra/terraform/environments/<env>/`
- Production changes require PR approval and release tag flow

## Planned resources
- Artifact Registry
- Cloud Run
- Identity Platform
- Firestore
- Memorystore (Redis)
- Secret Manager
- Logging sink + alerts
- Load Balancer + Cloud Armor
