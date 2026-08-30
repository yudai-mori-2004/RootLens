#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
source_file="$model_dir/forehead_magsafe_mount.scad"
stl_dir="$model_dir/stl"
openscad_bin="${OPENSCAD_BIN:-openscad}"

mkdir -p "$stl_dir"

"$openscad_bin" --hardwarnings --export-format binstl \
  -o "$stl_dir/forehead_magsafe_mount.stl" \
  "$source_file"

printf 'Generated forehead_magsafe_mount.stl\n'
