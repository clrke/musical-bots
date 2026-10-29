// Where little robot hands touch: port of Unity Heads/Runtime/Hands/{HandCapsules,HandTouch,HandClasp,HandLace}.cs
// and HandAim.EffectorLocal. The hands' volumes as capsules, palm contacts (a clap, a pat, a slap, a bump) that
// really meet, same-handed grips (a handshake, a thumb war's hook) and laced fingers (holding hands). Pure maths.
// A pose is { position: Vector3, rotation: Quaternion, shape } (a wrist pose). Same numbers as Unity (see
// hand-rig.js: the stage is Unity's mirror image, consistently).
import * as THREE from 'three';
import {
  HAND_BONES, PALM, SEG_LENGTH, SEG_RADIUS, X_AXIS, Y_AXIS, Z_AXIS, D2R,
  copyShape, handPose, handRotations, handShape, handTip, lerpShape, lookRotation, rigScratch, smooth,
} from './hand-rig.js';

// ------------------------------------------------------------------ HandCapsules

export const CAP_PALM = 0, CAP_CUFF = 1, CAP_FIRST_DIGIT = 2;
/** Capsules per hand: 3 palm + the cuff + 15 digit segments. */
export const CAP_COUNT = 4 + 15;
const PALM_Y0 = 0.009, PALM_Y1 = 0.026, PALM_X = 0.0105, PALM_R = 0.0068;
const CUFF_Y0 = -0.004, CUFF_Y1 = 0.003, CUFF_R = 0.0125;

/** n capsules { a, b, r, part } (scratch). */
export const makeCapsules = (n) => Array.from({ length: n }, () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, part: 0 }));
export const isFinger = (part) => part >= CAP_FIRST_DIGIT;
/** The digit (0 thumb .. 4 little) of a finger capsule, -1 for the palm and the cuff. */
export const digitOf = (part) => (part < CAP_FIRST_DIGIT ? -1 : Math.floor((part - CAP_FIRST_DIGIT) / 3));

/** The hand's capsules from its posed bones (bones[offset..+15]) into into[at..at+18]; `scale` the hand's size (radii). */
export function buildCapsules(bones, offset, scale, into, at) {
  const palm = bones[offset + PALM];
  let k = at;
  for (let i = -1; i <= 1; i++) {
    const c = into[k++];
    c.a.set(PALM_X * i, PALM_Y0, 0).applyMatrix4(palm);
    c.b.set(PALM_X * i, PALM_Y1, 0).applyMatrix4(palm);
    c.r = PALM_R * scale;
    c.part = CAP_PALM;
  }
  {
    const c = into[k++];
    c.a.set(0, CUFF_Y0, 0).applyMatrix4(palm);
    c.b.set(0, CUFF_Y1, 0).applyMatrix4(palm);
    c.r = CUFF_R * scale;
    c.part = CAP_CUFF;
  }
  for (let b = 1; b < HAND_BONES; b++) {
    const m = bones[offset + b];
    const c = into[k++];
    c.a.set(0, 0, 0).applyMatrix4(m);
    c.b.set(0, SEG_LENGTH[b], 0).applyMatrix4(m);
    c.r = SEG_RADIUS[b] * scale;
    c.part = CAP_FIRST_DIGIT + b - 1;
  }
  return into;
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
/** The shortest distance between segments p1-q1 and p2-q2 (Ericson 5.1.9). */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = _d1.copy(q1).sub(p1), d2 = _d2.copy(q2).sub(p2), r = _r.copy(p1).sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-14 && e <= 1e-14) return r.length();
  if (a <= 1e-14) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-14) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-14 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return _pa.copy(p1).addScaledVector(d1, s).sub(_pb.copy(p2).addScaledVector(d2, t)).length();
}

/** The point of segment a-b nearest p, as the share t (0 at a .. 1 at b). */
export function closestT(a, b, p) {
  const ab = _d1.copy(b).sub(a);
  const l2 = ab.lengthSq();
  return l2 > 1e-14 ? Math.min(1, Math.max(0, _d2.copy(p).sub(a).dot(ab) / l2)) : 0;
}

// ------------------------------------------------------------------ HandTouch

