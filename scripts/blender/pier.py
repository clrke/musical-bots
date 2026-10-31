"""Pier set (.blend -> .glb).

The docks at golden hour (metres, Blender Z-up; three.js x = x, z = -y):
  - a wide plank deck running out to the camera over the water, pilings along its back edge with a rope between them,
    a narrow walkway on out to the END of the pier;
  - the moored SAILBOAT behind the deck on the left and the little rowBOAT with its lantern on the right, the fishing
    SHACK on the left side, CRATES, barrels and a coiled rope on the right, two LAMP posts at the back;
  - far out: a big sailing ship, a sailboat and a lighthouse on its rock.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky (a low sun) is a painted panorama drawn code-side
(environments/skies/pier.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/pier.blend and exports environments/pier.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/pier.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "pier.blend"
GLB_PATH = K.ROOT / "environments" / "pier.glb"

P = {
    "deck_x": (-9.0, 9.0),
    "deck_y": (-9.0, 5.4),        # the deck's back edge at three.js z = -5.4
    "plank": 0.3,
    "planks": ("#B07A4A", "#9C6A3E", "#BC8656"),
    "water_z": -0.75,
    "walk_x": 1.1,                # the walkway out to the end: x in [-walk_x, walk_x]
    "walk_y1": 17.0,
    "light_color": "#ffc27a",
    "lamp_energy": 4.0,           # W in Blender = candela in three.js (RAW export)
}


def build_water():
    sea = K.color_material("SeaMat", roughness=0.15)
    K.water("Water", -90.0, 90.0, -20.0, 95.0, P["water_z"], "#3C8FAE", "#1D5C8C", sea, rows=(0.0, 0.25, 0.5, 1.0))


def _planks(prefix, x0, x1, y0, y1, mats, along_x=True):
    """Planks with a 1.5 cm gap, each a thin box (top at 0), three tones; the joists under them."""
    p = P["plank"]
    g = 0.015
    n = round(((y1 - y0) if along_x else (x1 - x0)) / p)
    for i in range(n):
        m = mats[(i * 7) % 3]
        if along_x:
            box(f"{prefix}{i:02d}", x0, x1, y0 + i * p + g / 2, y0 + (i + 1) * p - g / 2, -0.08, 0.0, m)
        else:
            box(f"{prefix}{i:02d}", x0 + i * p + g / 2, x0 + (i + 1) * p - g / 2, y0, y1, -0.08, 0.0, m)


def build_deck():
    mats = [H.material(f"PlankMat{i}", base_color=c, roughness=0.8, metallic=0.0) for i, c in enumerate(P["planks"])]
    x0, x1 = P["deck_x"]
    y0, y1 = P["deck_y"]
    _planks("Plank", x0, x1, y0, y1, mats)
    w = P["walk_x"]
    _planks("WalkPlank", -w, w, y1, P["walk_y1"], mats, along_x=True)
    dark = H.material("JoistMat", base_color="#5A3E28", roughness=0.9, metallic=0.0)
    for i, y in enumerate((y0 + 0.4, -3.0, 1.2, y1 - 0.4)):
        box(f"Joist{i}", x0 + 0.2, x1 - 0.2, y - 0.1, y + 0.1, -0.3, -0.08, dark)
    for i, x in enumerate((-w + 0.15, w - 0.15)):
        box(f"WalkJoist{i}", x - 0.1, x + 0.1, y1, P["walk_y1"] - 0.2, -0.3, -0.08, dark)
    # pilings: along the deck's back edge and its sides, either side of the walkway
    post = H.material("PilingMat", base_color="#6E4B30", roughness=0.85, metallic=0.0)
    piles = [(x, y1 + 0.18) for x in (-8.7, -6.5, -4.3, -2.1, 2.1, 4.3, 6.5, 8.7)]
    piles += [(s * 9.2, y) for s in (-1.0, 1.0) for y in (-6.0, -2.5, 1.0, 4.4)]
    piles += [(s * (w + 0.2), y) for s in (-1.0, 1.0) for y in (8.6, 11.8, 15.0)]
    for i, (x, y) in enumerate(piles):
        track(H.add_cylinder(f"Piling{i:02d}", radius=0.15, depth=3.2, location=(x, y, -0.95), vertices=10, mat=post,
                             smooth=False))
        track(H.add_cylinder(f"PilingCap{i:02d}", radius=0.17, depth=0.06, location=(x, y, 0.68), vertices=10, mat=post,
                             smooth=False))
    # a rope along the back edge, sagging between the pilings (gaps at the walkway)
    rope = H.material("RopeMat", base_color="#D9C49A", roughness=0.9, metallic=0.0)
    back = [x for x in (-8.7, -6.5, -4.3, -2.1)]
    for side, xs in (("L", back), ("R", [-x for x in reversed(back)])):
        pts = []
        for a, b in zip(xs, xs[1:]):
            pts += [(a, y1 + 0.18, 0.55), ((a + b) / 2, y1 + 0.18, 0.38)]
        pts.append((xs[-1], y1 + 0.18, 0.55))
        K.tube(f"Rope{side}", pts, 0.025, rope, resolution=6)
    # mooring bollards on the back edge
    iron = H.material("BollardMat", base_color="#2D3036", roughness=0.5, metallic=0.4)
    for i, x in enumerate((-5.4, 5.4)):
        track(H.add_cylinder(f"Bollard{i}", radius=0.13, depth=0.32, location=(x, y1 - 0.3, 0.16), vertices=12, mat=iron))
        track(H.add_cylinder(f"BollardTop{i}", radius=0.18, depth=0.06, location=(x, y1 - 0.3, 0.35), vertices=12,
                             mat=iron))


def build_boats():
    wz = P["water_z"]
    K.prop("Boat_Meadow_1", "SailBoat", (-4.6, 7.2, wz + 0.25), rot=90.0, scale=0.85)
    K.prop("Boat_Meadow_3", "RowBoat", (4.6, 6.6, wz + 0.25), rot=-80.0, scale=0.85)
    K.prop("Boat_Meadow_4", "Ship", (22.0, 38.0, wz), rot=30.0, scale=1.6)
    K.prop("SailBoat", "FarSail", (-20.0, 46.0, wz), rot=-60.0, scale=1.0)
    K.prop("Rock_B_LOD1", "LighthouseRock", (-38.0, 62.0, wz - 1.0), rot=0.0, scale=5.0)
    K.prop("Lighthouse", "Lighthouse", (-38.0, 62.0, wz + 2.4), rot=30.0, scale=0.9)


def build_shack():
    """The fishing shack on the left side: board walls, a door to the deck, a window, a roof and a FISH sign."""
    x0, x1, y0, y1 = -9.4, -6.6, 1.4, 4.8
    wall = H.material("ShackWallMat", base_color="#4F8FB0", roughness=0.85, metallic=0.0)
    trim = H.material("ShackTrimMat", base_color="#F2EBDD", roughness=0.7, metallic=0.0)
    box("ShackWalls", x0, x1, y0, y1, 0.0, 2.4, wall)
    door = H.material("ShackDoorMat", base_color="#8A4E2C", roughness=0.8, metallic=0.0)
    box("ShackDoor", x1, x1 + 0.006, 2.7, 3.6, 0.0, 1.95, door)
    glow = K.emissive("ShackWindowMat", "#ffd9a0", base="#3a2a14", strength=0.8)
    box("ShackWindow", x1, x1 + 0.006, 1.75, 2.45, 1.0, 1.65, glow)
    box("ShackWindowFrame", x1 - 0.02, x1 + 0.003, 1.68, 2.52, 0.93, 1.72, trim)
    roof = H.material("ShackRoofMat", base_color="#C8553D", roughness=0.7, metallic=0.0)
    track(H.add_box("ShackRoofA", size=(1.75, 3.8, 0.1), location=(x0 + 0.62, (y0 + y1) / 2, 2.72),
                    rotation=(0.0, -32.0, 0.0), mat=roof))
    track(H.add_box("ShackRoofB", size=(1.74, 3.82, 0.1), location=(x1 - 0.62, (y0 + y1) / 2, 2.72),
                    rotation=(0.0, 32.0, 0.0), mat=roof))
    board = H.material("SignBoardMat", base_color="#F2EBDD", roughness=0.8, metallic=0.0)
    box("ShackSign", x1 + 0.01, x1 + 0.06, 2.2, 3.9, 2.05, 2.4, board)
    paint = H.material("SignPaintMat", base_color="#C8553D", roughness=0.6, metallic=0.0)
    K.text_mesh("ShackSignText", "FISH", 0.26, (x1 + 0.065, 2.62, 2.11), paint, extrude=0.01, rotation=(90.0, 0.0, 90.0))
    K.prop("Seagull", "ShackGull", (x1 + 0.3, 3.0, 2.82), rot=-90.0, scale=0.7)


def build_cargo():
    K.prop("ShipwreckBay_Crates", "Crates", (5.0, 4.4, 0.0), rot=0.0, scale=0.55)
    K.prop("ShipwreckBay_Barrels", "Barrels", (6.6, 2.7, 0.0), rot=-90.0, scale=0.55)
    K.prop("ShipwreckBay_RopeCoil", "RopeCoil", (3.0, 4.6, 0.0), rot=0.0, scale=0.35)
    K.prop("Meadow_Crate", "Crate", (-3.0, 4.6, 0.0), rot=12.0, scale=0.6)
    for i, (x, y, z, r) in enumerate(((-2.1, 5.58, 0.71, 0.0), (6.5, 5.58, 0.71, 40.0), (3.0, 12.0, 6.0, -20.0),
                                      (-6.0, 14.0, 7.0, 30.0))):
        K.prop("Seagull", f"Gull{i}", (x, y, z), rot=r, scale=0.7)


def build_lamps():
    for i, (x, y) in enumerate(((-1.75, 5.0), (1.75, 5.0))):
        K.prop("LanternPost", f"Lamp{i}", (x, y, 0.0), rot=0.0, scale=0.85)
        track(H.add_light("POINT", name=f"LampLight{i}", location=(x, y - 0.5, 2.5), target=(x, y, 0.0),
                          energy=P["lamp_energy"], light_color=P["light_color"]))


def main():
    K.reset()
    build_water()
    build_deck()
    build_boats()
    build_shack()
    build_cargo()
    build_lamps()
    K.export("pier", BLEND_PATH, GLB_PATH)


main()
