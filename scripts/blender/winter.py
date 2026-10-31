"""Winter set (.blend -> .glb).

A snowy clearing (metres, Blender Z-up; three.js x = x, z = -y):
  - deep snow running out to the camera, snowy pines all around and blue mountains far off;
  - the CHALET at the back left (its door is the mark), a woodpile beside it, the SNOWMAN left of centre with a sledge,
    the frozen POND at the back right (flat: the cast can skate on it), lantern poles with warm lights.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky is a painted panorama drawn code-side
(environments/skies/winter.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/winter.blend and exports environments/winter.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/winter.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "winter.blend"
GLB_PATH = K.ROOT / "environments" / "winter.glb"

P = {
    "snow": "#EEF4FB",
    "snowman_xy": (-2.4, 3.65),
    "pond_xy": (3.0, 3.9),
    "light_color": "#ffc27a",
    "lamp_energy": 3.5,           # W in Blender = candela in three.js (RAW export)
}


def build_ground():
    snow = H.material("SnowMat", base_color=P["snow"], roughness=0.92, metallic=0.0)
    box("Snow", -80.0, 80.0, -20.0, 90.0, -0.08, 0.0, snow)
    # soft drifts out of the way (the back and the far sides)
    for i, (x, y, r, s) in enumerate(((-9.2, 3.2, 80.0, 0.7), (9.6, 4.4, -70.0, 0.75), (-1.0, 8.8, 0.0, 0.8),
                                      (6.8, 9.6, 20.0, 0.7), (-12.0, 9.0, 10.0, 0.9))):
        K.prop("Alpine_SnowDrift", f"Drift{i}", (x, y, 0.0), rot=r, scale=s)
    # far mountains: low-poly cones with snow caps (the caps' slopes run 0.5 m outside the rock's: never in its plane)
    rock = H.material("MountainMat", base_color="#7F96BC", roughness=0.95, metallic=0.0)
    cap = H.material("MountainSnowMat", base_color="#F6FAFF", roughness=0.9, metallic=0.0)
    for i, (x, y, r, h) in enumerate(((-38.0, 70.0, 26.0, 30.0), (4.0, 86.0, 32.0, 40.0), (44.0, 72.0, 28.0, 33.0),
                                      (-70.0, 60.0, 24.0, 24.0), (75.0, 58.0, 24.0, 26.0))):
        track(H.add_cone(f"Mountain{i}", radius=r, depth=h, location=(x, y, h / 2 - 2.0 - 0.1 * i), vertices=7, mat=rock,
                         smooth=False))
        k = 0.42  # the cap: the top 42% of the cone, lifted along the slope's normal
        lift = 0.5 * math.hypot(r, h) / r
        track(H.add_cone(f"MountainCap{i}", radius=r * k, depth=h * k, location=(x, y, h - 2.0 - h * k / 2 + lift),
                         vertices=7, mat=cap, smooth=False))


def build_trees():
    pines = (("Alpine_SnowPine_A", -2.8, 12.0, 0.0, 0.75), ("Alpine_SnowPine_B", 4.2, 11.5, 40.0, 0.8),
             ("Alpine_SnowPine_A", 9.8, 7.8, 90.0, 0.7), ("Alpine_SnowPine_B", -11.5, 6.2, 10.0, 0.75),
             ("Alpine_SnowPine_A", 12.5, 13.0, 150.0, 0.9), ("Alpine_SnowPine_B", -15.0, 14.0, 70.0, 1.0),
             ("Alpine_SnowPine_A", 7.5, 18.0, 30.0, 1.0), ("Alpine_SnowPine_B", -6.0, 19.0, 200.0, 1.1),
             ("Alpine_SnowPine_A", 0.8, 22.0, 100.0, 1.2), ("Alpine_SnowPine_B", 18.0, 22.0, 0.0, 1.2),
             ("Alpine_SnowPine_A", -21.0, 24.0, 50.0, 1.2), ("Alpine_SnowPine_A", 9.0, 2.6, 15.0, 0.5),
             ("Alpine_SnowPine_B", -9.8, 3.4, 60.0, 0.5))
    for i, (name, x, y, r, s) in enumerate(pines):
        K.prop(name, f"Pine{i}", (x, y, 0.0), rot=r, scale=s)
    K.prop("Alpine_SnowRock_A", "SnowRock", (-6.6, 3.4, 0.0), rot=30.0, scale=0.5)
    K.prop("Alpine_SnowRock_B", "SnowRock2", (12.0, 6.0, 0.0), rot=0.0, scale=0.7)


def build_chalet():
    K.prop("Alpine_Chalet", "Chalet", (-6.6, 8.6, 0.0), rot=14.0, scale=0.6)
    K.prop("Alpine_Woodpile", "Woodpile", (-3.4, 7.0, 0.0), rot=-10.0, scale=0.6)


def build_snowman():
    """Three snowballs, coal eyes and buttons, a carrot nose, stick arms, a scarf and a top hat."""
    x, y = P["snowman_xy"]
    snow = H.material("SnowmanMat", base_color="#FBFDFF", roughness=0.85, metallic=0.0)
    for name, r, z in (("SnowmanBase", 0.55, 0.42), ("SnowmanBody", 0.41, 1.1), ("SnowmanHead", 0.29, 1.62)):
        K.icosphere(name, r, (x, y, z), snow, subdivisions=2)
    coal = H.material("CoalMat", base_color="#1B1B22", roughness=0.6, metallic=0.0)
    for i, (dx, z) in enumerate(((-0.1, 1.7), (0.1, 1.7))):
        K.icosphere(f"SnowmanEye{i}", 0.035, (x + dx, y - 0.26, z), coal, subdivisions=1)
    for i, z in enumerate((1.22, 1.06, 0.9)):
        K.icosphere(f"SnowmanButton{i}", 0.04, (x, y - 0.4 + 0.02 * abs(i - 1), z), coal, subdivisions=1)
    carrot = H.material("CarrotMat", base_color="#F07A1A", roughness=0.6, metallic=0.0)
    track(H.add_cone("SnowmanNose", radius=0.05, depth=0.26, location=(x, y - 0.38, 1.6), rotation=(90.0, 0.0, 0.0),
                     vertices=10, mat=carrot, smooth=False))
    stick = H.material("StickMat", base_color="#5A3A22", roughness=0.9, metallic=0.0)
    for tag, s in (("L", -1.0), ("R", 1.0)):
        track(H.add_cylinder(f"SnowmanArm{tag}", radius=0.025, depth=0.8, location=(x + s * 0.62, y, 1.28),
                             rotation=(0.0, s * 62.0, 0.0), vertices=6, mat=stick, smooth=False))
    scarf = H.material("ScarfMat", base_color="#D8343C", roughness=0.8, metallic=0.0)
    track(H.add_torus("SnowmanScarf", major=0.27, minor=0.06, location=(x, y, 1.38), major_segments=20,
                      minor_segments=8, mat=scarf, smooth=False))
    box("SnowmanScarfEnd", x + 0.12, x + 0.24, y - 0.33, y - 0.25, 1.05, 1.38, scarf)
    hat = H.material("HatMat", base_color="#22232B", roughness=0.5, metallic=0.0)
    track(H.add_cylinder("SnowmanHatBrim", radius=0.27, depth=0.03, location=(x, y, 1.86), vertices=20, mat=hat,
                         smooth=False))
    track(H.add_cylinder("SnowmanHat", radius=0.18, depth=0.3, location=(x, y, 2.025), vertices=20, mat=hat,
                         smooth=False))
    track(H.add_cylinder("SnowmanHatBand", radius=0.185, depth=0.06, location=(x, y, 1.92), vertices=20, mat=scarf,
                         smooth=False))
    K.prop("Alpine_Sledge", "Sledge", (x - 1.9, y - 0.5, 0.0), rot=35.0, scale=1.0)


def build_pond():
    x, y = P["pond_xy"]
    K.prop("Alpine_FrozenPond", "Pond", (x, y, 0.0), rot=0.0, scale=0.62)


def build_lamps():
    for i, (x, y, r) in enumerate(((6.2, 2.6, -90.0), (-4.2, 6.0, 0.0))):
        K.prop("Alpine_LanternPole", f"Lantern{i}", (x, y, 0.0), rot=r, scale=0.9)
        track(H.add_light("POINT", name=f"LanternLight{i}", location=(x, y - 0.35, 2.3), target=(x, y, 0.0),
                          energy=P["lamp_energy"], light_color=P["light_color"]))


def main():
    K.reset()
    build_ground()
    build_trees()
    build_chalet()
    build_snowman()
    build_pond()
    build_lamps()
    K.export("winter", BLEND_PATH, GLB_PATH)


main()
