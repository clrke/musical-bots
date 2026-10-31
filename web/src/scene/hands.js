// A head's two little floating robot hands (no arms): port of Unity Heads/Runtime/Hands/{HandMesh,
// HandGestures,RobotHands}.cs. One shared mesh (both hands, 32 bone slots), one draw call with the head's own
// material and look. The gestures are Unity's HandGestures (idle / singing / muted / asleep / carried poses,
// the sway on the song's beat, and the one-shots Wave, OpenPalm, Clap with real palm contact, LoveYou) plus
// the stage's extra modes (celebrate, cheer, point, spin, shrug, beckon, wring, highFive). A hand play aims
// either hand (HandAim: in the bot's frame, on a head's point, or in the world) and blends it over the gesture
// by its weight; the hands follow with Unity's soft spring (stiffer while aimed), drawn exactly at contact
// moments. A `walk` input (0..1) swings the hands gently while the bot glides. Pure maths + three.js; no DOM.
import * as THREE from 'three';
import { MAT, HeadBuilder, chamferBox, cylinderY, sphere, trs } from './mech/builder.js';
import { applyFinish, createHeadMaterial } from './head-material.js';
import { drawnLook } from './head-style.js';
import { trimColor } from './appearance.js';
import { makeRng } from './motion.js';
import { PERSONALITY_STYLES, normalizePersonality } from './personality.js';
import {
  HAND_BONES, HAND_LENGTH, PALM, PALM_WIDTH, RIGHT, SEG_LENGTH, SEG_RADIUS, SHAPES, SIZE_OF_HEAD, X_AXIS, Z_AXIS, D2R,
  copyShape, handPose, handRotations, handSlot, lerpShape, orientation, smooth,
} from './hand-rig.js';
import { FLAT_SHAPE, clapReach, effectorLocal, palmTouch, touchOpen } from './hand-touch.js';
import { pointLocal } from './head-points.js';

export {
  RIGHT, LEFT, handShape, SHAPES, lerpShape, SIGN_SHAPES, HAND_BONES, PALM, THUMB, INDEX, MIDDLE, RING, LITTLE,
  HAND_LENGTH, PALM_WIDTH, SIZE_OF_HEAD, SEG_LENGTH, SEG_RADIUS, handSlot, MAX_SPREAD, MAX_PART, handRotations, handPose,
  handTip, lookRotation, orientation,
} from './hand-rig.js';

// ------------------------------------------------------------------ HandMesh

let sharedHands = null;

/** Both hands in one geometry (left 0-15, right 16-31), built once and shared. ~1.3k tris. */
export function handGeometry() {
  if (sharedHands) return sharedHands;
  const b = new HeadBuilder();
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

// ------------------------------------------------------------------ HandGestures

/** Gesture ids: Unity's four one-shots, then the stage's extra modes. */
export const GESTURE = Object.freeze({
  none: 0, wave: 1, palm: 2, clap: 3, loveYou: 4,
  celebrate: 5, cheer: 6, point: 7, spin: 8, shrug: 9, beckon: 10, wring: 11, highFive: 12,
});
const ALIAS = { openPalm: 'palm', 'open-palm': 'palm', loveyou: 'loveYou', 'love-you': 'loveYou', 'high-five': 'highFive' };

export const WAVE_SECONDS = 1.9, CLAP_SECONDS = 2.4, LOVE_YOU_SECONDS = 3.4, OPEN_PALM_SECONDS = 1.6;
/** Claps per second in the clap; this many claps once the hands are up (CLAP_UP s), the palms pressed CLAP_PRESS each. */
export const CLAP_RATE = 2.3, CLAPS = 4, CLAP_UP = 0.25, CLAP_PRESS = 0.045;
/** A note held at least this long (and 1.5 beats) may get an open palm, at most every OPEN_PALM_COOLDOWN s per bot. */
export const LONG_NOTE_SECONDS = 0.9, OPEN_PALM_COOLDOWN = 4.5;
const DURATION = [0, WAVE_SECONDS, OPEN_PALM_SECONDS, CLAP_SECONDS, LOVE_YOU_SECONDS, 3.6, 2.6, 2.4, 2.8, 2.2, 2.6, 2.8, 1.8];
/** The breath rate of a sleeping head (rad/s; Unity Personality.BreathRate). */
const BREATH_RATE = 1.15;

/** The time (s into the clap) of hit k (0 .. CLAPS - 1). */
export const clapHit = (k) => CLAP_UP + (k + 0.5) / CLAP_RATE;

/** How far apart the clapping hands are `t` s into the clap: 0 the palms touching (each hit) .. 1 apart. */
export function clapOpen(t) {
  const period = 1 / CLAP_RATE, half = 0.5 * (period - CLAP_PRESS);
  const k = Math.min(CLAPS - 1, Math.max(0, Math.round((t - CLAP_UP) * CLAP_RATE - 0.5)));
  return touchOpen(t - clapHit(k), half, CLAP_PRESS, half);
}

/** A clapping wrist's distance from the plane where the palms meet, at contact (head half-widths). */
const clapReachHw = () => (clapReach() * SIZE_OF_HEAD * 2) / HAND_LENGTH;

/** Unity HandGestures.Hash01: a deterministic hash in [0, 1). */
export function hash01(n) {
  let h = Math.imul(n | 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h ^= h >>> 16;
  return (h & 0xffffff) / 16777216;
}

const pose = () => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: copyShape(SHAPES.relaxed) });
/** A pose from side-normalised vectors (x outward, mirrored for side -1): Unity HandGestures.Make. */
export function makePose(side, pos, fingers, palm, shape, out = pose()) {
  out.position.set(pos[0] * (side < 0 ? -1 : 1), pos[1], pos[2]);
  orientation(side, fingers, palm, out.rotation);
  copyShape(shape, out.shape);
  return out;
}

