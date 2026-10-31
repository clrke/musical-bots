"""Swimming pool set (.blend -> .glb).

An outdoor swimming pool on a hot day (metres, Blender Z-up; three.js x = x, z = -y):
  - a tiled deck running out to the camera; the POOL across the back (sunk: the cast can float over its water), white
    coping, blue walls, a rubber duck and a swim ring on the water, a LADDER at its front right;
  - the DIVING-board at the pool's far end, the SLIDE at the back left, two LOUNGERs under an umbrella on the right,
    a striped cabana, palms, hedges and a white fence behind.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky is a painted panorama drawn code-side
(environments/skies/pool.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/pool.blend and exports environments/pool.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/pool.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "pool.blend"
GLB_PATH = K.ROOT / "environments" / "pool.glb"

P = {
    "deck_x": (-10.25, 10.25),
    "deck_y": (-8.25, 10.25),
    "tile": 0.5,
    "tiles": ("#F3EEE4", "#DCE8EE"),
    "hole": (-4.5, 4.5, 3.0, 6.5),     # the water: x0, x1, y0, y1 (three.js z -3 .. -6.5)
    "coping": 0.25,
    "water_z": -0.22,
    "water": ("#7EE6F0", "#2BB5DA"),
}


def build_deck():
    """Deck tiles (one mesh, two tones) everywhere but the pool and its coping; grass beyond the fence."""
    import bmesh
    mats = [H.material(f"DeckTileMat{i}", base_color=c, roughness=0.6, metallic=0.0) for i, c in enumerate(P["tiles"])]
    x0, x1 = P["deck_x"]
    y0, y1 = P["deck_y"]
    hx0, hx1, hy0, hy1 = P["hole"]
    c = P["coping"]
    t = P["tile"]
    bm = bmesh.new()
    nx, ny = round((x1 - x0) / t), round((y1 - y0) / t)
    for ix in range(nx):
        for iy in range(ny):
            ax, ay = x0 + ix * t, y0 + iy * t
            cx, cy = ax + t / 2, ay + t / 2
            if hx0 - c < cx < hx1 + c and hy0 - c < cy < hy1 + c:
                continue
            v = [bm.verts.new(p) for p in ((ax, ay, 0.0), (ax + t, ay, 0.0), (ax + t, ay + t, 0.0), (ax, ay + t, 0.0))]
            bm.faces.new(v).material_index = (ix + iy) % 2
    mesh = H.mesh_from_bmesh("Floor", bm)
    for m in mats:
        mesh.materials.append(m)
    track(H.link(H.bpy.data.objects.new("Floor", mesh)))
    grass = H.material("GrassMat", base_color="#77B851", roughness=0.95, metallic=0.0)
    box("Lawn", -80.0, 80.0, y1, 90.0, -0.06, -0.002, grass)
    box("LawnL", -80.0, x0, -20.0, y1, -0.06, -0.002, grass)
    box("LawnR", x1, 80.0, -20.0, y1, -0.06, -0.002, grass)


def build_pool():
    hx0, hx1, hy0, hy1 = P["hole"]
    c = P["coping"]
    wz = P["water_z"]
    wall = H.material("PoolWallMat", base_color="#3FA9DE", roughness=0.4, metallic=0.0)
    # the walls (inside the coping's footprint, their tops under it) and the water between them
    box("PoolWallF", hx0 - c + 0.02, hx1 + c - 0.02, hy0 - 0.1, hy0, -0.9, -0.004, wall)
    box("PoolWallB", hx0 - c + 0.02, hx1 + c - 0.02, hy1, hy1 + 0.1, -0.9, -0.004, wall)
    box("PoolWallL", hx0 - 0.1, hx0, hy0, hy1, -0.9, -0.004, wall)
    box("PoolWallR", hx1, hx1 + 0.1, hy0, hy1, -0.9, -0.004, wall)
    sea = K.color_material("PoolWaterMat", roughness=0.08)
    K.water("Water", hx0, hx1, hy0, hy1, wz, P["water"][0], P["water"][1], sea, rows=(0.0, 0.5, 1.0))
    # lane ropes floating on the water (red and white floats)
    red = H.material("FloatRedMat", base_color="#E8473C", roughness=0.5, metallic=0.0)
    white = H.material("FloatWhiteMat", base_color="#FFFFFF", roughness=0.5, metallic=0.0)
    for j, x in enumerate((-1.5, 1.5)):
        for i in range(12):
            y = hy0 + 0.25 + i * 0.27
            K.icosphere(f"LaneFloat{j}_{i:02d}", 0.07, (x, y, wz + 0.02), red if (i // 2) % 2 == 0 else white, 1)
    coping = H.material("CopingMat", base_color="#FFFFFF", roughness=0.55, metallic=0.0)
    box("CopingF", hx0 - c, hx1 + c, hy0 - c, hy0, 0.0, 0.05, coping)
    box("CopingB", hx0 - c, hx1 + c, hy1, hy1 + c, 0.0, 0.05, coping)
    box("CopingL", hx0 - c, hx0, hy0, hy1, 0.0, 0.05, coping)
    box("CopingR", hx1, hx1 + c, hy0, hy1, 0.0, 0.05, coping)
    # a swim ring and a rubber duck on the water
    ring = H.material("RingMat", base_color="#FF7FB0", roughness=0.45, metallic=0.0)
    track(H.add_torus("SwimRing", major=0.38, minor=0.13, location=(1.9, 4.6, wz + 0.04), major_segments=24,
                      minor_segments=10, mat=ring))
    duck = H.material("DuckMat", base_color="#FFD23C", roughness=0.4, metallic=0.0)
    beak = H.material("BeakMat", base_color="#FF8A1E", roughness=0.4, metallic=0.0)
    dx, dy = -2.2, 4.4
    body = K.icosphere("DuckBody", 0.26, (dx, dy, wz + 0.12), duck, 2)
    body.scale = (1.0, 1.25, 0.8)
    K.icosphere("DuckHead", 0.16, (dx, dy - 0.2, wz + 0.42), duck, 2)
    track(H.add_cone("DuckBeak", radius=0.06, depth=0.14, location=(dx, dy - 0.38, wz + 0.4), rotation=(90.0, 0.0, 0.0),
                     vertices=8, mat=beak, smooth=False))
    eye = H.material("DuckEyeMat", base_color="#1A1A22", roughness=0.4, metallic=0.0)
    for i, ex in enumerate((-0.07, 0.07)):
        K.icosphere(f"DuckEye{i}", 0.028, (dx + ex, dy - 0.33, wz + 0.48), eye, 1)
    # the ladder at the front right: two rails over the coping, three steps in the water
    steel = H.material("SteelMat", base_color="#D8DDE2", roughness=0.25, metallic=0.9)
    lx = 3.6
    for i, dxl in enumerate((-0.25, 0.25)):
        K.tube(f"LadderRail{i}", [(lx + dxl, hy0 + 0.22, -0.7), (lx + dxl, hy0 + 0.22, 0.4), (lx + dxl, hy0 - 0.05, 0.72),
                                   (lx + dxl, hy0 - 0.32, 0.4), (lx + dxl, hy0 - 0.32, 0.05)], 0.025, steel)
    for i in range(3):
        box(f"LadderStep{i}", lx - 0.23, lx + 0.23, hy0 + 0.1, hy0 + 0.3, -0.62 + i * 0.22, -0.6 + i * 0.22, steel)


def build_diving_board():
    hy1 = P["hole"][3]
    base = H.material("BoardBaseMat", base_color="#2F7FC8", roughness=0.5, metallic=0.0)
    board = H.material("BoardMat", base_color="#FFFFFF", roughness=0.45, metallic=0.0)
    box("BoardBase", -0.45, 0.45, hy1 + 0.45, hy1 + 1.3, 0.0, 0.52, base)
    box("Board", -0.32, 0.32, hy1 - 1.05, hy1 + 1.25, 0.52, 0.6, board)
    steel = H.bpy.data.materials["SteelMat"]
    for i, x in enumerate((-0.5, 0.5)):
        K.tube(f"BoardRail{i}", [(x, hy1 + 1.3, 0.0), (x, hy1 + 1.3, 1.1), (x, hy1 + 0.6, 1.0), (x, hy1 + 0.4, 0.55)],
               0.025, steel)


def build_slide():
    """A slide at the back left: steps up to a deck, a yellow chute curling down to the pool's edge."""
    x, y = -6.4, 5.2
    frame = H.material("SlideFrameMat", base_color="#3E7FD8", roughness=0.5, metallic=0.0)
    chute = H.material("SlideChuteMat", base_color="#FFC93C", roughness=0.35, metallic=0.0)
    for i, (dx, dy) in enumerate(((-0.4, -0.4), (0.4, -0.4), (-0.4, 0.4), (0.4, 0.4))):
        box(f"SlideLeg{i}", x + dx - 0.05, x + dx + 0.05, y + dy - 0.05, y + dy + 0.05, 0.0, 2.2, frame)
    box("SlideDeck", x - 0.48, x + 0.48, y - 0.48, y + 0.48, 2.2, 2.28, frame)
    for i in range(7):
        z = 0.3 + i * 0.3
        box(f"SlideStep{i}", x - 0.35, x + 0.35, y + 0.52 + (6 - i) * 0.13, y + 0.72 + (6 - i) * 0.13, z - 0.03, z + 0.03,
            frame)
    K.tube("SlideChute", [(x + 0.4, y, 2.3), (x + 1.3, y - 0.3, 1.7), (x + 1.75, y - 1.1, 1.0), (x + 1.85, y - 1.65, 0.45),
                           (x + 1.9, y - 1.95, 0.25)], 0.26, chute, resolution=10, bevel_resolution=3)


