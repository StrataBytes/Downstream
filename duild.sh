#!/bin/bash
set -e

echo "========================================"
echo "  Downstream v2.2.8 - Build Installer"
echo "========================================"
echo

echo "[1/3] Cleaning previous build..."
rm -rf out
echo "Done."

echo
echo "[2/3] Installing dependencies..."
npm run setup

echo
echo "[3/3] Building installer..."
npm run make

echo
if [ "$(uname)" = "Darwin" ]; then
  echo "========================================"
  echo "  Build complete!"
  echo "  Output: out/make/"
  echo "  (DMG in out/make/)"
  echo "========================================"
else
  echo "========================================"
  echo "  Build complete!"
  echo "  Output: out/make/squirrel.windows/x64"
  echo "========================================"
fi