const _gq = new THREE.Quaternion(), _gv = new THREE.Vector3();
const _shapeTmp = copyShape(SHAPES.relaxed);
const POINT_SHAPE = { ...SHAPES.relaxed, thumb: 0.8, index: 0, middle: 1.05, ring: 1.05, little: 1.05, spread: 0.05, thumbOut: 0.05 };

/**
 * The little floating hands' gestures (Unity HandGestures): a state machine over the bot's state with one-shots on
 * top, smooth and deterministic per index. Poses are in the bot's frame relative to the head centre, in head
 * half-widths (x = side +1, y up, z toward the viewer).
 */
export class HandGestures {
  constructor(index, energy = 0.5) {
    this.index = index;
    this._energy = Math.min(1, Math.max(0, energy));
    const rng = makeRng(index * 7919 + 4243);
    this._breathPhase = rng() * Math.PI * 2;
    this._idlePhase = rng() * Math.PI * 2;
    this._beatLead = rng() * 0.24 - 0.12; // a little ahead of or behind the beat (beats)
    this._swayDir = (index & 1) === 0 ? 1 : -1;
    this._palmReadyAt = 1.5 + rng() * 3.0;
    this._time = 0;
    this._mode = 'idle';
    this._gesture = 0;
    this._gestureSide = 0; // +1, -1, 0 both
    this._gestureAt = 0;
    this._prev = { g: 0, side: 0, at: 0, until: 0, from: 0 }; // a replaced gesture fading out
    this._palmCount = 0;
    this._noteUsed = false;
    this._sing = 0;
    this._level = 0;
    this._exact = 0;
    this._walk = 0;
    this._walkPhase = rng() * Math.PI * 2;
    this._base = [pose(), pose()];
    this._baseVel = [new THREE.Vector3(), new THREE.Vector3()];
    this._out = [pose(), pose()];
    this._tgt = pose();
    this._g = pose();
    this._first = true;
  }

  get energy() { return this._energy; }
  set energy(v) { this._energy = Math.min(1, Math.max(0, v)); }
  /** The gesture playing now (0 once it is over). */
  get gesture() { return this._gesture; }
  get playing() { return this._gesture; }
  get mode() { return this._mode; }
  get gestureTime() { return this._time - this._gestureAt; }
  /** How exactly the hands must be drawn now (the clap: the palms meet at each hit). */
  get exact() { return this._exact; }
  /** The pose of the hand on side (+1 / -1) after the last step. */
  hand(side) { return this._out[side < 0 ? 0 : 1]; }

  static idOf(name) {
    if (typeof name === 'number') return name;
    return GESTURE[ALIAS[name] ?? name] ?? 0;
  }
  static durationOf(g) { return DURATION[g] ?? 0; }

