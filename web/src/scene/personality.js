// Personalities and the expression maths of the mechanical heads (pure: no three.js, no DOM).
//
// A head's face is a set of expression channels (brows, lids, pupils, gaze, mouth, head pose,
// blush, iris glow...). Every frame `stepExpression` composes the channel *targets* from
//   personality baseline + singing (level, current vowel) + idle life (blinks, saccades, glances,
//   little personal acts like a yawn or a wink) + reactions (select / wake / randomize)
// and the head runs a spring per channel toward them (so nothing ever snaps), then turns the
// channels into bone poses (face-rig.js). Left / right (L / R) are as seen by the viewer
// (L = the head's -x side).
import { PERSONALITIES, PERSONALITY_IDS } from '../model/schema.js';
import { makeRng } from './motion.js';

// ------------------------------------------------------------------ channels

export const CHANNELS = Object.freeze([
  'browRaiseL', 'browRaiseR', // -1 down .. 1 up
  'browTiltL', 'browTiltR', //   -1 angry (inner end down) .. 1 worried (inner end up)
  'browSqueeze', //               0..1 furrow (both brows pulled to the centre)
  'browArch', //                 -1..1 curvature (segmented brows)
  'lidUpL', 'lidUpR', //          0 wide open .. 1 shut (upper shutter)
  'lidLowL', 'lidLowR', //        0 down .. 1 up (lower shutter: happy squint)
  'lidTiltL', 'lidTiltR', //     -1 angry .. 1 sad (slant of the lid line)
  'pupilL', 'pupilR', //          0 pinhole .. 1 wide (iris aperture)
  'lookYaw', 'lookPitch', //      gaze offset (rad), + = right / up
  'mouthOpen', //                 0..1
  'mouthSmile', //               -1 frown .. 1 smile
  'mouthWidth', //               -1 narrow (oo) .. 1 wide (ee)
  'mouthRound', //                0..1 pucker (o)
  'mouthSmirk', //               -1 left corner up .. 1 right corner up
  'headRoll', 'headPitch', 'headYaw', // rad: roll + = tilt to the right, pitch + = chin up
  'blush', //                     0..1 cheek lamps
  'irisGlow', //                  0..2 iris light
  'eyeZoom', //                   0..1 eyes pop out (telescope eyes extend, everything else widens)
  'antenna', //                  -1 droop .. 1 perk
]);
export const CHANNEL_COUNT = CHANNELS.length;
export const CH = Object.freeze(Object.fromEntries(CHANNELS.map((c, i) => [c, i])));

/** Symmetric shorthands usable in the tables: `browRaise: 0.4` sets browRaiseL and browRaiseR. */
const PAIRS = {
  browRaise: ['browRaiseL', 'browRaiseR'],
  browTilt: ['browTiltL', 'browTiltR'],
  lidUp: ['lidUpL', 'lidUpR'],
  lidLow: ['lidLowL', 'lidLowR'],
  lidTilt: ['lidTiltL', 'lidTiltR'],
  pupil: ['pupilL', 'pupilR'],
};

const RANGE_TABLE = {
  browRaise: [-1, 1],
  browTilt: [-1, 1],
  browSqueeze: [0, 1],
  browArch: [-1, 1],
  lidUp: [0, 1],
  lidLow: [0, 1],
  lidTilt: [-1, 1],
  pupil: [0, 1],
  lookYaw: [-0.75, 0.75],
  lookPitch: [-0.5, 0.5],
  mouthOpen: [0, 1],
  mouthSmile: [-1, 1],
  mouthWidth: [-1, 1],
  mouthRound: [0, 1],
  mouthSmirk: [-1, 1],
  headRoll: [-0.4, 0.4],
  headPitch: [-0.4, 0.4],
  headYaw: [-0.5, 0.5],
  blush: [0, 1],
  irisGlow: [0, 2],
  eyeZoom: [0, 1],
  antenna: [-1, 1],
};

/** Channel ranges: RANGE_LO[i]..RANGE_HI[i]. */
export const RANGE_LO = new Float32Array(CHANNEL_COUNT);
export const RANGE_HI = new Float32Array(CHANNEL_COUNT);
for (const [key, [lo, hi]] of Object.entries(RANGE_TABLE)) {
  for (const name of PAIRS[key] ?? [key]) {
    RANGE_LO[CH[name]] = lo;
    RANGE_HI[CH[name]] = hi;
  }
}

/** Writes `values` (table form, shorthands allowed) into `out` (Float32Array), on top of what is there. */
function writeValues(values, out, mode = 'set') {
  for (const [key, v] of Object.entries(values)) {
    const names = PAIRS[key] ?? [key];
    for (const name of names) {
      const i = CH[name];
      if (i === undefined) throw new Error(`personality: unknown channel ${key}`);
      if (mode === 'set') out[i] = v;
      else out[i] += v;
    }
  }
  return out;
}

const NEUTRAL_TABLE = { lidUp: 0.14, lidLow: 0.1, pupil: 0.5, irisGlow: 1 };
/** The neutral face (every channel at rest). */
export const NEUTRAL = writeValues(NEUTRAL_TABLE, new Float32Array(CHANNEL_COUNT));

export function clampChannels(out) {
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const v = out[i];
    out[i] = v < RANGE_LO[i] ? RANGE_LO[i] : v > RANGE_HI[i] ? RANGE_HI[i] : v;
  }
  return out;
}

// ------------------------------------------------------------------ timelines

/**
 * A reaction / idle act: keyframes [[t, { channel: offset }], ...] (offsets ADD to the face,
 * shorthands allowed). Starts from 0 at t = 0 and ends at 0 at the last key; between keys the
 * offsets ease in and out (the channel springs smooth it further).
 */
export function compileTimeline(keys, name = '') {
  const list = keys.slice();
  if (!list.length || list[0][0] > 0) list.unshift([0, {}]);
  const last = list[list.length - 1];
  if (Object.keys(last[1]).length) list.push([last[0] + 0.5, {}]);
  const times = new Float32Array(list.length);
  const values = new Float32Array(list.length * CHANNEL_COUNT);
  const mask = new Uint8Array(CHANNEL_COUNT);
  list.forEach(([t, v], k) => {
    times[k] = t;
    writeValues(v, values.subarray(k * CHANNEL_COUNT, (k + 1) * CHANNEL_COUNT));
    for (const key of Object.keys(v)) for (const n of PAIRS[key] ?? [key]) mask[CH[n]] = 1;
  });
  for (let k = 1; k < times.length; k++) if (!(times[k] > times[k - 1])) throw new Error(`timeline ${name}: keys out of order`);
  return { name, duration: times[times.length - 1], times, values, mask };
}

/** Adds the timeline's offsets at time `t` (x weight) into `out`. Returns false once it is over. */
export function sampleTimeline(tl, t, weight, out) {
  if (!tl || t >= tl.duration || t < 0) return false;
  const { times, values, mask } = tl;
  let k = 0;
  while (k < times.length - 2 && t >= times[k + 1]) k++;
  const t0 = times[k];
  const t1 = times[k + 1];
  let f = (t - t0) / (t1 - t0);
  f = f * f * (3 - 2 * f);
  const a = k * CHANNEL_COUNT;
  const b = a + CHANNEL_COUNT;
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    if (!mask[i]) continue;
    out[i] += (values[a + i] + (values[b + i] - values[a + i]) * f) * weight;
  }
  return true;
}

// ------------------------------------------------------------------ personalities

/**
 * Per personality:
 *   rest   absolute channel values (others neutral)
 *   idle   blink  [min, max] seconds between blinks, blinkDur (s), double (chance of a double blink)
 *          saccade [min, max] s between eye jumps, sacAmp (rad)
 *          glance { viewer, neighbor, away, up, down } weights, hold [min, max] s
 *          twitch (0..1 nervous brow twitches), pulse (zany pupil pulsing), sway (slow head sway)
 *          acts   [{ act, every: [min, max] s }] little personal moves (timelines in ACTS)
 *   sing   gain (mouth opening), brow (lift with loudness), browPow, close (lids close on loud notes),
 *          closePow, squint (lower lids up), bob (head bob per syllable), tilt (chin up with loudness),
 *          smile (smile while singing, replaces rest smile), pupil, glow, waggle (alternating brows per
 *          syllable), tremble (brow jitter), sway (head roll with the level), blush
 *   react  { select, wake } timelines (randomize = a shared reboot + this personality's flourish)
 */
