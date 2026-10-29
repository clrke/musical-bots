// A hand play's face wishes for one bot (Unity Heads/Runtime/Rig/HeadPlay.cs + RobotHead.Play's wink), applied to
// the JS head through its hand-play hooks (scene/robot-head.js: setPlayFace, flickAntenna). Continuous wishes
// (channel offsets, a tilt, a lean) are cleared every frame and said again by the play; one-shots (a wink, an act,
// an antenna flick) run out by themselves. Released, the head is exactly its own again.
//
// Mirroring (see scene/hand-rig.js): sides are the hands' (side +1 = the head's +x = the viewer's right), the
// expression channels' L / R are the viewer's, so `ch(side, L, R)` maps side +1 to R; a roll toward side +1 is a
// negative headRoll (the JS head's +headRoll tips its top toward -x); a gaze toward +x is a positive lookYaw.
import { ACTS, CH, CHANNEL_COUNT, RANGE_HI, RANGE_LO, sampleTimeline } from '../scene/personality.js';

/** The viewer-L/R channel of a pair (names) for a hand side: side +1 (+x, the viewer's right) is R. */
export const ch = (side, left, right) => (side > 0 ? right : left);

/** A wink lasts this long (s; Unity RobotHead.WinkSeconds). */
const WINK_SECONDS = 0.5;

export class FacePlay {
  constructor(bot) {
    this.bot = bot;
    /** This frame's continuous offsets (cleared before every play step). */
    this.face = new Float32Array(CHANNEL_COUNT);
    this.total = new Float32Array(CHANNEL_COUNT);
    this.acts = [];
    this.winkSide = 0;
    this.winkT = Infinity;
    this.lean = { roll: 0, pitch: 0 };
    this.attached = false;
    this._fn = (target) => this._apply(target);
  }

  /** Clears the continuous wishes (a play states them every frame). */
  clear() {
    this.face.fill(0);
  }

  /** Adds `value` to channel `name`'s target this frame. */
  add(name, value) {
    const i = CH[name];
    if (i !== undefined) this.face[i] += value;
  }

  /** A small tilt (Unity HeadPlay.Tilt): `roll` + tips the top toward side +1, `pitch` + lifts the face (rad). */
  tilt(roll, pitch = 0) {
    this.face[CH.headRoll] -= roll;
    this.face[CH.headPitch] += pitch;
  }

  /** A wink of the eye on `side` (about half a second). */
  winkEye(side) {
    this.winkSide = side < 0 ? -1 : 1;
    this.winkT = 0;
  }

  /** The antenna swings as if the head were pushed at velocity v (its frame, m/s of a full-size head). */
  flickAntenna(v) {
    this.bot?.head?.flickAntenna?.(v.x, v.y, v.z);
  }

  /** The eye on `side` is rubbed (Unity HeadPlay.RubEye). */
  rubEye(side, amount, wiggle = 0) {
    amount = Math.min(1, Math.max(0, amount));
    this.add(ch(side, 'lidUpL', 'lidUpR'), 1.15 * amount);
    this.add(ch(side, 'lidLowL', 'lidLowR'), (0.55 + 0.15 * wiggle) * amount);
    this.add(ch(side, 'browRaiseL', 'browRaiseR'), -(0.35 + 0.1 * wiggle) * amount);
    this.add('browSqueeze', 0.25 * amount);
    this.add('mouthSmirk', -0.25 * amount * (side > 0 ? 1 : -1));
    this.add('mouthSmile', -0.15 * amount);
  }

