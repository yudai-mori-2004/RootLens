/*
 * RootCap R3 — conformal crown bridge
 *
 * Assembly coordinates:
 *   X: wearer's right, Y: forward, Z: up
 *
 * The shell dimensions are provisional until measured. The printed saddle
 * follows the same parametric shell surface over its complete underside.
 */

part = "assembly";
show_hardware = true;

// ---------- Shell fit ----------

shell_radius_x = 90;          // provisional half-width
shell_radius_y = 104;         // provisional half-length
shell_radius_z = 102;         // provisional crown height
shell_wall = 2.2;             // reference shell only
shell_lower_cut = 18;

saddle_center_y = 25;
saddle_half_width = 76;
saddle_length = 52;
saddle_thickness = 5.0;
interface_pad = 0.8;          // EVA/TPU thickness; set 0 for direct contact

shell_bolt_x = 62;
shell_bolt_y_offset = 16;
shell_bolt_diameter = 4.8;

backer_width = 28;
backer_length = 46;
backer_thickness = 3.5;
backer_gap = 0.4;

// ---------- Yoke interface ----------

deck_width = 68;
deck_length = 50;
deck_thickness = 5;
deck_lift = 2.5;
deck_hole_x = 24;
deck_hole_y = 16;

yoke_inner_gap = 32;
yoke_ear_thickness = 6;
yoke_pivot_y = 0;
yoke_pivot_z = 50;
tilt_lock_radius = 24;
tilt_positions = [25, 35, 45, 55, 65];
camera_down_angle = 45;

// ---------- Cased phone envelope ----------

phone_width = 172;            // supported: 145 ... 185
phone_height = 88;            // supported: 70 ... 96
phone_thickness = 14;         // supported: 8 ... 18
phone_bottom_z = -42;

camera_keepout_width = 44;
camera_keepout_height = 38;
fit_clearance = 0.6;

// The landscape phone drops into a rigid, open-top pocket. A soft liner absorbs
// the few-millimetre differences between personal cases.
pocket_clearance = 1.8;
pocket_wall = 4.0;
pocket_front_lip = 4.0;
pocket_liner_thickness = 1.5;

$fn = 56;

assert(phone_width >= 145 && phone_width <= 185,
       "phone_width must be within 145..185 mm");
assert(phone_height >= 70 && phone_height <= 96,
       "phone_height must be within 70..96 mm");
assert(phone_thickness >= 8 && phone_thickness <= 18,
       "phone_thickness must be within 8..18 mm");
assert(camera_down_angle >= 25 && camera_down_angle <= 65,
       "camera_down_angle must be within 25..65 degrees");

// ---------- Derived dimensions ----------

function shell_z(x, y, offset = 0) =
    (shell_radius_z + offset) * sqrt(max(0,
        1 - pow(x / (shell_radius_x + offset), 2)
          - pow(y / (shell_radius_y + offset), 2)));

function shell_inner_z(x, y, inset = 0) =
    (shell_radius_z - shell_wall - inset) * sqrt(max(0,
        1 - pow(x / (shell_radius_x - shell_wall - inset), 2)
          - pow(y / (shell_radius_y - shell_wall - inset), 2)));

saddle_top_center_z = shell_z(
    0, saddle_center_y, interface_pad + saddle_thickness
);
deck_bottom_z = saddle_top_center_z - 0.8 + deck_lift;
deck_top_z = deck_bottom_z + deck_thickness;
pivot_world_y = saddle_center_y + yoke_pivot_y;
pivot_world_z = deck_top_z + yoke_pivot_z;

pocket_inner_width = phone_width + 2 * pocket_clearance;
pocket_inner_height = phone_height + 2 * pocket_clearance;
pocket_inner_depth = phone_thickness + 2 * pocket_clearance;
pocket_inner_bottom = phone_bottom_z - pocket_clearance;
pocket_inner_top = pocket_inner_bottom + pocket_inner_height;
pocket_screen_y = 20;
pocket_inner_back_y = pocket_screen_y - pocket_clearance;
pocket_back_y = pocket_inner_back_y - pocket_wall;
pocket_front_y = pocket_inner_back_y + pocket_inner_depth;
pocket_outer_front_y = pocket_front_y + pocket_front_lip;

