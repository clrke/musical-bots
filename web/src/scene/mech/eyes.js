// Eye mechanisms (EYE_SHAPES). Every eye is an eyeball (dark steel with a glass lens; the iris
// aperture behind the glass is drawn by the head shader with parallax), two spherical shutter lids
// (upper / lower) and a dark socket, inside a housing that gives the eye type its character:
// lens barrels, goggles, bulging bulbs, telescoping tubes, a monocle, or a visor across both eyes.
// The eyeballs and lids stay axis-aligned (they look forward); housings follow the shell surface.
import { noHardware } from '../head-style.js';
import * as THREE from 'three';
import { LID } from '../face-rig.js';
import { BONE, MAT, aimZ, extrude, hexBolt, latheZ, lidShell, roundedBox, sphere, torus, trs, tube } from './builder.js';
import { surfaceNormal } from './shells.js';

/** Half-angle of the glass lens on the eyeball (rad); the iris radius is R sin(CAP). */
export const EYE_CAP = 0.8;
/** Iris plane depth behind the glass (fraction of R). */
export const IRIS_DEPTH = 0.2;

export const EYE_OWNER = [10, 11];

/** Eye types: eyeball radius, how deep it sits, the aperture style (blades, ring width, look). */
export const EYE_TYPES = Object.freeze({
  lens: { R: 0.0215, protrude: 0.011, blades: 7, ring: 0.17, style: 0, zoom: 0.004 },
  goggle: { R: 0.0245, protrude: 0.012, blades: 9, ring: 0.13, style: 1, zoom: 0.004 },
  bulb: { R: 0.027, protrude: 0.022, blades: 6, ring: 0.2, style: 2, zoom: 0.005 },
  telescope: { R: 0.0185, protrude: 0.026, blades: 5, ring: 0.2, style: 3, zoom: 0.018 },
  monocle: { R: 0.02, R2: 0.0255, protrude: 0.011, blades: 8, ring: 0.15, style: 4, zoom: 0.004 },
  visor: { R: 0.0195, protrude: 0.01, blades: 6, ring: 0.18, style: 5, zoom: 0.003 },
});

