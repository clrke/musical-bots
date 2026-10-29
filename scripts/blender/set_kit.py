"""Shared building blocks for the Musical Bots sets (diner.py, big_house.py, street.py).

Blender is Z-up in metres; the glTF export maps Blender (x, y, z) to three.js (x, z, -y), so
Blender +Y (the back of a set) is three.js -Z (away from the staging camera).

Conventions shared by every set:
  - walls are thin boxes (they have a thickness, so a doorway reads as a real opening);
  - doorways are real gaps in the wall (wall_with_openings), so the bots can walk through them;
  - spheres are icospheres (bmesh create_uvsphere emits a nondeterministic polygon order);
  - lights export in RAW mode: Blender W is written as-is and three.js reads it as candela, so
    a set's lights need no runtime scale factor (the old x0.03 hack in main.js);
  - text is converted to a mesh before export (byte-stable, no curve export involved).
"""

import os
import sys
from pathlib import Path

SKILL_SCRIPTS = Path(os.environ.get(
    "BLENDER_SKILL_SCRIPTS",
    "/Users/arke/.local/share/muse/skills/bundled/muse-core~v1/skills/blender/scripts",
))
if not (SKILL_SCRIPTS / "bpy_helpers.py").is_file():
    raise SystemExit(f"bpy_helpers.py not found under {SKILL_SCRIPTS} "
                     f"(override via BLENDER_SKILL_SCRIPTS)")
sys.path.insert(0, str(SKILL_SCRIPTS))
import bpy_helpers as H  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
BUILT = []  # every object added to the scene, for reporting


def track(obj):
    BUILT.append(obj)
    return obj


def reset():
    H.reset_scene()  # idempotent: start from an empty scene every run
    del BUILT[:]


def box(name, x0, x1, y0, y1, z0, z1, mat):
    """Axis-aligned box from its extents (Blender coordinates)."""
    return track(H.add_box(name, size=(x1 - x0, y1 - y0, z1 - z0),
                           location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat=mat))


def wall_with_openings(name, x0, x1, y0, y1, height, openings, mat):
    """A wall along X (y0..y1 thick) from x0 to x1, with rectangular openings.

    openings: [(xa, xb, za, zb)], sorted by xa, inside [x0, x1]. The wall is tiled into boxes:
    full-height strips between the openings, a lintel above and a sill below each one.
    """
    parts = []
    x = x0
    for i, (xa, xb, za, zb) in enumerate(sorted(openings)):
        if xa > x + 1e-6:
            parts.append(box(f"{name}_{len(parts)}", x, xa, y0, y1, 0.0, height, mat))
        if zb < height - 1e-6:
            parts.append(box(f"{name}_{len(parts)}", xa, xb, y0, y1, zb, height, mat))
        if za > 1e-6:
            parts.append(box(f"{name}_{len(parts)}", xa, xb, y0, y1, 0.0, za, mat))
        x = xb
    if x1 > x + 1e-6:
        parts.append(box(f"{name}_{len(parts)}", x, x1, y0, y1, 0.0, height, mat))
    return parts


def door_trim(name, xa, xb, y_front, top, mat, width=0.1, depth=0.16):
    """Jambs + header around a doorway in a wall whose front face is at y_front."""
    y0, y1 = y_front - depth / 2, y_front + depth / 2
    box(f"{name}JambL", xa - width, xa, y0, y1, 0.0, top + width, mat)
    box(f"{name}JambR", xb, xb + width, y0, y1, 0.0, top + width, mat)
    box(f"{name}Head", xa, xb, y0, y1, top, top + width, mat)


def icosphere(name, radius, location, mat, subdivisions=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    obj = bpy.data.objects.new(name, H.mesh_from_bmesh(name, bm))
    H.link(obj)
    obj.location = location
    H.assign(obj, mat)
    H.shade_smooth(obj, angle=35)
    return track(obj)


def text_mesh(name, body, size, location, mat, extrude=0.02, rotation=(90.0, 0.0, 0.0)):
    """Text as a plain mesh object (the curve is evaluated, converted and removed)."""
    t = H.add_text(name + "Curve", body, size=size, extrude=extrude, location=location,
                   rotation=rotation, mat=mat)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
    obj = bpy.data.objects.new(name, me)
    H.link(obj)
    obj.matrix_world = t.matrix_world.copy()
    if not me.materials:
        me.materials.append(mat)
    curve = t.data
    bpy.data.objects.remove(t)
    bpy.data.curves.remove(curve)
    return track(obj)


def emissive(name, color, base="#101418", strength=1.0, roughness=0.4):
    """Principled with emission (stays extension-free in glTF: emissiveFactor)."""
    return H.material(name, base_color=base, roughness=roughness, metallic=0.0,
                      emission=color, emission_strength=strength)


def tri_count(obj):
    """Triangulated face count of the evaluated object."""
    if obj.type != "MESH":
        return 0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    n = len(bm.calc_loop_triangles())
    bm.free()
    ev.to_mesh_clear()
    return n


def export(tag, blend_path, glb_path):
    """Save the .blend and export the .glb (lights in RAW mode: W -> candela 1:1)."""
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 sidecar
    H.save_blend(str(blend_path))
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:  # already enabled or headless prefs; keep going
        print(f"[{tag}] addon_enable io_scene_gltf2: {exc!r}")
    Path(glb_path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", export_lights=True,
                              export_import_convert_lighting_mode="RAW")
    total = sum(tri_count(o) for o in BUILT)
    print(f"[{tag}] {len(BUILT)} objects, {total} tris (budget 60000), Blender {bpy.app.version_string}")
    print(f"[{tag}] wrote {blend_path} ({Path(blend_path).stat().st_size} bytes)")
    print(f"[{tag}] wrote {glb_path} ({Path(glb_path).stat().st_size} bytes)")
    print(f"[{tag}] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']}")
