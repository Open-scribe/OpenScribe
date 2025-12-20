# Real-Time Monitoring Guide

## 🔍 How to Monitor OpenScribe Stability

### Console.app Setup (OPENED FOR YOU)

1. **Filter Setup**:
   - In Console.app search bar, type: `OpenScribe OR SessionStore OR EventSource`
   - This will show all relevant logs

2. **What to Watch For**:

#### ✅ GOOD Logs (Expected):
```
[SessionStore] Created new session: <uuid>. Total sessions: 1
[EventSource] Connecting to session: <uuid>
[SessionStore] Subscriber added to session <uuid>. Total listeners: 1
[Cleanup] Closing EventSource connection
```

#### ❌ BAD Logs (Report if seen):
```
# This pattern repeating every second:
[EventSource] Connecting to session: <same-uuid>
[EventSource] Cleanup: closing connection
[EventSource] Connecting to session: <same-uuid>
[EventSource] Cleanup: closing connection
(RAPID LOOP - This is bad!)
```

### Network Monitoring (Optional)

If you want to see HTTP requests:
```bash
# In a terminal:
lsof -i -P | grep OpenScribe
```

Should show a port like `4123` or `4124` for the embedded Next.js server.

### Process Monitoring

Keep Activity Monitor open:
```bash
open -a "Activity Monitor"
```

Filter for "OpenScribe" - should see only ONE process.

---

## 🧪 Test Sequence

### 1. Start Recording (Now)
- Create a new encounter in the app
- Start recording
- **Watch Console.app for**:
  - Session creation
  - EventSource connection
  - Should be ONE connection, not many

### 2. Monitor During Recording
- Let it record for 30 seconds
- **Watch for**:
  - Segment uploads (should be periodic, not flooding)
  - No repeated EventSource reconnections
  - Memory should stay stable in Activity Monitor

### 3. Stop Recording
- Click stop
- **Watch for**:
  - Final transcription upload
  - Note generation
  - EventSource cleanup
  - Session completion

### 4. Test Quit (Last)
- Cmd+Q to quit
- **Watch for**:
  - Cleanup messages
  - Should quit in 2-3 seconds
  - Check Activity Monitor - should be GONE

---

## 📊 Success Indicators

### EventSource Health
- ✅ 1-2 connections per session (not 20+)
- ✅ Connections stay open during recording
- ✅ Clean cleanup on session end

### Process Health
- ✅ Always exactly 1 OpenScribe process
- ✅ Memory stable (not growing rapidly)
- ✅ No zombie processes after quit

### App Behavior
- ✅ Responsive UI
- ✅ Recording works end-to-end
- ✅ Transcription completes
- ✅ Note generation works

---

## 🚨 Red Flags

If you see these, report immediately:

1. **EventSource Storm**: Logs showing connection every second
2. **Memory Spike**: Memory usage doubling/tripling during short recording
3. **Hang**: App freezes or becomes unresponsive
4. **Quit Failure**: Takes more than 5 seconds to quit
5. **Zombie Process**: Process remains after quit

---

## Current Test: Recording Workflow

**Your turn!** 

Please:
1. ✅ Console.app is open and filtered
2. ✅ Activity Monitor open (optional but helpful)
3. ➡️ **In OpenScribe: Create a new encounter and start recording**
4. ➡️ **Watch Console.app during recording**
5. ➡️ **Report what you see!**

I'll wait for your feedback on how the recording goes.