const MIRROR_X = new Float64Array([-1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Eyeball + glass lens + lens ring on the eye bone, centred at c. */
function eyeball(b, c, R, bone, owner) {
  const irisR = R * Math.sin(EYE_CAP);
  const glass = sphere(R, 24, 6, 0, EYE_CAP);
  glass.rotateX(Math.PI / 2);
  b.add(glass, { matrix: trs(c), bone, mat: MAT.GLASS, owner, uv: (l) => [l.x / irisR, l.y / irisR], extra: 0 });
  const body = sphere(R * 0.995, 14, 5, EYE_CAP, Math.PI * 0.62 - EYE_CAP);
  body.rotateX(Math.PI / 2);
  b.add(body, { matrix: trs(c), bone, mat: MAT.STEEL, owner });
  const ring = torus(irisR + 0.0004, 0.0011, 4, 24);
  b.add(ring, { matrix: trs([c[0], c[1], c[2] + R * Math.cos(EYE_CAP) - 0.0002]), bone, mat: MAT.CHROME, owner });
  return irisR;
}

/** Upper and lower shutter lids, modelled shut (see face-rig LID). */
function lids(b, c, R, boneUp, boneLow, owner) {
  // the upper lid sweeps from above the eye down to the lower lid, so it spans ~120 deg
  const up = lidShell(R + 0.0029, R + 0.0043, LID.upModel, LID.upModel + 2.15, 1.42, 14, 8);
  b.add(up.outer, { matrix: trs(c), bone: boneUp, mat: MAT.LID, owner });
  b.add(up.edge, { matrix: trs(c), bone: boneUp, mat: MAT.STEEL, owner });
  const low = lidShell(R + 0.0007, R + 0.0019, LID.lowModel, LID.lowModel - 1.65, 1.42, 14, 6);
  b.add(low.outer, { matrix: trs(c), bone: boneLow, mat: MAT.LID, owner });
  b.add(low.edge, { matrix: trs(c), bone: boneLow, mat: MAT.STEEL, owner });
  return R + 0.0049; // outermost lid radius (bead included)
}

/**
 * Dark socket: telescope eyes (in front of the shell) get a cup behind the lids on the sliding
 * tube; every other eye sits partly inside the shell, so a dark floor disc covers the shell's
 * paint inside the housing (the shell itself hides the back of the eyeball and lids).
 */
function socket(b, c, rOut, axis, ds, bone, owner, cup = false) {
  if (cup) {
    const g = sphere(rOut + 0.0012, 16, 5, 0.62, Math.PI * 0.75 - 0.62);
    g.rotateX(Math.PI / 2);
    b.add(g, { matrix: aimZ(c, axis), bone, mat: MAT.RUBBER, owner, invert: true, ao: 0.5 });
    return;
  }
  const floor = new THREE.CircleGeometry(rOut + 0.0032, 24);
  floor.translate(0, 0, ds + 0.0004);
  b.add(floor, { matrix: aimZ(c, axis), mat: MAT.RUBBER, owner, ao: 0.55 });
}

/** Lens barrel (lathe) around the eye at c, along axis, front at `front` (distance along the axis). */
function barrel(b, c, axis, rIn, rOut, back, front, owner, mats = { body: MAT.STEEL, lip: MAT.CHROME, band: MAT.ACCENT }) {
  const m = aimZ(c, axis);
  const flange = rOut + 0.0042;
  b.add(
    latheZ([[flange, back - 0.004], [flange, back + 0.0016], [rOut, back + 0.003], [rOut, front - 0.0022], [rOut - 0.0018, front], [rIn + 0.0012, front], [rIn, front - 0.0014], [rIn, back - 0.006]], 26),
    { matrix: m, mat: mats.body, owner },
  );
  const lip = torus((rIn + rOut) / 2, (rOut - rIn) * 0.42, 4, 26);
  lip.translate(0, 0, front - 0.0004);
  b.add(lip, { matrix: m, mat: mats.lip, owner });
  if (mats.band !== undefined && front - back > 0.007) {
    const band = torus(rOut + 0.0004, 0.0016, 4, 26);
    band.translate(0, 0, (front + back) / 2);
    b.add(band, { matrix: m, mat: mats.band, owner });
  }
  return m;
}

/**
 * Adds both eyes for `eyeShape` on shell `shell` (spec from shells.js). Returns the eye rig:
 * { type, eyes: [{ side, center, R, irisR, zoom, bones, lidQ, top }], iris: { blades, ring, style } }.
 */
export function buildEyes(b, shell, eyeShape) {
  const T = EYE_TYPES[eyeShape] ?? EYE_TYPES.lens;
  const L = shell.layout;
  const zfn = shell.surfaceZ;
  const eyes = [];
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0 : 1;
    const owner = EYE_OWNER[k];
    const ex = L.faceX + side * L.eyeX;
    const ey = L.eyeY;
    // (friendly: both eyes one size: the big staring monocle eye read as heavy)
    const R = eyeShape === 'monocle' && side > 0 && !noHardware() ? T.R2 : T.R;
    const zs = zfn(ex, ey);
    const n = surfaceNormal(zfn, ex, ey);
    // the eyeball's front sits `protrude` in front of the shell
    const cz = zs + T.protrude * 0.82 - R;
    const c = [ex, ey, cz];
    const bones = {
      eye: side < 0 ? BONE.EYE_L : BONE.EYE_R,
      up: side < 0 ? BONE.LID_UL : BONE.LID_UR,
      low: side < 0 ? BONE.LID_LL : BONE.LID_LR,
      tube: -1,
    };
    // distance from the eye centre to the shell along the housing axis
    const ds = (zs - cz) * n[2];
    let tubeBone = BONE.STATIC;
    if (eyeShape === 'telescope') {
      tubeBone = side < 0 ? BONE.TUBE_L : BONE.TUBE_R;
      bones.tube = tubeBone;
    }
    const irisR = eyeball(b, c, R, bones.eye, owner);
    const rLid = lids(b, c, R, bones.up, bones.low, owner);
    const axis = eyeShape === 'telescope' ? [0, 0, 1] : n;
    socket(b, c, rLid, axis, ds, tubeBone, owner, eyeShape === 'telescope');
    const rIn = rLid + 0.0009;
    let top = ey + rLid + 0.004;
    switch (eyeShape) {
      case 'goggle': {
        const m = aimZ(c, n);
        const rimR = rIn + 0.0055;
        const rim = torus(rimR, 0.0058, 6, 30);
        rim.translate(0, 0, ds + 0.0045);
        b.add(rim, { matrix: m, mat: MAT.ACCENT, owner });
        const gasket = torus(rIn + 0.0006, 0.0021, 4, 26);
        gasket.translate(0, 0, ds + 0.0075);
        b.add(gasket, { matrix: m, mat: MAT.RUBBER, owner });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          const p = new THREE.Vector3(Math.cos(a) * rimR, Math.sin(a) * rimR, ds + 0.0098).applyMatrix4(m);
          b.add(hexBolt(0.0024, 0.0016), { matrix: aimZ([p.x, p.y, p.z], n), mat: MAT.CHROME, owner });
        }
        // strap toward the ear
        const sx = ex + side * (rimR + 0.004);
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const x = sx + side * i * 0.007;
          const y = ey - i * 0.0006;
          const z = zfn(Math.min(Math.abs(x), L.halfWidth - 0.012) * Math.sign(x), y) + 0.0022;
          pts.push([x, y, z]);
        }
        const strap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 12, 0.0028, 4);
        strap.scale(1, 2.2, 1);
        strap.translate(0, -ey * 1.2, 0);
        b.add(strap, { mat: MAT.RUBBER, owner });
        top = ey + rimR + 0.006;
        break;
      }
      case 'bulb': {
        const m = aimZ(c, n);
        const collar = torus(rIn + 0.0012, 0.0032, 5, 28);
        collar.translate(0, 0, ds + 0.0012);
        b.add(collar, { matrix: m, mat: MAT.CHROME, owner });
        b.add(latheZ([[rIn + 0.0075, ds - 0.004], [rIn + 0.0075, ds + 0.0004], [rIn + 0.0035, ds + 0.0018], [rIn, ds + 0.0012], [rIn, ds - 0.006]], 26), { matrix: m, mat: MAT.STEEL, owner });
        top = ey + rLid + 0.002;
        break;
      }
      case 'telescope': {
        // fixed outer tube on the shell, sliding inner tube (zoom) carrying the eye
        const m = aimZ(c, [0, 0, 1]);
        const outerIn = rIn + 0.0034;
        barrel(b, c, [0, 0, 1], outerIn, outerIn + 0.0036, ds - 0.002, ds + 0.017, owner, { body: MAT.STEEL, lip: MAT.CHROME, band: MAT.ACCENT });
        const inner = latheZ([[rIn + 0.003, -0.026], [rIn + 0.003, R * 0.42], [rIn + 0.0016, R * 0.42 + 0.0014], [rIn + 0.0004, R * 0.42 + 0.0008], [rIn + 0.0004, -0.026]], 26);
        b.add(inner, { matrix: m, bone: tubeBone, mat: MAT.ACCENT, owner });
        const lip = torus(rIn + 0.0018, 0.0012, 4, 24);
        lip.translate(0, 0, R * 0.42 + 0.0012);
        b.add(lip, { matrix: m, bone: tubeBone, mat: MAT.CHROME, owner });
        top = ey + outerIn + 0.0045;
        break;
      }
      case 'visor':
        break; // one frame across both eyes (below)
      default: {
        // lens (and the monocle's left eye): a stepped camera-lens barrel
        const front = ds + (eyeShape === 'monocle' ? 0.008 : 0.0095);
        barrel(b, c, n, rIn, rIn + 0.0052, ds - 0.002, front, owner);
        top = ey + rIn + 0.0098;
        if (eyeShape === 'monocle' && side > 0) {
          const m = aimZ(c, n);
          const monoR = rIn + 0.0098;
          const mono = torus(monoR, noHardware() ? 0.0017 : 0.0029, 5, 32);
          mono.translate(0, 0, front + 0.0018);
          b.add(mono, { matrix: m, mat: MAT.BRASS, owner });
          // chain: from the monocle's lower outer edge down to the cheek
          const a0 = new THREE.Vector3(Math.cos(-0.7) * monoR, Math.sin(-0.7) * monoR, front + 0.0018).applyMatrix4(m);
          const pts = [[a0.x, a0.y, a0.z]];
          const end = [ex + 0.045, ey - 0.075, 0];
          end[2] = zfn(Math.min(end[0], L.halfWidth - 0.01), end[1]) + 0.002;
          for (let i = 1; i <= 8; i++) {
            const t = i / 8;
            const x = a0.x + (end[0] - a0.x) * t;
            const y = a0.y + (end[1] - a0.y) * t - Math.sin(t * Math.PI) * 0.014;
            const z = Math.max(zfn(Math.min(Math.abs(x), L.halfWidth - 0.01) * Math.sign(x), y) + 0.0025, a0.z + (end[2] - a0.z) * t);
            pts.push([x, y, z]);
          }
          b.add(tube(pts, 0.0011, 20, 4), { mat: MAT.BRASS, owner });
          b.add(hexBolt(0.0028, 0.002), { matrix: aimZ(end, surfaceNormal(zfn, Math.min(end[0], L.halfWidth - 0.01), end[1])), mat: MAT.BRASS, owner });
          top = ey + monoR + 0.003;
        }
        break;
      }
    }
    b.occluder([c[0], c[1], c[2] + R * 0.6], rIn + 0.009, owner, 1.2);
    eyes.push({ side, center: Float64Array.from(c), R, irisR, rLid, zoom: T.zoom, bones, lidQ: side < 0 ? MIRROR_X : null, top });
  }
  if (eyeShape === 'visor') visorFrame(b, shell, eyes);
  if (eyeShape === 'goggle') {
    // nose bridge between the goggles
    const [l, r] = eyes;
    const x0 = l.center[0] + l.rLid + 0.008;
    const x1 = r.center[0] - r.rLid - 0.008;
    // a straight nose bridge (it sags into a frown on round shells otherwise)
    const y = L.eyeY + 0.002;
    const zb = Math.max(zfn(x0, y), zfn(x1, y), zfn((x0 + x1) / 2, y)) + 0.0045;
    const bridge = new THREE.CylinderGeometry(0.0034, 0.0034, x1 - x0 + 0.006, 10);
    bridge.rotateZ(Math.PI / 2);
    bridge.translate((x0 + x1) / 2, y, zb);
    b.add(bridge, { mat: MAT.STEEL, owner: EYE_OWNER[0] });
    for (const x of [x0, x1]) b.add(hexBolt(0.0026, 0.002), { matrix: aimZ([x, y, zb + 0.0028], [0, 0, 1]), mat: MAT.CHROME, owner: EYE_OWNER[0] });
  }
  return { type: eyeShape, eyes, iris: { blades: T.blades, ring: T.ring, style: T.style } };
}