  /** Starts a gesture now (replacing the one playing, which fades out). Returns its id (0: none / carried). */
  play(name) {
    const g = HandGestures.idOf(name);
    if (g === 0) return 0;
    if (this._mode === 'carried') return 0;
    if (this._gesture) Object.assign(this._prev, { g: this._gesture, side: this._gestureSide, at: this._gestureAt, from: this._time, until: this._time + 0.3 });
    this._gesture = g;
    this._gestureAt = this._time;
    const i = this.index;
    this._gestureSide = g === GESTURE.wave ? ((i & 1) === 0 ? 1 : -1)
      : g === GESTURE.loveYou || g === GESTURE.point || g === GESTURE.highFive ? RIGHT
      : g === GESTURE.beckon ? ((i & 1) === 0 ? -1 : 1)
      : g === GESTURE.palm ? (this._energy > 0.7 ? 0 : ((i + this._palmCount) & 1) === 0 ? 1 : -1)
      : 0;
    return g;
  }

  /** A gesture name's id (0: unknown): the stage's contract (acting.js asks it which modes the hands know). */
  static modeOf(name) {
    return HandGestures.idOf(name);
  }

  /** The hands' mode for a frame's input (priority: carried, asleep, muted, singing, idle). */
  static modeOfInput(i) {
    if (i.grabbed) return 'carried';
    if ((+i.asleep || 0) >= 0.5) return 'asleep';
    if (i.muted) return 'muted';
    if (i.singing) return 'singing';
    return 'idle';
  }

  /**
   * One frame. i: { dt, asleep 0..1, muted, singing, level, grabbed, beat, beatSec (0: no song clock),
   * noteSeconds (the syllable sung now held so long), walk 0..1 }.
   */
  step(i) {
    const dt = Math.min(0.1, Math.max(0, i.dt || 0));
    this._time += dt;
    const mode = HandGestures.modeOfInput(i);
    this._mode = mode;
    if (mode === 'carried') this._gesture = 0;
    if (this._gesture && this._time - this._gestureAt >= HandGestures.durationOf(this._gesture)) this._gesture = 0;
    this._level += ((i.level || 0) - this._level) * (1 - Math.exp(-8 * dt));
    this._sing += ((mode === 'singing' ? 1 : 0) - this._sing) * (1 - Math.exp(-3 * dt));
    this._walk += (Math.min(1, Math.max(0, i.walk || 0)) - this._walk) * (1 - Math.exp(-5 * dt));
    this._walkPhase += dt * Math.PI * 2 * (0.85 + 0.55 * this._walk);
    this._maybeOpenPalm(i, mode);
    const beat = i.beatSec > 0 ? i.beat : this._time * 0.9; // no clock: a slow, steady time of its own
    const asleepFade = 1 - Math.min(1, Math.max(0, ((+i.asleep || 0) - 0.5) * 4));
    this._exact = this._gesture === GESTURE.clap ? this._envelope(GESTURE.clap, this._time - this._gestureAt) * asleepFade : 0;
    const prev = this._prev;
    const prevW = prev.g && this._time < prev.until ? 1 - smooth((this._time - prev.from) / (prev.until - prev.from)) : 0;
    for (let h = 0; h < 2; h++) {
      const side = h === 0 ? -1 : 1;
      const target = this._baseTarget(mode, side, this._tgt);
      // mode changes glide (asleep slowly: it dozes off); the breathing is part of the target
      const k = mode === 'asleep' ? 2.2 : mode === 'carried' ? 9 : 6;
      const base = this._base[h];
      if (this._first) {
        base.position.copy(target.position);
        this._baseVel[h].set(0, 0, 0);
        base.rotation.copy(target.rotation);
        copyShape(target.shape, base.shape);
      } else {
        springTo(base.position, this._baseVel[h], target.position, k * 1.6, dt);
        const a = 1 - Math.exp(-k * dt);
        base.rotation.slerp(target.rotation, a);
        lerpShape(base.shape, target.shape, a, base.shape);
      }
      const out = this._out[h];
      out.position.copy(base.position);
      out.rotation.copy(base.rotation);
      copyShape(base.shape, out.shape);
      // the sway to the beat, on top (not smoothed: it is the rhythm), faded in and out with the singing
      if (this._sing > 0.001) this._addSway(out, side, beat, this._sing);
      if (this._walk > 0.002) this._addWalk(out, side, this._walk);
      if (prevW > 0 && (prev.side === 0 || prev.side === side)) {
        const w = prevW * this._envelope(prev.g, this._time - prev.at) * asleepFade;
        if (w > 0) this._blend(out, this._gestureTarget(prev.g, side, this._time - prev.at, i, beat, this._g), w);
      }
      if (this._gesture && (this._gestureSide === 0 || this._gestureSide === side)) {
        const t = this._time - this._gestureAt;
        const w = this._envelope(this._gesture, t) * asleepFade;
        if (w > 0) this._blend(out, this._gestureTarget(this._gesture, side, t, i, beat, this._g), w);
      }
    }
    this._first = false;
  }

