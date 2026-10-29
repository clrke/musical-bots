// Solo: conducting (Unity Plays/Conductor.cs). The bot raises a hand with the index finger out like a baton and beats
// time for two bars, locked to the song's beat: the 4/4 pattern (down on one, in on two, out on three, up on four),
// each beat landing with a little bounce, the head nodding on the downbeats, the eyes on a singer (or soft and half
// closed, feeling it); a small closing loop ends it.
import * as THREE from 'three';
import { RIGHT, REST, REST_FINGERS, REST_PALM, S_FIST, S_POINT, SHAPES, arc, clamp01, hold, inBotBlend, lerpShape, mir, pulse, smooth, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** The pattern's middle beside the face (the bot's frame, x outward), its size (half-widths). */
const MIDDLE = v3(1.2, 0.25, 0.95);
const SIZE = 0.55;
/** Beats conducted (two bars), the raise before the first beat and the lowering after (s). */
const BEATS = 8, RAISE = 0.6, LOWER = 0.55;
// where each beat lands in the pattern (x outward, y up): 1 down, 2 in, 3 out, 4 up
const ICTUS = [[0, -1], [-0.95, -0.55], [0.95, -0.5], [0.1, 0.2]];
const lerp = (a, b, t) => a + (b - a) * t;

/** The baton's tip at beat position b (beats since the first; side-normalised, the pattern's units). */
export function pattern(b) {
  const i = Math.floor(b);
  const f = b - i;
  // fast into each ictus, slow at the top of the rebound
  const w = f - (0.75 * Math.sin(2 * Math.PI * f)) / (2 * Math.PI);
  const a = ICTUS[((i % 4) + 4) % 4], c = ICTUS[(((i + 1) % 4) + 4) % 4];
  return { x: lerp(a[0], c[0], w), y: lerp(a[1], c[1], w) + 0.55 * Math.sin(Math.PI * w) };
}

/** A neighbour singing now (nearest first), or null. */
function singingNeighbour(s) {
  for (const b of s.neighbours(0, 4.5)) if (s.singsNow(b)) return b;
  return null;
}

export default {
  id: 'conductor',
  cast: 'solo',
  maxSeconds: 14,

  begin(s) {
    s.side[0] = s.chance(0.7) ? RIGHT : -RIGHT;
    // the first beat: the next whole beat at least the raise away
    s.value = s.nextBeat(s.beat, RAISE / Math.max(0.1, s.beatSec));
    const singer = singingNeighbour(s);
    s.I[0] = singer ? 1 : -1;
    if (singer) {
      s.lookAt(0, singer.head.mesh.getWorldPosition(new THREE.Vector3()), 6);
      s.note('watch singer', 0);
    }
    s.note('baton', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const b = s.beat - s.value; // beats since the first downbeat
    const sec = Math.max(0.1, s.beatSec);
    const end = BEATS * sec - b * sec + t; // the play's time at the last beat
    // the pattern runs from the first beat; before it, the baton is held at the top of beat 4 (the upbeat)
    const p = b < 0 ? pattern(-1 + clamp01(1 + b)) : b < BEATS ? pattern(b) : pattern(BEATS);
    // the closing loop after the last beat: a small circle closing into a fist
    const closing = b < BEATS ? 0 : clamp01((b - BEATS) * 1.4);
    if (closing > 0) {
      const a = closing * Math.PI * 2;
      p.x += 0.35 * Math.sin(a);
      p.y += 0.3 * (1 - Math.cos(a));
    }
    const down = smoother((t - end - 0.75 * sec) / LOWER);
    const u = smoother(t / RAISE) * (1 - down);
    const tip = v3(MIDDLE.x + p.x * SIZE, MIDDLE.y + p.y * SIZE, MIDDLE.z + 0.05 * p.y);
    const pos = arc(REST, v3(1.6, -0.4, 0.8), tip, u);
    let shape = lerpShape(SHAPES.relaxed, S_POINT, ramp(t, 0.1, RAISE));
    if (closing > 0) shape = lerpShape(shape, S_FIST, smooth(closing * 1.5 - 0.5));
    // the baton points up and forward, the palm in and down
    s.hand(0, side, inBotBlend(side, pos, REST_FINGERS, REST_PALM, v3(-0.25, 0.75, 0.6), v3(-0.85, -0.3, 0.3), u * 1.3, shape, 'indexTip'));
    const face = s.face(0);
    const feel = hold(t, 0.2, RAISE, end, end + LOWER);
    // a nod on each downbeat, softer on the others
    const nod = b < 0 || b >= BEATS ? 0 : pulse(b, 5) * (Math.floor(b) % 4 === 0 ? 1 : 0.4);
    face.tilt(0.04 * side * feel, -0.07 * nod);
    face.add('mouthSmile', 0.3 * feel);
    face.add('browRaiseL', 0.12 * feel);
    face.add('browRaiseR', 0.12 * feel);
    if (s.I[0] < 0) {
      face.add('lidUpL', 0.35 * feel);
      face.add('lidUpR', 0.35 * feel);
    }
    if (s.phase === 0 && b >= 0) {
      s.sparkle(0, s.botToWorld(0, mir(side, MIDDLE.clone().add(v3(0, 0.6, 0)))), 'notes');
      s.note('downbeat', 0);
      s.next(1);
    }
    if (s.phase === 1 && b >= 4) {
      s.note('downbeat', 0);
      s.next(2);
    }
    if (s.phase === 2 && b >= BEATS) {
      s.note('close', 0);
      s.next(3);
    }
    if (s.phase === 3 && down >= 1) s.done();
  },
};
