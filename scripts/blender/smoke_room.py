"""Smoke room: Phase 4 .blend -> .glb pipeline proof.

Builds a minimal room (floor + back wall + counter, metres, Z-up),
saves environments/smoke.blend and exports environments/smoke.glb.

Idempotent: rerunning reproduces the scene exactly (reset first,
deterministic geometry, no randomness, no timestamps in scene data).

Run headless per the blender skill:
    blender -b --factory-startup --python-exit-code 1 \\
        -P scripts/blender/smoke_room.py
"""

import os
import sys
from pathlib import Path

# bpy_helpers.py comes with Muse Code's bundled blender skill. Its directory: $MUSE_BLENDER_SCRIPTS
# (or the older $BLENDER_SKILL_SCRIPTS), else the default Muse Code install under the home directory.
SKILL_SCRIPTS = Path(os.path.expanduser(
    os.environ.get("MUSE_BLENDER_SCRIPTS")
    or os.environ.get("BLENDER_SKILL_SCRIPTS")
    or "~/.local/share/muse/skills/bundled/muse-core~v1/skills/blender/scripts"
))
if not (SKILL_SCRIPTS / "bpy_helpers.py").is_file():
    raise SystemExit(f"bpy_helpers.py (Muse Code's blender skill) not found under {SKILL_SCRIPTS}: "
                     f"set MUSE_BLENDER_SCRIPTS to the directory that holds it")
sys.path.insert(0, str(SKILL_SCRIPTS))
import bpy_helpers as H  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402

# Repo root resolved from this script's location: scripts/blender/ -> root.
ROOT = Path(__file__).resolve().parent.parent.parent
BLEND_PATH = ROOT / "environments" / "smoke.blend"
GLB_PATH = ROOT / "environments" / "smoke.glb"

P = {
    "floor_size": (8.0, 8.0),       # x, y extent (metres), top at z=0
    "floor_color": "#BDBDBD",        # light gray
    "wall_size": (8.0, 3.0),         # width x height (metres)
    "wall_pos": (0.0, -4.0, 1.5),    # centered, base at z=0
    "wall_color": "#F2EAD8",         # warm off-white
    "counter_size": (2.2, 0.6, 0.9),  # x, y, z extent (metres)
    "counter_pos": (0.0, -2.5, 0.45),  # center; base rests on z=0
    "counter_color": "#8A5A2B",      # wood brown
}


def build_floor():
    mat = H.material("FloorMat", base_color=P["floor_color"],
                     roughness=0.85, metallic=0.0)
    return H.add_plane("Floor", size=P["floor_size"],
                       location=(0.0, 0.0, 0.0), mat=mat)


def build_wall():
    # Plane default faces +Z; rotate -90 deg about X so it faces +Y (into room).
    mat = H.material("WallMat", base_color=P["wall_color"],
                     roughness=0.9, metallic=0.0)
    return H.add_plane("BackWall", size=P["wall_size"],
                       location=P["wall_pos"], rotation=(-90.0, 0.0, 0.0),
                       mat=mat)


def build_counter():
    mat = H.material("CounterMat", base_color=P["counter_color"],
                     roughness=0.7, metallic=0.0)
    return H.add_box("Counter", size=P["counter_size"],
                     location=P["counter_pos"], mat=mat)


def tri_count(obj):
    """Triangulated face count of the evaluated object."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    n = len(bm.calc_loop_triangles())
    bm.free()
    ev.to_mesh_clear()
    return n


def export_glb(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:  # already enabled or headless prefs; keep going
        print(f"[smoke] addon_enable io_scene_gltf2: {exc!r}")
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB")
    return path


def main():
    H.reset_scene()  # idempotent: start from an empty scene every run

    floor = build_floor()
    wall = build_wall()
    counter = build_counter()

    # Sanity: nothing floating or sunk (floor/wall/counter bases at z=0).
    H.ground_contacts([floor, wall, counter], ground_z=0.0)

    # No .blend1 backup sidecar: this session only, user prefs untouched.
    bpy.context.preferences.filepaths.save_version = 0
    H.save_blend(str(BLEND_PATH))
    export_glb(GLB_PATH)

    H.report()
    total_tris = 0
    for obj in (floor, wall, counter):
        n = tri_count(obj)
        total_tris += n
        print(f"[smoke] {obj.name}: {n} tris")
    print(f"[smoke] total: {total_tris} tris")
    print(f"[smoke] Blender {bpy.app.version_string}")
    print(f"[smoke] wrote {BLEND_PATH} ({BLEND_PATH.stat().st_size} bytes)")
    print(f"[smoke] wrote {GLB_PATH} ({GLB_PATH.stat().st_size} bytes)")
    print(f"[smoke] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']} "
          f"cameras={[o.name for o in bpy.data.objects if o.type == 'CAMERA']}")


main()
