// Coplanar overlap checker for the Blender sets (environments/*.glb): finds the triangle pairs that z-fight (flicker),
// two faces in the same plane (within `dist`, 1 mm by default) whose footprints overlap by area.
//
//  - same-facing pairs (a door jamb's inner face on the wall's reveal, a trim's underside on a lintel's, two boxes
//    sharing an outer face, a duplicated face) always flicker: they are reported;
//  - opposite-facing pairs (a box standing on the floor, a rail against a wall) are hidden inside the solids, unless one
//    of the two is an open sheet (a plane: a decal, a window, a sky card): the solid's face and the sheet's back side
//    (double-sided materials) then show together, reported, except underneath (a floor sheet under a box: never seen).
// Pairs inside one triangle soup that only share an edge (a checker floor's tiles) do not overlap by area: a 1 mm
// shrink keeps touching tiles apart.
//
//   node web/overlaps.mjs [set ...] [--dist 0.001] [--json]
//
// Pure geometry: three's GLTFLoader reads the .glb headless (no textures), the world matrices place the triangles.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

/** Every set .glb in environments/ (name without the extension). */
export function setFiles() {
  return readdirSync(join(root, 'environments')).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
}

export async function loadGlb(name) {
  const bytes = readFileSync(join(root, 'environments', `${name}.glb`));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return gltf.scene;
}

/** World triangles of a three group: [{ a, b, c, n, d, part, mesh }] (part: node name / material, mesh: its key). */
export function trianglesOf(group) {
  group.updateMatrixWorld(true);
  const out = [];
  const meshes = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const name = (o.name || o.parent?.name || 'mesh');
    const mat = Array.isArray(o.material) ? o.material.map((m) => m.name).join('+') : o.material?.name ?? '';
    const key = `${name}[${mat}]`;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tris = [];
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
      const e1 = v[1].clone().sub(v[0]), e2 = v[2].clone().sub(v[0]);
      const nn = e1.cross(e2);
      const area = nn.length() / 2;
      if (area < 1e-8) continue;
      nn.normalize();
      tris.push({ a: v[0].clone(), b: v[1].clone(), c: v[2].clone(), n: nn, d: nn.dot(v[0]), mesh: key, area });
    }
    // an open sheet: every triangle in one plane (a plane, a decal, a card)
    const flat = tris.length > 0 && tris.every((t) => Math.abs(t.n.dot(tris[0].n)) > 0.9999 && Math.abs(t.n.dot(t.a) * Math.sign(t.n.dot(tris[0].n)) - tris[0].d) < 1e-4);
    for (const t of tris) { t.sheet = flat; out.push(t); }
    meshes.push(key);
  });
  return { tris: out, meshes };
}

// 2D projection on the plane's dominant axes
function project(t, ax) {
  const [i, j] = ax;
  return [[t.a.getComponent(i), t.a.getComponent(j)], [t.b.getComponent(i), t.b.getComponent(j)], [t.c.getComponent(i), t.c.getComponent(j)]];
}

/** Shrinks a 2D triangle toward its centroid by `m` (metres, along each vertex's direction). */
function shrink(p, m) {
  const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
  return p.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy);
    if (l <= m * 1.5) return [cx, cy];
    return [x - (dx / l) * m, y - (dy / l) * m];
  });
}

/** Do two 2D triangles overlap by area (separating axis test on their edges)? */
function overlap2d(p, q) {
  for (const tri of [p, q]) {
    for (let e = 0; e < 3; e++) {
      const [x0, y0] = tri[e], [x1, y1] = tri[(e + 1) % 3];
      const nx = y0 - y1, ny = x1 - x0;
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity;
      for (const [x, y] of p) { const s = x * nx + y * ny; pmin = Math.min(pmin, s); pmax = Math.max(pmax, s); }
      for (const [x, y] of q) { const s = x * nx + y * ny; qmin = Math.min(qmin, s); qmax = Math.max(qmax, s); }
      const len = Math.hypot(nx, ny) || 1;
      if (pmax <= qmin + 1e-6 * len || qmax <= pmin + 1e-6 * len) return false;
    }
  }
  return true;
}