  /** Bliss (Unity HeadPlay.Bliss): eyes close contentedly, a smile, a blush; the head leans toward `toward` (bot frame). */
  bliss(amount, toward) {
    amount = Math.min(1, Math.max(0, amount));
    this.add('lidUpL', 0.62 * amount);
    this.add('lidUpR', 0.62 * amount);
    this.add('lidLowL', 0.32 * amount);
    this.add('lidLowR', 0.32 * amount);
    this.add('mouthSmile', 0.45 * amount);
    this.add('blush', 0.45 * amount);
    this.add('browRaiseL', 0.12 * amount);
    this.add('browRaiseR', 0.12 * amount);
    this.add('browTiltL', 0.25 * amount);
    this.add('browTiltR', 0.25 * amount);
    this.add('antenna', -0.3 * amount);
    const t = toward.lengthSq() > 1e-8 ? toward.clone().normalize() : toward;
    this.tilt(0.24 * amount * t.x, 0.08 * amount * Math.max(0, t.y) - 0.06 * amount * t.z);
  }

  /** The eyes (and a little the head) turn toward a point of the bot's frame by `amount` (Unity SoloKit.Gaze). */
  gaze(local, amount) {
    if (amount <= 0) return;
    const z = Math.max(0.35, local.z);
    const yaw = Math.atan2(local.x, z), pitch = Math.atan2(local.y, Math.sqrt(local.x * local.x + z * z));
    this.add('lookYaw', Math.min(0.75, Math.max(-0.75, yaw)) * amount);
    this.add('lookPitch', Math.min(0.5, Math.max(-0.5, pitch)) * amount);
  }

  /** A personality act now (scene/personality.js ACTS): the head's own act player when it has one, else sampled here. */
  act(name) {
    if (!name) return null;
    const head = this.bot?.head;
    if (typeof head?.playAct === 'function') {
      head.playAct(name);
      return name;
    }
    const tl = ACTS[name];
    if (tl) this.acts.push({ tl, t: 0 });
    return name;
  }

  /** Something still to show (a running act, a wink, a lean, continuous wishes). */
  get busy() {
    if (this.acts.length || this.winkT < WINK_SECONDS) return true;
    if (Math.abs(this.lean.roll) > 1e-4 || Math.abs(this.lean.pitch) > 1e-4) return true;
    for (let i = 0; i < CHANNEL_COUNT; i++) if (this.face[i] !== 0) return true;
    return false;
  }

  /** Advances the one-shots and composes this frame's offsets; hooks the head while there is anything to show. */
  step(dt) {
    const tot = this.total;
    tot.set(this.face);
    for (let k = this.acts.length - 1; k >= 0; k--) {
      const a = this.acts[k];
      a.t += dt;
      if (!sampleTimeline(a.tl, a.t, 1, tot)) this.acts.splice(k, 1);
    }
    if (this.winkT < WINK_SECONDS) {
      this.winkT += dt;
      const t = this.winkT;
      let env = Math.min(1, Math.max(0, t / 0.08)) * Math.min(1, Math.max(0, (WINK_SECONDS - t) / 0.16));
      env = env * env * (3 - 2 * env);
      const s = this.winkSide;
      tot[CH[ch(s, 'lidUpL', 'lidUpR')]] += 1.25 * env;
      tot[CH[ch(s, 'lidLowL', 'lidLowR')]] += 0.3 * env;
      tot[CH[ch(s, 'browRaiseL', 'browRaiseR')]] += -0.28 * env;
      tot[CH.mouthSmirk] += -0.3 * env * s;
      tot[CH.mouthSmile] += 0.12 * env;
    }
    tot[CH.headRoll] += this.lean.roll;
    tot[CH.headPitch] += this.lean.pitch;
    const busy = this.busy;
    const head = this.bot?.head;
    if (!head?.setPlayFace) return busy;
    if (busy && !this.attached) {
      head.setPlayFace(this._fn);
      this.attached = true;
    } else if (!busy && this.attached) {
      head.setPlayFace(null);
      this.attached = false;
    }
    return busy;
  }

  _apply(target) {
    const tot = this.total;
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const o = tot[i];
      if (o === 0) continue;
      const v = target[i] + o;
      target[i] = v < RANGE_LO[i] ? RANGE_LO[i] : v > RANGE_HI[i] ? RANGE_HI[i] : v;
    }
  }
}

