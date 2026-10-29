// What a hand play works with while it runs: port of Unity Scripts/App/HandPlays/HandStage.cs (+ the head moves of
// ChoirSocial). Its cast (Bots of rig.js), time and the song's beat, the bots' frames and head points, their hands
// (hand(), lace()), their heads' moves on springs (go / lean / home / jolt), their faces (face(), act, react, look),
// the log (note) and seeded randomness. The framework eases every hand in over the play's blendIn and out over its
// blendOut, clears the hands and the face's wishes every frame before the play's step (a play states what it wants
// each frame), and once the play is over or called off fades the last aims out and hands every bot back.
//
// A play (plays/*.js) is { id, cast: 'solo'|'duo'|'group', minCast?, maxCast?, blendIn?, blendOut?, maxSeconds?,
// handOf?(member) 'right'|'left'|'inner'|'outer'|'either', pair? 'same'|'opposite'|'any', leftPairs?,
// tryCast?(s), begin?(s), step(s), end?(s, calledOff) }.
//
// Units: bot frames and head points in head half-widths (unit(k) world metres), the world in metres. Sides: the
// hands' (scene/hand-rig.js: +1 the bot's +x side; RIGHT / LEFT the anatomical hands).
import * as THREE from 'three';
import { HAND_LENGTH, LEFT, RIGHT, SIZE_OF_HEAD, lookRotation, orientation, smooth, smoother } from '../scene/hand-rig.js';
import { handAim } from '../scene/hands.js';
import { laceSize, laceSolve } from '../scene/hand-touch.js';
import { pointLocal } from '../scene/head-points.js';
import { makeRng } from '../scene/motion.js';
import { FacePlay, profileOf } from './face.js';

/** The play's own beat when no song plays (s per beat: 96 BPM). */
export const OWN_BEAT_SEC = 0.625;
/** A call-off fades the hands out over this long (s). */
export const CALL_OFF_SECONDS = 0.25;
/** A point is on one side of a bot once its bearing is at least this far off straight ahead or behind (a sine). */
export const SIDE_CLEAR = 0.3;
/** Hands that held each other let go over this long (s). */
export const LET_GO_SECONDS = 0.8;
/** A head travels at most this many of its radii off its place (Unity ChoirSocial.MaxTravel), unless a play needs more. */
export const MAX_TRAVEL = 1.5;
const MAX_LEAN = 0.5;

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export const Smooth = smooth, Smoother = smoother;
/** A hold's weight as it lets go, `t` s after it began: 1 -> 0 with an ease-out. */
export const letGo = (t, seconds = LET_GO_SECONDS) => {
  const u = 1 - Math.min(1, Math.max(0, t / Math.max(1e-4, seconds)));
  return u * u;
};
/** 0 -> 1 over [a, b] (smoothstep). */
export const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-5, b - a));

// ------------------------------------------------------------------ per bot: the play's hold on it

/**
 * Everything the plays hold of one bot: its aims (read by Bot.update), its face wishes, the play's move of its head (a
 * spring off its place: rig.js applies `bot.playOffset`), where it looks. One per bot, made on first use.
 */
export class PlayBot {
  constructor(bot) {
    this.bot = bot;
    this.stage = null; // the stage whose hands these are
    this.face = new FacePlay(bot);
    this.x = new THREE.Vector3(); // the head's offset off its place (world)
    this.v = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.omega = 6;
    this.zeta = 0.85;
    this.cap = Infinity;
    this.lean = new THREE.Vector3(); // radians toward a level direction (world)
    this.leanV = new THREE.Vector3();
    this.leanGoal = new THREE.Vector3();
    this.leanOmega = 6;
    this.moving = false;
    this.lookAt = null; // { other: Bot | null, world: Vector3, until }
    this._lookPt = new THREE.Vector3();
  }

