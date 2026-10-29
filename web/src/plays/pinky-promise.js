// Duo: a pinky promise (Unity Plays/PinkyPromise.cs). Two neighbours look at each other; their RIGHT hands (always) come
// up as fists in front of the gap between them, low (the one whose right hand is its outer one reaches across under its
// chin), thumbs on top, palms toward each other, each little finger stretched out toward the other. The fists close in
// (never touching), B's little finger reaches past A's and curls round it, hooking it (the two little fingers touching),
// and the hooked hands shake on the beat, three times, both heads nodding along. Then the finger unhooks, the hands come
// down and both give a kind nod.
import * as THREE from 'three';
import { handShape } from '../scene/hand-rig.js';
import { CAP_COUNT, KNUCKLES_LOCAL, digitOf, makeCapsules, posedCapsules, segmentDistance } from '../scene/hand-touch.js';
import { SHAPES, aimByThumb, approach, duoCast, duoFrame, duoNow, lerpShape, meet, palmOf, smooth } from './kit.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const HOOK0 = meet(0.5, 0, -1.05, 1.1, 2.6, 2.6);
const MARKS = [HOOK0];
/** A fist with the little finger out straight / curled round the other's (B's), its end joints hooked. */
export const PINKY = handShape(0.85, 1.08, 1.1, 1.12, 0, 0, 0.1);
export const HOOKED = handShape(0.85, 1.08, 1.1, 1.12, 0.6, 0, 0.1, 0.6);
const UP_S = 0.8, CLOSE = 0.6, SHAKES = 3, UNHOOK = 0.45, DOWN_S = 0.55;
/** The knuckles' distance from the hook: apart, hooked (half-widths); the little fingers pass this much further apart first. */
const APART = 0.55, HOOKED0 = 0.12, CLEAR = 0.08;
const KIND = ['kindnod', 'nod'];
const lerp = (a, b, t) => a + (b - a) * t;
const caps = makeCapsules(2 * CAP_COUNT);

/**
 * Member k's fist: its knuckles `gap` (half-widths) short of the hook point, `depth` off it on the back of its palm (the two
 * palms face each other), brought in from beside its bot by `low` (1: there), shaking; B's little finger curled round A's
 * by `hooked`. Drawn without lag.
 */
function fist(s, k, hook, across, u, gap, depth, low, shake, hooked, weight) {
  const dir = across.clone().multiplyScalar(k === 0 ? 1 : -1);
  // right to right: A's palm faces B's across the hook; each fist sits on the back of its palm
  const palmA = palmOf(s.side[0], across, UP);
  let at = hook.clone().addScaledVector(dir, -gap * u).addScaledVector(UP, 0.12 * shake * u).addScaledVector(palmA, -(k === 0 ? depth : -depth) * u);
  if (low > 0) at = approach(s, k, s.side[k], at, 1 - low);
  const fingers = dir.clone().addScaledVector(DOWN, 0.25).normalize();
  const shape = lerpShape(SHAPES.relaxed, k === 0 ? PINKY : lerpShape(PINKY, HOOKED, hooked), 1 - low * 0.7);
  const aim = aimByThumb(s.side[k], at, fingers, UP, shape, 'knuckles', weight);
  aim.exact = 1;
  return aim;
}

/** How far apart the two little fingers are (m; negative: overlapping) with the fists `depth` apart, hooked. */
function littleGap(s, hook, across, u, depth, gap = HOOKED0, hooked = 1) {
  for (let k = 0; k < 2; k++) {
    const a = fist(s, k, hook, across, u, gap, depth, 0, 0, hooked, 1);
    const scale = s.handScale(k);
    const wrist = a.position.clone().sub(KNUCKLES_LOCAL.clone().multiplyScalar(scale).applyQuaternion(a.rotation));
    posedCapsules(a.shape, s.side[k], wrist, a.rotation, scale, caps, k * CAP_COUNT);
  }
  let best = Infinity;
  for (let i = 0; i < CAP_COUNT; i++) {
    if (digitOf(caps[i].part) !== 4) continue;
    for (let j = CAP_COUNT; j < 2 * CAP_COUNT; j++) {
      if (digitOf(caps[j].part) !== 4) continue;
      best = Math.min(best, segmentDistance(caps[i].a, caps[i].b, caps[j].a, caps[j].b) - caps[i].r - caps[j].r);
    }
  }
  return best;
}

