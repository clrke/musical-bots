// The little robot hand's skeleton and shapes: port of Unity Heads/Runtime/Hands/{HandRig,SignShapes}.cs
// (HandShape, the 16-bone rig, its forward kinematics) plus the pose helpers every hand module shares
// (Unity LookRotation, HandGestures.Orientation / Make). Pure maths + three.js maths; no DOM.
//
// Hand frame (as Unity's): origin the wrist, +Y toward the fingers, +Z out of the palm, the thumb on -X * side.
// The numbers are Unity's, read in three.js's right-handed axes, so every hand here is the mirror image of
// its Unity twin: side +1 is drawn as an anatomical LEFT hand on the bot's +x side (the viewer's right), side -1
// as a RIGHT hand. The whole stage is mirrored consistently (bot frame x = side +1); a play that wants a
// particular anatomical hand (a handshake is right to right) uses RIGHT / LEFT below.
import * as THREE from 'three';

/** The anatomical right hand's side in this (mirrored) port, and the left one's. */
export const RIGHT = -1, LEFT = 1;

// ------------------------------------------------------------------ HandShape

/** Curls (0 straight .. 1 bent) + spreads. Fields: thumb,index,middle,ring,little,spread,thumbOut,hook,part,cross. */
export function handShape(thumb, index, middle, ring, little, spread, thumbOut, hook = 0, part = 0, cross = 0) {
  return { thumb, index, middle, ring, little, spread, thumbOut, hook, part, cross };
}

export const SHAPES = {
  /** Hanging loose, fingers a little bent (more toward the little finger). */
  relaxed: handShape(0.25, 0.18, 0.26, 0.32, 0.4, 0.18, 0.25),
  /** Open, fingers fanned (a wave, an open-palm gesture). */
  open: handShape(0.02, 0.02, 0.03, 0.05, 0.08, 0.85, 0.75),
  /** Flat, fingers together (a clap). */
  flat: handShape(0.12, 0.04, 0.05, 0.06, 0.08, 0.05, 0.2),
  /** Limp and curled, asleep. */
  droop: handShape(0.45, 0.42, 0.5, 0.56, 0.62, 0.05, 0.1),
  /** Softly curled, resting folded together (a muted bot). */
  folded: handShape(0.5, 0.55, 0.6, 0.62, 0.66, 0.0, 0.15),
  /** Dangling while carried: loose and a little more bent than relaxed. */
  dangle: handShape(0.3, 0.3, 0.36, 0.42, 0.5, 0.1, 0.15),
  /** ASL "I love you": thumb, index, little extended; middle, ring folded. */
  loveYou: handShape(0.0, 0.0, 1.0, 1.0, 0.0, 0.55, 1.0),
};

const SHAPE_KEYS = ['thumb', 'index', 'middle', 'ring', 'little', 'spread', 'thumbOut', 'hook', 'part', 'cross'];

