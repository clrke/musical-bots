"""Big House set: Phase 4 environment (.blend -> .glb).

Builds a great-room interior (metres, Blender Z-up):
12x10 wood-toned floor, back wall with 2 emissive daylight windows,
2 full-depth side walls, brick fireplace with amber fire, rug, sofa
(base + back + 2 arms + 2 cushions), 10-step staircase with railing
along the right wall, 1 ceiling lamp (cord + shade + bulb) + 3 POINT
lights reusing the tuned diner baseline (energy 8.0, #ffb46b).

Saves environments/big_house.blend and exports environments/big_house.glb.

Idempotent: rerunning reproduces the scene exactly (reset first,
deterministic geometry, no randomness, no timestamps in scene data).

Constraints honored:
  - Center kept clear for the bot performance area (seating hugs the
    back wall, stairs hug the right wall; open top, no ceiling).
  - Plain Principled materials only, no textures; the only glTF
    extension used is KHR_lights_punctual (3 point lights, <= 4).
  - Tri budget under 60k.

Run headless per the blender skill:
    blender -b --factory-startup --python-exit-code 1 \\
        -P scripts/blender/big_house.py
"""

import math
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
BLEND_PATH = ROOT / "environments" / "big_house.blend"
GLB_PATH = ROOT / "environments" / "big_house.glb"

P = {
    "floor_size": (12.0, 10.0),  # x, y extent (metres), top at z=0
    "floor_color": "#8B5A2B",    # wood-plank-toned brown, single material
    "wall_height": 3.2,
    "wall_y": 5.0,               # back wall plane (Blender +Y maps to three.js -Z, away from camera)
    "wall_color": "#F2EAD8",     # warm off-white
    "window_size": (2.2, 1.4),   # width x height (metres)
    "window_x": (-3.5, 3.5),
    "window_z": 1.9,             # center height
    "window_emit": "#cfe8ff",    # cool daylight
    "frame_color": "#FAF6EC",    # white trim frames
    # Fireplace (box + dark opening + emissive amber fire plane).
    "fire_body": (2.2, 0.6, 1.5),
    "fire_pos": (0.0, 4.7, 0.75),
    "brick": "#8B3A2A",          # brick-toned
    "opening": "#14100C",        # dark firebox
    "fire_emit": "#ff9a2a",      # amber fire
    # Rug (thin box, deep red) between sofa and fireplace.
    "rug_size": (3.2, 1.5, 0.04),
    "rug_pos": (0.0, 3.55, 0.02),
    "rug_color": "#7B1F1F",
    # Sofa (muted green), back to camera, facing the fireplace.
    "sofa_color": "#5A7A5A",
    "sofa_xy": (-5.2, 2.5),      # base center; backrest against left wall
    # Staircase along the right wall, ascending toward the back.
    "stair_x": 5.35,             # center; steps span x in [4.8, 5.9]
    "stair_w": 1.1,
    "stair_y0": -1.5,            # first step front edge
    "stair_run": 0.55,           # tread depth per step
    "stair_rise": 0.3,           # rise per step (10 steps -> 3.0 top)
    "stair_n": 10,
    "stair_color": "#6B4226",    # wood brown
    "rail_color": "#4A2E18",     # dark wood railing
    "rail_x": 4.78,              # inner edge of the steps
    # Ceiling lamp over the seating area + 3 warm point lights.
    "lamp_xy": (0.0, 3.3),
    "shade_color": "#5C4033",    # dark bronze shade
    "bulb_emit": "#ffd9a0",      # warm bulb (diner baseline)
    "shade_z": 1.98,
    "bulb_z": 1.75,
    "light_z": 1.60,  # clear below the r=0.09 bulb (bottom 1.66); a light
                      # inside the bulb mesh is shadow-blocked entirely
    "light_color": "#ffb46b",    # warm lamp light (diner baseline)
    "light_energy": 4.0,         # house-tuned (8W diner baseline washed out these walls)
    "fill_xy": ((-3.5, 0.5), (4.0, 1.0)),
    "fill_z": 2.2,
}

BUILT = []  # every object added to the scene, for reporting


def track(obj):
    BUILT.append(obj)
    return obj


def build_floor():
    """Single 12x10 plane, one brown Principled, no textures."""
    mat = H.material("FloorMat", base_color=P["floor_color"],
                     roughness=0.7, metallic=0.0)
    return track(H.add_plane("Floor", size=P["floor_size"],
                             location=(0.0, 0.0, 0.0), mat=mat))


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
        # Slightly larger trim plane reads as a frame border.
        track(H.add_plane(f"WindowFrame{i}", size=(ww + 0.24, wh + 0.24),
                          location=(x, P["wall_y"] - 0.02, P["window_z"]),
                          rotation=(90.0, 0.0, 0.0), mat=frame))
        track(H.add_plane(f"Window{i}", size=(ww, wh),
                          location=(x, P["wall_y"] - 0.04, P["window_z"]),
                          rotation=(90.0, 0.0, 0.0), mat=glass))


