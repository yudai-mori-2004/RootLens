/*
 * RootCap R6 — forehead tile with a fixed 45-degree MagSafe plate
 *
 * Reuses the R5 forehead-contact surface unchanged.  In a center sagittal
 * section, the forehead tile and support plate form a katakana "レ" profile.
 *
 * Coordinate system:
 *   X = wearer's left/right
 *   Y = forward/outward from the forehead
 *   Z = up/down (the support plate rises forward at 45 degrees)
 */

use <../r5-forehead-tile/forehead_tile.scad>

plate_width = 70.0;
plate_length = 81.0;
plate_thickness = 6.0;
target_installed_angle = 45.0;
wear_upward_bias = 10.0;
plate_angle = target_installed_angle - wear_upward_bias;
plate_corner_radius = 6.0;

forehead_contact_thickness =
    is_undef(forehead_contact_thickness)
    ? 2.6
    : forehead_contact_thickness;

recess_diameter = 58.0;
recess_depth = 4.0;
recess_near_margin = 17.0;
recess_center_y = recess_near_margin + recess_diameter / 2;

mount_hole_diameter = 4.5;
mount_hole_x = 38.0;
mount_hole_top_z = 14.0;
mount_hole_bottom_z = -14.0;
mount_hole_three_row_enabled =
    is_undef(mount_hole_three_row_enabled)
    ? true
    : mount_hole_three_row_enabled;
mount_hole_two_row_enabled =
    is_undef(mount_hole_two_row_enabled)
    ? true
    : mount_hole_two_row_enabled;

root_y = -2.0;
root_z = -18.0;

// One continuous loft replaces the sharp line where the two original solids
// met.  Its upper skin is tangent to both the forehead and phone plate.  Its
// lower skin includes a true horizontal face instead of balancing on an edge.
blend_width = 69.0;
blend_join_y = 14.0;
blend_join_embed = 0.35;
blend_tile_upper_z = -14.0;
blend_tile_lower_z = -20.0;
blend_bottom_z = -22.0;
blend_bottom_front_y = 5.0;
blend_surface_overlap = 0.30;
blend_x_steps =
    is_undef(blend_x_steps)
    ? 48
    : blend_x_steps;
blend_curve_steps =
    is_undef(blend_curve_steps)
    ? 20
    : blend_curve_steps;
plate_near_y = blend_join_y - 2.0;

epsilon = 0.05;
$fn = 128;

assert(plate_width >= recess_diameter,
       "plate_width must be at least recess_diameter");
assert(plate_thickness > recess_depth,
       "recess must leave material behind it");
assert(recess_center_y < plate_length,
       "recess center must remain on the plate");

module rounded_plate_footprint_2d(width, near_y, far_y, radius) {
    hull()
        for (x = [-width / 2 + radius, width / 2 - radius],
             y = [near_y + radius, far_y - radius])
            translate([x, y]) circle(r = radius);
}

module recessed_plate_local() {
    difference() {
        translate([0, 0, -plate_thickness])
            linear_extrude(height = plate_thickness)
                rounded_plate_footprint_2d(plate_width,
                                           plate_near_y,
                                           plate_length,
                                           plate_corner_radius);

        // Opens on the inside face of the レ profile.  Its near edge starts
        // 17 mm from the forehead.  The far portion projects beyond the short
        // plate and is intentionally clipped at the plate edge.
        translate([0, recess_center_y, -recess_depth - epsilon])
            cylinder(d = recess_diameter,
                     h = recess_depth + 2 * epsilon);
    }
}

module support_plate() {
    translate([0, root_y, root_z])
        rotate([plate_angle, 0, 0])
            recessed_plate_local();
}

module forehead_tile_with_mount_holes() {
    difference() {
        forehead_tile(forehead_contact_thickness);

        if (mount_hole_two_row_enabled)
            for (x = [-mount_hole_x, mount_hole_x])
                translate([x, -5, mount_hole_bottom_z])
                    y_cylinder(30, mount_hole_diameter / 2);

        if (mount_hole_three_row_enabled)
            for (x = [-mount_hole_x, 0, mount_hole_x])
                translate([x, -5, mount_hole_top_z])
                    y_cylinder(30, mount_hole_diameter / 2);
    }
}

