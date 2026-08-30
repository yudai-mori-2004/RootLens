/*
 * RootCap R4 — landscape phone pocket with an adjustable shell arch
 *
 * The phone pocket keeps the two plates drawn in IMG_0270:
 *   1. a camera-side cover with only the camera-band aperture
 *   2. a solid screen-side tray with a U-shaped wall
 *
 * The camera cover is a broad retention plate with one camera-side window,
 * hash-locked after each deliberate revision.  The tray carries the moving
 * half of a compact friction hinge.  A separate arch follows the shell; its
 * two low ears are the fixed half of that hinge.
 *
 * X: landscape width, Y: pocket depth, Z: height
 */

part = "assembly";

// The previous holder used a 149.6 x 71.5 x 8.3 mm phone envelope.
// These are pocket clear dimensions only; no phone model is generated.
inside_width = 151.0;
inside_height = 73.0;
inside_depth = 10.2;

side_wall = 4.0;
bottom_wall = 4.0;
top_margin = 4.0;
front_thickness = 2.4;
rear_thickness = 2.4;
outer_radius = 9.0;
inner_radius = 4.0;
camera_cutout_width = 60.0;
camera_cutout_height = 69.0;
camera_cutout_radius = 8.0;
camera_cutout_right_margin = 6.0;
camera_cutout_top_margin = 6.0;

// Four hidden round pins align the cover without touching the outer contour.
// The fit is intentionally loose enough for an ordinary FDM printer;
// adhesive provides the final retention after the first fit check.
alignment_pin_diameter = 2.4;
alignment_hole_diameter = 2.8;
alignment_pin_depth = 1.2;
alignment_hole_depth = 1.5;
alignment_pin_z = [22, 58];

// A closed, vertically elongated hexagonal hole in the wearer's right side
// (-X in model coordinates) keeps the USB-C port reachable.  Both ends grow
// or close at 45 degrees in the tray's print orientation, so every deposited
// edge is supported by the preceding layer.  The tall straight section covers
// port-height variation, while 2 mm bridges close both depth-wise sides.
usb_c_opening_bottom_z = 26.0;
usb_c_opening_top_z = 55.75;
usb_c_side_bridge = 2.0;
usb_c_opening_y_min = front_thickness + usb_c_side_bridge;
usb_c_opening_y_max = front_thickness + inside_depth
                      + rear_thickness - usb_c_side_bridge;

// ---------- Tray / arch pitch joint ----------

// The phone rotates around X, so changing pitch changes the camera's
// forward/down angle without rotating the landscape image.
joint_blade_width = 28.0;
joint_side_clearance = 0.45;
joint_ear_thickness = 5.5;
joint_pivot_diameter = 5.6;       // M5 clearance
joint_pivot_outer_diameter = 30.0;
joint_pivot_y = 36.0;
joint_pivot_z = 14.0;
camera_down_angle = 45;
joint_contact_relief = 0.2;

// One coarse printed ridge set engages a 5-degree groove ring.  Only the
// lower fork face is indexed; the opposite ear remains flat and supplies the
// clamping reaction from the M5 bolt.
ratchet_ridge_step = 20;
ratchet_groove_step = 5;
ratchet_inner_radius = 10.2;
ratchet_outer_radius = 13.5;
ratchet_ridge_width = 0.60;
ratchet_groove_width = 0.75;
ratchet_ridge_height = 0.70;
ratchet_groove_depth = 0.90;
ratchet_groove_opening = 0.12;
ratchet_groove_radial_margin = 0.25;

// ---------- Provisional shell-contact arch ----------

// These radii are photo-derived starting values.  They only affect the arch;
// the phone pocket and the printed cover stay dimensionally frozen.
shell_radius_x = 90.0;
shell_radius_y = 104.0;
shell_radius_z = 102.0;
shell_contact_gap = 0.4;
arch_thickness = 4.8;
arch_half_width = 36.0;
arch_y_min = -58.0;
arch_y_max = 20.0;
arch_pivot_y = -72.0;
arch_pivot_z = 105.0;
shell_mount_x = 24.0;
shell_mount_ys = [-34.0, -4.0];
shell_mount_hole_diameter = 4.6;

