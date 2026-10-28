// Mechanical eyebrows (BROW_SHAPES). Each brow rides a servo: a chrome rail with a carriage
// (bar, blade, comb, segmented) or two hydraulic pistons (piston); the brow slides up and down,
// turns (angry / worried), squeezes toward the nose, and segmented brows also arch.
// Built for the right brow in its own frame (x = away from the nose, y = up, z = out of the face)
// and mirrored for the left one.
import * as THREE from 'three';
import { BONE, MAT, chamferBox, extrude, hexBolt, rivet, roundedBox, trs } from './builder.js';
import { surfaceNormal } from './shells.js';

export const BROW_OWNER = [20, 21];
export const BROW_LEN = 0.064;
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Static servo rail behind the brow, with its two mounting blocks. */
function rail(b, P, owner, depth) {
  const rod = new THREE.CylinderGeometry(0.0019, 0.0019, 0.04, 8);
  rod.translate(0, 0, -0.0085);
  b.add(rod, { matrix: P, mat: MAT.CHROME, owner });
  for (const y of [-0.0215, 0.0215]) {
    const blk = chamferBox(0.009, 0.0048, depth, 0.0014);
    blk.translate(0, y, -0.0085 - depth / 2 + 0.003);
    b.add(blk, { matrix: P, mat: MAT.STEEL, owner });
  }
}

function carriage(b, P, bone, owner) {
  const c = chamferBox(0.0105, 0.0105, 0.0062, 0.0016);
  c.translate(0, 0, -0.0085);
  b.add(c, { matrix: P, bone, mat: MAT.STEEL, owner });
}

/**
 * Adds both brows for `browShape`. `eyes` is the eye rig (for the heights). Returns per side:
 * { side, pivot, Q, kind: 'rigid'|'piston'|'segmented', main, extra: [b1, b2], halfLen, segX, rodX }.
 */