/** A palm contact's lean (deg): the fingers toward the other hand, the wrists apart (the cuffs clear). */
export const TOUCH_TILT = 14;
/** A palm contact's roll (deg): the little-finger edge toward the other hand (the thumbs clear). */
export const TOUCH_ROLL = 8;
/** A flat hand for a palm contact (a clap, a pat): fingers together and bent back a little, the thumb out. */
export const FLAT_SHAPE = handShape(0, -0.15, -0.15, -0.15, -0.15, 0.05, 1);
/** A hand open wide for a slap (a high five). */
export const SPREAD_SHAPE = handShape(0, -0.15, -0.15, -0.15, -0.15, 1.25, 0.95);
/** The Palm effector (the pad's middle) and the Knuckles effector in the hand frame (rig metres). */
export const PAD_LOCAL = new THREE.Vector3(0, 0.0185, 0.0076), KNUCKLES_LOCAL = new THREE.Vector3(0, 0.03125, 0);

const _tq1 = new THREE.Quaternion(), _tq2 = new THREE.Quaternion();
/** A hand's rotation for a palm contact (Unity HandTouch.Palm): leaned by TOUCH_TILT, rolled by TOUCH_ROLL. */
export function palmTouch(rot, side, out = new THREE.Quaternion()) {
  _tq1.setFromAxisAngle(X_AXIS, TOUCH_TILT * D2R);
  _tq2.setFromAxisAngle(Y_AXIS, (side < 0 ? TOUCH_ROLL : -TOUCH_ROLL) * D2R);
  return out.copy(rot).multiply(_tq1).multiply(_tq2);
}
/** A palm contact between two hands of the SAME side (Unity HandTouch.PalmSame): leaned only. */
export function palmSame(rot, out = new THREE.Quaternion()) {
  _tq1.setFromAxisAngle(X_AXIS, TOUCH_TILT * D2R);
  return out.copy(rot).multiply(_tq1);
}
/** The palm contact for a hand on `side` meeting one of `otherSide`. */
export const palmFor = (rot, side, otherSide, out = new THREE.Quaternion()) =>
  ((side < 0) === (otherSide < 0) ? palmSame(rot, out) : palmTouch(rot, side, out));

const S = rigScratch();
const sCaps = makeCapsules(CAP_COUNT);
const sPair = makeCapsules(2 * CAP_COUNT);
const _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _zero = new THREE.Vector3(), _sc = new THREE.Vector3();

function buildAt(shape, side, rot) {
  handRotations(shape, side, S.rot);
  _m.compose(_zero, rot, _one);
  handPose(_m, side, S.rot, S.bones, 0);
  buildCapsules(S.bones, 0, 1, sCaps, 0);
}

/**
 * How far a hand of `shape` on `side`, turned by `rot`, reaches along unit `dir` (rot's frame) from its wrist: the
 * farthest point of its volume (rig metres; times the hand's scale).
 */
export function touchReach(shape, side, rot, dir) {
  buildAt(shape, side, rot);
  let best = -Infinity;
  for (let i = 0; i < CAP_COUNT; i++) {
    const c = sCaps[i];
    const v = Math.max(c.a.dot(dir), c.b.dot(dir)) + c.r;
    if (v > best) best = v;
  }
  return best;
}

/** How far the palm plate alone reaches along `dir` (as touchReach). */
export function palmReach(shape, side, rot, dir) {
  buildAt(shape, side, rot);
  let best = -Infinity;
  for (let i = 0; i < CAP_COUNT; i++) {
    const c = sCaps[i];
    if (c.part !== CAP_PALM) continue;
    best = Math.max(best, Math.max(c.a.dot(dir), c.b.dot(dir)) + c.r);
  }
  return best;
}

let clapReachCache = -1;
/** A clapping wrist's distance from the plane where the palms meet, at contact (rig metres). */
export function clapReach() {
  if (clapReachCache < 0) clapReachCache = touchReach(FLAT_SHAPE, 1, palmTouch(new THREE.Quaternion(), 1), Z_AXIS);
  return clapReachCache;
}

/** A palm contact's direction toward the other hand in the hand's own frame (unit). */
export const normalLocal = (side, out = new THREE.Vector3()) => out.set(0, 0, 1).applyQuaternion(palmTouch(new THREE.Quaternion(), side).invert());

