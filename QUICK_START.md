# Quick Start - Rebuilding OpenScribe

## TL;DR

Run this single command to rebuild everything:

```bash
./rebuild-and-test.sh
```

## What Was Fixed?

### 🔴 Critical Bugs Fixed
1. **EventSource Connection Storm** - App was creating/destroying SSE connections every second
2. **Multiple Windows Opening** - Single instance lock wasn't working properly
3. **App Won't Quit** - Cleanup could hang indefinitely
4. **Memory Leaks** - Old sessions never cleaned up

### ✅ Solutions Applied
1. Stabilized React callbacks with refs to prevent EventSource recreation
2. Improved window management with better existence checks
3. Added 3-second force-quit timeout
4. Automatic session garbage collection every 5 minutes

## Build Steps

### Option 1: Automated (Recommended)
```bash
./rebuild-and-test.sh
```

This will:
- Kill existing processes
- Clean all build artifacts
- Reinstall dependencies  
- Build production app
- Run automated tests
- Give you manual test checklist

### Option 2: Manual
```bash
# 1. Stop everything
pkill -f OpenScribe
pkill -f "electron.*main.js"
pkill -f "next dev"

# 2. Clean
rm -rf build/ apps/web/.next/ .next/ node_modules/.cache/

# 3. Install
pnpm install

# 4. Build
pnpm build:desktop

# 5. Run
open build/dist/mac-arm64/OpenScribe.app
```

## Testing Checklist

### Automated (Script Does This)
- [x] Single instance enforcement
- [x] Clean shutdown (no zombie processes)

### Manual Testing
- [ ] Create new encounter → Record → Transcribe → Generate note
- [ ] Minimize window, click dock icon (should restore)
- [ ] Try opening app again (should focus existing window)
- [ ] Quit with Cmd+Q (should exit cleanly in ~2 seconds)
- [ ] Check Activity Monitor - no OpenScribe processes left

## Verification

### Good Signs ✅
```
# In server logs:
[SessionStore] Created new session: abc123. Total sessions: 1
[EventSource] Connecting to session: abc123
[SessionStore] Subscriber added to session abc123. Total listeners: 1

# Only 1-2 requests per session (not 20+):
GET /api/transcription/stream/abc123 200

# On quit:
[Cleanup] Cleanup complete
```

### Bad Signs ❌
```
# EventSource storm (multiple per second):
GET /api/transcription/stream/abc123 200 in 1000ms
GET /api/transcription/stream/abc123 200 in 995ms
GET /api/transcription/stream/abc123 200 in 1002ms
(repeating...)

# Multiple processes:
$ ps aux | grep OpenScribe
user  1234  ...  OpenScribe
user  5678  ...  OpenScribe  <-- BAD!

# Zombie processes after quit:
$ ps aux | grep "node.*server.js"
user  9999  ...  node server.js  <-- BAD!
```

## What Changed?

See `STABILITY_FIXES.md` for detailed technical explanation.

### Key Files Modified
- `packages/shell/main.js` - Window management + quit handler
- `apps/web/src/app/page.tsx` - EventSource stability
- `packages/pipeline/assemble/src/session-store.ts` - Session cleanup

## Troubleshooting

### Build Fails
```bash
# Clean everything and retry
rm -rf node_modules/
pnpm install
pnpm build:desktop
```

### App Won't Open
```bash
# Check Console.app for errors
# Look for OpenScribe in the filter

# Try running from terminal to see errors:
./build/dist/mac-arm64/OpenScribe.app/Contents/MacOS/OpenScribe
```

### Permission Issues
```bash
# Reset permissions
tccutil reset Microphone
tccutil reset ScreenCapture

# Reopen app and grant permissions when prompted
```

### Still Having Issues?
1. Check `Console.app` logs (filter: OpenScribe)
2. Look for [SessionStore] and [EventSource] logs
3. Check Activity Monitor for process count
4. Verify no zombie processes: `ps aux | grep -E "(OpenScribe|electron|node.*server)"`

## Success Criteria

✅ App opens in ~3 seconds
✅ Only ONE process in Activity Monitor
✅ Recording works end-to-end
✅ App quits cleanly in ~2 seconds
✅ No zombie processes after quit
✅ Can reopen immediately without issues

## Before vs After

### Before
- 10+ windows opening
- App hangs on quit
- 20+ EventSource requests per second
- Memory usage growing unbounded
- Can't reopen after force quit

### After
- Single stable window
- Clean quit in 2 seconds
- Stable EventSource connections
- Automatic memory cleanup
- Reliable reopen

---

**Last Updated**: December 12, 2025
**Status**: Ready for rebuild and testing

