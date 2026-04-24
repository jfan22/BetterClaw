#!/usr/bin/env bash
# Sync the root LICENSE + NOTICE into each publishable package. Run before
# `pnpm publish`. npm auto-includes these files in the tarball regardless of
# the `files` manifest, but only if they exist inside the package directory.
#
# We use copies (not symlinks) because `npm pack` doesn't follow symlinks out
# of the package boundary. The tradeoff is that LICENSE/NOTICE can drift if
# someone edits the root but forgets to re-run this. CI's publish dry-run
# catches drift by diffing against the root.
set -eu

cd "$(git rev-parse --show-toplevel)"

PUBLISHABLE_PACKAGES=(
  "packages/cli"
  "packages/plugin-openclaw"
)

for pkg in "${PUBLISHABLE_PACKAGES[@]}"; do
  cp LICENSE "$pkg/LICENSE"
  cp NOTICE "$pkg/NOTICE"
  echo "synced LICENSE + NOTICE into $pkg/"
done

echo ""
echo "Reminder: commit the changes if LICENSE or NOTICE was updated at the root."
