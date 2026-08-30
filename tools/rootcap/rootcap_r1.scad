// RootCap R1 — short bump-shell mounted egocentric phone rig.
//
// Coordinate system inside each printable part:
//   X = wearer's left/right (phone long axis)
//   Y = rear/front on the head
//   Z = outward from the shell
//
// Export examples:
//   openscad -o rootcap_r1_saddle.stl -D 'part="saddle"' rootcap_r1.scad
//   openscad -o rootcap_r1_cradle.stl -D 'part="cradle"' rootcap_r1.scad
//   openscad -o rootcap_r1_jaw.stl -D 'part="jaw"' rootcap_r1.scad

$fn = 72;

part = "assembly"; // assembly | review_mount | saddle | cradle | jaw | shell_proxy

// Review controls. The shell tangent contributes MOUNT_SLOPE_DEG and the
// cradle contributes RELATIVE_PITCH_DEG to the final downward camera angle.
MOUNT_SLOPE_DEG = 28;
RELATIVE_PITCH_DEG = -10;

// The real shell must be measured after the first visual review / fit print.
SHELL_RADIUS = 115;
SHELL_THICKNESS = 2.5;

SADDLE_W = 96;
SADDLE_L = 78;
SADDLE_T = 4;
MOUNT_HOLE_X = 34;
MOUNT_HOLE_Y = 25;
MOUNT_HOLE_D = 4.6;

HINGE_AXIS_Z = 16;
HINGE_CHEEK_T = 6;
HINGE_INNER_GAP = 28;
HINGE_OUTER_D = 16;
HINGE_BOLT_D = 5.4;

CRADLE_L = 170;
CRADLE_W = 100;
CRADLE_T = 4;
CRADLE_Z = 5;
CRADLE_FRAME = 11;

FIXED_JAW_INNER_Y = -45;
FIXED_JAW_H = 15;
FIXED_JAW_T = 7;
JAW_PREVIEW_Y = 44;
JAW_TRAVEL_MIN = 20;
JAW_TRAVEL_MAX = 47;
JAW_L = 126;
JAW_T = 10;
JAW_H = 11;
JAW_LOCK_X = 50;
JAW_LOCK_D = 4.5;

// Asymmetric so the left strap clears the landscape-right camera island.
STRAP_XS = [-18, 55];
STRAP_SLOT_L = 22;
STRAP_SLOT_W = 4.5;

PHONE_L = 153;
PHONE_W = 79;
PHONE_T = 13;

MOVING_JAW_INNER_Y = JAW_PREVIEW_Y - JAW_T / 2;
PHONE_CENTER_Y = (FIXED_JAW_INNER_Y + MOVING_JAW_INNER_Y) / 2;

EPS = 0.01;

module rounded_box(size = [10, 10, 10], r = 2, center = false) {
  x = size[0];
  y = size[1];
  z = size[2];
  translate(center ? [-x / 2, -y / 2, -z / 2] : [0, 0, 0])
    hull()
      for (px = [r, x - r], py = [r, y - r])
        translate([px, py, 0]) cylinder(r = r, h = z);
}

module spherical_patch(radius, width, length, thickness) {
  intersection() {
    difference() {
      translate([0, 0, -radius]) sphere(r = radius + thickness);
      translate([0, 0, -radius]) sphere(r = radius);
    }
    translate([-width / 2, -length / 2, -28])
      cube([width, length, 36]);
  }
}

module vertical_slot(x, y0, y1, d, z0 = -20, h = 60) {
  hull()
    for (y = [y0, y1])
      translate([x, y, z0]) cylinder(d = d, h = h);
}

module saddle_platform() {
  // A shallow center deck bridges the curved shell patch without turning the
  // whole saddle into a heavy solid wedge.
  hull()
    for (x = [-27, 27], y = [-22, 22])
      translate([x, y, -1]) cylinder(r = 4, h = 8);
}