outer_width = inside_width + 2 * side_wall;
outer_height = inside_height + bottom_wall + top_margin;
rear_y = front_thickness + inside_depth;
camera_cutout_x = outer_width / 2 - camera_cutout_right_margin
                  - camera_cutout_width / 2;
camera_cutout_z = outer_height - camera_cutout_top_margin
                   - camera_cutout_height;

$fn = 56;

module y_cylinder(length, diameter) {
    rotate([90, 0, 0]) cylinder(d = diameter, h = length, center = true);
}

module x_cylinder(length, diameter) {
    rotate([0, 90, 0]) cylinder(d = diameter, h = length, center = true);
}

module ellipsoid(rx, ry, rz) {
    scale([rx, ry, rz]) sphere(r = 1);
}

module shell_cap_solid(rx, ry, rz) {
    intersection() {
        ellipsoid(rx, ry, rz);
        translate([-rx - 5, -ry - 5, 28])
            cube([2 * rx + 10, 2 * ry + 10, rz]);
    }
}

module rounded_panel_xz(width, depth, height, radius) {
    hull()
        for (x = [-width / 2 + radius, width / 2 - radius],
             z = [radius, height - radius])
            translate([x, depth / 2, z])
                y_cylinder(depth, 2 * radius);
}

module camera_plate() {
    difference() {
        rounded_panel_xz(outer_width, front_thickness,
                         outer_height, outer_radius);
        translate([camera_cutout_x, -0.5, camera_cutout_z])
            rounded_panel_xz(camera_cutout_width,
                             front_thickness + 1,
                             camera_cutout_height,
                             camera_cutout_radius);
    }
}

module tray_outer() {
    translate([0, front_thickness, 0])
        rounded_panel_xz(outer_width,
                         inside_depth + rear_thickness,
                         outer_height,
                         outer_radius);
}

module tray_cavity() {
    // The upper rounded corners sit above the finished body, so subtracting
    // this volume leaves a smooth rounded bottom and a completely open top.
    translate([0,
               front_thickness - 0.1,
               bottom_wall])
        rounded_panel_xz(inside_width,
                         inside_depth + 0.2,
                         outer_height - bottom_wall + 2 * inner_radius,
                         inner_radius);
}

module alignment_holes() {
    pin_x = outer_width / 2 - side_wall / 2;
    for (x = [-pin_x, pin_x], z = alignment_pin_z)
        translate([x,
                   front_thickness + alignment_hole_depth / 2 - 0.05,
                   z])
            y_cylinder(alignment_hole_depth + 0.2,
                       alignment_hole_diameter);
}

module alignment_pins() {
    pin_x = outer_width / 2 - side_wall / 2;
    for (x = [-pin_x, pin_x], z = alignment_pin_z)
        translate([x,
                   front_thickness + alignment_pin_depth / 2 - 0.05,
                   z])
            y_cylinder(alignment_pin_depth + 0.1,
                       alignment_pin_diameter);
}

module usb_c_side_opening() {
    opening_y_center = (usb_c_opening_y_min
                        + usb_c_opening_y_max) / 2;
    opening_y_width = usb_c_opening_y_max
                      - usb_c_opening_y_min;
    opening_x_depth = side_wall + 5.0;
    slope_height = opening_y_width / 2;

    // This is one closed elongated hexagon, not a notch from either edge.
    // The lower point expands into two vertical sides; the upper point closes
    // them using the same 45-degree layer-by-layer support.
    hull()
        for (point = [
            [opening_y_center, usb_c_opening_bottom_z],
            [usb_c_opening_y_min,
             usb_c_opening_bottom_z + slope_height],
            [usb_c_opening_y_min,
             usb_c_opening_top_z - slope_height],
            [opening_y_center, usb_c_opening_top_z],
            [usb_c_opening_y_max,
             usb_c_opening_top_z - slope_height],
            [usb_c_opening_y_max,
             usb_c_opening_bottom_z + slope_height]
        ])
            translate([-outer_width / 2, point[0], point[1]])
                x_cylinder(opening_x_depth, 0.2);
}

