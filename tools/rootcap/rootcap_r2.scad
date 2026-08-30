// RootCap R2 — 45-degree forward/down optical axis.
//
// The phone is landscape. Its camera side faces local -Z, so the carrier is
// tilted upward toward the wearer's front; the rear camera then looks forward
// and down. R1 incorrectly treated phone-plane pitch as camera-axis pitch.
//
// Coordinate system:
//   X = wearer's left/right (phone long axis)
//   Y = rear/front on the head
//   Z = outward from the shell / toward the phone screen in carrier space

$fn = 72;

part = "assembly"; // assembly | review_mount | saddle | carrier | jaw | shell_proxy

CAMERA_DOWN_DEG = 45;
SADDLE_POSITION_DEG = 5;
PHONE_PLANE_GLOBAL_DEG = 90 - CAMERA_DOWN_DEG;
RELATIVE_PHONE_PITCH_DEG = PHONE_PLANE_GLOBAL_DEG + SADDLE_POSITION_DEG;

SHELL_RADIUS = 115;
SHELL_THICKNESS = 2.5;

SADDLE_W = 96;
SADDLE_L = 78;
SADDLE_T = 4;
MOUNT_HOLE_X = 34;
MOUNT_HOLE_Y = 25;
MOUNT_HOLE_D = 4.6;

HINGE_AXIS_Z = 14;
HINGE_CHEEK_T = 6;
HINGE_INNER_GAP = 28;
HINGE_OUTER_D = 16;
HINGE_BOLT_D = 5.4;

CARRIER_L = 170;
CARRIER_W = 100;
CARRIER_T = 4;
CARRIER_FRAME = 12;
CARRIER_HINGE_Y = -42;
CARRIER_HINGE_Z = 20;

FIXED_JAW_INNER_Y = -45;
MOVING_JAW_PREVIEW_Y = 44;
MOVING_JAW_T = 10;
MOVING_JAW_INNER_Y = MOVING_JAW_PREVIEW_Y - MOVING_JAW_T / 2;
JAW_L = 80;
JAW_CENTER_X = 10;
JAW_LOCK_XS = [-24, 44];
JAW_LOCK_D = 4.5;
JAW_TRAVEL_MIN = 20;
JAW_TRAVEL_MAX = 47;

STRAP_XS = [-18, 55];
STRAP_SLOT_L = 22;
STRAP_SLOT_W = 4.5;

PHONE_L = 153;
PHONE_W = 79;
PHONE_T = 13;
PHONE_CENTER_Y = (FIXED_JAW_INNER_Y + MOVING_JAW_INNER_Y) / 2;

CAMERA_X = -52;
CAMERA_Y = PHONE_CENTER_Y + 19;

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
    translate([-width / 2, -length / 2, -28]) cube([width, length, 36]);
  }
}

module vertical_slot(x, y0, y1, d, z0, h) {
  hull()
    for (y = [y0, y1])
      translate([x, y, z0]) cylinder(d = d, h = h);
}

module saddle_platform() {
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

      for (side_x = [-1, 1], side_y = [-1, 1])
        hull() {
          translate([side_x * 19, side_y * 10, 3]) cylinder(r = 3.2, h = 3);
          translate([side_x * 36, side_y * 25, -5]) cylinder(r = 4.5, h = 4);
        }
    }

    for (x = [-MOUNT_HOLE_X, MOUNT_HOLE_X],
         y = [-MOUNT_HOLE_Y, MOUNT_HOLE_Y])
      translate([x, y, -25]) cylinder(d = MOUNT_HOLE_D, h = 55);
  }
}

module carrier_ring() {
  difference() {
    translate([-CARRIER_L / 2, -CARRIER_W / 2, PHONE_T])
      rounded_box([CARRIER_L, CARRIER_W, CARRIER_T], r = 6);
    translate([-(CARRIER_L - 2 * CARRIER_FRAME) / 2,
               -(CARRIER_W - 2 * CARRIER_FRAME) / 2,
               PHONE_T - 1])
      rounded_box([CARRIER_L - 2 * CARRIER_FRAME,
                   CARRIER_W - 2 * CARRIER_FRAME,
                   CARRIER_T + 2], r = 4);
  }
}

module adjustment_rails() {
  for (x = JAW_LOCK_XS)
    translate([x - 4, 13, PHONE_T])
      rounded_box([8, 37, CARRIER_T], r = 2);
}

module fixed_jaw() {
  // This center-biased jaw clears the iPhone camera corner on the underside.
  translate([JAW_CENTER_X - JAW_L / 2, -52, 0])
    rounded_box([JAW_L, 7, PHONE_T + CARRIER_T], r = 2);
  translate([JAW_CENTER_X - JAW_L / 2, -45, -2])
    rounded_box([JAW_L, 4, 3], r = 1);
}

module carrier_hinge_lug() {
  difference() {
    union() {
      translate([0, CARRIER_HINGE_Y, CARRIER_HINGE_Z])
        rotate([0, 90, 0])
          cylinder(d = 14, h = HINGE_INNER_GAP - 1, center = true);
      hull() {
        translate([-(HINGE_INNER_GAP - 1) / 2,
                   CARRIER_HINGE_Y - 6,
                   CARRIER_HINGE_Z - 1])
          cube([HINGE_INNER_GAP - 1, 12, 2]);
        translate([-22, CARRIER_HINGE_Y - 8, PHONE_T])
          cube([44, 16, CARRIER_T]);
      }
    }
    translate([0, CARRIER_HINGE_Y, CARRIER_HINGE_Z])
      rotate([0, 90, 0])
        cylinder(d = HINGE_BOLT_D, h = HINGE_INNER_GAP + 4, center = true);
  }
}