/** The depth (F[0], half-widths) at which B's hooked little finger just touches A's, found once as it begins. */
function findHook(s) {
  const { across, u } = duoFrame(s);
  const hook = duoNow(s, HOOK0);
  let lo = 0, hi = 0.2;
  for (let it = 0; it < 20; it++) {
    const d = 0.5 * (lo + hi);
    if (littleGap(s, hook, across, u, d) < 0) lo = d;
    else hi = d;
  }
  s.F[0] = hi;
}

export default {
  id: 'pinky-promise',
  cast: 'duo',
  maxSeconds: 13,
  blendIn: 0.45,
  blendOut: 0.45,
  handOf: () => 'right',
  pair: 'same',
  tryCast: (s) => duoCast(s, MARKS, 0.5),

  begin(s) {
    findHook(s);
    s.note('pinkies', 0, 1);
    s.look(0, 1, 1.4);
    s.look(1, 0, 1.4);
    s.act(0, s.profile(0).exchange, 'smile', 1);
  },

  step(s) {
    const f = duoFrame(s);
    const { across, toViewer, u } = f;
    const hook = duoNow(s, HOOK0, f);
    const t = s.phaseT;
    let gap = APART, low = 0, hooked = 0, weight = 1, shake = 0;
    switch (s.phase) {
      case 0:
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        low = 1 - smooth(t / UP_S);
        if (t >= UP_S) {
          s.lookAt(0, hook, 1.4);
          s.lookAt(1, hook, 1.4);
          s.next(1);
        }
        break;
      case 1: // close in (the little fingers straight, passing each other), then B's curls round A's
        gap = lerp(APART, HOOKED0, smooth(t / (CLOSE * 0.6)));
        hooked = smooth((t - CLOSE * 0.6) / (CLOSE * 0.4));
        if (t >= CLOSE) {
          s.note('hook', 0, 1);
          s.sparkle(0, hook.clone().addScaledVector(toViewer, 0.15 * u), 'stardust');
          s.mark = s.nextBeat(s.beat, 0.2);
          s.next(2);
        }
        break;
      case 2: { // three shakes on the beat, nodding along
        gap = HOOKED0;
        hooked = 1;
        const b = s.beat - s.mark;
        if (b >= 0) {
          if (s.round === 0) {
            s.note('shake', 0, 1);
            s.round = 1;
          }
          shake = b < SHAKES ? Math.sin(2 * Math.PI * b) : 0;
        }
        if (b >= SHAKES) {
          s.note('promise', 0, 1);
          s.next(3);
        }
        break;
      }
      case 3: // unhook, then apart
        hooked = 1 - smooth(t / (UNHOOK * 0.45));
        gap = lerp(HOOKED0, APART, smooth((t - UNHOOK * 0.4) / (UNHOOK * 0.6)));
        if (t >= UNHOOK) {
          s.act(0, KIND, 'smile', 1);
          s.react(1, 0.2, KIND, 'smile', 0, 1.2);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(4);
        }
        break;
      default:
        low = smooth(t / DOWN_S);
        weight = 1 - smooth(t / DOWN_S);
        if (t >= DOWN_S) s.done();
        break;
    }
    // the little fingers pass each other a little further apart, then close in as B's curls round A's; while they meet,
    // never closer than touching (B's curling finger sweeps round A's, not through it)
    let depth = s.F[0] + CLEAR * (1 - hooked);
    if (s.phase >= 1 && s.phase <= 3 && littleGap(s, hook, across, u, depth, gap, hooked) < 0) {
      let lo = depth, hi = depth + 2 * CLEAR;
      for (let it = 0; it < 14; it++) {
        const d = 0.5 * (lo + hi);
        if (littleGap(s, hook, across, u, d, gap, hooked) < 0) lo = d;
        else hi = d;
      }
      depth = hi;
    }
    const warm = s.phase === 2 ? 1 : s.phase === 1 ? hooked : s.phase === 3 ? 1 - smooth(t / UNHOOK) : 0;
    for (let k = 0; k < 2; k++) {
      s.hand(k, s.side[k], fist(s, k, hook, across, u, gap, depth, low, shake, hooked, weight));
      const face = s.face(k);
      face.tilt(0.06 * s.side[k] * warm, -0.08 * shake);
      face.add('mouthSmile', 0.4 * warm);
      face.add('blush', 0.2 * warm);
    }
  },
};
