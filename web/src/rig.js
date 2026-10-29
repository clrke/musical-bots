// A cast bot: a Soothing Bots head + two floating hands (no body), staged by the player.
import * as THREE from 'three';
import { syllabify } from './mv/voice/syllables.js';
import { createRobotHead } from './scene/robot-head.js';
import { RobotHands } from './scene/hands.js';
import { normalizeAppearance } from './scene/appearance.js';
import { acquireHead, releaseHead } from './scene/mech/assemble.js';
import { CAST16_BY_NAME } from './cast16.js';

const GROUP_SCALE = 2.4;
/** A glide this fast (head half-widths per second) swings the hands fully (walk 1). */
const WALK_HALF_WIDTHS = 5;

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
    /** The hand plays' wishes (plays/): this frame's aims for the left (-1) and right (+1) hand, the head's move. */
    this.aims = { left: null, right: null };
    this.playOffset = new THREE.Vector3();
    /** Seconds per beat of the song clock (0: none, the hands keep their own time), and how fast it glides (0..1). */
    this.beatSec = 0;
    this.walk = 0;
    this._lastPos = home.clone();
    this._centre = new THREE.Vector3();
    this._n = new THREE.Vector3();
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
    // how long the syllable sounding now has been held (the hands may open a palm on a long note)
    const held = open ? Math.max(0, u - tm.syllables[idx].t0) : 0;
    return { idx, open, held };
  }

  consult(other) {
    this.consultFrom.copy(this.group.position);
    this.consultTo = other;
    this.consultT = 0;
    this.consultDur = 4;
    this.hands.play('wave');
  }

  /**
   * One frame. clock (optional): the song's clock { time (s), beatSec, playing }: while it plays the hands sway on its
   * beat (Unity HandsInput.Beat); without one they keep their own slow time.
   */
  update(dt, t, clock = null) {
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
    // gliding: how fast the bot moves through the set (its group; a play's head move does not count), for the hands' swing
    if (dt > 1e-4) {
      const speed = this._lastPos.distanceTo(this.group.position) / dt;
      const walk = Math.min(1, speed / (WALK_HALF_WIDTHS * this.unit * GROUP_SCALE));
      this.walk += (walk - this.walk) * (1 - Math.exp(-6 * dt));
    }
    this._lastPos.copy(this.group.position);
    this.head.group.position.copy(this.playOffset); // a hand play's move of the head (plays/stage.js)
    this.group.updateWorldMatrix(true, true);
    // singing envelope + syllables drive the mouth
    this.singing = Math.max(0, this.singing - dt);
    this._singAge += dt;
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
      this.head.setLyricProgress(Math.min(this._syllables - 1, timed.idx));
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