def build_side_walls():
    mat = bpy.data.materials["WallMat"]
    h = P["wall_height"]
    d = P["floor_size"][1]  # full-depth sides; front stays open to the camera
    # NOTE: with ±90 deg Y-rotation the plane's local X maps to world Z,
    # so size is (height, depth) here, not (depth, height).
    # Left wall (x=-6) faces +X; right wall (x=+6) faces -X.
    track(H.add_plane("SideWallL", size=(h, d),
                      location=(-P["floor_size"][0] / 2, 0.0, h / 2),
                      rotation=(0.0, 90.0, 0.0), mat=mat))
    track(H.add_plane("SideWallR", size=(h, d),
                      location=(P["floor_size"][0] / 2, 0.0, h / 2),
                      rotation=(0.0, -90.0, 0.0), mat=mat))


def build_fireplace():
    brick = H.material("BrickMat", base_color=P["brick"],
                       roughness=0.9, metallic=0.0)
    dark = H.material("FireboxMat", base_color=P["opening"],
                      roughness=1.0, metallic=0.0)
    fire = H.material("FireMat", base_color="#1a0d05",
                      roughness=0.6, metallic=0.0,
                      emission=P["fire_emit"], emission_strength=1.0)
    bx, by, bz = P["fire_pos"]
    sx, sy, sz = P["fire_body"]
    track(H.add_box("Fireplace", size=P["fire_body"],
                    location=P["fire_pos"], mat=brick))
    # Dark firebox panel proud of the body's front face (front at by - sy/2).
    front = by - sy / 2
    track(H.add_box("FireplaceOpening", size=(1.1, 0.12, 0.75),
                    location=(bx, front - 0.02, 0.475), mat=dark))
    # Amber fire plane just in front of the opening, facing -Y into the room.
    track(H.add_plane("Fire", size=(0.8, 0.45),
                      location=(bx, front - 0.09, 0.42),
                      rotation=(90.0, 0.0, 0.0), mat=fire))


def build_rug():
    mat = H.material("RugMat", base_color=P["rug_color"],
                     roughness=0.95, metallic=0.0)
    track(H.add_box("Rug", size=P["rug_size"],
                    location=P["rug_pos"], mat=mat))


def build_sofa():
    # Against the left wall, length along Y, facing the room: a centered
    # sofa's backrest would occlude the low fire plane from the staging
    # camera (verified in preview), so the fireplace wall stays in view.
    mat = H.material("SofaMat", base_color=P["sofa_color"],
                     roughness=0.9, metallic=0.0)
    cx, cy = P["sofa_xy"]
    # Seat base on the floor, long side along the wall.
    track(H.add_box("SofaBase", size=(0.95, 2.4, 0.45),
                    location=(cx, cy, 0.225), mat=mat))
    # Backrest along the wall-side edge, grounded.
    track(H.add_box("SofaBack", size=(0.25, 2.4, 1.05),
                    location=(cx - 0.6, cy, 0.525), mat=mat))
    # Arms at both ends, grounded.
    track(H.add_box("SofaArmL", size=(0.95, 0.3, 0.65),
                    location=(cx, cy - 1.05, 0.325), mat=mat))
    track(H.add_box("SofaArmR", size=(0.95, 0.3, 0.65),
                    location=(cx, cy + 1.05, 0.325), mat=mat))
    # Two seat cushions resting on the base top (z=0.45), tucked to the arms.
    track(H.add_box("SofaCushionL", size=(0.7, 0.85, 0.18),
                    location=(cx + 0.05, cy - 0.5, 0.54), mat=mat))
    track(H.add_box("SofaCushionR", size=(0.7, 0.85, 0.18),
                    location=(cx + 0.05, cy + 0.5, 0.54), mat=mat))


