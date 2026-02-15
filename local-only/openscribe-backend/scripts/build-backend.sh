#!/bin/bash
#
# Build OpenScribe Python backend as standalone executable
#
# This script bundles the Python backend using PyInstaller so that
# users don't need Python installed to run the app.
#
# Prerequisites:
#   - Python 3.9+ with pip
#   - Virtual environment activated (optional but recommended)
#
# Usage:
#   ./scripts/build-backend.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "==================================="
echo "  OpenScribe Backend Builder"
echo "==================================="
echo ""

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found"
    exit 1
fi

echo "Python version: $(python3 --version)"
echo ""

# Create or reuse local virtualenv to avoid system dependency conflicts
VENV_DIR="${PROJECT_ROOT}/.venv-backend"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment at ${VENV_DIR}..."
    python3 -m venv "$VENV_DIR"
fi

source "${VENV_DIR}/bin/activate"

# Upgrade pip tooling
python -m pip install --upgrade pip setuptools wheel

# Install PyInstaller if not present
if ! python -c "import PyInstaller" 2>/dev/null; then
    echo "Installing PyInstaller..."
    python -m pip install pyinstaller
    echo ""
fi

# Install project dependencies
echo "Installing project dependencies..."
python -m pip install -r requirements.txt
python -m pip install -e .
echo ""

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build/ dist/
echo ""

# Run PyInstaller
echo "Building standalone executable..."
echo "This may take several minutes..."
echo ""

python -m PyInstaller openscribe-backend.spec --noconfirm

# Check if build succeeded
if [ -d "dist/openscribe-backend" ]; then
    echo ""
    echo "==================================="
    echo "  Build Successful!"
    echo "==================================="
    echo ""
    echo "Bundled executable is at: dist/openscribe-backend/"
    echo ""

    # Show size
    SIZE=$(du -sh dist/openscribe-backend | cut -f1)
    echo "Bundle size: $SIZE"
    echo ""

    # Test the executable
    echo "Testing executable..."
    if ./dist/openscribe-backend/openscribe-backend --help > /dev/null 2>&1; then
        echo "Executable test: PASSED"
    else
        echo "Executable test: WARNING - may need additional testing"
    fi
    echo ""
    echo "To use with Electron app, update main.js to use:"
    echo "  path.join(__dirname, '..', 'dist', 'openscribe-backend', 'openscribe-backend')"
else
    echo ""
    echo "Build FAILED!"
    echo "Check the output above for errors."
    exit 1
fi
