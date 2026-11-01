// A cast bot: a Soothing Bots head + two floating hands (no body), staged by the player.
import * as THREE from 'three';
import { syllabify } from './mv/voice/syllables.js';
import { createRobotHead } from './scene/robot-head.js';
import { RobotHands } from './scene/hands.js';
import { normalizeAppearance } from './scene/appearance.js';
import { acquireHead, releaseHead } from './scene/mech/assemble.js';
import { CAST16_BY_NAME } from './cast16.js';
import { cardSyllable } from './staging.js';
import { CARD_SHOW_LEAD } from './sing-plan.js';

const GROUP_SCALE = 2.4;
let singSerial = 0; // the order lines start in (the stage's spots go to the earlier singer among equals)

// Movement (blocking.js drives it through walkTo / place): a glide at head height.
/** Default glide speed (m/s). */
export const GLIDE_SPEED = 1.45;
/** A glide this fast (head half-widths per second) swings the hands fully (walk 1). */
const WALK_HALF_WIDTHS = 5;
const STEP = 0.55; // metres per bob
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

/** Ring formation targets around center (XZ plane, center's height). Pure. */
export function ringTargets(center, radius, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push(new THREE.Vector3(center.x + Math.cos(a) * radius, center.y, center.z + Math.sin(a) * radius));
  }
  return out;
}