/** A visor band across both eyes: a frame bent onto the shell with a dark back plate. */
function visorFrame(b, shell, eyes) {
  const L = shell.layout;
  const zfn = shell.surfaceZ;
  const [l, r] = eyes;
  const cy = L.eyeY;
  const R = Math.max(l.rLid, r.rLid);
  const hw = L.eyeX + R + 0.012;
  const hh = R + 0.0085;
  const ihw = L.eyeX + R + 0.0045;
  const ihh = R + 0.0028;
  const rr = hh * 0.85;
  const rect = (path, w, h, rad) => {
    path.moveTo(-w + rad, -h);
    path.lineTo(w - rad, -h);
    path.quadraticCurveTo(w, -h, w, -h + rad);
    path.lineTo(w, h - rad);
    path.quadraticCurveTo(w, h, w - rad, h);
    path.lineTo(-w + rad, h);
    path.quadraticCurveTo(-w, h, -w, h - rad);
    path.lineTo(-w, -h + rad);
    path.quadraticCurveTo(-w, -h, -w + rad, -h);
    return path;
  };
  const shape = rect(new THREE.Shape(), hw, hh, rr);
  shape.holes.push(rect(new THREE.Path(), ihw, ihh, ihh * 0.95));
  const depth = 0.011;
  const frame = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018, bevelSegments: 2, curveSegments: 10 });
  // bend onto the shell: z offset by the surface at x, normals turned by the surface slope
  const z0 = zfn(L.faceX, cy);
  const bend = (p, nrm) => {
    const x = p.x;
    const zs = zfn(x, cy);
    const slope = (zfn(x + 0.002, cy) - zfn(x - 0.002, cy)) / 0.004;
    p.z += zs - z0;
    const a = Math.atan(slope);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = nrm.x * c + nrm.z * s;
    const nz = -nrm.x * s + nrm.z * c;
    nrm.set(nx, nrm.y, nz).normalize();
  };
  // extrude geometry runs z in [-bevel, depth + bevel]; seat its back 4 mm into the shell
  const m = trs([L.faceX, cy, z0 - 0.004]);
  frame.translate(0, 0, 0);
  b.add(frame, { matrix: m, mat: MAT.STEEL, owner: EYE_OWNER[0], warp: bend });
  // a bright trim strip along the top of the frame
  const strip = roundedBox(hw * 1.6, 0.0035, 0.004, 0.0015, 1);
  b.add(strip, { matrix: trs([L.faceX, cy + hh - 0.002, z0 + depth - 0.0015]), mat: MAT.ACCENT, owner: EYE_OWNER[0], warp: bend });
  // dark back plate inside the frame (between the eyes)
  const plate = extrude(
    (() => {
      const pts = [];
      const n = 40;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const px = Math.sign(c) * Math.pow(Math.abs(c), 0.35) * ihw;
        const py = Math.sign(s) * Math.pow(Math.abs(s), 0.35) * ihh;
        pts.push([px, py]);
      }
      return pts;
    })(),
    0.002,
  );
  b.add(plate, { matrix: trs([L.faceX, cy, z0 - 0.002]), mat: MAT.RUBBER, owner: EYE_OWNER[0], warp: bend, ao: 0.6 });
  for (const e of eyes) e.top = cy + hh + 0.003;
}
