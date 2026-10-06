#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) target=macos-arm64 ;;
  Darwin:x86_64) target=macos-x64 ;;
  Linux:x86_64) target=linux-x64 ;;
  *) printf '%s\n' 'Unsupported platform.' >&2; exit 1 ;;
esac
binary="$base/updater/$target/asterveil-updater"
chmod u+x "$binary"
exec "$binary" --setup "$base/extension"