const STYLE_TABLE = {
  cheerful: {
    rest: { browRaise: 0.5, browTilt: 0.1, browArch: 0.45, lidUp: 0.04, lidLow: 0.34, pupil: 0.72, mouthSmile: 0.9, mouthWidth: 0.35, mouthOpen: 0.07, headRoll: 0.07, headPitch: 0.05, irisGlow: 1.2, antenna: 0.4 },
    idle: { blink: [2.2, 4.5], blinkDur: 0.13, double: 0.2, saccade: [0.7, 1.8], sacAmp: 0.1, glance: { viewer: 0.55, neighbor: 0.4, away: 0.05 }, hold: [1.5, 3.5], acts: [{ act: 'giggle', every: [5, 9] }] },
    sing: { gain: 1.1, brow: 0.35, browPow: 1, close: 0, closePow: 1, squint: 0.28, bob: 1.0, tilt: 0.05, smile: 0.6, pupil: 0.15, glow: 0.4, beatBrows: 0.35 },
    react: {
      select: [[0.1, { browRaise: 0.6, lidUp: -0.2, lidLow: -0.25, pupil: 0.3, mouthOpen: 0.55, mouthRound: 0.3, eyeZoom: 0.9, headPitch: 0.12, antenna: 0.8, irisGlow: 0.5 }], [0.5, { browRaise: 0.45, lidLow: 0.3, mouthOpen: 0.3, mouthSmile: 0.4, mouthWidth: 0.45, headRoll: 0.14, headPitch: 0.06, irisGlow: 0.4, eyeZoom: 0.3 }], [1.3, { browRaise: 0.3, lidLow: 0.2, mouthSmile: 0.25, headRoll: 0.08 }], [1.9, {}]],
      wake: [[0.5, { mouthSmile: 0.4, mouthOpen: 0.35, browRaise: 0.4, headPitch: -0.12 }], [0.8, { headPitch: 0.1, mouthOpen: 0.3 }], [1.1, { headPitch: -0.06, mouthSmile: 0.3 }], [1.6, {}]],
    },
  },
  shy: {
    rest: { browRaise: 0.2, browTilt: 0.7, browSqueeze: 0.15, lidUp: 0.34, lidLow: 0.12, lidTilt: 0.4, pupil: 0.78, lookPitch: -0.22, lookYaw: 0.12, mouthSmile: 0.3, mouthWidth: -0.35, headPitch: -0.17, headRoll: 0.13, headYaw: 0.13, blush: 0.35, irisGlow: 0.9, antenna: -0.2 },
    idle: { blink: [2.5, 5], blinkDur: 0.14, double: 0.15, saccade: [1, 2.5], sacAmp: 0.08, glance: { viewer: 0.15, neighbor: 0.3, away: 0.25, down: 0.3 }, hold: [1.5, 3.5], acts: [{ act: 'peek', every: [6, 11] }] },
    sing: { gain: 0.6, brow: 0.2, browPow: 1, close: 0.25, closePow: 1, squint: 0.1, bob: 0.35, tilt: -0.03, smile: 0.25, pupil: 0.1, glow: 0.2, blush: 0.25 },
    react: {
      select: [[0.1, { browRaise: 0.45, lidUp: -0.15, pupil: 0.2, mouthRound: 0.6, mouthOpen: 0.18, blush: 0.9, lookYaw: 0.5, lookPitch: -0.2, headYaw: 0.25, headPitch: -0.12 }], [0.6, { blush: 1, lidUp: 0.35, lookYaw: 0.55, lookPitch: -0.3, headYaw: 0.32, headPitch: -0.2, mouthSmile: 0.3 }], [1.5, { blush: 0.75, lookYaw: 0.2, headYaw: 0.15, lidUp: 0.2, mouthSmile: 0.35 }], [2.4, {}]],
      wake: [[0.5, { blush: 0.85, lookPitch: -0.3, headPitch: -0.15, mouthSmile: 0.2 }], [1.5, { blush: 0.6, lookYaw: 0.35 }], [2.1, {}]],
    },
  },
  dramatic: {
    rest: { browRaise: 0.62, browTilt: 0.6, browArch: 0.65, lidUp: 0, lidLow: 0.04, pupil: 0.62, mouthOpen: 0.16, mouthSmile: -0.15, mouthRound: 0.35, headPitch: 0.12, headRoll: -0.13, irisGlow: 1.25, antenna: 0.6 },
    idle: { blink: [3, 5.5], blinkDur: 0.18, double: 0.1, saccade: [1.2, 2.6], sacAmp: 0.1, glance: { viewer: 0.6, neighbor: 0.1, up: 0.3 }, hold: [2, 4], acts: [{ act: 'sigh', every: [6, 10] }] },
    sing: { gain: 1.4, brow: 0.65, browPow: 2, close: 0.6, closePow: 3, squint: 0, bob: 0.6, tilt: 0.24, tiltPow: 2, smile: -0.1, pupil: 0.3, glow: 0.8 },
    react: {
      select: [[0.12, { browRaise: 0.5, browTilt: 0.3, lidUp: -0.3, pupil: 0.35, mouthOpen: 0.75, mouthRound: 0.7, eyeZoom: 1, headPitch: 0.25, headRoll: 0.15, irisGlow: 0.7 }], [0.7, { browRaise: 0.5, mouthOpen: 0.55, mouthRound: 0.6, headPitch: 0.3, headRoll: 0.22, lidUp: 0.35, eyeZoom: 0.4 }], [1.4, { lidUp: 0.5, mouthOpen: 0.1, headPitch: 0.15, browTilt: 0.4 }], [2.2, {}]],
      wake: [[0.6, { browRaise: 0.6, mouthOpen: 0.6, mouthRound: 0.4, headPitch: 0.3, lidUp: 0.5 }], [1.3, { headPitch: 0.22, mouthOpen: 0.35, lidUp: 0.3 }], [2.0, {}]],
    },
  },
  sleepy: {
    rest: { browRaise: -0.35, browTilt: 0.25, lidUp: 0.62, lidLow: 0.22, pupil: 0.42, mouthOpen: 0.06, mouthSmile: 0.05, mouthRound: 0.25, headPitch: -0.15, headRoll: 0.17, irisGlow: 0.6, antenna: -0.85 },
    idle: { blink: [3.5, 7], blinkDur: 0.42, double: 0.05, saccade: [2.5, 5], sacAmp: 0.05, glance: { viewer: 0.5, neighbor: 0.15, down: 0.35 }, hold: [2.5, 5], acts: [{ act: 'yawn', every: [7, 13] }, { act: 'doze', every: [9, 16] }] },
    sing: { gain: 0.75, brow: 0.3, browPow: 1, close: -0.3, closePow: 1, squint: 0, bob: 0.4, tilt: 0.02, smile: 0.1, pupil: 0.1, glow: 0.3 },
    react: {
      select: [[0.06, { lidUp: -0.7, browRaise: 0.95, pupil: 0.4, headPitch: 0.25, eyeZoom: 0.8, antenna: 1.6, mouthOpen: 0.2, mouthRound: 0.5 }], [0.5, { lidUp: -0.6, browRaise: 0.75, headPitch: 0.15, antenna: 1 }], [1.2, { lidUp: -0.1, mouthOpen: 0.7, mouthRound: 0.4, browRaise: 0.35, headPitch: 0.15 }], [1.9, { lidUp: 0.1 }], [2.4, {}]],
      wake: [[0.4, { lidUp: -0.5, browRaise: 0.4, antenna: 1.2 }], [1.0, { mouthOpen: 0.75, mouthRound: 0.4, lidUp: 0.15, browRaise: 0.5 }], [1.7, { lidUp: -0.2 }], [2.2, {}]],
    },
  },
  cheeky: {
    rest: { browRaiseL: -0.15, browRaiseR: 0.75, browTiltL: -0.4, browTiltR: 0.05, lidUpL: 0.36, lidUpR: 0.04, lidLowL: 0.3, lidLowR: 0.1, pupil: 0.6, mouthSmile: 0.5, mouthSmirk: 0.8, mouthWidth: 0.2, headRoll: -0.1, headYaw: 0.06, irisGlow: 1.1, antenna: 0.3 },
    idle: { blink: [2, 4.5], blinkDur: 0.12, double: 0.15, saccade: [0.8, 2], sacAmp: 0.12, glance: { viewer: 0.55, neighbor: 0.4, away: 0.05 }, hold: [1.2, 3], acts: [{ act: 'wink', every: [5, 10] }, { act: 'waggle', every: [8, 14] }] },
    sing: { gain: 1.0, brow: 0.2, browPow: 1, close: 0, closePow: 1, squint: 0.2, bob: 0.9, tilt: 0, smile: 0.45, pupil: 0.1, glow: 0.4, waggle: 0.5 },
    react: {
      select: [[0.1, { lidUpL: 1.3, lidLowL: 0.45, browRaiseR: 0.5, browRaiseL: -0.5, browTiltL: -0.4, mouthSmirk: 0.4, mouthSmile: 0.45, mouthOpen: 0.18, headRoll: -0.2, headYaw: 0.1 }], [0.45, { lidUpL: 1.3, lidLowL: 0.45, browRaiseR: 0.55, browRaiseL: -0.5, mouthSmile: 0.45, mouthSmirk: 0.4, mouthOpen: 0.15, headRoll: -0.2 }], [0.7, { browRaiseR: 0.6, mouthSmile: 0.4, mouthSmirk: 0.4, headRoll: -0.12 }], [0.85, { browRaiseR: 0.1 }], [1.0, { browRaiseR: 0.6 }], [1.6, {}]],
      wake: [[0.4, { lidUpL: 1.2, mouthSmirk: 0.4, browRaiseR: 0.5 }], [0.75, { lidUpL: 0, browRaiseR: 0.4 }], [1.4, {}]],
    },
  },
  proud: {
    rest: { browRaise: 0.25, browTilt: -0.1, lidUp: 0.48, lidLow: 0.12, pupil: 0.45, lookPitch: -0.14, mouthSmile: 0.32, mouthWidth: -0.15, headPitch: 0.25, irisGlow: 1, antenna: 0.75 },
    idle: { blink: [3, 6], blinkDur: 0.24, double: 0.05, saccade: [2, 4], sacAmp: 0.05, glance: { viewer: 0.6, neighbor: 0.15, away: 0.25 }, hold: [2, 4.5], acts: [{ act: 'preen', every: [7, 12] }] },
    sing: { gain: 1.05, brow: 0.35, browPow: 1, close: 0.45, closePow: 1, squint: 0, bob: 0.5, tilt: 0.12, smile: 0.25, pupil: 0.1, glow: 0.5 },
    react: {
      select: [[0.15, { headPitch: 0.2, lidUp: 0.5, browRaise: 0.55, browTilt: -0.2, mouthSmile: 0.4, mouthSmirk: 0.25, headYaw: -0.22, antenna: 0.4 }], [0.9, { headPitch: 0.22, lidUp: 0.55, browRaise: 0.6, mouthSmile: 0.45, mouthSmirk: 0.3, headYaw: -0.24 }], [1.5, { headPitch: 0.1, lidUp: 0.15, browRaise: 0.2 }], [2.1, {}]],
      wake: [[0.5, { headPitch: 0.15, lidUp: 0.3, mouthSmile: 0.3 }], [0.9, { headPitch: -0.06 }], [1.4, {}]],
    },
  },
  nervous: {
    rest: { browRaise: 0.42, browTilt: 0.8, browSqueeze: 0.35, lidUp: 0, lidLow: 0.05, pupil: 0.16, mouthSmile: -0.3, mouthWidth: 0.8, mouthOpen: 0.05, headPitch: -0.05, irisGlow: 1, antenna: 0.2 },
    idle: { blink: [1, 2.5], blinkDur: 0.09, double: 0.3, saccade: [0.25, 0.7], sacAmp: 0.22, glance: { viewer: 0.3, neighbor: 0.5, away: 0.2 }, hold: [0.6, 1.6], twitch: 0.7, acts: [{ act: 'gulp', every: [5, 9] }, { act: 'dart', every: [4, 7] }] },
    sing: { gain: 0.9, brow: 0.25, browPow: 1, close: 0, closePow: 1, squint: 0, bob: 0.6, tilt: 0, smile: -0.2, pupil: -0.05, glow: 0.3, tremble: 0.5 },
    react: {
      select: [[0.05, { browRaise: 0.8, browTilt: 0.3, lidUp: -0.1, lidLow: -0.1, pupil: -0.25, eyeZoom: 1, mouthWidth: 0.4, mouthSmile: -0.6, mouthOpen: 0.2, headPitch: -0.16, antenna: 0.8 }], [0.25, { lookYaw: -0.55, browRaise: 0.8, eyeZoom: 1, mouthSmile: -0.6, mouthOpen: 0.15, headYaw: -0.08 }], [0.45, { lookYaw: 0.55, browRaise: 0.75, eyeZoom: 0.9, mouthSmile: -0.5, headYaw: 0.08 }], [0.65, { lookYaw: -0.35, browRaise: 0.6, mouthSmile: -0.4 }], [0.95, { browRaise: 0.45, mouthSmile: -0.25, mouthWidth: -0.4 }], [1.7, {}]],
      wake: [[0.3, { lookYaw: -0.4, eyeZoom: 0.8 }], [0.5, { lookYaw: 0.4 }], [0.75, { mouthWidth: -0.5, mouthSmile: -0.3, lidUp: 0.3 }], [1.3, {}]],
    },
  },
  dreamy: {
    rest: { browRaise: 0.3, browTilt: 0.32, browArch: 0.3, lidUp: 0.38, lidLow: 0.18, pupil: 0.82, lookPitch: 0.3, lookYaw: 0.1, mouthSmile: 0.45, mouthWidth: -0.2, mouthOpen: 0.03, headRoll: 0.18, headPitch: 0.1, irisGlow: 1.05, antenna: 0.1 },
    idle: { blink: [3.5, 6.5], blinkDur: 0.3, double: 0.05, saccade: [2, 4.5], sacAmp: 0.06, glance: { viewer: 0.2, neighbor: 0.15, up: 0.65 }, hold: [2.5, 5], sway: 0.6, acts: [{ act: 'sway', every: [6, 10] }] },
    sing: { gain: 0.9, brow: 0.3, browPow: 1, close: 0.55, closePow: 1, squint: 0.1, bob: 0.35, tilt: 0.08, smile: 0.35, pupil: 0.1, glow: 0.45, sway: 0.6 },
    react: {
      select: [[0.3, { lookPitch: -0.36, lookYaw: -0.1, lidUp: -0.3, pupil: 0.2, browRaise: 0.4, mouthOpen: 0.16, mouthRound: 0.6, mouthSmile: 0.1, headRoll: 0.08 }], [0.95, { lookPitch: -0.3, lookYaw: -0.1, lidUp: 0.4, lidLow: 0.2, mouthSmile: 0.5, blush: 0.75, headRoll: 0.22, browTilt: 0.3 }], [1.8, { lookPitch: -0.15, lidUp: 0.25, blush: 0.4, headRoll: 0.12 }], [2.6, {}]],
      wake: [[0.6, { lookPitch: -0.25, mouthSmile: 0.3, lidUp: -0.15, mouthOpen: 0.15, mouthRound: 0.5 }], [1.6, {}]],
    },
  },
  zany: {
    rest: { browRaiseL: 0.95, browRaiseR: -0.55, browTiltL: 0.4, browTiltR: -0.75, browArch: 0.5, lidUpL: 0, lidUpR: 0.32, lidLowL: 0, lidLowR: 0.2, pupilL: 0.92, pupilR: 0.22, mouthSmile: 0.6, mouthSmirk: -0.6, mouthWidth: 0.45, mouthOpen: 0.13, headRoll: -0.16, irisGlow: 1.3, antenna: 0.9 },
    idle: { blink: [1.5, 4], blinkDur: 0.1, double: 0.25, saccade: [0.3, 1.0], sacAmp: 0.25, glance: { viewer: 0.4, neighbor: 0.4, away: 0.2 }, hold: [0.8, 2], twitch: 0.4, pulse: 0.35, acts: [{ act: 'crazy', every: [4, 8] }, { act: 'swap', every: [6, 10] }] },
    sing: { gain: 1.25, brow: 0.5, browPow: 1, close: 0, closePow: 1, squint: 0, bob: 1.4, tilt: 0.1, smile: 0.5, pupil: 0.3, glow: 0.8, waggle: 0.8 },
    react: {
      select: [[0.08, { browRaiseL: -1.2, browRaiseR: 1.4, pupilL: -0.6, pupilR: 0.6, mouthOpen: 0.7, mouthSmile: 0.4, eyeZoom: 1, headRoll: 0.32, irisGlow: 0.8, antenna: 1 }], [0.3, { browRaiseL: 1.2, browRaiseR: -1.0, pupilL: 0.6, pupilR: -0.5, headRoll: -0.3, mouthOpen: 0.4, eyeZoom: 1 }], [0.55, { browRaiseL: -1.0, browRaiseR: 1.2, headRoll: 0.25, mouthSmirk: 0.8, mouthOpen: 0.3 }], [0.8, { browRaise: 0.4, lookYaw: 0.3, mouthOpen: 0.3, headRoll: -0.1 }], [1.4, {}]],
      wake: [[0.3, { browRaiseL: 1, browRaiseR: -1, pupilL: 0.5, pupilR: -0.5, headRoll: 0.3, eyeZoom: 1 }], [0.6, { browRaiseL: -1, browRaiseR: 1, headRoll: -0.3 }], [0.9, { mouthOpen: 0.5, mouthSmile: 0.5 }], [1.4, {}]],
    },
  },
  wistful: {
    rest: { browRaise: 0.12, browTilt: 0.6, browSqueeze: 0.12, lidUp: 0.42, lidLow: 0.14, lidTilt: 0.25, pupil: 0.72, lookPitch: 0.18, lookYaw: 0.2, mouthSmile: 0.12, mouthWidth: -0.3, mouthOpen: 0.02, headRoll: 0.16, headPitch: 0.04, headYaw: 0.08, irisGlow: 0.88, antenna: -0.35 },
    idle: { blink: [3, 6.5], blinkDur: 0.26, double: 0.08, saccade: [2.2, 4.8], sacAmp: 0.05, glance: { viewer: 0.35, neighbor: 0.25, up: 0.25, down: 0.15 }, hold: [2.5, 5.5], sway: 0.35, acts: [{ act: 'longing', every: [7, 12] }, { act: 'softsigh', every: [9, 15] }] },
    sing: { gain: 0.85, brow: 0.25, browPow: 1, close: 0.3, closePow: 1.5, squint: 0.08, bob: 0.4, tilt: 0.08, smile: 0.3, pupil: 0.1, glow: 0.45, swoon: 0.5 },
    react: {
      select: [[0.15, { browRaise: 0.35, lidUp: -0.25, pupil: 0.2, lookPitch: -0.18, lookYaw: -0.2, mouthSmile: 0.2, headPitch: 0.06, irisGlow: 0.35 }], [0.8, { browRaise: 0.2, lidUp: 0.05, lookPitch: -0.12, lookYaw: -0.15, mouthSmile: 0.35, blush: 0.35, headRoll: -0.08 }], [1.6, { mouthSmile: 0.2, blush: 0.2, lookYaw: -0.05 }], [2.3, {}]],
      wake: [[0.5, { lidUp: 0.2, lookPitch: 0.15, browTilt: 0.15, mouthSmile: 0.1 }], [1.3, { lookPitch: -0.1, lookYaw: -0.15, mouthSmile: 0.25, headPitch: 0.05 }], [2, {}]],
    },
    after: 'softsigh',
  },
  curious: {
    rest: { browRaiseL: 0.62, browRaiseR: 0.18, browTiltL: 0, browTiltR: 0.3, browArch: 0.25, lidUp: 0.08, pupil: 0.66, lookPitch: 0.04, mouthSmile: 0.1, mouthWidth: -0.25, mouthOpen: 0.03, mouthRound: 0.12, mouthSmirk: 0.12, headRoll: 0.12, headPitch: 0.02, irisGlow: 1.12, antenna: 0.5 },
    idle: { blink: [2.4, 5], blinkDur: 0.14, double: 0.15, saccade: [0.6, 1.5], sacAmp: 0.12, glance: { viewer: 0.4, neighbor: 0.35, away: 0.15, up: 0.1 }, hold: [1.2, 3], acts: [{ act: 'cockleft', every: [3, 6.5] }, { act: 'cockright', every: [3, 6.5] }, { act: 'peer', every: [3, 6.5] }] },
    sing: { gain: 1, brow: 0.3, browPow: 1, close: 0, closePow: 1, squint: 0.1, bob: 0.7, tilt: 0.04, smile: 0.35, pupil: 0.2, glow: 0.4, cock: 1 },
    react: {
      select: [[0.1, { browRaise: 0.4, lidUp: -0.15, pupil: 0.2, mouthOpen: 0.12, mouthRound: 0.3, eyeZoom: 0.7, headRoll: 0.2, headPitch: 0.1, antenna: 0.6, irisGlow: 0.4 }], [0.55, { browRaiseL: 0.45, browRaiseR: 0.2, pupil: 0.15, mouthOpen: 0.05, mouthRound: 0.2, eyeZoom: 0.3, headRoll: -0.24, headPitch: 0.06, antenna: 0.4, irisGlow: 0.3 }], [1.2, { browRaiseL: 0.3, headRoll: 0.12, headPitch: 0.04, antenna: 0.3 }], [1.9, {}]],
      wake: [[0.35, { browRaise: 0.35, lidUp: -0.1, headRoll: 0.2, headPitch: 0.06, lookYaw: -0.3, antenna: 0.5 }], [0.8, { browRaise: 0.3, headRoll: -0.22, lookYaw: 0.3, mouthRound: 0.2, antenna: 0.4 }], [1.3, { browRaiseL: 0.2, headRoll: 0.12, lookYaw: 0 }], [1.8, {}]],
    },
  },
  gentle: {
    rest: { browRaise: 0.22, browTilt: 0.32, browArch: 0.22, lidUp: 0.24, lidLow: 0.3, pupil: 0.76, mouthSmile: 0.62, mouthWidth: 0.05, headRoll: 0.09, headPitch: -0.03, blush: 0.18, irisGlow: 1.05, antenna: 0.2 },
    idle: { blink: [3, 6], blinkDur: 0.22, double: 0.1, saccade: [1.8, 4], sacAmp: 0.05, glance: { viewer: 0.55, neighbor: 0.4, down: 0.05 }, hold: [2, 4.5], sway: 0.15, acts: [{ act: 'kindnod', every: [6, 11] }, { act: 'slowblink', every: [9, 15] }] },
    sing: { gain: 0.9, brow: 0.2, browPow: 1, close: 0.2, closePow: 1, squint: 0.25, bob: 0.45, tilt: 0.05, smile: 0.5, pupil: 0.1, glow: 0.4 },
    react: {
      select: [[0.2, { browRaise: 0.25, lidUp: -0.12, mouthSmile: 0.25, blush: 0.3, headPitch: 0.06, irisGlow: 0.3 }], [0.9, { lidLow: 0.2, mouthSmile: 0.35, blush: 0.35, headRoll: 0.12, headPitch: -0.04 }], [1.7, { mouthSmile: 0.2, blush: 0.15 }], [2.4, {}]],
      wake: [[0.5, { lidUp: 0.12, mouthSmile: 0.3, blush: 0.2, headPitch: -0.05 }], [1.2, { lidLow: 0.15, mouthSmile: 0.35, headRoll: 0.08 }], [1.9, {}]],
    },
  },
  stoic: {
    rest: { browRaise: -0.04, browTilt: -0.06, browSqueeze: 0.04, lidUp: 0.22, lidLow: 0.12, lidTilt: -0.05, pupil: 0.4, mouthSmile: -0.05, mouthWidth: -0.1, irisGlow: 0.9, antenna: 0.05 },
    idle: { blink: [5, 9], blinkDur: 0.2, double: 0, saccade: [4, 8], sacAmp: 0.02, glance: { viewer: 0.85, neighbor: 0.15 }, hold: [4, 8], acts: [{ act: 'nod', every: [6, 11] }, { act: 'nodtwice', every: [14, 22] }] },
    sing: { gain: 0.72, brow: 0.04, browPow: 1, close: 0.04, closePow: 1, squint: 0, bob: 0.15, tilt: 0, smile: 0.04, pupil: 0, glow: 0.12 },
    react: {
      select: [[0.4, { headPitch: -0.13, browRaise: 0.16, lidUp: -0.06, irisGlow: 0.25 }], [1, { headPitch: -0.13, browRaise: 0.12, lidUp: -0.06, irisGlow: 0.2 }], [1.7, { headPitch: 0.02 }], [2.3, {}]],
      wake: [[0.35, { lidUp: 0.5 }], [0.75, { lidUp: 0.5 }], [1.15, { headPitch: -0.1, browRaise: 0.08 }], [1.7, { headPitch: -0.08, browRaise: 0.04 }], [2.3, {}]],
    },
  },
  giddy: {
    rest: { browRaise: 0.7, browTilt: 0.3, browArch: 0.3, lidUp: 0, lidLow: 0.2, pupil: 0.85, mouthSmile: 0.95, mouthWidth: 0.7, mouthOpen: 0.2, headPitch: 0.08, blush: 0.3, irisGlow: 1.28, antenna: 0.85 },
    idle: { blink: [1.6, 3.6], blinkDur: 0.1, double: 0.3, saccade: [0.45, 1.1], sacAmp: 0.13, glance: { viewer: 0.5, neighbor: 0.45, up: 0.05 }, hold: [1, 2.4], pulse: 0.06, acts: [{ act: 'bounce', every: [4, 8] }, { act: 'squeal', every: [7, 12] }] },
    sing: { gain: 1.2, brow: 0.3, browPow: 1, close: 0, closePow: 1, squint: 0.3, bob: 1.7, tilt: 0.06, smile: 0.95, pupil: 0.2, glow: 0.5, beatBrows: 0.5, nod: 1 },
    react: {
      select: [[0.08, { browRaise: 0.35, lidUp: -0.1, lidLow: -0.1, pupil: 0.2, mouthOpen: 0.45, mouthWidth: 0.1, eyeZoom: 0.8, headPitch: 0.14, antenna: 0.6, irisGlow: 0.5, blush: 0.15 }], [0.35, { browRaise: 0.25, lidLow: 0.15, mouthOpen: 0.25, headRoll: 0.14, headPitch: -0.05, antenna: 0.3, eyeZoom: 0.3 }], [0.65, { browRaise: 0.3, mouthOpen: 0.3, headRoll: -0.14, headPitch: 0.1, antenna: 0.5 }], [0.95, { browRaise: 0.2, mouthOpen: 0.2, headRoll: 0.1, headPitch: -0.03 }], [1.3, { browRaise: 0.12, headRoll: 0.04 }], [1.9, {}]],
      wake: [[0.3, { browRaise: 0.4, lidLow: 0.1, mouthOpen: 0.4, headPitch: 0.14, antenna: 0.5, eyeZoom: 0.6 }], [0.6, { browRaise: 0.2, mouthOpen: 0.25, headPitch: -0.06 }], [0.9, { browRaise: 0.3, mouthOpen: 0.35, headPitch: 0.12, antenna: 0.4 }], [1.2, { mouthOpen: 0.2, headPitch: -0.03 }], [1.7, {}]],
    },
  },
  hopeful: {
    rest: { browRaise: 0.5, browTilt: 0.28, browArch: 0.4, lidUp: 0.02, lidLow: 0.08, pupil: 0.8, lookPitch: 0.22, mouthSmile: 0.45, mouthWidth: -0.05, mouthOpen: 0.05, mouthRound: 0.12, headPitch: 0.15, irisGlow: 1.22, antenna: 0.6 },
    idle: { blink: [2.4, 5], blinkDur: 0.13, double: 0.15, saccade: [0.9, 2.2], sacAmp: 0.08, glance: { viewer: 0.5, neighbor: 0.3, up: 0.2 }, hold: [1.4, 3.2], pulse: 0.04, acts: [{ act: 'brighten', every: [5, 9] }, { act: 'lookup', every: [7, 12] }] },
    sing: { gain: 1.05, brow: 0.35, browPow: 1, close: 0.08, closePow: 1, squint: 0.15, bob: 0.8, tilt: 0.12, smile: 0.55, pupil: 0.15, glow: 0.55, beatBrows: 0.2 },
    react: {
      select: [[0.08, { browRaise: 0.35, lidUp: -0.15, eyeZoom: 0.7, irisGlow: 0.6, mouthOpen: 0.3, mouthSmile: 0.35, headPitch: 0.12, antenna: 0.8 }], [0.6, { browRaise: 0.25, eyeZoom: 0.3, mouthSmile: 0.45, mouthOpen: 0.12, headPitch: 0.08, irisGlow: 0.4, blush: 0.2 }], [1.4, { mouthSmile: 0.25, headPitch: 0.03 }], [2, {}]],
      wake: [[0.35, { browRaise: 0.35, lidUp: -0.2, eyeZoom: 0.5, irisGlow: 0.6, mouthSmile: 0.35, headPitch: 0.1, antenna: 0.6 }], [1, { browRaise: 0.2, mouthSmile: 0.4, headPitch: 0.05 }], [1.6, {}]],
    },
  },
  romantic: {
    rest: { browRaise: 0.45, browTilt: 0.6, browArch: 0.35, lidUp: 0.26, lidLow: 0.3, lidTilt: 0.35, pupil: 0.86, lookPitch: -0.08, mouthSmile: 0.4, mouthWidth: -0.4, mouthOpen: 0.02, mouthRound: 0.2, headRoll: -0.14, headPitch: -0.02, headYaw: 0.08, blush: 0.35, irisGlow: 1.15, antenna: 0.15 },
    idle: { blink: [3, 6], blinkDur: 0.26, double: 0.35, saccade: [2, 4.5], sacAmp: 0.05, glance: { viewer: 0.6, neighbor: 0.25, down: 0.15 }, hold: [2.5, 5], acts: [{ act: 'flutter', every: [5, 9] }, { act: 'swoon', every: [9, 15] }] },
    sing: { gain: 0.85, brow: 0.18, browPow: 1, close: 0.18, closePow: 1, squint: 0.12, bob: 0.3, tilt: 0.05, smile: 0.4, pupil: 0.1, glow: 0.45, blush: 0.2, swoon: 1 },
    react: {
      select: [[0.2, { lidUp: -0.1, pupil: 0.1, browRaise: 0.3, browTilt: 0.2, mouthOpen: 0.1, mouthRound: 0.3, blush: 0.45, headPitch: 0.08, irisGlow: 0.35 }], [0.8, { lidUp: 0.28, browRaise: 0.2, browTilt: 0.25, mouthSmile: 0.3, blush: 0.55, headRoll: -0.16, headPitch: 0.1, irisGlow: 0.3, antenna: -0.2 }], [1.7, { lidUp: 0.32, mouthSmile: 0.3, blush: 0.5, headRoll: -0.14, headPitch: 0.08 }], [2.5, { lidUp: 0.1, blush: 0.25 }], [3, {}]],
      wake: [[0.5, { lidUp: 0.3, mouthSmile: 0.25, blush: 0.4, headRoll: -0.12, headPitch: 0.06, mouthOpen: 0.08, mouthRound: 0.2 }], [1.5, { lidUp: 0.18, blush: 0.3, headRoll: -0.08 }], [2.2, {}]],
    },
  },
  bored: {
    rest: { browRaise: -0.18, browTilt: 0.05, lidUp: 0.52, lidLow: 0.06, pupil: 0.36, lookYaw: 0.14, lookPitch: 0.04, mouthSmile: -0.2, mouthWidth: -0.3, mouthSmirk: 0.2, headRoll: 0.1, headPitch: -0.06, headYaw: 0.1, irisGlow: 0.8, antenna: -0.35 },
    idle: { blink: [3.5, 7], blinkDur: 0.3, double: 0, saccade: [2.5, 5.5], sacAmp: 0.04, glance: { viewer: 0.2, neighbor: 0.1, away: 0.4, up: 0.2, down: 0.1 }, hold: [3, 6], acts: [{ act: 'stare', every: [7, 12] }, { act: 'exhale', every: [10, 16] }] },
    sing: { gain: 0.7, brow: 0.05, browPow: 1, close: 0, closePow: 1, squint: 0, bob: 0.25, tilt: -0.02, smile: -0.1, pupil: 0, glow: 0.15 },
    react: {
      select: [[0.3, { lidUp: -0.3, browRaise: 0.4, browTilt: 0.1, pupil: 0.15, headPitch: 0.08, lookYaw: -0.15, irisGlow: 0.3 }], [0.9, { lidUp: -0.12, browRaise: 0.2, headPitch: 0.04, lookYaw: -0.1 }], [1.5, { lidUp: 0.12, browRaise: -0.05, mouthOpen: 0.14, mouthRound: 0.3, headPitch: -0.1, antenna: -0.2 }], [2.1, { lidUp: 0.08, headPitch: -0.04 }], [2.6, {}]],
      wake: [[0.5, { lidUp: -0.15, browRaise: 0.2, headPitch: 0.05 }], [1.1, { lidUp: 0.15, mouthOpen: 0.16, mouthRound: 0.4, headPitch: -0.1, antenna: -0.2 }], [1.8, { lidUp: 0.08 }], [2.3, {}]],
    },
    after: 'exhale',
  },
  goofy: {
    rest: { browRaiseL: 0.3, browRaiseR: 0.1, browTilt: 0.4, browArch: 0.2, lidUpL: 0.12, lidUpR: 0.2, lidLow: 0.14, pupilL: 0.7, pupilR: 0.56, lookPitch: 0.08, mouthSmile: 0.55, mouthWidth: 0.5, mouthOpen: 0.16, mouthSmirk: 0.3, headRoll: 0.14, headPitch: -0.05, blush: 0.12, antenna: -0.3 },
    idle: { blink: [1.8, 4], blinkDur: 0.16, double: 0.2, saccade: [1.2, 2.8], sacAmp: 0.16, glance: { viewer: 0.4, neighbor: 0.3, away: 0.15, up: 0.15 }, hold: [1.5, 3.5], pulse: 0.18, sway: 0.7, cross: 0.65, acts: [{ act: 'wobble', every: [4, 8] }, { act: 'boing', every: [8, 14] }] },
    sing: { gain: 1.1, brow: 0.2, browPow: 1, close: 0, closePow: 1, squint: 0.15, bob: 1.1, tilt: 0, smile: 0.6, pupil: 0.15, glow: 0.4, waggle: 0.3, sway: 0.5 },
    react: {
      select: [[0.1, { browRaise: 0.45, lidUp: -0.1, pupil: -0.25, mouthOpen: 0.4, eyeZoom: 0.8, headRoll: 0.2, headPitch: 0.1, antenna: 0.8, irisGlow: 0.3 }], [0.5, { browRaise: 0.3, pupil: -0.2, mouthOpen: 0.35, eyeZoom: 0.5, headRoll: -0.24, antenna: 0.1 }], [1, { browRaise: 0.2, mouthOpen: 0.25, eyeZoom: 0.2, headRoll: 0.16, lookYaw: 0.2 }], [1.6, { headRoll: 0.06 }], [2.2, {}]],
      wake: [[0.35, { lookYaw: 0.3, lookPitch: 0.1, headRoll: -0.2, mouthOpen: 0.25, browRaise: 0.3, eyeZoom: 0.5, antenna: 0.6 }], [0.8, { lookYaw: -0.3, lookPitch: 0.1, headRoll: 0.2, mouthOpen: 0.3, browRaise: 0.2, eyeZoom: 0.2, antenna: 0.1 }], [1.2, { lookYaw: 0.1, lookPitch: 0.05, headRoll: -0.1, mouthOpen: 0.2, browRaise: 0.1 }], [1.8, {}]],
    },
  },
  wise: {
    rest: { browRaiseL: 0, browRaiseR: 0.28, browTilt: -0.08, browArch: 0.25, lidUp: 0.28, lidLow: 0.26, mouthSmile: 0.4, mouthWidth: -0.12, mouthSmirk: 0.35, headRoll: -0.05, headPitch: -0.03, irisGlow: 1.05, antenna: 0.1 },
    idle: { blink: [4, 8], blinkDur: 0.62, double: 0, saccade: [3, 6], sacAmp: 0.03, glance: { viewer: 0.55, neighbor: 0.3, down: 0.15 }, hold: [3, 6.5], acts: [{ act: 'slowblink', every: [6, 11] }, { act: 'knowing', every: [10, 16] }] },
    sing: { gain: 0.85, brow: 0.15, browPow: 1, close: 0.2, closePow: 1, squint: 0.12, bob: 0.3, tilt: 0.04, smile: 0.45, pupil: 0.05, glow: 0.35 },
    react: {
      select: [[0.5, { browRaise: 0.2, browTilt: -0.1, lidUp: -0.05, mouthSmile: 0.15, mouthSmirk: 0.1, headPitch: -0.1, irisGlow: 0.25 }], [1.1, { browRaise: 0.25, browTilt: -0.1, lidUp: 0.45, lidLow: 0.05, mouthSmile: 0.2, mouthSmirk: 0.12, headPitch: -0.12, irisGlow: 0.2 }], [1.6, { browRaise: 0.15, lidUp: 0.45, mouthSmile: 0.2, mouthSmirk: 0.1, headPitch: -0.1 }], [2.1, { lidUp: 0.05, headPitch: 0.02 }], [2.7, {}]],
      wake: [[0.5, { lidUp: 0.5, mouthSmile: 0.15, headPitch: -0.04 }], [0.9, { lidUp: 0.55, mouthSmile: 0.15, headPitch: -0.04 }], [1.5, { lidUp: 0.05, mouthSmile: 0.12, browRaiseR: 0.12 }], [2.2, {}]],
    },
  },
  starstruck: {
    rest: { browRaise: 0.7, browTilt: 0.12, browArch: 0.55, lidUp: 0, lidLow: 0, pupil: 0.88, mouthSmile: 0.3, mouthWidth: -0.1, mouthOpen: 0.14, mouthRound: 0.35, headPitch: 0.12, blush: 0.3, irisGlow: 1.32, antenna: 0.65 },
    idle: { blink: [4, 8], blinkDur: 0.11, double: 0.1, saccade: [0.6, 1.5], sacAmp: 0.08, glance: { viewer: 0.55, neighbor: 0.15, up: 0.3 }, hold: [1.4, 3.2], pulse: 0.14, acts: [{ act: 'gasp', every: [5, 9] }, { act: 'twinkle', every: [7, 12] }] },
    sing: { gain: 1, brow: 0.3, browPow: 1, close: 0, closePow: 1, squint: 0, bob: 0.7, tilt: 0.1, smile: 0.45, pupil: 0.1, glow: 0.65 },
    react: {
      select: [[0.06, { browRaise: 0.3, mouthOpen: 0.55, mouthRound: 0.55, mouthSmile: -0.25, eyeZoom: 1, headPitch: 0.2, antenna: 0.4, irisGlow: 0.8, blush: 0.2 }], [0.6, { browRaise: 0.25, mouthOpen: 0.45, mouthRound: 0.45, mouthSmile: -0.2, eyeZoom: 0.7, headPitch: 0.18, irisGlow: 0.6, blush: 0.25 }], [1.2, { mouthOpen: 0.2, mouthRound: 0.2, mouthSmile: 0.1, eyeZoom: 0.3, headPitch: 0.1, irisGlow: 0.35, blush: 0.2 }], [2, {}]],
      wake: [[0.25, { mouthOpen: 0.45, mouthRound: 0.5, mouthSmile: -0.2, eyeZoom: 0.8, browRaise: 0.3, headPitch: 0.12, irisGlow: 0.6, antenna: 0.4 }], [0.9, { mouthOpen: 0.3, mouthRound: 0.4, mouthSmile: -0.1, eyeZoom: 0.4, browRaise: 0.15, headPitch: 0.1, irisGlow: 0.4 }], [1.6, {}]],
    },
  },
};

