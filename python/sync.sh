#!/usr/bin/env bash
# Stage the TUI sources into the python package data dir before building the wheel.
# The copy is gitignored (single source of truth stays at repo root).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
dest="$here/tktop_tui/tui"
rm -rf "$dest"
mkdir -p "$dest/src" "$dest/bin"
cp "$root"/src/*.ts "$dest/src/"
cp -r "$root"/src/adapters "$dest/src/adapters"
cp "$root/bin/tktop" "$dest/bin/tktop"
cp "$root/package.json" "$root/LICENSE" "$dest/"
echo "staged: $(find "$dest" -type f | wc -l) files -> $dest"