  _blend(out, g, w) {
    out.position.lerp(g.position, w);
    out.rotation.slerp(g.rotation, Math.min(1, w));
    lerpShape(out.shape, g.shape, w, out.shape);
  }

  _maybeOpenPalm(i, mode) {
    if (mode !== 'singing' || !(i.noteSeconds > 0)) {
      this._noteUsed = false;
      return;
    }
    const longNote = Math.max(LONG_NOTE_SECONDS, i.beatSec > 0 ? 1.5 * i.beatSec : 0);
    if (this._noteUsed || i.noteSeconds < longNote || (i.level || 0) < 0.25 || this._gesture || this._time < this._palmReadyAt) return;
    this._noteUsed = true; // one decision per note
    this._palmCount++;
    // not every long note, and not every bot on the same note: a per-bot, per-note coin, likelier when lively
    const coin = hash01(this.index * 131 + this._palmCount * 17);
    if (coin > 0.35 + 0.45 * this._energy) return;
    this.play(GESTURE.palm);
    this._palmReadyAt = this._time + OPEN_PALM_COOLDOWN;
  }

  // ---------------------------------------------------------------- targets (x outward, mirrored per side)

  _baseTarget(mode, side, out) {
    const t = this._time;
    switch (mode) {
      case 'asleep': {
        // the head's own breathing rate: slow, deep, in step
        const b = Math.sin(t * BREATH_RATE + this._breathPhase);
        return makePose(side, [1.08, -1.08 + 0.035 * b, 0.06], [0.12, -1, 0.3], [-1, 0.05, 0.1], SHAPES.droop, out);
      }
      case 'muted': {
        const b = Math.sin(t * 1.1 + this._breathPhase);
        // folded under the chin: fingers pointing in and overlapping, one hand a little in front
        return makePose(side, [0.3, -1.48 + 0.015 * b, 0.36 + 0.05 * side], [-1, 0.18, 0.3], [0, -0.25, -1], SHAPES.folded, out);
      }
      case 'carried': {
        const f = Math.sin(t * 6.5 + this._idlePhase + side) * 0.05;
        return makePose(side, [1.04, -1.28, -0.05], [0.15 + f, -1, -0.12], [-1, 0, 0.05], SHAPES.dangle, out);
      }
      case 'singing':
        return makePose(side, [1.2, -0.5, 0.34], [-0.12, 0.5, 0.86], [-0.85, 0.15, 0.5],
          lerpShape(SHAPES.relaxed, SHAPES.open, 0.3 + 0.3 * this._level, _shapeTmp), out);
      default: {
        const b = Math.sin(t * 1.7 + this._breathPhase + 0.6 * side);
        const drift = Math.sin(t * 0.37 + this._idlePhase + side) * 0.05;
        return makePose(side, [1.22 + drift * 0.5, -0.62 + 0.05 * b, 0.22 + drift], [-0.25, 0.18 + 0.06 * b, 1], [-0.85, -0.45, 0.1], SHAPES.relaxed, out);
      }
    }
  }

  /** The sway to the beat: a side-to-side swing over two beats (both hands the same way) and a lift on each beat. */
  _addSway(p, side, beat, weight) {
    void side;
    const amp = (0.35 + 0.65 * this._energy) * (0.45 + 0.55 * this._level) * weight;
    const b = beat + this._beatLead;
    const swing = Math.sin(Math.PI * b) * this._swayDir; // one swing per two beats
    const lift = 0.5 + 0.5 * Math.cos(2 * Math.PI * b); // 1 on the beat
    p.position.x += 0.2 * amp * swing;
    p.position.y += 0.09 * amp * lift;
    p.position.z += 0.03 * amp * swing;
    p.rotation.premultiply(_gq.setFromAxisAngle(Z_AXIS, -14 * amp * swing * D2R));
    p.shape.spread += 0.12 * amp * lift;
  }

