// Geometry builder for the mechanical heads: merges three.js primitives into ONE indexed mesh per
// head with per-vertex skinning (two bones + weight), a material id, material uv and baked ambient
// occlusion. Packed vertex format (28 bytes):
//   position  Float32 x3
//   normal    Int8 x3, normalized
//   aSkin     Uint8 x4 = (bone A, bone B, weight of B x 255, ambient occlusion x 255)
//   aMat      Int16 x4 = (material id, u x UV_SCALE, v x UV_SCALE, extra)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { noHardware } from '../head-style.js';

/** Material ids (aMat.x), see head-material.js. */
export const MAT = Object.freeze({
  PAINT: 0, // shell paint: faceColor + finish
  ACCENT: 1, // trims, brows, lips: accentColor
  STEEL: 2, // dark machined steel
  CHROME: 3, // polished chrome
  RUBBER: 4, // black rubber, gaskets, cables
  GLASS: 5, // eye lens with the iris aperture inside (uv = eye-local xy / iris radius)
  LED: 6, // glowing eyeColor
  CAVITY: 7, // mouth interior (uv = u across, v up)
  BLUSH: 8, // cheek lamps
  BRASS: 9, // brass fittings
  MOUTH_IRIS: 10, // iris-diaphragm mouth (uv = disc coords)
  LID: 11, // eyelid shutters (paint, slightly different sheen)
});

/** Bone slots (rigid skinning, see robot-head.js). */
export const BONE = Object.freeze({
  STATIC: 0,
  JAW: 1,
  EYE_L: 2,
  EYE_R: 3,
  LID_UL: 4,
  LID_LL: 5,
  LID_UR: 6,
  LID_LR: 7,
  ANTENNA: 8,
  BROW_L: 9, // 9, 10, 11
  BROW_R: 12, // 12, 13, 14
  MOUTH: 15, // 15 .. 28
  TUBE_L: 29,
  TUBE_R: 30,
});
export const BONE_COUNT = 32;
/** aMat.yz are stored as Int16: value * UV_SCALE (|uv| < 4). */
export const UV_SCALE = 8192;
export const MOUTH_BONES = 14;

const tmpV = new THREE.Vector3();
const tmpL = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM3 = new THREE.Matrix3();
const ID = new THREE.Matrix4();

/** Matrix from position [x, y, z], euler [x, y, z] (XYZ) and scale (number or [x, y, z]). */
export function trs(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return m.compose(new THREE.Vector3(...p), q, sc);
}