// ---------- Geometry helpers ----------

module ellipsoid(rx, ry, rz) {
    scale([rx, ry, rz]) sphere(r = 1);
}

module rounded_box_xy(size = [10, 10, 3], radius = 2, center = false) {
    x = size[0]; y = size[1]; z = size[2];
    tx = center ? -x / 2 : 0;
    ty = center ? -y / 2 : 0;
    tz = center ? -z / 2 : 0;
    translate([tx, ty, tz])
        linear_extrude(height = z)
            hull()
                for (px = [radius, x - radius], py = [radius, y - radius])
                    translate([px, py]) circle(r = radius);
}

module rounded_box_xz(size = [10, 3, 10], radius = 2, center = false) {
    x = size[0]; y = size[1]; z = size[2];
    tx = center ? -x / 2 : 0;
    ty = center ? -y / 2 : 0;
    tz = center ? -z / 2 : 0;
    translate([tx, ty, tz])
        hull()
            for (px = [radius, x - radius], pz = [radius, z - radius])
                translate([px, y / 2, pz])
                    y_cylinder(length = y, diameter = 2 * radius);
}

module x_cylinder(length = 20, diameter = 5) {
    rotate([0, 90, 0]) cylinder(d = diameter, h = length, center = true);
}

module y_cylinder(length = 20, diameter = 5) {
    rotate([90, 0, 0]) cylinder(d = diameter, h = length, center = true);
}

module y_countersink(depth = 2.6, shaft_diameter = 4.5, head_diameter = 8.4) {
    rotate([90, 0, 0])
        cylinder(d1 = head_diameter, d2 = shaft_diameter, h = depth);
}

module y_slot_x(length = 20, diameter = 4.5, depth = 20) {
    hull()
        for (dx = [-length / 2, length / 2])
            translate([dx, 0, 0]) y_cylinder(length = depth, diameter = diameter);
}

module cap_solid(rx, ry, rz, lower_cut) {
    intersection() {
        ellipsoid(rx, ry, rz);
        translate([-140, -140, lower_cut]) cube([280, 280, 130]);
    }
}

// ---------- Reference shell ----------

module shell_reference() {
    color([0.07, 0.09, 0.11, 0.90])
        difference() {
            cap_solid(shell_radius_x, shell_radius_y, shell_radius_z,
                      shell_lower_cut);
            cap_solid(shell_radius_x - shell_wall,
                      shell_radius_y - shell_wall,
                      shell_radius_z - shell_wall,
                      shell_lower_cut - 3);
        }
}

module shell_solid() {
    cap_solid(shell_radius_x, shell_radius_y, shell_radius_z,
              shell_lower_cut);
}

// ---------- Conformal crown saddle ----------

module saddle_skin_global() {
    intersection() {
        difference() {
            ellipsoid(shell_radius_x + interface_pad + saddle_thickness,
                      shell_radius_y + interface_pad + saddle_thickness,
                      shell_radius_z + interface_pad + saddle_thickness);
            ellipsoid(shell_radius_x + interface_pad,
                      shell_radius_y + interface_pad,
                      shell_radius_z + interface_pad);
        }
        translate([-saddle_half_width,
                   saddle_center_y - saddle_length / 2,
                   shell_lower_cut])
            cube([2 * saddle_half_width, saddle_length, 110]);
    }
}

module saddle_support_post(x, y) {
    z0 = shell_z(x, y, interface_pad + saddle_thickness * 0.55);
    hull() {
        translate([x, y, z0]) cylinder(d = 13, h = 2);
        translate([x, y, deck_bottom_z - 1]) cylinder(d = 13, h = 2);
    }
}

