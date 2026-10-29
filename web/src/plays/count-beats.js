// Solo: counting the beat (Unity Plays/CountBeats.cs). A fist comes up beside the face, palm to the viewer, and on each
// beat one more finger pops up (one, two, three, four) with a little nod; on the next one the whole hand opens and goes
// back down.
import { handShape } from '../scene/hand-rig.js';
import { RIGHT, REST, REST_FINGERS, REST_PALM, SHAPES, arc, copyShape, lerpShape, mir, onFaceBlend, pulse, smooth, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** The fist (thumb across it): the count adds fingers to it. */
const CLOSED = handShape(0.85, 1.05, 1.05, 1.05, 1.05, 0.05, 0.05);
const AT = v3(1.25, -0.05, 0.85);
const RAISE = 0.55, LOWER = 0.5;
const STEPS = ['1', '2', '3', '4'];
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** How far finger f (1 index .. 4 little) is up at beat position b (beats since the first count; 0 down .. 1 up). */
export const fingerUp = (b, f) => smooth((b - (f - 1)) * 5);

export default {
  id: 'count-beats',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.6) ? RIGHT : -RIGHT;
    // the first count: the next whole beat at least the raise away
    s.value = s.nextBeat(s.beat, RAISE / Math.max(0.1, s.beatSec));
    s.note('count', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const b = s.beat - s.value;
    const sec = Math.max(0.1, s.beatSec);
    // after "four": the whole hand opens on the next beat and holds a beat, then down
    const open = smooth((b - 4) * 5);
    const down = smoother(((b - 5.2) * sec) / LOWER);
    const u = smoother(t / RAISE) * (1 - down);
    const count = copyShape(CLOSED);
    count.index = lerp(1.05, 0, fingerUp(b, 1));
    count.middle = lerp(1.05, 0, fingerUp(b, 2));
    count.ring = lerp(1.05, 0, fingerUp(b, 3));
    count.little = lerp(1.05, 0, fingerUp(b, 4));
    count.spread = 0.05 + 0.55 * fingerUp(b, 2) + 0.4 * open;
    count.thumb = lerp(0.85, 0, open);
    count.thumbOut = lerp(0.05, 0.9, open);
    const shape = lerpShape(SHAPES.relaxed, count, ramp(t, 0.1, RAISE));
    // a little lift on each count
    const lift = b >= 0 && b < 5 ? 0.05 * pulse(b, 6) : 0;
    const at = v3(AT.x, AT.y + lift, AT.z + 0.1 * open);
    const pos = arc(REST, v3(1.55, -0.45, 0.8), at, u);
    s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, v3(0.1, 1, 0.05), v3(-0.1, 0, 1), u * 1.3, shape));
    const face = s.face(0);
    const nod = b >= 0 && b < 5 ? pulse(b, 6) : 0;
    face.tilt(0.05 * side * (1 - down), -0.06 * nod);
    face.add('mouthSmile', (0.25 + 0.3 * open) * (1 - down) * ramp(t, 0.1, RAISE));
    face.add('browRaiseL', 0.15 * (1 - down));
    face.add('browRaiseR', 0.15 * (1 - down));
    face.gaze(mir(side, AT), 0.35 * (1 - open) * ramp(t, 0.1, RAISE));
    // the counts
    if (s.round < 4 && b >= s.round) {
      s.note(STEPS[s.round], 0);
      s.round++;
    }
    if (s.phase === 0 && b >= 4) {
      s.sparkle(0, s.botToWorld(0, mir(side, AT.clone().add(v3(0, 0.7, 0.1)))), 'notes');
      s.note('open', 0);
      s.next(1);
    }
    if (s.phase === 1 && down >= 1) s.done();
  },
};