  /** Gliding: the hands swing like a walker's, in turn (a pendulum toward the viewer and back), with a little lift. */
  _addWalk(p, side, walk) {
    const th = 0.45 * walk * Math.sin(this._walkPhase) * side;
    const L = 0.6;
    p.position.z += L * Math.sin(th);
    p.position.y += L * (1 - Math.cos(th)) + 0.03 * walk * Math.abs(Math.cos(this._walkPhase));
    p.rotation.premultiply(_gq.setFromAxisAngle(X_AXIS, -th));
  }

  _envelope(g, t) {
    const d = HandGestures.durationOf(g);
    if (t < 0 || t >= d) return 0;
    const inS = g === GESTURE.clap ? 0.25 : g === GESTURE.celebrate || g === GESTURE.cheer ? 0.45 : 0.3;
    const outS = g === GESTURE.loveYou || g === GESTURE.celebrate ? 0.5 : 0.4;
    return smooth(t / inS) * smooth((d - t) / outS);
  }

  _gestureTarget(g, side, t, i, beat, out) {
    const bounce = Math.max(0, Math.sin(Math.PI * beat));
    switch (g) {
      case GESTURE.wave: {
        // hand up beside the head, palm to the viewer, rocking from the wrist
        const rock = Math.sin(t * 2 * Math.PI * 2.4) * 24;
        makePose(side, [1.32, 0.02, 0.42], [0.22, 1, 0.05], [0.1, 0, 1], SHAPES.open, out);
        out.rotation.premultiply(_gq.setFromAxisAngle(Z_AXIS, rock * D2R));
        return out;
      }
      case GESTURE.clap: {
        // palms meet in front of the face, well above the lyrics card, CLAP_RATE times a second: the palm plates touch
        // at each hit (leaned so the cuffs and thumbs clear), decelerating into it, pressed a moment, bouncing apart
        const x = clapReachHw() + 0.42 * clapOpen(t);
        makePose(side, [x, -0.42, 1.1], [-0.15, 0.75, 0.62], [-1, 0, 0], FLAT_SHAPE, out);
        palmTouch(out.rotation, side, out.rotation);
        return out;
      }
      case GESTURE.loveYou: {
        const wob = Math.sin(t * 4.2) * 0.018;
        return makePose(side, [1.18, -0.12 + wob, 0.55], [0.06, 1, 0.08], [0, 0, 1], SHAPES.loveYou, out);
      }
      case GESTURE.palm: {
        const reach = smooth(t / 0.6);
        return makePose(side, [1.26 + 0.24 * reach, -0.3 + 0.12 * reach, 0.52], [0.75, 0.42, 0.55], [0.15, 0.8, 0.55], SHAPES.open, out);
      }
      case GESTURE.celebrate:
        return makePose(side, [1.0, 1.35 + 0.12 * bounce, 0.18], [0.1, 1, 0.3], [0, 0.3, 1], SHAPES.open, out);
      case GESTURE.cheer:
        return makePose(side, [1.15, 1.35 + 0.14 * bounce, 0.22], [0.15, 1, 0.25], [0, 0.2, 1], { ...SHAPES.open, thumb: 0.4 }, out);
      case GESTURE.highFive:
        return makePose(side, [0.95, 1.5, 0.2], [0, 1, 0.1], [-1, 0, 0.15], SHAPES.open, out);
      case GESTURE.point: {
        // out to the side and forward, the index pointing out at something, a little jab on the beat
        const jab = 0.06 * Math.exp(-6 * (beat - Math.floor(beat)));
        return makePose(side, [1.25, 0.05, 0.8 + jab], [0.45, 0.25, 1], [-0.1, -1, 0.15], POINT_SHAPE, out);
      }
      case GESTURE.beckon: {
        // palm up, the fingers curling "come here"
        const c = 0.15 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.6 - Math.PI / 2));
        return makePose(side, [1.1, -0.15, 0.8], [0.1, 0.35, 1], [0, 1, 0.3],
          { ...SHAPES.open, index: c, middle: c, ring: c * 1.05, little: c * 1.1, spread: 0.2 }, out);
      }
      case GESTURE.shrug:
        return makePose(side, [1.07, 0.65, 0.3], [0.4, 0.7, 0.4], [0, 1, 0.3], lerpShape(SHAPES.relaxed, SHAPES.open, 0.6, _shapeTmp), out);
      case GESTURE.wring: {
        const wr = Math.sin(t * 9);
        return makePose(side, [0.3 + side * 0.06 * wr, -0.25, 0.8], [0.3, 0.4, 1], [-0.7, 0.3, 0.6], SHAPES.folded, out);
      }
      case GESTURE.spin: {
        const tw = t * (3 + 3 * this._energy);
        makePose(side, [0.9 + 0.2 * Math.cos(tw), 0.9 + 0.25 * Math.sin(tw), 0.35], [0, Math.cos(tw), Math.sin(tw)],
          [side * Math.sin(tw * 0.5), 0, Math.cos(tw * 0.5)], SHAPES.open, out);
        return out;
      }
      default:
        return this._baseTarget(this._mode, side, out);
    }
  }
}

