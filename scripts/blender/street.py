"""Street set (.blend -> .glb).

A night street exterior (metres, Blender Z-up; three.js x = x, z = -y): a 14 x 8 asphalt road
along X with a dashed centre line and a zebra CROSSING, raised sidewalks with curbs on both
sides, two facades per side (lit windows), a far skyline closing the gap between the north
facades, two streetLAMPs on the north sidewalk (warm point lights) and a cool moon fill, a red
fire hydrant, a bus-stop sign and a white picket FENCE. The sky is drawn code-side (it follows
the lighting mood: web/src/scene/environments/stage.js).

The set dresses the back (Blender +Y = three.js -Z) and keeps the road clear for the bots; the
south pair stands behind the staging camera. web/src/scene/environments/sets.js holds the marks.

Saves environments/street.blend and exports environments/street.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/street.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "street.blend"
GLB_PATH = K.ROOT / "environments" / "street.glb"

P = {
    "road_size": (14.0, 8.0),
    "road_color": "#2A2D33",
    "walk_y": 5.0,
    "walk_d": 2.0,
    "walk_top": 0.12,
    "walk_color": "#6E6E72",
    "curb_y": 4.0,
    "curb_d": 0.25,
    "curb_top": 0.15,
    "curb_color": "#8E8E93",
    "bld_x": (-3.6, 3.6),
    "bld_w": 4.2,
    "bld_north_y": 6.5,
    "bld_south_y": -8.05,
    "blds": ((6.5, "#6B5D4F"), (4.5, "#4F5D6B"), (4.0, "#5D4F5A"), (5.5, "#565048")),
    "win_size": (0.7, 0.9),
    "win_warm": "#ffd9a0",
    "win_cool": "#cfe8ff",
    "lamps": ((-4.5, 5.0), (4.5, 5.0)),
    "pole_h": 4.5,
    "pole_color": "#23262B",
    "arm_len": 1.1,
    "arm_z": 4.35,
    "head_size": (0.5, 0.28, 0.12),
    "lamp_emit": "#ffd9a0",
    "lamp_z": 4.2,
    "light_z": 4.02,
    "light_color": "#ffb46b",
    "light_energy": 6.0,          # W in Blender = candela in three.js (RAW export)
    "fill_pos": (0.0, 0.0, 8.0),
    "fill_color": "#9db8ff",
    "fill_energy": 2.0,
    "hyd_xy": (6.0, 4.9),
    "hyd_color": "#B02020",
    "bus_xy": (-6.2, 4.9),
    "bus_emit": "#d8ecff",
    "fence_x": (0.6, 3.6),        # picket fence on the north sidewalk, in front of facade N1
    "fence_y": 5.75,
    "crossing_x": (-3.5, -1.5),   # zebra crossing (stripes run along the road)
    # far skyline: (x centre, width, height, colour)
    "far": ((-6.5, 5.0, 9.0, "#2E3140"), (0.0, 4.6, 11.0, "#262A38"), (6.8, 5.2, 8.0, "#30303C")),
    "far_y": 12.0,
}


def build_road():
    road = H.material("RoadMat", base_color=P["road_color"], roughness=0.95, metallic=0.0)
    track(H.add_plane("Road", size=P["road_size"], location=(0.0, 0.0, 0.0), mat=road))
    paint = H.material("PaintMat", base_color="#E8E8E2", roughness=0.8, metallic=0.0)
    x0, x1 = P["crossing_x"]
    for i in range(8):
        y = -3.5 + i * 1.0
        box(f"Zebra{i}", x0, x1, y - 0.22, y + 0.22, 0.0, 0.006, paint)
    yellow = H.material("LineMat", base_color="#D9A62E", roughness=0.8, metallic=0.0)
    for i, x in enumerate((-6.5, -5.0, 0.0, 1.5, 3.0, 4.5, 6.0)):
        box(f"Dash{i}", x - 0.5, x + 0.5, -0.06, 0.06, 0.0, 0.006, yellow)


def build_sidewalks():
    walk = H.material("WalkMat", base_color=P["walk_color"], roughness=0.9, metallic=0.0)
    curb = H.material("CurbMat", base_color=P["curb_color"], roughness=0.85, metallic=0.0)
    length = P["road_size"][0]
    for side, sy in (("N", 1.0), ("S", -1.0)):
        # the sidewalk starts at the curb's back (no faces shared with it)
        y_in = P["curb_y"] + P["curb_d"] / 2
        y_out = P["walk_y"] + P["walk_d"] / 2
        track(H.add_box(f"Sidewalk{side}", size=(length, y_out - y_in, P["walk_top"]),
                        location=(0.0, sy * (y_in + y_out) / 2, P["walk_top"] / 2), mat=walk))
        track(H.add_box(f"Curb{side}", size=(length, P["curb_d"], P["curb_top"]),
                        location=(0.0, sy * P["curb_y"], P["curb_top"] / 2), mat=curb))


def _windows_for(height, cx, face_y, facing, mats, tag):
    ww, wh = P["win_size"]
    rows = max(1, int((height - 0.8) // 1.6))
    n = 0
    for r in range(rows):
        z = 1.7 + r * 1.6
        if z + wh / 2 > height - 0.25:
            break
        for c, dx in enumerate((-1.05, 1.05)):
            mat = mats[(r + c) % 2]
            rot = (90.0, 0.0, 0.0) if facing < 0 else (-90.0, 0.0, 0.0)
            track(H.add_plane(f"Win{tag}_{n}", size=(ww, wh), location=(cx + dx, face_y + facing * 0.02, z),
                              rotation=rot, mat=mat))
            n += 1


def build_buildings():
    mats = (K.emissive("WinWarmMat", P["win_warm"], base="#201510"), K.emissive("WinCoolMat", P["win_cool"]))
    for i, (h, color) in enumerate(P["blds"]):
        north = i < 2
        tag = f"N{i % 2}" if north else f"S{i % 2}"
        cx = P["bld_x"][i % 2]
        cy = P["bld_north_y"] if north else P["bld_south_y"]
        mat = H.material(f"BldMat{i}", base_color=color, roughness=0.9, metallic=0.0)
        track(H.add_box(f"Building{tag}", size=(P["bld_w"], 1.0, h), location=(cx, cy, h / 2), mat=mat))
        face_y = cy - 0.5 if north else cy + 0.5
        _windows_for(h, cx, face_y, -1 if north else 1, mats, tag)


def build_skyline():
    """Dark far facades behind the north pair, a few lit windows: no hole in the backdrop."""
    warm = H.bpy.data.materials["WinWarmMat"]
    for i, (cx, w, h, color) in enumerate(P["far"]):
        mat = H.material(f"FarMat{i}", base_color=color, roughness=0.95, metallic=0.0)
        y = P["far_y"] + (i % 2) * 1.5
        box(f"Far{i}", cx - w / 2, cx + w / 2, y, y + 1.0, 0.0, h, mat)
        for j, (dx, z) in enumerate(((-1.2, 5.4), (0.9, 7.0), (-0.3, 8.6), (1.4, 3.8))):
            if z + 0.5 < h:
                track(H.add_plane(f"FarWin{i}_{j}", size=(0.6, 0.8), location=(cx + dx, y - 0.02, z),
                                  rotation=(90.0, 0.0, 0.0), mat=warm))
    # the ground between the sidewalk and the skyline (no void at the horizon)
    ground = H.material("FarGroundMat", base_color="#1E2026", roughness=0.95, metallic=0.0)
    box("FarGround", -12.0, 12.0, 6.0, P["far_y"] + 3.0, -0.02, 0.0, ground)


def build_lamps():
    pole_mat = H.material("PoleMat", base_color=P["pole_color"], roughness=0.5, metallic=0.6)
    globe_mat = K.emissive("LampGlobeMat", P["lamp_emit"], base="#201510")
    for i, (x, y) in enumerate(P["lamps"]):
        base = P["walk_top"]
        track(H.add_cylinder(f"LampPole{i}", radius=0.06, depth=P["pole_h"] - base,
                             location=(x, y, (P["pole_h"] + base) / 2), vertices=12, mat=pole_mat))
        hy = y - P["arm_len"]
        track(H.add_box(f"LampArm{i}", size=(0.08, P["arm_len"], 0.08), location=(x, (y + hy) / 2, P["arm_z"]),
                        mat=pole_mat))
        track(H.add_box(f"LampHead{i}", size=P["head_size"], location=(x, hy, P["lamp_z"] + 0.16), mat=pole_mat))
        K.icosphere(f"LampGlobe{i}", 0.12, (x, hy, P["lamp_z"]), globe_mat)


def build_lights():
    for i, (x, y) in enumerate(P["lamps"]):
        hy = y - P["arm_len"]
        track(H.add_light("POINT", name=f"LampLight{i}", location=(x, hy, P["light_z"]), target=(x, hy, 0.0),
                          energy=P["light_energy"], light_color=P["light_color"]))
    track(H.add_light("POINT", name="MoonFill", location=P["fill_pos"], target=(0.0, 0.0, 0.0),
                      energy=P["fill_energy"], light_color=P["fill_color"]))


def build_hydrant():
    mat = H.material("HydrantMat", base_color=P["hyd_color"], roughness=0.5, metallic=0.1)
    x, y = P["hyd_xy"]
    base = P["walk_top"]
    track(H.add_cylinder("HydrantBody", radius=0.12, depth=0.5, location=(x, y, base + 0.25), vertices=16, mat=mat))
    track(H.add_cylinder("HydrantCap", radius=0.09, depth=0.1, location=(x, y, base + 0.55), vertices=16, mat=mat))
    K.icosphere("HydrantDome", 0.09, (x, y, base + 0.6), mat)
    for tag, dx in (("A", -1.0), ("B", 1.0)):
        track(H.add_cylinder(f"HydrantNoz{tag}", radius=0.05, depth=0.14, location=(x + dx * 0.16, y, base + 0.38),
                             rotation=(0.0, 90.0, 0.0), vertices=12, mat=mat))


def build_bus_sign():
    pole_mat = H.bpy.data.materials["PoleMat"]
    sign_mat = K.emissive("BusSignMat", P["bus_emit"])
    x, y = P["bus_xy"]
    base = P["walk_top"]
    track(H.add_cylinder("BusPole", radius=0.04, depth=2.6, location=(x, y, base + 1.3), vertices=12, mat=pole_mat))
    track(H.add_plane("BusSign", size=(0.6, 0.4), location=(x, y - 0.05, base + 2.3), rotation=(90.0, 0.0, 0.0),
                      mat=sign_mat))


def build_fence():
    paint = H.material("FenceMat", base_color="#F4F1EA", roughness=0.7, metallic=0.0)
    x0, x1 = P["fence_x"]
    y = P["fence_y"]
    base = P["walk_top"]
    box("FenceRailLo", x0, x1, y - 0.02, y + 0.02, base + 0.28, base + 0.36, paint)
    box("FenceRailHi", x0, x1, y - 0.02, y + 0.02, base + 0.7, base + 0.78, paint)
    n = int(round((x1 - x0) / 0.17))
    for i in range(n + 1):
        x = x0 + i * (x1 - x0) / n
        box(f"Picket{i:02d}", x - 0.035, x + 0.035, y - 0.045, y - 0.02, base, base + 0.95, paint)


def main():
    K.reset()
    build_road()
    build_sidewalks()
    build_buildings()
    build_skyline()
    build_lamps()
    build_lights()
    build_hydrant()
    build_bus_sign()
    build_fence()
    bad = H.ground_contacts([o for o in K.BUILT if o.type == "MESH" and o.name in (
        "Road", "SidewalkN", "BuildingN0", "Far0")], ground_z=0.0)
    print(f"[street] floating/sunk pieces: {bad}")
    K.export("street", BLEND_PATH, GLB_PATH)


main()
