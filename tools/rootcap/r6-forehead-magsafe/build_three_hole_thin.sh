#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
source_file="$model_dir/forehead_magsafe_mount.scad"
stl_dir="$model_dir/stl"
output_file="$stl_dir/forehead_magsafe_mount_three_hole_thin.stl"
openscad_bin="${OPENSCAD_BIN:-openscad}"

mkdir -p "$stl_dir"

"$openscad_bin" --hardwarnings --export-format binstl \
  -D 'forehead_contact_thickness=2.0' \
  -D 'mount_hole_two_row_enabled=false' \
  -D '$fn=192' \
  -D 'blend_x_steps=64' \
  -D 'blend_curve_steps=28' \
  -o "$output_file" \
  "$source_file"

printf 'Generated %s\n' "$output_file"
