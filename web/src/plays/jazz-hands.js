// Solo: jazz hands (Unity Plays/JazzHands.cs). Both hands spring up and out beside the head, palms to the viewer, fingers
// splayed, and shimmer (the wrists shaking fast) while the bot beams wide-eyed and bobs on the beat; a flourish down.
import { REST, REST_FINGERS, REST_PALM, S_SPLAYED, SHAPES, arc, clamp01, hold, lerpShape, onFaceBlend, pulse, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

const AT = v3(1.5, 0.3, 0.75);
const FINGERS = v3(0.3, 1, 0.1), PALM = v3(0, -0.1, 1);
const UP = 0.4, HOLD_END = 2.1, DOWN = 2.6;
/** Shimmers per second (each a turn of the wrists one way and back). */
const SHIMMER = 5.5;

export default {
  id: 'jazz-hands',
  cast: 'solo',

  begin(s) {
    s.note('jazz', 0);
  },

  step(s) {
    const t = s.t;
    // a spring up with a little overshoot
    const up = smoother(t / UP);
    const over = Math.sin(clamp01((t - UP * 0.6) / 0.35) * Math.PI) * 0.12;
    const u = up * (1 - smoother((t - HOLD_END) / (DOWN - HOLD_END)));
    const shimmer = hold(t, UP * 0.7, UP + 0.1, HOLD_END - 0.2, HOLD_END);
    const bob = 0.05 * pulse(s.beat, 5) * shimmer;
    for (let side = -1; side <= 1; side += 2) {
      const a = Math.sin((t * SHIMMER + (side > 0 ? 0 : 0.25)) * Math.PI * 2) * 0.55 * shimmer;
      const at = v3(AT.x + 0.1 * over, AT.y + 0.12 * over + bob, AT.z);
      const pos = arc(REST, v3(1.75, -0.35, 0.7), at, u);
      // the shimmer: the palm turns to and fro about the forearm
      const palm = v3(Math.sin(a), PALM.y, Math.cos(a));
      s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, FINGERS, palm, u * 1.4,
        lerpShape(SHAPES.relaxed, S_SPLAYED, ramp(t, 0.1, UP)), 'palm'));
    }
    const face = s.face(0);
    const glow = hold(t, 0.1, UP, HOLD_END, DOWN);
    face.add('mouthSmile', 0.55 * glow);
    face.add('mouthOpen', 0.3 * glow);
    face.add('mouthWidth', 0.3 * glow);
    face.add('eyeZoom', 0.5 * glow);
    face.add('browRaiseL', 0.35 * glow);
    face.add('browRaiseR', 0.35 * glow);
    face.tilt(0.05 * Math.sin(t * 5) * shimmer, 0.05 * glow);
    if (s.phase === 0 && t >= UP) {
      s.sparkle(0, s.botToWorld(0, v3(0, 1.1, 0.6)), 'stardust');
      s.note('ta-da', 0);
      s.next(1);
    }
    if (t >= DOWN) s.done();
  },
};
