"""Ocean set (.blend -> .glb).

A big log raft in the middle of the ocean (metres, Blender Z-up; three.js x = x, z = -y):
  - the raft's logs running out to the camera (the cast plays on it; floating heads may drift over the water too),
    deep blue sea to the horizon;
  - the MAST with its striped sail at the back left, the palm-roofed HUT with a hammock at the back right, a treasure
    CHEST on the left, a life RING on a post at the back right corner, barrels and a crate;
  - out at sea: a friendly whale blowing a spout, a little palm island, a big sailing ship, a sailboat, gulls.
The middle stays clear for the bots (x in [-5.6, 5.6], three.js z in [-2.6, 2.6]); props sit at the back and the sides,
out of the side lanes (three.js z -0.4 and 2.2). The sky is a painted panorama drawn code-side
(environments/skies/ocean.jpg). web/src/scene/environments/sets.js holds the marks.

Props: Squatopia 2 (the owner's own, scripts/blender/props/squatopia, credits/ASSETS.md).
Saves environments/ocean.blend and exports environments/ocean.glb (lights RAW: W -> candela).
Idempotent and deterministic. Run headless:
    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/ocean.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import set_kit as K  # noqa: E402
from set_kit import H, box, track  # noqa: E402

BLEND_PATH = K.ROOT / "environments" / "ocean.blend"
GLB_PATH = K.ROOT / "environments" / "ocean.glb"

P = {
    "raft_x": (-6.6, 6.6),
    "raft_y": (-3.9, 5.1),        # the raft's back edge at three.js z = -5.1
    "log_r": 0.25,
    "logs": ("#B98A55", "#A97B48", "#C69660"),
    "water_z": -0.22,
    "lamp_energy": 3.0,           # W in Blender = candela in three.js (RAW export)
}


def build_sea():
    sea = K.color_material("SeaMat", roughness=0.12)
    K.water("Sea", -95.0, 95.0, -25.0, 95.0, P["water_z"], "#2A9BD0", "#145C9E", sea, rows=(0.0, 0.3, 0.6, 1.0))
    # foam around the raft (a ring of flat white strips on the water, a few mm up)
    foam = K.emissive("FoamMat", "#ffffff", base="#f4fbff", strength=0.12, roughness=0.6)
    x0, x1 = P["raft_x"]
    y0, y1 = P["raft_y"]
    z = P["water_z"] + 0.006
    for i, (cx, cy, sx, sy) in enumerate((((x0 + x1) / 2, y0 - 0.25, x1 - x0 + 1.0, 0.36),
                                          ((x0 + x1) / 2, y1 + 0.25, x1 - x0 + 1.0, 0.36),
                                          (x0 - 0.3, (y0 + y1) / 2, 0.36, y1 - y0 - 0.14),
                                          (x1 + 0.3, (y0 + y1) / 2, 0.36, y1 - y0 - 0.14))):
        track(H.add_plane(f"Foam{i}", size=(sx, sy), location=(cx, cy, z), mat=foam))


def build_raft():
    """Logs along x (their tops at 0), two cross beams lashed over the ends, rope lashings."""
    mats = [H.material(f"LogMat{i}", base_color=c, roughness=0.85, metallic=0.0) for i, c in enumerate(P["logs"])]
    x0, x1 = P["raft_x"]
    y0, y1 = P["raft_y"]
    r = P["log_r"]
    n = round((y1 - y0) / (2 * r))
    for i in range(n):
        y = y0 + r + i * 2 * r
        dx = 0.12 * (((i * 5) % 3) - 1)
        track(H.add_cylinder(f"Log{i:02d}", radius=r - 0.004, depth=x1 - x0 + 0.3 * ((i * 3) % 2), location=(dx, y, -r),
                             rotation=(0.0, 90.0, 0.0), vertices=10, mat=mats[(i * 7) % 3], smooth=True))
    beam = H.material("BeamMat", base_color="#7A5432", roughness=0.85, metallic=0.0)
    for i, x in enumerate((x0 + 0.5, x1 - 0.5)):
        box(f"Beam{i}", x - 0.16, x + 0.16, y0 - 0.1, y1 + 0.1, -0.62, -0.42, beam)


def build_mast():
    x, y = -3.4, 4.3
    wood = H.material("MastMat", base_color="#7A5432", roughness=0.8, metallic=0.0)
    track(H.add_cylinder("Mast", radius=0.09, depth=5.0, location=(x, y, 2.4), vertices=10, mat=wood))
    track(H.add_cylinder("Boom", radius=0.06, depth=2.9, location=(x + 1.4, y, 1.05), rotation=(0.0, 90.0, 0.0),
                         vertices=8, mat=wood))
    a = H.material("SailRedMat", base_color="#E8584A", roughness=0.75, metallic=0.0)
    b = H.material("SailCreamMat", base_color="#FFF6E4", roughness=0.75, metallic=0.0)
    # the sail: horizontal stripes of a triangle (mast to boom end), a little bellied toward the camera
    import bmesh
    bm = bmesh.new()
    top, bot, end = 4.6, 1.12, 2.8
    rows = 6
    for k in range(rows):
        za, zb = bot + (top - bot) * k / rows, bot + (top - bot) * (k + 1) / rows
        wa, wb = end * (1 - k / rows), end * (1 - (k + 1) / rows)
        belly = lambda t: -0.18 * (1 - t) * 4 * 0.25  # noqa: E731 (a slight curve toward the camera)
        v = [bm.verts.new((x + 0.1, y + belly(0), za)), bm.verts.new((x + 0.1 + wa, y + belly(0) * 0.3, za)),
             bm.verts.new((x + 0.1 + wb, y + belly(0) * 0.3, zb)), bm.verts.new((x + 0.1, y + belly(0), zb))]
        bm.faces.new(v).material_index = k % 2
    mesh = H.mesh_from_bmesh("Sail", bm)
    mesh.materials.append(a)
    mesh.materials.append(b)
    track(H.link(H.bpy.data.objects.new("Sail", mesh)))
    flag = H.material("FlagMat", base_color="#FFD23C", roughness=0.6, metallic=0.0)
    track(H.add_extrusion("Flag", [(0.0, 0.0), (0.55, 0.15), (0.0, 0.3)], depth=0.01, location=(x + 0.09, y, 4.62),
                          rotation=(90.0, 0.0, 0.0), mat=flag))


def build_hut():
    """A palm-roofed shelter at the back right: four poles, a thatched pyramid roof, a hammock, a lantern."""
    x, y = 3.9, 4.0
    pole = H.material("HutPoleMat", base_color="#8A6238", roughness=0.85, metallic=0.0)
    for i, (dx, dy) in enumerate(((-0.95, -0.75), (0.95, -0.75), (-0.95, 0.75), (0.95, 0.75))):
        track(H.add_cylinder(f"HutPole{i}", radius=0.07, depth=2.4, location=(x + dx, y + dy, 1.2), vertices=8, mat=pole))
    thatch = H.material("ThatchMat", base_color="#D9B45A", roughness=0.95, metallic=0.0)
    roof = H.add_cone("HutRoof", radius=1.85, depth=1.05, location=(x, y, 2.86), vertices=4, mat=thatch, smooth=False)
    roof.rotation_euler = (0.0, 0.0, 0.785398)
    roof.scale = (1.0, 0.85, 1.0)
    track(roof)
    net = H.material("HammockMat", base_color="#F2E2B8", roughness=0.9, metallic=0.0)
    K.tube("Hammock", [(x - 0.95, y + 0.75, 1.45), (x - 0.45, y + 0.75, 0.95), (x, y + 0.75, 0.85),
                       (x + 0.45, y + 0.75, 0.95), (x + 0.95, y + 0.75, 1.45)], 0.07, net, resolution=6)
    glow = K.emissive("LanternGlowMat", "#ffd9a0", base="#3a2a14", strength=1.0)
    K.icosphere("HutLantern", 0.1, (x - 0.95, y - 0.92, 1.95), glow, 2)
    track(H.add_light("POINT", name="HutLight", location=(x - 0.95, y - 1.1, 1.95), target=(x, y, 0.0),
                      energy=P["lamp_energy"], light_color="#ffc27a"))


def build_cargo():
    K.prop("Meadow_Barrel", "Barrel", (6.0, 2.6, 0.0), rot=0.0, scale=0.7)
    K.prop("Meadow_Barrel", "Barrel2", (5.85, 1.9, 0.0), rot=50.0, scale=0.6)
    K.prop("Meadow_Crate", "Crate", (-5.9, 4.4, 0.0), rot=15.0, scale=0.65)
    # the treasure chest (left): a box, a rounded lid, gold bands and coins spilling out
    x, y = -5.4, 2.5
    wood = H.material("ChestMat", base_color="#8E5530", roughness=0.7, metallic=0.0)
    gold = H.material("GoldMat", base_color="#F2C230", roughness=0.3, metallic=0.85)
    box("Chest", x - 0.45, x + 0.45, y - 0.3, y + 0.3, 0.0, 0.42, wood)
    lid = H.add_cylinder("ChestLid", radius=0.3, depth=0.9, location=(x, y + 0.06, 0.48), rotation=(0.0, 90.0, 0.0),
                         vertices=12, mat=wood, smooth=False)
    lid.rotation_euler = (-0.6, 1.5708, 0.0)
    track(lid)
    for i, dx in enumerate((-0.3, 0.3)):
        box(f"ChestBand{i}", x + dx - 0.04, x + dx + 0.04, y - 0.306, y + 0.306, -0.004, 0.43, gold)
    for i, (cx, cy) in enumerate(((0.55, -0.35), (0.7, -0.15), (0.62, -0.55), (0.35, -0.5), (0.8, -0.42))):
        track(H.add_cylinder(f"Coin{i}", radius=0.06, depth=0.012, location=(x + cx, y + cy, 0.006 + 0.012 * (i % 2)),
                             vertices=10, mat=gold, smooth=False))
    # the life ring on its post (back right corner)
    post = H.material("RingPostMat", base_color="#F4F1EA", roughness=0.6, metallic=0.0)
    box("RingPost", 6.05, 6.17, 4.7, 4.82, -0.1, 1.6, post)
    ring = H.material("LifeRingMat", base_color="#FF5A3C", roughness=0.5, metallic=0.0)
    track(H.add_torus("LifeRing", major=0.3, minor=0.08, location=(6.11, 4.62, 1.15), rotation=(90.0, 0.0, 0.0),
                      major_segments=20, minor_segments=8, mat=ring))


def build_seascape():
    wz = P["water_z"]
    # a friendly whale off to the right, blowing a spout
    body = H.material("WhaleMat", base_color="#3A6EA8", roughness=0.5, metallic=0.0)
    belly = H.material("WhaleBellyMat", base_color="#DCE8F2", roughness=0.5, metallic=0.0)
    wx, wy = 8.0, 17.0
    w = K.icosphere("Whale", 1.0, (wx, wy, wz + 0.1), body, 3)
    w.scale = (2.6, 1.2, 0.9)
    k = K.icosphere("WhaleBelly", 1.0, (wx - 0.3, wy - 0.35, wz - 0.05), belly, 2)
    k.scale = (2.0, 0.85, 0.55)
    eye = H.material("WhaleEyeMat", base_color="#14182A", roughness=0.4, metallic=0.0)
    K.icosphere("WhaleEye", 0.1, (wx - 1.7, wy - 0.95, wz + 0.45), eye, 1)
    track(H.add_extrusion("WhaleTail", [(0.0, 0.0), (0.9, 0.7), (0.5, 0.0), (0.9, -0.7)], depth=0.12,
                          location=(wx + 2.4, wy, wz + 0.55), rotation=(90.0, -30.0, 0.0), mat=body))
    spout = K.emissive("SpoutMat", "#ffffff", base="#eaf6ff", strength=0.25, roughness=0.5)
    for i, (dx, z, r) in enumerate(((0.0, 1.2, 0.18), (0.15, 1.65, 0.24), (-0.2, 1.95, 0.22), (0.25, 2.1, 0.2),
                                    (-0.05, 2.3, 0.26))):
        K.icosphere(f"Spout{i}", r, (wx - 0.6 + dx, wy, wz + z), spout, 1)
    # a little palm island far left
    sand = H.material("IslandSandMat", base_color="#F2D9A2", roughness=0.95, metallic=0.0)
    isl = K.icosphere("Island", 1.0, (-18.0, 30.0, wz - 0.9), sand, 3)
    isl.scale = (5.0, 3.6, 1.6)
    K.prop("PalmTree", "IslandPalm", (-18.5, 30.0, wz + 0.5), rot=30.0, scale=1.0)
    K.prop("PalmTree", "IslandPalm2", (-16.6, 31.0, wz + 0.4), rot=160.0, scale=0.8)
    K.prop("Rock_A", "IslandRock", (-14.8, 29.2, wz - 0.1), rot=0.0, scale=0.8)
    K.prop("Boat_Meadow_4", "Ship", (30.0, 52.0, wz - 0.1), rot=-25.0, scale=1.8)
    K.prop("SailBoat", "FarSail", (-34.0, 60.0, wz - 0.2), rot=60.0, scale=1.2)
    for i, (x, y, z, r) in enumerate(((2.0, 9.0, 5.0, 20.0), (5.5, 12.0, 6.2, -30.0), (-4.0, 14.0, 6.8, 60.0),
                                      (6.11, 4.76, 1.6, -90.0))):
        K.prop("Seagull", f"Gull{i}", (x, y, z), rot=r, scale=0.75)


def main():
    K.reset()
    build_sea()
    build_raft()
    build_mast()
    build_hut()
    build_cargo()
    build_seascape()
    K.export("ocean", BLEND_PATH, GLB_PATH)


main()
