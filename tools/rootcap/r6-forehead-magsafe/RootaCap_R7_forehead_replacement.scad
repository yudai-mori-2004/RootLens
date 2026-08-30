/*
 * RootaCap R7 — deterministic forehead-surface replacement geometry.
 *
 * `part = "removal_mask"` removes the previous forehead tile and every solid
 * toward the wearer's forehead.  `part = "replacement"` regenerates the only
 * remaining contact surface from the R5 ellipsoid: 2 mm nominal thickness,
 * square lower corners, and the established 8 mm upper corner radius.
 * `part = "counterbore_cutters"` creates the three shallow M4-head recess
 * cutters that are subtracted only after the replacement has joined the body.
 */

use <../r5-forehead-tile/forehead_tile.scad>

part = "replacement"; // replacement | removal_mask | counterbore_cutters

tile_width = 96.0;
tile_bottom_z = -22.032694;
tile_top_z = 22.0;
upper_corner_radius = 8.0;
inner_fit_clearance = 0.10;
replacement_outer_clearance = 2.10;
removal_outer_clearance = 2.01;
arc_steps = 32;
mount_hole_diameter = 4.5;
mount_hole_z = 14.0;
mount_hole_x_positions = [-38.0, 0.0, 38.0];
counterbore_diameter = 8.4;
counterbore_depth = 1.0;
counterbore_epsilon = 0.05;

$fn = 192;

function replacement_crop_points() =
    concat(
        [[-tile_width / 2, tile_bottom_z],
         [ tile_width / 2, tile_bottom_z]],
        [for (step = [0 : arc_steps])
            let(angle = 90 * step / arc_steps)
                [tile_width / 2 - upper_corner_radius
                 + upper_corner_radius * cos(angle),
                 tile_top_z - upper_corner_radius
                 + upper_corner_radius * sin(angle)]],
        [for (step = [0 : arc_steps])
            let(angle = 90 + 90 * step / arc_steps)
                [-tile_width / 2 + upper_corner_radius
                 + upper_corner_radius * cos(angle),
                 tile_top_z - upper_corner_radius
                 + upper_corner_radius * sin(angle)]]
    );

module replacement_crop() {
    rotate([90, 0, 0])
        linear_extrude(height = 300, center = true, convexity = 10)
            polygon(points = replacement_crop_points());
}

module replacement_forehead_surface() {
    difference() {
        intersection() {
            difference() {
                forehead_fit_volume(replacement_outer_clearance);
                forehead_fit_volume(inner_fit_clearance);
            }
            replacement_crop();
        }

        for (x = mount_hole_x_positions)
            translate([x, -5, mount_hole_z])
                y_cylinder(40, mount_hole_diameter / 2);

        // Keep the standalone replacement operand complete for inspection.
        // The same cutters are applied again after the body union so any
        // overlapping support material is removed from the final recesses.
        counterbore_cutters();
    }
}

module counterbore_cutters() {
    // Remove only the head-facing 1.0 mm ellipsoidal layer.  The recess opens
    // on the inner face and leaves the outer face intact.  Its bottom follows
    // the forehead ellipsoid so the requested depth remains constant at the
    // sloped side holes.  Applying these cutters after the body union also
    // prevents underlying support material from filling the recesses or
    // creating enclosed annular tunnels.
    for (x = mount_hole_x_positions)
        intersection() {
            translate([x, -5, mount_hole_z])
                y_cylinder(40, counterbore_diameter / 2);

            difference() {
                forehead_fit_volume(
                    inner_fit_clearance + counterbore_depth);
                forehead_fit_volume(
                    inner_fit_clearance - counterbore_epsilon);
            }
        }
}

module old_forehead_removal_mask() {
    // This solid includes the old contact tile and all material on the
    // forehead side of its outer surface.  The replacement extends 0.01 mm
    // farther outward so the final union has a deterministic overlap.
    forehead_fit_volume(removal_outer_clearance);
}

if (part == "replacement") {
    replacement_forehead_surface();
} else if (part == "removal_mask") {
    old_forehead_removal_mask();
} else if (part == "counterbore_cutters") {
    counterbore_cutters();
} else {
    assert(false,
           "part must be replacement, removal_mask, or counterbore_cutters");
}
