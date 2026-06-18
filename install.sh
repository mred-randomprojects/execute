#!/usr/bin/env bash
#
# install.sh — build Execute and install it into /Applications.
#
# Usage:
#   ./install.sh              # build → install → clear the quarantine flag
#   ./install.sh --open       # ...and launch it afterwards
#   ./install.sh --uninstall  # remove it from /Applications
#
# Install somewhere else with:  INSTALL_DIR=/some/dir ./install.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

APP_NAME="Execute"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
DEST="${INSTALL_DIR}/${APP_NAME}.app"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

quit_running() { osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true; }

# --- uninstall ---------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  bold "Uninstalling ${APP_NAME}"
  quit_running
  if [[ -d "$DEST" ]]; then
    rm -rf "$DEST"
    ok "removed $DEST"
  else
    warn "not installed at $DEST"
  fi
  warn "Data at ~/Library/Application Support/${APP_NAME} was left untouched."
  exit 0
fi

OPEN_AFTER=false
[[ "${1:-}" == "--open" ]] && OPEN_AFTER=true

# --- prerequisites -----------------------------------------------------------
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed — see https://pnpm.io"

bold "Installing ${APP_NAME}"

if [[ ! -d node_modules ]]; then
  echo "  installing dependencies…"
  pnpm install
  ok "dependencies installed"
fi

# --- build (icons + renderer + .app, no dmg needed for a local install) ------
echo "  building the app (icons + renderer + package)…"
pnpm package
ok "built"

APP_SRC="$(find out -maxdepth 2 -name "${APP_NAME}.app" -type d 2>/dev/null | head -n 1)"
[[ -n "$APP_SRC" ]] || die "could not find a built ${APP_NAME}.app under out/"

# --- install -----------------------------------------------------------------
quit_running
mkdir -p "$INSTALL_DIR"
rm -rf "$DEST"
ditto "$APP_SRC" "$DEST"
ok "installed to $DEST"

# Unsigned app: clear the quarantine attribute so Gatekeeper lets it open.
xattr -cr "$DEST" 2>/dev/null || true
ok "cleared the quarantine flag"

echo ""
bold "Done."
if $OPEN_AFTER; then
  open "$DEST"
  ok "launched ${APP_NAME}"
else
  echo "  Launch from Applications, or run:  open -a ${APP_NAME}"
fi