  /** One frame of the head's move and look, then the face: false once there is nothing left to do. */
  step(dt) {
    if (this.moving) {
      const n = Math.min(12, Math.max(1, Math.ceil(dt / (1 / 90))));
      const h = dt / n, k = this.omega * this.omega, c = 2 * this.zeta * this.omega;
      for (let i = 0; i < n; i++) {
        this.v.x += (-k * (this.x.x - this.goal.x) - c * this.v.x) * h;
        this.v.y += (-k * (this.x.y - this.goal.y) - c * this.v.y) * h;
        this.v.z += (-k * (this.x.z - this.goal.z) - c * this.v.z) * h;
        this.x.addScaledVector(this.v, h);
      }
      const m = this.x.length();
      if (m > this.cap) {
        this.x.multiplyScalar(this.cap / m);
        const out = this.v.dot(_v.copy(this.x).normalize());
        if (out > 0) this.v.addScaledVector(_v, -out);
      }
      // the lean: a critically damped spring
      const lw = this.leanOmega, e = Math.exp(-lw * dt);
      for (const ax of ['x', 'z']) {
        const d = this.lean[ax] - this.leanGoal[ax];
        const tmp = (this.leanV[ax] + lw * d) * dt;
        this.lean[ax] = this.leanGoal[ax] + (d + tmp) * e;
        this.leanV[ax] = (this.leanV[ax] - lw * tmp) * e;
      }
      const settled = this.goal.lengthSq() === 0 && this.leanGoal.lengthSq() === 0 && this.x.lengthSq() < 1e-8 && this.v.lengthSq() < 1e-8
        && this.lean.lengthSq() < 4e-6 && this.leanV.lengthSq() < 4e-4;
      if (settled && !this.stage) {
        this.moving = false;
        this.x.set(0, 0, 0);
        this.v.set(0, 0, 0);
        this.lean.set(0, 0, 0);
        this.leanV.set(0, 0, 0);
      }
    }
    this._apply();
    if (this.lookAt) this._look(dt);
    const faceBusy = this.face.step(dt);
    return this.moving || faceBusy || !!this.stage || !!this.lookAt;
  }

  _apply() {
    const bot = this.bot;
    const g = bot.group;
    // the move: the head's offset in the bot's own (scaled) frame
    if (!bot.playOffset) bot.playOffset = new THREE.Vector3();
    g.updateWorldMatrix(true, false);
    const s = g.getWorldScale(_w).x || 1;
    bot.playOffset.copy(this.x).applyQuaternion(g.getWorldQuaternion(_q).invert()).divideScalar(s);
    // the lean, as the head's roll (toward its +x) and pitch (toward its face): in the bot's frame
    _v.copy(this.lean).applyQuaternion(_q);
    this.face.lean.roll = -_v.x;
    this.face.lean.pitch = -_v.z;
  }

  _look(dt) {
    const L = this.lookAt;
    const head = this.bot.head;
    if (!head?.glanceTo) {
      this.lookAt = null;
      return;
    }
    if (L.other) L.other.head.mesh.getWorldPosition(L.world);
    // the glance point in the head group's parent space (the bot's group), kept by reference by the head
    this._lookPt.copy(L.world);
    this.bot.group.worldToLocal(this._lookPt);
    if (!L.started) {
      head.glanceTo(this._lookPt, L.seconds);
      L.started = true;
    }
    L.left -= dt;
    if (L.left <= 0) this.lookAt = null;
  }

  /** Look at a bot (its head, as it moves) or a world point for `seconds`. */
  look(other, world, seconds) {
    this.lookAt = { other, world: world ? world.clone() : new THREE.Vector3(), seconds, left: seconds, started: false };
  }
}

// ------------------------------------------------------------------ the stage

