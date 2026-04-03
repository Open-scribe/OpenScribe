# OpenScribe Desktop GA Release Checklist

## Support Contract (GA)
- Platforms:
  - macOS (current mainstream release): `x64`, `arm64`
  - Windows 11/10 (current mainstream): `x64`
  - Linux mainstream desktop distros: `x64`, `arm64`
- Hardware baseline:
  - Minimum 8GB RAM
  - 20GB free disk for local model setup and runtime artifacts
- Runtime mode policy:
  - `mixed` mode available by default
  - `local` mode requires guided setup completion

## Hard Blockers (Must Pass)
- All five target artifacts built and published with checksums + manifest:
  - `mac/x64`, `mac/arm64`, `windows/x64`, `linux/x64`, `linux/arm64`
- Installer/runtime E2E smoke passes on each target:
  - clean environment provision
  - launch
  - setup wizard checks
  - local setup state persistence
  - restart
  - uninstall/reinstall simulation
- Signing/notarization verification passes on all targets.
- Release manifest contains valid platform/arch mapping and download URLs.
- Quality gates pass (`lint`, `build:test`, backend unit tests, release evidence validation).

## Release Evidence Table
| Gate | Owner | Evidence | Status |
|---|---|---|---|
| 5-target build matrix | Release Eng | CI run links + artifacts | ☐ |
| E2E launch/lifecycle smoke | QA/Release Eng | CI logs per target | ☐ |
| Setup wizard flow | QA | CI logs + manual notes | ☐ |
| Signature/notarization checks | Release Eng | CI verification logs | ☐ |
| Manifest + checksum integrity | Release Eng | Uploaded `release-manifest.json`, `checksums.txt` | ☐ |
| Manual UX spot-check (3 platforms) | QA | Sign-off notes | ☐ |

## Rollback Procedure
1. Mark failing release as blocked in release notes and internal tracker.
2. Keep previous known-good GA artifact as "latest stable" reference.
3. Revert to previous stable tag for distribution links.
4. Open blocker issue with failing gate evidence and owner.
5. Re-run full matrix + evidence validation before re-promoting GA.
