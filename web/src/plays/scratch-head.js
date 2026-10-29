// Solo: a puzzled little scratch (Unity Plays/ScratchHead.cs). One hand goes up the side of the head onto its top
// (beside the antenna) and scratches it with hooked fingertips, to and fro, while the bot squints, purses its mouth and
// looks up as if thinking; then the hand comes back down and the bot shrugs it off (a small act of its own).
import { ch } from './face.js';
import { RIGHT, REST, REST_FINGERS, REST_PALM, S_CLAW, SHAPES, arc, clamp01, hold, lerpShape, onFaceBlend, pointOf, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** Up, scratching until, down (s); scratches per second. */
const UP = 0.65, UNTIL = 2.3, DOWN = 2.85, RATE = 4.2;

export default {
  id: 'scratch-head',
  cast: 'solo',

  begin(s) {
    s.side[0] = s.chance(0.6) ? RIGHT : -RIGHT;
    // where the fingertips scratch: the crown, on top in front of the antenna
    const crown = pointOf(s, 0, 'crown', 0, s.side[0]);
    const top = pointOf(s, 0, 'top', 0, s.side[0]);
    s.V[0].set(0.02, Math.max(crown.y, top.y - 0.06), Math.max(0.2, crown.z));
    s.note('scratch', 0);
  },

  step(s) {
    const side = s.side[0];
    const t = s.t;
    const spot = s.V[0];
    const u = smoother(t / UP) * (1 - smoother((t - UNTIL) / (DOWN - UNTIL)));
    const on = hold(t, UP * 0.8, UP + 0.1, UNTIL - 0.15, UNTIL);
    // to and fro across the top, the fingers flexing as they scratch
    const w = Math.sin((t - UP) * RATE * Math.PI * 2) * on;
    // the knuckles (rigid in the palm) just above and outside the spot: the hooked fingers drape over onto it
    const knuckles = spot.clone().add(v3(0.24 + 0.03 * w, 0.17 + 0.02 * Math.abs(w), 0.1 * w));
    // up the side, out from the ear, then over onto the top
    const pos = arc(REST, v3(1.7, 0.85, 0.35), knuckles.add(v3(0, 0.12 * (1 - on), 0)), u);
    const shape = lerpShape(SHAPES.relaxed, S_CLAW, ramp(t, UP * 0.5, UP));
    shape.hook = clamp01(shape.hook + 0.15 * w);
    shape.index += 0.12 * w;
    shape.middle += 0.12 * w;
    shape.ring += 0.12 * w;
    // palm down over the top, fingers pointing in across it
    s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, v3(-1, -0.15, 0.1), v3(-0.15, -1, 0.05), u * 1.25, shape, 'knuckles'));
    // puzzled: eyes up and to the side, a squint on the other side, the mouth pursed to one side, the head into the scratch
    const face = s.face(0);
    const puzzled = hold(t, 0.3, UP + 0.2, UNTIL, DOWN);
    face.gaze(v3(-0.5 * side, 0.6, 1), 0.8 * puzzled);
    face.add(ch(-side, 'browRaiseL', 'browRaiseR'), 0.3 * puzzled);
    face.add(ch(side, 'browRaiseL', 'browRaiseR'), -0.15 * puzzled);
    face.add('browSqueeze', 0.25 * puzzled);
    face.add(ch(side, 'lidLowL', 'lidLowR'), 0.25 * puzzled);
    face.add('mouthRound', 0.35 * puzzled);
    face.add('mouthWidth', -0.3 * puzzled);
    face.add('mouthSmirk', -0.35 * puzzled * side); // mirrored
    face.tilt(0.07 * side * puzzled + 0.015 * w, 0.03 * puzzled);
    if (s.phase === 0 && t >= UNTIL) {
      s.act(0, s.profile(0).ret, 'shrug');
      s.next(1);
    }
    if (t >= DOWN) s.done();
  },
};