module crown_saddle_global() {
    difference() {
        union() {
            saddle_skin_global();

            // A shallow level deck is tied into the conformal band by four posts.
            translate([-deck_width / 2,
                       saddle_center_y - deck_length / 2,
                       deck_bottom_z])
                rounded_box_xy([deck_width, deck_length, deck_thickness], 6);

            for (x = [-deck_hole_x, deck_hole_x],
                 y = [saddle_center_y - deck_hole_y,
                      saddle_center_y + deck_hole_y])
                saddle_support_post(x, y);
        }

        // Four shell fasteners, two on each side of the crown.
        for (x = [-shell_bolt_x, shell_bolt_x],
             y = [saddle_center_y - shell_bolt_y_offset,
                  saddle_center_y + shell_bolt_y_offset])
            translate([x, y, shell_inner_z(x, y) - 8])
                cylinder(d = shell_bolt_diameter, h = 42);

        // Heat-set insert bores for the removable pitch yoke.
        for (x = [-deck_hole_x, deck_hole_x],
             y = [saddle_center_y - deck_hole_y,
                  saddle_center_y + deck_hole_y])
            translate([x, y, deck_top_z - 7.3])
                cylinder(d = 5.5, h = 8.3);
    }
}

module crown_saddle_part() {
    translate([0, -saddle_center_y,
               -shell_z(0, saddle_center_y, interface_pad)])
        crown_saddle_global();
}

// ---------- Interior load spreaders ----------

module inner_backer_global(side = 1) {
    x0 = side * shell_bolt_x;
    difference() {
        intersection() {
            difference() {
                ellipsoid(shell_radius_x - shell_wall - backer_gap,
                          shell_radius_y - shell_wall - backer_gap,
                          shell_radius_z - shell_wall - backer_gap);
                ellipsoid(shell_radius_x - shell_wall - backer_gap
                                      - backer_thickness,
                          shell_radius_y - shell_wall - backer_gap
                                      - backer_thickness,
                          shell_radius_z - shell_wall - backer_gap
                                      - backer_thickness);
            }
            translate([x0 - backer_width / 2,
                       saddle_center_y - backer_length / 2,
                       shell_lower_cut])
                cube([backer_width, backer_length, 90]);
        }

        for (y = [saddle_center_y - shell_bolt_y_offset,
                  saddle_center_y + shell_bolt_y_offset])
            translate([x0, y, shell_inner_z(x0, y) - 16])
                cylinder(d = shell_bolt_diameter, h = 34);
    }
}

module inner_backer_part(side = 1) {
    translate([-side * shell_bolt_x,
               -saddle_center_y,
               -shell_inner_z(side * shell_bolt_x, saddle_center_y,
                              backer_gap + backer_thickness)])
        inner_backer_global(side);
}

// ---------- Positive-position pitch yoke ----------

module yoke_ear_raw(xpos) {
    translate([xpos, 0, 0])
        hull()
            for (p = [[-19, 7], [19, 7], [18, 34],
                      [yoke_pivot_y, yoke_pivot_z], [-18, 34]])
                translate([0, p[0], p[1]])
                    x_cylinder(length = yoke_ear_thickness, diameter = 9);
}

module pitch_yoke() {
    ear_x = yoke_inner_gap / 2 + yoke_ear_thickness / 2;
    difference() {
        union() {
            translate([-deck_width / 2, -deck_length / 2, 0])
                rounded_box_xy([deck_width, deck_length, 5], 6);
            yoke_ear_raw(-ear_x);
            yoke_ear_raw(ear_x);
        }

        for (x = [-deck_hole_x, deck_hole_x],
             y = [-deck_hole_y, deck_hole_y]) {
            translate([x, y, -1]) cylinder(d = 4.5, h = 9);
            translate([x, y, 2.6]) cylinder(d1 = 4.5, d2 = 8.6, h = 2.5);
        }

        translate([0, yoke_pivot_y, yoke_pivot_z])
            x_cylinder(length = 52, diameter = 6.5);

        // The second M5 bolt selects a real hole rather than relying on friction.
        for (a = tilt_positions)
            translate([0,
                       yoke_pivot_y - tilt_lock_radius * sin(a),
                       yoke_pivot_z - tilt_lock_radius * cos(a)])
                x_cylinder(length = 52, diameter = 5.5);
    }
}