/** How far (rig metres) the palm pad of a clapping hand is from the plane where the palms meet, at contact. */
export const clapPad = () => clapReach() - PAD_LOCAL.dot(normalLocal(1));

const _pl = new THREE.Vector3();
/**
 * Where to put a hand's effector (its place in the hand frame, rig metres: PAD_LOCAL, KNUCKLES_LOCAL, zero for the
 * wrist) so that the hand's front along unit `n` is `gap` short of the plane through `at` (Unity HandTouch.Place).
 * `palmOnly`: the palm plate's front (a same-sided pair palm to palm).
 */
export function touchPlace(shape, side, rot, scale, effector, at, n, gap, palmOnly = false, out = new THREE.Vector3()) {
  const reach = palmOnly ? palmReach(shape, side, rot, n) : touchReach(shape, side, rot, n);
  const along = _pl.copy(effector).applyQuaternion(rot).dot(n);
  return out.copy(at).addScaledVector(n, -((reach - along) * scale + gap));
}

/** A posed hand's capsules (world) into into[at..]. */
export function posedCapsules(shape, side, wrist, rot, scale, into, at) {
  handRotations(shape, side, S.rot);
  _m.compose(wrist, rot, _sc.set(scale, scale, scale));
  handPose(_m, side, S.rot, S.bones, 0);
  return buildCapsules(S.bones, 0, scale, into, at);
}

/** How two posed hands meet: { closest (m; negative: overlap depth), palms (the palm plates' closest), fingerIn }. */
export function measure(a, atA, b, atB) {
  let closest = Infinity, palms = Infinity, fingerIn = 0;
  for (let i = 0; i < CAP_COUNT; i++) {
    const ca = a[atA + i];
    for (let j = 0; j < CAP_COUNT; j++) {
      const cb = b[atB + j];
      const d = segmentDistance(ca.a, ca.b, cb.a, cb.b) - ca.r - cb.r;
      if (d < closest) closest = d;
      if (ca.part === CAP_PALM && cb.part === CAP_PALM && d < palms) palms = d;
      if ((isFinger(ca.part) || isFinger(cb.part)) && -d > fingerIn) fingerIn = -d;
    }
  }
  return { closest, palms, fingerIn };
}

/** The closest the surfaces of two posed hands come (m; negative: overlapping that deep). */
export function handDistance(shapeA, sideA, wristA, rotA, scaleA, shapeB, sideB, wristB, rotB, scaleB) {
  posedCapsules(shapeA, sideA, wristA, rotA, scaleA, sPair, 0);
  posedCapsules(shapeB, sideB, wristB, rotB, scaleB, sPair, CAP_COUNT);
  return measure(sPair, 0, sPair, CAP_COUNT).closest;
}

const _ma = new THREE.Vector3(), _mb = new THREE.Vector3();
/** Two posed hands' volumes overlap deeper than `margin` somewhere (far capsules skipped). */
export function capsulesOverlap(a, atA, b, atB, margin = 0) {
  for (let i = 0; i < CAP_COUNT; i++) {
    const ca = a[atA + i];
    _ma.copy(ca.a).add(ca.b).multiplyScalar(0.5);
    const ra = 0.5 * ca.a.distanceTo(ca.b) + ca.r;
    for (let j = 0; j < CAP_COUNT; j++) {
      const cb = b[atB + j];
      const reach = ra + 0.5 * cb.a.distanceTo(cb.b) + cb.r;
      _mb.copy(cb.a).add(cb.b).multiplyScalar(0.5);
      if (_ma.distanceToSquared(_mb) > reach * reach) continue;
      if (segmentDistance(ca.a, ca.b, cb.a, cb.b) < ca.r + cb.r - margin) return true;
    }
  }
  return false;
}

/**
 * A clap's (a pat's) opening `x` s from its hit (negative: before it): 1 apart .. 0 touching (Unity HandTouch.Open).
 * Eases into contact over inS, pressed `hold`, springs apart over outS.
 */
