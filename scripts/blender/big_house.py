"""Big House set (.blend -> .glb).

A great room (metres, Blender Z-up; three.js x = x, z = -y):
  - a plank floor running out to the camera (y in [-7, 5]), walls 3.2 high, a ceiling;
  - back wall (y = 5) with two real doorways: to the GARDEN at the left (a lawn, a hedge, a tree,
    flowers and sky beyond) and to the PORCH at the right (a deck under a porch light), and the
    brick fireplace with its amber fire in the middle;
  - the KITCHEN in the back-left corner (fridge, counter, upper cabinets, a kettle);
  - the sofa against the left wall, the staircase with its railing along the right wall, a rug
    and the ceiling lamp in front of the fireplace.
The centre stays clear for the bots (web/src/scene/environments/sets.js holds the marks).

Saves environments/big_house.blend and exports environments/big_house.glb (lights RAW: W -> cd).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/big_house.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "big_house.blend"
GLB_PATH = K.ROOT / "environments" / "big_house.glb"

P = {
    "x": (-6.0, 6.0),
    "floor_y": (-7.0, 5.0),
    "plank": 0.4,                 # plank width (planks run front to back)
    "floor_a": "#8B5A2B",
    "floor_b": "#7A4E25",
    "wall_h": 3.2,
    "wall_y": 5.0,                # back wall front face (three.js z = -5)
    "wall_t": 0.12,
    "wall_color": "#F2EAD8",
    "trim": "#FAF6EC",            # white trims
    "garden": (-4.6, -3.0, 2.4),  # doorway x0, x1, top
    "porch": (2.85, 4.15, 2.3),
    "fire_body": (2.2, 0.6, 1.5),
    "fire_pos": (0.0, 4.7, 0.75),
    "brick": "#8B3A2A",
    "opening": "#14100C",
    "fire_emit": "#ff9a2a",
    "rug_size": (3.2, 1.5, 0.04),
    "rug_pos": (0.0, 3.55, 0.02),
    "rug_color": "#7B1F1F",
    "sofa_color": "#5A7A5A",
    "sofa_xy": (-5.2, 0.7),       # three.js z = -0.7, against the left wall
    "stair_x": 5.35,
    "stair_w": 1.1,
    "stair_y0": -1.5,
    "stair_run": 0.55,
    "stair_rise": 0.3,
    "stair_n": 10,
    "stair_color": "#6B4226",
    "rail_color": "#4A2E18",
    "rail_x": 4.78,
    "lamp_xy": (0.0, 3.3),
    "shade_color": "#5C4033",
    "shade_z": 1.98,
    "bulb_z": 1.75,
    "light_z": 1.60,
    "light_color": "#ffb46b",
    "light_energy": 4.0,          # W in Blender = candela in three.js (RAW export)
    "fill_xy": ((-3.5, 0.5), (4.0, 1.0)),
    "fill_z": 2.2,
    "porch_light": 3.0,
}


def build_floor():
    """Planks front to back in two browns, one mesh per tone."""
    import bmesh
    a = H.material("FloorMat", base_color=P["floor_a"], roughness=0.6, metallic=0.0)
    b = H.material("FloorMatB", base_color=P["floor_b"], roughness=0.65, metallic=0.0)
    x0, x1 = P["x"]
    y0, y1 = P["floor_y"]
    n = round((x1 - x0) / P["plank"])
    bm = bmesh.new()
    for i in range(n):
        ax = x0 + i * P["plank"]
        # stagger the plank ends so the floor reads as boards, not stripes
        cut = y0 + 1.3 + (i * 7 % 5) * 0.9
        for (ya, yb) in ((y0, cut), (cut, y1)):
            v = [bm.verts.new(c) for c in ((ax, ya, 0.0), (ax + P["plank"], ya, 0.0),
                                           (ax + P["plank"], yb, 0.0), (ax, yb, 0.0))]
            bm.faces.new(v).material_index = (i + (1 if ya > y0 else 0)) % 2
    mesh = H.mesh_from_bmesh("Floor", bm)
    mesh.materials.append(a)
    mesh.materials.append(b)
    track(H.link(H.bpy.data.objects.new("Floor", mesh)))


def build_shell():
    wall = H.material("WallMat", base_color=P["wall_color"], roughness=0.9, metallic=0.0)
    trim = H.material("FrameMat", base_color=P["trim"], roughness=0.6, metallic=0.0)
    h, y, t = P["wall_h"], P["wall_y"], P["wall_t"]
    g0, g1, gt = P["garden"]
    p0, p1, pt = P["porch"]
    K.wall_with_openings("BackWall", P["x"][0] - t, P["x"][1] + t, y, y + t, h,
                         [(g0, g1, 0.0, gt), (p0, p1, 0.0, pt)], wall)
    for tag, sx in (("L", -1.0), ("R", 1.0)):
        x_in = sx * P["x"][1]
        box(f"SideWall{tag}", min(x_in, x_in + sx * t), max(x_in, x_in + sx * t), -5.0, y + t, 0.0, h, wall)
    box("Ceiling", P["x"][0] - t, P["x"][1] + t, -5.0, y + t, h, h + 0.05,
        H.material("CeilingMat", base_color="#F4EEE2", roughness=0.95, metallic=0.0))
    # skirting along the back wall and the trims of both doorways
    box("Skirting", P["x"][0], g0 - 0.1, y - 0.03, y, 0.0, 0.12, trim)
    box("Skirting2", g1 + 0.1, p0 - 0.1, y - 0.03, y, 0.0, 0.12, trim)
    box("Skirting3", p1 + 0.1, P["x"][1], y - 0.03, y, 0.0, 0.12, trim)
    K.door_trim("GardenDoor", g0, g1, y + t / 2, gt, trim)
    K.door_trim("PorchDoor", p0, p1, y + t / 2, pt, trim)


def build_outside():
    """The garden and the porch, seen through the doorways (daylight, no extra lights but one)."""
    y0 = P["wall_y"] + P["wall_t"]
    grass = H.material("GrassMat", base_color="#6FA548", roughness=0.95, metallic=0.0)
    box("Lawn", -9.0, 9.0, y0, 12.0, -0.02, 0.0, grass)
    hedge = H.material("HedgeMat", base_color="#2F6B34", roughness=0.95, metallic=0.0)
    box("Hedge", -9.0, 1.2, 8.6, 9.4, 0.0, 1.4, hedge)
    box("Hedge2", 6.0, 9.0, 8.6, 9.4, 0.0, 1.4, hedge)
    trunk = H.material("TrunkMat", base_color="#5B3A22", roughness=0.9, metallic=0.0)
    track(H.add_cylinder("TreeTrunk", radius=0.14, depth=2.2, location=(-2.2, 7.2, 1.1), vertices=12, mat=trunk))
    K.icosphere("TreeTop", 1.05, (-2.2, 7.2, 2.75), H.material("LeafMat", base_color="#3E8A3A", roughness=0.9), 2)
    for i, (x, c) in enumerate(((-5.4, "#E8505B"), (-4.6, "#F6C343"), (-3.9, "#E8505B"), (-3.2, "#F49AC1"),
                                (-1.0, "#F6C343"), (-0.3, "#F49AC1"), (6.6, "#E8505B"), (7.4, "#F6C343"))):
        K.icosphere(f"Flower{i}", 0.13, (x, 8.35, 0.32), K.emissive(f"FlowerMat{i}", c, base=c, strength=0.15), 1)
    sky = K.emissive("SkyMat", "#bfe3ff", base="#bfe3ff", strength=1.0)
    track(H.add_plane("Sky", size=(20.0, 9.0), location=(0.0, 12.0, 4.0), rotation=(90.0, 0.0, 0.0), mat=sky))
    # the porch: a deck, a post and a light by the door
    deck = H.material("DeckMat", base_color="#A0744A", roughness=0.8, metallic=0.0)
    p0, p1, _ = P["porch"]
    box("PorchDeck", p0 - 1.0, p1 + 1.6, y0, y0 + 1.9, 0.0, 0.12, deck)
    box("PorchPost", p0 - 0.9, p0 - 0.75, y0 + 1.7, y0 + 1.85, 0.12, 2.8, deck)
    box("PorchPost2", p1 + 1.4, p1 + 1.55, y0 + 1.7, y0 + 1.85, 0.12, 2.8, deck)
    box("PorchRoof", p0 - 1.0, p1 + 1.6, y0, y0 + 1.95, 2.8, 2.9, deck)
    K.icosphere("PorchGlobe", 0.09, (p1 + 0.3, y0 + 0.12, 2.0), K.emissive("PorchGlobeMat", "#ffd9a0", base="#201510"))
    track(H.add_light("POINT", name="PorchLight", location=(p1 + 0.3, y0 + 0.4, 1.9), target=(p1 + 0.3, y0 + 0.4, 0.0),
                      energy=P["porch_light"], light_color=P["light_color"]))


def build_fireplace():
    brick = H.material("BrickMat", base_color=P["brick"], roughness=0.9, metallic=0.0)
    dark = H.material("FireboxMat", base_color=P["opening"], roughness=1.0, metallic=0.0)
    fire = K.emissive("FireMat", P["fire_emit"], base="#1a0d05", roughness=0.6)
    bx, by, bz = P["fire_pos"]
    sx, sy, sz = P["fire_body"]
    track(H.add_box("Fireplace", size=P["fire_body"], location=P["fire_pos"], mat=brick))
    mantel = H.material("MantelMat", base_color="#5B3A22", roughness=0.7, metallic=0.0)
    box("Mantel", bx - sx / 2 - 0.1, bx + sx / 2 + 0.1, by - sy / 2 - 0.1, by + sy / 2, sz, sz + 0.08, mantel)
    front = by - sy / 2
    track(H.add_box("FireplaceOpening", size=(1.1, 0.12, 0.75), location=(bx, front - 0.02, 0.475), mat=dark))
    track(H.add_plane("Fire", size=(0.8, 0.45), location=(bx, front - 0.09, 0.42), rotation=(90.0, 0.0, 0.0), mat=fire))
    # a picture frame over the mantel (a warm sunset square)
    frame = H.material("PictureFrameMat", base_color="#3B2A1A", roughness=0.6)
    box("Picture", -0.55, 0.55, P["wall_y"] - 0.04, P["wall_y"], 1.95, 2.7, frame)
    track(H.add_plane("PictureArt", size=(0.92, 0.57), location=(0.0, P["wall_y"] - 0.045, 2.325),
                      rotation=(90.0, 0.0, 0.0), mat=K.emissive("PictureArtMat", "#f2a65a", base="#f2a65a", strength=0.25)))


def build_rug():
    mat = H.material("RugMat", base_color=P["rug_color"], roughness=0.95, metallic=0.0)
    track(H.add_box("Rug", size=P["rug_size"], location=P["rug_pos"], mat=mat))


def build_sofa():
    mat = H.material("SofaMat", base_color=P["sofa_color"], roughness=0.9, metallic=0.0)
    cx, cy = P["sofa_xy"]
    track(H.add_box("SofaBase", size=(0.95, 2.4, 0.45), location=(cx, cy, 0.225), mat=mat))
    track(H.add_box("SofaBack", size=(0.25, 2.4, 1.05), location=(cx - 0.6, cy, 0.525), mat=mat))
    track(H.add_box("SofaArmL", size=(0.95, 0.3, 0.65), location=(cx, cy - 1.05, 0.325), mat=mat))
    track(H.add_box("SofaArmR", size=(0.95, 0.3, 0.65), location=(cx, cy + 1.05, 0.325), mat=mat))
    track(H.add_box("SofaCushionL", size=(0.7, 0.85, 0.18), location=(cx + 0.05, cy - 0.5, 0.54), mat=mat))
    track(H.add_box("SofaCushionR", size=(0.7, 0.85, 0.18), location=(cx + 0.05, cy + 0.5, 0.54), mat=mat))


def build_kitchen():
    """Back-left corner: fridge in the corner, counter + upper cabinets along the left wall."""
    x0 = P["x"][0]
    yb = P["wall_y"]
    steel = H.material("FridgeMat", base_color="#D5DADF", roughness=0.3, metallic=0.55)
    box("Fridge", x0, x0 + 0.75, yb - 0.75, yb, 0.0, 1.9, steel)
    handle = H.material("HandleMat", base_color="#8A9096", roughness=0.25, metallic=0.9)
    box("FridgeHandle", x0 + 0.76, x0 + 0.79, yb - 0.6, yb - 0.55, 0.9, 1.5, handle)
    cab = H.material("CabinetMat", base_color="#9DB4A0", roughness=0.6, metallic=0.0)
    top = H.material("WorktopMat", base_color="#E6E1D8", roughness=0.35, metallic=0.0)
    box("Cabinets", x0, x0 + 0.62, 2.2, yb - 0.8, 0.0, 0.88, cab)
    box("Worktop", x0, x0 + 0.66, 2.15, yb - 0.78, 0.88, 0.93, top)
    box("UpperCabinets", x0, x0 + 0.36, 2.2, yb - 0.8, 1.55, 2.35, cab)
    stove = H.material("StoveMat", base_color="#2B2D30", roughness=0.4, metallic=0.3)
    box("Stove", x0 + 0.05, x0 + 0.6, 2.9, 3.5, 0.93, 0.95, stove)
    kettle = H.material("KettleMat", base_color="#D9534F", roughness=0.25, metallic=0.2)
    track(H.add_cylinder("Kettle", radius=0.11, depth=0.2, location=(x0 + 0.33, 3.2, 1.05), vertices=20,
                         radius_top=0.07, mat=kettle))


def _step_top(y):
    i = min(max(int((y - P["stair_y0"]) // P["stair_run"]), 0), P["stair_n"] - 1)
    return (i + 1) * P["stair_rise"]


def build_stairs():
    mat = H.material("StairMat", base_color=P["stair_color"], roughness=0.8, metallic=0.0)
    for i in range(P["stair_n"]):
        top = (i + 1) * P["stair_rise"]
        yc = P["stair_y0"] + i * P["stair_run"] + P["stair_run"] / 2
        track(H.add_box(f"Step{i:02d}", size=(P["stair_w"], P["stair_run"], top),
                        location=(P["stair_x"], yc, top / 2), mat=mat))


def build_railing():
    mat = H.material("RailMat", base_color=P["rail_color"], roughness=0.7, metallic=0.0)
    run = P["stair_n"] * P["stair_run"]
    rise = P["stair_n"] * P["stair_rise"]
    slope = rise / run
    angle = math.degrees(math.atan2(rise, run))
    y_mid = P["stair_y0"] + run / 2
    z_mid = rise / 2 + 0.9
    length = math.hypot(run, rise) + 0.15
    track(H.add_box("Handrail", size=(0.08, length, 0.08), location=(P["rail_x"], y_mid, z_mid),
                    rotation=(angle, 0.0, 0.0), mat=mat))
    for tag, y in (("A", P["stair_y0"] + 0.3), ("B", y_mid), ("C", P["stair_y0"] + run - 0.3)):
        top = _step_top(y)
        rail_z = z_mid + (y - y_mid) * slope
        h = rail_z - top
        track(H.add_box(f"RailPost{tag}", size=(0.08, 0.08, h), location=(P["rail_x"], y, top + h / 2), mat=mat))


def build_lamp():
    shade_mat = H.material("ShadeMat", base_color=P["shade_color"], roughness=0.4, metallic=0.3)
    bulb_mat = K.emissive("BulbMat", "#ffd9a0", base="#201510")
    cord_mat = H.material("CordMat", base_color="#1a1a1a", roughness=0.8, metallic=0.0)
    x, y = P["lamp_xy"]
    lo = P["shade_z"] + 0.15
    track(H.add_cylinder("LampCord", radius=0.015, depth=P["wall_h"] - lo, location=(x, y, (P["wall_h"] + lo) / 2),
                         vertices=8, mat=cord_mat))
    track(H.add_cone("LampShade", radius=0.35, depth=0.3, location=(x, y, P["shade_z"]), vertices=24, mat=shade_mat))
    K.icosphere("LampBulb", 0.09, (x, y, P["bulb_z"]), bulb_mat)


def build_lights():
    x, y = P["lamp_xy"]
    track(H.add_light("POINT", name="LampLight", location=(x, y, P["light_z"]), target=(x, y, 0.0),
                      energy=P["light_energy"], light_color=P["light_color"]))
    for i, (fx, fy) in enumerate(P["fill_xy"]):
        track(H.add_light("POINT", name=f"Fill{i}", location=(fx, fy, P["fill_z"]), target=(fx, fy, 0.0),
                          energy=P["light_energy"], light_color=P["light_color"]))


def main():
    K.reset()
    build_floor()
    build_shell()
    build_outside()
    build_fireplace()
    build_rug()
    build_sofa()
    build_kitchen()
    build_stairs()
    build_railing()
    build_lamp()
    build_lights()
    bad = H.ground_contacts([o for o in K.BUILT if o.type == "MESH" and o.name in (
        "Fireplace", "SofaBase", "Fridge", "Cabinets", "Step00", "SideWallL", "BackWall_0")], ground_z=0.0)
    print(f"[big_house] floating/sunk furniture: {bad}")
    K.export("big_house", BLEND_PATH, GLB_PATH)


main()