export class Stage {
  /**
   * def: the play; cast: Bots (member 0 started it); ctx: { time, beatSec, playing, bots, viewer }; seed: the run's dice;
   * hold: (bot) => PlayBot.
   */
  constructor(def, cast, ctx, seed, hold) {
    this.def = def;
    this.cast = cast.slice(0, 5);
    this.hold = hold;
    this.rng = makeRng(seed >>> 0);
    this.ctx = ctx;
    this.notes = [];
    this.forced = true;
    this.clearScratch();
    this.active = false;
    this.running = false;
    this.ending = false;
    this.calledOff = false;
    this.faded = false;
    this.now = 0;
    this.start = 0;
    this.phaseAt = 0;
    this.endAt = 0;
    this.blendOutS = 0.4;
    this.dt = 0;
    this._beat = 0;
    this._beatSec = OWN_BEAT_SEC;
    this._clocked = false;
    this._out = this.cast.map(() => ({ left: null, right: null }));
    this._last = this.cast.map(() => ({ left: null, right: null }));
    this._react = this.cast.map(() => ({ at: -1, acts: null, step: '', to: -1, look: 0 }));
    this.readBeat(0);
  }

  clearScratch() {
    this.phase = 0;
    this.round = 0;
    this.mark = 0;
    this.value = 0;
    this.point = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.I = [0, 0, 0, 0, 0];
    this.F = [0, 0, 0, 0, 0];
    this.V = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
    this.B = [false, false, false, false, false];
    this.side = [1, 1, 1, 1, 1];
  }

  // ---------------------------------------------------------------- the run

  get count() { return this.cast.length; }
  get id() { return this.def.id; }

  /** The cast checks (the play's tryCast; duo plays fit their hands by the hand rule). */
  tryCast() {
    const d = this.def;
    const min = d.minCast ?? (d.cast === 'solo' ? 1 : d.cast === 'duo' ? 2 : 3);
    const max = d.maxCast ?? (d.cast === 'solo' ? 1 : d.cast === 'duo' ? 2 : 5);
    if (this.count < min) return false;
    if (this.count > max) this.cast.length = max;
    if (d.cast === 'solo') return true;
    if (d.tryCast) return !!d.tryCast(this);
    if (d.cast === 'duo') return this.fitHands();
    return true;
  }

  begin() {
    this.active = this.running = true;
    this.ending = this.calledOff = this.faded = false;
    this.start = this.now = this.phaseAt = 0;
    this.phase = 0;
    this._out = this.cast.map(() => ({ left: null, right: null }));
    this._last = this.cast.map(() => ({ left: null, right: null }));
    this._react = this.cast.map(() => ({ at: -1, acts: null, step: '', to: -1, look: 0 }));
    const d = this.def;
    // a duo's hand rule as cast: the hands that meet (a same-handed pair: both left now and then)
    if (d.cast === 'duo' && this.count === 2) {
      if (d.pair === 'same' && (d.leftPairs ?? 0) > 0 && this.side[0] === this.side[1] && this.chance(d.leftPairs)) this.side[0] = this.side[1] = -this.side[0];
      for (let k = 0; k < 2; k++) if ((d.pair ?? 'any') !== 'any' || (d.handOf?.(k) ?? 'either') !== 'either') this.noteHand(k, this.side[k], 1 - k);
    }
    d.begin?.(this);
  }