export function touchOpen(x, inS, hold, outS) {
  const h = 0.5 * hold;
  if (x <= -h) {
    const u = Math.min(1, Math.max(0, (-x - h) / Math.max(1e-4, inS)));
    return u * u * (3 - 2 * u);
  }
  if (x < h) return 0;
  const v = Math.min(1, Math.max(0, (x - h) / Math.max(1e-4, outS)));
  return 1 - (1 - v) * (1 - v);
}

// ------------------------------------------------------------------ effectors (Unity HandAim.EffectorLocal)

/**
 * The effector's place in the hand frame (rig metres, unscaled) for a shape: 'wrist', 'palm', 'back',
 * 'knuckles', 'thumbTip', 'indexTip', 'middleTip', 'pinch', 'fingertips'.
 */
export function effectorLocal(effector, shape, side, out = new THREE.Vector3()) {
  switch (effector) {
    case 'palm': return out.copy(PAD_LOCAL);
    case 'back': return out.set(0, 0.019, -0.0069);
    case 'knuckles': return out.copy(KNUCKLES_LOCAL);
    case undefined:
    case null:
    case 'wrist': return out.set(0, 0, 0);
    default: break;
  }
  handRotations(shape, side, S.rot);
  _m.identity();
  handPose(_m, side, S.rot, S.bones, 0);
  switch (effector) {
    case 'thumbTip': return handTip(S.bones, 0, 0, out);
    case 'indexTip': return handTip(S.bones, 0, 1, out);
    case 'middleTip': return handTip(S.bones, 0, 2, out);
    case 'pinch': return handTip(S.bones, 0, 0, out).add(handTip(S.bones, 0, 1, _pl)).multiplyScalar(0.5);
    default: {
      out.set(0, 0, 0);
      for (let d = 1; d <= 4; d++) out.add(handTip(S.bones, 0, d, _pl));
      return out.multiplyScalar(0.25);
    }
  }
}

// ------------------------------------------------------------------ HandClasp (same-sided grips)

/** A handshake: palms pressed together, the fingers wrapped round the other's heel, the thumbs up over its back. */
export const GRIP_SHAKE = { droop: 35.5, yaw: 29, along: 0.0026, depth: -0.002, shape: handShape(0.28, 0.78, 0.83, 0.51, 0.49, 0, 0.3, 0.82), hookIn: false };
/** A thumb war's grip: each hand's four fingers hooked into the other's, palms apart, both thumbs up. */
export const GRIP_HOOK = { droop: 2.1, yaw: -2.4, along: -0.0126, depth: -0.0056, shape: handShape(0, 0.665, 0.93, 0.687, 0.563, 0.43, 0.9, 0.53), hookIn: true };
const CLASP_PAD = new THREE.Vector3(0, 0.0185, 0.0076);

function claspFrame(side, fingers, thumbs) {
  const t = thumbs.lengthSq() > 1e-12 ? thumbs.clone().normalize() : Y_AXIS.clone();
  const f = fingers.clone().addScaledVector(t, -fingers.dot(t));
  if (f.lengthSq() < 1e-10) f.crossVectors(t, Math.abs(t.x) < 0.9 ? X_AXIS : Z_AXIS);
  f.normalize();
  const n = new THREE.Vector3().crossVectors(f, t).multiplyScalar(side < 0 ? -1 : 1);
  return { f, t, n };
}

/** The clasp's palm direction of hand A (from its palm toward B's) for hands on `side`. */
export const claspNormal = (side, fingers, thumbs) => claspFrame(side, fingers, thumbs).n;

function claspPlace(c, f, t, n, scale, g, shape) {
  const d = g.droop * D2R, y = g.yaw * D2R;
  const fd = f.clone().multiplyScalar(Math.cos(d)).addScaledVector(t, -Math.sin(d));
  const fingers = fd.clone().multiplyScalar(Math.cos(y)).addScaledVector(n, Math.sin(y));
  const palm = n.clone().multiplyScalar(Math.cos(y)).addScaledVector(fd, -Math.sin(y));
  const rotation = lookRotation(fingers, palm);
  const pad = c.clone().addScaledVector(f, g.along * scale).addScaledVector(n, g.depth * scale);
  const position = pad.sub(CLASP_PAD.clone().multiplyScalar(scale).applyQuaternion(rotation));
  return { position, rotation, shape };
}

