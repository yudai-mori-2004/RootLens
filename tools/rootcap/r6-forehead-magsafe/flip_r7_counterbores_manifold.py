#!/usr/bin/env python3
"""Move only R7's three counterbores to the forehead-facing side.

The input is the latest hand-adjusted mesh, not a regenerated base model.  A
local ellipsoid patch fills each old outer-face recess with a tiny overlap into
the existing solid.  The same 8.4 mm by 1.0 mm recess is then cut from the
opposite face.  Geometry outside the three local recess regions must remain
vertex-for-vertex identical.
"""

from math import pi
from pathlib import Path
import argparse

import numpy as np
import trimesh


FOREHEAD_RADII = np.array([95.0, 95.0, 111.0])
FOREHEAD_CENTER = np.array([0.0, -95.0, 0.0])
INNER_CLEARANCE = 0.10
OUTER_CLEARANCE = 2.10
RECESS_DEPTH = 1.0
RECESS_EPSILON = 0.05
RECESS_RADIUS = 4.2
RESTORE_RADIUS = 4.21
RESTORE_DEPTH_OVERLAP = 0.05
THROUGH_HOLE_RADIUS = 2.25
HOLE_X_POSITIONS = (-38.0, 0.0, 38.0)
HOLE_Z = 14.0


def load_mesh(path: Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, force="mesh", process=True)
    if isinstance(loaded, trimesh.Scene):
        loaded = loaded.to_geometry()
    if not isinstance(loaded, trimesh.Trimesh):
        raise TypeError(f"not a mesh: {path}")
    loaded.remove_unreferenced_vertices()
    return loaded


def y_cylinder(radius: float, x_position: float) -> trimesh.Trimesh:
    cylinder = trimesh.creation.cylinder(radius=radius, height=42.0, sections=192)
    transform = trimesh.transformations.rotation_matrix(pi / 2, [1.0, 0.0, 0.0])
    transform[:3, 3] = [x_position, -5.0, HOLE_Z]
    cylinder.apply_transform(transform)
    return cylinder


def fit_ellipsoid(clearance: float) -> trimesh.Trimesh:
    sphere = trimesh.creation.uv_sphere(radius=1.0, count=[192, 96])
    sphere.apply_scale(FOREHEAD_RADII + clearance)
    sphere.apply_translation(FOREHEAD_CENTER)
    return sphere