  /** One frame (dt s): the play steps, reactions fire, the hands are eased and handed to the bots. False once faded. */
  update(dt, ctx) {
    if (!this.active) return false;
    if (ctx) this.ctx = ctx;
    this.dt = Math.min(0.1, Math.max(0, dt));
    this.now += this.dt;
    this.readBeat(this.dt);
    if (this.now - this.start > (this.def.maxSeconds ?? 16) && !this.ending) this.beginEnding(true);
    for (let k = 0; k < this.count; k++) {
      this._out[k].left = this._out[k].right = null;
      const hb = this.hold(this.cast[k]);
      if (hb.stage === this) hb.face.clear();
    }
    if (this.running && !this.ending) {
      this.def.step(this);
      if (!this.ending) for (let k = 0; k < this.count; k++) Object.assign(this._last[k], this._out[k]);
    }
    if (this.ending) for (let k = 0; k < this.count; k++) Object.assign(this._out[k], this._last[k]);
    this.fireReactions();
    let env = smooth((this.now - this.start) / Math.max(0.01, this.def.blendIn ?? 0.35));
    if (this.ending) {
      const u = (this.now - this.endAt) / Math.max(0.01, this.blendOutS);
      env *= 1 - smooth(u);
      if (u >= 1) this.faded = true;
    }
    for (let k = 0; k < this.count; k++) {
      const hb = this.hold(this.cast[k]);
      if (hb.stage !== this) continue;
      const o = this._out[k];
      const bot = this.cast[k];
      bot.aims.left = o.left ? { ...o.left, weight: Math.min(1, Math.max(0, o.left.weight)) * env } : null;
      bot.aims.right = o.right ? { ...o.right, weight: Math.min(1, Math.max(0, o.right.weight)) * env } : null;
    }
    if (this.faded) this.finish();
    return !this.faded;
  }

  readBeat(dt) {
    const c = this.ctx;
    if (c && c.playing !== false && c.beatSec > 0 && Number.isFinite(c.time)) {
      this._beat = c.time / c.beatSec;
      this._beatSec = c.beatSec;
      this._clocked = true;
    } else {
      this._beat += dt / Math.max(0.1, this._beatSec);
      this._clocked = false;
    }
  }

  beginEnding(calledOff) {
    if (this.ending) return;
    this.ending = true;
    this.calledOff = calledOff;
    this.endAt = this.now;
    this.blendOutS = calledOff ? CALL_OFF_SECONDS : this.def.blendOut ?? 0.4;
    if (calledOff) for (const r of this._react) r.at = -1;
    this.def.end?.(this, calledOff);
    for (let k = 0; k < this.count; k++) if (this.hold(this.cast[k]).stage === this) this.home(k);
  }

  /** The stage ends it: over (the last aims fade out) or called off (fast fade, no more reactions). */
  endByChoir(calledOff) {
    if (!this.active || this.ending) return;
    this.beginEnding(calledOff);
  }

  /** Everything handed back: every member's hands and face are the bot's own again. */
  finish() {
    if (!this.active) return;
    for (let k = 0; k < this.count; k++) {
      const hb = this.hold(this.cast[k]);
      if (hb.stage !== this) continue;
      this.cast[k].aims.left = this.cast[k].aims.right = null;
      hb.face.clear();
      hb.stage = null;
      this.home(k);
    }
    this.active = this.running = this.ending = false;
  }

  /** Member k is taken by another play: its hands stop here (at once), the rest plays on. */
  release(k) {
    if (k < 0) return;
    const hb = this.hold(this.cast[k]);
    if (hb.stage === this) hb.stage = null;
  }

  // ---------------------------------------------------------------- the cast

  bot(k) { return this.cast[k]; }
  memberOf(bot) { return this.cast.indexOf(bot); }
  personality(k) { return this.cast[k]?.cast?.personality ?? 'cheerful'; }
  profile(k) { return profileOf(this.personality(k)); }
  starter() { return this.cast[0]; }

  swapMembers(i, j) {
    if (i === j || i < 0 || j < 0 || i >= this.count || j >= this.count) return;
    const sw = (a) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
    sw(this.cast); sw(this.I); sw(this.F); sw(this.V); sw(this.B); sw(this.side);
  }

  /** The hand of member k on the side of a world point: +1 / -1, 0 when it is nearly straight ahead or behind. */
  handToward(k, world) {
    const d = _v.copy(world).sub(this.place(k, _w));
    d.y = 0;
    const m = d.length();
    if (m < 1e-6) return 0;
    const x = d.dot(this.rightOf(k, _w)) / m;
    return x >= SIDE_CLEAR ? 1 : x <= -SIDE_CLEAR ? -1 : 0;
  }

