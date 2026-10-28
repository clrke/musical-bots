// Mechanical mouths (MOUTH_SHAPES). All of them follow the same lip curves (face-rig.js
// mouthPoint): bones sit on the upper / lower lip lines at fixed u positions (-1 = left corner,
// 1 = right corner), the parts are skinned to their two nearest bones, and a dark "cavity"
// membrane stretches between the lips (its edges ride the lip bones, so it is hidden when shut).
//   lips     articulated metal lip plates with corner joints
//   jaw      a hinged chin plate with teeth (nutcracker), a bending upper plate, side pistons
//   shutter  four horizontal louvre slats on guide rails that part like a roller shutter
//   grille   a speaker grille: two bands and chrome bars that stretch as it opens
//   iris     a camera-iris diaphragm (drawn by the shader) in a bolted ring, with cheek flaps
import * as THREE from 'three';
import { BONE, MAT, chamferBox, cylinderZ, hexBolt, latheZ, rivet, roundRectProfile, roundedBox, sphere, sweepX, torus, trs } from './builder.js';

export const MOUTH_OWNER = 30;
/** u positions of the lip-line bones between the corners. */
export const LIP_U = Object.freeze([-0.8, -0.4, 0, 0.4, 0.8]);
/** u positions of the three-bone bands (shutter slats, grille bands). */
export const BAND_U = Object.freeze([-0.65, 0, 0.65]);
export const MOUTH_STANDOFF = 0.0075;
export const MOUTH_HEIGHT = 0.042; // lip gap at full opening (m)
export const SLAT_PITCH = 0.0082;
export const GRILLE_GAP = 0.0146;
export const IRIS_R = 0.024;

/** Piecewise-linear skin weights along u for bones at positions `us` (indices `bones`). */
function along(us, bones, u) {
  if (u <= us[0]) return [bones[0], bones[0], 0];
  for (let j = 0; j < us.length - 1; j++) {
    if (u <= us[j + 1]) return [bones[j], bones[j + 1], (u - us[j]) / (us[j + 1] - us[j])];
  }
  const l = bones[bones.length - 1];
  return [l, l, 0];
}

