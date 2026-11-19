#!/usr/bin/env bash
set -euo pipefail

target=$1
executable=$2
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_dir="$root/amalgamation/.source"
version=$(cat "$source_dir/.dolt_release_version")
jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)

mkdir -p "$root/amalgamation/cli-build" "$root/prebuilds/$target"
cd "$root/amalgamation/cli-build"
"$source_dir/configure"

if [[ "$executable" == *.exe ]]; then
  make -j"$jobs" DOLTLITE_VERSION="$version" "T.link=\$(T.cc.sqlite) -static" "$executable"
else
  make -j"$jobs" DOLTLITE_VERSION="$version" DOLTLITE_SINGLE_FILE=1 "$executable"
fi

cp "$executable" "$root/prebuilds/$target/$executable"