module camera_cover_global() {
    union() {
        camera_plate();
        alignment_pins();
    }
}

module tray_joint_blade_solid() {
    rear_surface = rear_y + rear_thickness;

    // A long rounded arm grows directly from the lower rear wall.  Moving the
    // pivot away from the pocket gives its lower edge room to sweep past the
    // shell when the camera is aimed farther downward.
    // The large pivot boss is clipped at Z=0.  Its resulting flat joins the
    // tray's long lower edge on the print bed instead of balancing on a round
    // cylinder.
    intersection() {
        hull() {
            translate([0, rear_surface - 0.8, joint_pivot_z])
                x_cylinder(joint_blade_width, 14);
            translate([0, joint_pivot_y, joint_pivot_z])
                x_cylinder(joint_blade_width,
                           joint_pivot_outer_diameter);
        }
        translate([-outer_width, -20, 0])
            cube([2 * outer_width, 100, outer_height + 30]);
    }
}

module radial_bar_x(x_center, depth, angle, width,
                    center_y = joint_pivot_y,
                    center_z = joint_pivot_z,
                    inner_radius = ratchet_inner_radius,
                    outer_radius = ratchet_outer_radius) {
    radial_length = outer_radius - inner_radius;
    radial_center = (outer_radius + inner_radius) / 2;

    translate([0, center_y, center_z])
        rotate([angle, 0, 0])
            translate([x_center, 0, radial_center])
                cube([depth, width, radial_length], center = true);
}

module tray_ratchet_ridges() {
    blade_face_x = -joint_blade_width / 2;
    ridge_center_x = blade_face_x - ratchet_ridge_height / 2;

    for (a = [0 : ratchet_ridge_step : 360 - ratchet_ridge_step])
        radial_bar_x(ridge_center_x,
                     ratchet_ridge_height,
                     a,
                     ratchet_ridge_width);
}

module tray_joint_holes() {
    translate([0, joint_pivot_y, joint_pivot_z])
        x_cylinder(joint_blade_width + 4,
                   joint_pivot_diameter);
}

module main_tray_global() {
    difference() {
        union() {
            tray_outer();
            tray_joint_blade_solid();
            tray_ratchet_ridges();
        }
        tray_cavity();
        alignment_holes();
        usb_c_side_opening();
        tray_joint_holes();
    }
}

// ---------- Shell arch ----------

function shell_z(x, y, offset = 0) =
    (shell_radius_z + offset) * sqrt(max(0,
        1 - pow(x / (shell_radius_x + offset), 2)
          - pow(y / (shell_radius_y + offset), 2)));

module shell_reference() {
    color([0.09, 0.10, 0.12, 0.30])
        difference() {
            shell_cap_solid(shell_radius_x,
                            shell_radius_y,
                            shell_radius_z);
            shell_cap_solid(shell_radius_x - 2.2,
                            shell_radius_y - 2.2,
                            shell_radius_z - 2.2);
        }
}

module arch_skin_solid() {
    intersection() {
        difference() {
            ellipsoid(shell_radius_x + shell_contact_gap + arch_thickness,
                      shell_radius_y + shell_contact_gap + arch_thickness,
                      shell_radius_z + shell_contact_gap + arch_thickness);
            ellipsoid(shell_radius_x + shell_contact_gap,
                      shell_radius_y + shell_contact_gap,
                      shell_radius_z + shell_contact_gap);
        }
        translate([-arch_half_width, arch_y_min, 35])
            cube([2 * arch_half_width,
                  arch_y_max - arch_y_min,
                  90]);
    }
}

module arch_joint_ear_solid(side = 1) {
    ear_x = side * (joint_blade_width / 2
                    + joint_side_clearance
                    + joint_ear_thickness / 2);
    root_z = shell_z(ear_x, arch_y_min,
                     shell_contact_gap + arch_thickness / 2);

