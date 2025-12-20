#!/bin/bash
# Test script for Electron fixes
# Tests single instance lock, dynamic port finding, and process cleanup

echo "🧪 Testing Electron Fixes..."
echo ""

# Check if app is built
APP_PATH="build/dist/mac-arm64/OpenScribe.app"
if [ ! -d "$APP_PATH" ]; then
  echo "❌ App not built. Run: pnpm build:desktop"
  exit 1
fi

# Test 1: Single Instance Lock
echo "✅ Test 1: Single Instance Lock"
echo "   Opening app first time..."
open "$APP_PATH"
sleep 3
echo "   Opening app second time (should focus existing window)..."
open "$APP_PATH"
sleep 2

PROCESS_COUNT=$(ps aux | grep -i openscribe | grep -v grep | grep -v "test-electron" | wc -l | tr -d ' ')
if [ "$PROCESS_COUNT" -eq "1" ]; then
  echo "   ✓ Only 1 process running (PASS)"
else
  echo "   ✗ FAIL: Found $PROCESS_COUNT processes"
fi

# Close app
osascript -e 'quit app "OpenScribe"' 2>/dev/null
sleep 2

# Test 2: Dynamic Port Finding
echo ""
echo "✅ Test 2: Dynamic Port Finding"
echo "   Blocking port 4123..."
node -e "require('http').createServer().listen(4123, () => console.log('Port 4123 blocked'))" &
BLOCKER_PID=$!
sleep 1

echo "   Opening app (should use alternative port)..."
open "$APP_PATH"
sleep 4

PORT_USED=$(lsof -i -P | grep LISTEN | grep node | grep -v 4123 | wc -l | tr -d ' ')
if [ "$PORT_USED" -gt "0" ]; then
  echo "   ✓ App found alternative port (PASS)"
  lsof -i -P | grep LISTEN | grep node | head -2
else
  echo "   ⚠ Could not verify port fallback (check manually)"
fi

# Cleanup
kill $BLOCKER_PID 2>/dev/null
osascript -e 'quit app "OpenScribe"' 2>/dev/null
sleep 3

# Test 3: Process Cleanup
echo ""
echo "✅ Test 3: Process Cleanup"
echo "   Opening app..."
open "$APP_PATH"
sleep 3
echo "   Quitting app..."
osascript -e 'quit app "OpenScribe"' 2>/dev/null
sleep 3

ZOMBIE_COUNT=$(ps aux | grep "node.*server.js" | grep -v grep | wc -l | tr -d ' ')
if [ "$ZOMBIE_COUNT" -eq "0" ]; then
  echo "   ✓ No zombie Node processes (PASS)"
else
  echo "   ⚠ Warning: Found $ZOMBIE_COUNT node processes"
  ps aux | grep "node.*server.js" | grep -v grep
fi

echo ""
echo "🎉 Testing complete!"
echo ""
echo "Manual tests to perform:"
echo "1. Click dock icon while app is minimized (should restore)"
echo "2. Open app from Spotlight (⌘+Space) twice (should focus existing)"
echo "3. Force quit (⌘+Option+Esc) and check for zombie processes"
