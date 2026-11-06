#!/bin/bash
set -e

echo "========================================"
echo "  Downstream v3.0.0 for Linux - Build Package"
echo "  Target: Ubuntu Linux 22.04 Jammy Jellyfish and newer"
echo "========================================"
echo

echo "[1/3] Cleaning previous build..."
rm -rf out
echo "Done."

echo
echo "[2/3] Installing dependencies..."
npm run setup

echo
echo "[3/3] Building package..."
npx electron-forge make --targets @electron-forge/maker-deb

echo
echo "========================================"
echo "  Build complete!"
echo "  Output: out/make/deb/x64/"
echo "  Install with: sudo apt install ./out/make/deb/x64/downstream_3.0.0_amd64.deb"
echo "========================================"