/** Little personal moves played now and then while idle (offset timelines). */
const ACT_TABLE = {
  giggle: [[0.1, { lidLow: 0.35, mouthSmile: 0.2, mouthOpen: 0.28, headRoll: 0.08 }], [0.25, { lidLow: 0.35, mouthOpen: 0.2, headPitch: 0.07 }], [0.4, { lidLow: 0.35, mouthOpen: 0.28, headPitch: -0.04 }], [0.55, { lidLow: 0.3, mouthOpen: 0.2, headPitch: 0.06 }], [0.7, { lidLow: 0.25, headPitch: -0.03 }], [1.1, {}]],
  harrumph: [[0.1, { browRaise: -0.4, browSqueeze: 0.2, mouthWidth: -0.45, mouthSmile: -0.2, lidUp: 0.15 }], [0.3, { browRaise: -0.4, mouthWidth: -0.45, headYaw: -0.12 }], [0.5, { browRaise: -0.4, mouthWidth: -0.4, headYaw: 0.12 }], [0.7, { browRaise: -0.3, headYaw: -0.06 }], [1.2, {}]],
  peek: [[0.4, { lookYaw: -0.3, lookPitch: 0.24, headYaw: -0.12, headPitch: 0.06 }], [0.85, { lookYaw: -0.3, lookPitch: 0.24, headYaw: -0.12 }], [1.05, { lookYaw: 0.4, lookPitch: -0.2, blush: 0.6, headYaw: 0.15 }], [1.9, { blush: 0.35 }], [2.5, {}]],
  sigh: [[0.4, { lidUp: 0.6, headPitch: 0.16, browTilt: 0.3, mouthOpen: 0.15 }], [1.2, { lidUp: 0.65, headPitch: 0.2, mouthOpen: 0.1 }], [1.8, {}]],
  yawn: [[0.5, { mouthOpen: 0.9, mouthRound: 0.4, mouthWidth: -0.2, lidUp: 0.3, lidLow: 0.3, browRaise: 0.6, browTilt: 0.4, headPitch: 0.2 }], [1.6, { mouthOpen: 0.95, mouthRound: 0.4, lidUp: 0.3, browRaise: 0.7, headPitch: 0.22 }], [2.2, { mouthOpen: 0.1, lidUp: 0.2 }], [2.8, {}]],
  doze: [[0.8, { lidUp: 0.4, headPitch: -0.2, antenna: -0.4 }], [1.6, { lidUp: 0.45, headPitch: -0.28, antenna: -0.5 }], [1.75, { lidUp: -0.5, headPitch: 0.05, browRaise: 0.6, eyeZoom: 0.6, antenna: 0.8 }], [2.4, {}]],
  wink: [[0.1, { lidUpL: 1.2, lidLowL: 0.3, mouthSmirk: 0.3, browRaiseL: -0.3 }], [0.35, { lidUpL: 1.2, lidLowL: 0.3, mouthSmirk: 0.3, browRaiseL: -0.3 }], [0.6, {}]],
  waggle: [[0.1, { browRaise: 0.5 }], [0.25, { browRaise: -0.1 }], [0.4, { browRaise: 0.5 }], [0.55, { browRaise: -0.1 }], [0.9, {}]],
  preen: [[0.4, { headPitch: 0.12, headYaw: 0.25, lidUp: 0.35, mouthSmile: 0.15 }], [1.4, { headPitch: 0.12, headYaw: 0.25, lidUp: 0.35, mouthSmile: 0.15 }], [2.0, {}]],
  gulp: [[0.15, { mouthWidth: -0.6, mouthSmile: -0.2, lidUp: 0.3, browRaise: 0.3, headPitch: -0.08 }], [0.35, { mouthWidth: -0.4, headPitch: 0.04 }], [0.7, {}]],
  dart: [[0.1, { lookYaw: 0.45 }], [0.3, { lookYaw: -0.45 }], [0.5, { lookYaw: 0.3 }], [0.7, {}]],
  sway: [[1.0, { headRoll: -0.3, lookYaw: -0.15 }], [2.2, { headRoll: -0.3, lookYaw: -0.1 }], [3.2, {}]],
  crazy: [[0.1, { pupilL: 0.5, pupilR: -0.4, lookYaw: 0.4 }], [0.3, { lookYaw: -0.4, pupilL: -0.4, pupilR: 0.5 }], [0.5, { lookYaw: 0.2, eyeZoom: 1, mouthOpen: 0.4 }], [0.9, {}]],
  swap: [[0.3, { browRaiseL: -1.4, browRaiseR: 1.4, browTiltL: -1.0, browTiltR: 1.0 }], [1.2, { browRaiseL: -1.4, browRaiseR: 1.4, browTiltL: -1.0, browTiltR: 1.0 }], [1.6, {}]],
  cockleft: [[0.2, { headRoll: 0.16, headPitch: 0.03, browRaiseL: 0.22, pupil: 0.08, antenna: 0.25 }], [0.9, { headRoll: 0.2, headPitch: 0.04, browRaiseL: 0.28, pupil: 0.1, antenna: 0.3 }], [1.5, { headRoll: 0.06, browRaiseL: 0.08 }], [1.9, {}]],
  cockright: [[0.2, { headRoll: -0.3, headPitch: 0.03, browRaiseR: 0.22, pupil: 0.08, antenna: 0.25 }], [0.9, { headRoll: -0.34, headPitch: 0.04, browRaiseR: 0.28, pupil: 0.1, antenna: 0.3 }], [1.5, { headRoll: -0.1, browRaiseR: 0.08 }], [1.9, {}]],
  peer: [[0.4, { headPitch: -0.1, browRaise: 0.2, lidUp: -0.1, pupil: 0.15, eyeZoom: 0.35, antenna: 0.3, mouthRound: 0.1 }], [1.3, { headPitch: -0.12, browRaise: 0.25, lidUp: -0.1, pupil: 0.18, eyeZoom: 0.4, antenna: 0.35, mouthRound: 0.12 }], [1.9, {}]],
  browlift: [[0.2, { browRaiseL: 0.28, browRaiseR: -0.12, browTiltL: -0.1, mouthSmirk: -0.2, headRoll: 0.06, headPitch: 0.05, lidUpL: -0.08 }], [1.1, { browRaiseL: 0.3, browRaiseR: -0.14, browTiltL: -0.1, mouthSmirk: -0.22, headRoll: 0.07, headPitch: 0.05, lidUpL: -0.08 }], [1.6, {}]],
  nod: [[0.8, { headPitch: -0.13, lidUp: 0.1, browRaise: 0.04 }], [1.2, { headPitch: -0.13, lidUp: 0.1, browRaise: 0.04 }], [2.1, { headPitch: 0.02 }], [2.7, {}]],
  nodtwice: [[0.7, { headPitch: -0.12, lidUp: 0.08 }], [1.2, { headPitch: 0.01, lidUp: 0.02 }], [1.9, { headPitch: -0.12, lidUp: 0.08 }], [2.6, { headPitch: 0.02 }], [3.2, {}]],
  bounce: [[0.15, { headPitch: 0.13, browRaise: 0.2, antenna: 0.3, mouthOpen: 0.08 }], [0.5, { headPitch: -0.08, browRaise: 0.08, antenna: -0.1, mouthOpen: 0.02 }], [0.85, { headPitch: 0.13, browRaise: 0.2, antenna: 0.3, mouthOpen: 0.08 }], [1.2, { headPitch: -0.08, browRaise: 0.08, antenna: -0.1, mouthOpen: 0.02 }], [1.55, { headPitch: 0.12, browRaise: 0.18, antenna: 0.25, mouthOpen: 0.08 }], [1.9, { headPitch: -0.03 }], [2.3, {}]],
  squeal: [[0.12, { lidUp: 0.22, lidLow: 0.22, mouthOpen: 0.3, mouthWidth: 0.2, browRaise: 0.2, headRoll: 0.14, blush: 0.2 }], [0.55, { lidUp: 0.22, lidLow: 0.22, mouthOpen: 0.32, mouthWidth: 0.2, browRaise: 0.22, headRoll: -0.14, blush: 0.22 }], [1, { lidUp: 0.18, lidLow: 0.18, mouthOpen: 0.25, mouthWidth: 0.15, browRaise: 0.15, headRoll: 0.1, blush: 0.18 }], [1.5, {}]],
  flutter: [[0.08, { lidUp: 0.55, browRaise: 0.12 }], [0.18, { lidUp: 0, browRaise: 0.14 }], [0.28, { lidUp: 0.55, browRaise: 0.16 }], [0.38, { lidUp: 0, browRaise: 0.16 }], [0.48, { lidUp: 0.5, browRaise: 0.14 }], [0.6, { lidUp: 0, browRaise: 0.12, blush: 0.12 }], [1, { headRoll: -0.06, blush: 0.15 }], [1.5, {}]],
  swoon: [[0.7, { lidUp: 0.4, headRoll: -0.16, headPitch: 0.1, blush: 0.3, mouthSmile: 0.2, browTilt: 0.2, antenna: -0.3 }], [1.9, { lidUp: 0.45, headRoll: -0.2, headPitch: 0.12, blush: 0.4, mouthSmile: 0.25, browTilt: 0.25, antenna: -0.4 }], [2.3, { lidUp: 0.1, headRoll: -0.06, headPitch: 0.05, blush: 0.2, mouthSmile: 0.1, mouthOpen: 0.1, mouthRound: 0.2, antenna: -0.1 }], [3, { blush: 0.1 }], [3.6, {}]],
  stare: [[0.5, { lookYaw: 0.2, lookPitch: 0.18, pupil: -0.1, lidUp: 0.05, headPitch: 0.04 }], [2, { lookYaw: 0.22, lookPitch: 0.2, pupil: -0.12, lidUp: 0.06, headPitch: 0.05 }], [2.7, {}]],
  exhale: [[0.5, { lidUp: 0.12, headPitch: -0.1, mouthOpen: 0.16, mouthRound: 0.4, mouthWidth: -0.2, browRaise: -0.1, browTilt: 0.1, antenna: -0.25 }], [1.3, { lidUp: 0.14, headPitch: -0.12, mouthOpen: 0.12, mouthRound: 0.3, mouthWidth: -0.2, browRaise: -0.1, antenna: -0.3 }], [2, { lidUp: 0.06, headPitch: -0.04, mouthOpen: 0.04 }], [2.6, {}]],
  wobble: [[0.25, { headRoll: -0.18, mouthOpen: 0.12, lookYaw: 0.25, lookPitch: 0.1, browRaise: 0.1 }], [0.7, { headRoll: 0.18, mouthOpen: 0.16, lookYaw: -0.25, lookPitch: 0.12, browRaise: 0.15 }], [1.2, { headRoll: -0.13, mouthOpen: 0.1, lookYaw: 0.2, lookPitch: 0.08, browRaise: 0.1 }], [1.7, { headRoll: 0.04, mouthOpen: 0.04, lookYaw: 0, lookPitch: 0, browRaise: 0.04 }], [2.2, {}]],
  boing: [[0.15, { antenna: 0.9, browRaise: 0.35, eyeZoom: 0.5, mouthOpen: 0.25, pupil: -0.2, headPitch: 0.08 }], [0.45, { antenna: -0.3, browRaise: 0.15, eyeZoom: 0.2, mouthOpen: 0.2, pupil: -0.2, headPitch: 0.02 }], [0.8, { antenna: 0.5, browRaise: 0.25, eyeZoom: 0.3, mouthOpen: 0.22, pupil: -0.15, headPitch: 0.05 }], [1.3, {}]],
  slowblink: [[0.3, { lidUp: 0.7, lidLow: 0.1, mouthSmile: 0.1, headPitch: -0.02 }], [0.55, { lidUp: 0.75, lidLow: 0.1, mouthSmile: 0.12, headPitch: -0.03 }], [1.1, { lidUp: 0.1, mouthSmile: 0.05 }], [1.5, {}]],
  knowing: [[0.5, { mouthSmile: 0.2, mouthSmirk: 0.2, browRaiseR: 0.3, lidLow: 0.1, lidUp: 0.05, headPitch: -0.05 }], [1.5, { mouthSmile: 0.24, mouthSmirk: 0.22, browRaiseR: 0.34, lidLow: 0.12, lidUp: 0.05, headPitch: -0.06 }], [1.9, { headPitch: 0.02, mouthSmile: 0.1 }], [2.6, {}]],
  gasp: [[0.07, { mouthOpen: 0.4, mouthRound: 0.5, mouthSmile: -0.2, eyeZoom: 0.8, browRaise: 0.25, headPitch: 0.1, antenna: 0.35, irisGlow: 0.3 }], [0.7, { mouthOpen: 0.35, mouthRound: 0.5, mouthSmile: -0.2, eyeZoom: 0.6, browRaise: 0.22, headPitch: 0.1, antenna: 0.3, irisGlow: 0.25 }], [1, { mouthOpen: 0.12, mouthRound: 0.2, mouthSmile: -0.05, eyeZoom: 0.2, browRaise: 0.1, headPitch: 0.04, irisGlow: 0.1 }], [1.5, {}]],
  longing: [[0.6, { lookYaw: 0.25, lookPitch: 0.2, headYaw: 0.1, headPitch: 0.08, lidUp: 0.12, browTilt: 0.2, mouthSmile: 0.1 }], [2, { lookYaw: 0.28, lookPitch: 0.22, headYaw: 0.12, headPitch: 0.1, lidUp: 0.15, browTilt: 0.22, mouthSmile: 0.12 }], [2.8, {}]],
  softsigh: [[0.4, { lidUp: 0.25, headPitch: 0.08, browTilt: 0.2, mouthOpen: 0.08, mouthRound: 0.3 }], [1.3, { lidUp: 0.28, headPitch: 0.1, mouthOpen: 0.05, mouthRound: 0.2 }], [2, {}]],
  brighten: [[0.15, { browRaise: 0.25, lidUp: -0.1, eyeZoom: 0.4, irisGlow: 0.5, mouthSmile: 0.25, headPitch: 0.06, antenna: 0.4 }], [0.7, { browRaise: 0.2, eyeZoom: 0.25, irisGlow: 0.4, mouthSmile: 0.3, headPitch: 0.05, antenna: 0.3 }], [1.4, {}]],
  lookup: [[0.4, { lookPitch: 0.3, lookYaw: -0.12, headPitch: 0.12, browRaise: 0.2, mouthSmile: 0.15, mouthOpen: 0.05 }], [1.6, { lookPitch: 0.32, lookYaw: -0.1, headPitch: 0.14, browRaise: 0.22, mouthSmile: 0.18 }], [2.3, {}]],
  kindnod: [[0.5, { headPitch: -0.1, lidLow: 0.12, mouthSmile: 0.15, headRoll: 0.06 }], [1.1, { headPitch: -0.1, lidLow: 0.12, mouthSmile: 0.15, headRoll: 0.06 }], [1.8, { headPitch: 0.02 }], [2.4, {}]],
  twinkle: [[0.12, { irisGlow: 0.55, pupil: 0.06, blush: 0.1 }], [0.3, { irisGlow: 0.1, pupil: -0.1, blush: 0.08 }], [0.48, { irisGlow: 0.6, pupil: 0.06, blush: 0.15 }], [0.66, { irisGlow: 0.1, pupil: -0.1, blush: 0.1 }], [0.84, { irisGlow: 0.55, pupil: 0.05, blush: 0.15, headRoll: 0.06 }], [1.5, {}]],
  stir: [[0.12, { lidUpL: -0.35, lidUpR: -0.1, browRaise: 0.3, headPitch: 0.14, antenna: 0.7, mouthOpen: 0.1, mouthRound: 0.3 }], [0.5, { lidUpL: -0.25, browRaise: 0.22, headPitch: 0.1, antenna: 0.35, mouthOpen: 0.06 }], [1.2, { lidUpL: -0.05, browRaise: 0.06, headPitch: 0.03 }], [1.9, {}]],
};

