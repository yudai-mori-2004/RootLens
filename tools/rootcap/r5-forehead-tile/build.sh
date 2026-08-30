#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
source_file="$model_dir/forehead_tile.scad"
stl_dir="$model_dir/stl"
review_dir="$model_dir/review"

mkdir -p "$stl_dir" "$review_dir"

openscad --hardwarnings --export-format binstl \
  -o "$stl_dir/forehead_tile_medium.stl" \
  -D 'part="tile"' \
  "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="tile"' --autocenter --viewall \
  --camera=0,0,0,68,0,35,80 \
  -o "$review_dir/tile-isometric.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="fit_preview"' --autocenter --viewall \
  --camera=0,0,0,90,0,180,85 \
  -o "$review_dir/fit-front.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="fit_preview"' --autocenter --viewall \
  --camera=0,0,0,90,0,90,85 \
  -o "$review_dir/fit-side.png" "$source_file"

printf 'Generated one forehead fit STL and three review images.\n'