  /** As handToward, but never 0: a partner straight ahead or behind is on the side it leans to. */
  handTowardLoose(k, world) {
    const h = this.handToward(k, world);
    if (h) return h;
    const d = _v.copy(world).sub(this.place(k, _w));
    return d.dot(this.rightOf(k, _w)) >= 0 ? 1 : -1;
  }

  /**
   * Duo casting (Unity HandStage.FitHands): the members' hands by the play's hand rule from their places. A rule
   * naming a hand may swap the members so that the named hand is the inner one. The stage's cast is given, so a pair
   * not clearly side by side still plays (the hands by which side the partner leans to).
   */
  fitHands() {
    const d = this.def;
    if (this.count !== 2) return true;
    const named = d.handOf?.(0) === 'left' || d.handOf?.(0) === 'right' || d.handOf?.(1) === 'left' || d.handOf?.(1) === 'right';
    for (const loose of [false, true]) {
      if (this.trySides(loose)) return true;
      if (!named) continue;
      this.swapMembers(0, 1);
      if (this.trySides(loose)) return true;
      this.swapMembers(0, 1);
    }
    return false;
  }

  trySides(loose) {
    const d = this.def;
    const tw = loose ? this.handTowardLoose.bind(this) : this.handToward.bind(this);
    const i0 = tw(0, this.place(1, new THREE.Vector3())), i1 = tw(1, this.place(0, new THREE.Vector3()));
    if (i0 === 0 || i1 === 0) return false;
    if (d.pair === 'same') {
      this.side[0] = this.side[1] = d.handOf?.(0) === 'left' ? LEFT : RIGHT;
      return true;
    }
    const pick = (rule, inner) => rule === 'left' ? (inner === LEFT ? LEFT : 0) : rule === 'right' ? (inner === RIGHT ? RIGHT : 0)
      : rule === 'outer' ? -inner : inner;
    const s0 = pick(d.handOf?.(0) ?? 'inner', i0), s1 = pick(d.handOf?.(1) ?? 'inner', i1);
    if (s0 === 0 || s1 === 0 || (d.pair === 'opposite' && s0 === s1)) return false;
    this.side[0] = s0;
    this.side[1] = s1;
    return true;
  }

  noteHand(k, side, other = -1) { this.note(side === RIGHT ? 'right hand' : 'left hand', k, other); }

  // ---------------------------------------------------------------- the moment

  /** The stage's other bots within `reachRadii` of member k's head radius, nearest first (Unity Gather). */
  neighbours(k, reachRadii = 4.5) {
    const all = this.ctx?.bots ? [...(this.ctx.bots.values?.() ?? this.ctx.bots)] : this.cast;
    const me = this.cast[k], at = this.place(k, new THREE.Vector3()), r = this.radius(k) * reachRadii;
    return all.filter((b) => b !== me).map((b) => ({ b, d: b.head.mesh.getWorldPosition(_w).distanceTo(at) }))
      .filter((x) => x.d <= r).sort((x, y) => x.d - y.d).map((x) => x.b);
  }

  /** A song's beat clock runs (else the play keeps its own). */
  songOn() { return this._clocked; }
  /** Robot `bot` sings now. */
  singsNow(bot) { return (bot?.singing ?? 0) > 0; }
  sleeping() { return false; }

  // ---------------------------------------------------------------- time and the beat

  get t() { return this.now - this.start; }
  get phaseT() { return this.now - this.phaseAt; }
  next(phase) {
    this.phase = phase;
    this.phaseAt = this.now;
  }
  get beat() { return this._beat; }
  get beatSec() { return this._beatSec; }
  get clocked() { return this._clocked; }
  /** The first whole beat at or after `beat` (plus `ahead` beats of lead-in). */
  nextBeat(beat, ahead = 0) { return Math.ceil(beat + ahead - 1e-4); }

  // ---------------------------------------------------------------- where things are (world)