/** A critically damped spring (angular frequency w), stable for any dt (Unity HandGestures.SpringTo). */
function springTo(x, v, target, w, dt) {
  if (dt <= 0) return;
  const e = Math.exp(-w * dt);
  for (const ax of ['x', 'y', 'z']) {
    const d = x[ax] - target[ax];
    const tmp = (v[ax] + w * d) * dt;
    x[ax] = target[ax] + (d + tmp) * e;
    v[ax] = (v[ax] - w * tmp) * e;
  }
}

// ------------------------------------------------------------------ HandAim

/**
 * Where a hand play wants one hand this frame (Unity HandAim): a pose in a space, the hand's shape, how much of it
 * replaces the bot's own gesture (weight, eased by the play framework).
 *   space 'bot'   position in head half-widths from the head's centre in the bot's frame (x = side +1)
 *         'head'  `head` (a robot head API) point `point` / `pointSide`, offset in that head's half-widths, its turning frame
 *         'world' world metres
 * rotation: the hand frame's (+Y fingers, +Z out of the palm) in that space. effector: which part goes to the
 * position ('wrist', 'palm', 'back', 'knuckles', 'thumbTip', 'indexTip', 'middleTip', 'pinch', 'fingertips').
 * scale: the drawn size (world metres per rig metre; 0: its own). exact: 1 drawn exactly at the aim (contact).
 */
export function handAim(fields = {}) {
  return {
    weight: 1, space: 'bot', head: null, point: 'centre', pointSide: 0,
    position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: copyShape(SHAPES.relaxed),
    effector: 'wrist', scale: 0, exact: 0, laced: false, ...fields,
  };
}

// ------------------------------------------------------------------ RobotHands

/** In a play a hand reaches at most this many head half-widths from its head (wrist to the head's centre). */
export const PLAY_REACH = 3;
/** The follow: a soft spring a little under critical damping (a carried bot's hands swing); stiffer while aimed. */
const FOLLOW_W = 13, FOLLOW_ZETA = 0.62, PLAY_FOLLOW_W = 24, PLAY_FOLLOW_ZETA = 1;
/** A lagging hand never trails further than this from its place (head half-widths). */
const MAX_LAG = 2.2;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _ws = new THREE.Vector3();