    difference() {
        translate([ear_x, 0, 0]) {
            // Each side is one short rounded ear rising from the front edge of
            // the conformal band, matching the sketched support without a long
            // fan or a protruding lock-hole cluster.
            hull() {
                translate([0, arch_y_min + 4, root_z])
                    x_cylinder(joint_ear_thickness, 15);
                translate([0, arch_pivot_y, arch_pivot_z])
                    x_cylinder(joint_ear_thickness,
                               joint_pivot_outer_diameter);
            }
        }

        // The raw root cylinder crosses the shell-facing surface.  Trim only
        // that hidden overlap and recess it slightly so the conformal arch,
        // rather than either joint ear, defines the contact with the shell.
        ellipsoid(shell_radius_x + shell_contact_gap
                              + joint_contact_relief,
                  shell_radius_y + shell_contact_gap
                              + joint_contact_relief,
                  shell_radius_z + shell_contact_gap
                              + joint_contact_relief);
    }
}

module shell_mount_holes() {
    for (x = [-shell_mount_x, shell_mount_x],
         y = shell_mount_ys)
        translate([x, y, shell_z(x, y) - 12])
            cylinder(d = shell_mount_hole_diameter, h = 28);
}

module arch_joint_holes() {
    full_width = joint_blade_width
                 + 2 * joint_side_clearance
                 + 2 * joint_ear_thickness + 4;

    translate([0, arch_pivot_y, arch_pivot_z])
        x_cylinder(full_width, joint_pivot_diameter);
}

module arch_ratchet_grooves() {
    lower_ear_inner_x = -joint_blade_width / 2
                        - joint_side_clearance;
    // Extend the subtractive slot slightly through the face.  A coplanar end
    // can leave a zero-thickness skin in CGAL and in exported slicer meshes.
    groove_center_x = lower_ear_inner_x
                      - ratchet_groove_depth / 2
                      + ratchet_groove_opening;

    for (a = [0 : ratchet_groove_step : 360 - ratchet_groove_step])
        radial_bar_x(groove_center_x,
                     ratchet_groove_depth,
                     a,
                     ratchet_groove_width,
                     arch_pivot_y,
                     arch_pivot_z,
                     ratchet_inner_radius - ratchet_groove_radial_margin,
                     ratchet_outer_radius + ratchet_groove_radial_margin);
}

module shell_arch_global() {
    difference() {
        union() {
            arch_skin_solid();
            arch_joint_ear_solid(-1);
            arch_joint_ear_solid(1);
        }
        shell_mount_holes();
        arch_joint_holes();
        arch_ratchet_grooves();
    }
}

module camera_cover_print() {
    // Camera-side face lies flat on the print bed.
    translate([0, outer_height, 0])
        rotate([90, 0, 0])
            camera_cover_global();
}

module camera_cover_profile_review() {
    projection(cut = false)
        camera_cover_print();
}

module main_tray_print() {
    // The long closed bottom edge lies on the bed.  This keeps the integrated
    // joint blade upright and preserves continuous layers through its roots.
    main_tray_global();
}

module shell_arch_print() {
    // The trimmed left edge is planar and becomes the print-bed face.
    translate([shell_radius_z + shell_contact_gap + arch_thickness,
               0, arch_half_width])
        rotate([0, -90, 0])
            shell_arch_global();
}

module phone_pocket_at_angle(angle = camera_down_angle,
                             show_cover = true) {
    translate([0, arch_pivot_y, arch_pivot_z])
        rotate([angle, 0, 0])
            translate([0, -joint_pivot_y, -joint_pivot_z]) {
                if (show_cover)
                    camera_cover_global();
                main_tray_global();
            }
}

module assembly_review() {
    shell_reference();
    color([0.92, 0.56, 0.10]) shell_arch_global();

    translate([0, arch_pivot_y, arch_pivot_z])
        rotate([camera_down_angle, 0, 0])
            translate([0, -joint_pivot_y, -joint_pivot_z]) {
                color([0.94, 0.43, 0.06]) camera_cover_global();
                color([0.12, 0.55, 0.58]) main_tray_global();
            }
}

