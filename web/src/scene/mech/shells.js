// The head shells (FACE_SHAPES): silhouette geometry with its engineering (bands, rivets, bolts,
// vents, fins), a smooth hull for the selection outline, the analytic front surface the eye, brow
// and mouth mechanisms are mounted on, the panel seams the shader draws, and the face layout.
// Head-local frame: +Z faces the viewer, +Y up, origin = head centre, scale 1 (about 23 cm wide).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT, aimZ, chamferBox, cylinderY, extrude, hexBolt, lathe, ringY, rivet, roundedBox, sphere, torus, trs, tube } from './builder.js';

export const SHELL_OWNER = 1;

/** Highest shell point allowed (m above the centre, scale 1): keeps the back row under +6 deg. */
export const SHELL_TOP_MAX = 0.106;

const SEAM_NONE = [0, 0, 0, 99, 0, 0, 0, -99];

/** Smooth closed version of shell pieces for the inverted-hull outline. */
function hullOf(...pieces) {
  const parts = pieces.map((g) => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k);
    const w = mergeVertices(c, 1e-4);
    w.computeVertexNormals();
    return w;
  });
  if (parts.length === 1) return parts[0];
  // concatenate (positions + normals + index)
  let n = 0;
  let m = 0;
  for (const p of parts) {
    n += p.getAttribute('position').count;
    m += p.index.count;
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const idx = new Uint32Array(m);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    pos.set(p.getAttribute('position').array, vo * 3);
    nor.set(p.getAttribute('normal').array, vo * 3);
    const I = p.index.array;
    for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
    vo += p.getAttribute('position').count;
    io += I.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Numeric surface normal of a front surface z(x, y). */
export function surfaceNormal(zfn, x, y, out = [0, 0, 1]) {
  const e = 0.002;
  const dzdx = (zfn(x + e, y) - zfn(x - e, y)) / (2 * e);
  const dzdy = (zfn(x, y + e) - zfn(x, y - e)) / (2 * e);
  const l = Math.hypot(dzdx, dzdy, 1);
  out[0] = -dzdx / l;
  out[1] = -dzdy / l;
  out[2] = 1 / l;
  return out;
}

/** A rivet / bolt on the front surface at (x, y), facing out. */
function surfaceRivet(b, zfn, x, y, r, mat = MAT.CHROME, bolt = false) {
  const n = surfaceNormal(zfn, x, y);
  const z = zfn(x, y);
  b.add(bolt ? hexBolt(r) : rivet(r), { matrix: aimZ([x, y, z - 0.0006], n), mat, owner: SHELL_OWNER });
}

/** Rivets along the face panel seam (corners and mid sides). */
function panelRivets(b, zfn, panel, faceX = 0, r = 0.0026) {
  const [hw, hh, rad, cy] = panel;
  const inset = rad * 0.3 + 0.007;
  const pts = [
    [hw - inset, hh - inset],
    [-hw + inset, hh - inset],
    [hw - inset, -hh + inset],
    [-hw + inset, -hh + inset],
  ];
  for (const [x, y] of pts) surfaceRivet(b, zfn, faceX + x, cy + y, r);
}

/** Lathe ring of rivets around a shell at height y and radius r(y) (skips the face). */
function rivetRing(b, y, radius, count, size = 0.0024, skipFront = 0.75, zScale = 1) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const dir = [Math.sin(a), 0, Math.cos(a) * zScale];
    if (Math.cos(a) > skipFront) continue;
    const l = Math.hypot(dir[0], dir[2]);
    b.add(rivet(size), { matrix: aimZ([radius * Math.sin(a), y, radius * Math.cos(a) * zScale], [dir[0] / l, 0, dir[2] / l]), mat: MAT.CHROME, owner: SHELL_OWNER });
  }
}

// ------------------------------------------------------------------ dome (diving helmet)

