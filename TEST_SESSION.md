# Test Session - December 12, 2025, 1:13 PM

## ✅ Stability Tests Completed

### Test 1: Single Instance Lock
**Status**: ✅ **PASSED**
- Launched app: PID 72475
- Attempted second launch
- Result: Only ONE process running (focused existing window)
- **This is the correct behavior!**

### Test 2: Process Verification  
**Status**: ✅ **PASSED**
- Only 1 OpenScribe process found
- No duplicate Electron processes
- Next.js server embedded correctly (standalone build)
- No zombie processes

### Test 3: Clean Startup
**Status**: ✅ **PASSED**
- App launched successfully
- No error logs in system logs
- App window is responsive

---

## 🧪 Manual Tests Required

### Please test the following in the running app:

#### Test 4: Recording Workflow
- [ ] Click "New Encounter" or start new recording
- [ ] Fill in patient details
- [ ] Click "Start Recording"
- [ ] **Expected**: Microphone permission prompt (if first time)
- [ ] Speak for 10-15 seconds
- [ ] Click "Stop Recording"
- [ ] **Expected**: Transcription processes
- [ ] **Expected**: Note generates automatically
- [ ] **Check**: Did it work end-to-end?

#### Test 5: EventSource Stability (CRITICAL)
While recording or after starting:
- [ ] Open Console app on Mac
- [ ] Filter for "SessionStore" or "EventSource"
- [ ] **Look for**: Session creation logs
- [ ] **Should see**: Only 1-2 connections per session
- [ ] **Should NOT see**: Rapid repeated connections (every second)

#### Test 6: Window Management
- [ ] Minimize the window
- [ ] Click OpenScribe icon in dock
- [ ] **Expected**: Window restores
- [ ] Try Cmd+H to hide
- [ ] Click dock icon again
- [ ] **Expected**: Window shows

#### Test 7: App Quit (CRITICAL)
- [ ] Press Cmd+Q to quit
- [ ] **Expected**: App quits within 2-3 seconds
- [ ] **Expected**: No error dialogs
- [ ] Run this in terminal:
   ```bash
   ps aux | grep -E "(OpenScribe|node.*server)" | grep -v grep
   ```
- [ ] **Expected**: NO processes (output should be empty)

---

## 📊 What to Look For

### Good Signs ✅
```
# In Console.app:
[SessionStore] Created new session: abc-123. Total sessions: 1
[EventSource] Connecting to session: abc-123
[SessionStore] Subscriber added. Total listeners: 1
[Cleanup] Cleanup complete
```

### Bad Signs ❌ (Report if you see these)
```
# Rapid repeated connections:
GET /api/transcription/stream/abc-123 200 in 1000ms
GET /api/transcription/stream/abc-123 200 in 995ms
(repeating every second) <-- BAD!

# Multiple processes:
OpenScribe  72475
OpenScribe  72999  <-- BAD!

# Zombie processes after quit:
node  73000  server.js  <-- BAD!
```

---

## 🎯 Current Status Summary

| Test | Status | Details |
|------|--------|---------|
| Build | ✅ | 262 MB, signed, packaged |
| Single Instance | ✅ | Only 1 process running |
| Clean Startup | ✅ | No errors, responsive |
| Recording Workflow | ⏳ | **← TEST THIS NOW** |
| EventSource Stability | ⏳ | **← MONITOR THIS** |
| Window Management | ⏳ | Need to test |
| Clean Quit | ⏳ | **← TEST THIS LAST** |

---

## 🚨 If You See Problems

### Problem: Multiple EventSource connections
**Cause**: React callback instability (we fixed this, but verify)
**Check**: Console.app logs for rapid reconnections

### Problem: App won't quit
**Cause**: Cleanup hanging (we added 3s timeout)
**Action**: Wait 3 seconds max, should force quit

### Problem: Multiple windows
**Cause**: Single instance lock failing
**Check**: `ps aux | grep OpenScribe`

### Problem: Crash on recording
**Check**: Console.app for specific error
**Common**: Microphone permission not granted

---

## 📝 Test Notes

Record your observations here:

**Recording test**:
- 

**EventSource behavior**:
-

**Quit behavior**:
-

**Any errors**:
-

---

**Next Step**: Please test the recording workflow in the app and report back!