module two_parts_review() {
    color([0.94, 0.43, 0.06]) camera_cover_global();
    color([0.12, 0.55, 0.58])
        translate([-outer_width - 18, -front_thickness, 0])
            main_tray_global();
}

module usb_c_review() {
    // Leave the body uncolored so the cutout's back face stays visually
    // distinct in the direct side render.
    main_tray_global();
}

module usb_c_profile_review() {
    // Slice only through the right wall.  Looking through the whole tray would
    // visually fill the port with geometry from the opposite side.
    projection(cut = false)
        mirror([0, 1, 0])
            rotate([90, 90, 0])
                intersection() {
                    main_tray_global();
                    translate([-outer_width / 2 + 0.2, -1, -1])
                        cube([side_wall - 0.4,
                              rear_y + rear_thickness + 2,
                              outer_height + 2]);
                }
}

module print_layout_review() {
    color([0.12, 0.55, 0.58])
        translate([-75, 0, 0])
            main_tray_print();
    color([0.92, 0.56, 0.10])
        translate([70, 0, 0])
            shell_arch_print();
}

module joint_review() {
    color([0.92, 0.56, 0.10]) shell_arch_global();
    translate([0, arch_pivot_y, arch_pivot_z])
        rotate([camera_down_angle, 0, 0])
            translate([0, -joint_pivot_y, -joint_pivot_z])
                color([0.12, 0.55, 0.58]) main_tray_global();

    color([0.76, 0.78, 0.82]) {
        translate([0, arch_pivot_y, arch_pivot_z])
            x_cylinder(48, 5.0);
    }
}

module ratchet_review() {
    // Pull the tray sideways to expose the indexed face without changing its
    // working pitch.  This is a review-only exploded view.
    color([0.92, 0.56, 0.10]) shell_arch_global();
    translate([12, arch_pivot_y, arch_pivot_z])
        rotate([camera_down_angle, 0, 0])
            translate([0, -joint_pivot_y, -joint_pivot_z])
                color([0.12, 0.55, 0.58]) main_tray_global();
}

module shell_contact_review() {
    shell_reference();
    color([0.92, 0.56, 0.10]) shell_arch_global();
}

module diagnostic_phone_shell() {
    intersection() {
        shell_cap_solid(shell_radius_x,
                        shell_radius_y,
                        shell_radius_z);
        phone_pocket_at_angle(camera_down_angle, true);
    }
}

module diagnostic_joint_overlap() {
    intersection() {
        shell_arch_global();
        translate([0, arch_pivot_y, arch_pivot_z])
            rotate([camera_down_angle, 0, 0])
                translate([0, -joint_pivot_y, -joint_pivot_z])
                    main_tray_global();
    }
}

module diagnostic_arch_shell_intrusion() {
    intersection() {
        shell_arch_global();
        shell_cap_solid(shell_radius_x,
                        shell_radius_y,
                        shell_radius_z);
    }
}

if (part == "assembly") {
    assembly_review();
} else if (part == "two_parts") {
    two_parts_review();
} else if (part == "usb_c_review") {
    usb_c_review();
} else if (part == "usb_c_profile") {
    usb_c_profile_review();
} else if (part == "print_layout") {
    print_layout_review();
} else if (part == "camera_cover") {
    camera_cover_print();
} else if (part == "camera_cover_profile") {
    camera_cover_profile_review();
} else if (part == "main_tray") {
    main_tray_print();
} else if (part == "shell_arch") {
    shell_arch_print();
} else if (part == "joint_review") {
    joint_review();
} else if (part == "ratchet_review") {
    ratchet_review();
} else if (part == "shell_contact") {
    shell_contact_review();
} else if (part == "diagnostic_phone_shell") {
    diagnostic_phone_shell();
} else if (part == "diagnostic_joint_overlap") {
    diagnostic_joint_overlap();
} else if (part == "diagnostic_arch_shell_intrusion") {
    diagnostic_arch_shell_intrusion();
} else {
    assert(false, str("Unknown part selector: ", part));
}
