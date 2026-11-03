// Group: "hands in!" (Unity Plays/HandStack.cs). Three to five neighbours lean in and stack one hand each in the middle,
// palm down, one on top of another, a beat apart (the starter's first, the others in turn): each hand comes over the stack
// and settles onto it, its palm resting on the hands below (the heights found from the hands' volumes: no gap, nothing
// through another hand). The stack pumps down on "one, two, three" and on "three" every hand flies up above the heads,
// fingers spread, in a cheer: the heads hop, the antennas flick, everyone beams; then the hands come down.
import * as THREE from 'three';
import { lookRotation } from '../scene/hand-rig.js';
import { CAP_COUNT, FLAT_SHAPE, PAD_LOCAL, capsulesOverlap, makeCapsules, palmTouch, posedCapsules } from '../scene/hand-touch.js';
import { SHAPES, clamp01, lerpShape, slerpDir, smooth, smoother, toViewerFrom, v3 } from './kit.js';
import { aimInWorld } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
/** The stack: in front of the group's middle and down (half-widths); each hand this much above the one under it. */
const FRONT = 1.0, BELOW = 1.25, LAYER = 0.25, OFF = 0.25;
/** A wrist reaches the stack from this far at most (half-widths; a loose cast: nearly the play reach, 3). */
const REACH = 2.5, REACH_LOOSE = 2.85;
/** The cheer: the hands this high above the stack (half-widths), toward their own heads. */
const CHEER_UP = 1.7;
/** A hand takes this long to come in onto the stack (s; it lands on its beat), over it this high first (half-widths). */
const IN_S = 0.6, HOVER = 0.35;
const CHEERS = ['bounce', 'brighten', 'squeal', 'twinkle', 'giggle'];
const PROBE = 5;
const caps = makeCapsules((PROBE + 1) * CAP_COUNT);

const meanUnit = (s) => {
  let u = 0;
  for (let k = 0; k < s.count; k++) u += s.unit(k);
  return u / s.count;
};

function clear(s, m, u) {
  for (let k = 0; k < s.count; k++) if (m.distanceTo(s.place(k)) < s.radius(k) * 1.35 + 0.35 * u) return false;
  return true;
}

/** The stack's base (point), the way to the viewer (axis), each member's lean-in (V), hand (side). */
function fit(s, loose) {
  const n = s.count;
  const mid = v3();
  for (let k = 0; k < n; k++) mid.add(s.place(k));
  mid.divideScalar(n);
  const u = meanUnit(s);
  const toViewer = toViewerFrom(s, mid);
  let ahead = 0;
  for (let k = 0; k < n; k++) ahead = Math.max(ahead, s.place(k).sub(mid).dot(toViewer));
  const m = mid.clone().addScaledVector(toViewer, ahead + FRONT * u).addScaledVector(DOWN, BELOW * u);
  for (let step = 0; step < 12 && !clear(s, m, u); step++) m.addScaledVector(toViewer, 0.12 * u);
  if (!clear(s, m, u)) return false;
  s.point.copy(m);
  s.axis.copy(toViewer);
  // the stage's rows stand wider than Unity's choir: a loose cast lets the wrists reach the play's full reach and the
  // heads lean in further (kept apart from each other)
  const reach = loose ? REACH_LOOSE : REACH;
  for (let k = 0; k < n; k++) {
    const place = s.place(k);
    const to = m.clone().sub(place);
    const d = to.length();
    if (d < 1e-5) return false;
    const move = Math.min(1, s.profile(k).move);
    // the palm sits on the stack a little toward its own head; the wrist is short of it
    const short = (OFF + 0.3) * s.unit(k);
    const need = Math.max(0, d - short - reach * s.unit(k));
    const cap = loose ? 3.5 * s.radius(k) * Math.max(0.6, move) : 0.85 * s.radius(k) * move;
    const drift = Math.min(need + 0.15 * s.radius(k) * move, cap);
    if (d - drift - short > reach * s.unit(k) * 1.05) return false;
    const level = to.clone();
    level.y = 0;
    s.V[k].copy(level.lengthSq() > 1e-8 ? level.normalize() : to.divideScalar(d)).multiplyScalar(drift);
    s.side[k] = s.sideToward(k, m);
  }
  if (loose) {
    s.separate();
    for (let k = 0; k < n; k++) if (m.distanceTo(s.place(k).add(s.V[k])) - (OFF + 0.3) * s.unit(k) > reach * s.unit(k) * 1.08) return false;
  }
  for (let k = 0; k < n; k++) s.allowTravel(k, s.V[k].length() + 0.4 * s.radius(k));
  return true;
}

