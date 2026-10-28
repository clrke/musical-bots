// Parts every head shares: antennas (ANTENNAS, on a sprung mount), ear servos, cables down to the
// hover unit, the hover unit itself (neck + glowing thruster ring) and the cheek lamps (blush).
import * as THREE from 'three';
import { BONE, MAT, aimZ, cylinderY, hexBolt, lathe, rivet, sphere, torus, trs, tube } from './builder.js';
import { surfaceNormal } from './shells.js';

export const EXTRA_OWNER = 40;
/** Highest antenna point above its mount (m, scale 1). */
export const ANTENNA_MAX = 0.064;

/** Antenna on the antenna bone, base at `mount`. Returns { height, tip: [x, y, z] }. */
export function buildAntenna(b, mount, name) {
  const owner = EXTRA_OWNER + 1;
  const M = trs(mount);
  const bone = BONE.ANTENNA;
  const add = (g, mat, m = M) => b.add(g, { matrix: m, bone, mat, owner });
  const collar = () => {
    const c = cylinderY(0.0105, 0.0085, 0.008, 16);
    c.translate(0, 0.002, 0);
    add(c, MAT.STEEL);
    const ring = torus(0.0092, 0.0016, 4, 18);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.0062, 0);
    add(ring, MAT.ACCENT);
  };
  b.occluder([mount[0], mount[1] - 0.004, mount[2]], 0.012, owner, 0.8);
  switch (name) {
    case 'single': {
      collar();
      const rod = cylinderY(0.0024, 0.0019, 0.044, 8);
      rod.translate(0, 0.006 + 0.022, 0);
      add(rod, MAT.CHROME);
      const mid = torus(0.0034, 0.0014, 5, 12);
      mid.rotateX(Math.PI / 2);
      mid.translate(0, 0.026, 0);
      add(mid, MAT.ACCENT);
      const ball = sphere(0.0068, 12, 8);
      ball.translate(0, 0.0545, 0);
      add(ball, MAT.LED);
      return { height: 0.0613 };
    }
    case 'double': {
      collar();
      let h = 0;
      for (const s of [-1, 1]) {
        const a = s * 0.38;
        const len = 0.042;
        const rod = cylinderY(0.0021, 0.0017, len, 8);
        rod.translate(0, len / 2, 0);
        rod.rotateZ(-a);
        rod.translate(s * 0.004, 0.006, 0);
        add(rod, MAT.CHROME);
        const tx = s * 0.004 + Math.sin(a) * len;
        const ty = 0.006 + Math.cos(a) * len;
        const ball = sphere(0.0056, 12, 7);
        ball.translate(tx, ty, 0);
        add(ball, MAT.LED);
        h = Math.max(h, ty + 0.0056);
      }
      return { height: h };
    }
    case 'coil': {
      collar();
      const pts = [];
      const turns = 5;
      for (let i = 0; i <= 100; i++) {
        const f = i / 100;
        const a = f * turns * Math.PI * 2;
        const r = 0.0062 * (1 - 0.3 * f);
        pts.push([r * Math.cos(a), 0.007 + f * 0.038, r * Math.sin(a)]);
      }
      add(tube(pts, 0.0015, 90, 4), MAT.CHROME);
      const stem = cylinderY(0.0016, 0.0016, 0.008, 6);
      stem.translate(0, 0.049, 0);
      add(stem, MAT.CHROME);
      const ball = sphere(0.0065, 12, 8);
      ball.translate(0, 0.0565, 0);
      add(ball, MAT.LED);
      return { height: 0.063 };
    }
    case 'dish': {
      collar();
      const mast = cylinderY(0.0026, 0.0026, 0.016, 8);
      mast.translate(0, 0.014, 0);
      add(mast, MAT.STEEL);
      // dish tilted toward the front, with a feed horn
      const D = trs([0, 0.0225, 0.002], [-0.62, 0, 0]);
      const prof = [];
      for (let i = 0; i <= 5; i++) {
        const r = (i / 5) * 0.021;
        prof.push([r, (r * r) / 0.05]);
      }
      const back = prof.map(([r, y]) => [r, y - 0.0016]).reverse();
      const dishGeo = lathe([...prof, ...back], 24);
      add(dishGeo, MAT.ACCENT, D);
      const horn = cylinderY(0.0012, 0.0012, 0.014, 6);
      horn.translate(0, 0.008, 0);
      add(horn, MAT.CHROME, D);
      const feed = sphere(0.0034, 12, 8);
      feed.translate(0, 0.0155, 0);
      add(feed, MAT.LED, D);
      return { height: 0.05 };
    }
    default: {
      // none: a capped bolt where an antenna would go
      const cap = sphere(0.0085, 12, 4, 0, Math.PI / 2);
      add(cap, MAT.STEEL);
      add(hexBolt(0.0034, 0.004), MAT.CHROME, M.clone().multiply(trs([0, 0.0065, 0], [-Math.PI / 2, 0, 0])));
      return { height: 0.0105 };
    }
  }
}