/** Unity Personality act lists per personality (ChoirSocial.Profiles): what a bot plays when it greets, answers, giggles, plots. */
const PROFILE = {
  cheerful: { move: 1, exchange: ['nod', 'giggle'], ret: ['nod', 'giggle'], giggle: ['giggle'], mischief: ['giggle', 'nod'] },
  wistful: { move: 0.7, exchange: ['longing'], ret: ['softsigh'], giggle: ['slowblink', 'softsigh'], mischief: ['longing'] },
  shy: { move: 0.75, exchange: ['peek'], ret: ['peek'], giggle: ['peek', 'flutter'], mischief: ['peek'] },
  dramatic: { move: 1.1, exchange: ['gasp', 'swoon'], ret: ['gasp'], giggle: ['swoon', 'gasp'], mischief: ['gasp'] },
  sleepy: { move: 0.6, exchange: ['slowblink'], ret: ['slowblink'], giggle: ['slowblink'], mischief: ['yawn'] },
  cheeky: { move: 1.1, exchange: ['wink', 'giggle'], ret: ['wink'], giggle: ['giggle', 'wink'], mischief: ['wink', 'waggle', 'knowing'] },
  proud: { move: 0.7, exchange: ['preen'], ret: ['nod'], giggle: ['preen', 'nod'], mischief: ['preen'] },
  nervous: { move: 0.9, exchange: ['dart'], ret: ['gulp'], giggle: ['gulp'], mischief: ['dart'] },
  dreamy: { move: 0.8, exchange: ['slowblink'], ret: ['slowblink'], giggle: ['twinkle', 'slowblink'], mischief: ['slowblink'] },
  zany: { move: 1.25, exchange: ['crazy', 'boing'], ret: ['wobble'], giggle: ['crazy', 'wobble'], mischief: ['crazy', 'swap'] },
  curious: { move: 1, exchange: ['peer', 'cockleft', 'cockright'], ret: ['cockleft', 'cockright'], giggle: ['cockleft', 'cockright'], mischief: ['peer', 'cockleft', 'cockright'] },
  gentle: { move: 0.8, exchange: ['kindnod'], ret: ['kindnod', 'slowblink'], giggle: ['giggle', 'kindnod'], mischief: ['kindnod'] },
  stoic: { move: 0.35, exchange: ['nod'], ret: ['nod'], giggle: ['nod'], mischief: ['nod'] },
  giddy: { move: 1.2, exchange: ['giggle', 'bounce'], ret: ['bounce', 'giggle'], giggle: ['giggle', 'squeal'], mischief: ['squeal', 'bounce'] },
  hopeful: { move: 1, exchange: ['brighten'], ret: ['brighten'], giggle: ['giggle', 'brighten'], mischief: ['brighten', 'lookup'] },
  romantic: { move: 0.9, exchange: ['flutter', 'swoon'], ret: ['flutter'], giggle: ['flutter', 'swoon'], mischief: ['flutter'] },
  bored: { move: 0.6, exchange: ['sigh'], ret: ['sigh'], giggle: ['exhale'], mischief: ['stare'] },
  goofy: { move: 1.2, exchange: ['waggle'], ret: ['wobble'], giggle: ['wobble', 'waggle'], mischief: ['waggle', 'wobble'] },
  wise: { move: 0.4, exchange: ['nod'], ret: ['nod'], giggle: ['knowing'], mischief: ['knowing'] },
  starstruck: { move: 1, exchange: ['twinkle'], ret: ['twinkle'], giggle: ['twinkle'], mischief: ['twinkle'] },
};
const DEFAULT_PROFILE = { move: 1, exchange: ['nod'], ret: ['nod'], giggle: ['giggle'], mischief: ['nod'] };

/** A personality's profile: { move, exchange, ret, giggle, mischief } (Unity ChoirSocial.Profile). */
export const profileOf = (personality) => PROFILE[personality] ?? DEFAULT_PROFILE;

