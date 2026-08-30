#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
source_file="$model_dir/rootcap_r4.scad"
stl_dir="$model_dir/stl"
review_dir="$model_dir/review"

mkdir -p "$stl_dir" "$review_dir"

cover_file="$stl_dir/camera_cover.stl"
expected_cover_sha256="f2b25eb4f11ea1ea3c4f655e3d5451debdfa0c606378f5e249079fe0cbc3e67f"

if [[ ! -f "$cover_file" ]]; then
  printf 'The frozen camera_cover.stl is missing; refusing to replace it.\n' >&2
  exit 1
fi

actual_cover_sha256="$(shasum -a 256 "$cover_file" | awk '{print $1}')"
if [[ "$actual_cover_sha256" != "$expected_cover_sha256" ]]; then
  printf 'The frozen camera_cover.stl has changed; refusing to continue.\n' >&2
  exit 1
fi

for part_name in main_tray shell_arch; do
  openscad --hardwarnings --export-format binstl \
    -o "$stl_dir/$part_name.stl" \
    -D "part=\"$part_name\"" \
    "$source_file"
done

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="assembly"' --autocenter --viewall \
  --camera=0,0,70,60,0,135,440 \
  -o "$review_dir/assembly.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="assembly"' --autocenter --viewall \
  --camera=0,0,80,90,0,90,430 \
  -o "$review_dir/assembly-side.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="assembly"' -D 'camera_down_angle=55' \
  --autocenter --viewall --camera=0,0,80,90,0,90,430 \
  -o "$review_dir/assembly-down-55.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="joint_review"' --autocenter --viewall \
  --camera=0,0,75,72,0,110,300 \
  -o "$review_dir/pitch-joint.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="ratchet_review"' --autocenter --viewall \
  --camera=0,0,100,84,0,105,230 \
  -o "$review_dir/ratchet-5deg.png" "$source_file"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="shell_contact"' --autocenter --viewall \
  --camera=0,0,70,60,0,135,400 \
  -o "$review_dir/shell-contact.png" "$source_file"

openscad --hardwarnings \
  -D 'part="usb_c_profile"' \
  -o "$review_dir/usb-c-right.svg" "$source_file"
rsvg-convert -a -w 600 -h 1000 \
  -b '#f3f4f6' \
  -o "$review_dir/usb-c-right.png" \
  "$review_dir/usb-c-right.svg"

openscad --hardwarnings \
  -D 'part="camera_cover_profile"' \
  -o "$review_dir/camera-cover-wide.svg" "$source_file"
rsvg-convert -a -w 1200 -h 700 \
  -b '#f3f4f6' \
  -o "$review_dir/camera-cover-wide.png" \
  "$review_dir/camera-cover-wide.svg"

openscad --hardwarnings --projection=ortho \
  --imgsize=1800,1200 --colorscheme=Tomorrow \
  -D 'part="print_layout"' --autocenter --viewall \
  --camera=0,0,0,55,0,25,520 \
  -o "$review_dir/print-layout.png" "$source_file"

printf 'Preserved the frozen camera cover and generated two printable STL files plus nine review images.\n'