/** Ear servos, cables, hover unit and cheek lamps. */
export function buildExtras(b, shell) {
  const L = shell.layout;
  const zfn = shell.surfaceZ;
  const owner = EXTRA_OWNER;
  // ---- ear servos (cylinders along X, embedded in the sides)
  if (!L.noEars) {
    for (const s of [-1, 1]) {
      const x = s * (L.earX - 0.004);
      const m = aimZ([x, L.earY, L.earZ], [s, 0, 0]);
      const housing = lathe([[0.0225, -0.012], [0.0225, 0.007], [0.0205, 0.0098], [0.0, 0.0102]], 24);
      housing.rotateX(Math.PI / 2);
      b.add(housing, { matrix: m, mat: MAT.STEEL, owner });
      const cap = new THREE.CylinderGeometry(0.0168, 0.0175, 0.0042, 24);
      cap.rotateX(Math.PI / 2);
      cap.translate(0, 0, 0.0118);
      b.add(cap, { matrix: m, mat: MAT.ACCENT, owner });
      const hub = new THREE.CylinderGeometry(0.0062, 0.0062, 0.004, 12);
      hub.rotateX(Math.PI / 2);
      hub.translate(0, 0, 0.0155);
      b.add(hub, { matrix: m, mat: MAT.CHROME, owner });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        b.add(hexBolt(0.0022, 0.0015), { matrix: m.clone().multiply(trs([Math.cos(a) * 0.0122, Math.sin(a) * 0.0122, 0.0138])), mat: MAT.CHROME, owner });
      }
      b.occluder([s * L.earX, L.earY, L.earZ], 0.024, owner, 0.6);
    }
  }
  // ---- hover unit: neck collar + thruster ring
  const py = L.bottom;
  const neck = lathe([[0, py - 0.017], [0.012, py - 0.017], [0.0215, py - 0.0145], [0.0275, py - 0.0085], [0.0305, py - 0.0035], [0.0305, py + 0.006], [0, py + 0.006]], 24);
  b.add(neck, { mat: MAT.STEEL, owner });
  const glow = torus(0.0242, 0.0034, 4, 24);
  glow.rotateX(Math.PI / 2);
  glow.translate(0, py - 0.0118, 0);
  b.add(glow, { mat: MAT.LED, owner });
  const nozzle = new THREE.CylinderGeometry(0.0135, 0.0085, 0.006, 16);
  nozzle.translate(0, py - 0.0185, 0);
  b.add(nozzle, { mat: MAT.RUBBER, owner });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.add(rivet(0.0018, 6), { matrix: aimZ([Math.sin(a) * 0.0307, py + 0.0012, Math.cos(a) * 0.0307], [Math.sin(a), 0, Math.cos(a)]), mat: MAT.CHROME, owner });
  }
  // ---- cables from behind the ears down to the neck
  for (const s of [-1, 1]) {
    const x0 = s * (L.halfWidth - 0.02);
    const pts = [
      [x0, L.earY - 0.012, -0.045],
      [s * (L.halfWidth - 0.028), L.earY - 0.05, -0.05],
      [s * 0.04, py - 0.004, -0.038],
      [s * 0.024, py - 0.008, -0.022],
    ];
    b.add(tube(pts, 0.0034, 14, 5), { mat: MAT.RUBBER, owner });
    const sleeve = new THREE.CylinderGeometry(0.0046, 0.0046, 0.008, 8);
    sleeve.translate(0, 0, 0);
    b.add(sleeve, { matrix: aimZ(pts[3], [-s * 0.6, 0.4, 0.6]), mat: MAT.ACCENT, owner });
  }
  // ---- cheek lamps (blush)
  for (const s of [-1, 1]) {
    const x = L.faceX + s * L.cheekX;
    const y = L.cheekY;
    const n = surfaceNormal(zfn, x, y);
    const z = zfn(x, y);
    const m = aimZ([x, y, z - 0.0018], n);
    const lamp = sphere(0.0105, 12, 3, 0, 1.1);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(0, 0, -0.006);
    b.add(lamp, { matrix: m, mat: MAT.BLUSH, owner, uv: (l) => [l.x / 0.0093, l.y / 0.0093] });
    const bezel = torus(0.0102, 0.0017, 3, 18);
    bezel.translate(0, 0, 0.0016);
    b.add(bezel, { matrix: m, mat: MAT.CHROME, owner });
  }
}
