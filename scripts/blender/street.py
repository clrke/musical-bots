"""Street set: Phase 4 environment (.blend -> .glb).

Builds a NIGHT street exterior (metres, Blender Z-up): 14x8 asphalt
road running along X, 2 raised sidewalks with curbs flanking its
long sides (north/back + south/front), 2 building facades per side
(heights 4-7m, emissive windows mixed warm/cool facing the street),
2 streetlamps on the north sidewalk (pole + arm + head + emissive
globe) with 2 warm POINT lights (#ffb46b, energy 6.0), 1 dim cool
moon-ish FILL point light (#9db8ff, energy 2.0) high up, red fire
hydrant, bus-stop sign (pole + emissive sign plane facing the
camera). Scene background stays dark code-side (no world lighting
baked here).

Layout follows the diner/house pattern: the set dresses the back
(Blender +Y = three.js -Z, away from the staging camera at
three.js (0, 2.2, 7)) and keeps the center clear for the bot
performance area (radius ~3.2). The south facade pair stands
behind the camera so the staging view stays open.

Saves environments/street.blend and exports environments/street.glb.

Idempotent: rerunning reproduces the scene exactly (reset first,
deterministic geometry, no randomness, no timestamps in scene data).

Constraints honored:
  - Center kept clear for the bot performance area (all set pieces
    hug the back and sides; open top, no ceiling).
  - Plain Principled materials only, no textures; the only glTF
    extension used is KHR_lights_punctual (3 point lights, <= 4).
  - Tri budget under 60k.

Run headless per the blender skill:
    blender -b --factory-startup --python-exit-code 1 \\
        -P scripts/blender/street.py
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
BLEND_PATH = ROOT / "environments" / "street.blend"
GLB_PATH = ROOT / "environments" / "street.glb"

P = {
    "road_size": (14.0, 8.0),   # x, y extent (metres), top at z=0
    "road_color": "#2A2D33",    # dark gray asphalt
    # Sidewalks (raised slabs + curbs) flank the road's long sides.
    "walk_y": 5.0,              # slab center; slabs span y in [4.0, 6.0]
    "walk_d": 2.0,
    "walk_top": 0.12,
    "walk_color": "#6E6E72",    # concrete gray
    "curb_y": 4.0,              # curb center; spans y in [3.875, 4.125]
    "curb_d": 0.25,
    "curb_top": 0.15,
    "curb_color": "#8E8E93",    # lighter concrete
    # Buildings: 2 facades per side. North pair (back, faces the camera);
    # south pair stands behind the staging camera so the view stays open.
    "bld_x": (-3.6, 3.6),
    "bld_w": 4.2,               # width along x
    "bld_north_y": 6.5,         # box center (1.0 deep; face at y=6.0)
    "bld_south_y": -8.05,       # box center (face at y=-7.55, behind camera)
    # (height, muted color) per facade: N0, N1, S0, S1.
    "blds": ((6.5, "#6B5D4F"), (4.5, "#4F5D6B"),
            (4.0, "#5D4F5A"), (5.5, "#565048")),
    "win_size": (0.7, 0.9),     # width x height (metres)
    "win_warm": "#ffd9a0",
    "win_cool": "#cfe8ff",
    # Streetlamps on the north sidewalk, arms reaching toward the road.
    "lamps": ((-4.5, 5.0), (4.5, 5.0)),
    "pole_h": 4.5,
    "pole_color": "#23262B",    # near-black steel
    "arm_len": 1.1,             # reach toward the road from the pole
    "arm_z": 4.35,
    "head_size": (0.5, 0.28, 0.12),
    "lamp_emit": "#ffd9a0",     # warm lamp glass (diner baseline)
    "lamp_z": 4.2,              # emissive globe center
    "light_z": 4.02,            # clear below the r=0.12 globe (bottom 4.08);
                                # a light inside the globe mesh is shadow-blocked
    "light_color": "#ffb46b",   # warm lamp light (diner baseline)
    "light_energy": 6.0,        # between the 8W diner and 4W house values
    "fill_pos": (0.0, 0.0, 8.0),
    "fill_color": "#9db8ff",    # dim cool moon-ish fill
    "fill_energy": 2.0,
    # Fire hydrant (red cylinders) on the north sidewalk, east end.
    "hyd_xy": (6.0, 4.9),
    "hyd_color": "#B02020",
    # Bus-stop sign (pole + emissive plane facing the camera) on the
    # north sidewalk, west end.
    "bus_xy": (-6.2, 4.9),
    "bus_emit": "#d8ecff",      # pale sign face
}

BUILT = []  # every object added to the scene, for reporting


def track(obj):
    BUILT.append(obj)
    return obj


def build_road():
    """Single 14x8 plane, one dark-gray Principled, no textures."""
    mat = H.material("RoadMat", base_color=P["road_color"],
                     roughness=0.95, metallic=0.0)
    return track(H.add_plane("Road", size=P["road_size"],
                             location=(0.0, 0.0, 0.0), mat=mat))


def build_sidewalks():
    walk = H.material("WalkMat", base_color=P["walk_color"],
                      roughness=0.9, metallic=0.0)
    curb = H.material("CurbMat", base_color=P["curb_color"],
                      roughness=0.85, metallic=0.0)
    length = P["road_size"][0]
    for side, sy in (("N", 1.0), ("S", -1.0)):
        track(H.add_box(f"Sidewalk{side}",
                        size=(length, P["walk_d"], P["walk_top"]),
                        location=(0.0, sy * P["walk_y"], P["walk_top"] / 2),
                        mat=walk))
        track(H.add_box(f"Curb{side}",
                        size=(length, P["curb_d"], P["curb_top"]),
                        location=(0.0, sy * P["curb_y"], P["curb_top"] / 2),
                        mat=curb))


def _windows_for(height, cx, face_y, facing, mats, tag):
    """Grid of emissive window planes on a facade face.

    facing=-1: face at y=face_y looks toward -Y (north facades, toward
    the staging camera); facing=+1: face looks toward +Y (south pair).
    """
    ww, wh = P["win_size"]
    # Floors every 1.6m starting at z=1.7; 2 columns across the front.
    rows = max(1, int((height - 0.8) // 1.6))
    cols = (-1.05, 1.05)
    n = 0
    for r in range(rows):
        z = 1.7 + r * 1.6
        if z + wh / 2 > height - 0.25:
            break
        for c, dx in enumerate(cols):
            # Deterministic warm/cool checkerboard mix.
            mat = mats[(r + c) % 2]
            rot = (90.0, 0.0, 0.0) if facing < 0 else (-90.0, 0.0, 0.0)
            track(H.add_plane(f"Win{tag}_{n}", size=(ww, wh),
                              location=(cx + dx, face_y + facing * 0.02, z),
                              rotation=rot, mat=mat))
            n += 1


def build_buildings():
    mats = (
        H.material("WinWarmMat", base_color="#201510",
                   roughness=0.4, metallic=0.0,
                   emission=P["win_warm"], emission_strength=1.0),
        H.material("WinCoolMat", base_color="#101418",
                   roughness=0.4, metallic=0.0,
                   emission=P["win_cool"], emission_strength=1.0),
    )
    for i, (h, color) in enumerate(P["blds"]):
        north = i < 2
        tag = f"N{i % 2}" if north else f"S{i % 2}"
        cx = P["bld_x"][i % 2]
        cy = P["bld_north_y"] if north else P["bld_south_y"]
        mat = H.material(f"BldMat{i}", base_color=color,
                         roughness=0.9, metallic=0.0)
        track(H.add_box(f"Building{tag}", size=(P["bld_w"], 1.0, h),
                        location=(cx, cy, h / 2), mat=mat))
        # Windows on the street-facing facade.
        face_y = cy - 0.5 if north else cy + 0.5
        _windows_for(h, cx, face_y, -1 if north else 1, mats, tag)


def _icosphere(name, radius, location, mat):
    # Icosphere, NOT a UV sphere: bmesh.ops.create_uvsphere emits
    # nondeterministic polygon order per run (verified: 4 distinct GLB
    # hashes in 4 runs), while create_icosphere is byte-stable (4/4).
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    obj = bpy.data.objects.new(name, H.mesh_from_bmesh(name, bm))
    H.link(obj)
    obj.location = location
    H.assign(obj, mat)
    H.shade_smooth(obj, angle=35)
    return track(obj)


def build_lamps():
    pole_mat = H.material("PoleMat", base_color=P["pole_color"],
                          roughness=0.5, metallic=0.6)
    globe_mat = H.material("LampGlobeMat", base_color="#201510",
                           roughness=0.4, metallic=0.0,
                           emission=P["lamp_emit"], emission_strength=1.0)
    for i, (x, y) in enumerate(P["lamps"]):
        base = P["walk_top"]  # lamps stand on the sidewalk tops
        # Pole, grounded on the sidewalk.
        track(H.add_cylinder(f"LampPole{i}", radius=0.06,
                             depth=P["pole_h"] - base,
                             location=(x, y, (P["pole_h"] + base) / 2),
                             vertices=12, mat=pole_mat))
        # Arm reaching toward the road (-Y for the north sidewalk).
        hy = y - P["arm_len"]
        track(H.add_box(f"LampArm{i}", size=(0.08, P["arm_len"], 0.08),
                        location=(x, (y + hy) / 2, P["arm_z"]), mat=pole_mat))
        # Head cap over the globe.
        track(H.add_box(f"LampHead{i}", size=P["head_size"],
                        location=(x, hy, P["lamp_z"] + 0.16), mat=pole_mat))
        # Emissive globe hanging under the head.
        _icosphere(f"LampGlobe{i}", 0.12, (x, hy, P["lamp_z"]), globe_mat)


def build_lights():
    for i, (x, y) in enumerate(P["lamps"]):
        hy = y - P["arm_len"]
        track(H.add_light("POINT", name=f"LampLight{i}",
                          location=(x, hy, P["light_z"]),
                          target=(x, hy, 0.0),
                          energy=P["light_energy"],
                          light_color=P["light_color"]))
    track(H.add_light("POINT", name="MoonFill",
                      location=P["fill_pos"],
                      target=(0.0, 0.0, 0.0),
                      energy=P["fill_energy"],
                      light_color=P["fill_color"]))


def build_hydrant():
    mat = H.material("HydrantMat", base_color=P["hyd_color"],
                     roughness=0.5, metallic=0.1)
    x, y = P["hyd_xy"]
    base = P["walk_top"]
    # Body grounded on the sidewalk, domed cap, side nozzles.
    track(H.add_cylinder("HydrantBody", radius=0.12, depth=0.5,
                         location=(x, y, base + 0.25),
                         vertices=16, mat=mat))
    track(H.add_cylinder("HydrantCap", radius=0.09, depth=0.1,
                         location=(x, y, base + 0.55),
                         vertices=16, mat=mat))
    _icosphere("HydrantDome", 0.09, (x, y, base + 0.6), mat)
    for tag, dx in (("A", -1.0), ("B", 1.0)):
        noz = H.add_cylinder(f"HydrantNoz{tag}", radius=0.05, depth=0.14,
                             location=(x + dx * 0.16, y, base + 0.38),
                             rotation=(0.0, 90.0, 0.0),
                             vertices=12, mat=mat)
        track(noz)


def build_bus_sign():
    pole_mat = bpy.data.materials["PoleMat"]
    sign_mat = H.material("BusSignMat", base_color="#101418",
                          roughness=0.4, metallic=0.0,
                          emission=P["bus_emit"], emission_strength=1.0)
    x, y = P["bus_xy"]
    base = P["walk_top"]
    track(H.add_cylinder("BusPole", radius=0.04, depth=2.6,
                         location=(x, y, base + 1.3),
                         vertices=12, mat=pole_mat))
    # Sign plane faces -Y toward the staging camera.
    track(H.add_plane("BusSign", size=(0.6, 0.4),
                      location=(x, y - 0.05, base + 2.3),
                      rotation=(90.0, 0.0, 0.0), mat=sign_mat))


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
        print(f"[street] addon_enable io_scene_gltf2: {exc!r}")
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                              export_lights=True)
    return path


def main():
    H.reset_scene()  # idempotent: start from an empty scene every run
    del BUILT[:]

    build_road()
    build_sidewalks()
    build_buildings()
    build_lamps()
    build_lights()
    build_hydrant()
    build_bus_sign()

    # Sanity: set pieces rest on z=0 (sidewalk-top items excluded by name).
    H.ground_contacts([o for o in BUILT if not o.name.startswith(
        ("Lamp", "Moon", "Win", "Bus", "Hydrant"))], ground_z=0.0)

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
        print(f"[street] {obj.name}: {tri_count(obj)} tris")
    print(f"[street] total: {total_tris} tris (budget 60000)")
    print(f"[street] Blender {bpy.app.version_string}")
    print(f"[street] wrote {BLEND_PATH} ({BLEND_PATH.stat().st_size} bytes)")
    print(f"[street] wrote {GLB_PATH} ({GLB_PATH.stat().st_size} bytes)")
    print(f"[street] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']} "
          f"cameras={[o.name for o in bpy.data.objects if o.type == 'CAMERA']}")


main()
