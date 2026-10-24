#!/bin/bash
set -e

echo "========================================"
echo "  Downstream v2.4.1 for Legacy macOS - Build Installer"
echo "  macOS 10.13 High Sierra and 10.14 Mojave"
echo "========================================"
echo

# electron 26 is the last to run on macos 10.13 and 10.14.
# it's only installed for this build, and the project's own electron comes back afterwards.
LEGACY_ELECTRON=26.6.10

restore() {
  echo
  echo "Restoring the project's Electron..."
  npm install --ignore-scripts > /dev/null
  node scripts/postinstall.js > /dev/null
  echo "Done."
}

echo "[1/4] Cleaning previous build..."
rm -rf out-legacy
echo "Done."

echo
echo "[2/4] Installing dependencies with Electron $LEGACY_ELECTRON..."
npm run setup
trap restore EXIT
npm install --no-save --ignore-scripts "electron@$LEGACY_ELECTRON"
node scripts/postinstall.js

echo
echo "[3/4] Preparing the legacy downloader..."
node scripts/prepareLegacy.js

echo
echo "[4/4] Building installer..."
DOWNSTREAM_LEGACY=1 npx electron-forge make --arch=x64

echo
echo "========================================"
echo "  Build complete!"
echo "  Output: out-legacy/make/"
echo "  (Downstream for Legacy macOS.dmg in out-legacy/make/)"
echo "========================================"
