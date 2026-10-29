// Group: the stadium wave (Unity Plays/StadiumWave.cs). Three to five neighbours in a row hold their hands ready; from
// the next beat, both hands shoot up (open, palms to the viewer) one bot after another along the row, half a beat apart,
// each head hopping up with an "ooh!" mouth, and down again as the next one goes up: across the row from the starter's
// end and back. Then they all giggle or cheer.
import * as THREE from 'three';
import { SHAPES, lerpShape, rowAt, rowOrder, slerpDir, smoother, v3 } from './kit.js';
import { aimInBot } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0);
/** Beats from one bot to the next; the rise, the hold and the fall of one bot's hands (s: the same at any tempo). */
const BEATS = 0.5, RISE = 0.42, HOLD = 0.14, FALL = 0.5;
const CHEERS = ['bounce', 'brighten', 'squeal', 'twinkle', 'giggle'];
/** How many times the wave crosses the row (there and back; and there again in a row of three). */
const passes = (s) => (s.count <= 3 ? 3 : 2);

/** When (beats from the first) member k's hands go up on pass p: there along the row, then back. */
function due(s, k, pass) {
  const n = s.count;
  let pos = s.value > 0 ? s.I[k] : n - 1 - s.I[k];
  if ((pass & 1) === 1) pos = n - 1 - pos;
  return pass * ((n - 1) * BEATS + 0.75) + pos * BEATS;
}

/** 0 hands ready .. 1 up: a quick rise, a short hold, a slower fall (seconds since it was due). */
function lift(u) {
  if (u < 0) return 0;
  if (u < RISE) return smoother(u / RISE);
  if (u < RISE + HOLD) return 1;
  return 1 - smoother((u - RISE - HOLD) / FALL);
}

/** Both hands: ready at the sides (a little raised) .. straight up above the head, open, palms to the viewer. */
function pose(s, k, l) {
  for (let side = -1; side <= 1; side += 2) {
    const at = v3(1.2, -0.25, 0.45).lerp(v3(1.1, 1.2, 0.35), l);
    const fingers = slerpDir(v3(0.1, 0.6, 0.8), v3(0.18, 1, 0.05), l);
    const palm = slerpDir(v3(-0.9, 0.1, 0.4), v3(0.05, 0, 1), l);
    const shape = lerpShape(SHAPES.relaxed, SHAPES.open, 0.25 + 0.75 * l);
    // a little shake of the raised hands
    if (l > 0.5) at.x += 0.05 * (l - 0.5) * Math.sin(s.t * 22 + k + side);
    s.hand(k, side, aimInBot(side, at, fingers, palm, shape));
  }
}

export default {
  id: 'stadium-wave',
  cast: 'group',
  row: true,
  maxSeconds: 14,
  blendIn: 0.4,
  blendOut: 0.45,

  tryCast(s) {
    rowOrder(s);
    return true;
  },

  begin(s) {
    // the wave starts at the starter's end of the row
    s.value = s.I[0] * 2 <= s.count - 1 ? 1 : -1;
    s.mark = s.nextBeat(s.beat, 0.5);
    s.act(0, s.profile(0).mischief, 'mischief');
    s.note('ready', 0);
  },

  step(s) {
    const n = s.count, np = passes(s);
    const b = s.beat - s.mark;
    for (let k = 0; k < n; k++) {
      let l = 0;
      for (let p = 0; p < np; p++) l = Math.max(l, lift((b - due(s, k, p)) * s.beatSec));
      // events: up, down, up, down (the head hops with the hands)
      const e = Math.floor(s.F[k]);
      if (e < 2 * np) {
        const at = due(s, k, Math.floor(e / 2)) + ((e & 1) === 0 ? 0 : (RISE + HOLD) / s.beatSec);
        if (b >= at) {
          s.F[k] = e + 1;
          if ((e & 1) === 0) {
            s.note((e & 2) === 0 ? 'up' : 'back', k);
            s.go(k, UP.clone().multiplyScalar(0.4 * s.radius(k) * Math.min(1.1, s.profile(k).move)), 14, 0.7);
            s.face(k).flickAntenna(new THREE.Vector3(0, 0.1, 0));
          } else s.home(k, 9, 0.6);
        }
      }
      pose(s, k, l);
      const face = s.face(k);
      face.add('mouthOpen', 0.45 * l);
      face.add('mouthRound', 0.4 * l);
      face.add('browRaiseL', 0.35 * l);
      face.add('browRaiseR', 0.35 * l);
      face.tilt(0, 0.08 * l);
    }
    const last = rowAt(s, (s.value > 0) === ((np & 1) === 0) ? 0 : n - 1);
    const end = due(s, last, np - 1) + (RISE + HOLD + FALL) / s.beatSec;
    if (s.phase === 0 && b > end + 0.1) {
      s.note('done', 0);
      for (let k = 0; k < n; k++) {
        s.home(k);
        const next = rowAt(s, s.I[k] + 1 < n ? s.I[k] + 1 : s.I[k] - 1);
        const cheer = s.chance(0.5);
        s.react(k, 0.1 + 0.12 * k, cheer ? CHEERS : s.profile(k).giggle, cheer ? 'cheer' : 'giggle', next, 1.2);
      }
      s.next(1);
    }
    if (s.phase === 1 && s.phaseT > 0.3) s.done();
  },
};