function plate_global(y, z) = [
    root_y + y * cos(plate_angle) - z * sin(plate_angle),
    root_z + y * sin(plate_angle) + z * cos(plate_angle)
];

function bezier_2d(p0, p1, p2, p3, t) =
    p0 * pow(1 - t, 3)
    + p1 * (3 * pow(1 - t, 2) * t)
    + p2 * (3 * (1 - t) * pow(t, 2))
    + p3 * pow(t, 3);

function blend_profile(x) =
    let(
        upper = [forehead_outer_y(x,
                                  blend_tile_upper_z,
                                  blend_surface_overlap,
                                  forehead_contact_thickness),
                 blend_tile_upper_z],
        lower = [forehead_outer_y(x,
                                  blend_tile_lower_z,
                                  blend_surface_overlap,
                                  forehead_contact_thickness),
                 blend_tile_lower_z],
        // End the loft just inside the original plate.  The near-tangent
        // overlap removes a geometric seam without adding a visible rib.
        plate_inner = plate_global(blend_join_y, -blend_join_embed),
        plate_outer = plate_global(blend_join_y,
                                   -plate_thickness + blend_join_embed),
        direction = [cos(plate_angle), sin(plate_angle)],
        bottom_back = [lower[0] + 1.5, blend_bottom_z],
        bottom_front = [blend_bottom_front_y, blend_bottom_z],
        upper_c1 = upper + [0, 3.0],
        upper_c2 = plate_inner - direction * 3.0,
        lower_c1 = lower + [0, -2.0],
        lower_c2 = bottom_back + [-1.5, 0],
        rise_c1 = bottom_front + [3.0, 0],
        rise_c2 = plate_outer - direction * 3.0
    )
    concat(
        [for (i = [0 : blend_curve_steps])
            bezier_2d(upper,
                      upper_c1,
                      upper_c2,
                      plate_inner,
                      i / blend_curve_steps)],
        [plate_outer],
        [for (i = [blend_curve_steps - 1 : -1 : 0])
            bezier_2d(bottom_front,
                      rise_c1,
                      rise_c2,
                      plate_outer,
                      i / blend_curve_steps)],
        [bottom_back],
        [for (i = [blend_curve_steps - 1 : -1 : 0])
            bezier_2d(lower,
                      lower_c1,
                      lower_c2,
                      bottom_back,
                      i / blend_curve_steps)]
    );

profile_size = len(blend_profile(0));

function blend_vertex_index(x_index, profile_index) =
    x_index * profile_size + profile_index;

module smooth_joint() {
    skin_points = [
        for (xi = [0 : blend_x_steps])
            let(x = -blend_width / 2
                    + blend_width * xi / blend_x_steps)
                for (p = blend_profile(x)) [x, p[0], p[1]]
    ];

    left_center_index = len(skin_points);
    right_center_index = left_center_index + 1;
    points = concat(skin_points,
                    [[-blend_width / 2, 2.0, -16.0],
                     [ blend_width / 2, 2.0, -16.0]]);

    side_faces_a = [
        for (xi = [0 : blend_x_steps - 1],
             pi = [0 : profile_size - 1])
            [blend_vertex_index(xi, pi),
             blend_vertex_index(xi + 1, pi),
             blend_vertex_index(xi + 1, (pi + 1) % profile_size)]
    ];

    side_faces_b = [
        for (xi = [0 : blend_x_steps - 1],
             pi = [0 : profile_size - 1])
            [blend_vertex_index(xi, pi),
             blend_vertex_index(xi + 1, (pi + 1) % profile_size),
             blend_vertex_index(xi, (pi + 1) % profile_size)]
    ];

    left_cap_faces = [
        for (pi = [0 : profile_size - 1])
            [left_center_index,
             pi,
             (pi + 1) % profile_size]
    ];

    right_cap_faces = [
        for (pi = [0 : profile_size - 1])
            [right_center_index,
             blend_vertex_index(blend_x_steps,
                                (pi + 1) % profile_size),
             blend_vertex_index(blend_x_steps, pi)]
    ];

    polyhedron(points = points,
               faces = concat(side_faces_a,
                              side_faces_b,
                              left_cap_faces,
                              right_cap_faces),
               convexity = 10);
}

module forehead_magsafe_mount() {
    union() {
        forehead_tile_with_mount_holes();
        support_plate();
        smooth_joint();
    }
}

forehead_magsafe_mount();