export class Bot {
  constructor(name, home, index) {
    const cast = CAST16_BY_NAME[name];
    if (!cast) throw new Error(`unknown bot ${name}`);
    this.name = name;
    this.index = index;
    this.cast = cast;
    this.group = new THREE.Group();
    this.group.position.copy(home);
    this.group.scale.setScalar(GROUP_SCALE);
    this.head = createRobotHead({ index });
    this.head.setAppearance(cast.look);
    this.head.setParticles(cast.fx);
    this.head.setPersonality(cast.personality);
    this.group.add(this.head.group);
    this.hands = new RobotHands(index);
    this.hands.attach(this.group);
    const look = normalizeAppearance(cast.look);
    this.hands.setLook(look);
    this.hands.setPersonality(cast.personality);
    // shared head cache: read this look's half-width for the hand scale (released; the head holds its own ref)
    const shared = acquireHead(look);
    this.unit = shared.halfWidth * look.scale;
    releaseHead(shared);
    this.headScale = look.scale;
    this.home = home.clone();
    this.target = home.clone();
    // movement state: the glide position (group.position adds the bob), velocity, waypoints, the
    // separation push the blocking sets each frame, body yaw (rest: faceYaw) and the 0..1 walk
    // the hands swing with (hands.update({ walk }): the glide's own speed, the bob not counted)
    this.pos = home.clone();
    this.vel = new THREE.Vector3();
    this.push = new THREE.Vector3();
    this.via = [];
    this.speed = GLIDE_SPEED;
    this.yaw = 0;
    this.faceYaw = 0;
    this.strafe = false; // the glide keeps its face to faceYaw (walkTo strafe)
    this.walk = 0;
    this._stride = 0;
    this._lean = 0;
    this._roll = 0;
    this.group.rotation.order = 'YXZ';
    this.viewer = new THREE.Vector3(0, 1.6, 7);
    this.singing = 0;
    /** What it sings now (sing() opts.part): 'lead', 'harmony', 'reply', 'echo' or 'backing' (its card's style, its spot). */
    this.part = 'lead';
    /** The stage's spot for what it sings (stage.js SPOT_RANK / SPOT_GAIN): its part, or 'duet'. */
    this.spotPart = 'lead';
    this.singSerial = 0;
    this._cycle = false;
    this._timing = null;
    this._singAge = 0;
    this.singTotal = 0.001;
    this.level = 0;
    this.beat = 0;
    this._line = null;
    this._lineText = null;
    this._syllables = 0;
    this._cardDue = false; // the line's card comes up at _cardAt (s after sing)
    this._cardAt = 0;
    this.consultT = 0;
    this.consultDur = 0;
    this.consultFrom = new THREE.Vector3();
    this.consultTo = null;
    /** The hand plays' wishes (plays/): this frame's aims for the left (-1) and right (+1) hand, the head's move. */
    this.aims = { left: null, right: null };
    this.handPlay = null; // the hand play holding its hands { id, other } (plays/stage.js), else null
    this.playOffset = new THREE.Vector3();
    /** Seconds per beat of the song clock (0: none, the hands keep their own time). */
    this.beatSec = 0;
    this._centre = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  /**
   * Glide to v (head centre, world). opts: via (Vector3 waypoints first, e.g. a path around the
   * furniture), speed (m/s), face (body yaw once arrived; default: keep the current rest yaw), strafe (glide there
   * facing `face` all the way, not the way it goes: a singer's step forward and back keeps its face to the audience).
   */
  walkTo(v, { via = null, speed = GLIDE_SPEED, face = null, strafe = false } = {}) {
    this.target.copy(v);
    this.via = via ? via.map((p) => p.clone()) : [];
    this.speed = speed;
    this.strafe = !!strafe;
    if (face !== null) this.faceYaw = face;
  }

  /** Put the bot at v at once (a cut, an entrance): no glide, at rest, facing yaw. */
  place(v, yaw = this.faceYaw) {
    this.pos.copy(v);
    this.target.copy(v);
    this.via = [];
    this.strafe = false;
    this.vel.set(0, 0, 0);
    this.yaw = this.faceYaw = yaw;
    this.walk = this._lean = this._roll = 0;
    this.group.position.copy(v);
    this.group.rotation.set(0, yaw, 0);
  }

  /** True while gliding (or still settling) toward the target. */
  get moving() {
    return this.via.length > 0 || this.vel.lengthSq() > 0.02 || this.pos.distanceToSquared(this.target) > 0.01;
  }

  /**
   * The glide's wish now (level, m/s, into out.x / out.z): toward the next waypoint at full speed, an easy arrival at
   * the last one. Returns out. (The blocking's swarm steering reads it: rig.push bends it round the other bots.)
   */
  glideVelocity(out) {
    const p = this.pos;
    let i = 0;
    while (i < this.via.length && (this.via[i].x - p.x) ** 2 + (this.via[i].z - p.z) ** 2 < 0.3 * 0.3) i++;
    const goal = this.via[i] ?? this.target;
    const dx = goal.x - p.x, dz = goal.z - p.z;
    const d = Math.hypot(dx, dz);
    const glide = i < this.via.length ? this.speed : Math.min(this.speed, d * 1.8);
    out.x = d > 1e-4 ? (dx / d) * glide : 0;
    out.z = d > 1e-4 ? (dz / d) * glide : 0;
    return out;
  }

  /** Seconds of glide left to the end of its path at its speed (0 when there). */
  get glideLeft() {
    let len = 0, x = this.pos.x, z = this.pos.z;
    for (let i = 0; i <= this.via.length; i++) {
      const w = this.via[i] ?? this.target;
      len += Math.hypot(w.x - x, w.z - z);
      x = w.x;
      z = w.z;
    }
    return len > 0.02 ? len / Math.max(0.3, this.speed) + 0.4 : 0;
  }

  /**
   * The glide: steer to the next waypoint / the target (bent round the others by the blocking's push), then bob, lean
   * and turn. (Consultations and social moves are offsets on the head, acting.js: the bot itself stays on its mark.)
   */
  _move(dt) {
    const p = this.pos, v = this.vel;
    const px = p.x, pz = p.z;
    while (this.via.length && (this.via[0].x - p.x) ** 2 + (this.via[0].z - p.z) ** 2 < 0.3 * 0.3) this.via.shift();
    // full speed between waypoints, an easy arrival at the last one
    const { x: wx, z: wz } = this.glideVelocity(this._n);
    const k = 1 - Math.exp(-dt * 5);
    v.x += (wx + this.push.x - v.x) * k;
    v.z += (wz + this.push.z - v.z) * k;
    v.y = 0;
    p.x += v.x * dt;
    p.z += v.z * dt;
    p.y += (this.target.y - p.y) * (1 - Math.exp(-dt * 3));
    // walk 0..1 (the hands' swing: full at WALK_HALF_WIDTHS head half-widths a second), the bob of
    // each glide step, a lean into the motion
    const speed = dt > 0 ? Math.hypot(p.x - px, p.z - pz) / dt : 0;
    const full = WALK_HALF_WIDTHS * this.unit * GROUP_SCALE;
    this.walk += (Math.min(1, speed / full) - this.walk) * (1 - Math.exp(-dt * 6));
    this._stride += (speed * dt) / STEP;
    const bob = 0.04 * this.walk * Math.sin(this._stride * Math.PI) ** 2;
    // turn toward the direction of travel; at rest back to the rest yaw
    const travel = Math.atan2(v.x, v.z);
    const going = this.strafe ? 0 : Math.min(1, Math.max(0, (speed - 0.12) / 0.35));
    const want = this.faceYaw + wrapAngle(travel - this.faceYaw) * going;
    const turn = wrapAngle(want - this.yaw) * (1 - Math.exp(-dt * 5.5));
    this.yaw = wrapAngle(this.yaw + turn);
    this._lean += (0.13 * this.walk - this._lean) * (1 - Math.exp(-dt * 4));
    const bank = dt > 0 ? Math.max(-0.12, Math.min(0.12, -(turn / dt) * 0.05 * this.walk)) : 0;
    this._roll += (bank - this._roll) * (1 - Math.exp(-dt * 4));
    this.group.position.set(p.x, p.y + bob, p.z);
    this.group.rotation.set(this._lean, this.yaw, this._roll);
  }

  /** Its hands are held by a hand play now (acting.js checks this before staging a handshake): { id, other }, else null. */
  get _hand() {
    return this.handPlay ?? (this.aims.left || this.aims.right ? { id: 'aimed', other: null } : null);
  }

  /**
   * Show a lyric and sing it. timing (from the voice engine, optional): { delay, length,
   * syllables: [{t0, t1}] } in seconds from now / from the first note; then the mouth opens on the
   * real syllables and the card highlights each one as it sounds. Without it, a generic envelope.
   * opts: part ('lead' the story's line, 'harmony', 'reply' / 'echo' the pal's answers, 'backing': a smaller,
   * dimmer card; the stage's spots rank by it), cycle (the voice sings the card's syllables again and again, one
   * cell a bar: the backing; the highlight comes round with it), spot (the stage's spot for it when not its part's:
   * 'duet', a making-of consultation's two singers, lit a little softer than a lead).
   */
  sing(seconds, lyric = '', timing = null, { part = 'lead', cycle = false, spot = null } = {}) {
    this._timing = timing && timing.syllables?.length ? timing : null;
    this._singAge = 0;
    if (this._timing) seconds = this._timing.delay + this._timing.length + 0.15;
    this.singing = seconds;
    this.singTotal = Math.max(0.001, seconds);
    this.part = part;
    this.spotPart = spot ?? part;
    this.singSerial = ++singSerial;
    this._cycle = !!cycle;
    this._cardDue = false;
    if (!lyric) {
      this.head.setCardStyle?.(part);
      this._line = null;
      this._lineText = null;
      this._syllables = 0;
      this.head.setLyrics(null);
      this.head.setLyricProgress(-1);
      return;
    }
    if (lyric !== this._lineText) {
      const sylls = syllabify(lyric);
      this._line = { text: lyric, syllables: sylls.length ? sylls : lyric.split(' ').filter(Boolean).map((w) => ({ text: w })) };
      this._lineText = lyric;
      this._syllables = this._line.syllables.length;
    }
    // the card comes up CARD_SHOW_LEAD before the first note (update), not with the event (CARD_LEAD before it)
    this._cardAt = this._timing ? Math.max(0, this._timing.delay - CARD_SHOW_LEAD) : 0;
    this._cardDue = true;
    if (this._cardAt <= 0) this._showCard();
  }

  /** Its lyric card down now, and one still due not shown (a cut to another set: the last section's lines stay behind). */
  dropCard() {
    this._cardDue = false;
    this.head.dropLyrics?.();
  }

  /** The line's lyric card up now (its quiet spell starts again). */
  _showCard() {
    this._cardDue = false;
    this.head.setCardStyle?.(this.part);
    this.head.setLyrics(this._line);
    this.head.setLyricProgress(this._timing ? -1 : 0);
    this.head.keepLyrics?.();
  }

  /** Index of the syllable sounding now (-1 between syllables / before the line), from timing. */
  _timedSyllable() {
    const tm = this._timing;
    const u = this._singAge - tm.delay;
    let idx = -1;
    for (let i = 0; i < tm.syllables.length; i++) if (u >= tm.syllables[i].t0 - 0.03) idx = i;
    const open = idx >= 0 && u <= tm.syllables[idx].t1 + 0.05;
    // how long the syllable sounding now has been held (the hands may open a palm on a long note)
    const held = open ? Math.max(0, u - tm.syllables[idx].t0) : 0;
    return { idx, open, held };
  }

  /**
   * A consultation with `other` (status: consulting) lasting `seconds`. The scene (the head goes over,
   * the two face each other, trade nods, agree with a nod or a handshake, come back) is staged by
   * acting.js consult(); the bot itself keeps its mark (blocking.js places the bots). Returns the length.
   */
  consult(other, seconds = 4) {
    this.consultTo = null; // the whole bot no longer drifts over and back
    this.consultWith = other ?? null;
    this.consultT = 0;
    this.consultDur = seconds;
    return seconds;
  }

  /**
   * One frame. clock (optional): the song's clock { time (s), beatSec, playing }: while it plays the hands sway on its
   * beat (Unity HandsInput.Beat); without one they keep their own slow time.
   */
  update(dt, t, clock = null) {
    // glide toward the target, facing the way it goes (sets this.walk for the hands' swing)
    _q0.copy(this.group.quaternion);
    this._move(dt);
    // the head off its place: the choir's social move (acting.js, head.setSocialOffset) plus a hand play's (plays/stage.js),
    // both set in the bot's frame before this glide step: they keep their direction in the world as the bot turns (else a
    // head held out to the side swings round with the turn, into a neighbour)
    const social = this.head.socialOffset;
    const off = this.head.group.position;
    if (social) off.copy(social).add(this.playOffset);
    else off.copy(this.playOffset);
    if (off.lengthSq() > 0) off.applyQuaternion(_q1.copy(this.group.quaternion).invert().multiply(_q0));
    this.group.updateWorldMatrix(true, true);
    // singing envelope + syllables drive the mouth
    this.singing = Math.max(0, this.singing - dt);
    this._singAge += dt;
    if (this._cardDue && this._singAge >= this._cardAt - 1e-6) this._showCard();
    const timed = this._timing && this.singing > 0 ? this._timedSyllable() : null;
    const target = timed ? (timed.open ? 0.75 : 0.12) : this.singing > 0 ? 0.55 + 0.25 * Math.sin(t * 9 + this.index) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 8);
    // the song's beat (continuous beats), else none
    const clocked = !!clock && clock.playing !== false && clock.beatSec > 0 && Number.isFinite(clock.time);
    this.beatSec = clocked ? clock.beatSec : 0;
    this.beat = clocked ? clock.time / clock.beatSec : 0;
    const singing = this.singing > 0;
    this.head.setSinging(singing ? this.level : 0);
    if (timed) {
      this.head.setLyricProgress(cardSyllable(timed.idx, this._syllables, this._cycle));
      if (timed.open) this.head.keepLyrics?.(); // a long held note keeps its card up
    } else if (singing && this._syllables > 0) {
      const u = 1 - this.singing / this.singTotal;
      this.head.setLyricProgress(Math.min(this._syllables - 1, Math.floor(u * this._syllables)));
    } else {
      this.head.setLyricProgress(-1);
    }
    this.head.update(dt, t, this.viewer);
    // hands hang off the head's drawn centre (head space, refreshed each frame)
    this.head.mesh.getWorldPosition(this._centre);
    this.group.worldToLocal(this._centre);
    this.hands.update({
      centre: this._centre, unit: this.unit, dt,
      singing, level: this.level, muted: false, asleep: 0, grab: false,
      beat: this.beat, beatSec: this.beatSec, noteSeconds: timed?.held ?? 0, walk: this.walk,
      aimL: this.aims.left, aimR: this.aims.right,
    });
  }
}
