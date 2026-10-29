// Solo: "shh" (Unity Plays/Shh.cs). The bot raises its index finger to its lips, purses them and looks kindly toward
// the viewer with soft eyes (a gentle hush; the stage has no sleeping neighbours to hush for); then the finger comes down.
import { RIGHT, REST, REST_FINGERS, REST_PALM, S_POINT, SHAPES, arc, hold, lerpShape, onFaceBlend, pointOf, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

const UP = 0.55, HOLD_END = 2.2, DOWN = 2.7;

export default {
  id: 'shh',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.6) ? RIGHT : -RIGHT;
    s.V[0].copy(pointOf(s, 0, 'mouth', 0, s.side[0]));
    s.lookAt(0, s.viewer, DOWN);
    s.note('shh', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const mouth = s.V[0];
    const u = smoother(t / UP) * (1 - smoother((t - HOLD_END) / (DOWN - HOLD_END)));
    // the finger upright across the lips, the side of the hand to the viewer
    const tip = mouth.clone().add(v3(0.03, 0.2, 0.13));
    const pos = arc(REST, v3(1.2, -0.85, 1.05), tip, u);
    const shape = lerpShape(SHAPES.relaxed, S_POINT, ramp(t, 0.1, UP));
    s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, v3(-0.05, 1, 0.15), v3(-1, 0, -0.2), u * 1.3, shape, 'indexTip'));
    const face = s.face(0);
    const hush = hold(t, 0.2, UP + 0.1, HOLD_END, DOWN);
    face.add('mouthRound', 0.7 * hush);
    face.add('mouthWidth', -0.5 * hush);
    face.add('mouthOpen', 0.06 * hush);
    face.add('lidUpL', 0.3 * hush);
    face.add('lidUpR', 0.3 * hush);
    face.add('browTiltL', 0.25 * hush);
    face.add('browTiltR', 0.25 * hush);
    face.tilt(0.06 * side * hush, -0.05 * hush);
    if (t >= DOWN) s.done();
  },
};