export class RobotHands {
  constructor(index) {
    this.index = index;
    this.energy = 0.5;
    this.gestures = new HandGestures(index, this.energy);
    this.material = createHeadMaterial();
    this.material.name = 'magna-hands';
    this.mesh = new THREE.Mesh(handGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.bonesArr = this.material.uniforms.uBones.value;
    this.parent = null;
    this._bones = Array.from({ length: 32 }, () => new THREE.Matrix4());
    this._rot = Array.from({ length: 16 }, () => new THREE.Quaternion());
    this._wrist = new THREE.Matrix4();
    this._scl = new THREE.Vector3();
    this._pos = [new THREE.Vector3(), new THREE.Vector3()];
    this._vel = [new THREE.Vector3(), new THREE.Vector3()];
    this._want = [new THREE.Vector3(), new THREE.Vector3()];
    this._wristRot = [new THREE.Quaternion(), new THREE.Quaternion()];
    this._drawn = [
      { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: copyShape(SHAPES.relaxed), scale: 1 },
      { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: copyShape(SHAPES.relaxed), scale: 1 },
    ];
    this._snap = true;
    this._input = { dt: 0, asleep: 0, muted: false, singing: false, level: 0, grabbed: false, beat: 0, beatSec: 0, noteSeconds: 0, walk: 0 };
    this._aimPos = new THREE.Vector3();
    this._aimRot = new THREE.Quaternion();
    this._wantPos = new THREE.Vector3();
    this._wantRot = new THREE.Quaternion();
    this._parentQInv = new THREE.Quaternion();
    this._handScale = 1;
    this._unit = 1;
  }

  attach(parent) {
    this.parent = parent;
    parent.add(this.mesh);
    parent.updateWorldMatrix(true, false);
  }

  setLook(look) {
    this._look = look;
    const u = this.material.uniforms;
    const d = drawnLook(look); // the colours drawn (head-style.js: the friendly look's, else the look's own)
    applyFinish(d.faceColor, d.finish, u.uPaint.value, u.uFinish.value);
    u.uAccent.value.set(trimColor(d.faceColor, d.accentColor));
    u.uEye.value.set(d.eyeColor);
  }

  /** Calm .. lively (Unity HandGestures.EnergyOf: singing gain x bob). */
  setPersonality(id) {
    const st = PERSONALITY_STYLES[normalizePersonality(id)];
    const e = st ? (st.sing.gain * st.sing.bob - 0.1) / 1.5 : 0.5;
    this.energy = Math.min(1, Math.max(0, e));
    this.gestures.energy = this.energy;
  }

  /** A one-shot gesture (GESTURE names: wave, palm, clap, loveYou, celebrate, cheer, point, spin, shrug, beckon, wring, highFive). */
  play(g) {
    return this.gestures.play(g);
  }

  /** The gesture playing (0: none). */
  get playing() {
    return this.gestures.playing;
  }

  /** Drawn wrist (parent space). */
  wristPos(side, out = new THREE.Vector3()) {
    return out.copy(this._drawn[side < 0 ? 0 : 1].position);
  }

  /** The pose the hand on `side` was drawn at (parent space): { position, rotation, shape, scale }. */
  drawn(side) {
    return this._drawn[side < 0 ? 0 : 1];
  }

  /** The drawn hand in the world: { position, rotation, shape, scale } (scale in world metres per rig metre). */
  drawnWorld(side, out = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: null, scale: 1 }) {
    const d = this.drawn(side);
    out.shape = d.shape;
    if (!this.parent) {
      out.position.copy(d.position);
      out.rotation.copy(d.rotation);
      out.scale = d.scale;
      return out;
    }
    this.parent.updateWorldMatrix(true, false);
    out.position.copy(d.position).applyMatrix4(this.parent.matrixWorld);
    out.rotation.copy(this.parent.getWorldQuaternion(_q1)).multiply(d.rotation);
    out.scale = d.scale * this.parent.getWorldScale(_ws).x;
    return out;
  }

  /**
   * An aim's wrist pose in the parent's space now (the head it is on as it is now, the effector taken off), within
   * PLAY_REACH of the head. False when it cannot be resolved.
   */
  _resolve(aim, side, centre, unit, pos, rot) {
    if (aim.space === 'bot') {
      rot.copy(aim.rotation);
      pos.copy(aim.position).multiplyScalar(unit).add(centre);
    } else if (aim.space === 'head') {
      const head = aim.head;
      if (!head?.mesh) return false;
      head.mesh.updateWorldMatrix(true, false);
      const hw = head.mech?.halfWidth ?? 0.12;
      pointLocal(head, aim.point, aim.pointSide, pos).add(aim.position).multiplyScalar(hw).applyMatrix4(head.mesh.matrixWorld);
      this._toParent(pos);
      rot.copy(this._parentQInv).multiply(head.mesh.getWorldQuaternion(_q2)).multiply(aim.rotation);
    } else {
      pos.copy(aim.position);
      this._toParent(pos);
      rot.copy(this._parentQInv).multiply(aim.rotation);
    }
    if (aim.effector && aim.effector !== 'wrist') {
      pos.sub(effectorLocal(aim.effector, aim.shape, side, _v1).multiplyScalar(this._handScale).applyQuaternion(rot));
    }
    // reach: never further than PLAY_REACH half-widths from the head
    _v2.copy(pos).sub(centre);
    const max = PLAY_REACH * unit;
    if (_v2.lengthSq() > max * max) pos.copy(centre).addScaledVector(_v2.normalize(), max);
    return true;
  }

  _toParent(v) {
    if (this.parent) this.parent.worldToLocal(v);
    return v;
  }

