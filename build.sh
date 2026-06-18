#!/usr/bin/env bash
set -euo pipefail

echo "Building Execute .dmg installer..."
echo ""

pnpm make

DMG_DIR="out/make"
DMG_FILE="$(find "${DMG_DIR}" -maxdepth 2 -name "*.dmg" -type f 2>/dev/null | head -n 1)"

if [[ -z "${DMG_FILE}" ]]; then
    echo ""
    echo "ERROR: No .dmg file found in ${DMG_DIR}"
    exit 1
fi

DMG_SIZE="$(du -h "${DMG_FILE}" | cut -f1)"

echo ""
echo "================================================"
echo "  Build successful!"
echo "================================================"
echo ""
echo "  Installer:  ${DMG_FILE}"
echo "  Size:       ${DMG_SIZE}"
echo ""
echo "  To install:"
echo ""
echo "  1. Open the .dmg file above"
echo "  2. Drag Execute into the Applications folder"
echo "  3. If macOS blocks the unsigned app, run:"
echo "     xattr -cr /Applications/Execute.app"
echo "  4. Open Execute from Applications"
echo ""