/**
 * The poses of hand A and hand B (both on `side`) gripping at `centre`, A's fingers along `fingers`, the thumbs along
 * `thumbs`, drawn at `scale`, with grip `g` and shapes (Unity HandClasp.Solve). Returns [a, b].
 */
export function claspSolve(side, scale, g, centre, fingers, thumbs, shapeA = g.shape, shapeB = g.shape) {
  const { f, t, n } = claspFrame(side, fingers, thumbs);
  const a = claspPlace(centre, f, t, n, scale, g, shapeA);
  const b = claspPlace(centre, f.clone().negate(), t, n.clone().negate(), scale, g, shapeB);
  return [a, b];
}

// ------------------------------------------------------------------ HandLace (laced fingers)

const LACE_OPPOSITE = { hinge: 25, gap: 0.0084, shift: -0.0033, shape: handShape(0.86, 0.25, 0.25, 0.25, 0.25, 1.52, 0.58, 0.49) };
const LACE_SAME = { hinge: 10, gap: 0.006, shift: 0.0045, shape: handShape(0.31, 0.33, 0.33, 0.33, 0.33, 1.66, 0.42, 0.96) };
const LACE_KNUCKLES = new THREE.Vector3(0, 0.03125, 0);
/** The palm's centre in the hand frame (rig metres). */
export const PALM_CENTRE = new THREE.Vector3(0, 0.0175, 0);

/** Where two laced hands meet: centre, normal (from hand A toward hand B, perpendicular to up), up (the fingers). */
export function laceClasp(centre, normal, up) {
  const u = up.lengthSq() > 1e-12 ? up.clone().normalize() : Y_AXIS.clone();
  const n = normal.clone().addScaledVector(u, -normal.dot(u));
  if (n.lengthSq() < 1e-10) n.crossVectors(u, Math.abs(u.x) < 0.9 ? X_AXIS : Z_AXIS);
  return { centre: centre.clone(), normal: n.normalize(), up: u };
}

/** The size both laced hands are drawn at (the geometric mean of theirs). */
export const laceSize = (a, b) => Math.sqrt(Math.max(1e-9, a) * Math.max(1e-9, b));
/** The shape a lacing hand takes. */
export const laceShapeOf = (sideA, sideB) => copyShape((sideA < 0) === (sideB < 0) ? LACE_SAME.shape : LACE_OPPOSITE.shape);

function lacePlace(c, n, u, k, ch, sh, sgn, gap, shift, scale, shape) {
  const fingers = u.clone().multiplyScalar(ch).addScaledVector(n, sgn * sh);
  const palm = n.clone().multiplyScalar(sgn * ch).addScaledVector(u, -sh);
  const rotation = lookRotation(fingers, palm);
  const knuckles = c.clone().addScaledVector(n, -gap * scale * sgn).addScaledVector(k, shift * scale * sgn);
  const position = knuckles.sub(LACE_KNUCKLES.clone().multiplyScalar(scale).applyQuaternion(rotation));
  return { position, rotation, shape: copyShape(shape) };
}

/** The laced poses of hand A (sideA) and hand B (sideB) at `clasp`, both drawn at `scale`. Returns [a, b]. */
export function laceSolve(sideA, sideB, scale, clasp) {
  const same = (sideA < 0) === (sideB < 0);
  const cfg = same ? LACE_SAME : LACE_OPPOSITE;
  const n = clasp.normal, u = clasp.up, k = new THREE.Vector3().crossVectors(n, u);
  const shift = cfg.shift * (same && sideA < 0 ? -1 : 1);
  const hinge = cfg.hinge * D2R, ch = Math.cos(hinge), sh = Math.sin(hinge);
  return [
    lacePlace(clasp.centre, n, u, k, ch, sh, 1, cfg.gap, shift, scale, cfg.shape),
    lacePlace(clasp.centre, n, u, k, ch, sh, -1, cfg.gap, shift, scale, cfg.shape),
  ];
}

/** The wrists' midpoint of a pair laced at `clasp`. */
export function laceWristsMid(sideA, sideB, scale, clasp) {
  const [a, b] = laceSolve(sideA, sideB, scale, clasp);
  return a.position.add(b.position).multiplyScalar(0.5);
}

export { lerpShape, smooth };
