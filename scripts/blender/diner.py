"""Diner set: Phase 4 environment (.blend -> .glb).

Builds a 1950s-style diner interior (metres, Blender Z-up):
10x8 two-tone checker floor, back wall with 2 emissive windows,
2 half-depth side walls, counter + 3 stools, 2 side booths,
3 pendant shades with warm bulbs + 3 POINT lights.

Saves environments/diner.blend and exports environments/diner.glb.

Idempotent: rerunning reproduces the scene exactly (reset first,
deterministic geometry, no randomness, no timestamps in scene data).

Constraints honored:
  - Center kept clear for the bot performance area (all set pieces hug
    the back wall and sides; open top, no ceiling).
  - Plain Principled materials only, no textures; the only glTF
    extension used is KHR_lights_punctual (3 point lights, <= 4).
  - Tri budget under 60k.

Run headless per the blender skill:
    blender -b --factory-startup --python-exit-code 1 \\
        -P scripts/blender/diner.py
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

# Repo root resolved from this script's location: scripts/blender/ -> root.
ROOT = Path(__file__).resolve().parent.parent.parent
BLEND_PATH = ROOT / "environments" / "diner.blend"
GLB_PATH = ROOT / "environments" / "diner.glb"

P = {
    "floor_size": (10.0, 8.0),    # x, y extent (metres), top at z=0
    "tile": 1.0,                  # checker tile size (metres)
    "floor_a": "#EDE6D6",         # cream tiles
    "floor_b": "#A93226",         # diner-red tiles
    "wall_height": 3.2,
    "wall_y": 4.0,                # back wall plane (Blender +Y maps to three.js -Z, away from camera)
    "wall_color": "#F2EAD8",      # warm off-white
    "window_size": (2.2, 1.4),    # width x height (metres)
    "window_x": (-2.5, 2.5),
    "window_z": 1.9,              # center height
    "window_emit": "#cfe8ff",     # cool daylight
    "frame_color": "#7B241C",     # dark red window frames
    "side_depth": 4.0,            # half-depth side walls (y in [0, 4])
    "counter_size": (4.4, 0.6, 0.92),
    "counter_pos": (0.0, 3.35, 0.46),
    "counter_color": "#B03A2E",   # red laminate
    "counter_top": "#D8D8D8",     # chrome top
    "stool_x": (-1.5, 0.0, 1.5),
    "stool_y": 2.5,
    "vinyl": "#B03A2E",           # red vinyl seats
    "chrome": "#D8D8D8",
    "booth_x": 4.15,              # |x| center of side booths
    "booth_y": 2.0,
    "table_top": "#EDE6D6",
    "shade_color": "#7B241C",     # dark red enamel shades
    "bulb_emit": "#ffd9a0",       # warm bulb
    "pendant_y": 3.35,            # over the counter
    "shade_z": 1.98,              # shade center
    "bulb_z": 1.77,               # bulb center (just below shade rim)
    "light_z": 1.70,
    "light_color": "#ffb46b",     # warm pendant light
    "light_energy": 8.0,
}

BUILT = []  # every object added to the scene, for reporting


def track(obj):
    BUILT.append(obj)
    return obj


def build_floor():
    """Single-mesh 10x8 checker floor, two Principled materials, no textures."""
    mat_a = H.material("FloorMatA", base_color=P["floor_a"],
                       roughness=0.6, metallic=0.0)
    mat_b = H.material("FloorMatB", base_color=P["floor_b"],
                       roughness=0.6, metallic=0.0)
    nx = round(P["floor_size"][0] / P["tile"])
    ny = round(P["floor_size"][1] / P["tile"])
    sx, sy = P["floor_size"]
    bm = bmesh.new()
    for ix in range(nx):
        for iy in range(ny):
            x0 = -sx / 2 + ix * P["tile"]
            y0 = -sy / 2 + iy * P["tile"]
            x1, y1 = x0 + P["tile"], y0 + P["tile"]
            v = [bm.verts.new(c) for c in
                 ((x0, y0, 0.0), (x1, y0, 0.0), (x1, y1, 0.0), (x0, y1, 0.0))]
            face = bm.faces.new(v)
            face.material_index = (ix + iy) % 2  # 0 -> cream, 1 -> red
    mesh = H.mesh_from_bmesh("Floor", bm)
    mesh.materials.append(mat_a)
    mesh.materials.append(mat_b)
    obj = H.link(bpy.data.objects.new("Floor", mesh))
    return track(obj)


def build_back_wall():
    # Plane default faces +Z; rotate +90 deg about X so it faces -Y (into room).
    mat = H.material("WallMat", base_color=P["wall_color"],
                     roughness=0.9, metallic=0.0)
    return track(H.add_plane("BackWall", size=(P["floor_size"][0], P["wall_height"]),
                             location=(0.0, P["wall_y"], P["wall_height"] / 2),
                             rotation=(90.0, 0.0, 0.0), mat=mat))


def build_windows():
    # Principled with emission (stays extension-free in glTF: emissiveFactor).
    glass = H.material("WindowMat", base_color="#101418",
                       roughness=0.4, metallic=0.0,
                       emission=P["window_emit"], emission_strength=1.0)
    frame = H.material("FrameMat", base_color=P["frame_color"],
                       roughness=0.6, metallic=0.0)
    ww, wh = P["window_size"]
    for i, x in enumerate(P["window_x"]):
        # Slightly larger dark backing plane reads as a frame border.
        track(H.add_plane(f"WindowFrame{i}", size=(ww + 0.24, wh + 0.24),
                          location=(x, P["wall_y"] - 0.02, P["window_z"]),
                          rotation=(90.0, 0.0, 0.0), mat=frame))
        track(H.add_plane(f"Window{i}", size=(ww, wh),
                          location=(x, P["wall_y"] - 0.04, P["window_z"]),
                          rotation=(90.0, 0.0, 0.0), mat=glass))


def build_side_walls():
    mat = bpy.data.materials["WallMat"]
    h = P["wall_height"]
    d = P["side_depth"]
    y_mid = P["wall_y"] - d / 2  # spans y in [0, 4]
    # Left wall (x=-5) faces +X; right wall (x=+5) faces -X.
    track(H.add_plane("SideWallL", size=(d, h),
                      location=(-P["floor_size"][0] / 2, y_mid, h / 2),
                      rotation=(0.0, 90.0, 0.0), mat=mat))
    track(H.add_plane("SideWallR", size=(d, h),
                      location=(P["floor_size"][0] / 2, y_mid, h / 2),
                      rotation=(0.0, -90.0, 0.0), mat=mat))


def build_counter():
    body = H.material("CounterMat", base_color=P["counter_color"],
                      roughness=0.5, metallic=0.0)
    top = H.material("CounterTopMat", base_color=P["counter_top"],
                     roughness=0.3, metallic=0.9)
    cx, cy, cz = P["counter_pos"]
    sx, sy, sz = P["counter_size"]
    track(H.add_box("Counter", size=P["counter_size"],
                    location=P["counter_pos"], mat=body))
    track(H.add_box("CounterTop", size=(sx + 0.2, sy + 0.15, 0.06),
                    location=(cx, cy, cz + sz / 2 + 0.03), mat=top))


def build_stools():
    vinyl = H.material("VinylMat", base_color=P["vinyl"],
                       roughness=0.4, metallic=0.0)
    chrome = H.material("ChromeMat", base_color=P["chrome"],
                        roughness=0.3, metallic=0.9)
    for i, x in enumerate(P["stool_x"]):
        y = P["stool_y"]
        track(H.add_cylinder(f"StoolSeat{i}", radius=0.19, depth=0.10,
                             location=(x, y, 0.70), vertices=24, mat=vinyl))
        track(H.add_cylinder(f"StoolPole{i}", radius=0.035, depth=0.62,
                             location=(x, y, 0.34), vertices=16, mat=chrome))
        track(H.add_cylinder(f"StoolBase{i}", radius=0.17, depth=0.05,
                             location=(x, y, 0.025), vertices=24, mat=chrome))


def build_booths():
    vinyl = bpy.data.materials["VinylMat"]
    chrome = bpy.data.materials["ChromeMat"]
    top_mat = H.material("TableMat", base_color=P["table_top"],
                         roughness=0.5, metallic=0.0)
    for side, tag in ((-1.0, "L"), (1.0, "R")):
        x = side * P["booth_x"]
        y = P["booth_y"]
        # Table: white top on a chrome pedestal leg.
        track(H.add_box(f"Table{tag}", size=(1.0, 0.7, 0.07),
                        location=(x, y, 0.72), mat=top_mat))
        track(H.add_box(f"TableLeg{tag}", size=(0.14, 0.14, 0.68),
                        location=(x, y, 0.34), mat=chrome))
        # Two benches facing each other across the table.
        for dy, seat in ((-0.68, "A"), (0.68, "B")):
            by = y + dy
            track(H.add_box(f"Bench{tag}{seat}", size=(1.0, 0.5, 0.14),
                            location=(x, by, 0.45), mat=vinyl))
            # Backrest on the outer edge of each bench.
            outward = 1.0 if dy > 0 else -1.0
            track(H.add_box(f"BenchBack{tag}{seat}",
                            size=(1.0, 0.14, 0.62),
                            location=(x, by + outward * 0.32, 0.83),
                            mat=vinyl))


def build_pendants():
    shade_mat = H.material("ShadeMat", base_color=P["shade_color"],
                           roughness=0.4, metallic=0.3)
    bulb_mat = H.material("BulbMat", base_color="#201510",
                          roughness=0.4, metallic=0.0,
                          emission=P["bulb_emit"], emission_strength=1.0)
    cord_mat = H.material("CordMat", base_color="#1a1a1a",
                          roughness=0.8, metallic=0.0)
    for i, x in enumerate(P["stool_x"]):
        y = P["pendant_y"]
        # Cord from the open top down to the shade.
        track(H.add_cylinder(f"Cord{i}", radius=0.015, depth=1.0,
                             location=(x, y, 2.61), vertices=8, mat=cord_mat))
        # Cone shade, apex up; capped bottom hides the interior.
        track(H.add_cone(f"Shade{i}", radius=0.28, depth=0.26,
                         location=(x, y, P["shade_z"]),
                         vertices=24, mat=shade_mat))
        track(H.add_sphere(f"Bulb{i}", radius=0.07,
                           location=(x, y, P["bulb_z"]),
                           segments=16, rings=8, mat=bulb_mat))
        track(H.add_light("POINT", name=f"Pendant{i}",
                          location=(x, y, P["light_z"]),
                          target=(x, y, 0.0),
                          energy=P["light_energy"],
                          light_color=P["light_color"]))


def tri_count(obj):
    """Triangulated face count of the evaluated object."""
    if obj.type == "LIGHT":
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


def export_glb(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:  # already enabled or headless prefs; keep going
        print(f"[diner] addon_enable io_scene_gltf2: {exc!r}")
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                              export_lights=True)
    return path


def main():
    H.reset_scene()  # idempotent: start from an empty scene every run
    del BUILT[:]

    build_floor()
    build_back_wall()
    build_windows()
    build_side_walls()
    build_counter()
    build_stools()
    build_booths()
    build_pendants()

    # Sanity: furniture bases rest on z=0 (pendant cords hang from open top).
    H.ground_contacts([o for o in BUILT if not o.name.startswith(
        ("Cord", "Shade", "Bulb", "Pendant"))], ground_z=0.0)

    # No .blend1 backup sidecar: this session only, user prefs untouched.
    bpy.context.preferences.filepaths.save_version = 0
    H.save_blend(str(BLEND_PATH))
    export_glb(GLB_PATH)

    H.report()
    total_tris = 0
    for obj in BUILT:
        n = tri_count(obj)
        total_tris += n
    for obj in BUILT:
        print(f"[diner] {obj.name}: {tri_count(obj)} tris")
    print(f"[diner] total: {total_tris} tris (budget 60000)")
    print(f"[diner] Blender {bpy.app.version_string}")
    print(f"[diner] wrote {BLEND_PATH} ({BLEND_PATH.stat().st_size} bytes)")
    print(f"[diner] wrote {GLB_PATH} ({GLB_PATH.stat().st_size} bytes)")
    print(f"[diner] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']} "
          f"cameras={[o.name for o in bpy.data.objects if o.type == 'CAMERA']}")


main()