/** The way from the stack's middle out to member k's head (level; its drifted place: steady while it plays). */
function outOf(s, k) {
  const d = s.place(k).add(s.V[k]).sub(s.point);
  d.y = 0;
  return d.lengthSq() > 1e-8 ? d.normalize() : s.frontOf(k).negate();
}

/** Member k's hand on the stack: its rotation (palm down, fingers over the middle) and its palm pad's place. */
function onStack(s, k, u) {
  const dir = outOf(s, k);
  const pad = s.point.clone().addScaledVector(dir, OFF * u);
  const rot = palmTouch(lookRotation(dir.clone().negate().addScaledVector(DOWN, 0.08).normalize(), DOWN), s.side[k]);
  return { rot, pad, dir };
}

function posed(s, k, rot, pad, scale, slot) {
  const wrist = pad.clone().sub(PAD_LOCAL.clone().multiplyScalar(scale).applyQuaternion(rot));
  posedCapsules(FLAT_SHAPE, s.side[k], wrist, rot, scale, caps, slot * CAP_COUNT);
}

/** Each hand's height on the stack (F, metres above its base), in the order they go in: resting on the hands below. */
function layers(s) {
  const n = s.count;
  const u = meanUnit(s);
  let top = 0;
  for (let order = 0; order < n; order++) {
    let k = 0;
    while (k < n && s.I[k] !== order) k++;
    if (k >= n) continue;
    const { rot, pad } = onStack(s, k, u);
    const scale = s.handScale(k);
    let h = 0;
    if (order > 0) {
      let lo = -LAYER * u, hi = top + 2 * LAYER * u;
      for (let it = 0; it < 22; it++) {
        h = 0.5 * (lo + hi);
        posed(s, k, rot, pad.clone().addScaledVector(UP, h), scale, PROBE);
        let ok = true;
        for (let j = 0; j < order && ok; j++) ok = !capsulesOverlap(caps, PROBE * CAP_COUNT, caps, j * CAP_COUNT);
        if (ok) hi = h;
        else lo = h;
      }
      h = hi;
    }
    s.F[k] = h;
    top = Math.max(top, h);
    posed(s, k, rot, pad.clone().addScaledVector(UP, h), scale, order);
  }
}

/** Where member k's hand goes in the cheer: up high over its own head, a little toward the stack and the viewer. */
function cheerAt(s, k, m, u) {
  const head = s.place(k).add(s.V[k]);
  const toM = m.clone().sub(head);
  toM.y = 0;
  const viewRight = s.viewerRight;
  const side = toM.dot(viewRight);
  return head.addScaledVector(UP, CHEER_UP * s.unit(k)).addScaledVector(viewRight, Math.min(1, Math.max(-1, side / u)) * 0.55 * s.unit(k))
    .addScaledVector(s.axis, 0.35 * s.unit(k));
}