export function buildBrows(b, shell, browShape, eyes) {
  const L = shell.layout;
  const zfn = shell.surfaceZ;
  const out = [];
  const eyeTop = Math.max(...eyes.eyes.map((e) => e.top));
  const lift = browShape === 'piston' ? 0.0145 : browShape === 'comb' ? 0.0075 : 0.0085;
  const y = eyeTop + lift;
  const x = L.eyeX + 0.003;
  const zs = zfn(L.faceX + x, y);
  const n = surfaceNormal(zfn, L.faceX + x, y);
  const standoff = 0.0105;
  const yaw = Math.atan2(n[0], n[2]);
  const pitch = -Math.asin(Math.max(-0.6, Math.min(0.6, n[1]))) * 0.35;
  // right brow frame (mirrored for the left); it stands off the face straight toward the viewer
  const Pr = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const pr = new THREE.Vector3(L.faceX + x, y, zs + standoff);
  Pr.setPosition(pr);
  const depth = standoff + 0.004;
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0 : 1;
    const owner = BROW_OWNER[k];
    let P = Pr.clone();
    if (side < 0) {
      P = MIRROR.clone().multiply(Pr);
      if (L.faceX) P.elements[12] += 2 * L.faceX; // mirror about the face centre, not x = 0
    }
    const main = side < 0 ? BONE.BROW_L : BONE.BROW_R;
    const e1 = main + 1;
    const e2 = main + 2;
    const half = BROW_LEN / 2;
    const info = { side, kind: 'rigid', main, extra: [e1, e2], halfLen: half, segX: null, rodX: null };
    switch (browShape) {
      case 'blade': {
        const pts = [[-half, -0.0085], [-half + 0.002, 0.0085], [-0.008, 0.0078], [0.012, 0.0052], [half + 0.003, 0.0022], [half + 0.004, 0.0002], [0.012, -0.0028], [-0.008, -0.0058]];
        const blade = extrude(pts, 0.0062, 0.0015, 6, 2);
        b.add(blade, { matrix: P, bone: main, mat: MAT.ACCENT, owner });
        b.add(hexBolt(0.0026, 0.0018), { matrix: P.clone().multiply(trs([-half + 0.006, 0, 0.0045])), bone: main, mat: MAT.CHROME, owner });
        carriage(b, P, main, owner);
        rail(b, P, owner, depth);
        break;
      }
      case 'comb': {
        const base = chamferBox(BROW_LEN, 0.0058, 0.0105, 0.0018);
        base.translate(0, -0.0045, 0);
        b.add(base, { matrix: P, bone: main, mat: MAT.STEEL, owner });
        const teeth = 8;
        for (let i = 0; i < teeth; i++) {
          const t = i / (teeth - 1);
          const tx = -half + 0.0035 + t * (BROW_LEN - 0.007);
          const h = 0.0105 + 0.004 * Math.sin(t * Math.PI);
          const tooth = chamferBox(0.0048, h, 0.0068, 0.0015);
          tooth.translate(0, h / 2 - 0.0016, 0);
          const m = P.clone().multiply(trs([tx, 0, 0.0005], [0, 0, -0.18 * (t - 0.35)]));
          b.add(tooth, { matrix: m, bone: main, mat: MAT.ACCENT, owner });
        }
        carriage(b, P, main, owner);
        rail(b, P, owner, depth);
        break;
      }
      case 'piston': {
        info.kind = 'piston';
        info.rodX = [-half + 0.011, half - 0.011];
        const bar = roundedBox(BROW_LEN, 0.0118, 0.0105, 0.0038, 2);
        b.add(bar, { matrix: P, bone: main, mat: MAT.ACCENT, owner });
        for (const rx of [-0.017, 0.017]) b.add(rivet(0.0019), { matrix: P.clone().multiply(trs([rx, 0, 0.0052])), bone: main, mat: MAT.CHROME, owner });
        info.rodX.forEach((rx, j) => {
          const rod = new THREE.CylinderGeometry(0.0021, 0.0021, 0.024, 8);
          rod.translate(rx, -0.0055 - 0.012, -0.001);
          b.add(rod, { matrix: P, bone: j ? e2 : e1, mat: MAT.CHROME, owner });
          const cyl = new THREE.CylinderGeometry(0.0037, 0.0037, 0.0105, 10);
          cyl.translate(rx, -0.0172, -0.001);
          b.add(cyl, { matrix: P, mat: MAT.STEEL, owner });
          const cap = new THREE.CylinderGeometry(0.0043, 0.0043, 0.002, 10);
          cap.translate(rx, -0.0122, -0.001);
          b.add(cap, { matrix: P, mat: MAT.ACCENT, owner });
          const mount = chamferBox(0.0085, 0.0045, depth, 0.0013);
          mount.translate(rx, -0.0215, -0.001 - depth / 2 + 0.003);
          b.add(mount, { matrix: P, mat: MAT.STEEL, owner });
        });
        break;
      }
      case 'segmented': {
        info.kind = 'segmented';
        const seg = BROW_LEN / 3;
        info.segX = [-seg, 0, seg];
        const bones = [e1, main, e2];
        info.segX.forEach((sx, j) => {
          const s = roundedBox(seg - 0.0016, 0.0128 - 0.0012 * Math.abs(j - 1), 0.0105, 0.0035, 1);
          s.translate(sx, 0, 0);
          b.add(s, { matrix: P, bone: bones[j], mat: MAT.ACCENT, owner });
        });
        for (const jx of [-seg / 2, seg / 2]) {
          const pin = new THREE.CylinderGeometry(0.0027, 0.0027, 0.0128, 8);
          pin.rotateX(Math.PI / 2);
          pin.translate(jx, 0, 0.0004);
          b.add(pin, { matrix: P, bone: main, mat: MAT.CHROME, owner });
        }
        carriage(b, P, main, owner);
        rail(b, P, owner, depth);
        break;
      }
      default: {
        // bar
        const bar = roundedBox(BROW_LEN, 0.0138, 0.0108, 0.0042, 2);
        b.add(bar, { matrix: P, bone: main, mat: MAT.ACCENT, owner });
        for (const rx of [-0.0205, 0.0205]) b.add(rivet(0.0021), { matrix: P.clone().multiply(trs([rx, 0, 0.0053])), bone: main, mat: MAT.CHROME, owner });
        carriage(b, P, main, owner);
        rail(b, P, owner, depth);
        break;
      }
    }
    // shadow on the forehead under the brow
    for (const ox of [-0.02, 0, 0.02]) {
      const c = new THREE.Vector3(ox, -0.002, -0.004).applyMatrix4(P);
      b.occluder([c.x, c.y, c.z], 0.011, owner, 0.9);
    }
    const pivot = new THREE.Vector3().setFromMatrixPosition(P);
    const e = P.elements;
    // rest frame Q (row-major 3x3) from the matrix columns
    info.Q = new Float64Array([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    info.pivot = new Float64Array([pivot.x, pivot.y, pivot.z]);
    const at = (lx) => {
      const v = new THREE.Vector3(lx, 0, 0).applyMatrix4(P);
      return new Float64Array([v.x, v.y, v.z]);
    };
    if (info.segX) {
      info.segPivots = info.segX.map(at);
      info.segBones = [e1, main, e2]; // inner, middle, outer
    }
    if (info.rodX) info.rodPivots = info.rodX.map(at);
    info.top = y + 0.012 + (browShape === 'comb' ? 0.012 : 0);
    out.push(info);
  }
  return out;
}