def build_loungers():
    frame = H.material("LoungerFrameMat", base_color="#FFFFFF", roughness=0.5, metallic=0.0)
    cush = (H.material("CushionBlueMat", base_color="#3FA0E8", roughness=0.8, metallic=0.0),
            H.material("CushionCoralMat", base_color="#FF8A70", roughness=0.8, metallic=0.0))
    for i, y in enumerate((1.7, 3.7)):
        x = 6.1
        box(f"Lounger{i}", x - 0.33, x + 0.33, y - 0.95, y + 0.95, 0.12, 0.32, frame)
        box(f"LoungerPad{i}", x - 0.3, x + 0.3, y - 0.92, y + 0.4, 0.32, 0.4, cush[i])
        track(H.add_box(f"LoungerBack{i}", size=(0.56, 0.7, 0.08), location=(x, y + 0.62, 0.62), rotation=(48.0, 0.0, 0.0),
                        mat=cush[i]))
        for k, (dx, dy) in enumerate(((-0.28, -0.85), (0.28, -0.85), (-0.28, 0.85), (0.28, 0.85))):
            box(f"LoungerLeg{i}{k}", x + dx - 0.03, x + dx + 0.03, y + dy - 0.03, y + dy + 0.03, -0.004, 0.12, frame)
    # the umbrella between them
    pole = H.material("UmbrellaPoleMat", base_color="#F4F1EA", roughness=0.5, metallic=0.1)
    ux, uy = 6.9, 2.65
    track(H.add_cylinder("UmbrellaPole", radius=0.035, depth=2.5, location=(ux, uy, 1.25), vertices=10, mat=pole))
    a = H.material("UmbrellaTealMat", base_color="#2EC4B6", roughness=0.6, metallic=0.0)
    b = H.material("UmbrellaWhiteMat", base_color="#FFF8EE", roughness=0.6, metallic=0.0)
    canopy = H.add_cone("UmbrellaCanopy", radius=1.4, depth=0.45, location=(ux, uy, 2.4), vertices=12, mat=a,
                        smooth=False)
    canopy.data.materials.append(b)
    for i, f in enumerate(canopy.data.polygons):
        f.material_index = i % 2 if len(f.vertices) == 3 else 0
    track(canopy)