  /** Member k's head now (its centre, world: its place plus where a play moved it). */
  head(k, out = new THREE.Vector3()) { return this.cast[k].head.mesh.getWorldPosition(out); }
  /** Member k's place (its head's centre without a play's move). */
  place(k, out = new THREE.Vector3()) { return this.head(k, out).sub(this.hold(this.cast[k]).x); }
  /** Member k's head half-width (world metres). */
  unit(k) {
    const b = this.cast[k];
    return b.unit * (b.group.getWorldScale(_w).x || 1);
  }
  /** Member k's head radius (world metres). */
  radius(k) {
    const b = this.cast[k];
    const r = (b.head.mech?.radius ?? 0.14) * (b.head.appearance?.scale ?? 1);
    return r * (b.group.getWorldScale(_w).x || 1);
  }
  /** Member k's frame (world): x its +x side, y up, z toward the viewer. */
  facing(k, out = new THREE.Quaternion()) { return this.cast[k].group.getWorldQuaternion(out); }
  rightOf(k, out = new THREE.Vector3()) { return out.copy(X).applyQuaternion(this.facing(k, _q)); }
  frontOf(k, out = new THREE.Vector3()) { return out.copy(Z).applyQuaternion(this.facing(k, _q)); }
  /** The viewer's head (world). */
  get viewer() { return this.ctx?.viewer ?? this.cast[0].viewer ?? new THREE.Vector3(0, 1.6, 7); }
  /**
   * Unity's "viewer's right" (level), seen from the cast's middle, mirrored like everything else here: the true
   * viewer's LEFT. Unity rows run from its viewer's left and their sways tilt heads by bot-frame sides; in this mirror
   * image of Unity's stage the same numbers need the mirrored direction (rows then run from the viewer's right).
   */
  get viewerRight() {
    const mid = new THREE.Vector3();
    for (let k = 0; k < this.count; k++) mid.add(this.head(k, _w));
    mid.divideScalar(Math.max(1, this.count));
    const to = _v.copy(this.viewer).sub(mid);
    to.y = 0;
    if (to.lengthSq() < 1e-8) return new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3().crossVectors(to.normalize(), UP).normalize();
  }
  /** World metres per metre of the hand rig. */
  handScale(k) { return (SIZE_OF_HEAD * 2 * this.unit(k)) / HAND_LENGTH; }
  botToWorld(k, local, out = new THREE.Vector3()) {
    return out.copy(local).multiplyScalar(this.unit(k)).applyQuaternion(this.facing(k, _q)).add(this.head(k, _w));
  }
  worldToBot(k, world, out = new THREE.Vector3()) {
    return out.copy(world).sub(this.head(k, _w)).applyQuaternion(this.facing(k, _q).invert()).divideScalar(Math.max(1e-6, this.unit(k)));
  }
  /** Point `name` (with `side`) of member k's head in its head frame (half-widths). */
  pointLocal(k, name, side = 0, out = new THREE.Vector3()) { return pointLocal(this.cast[k].head, name, side, out); }
  /** About where point `name` of member k's head is in the world (its frame, not its look-at turn). */
  pointWorld(k, name, side = 0, out = new THREE.Vector3()) { return this.botToWorld(k, this.pointLocal(k, name, side, out), out); }
  /** Member k's hand nearer a world point: +1 / -1. */
  sideToward(k, world) { return _v.copy(world).sub(this.head(k, _w)).dot(this.rightOf(k, _w)) >= 0 ? 1 : -1; }

  // ---------------------------------------------------------------- hands

  /** Member k's hand on `side` goes to `aim` this frame (its weight is eased in / out by the framework). */
  hand(k, side, aim) {
    const o = this._out[k];
    if (!o) return;
    if (side < 0) o.left = aim;
    else o.right = aim;
  }