/** Matrix whose +Z axis points along `dir` (unit [x, y, z]) with +Y kept as upright as possible, at `p`. */
export function aimZ(p, dir, roll = 0) {
  const z = new THREE.Vector3(...dir).normalize();
  const up = Math.abs(z.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  m.setPosition(p[0], p[1], p[2]);
  return m;
}

export class HeadBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.skin = [];
    this.mat = [];
    this.own = [];
    this.index = [];
    this.count = 0;
    this.occluders = [];
  }

  /**
   * Appends `geometry`.
   * opts.matrix  Matrix4 (local -> head space)
   * opts.bone    bone slot (rigid), or opts.skin(p: Vector3 head space, l: Vector3 local) -> [a, b, w]
   * opts.mat     MAT id
   * opts.uv      [u, v] or (l: Vector3 local, p: Vector3 head) -> [u, v]   (aMat.yz)
   * opts.extra   aMat.w
   * opts.owner   module id: occluders of the same owner do not darken it
   * opts.ao      ambient occlusion multiplier (crevices)
   * opts.warp    (p: Vector3, n: Vector3) => void, in head space after the matrix (bends onto the shell)
   * opts.invert  turn the surface inside out (sockets, cavities seen from inside)
   */
  add(geometry, opts = {}) {
    const matrix = opts.matrix ?? ID;
    const g = geometry;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const n = P.count;
    const base = this.count;
    tmpM3.getNormalMatrix(matrix);
    const flip = (matrix.determinant() < 0) !== !!opts.invert;
    const ns = opts.invert ? -1 : 1;
    const bone = opts.bone ?? 0;
    const mat = opts.mat ?? MAT.PAINT;
    const extra = opts.extra ?? 0;
    const owner = opts.owner ?? 0;
    const ao = opts.ao ?? 1;
    const uvFixed = Array.isArray(opts.uv) ? opts.uv : null;
    const uvFn = typeof opts.uv === 'function' ? opts.uv : null;
    for (let i = 0; i < n; i++) {
      tmpL.fromBufferAttribute(P, i);
      tmpV.copy(tmpL).applyMatrix4(matrix);
      tmpN.fromBufferAttribute(N, i).applyMatrix3(tmpM3).normalize().multiplyScalar(ns);
      if (opts.warp) opts.warp(tmpV, tmpN);
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      if (opts.skin) {
        const [a, b, w] = opts.skin(tmpV, tmpL);
        this.skin.push(a, b, w, ao);
      } else this.skin.push(bone, bone, 0, ao);
      let u = 0;
      let v = 0;
      if (uvFixed) [u, v] = uvFixed;
      else if (uvFn) [u, v] = uvFn(tmpL, tmpV);
      this.mat.push(mat, u, v, extra);
      this.own.push(owner);
    }
    if (g.index) {
      const I = g.index.array;
      for (let i = 0; i < I.length; i += 3) {
        if (flip) this.index.push(base + I[i], base + I[i + 2], base + I[i + 1]);
        else this.index.push(base + I[i], base + I[i + 1], base + I[i + 2]);
      }
    } else {
      for (let i = 0; i < n; i += 3) {
        if (flip) this.index.push(base + i, base + i + 2, base + i + 1);
        else this.index.push(base + i, base + i + 1, base + i + 2);
      }
    }
    this.count += n;
    g.dispose?.();
    return this;
  }

  /** A soft occluder (sphere) for the baked ambient occlusion. */
  occluder(c, r, owner = -1, strength = 1) {
    this.occluders.push({ c: [c[0], c[1], c[2]], r, owner, strength });
    return this;
  }

  get triangles() {
    return this.index.length / 3;
  }

  /** Bakes AO and returns the BufferGeometry. */
  build() {
    const n = this.count;
    const pos = new Float32Array(this.pos);
    const nor = new Float32Array(this.nor);
    const skin = new Float32Array(this.skin);
    const mat = new Float32Array(this.mat);
    const occ = this.occluders;
    for (let i = 0; i < n; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
      let a = skin[i * 4 + 3];
      const own = this.own[i];
      for (let k = 0; k < occ.length; k++) {
        const o = occ[k];
        if (o.owner === own && own !== 0) continue;
        const dx = o.c[0] - px, dy = o.c[1] - py, dz = o.c[2] - pz;
        const l2 = dx * dx + dy * dy + dz * dz;
        const l = Math.sqrt(l2) || 1e-6;
        const cos = (dx * nx + dy * ny + dz * nz) / l;
        if (cos <= 0) continue;
        const f = Math.min(0.75, (o.strength * cos * o.r * o.r) / Math.max(l2, o.r * o.r * 0.5));
        a *= 1 - f;
      }
      skin[i * 4 + 3] = Math.max(0.3, a);
    }
    // pack: normals to signed bytes, skin to bytes, material to shorts
    const norP = new Int8Array(n * 3);
    for (let i = 0; i < n * 3; i++) norP[i] = Math.max(-127, Math.min(127, Math.round(nor[i] * 127)));
    const skinP = new Uint8Array(n * 4);
    const matP = new Int16Array(n * 4);
    for (let i = 0; i < n; i++) {
      skinP[i * 4] = skin[i * 4];
      skinP[i * 4 + 1] = skin[i * 4 + 1];
      skinP[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, skin[i * 4 + 2])) * 255);
      skinP[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, skin[i * 4 + 3])) * 255);
      matP[i * 4] = mat[i * 4];
      matP[i * 4 + 1] = Math.round(Math.max(-3.99, Math.min(3.99, mat[i * 4 + 1])) * UV_SCALE);
      matP[i * 4 + 2] = Math.round(Math.max(-3.99, Math.min(3.99, mat[i * 4 + 2])) * UV_SCALE);
      matP[i * 4 + 3] = mat[i * 4 + 3];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(norP, 3, true));
    geometry.setAttribute('aSkin', new THREE.BufferAttribute(skinP, 4));
    geometry.setAttribute('aMat', new THREE.BufferAttribute(matP, 4));
    const Index = n > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new Index(this.index), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // parts move (brows, jaw, eyes pop): keep the head inside its culling sphere
    geometry.boundingSphere.radius += 0.04;
    return geometry;
  }
}

// ------------------------------------------------------------------ primitives

/** Lathe about +Y from [radius, y] pairs (counter-clockwise profile = outward normals). */
export function lathe(profile, segments = 32, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
}

