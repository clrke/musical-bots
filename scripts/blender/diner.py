"""Diner set (.blend -> .glb).

A 1950s diner interior (metres, Blender Z-up; three.js x = x, z = -y):
  - 10 m wide checker floor running out to the camera (y in [-6, 4]);
  - back wall (y = 4) with two real doorways: the street DOOR at the left (daylight beyond) and
    the KITCHEN door at the right, plus a pass-through HATCH over the counter; two windows;
  - a lit kitchen behind the back wall (shelf, pots, warm light) seen through the hatch + door;
  - side walls x = +-5 from y = -1 to the back, a ceiling at 3.2;
  - counter + 3 stools in front of the hatch, a booth on each side wall (forward, so the back
    corners stay free as walkways to the doors), pendants and a ceiling light, a red neon DINER sign.
The centre (x in [-3, 3], y in [-6, 2]) stays clear: the bots perform there (web/src/blocking.js
reads the marks from web/src/scene/environments/sets.js, which follows this layout).

Saves environments/diner.blend and exports environments/diner.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/diner.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "diner.blend"
GLB_PATH = K.ROOT / "environments" / "diner.glb"

P = {
    "x": (-5.0, 5.0),
    "floor_y": (-6.0, 4.0),       # floor runs out toward the camera (Blender -Y)
    "tile": 1.0,
    "floor_a": "#EDE6D6",         # cream tiles
    "floor_b": "#A93226",         # diner-red tiles
    "wall_h": 3.2,
    "wall_y": 4.0,                # back wall front face (three.js z = -4)
    "wall_t": 0.12,
    "side_y0": -1.0,              # side walls run from here to the back wall
    "wall_color": "#F2EAD8",
    "trim": "#7B241C",            # dark red frames and trims
    "door": (-4.75, -3.65, 2.2),  # street door: x0, x1, top (1.1 m: a head + hands fit)
    "kitchen": (3.65, 4.75, 2.2),  # kitchen door
    "hatch": (-0.85, 0.85, 1.3, 2.05),  # pass-through: x0, x1, z0, z1
    "window_size": (2.0, 1.4),
    "window_x": (-2.35, 2.35),  # clear of the door trims and the hatch
    "window_z": 1.9,
    "window_emit": "#cfe8ff",     # cool daylight
    "counter_size": (4.4, 0.6, 0.92),
    "counter_pos": (0.0, 3.35, 0.46),
    "counter_color": "#B03A2E",
    "chrome": "#D8D8D8",
    "stool_x": (-1.5, 0.0, 1.5),
    "stool_y": 2.5,
    "vinyl": "#B03A2E",
    "booth_x": 4.15,
    "booth_y": 1.0,               # three.js z = -1: forward of the doorway walkways
    "table_top": "#EDE6D6",
    "pendant_x": (-1.05, 1.05),   # either side of the sign over the hatch
    "pendant_y": 3.35,
    "shade_z": 1.98,
    "bulb_z": 1.77,
    "light_z": 1.70,
    "light_color": "#ffb46b",
    "light_energy": 9.0,          # W in Blender = candela in three.js (RAW export)
    "ceiling_light": 10.0,
    "kitchen_light": 6.0,
    "neon": "#ff3b3b",
}


def build_floor():
    """Single-mesh checker floor, two Principled materials, no textures."""
    import bmesh
    mat_a = H.material("FloorMatA", base_color=P["floor_a"], roughness=0.55, metallic=0.0)
    mat_b = H.material("FloorMatB", base_color=P["floor_b"], roughness=0.55, metallic=0.0)
    x0, x1 = P["x"]
    y0, y1 = P["floor_y"]
    nx, ny = round((x1 - x0) / P["tile"]), round((y1 - y0) / P["tile"])
    bm = bmesh.new()
    for ix in range(nx):
        for iy in range(ny):
            ax, ay = x0 + ix * P["tile"], y0 + iy * P["tile"]
            v = [bm.verts.new(c) for c in ((ax, ay, 0.0), (ax + P["tile"], ay, 0.0),
                                           (ax + P["tile"], ay + P["tile"], 0.0), (ax, ay + P["tile"], 0.0))]
            bm.faces.new(v).material_index = (ix + iy) % 2
    mesh = H.mesh_from_bmesh("Floor", bm)
    mesh.materials.append(mat_a)
    mesh.materials.append(mat_b)
    track(H.link(H.bpy.data.objects.new("Floor", mesh)))


def build_shell():
    wall = H.material("WallMat", base_color=P["wall_color"], roughness=0.9, metallic=0.0)
    trim = H.material("FrameMat", base_color=P["trim"], roughness=0.6, metallic=0.0)
    h, y, t = P["wall_h"], P["wall_y"], P["wall_t"]
    d0, d1, _ = P["door"]
    k0, k1, _ = P["kitchen"]
    hx0, hx1, hz0, hz1 = P["hatch"]
    K.wall_with_openings("BackWall", P["x"][0] - t, P["x"][1] + t, y, y + t, h, [
        (d0, d1, 0.0, P["door"][2]),
        (hx0, hx1, hz0 - 0.04, hz1),  # (the steel sill fills the bottom 4 cm: no shared top face)
        (k0, k1, 0.0, P["kitchen"][2]),
    ], wall)
    # the side walls stop at the back wall's front face (the back wall runs across their ends: no shared faces)
    for tag, sx in (("L", -1.0), ("R", 1.0)):
        x_in = sx * P["x"][1]
        box(f"SideWall{tag}", min(x_in, x_in + sx * t), max(x_in, x_in + sx * t),
            P["side_y0"], y, 0.0, h, wall)
    # ceiling: warm cream, a thin slab so it reads from any side
    box("Ceiling", P["x"][0] - t, P["x"][1] + t, P["side_y0"], y + t, h, h + 0.05,
        H.material("CeilingMat", base_color="#E9DDC4", roughness=0.95, metallic=0.0))
    # a red chair rail along the walls (the diner stripe)
    # (broken at the doorways: the bots walk through them)
    for i, (xa, xb) in enumerate(((P["x"][0], d0 - 0.1), (d1 + 0.1, k0 - 0.1), (k1 + 0.1, P["x"][1]))):
        box(f"RailBack{i}", xa, xb, y - 0.03, y, 1.02, 1.12, trim)
    for tag, sx in (("L", -1.0), ("R", 1.0)):
        x_in = sx * P["x"][1]
        box(f"Rail{tag}", min(x_in, x_in - sx * 0.03), max(x_in, x_in - sx * 0.03), P["side_y0"], y - 0.03, 1.02, 1.12, trim)
    # door + kitchen trims, the hatch frame and its stainless sill
    K.door_trim("Door", d0, d1, y + t / 2, P["door"][2], trim)
    K.door_trim("KitchenDoor", k0, k1, y + t / 2, P["kitchen"][2], trim)
    steel = H.material("SteelMat", base_color="#C9CDD2", roughness=0.25, metallic=0.9)
    box("HatchSill", hx0 - 0.1, hx1 + 0.1, y - 0.12, y + t + 0.05, hz0 - 0.04, hz0, steel)
    box("HatchHead", hx0 - 0.1, hx1 + 0.1, y - 0.05, y + t + 0.02, hz1 - K.REVEAL, hz1 + 0.08, trim)


def build_outside():
    """Daylight beyond the street door: a small vestibule with a bright backdrop."""
    x0, x1 = P["door"][0] - 0.6, P["door"][1] + 0.6
    y0, y1 = P["wall_y"] + P["wall_t"], P["wall_y"] + 1.1
    walk = H.material("OutsideFloorMat", base_color="#8E8E93", roughness=0.9, metallic=0.0)
    box("OutsideFloor", x0, x1, y0, y1, -0.02, 0.0, walk)
    sky = K.emissive("OutsideMat", "#d6ecff", base="#d6ecff", strength=1.0)
    track(H.add_plane("Outside", size=(x1 - x0, 3.0), location=((x0 + x1) / 2, y1, 1.5),
                      rotation=(90.0, 0.0, 0.0), mat=sky))
    side = H.material("OutsideSideMat", base_color="#B9C3CC", roughness=0.9, metallic=0.0)
    for tag, x in (("L", x0), ("R", x1)):
        track(H.add_plane(f"OutsideSide{tag}", size=(3.0, y1 - y0), location=(x, (y0 + y1) / 2, 1.5),
                          rotation=(0.0, 90.0, 0.0), mat=side))


def build_kitchen():
    """A lit kitchen behind the back wall, seen through the hatch and the kitchen door."""
    y0 = P["wall_y"] + P["wall_t"]
    y1 = y0 + 1.6
    x0, x1 = P["hatch"][0] - 0.7, P["x"][1] + 0.12
    tile = H.material("KitchenTileMat", base_color="#F4F2EC", roughness=0.4, metallic=0.0)
    box("KitchenFloor", x0, x1, y0, y1, -0.02, 0.0, tile)
    box("KitchenBack", x0 - 0.1, x1, y1, y1 + 0.1, 0.0, P["wall_h"], tile)
    box("KitchenSideL", x0 - 0.1, x0, y0, y1, 0.0, P["wall_h"], tile)
    box("KitchenSideR", x1 - 0.12, x1, y0, y1, 0.0, P["wall_h"], tile)
    box("KitchenCeiling", x0 - 0.1, x1, y0, y1 + 0.1, P["wall_h"], P["wall_h"] + 0.05, tile)
    steel = H.material("KitchenSteelMat", base_color="#B8BEC4", roughness=0.3, metallic=0.85)
    # a stainless prep table under the hatch and a shelf of pots above it
    box("PrepTable", P["hatch"][0] - 0.2, P["hatch"][1] + 0.2, y1 - 0.75, y1 - 0.05, 0.0, 0.92, steel)
    box("Shelf", P["hatch"][0] - 0.2, P["hatch"][1] + 0.2, y1 - 0.35, y1 - 0.05, 1.75, 1.79, steel)
    pot = H.material("PotMat", base_color="#3A3D42", roughness=0.35, metallic=0.8)
    copper = H.material("CopperMat", base_color="#C46A3A", roughness=0.3, metallic=0.9)
    for i, (x, r, h, m) in enumerate(((-0.45, 0.16, 0.22, pot), (0.05, 0.13, 0.28, copper), (0.5, 0.18, 0.18, pot))):
        track(H.add_cylinder(f"Pot{i}", radius=r, depth=h, location=(x, y1 - 0.2, 1.79 + h / 2), vertices=20, mat=m))
    # a heat-lamp glow strip over the prep table
    track(H.add_plane("HeatLamp", size=(1.6, 0.12), location=(0.0, y1 - 0.4, 2.3), rotation=(180.0, 0.0, 0.0),
                      mat=K.emissive("HeatLampMat", "#ffb070", base="#201510", strength=1.0)))
    track(H.add_light("POINT", name="KitchenLight", location=(1.5, y0 + 0.8, 2.4), target=(1.5, y0 + 0.8, 0.0),
                      energy=P["kitchen_light"], light_color="#ffc890"))


def build_windows():
    glass = K.emissive("WindowMat", P["window_emit"])
    frame = H.bpy.data.materials["FrameMat"]
    ww, wh = P["window_size"]
    for i, x in enumerate(P["window_x"]):
        track(H.add_plane(f"WindowFrame{i}", size=(ww + 0.24, wh + 0.24),
                          location=(x, P["wall_y"] - 0.02, P["window_z"]), rotation=(90.0, 0.0, 0.0), mat=frame))
        track(H.add_plane(f"Window{i}", size=(ww, wh),
                          location=(x, P["wall_y"] - 0.04, P["window_z"]), rotation=(90.0, 0.0, 0.0), mat=glass))


def build_counter():
    body = H.material("CounterMat", base_color=P["counter_color"], roughness=0.5, metallic=0.0)
    top = H.material("CounterTopMat", base_color=P["chrome"], roughness=0.3, metallic=0.9)
    cx, cy, cz = P["counter_pos"]
    sx, sy, sz = P["counter_size"]
    track(H.add_box("Counter", size=P["counter_size"], location=P["counter_pos"], mat=body))
    track(H.add_box("CounterTop", size=(sx + 0.2, sy + 0.15, 0.06), location=(cx, cy, cz + sz / 2 + 0.03), mat=top))


def build_stools():
    vinyl = H.material("VinylMat", base_color=P["vinyl"], roughness=0.4, metallic=0.0)
    chrome = H.material("ChromeMat", base_color=P["chrome"], roughness=0.3, metallic=0.9)
    for i, x in enumerate(P["stool_x"]):
        y = P["stool_y"]
        track(H.add_cylinder(f"StoolSeat{i}", radius=0.19, depth=0.10, location=(x, y, 0.70), vertices=24, mat=vinyl))
        track(H.add_cylinder(f"StoolPole{i}", radius=0.035, depth=0.62, location=(x, y, 0.34), vertices=16, mat=chrome))
        track(H.add_cylinder(f"StoolBase{i}", radius=0.17, depth=0.05, location=(x, y, 0.025), vertices=24, mat=chrome))


def build_booths():
    vinyl = H.bpy.data.materials["VinylMat"]
    chrome = H.bpy.data.materials["ChromeMat"]
    top_mat = H.material("TableMat", base_color=P["table_top"], roughness=0.5, metallic=0.0)
    for side, tag in ((-1.0, "L"), (1.0, "R")):
        x = side * P["booth_x"]
        y = P["booth_y"]
        track(H.add_box(f"Table{tag}", size=(1.0, 0.7, 0.07), location=(x, y, 0.72), mat=top_mat))
        track(H.add_box(f"TableLeg{tag}", size=(0.14, 0.14, 0.68), location=(x, y, 0.34), mat=chrome))
        for dy, seat in ((-0.68, "A"), (0.68, "B")):
            by = y + dy
            track(H.add_box(f"Bench{tag}{seat}", size=(1.0, 0.5, 0.14), location=(x, by, 0.45), mat=vinyl))
            outward = 1.0 if dy > 0 else -1.0
            track(H.add_box(f"BenchBack{tag}{seat}", size=(1.0, 0.14, 0.62),
                            location=(x, by + outward * 0.32, 0.83), mat=vinyl))


def build_pendants():
    shade_mat = H.material("ShadeMat", base_color=P["trim"], roughness=0.4, metallic=0.3)
    bulb_mat = K.emissive("BulbMat", "#ffd9a0", base="#201510")
    cord_mat = H.material("CordMat", base_color="#1a1a1a", roughness=0.8, metallic=0.0)
    top = P["wall_h"]
    # two pendants over the counter, their cords clear of the sign over the hatch
    for i, x in enumerate(P["pendant_x"]):
        y = P["pendant_y"]
        cord_lo = P["shade_z"] + 0.13
        track(H.add_cylinder(f"Cord{i}", radius=0.015, depth=top - cord_lo,
                             location=(x, y, (top + cord_lo) / 2), vertices=8, mat=cord_mat))
        track(H.add_cone(f"Shade{i}", radius=0.28, depth=0.26, location=(x, y, P["shade_z"]), vertices=24, mat=shade_mat))
        K.icosphere(f"Bulb{i}", 0.07, (x, y, P["bulb_z"]), bulb_mat)
        track(H.add_light("POINT", name=f"Pendant{i}", location=(x, y, P["light_z"]), target=(x, y, 0.0),
                          energy=P["light_energy"], light_color=P["light_color"]))
    # a round flush light over the floor in front of the counter (the room's own light)
    disc = K.emissive("CeilingLampMat", "#fff1d6", base="#fff1d6", strength=1.0)
    track(H.add_cylinder("CeilingLamp", radius=0.32, depth=0.05, location=(0.0, 0.4, top - 0.025), vertices=32, mat=disc))
    track(H.add_light("POINT", name="CeilingLight", location=(0.0, 0.4, top - 0.25), target=(0.0, 0.4, 0.0),
                      energy=P["ceiling_light"], light_color="#ffe2b8"))


def build_sign():
    neon = K.emissive("NeonMat", P["neon"], base="#3a0606", strength=1.0)
    K.text_mesh("Sign", "DINER", 0.42, (0.0, P["wall_y"] - 0.03, 2.55), neon, extrude=0.015)


def main():
    K.reset()
    build_floor()
    build_shell()
    build_outside()
    build_kitchen()
    build_windows()
    build_counter()
    build_stools()
    build_booths()
    build_pendants()
    build_sign()
    bad = H.ground_contacts([o for o in K.BUILT if o.type == "MESH" and o.name in (
        "Counter", "StoolBase0", "TableLegL", "TableLegR", "SideWallL", "SideWallR", "BackWall_0")], ground_z=0.0)
    print(f"[diner] floating/sunk furniture: {bad}")
    K.export("diner", BLEND_PATH, GLB_PATH)


main()
