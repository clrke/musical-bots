"""Haunted set (.blend -> .glb).

A friendly-spooky churchyard at night (metres, Blender Z-up; three.js x = x, z = -y):
  - mossy ground running out to the camera, a flagstone path up to the GATE in an iron fence across the back;
  - beyond the gate the old chapel, gravestones, crooked trees and two little ghosts;
  - this side of the fence: GRAVES at the back left, the bubbling CAULDRON on the left, the PUMPKINS and a grinning
    jack-o'-lantern at the back right; glowing lamps on the gate pillars and orange pumpkin light.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky (a big moon, stars) is a painted panorama drawn code-side
(environments/skies/haunted.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/haunted.blend and exports environments/haunted.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/haunted.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "haunted.blend"
GLB_PATH = K.ROOT / "environments" / "haunted.glb"

P = {
    "ground": "#4C5E4E",
    "fence_y": 5.0,               # the fence line (three.js z = -5)
    "gate_x": 1.35,               # the gate's posts at +-gate_x
    "lamp_color": "#ffb45a",
    "lamp_energy": 4.0,           # W in Blender = candela in three.js (RAW export)
    "pumpkin_energy": 3.0,
    "cauldron_energy": 2.5,
}


def build_ground():
    ground = H.material("GroundMat", base_color=P["ground"], roughness=0.95, metallic=0.0)
    box("Ground", -80.0, 80.0, -20.0, 90.0, -0.08, 0.0, ground)
    stone = H.material("FlagstoneMat", base_color="#8B8794", roughness=0.9, metallic=0.0)
    # flagstones from the front up to the gate and on to the chapel (a few mm proud of the ground)
    y = -6.0
    i = 0
    while y < 9.2:
        w = 0.9 + 0.25 * ((i * 7) % 3) / 2
        dx = 0.12 * (((i * 5) % 3) - 1)
        box(f"Flagstone{i:02d}", dx - w / 2, dx + w / 2, y, y + 0.62, 0.0, 0.012, stone)
        y += 0.78
        i += 1
    # rolling dark hills far off (the moonlit horizon)
    hill = H.material("HillMat", base_color="#2E3A40", roughness=0.95, metallic=0.0)
    for i, (x, y, sx, sy, sz) in enumerate(((-30.0, 50.0, 30.0, 14.0, 9.0), (18.0, 58.0, 34.0, 14.0, 11.0),
                                            (60.0, 45.0, 24.0, 12.0, 8.0))):
        h = K.icosphere(f"Hill{i}", 1.0, (x, y, -sz * 0.35 - 0.1 * i), hill, subdivisions=3)
        h.scale = (sx, sy, sz)


def build_fence():
    """Iron fence segments either side of the gate (a hair apart: no shared end posts), stone gate posts, an arch."""
    fy = P["fence_y"]
    gx = P["gate_x"]
    for side in (-1.0, 1.0):
        for k in range(4):
            x = side * (gx + 0.25 + 1.3 + k * 2.56)
            K.prop("IronFence", f"Fence{'L' if side < 0 else 'R'}{k}", (x, fy, 0.0), rot=0.0, scale=1.0)
    stone = H.material("PillarMat", base_color="#77707F", roughness=0.85, metallic=0.0)
    cap = H.material("PillarCapMat", base_color="#5F5868", roughness=0.85, metallic=0.0)
    glow = K.emissive("GateLampMat", "#ffb45a", base="#2a1606", strength=1.0)
    iron = H.material("IronMat", base_color="#22202A", roughness=0.5, metallic=0.6)
    for tag, s in (("L", -1.0), ("R", 1.0)):
        x = s * gx
        box(f"GatePost{tag}", x - 0.22, x + 0.22, fy - 0.22, fy + 0.22, 0.0, 2.0, stone)
        box(f"GatePostCap{tag}", x - 0.27, x + 0.27, fy - 0.27, fy + 0.27, 2.0, 2.12, cap)
        K.icosphere(f"GateLamp{tag}", 0.16, (x, fy, 2.3), glow, subdivisions=2)
        track(H.add_light("POINT", name=f"GateLight{tag}", location=(x, fy - 0.4, 2.3), target=(x, fy, 0.0),
                          energy=P["lamp_energy"], light_color=P["lamp_color"]))
    # the gate stands open: its two leaves swung in (along the path, beyond the posts); an iron arch with a sign
    for tag, s in (("L", -1.0), ("R", 1.0)):
        x = s * (gx - 0.12)
        y0 = fy + 0.3
        for j in range(6):
            y = y0 + 0.1 + j * 0.18
            box(f"GateBar{tag}{j}", x - 0.018, x + 0.018, y - 0.018, y + 0.018, 0.05, 1.7 + 0.08 * (j % 2), iron)
        box(f"GateRail{tag}", x - 0.028, x + 0.028, y0, y0 + 1.05, 0.4, 0.46, iron)
        box(f"GateRail{tag}2", x - 0.028, x + 0.028, y0, y0 + 1.05, 1.4, 1.46, iron)
    K.tube("GateArch", [(-gx, fy, 2.35), (-0.8, fy, 2.9), (0.0, fy, 3.1), (0.8, fy, 2.9), (gx, fy, 2.35)], 0.04, iron,
           resolution=8)
    board = H.material("SignBoardMat", base_color="#4A3426", roughness=0.85, metallic=0.0)
    box("GateSign", -0.75, 0.75, fy - 0.03, fy + 0.03, 2.38, 2.78, board)
    paint = K.emissive("SignPaintMat", "#e8f0ff", base="#cfd8e8", strength=0.4)
    K.text_mesh("GateSignText", "BOO!", 0.3, (-0.36, fy - 0.045, 2.47), paint, extrude=0.01)


def build_churchyard():
    """Beyond the fence: the chapel, gravestones, crooked trees, two friendly ghosts."""
    K.prop("HauntedChapel", "Chapel", (0.0, 13.6, 0.0), rot=0.0, scale=0.78)
    graves = (("Gravestone_A", -3.4, 6.4, 8.0), ("Gravestone_B", -5.2, 7.1, -12.0), ("Gravestone_C", -7.0, 6.2, 5.0),
              ("Gravestone_A", -2.6, 8.4, -6.0), ("Gravestone_B", 3.0, 6.6, 10.0), ("Gravestone_C", 4.9, 7.6, -8.0),
              ("Gravestone_A", 6.8, 6.3, 14.0), ("Gravestone_B", 2.4, 8.8, -4.0), ("Gravestone_C", -4.6, 9.4, 0.0))
    for i, (name, x, y, r) in enumerate(graves):
        K.prop(name, f"Grave{i}", (x, y, 0.0), rot=r, scale=0.85)
    K.prop("DeadTree_A_LOD1", "DeadTree", (-9.5, 7.8, 0.0), rot=30.0, scale=0.75)
    K.prop("DeadTree_B_LOD1", "DeadTree2", (9.2, 8.6, 0.0), rot=-40.0, scale=0.7)
    K.prop("SpookyTree_LOD1", "SpookyTree", (12.0, 13.0, 0.0), rot=0.0, scale=0.7)
    K.prop("SpookyTree_LOD1", "SpookyTree2", (-13.5, 12.0, 0.0), rot=60.0, scale=0.8)
    ghost = K.emissive("GhostMat", "#d8e6ff", base="#eef3ff", strength=0.35, roughness=0.6)
    eye = H.material("GhostEyeMat", base_color="#1A1A2A", roughness=0.5, metallic=0.0)
    for i, (x, y, z, s) in enumerate(((-5.0, 6.8, 1.7, 1.0), (6.0, 8.2, 2.3, 0.8))):
        head = K.icosphere(f"Ghost{i}", 0.34 * s, (x, y, z), ghost, subdivisions=2)
        head.scale = (1.0, 1.0, 1.15)
        track(H.add_cone(f"GhostTail{i}", radius=0.34 * s, depth=0.55 * s, location=(x, y, z - 0.42 * s),
                         rotation=(180.0, 0.0, 0.0), vertices=12, mat=ghost, smooth=False))
        for j, dx in enumerate((-0.11, 0.11)):
            K.icosphere(f"GhostEye{i}{j}", 0.05 * s, (x + dx * s, y - 0.31 * s, z + 0.08 * s), eye, subdivisions=1)


def build_props():
    # graves this side of the fence (the GRAVES mark), the cauldron (left), the pumpkins (right)
    for i, (name, x, y, r) in enumerate((("Gravestone_B", -4.6, 3.9, 6.0), ("Gravestone_A", -3.4, 4.3, -10.0),
                                          ("Gravestone_C", -5.9, 4.5, 12.0))):
        K.prop(name, f"NearGrave{i}", (x, y, 0.0), rot=r, scale=0.8)
    K.prop("Haunted_Cauldron", "Cauldron", (-6.1, 2.3, 0.0), rot=20.0, scale=0.65)
    brew = K.emissive("BrewMat", "#6dff8a", base="#1e5a2a", strength=1.0)
    for i, (dx, dy, z, r) in enumerate(((0.0, 0.0, 1.32, 0.11), (0.14, -0.08, 1.45, 0.07), (-0.1, 0.06, 1.55, 0.05))):
        K.icosphere(f"Bubble{i}", r, (-6.1 + dx, 2.3 + dy, z), brew, subdivisions=1)
    track(H.add_light("POINT", name="CauldronLight", location=(-6.1, 2.3, 1.7), target=(-6.1, 2.3, 0.0),
                      energy=P["cauldron_energy"], light_color="#7dff9a"))
    K.prop("Haunted_JackOLantern", "JackOLantern", (4.1, 3.9, 0.0), rot=-15.0, scale=0.55)
    K.prop("Haunted_Pumpkins", "Pumpkins", (5.7, 3.3, 0.0), rot=-70.0, scale=0.6)
    track(H.add_light("POINT", name="PumpkinLight", location=(4.1, 3.3, 0.9), target=(4.1, 3.9, 0.0),
                      energy=P["pumpkin_energy"], light_color="#ff9a3a"))


def main():
    K.reset()
    build_ground()
    build_fence()
    build_churchyard()
    build_props()
    K.export("haunted", BLEND_PATH, GLB_PATH)


main()