export const ACTS = Object.freeze(Object.fromEntries(Object.entries(ACT_TABLE).map(([k, v]) => [k, compileTimeline(v, k)])));

/** The reboot every head runs after "Randomize" (then its own flourish, see `randomizeTimeline`). */
const BOOT_KEYS = [
  [0.08, { lidUp: 1.4, lidLow: 0.6, irisGlow: -1.6, browRaise: -0.8, mouthOpen: -0.5, mouthSmile: -0.5, headPitch: -0.2, antenna: -1.6 }],
  [0.32, { lidUp: 1.4, lidLow: 0.6, irisGlow: -1.6, headRoll: 0.26, browRaise: -0.8, antenna: -1.6 }],
  [0.48, { lidUp: 1.4, lidLow: 0.6, irisGlow: -1.4, headRoll: -0.26, browRaise: 0.9 }],
  [0.64, { lidUp: 1.4, lidLow: 0.5, irisGlow: -1.2, headRoll: 0.12, browRaise: -0.6 }],
  [0.84, { lidUp: -0.4, lidLow: -0.2, irisGlow: 1, pupil: -0.6, browRaise: 0.7, eyeZoom: 1, antenna: 1.4 }],
  [1.05, { lidUp: -0.3, irisGlow: 0.7, pupil: 0.55, browRaise: 0.5, mouthOpen: 0.45, mouthRound: 0.5, eyeZoom: 0.8 }],
];

