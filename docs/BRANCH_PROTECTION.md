# Branch Protection Policy

## Protected branch
- `main`

## Required settings
- Pull request required before merge
- At least 1 approving review
- Dismiss stale approvals when new commits are pushed
- Require conversation resolution before merge
- Require status checks to pass
- Restrict direct pushes to `main`
- Allow squash merge only

## Required status checks
- `lint`
- `typecheck`
- `test`
- `dependency-scan`
- `secret-scan`
- `no-phi-log-check`

## Release policy
- Production deploys are allowed only from signed tags `v*`
- `main` merges may deploy to non-production environments only
