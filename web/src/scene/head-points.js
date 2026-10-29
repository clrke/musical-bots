// Points of a robot head a hand can touch: port of Unity RobotHead.PointLocal (RobotHead.Play.cs) for the
// JS head (scene/robot-head.js), read from its shared mechanical head (`head.mech`). Points are in the head's
// own turning frame (the mesh: it follows the float, the look-at turn), in half-widths of the head. Sides
// are the hands' (hand-rig.js): side +1 = the head's +x (the viewer's right), the same numbers as Unity's.
// Names: centre, top, crown, antennaBase, antennaTip, eye, brow, browInner, browOuter, cheek, ear (with a
// side), mouth, chin, back.
import * as THREE from 'three';

/** A generic head's points (Unity RobotHead.Generic), before a head is built. */
export function genericPoint(name, side = 0, out = new THREE.Vector3()) {
  const s = side < 0 ? -1 : side > 0 ? 1 : 0;
  switch (name) {
    case 'top': return out.set(0, 0.95, 0);
    case 'crown': return out.set(0, 0.86, 0.32);
    case 'antennaBase': return out.set(0, 0.95, -0.08);
    case 'antennaTip': return out.set(0, 1.45, -0.08);
    case 'eye': return out.set(0.42 * s, 0.1, 0.8);
    case 'brow': return out.set(0.44 * s, 0.36, 0.78);
    case 'browInner': return out.set(0.24 * s, 0.36, 0.82);
    case 'browOuter': return out.set(0.64 * s, 0.36, 0.68);
    case 'cheek': return out.set(0.64 * s, -0.25, 0.68);
    case 'ear': return out.set(0.98 * s, 0, 0);
    case 'mouth': return out.set(0, -0.42, 0.84);
    case 'chin': return out.set(0, -0.95, 0.5);
    case 'back': return out.set(0, 0, -0.85);
    default: return out.set(0, 0, 0);
  }
}

/** The front of the face at (x, y), head space (the shell's surface; a sane value where it has none). */
function faceZ(h, x, y) {
  const fn = h.rig?.surfaceZ;
  let z = typeof fn === 'function' ? fn(x, y) : NaN;
  const lim = h.halfWidth * 1.2;
  if (!Number.isFinite(z)) z = 0.6 * h.halfWidth;
  return Math.min(lim, Math.max(-lim, z));
}

/**
 * Point `name` (with `side` for the paired ones) of a JS robot head (createRobotHead's API) in its turning frame,
 * in head half-widths. Without a built head: a generic head's.
 */
export function pointLocal(head, name, side = 0, out = new THREE.Vector3()) {
  const h = head?.mech;
  if (!h || !h.rig) return genericPoint(name, side, out);
  const L = h.rig.layout;
  const hw = Math.max(1e-4, h.halfWidth);
  const s = side < 0 ? -1 : 1;
  switch (name) {
    case 'centre': out.set(0, 0, 0); break;
    case 'top': out.set(0, L.top, h.rig.antenna.mount[2]); break;
    case 'crown': out.set(0, L.top * 0.9, Math.max(h.rig.antenna.mount[2] + 0.035, 0.32 * hw)); break;
    case 'antennaBase': out.fromArray(h.rig.antenna.mount); break;
    case 'antennaTip': out.fromArray(h.rig.antenna.mount).y += Math.max(0.012, h.rig.antenna.height); break;
    case 'eye': {
      // the eye on this side (+x for side +1)
      let best = null;
      for (const e of h.rig.eyes.eyes) if (!best || e.center[0] * s > best.center[0] * s) best = e;
      if (best && (h.rig.eyes.eyes.length > 1 || Math.abs(best.center[0]) > 0.01)) out.set(best.center[0], best.center[1], best.center[2] + best.R * 0.7);
      else {
        const x = s * L.eyeX;
        out.set(x, L.eyeY, faceZ(h, L.faceX + x, L.eyeY) + 0.006);
      }
      break;
    }
    case 'brow':
    case 'browInner':
    case 'browOuter': {
      const rig = h.rig.brows.find((b) => (b.side < 0) === (s < 0));
      let px, py, pz, half;
      if (rig) {
        [px, py, pz] = rig.pivot;
        half = rig.halfLen;
      } else {
        py = L.eyeY + 0.03;
        px = s * (L.eyeX + 0.003);
        pz = faceZ(h, L.faceX + s * L.eyeX, py) + 0.01;
        half = 0.025;
      }
      const along = name === 'browInner' ? -1 : name === 'browOuter' ? 1 : 0;
      if (along === 0) out.set(px, py, pz);
      else {
        // inner = toward the nose, outer = away; the brow follows the face's curve back
        const outward = px < 0 ? -1 : 1;
        const x = px + outward * along * half;
        const standoff = pz - faceZ(h, L.faceX + px, py);
        out.set(x, py, faceZ(h, L.faceX + x, py) + standoff);
      }
      break;
    }
    case 'cheek': {
      const x = s * L.cheekX;
      out.set(x, L.cheekY, faceZ(h, L.faceX + x, L.cheekY));
      break;
    }
    case 'ear': out.set(s * Math.max(L.earX, 0.7 * hw), L.earY, L.earZ); break;
    case 'mouth': out.fromArray(h.mouthPoint); break;
    case 'chin': out.set(0, h.captionTop, faceZ(h, L.faceX, h.captionTop + 0.01) - 0.01); break;
    default: out.set(0, 0, -0.85 * hw); break; // back
  }
  return out.divideScalar(hw);
}

/** Point `name` of a JS robot head in the world now (its turning frame: float, look-at turn, scale). */
export function pointWorld(head, name, side = 0, out = new THREE.Vector3()) {
  pointLocal(head, name, side, out);
  const hw = head?.mech?.halfWidth ?? 0.12;
  head.mesh.updateWorldMatrix(true, false);
  return out.multiplyScalar(hw).applyMatrix4(head.mesh.matrixWorld);
}
