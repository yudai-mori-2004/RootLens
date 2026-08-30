#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
source_file="$model_dir/rootcap_r3.scad"
stl_dir="$model_dir/stl"
review_dir="$model_dir/review"

mkdir -p "$stl_dir" "$review_dir"

parts=(
  crown_saddle
  inner_backer_left
  inner_backer_right
  pitch_yoke
  phone_pocket
)

for part_name in "${parts[@]}"; do
  openscad --hardwarnings --export-format binstl \
    -o "$stl_dir/$part_name.stl" \
    -D "part=\"$part_name\"" \
    "$source_file"
done

openscad --hardwarnings --export-format binstl \
  -o "$review_dir/reference_shell.stl" \
  -D 'part="reference_shell"' \
  "$source_file"

common_png_args=(
  --hardwarnings
  --preview=throwntogether
  --projection=ortho
  --imgsize=1800,1300
  --colorscheme=Tomorrow
  -D 'part="assembly"'
  --autocenter
  --viewall
)

openscad "${common_png_args[@]}" \
  --camera=0,0,80,60,0,135,500 \
  -o "$review_dir/assembly-isometric.png" "$source_file"

openscad "${common_png_args[@]}" \
  --camera=0,0,80,90,0,90,450 \
  -o "$review_dir/assembly-side.png" "$source_file"

openscad "${common_png_args[@]}" \
  --camera=0,0,80,90,0,180,450 \
  -o "$review_dir/assembly-front.png" "$source_file"

openscad --hardwarnings --preview=throwntogether --projection=ortho \
  --imgsize=1800,1300 --colorscheme=Tomorrow \
  -D 'part="contact_review"' --autocenter --viewall \
  --camera=0,0,70,60,0,135,420 \
  -o "$review_dir/shell-contact.png" "$source_file"

openscad --hardwarnings --render --projection=ortho \
  --imgsize=1800,1300 --colorscheme=Tomorrow \
  -D 'part="pocket_review"' --autocenter --viewall \
  --camera=0,0,0,72,0,145,430 \
  -o "$review_dir/pocket-open-top.png" "$source_file"

printf 'Generated %s printable STL files and five review images.\n' \
  "${#parts[@]}"
