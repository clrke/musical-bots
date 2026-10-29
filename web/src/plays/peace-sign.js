// Solo: posing for a photo (Unity Plays/PeaceSign.cs). The bot looks at the viewer, a hand comes up beside its face in a
// V (index and middle up and apart, palm to the viewer), and on the "click" the V pops forward, the head tips toward it
// and the eye beside it winks; the lively ones sometimes make a V with both hands.
import { handShape } from '../scene/hand-rig.js';
import { RIGHT, REST, REST_FINGERS, REST_PALM, SHAPES, arc, hold, lerpShape, mir, onFaceBlend, pulse, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** The V: index and middle straight and apart, ring and little folded, the thumb over them. */
export const VEE = handShape(0.9, 0, 0, 1.05, 1.05, 1.05, 0.05);
/** The wrist beside the face (x outward), fingers up and a little out, palm to the viewer. */
const AT = v3(1.08, -0.05, 0.78);
const FINGERS = v3(0.22, 1, 0.08), PALM = v3(-0.05, 0, 1);
const UP = 0.55, CLICK = 0.7, HOLD_END = 2.35, DOWN = 2.85;
const BOTH = { giddy: 0.5, zany: 0.5, starstruck: 0.4, cheerful: 0.3, goofy: 0.3, cheeky: 0.25 };

export default {
  id: 'peace-sign',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.55) ? RIGHT : -RIGHT;
    s.B[0] = s.chance(BOTH[s.personality(0)] ?? 0.1);
    s.lookAt(0, s.viewer, DOWN + 0.4);
    s.note('pose', 0);
    if (s.B[0]) s.note('both hands', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const u = smoother(t / UP) * (1 - smoother((t - HOLD_END) / (DOWN - HOLD_END)));
    // the click: a quick pop toward the viewer that settles, then a little bob on the beat
    const pop = ramp(t, CLICK - 0.12, CLICK) * (1 - 0.65 * ramp(t, CLICK, CLICK + 0.35));
    const bob = t > CLICK + 0.3 ? 0.035 * pulse(s.beat, 6) : 0;
    for (let hand = -1; hand <= 1; hand += 2) {
      if (hand !== side && !s.B[0]) continue;
      const at = v3(AT.x - 0.05 * pop, AT.y + 0.05 * pop + bob, AT.z + 0.2 * pop);
      const pos = arc(REST, v3(1.55, -0.45, 0.75), at, u);
      const shape = lerpShape(SHAPES.relaxed, VEE, ramp(t, 0.15, UP));
      s.hand(0, hand, onFaceBlend(s, 0, hand, pos, REST_FINGERS, REST_PALM, FINGERS, PALM, u * 1.3, shape));
    }
    const face = s.face(0);
    const glow = hold(t, 0.2, CLICK, HOLD_END, DOWN);
    face.tilt(0.15 * side * ramp(t, CLICK - 0.15, CLICK + 0.1) * (1 - ramp(t, HOLD_END, DOWN)), 0.03 * glow);
    face.add('mouthSmile', 0.5 * glow);
    face.add('browRaiseL', 0.15 * glow);
    face.add('browRaiseR', 0.15 * glow);
    face.add('irisGlow', 0.2 * glow);
    if (s.phase === 0 && t >= CLICK) {
      face.winkEye(side);
      s.note('click', 0);
      s.note('wink', 0);
      s.sparkle(0, s.botToWorld(0, mir(side, AT.clone().add(v3(0.1, 0.75, 0.25)))), 'stardust');
      s.next(1);
    }
    if (s.phase === 1 && t >= CLICK + 0.6) {
      s.act(0, s.profile(0).giggle, 'smile');
      s.next(2);
    }
    if (t >= DOWN) s.done();
  },
};