function randomizeKeys(id) {
  // after the boot: the new personality shows itself off (its rest face, exaggerated), then settles
  const rest = STYLE_TABLE[id].rest;
  const flourish = {};
  for (const [k, v] of Object.entries(rest)) {
    const names = PAIRS[k] ?? [k];
    const base = NEUTRAL[CH[names[0]]];
    flourish[k] = (v - base) * 0.6;
  }
  return [...BOOT_KEYS, [1.45, flourish], [2.0, flourish], [2.6, {}]];
}

function weights(table) {
  const keys = ['viewer', 'neighbor', 'away', 'up', 'down'];
  const w = keys.map((k) => table[k] ?? 0);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return keys.map((k, i) => {
    acc += w[i] / sum;
    return [k, acc];
  });
}

function compileStyle(id, def) {
  const rest = writeValues(def.rest, Float32Array.from(NEUTRAL));
  const idle = def.idle;
  return Object.freeze({
    id,
    label: PERSONALITIES[id]?.label ?? id,
    rest: clampChannels(rest),
    idle: {
      blink: idle.blink,
      blinkDur: idle.blinkDur,
      double: idle.double ?? 0.1,
      saccade: idle.saccade,
      sacAmp: idle.sacAmp,
      glance: weights(idle.glance),
      hold: idle.hold ?? [1.5, 4],
      twitch: idle.twitch ?? 0,
      pulse: idle.pulse ?? 0,
      sway: idle.sway ?? 0,
      cross: idle.cross ?? 0,
      acts: (idle.acts ?? []).map((a) => ({ tl: ACTS[a.act], every: a.every })),
    },
    sing: { browPow: 1, closePow: 1, tiltPow: 1, waggle: 0, tremble: 0, sway: 0, blush: 0, beatBrows: 0, cock: 0, nod: 0, swoon: 0, ...def.sing },
    after: def.after ? ACTS[def.after] : null,
    reactions: {
      select: compileTimeline(def.react.select, `${id}.select`),
      wake: compileTimeline(def.react.wake, `${id}.wake`),
      randomize: compileTimeline(randomizeKeys(id), `${id}.randomize`),
    },
  });
}

