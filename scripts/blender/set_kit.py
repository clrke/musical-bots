"""Shared building blocks for the Musical Bots sets (diner.py, big_house.py, street.py and the outdoor sets).

Blender is Z-up in metres; the glTF export maps Blender (x, y, z) to three.js (x, z, -y), so
Blender +Y (the back of a set) is three.js -Z (away from the staging camera).

Conventions shared by every set:
  - walls are thin boxes (they have a thickness, so a doorway reads as a real opening);
  - doorways are real gaps in the wall (wall_with_openings), so the bots can walk through them;
  - spheres are icospheres (bmesh create_uvsphere emits a nondeterministic polygon order);
  - lights export in RAW mode: Blender W is written as-is and three.js reads it as candela, so
    a set's lights need no runtime scale factor (the old x0.03 hack in main.js);
  - text is converted to a mesh before export (byte-stable, no curve export involved);
  - no two faces share a plane where they overlap (z-fighting flicker): pieces that meet butt up against each other
    (a side wall stops at the back wall's front face), a trim stands REVEAL proud of the faces it covers (a jamb's
    inner face inside the doorway, a head's underside below the lintel), decals and cards sit a few mm off their
    surface. web/overlaps.mjs checks every exported .glb (web/test-overlaps.mjs).
"""

import os
import sys
from pathlib import Path

SKILL_SCRIPTS = Path(os.environ.get(
    "BLENDER_SKILL_SCRIPTS",
    "/Users/arke/.local/share/muse/skills/bundled/muse-core~v1/skills/blender/scripts",
))
if not (SKILL_SCRIPTS / "bpy_helpers.py").is_file():
    raise SystemExit(f"bpy_helpers.py not found under {SKILL_SCRIPTS} "
                     f"(override via BLENDER_SKILL_SCRIPTS)")
sys.path.insert(0, str(SKILL_SCRIPTS))
import bpy_helpers as H  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
BUILT = []  # every object added to the scene, for reporting


def track(obj):
    BUILT.append(obj)
    return obj


def reset():
    H.reset_scene()  # idempotent: start from an empty scene every run
    del BUILT[:]
    _PROP_MESH.clear()


def box(name, x0, x1, y0, y1, z0, z1, mat):
    """Axis-aligned box from its extents (Blender coordinates)."""
    return track(H.add_box(name, size=(x1 - x0, y1 - y0, z1 - z0),
                           location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat=mat))


def wall_with_openings(name, x0, x1, y0, y1, height, openings, mat):
    """A wall along X (y0..y1 thick) from x0 to x1, with rectangular openings.

    openings: [(xa, xb, za, zb)], sorted by xa, inside [x0, x1]. The wall is tiled into boxes:
    full-height strips between the openings, a lintel above and a sill below each one.
    """
    parts = []
    x = x0
    for i, (xa, xb, za, zb) in enumerate(sorted(openings)):
        if xa > x + 1e-6:
            parts.append(box(f"{name}_{len(parts)}", x, xa, y0, y1, 0.0, height, mat))
        if zb < height - 1e-6:
            parts.append(box(f"{name}_{len(parts)}", xa, xb, y0, y1, zb, height, mat))
        if za > 1e-6:
            parts.append(box(f"{name}_{len(parts)}", xa, xb, y0, y1, 0.0, za, mat))
        x = xb
    if x1 > x + 1e-6:
        parts.append(box(f"{name}_{len(parts)}", x, x1, y0, y1, 0.0, height, mat))
    return parts


REVEAL = 0.006  # m a trim stands proud of the wall faces it covers (no shared plane: no z-fighting)


def door_trim(name, xa, xb, y_mid, top, mat, width=0.1, depth=0.16):
    """Jambs + header around a doorway [xa, xb] x [0, top] in a wall centred on y_mid (depth: the trim's, > the wall's).

    The trim covers the doorway's reveals: the jambs' inner faces stand REVEAL inside the opening and the head's
    underside REVEAL below the lintel, so the wall's own reveal faces are inside the trim, never in its plane.
    """
    y0, y1 = y_mid - depth / 2, y_mid + depth / 2
    e = REVEAL
    box(f"{name}JambL", xa - width, xa + e, y0, y1, -e, top + width, mat)  # (its foot just under the floor)
    box(f"{name}JambR", xb - e, xb + width, y0, y1, -e, top + width, mat)
    box(f"{name}Head", xa + e, xb - e, y0, y1, top - e, top + width, mat)