module strap_slots() {
  for (x = STRAP_XS, y = [-43, 43])
    translate([x - STRAP_SLOT_L / 2,
               y - STRAP_SLOT_W / 2,
               PHONE_T - 1])
      rounded_box([STRAP_SLOT_L, STRAP_SLOT_W, CARRIER_T + 2], r = 1.5);
}

module moving_jaw_slots() {
  for (x = JAW_LOCK_XS)
    vertical_slot(x, JAW_TRAVEL_MIN, JAW_TRAVEL_MAX,
                  JAW_LOCK_D, PHONE_T - 1, CARRIER_T + 2);
}

module carrier() {
  difference() {
    union() {
      carrier_ring();
      adjustment_rails();
      fixed_jaw();
      carrier_hinge_lug();
    }
    strap_slots();
    moving_jaw_slots();
  }
}

module moving_jaw() {
  difference() {
    union() {
      // Top locking bar on the screen side.
      translate([JAW_CENTER_X - JAW_L / 2, -MOVING_JAW_T / 2, 0])
        rounded_box([JAW_L, MOVING_JAW_T, 4], r = 2);
      // Side wall descends around the case edge.
      translate([JAW_CENTER_X - JAW_L / 2, -MOVING_JAW_T / 2, -17])
        rounded_box([JAW_L, 6, 17], r = 2);
      // Lower lip supports only the center of the case, not the camera corner.
      translate([JAW_CENTER_X - JAW_L / 2, -MOVING_JAW_T / 2 - 3, -19])
        rounded_box([JAW_L, 4, 3], r = 1);
    }
    for (x = JAW_LOCK_XS)
      translate([x, 0, -21]) cylinder(d = JAW_LOCK_D, h = 28);
  }
}

module phone_proxy() {
  color([0.08, 0.30, 0.62, 0.92])
    translate([-PHONE_L / 2, PHONE_CENTER_Y - PHONE_W / 2, 0])
      rounded_box([PHONE_L, PHONE_W, PHONE_T], r = 7);

  // Rear camera side is underneath the carrier (local -Z).
  color([0.03, 0.03, 0.04, 0.98])
    translate([-PHONE_L / 2 + 7,
               PHONE_CENTER_Y + PHONE_W / 2 - 32,
               -3])
      rounded_box([34, 29, 3], r = 5);

  // Screen-side proxy, facing local +Z.
  color([0.02, 0.03, 0.05, 0.94])
    translate([-PHONE_L / 2 + 3,
               PHONE_CENTER_Y - PHONE_W / 2 + 3,
               PHONE_T - EPS])
      rounded_box([PHONE_L - 6, PHONE_W - 6, 0.8], r = 5);
}

module strap_proxy() {
  for (x = STRAP_XS)
    color([0.07, 0.07, 0.08, 0.95])
      translate([x - 9,
                 PHONE_CENTER_Y - PHONE_W / 2 - 2,
                 PHONE_T + CARRIER_T])
        rounded_box([18, PHONE_W + 4, 1.5], r = 1.5);
}

module optical_axis_proxy() {
  // Red arrow starts at the 1x camera area and follows local -Z.
  color([0.92, 0.12, 0.10]) {
    translate([CAMERA_X, CAMERA_Y, -3])
      rotate([180, 0, 0]) cylinder(d = 3, h = 44);
    translate([CAMERA_X, CAMERA_Y, -47])
      rotate([180, 0, 0]) cylinder(d1 = 8, d2 = 0, h = 12);
  }
}

module carrier_assembly(show_phone = true, show_axis = true) {
  color([0.84, 0.42, 0.12]) carrier();
  color([0.92, 0.66, 0.16])
    translate([0, MOVING_JAW_PREVIEW_Y, PHONE_T + CARRIER_T]) moving_jaw();
  if (show_phone) {
    phone_proxy();
    strap_proxy();
  }
  if (show_axis) optical_axis_proxy();
}

module carrier_at_pivot(show_phone = true, show_axis = true) {
  translate([0, -CARRIER_HINGE_Y, -CARRIER_HINGE_Z])
    carrier_assembly(show_phone, show_axis);
}

module shell_proxy() {
  color([0.70, 0.71, 0.73, 0.38])
    intersection() {
      difference() {
        sphere(r = SHELL_RADIUS);
        sphere(r = SHELL_RADIUS - SHELL_THICKNESS);
      }
      translate([-140, -75, 18]) cube([280, 190, 120]);
    }
}

module mount_frame() {
  translate([0,
             SHELL_RADIUS * sin(SADDLE_POSITION_DEG),
             SHELL_RADIUS * cos(SADDLE_POSITION_DEG)])
    rotate([-SADDLE_POSITION_DEG, 0, 0]) children();
}

module review_mount() {
  color([0.16, 0.18, 0.21]) saddle();
  translate([0, 0, HINGE_AXIS_Z])
    rotate([RELATIVE_PHONE_PITCH_DEG, 0, 0])
      carrier_at_pivot(true, true);
  color("silver")
    translate([-(HINGE_INNER_GAP / 2 + HINGE_CHEEK_T + 2), 0, HINGE_AXIS_Z])
      rotate([0, 90, 0])
        cylinder(d = 5, h = HINGE_INNER_GAP + 2 * HINGE_CHEEK_T + 4);
}

module assembly() {
  shell_proxy();
  mount_frame() review_mount();
}

if (part == "saddle") {
  saddle();
} else if (part == "carrier") {
  translate([0, 0, 2]) carrier();
} else if (part == "jaw") {
  translate([0, 0, 19]) moving_jaw();
} else if (part == "shell_proxy") {
  shell_proxy();
} else if (part == "review_mount") {
  review_mount();
} else {
  assembly();
}