module pitch_yoke_global() {
    translate([0, saddle_center_y, deck_top_z]) pitch_yoke();
}

// ---------- Universal landscape phone pocket ----------

module carrier_tilt_blade_raw() {
    blade_width = yoke_inner_gap - 2 * fit_clearance;
    hull() {
        translate([0, 0, 0])
            x_cylinder(length = blade_width, diameter = 20);
        translate([0, 0, -tilt_lock_radius])
            x_cylinder(length = blade_width, diameter = 15);
    }
    hull() {
        translate([0, 0, 0])
            x_cylinder(length = blade_width, diameter = 20);
        translate([0, 16, 31])
            x_cylinder(length = blade_width, diameter = 11);
    }
}

module phone_pocket_body() {
    body_x0 = -pocket_inner_width / 2 - pocket_wall;
    body_x1 = pocket_inner_width / 2 + pocket_wall;
    body_width = body_x1 - body_x0;

    difference() {
        union() {
            // Full screen-side backplate. The camera side stays open except for
            // the perimeter lips, matching the sketched insertion pocket.
            translate([body_x0, pocket_back_y,
                       pocket_inner_bottom - pocket_wall])
                cube([body_width, pocket_wall,
                      pocket_inner_height + 2 * pocket_wall]);

            // Closed bottom rail. The entire long top edge remains open.
            translate([body_x0, pocket_inner_back_y,
                       pocket_inner_bottom - pocket_wall])
                cube([body_width,
                      pocket_inner_depth + pocket_front_lip,
                      pocket_wall]);

            // Both short sides guide the phone during the top-down insertion.
            for (x0 = [body_x0, pocket_inner_width / 2])
                translate([x0, pocket_inner_back_y,
                           pocket_inner_bottom - pocket_wall])
                    cube([pocket_wall,
                          pocket_inner_depth + pocket_front_lip,
                          pocket_inner_height + pocket_wall]);

            // Camera-side corner lips keep the phone inside the pocket.
            translate([body_x0, pocket_front_y,
                       pocket_inner_bottom - pocket_wall])
                cube([body_width, pocket_front_lip, 12]);

            // Right front rail runs nearly full height. The left camera corner
            // is retained only below the camera opening.
            translate([pocket_inner_width / 2,
                       pocket_front_y,
                       pocket_inner_bottom - pocket_wall])
                cube([pocket_wall, pocket_front_lip,
                      pocket_inner_height + pocket_wall]);
            translate([body_x0,
                       pocket_front_y,
                       pocket_inner_bottom - pocket_wall])
                cube([pocket_wall, pocket_front_lip,
                      phone_height * 0.55]);

            carrier_tilt_blade_raw();
        }

        translate([0, 0, 0]) x_cylinder(length = 40, diameter = 6.5);
        translate([0, 0, -tilt_lock_radius])
            x_cylinder(length = 40, diameter = 5.5);

        // The large camera corner is cut only through the forward lips.
        camera_x = -phone_width / 2 + 18;
        camera_z = phone_bottom_z + phone_height - 17;
        translate([camera_x, pocket_front_y - 1, camera_z])
            cube([camera_keepout_width + 10,
                  2 * pocket_front_lip + 4,
                  camera_keepout_height + 10], center = true);

    }
}

module pocket_liner_reference() {
    color([0.70, 0.73, 0.76, 0.72]) {
        translate([-phone_width / 2,
                   pocket_inner_back_y,
                   phone_bottom_z])
            cube([phone_width, pocket_liner_thickness, phone_height]);

        for (z = [pocket_inner_bottom,
                  pocket_inner_top - pocket_liner_thickness])
            translate([-phone_width / 2,
                       pocket_inner_back_y,
                       z])
                cube([phone_width, pocket_inner_depth,
                      pocket_liner_thickness]);

        translate([-pocket_inner_width / 2,
                   pocket_inner_back_y,
                   phone_bottom_z])
            cube([pocket_liner_thickness,
                  pocket_inner_depth, phone_height]);

        translate([pocket_inner_width / 2 - pocket_liner_thickness,
                   pocket_inner_back_y,
                   phone_bottom_z])
            cube([pocket_liner_thickness,
                  pocket_inner_depth, phone_height]);
    }
}

