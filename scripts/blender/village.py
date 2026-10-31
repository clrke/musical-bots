"""Village set (.blend -> .glb).

A village square on a sunny day (metres, Blender Z-up; three.js x = x, z = -y):
  - a cobbled square (warm stones, three tones) running out to the camera, grass beyond;
  - two cottages at the back corners (their doors face the square: the left one is the COTTAGE mark's door), a third
    further back, trees, a windmill on the far hill and bunting strung over the back of the square;
  - the stone WELL (back left of centre) and the market STALL (back right), a BENCH on the left, a LAMP on the right.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes the bots walk in by (three.js z -0.4 and 2.2). The sky is a painted panorama drawn code-side
(environments/skies/village.jpg, web/src/scene/environments/stage.js). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/village.blend and exports environments/village.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/village.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "village.blend"
GLB_PATH = K.ROOT / "environments" / "village.glb"

P = {
    "square_x": (-10.2, 10.2),
    "square_y": (-8.4, 7.2),
    "stone": 0.6,
    "stones": ("#D9C4A0", "#CDB48C", "#E2D2B2"),
    "grass": "#7DB656",
    "well_xy": (-1.8, 3.9),
    "stall_xy": (2.6, 4.25),
    "lamp_xy": (6.25, 2.65),
    "light_color": "#ffc98a",
    "lamp_energy": 3.0,           # W in Blender = candela in three.js (RAW export)
}


def build_ground():
    """The cobbled square (one mesh, three stone tones by a fixed hash) and the grass around it."""
    import bmesh
    mats = [H.material(f"CobbleMat{i}", base_color=c, roughness=0.9, metallic=0.0) for i, c in enumerate(P["stones"])]
    x0, x1 = P["square_x"]
    y0, y1 = P["square_y"]
    s = P["stone"]
    nx, ny = round((x1 - x0) / s), round((y1 - y0) / s)
    bm = bmesh.new()
    g = 0.035  # the mortar: a hair of gap between stones, the grout plane under them
    for iy in range(ny):
        ay = y0 + iy * s
        off = (s / 2) if iy % 2 else 0.0  # running bond: odd rows start half a stone early (clipped at the edges)
        for ix in range(nx + (1 if off else 0)):
            ax, bx = max(x0, x0 - off + ix * s), min(x1, x0 - off + (ix + 1) * s)
            v = [bm.verts.new(c) for c in ((ax + g, ay + g, 0.0), (bx - g, ay + g, 0.0),
                                           (bx - g, ay + s - g, 0.0), (ax + g, ay + s - g, 0.0))]
            bm.faces.new(v).material_index = (ix * 7 + iy * 13 + (ix * iy) % 5) % 3
    mesh = H.mesh_from_bmesh("Floor", bm)
    for m in mats:
        mesh.materials.append(m)
    track(H.link(H.bpy.data.objects.new("Floor", mesh)))
    grout = H.material("GroutMat", base_color="#9C8A6E", roughness=0.95, metallic=0.0)
    box("FloorGrout", x0, x1, y0, y1, -0.03, -0.004, grout)
    grass = H.material("GrassMat", base_color=P["grass"], roughness=0.95, metallic=0.0)
    box("Lawn", -60.0, 60.0, y1, 70.0, -0.05, -0.002, grass)
    box("LawnL", -60.0, x0, -20.0, y1, -0.05, -0.002, grass)
    box("LawnR", x1, 60.0, -20.0, y1, -0.05, -0.002, grass)
    # a low hill behind the village (the windmill stands on it)
    hill = K.icosphere("Hill", 1.0, (-12.0, 34.0, -9.0), grass, subdivisions=3)
    hill.scale = (26.0, 12.0, 11.0)
    hill2 = K.icosphere("Hill2", 1.0, (22.0, 40.0, -10.0), grass, subdivisions=3)
    hill2.scale = (24.0, 12.0, 12.0)


def build_houses():
    K.prop("Cottage", "CottageL", (-6.7, 7.1, 0.0), rot=12.0, scale=0.72)
    K.prop("Cottage", "CottageR", (6.9, 7.4, 0.0), rot=-12.0, scale=0.72)
    K.prop("Cottage", "CottageBack", (1.2, 14.0, 0.0), rot=0.0, scale=0.62)
    K.prop("Windmill", "Windmill", (-15.0, 25.0, 1.2), rot=18.0, scale=0.9)
    # the sails at the mill's hub (Squatopia landmarks.py HUB = (0, -3.2, 8.6), in the mill's own space)
    a = math.radians(18.0)
    hx, hy, hz = 0.0 * 0.9, -3.2 * 0.9, 8.6 * 0.9
    hub = (-15.0 + hx * math.cos(a) - hy * math.sin(a), 25.0 + hx * math.sin(a) + hy * math.cos(a), 1.2 + hz)
    K.prop("Windmill_Sails", "WindmillSails", hub, rot=18.0, scale=0.9)
    for i, (name, x, y, r, s) in enumerate((
            ("TreeRound_A_LOD1", -11.8, 8.6, 0.0, 0.95), ("TreeRound_B_LOD1", 12.2, 10.0, 40.0, 0.9),
            ("TreeRound_A_LOD1", -4.0, 18.0, 70.0, 1.05), ("TreeRound_B_LOD1", 8.0, 21.0, 10.0, 1.1),
            ("TreeRound_A_LOD1", 18.0, 16.0, 120.0, 1.0), ("TreeRound_B_LOD1", -21.0, 14.0, 200.0, 1.0))):
        K.prop(name, f"Tree{i}", (x, y, 0.0), rot=r, scale=s)
    for i, (x, y, s) in enumerate(((-3.95, 6.0, 0.55), (4.1, 6.4, 0.5), (-9.4, 5.6, 0.6), (9.6, 6.1, 0.6))):
        K.prop("Bush_A_LOD1", f"Bush{i}", (x, y, 0.0), rot=i * 50.0, scale=s)
    for i, (x, y) in enumerate(((-5.0, 4.95), (-4.55, 5.1), (5.35, 5.2), (4.95, 5.4), (-7.6, 4.6), (8.1, 4.9))):
        K.prop("Flowers_A", f"Flowers{i}", (x, y, 0.0), rot=i * 37.0, scale=1.2)
    K.prop("Meadow_Bunting", "Bunting", (0.4, 6.6, 0.0), rot=0.0, scale=0.95)


def build_well():
    """The stone well: an open ring (water inside), two posts, a little gabled roof, the crank and a bucket."""
    x, y = P["well_xy"]
    stone = H.material("WellStoneMat", base_color="#B8B2A6", roughness=0.9, metallic=0.0)
    track(H.add_lathe("WellRing", [(0.8, 0.0), (0.8, 0.8), (0.62, 0.8), (0.62, 0.42)], segments=20,
                      location=(x, y, 0.0), mat=stone, smooth=False))
    water = H.material("WellWaterMat", base_color="#3E7FB8", roughness=0.15, metallic=0.0)
    track(H.add_cylinder("WellWater", radius=0.63, depth=0.04, location=(x, y, 0.44), vertices=20, mat=water, smooth=False))
    wood = H.material("WellWoodMat", base_color="#7A4E2C", roughness=0.8, metallic=0.0)
    for tag, dx in (("L", -0.71), ("R", 0.71)):
        box(f"WellPost{tag}", x + dx - 0.06, x + dx + 0.06, y - 0.06, y + 0.06, 0.6, 2.25, wood)
    roof = H.material("WellRoofMat", base_color="#B5452E", roughness=0.7, metallic=0.0)
    for tag, s in (("A", -1.0), ("B", 1.0)):
        track(H.add_box(f"WellRoof{tag}", size=(1.9 + s * 0.02, 0.62, 0.06), location=(x, y + s * 0.26, 2.42),
                        rotation=(s * -32.0, 0.0, 0.0), mat=roof))
    track(H.add_cylinder("WellCrank", radius=0.05, depth=1.3, location=(x, y, 1.75), rotation=(0.0, 90.0, 0.0),
                         vertices=10, mat=wood))
    rope = H.material("RopeMat", base_color="#CDB48A", roughness=0.9, metallic=0.0)
    track(H.add_cylinder("WellRope", radius=0.012, depth=0.5, location=(x + 0.1, y, 1.45), vertices=6, mat=rope))
    bucket = H.material("BucketMat", base_color="#8E5A32", roughness=0.7, metallic=0.0)
    track(H.add_lathe("WellBucket", [(0.11, 0.0), (0.14, 0.24)], segments=12, location=(x + 0.1, y, 0.96),
                      mat=bucket, smooth=False, close_ends=True))


def build_market():
    x, y = P["stall_xy"]
    K.prop("Meadow_Stall_A", "Stall", (x, y, 0.0), rot=0.0, scale=1.0)
    K.prop("Meadow_Barrel", "Barrel", (4.55, 4.85, 0.0), rot=20.0, scale=0.75)
    K.prop("Meadow_Crate", "Crate", (4.45, 3.95, 0.0), rot=-15.0, scale=0.7)
    K.prop("Meadow_Crate", "Crate2", (0.75, 4.95, 0.0), rot=10.0, scale=0.6)
    K.prop("Meadow_Bench", "Bench", (-6.05, 2.75, 0.0), rot=90.0, scale=1.0)
    K.prop("Meadow_FlowerBed", "FlowerBed", (-6.1, 4.9, 0.0), rot=90.0, scale=0.6)


def build_lamps():
    for i, (x, y, r) in enumerate(((P["lamp_xy"][0], P["lamp_xy"][1], -90.0), (-3.6, 6.3, 0.0))):
        K.prop("LanternPost", f"Lamp{i}", (x, y, 0.0), rot=r, scale=0.85)
        track(H.add_light("POINT", name=f"LampLight{i}", location=(x, y, 2.5), target=(x, y, 0.0),
                          energy=P["lamp_energy"], light_color=P["light_color"]))


def main():
    K.reset()
    build_ground()
    build_houses()
    build_well()
    build_market()
    build_lamps()
    K.export("village", BLEND_PATH, GLB_PATH)


main()
