#!/bin/bash
# Complete rebuild script for OpenScribe Electron app
# This script cleans all build artifacts and creates a fresh production build

set -e  # Exit on error

echo "🧹 OpenScribe - Complete Rebuild & Test Script"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Clean all build artifacts
echo -e "${YELLOW}Step 1: Cleaning all build artifacts...${NC}"
echo ""

# Kill any running processes
echo "Stopping any running OpenScribe processes..."
pkill -f "OpenScribe" || true
pkill -f "electron.*main.js" || true
pkill -f "next dev.*3001" || true
sleep 2

# Remove build directories
echo "Removing build directories..."
rm -rf build/
rm -rf apps/web/.next/
rm -rf .next/
rm -rf node_modules/.cache/
rm -rf tsconfig.tsbuildinfo

# Clean package caches
echo "Cleaning package caches..."
pnpm store prune || true

echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

# Step 2: Reinstall dependencies
echo -e "${YELLOW}Step 2: Reinstalling dependencies...${NC}"
pnpm install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 3: Build the application
echo -e "${YELLOW}Step 3: Building desktop application...${NC}"
echo "This will take a few minutes..."
echo ""

pnpm build:desktop

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✓ Build completed successfully!${NC}"
  echo ""
else
  echo ""
  echo -e "${RED}✗ Build failed!${NC}"
  echo "Check the error messages above for details."
  exit 1
fi

# Step 4: Verify build output
echo -e "${YELLOW}Step 4: Verifying build output...${NC}"
echo ""

APP_PATH="build/dist/mac-arm64/OpenScribe.app"
if [ ! -d "$APP_PATH" ]; then
  APP_PATH="build/dist/mac/OpenScribe.app"
fi

if [ -d "$APP_PATH" ]; then
  echo -e "${GREEN}✓ Application bundle found at: $APP_PATH${NC}"
  
  # Get app size
  APP_SIZE=$(du -sh "$APP_PATH" | cut -f1)
  echo "  App size: $APP_SIZE"
  
  # Check for required files
  if [ -f "$APP_PATH/Contents/MacOS/OpenScribe" ]; then
    echo -e "${GREEN}✓ Executable found${NC}"
  else
    echo -e "${RED}✗ Executable not found!${NC}"
  fi
  
  if [ -d "$APP_PATH/Contents/Resources" ]; then
    echo -e "${GREEN}✓ Resources directory found${NC}"
  else
    echo -e "${RED}✗ Resources directory not found!${NC}"
  fi
  
else
  echo -e "${RED}✗ Application bundle not found!${NC}"
  echo "Expected at: $APP_PATH"
  exit 1
fi

echo ""
echo -e "${GREEN}=============================================="
echo "✓ Build verification complete!"
echo "==============================================\n"

# Step 5: Automated tests
echo -e "${YELLOW}Step 5: Running automated tests...${NC}"
echo ""

echo "Test 1: Single Instance Lock"
echo "----------------------------"
echo "Opening app..."
open "$APP_PATH"
sleep 4

PROCESS_COUNT=$(ps aux | grep -i "OpenScribe.app" | grep -v grep | wc -l | tr -d ' ')
echo "Process count: $PROCESS_COUNT"

echo ""
echo "Attempting to open second instance..."
open "$APP_PATH"
sleep 2

NEW_PROCESS_COUNT=$(ps aux | grep -i "OpenScribe.app" | grep -v grep | wc -l | tr -d ' ')
echo "Process count after second launch: $NEW_PROCESS_COUNT"

if [ "$PROCESS_COUNT" -eq "$NEW_PROCESS_COUNT" ]; then
  echo -e "${GREEN}✓ Single instance lock working - only one process running${NC}"
else
  echo -e "${RED}✗ Multiple instances detected!${NC}"
fi

sleep 2

echo ""
echo "Test 2: Clean Shutdown"
echo "----------------------"
echo "Closing app..."
osascript -e 'quit app "OpenScribe"' 2>/dev/null
sleep 3

# Check for zombie processes
ZOMBIE_COUNT=$(ps aux | grep -E "(node.*server.js|electron.*main.js)" | grep -v grep | wc -l | tr -d ' ')
if [ "$ZOMBIE_COUNT" -eq "0" ]; then
  echo -e "${GREEN}✓ Clean shutdown - no zombie processes${NC}"
else
  echo -e "${RED}✗ Found $ZOMBIE_COUNT zombie process(es)${NC}"
  ps aux | grep -E "(node.*server.js|electron.*main.js)" | grep -v grep
fi

echo ""
echo -e "${GREEN}=============================================="
echo "Automated tests complete!"
echo "==============================================\n"

# Manual test instructions
echo -e "${YELLOW}Manual Tests Required:${NC}"
echo ""
echo "1. Launch the app and verify it opens without errors"
echo "   $ open \"$APP_PATH\""
echo ""
echo "2. Test recording workflow:"
echo "   - Create a new encounter"
echo "   - Start recording"
echo "   - Verify microphone access"
echo "   - Stop recording"
echo "   - Verify transcription completes"
echo "   - Verify note generation works"
echo ""
echo "3. Test window management:"
echo "   - Minimize window and click dock icon (should restore)"
echo "   - Hide window (Cmd+H) and click dock icon (should show)"
echo "   - Try opening app again from Finder (should focus existing window)"
echo ""
echo "4. Test app quit:"
echo "   - Quit app (Cmd+Q)"
echo "   - Verify no error dialogs"
echo "   - Run: ps aux | grep -i openscribe"
echo "   - Should see no processes"
echo ""
echo "5. Test permissions:"
echo "   - Check System Preferences > Security & Privacy > Microphone"
echo "   - Check System Preferences > Security & Privacy > Screen Recording"
echo ""
echo -e "${GREEN}=============================================="
echo "Rebuild & Test Complete!"
echo "==============================================\n"
echo ""
echo "To launch the app:"
echo "  open \"$APP_PATH\""
echo ""
echo "To see logs:"
echo "  Console.app > Filter: OpenScribe"
echo ""