/** Unity HandShape.Lerp (t clamped to 0..1); writes into out (a new object by default). */
export function lerpShape(a, b, t, out = {}) {
  t = Math.min(1, Math.max(0, t));
  for (const k of SHAPE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const copyShape = (s, out = {}) => {
  for (const k of SHAPE_KEYS) out[k] = s[k];
  return out;
};

const curlOf = (s, f) => (f === 0 ? s.thumb : f === 1 ? s.index : f === 2 ? s.middle : f === 3 ? s.ring : s.little);

/** Sign-reply shapes (Unity SignShapes): peace, W, horns, spider-man, vulcan, thumb, shaka, cover, peek, cheeks, mouth, wring. */
export const SIGN_SHAPES = {
  peace: { ...handShape(0.9, 0, 0, 1.05, 1.05, 1.15, 0), cross: 0.85 },
  w: { ...handShape(0.9, 0, 0, 0, 1.05, 1, 0), cross: 1 },
  horns: { ...handShape(0.9, 0, 1.05, 1.05, 0, 0.8, 0), cross: 0.6 },
  spiderMan: { ...handShape(0.9, -0.05, 1.1, 1.1, -0.05, 0.9, 0), cross: 0.55 },
  loveYou: SHAPES.loveYou,
  vulcan: { ...handShape(0, 0, 0, 0, 0, 0, 1), part: 1.25 },
  thumb: handShape(0, 1.05, 1.05, 1.05, 1.05, 0, 1),
  shaka: handShape(0, 1.05, 1.05, 1.05, 0, 1.2, 1),
  coverEyes: handShape(0.25, 0.06, 0.07, 0.08, 0.1, 0.1, 0.35),
  peek: handShape(0.25, 0.04, 0.05, 0.08, 0.12, 1.35, 0.4),
  cheeks: handShape(0.2, 0.06, 0.06, 0.08, 0.1, 0.45, 0.45),
  mouth: handShape(0.3, 0.16, 0.16, 0.18, 0.2, 0.12, 0.3),
  wring: handShape(0.45, 0.5, 0.55, 0.58, 0.62, 0.05, 0.2),
};

// ------------------------------------------------------------------ HandRig

export const HAND_BONES = 16;
export const PALM = 0, THUMB = 1, INDEX = 4, MIDDLE = 7, RING = 10, LITTLE = 13;
/** Wrist to middle fingertip, straight (rig metres, before scaling to the head). */
export const HAND_LENGTH = 0.0652;
export const PALM_WIDTH = 0.034;
/** A hand (wrist to fingertip) is this fraction of the head's width (Unity RobotHands.SizeOfHead). */
export const SIZE_OF_HEAD = 0.3;
/** Head half-widths per metre of the hand rig (Unity SoloKit.HwPerRig). */
export const HW_PER_RIG = (SIZE_OF_HEAD * 2) / HAND_LENGTH;
export const PARENT = [-1, 0, 1, 2, 0, 4, 5, 0, 7, 8, 0, 10, 11, 0, 13, 14];
export const SEG_LENGTH = [0.032, 0.0115, 0.01, 0.0085, 0.013, 0.009, 0.0078, 0.014, 0.01, 0.0082, 0.013, 0.0095, 0.0078, 0.01, 0.0075, 0.0068];
export const SEG_RADIUS = [0, 0.005, 0.0048, 0.0046, 0.0042, 0.0041, 0.004, 0.0043, 0.0042, 0.0041, 0.0041, 0.004, 0.0039, 0.0037, 0.0036, 0.0035];
// digit base on the palm (side +1; x mirrored for side -1)
const BASE = [[-0.0125, 0.0045, 0.0035], [-0.0125, 0.031, 0], [-0.004, 0.033, 0], [0.0045, 0.032, 0], [0.0125, 0.029, 0]];

/** Bone slot of bone b of the hand on side (+1 right, -1 left). */
export const handSlot = (side, b) => (side < 0 ? 0 : HAND_BONES) + b;

const _off = new THREE.Vector3();
/** Offset of bone b from its parent's origin, in the parent's frame (Unity HandRig.Offset). */
export function boneOffset(b, side, out) {
  if (b === PALM) return out.set(0, 0, 0);
  const digit = Math.floor((b - 1) / 3), k = (b - 1) % 3;
  if (k === 0) {
    const p = BASE[digit];
    return out.set(p[0] * side, p[1], p[2]);
  }
  return out.set(0, SEG_LENGTH[b - 1], 0);
}

const CURL_MCP = 80, CURL_PIP = 95, CURL_DIP = 62;
const FAN_DEG = [13, 3.5, -6, -16], FAN_REST = [2, 0, -2, -5];
const HOOK_GAIN = 0.55, PART_DEG = [8, 13, -13, -10];
export const MAX_SPREAD = 2.4, MAX_PART = 1.5;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
export const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
export const D2R = Math.PI / 180;

/** Thumb reaching across the palm (HandShape.cross), blended over the first 0.3. */
function crossThumb(cross, side, rot) {
  const c = Math.min(1, Math.max(0, cross)), sd = side < 0 ? -1 : 1;
  _v1.set(sd * (-0.015 + 0.025 * c), 0.02525 - 0.00375 * c, 0.0145 - 0.0075 * c); // target
  boneOffset(THUMB, side, _v2); // b
  _v3.copy(_v2).lerp(_v1, 0.5);
  _v3.z += 0.005; // aim
  const dMeta = _v4.copy(_v3).sub(_v2).normalize();
  const m = _v3.copy(_v2).addScaledVector(dMeta, SEG_LENGTH[THUMB]);
  const l1 = SEG_LENGTH[THUMB + 1], l2 = SEG_LENGTH[THUMB + 2];
  const tm = new THREE.Vector3().copy(_v1).sub(m);
  const d = Math.min(l1 + l2 - 1e-5, Math.max(Math.abs(l1 - l2) + 1e-5, tm.length()));
  const u = tm.lengthSq() > 1e-12 ? tm.normalize() : dMeta;
  const bend = new THREE.Vector3().copy(Z_AXIS).addScaledVector(u, -Z_AXIS.dot(u));
  if (bend.lengthSq() > 1e-10) bend.normalize();
  else bend.copy(X_AXIS);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const j = new THREE.Vector3().copy(m).addScaledVector(u, l1 * cosA).addScaledVector(bend, l1 * Math.sqrt(1 - cosA * cosA));
  const tip = new THREE.Vector3().copy(m).addScaledVector(u, d);
  const d1 = j.sub(m).normalize(), d2 = tip.sub(j).normalize();
  const r0 = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dMeta);
  const r1 = new THREE.Quaternion().setFromUnitVectors(dMeta, d1).multiply(r0);
  const r2 = new THREE.Quaternion().setFromUnitVectors(d1, d2).multiply(r1);
  let w = c >= 0.3 ? 1 : c / 0.3;
  w = w * w * (3 - 2 * w);
  rot[THUMB].slerp(r0, w);
  rot[THUMB + 1].slerp(r0.clone().invert().multiply(r1), w);
  rot[THUMB + 2].slerp(r1.clone().invert().multiply(r2), w);
}

/** Joint rotations (local to each parent) of a hand shape; rot holds 16 quats, rot[0] identity (Unity HandRig.Rotations). */
export function handRotations(s, side, rot) {
  const sd = side < 0 ? -1 : 1;
  rot[PALM].identity();
  const tc = Math.min(1, Math.max(0, s.thumb)), to = Math.min(1, Math.max(-0.5, s.thumbOut));
  _q1.setFromAxisAngle(Z_AXIS, sd * (28 + 42 * to) * D2R);
  _q2.setFromAxisAngle(X_AXIS, (22 + 18 * tc - 14 * to) * D2R);
  _q3.setFromAxisAngle(Y_AXIS, sd * -25 * D2R);
  rot[THUMB].copy(_q1).multiply(_q2).multiply(_q3);
  _v1.set(1, 0, -0.6 * sd).normalize();
  rot[THUMB + 1].setFromAxisAngle(_v1, 48 * tc * D2R);
  rot[THUMB + 2].setFromAxisAngle(_v1, 62 * tc * D2R);
  if (s.cross > 1e-3) crossThumb(s.cross, side, rot);
  const hook = Math.min(1, Math.max(0, s.hook || 0)), mcp = 1 - hook, ends = 1 + HOOK_GAIN * hook;
  const part = Math.min(MAX_PART, Math.max(0, s.part || 0));
  for (let f = 0; f < 4; f++) {
    const b = INDEX + f * 3;
    const c = Math.min(1.1, Math.max(-0.15, curlOf(s, f + 1)));
    const fan = FAN_REST[f] + (FAN_DEG[f] * Math.min(MAX_SPREAD, Math.max(0, s.spread)) + PART_DEG[f] * part) * (1 - 0.6 * Math.min(1, Math.max(0, c)));
    _q1.setFromAxisAngle(Z_AXIS, sd * fan * D2R);
    _q2.setFromAxisAngle(X_AXIS, CURL_MCP * c * mcp * D2R);
    rot[b].copy(_q1).multiply(_q2);
    rot[b + 1].setFromAxisAngle(X_AXIS, CURL_PIP * Math.max(0, c) * ends * D2R);
    rot[b + 2].setFromAxisAngle(X_AXIS, CURL_DIP * Math.max(0, c) * ends * D2R);
  }
  return rot;
}

const ONE = new THREE.Vector3(1, 1, 1);
/** FK: wrist matrix + joint rotations -> object-from-bone matrices at bones[offset..+15] (Unity HandRig.Pose). */
export function handPose(wrist, side, rot, bones, offset) {
  for (let b = 0; b < HAND_BONES; b++) {
    const p = PARENT[b];
    const parent = p < 0 ? wrist : bones[offset + p];
    bones[offset + b].compose(boneOffset(b, side, _off), rot[b], ONE);
    bones[offset + b].premultiply(parent);
  }
  return bones;
}

/** Tip of digit d (0 thumb .. 4 little) in the space the bones are in. */
export function handTip(bones, offset, digit, out = new THREE.Vector3()) {
  const b = 1 + digit * 3 + 2;
  return out.set(0, SEG_LENGTH[b], 0).applyMatrix4(bones[offset + b]);
}

/** Fresh scratch for the FK: 16 rotations and 16 bone matrices. */
export const rigScratch = () => ({
  rot: Array.from({ length: HAND_BONES }, () => new THREE.Quaternion()),
  bones: Array.from({ length: HAND_BONES }, () => new THREE.Matrix4()),
});

// ------------------------------------------------------------------ orientations

const _lr1 = new THREE.Vector3(), _lr2 = new THREE.Vector3(), _lr3 = new THREE.Vector3(), _m1 = new THREE.Matrix4();
/**
 * Unity Quaternion.LookRotation(n, f): the basis with +Z along n (the palm, kept exactly) and +Y along f (the
 * fingers, orthogonalised). Note the argument order: fingers first.
 */
export function lookRotation(f, n, out = new THREE.Quaternion()) {
  if (n.lengthSq() < 1e-10) _lr1.set(0, 0, 1);
  else _lr1.copy(n).normalize();
  _lr2.crossVectors(f.lengthSq() > 1e-10 ? f : Y_AXIS, _lr1);
  if (_lr2.lengthSq() < 1e-8) _lr2.crossVectors(Math.abs(_lr1.y) < 0.9 ? Y_AXIS : X_AXIS, _lr1);
  _lr2.normalize();
  _lr3.crossVectors(_lr1, _lr2);
  _m1.makeBasis(_lr2, _lr3, _lr1);
  return out.setFromRotationMatrix(_m1);
}

const _of = new THREE.Vector3(), _on = new THREE.Vector3();
/**
 * Unity HandGestures.Orientation: the hand's rotation from side-normalised fingers / palm directions (x
 * outward: mirrored for side -1). Accepts Vector3s or [x, y, z] arrays.
 */
export function orientation(side, fingers, palm, out = new THREE.Quaternion()) {
  const s = side < 0 ? -1 : 1;
  if (Array.isArray(fingers)) _of.set(fingers[0] * s, fingers[1], fingers[2]);
  else _of.set(fingers.x * s, fingers.y, fingers.z);
  if (Array.isArray(palm)) _on.set(palm[0] * s, palm[1], palm[2]);
  else _on.set(palm.x * s, palm.y, palm.z);
  return lookRotation(_of, _on, out);
}

/** A side-normalised vector (x outward on `side`) in the bot's axes (Unity SoloKit.Mir). */
export const mir = (side, v, out = new THREE.Vector3()) => out.set(side < 0 ? -v.x : v.x, v.y, v.z);

/** Smoothstep of x clamped to 0..1. */
export const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** Smoother step (zero velocity and acceleration at both ends) of x clamped to 0..1. */
export const smoother = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (6 * t - 15) + 10);
};
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Unity Vector3.Slerp: directions turned by angle, lengths lerped (t clamped). */
export function slerpVec(a, b, t, out = new THREE.Vector3()) {
  t = clamp01(t);
  const ma = a.length(), mb = b.length();
  if (ma < 1e-9 || mb < 1e-9) return out.copy(a).lerp(b, t);
  const dot = Math.min(1, Math.max(-1, a.dot(b) / (ma * mb)));
  const th = Math.acos(dot);
  const m = ma + (mb - ma) * t;
  if (th < 1e-5) return out.copy(a).lerp(b, t).normalize().multiplyScalar(m);
  if (Math.PI - th < 1e-4) {
    // opposite: turn about any axis perpendicular to a
    const ax = new THREE.Vector3().crossVectors(a, Math.abs(a.x) < 0.9 * ma ? X_AXIS : Y_AXIS).normalize();
    return out.copy(a).applyAxisAngle(ax, th * t).normalize().multiplyScalar(m);
  }
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return out.set((a.x / ma) * wa + (b.x / mb) * wb, (a.y / ma) * wa + (b.y / mb) * wb, (a.z / ma) * wa + (b.z / mb) * wb).normalize().multiplyScalar(m);
}
