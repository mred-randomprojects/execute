#!/usr/bin/env bash
# Run the Firebase CLI for this repo, at one exact version.
#
# It runs with your Firebase/Google login, which reaches every Firebase project
# of this account, so it is pinned: a floating `@15` would fetch and run
# whatever 15.x npm serves that day. Bump FIREBASE_TOOLS on purpose, to a
# release that has been out for a while.
#
# firebase-tools needs Node >= 20, and a login shell may still resolve an older
# Node (the repo pins 22 in .nvmrc, but nothing switches to it by itself). So
# use the current Node when it's new enough, else the newest one nvm has
# installed.
set -euo pipefail

node_major() { "$1" -p 'process.versions.node.split(".")[0]'; }

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || "$(node_major "$NODE_BIN")" -lt 20 ]]; then
  NEWEST="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v2[0-9]* 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$NEWEST" ]]; then
    echo "firebase-tools needs Node >= 20 (have $(node --version 2>/dev/null || echo none)). Install one, e.g. 'nvm install 22'." >&2
    exit 1
  fi
  export PATH="$NEWEST/bin:$PATH"
fi

FIREBASE_TOOLS="firebase-tools@15.33.0"

exec npx -y "$FIREBASE_TOOLS" "$@"