module hinge_cheek(x_center) {
  difference() {
    hull() {
      translate([x_center - HINGE_CHEEK_T / 2, -15, 4])
        cube([HINGE_CHEEK_T, 30, 3]);
      translate([x_center, 0, HINGE_AXIS_Z])
        rotate([0, 90, 0])
          cylinder(d = HINGE_OUTER_D, h = HINGE_CHEEK_T, center = true);
    }
    translate([x_center, 0, HINGE_AXIS_Z])
      rotate([0, 90, 0])
        cylinder(d = HINGE_BOLT_D, h = HINGE_CHEEK_T + 4, center = true);
  }
}

module saddle() {
  difference() {
    union() {
      spherical_patch(SHELL_RADIUS, SADDLE_W, SADDLE_L, SADDLE_T);
      saddle_platform();

      for (side = [-1, 1])
        hinge_cheek(side * (HINGE_INNER_GAP / 2 + HINGE_CHEEK_T / 2));

      // Four ribs move hinge loads into the outer part of the saddle.
      for (side_x = [-1, 1], side_y = [-1, 1])
        hull() {
          translate([side_x * 19, side_y * 10, 3])
            cylinder(r = 3.2, h = 3);
          translate([side_x * 36, side_y * 25, -4])
            cylinder(r = 4.5, h = 3);
        }
    }

    for (x = [-MOUNT_HOLE_X, MOUNT_HOLE_X],
         y = [-MOUNT_HOLE_Y, MOUNT_HOLE_Y])
      translate([x, y, -25]) cylinder(d = MOUNT_HOLE_D, h = 55);
  }
}

module bed_outline() {
  translate([-CRADLE_L / 2, -CRADLE_W / 2, CRADLE_Z])
    rounded_box([CRADLE_L, CRADLE_W, CRADLE_T], r = 5);
}

module bed_windows() {
  // Keep the perimeter, center hinge spine and lock/strap regions solid.
  for (x = [-49, 49], y = [-19, 19])
    translate([x, y, CRADLE_Z - 1])
      rounded_box([62, 25, CRADLE_T + 2], r = 5, center = true);
}

module strap_slots() {
  for (x = STRAP_XS, y = [-39, 39])
    translate([x - STRAP_SLOT_L / 2, y - STRAP_SLOT_W / 2, CRADLE_Z - 1])
      rounded_box([STRAP_SLOT_L, STRAP_SLOT_W, CRADLE_T + 2], r = 1.5);
}

module moving_jaw_slots() {
  for (x = [-JAW_LOCK_X, JAW_LOCK_X])
    vertical_slot(x, JAW_TRAVEL_MIN, JAW_TRAVEL_MAX,
                  JAW_LOCK_D, CRADLE_Z - 1, CRADLE_T + 2);
}

module fixed_jaw_segment(x_center) {
  translate([x_center - 28, FIXED_JAW_INNER_Y - FIXED_JAW_T,
             CRADLE_Z + CRADLE_T - EPS])
    rounded_box([56, FIXED_JAW_T, FIXED_JAW_H], r = 2);
}

module cradle_hinge_lug() {
  difference() {
    union() {
      rotate([0, 90, 0])
        cylinder(d = 14, h = HINGE_INNER_GAP - 1, center = true);
      hull() {
        translate([-(HINGE_INNER_GAP - 1) / 2, -6, 0])
          cube([HINGE_INNER_GAP - 1, 12, 2]);
        translate([-20, -10, CRADLE_Z]) cube([40, 20, 1]);
      }
    }
    rotate([0, 90, 0])
      cylinder(d = HINGE_BOLT_D, h = HINGE_INNER_GAP + 4, center = true);
  }
}

module cradle() {
  difference() {
    union() {
      difference() {
        bed_outline();
        bed_windows();
      }
      cradle_hinge_lug();
      fixed_jaw_segment(-49);
      fixed_jaw_segment(49);
    }
    strap_slots();
    moving_jaw_slots();
  }
}