export default {
  id: 'hand-stack',
  cast: 'group',
  maxSeconds: 16,
  blendIn: 0.45,
  blendOut: 0.55,
  handOf: () => 'inner',

  tryCast(s) {
    for (const loose of [false, true]) {
      const all = s.cast.slice();
      while (s.count >= 3) {
        if (fit(s, loose)) return true;
        s.cast.length--;
      }
      s.cast.splice(0, s.cast.length, ...all);
    }
    return false;
  },

  begin(s) {
    const n = s.count;
    // the order the hands go in: the starter first, then the others by distance from the stack (nearest first)
    s.I[0] = 0;
    for (let k = 1; k < n; k++) {
      const d = s.place(k).distanceToSquared(s.point);
      let order = 1;
      for (let o = 1; o < n; o++) {
        if (o === k) continue;
        const e = s.place(o).distanceToSquared(s.point);
        if (e < d || (e === d && o < k)) order++;
      }
      s.I[k] = order;
    }
    layers(s);
    s.act(0, s.profile(0).mischief, 'mischief', 1);
    s.note('lean in', 0);
    for (let k = 0; k < n; k++) s.lookAt(k, s.point, 2.5);
    s.mark = s.nextBeat(s.beat, 0.6);
  },

  step(s) {
    const n = s.count;
    const m = s.point;
    const u = meanUnit(s);
    const b = s.beat - s.mark; // beats since the first hand goes in
    // beats: hand k lands on beat I[k]; then "one, two, three" (n+0.5 .. n+2.5), the cheer on three
    const count0 = n + 0.5, cheerBeat = count0 + 2;
    const lean = smooth(s.t / 0.5);
    if (s.phase === 0) {
      for (let k = 0; k < n; k++) {
        s.go(k, s.V[k], 5);
        s.lean(k, m.clone().sub(s.head(k)), 0.12 * Math.min(1, s.profile(k).move) * lean, 6);
        if (b >= s.I[k] && !s.B[k]) {
          s.B[k] = true;
          s.note('hand in', k);
          s.jolt(k, DOWN.clone().multiplyScalar(0.5 * s.radius(k)));
        }
      }
      if (b >= count0) {
        s.note('count', 0);
        s.next(1);
      }
    }
    let pump = 0;
    if (s.phase === 1) {
      // "one, two, three": the stack dips on each count, the mouths too
      const c = b - count0;
      const x = c - Math.floor(c);
      pump = c < 2 ? Math.sin(Math.PI * clamp01(x / 0.5)) : 0;
      for (let k = 0; k < n; k++) {
        const face = s.face(k);
        face.add('mouthOpen', 0.35 * (c < 2.2 ? Math.sin(Math.PI * clamp01(x / 0.45)) : 0));
        face.tilt(0, -0.05 * pump);
      }
      if (b >= cheerBeat) {
        s.note('cheer', 0);
        for (let k = 0; k < n; k++) {
          s.go(k, s.V[k].clone().addScaledVector(UP, 0.35 * s.radius(k) * Math.min(1.1, s.profile(k).move)), 12, 0.6);
          s.lean(k, m.clone().sub(s.head(k)), 0, 6);
          s.face(k).flickAntenna(new THREE.Vector3(0, 0.14, 0));
          s.lookAt(k, s.viewer, 1.5);
          s.react(k, 0.05 + 0.1 * s.I[k], CHEERS, 'cheer');
        }
        s.sparkle(0, m.clone().addScaledVector(UP, (BELOW + 1.9) * u).addScaledVector(s.axis, -FRONT * u), 'confetti');
        s.next(2);
      }
    }
    let cheer = 0;
    if (s.phase === 2) {
      cheer = smoother(s.phaseT / 0.6);
      if (s.phaseT > 0.45 && s.round === 0) {
        s.round = 1;
        for (let k = 0; k < n; k++) s.home(k, 7, 0.6);
      }
      for (let k = 0; k < n; k++) {
        const face = s.face(k);
        face.add('mouthOpen', 0.4 * cheer);
        face.add('mouthSmile', 0.5 * cheer);
        face.tilt(0, 0.08 * cheer);
      }
      if (s.phaseT >= 1.5) {
        s.note('hands down', 0);
        s.done();
      }
    }
    // the hands: each comes in on its beat over the stack, then down onto it (palm down, fingers to the middle,
    // decelerating into it: it lands on its beat, resting on the hands below), pumps, flies up; drawn without lag
    for (let k = 0; k < n; k++) {
      const { rot: rest, pad, dir } = onStack(s, k, u);
      const inW = s.phase === 0 ? clamp01(1 + ((b - s.I[k]) * s.beatSec) / IN_S) : 1;
      const glide = smoother(inW / 0.65), drop = smooth((inW - 0.55) / 0.45);
      const layer = pad.clone().addScaledVector(UP, s.F[k]).addScaledVector(DOWN, 0.18 * u * pump);
      const above = layer.clone().addScaledVector(UP, HOVER * u);
      // waiting: the hand ready beside the face (bot frame), then it comes over the stack and settles onto it
      const ready = s.botToWorld(k, v3(1.2 * s.side[k], -0.35, 0.55));
      let palmAt = ready.clone().lerp(above, glide).add(layer.clone().sub(above).multiplyScalar(drop));
      let fingers = slerpDir(dir.clone().negate().addScaledVector(UP, 0.4).normalize(), dir.clone().negate().addScaledVector(DOWN, 0.08).normalize(), glide);
      let palm = slerpDir(dir.clone().negate(), DOWN, glide);
      let shape = lerpShape(SHAPES.relaxed, FLAT_SHAPE, glide);
      let rot = palmTouch(lookRotation(fingers, palm), s.side[k]); // on the stack: `rest`
      if (cheer > 0) {
        // out from the middle first (each its own way), then up: no hand goes through another
        const up = cheerAt(s, k, m, u);
        const outward = up.sub(layer);
        const rise = smoother((s.phaseT - 0.1) / 0.7), spread = smoother(s.phaseT / 0.45);
        palmAt = layer.clone().add(v3(outward.x * spread, outward.y * rise, outward.z * spread));
        fingers = slerpDir(fingers, UP.clone().addScaledVector(dir, 0.25).normalize(), cheer);
        palm = slerpDir(palm, s.axis, cheer);
        shape = lerpShape(FLAT_SHAPE, SHAPES.open, cheer);
        rot = rest.clone().slerp(lookRotation(fingers, palm), cheer);
      }
      const aim = aimInWorld(palmAt, fingers, palm, shape, 'palm');
      aim.rotation = rot;
      aim.exact = 1;
      s.hand(k, s.side[k], aim);
    }
  },
};
