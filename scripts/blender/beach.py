"""Beach set (.blend -> .glb).

A sunny beach (metres, Blender Z-up; three.js x = x, z = -y):
  - warm sand running out to the camera, sloping into the SEA at the back (turquoise near the shore, deep blue far
    out), a foam line, a little pier off to the right, a sailboat and a lighthouse island far out;
  - the striped UMBRELLA with two towels at the back left, the SANDCASTLE (bucket and spade) at the back right, the
    LIFEGUARD tower on the right, palms either side, a beach ball, rocks and gulls.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky is a painted panorama drawn code-side
(environments/skies/beach.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/beach.blend and exports environments/beach.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/beach.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "beach.blend"
GLB_PATH = K.ROOT / "environments" / "beach.glb"

P = {
    "sand": "#F2D9A2",
    "wet": "#D6B57E",
    "shore_y": 5.4,               # the dry sand ends here (three.js z = -5.4), the slope runs down into the sea
    "slope": 2.6,
    "sea_z": -0.16,
    "umbrella_xy": (-3.3, 4.1),
    "castle_xy": (2.3, 4.15),
    "tower_xy": (6.0, 3.3),
}


def build_ground():
    import bmesh
    sand = H.material("SandMat", base_color=P["sand"], roughness=0.95, metallic=0.0)
    wet = H.material("WetSandMat", base_color=P["wet"], roughness=0.6, metallic=0.0)
    sy = P["shore_y"]
    box("Sand", -80.0, 80.0, -20.0, sy, -0.08, 0.0, sand)
    # the wet slope into the sea (one quad strip, ends below the water)
    bm = bmesh.new()
    v = [bm.verts.new(c) for c in ((-80.0, sy, 0.0), (80.0, sy, 0.0), (80.0, sy + P["slope"], -0.45),
                                   (-80.0, sy + P["slope"], -0.45))]
    bm.faces.new(v)
    mesh = H.mesh_from_bmesh("Shore", bm)
    mesh.materials.append(wet)
    track(H.link(H.bpy.data.objects.new("Shore", mesh)))
    sea = K.color_material("SeaMat", roughness=0.18)
    K.water("Sea", -90.0, 90.0, sy + 0.6, 95.0, P["sea_z"], "#7FE3E6", "#1876B8", sea,
            rows=(0.0, 0.03, 0.08, 0.2, 0.45, 1.0))
    # the foam line where the slope meets the water (just above the water, crossing the slope)
    foam = K.emissive("FoamMat", "#ffffff", base="#f4fbff", strength=0.15, roughness=0.6)
    z_cross = P["sea_z"]
    y_cross = sy + P["slope"] * (-z_cross / 0.45)
    for i, (x0, x1, dy) in enumerate(((-80.0, -9.0, 0.0), (-9.0, -1.5, 0.12), (-1.5, 6.0, -0.06), (6.0, 80.0, 0.08))):
        track(H.add_plane(f"Foam{i}", size=(x1 - x0, 0.32), location=((x0 + x1) / 2, y_cross + dy, z_cross + 0.008),
                          mat=foam))


def build_umbrella():
    x, y = P["umbrella_xy"]
    pole = H.material("UmbrellaPoleMat", base_color="#F4F1EA", roughness=0.5, metallic=0.1)
    track(H.add_cylinder("UmbrellaPole", radius=0.035, depth=2.5, location=(x, y, 1.2), vertices=10, mat=pole))
    red = H.material("StripeRedMat", base_color="#E84A4A", roughness=0.6, metallic=0.0)
    white = H.material("StripeWhiteMat", base_color="#FFF8EE", roughness=0.6, metallic=0.0)
    canopy = H.add_cone("UmbrellaCanopy", radius=1.35, depth=0.45, location=(x, y, 2.35), vertices=12, mat=red,
                        smooth=False)
    canopy.data.materials.append(white)
    for i, f in enumerate(canopy.data.polygons):
        f.material_index = i % 2 if len(f.vertices) == 3 else 0
    track(canopy)
    # two towels on the sand (a few mm proud of it), a cool box
    for i, (dx, dy, r, c1, c2) in enumerate(((-0.75, -0.45, 8.0, "#3C8DDC", "#FFD54A"),
                                              (0.75, -0.55, -10.0, "#FF7FB0", "#FFFFFF"))):
        a = H.material(f"Towel{i}MatA", base_color=c1, roughness=0.9, metallic=0.0)
        b = H.material(f"Towel{i}MatB", base_color=c2, roughness=0.9, metallic=0.0)
        for k in range(5):
            t = track(H.add_box(f"Towel{i}_{k}", size=(0.8, 0.3, 0.006), location=(0.0, 0.0, 0.0),
                                mat=a if k % 2 == 0 else b))
            ang = math.radians(r)
            ox, oy = 0.0, -0.6 + k * 0.3
            t.location = (x + dx + ox * math.cos(ang) - oy * math.sin(ang), y + dy + ox * math.sin(ang) + oy * math.cos(ang),
                          0.003)
            t.rotation_euler = (0.0, 0.0, ang)
    cool = H.material("CoolBoxMat", base_color="#2E9C8C", roughness=0.5, metallic=0.0)
    lid = H.material("CoolLidMat", base_color="#FFFFFF", roughness=0.5, metallic=0.0)
    box("CoolBox", x + 1.2, x + 1.7, y + 0.2, y + 0.55, 0.0, 0.34, cool)
    box("CoolBoxLid", x + 1.18, x + 1.72, y + 0.18, y + 0.57, 0.34, 0.4, lid)


def build_sandcastle():
    x, y = P["castle_xy"]
    sand = H.material("CastleMat", base_color="#E8C27E", roughness=0.95, metallic=0.0)
    box("CastleBase", x - 0.6, x + 0.6, y - 0.45, y + 0.45, 0.0, 0.32, sand)
    for i, (dx, dy) in enumerate(((-0.52, -0.38), (0.52, -0.38), (-0.52, 0.38), (0.52, 0.38))):
        track(H.add_cylinder(f"CastleTower{i}", radius=0.17, depth=0.64, location=(x + dx, y + dy, 0.3), vertices=10,
                             mat=sand, smooth=False))
        track(H.add_cone(f"CastleTop{i}", radius=0.2, depth=0.24, location=(x + dx, y + dy, 0.74), vertices=10, mat=sand,
                         smooth=False))
    box("CastleKeep", x - 0.25, x + 0.25, y - 0.2, y + 0.24, 0.32, 0.78, sand)
    for i, dx in enumerate((-0.19, -0.06, 0.07, 0.19)):
        box(f"CastleMerlon{i}", x + dx - 0.04, x + dx + 0.04, y - 0.2, y - 0.12, 0.78, 0.86, sand)
    door = H.material("CastleDoorMat", base_color="#A8834A", roughness=0.95, metallic=0.0)
    box("CastleDoor", x - 0.08, x + 0.08, y - 0.21, y - 0.198, 0.326, 0.52, door)
    flag = H.material("FlagMat", base_color="#E8473C", roughness=0.6, metallic=0.0)
    track(H.add_cylinder("CastleFlagPole", radius=0.012, depth=0.42, location=(x, y + 0.02, 0.99), vertices=6,
                         mat=door))
    track(H.add_extrusion("CastleFlag", [(0.0, 0.0), (0.24, 0.07), (0.0, 0.14)], depth=0.01,
                          location=(x + 0.012, y + 0.02, 1.06), rotation=(90.0, 0.0, 0.0), mat=flag))
    bucket = H.material("BucketBlueMat", base_color="#3E8BE6", roughness=0.5, metallic=0.0)
    track(H.add_lathe("Bucket", [(0.12, 0.0), (0.16, 0.26)], segments=14, location=(x + 1.0, y - 0.3, 0.0),
                      mat=bucket, smooth=False, close_ends=True))
    spade = H.material("SpadeMat", base_color="#FFC93C", roughness=0.5, metallic=0.0)
    track(H.add_box("Spade", size=(0.16, 0.03, 0.2), location=(x + 1.0, y + 0.18, 0.28), rotation=(12.0, 0.0, 20.0),
                    mat=spade))
    track(H.add_cylinder("SpadeHandle", radius=0.015, depth=0.4, location=(x + 1.03, y + 0.2, 0.55),
                         rotation=(12.0, 0.0, 20.0), vertices=6, mat=spade))


def build_tower():
    """The lifeguard tower: four legs, a deck with a rail, a striped hut and a flag; a ladder in front."""
    x, y = P["tower_xy"]
    wood = H.material("TowerWoodMat", base_color="#F4EEE2", roughness=0.7, metallic=0.0)
    red = H.bpy.data.materials["StripeRedMat"]
    for i, (dx, dy) in enumerate(((-0.55, -0.5), (0.55, -0.5), (-0.55, 0.5), (0.55, 0.5))):
        box(f"TowerLeg{i}", x + dx - 0.06, x + dx + 0.06, y + dy - 0.06, y + dy + 0.06, 0.0, 1.6, wood)
    box("TowerDeck", x - 0.7, x + 0.7, y - 0.65, y + 0.65, 1.6, 1.7, wood)
    box("TowerHut", x - 0.5, x + 0.5, y - 0.2, y + 0.5, 1.7, 2.5, red)
    box("TowerWindow", x - 0.3, x + 0.3, y - 0.206, y - 0.2, 2.0, 2.3, wood)
    track(H.add_box("TowerRoof", size=(1.3, 1.05, 0.08), location=(x, y + 0.12, 2.6), rotation=(-10.0, 0.0, 0.0),
                    mat=wood))
    for i, dx in enumerate((-0.66, 0.66)):
        box(f"TowerRail{i}", x + dx - 0.03, x + dx + 0.03, y - 0.62, y + 0.62, 1.7, 2.1, wood)
    track(H.add_cylinder("TowerFlagPole", radius=0.02, depth=1.0, location=(x + 0.4, y + 0.3, 3.1), vertices=6,
                         mat=wood))
    track(H.add_extrusion("TowerFlag", [(0.0, 0.0), (0.4, 0.12), (0.0, 0.24)], depth=0.01,
                          location=(x + 0.42, y + 0.3, 3.35), rotation=(90.0, 0.0, 0.0), mat=red))
    for i in range(5):
        z = 0.3 + i * 0.3
        box(f"TowerRung{i}", x - 0.25, x + 0.25, y - 0.92 + i * 0.06, y - 0.88 + i * 0.06, z - 0.02, z + 0.02, wood)
    for i, dx in enumerate((-0.27, 0.27)):
        track(H.add_box(f"TowerLadder{i}", size=(0.04, 0.04, 1.75), location=(x + dx, y - 0.78, 0.85),
                        rotation=(-12.0, 0.0, 0.0), mat=wood))


def build_scenery():
    for i, (x, y, r, s) in enumerate(((-10.5, 3.2, 30.0, 0.85), (-10.6, 6.6, 120.0, 1.0), (8.9, 1.8, -40.0, 0.8),
                                      (11.5, 4.8, 200.0, 1.0), (-14.0, 2.0, 80.0, 0.9))):
        K.prop("PalmTree", f"Palm{i}", (x, y, 0.0), rot=r, scale=s)
    K.prop("Rock_B", "Rock", (-6.9, 6.3, -0.25), rot=20.0, scale=0.7)
    K.prop("Rock_A", "Rock2", (-5.9, 7.2, -0.3), rot=80.0, scale=0.5)
    K.prop("Rock_C", "Rock3", (14.0, 18.0, -0.3), rot=0.0, scale=1.2)
    K.prop("Pier", "Pier", (10.0, 5.3, 0.0), rot=180.0, scale=0.8)
    K.prop("SailBoat", "SailBoat", (-12.0, 34.0, P["sea_z"]), rot=70.0, scale=1.0)
    K.prop("Rock_B", "IslandRock", (-34.0, 58.0, -1.5), rot=0.0, scale=5.0)
    K.prop("Lighthouse", "Lighthouse", (-34.0, 58.0, 1.4), rot=20.0, scale=0.9)
    for i, (x, y, z, r) in enumerate(((1.5, 10.0, 4.6, 20.0), (4.0, 14.0, 5.8, -30.0), (-3.0, 16.0, 6.2, 60.0))):
        K.prop("Seagull", f"Gull{i}", (x, y, z), rot=r, scale=0.8)
    # a beach ball by the towels (two colours, by side)
    ball_a = H.material("BallRedMat", base_color="#F2484E", roughness=0.4, metallic=0.0)
    ball_b = H.material("BallWhiteMat", base_color="#FFFFFF", roughness=0.4, metallic=0.0)
    ball = K.icosphere("BeachBall", 0.24, (-1.3, 3.7, 0.24), ball_a, subdivisions=2)
    ball.data.materials.append(ball_b)
    for f in ball.data.polygons:
        a = math.atan2(f.center.y, f.center.x)
        f.material_index = int(((a + math.pi) / (math.pi / 3))) % 2


def main():
    K.reset()
    build_ground()
    build_umbrella()
    build_sandcastle()
    build_tower()
    build_scenery()
    K.export("beach", BLEND_PATH, GLB_PATH)


main()