/**
 * The z-fighting pairs of a group: [{ a, b, facing: 'same'|'opposite', normal, at, gap }] grouped by mesh pair:
 * { pairs: [{ a, b, facing, count, at: [x, y, z], normal }], tris }. dist: plane gap (m), margin: the 2D shrink (m).
 */
export function coplanarOverlaps(group, { dist = 0.001, margin = 0.001 } = {}) {
  const { tris } = trianglesOf(group);
  // bucket by the canonical normal (sign folded: opposite faces share a bucket) and the plane offset
  const buckets = new Map();
  const canon = (n) => {
    const c = [n.x, n.y, n.z];
    const k = Math.abs(c[0]) > 1e-6 ? 0 : Math.abs(c[1]) > 1e-6 ? 1 : 2;
    return c[k] < 0 ? -1 : 1;
  };
  const step = Math.max(dist * 2, 0.002);
  tris.forEach((t, i) => {
    const s = canon(t.n);
    t.s = s;
    t.cn = t.n.clone().multiplyScalar(s);
    t.cd = t.d * s;
    t.key = `${Math.round(t.cn.x * 40)},${Math.round(t.cn.y * 40)},${Math.round(t.cn.z * 40)}`;
    const k = `${t.key}|${Math.round(t.cd / step)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const found = new Map();
  const axesOf = (n) => {
    const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const drop = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    return [0, 1, 2].filter((x) => x !== drop);
  };
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|');
    const cand = [...list, ...(buckets.get(`${nk}|${+dk + 1}`) ?? [])];
    for (let x = 0; x < list.length; x++) {
      const t = tris[list[x]];
      const ax = axesOf(t.cn);
      let p = null;
      for (let y = 0; y < cand.length; y++) {
        const j = cand[y];
        if (y < list.length && y <= x) continue;
        const u = tris[j];
        if (Math.abs(t.cn.dot(u.cn)) < 0.9995) continue;
        // u's vertices on t's plane
        const gap = Math.max(...[u.a, u.b, u.c].map((v) => Math.abs(t.cn.dot(v) - t.cd)));
        if (gap > dist) continue;
        const facing = t.s === u.s ? 'same' : 'opposite';
        if (facing === 'opposite') {
          // two solids touching: both faces inside; a sheet on a solid: the solid's face and the sheet's back show on
          // the solid's outer side, unless that side is underneath (the floor under a box: never seen)
          if (t.mesh === u.mesh || (!t.sheet && !u.sheet)) continue;
          if (t.sheet !== u.sheet && (t.sheet ? u : t).n.y < -0.5) continue;
        }
        p ??= shrink(project(t, ax), margin);
        const q = shrink(project(u, ax), margin);
        if (!overlap2d(p, q)) continue;
        const [ma, mb] = t.mesh < u.mesh ? [t.mesh, u.mesh] : [u.mesh, t.mesh];
        const key = `${ma}|${mb}|${facing}`;
        const f = found.get(key) ?? { a: ma, b: mb, facing, count: 0, at: null, normal: null, gap: 0 };
        f.count++;
        f.gap = Math.max(f.gap, gap);
        f.at ??= [t.a, t.b, t.c].reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(3).toArray().map((c) => +c.toFixed(3));
        f.normal ??= t.n.toArray().map((c) => +c.toFixed(2));
        found.set(key, f);
      }
    }
  }
  return { pairs: [...found.values()].sort((a, b) => (a.a + a.b).localeCompare(b.a + b.b)), tris: tris.length };
}

// --- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const dist = Number(opt('--dist') ?? 0.001), json = flag('--json');
  const names = args.length ? args : setFiles();
  const all = {};
  let total = 0;
  for (const name of names) {
    const r = coplanarOverlaps(await loadGlb(name), { dist });
    all[name] = r.pairs;
    total += r.pairs.length;
    if (!json) {
      console.log(`${name}: ${r.tris} tris, ${r.pairs.length} z-fighting mesh pairs`);
      for (const p of r.pairs) console.log(`  ${p.facing.padEnd(8)} ${p.a}  x  ${p.b}  (${p.count} tri pairs, n ${p.normal}, at ${p.at})`);
    }
  }
  if (json) console.log(JSON.stringify(all, null, 1));
  process.exitCode = total ? 1 : 0;
}