  /**
   * o: { centre (the head's centre, parent space), unit (head half-width, parent units), dt, singing, level, muted,
   *      asleep (0..1), grab, beat, beatSec (0: no song clock), noteSeconds, walk (0..1), aimL, aimR (handAim | null) }
   */
  update(o) {
    const dt = Math.min(0.1, Math.max(0, o.dt || 0));
    const inp = this._input;
    inp.dt = dt;
    inp.asleep = +o.asleep || 0;
    inp.muted = !!o.muted;
    inp.singing = !!o.singing;
    inp.level = o.level ?? 0;
    inp.grabbed = !!o.grab;
    inp.beat = o.beat ?? 0;
    inp.beatSec = o.beatSec ?? 0;
    inp.noteSeconds = o.noteSeconds ?? 0;
    inp.walk = o.walk ?? 0;
    this.gestures.step(inp);
    const unit = o.unit, centre = o.centre;
    this._unit = unit;
    this._handScale = (SIZE_OF_HEAD * 2 * unit) / HAND_LENGTH;
    const parentScale = this.parent ? this.parent.getWorldScale(_ws).x || 1 : 1;
    if (this.parent) {
      this.parent.updateWorldMatrix(true, false);
      this.parent.getWorldQuaternion(this._parentQInv).invert();
    }
    for (let h = 0; h < 2; h++) {
      const side = h === 0 ? -1 : 1;
      const g = this.gestures.hand(side);
      const want = this._wantPos.copy(g.position).multiplyScalar(unit).add(centre);
      const wantRot = this._wantRot.copy(g.rotation);
      const d = this._drawn[h];
      copyShape(g.shape, d.shape);
      let scale = this._handScale;
      const aim = side < 0 ? o.aimL : o.aimR;
      let w = aim ? Math.min(1, Math.max(0, aim.weight)) : 0;
      if (w > 0 && this._resolve(aim, side, centre, unit, this._aimPos, this._aimRot)) {
        want.lerp(this._aimPos, w);
        wantRot.slerp(this._aimRot, w);
        lerpShape(d.shape, aim.shape, w, d.shape);
        if (aim.scale > 0) scale += (aim.scale / parentScale - scale) * w;
      } else w = 0;
      const pos = this._pos[h], vel = this._vel[h], rot = this._wristRot[h];
      if (this._snap) {
        pos.copy(want);
        vel.set(0, 0, 0);
        rot.copy(wantRot);
      } else {
        follow(pos, vel, want, dt, FOLLOW_W + (PLAY_FOLLOW_W - FOLLOW_W) * w, FOLLOW_ZETA + (PLAY_FOLLOW_ZETA - FOLLOW_ZETA) * w);
        const max = MAX_LAG * unit;
        if (pos.distanceToSquared(want) > max * max) pos.sub(want).setLength(max).add(want);
        rot.slerp(wantRot, 1 - Math.exp(-(14 + 8 * w) * dt));
        // a contact moment (a clap, a pat, a slap): no lag, the hand is where it must touch
        const exact = Math.min(1, Math.max(0, this.gestures.exact + ((aim?.exact ?? 0) - this.gestures.exact) * w));
        if (exact > 0) {
          pos.lerp(want, exact);
          if (dt > 1e-5) vel.lerp(_v2.copy(want).sub(this._want[h]).divideScalar(dt), exact);
          rot.slerp(wantRot, exact);
        }
      }
      this._want[h].copy(want);
      d.position.copy(pos);
      d.rotation.copy(rot);
      d.scale = scale;
      this._scl.setScalar(scale);
      this._wrist.compose(pos, rot, this._scl);
      handRotations(d.shape, side, this._rot);
      handPose(this._wrist, side, this._rot, this._bones, side < 0 ? 0 : 16);
    }
    this._snap = false;
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

/** Semi-implicit spring toward `target` (angular frequency w, damping ratio zeta; sub-stepped: stable at any frame rate). */
function follow(x, v, target, dt, w, zeta) {
  const n = Math.min(12, Math.max(1, Math.ceil(dt / 0.008)));
  const h = dt / n, k = w * w, c = 2 * zeta * w;
  for (let i = 0; i < n; i++) {
    v.x += (-k * (x.x - target.x) - c * v.x) * h;
    v.y += (-k * (x.y - target.y) - c * v.y) * h;
    v.z += (-k * (x.z - target.z) - c * v.z) * h;
    x.addScaledVector(v, h);
  }
}