def boolean_union(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.boolean.union(meshes, engine="manifold", check_volume=False)


def boolean_difference(a: trimesh.Trimesh, b: trimesh.Trimesh) -> trimesh.Trimesh:
    return trimesh.boolean.difference([a, b], engine="manifold", check_volume=False)


def boolean_intersection(a: trimesh.Trimesh, b: trimesh.Trimesh) -> trimesh.Trimesh:
    return trimesh.boolean.intersection([a, b], engine="manifold", check_volume=False)


def face_components(mesh: trimesh.Trimesh) -> list[trimesh.Trimesh]:
    """Split disconnected shells without an optional graph dependency."""

    parent = np.arange(len(mesh.vertices), dtype=np.int64)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = int(parent[index])
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for a, b, c in mesh.faces:
        union(int(a), int(b))
        union(int(b), int(c))

    roots = np.array([find(index) for index in range(len(parent))])
    face_roots = roots[mesh.faces[:, 0]]
    components = []
    for root in np.unique(face_roots):
        component_faces = mesh.faces[face_roots == root]
        used_vertices, remapped_faces = np.unique(
            component_faces, return_inverse=True
        )
        components.append(
            trimesh.Trimesh(
                vertices=mesh.vertices[used_vertices],
                faces=remapped_faces.reshape((-1, 3)),
                process=False,
            )
        )
    return components


def unchanged_vertex_ratio(before: trimesh.Trimesh, after: trimesh.Trimesh) -> tuple[int, int]:
    after_vertices = {tuple(vertex) for vertex in np.round(after.vertices, 5)}
    unchanged = 0
    considered = 0
    for vertex in np.round(before.vertices, 5):
        near_hole = any(
            (vertex[0] - x_position) ** 2 + (vertex[2] - HOLE_Z) ** 2 <= 6.0**2
            for x_position in HOLE_X_POSITIONS
        )
        if near_hole:
            continue
        considered += 1
        unchanged += tuple(vertex) in after_vertices
    return unchanged, considered


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("latest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    latest = load_mesh(args.latest)
    through_holes = boolean_union(
        [y_cylinder(THROUGH_HOLE_RADIUS, x) for x in HOLE_X_POSITIONS]
    )

    # Recreate only the material removed by the old outer counterbores.  The
    # 0.01 mm radial and 0.05 mm depth overlaps avoid coincident Boolean faces;
    # both overlaps lie inside existing solid and cannot alter the exterior.
    outer_restore_band = boolean_difference(
        fit_ellipsoid(OUTER_CLEARANCE),
        fit_ellipsoid(
            OUTER_CLEARANCE - RECESS_DEPTH - RESTORE_DEPTH_OVERLAP
        ),
    )
    outer_restore_cylinders = boolean_union(
        [y_cylinder(RESTORE_RADIUS, x) for x in HOLE_X_POSITIONS]
    )
    outer_fill = boolean_intersection(
        outer_restore_band, outer_restore_cylinders
    )
    outer_fill = boolean_difference(outer_fill, through_holes)
    restored = boolean_union([latest, outer_fill])

    # Cut the same recesses from the head-facing one-millimetre ellipsoid layer.
    inner_band = boolean_difference(
        fit_ellipsoid(INNER_CLEARANCE + RECESS_DEPTH),
        fit_ellipsoid(INNER_CLEARANCE - RECESS_EPSILON),
    )
    recess_cylinders = boolean_union(
        [y_cylinder(RECESS_RADIUS, x) for x in HOLE_X_POSITIONS]
    )
    inner_cutters = boolean_intersection(inner_band, recess_cylinders)
    raw_result = boolean_difference(restored, inner_cutters)
    raw_result.remove_unreferenced_vertices()

    # Manifold can retain sub-micron closed shells at coplanar triangle seams.
    # They contain no printable geometry.  Keep the main body only and fail if
    # any discarded shell is large enough to represent real model material.
    components = sorted(
        face_components(raw_result), key=lambda mesh: len(mesh.faces), reverse=True
    )
    result = components[0]
    discarded_volume = sum(abs(mesh.volume) for mesh in components[1:])
    if discarded_volume > 0.001:
        raise SystemExit(
            f"unexpected disconnected material: {discarded_volume:.6f} mm3"
        )

    unchanged, considered = unchanged_vertex_ratio(latest, result)
    print(
        "R7_FLIP_COUNTERBORES",
        f"vertices={len(result.vertices)}",
        f"faces={len(result.faces)}",
        f"watertight={result.is_watertight}",
        f"winding_consistent={result.is_winding_consistent}",
        f"raw_components={len(components)}",
        f"discarded_volume_mm3={discarded_volume:.9f}",
        f"volume_mm3={result.volume:.6f}",
        f"bounds_mm={np.round(result.bounds, 5).tolist()}",
        f"unchanged_vertices_away_from_holes={unchanged}/{considered}",
    )
    if not result.is_watertight or not result.is_winding_consistent:
        raise SystemExit("counterbore flip did not produce one closed manifold")
    if unchanged != considered:
        raise SystemExit("geometry away from the three recesses changed")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.export(args.output, file_type="stl")

    # Validate the actual float32 STL, not just the in-memory Boolean mesh.
    exported = load_mesh(args.output)
    exported_components = face_components(exported)
    if (
        not exported.is_watertight
        or not exported.is_winding_consistent
        or len(exported_components) != 1
    ):
        raise SystemExit("exported STL is not one closed manifold")
    exported_unchanged, exported_considered = unchanged_vertex_ratio(
        latest, exported
    )
    if exported_unchanged != exported_considered:
        raise SystemExit("exported STL changed geometry outside the recesses")


if __name__ == "__main__":
    main()
