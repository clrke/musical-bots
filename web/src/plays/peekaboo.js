// Solo: peekaboo with the viewer (Unity Plays/Peekaboo.cs). Both hands come up and cover the eyes (palms on them,
// fingers up), the head dips a little and waits; then the hands spring apart, open and splayed, and the bot looks at the
// viewer wide-eyed with a big smile and a giggle.
import { handShape } from '../scene/hand-rig.js';
import { REST, REST_FINGERS, REST_PALM, S_SPLAYED, SHAPES, arc, hold, lerpShape, onFaceBlend, pointOf, slerpDir, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

const COVER = handShape(0.25, 0.06, 0.07, 0.08, 0.1, 0.12, 0.35);
/** The hands open beside the face after the "boo" (x outward). */
const OPEN = v3(1.4, 0.25, 0.85);
const UP = 0.6, BOO = 1.75, APART = 0.3, HOLD_END = 2.85, DOWN = 3.35;

export default {
  id: 'peekaboo',
  cast: 'solo',

  begin(s) {
    s.V[0].copy(pointOf(s, 0, 'eye', 1, 1));
    s.lookAt(0, s.viewer, DOWN);
    s.note('hide', 0);
  },

  step(s) {
    const t = s.t;
    const eye = s.V[0];
    const up = smoother(t / UP);
    const apart = smoother((t - BOO) / APART);
    const down = smoother((t - HOLD_END) / (DOWN - HOLD_END));
    for (let side = -1; side <= 1; side += 2) {
      // on the eyes (the palm's pad on the eye, standing off the face), the head-side edge in a little
      const cover = eye.clone().add(v3(-0.02, 0.02, 0.16));
      const pos = apart <= 0
        ? arc(REST, v3(1.35, -0.35, 1.15), cover, up)
        : arc(arc(cover, v3(0.9, 0.15, 1.25), OPEN, apart), v3(1.6, -0.3, 0.75), REST, down);
      const shape = apart <= 0 ? lerpShape(SHAPES.relaxed, COVER, ramp(t, 0.1, UP))
        : lerpShape(lerpShape(COVER, S_SPLAYED, apart), SHAPES.relaxed, down);
      const fingers = slerpDir(v3(-0.08, 1, 0), v3(0.3, 1, 0.1), apart);
      const palm = slerpDir(v3(0.05, 0, -1), v3(0, 0, 1), apart);
      const r = apart <= 0 ? up * 1.25 : 1 - down;
      s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, fingers, palm, r, shape, 'palm'));
    }
    const face = s.face(0);
    const hidden = hold(t, UP * 0.6, UP, BOO, BOO + 0.1);
    const boo = hold(t, BOO, BOO + 0.15, HOLD_END, DOWN);
    face.tilt(0, -0.08 * hidden + 0.06 * boo);
    face.add('mouthSmile', 0.2 * hidden + 0.6 * boo);
    face.add('mouthOpen', 0.35 * boo);
    face.add('eyeZoom', 0.7 * boo);
    face.add('browRaiseL', 0.45 * boo);
    face.add('browRaiseR', 0.45 * boo);
    face.add('lidUpL', -0.2 * boo);
    face.add('lidUpR', -0.2 * boo);
    if (s.phase === 0 && t >= BOO) {
      s.note('boo', 0);
      s.next(1);
    }
    if (s.phase === 1 && t >= BOO + 0.35) {
      s.act(0, s.profile(0).giggle, 'giggle');
      s.next(2);
    }
    if (t >= DOWN) s.done();
  },
};