function dome() {
  const R = 0.112;
  const yBand = 0.036;
  const H = 0.068; // dome height above the band
  const yBot = -0.088;
  const surfaceZ = (x, y) => {
    let r = R;
    if (y > yBand) {
      const f = Math.min(1, (y - yBand) / H);
      r = R * Math.sqrt(Math.max(0, 1 - f * f));
    }
    return Math.sqrt(Math.max(1e-8, r * r - x * x));
  };
  const panel = [0.088, 0.066, 0.03, -0.02];
  return {
    name: 'dome',
    surfaceZ,
    layout: { eyeX: 0.05, eyeY: 0.01, mouthY: -0.052, mouthHalfWidth: 0.041, cheekX: 0.077, cheekY: -0.03, earX: R, earY: -0.012, earZ: 0, top: yBand + H, bottom: yBot - 0.004, halfWidth: R + 0.006, mount: [0, yBand + H, 0], faceX: 0 },
    seams: [
      [1, 0, 0, 0, 0, 1, 0, yBand + 0.006], // crown seam front-back
      [0, 0, 1, 0, 0, 1, 0, yBand + 0.006], // crown seam side-side
      [0, 1, 0, -0.056, 0, 0, -1, -0.03], // lower ring, sides and back
      SEAM_NONE,
    ],
    panel,
    build(b) {
      const profile = [[0, yBot - 0.004], [R - 0.014, yBot - 0.004], [R - 0.004, yBot - 0.001], [R, yBot + 0.008], [R, yBand]];
      for (let i = 1; i <= 14; i++) {
        const a = (i / 14) * (Math.PI / 2);
        profile.push([R * Math.cos(a), yBand + H * Math.sin(a)]);
      }
      profile[profile.length - 1][0] = 0;
      const shell = lathe(profile, 40);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // helmet brim band with rivets, chin ring
      b.add(ringY(R + 0.0015, 0.0048, yBand, 5, 40), { mat: MAT.ACCENT, owner: SHELL_OWNER });
      rivetRing(b, yBand, R + 0.006, 14, 0.0022, 0.97);
      b.add(ringY(R - 0.006, 0.0042, yBot + 0.002, 4, 32), { mat: MAT.STEEL, owner: SHELL_OWNER });
      // crown cap plate
      const cap = cylinderY(0.016, 0.014, 0.004, 20);
      b.add(cap, { matrix: trs([0, yBand + H - 0.0008, 0]), mat: MAT.STEEL, owner: SHELL_OWNER });
      panelRivets(b, surfaceZ, panel);
    },
  };
}

// ------------------------------------------------------------------ box (tin robot)

function box() {
  const W = 0.236;
  const H = 0.2;
  const D = 0.188;
  const r = 0.024;
  const zf = D / 2;
  const surfaceZ = (x, y) => {
    // flat front with rounded edges
    const ex = Math.max(0, Math.abs(x) - (W / 2 - r));
    const ey = Math.max(0, Math.abs(y) - (H / 2 - r));
    const e = Math.hypot(ex, ey);
    return e > 0 ? zf - r + Math.sqrt(Math.max(1e-8, r * r - Math.min(r, e) ** 2)) : zf;
  };
  const panel = [0.098, 0.084, 0.014, -0.006];
  return {
    name: 'box',
    surfaceZ,
    layout: { eyeX: 0.052, eyeY: 0.016, mouthY: -0.05, mouthHalfWidth: 0.044, cheekX: 0.082, cheekY: -0.028, earX: W / 2, earY: -0.004, earZ: 0, top: H / 2, bottom: -H / 2, halfWidth: W / 2, mount: [0, H / 2, -0.01], faceX: 0 },
    seams: [
      [0, 1, 0, 0.064, 0, 0, -1, -(zf - 0.012)], // lid seam around the sides and back
      [1, 0, 0, 0, 0, 0, -1, 0.04], // back seam
      SEAM_NONE,
      SEAM_NONE,
    ],
    panel,
    build(b) {
      const shell = roundedBox(W, H, D, r, 3);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // side vents (louvres)
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const v = chamferBox(0.008, 0.0055, 0.07, 0.002);
          b.add(v, { matrix: trs([s * (W / 2 - 0.0015), -0.035 + i * 0.012, -0.03]), mat: MAT.RUBBER, owner: SHELL_OWNER, ao: 0.7 });
        }
        // corner rivets on the side panels
        for (const [y, z] of [[0.075, 0.07], [0.075, -0.07], [-0.075, 0.07], [-0.075, -0.07]]) {
          b.add(rivet(0.0026), { matrix: aimZ([s * (W / 2 - 0.0004), y, z], [s, 0, 0]), mat: MAT.CHROME, owner: SHELL_OWNER });
        }
      }
      // top lid ridge
      const ridge = chamferBox(0.12, 0.008, 0.012, 0.0025);
      b.add(ridge, { matrix: trs([0, H / 2 + 0.001, -0.045]), mat: MAT.ACCENT, owner: SHELL_OWNER });
      panelRivets(b, surfaceZ, panel);
      for (const x of [-0.04, 0.04]) surfaceRivet(b, surfaceZ, x, panel[3] + panel[1] - 0.007, 0.0024);
    },
  };
}

