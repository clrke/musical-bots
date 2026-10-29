// Solo: thinking (Unity Plays/ChinStroke.cs). A hand comes up under the chin, thumb beneath it and the crooked index in
// front, and strokes it slowly while the eyes look up and away, one brow raised, the mouth pursed; then an idea: the
// index pops up beside the face, the eyes brighten, and the hand goes back down.
import { handShape } from '../scene/hand-rig.js';
import { ch } from './face.js';
import { RIGHT, REST, REST_FINGERS, REST_PALM, S_POINT, SHAPES, arc, hold, lerpShape, onFaceBlend, pointOf, slerpDir, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** Thumb out under the chin, the index crooked, the others curled. */
const THINK = handShape(0.15, 0.55, 0.95, 1.02, 1.05, 0.05, 0.85);
/** The idea: the index straight up beside the face. */
const IDEA_AT = v3(1.2, 0.25, 0.85);
const UP = 0.6, IDEA = 2.75, HOLD_END = 3.55, DOWN = 4.05;
const IDEA_ACTS = ['brighten', 'gasp'];

export default {
  id: 'chin-stroke',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.6) ? RIGHT : -RIGHT;
    s.V[0].copy(pointOf(s, 0, 'chin', 0, s.side[0]));
    s.note('think', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const chin = s.V[0];
    const think = hold(t, 0.2, UP, IDEA - 0.1, IDEA + 0.1);
    // the stroke: down the chin and back, slowly
    const stroke = t < UP ? 0 : 0.5 - 0.5 * Math.cos((t - UP) * Math.PI * 2 * 1.1);
    const under = chin.clone().add(v3(0.05, 0.1 - 0.1 * stroke * think, 0.12));
    // up from rest under the chin, then (the idea) out and up beside the face, then down
    let pos, r;
    if (t < IDEA) {
      r = smoother(t / UP);
      pos = arc(REST, v3(1.25, -1.05, 0.85), under, r);
    } else {
      const i = smoother((t - IDEA) / 0.45);
      const d = smoother((t - HOLD_END) / (DOWN - HOLD_END));
      pos = arc(under, v3(1.3, -0.4, 1.0), IDEA_AT, i).lerp(arc(IDEA_AT, v3(1.5, -0.2, 0.75), REST, d), d);
      r = 1 - d;
    }
    const idea = hold(t, IDEA, IDEA + 0.25, HOLD_END, DOWN);
    const shape = lerpShape(lerpShape(SHAPES.relaxed, THINK, ramp(t, 0.1, UP)), S_POINT, idea);
    // thinking: the palm up under the chin, the index in front of it; the idea: the finger straight up, palm to the viewer
    const fingers = slerpDir(v3(-0.85, 0.25, 0.45), v3(0.05, 1, 0.1), idea);
    const palm = slerpDir(v3(-0.1, 0.6, -0.8), v3(-0.2, 0, 1), idea);
    s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, fingers, palm, r * 1.3, shape, 'pinch'));
    const face = s.face(0);
    face.gaze(v3(-0.6 * side, 0.7, 1), 0.9 * think);
    face.add(ch(-side, 'browRaiseL', 'browRaiseR'), 0.35 * think);
    face.add('mouthRound', 0.3 * think);
    face.add('mouthWidth', -0.35 * think);
    face.add('mouthSmirk', 0.25 * side * think); // mirrored: the corner away from the hand
    face.add(ch(side, 'lidLowL', 'lidLowR'), 0.2 * think);
    face.tilt(-0.06 * side * think, 0.06 * think);
    face.add('mouthSmile', 0.4 * idea);
    face.add('eyeZoom', 0.4 * idea);
    face.add('browRaiseL', 0.3 * idea);
    face.add('browRaiseR', 0.3 * idea);
    if (s.phase === 0 && t >= IDEA + 0.2) {
      s.sparkle(0, s.botToWorld(0, IDEA_AT.clone().add(v3(0, 0.75, 0.1)).setX(IDEA_AT.x * side)), 'stardust');
      s.act(0, IDEA_ACTS, 'idea');
      s.next(1);
    }
    if (t >= DOWN) s.done();
  },
};
