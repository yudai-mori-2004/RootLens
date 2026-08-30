"""Repair the small Boolean seam defects in the Blender-exported R7 STL.

Run with Blender in background mode.  The export contains a handful of
degenerate/duplicate triangles along the far edge of the MagSafe plate.  This
script removes only faces touching those non-manifold edges, fills the newly
exposed local patch, recalculates normals, and writes a closed intermediate
mesh for the exact forehead-fit Boolean.
"""

from pathlib import Path
import sys

import bmesh
import bpy


def script_args() -> tuple[Path, Path]:
    argv = sys.argv
    if "--" not in argv or len(argv[argv.index("--") + 1 :]) != 2:
        raise SystemExit("usage: blender --background --python repair_r7_export.py -- INPUT OUTPUT")
    input_path, output_path = argv[argv.index("--") + 1 :]
    return Path(input_path).resolve(), Path(output_path).resolve()


def topology_counts(mesh: bpy.types.Mesh) -> tuple[int, int]:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    boundary = sum(edge.is_boundary for edge in bm.edges)
    non_manifold = sum(not edge.is_manifold for edge in bm.edges)
    bm.free()
    return boundary, non_manifold


input_path, output_path = script_args()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.wm.stl_import(filepath=str(input_path))
obj = bpy.context.active_object
obj.name = "RootaCap_R7_repaired_intermediate"

mesh = obj.data
mesh.validate(verbose=True, clean_customdata=True)

bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)

for repair_pass in range(8):
    problem_edges = [edge for edge in bm.edges if not edge.is_manifold]
    if not problem_edges:
        break

    faces_to_remove = {face for edge in problem_edges for face in edge.link_faces}
    bmesh.ops.delete(bm, geom=list(faces_to_remove), context="FACES")

    boundary_edges = [edge for edge in bm.edges if edge.is_boundary]
    bmesh.ops.triangle_fill(
        bm,
        edges=boundary_edges,
        use_beauty=True,
        use_dissolve=False,
    )
    bmesh.ops.dissolve_limit(
        bm,
        angle_limit=1e-6,
        verts=list(bm.verts),
        edges=list(bm.edges),
        use_dissolve_boundaries=False,
        delimit=set(),
    )
    bmesh.ops.triangulate(
        bm,
        faces=list(bm.faces),
        quad_method="BEAUTY",
        ngon_method="BEAUTY",
    )
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

bm.to_mesh(mesh)
bm.free()
mesh.validate(verbose=True, clean_customdata=True)
mesh.update()

boundary, non_manifold = topology_counts(mesh)
print(
    "R7_REPAIR",
    f"vertices={len(mesh.vertices)}",
    f"polygons={len(mesh.polygons)}",
    f"boundary_edges={boundary}",
    f"non_manifold_edges={non_manifold}",
)
if boundary or non_manifold:
    raise SystemExit("repair did not produce a closed manifold")

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.wm.stl_export(
    filepath=str(output_path),
    export_selected_objects=True,
    apply_modifiers=True,
    ascii_format=False,
)