/** Compiled styles by personality id (every id of PERSONALITIES). */
export const PERSONALITY_STYLES = Object.freeze(Object.fromEntries(PERSONALITY_IDS.map((id) => [id, compileStyle(id, STYLE_TABLE[id])])));

/** Retired ids -> their replacement (owner: no angry faces). */
export const RETIRED_PERSONALITIES = Object.freeze({ grumpy: 'wistful', sassy: 'gentle', suspicious: 'hopeful' });

export const DEFAULT_PERSONALITY = 'cheerful';

export function normalizePersonality(id) {
  if (id != null && RETIRED_PERSONALITIES[id]) id = RETIRED_PERSONALITIES[id];
  return PERSONALITY_STYLES[id] ? id : DEFAULT_PERSONALITY;
}

export function personalityStyle(id) {
  return PERSONALITY_STYLES[id] ?? PERSONALITY_STYLES[DEFAULT_PERSONALITY];
}

export const REACTIONS = Object.freeze(['select', 'wake', 'randomize']);

// ------------------------------------------------------------------ vowels

/** Mouth shape per sung vowel class: opening (x level), width (-1 oo .. 1 ee), rounding. */
export const VOWEL_SHAPES = Object.freeze({
  a: Object.freeze({ open: 1.0, width: 0.15, round: 0 }), //   ah: la, wah, father
  e: Object.freeze({ open: 0.68, width: 0.55, round: 0 }), //  eh: rest, step
  i: Object.freeze({ open: 0.38, width: 1.0, round: 0 }), //   ee: be, lieve, me
  I: Object.freeze({ open: 0.52, width: 0.62, round: 0 }), //  ih: in, lit, thing
  o: Object.freeze({ open: 0.82, width: -0.45, round: 0.72 }), // oh: on, bom, hold
  u: Object.freeze({ open: 0.42, width: -1.0, round: 1.0 }), // oo: you, doo, ooh
  U: Object.freeze({ open: 0.62, width: 0.1, round: 0.1 }), //  uh: up, love, but
  ai: Object.freeze({ open: 0.9, width: 0.35, round: 0 }), //   I, my, shine, mind
  au: Object.freeze({ open: 0.85, width: -0.2, round: 0.45 }), // out, now
  r: Object.freeze({ open: 0.48, width: -0.25, round: 0.35 }), // wor, er
  m: Object.freeze({ open: 0.04, width: 0.05, round: 0.15 }), //  hum: mm
});