def icosphere(name, radius, location, mat, subdivisions=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    obj = bpy.data.objects.new(name, H.mesh_from_bmesh(name, bm))
    H.link(obj)
    obj.location = location
    H.assign(obj, mat)
    H.shade_smooth(obj, angle=35)
    return track(obj)


def text_mesh(name, body, size, location, mat, extrude=0.02, rotation=(90.0, 0.0, 0.0)):
    """Text as a plain mesh object (the curve is evaluated, converted and removed)."""
    t = H.add_text(name + "Curve", body, size=size, extrude=extrude, location=location,
                   rotation=rotation, mat=mat)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
    obj = bpy.data.objects.new(name, me)
    H.link(obj)
    obj.matrix_world = t.matrix_world.copy()
    if not me.materials:
        me.materials.append(mat)
    curve = t.data
    bpy.data.objects.remove(t)
    bpy.data.curves.remove(curve)
    return track(obj)


def to_mesh(obj, name=None):
    """A curve / text object as a plain mesh object in its place (the curve removed): byte-stable glTF."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    out = bpy.data.objects.new(name or obj.name, me)
    H.link(out)
    out.matrix_world = obj.matrix_world.copy()
    mats = list(obj.data.materials) if hasattr(obj.data, "materials") else []
    if not me.materials:
        for m in mats:
            me.materials.append(m)
    data = obj.data
    if obj in BUILT:
        BUILT.remove(obj)
    bpy.data.objects.remove(obj)
    if isinstance(data, bpy.types.Curve):
        bpy.data.curves.remove(data)
    return track(out)


def tube(name, points, radius, mat, resolution=6, bevel_resolution=2, smooth_path=True):
    """A round tube along a polyline (world coords) as a mesh: rails, ropes, a slide's chute."""
    return to_mesh(H.add_tube(name + "Curve", points, radius=radius, mat=mat, resolution=resolution,
                              bevel_resolution=bevel_resolution, smooth_path=smooth_path), name)


# ------------------------------------------------------------------ props made in Squatopia 2 (the owner's own)

PROPS_DIR = Path(__file__).resolve().parent / "props" / "squatopia"
_PROP_MESH = {}  # name -> (mesh, base matrix): one mesh per prop, shared by its copies (glTF instancing)


def prop_material():
    """The props carry their colour in a corner colour attribute "Col" (no textures): one shared material reads it."""
    mat = bpy.data.materials.get("PropVertexMat")
    if mat:
        return mat
    mat = bpy.data.materials.new("PropVertexMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs[0], bsdf.inputs["Base Color"])
    H.set_principled(bsdf, roughness=0.85, metallic=0.0)
    return mat


def separate_coplanar(mesh, push=0.003, dist=0.001, rounds=4):
    """Pushes apart the faces of one mesh that overlap in one plane facing the same way (a lath on a sail, a trim on
    a wall, a doubled awning): the smaller face moves `push` m out along its normal, so it reads in front, no flicker.
    Returns how many faces moved."""
    import bmesh
    from mathutils import Vector

    def proj(face, ax):
        return [(v.co[ax[0]], v.co[ax[1]]) for v in face.verts]

    def shrink(pts, m=0.001):
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        out = []
        for x, y in pts:
            dx, dy = x - cx, y - cy
            ln = (dx * dx + dy * dy) ** 0.5
            out.append((cx, cy) if ln <= m * 1.5 else (x - dx / ln * m, y - dy / ln * m))
        return out

    def overlap(p, q):
        for poly in (p, q):
            n = len(poly)
            for i in range(n):
                (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
                nx, ny = y0 - y1, x1 - x0
                a = [x * nx + y * ny for x, y in p]
                b = [x * nx + y * ny for x, y in q]
                eps = 1e-7 * ((nx * nx + ny * ny) ** 0.5 or 1)
                if max(a) <= min(b) + eps or max(b) <= min(a) + eps:
                    return False
        return True

    moved = 0
    for _ in range(rounds):
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        buckets = {}
        for f in bm.faces:
            n = f.normal
            if n.length < 0.5 or f.calc_area() < 1e-6:
                continue
            key = (round(n.x * 40), round(n.y * 40), round(n.z * 40), round(n.dot(f.verts[0].co) / 0.004))
            buckets.setdefault(key, []).append(f)
        push_faces = set()
        for key, faces in buckets.items():
            near = faces + buckets.get(key[:3] + (key[3] + 1,), [])
            for i, f in enumerate(faces):
                n = f.normal
                a = [abs(n.x), abs(n.y), abs(n.z)]
                drop = a.index(max(a))
                ax = [k for k in range(3) if k != drop]
                pf = shrink(proj(f, ax))
                for g in near[i + 1:]:
                    if g is f or n.dot(g.normal) < 0.9995:
                        continue
                    if max(abs(n.dot(v.co) - n.dot(f.verts[0].co)) for v in g.verts) > dist:
                        continue
                    if set(f.verts) & set(g.verts) and len(set(f.verts) & set(g.verts)) >= 2 and not overlap(pf, shrink(proj(g, ax))):
                        continue
                    if overlap(pf, shrink(proj(g, ax))):
                        push_faces.add(f if f.calc_area() < g.calc_area() else g)
        if not push_faces:
            bm.free()
            break
        offs = {}
        for f in push_faces:
            for v in f.verts:
                offs.setdefault(v, Vector()).__iadd__(f.normal * push)
        for v, d in offs.items():
            v.co += d if d.length <= push * 1.01 else d.normalized() * push
        moved += len(push_faces)
        bm.to_mesh(mesh)
        bm.free()
    return moved


def prop(name, tag, location, rot=0.0, scale=1.0):
    """Places a Squatopia prop (scripts/blender/props/squatopia/<name>.fbx, see credits/ASSETS.md) as object `tag`.

    location: where its origin (the ground contact point) goes; rot: degrees about Z (0: its front faces -Y, the
    camera); scale: uniform. Copies of one prop share its mesh.
    """
    from mathutils import Matrix
    if name not in _PROP_MESH:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=str(PROPS_DIR / f"{name}.fbx"))
        new = [o for o in bpy.data.objects if o not in before]
        src = next(o for o in new if o.type == "MESH")
        mesh = src.data
        mesh.name = name
        mesh.materials.clear()
        mesh.materials.append(prop_material())
        moved = separate_coplanar(mesh, push=0.004)
        if moved:
            print(f"[prop] {name}: {moved} faces pushed out of a shared plane")
        _PROP_MESH[name] = (mesh, src.matrix_world.copy())
        for o in new:
            bpy.data.objects.remove(o)
    mesh, base = _PROP_MESH[name]
    obj = bpy.data.objects.new(tag, mesh)
    H.link(obj)
    import math
    obj.matrix_world = (Matrix.Translation(location) @ Matrix.Rotation(math.radians(rot), 4, "Z")
                        @ Matrix.Scale(scale, 4) @ base)
    return track(obj)


def color_material(name, roughness=0.5, metallic=0.0):
    """A material whose base colour is the mesh's corner colour attribute "Col" (exports as glTF COLOR_0)."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs[0], bsdf.inputs["Base Color"])
    H.set_principled(bsdf, roughness=roughness, metallic=metallic)
    return mat


def water(name, x0, x1, y0, y1, z, near, far, mat, rows=(0.0, 0.08, 0.25, 0.6, 1.0)):
    """A flat sheet of water at height z, its colour running from `near` (y0) to `far` (y1) through `rows` (0..1)."""
    import bmesh
    bm = bmesh.new()
    col = bm.loops.layers.float_color.new("Col")
    a, b = H.color(near), H.color(far)
    vs = []
    for t in rows:
        y = y0 + (y1 - y0) * t
        vs.append((bm.verts.new((x0, y, z)), bm.verts.new((x1, y, z)), t))
    for (a0, a1, ta), (b0, b1, tb) in zip(vs, vs[1:]):
        f = bm.faces.new((a0, a1, b1, b0))
        for loop in f.loops:
            t = ta if loop.vert in (a0, a1) else tb
            loop[col] = tuple(a[k] + (b[k] - a[k]) * t for k in range(3)) + (1.0,)
    mesh = H.mesh_from_bmesh(name, bm)
    mesh.materials.append(mat)
    return track(H.link(bpy.data.objects.new(name, mesh)))


def emissive(name, color, base="#101418", strength=1.0, roughness=0.4):
    """Principled with emission (stays extension-free in glTF: emissiveFactor)."""
    return H.material(name, base_color=base, roughness=roughness, metallic=0.0,
                      emission=color, emission_strength=strength)


def tri_count(obj):
    """Triangulated face count of the evaluated object."""
    if obj.type != "MESH":
        return 0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    n = len(bm.calc_loop_triangles())
    bm.free()
    ev.to_mesh_clear()
    return n


def export(tag, blend_path, glb_path):
    """Save the .blend and export the .glb (lights in RAW mode: W -> candela 1:1)."""
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 sidecar
    H.save_blend(str(blend_path))
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:  # already enabled or headless prefs; keep going
        print(f"[{tag}] addon_enable io_scene_gltf2: {exc!r}")
    Path(glb_path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", export_lights=True,
                              export_import_convert_lighting_mode="RAW")
    total = sum(tri_count(o) for o in BUILT)
    print(f"[{tag}] {len(BUILT)} objects, {total} tris (budget 60000), Blender {bpy.app.version_string}")
    print(f"[{tag}] wrote {blend_path} ({Path(blend_path).stat().st_size} bytes)")
    print(f"[{tag}] wrote {glb_path} ({Path(glb_path).stat().st_size} bytes)")
    print(f"[{tag}] lights={[o.name for o in bpy.data.objects if o.type == 'LIGHT']}")