def _step_top(y):
    """Top height of the solid step under position y (staircase run)."""
    i = min(max(int((y - P["stair_y0"]) // P["stair_run"]), 0), P["stair_n"] - 1)
    return (i + 1) * P["stair_rise"]


def build_stairs():
    mat = H.material("StairMat", base_color=P["stair_color"],
                     roughness=0.8, metallic=0.0)
    # Solid stacked steps: each rises full-height from the floor, grounded.
    for i in range(P["stair_n"]):
        top = (i + 1) * P["stair_rise"]
        yc = P["stair_y0"] + i * P["stair_run"] + P["stair_run"] / 2
        track(H.add_box(f"Step{i:02d}", size=(P["stair_w"], P["stair_run"], top),
                        location=(P["stair_x"], yc, top / 2), mat=mat))


def build_railing():
    mat = H.material("RailMat", base_color=P["rail_color"],
                     roughness=0.7, metallic=0.0)
    run = P["stair_n"] * P["stair_run"]
    rise = P["stair_n"] * P["stair_rise"]
    slope = rise / run
    angle = math.degrees(math.atan2(rise, run))
    y_mid = P["stair_y0"] + run / 2
    z_mid = rise / 2 + 0.9  # handrail rides ~0.9 above the steps
    length = math.hypot(run, rise) + 0.15
    # Sloped handrail along the inner edge; +X rotation raises the +Y end.
    track(H.add_box("Handrail", size=(0.08, length, 0.08),
                    location=(P["rail_x"], y_mid, z_mid),
                    rotation=(angle, 0.0, 0.0), mat=mat))
    # Newel posts from the step tops up to the rail line.
    for tag, y in (("A", P["stair_y0"] + 0.3),
                   ("B", y_mid),
                   ("C", P["stair_y0"] + run - 0.3)):
        top = _step_top(y)
        rail_z = z_mid + (y - y_mid) * slope
        h = rail_z - top
        track(H.add_box(f"RailPost{tag}", size=(0.08, 0.08, h),
                        location=(P["rail_x"], y, top + h / 2), mat=mat))


def build_lamp():
    shade_mat = H.material("ShadeMat", base_color=P["shade_color"],
                           roughness=0.4, metallic=0.3)
    bulb_mat = H.material("BulbMat", base_color="#201510",
                          roughness=0.4, metallic=0.0,
                          emission=P["bulb_emit"], emission_strength=1.0)
    cord_mat = H.material("CordMat", base_color="#1a1a1a",
                          roughness=0.8, metallic=0.0)
    x, y = P["lamp_xy"]
    # Cord from the open top down to the shade.
    track(H.add_cylinder("LampCord", radius=0.015, depth=1.0,
                         location=(x, y, 2.61), vertices=8, mat=cord_mat))
    # Cone shade, apex up; capped bottom hides the interior.
    track(H.add_cone("LampShade", radius=0.35, depth=0.3,
                     location=(x, y, P["shade_z"]),
                     vertices=24, mat=shade_mat))
    # Icosphere bulb, NOT a UV sphere: bmesh.ops.create_uvsphere emits
    # nondeterministic polygon order per run (verified: 4 distinct GLB
    # hashes in 4 runs), while create_icosphere is byte-stable (4/4).
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.09)
    bulb = bpy.data.objects.new("LampBulb", H.mesh_from_bmesh("LampBulb", bm))
    H.link(bulb)
    bulb.location = (x, y, P["bulb_z"])
    H.assign(bulb, bulb_mat)
    H.shade_smooth(bulb, angle=35)
    track(bulb)


def build_lights():
    x, y = P["lamp_xy"]
    track(H.add_light("POINT", name="LampLight",
                      location=(x, y, P["light_z"]),
                      target=(x, y, 0.0),
                      energy=P["light_energy"],
                      light_color=P["light_color"]))
    for i, (fx, fy) in enumerate(P["fill_xy"]):
        track(H.add_light("POINT", name=f"Fill{i}",
                          location=(fx, fy, P["fill_z"]),
                          target=(fx, fy, 0.0),
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
        print(f"[big_house] addon_enable io_scene_gltf2: {exc!r}")
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
    build_fireplace()
    build_rug()
    build_sofa()
    build_stairs()
    build_railing()
    build_lamp()
    build_lights()

    # Sanity: set pieces rest on z=0 (lamp hangs; lights/fire/windows mount).
    H.ground_contacts([o for o in BUILT if not o.name.startswith(
        ("Lamp", "Fill", "Window", "Fire"))], ground_z=0.0)

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
        print(f"[big_house] {obj.name}: {tri_count(obj)} tris")
    print(f"[big_house] total: {total_tris} tris (budget 60000)")
    print(f"[big_house] Blender {bpy.app.version_string}")
    print(f"[big_house] wrote {BLEND_PATH} ({BLEND_PATH.stat().st_size} bytes)")
    print(f"[big_house] wrote {GLB_PATH} ({GLB_PATH.stat().st_size} bytes)")
    print(f"[big_house] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']} "
          f"cameras={[o.name for o in bpy.data.objects if o.type == 'CAMERA']}")


main()