const OW_AU = new Set(['now', 'how', 'wow', 'cow', 'bow', 'vow', 'pow', 'brow', 'down', 'town', 'gown', 'crown', 'brown', 'clown', 'frown', 'drown']);
const WORDS = { i: 'ai', are: 'a', you: 'u', the: 'U', a: 'U', of: 'U', one: 'U', love: 'U', come: 'U', some: 'U', done: 'U', great: 'e' };

/**
 * The vowel class a syllable is sung on, from its spelling ("lieve" -> 'i', "you" -> 'u',
 * "Mm" -> 'm', "shine" -> 'ai'). Good enough for a robot choir's lip sync.
 */
export function vowelOf(text) {
  const s = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 'a';
  if (/^h?m+$|^[mn]+$|^hm+$/.test(s)) return 'm';
  if (WORDS[s]) return WORDS[s];
  if (!/[aeiouy]/.test(s)) return 'U';
  if (/igh|ind$/.test(s)) return 'ai';
  if (/oo|ue|ew/.test(s)) return 'u';
  if (/our$/.test(s)) return 'o'; // your, four
  if (/ow/.test(s)) return OW_AU.has(s) ? 'au' : 'o'; // slow, show / now, down
  if (/ou/.test(s)) return 'au'; // out, hours
  if (/ee|ea|ie|ei/.test(s)) return 'i'; // be-lieve, leave, breathe, wea-ry
  if (/ai|ay|ey$/.test(s)) return 'e'; // day, hey
  if (/oa|oe/.test(s)) return 'o';
  if (/au|aw/.test(s)) return 'a';
  if (/oi|oy/.test(s)) return 'o';
  if (/^[^aeiou]+le$/.test(s)) return 'U'; // lit-tle
  if (/^w?or|[^aeiou](er|ir|ur)[^aeiou]*$/.test(s) && !/[aeiou].*[aeiou].*r/.test(s)) return 'r'; // wor-ries, her
  // magic e: a single vowel, consonants, final e ("shine", "hope", "take", "eve")
  const magic = /^[^aeiouy]*([aeiou])[^aeiouy]+e$/.exec(s);
  if (magic) return { a: 'e', e: 'i', i: 'ai', o: 'o', u: 'u' }[magic[1]];
  // y as the vowel: "my", "fly", "by" -> ai; a weak ending ("ry", "ty", "ly") -> ee
  if (!/[aeiou]/.test(s)) return /^[rtlnds]y$/.test(s) || s.length > 4 ? 'i' : 'ai';
  const v = /[aeiou]/.exec(s)[0];
  if (v === 'a') return 'a';
  if (v === 'e') return /^[^aeiou]*e$/.test(s) ? 'i' : 'e'; // be, me, we, re
  if (v === 'i') return /i$/.test(s) ? 'ai' : 'I';
  if (v === 'o') return /^(d|t|wh|tw)o$/.test(s) ? 'u' : 'o'; // do, to, who / go, on, hold
  return 'U';
}

/** How shut the lips are at the start of a syllable: 0 = closed (m, b, p), 1 = no closure. */
export function onsetClosure(text) {
  const s = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^[mbp]/.test(s)) return 0;
  if (/^[fv]/.test(s)) return 0.25;
  if (/^(w|wh|oo|u)/.test(s)) return 0.35;
  return 0.55;
}

// ------------------------------------------------------------------ the expression state machine

/** What the eyes aim at (the head turns these into directions). */
export const GAZE = Object.freeze({ VIEWER: 0, LEFT: 1, RIGHT: 2, FREE: 3 });

const between = (rng, range) => range[0] + rng() * (range[1] - range[0]);

/** Per-head expression state (allocation-free to step). */
export function createExpression(personality = DEFAULT_PERSONALITY, seed = 1) {
  const rng = makeRng(seed);
  const style = personalityStyle(personality);
  const s = {
    style,
    rng,
    time: 0,
    blinkWait: 0.5 + rng() * 2,
    blinkT: -1,
    blinkDouble: false,
    blink: 0,
    sacWait: rng(),
    sacYaw: 0,
    sacPitch: 0,
    gaze: GAZE.VIEWER,
    glanceWait: 1 + rng() * 2,
    glanceYaw: 0,
    glancePitch: 0,
    actWait: 0,
    act: null,
    actT: 0,
    reaction: null,
    reactionKind: '',
    reactionT: 0,
    twitchWait: 1,
    twitchCh: -1,
    twitchV: 0,
    twitchT: 0,
    bobX: 0,
    bobV: 0,
    beat: 0,
    noteT: -1,
    swoon: 0,
    sung: 0,
    lineCool: 0,
    cross: 0,
    phase: rng() * Math.PI * 2,
  };
  s.actWait = firstActWait(s);
  return s;
}

function firstActWait(s) {
  const acts = s.style.idle.acts;
  return acts.length ? 2 + s.rng() * acts[0].every[1] : Infinity;
}

/** Switches personality (keeps timers; a running act ends). */
export function setExpressionPersonality(s, id) {
  const style = personalityStyle(id);
  if (style === s.style) return false;
  s.style = style;
  s.act = null;
  s.actWait = firstActWait(s);
  return true;
}

/** Starts a reaction: 'select' | 'wake' | 'randomize' (unknown kinds are ignored). */
export function triggerReaction(s, kind) {
  const tl = s.style.reactions[kind];
  if (!tl) return false;
  s.reaction = tl;
  s.reactionKind = kind;
  s.reactionT = 0;
  s.act = null; // a reaction interrupts an idle act
  if (kind !== 'select') s.blinkT = -1;
  return true;
}

/** Reaction currently playing ('' when none). */
export function activeReaction(s) {
  return s.reaction ? s.reactionKind : '';
}

const MUTED_POSE = writeValues(
  { lidUp: 0.72, lidLow: 0.25, browRaise: -0.35, browTilt: 0.1, irisGlow: 0.3, pupil: 0.3, mouthOpen: 0, mouthSmile: 0, headPitch: -0.16, antenna: -0.9, blush: 0 },
  Float32Array.from(NEUTRAL),
);
const MUTED_MASK = writeValues({ lidUp: 1, lidLow: 1, browRaise: 1, browTilt: 1, irisGlow: 1, pupil: 1, mouthOpen: 1, mouthSmile: 1, headPitch: 1, antenna: 1, blush: 1 }, new Float32Array(CHANNEL_COUNT));

/**
 * Input of one step: { level 0..1 (singing, smoothed), vowel (VOWEL_SHAPES entry or null),
 *   artic 0..1 (articulation: dips toward 0 at a closed onset, back to 1), syllable (true on the frame a
 *   new syllable starts), selected, hovered, muted (0..1 amounts or booleans), neighbors (true when
 *   there are heads to glance at) }.
 */
export function createExpressionInput() {
  return { level: 0, vowel: null, artic: 1, syllable: false, selected: 0, hovered: 0, muted: 0, neighbors: true };
}

/**
 * Advances the state by `dt` and writes the channel targets into `out` (Float32Array(CHANNEL_COUNT)).
 * The gaze target is in `s.gaze` (GAZE), its free offsets are part of out[lookYaw / lookPitch].
 */
