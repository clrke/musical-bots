// A head's two little floating robot hands (no arms) — port of Unity's
// Heads/Runtime/Hands/{HandRig,HandMesh,HandGestures,HandTouch,SignShapes}.cs.
// One shared mesh (both hands, 32 bone slots), one draw call with the head's
// own material and look. Pure maths + three.js; no DOM.
import * as THREE from 'three';
import { MAT, HeadBuilder, chamferBox, cylinderY, sphere, trs } from './mech/builder.js';
import { applyFinish, createHeadMaterial } from './head-material.js';
import { trimColor } from './appearance.js';
import { makeRng } from './motion.js';
import { PERSONALITY_STYLES, normalizePersonality } from './personality.js';

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

export function lerpShape(a, b, t, out = {}) {
  t = Math.min(1, Math.max(0, t));
  for (const k of ['thumb', 'index', 'middle', 'ring', 'little', 'spread', 'thumbOut', 'hook', 'part', 'cross']) {
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

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
const PARENT = [-1, 0, 1, 2, 0, 4, 5, 0, 7, 8, 0, 10, 11, 0, 13, 14];
const SEG_LENGTH = [0.032, 0.0115, 0.01, 0.0085, 0.013, 0.009, 0.0078, 0.014, 0.01, 0.0082, 0.013, 0.0095, 0.0078, 0.01, 0.0075, 0.0068];
const SEG_RADIUS = [0, 0.005, 0.0048, 0.0046, 0.0042, 0.0041, 0.004, 0.0043, 0.0042, 0.0041, 0.0041, 0.004, 0.0039, 0.0037, 0.0036, 0.0035];
// digit base on the palm (side +1; x mirrored for the left hand)
const BASE = [[-0.0125, 0.0045, 0.0035], [-0.0125, 0.031, 0], [-0.004, 0.033, 0], [0.0045, 0.032, 0], [0.0125, 0.029, 0]];

/** Bone slot of bone b of the hand on side (+1 right, -1 left). */
export const handSlot = (side, b) => (side < 0 ? 0 : HAND_BONES) + b;

const _off = new THREE.Vector3();
function boneOffset(b, side, out) {
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
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
const D2R = Math.PI / 180;

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

/** Joint rotations (local to each parent) of a hand shape; rot holds 16 quats, rot[0] identity. */
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
  const hook = Math.min(1, Math.max(0, s.hook)), mcp = 1 - hook, ends = 1 + HOOK_GAIN * hook;
  const part = Math.min(MAX_PART, Math.max(0, s.part));
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

/** FK: wrist matrix + joint rotations -> object-from-bone matrices at bones[offset..+15]. */
export function handPose(wrist, side, rot, bones, offset) {
  for (let b = 0; b < HAND_BONES; b++) {
    const p = PARENT[b];
    const parent = p < 0 ? wrist : bones[offset + p];
    _v1.set(0, 0, 0);
    bones[offset + b].compose(boneOffset(b, side, _off), rot[b], _v1.set(1, 1, 1));
    bones[offset + b].premultiply(parent);
  }
  return bones;
}

/** Tip of digit d (0 thumb .. 4 little) in the space the bones are in. */
export function handTip(bones, offset, digit, out = new THREE.Vector3()) {
  const b = 1 + digit * 3 + 2;
  return out.set(0, SEG_LENGTH[b], 0).applyMatrix4(bones[offset + b]);
}

// ------------------------------------------------------------------ HandMesh

let sharedHands = null;

/** Both hands in one geometry (left 0-15, right 16-31), built once and shared. ~1.3k tris. */
export function handGeometry() {
  if (sharedHands) return sharedHands;
  const b = new HeadBuilder();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  for (const side of [-1, 1]) {
    const palm = handSlot(side, PALM);
    // palm plate, rubber pad (+Z), LED (-Z), cuff at the wrist
    b.add(chamferBox(PALM_WIDTH, 0.03, 0.0135, 0.0042), { matrix: trs([0, 0.0175, 0]), bone: palm, mat: MAT.LID, ao: 1 });
    b.add(chamferBox(0.024, 0.019, 0.002, 0.0009), { matrix: trs([0, 0.0185, 0.0066]), bone: palm, mat: MAT.RUBBER, ao: 0.9 });
    b.add(new THREE.CircleGeometry(0.0036, 8), { matrix: trs([0, 0.019, -0.00685], [0, Math.PI, 0]), bone: palm, mat: MAT.LED, ao: 1 });
    b.add(cylinderY(0.0128, 0.0118, 0.0095, 8), { matrix: trs([0, -0.0005, 0]), bone: palm, mat: MAT.ACCENT, ao: 0.85 });
    for (let bone = 1; bone < HAND_BONES; bone++) {
      const slot = handSlot(side, bone);
      const r = SEG_RADIUS[bone], len = SEG_LENGTH[bone];
      b.add(sphere(r * 1.1, 6, (bone - 1) % 3 === 0 ? 3 : 2), { bone: slot, mat: MAT.STEEL, ao: 0.75 });
      b.add(cylinderY(r, r * 0.94, len, 6, true), { matrix: trs([0, len * 0.5, 0]), bone: slot, mat: MAT.LID, ao: 1 });
      if ((bone - 1) % 3 === 2) {
        b.add(sphere(r * 0.94, 6, 2, 0, Math.PI * 0.5), { matrix: trs([0, len, 0]), bone: slot, mat: MAT.LID, ao: 1 });
      }
    }
  }
  sharedHands = b.build();
  return sharedHands;
}

// ------------------------------------------------------------------ gestures

const RAD = Math.PI / 180;
function hash01(i, salt) {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smoothie = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};


/** Unity LookRotation: basis with +Y along f (fingers) and +Z along n (palm). */
const _lr1 = new THREE.Vector3(), _lr2 = new THREE.Vector3(), _lr3 = new THREE.Vector3();
export function lookRotation(f, n, out) {
  _lr1.copy(n).normalize();
  _lr2.crossVectors(f, _lr1);
  if (_lr2.lengthSq() < 1e-8) _lr2.set(1, 0, 0);
  _lr2.normalize();
  _lr3.crossVectors(_lr1, _lr2);
  _m1.makeBasis(_lr2, _lr3, _lr1);
  return out.setFromRotationMatrix(_m1);
}
const _m1 = new THREE.Matrix4();

const REST = { x: 0.82, y: -0.05, lean: 12, spread: [0.05, 0] };
const REST_SING = { x: 0.75, y: -0.02, lean: 20, spread: [0.03, 0] };

export class HandGestures {
  constructor(index, energy = 1) {
    this.index = index;
    this.energy = energy;
    const rng = makeRng(index * 7919 + 4243);
    this._phase = rng() * Math.PI * 2;
    this._carry = -0.15 - 0.25 * rng();
    this._tfist = 0.7 + 0.5 * rng();
    this._intro = 0;
    this._modes = [];
    this._act = 0;
    this._actT = 0;
    this._actDur = 0;
    this._tray = 0;
    this._hold = 0;
    this._shapeCur = { ...SHAPES.relaxed };
    this._flat = { ...SHAPES.flat };
    this._spreadV = 0;
    this._spreadX = 0;
    this._flatT = -1;
    this._palmSide = hash01(index, 4) < 0.5 ? -1 : 1;
    this._clapReachL = 0;
    this._clapReachR = 0;
  }

  static modeOf(g) {
    return { none: 0, sway: 1, point: 2, celebrate: 3, clap: 4, wave: 5, cheer: 6, wring: 7, hold: 8, beckon: 9, clasp: 10, shrug: 11, thwip: 12, loveYou: 13, highFive: 14, reachEach: 15, spin: 16 }[g] ?? 0;
  }
  static energyOf(m) {
    return [0, 0.4, 0.55, 1, 1, 0.75, 1, 0.5, 0.3, 0.6, 0.1, 0.5, 1.1, 0.7, 1, 0.4, 0.85][m] ?? 0;
  }
  static durationOf(m) {
    return [0, 2.8, 2.4, 3.6, 3.2, 2.8, 2.6, 2.8, 1.6, 2.6, 3.4, 2.2, 1.4, 2.6, 1.8, 3.0, 2.8][m] ?? 0;
  }

  play(g) {
    const m = HandGestures.modeOf(g);
    if (m === 8 || m === 10 || m === 12) {
      this._modes[0] = m;
      this._act = m;
      this._actT = 0;
      this._actDur = HandGestures.durationOf(m);
    } else if (m > 0 && !this._modes.includes(m)) {
      if (this._modes.length === 0) {
        this._act = m;
        this._actT = 0;
        this._actDur = HandGestures.durationOf(m);
      }
      this._modes.push(m);
    }
    return m;
  }

  get playing() {
    return this._act;
  }
  get tray() {
    return this._tray;
  }
  get shapeCur() {
    return this._shapeCur;
  }

  /** One frame of the base shape (idle + song). Writes target into out, returns exactness 0..1. */
  baseTarget(out, dt, o) {
    // o: {asleep, muted, grabbed, singing, level, beat, beatSec}
    let rate = 4 * this.energy + (o.singing ? 2 : 0);
    let exact = 0;
    if (o.asleep) {
      rate = 1.5;
      lerpShape(this._shapeCur, SHAPES.droop, Math.min(1, dt * 1.2), this._shapeCur);
    } else if (o.grabbed > 0) {
      lerpShape(this._shapeCur, SHAPES.folded, Math.min(1, dt * 8), this._shapeCur);
    } else if (o.muted) {
      lerpShape(this._shapeCur, SHAPES.folded, Math.min(1, dt * 3), this._shapeCur);
    } else {
      this._tfist -= dt;
      if (this._tfist <= 0) this._tfist = 6 + 5 * hash01(this.index, (o.beat | 0) + 9);
      const fist = this._tfist < 1.6 && o.singing ? Math.sin((Math.min(1.6, Math.max(0, 1.6 - this._tfist)) / 1.6) * Math.PI) : 0;
      _tmpShape.thumb = 0.25 + 0.5 * fist;
      _tmpShape.index = 0.18 + 0.62 * fist;
      _tmpShape.middle = 0.26 + 0.6 * fist;
      _tmpShape.ring = 0.32 + 0.56 * fist;
      _tmpShape.little = 0.4 + 0.5 * fist;
      _tmpShape.spread = 0.18;
      _tmpShape.thumbOut = 0.25;
      _tmpShape.hook = 0;
      _tmpShape.part = 0;
      _tmpShape.cross = 0;
      lerpShape(this._shapeCur, _tmpShape, Math.min(1, dt * rate), this._shapeCur);
    }
    // overlay the playing gesture's shape
    if (this._act > 0) {
      this._actT += dt;
      const e = this.envelope(this._act, o);
      exact = this._act === 10 || this._act === 12 ? e : 0;
      const gs = gestureShape(this._act, this._actT, this._shapeCur, this.energy);
      lerpShape(this._shapeCur, gs, Math.min(1, dt * (2 + 6 * e)), this._shapeCur);
      if (this._actT >= this._actDur) {
        this._modes.shift();
        this._act = this._modes.length > 0 ? this._modes[0] : 0;
        this._actT = 0;
        this._actDur = this._act > 0 ? HandGestures.durationOf(this._act) : 0;
      }
    }
    Object.assign(out, this._shapeCur);
    return exact;
  }

  envelope(m, o) {
    const e = this.energy, t = this._actT;
    switch (m) {
      case 3:
      case 6:
      case 16:
        return smoothie(t / 0.6);
      case 5:
      case 13:
        return smoothie(t / 0.5) * (1 - smoothie((t - this._actDur + 0.5) / 0.5));
      case 4:
      case 8:
      case 10:
      case 12:
        return smoothie(t / 0.5);
      case 15:
        return smoothie(t / 0.5) * (1 - smoothie((t - this._actDur + 0.5) / 0.5));
      case 2:
      case 9:
      case 11:
      case 14:
        return smoothie(t / 0.4);
      default:
        return smoothie(t / 0.6) * (1 - smoothie((t - this._actDur + 0.4) / 0.4));
    }
  }

  /** Wrist target in head half-widths + shape. hands: {drawnL, drawnR} parent-space wrist pos (prev frame). */
  gestureTarget(g, t, o, drawL, drawR, side, out) {
    // o: {beat, beatSec, unit, singing, level}
    const sd = side < 0 ? -1 : 1;
    const ph = this._phase;
    const e = this.envelope(g, o);
    const beat = o.beat, beatSec = Math.max(0.2, o.beatSec);
    let pos = null, f = null, n = null, shape = null, exact = 0;
    const bounce = Math.max(0, Math.sin((beat * Math.PI * 2) / 2));
    switch (g) {
      case 3: // celebrate
        pos = [sd * (0.75 + 0.25 * e), 1.55 - 0.2 * e + 0.12 * bounce * e, 0.18 * e];
        f = [sd * 0.1 * e, 1, 0.3 * e];
        n = [0, 0.3 * e, 1];
        shape = lerpShape(SHAPES.relaxed, SHAPES.open, e);
        break;
      case 4: { // clap
        const open = this.clapOpen(o, side, drawL, drawR);
        const w = 0.265 + 0.77 * open;
        pos = [sd * 0.32 * w + this._tray * sd * 0.15, (0.72 + 0.3 * open - 0.04 * (1 - open)) * (1 + this._hold * 0.1), 0.72];
        const lean = 55 * RAD * (1 - open);
        f = [sd * 0.12 * open, Math.cos(lean) * (0.5 + 0.5 * open) + 0.5 * open, 0.42 * (1 - open) + 0.1 * open];
        n = [-sd, 0, 0.25 * open];
        shape = clapShape(this, open);
        exact = 1;
        break;
      }
      case 5: { // wave
        const wv = Math.sin(t * 7 * this.energy + ph) * e;
        pos = [sd * (1.05 + 0.08 * wv), 1.5 - 0.05 * e, 0.12];
        f = [sd * 0.1, 1, 0.1];
        n = [sd * -0.2, -0.15, 1];
        shape = lerpShape(SHAPES.relaxed, SHAPES.open, e, {});
        break;
      }
      case 6: // cheer
        pos = [sd * 1.15 * e + sd * 0.82 * (1 - e), 1.35 * e - 0.05 * (1 - e) + 0.14 * bounce * e, 0.22 * e];
        f = [sd * 0.15, 1, 0.25];
        n = [0, 0.2, 1];
        shape = lerpShape(SHAPES.relaxed, { ...SHAPES.open, thumb: 0.4 }, e);
        break;
      case 14: // highFive
        pos = [sd * 0.95, 1.5, 0.2];
        f = [0, 1, 0.1];
        n = [-sd, 0, 0.15];
        shape = { ...SHAPES.open };
        break;
      case 2: // point
        pos = [sd * 0.3 * e, 0.55 + 0.35 * e, 0.85 * e];
        f = [sd * 0.1, 0.35, 1];
        n = [0, 1, 0.2];
        shape = { ...SHAPES.relaxed, index: 0.02, middle: 0.7, ring: 0.75, little: 0.8, spread: 0.3 };
        break;
      case 9: // beckon
        pos = [sd * 0.55, 0.35, 0.75];
        f = [sd * 0.2, 0.5, 1];
        n = [0, 1, 0.3];
        shape = { ...SHAPES.open, index: 0.5, middle: 0.5, ring: 0.5, little: 0.5 };
        break;
      case 16: { // spin
        const tw = t * 5 * this.energy;
        pos = [sd * (0.9 + 0.2 * Math.cos(tw)), 0.9 + 0.25 * Math.sin(tw), 0.35];
        f = [0, Math.cos(tw), Math.sin(tw)];
        n = [Math.sin(tw * 0.5), 0, Math.cos(tw * 0.5)];
        shape = { ...SHAPES.open };
        break;
      }
      case 7: { // wring
        const wr = Math.sin(t * 9) * e;
        pos = [sd * 0.3 + wr * 0.06, 0.15, 0.75];
        f = [sd * 0.3, 0.4, 1];
        n = [-sd * 0.7, 0.3, 0.6];
        shape = { ...SHAPES.folded };
        break;
      }
      case 11: // shrug
        pos = [sd * (0.82 + 0.25 * e), 0.35 + 0.3 * e, 0.3 * e];
        f = [sd * 0.4, 0.7, 0.4];
        n = [0, 1, 0.3];
        shape = lerpShape(SHAPES.relaxed, SHAPES.open, 0.6 * e);
        break;
      case 13: // loveYou
        pos = [sd * 0.75, 0.75 + 0.15 * e, 0.45 * e];
        f = [sd * 0.1, 0.9, 0.35];
        n = [0, 0.1, 1];
        shape = { ...SIGN_SHAPES.loveYou };
        break;
      default:
        return null;
    }
    out.position.set(pos[0], pos[1], pos[2]);
    lookRotation(_v1.set(...f).normalize(), _v2.set(...n).normalize(), out.rotation);
    if (g === 5) out.rotation.multiply(_q1.setFromAxisAngle(Z_AXIS, Math.sin(t * 7 * this.energy + ph) * e * 0.5));
    out.shape = shape;
    out.exact = exact;
    return out;
  }

  clapOpen(o, side, drawL, drawR) {
    // lean the palms toward each other (14 deg), measure the gap between them
    const sd = side < 0 ? -1 : 1;
    const lean = handTilt(drawL, drawR) * (14 * 0.0174533);
    void lean;
    const draw = side < 0 ? drawL : drawR;
    const other = side < 0 ? drawR : drawL;
    const reach = side < 0 ? this._clapReachL : this._clapReachR;
    const d = _v1.copy(other).sub(draw);
    const gap = d.length() - reach * 2;
    const open = Math.min(1, Math.max(0, gap / (0.6 * o.unit)));
    return open;
  }
}

const _tmpShape = handShape(0, 0, 0, 0, 0, 0, 0);

/** The playing gesture's finger shape (Unity GestureTarget shape mixing). */
function gestureShape(m, t, base, energy) {
  switch (m) {
    case 3:
    case 6:
      return lerpShape(base, SHAPES.open, 0.8, {});
    case 5:
      return lerpShape(base, SHAPES.open, 0.9, {});
    case 13:
      return { ...SIGN_SHAPES.loveYou };
    case 2:
      return { ...base, index: 0.02, middle: 0.7, ring: 0.75, little: 0.8 };
    case 7:
      return { ...SHAPES.folded };
    default:
      return { ...base };
  }
}

function clapShape(g, open) {
  // open palms while apart, flatten as they meet
  return lerpShape(SHAPES.open, g._flat, 1 - open, {});
}

/** Head-relative tilt of the L->R wrist axis (Unity HandTouch.Tilt), for palm lean. */
export function handTilt(drawL, drawR) {
  _v1.copy(drawR).sub(drawL);
  return Math.atan2(_v1.y, Math.abs(_v1.x)) / (Math.PI * 0.5);
}

// ------------------------------------------------------------------ RobotHands (lite)

/** Blob size of a head scale for the wrist rest poses (Unity RobotHands.SizeOfHead). */
/** A hand (wrist to fingertip) is this fraction of the head's width (Unity RobotHands.SizeOfHead). */
export const SIZE_OF_HEAD = 0.3;

export class RobotHands {
  constructor(index) {
    this.index = index;
    const rng = makeRng(index * 7919 + 4243);
    this.energy = 1;
    this.gestures = { '-1': new HandGestures(index * 2, 1), 1: new HandGestures(index * 2 + 1, 1) };
    this.material = createHeadMaterial();
    this.material.name = 'magna-hands';
    this.mesh = new THREE.Mesh(handGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.bonesArr = this.material.uniforms.uBones.value;
    this._bones = Array.from({ length: 32 }, () => new THREE.Matrix4());
    this._rot = Array.from({ length: 16 }, () => new THREE.Quaternion());
    this._rot2 = Array.from({ length: 16 }, () => new THREE.Quaternion());
    this._reachBones = Array.from({ length: 16 }, () => new THREE.Matrix4());
    this._shape = { ...SHAPES.relaxed };
    this._wrist = new THREE.Matrix4();
    this._scl = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._time = 0;
    this._drawn = { '-1': { p: new THREE.Vector3(), q: new THREE.Quaternion() }, 1: { p: new THREE.Vector3(), q: new THREE.Quaternion() } };
    this._followV = { '-1': new THREE.Vector3(), 1: new THREE.Vector3() };
    this._snap = { '-1': true, 1: true };
    this._centre = new THREE.Vector3();
    this._wristPos = new THREE.Vector3();
    this._tgt = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: null, exact: 0 };
    this._look = null;
    this._coin = rng() < 0.5 ? -1 : 1;
  }

  attach(parent) {
    this.parent = parent;
    parent.add(this.mesh);
    parent.updateWorldMatrix(true, false);
  }

  setLook(look) {
    this._look = look;
    const u = this.material.uniforms;
    applyFinish(look.faceColor, look.finish, u.uPaint.value, u.uFinish.value);
    u.uAccent.value.set(trimColor(look.faceColor, look.accentColor));
    u.uEye.value.set(look.eyeColor);
  }

  setPersonality(id) {
    const st = PERSONALITY_STYLES[normalizePersonality(id)];
    // how lively the hands are: singing gain x bob (Unity HandGestures.EnergyOf)
    const e = st ? (st.sing.gain * st.sing.bob - 0.1) / 1.5 : 0.5;
    this.energy = Math.min(1, Math.max(0, e));
    this.gestures['-1'].energy = this.energy;
    this.gestures[1].energy = this.energy;
  }

  play(g) {
    this.gestures['-1'].play(g);
    this.gestures[1].play(g);
  }

  get playing() {
    return this.gestures[1].playing;
  }

  /** Drawn wrist (parent space) for staging (handshakes aim at these). */
  wristPos(side, out = new THREE.Vector3()) {
    return out.copy(this._drawn[side < 0 ? '-1' : '1'].p);
  }

  /**
   * o: {centre, unit, dt, singing, level, muted, asleep, grab, wring,
   *     beat, beatSec, noteSeconds, aimL, aimR}
   * aim: {position (parent space), rotation, shape, weight} | null
   */
  /** How far a shaped hand reaches from its wrist along dir (parent space) — lands claps. */
  _reach(side, shape, wristPos, wristQuat, dir, handScale) {
    this._dir.copy(dir);
    handRotations(shape, side, this._rot2);
    this._wrist.compose(wristPos, wristQuat, this._scl.setScalar(handScale));
    handPose(this._wrist, side, this._rot2, this._reachBones, 0);
    const w0 = wristPos.dot(this._dir);
    let best = 0;
    _v2.set(0, 0.03, 0).applyMatrix4(this._reachBones[PALM]); // palm plate top
    best = Math.max(best, _v2.dot(this._dir) - w0 + 0.017 * handScale);
    for (let d = 0; d < 5; d++) {
      handTip(this._reachBones, 0, d, _v3);
      best = Math.max(best, _v3.dot(this._dir) - w0 + SEG_RADIUS[1 + d * 3 + 2] * handScale);
    }
    return Math.max(0, best);
  }

  update(o) {
    const dt = Math.min(0.05, o.dt);
    this._time += dt;
    const handScale = (SIZE_OF_HEAD * 2 * o.unit) / HAND_LENGTH;
    const beat = o.beat ?? 0, beatSec = o.beatSec ?? 0.5;
    // clap reach for both hands (flattened palm extent toward the other wrist)
    if (this.gestures['-1'].playing === 4 || this.gestures[1].playing === 4) {
      for (const side of [-1, 1]) {
        const key = side < 0 ? '-1' : '1';
        const other = side < 0 ? '1' : '-1';
        _v4.copy(this._drawn[other].p).sub(this._drawn[key].p);
        if (_v4.lengthSq() < 1e-8) _v4.set(-side, 0, 0);
        _v4.normalize();
        const reach = this._reach(side, SHAPES.flat, this._drawn[key].p, this._drawn[key].q, _v4, handScale);
        this.gestures[key]._clapReachL = reach;
        this.gestures[key]._clapReachR = reach;
      }
    }
    // targets for both hands first (claps read the previous frame's drawn wrists)
    const targets = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? '-1' : '1';
      const g = this.gestures[key];
      const exact = g.baseTarget(this._shape, dt, o);
      void exact;
      let tgt = null;
      if (g.playing) {
        tgt = g.gestureTarget(g.playing, g._actT, { ...o, beat, beatSec }, this._drawn['-1'].p, this._drawn[1].p, side, this._tgt);
      }
      if (!tgt) {
        // rest: hang beside the head, swing a little with the song
        const rest = o.singing ? REST_SING : REST;
        const ph = this.index * 7919 + 4243;
        const swing = o.singing ? Math.sin(beat * Math.PI + ph) * 0.06 : Math.sin(this._time * 0.9 + ph) * 0.02;
        this._tgt.position.set(side * rest.x, rest.y + swing, 0.1);
        lookRotation(_v1.set(side * 0.15, -1, 0.1).normalize(), _v2.set(side * -0.5, 0.25, 1).normalize(), this._tgt.rotation);
        this._tgt.shape = this._shape;
        this._tgt.exact = 0;
        tgt = this._tgt;
      }
      targets[key] = { pos: tgt.position.clone(), quat: tgt.rotation.clone(), shape: { ...tgt.shape }, exact: tgt.exact };
      // aim blend (staging: consultations, handshakes)
      const aim = side < 0 ? o.aimL : o.aimR;
      if (aim && aim.weight > 0) {
        const w = Math.min(1, aim.weight);
        _v1.copy(aim.position).sub(o.centre).divideScalar(o.unit); // parent space -> half-widths
        targets[key].pos.lerp(_v1, w);
        targets[key].quat.slerp(aim.rotation, w);
        lerpShape(targets[key].shape, aim.shape ?? SHAPES.open, w, targets[key].shape);
        if (aim.exact) targets[key].exact = Math.max(targets[key].exact, w);
      }
    }
    // finish: follow spring + FK + bone upload
    for (const side of [-1, 1]) {
      const key = side < 0 ? '-1' : '1';
      const T = targets[key];
      this._wristPos.copy(T.pos).multiplyScalar(o.unit).add(o.centre);
      if (this._snap[key]) {
        this._drawn[key].p.copy(this._wristPos);
        this._drawn[key].q.copy(T.quat);
        this._snap[key] = false;
      }
      if (T.exact >= 0.99) {
        this._drawn[key].p.copy(this._wristPos);
      } else {
        // critically damped follow per axis
        for (const ax of ['x', 'y', 'z']) {
          const stiff = 10;
          const f = 1 + 2 * dt * stiff + dt * dt * stiff * stiff;
          const vv = this._followV[key];
          vv[ax] += dt * stiff * stiff * (this._wristPos[ax] - this._drawn[key].p[ax]);
          vv[ax] /= f;
          this._drawn[key].p[ax] += dt * vv[ax];
        }
      }
      this._drawn[key].q.slerp(T.quat, Math.min(1, (T.exact >= 0.99 ? 14 : 8) * dt));
      this._scl.setScalar(handScale);
      this._wrist.compose(this._drawn[key].p, this._drawn[key].q, this._scl);
      handRotations(T.shape, side, this._rot);
      handPose(this._wrist, side, this._rot, this._bones, side < 0 ? 0 : 16);
    }
    // upload 32 bone rows (3x4 row-major each)
    for (let i = 0; i < 32; i++) {
      const e = this._bones[i].elements, w = i * 12;
      this.bonesArr[w] = e[0];
      this.bonesArr[w + 1] = e[4];
      this.bonesArr[w + 2] = e[8];
      this.bonesArr[w + 3] = e[12];
      this.bonesArr[w + 4] = e[1];
      this.bonesArr[w + 5] = e[5];
      this.bonesArr[w + 6] = e[9];
      this.bonesArr[w + 7] = e[13];
      this.bonesArr[w + 8] = e[2];
      this.bonesArr[w + 9] = e[6];
      this.bonesArr[w + 10] = e[10];
      this.bonesArr[w + 11] = e[14];
    }
    // LED glow follows the song; no rim, no blush on hands
    const awake = 1 - 0.7 * (o.muted ? 1 : 0);
    const u = this.material.uniforms;
    u.uGlow.value.set(0, 0, awake * (0.35 + 0.9 * (o.level ?? 0)), 0);
    u.uState.value.set(0, awake, 0.65 * (o.muted ? 1 : 0), 0);
  }
}

