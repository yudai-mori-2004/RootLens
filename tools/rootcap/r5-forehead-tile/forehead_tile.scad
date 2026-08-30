/*
 * RootCap R5 — one-piece black PLA forehead tile, first fit model
 *
 * This file intentionally contains only one solid part that touches the forehead.
 * The 45-degree MagSafe support will attach to the outer face after this fit
 * surface has been tested.
 *
 * Coordinate system:
 *   X = wearer's left/right
 *   Y = outward from the forehead (inner center surface is Y = 0)
 *   Z = up/down
 */

part = "tile"; // tile | fit_preview

// First adult-medium fit sample.  The horizontal local curvature radius is
// 95 mm.  The ellipsoid gives a gentler vertical local radius of about 130 mm.
forehead_radius_x = 95.0;
forehead_radius_y = 95.0;
forehead_radius_z = 111.0;

tile_width = 96.0;
tile_height = 44.0;
tile_thickness = 2.6;
corner_radius = 8.0;

$fn = 128;

module ellipsoid(radius_x, radius_y, radius_z) {
    scale([radius_x, radius_y, radius_z]) sphere(r = 1);
}

module y_cylinder(length, radius) {
    rotate([90, 0, 0]) cylinder(h = length, r = radius, center = true);
}

module rounded_patch_crop(width, height, radius) {
    // Only include the front band of the head ellipsoid.  The rounded X/Z
    // outline avoids pressure points at the four corners.
    hull()
        for (x = [-width / 2 + radius, width / 2 - radius],
             z = [-height / 2 + radius, height / 2 - radius])
            translate([x, -10, z]) y_cylinder(50, radius);
}

module forehead_fit_volume(clearance = 0) {
    // Public fit reference for later one-piece parts.  Subtracting this volume
    // lets a support grow around the R5 surface without entering head space.
    translate([0, -forehead_radius_y, 0])
        ellipsoid(forehead_radius_x + clearance,
                  forehead_radius_y + clearance,
                  forehead_radius_z + clearance);
}

function forehead_outer_y(x,
                          z,
                          inset = 0,
                          thickness = tile_thickness) =
    -forehead_radius_y
    + (forehead_radius_y + thickness)
      * sqrt(1
             - pow(x / (forehead_radius_x + thickness), 2)
             - pow(z / (forehead_radius_z + thickness), 2))
    - inset;

module forehead_shell(thickness = tile_thickness) {
    // Both ellipsoids share a center.  The inner front-center point lands at
    // Y=0 and the outer front-center point at Y=thickness.
    difference() {
        forehead_fit_volume(thickness);
        forehead_fit_volume();
    }
}

module forehead_tile(thickness = tile_thickness) {
    intersection() {
        forehead_shell(thickness);
        rounded_patch_crop(tile_width, tile_height, corner_radius);
    }
}

module head_fit_proxy() {
    color([0.72, 0.55, 0.42, 0.28])
        intersection() {
            translate([0, -forehead_radius_y, 0])
                ellipsoid(forehead_radius_x,
                          forehead_radius_y,
                          forehead_radius_z);
            translate([-70, -42, -36]) cube([140, 44, 72]);
        }
}

if (part == "tile") {
    color([0.14, 0.14, 0.16, 1.0]) forehead_tile();
} else if (part == "fit_preview") {
    head_fit_proxy();
    color([0.14, 0.14, 0.16, 1.0]) forehead_tile();
}