export function stepExpression(s, dt, input, out) {
  const st = s.style;
  const idle = st.idle;
  const sing = st.sing;
  const rng = s.rng;
  s.time += dt;
  const t = s.time;
  const level = Math.min(1, Math.max(0, input.level || 0));
  const muted = +input.muted || 0;
  const selected = +input.selected || 0;
  const attention = Math.max(selected, +input.hovered || 0);
  const quiet = 1 - Math.min(1, level * 1.6); // idle life fades while singing loud

  out.set(st.rest);

  // a syllable that keeps sounding is a held note: it eases the swoon in (romantic)
  if (input.syllable) s.noteT = 0;
  else if (s.noteT >= 0) s.noteT = level > 0.15 || s.noteT < 0.3 ? s.noteT + dt : -1;
  const swoonWant = sing.swoon !== 0 && s.noteT > 0.7 ? Math.min(1, Math.max(0, (s.noteT - 0.7) / 0.8)) : 0;
  s.swoon += (swoonWant - s.swoon) * Math.min(1, dt * (swoonWant > s.swoon ? 2.5 : 6));

  // ---- singing: mouth from the level and the vowel, the personality's singing face
  const k = level > 0.02 ? Math.min(1, level * 3.5) : 0; // how much the singing face takes over
  const vowel = input.vowel;
  if (k > 0) {
    const shape = vowel ?? VOWEL_SHAPES.a;
    const amp = Math.pow(level, 0.75) * sing.gain;
    const open = amp * shape.open * (0.35 + 0.65 * (input.artic ?? 1));
    out[CH.mouthOpen] = out[CH.mouthOpen] * (1 - k) + open;
    out[CH.mouthWidth] += (shape.width - out[CH.mouthWidth]) * k * 0.85;
    out[CH.mouthRound] += (shape.round - out[CH.mouthRound]) * k;
    out[CH.mouthSmile] += (sing.smile - out[CH.mouthSmile]) * k * (1 - 0.5 * shape.round);
    const bl = sing.brow * Math.pow(level, sing.browPow);
    out[CH.browRaiseL] += bl;
    out[CH.browRaiseR] += bl;
    const cl = sing.close * Math.pow(level, sing.closePow);
    out[CH.lidUpL] += cl;
    out[CH.lidUpR] += cl;
    out[CH.lidLowL] += sing.squint * level;
    out[CH.lidLowR] += sing.squint * level;
    out[CH.pupilL] += sing.pupil * level;
    out[CH.pupilR] += sing.pupil * level;
    out[CH.irisGlow] += sing.glow * level;
    out[CH.headPitch] += sing.tilt * Math.pow(level, sing.tiltPow ?? 1);
    out[CH.blush] += (sing.blush ?? 0) * level;
    if (sing.sway) out[CH.headRoll] += sing.sway * 0.12 * level * Math.sin(t * 1.3 + s.phase);
    if (sing.tremble) {
      const tr = sing.tremble * level * 0.12 * Math.sin(t * 31 + s.phase);
      out[CH.browRaiseL] += tr;
      out[CH.browRaiseR] -= tr * 0.7;
    }
  }
  if (input.syllable) {
    s.bobV += 0.9 * sing.bob * (0.4 + level);
    s.beat ^= 1;
  }
  // syllable bob: a damped spring (critically-ish damped, ~0.3 s)
  {
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / 0.016)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -160 * s.bobX - 18 * s.bobV;
      s.bobV += a * h;
      s.bobX += s.bobV * h;
    }
  }
  out[CH.headPitch] -= s.bobX * 0.05;
  if (k > 0) {
    if (sing.waggle) {
      const w = sing.waggle * 0.35 * k;
      out[CH.browRaiseL] += s.beat ? w : -w * 0.4;
      out[CH.browRaiseR] += s.beat ? -w * 0.4 : w;
    }
    if (sing.beatBrows) {
      const b = sing.beatBrows * Math.max(0, s.bobX) * 3;
      out[CH.browRaiseL] += b;
      out[CH.browRaiseR] += b;
    }
    // every syllable tips the head to the other side / nods the other way (curious, giddy)
    if (sing.cock) out[CH.headRoll] += sing.cock * 0.12 * (s.beat ? 1 : -1) * k;
    if (sing.nod) out[CH.headPitch] += sing.nod * 0.1 * (s.beat ? 1 : -1) * k;
  }
  if (s.swoon > 0.002) {
    // a held note: lids sink, head tips back, cheeks glow (romantic)
    const sw = sing.swoon * s.swoon;
    out[CH.lidUpL] += 0.3 * sw;
    out[CH.lidUpR] += 0.3 * sw;
    out[CH.headRoll] -= 0.12 * sw;
    out[CH.headPitch] += 0.1 * sw;
    out[CH.browTiltL] += 0.25 * sw;
    out[CH.browTiltR] += 0.25 * sw;
    out[CH.mouthSmile] += 0.2 * sw;
    out[CH.blush] += 0.3 * sw;
    out[CH.antenna] -= 0.25 * sw;
  }

  // ---- idle life: zany pulses, dreamy sways
  if (idle.pulse) {
    out[CH.pupilL] += idle.pulse * Math.sin(t * 5.1 + s.phase);
    out[CH.pupilR] += idle.pulse * Math.sin(t * 3.7 + s.phase * 1.7);
    out[CH.irisGlow] += idle.pulse * 0.5 * Math.sin(t * 7.3);
  }
  if (idle.sway) out[CH.headRoll] += idle.sway * 0.08 * Math.sin(t * 0.55 + s.phase);

  // twitches (nervous / zany): a brow channel jumps for a moment
  if (idle.twitch > 0) {
    s.twitchWait -= dt;
    if (s.twitchWait <= 0) {
      s.twitchWait = (0.4 + rng() * 1.6) / idle.twitch;
      s.twitchCh = rng() < 0.5 ? (rng() < 0.5 ? CH.browRaiseL : CH.browRaiseR) : rng() < 0.5 ? CH.browTiltL : CH.browTiltR;
      s.twitchV = (rng() * 2 - 1) * 0.5 * idle.twitch;
      s.twitchT = 0.12 + rng() * 0.1;
    }
    if (s.twitchT > 0) {
      s.twitchT -= dt;
      out[s.twitchCh] += s.twitchV;
    }
  }

  // the line is over (sung a while, then silent): the style's after-line act, e.g. bored sighs
  if (st.after) {
    s.lineCool -= dt;
    if (level > 0.12) s.sung += dt;
    else if (level < 0.03) {
      if (s.sung > 1.2 && s.lineCool <= 0 && !s.act && !s.reaction) {
        s.act = st.after;
        s.actT = 0;
        s.lineCool = 4;
        s.actWait = Math.max(s.actWait, 3);
      }
      s.sung = 0;
    }
  }
  // crossed eyes (goofy): the renderer turns each eye in (see robot-head.js)
  s.cross = idle.cross > 0 ? Math.min(1, Math.max(0, idle.cross * (0.8 + 0.2 * Math.sin(t * 0.9 + s.phase * 1.3)))) : 0;

  // idle acts (yawn, wink, ...), only when not singing loud and no reaction is playing
  if (s.act) {
    s.actT += dt;
    if (!sampleTimeline(s.act, s.actT, quiet, out)) s.act = null;
  } else if (!s.reaction && idle.acts.length) {
    s.actWait -= dt * (quiet > 0.5 ? 1 : 0.25);
    if (s.actWait <= 0) {
      const pick = idle.acts[Math.floor(rng() * idle.acts.length) % idle.acts.length];
      s.act = pick.tl;
      s.actT = 0;
      s.actWait = between(rng, pick.every);
    }
  }

  // gaze: glances (viewer / neighbours / away / up / down) and saccades
  s.glanceWait -= dt;
  if (s.glanceWait <= 0) {
    const r = rng();
    let mode = 'viewer';
    const gl = idle.glance;
    for (let i = 0; i < gl.length; i++) {
      if (r <= gl[i][1]) {
        mode = gl[i][0];
        break;
      }
    }
    s.glanceWait = between(rng, idle.hold);
    s.glanceYaw = 0;
    s.glancePitch = 0;
    if (mode === 'neighbor' && input.neighbors !== false) s.gaze = rng() < 0.5 ? GAZE.LEFT : GAZE.RIGHT;
    else if (mode === 'away') {
      s.gaze = GAZE.FREE;
      s.glanceYaw = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.25);
      s.glancePitch = (rng() * 2 - 1) * 0.12;
    } else if (mode === 'up') {
      s.gaze = GAZE.FREE;
      s.glanceYaw = (rng() * 2 - 1) * 0.2;
      s.glancePitch = 0.22 + rng() * 0.12;
    } else if (mode === 'down') {
      s.gaze = GAZE.FREE;
      s.glanceYaw = (rng() * 2 - 1) * 0.25;
      s.glancePitch = -0.2 - rng() * 0.1;
    } else s.gaze = GAZE.VIEWER;
  }
  s.sacWait -= dt;
  if (s.sacWait <= 0) {
    s.sacWait = between(rng, idle.saccade);
    s.sacYaw = (rng() * 2 - 1) * idle.sacAmp;
    s.sacPitch = (rng() * 2 - 1) * idle.sacAmp * 0.6;
  }
  const look = 1 - 0.6 * (1 - quiet); // singers look around less
  out[CH.lookYaw] += (s.glanceYaw + s.sacYaw) * look;
  out[CH.lookPitch] += (s.glancePitch + s.sacPitch) * look;

  // blinks (a double now and then); a blink also nudges the lower lids and the brows
  s.blinkWait -= dt;
  if (s.blinkT < 0 && s.blinkWait <= 0) s.blinkT = 0;
  s.blink = 0;
  if (s.blinkT >= 0) {
    s.blinkT += dt;
    const u = s.blinkT / idle.blinkDur;
    if (u >= 1) {
      s.blinkT = -1;
      if (!s.blinkDouble && rng() < idle.double) {
        s.blinkDouble = true;
        s.blinkWait = 0.08;
      } else {
        s.blinkDouble = false;
        s.blinkWait = between(rng, idle.blink);
      }
    } else s.blink = u < 0.33 ? u / 0.33 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45; // shut, hold, open
  }
  // (the upper shutters themselves follow s.blink directly, after the springs: a blink is a crisp
  // mechanical stroke, see blinkLid)
  if (s.blink > 0) {
    const b = s.blink;
    out[CH.lidLowL] += 0.25 * b;
    out[CH.lidLowR] += 0.25 * b;
    out[CH.browRaiseL] -= 0.08 * b;
    out[CH.browRaiseR] -= 0.08 * b;
  }

  // attention: picked or pointed at -> looks at you, a bit brighter and more alert
  if (attention > 0) {
    out[CH.browRaiseL] += 0.12 * attention;
    out[CH.browRaiseR] += 0.12 * attention;
    out[CH.irisGlow] += 0.25 * attention;
    out[CH.lidUpL] -= 0.06 * attention;
    out[CH.lidUpR] -= 0.06 * attention;
    out[CH.lookYaw] *= 1 - 0.7 * attention;
    out[CH.lookPitch] *= 1 - 0.5 * attention;
    if (attention > 0.5 && s.gaze !== GAZE.VIEWER && !s.reaction) {
      s.gaze = GAZE.VIEWER;
      s.glanceWait = Math.max(s.glanceWait, 1.5);
    }
  }

  // reactions on top of everything
  if (s.reaction) {
    s.reactionT += dt;
    if (!sampleTimeline(s.reaction, s.reactionT, 1, out)) {
      s.reaction = null;
      s.reactionKind = '';
    }
  }

  // muted: powered down (half-shut, dim, drooping); reactions still show through a little
  if (muted > 0) {
    const m = muted * (s.reaction ? 0.5 : 1);
    for (let i = 0; i < CHANNEL_COUNT; i++) if (MUTED_MASK[i]) out[i] += (MUTED_POSE[i] - out[i]) * m;
  }
  return clampChannels(out);
}

/** Upper lid closure with a blink stroke on top (lidUp 0..1, blink 0..1). */
export function blinkLid(lidUp, blink) {
  return lidUp + (1 - lidUp) * blink;
}

/** The settled face of a personality in a given situation (no idle life): for previews and tests. */
export function poseOf(id, { level = 0, vowel = null, reaction = null, at = 0 } = {}, out = new Float32Array(CHANNEL_COUNT)) {
  const s = createExpression(id, 1);
  s.blinkWait = Infinity;
  s.sacWait = Infinity;
  s.glanceWait = Infinity;
  s.actWait = Infinity;
  s.style = { ...s.style, idle: { ...s.style.idle, pulse: 0, twitch: 0, sway: 0, cross: 0, acts: [] }, sing: { ...s.style.sing, sway: 0, tremble: 0, cock: 0, nod: 0, swoon: 0 } };
  if (reaction) {
    triggerReaction(s, reaction);
    s.reactionT = Math.max(0, at - 1e-3);
  }
  const input = createExpressionInput();
  input.level = level;
  input.vowel = vowel ? VOWEL_SHAPES[vowel] : null;
  return stepExpression(s, 1e-3, input, out);
}
