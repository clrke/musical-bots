// A cast bot: a Soothing Bots head + two floating hands (no body), staged by the player.
import * as THREE from 'three';
import { syllabify } from './mv/voice/syllables.js';
import { createRobotHead } from './scene/robot-head.js';
import { RobotHands, SHAPES, lookRotation } from './scene/hands.js';
import { normalizeAppearance } from './scene/appearance.js';
import { acquireHead, releaseHead } from './scene/mech/assemble.js';
import { CAST16_BY_NAME } from './cast16.js';

const GROUP_SCALE = 2.4;
const GRIP = { ...SHAPES.relaxed, thumb: 0.35, index: 0.6, middle: 0.65, ring: 0.65, little: 0.6, spread: 0.1 };

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
    this.viewer = new THREE.Vector3(0, 1.6, 7);
    this.singing = 0;
    this._timing = null;
    this._singAge = 0;
    this.singTotal = 0.001;
    this.level = 0;
    this.beat = 0;
    this._line = null;
    this._lineText = null;
    this._syllables = 0;
    this.consultT = 0;
    this.consultDur = 0;
    this.consultFrom = new THREE.Vector3();
    this.consultTo = null;
    this._hand = null; // { other, t, dur, mid, kind }
    this._centre = new THREE.Vector3();
    this._aim = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), shape: GRIP, weight: 0 };
    this._n = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  walkTo(v) {
    this.target.copy(v);
  }

  /**
   * Show a lyric and sing it. timing (from the voice engine, optional): { delay, length,
   * syllables: [{t0, t1}] } in seconds from now / from the first note; then the mouth opens on the
   * real syllables and the card highlights each one as it sounds. Without it, a generic envelope.
   */
  sing(seconds, lyric = '', timing = null) {
    this._timing = timing && timing.syllables?.length ? timing : null;
    this._singAge = 0;
    if (this._timing) seconds = this._timing.delay + this._timing.length + 0.15;
    this.singing = seconds;
    this.singTotal = Math.max(0.001, seconds);
    if (!lyric) {
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
    this.head.setLyrics(this._line);
    this.head.setLyricProgress(this._timing ? -1 : 0);
  }

  /** Index of the syllable sounding now (-1 between syllables / before the line), from timing. */
  _timedSyllable() {
    const tm = this._timing;
    const u = this._singAge - tm.delay;
    let idx = -1;
    for (let i = 0; i < tm.syllables.length; i++) if (u >= tm.syllables[i].t0 - 0.03) idx = i;
    const open = idx >= 0 && u <= tm.syllables[idx].t1 + 0.05;
    return { idx, open };
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

  /** Right hands meet halfway and shake (both bots drive their own hand). */
  handshake(other) {
    const mid = this.group.position.clone().add(other.group.position).multiplyScalar(0.5);
    mid.y = Math.min(this.group.position.y, other.group.position.y) + 0.1;
    this._hand = { other, t: 0, dur: 1.8, mid: mid.clone(), kind: 'shake' };
    other._hand = { other: this, t: 0, dur: 1.8, mid, kind: 'shake' };
  }

  /** Right hands meet high and slap (both bots drive their own hand). */
  highFive(other) {
    const mid = this.group.position.clone().add(other.group.position).multiplyScalar(0.5);
    mid.y += 0.7;
    this._hand = { other, t: 0, dur: 1.1, mid: mid.clone(), kind: 'five' };
    other._hand = { other: this, t: 0, dur: 1.1, mid, kind: 'five' };
  }

  update(dt, t) {
    // drift toward the target; consultations arc over and back
    const k = 1 - Math.exp(-3 * dt);
    if (this.consultTo) {
      this.consultT += dt;
      const u = Math.min(1, this.consultT / this.consultDur);
      const there = this._n.copy(this.consultTo.group.position).sub(this.consultFrom);
      const dist = Math.min(1.2, there.length() - 0.8);
      there.normalize().multiplyScalar(Math.max(0, dist) * Math.sin(u * Math.PI));
      this.group.position.copy(this.consultFrom).add(there);
      if (u >= 1) this.consultTo = null;
    } else {
      this.group.position.lerp(this.target, k);
    }
    this.group.updateWorldMatrix(true, true);
    // singing envelope + syllables drive the mouth
    this.singing = Math.max(0, this.singing - dt);
    this._singAge += dt;
    const timed = this._timing && this.singing > 0 ? this._timedSyllable() : null;
    const target = timed ? (timed.open ? 0.75 : 0.12) : this.singing > 0 ? 0.55 + 0.25 * Math.sin(t * 9 + this.index) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 8);
    this.beat = t / 0.5;
    const singing = this.singing > 0;
    this.head.setSinging(singing ? this.level : 0);
    if (timed) {
      this.head.setLyricProgress(Math.min(this._syllables - 1, timed.idx));
    } else if (singing && this._syllables > 0) {
      const u = 1 - this.singing / this.singTotal;
      this.head.setLyricProgress(Math.min(this._syllables - 1, Math.floor(u * this._syllables)));
    } else {
      this.head.setLyricProgress(-1);
    }
    this.head.update(dt, t, this.viewer);
    // the meeting hand aims its right hand at the shared point
    let aimR = null;
    if (this._hand) {
      const h = this._hand;
      h.t += dt;
      const u = Math.min(1, h.t / h.dur);
      const env = u < 0.25 ? u / 0.25 : u > 0.75 ? (1 - u) / 0.25 : 1;
      const bob = h.kind === 'shake' ? Math.sin(h.t * 16) * 0.035 * env : 0;
      this._aim.position.copy(h.mid);
      this._aim.position.y += bob;
      this._aim.position.sub(this.group.position).divideScalar(GROUP_SCALE);
      this._n.copy(h.other.group.position).sub(this.group.position).setY(0);
      if (this._n.lengthSq() < 1e-6) this._n.set(0, 0, 1);
      this._n.normalize();
      this._f.set(0, 1, 0.12).normalize();
      lookRotation(this._f, this._n, this._aim.rotation);
      this._aim.shape = h.kind === 'shake' ? GRIP : SHAPES.open;
      this._aim.weight = env;
      aimR = this._aim;
      if (u >= 1) this._hand = null;
    }
    // hands hang off the head's drawn centre (head space, refreshed each frame)
    this.head.mesh.getWorldPosition(this._centre);
    this.group.worldToLocal(this._centre);
    this.hands.update({
      centre: this._centre, unit: this.unit, headScale: this.headScale, dt,
      singing, level: this.level, muted: false, asleep: false, grab: 0,
      beat: this.beat, beatSec: 0.5, aimL: null, aimR,
    });
  }
}