// ------------------------------------------------------------------ capsule (a pill on its side)

function capsule() {
  const R = 0.095;
  const L = 0.07;
  const surfaceZ = (x, y) => {
    const ax = Math.max(0, Math.abs(x) - L / 2);
    return Math.sqrt(Math.max(1e-8, R * R - ax * ax - y * y));
  };
  const panel = [0.072, 0.066, 0.034, -0.012];
  return {
    name: 'capsule',
    surfaceZ,
    layout: { eyeX: 0.05, eyeY: 0.014, mouthY: -0.045, mouthHalfWidth: 0.04, cheekX: 0.074, cheekY: -0.026, earX: L / 2 + R, earY: 0, earZ: 0, top: R, bottom: -R, halfWidth: L / 2 + R, mount: [0, R, -0.01], faceX: 0 },
    seams: [
      [1, 0, 0, L / 2, 0, 0, -1, -0.03], // cap seams (not across the face)
      [1, 0, 0, -L / 2, 0, 0, -1, -0.03],
      [0, 1, 0, 0, 0, 0, -1, 0.02], // back seam
      SEAM_NONE,
    ],
    panel,
    build(b) {
      const shell = new THREE.CapsuleGeometry(R, L, 8, 36, 1);
      shell.rotateZ(Math.PI / 2);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // two bands where the caps meet, over the crown and the back (not across the face)
      for (const s of [-1, 1]) {
        // after rotateY(90 deg) the torus angle phi maps to (y, z) = R (sin phi, -cos phi): the face is
        // around phi = pi, so the arc runs from under the chin through the back to the front-top
        const band = torus(R + 0.001, 0.0035, 4, 26, Math.PI * 1.5 - 0.7);
        band.rotateZ(-Math.PI / 2 - 0.2);
        band.rotateY(Math.PI / 2);
        band.translate(s * L * 0.5, 0, 0);
        b.add(band, { mat: MAT.ACCENT, owner: SHELL_OWNER });
      }
      // a spine of rivets over the top
      for (let i = -3; i <= 3; i++) {
        const a = (i / 3) * 0.75;
        const d = [0, Math.cos(a), -Math.sin(a)];
        b.add(rivet(0.0024), { matrix: aimZ([0, R * Math.cos(a), -R * Math.sin(a)], d), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
      panelRivets(b, surfaceZ, panel);
    },
  };
}

// ------------------------------------------------------------------ bucket (a tin pail with a bail)

function bucket() {
  const yB = -0.088;
  const yT = 0.08;
  const rB = 0.094;
  const rT = 0.108;
  const rAt = (y) => rB + ((rT - rB) * (Math.min(yT, Math.max(yB, y)) - yB)) / (yT - yB);
  const surfaceZ = (x, y) => Math.sqrt(Math.max(1e-8, rAt(y) ** 2 - x * x));
  const panel = [0.08, 0.07, 0.02, -0.012];
  return {
    name: 'bucket',
    surfaceZ,
    layout: { eyeX: 0.05, eyeY: 0.008, mouthY: -0.052, mouthHalfWidth: 0.04, cheekX: 0.076, cheekY: -0.032, earX: rAt(0.03), earY: 0.03, earZ: 0, top: yT + 0.0065, bottom: yB - 0.006, halfWidth: rT + 0.006, mount: [0, yT + 0.003, 0], faceX: 0, noEars: true },
    seams: [[1, 0, 0, 0, 0, 0, -1, 0.03], SEAM_NONE, SEAM_NONE, SEAM_NONE],
    panel,
    build(b) {
      const wall = lathe([[0, yB - 0.004], [rB - 0.01, yB - 0.004], [rB - 0.002, yB], [rB, yB + 0.004], [rT, yT], [rT - 0.004, yT + 0.002], [0, yT + 0.002]], 40);
      this._hull = hullOf(wall.clone());
      b.add(wall, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // rolled rims and beads
      b.add(ringY(rT, 0.0058, yT, 5, 36), { mat: MAT.CHROME, owner: SHELL_OWNER });
      b.add(ringY(rAt(0.046) + 0.0008, 0.0024, 0.046, 3, 36), { mat: MAT.STEEL, owner: SHELL_OWNER });
      b.add(ringY(rAt(-0.066) + 0.0008, 0.0024, -0.066, 3, 36), { mat: MAT.STEEL, owner: SHELL_OWNER });
      b.add(ringY(rB - 0.001, 0.0045, yB, 4, 36), { mat: MAT.ACCENT, owner: SHELL_OWNER });
      // lid: a recessed disc with a ring of rivets
      rivetRing(b, yT - 0.012, rAt(yT - 0.012) + 0.0004, 12, 0.0021, 0.98);
      // bail lugs and the wire handle folded down the back
      const ly = 0.036;
      const lr = rAt(ly);
      for (const s of [-1, 1]) {
        const lug = new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12);
        lug.rotateZ(Math.PI / 2);
        lug.translate(s * (lr + 0.002), ly, 0);
        b.add(lug, { mat: MAT.STEEL, owner: SHELL_OWNER });
        b.add(hexBolt(0.0042, 0.003), { matrix: aimZ([s * (lr + 0.005), ly, 0], [s, 0, 0]), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
      const handle = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        const x = Math.cos(a) * (lr + 0.009);
        const back = Math.sin(a);
        handle.push([x, ly - back * 0.07, -back * (rAt(ly - back * 0.07) + 0.012)]);
      }
      b.add(tube(handle, 0.0022, 28, 5), { mat: MAT.CHROME, owner: SHELL_OWNER });
      const grip = new THREE.CylinderGeometry(0.0055, 0.0055, 0.05, 10);
      grip.rotateZ(Math.PI / 2);
      grip.translate(0, ly - 0.07, -(rAt(ly - 0.07) + 0.012));
      b.add(grip, { mat: MAT.RUBBER, owner: SHELL_OWNER });
      // side seam with rivets
      for (let i = 0; i < 5; i++) {
        const y = -0.06 + i * 0.026;
        b.add(rivet(0.002), { matrix: aimZ([0, y, -rAt(y) - 0.0002], [0, 0, -1]), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
      panelRivets(b, surfaceZ, panel);
    },
  };
}

// ------------------------------------------------------------------ egg

function egg() {
  const ry = 0.104;
  const k = 0.07; // fatter below
  const zs = 0.9; // a little flatter front to back
  const rAt = (y) => {
    const f = Math.max(-1, Math.min(1, y / ry));
    return 0.112 * Math.sqrt(Math.max(0, 1 - f * f)) * (1 - k * f);
  };
  const surfaceZ = (x, y) => zs * Math.sqrt(Math.max(1e-8, rAt(y) ** 2 - x * x));
  const yBand = 0.042;
  const panel = [0.08, 0.068, 0.04, -0.016];
  return {
    name: 'egg',
    surfaceZ,
    layout: { eyeX: 0.049, eyeY: 0.012, mouthY: -0.05, mouthHalfWidth: 0.04, cheekX: 0.075, cheekY: -0.03, earX: rAt(-0.012), earY: -0.012, earZ: 0, top: ry, bottom: -ry, halfWidth: 0.118, mount: [0, ry, 0], faceX: 0 },
    seams: [
      [1, 0, 0, 0, 0, 1, 0, yBand + 0.006],
      [0, 1, 0, -0.06, 0, 0, -1, -0.02],
      SEAM_NONE,
      SEAM_NONE,
    ],
    panel,
    build(b) {
      const profile = [];
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = -ry * Math.cos(t * Math.PI);
        profile.push([rAt(y), y]);
      }
      profile[0][0] = 0;
      profile[n][0] = 0;
      const shell = lathe(profile, 40);
      shell.scale(1, 1, zs);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      const band = ringY(rAt(yBand) + 0.001, 0.0045, 0, 5, 40);
      band.scale(1, 1, zs);
      band.translate(0, yBand, 0);
      b.add(band, { mat: MAT.ACCENT, owner: SHELL_OWNER });
      rivetRing(b, yBand, rAt(yBand) + 0.0055, 12, 0.0021, 0.96, zs);
      panelRivets(b, surfaceZ, panel);
    },
  };
}

// ------------------------------------------------------------------ hex (flat-top hexagonal prism)

function roundPolygon(points, r, perCorner = 4) {
  const pts = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n];
    const v = points[i];
    const q = points[(i + 1) % n];
    const dp = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const dq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const a = [v[0] + ((p[0] - v[0]) / dp) * r, v[1] + ((p[1] - v[1]) / dp) * r];
    const c = [v[0] + ((q[0] - v[0]) / dq) * r, v[1] + ((q[1] - v[1]) / dq) * r];
    for (let k = 0; k <= perCorner; k++) {
      const t = k / perCorner;
      const s = 1 - t;
      pts.push([s * s * a[0] + 2 * s * t * v[0] + t * t * c[0], s * s * a[1] + 2 * s * t * v[1] + t * t * c[1]]);
    }
  }
  return pts;
}

function hex() {
  const R = 0.116;
  const depth = 0.15;
  const bevel = 0.009;
  const zf = depth / 2 + bevel;
  const hy = R * Math.sin(Math.PI / 3);
  const corners = [];
  for (let i = 0; i < 6; i++) corners.push([R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)]);
  const surfaceZ = () => zf;
  const panel = [0.074, 0.074, 0.02, -0.006];
  return {
    name: 'hex',
    surfaceZ,
    layout: { eyeX: 0.05, eyeY: 0.018, mouthY: -0.046, mouthHalfWidth: 0.041, cheekX: 0.078, cheekY: -0.026, earX: R - 0.004, earY: 0, earZ: 0, top: hy + bevel * 0.5, bottom: -hy - bevel * 0.5, halfWidth: R + bevel, mount: [0, hy + bevel * 0.5, -0.01], faceX: 0 },
    seams: [[0, 0, 1, 0, 0, 0, 0, -99], SEAM_NONE, SEAM_NONE, SEAM_NONE],
    panel,
    build(b) {
      const outline = roundPolygon(corners, 0.016, 4);
      const shell = extrude(outline, depth, bevel, 4, 2);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // corner bolts on the front, and on the back
      for (const [x, y] of corners) {
        const ix = x * 0.84;
        const iy = y * 0.84;
        b.add(hexBolt(0.0052, 0.0032), { matrix: aimZ([ix, iy, zf - 0.0005], [0, 0, 1]), mat: MAT.CHROME, owner: SHELL_OWNER });
        b.add(hexBolt(0.0052, 0.0032), { matrix: aimZ([ix, iy, -zf + 0.0005], [0, 0, -1]), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
      // a reinforcing strip along the top edge
      const strip = chamferBox(0.09, 0.006, 0.11, 0.002);
      b.add(strip, { matrix: trs([0, hy + bevel - 0.001, -0.005]), mat: MAT.ACCENT, owner: SHELL_OWNER });
      panelRivets(b, surfaceZ, panel);
    },
  };
}

// ------------------------------------------------------------------ tv (a little CRT set)

function tv() {
  const W = 0.262;
  const H = 0.198;
  const D = 0.118;
  const zc = 0.012;
  const zf = zc + D / 2;
  const faceX = -0.022;
  const surfaceZ = () => zf;
  const bezel = [0.088, 0.075];
  return {
    name: 'tv',
    surfaceZ,
    layout: { eyeX: 0.045, eyeY: 0.018, mouthY: -0.044, mouthHalfWidth: 0.038, cheekX: 0.07, cheekY: -0.026, earX: W / 2, earY: 0, earZ: zc, top: H / 2, bottom: -H / 2, halfWidth: W / 2, mount: [0, H / 2, -0.01], faceX },
    seams: [[0, 0, 1, zc - D / 2 + 0.002, 0, 0, 0, -99], SEAM_NONE, SEAM_NONE, SEAM_NONE],
    panel: null,
    build(b) {
      const cab = roundedBox(W, H, D, 0.018, 3);
      cab.translate(0, 0, zc);
      // tapered CRT back (flat shaded)
      const back = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1);
      back.rotateX(-Math.PI / 2);
      back.rotateZ(Math.PI / 4);
      back.scale(0.118 / 0.7071, 0.09 / 0.7071, 0.064);
      back.translate(0, 0, zc - D / 2 - 0.032 + 0.002);
      const backFlat = back.toNonIndexed();
      backFlat.computeVertexNormals();
      this._hull = hullOf(cab.clone(), back.clone());
      b.add(cab, { mat: MAT.PAINT, owner: SHELL_OWNER });
      b.add(backFlat, { mat: MAT.PAINT, owner: SHELL_OWNER });
      // screen bezel: a raised frame around the face
      const [hw, hh] = bezel;
      const frame = new THREE.Shape();
      const rr = 0.016;
      const rect = (s, w, h, r, hole = false) => {
        const path = hole ? new THREE.Path() : s;
        path.moveTo(-w + r, -h);
        path.lineTo(w - r, -h);
        path.quadraticCurveTo(w, -h, w, -h + r);
        path.lineTo(w, h - r);
        path.quadraticCurveTo(w, h, w - r, h);
        path.lineTo(-w + r, h);
        path.quadraticCurveTo(-w, h, -w, h - r);
        path.lineTo(-w, -h + r);
        path.quadraticCurveTo(-w, -h, -w + r, -h);
        return path;
      };
      rect(frame, hw + 0.009, hh + 0.009, rr + 0.006);
      frame.holes.push(rect(null, hw, hh, rr, true));
      const fg = new THREE.ExtrudeGeometry(frame, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 4 });
      fg.translate(faceX, 0, zf - 0.003);
      b.add(fg, { mat: MAT.STEEL, owner: SHELL_OWNER });
      // knobs and speaker slots on the right
      for (const [y, rad] of [[0.045, 0.014], [0.008, 0.011]]) {
        const knob = new THREE.CylinderGeometry(rad, rad * 1.08, 0.012, 16);
        knob.rotateX(Math.PI / 2);
        knob.translate(0.104, y, zf + 0.006);
        b.add(knob, { mat: MAT.ACCENT, owner: SHELL_OWNER });
        const tick = chamferBox(0.0025, rad * 1.1, 0.003, 0.0008);
        b.add(tick, { matrix: trs([0.104, y + rad * 0.35, zf + 0.0125]), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
      for (let i = 0; i < 4; i++) {
        const s = chamferBox(0.028, 0.0045, 0.004, 0.0015);
        b.add(s, { matrix: trs([0.104, -0.03 - i * 0.011, zf + 0.0002]), mat: MAT.RUBBER, owner: SHELL_OWNER, ao: 0.8 });
      }
      // feet / corner bolts
      for (const [x, y] of [[-0.118, 0.085], [0.118, 0.085], [-0.118, -0.085], [0.118, -0.085]]) {
        b.add(hexBolt(0.0045, 0.003), { matrix: aimZ([x * 0.97, y * 0.97, zf - 0.0045], [0, 0, 1]), mat: MAT.CHROME, owner: SHELL_OWNER });
      }
    },
  };
}

// ------------------------------------------------------------------ bullet (rounded nose, fins)

function bullet() {
  const R = 0.1;
  const yN = 0.034;
  const HN = 0.068;
  const yB = -0.09;
  const rAt = (y) => {
    if (y <= yN) return R;
    const f = Math.min(1, (y - yN) / HN);
    return R * Math.sqrt(Math.max(0, 1 - f * f));
  };
  const surfaceZ = (x, y) => Math.sqrt(Math.max(1e-8, rAt(y) ** 2 - x * x));
  const panel = [0.08, 0.064, 0.03, -0.02];
  return {
    name: 'bullet',
    surfaceZ,
    layout: { eyeX: 0.048, eyeY: 0.01, mouthY: -0.05, mouthHalfWidth: 0.039, cheekX: 0.072, cheekY: -0.03, earX: R, earY: -0.02, earZ: 0, top: yN + HN, bottom: yB - 0.004, halfWidth: R + 0.03, mount: [0, yN + HN, 0], faceX: 0 },
    seams: [
      [1, 0, 0, 0, 0, 1, 0, yN + 0.006],
      [0, 0, 1, 0, 0, 1, 0, yN + 0.006],
      [0, 1, 0, -0.058, 0, 0, -1, -0.04],
      SEAM_NONE,
    ],
    panel,
    build(b) {
      const profile = [[0, yB - 0.004], [R - 0.012, yB - 0.004], [R - 0.003, yB - 0.001], [R, yB + 0.008], [R, yN]];
      for (let i = 1; i <= 14; i++) {
        const a = (i / 14) * (Math.PI / 2);
        profile.push([R * Math.cos(a), yN + HN * Math.sin(a)]);
      }
      profile[profile.length - 1][0] = 0;
      const shell = lathe(profile, 40);
      this._hull = hullOf(shell.clone());
      b.add(shell, { mat: MAT.PAINT, owner: SHELL_OWNER });
      b.add(ringY(R + 0.001, 0.0036, yN, 4, 40), { mat: MAT.CHROME, owner: SHELL_OWNER });
      b.add(ringY(R + 0.001, 0.0042, -0.07, 5, 40), { mat: MAT.ACCENT, owner: SHELL_OWNER });
      rivetRing(b, -0.07, R + 0.0055, 10, 0.0021, 0.97);
      // three stabiliser fins at the back
      for (const a of [Math.PI * 0.72, Math.PI, Math.PI * 1.28]) {
        const fin = extrude([[0, -0.012], [0.034, -0.02], [0.036, 0.004], [0, 0.05]], 0.005, 0.0012, 2, 1);
        // fin in its local XY plane, x = outward; rotate so x points along the radial direction
        const m = new THREE.Matrix4().makeRotationY(a - Math.PI / 2);
        m.setPosition(Math.sin(a) * (R - 0.004), -0.058, Math.cos(a) * (R - 0.004));
        b.add(fin, { matrix: m, mat: MAT.ACCENT, owner: SHELL_OWNER });
      }
      // nose tip
      b.add(sphere(0.0075, 10, 4, 0, Math.PI / 2), { matrix: trs([0, yN + HN - 0.003, 0]), mat: MAT.CHROME, owner: SHELL_OWNER });
      panelRivets(b, surfaceZ, panel);
    },
  };
}

const BUILDERS = { dome, box, capsule, bucket, egg, hex, tv, bullet };

/** A fresh shell spec (geometry is added to a builder by spec.build(b); spec._hull afterwards). */
export function makeShell(name) {
  return (BUILDERS[name] ?? BUILDERS.dome)();
}

export const SHELL_NAMES = Object.keys(BUILDERS);