module moving_jaw() {
  difference() {
    union() {
      translate([-JAW_L / 2, -JAW_T / 2, 0])
        rounded_box([JAW_L, JAW_T, 4], r = 2);
      translate([-JAW_L / 2, -JAW_T / 2, 4 - EPS])
        rounded_box([JAW_L, 6, JAW_H], r = 2);
      // Small rear gussets keep the wall square under clamp pressure.
      for (x = [-45, 45])
        hull() {
          translate([x - 3, -JAW_T / 2 + 4, 3]) cube([6, 4, 1]);
          translate([x - 3, -JAW_T / 2, 10]) cube([6, 4, 1]);
        }
    }
    for (x = [-JAW_LOCK_X, JAW_LOCK_X])
      translate([x, 0, -1]) cylinder(d = JAW_LOCK_D, h = JAW_H + 8);
  }
}

module shell_proxy() {
  color([0.10, 0.11, 0.12, 0.38])
    intersection() {
      difference() {
        sphere(r = SHELL_RADIUS);
        sphere(r = SHELL_RADIUS - SHELL_THICKNESS);
      }
      translate([-140, -75, 18]) cube([280, 190, 120]);
    }
}

module phone_proxy() {
  color([0.08, 0.30, 0.62, 0.92])
    translate([-PHONE_L / 2,
               PHONE_CENTER_Y - PHONE_W / 2,
               CRADLE_Z + CRADLE_T])
      rounded_box([PHONE_L, PHONE_W, PHONE_T], r = 7);

  // Camera island is deliberately off-center; the phone body remains centered.
  color([0.03, 0.03, 0.04, 0.95])
    translate([-PHONE_L / 2 + 7,
               PHONE_CENTER_Y + PHONE_W / 2 - 32,
               CRADLE_Z + CRADLE_T + PHONE_T - EPS])
      rounded_box([34, 29, 3], r = 5);
}

module strap_proxy() {
  for (x = STRAP_XS) {
    color([0.06, 0.06, 0.07, 0.94])
      translate([x - 9, PHONE_CENTER_Y - PHONE_W / 2 - 2,
                 CRADLE_Z + CRADLE_T + PHONE_T])
        rounded_box([18, PHONE_W + 4, 1.4], r = 1.5);
  }
}

module cradle_assembly(show_phone = true) {
  color([0.84, 0.42, 0.12]) cradle();
  color([0.92, 0.66, 0.16])
    translate([0, JAW_PREVIEW_Y, CRADLE_Z + CRADLE_T]) moving_jaw();
  if (show_phone) {
    phone_proxy();
    strap_proxy();
  }
}

module mount_frame() {
  translate([0,
             SHELL_RADIUS * sin(MOUNT_SLOPE_DEG),
             SHELL_RADIUS * cos(MOUNT_SLOPE_DEG)])
    rotate([-MOUNT_SLOPE_DEG, 0, 0])
      children();
}

module assembly() {
  shell_proxy();
  mount_frame() {
    color([0.16, 0.18, 0.21]) saddle();
    translate([0, 0, HINGE_AXIS_Z])
      rotate([RELATIVE_PITCH_DEG, 0, 0])
        cradle_assembly(true);

    color("silver")
      translate([-(HINGE_INNER_GAP / 2 + HINGE_CHEEK_T + 2), 0, HINGE_AXIS_Z])
        rotate([0, 90, 0])
          cylinder(d = 5, h = HINGE_INNER_GAP + 2 * HINGE_CHEEK_T + 4);
  }
}

module review_mount() {
  color([0.16, 0.18, 0.21]) saddle();
  translate([0, 0, HINGE_AXIS_Z])
    rotate([RELATIVE_PITCH_DEG, 0, 0])
      cradle_assembly(true);
  color("silver")
    translate([-(HINGE_INNER_GAP / 2 + HINGE_CHEEK_T + 2), 0, HINGE_AXIS_Z])
      rotate([0, 90, 0])
        cylinder(d = 5, h = HINGE_INNER_GAP + 2 * HINGE_CHEEK_T + 4);
}

if (part == "saddle") {
  saddle();
} else if (part == "cradle") {
  translate([0, 0, 7]) cradle();
} else if (part == "jaw") {
  moving_jaw();
} else if (part == "shell_proxy") {
  shell_proxy();
} else if (part == "review_mount") {
  review_mount();
} else {
  assembly();
}