/** A lathe whose axis is +Z (rings, lens barrels): profile [radius, z]. */
export function latheZ(profile, segments = 32) {
  const g = lathe(profile, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A box with chamfered edges and corners (44 triangles): small machined parts that still catch a
 * highlight on every edge, at a fraction of a rounded box's cost.
 */
export function chamferBox(w, h, d, c) {
  const H = [w / 2, h / 2, d / 2];
  c = Math.min(c, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9);
  const pos = [];
  const nor = [];
  const tri = (a, b, d2, n) => {
    // orient outward (the box is convex around the origin)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d2[0] - a[0], vy = d2[1] - a[1], vz = d2[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const mx = a[0] + b[0] + d2[0], my = a[1] + b[1] + d2[1], mz = a[2] + b[2] + d2[2];
    const pts = cx * mx + cy * my + cz * mz >= 0 ? [a, b, d2] : [a, d2, b];
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
    }
  };
  const quad = (a, b, d2, e, n) => {
    tri(a, b, d2, n);
    tri(a, d2, e, n);
  };
  // faces
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const e = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const P = (sb, se) => {
        const p = [0, 0, 0];
        p[a] = s * H[a];
        p[b] = sb * (H[b] - c);
        p[e] = se * (H[e] - c);
        return p;
      };
      const n = [0, 0, 0];
      n[a] = s;
      quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n);
    }
  }
  // edges
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const e = (a + 2) % 3;
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const P = (onA, se) => {
          const p = [0, 0, 0];
          p[a] = sa * (onA ? H[a] : H[a] - c);
          p[b] = sb * (onA ? H[b] - c : H[b]);
          p[e] = se * (H[e] - c);
          return p;
        };
        const n = [0, 0, 0];
        n[a] = sa * Math.SQRT1_2;
        n[b] = sb * Math.SQRT1_2;
        quad(P(true, -1), P(true, 1), P(false, 1), P(false, -1), n);
      }
    }
  }
  // corners
  const k = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    tri([sx * H[0], sy * (H[1] - c), sz * (H[2] - c)], [sx * (H[0] - c), sy * H[1], sz * (H[2] - c)], [sx * (H[0] - c), sy * (H[1] - c), sz * H[2]], [sx * k, sy * k, sz * k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function roundedBox(w, h, d, r, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

export function cylinderY(r0, r1, h, seg = 16, open = false) {
  return new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
}

/** Cylinder along Z from z0 to z1. */
export function cylinderZ(r, z0, z1, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Cylinder along X centred at the origin. */
export function cylinderX(r, len, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

export function sphere(r, w = 12, h = 8, thetaStart = 0, thetaLength = Math.PI) {
  return new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, thetaStart, thetaLength);
}

/** Torus in the XY plane (axis Z). */
export function torus(R, r, radial = 8, tubular = 32, arc = Math.PI * 2) {
  return new THREE.TorusGeometry(R, r, radial, tubular, arc);
}

/** Torus lying in the XZ plane (axis Y), e.g. a ring around a shell. */
export function ringY(R, r, y, radial = 8, tubular = 40) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

export function tube(points, r, segments = 24, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segments, r, radial, closed);
}

/** No geometry (the friendly look's left-out hardware): adds nothing. */
export function emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  return g;
}

/** A dome rivet (hemisphere) facing +Z at the origin (the friendly look: none). */
export function rivet(r, seg = 6) {
  if (noHardware()) return emptyGeometry();
  const g = new THREE.SphereGeometry(r, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A hex bolt head facing +Z at the origin (the friendly look: none). */
export function hexBolt(r, h = r * 0.6) {
  if (noHardware()) return emptyGeometry();
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, h / 2);
  return g;
}

/** Closed 2D outline [[x, y], ...] (CCW) extruded along Z (front at +depth/2), optional bevel. */
export function extrude(points, depth, bevel = 0, curveSegments = 4, bevelSegments = 2) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Sweeps a closed 2D profile [[y, z], ...] (CCW seen from +x) along X from x0 to x1 in `cols`
 * steps, with flat end caps. Non-indexed sides are avoided: one ring of vertices per column.
 */
export function sweepX(profile, x0, x1, cols = 8, caps = true) {
  const m = profile.length;
  const pos = [];
  const index = [];
  // per-profile-vertex normals (2D, averaged)
  const nrm = profile.map((_, i) => {
    const p = profile[(i - 1 + m) % m];
    const q = profile[(i + 1) % m];
    const ty = q[0] - p[0];
    const tz = q[1] - p[1];
    const l = Math.hypot(ty, tz) || 1;
    return [tz / l, -ty / l];
  });
  const nor = [];
  for (let c = 0; c <= cols; c++) {
    const x = x0 + ((x1 - x0) * c) / cols;
    for (let i = 0; i < m; i++) {
      pos.push(x, profile[i][0], profile[i][1]);
      nor.push(0, nrm[i][0], nrm[i][1]);
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let i = 0; i < m; i++) {
      const a = c * m + i;
      const b = c * m + ((i + 1) % m);
      const a2 = a + m;
      const b2 = b + m;
      index.push(a, b2, a2, a, b, b2);
    }
  }
  if (caps) {
    for (const [c, sx] of [[0, -1], [cols, 1]]) {
      const start = pos.length / 3;
      const cy = profile.reduce((s, p) => s + p[0], 0) / m;
      const cz = profile.reduce((s, p) => s + p[1], 0) / m;
      const x = x0 + ((x1 - x0) * c) / cols;
      pos.push(x, cy, cz);
      nor.push(sx, 0, 0);
      for (let i = 0; i < m; i++) {
        pos.push(x, profile[i][0], profile[i][1]);
        nor.push(sx, 0, 0);
      }
      for (let i = 0; i < m; i++) {
        const a = start + 1 + i;
        const b = start + 1 + ((i + 1) % m);
        if (sx < 0) index.push(start, b, a);
        else index.push(start, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}

/** Rounded-rectangle profile [[y, z]] (CCW seen from +x), centred at (cy, cz). */
export function roundRectProfile(h, d, r, cy = 0, cz = 0, perCorner = 3) {
  const pts = [];
  const hy = h / 2;
  const hz = d / 2;
  r = Math.min(r, hy, hz);
  const corners = [
    [hy - r, hz - r, 0],
    [-hy + r, hz - r, Math.PI / 2],
    [-hy + r, -hz + r, Math.PI],
    [hy - r, -hz + r, (3 * Math.PI) / 2],
  ];
  // CCW in the (z, y)... build in (y, z) with angle measured from +y toward +z mirrored so the
  // winding matches sweepX's convention: we walk +z first at the top
  for (const [y0, z0, a0] of corners) {
    for (let k = 0; k <= perCorner; k++) {
      const a = a0 + (k / perCorner) * (Math.PI / 2);
      pts.push([cy + y0 + r * Math.cos(a), cz + z0 + r * Math.sin(a)]);
    }
  }
  return pts;
}

/**
 * A spherical shutter lid around the origin: the part of a thick shell (r0..r1) between edge
 * angle `phi0` and `phi1` measured about the X axis in the YZ plane (0 = +Z, + = toward +Y),
 * spanning latitude +-psi toward +-X. The edge (at phi0) gets a rounded bead.
 * Returns { outer, inner, edge } geometries.
 */
export function lidShell(r0, r1, phi0, phi1, psi = 1.2, cols = 16, rows = 10) {
  const make = (r, outward) => {
    const pos = [];
    const nor = [];
    const index = [];
    for (let j = 0; j <= rows; j++) {
      const phi = phi0 + ((phi1 - phi0) * j) / rows;
      for (let i = 0; i <= cols; i++) {
        const s = -psi + (2 * psi * i) / cols;
        const x = Math.sin(s);
        const c = Math.cos(s);
        const y = c * Math.sin(phi);
        const z = c * Math.cos(phi);
        pos.push(r * x, r * y, r * z);
        const k = outward ? 1 : -1;
        nor.push(k * x, k * y, k * z);
      }
    }
    const w = cols + 1;
    const up = phi1 > phi0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        // outward-facing winding depends on the sweep direction
        if (up === outward) index.push(a, b, d, a, d, c);
        else index.push(a, d, b, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(index);
    return g;
  };
  // bead along the edge: a tube following the edge arc at mid radius
  const mid = (r0 + r1) / 2;
  const pts = [];
  for (let i = 0; i <= cols; i++) {
    const s = -psi + (2 * psi * i) / cols;
    const c = Math.cos(s);
    pts.push(new THREE.Vector3(mid * Math.sin(s), mid * c * Math.sin(phi0), mid * c * Math.cos(phi0)));
  }
  const edge = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), cols, (r1 - r0) * 0.9, 4, false);
  return { outer: make(r1, true), edge };
}
