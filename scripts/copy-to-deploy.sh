#!/bin/sh
# Copies the app sources from this repo into the folder you run `forge deploy` from (the one that holds your registered app id).
# It only copies; it never deletes. manifest.yml is NOT copied because the deploy folder's copy carries your app id.
# Usage: scripts/copy-to-deploy.sh ~/same-page/same-page-app
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)/same-page-app"
DEST="${1:?usage: copy-to-deploy.sh <deploy app folder>}"
cp "$SRC"/src/*.ts "$DEST"/src/
cp "$SRC"/src/frontend/* "$DEST"/src/frontend/
cp -R "$SRC"/src/core/. "$DEST"/src/core/
echo "copied sources to $DEST"
