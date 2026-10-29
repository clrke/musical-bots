// Solo: a thumbs-up to the viewer (Unity Plays/ThumbsUp.cs). A fist comes up beside the face with the thumb straight up,
// gives two little pumps toward the viewer with a kind nod and a smile (a cheeky one winks), then goes back down.
import { RIGHT, REST, REST_FINGERS, REST_PALM, SHAPES, arc, hold, lerpShape, onFaceBlend, smoother, v3 } from './kit.js';
import { handShape } from '../scene/hand-rig.js';
import { ramp } from './stage.js';

/** A fist, the thumb straight up out of it. */
export const THUMB = handShape(0, 1.05, 1.05, 1.05, 1.05, 0, 1);
const AT = v3(1.1, -0.18, 0.98);
// the fist's fingers curl in toward the face, the thumb (on the hand's inner side) up, the palm in and back
const FINGERS = v3(-0.55, 0, 0.84), PALM = v3(-0.84, 0, -0.55);
const UP = 0.5, HOLD_END = 1.9, DOWN = 2.4;
const NOD_ACTS = ['kindnod', 'nod'];

export default {
  id: 'thumbs-up',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.6) ? RIGHT : -RIGHT;
    s.B[0] = s.chance(s.personality(0) === 'cheeky' ? 0.7 : 0.15);
    s.lookAt(0, s.viewer, DOWN);
    s.note('thumbs up', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const u = smoother(t / UP) * (1 - smoother((t - HOLD_END) / (DOWN - HOLD_END)));
    // two pumps toward the viewer
    const pump = t < UP ? 0 : Math.max(0, Math.sin((t - UP) * Math.PI * 2 * 1.6)) * (1 - ramp(t, UP + 1.1, UP + 1.3));
    const at = v3(AT.x, AT.y + 0.04 * pump, AT.z + 0.14 * pump);
    const pos = arc(REST, v3(1.5, -0.6, 0.9), at, u);
    const shape = lerpShape(SHAPES.relaxed, THUMB, ramp(t, 0.1, UP));
    s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, FINGERS, PALM, u * 1.3, shape));
    const face = s.face(0);
    const glow = hold(t, 0.2, UP + 0.1, HOLD_END, DOWN);
    face.add('mouthSmile', 0.45 * glow);
    face.add('irisGlow', 0.15 * glow);
    face.tilt(0.06 * side * glow);
    if (s.phase === 0 && t >= UP) {
      s.act(0, NOD_ACTS, 'nod');
      if (s.B[0]) {
        face.winkEye(side);
        s.note('wink', 0);
      }
      s.next(1);
    }
    if (t >= DOWN) s.done();
  },
};