module phone_mount_global(show_liner = false) {
    translate([0, pivot_world_y, pivot_world_z])
        rotate([-camera_down_angle, 0, 0]) {
            color([0.95, 0.48, 0.06]) phone_pocket_body();

            if (show_liner)
                pocket_liner_reference();
        }
}

module pocket_review() {
    color([0.95, 0.48, 0.06]) phone_pocket_body();
    pocket_liner_reference();
}

module camera_keepout_global() {
    camera_x = -phone_width / 2 + 18;
    camera_z = phone_bottom_z + phone_height - 17;
    translate([0, pivot_world_y, pivot_world_z])
        rotate([-camera_down_angle, 0, 0])
            translate([camera_x, 54, camera_z])
                cube([camera_keepout_width, 40,
                      camera_keepout_height], center = true);
}

// ---------- Assembly and diagnostics ----------

module hardware_reference() {
    if (show_hardware) {
        color([0.72, 0.74, 0.78]) {
            translate([0, pivot_world_y, pivot_world_z])
                x_cylinder(length = 50, diameter = 5.8);

            translate([0,
                       pivot_world_y - tilt_lock_radius
                                           * sin(camera_down_angle),
                       pivot_world_z - tilt_lock_radius
                                           * cos(camera_down_angle)])
                x_cylinder(length = 50, diameter = 4.8);

            for (x = [-shell_bolt_x, shell_bolt_x],
                 y = [saddle_center_y - shell_bolt_y_offset,
                      saddle_center_y + shell_bolt_y_offset])
                translate([x, y, shell_inner_z(x, y) - 5])
                    cylinder(d = 4.2, h = 22);
        }
    }
}

module contact_review() {
    shell_reference();
    color([0.95, 0.42, 0.04]) crown_saddle_global();
    color([0.20, 0.72, 0.66]) {
        inner_backer_global(-1);
        inner_backer_global(1);
    }
    hardware_reference();
}

module assembly_review() {
    shell_reference();
    color([0.95, 0.42, 0.04]) crown_saddle_global();
    color([0.98, 0.68, 0.14]) pitch_yoke_global();
    color([0.20, 0.72, 0.66]) {
        inner_backer_global(-1);
        inner_backer_global(1);
    }
    phone_mount_global(true);
    hardware_reference();
}

module diagnostic_mount_shell() {
    intersection() {
        shell_solid();
        phone_mount_global(false);
    }
}

module diagnostic_camera_keepout() {
    intersection() {
        camera_keepout_global();
        phone_mount_global(false);
    }
}

module diagnostic_saddle_shell() {
    intersection() {
        shell_solid();
        crown_saddle_global();
    }
}

if (part == "assembly") {
    assembly_review();
} else if (part == "contact_review") {
    contact_review();
} else if (part == "crown_saddle") {
    crown_saddle_part();
} else if (part == "inner_backer_left") {
    inner_backer_part(-1);
} else if (part == "inner_backer_right") {
    inner_backer_part(1);
} else if (part == "pitch_yoke") {
    pitch_yoke();
} else if (part == "phone_pocket") {
    phone_pocket_body();
} else if (part == "pocket_review") {
    pocket_review();
} else if (part == "reference_shell") {
    shell_solid();
} else if (part == "diagnostic_mount_shell") {
    diagnostic_mount_shell();
} else if (part == "diagnostic_camera_keepout") {
    diagnostic_camera_keepout();
} else if (part == "diagnostic_saddle_shell") {
    diagnostic_saddle_shell();
} else {
    assert(false, str("Unknown part selector: ", part));
}