/** The cavity membrane: a grid between a lower and an upper row of bones. */
function membrane(cols, lowerBones, upperBones, W, y0, y1, depth = 0.004, rows = 4) {
  const pos = [];
  const nor = [];
  const skin = [];
  const uv = [];
  for (let c = 0; c < cols.length; c++) {
    for (let r = 0; r <= rows; r++) {
      const f = r / rows;
      pos.push(cols[c] * W, y0 + (y1 - y0) * f, -0.0028 - depth * Math.sin(Math.PI * f));
      nor.push(0, 0, 1);
      skin.push([lowerBones[c], upperBones[c], f]);
      uv.push([cols[c], f]);
    }
  }
  const index = [];
  const w = rows + 1;
  for (let c = 0; c < cols.length - 1; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * w + r;
      index.push(a, a + w, a + w + 1, a, a + w + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return { g, skin, uv };
}

/**
 * Adds the mouth for `mouthShape`. Returns the mouth rig:
 * { type, center, halfWidth, height, standoff, faceX, mouthY, bones: [{ index, role, u, lip, stack }],
 *   jaw?: { pivot }, iris?: true }
 * roles: 'lip' (on a lip line: lip = 1 upper, -1 lower, stack = 0 inner / 1 outer slat), 'corner',
 * 'bar' (grille bar, stretches between the bands), 'iris' (the iris unit), 'flap' (iris cheek flap).
 */
export function buildMouth(b, shell, mouthShape) {
  const L = shell.layout;
  const zfn = shell.surfaceZ;
  const W = L.mouthHalfWidth;
  const cx = L.faceX;
  const cy = L.mouthY;
  const z0 = zfn(cx, cy) + MOUTH_STANDOFF;
  const zc = zfn(cx, cy);
  const owner = MOUTH_OWNER;
  const M = trs([cx, cy, z0]);
  // follow the shell: offset z by the surface relative to the mouth centre, turn normals with it
  const warp = (p, n) => {
    const x = p.x;
    const y = Math.max(cy - 0.03, Math.min(cy + 0.03, p.y));
    p.z += zfn(x, y) - zc;
    const sx = (zfn(x + 0.002, y) - zfn(x - 0.002, y)) / 0.004;
    const a = Math.atan(sx);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = n.x * c + n.z * s;
    const nz = -n.x * s + n.z * c;
    n.set(nx, n.y, nz).normalize();
  };
  const bones = [];
  const B = BONE.MOUTH;
  const rig = { type: mouthShape, center: new Float64Array([cx, cy, z0]), halfWidth: W, height: MOUTH_HEIGHT, standoff: MOUTH_STANDOFF, faceX: cx, mouthY: cy, bones };
  const add = (g, opts) => b.add(g, { matrix: M, owner, warp, ...opts });

  const lipBones = () => {
    // upper 0..4, lower 5..9, corners 10 (left), 11 (right)
    LIP_U.forEach((u, i) => bones.push({ index: B + i, role: 'lip', u, lip: 1, stack: 0 }));
    LIP_U.forEach((u, i) => bones.push({ index: B + 5 + i, role: 'lip', u, lip: -1, stack: 0 }));
    bones.push({ index: B + 10, role: 'corner', u: -1, lip: 0, stack: 0 });
    bones.push({ index: B + 11, role: 'corner', u: 1, lip: 0, stack: 0 });
  };
  const US = [-1, ...LIP_U, 1];
  const upperChain = [B + 10, B, B + 1, B + 2, B + 3, B + 4, B + 11];
  const lowerChain = [B + 10, B + 5, B + 6, B + 7, B + 8, B + 9, B + 11];

  /** A row of rigid plates along a lip line (upper: y in [0, h], lower: y in [-h, 0]). */
  const plates = (count, h0, d, lip, chain, mat = MAT.ACCENT, rivets = true, taper = 0.42) => {
    const span = 2 / count;
    for (let k = 0; k < count; k++) {
      const uc = -1 + (k + 0.5) * span;
      // plates overlap their neighbours a little (alternately in front), so the lip stays closed
      // as it bends
      const x0 = (uc - span / 2 - 0.035) * W;
      const x1 = (uc + span / 2 + 0.035) * W;
      const dz = k % 2 ? -0.0006 : 0.0004;
      // fuller in the middle, slimmer toward the corners, like lips
      const h = h0 * (1 - taper * Math.pow(Math.abs(uc), 1.6));
      const yc = lip > 0 ? h / 2 + 0.0004 : -h / 2 - 0.0004;
      const prof = roundRectProfile(h, d, Math.min(h, d) * 0.45, yc, dz, 2);
      const g = sweepX(prof, x0, x1, 3);
      const sk = along(US, chain, uc);
      add(g, { skin: () => sk, mat });
      if (rivets) add(rivet(0.0016, 6), { matrix: M.clone().multiply(trs([uc * W, yc, d / 2 + dz - 0.0003])), skin: () => sk, mat: MAT.CHROME });
    }
  };
  const corners = (r = 0.0066) => {
    for (const [u, bone] of [[-1.03, B + 10], [1.03, B + 11]]) {
      add(cylinderZ(r, -0.0055, 0.0062, 14), { matrix: M.clone().multiply(trs([u * W, 0, 0])), bone, mat: MAT.CHROME });
      add(hexBolt(r * 0.45, 0.0018), { matrix: M.clone().multiply(trs([u * W, 0, 0.0062])), bone, mat: MAT.STEEL });
    }
  };
  const cavity = (cols, lower, upper, y0, y1, depth) => {
    const { g, skin, uv } = membrane(cols, lower, upper, W, y0, y1, depth);
    let i = 0;
    let j = 0;
    add(g, { skin: () => skin[i++], uv: () => uv[j++], mat: MAT.CAVITY, ao: 0.9 });
  };

  switch (mouthShape) {
    case 'jaw': {
      // upper plate (5 bending plates + teeth), corners
      lipBones();
      plates(5, 0.0152, 0.0115, 1, upperChain, MAT.ACCENT, true, 0.2);
      corners(0.0062);
      const teethU = [-0.62, -0.2, 0.2, 0.62];
      for (const u of teethU) {
        const t = chamferBox(0.0105, 0.0066, 0.0058, 0.0014);
        add(t, { matrix: M.clone().multiply(trs([u * W, -0.0029, 0.0012])), skin: () => along(US, upperChain, u), mat: MAT.CHROME });
      }
      // hinged chin plate with lower teeth
      const jawPivot = new Float64Array([cx, cy + 0.004, z0 - 0.034]);
      rig.jaw = { pivot: jawPivot };
      const chin = roundedBox(2 * W * 1.04, 0.0235, 0.0165, 0.0062, 2);
      add(chin, { matrix: M.clone().multiply(trs([0, -0.0065 - 0.0118, -0.0005])), bone: BONE.JAW, mat: MAT.LID });
      const hinge = new THREE.CylinderGeometry(0.003, 0.003, 2 * W * 1.08, 10);
      hinge.rotateZ(Math.PI / 2);
      add(hinge, { matrix: M.clone().multiply(trs([0, -0.0075, -0.007])), bone: BONE.JAW, mat: MAT.STEEL });
      for (const u of [-0.82, -0.41, 0, 0.41, 0.82]) {
        const t = chamferBox(0.0092, 0.0062, 0.0056, 0.0014);
        add(t, { matrix: M.clone().multiply(trs([u * W, -0.0036, 0.0012])), bone: BONE.JAW, mat: MAT.CHROME });
      }
      for (const u of [-0.55, 0.55]) add(rivet(0.0019, 6), { matrix: M.clone().multiply(trs([u * W, -0.019, 0.0078])), bone: BONE.JAW, mat: MAT.CHROME });
      // side pistons: cylinders on the cheeks, rods on the jaw
      for (const s of [-1, 1]) {
        const x = s * (W * 1.04 + 0.0085);
        add(cylinderY(0.0034, 0.013, 14), { matrix: M.clone().multiply(trs([x, 0.0105, -0.002])), mat: MAT.STEEL });
        add(cylinderY(0.0039, 0.0018, 14), { matrix: M.clone().multiply(trs([x, 0.0175, -0.002])), mat: MAT.ACCENT });
        add(cylinderY(0.0019, 0.026, 8), { matrix: M.clone().multiply(trs([x, -0.0035, -0.002])), bone: BONE.JAW, mat: MAT.CHROME });
        add(sphere(0.0034, 8, 4), { matrix: M.clone().multiply(trs([x, -0.0165, -0.002])), bone: BONE.JAW, mat: MAT.STEEL });
      }
      const cols = [-1, ...LIP_U, 1];
      cavity(cols, cols.map(() => BONE.JAW), upperChain, -0.0068, 0.0002, 0.003);
      break;
    }
    case 'shutter': {
      // slats: upper outer (0..2), upper inner (3..5), lower inner (6..8), lower outer (9..11), rails 12, 13
      const slats = [
        { lip: 1, stack: 1, y: 1.5 * SLAT_PITCH },
        { lip: 1, stack: 0, y: 0.5 * SLAT_PITCH },
        { lip: -1, stack: 0, y: -0.5 * SLAT_PITCH },
        { lip: -1, stack: 1, y: -1.5 * SLAT_PITCH },
      ];
      slats.forEach((s, k) => {
        const idx = BAND_U.map((u, i) => B + k * 3 + i);
        BAND_U.forEach((u, i) => bones.push({ index: idx[i], role: 'lip', u, lip: s.lip, stack: s.stack }));
        const prof = roundRectProfile(SLAT_PITCH - 0.0003, 0.0066 - s.stack * 0.0008, 0.0013, s.y, -s.stack * 0.0006, 2);
        // inner slats run corner to corner, the outer ones are shorter: an almond-shaped mouth
        const len = s.stack ? 0.8 : 1;
        const g = sweepX(prof, -W * len, W * len, 14);
        add(g, { skin: (p, l) => along(BAND_U, idx, l.x / W), mat: s.stack ? MAT.STEEL : MAT.ACCENT });
      });
      bones.push({ index: B + 12, role: 'corner', u: -1.06, lip: 0, stack: 0 });
      bones.push({ index: B + 13, role: 'corner', u: 1.06, lip: 0, stack: 0 });
      for (const [u, bone] of [[-1.06, B + 12], [1.06, B + 13]]) {
        add(chamferBox(0.0068, 0.042, 0.0085, 0.0018), { matrix: M.clone().multiply(trs([u * W, 0, -0.0006])), bone, mat: MAT.STEEL });
        for (const y of [-0.0215, 0.0215]) add(sphere(0.0038, 8, 4), { matrix: M.clone().multiply(trs([u * W, y, -0.0006])), bone, mat: MAT.CHROME });
        add(hexBolt(0.0024, 0.0016), { matrix: M.clone().multiply(trs([u * W, 0, 0.0038])), bone, mat: MAT.CHROME });
      }
      const cols = [-0.98, ...BAND_U, 0.98];
      const lo = [B + 6, B + 6, B + 7, B + 8, B + 8];
      const up = [B + 3, B + 3, B + 4, B + 5, B + 5];
      cavity(cols, lo, up, -0.0003, 0.0003, 0.003);
      break;
    }
    case 'grille': {
      // top band 0..2, bottom band 3..5, bars 6..10, corner caps 11, 12
      const half = GRILLE_GAP / 2;
      const bandH = 0.0068;
      [
        { lip: 1, y: half + bandH / 2, k: 0 },
        { lip: -1, y: -half - bandH / 2, k: 1 },
      ].forEach((s) => {
        const idx = BAND_U.map((u, i) => B + s.k * 3 + i);
        BAND_U.forEach((u, i) => bones.push({ index: idx[i], role: 'lip', u, lip: s.lip, stack: 0 }));
        const g = sweepX(roundRectProfile(bandH, 0.0088, 0.0028, s.y, 0, 2), -W, W, 14);
        add(g, { skin: (p, l) => along(BAND_U, idx, l.x / W), mat: MAT.ACCENT });
        for (const u of [-0.85, 0.85]) add(rivet(0.0016, 6), { matrix: M.clone().multiply(trs([u * W, s.y, 0.0042])), skin: () => along(BAND_U, idx, u), mat: MAT.CHROME });
      });
      const barU = [-0.72, -0.36, 0, 0.36, 0.72];
      barU.forEach((u, i) => {
        bones.push({ index: B + 6 + i, role: 'bar', u, lip: 0, stack: 0 });
        add(cylinderY(0.0021, GRILLE_GAP + 0.003, 8), { matrix: M.clone().multiply(trs([u * W, 0, -0.0008])), bone: B + 6 + i, mat: MAT.CHROME });
      });
      bones.push({ index: B + 11, role: 'corner', u: -1.04, lip: 0, stack: 0 });
      bones.push({ index: B + 12, role: 'corner', u: 1.04, lip: 0, stack: 0 });
      for (const [u, bone] of [[-1.04, B + 11], [1.04, B + 12]]) {
        add(roundedBox(0.0092, GRILLE_GAP + 2 * bandH + 0.002, 0.0098, 0.0032, 2), { matrix: M.clone().multiply(trs([u * W, 0, 0])), bone, mat: MAT.STEEL });
        add(hexBolt(0.0022, 0.0015), { matrix: M.clone().multiply(trs([u * W, 0, 0.0049])), bone, mat: MAT.CHROME });
      }
      const cols = [-0.98, ...BAND_U, 0.98];
      cavity(cols, [B + 3, B + 3, B + 4, B + 5, B + 5], [B, B, B + 1, B + 2, B + 2], -half, half, 0.0035);
      break;
    }
    case 'iris': {
      bones.push({ index: B, role: 'iris', u: 0, lip: 0, stack: 0 });
      bones.push({ index: B + 1, role: 'flap', u: -1, lip: 0, stack: 0 });
      bones.push({ index: B + 2, role: 'flap', u: 1, lip: 0, stack: 0 });
      rig.iris = true;
      const disc = new THREE.CircleGeometry(IRIS_R + 0.0008, 32);
      disc.translate(0, 0, -0.0025);
      add(disc, { bone: B, mat: MAT.MOUTH_IRIS, uv: (l) => [l.x / IRIS_R, l.y / IRIS_R] });
      const ring = latheZ([[0.0318, -0.007], [0.0318, 0.0012], [0.0306, 0.0042], [0.0284, 0.0055], [0.0252, 0.0052], [0.0236, 0.0036], [0.0236, -0.007]], 36);
      add(ring, { bone: B, mat: MAT.ACCENT });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        add(hexBolt(0.0019, 0.0014), { matrix: M.clone().multiply(trs([Math.cos(a) * 0.0272, Math.sin(a) * 0.0272, 0.005])), bone: B, mat: MAT.CHROME });
      }
      for (const [s, bone] of [[-1, B + 1], [1, B + 2]]) {
        const arc = torus(0.0385, 0.0031, 5, 12, 1.0);
        arc.rotateZ(s > 0 ? -0.5 : Math.PI - 0.5);
        add(arc, { bone, mat: MAT.ACCENT });
        const tip = sphere(0.0037, 8, 5);
        const a = s > 0 ? -0.5 : Math.PI + 0.5;
        add(tip, { matrix: M.clone().multiply(trs([Math.cos(a) * 0.0385, Math.sin(a) * 0.0385, 0])), bone, mat: MAT.CHROME });
      }
      break;
    }
    default: {
      // lips: articulated plates, corner joints, cavity
      lipBones();
      plates(7, 0.0122, 0.0108, 1, upperChain, MAT.ACCENT, false);
      plates(7, 0.0122, 0.0108, -1, lowerChain, MAT.ACCENT, false);
      corners();
      const cols = [-1, ...LIP_U, 1];
      cavity(cols, lowerChain, upperChain, -0.0004, 0.0004, 0.0035);
      break;
    }
  }
  // soft shadow of the mouth unit on the face
  for (const u of [-0.7, 0, 0.7]) b.occluder([cx + u * W, cy, z0 - 0.002], 0.016, owner, 0.7);
  return rig;
}

function cylinderY(r, h, seg = 12) {
  return new THREE.CylinderGeometry(r, r, h, seg, 1);
}