  /** Member a's hand on sideA and member b's on sideB laced at `clasp` (world): both at one size, drawn exactly. */
  lace(a, sideA, b, sideB, clasp, weight = 1) {
    const size = laceSize(this.handScale(a), this.handScale(b));
    const [pa, pb] = laceSolve(sideA, sideB, size, clasp);
    this.hand(a, sideA, aimFromPose(pa, weight, { scale: size, exact: 1, laced: true }));
    this.hand(b, sideB, aimFromPose(pb, weight, { scale: size, exact: 1, laced: true }));
  }

  // ---------------------------------------------------------------- heads (springs; capped)

  /** Member k's head heads for `offset` (world, off its place) on a spring: `omega` 1/s, `zeta` 1 no overshoot. */
  go(k, offset, omega, zeta = 1) {
    const hb = this.hold(this.cast[k]);
    hb.goal.copy(offset);
    const cap = Math.max(MAX_TRAVEL * this.radius(k), hb.cap === Infinity ? 0 : hb.cap);
    if (hb.goal.length() > cap) hb.goal.setLength(cap);
    hb.omega = omega;
    hb.zeta = zeta;
    hb.moving = true;
  }
  /** Lets member k's head travel as far as `metres` off its place this play (a duo that must come together). */
  allowTravel(k, metres) {
    const hb = this.hold(this.cast[k]);
    hb.cap = Math.max(MAX_TRAVEL * this.radius(k), metres * 1.05);
  }
  /**
   * Keeps the cast's drifted heads apart (V[k]: offsets off their places): pairs closer than `apart` x their summed radii
   * are pushed apart (level) a few rounds (Unity ChoirSocial keeps heads from passing through each other while they move).
   */
  separate(apart = 1.08, rounds = 8) {
    const n = this.count, p = [];
    for (let k = 0; k < n; k++) p.push(this.place(k));
    for (let r = 0; r < rounds; r++) {
      let moved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = _v.copy(p[i]).add(this.V[i]).sub(p[j]).sub(this.V[j]);
        d.y = 0;
        const m = d.length(), min = apart * (this.radius(i) + this.radius(j));
        if (m >= min) continue;
        if (m < 1e-6) d.copy(p[i]).sub(p[j]).setY(0);
        d.normalize().multiplyScalar(0.5 * (min - m));
        this.V[i].add(d);
        this.V[j].sub(d);
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Member k's head leans `angle` rad toward `toward` (levelled). */
  lean(k, toward, angle, omega) {
    const d = _v.copy(toward);
    d.y = 0;
    const m = d.length();
    this.leanBy(k, m > 1e-6 ? d.multiplyScalar(angle / m) : d.set(0, 0, 0), omega);
  }
  /** Member k's head leans by `lean` (rad toward its direction, levelled, capped). */
  leanBy(k, lean, omega) {
    const hb = this.hold(this.cast[k]);
    hb.leanGoal.copy(lean);
    hb.leanGoal.y = 0;
    const a = hb.leanGoal.length();
    if (a > MAX_LEAN) hb.leanGoal.multiplyScalar(MAX_LEAN / a);
    hb.leanOmega = omega;
    hb.moving = true;
  }
  /** Member k's head goes back to its place and upright. */
  home(k, omega = 6, zeta = 0.85) {
    const hb = this.hold(this.cast[k]);
    hb.goal.set(0, 0, 0);
    hb.leanGoal.set(0, 0, 0);
    hb.cap = Infinity;
    if (!hb.moving) return;
    hb.omega = omega;
    hb.zeta = zeta;
    hb.leanOmega = Math.max(6, omega);
  }
  /** Member k's head wobbles as if pushed (world m/s, x its personality's move). */
  jolt(k, velocity) {
    const hb = this.hold(this.cast[k]);
    hb.v.addScaledVector(velocity, this.profile(k).move);
    hb.moving = true;
  }

  // ---------------------------------------------------------------- faces

  /** Member k's face this frame (plays/face.js FacePlay). */
  face(k) { return this.hold(this.cast[k]).face; }
  /** Member k looks at member `other` for `seconds`. */
  look(k, other, seconds) {
    if (other >= 0 && other < this.count) this.hold(this.cast[k]).look(this.cast[other], null, seconds);
  }
  /** Member k looks at a world point for `seconds`. */
  lookAt(k, world, seconds) { this.hold(this.cast[k]).look(null, world, seconds); }
  /** Member k plays one of `acts` now, noted as `step`; returns the act. */
  act(k, acts, step, other = -1) {
    const name = Array.isArray(acts) ? this.pick(acts) : acts;
    this.face(k).act(name);
    this.note(step, k, other, name);
    return name;
  }
  /** Later (`delay` s): member k looks at member `lookAt` for `look` s and plays one of `acts`, noted as `step`. */
  react(k, delay, acts, step, lookAt = -1, look = 0) {
    if (k < 0 || k >= this.count) return;
    const r = this._react[k];
    const at = this.now + Math.max(0, delay);
    if (r.at >= 0 && r.at <= at) return;
    Object.assign(r, { at, acts, step, to: lookAt, look });
  }
  fireReactions() {
    for (let k = 0; k < this.count; k++) {
      const r = this._react[k];
      if (r.at < 0 || this.now < r.at) continue;
      r.at = -1;
      if (r.to >= 0 && r.to < this.count && r.look > 0) this.look(k, r.to, r.look);
      this.act(k, r.acts, r.step, r.to);
    }
  }
  /** A little pop of sparkles (a particle preset) at a world point: noted (the JS heads emit only while they sing). */
  sparkle(k, world, preset) { this.note(`sparkle ${preset}`, k); }

  // ---------------------------------------------------------------- the log and the dice

  /** Logs a step of the play: { t, step, who, other, act } (bot names). */
  note(step, k, other = -1, act = null) {
    this.notes.push({ t: +this.t.toFixed(3), step, who: this.cast[k]?.name ?? null, other: other >= 0 ? this.cast[other]?.name ?? null : null, act });
  }
  rand() { return this.rng(); }
  pick(n) {
    if (Array.isArray(n)) return n.length ? n[this.pick(n.length)] : null;
    return n <= 1 ? 0 : Math.min(n - 1, Math.floor(this.rng() * n));
  }
  chance(p) { return this.rng() < p; }

  /** The play is over: the hands fade out, the heads go home, the reactions still due fire. */
  done() {
    if (!this.active || this.ending) return;
    this.beginEnding(false);
  }
}

// ------------------------------------------------------------------ aims (Unity HandAim constructors)

/** A pose in the bot's own frame from side-normalised vectors (x outward, mirrored for side -1). */
export function aimInBot(side, pos, fingers, palm, shape, weight = 1, effector = 'wrist') {
  const s = side < 0 ? -1 : 1;
  return handAim({ space: 'bot', position: new THREE.Vector3(pos.x * s, pos.y, pos.z), rotation: orientation(side, fingers, palm), shape, weight, effector });
}
/** A pose on a head (its point `point` / `pointSide`), `offset` in that head's half-widths and frame (not mirrored). */
export function aimOnHead(head, point, pointSide, offset, fingers, palm, shape, effector = 'wrist', weight = 1) {
  return handAim({ space: 'head', head, point, pointSide, position: offset.clone(), rotation: lookRotation(fingers, palm), shape, effector, weight });
}
/** A pose in the world: metres, the fingers' and palm's world directions. */
export function aimInWorld(position, fingers, palm, shape, effector = 'wrist', weight = 1) {
  return handAim({ space: 'world', position: position.clone(), rotation: lookRotation(fingers, palm), shape, effector, weight });
}
/** A pose in the world given as a wrist pose (laced, clasped hands). */
export function aimFromPose(pose, weight = 1, extra = {}) {
  return handAim({ space: 'world', position: pose.position.clone(), rotation: pose.rotation.clone(), shape: pose.shape, effector: 'wrist', weight, ...extra });
}
