# Desktop Release Runbook

This is the shortest repeatable path to produce downloadable installers and publish them for users.

## Pre-release Requirements
- Signing secrets configured in GitHub Actions:
  - `CSC_LINK`, `CSC_KEY_PASSWORD`
  - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
  - `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
  - `LINUX_SIGNING_KEY`
- `desktop-release` workflow green on default branch.

## 1. Create release tag
```bash
git checkout main
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

## 2. CI build + publish
- GitHub Actions runs `.github/workflows/desktop-release.yml` on the tag.
- Required matrix targets:
  - macOS `x64`, `arm64`
  - Windows `x64`
  - Linux `x64`, `arm64`
- The workflow publishes a GitHub Release with installer files and integrity files.

## 3. Verify release output
- Confirm release assets include installers for all required targets.
- Confirm `release-manifest.json` and `checksums.txt` are attached.
- Confirm `validate-release-evidence` job passed.
- Confirm signing/notarization gate passed for each target.

## 4. Manual sign-off
- Complete [MANUAL_SIGNOFF_TEMPLATE.md](./MANUAL_SIGNOFF_TEMPLATE.md):
  - One human run on macOS, Windows, and Linux
  - First-run setup + recording/transcription/note generation sanity

## 5. Mark GA ready
- Update [RELEASE_READINESS_CHECKLIST.md](./RELEASE_READINESS_CHECKLIST.md) with evidence links.
- Announce release only when all blockers are green.