def build_surroundings():
    # the cabana: a striped beach hut at the back right
    x, y = 7.6, 7.6
    w = H.material("CabanaWhiteMat", base_color="#FFFFFF", roughness=0.7, metallic=0.0)
    s = H.material("CabanaStripeMat", base_color="#FF6F91", roughness=0.7, metallic=0.0)
    for i in range(6):
        box(f"CabanaWall{i}", x - 1.2 + i * 0.4, x - 0.8 + i * 0.4, y - 0.9, y + 0.9, 0.0, 2.2, w if i % 2 else s)
    track(H.add_box("CabanaRoofA", size=(2.7, 1.2, 0.08), location=(x, y - 0.45, 2.5), rotation=(-30.0, 0.0, 0.0),
                    mat=s))
    track(H.add_box("CabanaRoofB", size=(2.66, 1.2, 0.08), location=(x, y + 0.45, 2.5), rotation=(30.0, 0.0, 0.0),
                    mat=s))
    door = H.material("CabanaDoorMat", base_color="#3E7FD8", roughness=0.6, metallic=0.0)
    box("CabanaDoor", x - 0.4, x + 0.4, y - 0.906, y - 0.9, 0.0, 1.8, door)
    # a white picket fence along the back, hedges and palms
    fence = H.material("FenceMat", base_color="#FFFFFF", roughness=0.7, metallic=0.0)
    fy = 9.6
    box("FenceRailLo", -10.0, 10.0, fy - 0.02, fy + 0.02, 0.28, 0.36, fence)
    box("FenceRailHi", -10.0, 10.0, fy - 0.02, fy + 0.02, 0.7, 0.78, fence)
    n = 100
    for i in range(n + 1):
        px = -10.0 + i * 20.0 / n
        box(f"Picket{i:03d}", px - 0.035, px + 0.035, fy - 0.045, fy - 0.02, 0.0, 0.95, fence)
    for i, (hx, hy, r) in enumerate(((-4.0, 10.6, 0.0), (-1.2, 10.8, 40.0), (1.8, 10.6, 90.0), (4.6, 10.8, 10.0),
                                     (-8.8, 10.6, 60.0))):
        K.prop("Bush_A_LOD1", f"Hedge{i}", (hx, hy, 0.0), rot=r, scale=0.9)
    for i, (px, py, r, sc) in enumerate(((-9.0, 7.6, 20.0, 0.95), (10.4, 4.6, 100.0, 0.9), (-12.0, 2.5, 200.0, 1.0),
                                         (12.5, 9.5, 300.0, 1.05), (-3.0, 13.5, 0.0, 1.1))):
        K.prop("PalmTree_LOD1", f"Palm{i}", (px, py, 0.0), rot=r, scale=sc)
    for i, (fx, fy2) in enumerate(((-7.6, 2.4), (-7.9, 3.1), (8.6, 0.3), (-2.4, 9.0), (2.8, 9.1))):
        K.prop("Flowers_A", f"Flowers{i}", (fx, fy2, 0.0), rot=i * 40.0, scale=1.4)


def main():
    K.reset()
    build_deck()
    build_pool()
    build_diving_board()
    build_slide()
    build_loungers()
    build_surroundings()
    K.export("pool", BLEND_PATH, GLB_PATH)


main()
