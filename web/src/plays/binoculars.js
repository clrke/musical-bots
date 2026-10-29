// Solo: binoculars (Unity Plays/Binoculars.cs). Both hands curl into little tubes in front of the eyes, the head scans
// slowly from side to side, then stops on the viewer: the eyes zoom, the brows go up, a twinkle, and the hands come down.
import { handShape } from '../scene/hand-rig.js';
import { REST, REST_FINGERS, REST_PALM, SHAPES, arc, hold, lerpShape, onFaceBlend, pointOf, smoother, v3 } from './kit.js';
import { ramp } from './stage.js';

/** A tube: the fingers curled round, the thumb meeting the index. */
const TUBE = handShape(0.45, 0.55, 0.6, 0.66, 0.72, 0, 0.6);
const UP = 0.6, SCAN_END = 2.6, FOUND = 2.75, HOLD_END = 3.5, DOWN = 4;
const SPOT_ACTS = ['twinkle', 'brighten'];

export default {
  id: 'binoculars',
  cast: 'solo',

  begin(s) {
    // each hand its own side's eye (side-normalised; a face off the head's middle has its eyes off-centre too)
    s.V[0].copy(pointOf(s, 0, 'eye', 1, 1));
    s.V[1].copy(pointOf(s, 0, 'eye', -1, -1));
    s.lookAt(0, s.viewer, DOWN);
    s.note('binoculars', 0);
  },

  step(s) {
    const t = s.t;
    const u = smoother(t / UP) * (1 - smoother((t - HOLD_END) / (DOWN - HOLD_END)));
    const spotted = ramp(t, SCAN_END, FOUND);
    for (let side = -1; side <= 1; side += 2) {
      const eye = side > 0 ? s.V[0] : s.V[1];
      // the tube's eye end (thumb and index) just in front of the eye, a little forward when it spots the viewer
      const at = eye.clone().add(v3(0.02, -0.02, 0.2 + 0.1 * spotted));
      const pos = arc(REST, v3(1.35, -0.3, 1.1), at, u);
      const shape = lerpShape(SHAPES.relaxed, TUBE, ramp(t, 0.1, UP));
      // the tube's axis to the viewer: the thumb side toward the face, fingers up, the palm in toward the nose
      s.hand(0, side, onFaceBlend(s, 0, side, pos, REST_FINGERS, REST_PALM, v3(0.1, 1, 0), v3(-1, 0, 0.05), u * 1.3, shape, 'pinch'));
    }
    const face = s.face(0);
    const scan = hold(t, UP * 0.6, UP + 0.2, SCAN_END - 0.4, SCAN_END);
    // scanning slowly from side to side (the head turns; the binoculars turn with it)
    face.add('headYaw', 0.32 * Math.sin((t - UP) * 2.4) * scan);
    face.add('headPitch', 0.05 * scan);
    face.add('eyeZoom', 0.3 * scan + 0.8 * spotted * (1 - ramp(t, HOLD_END, DOWN)));
    const glee = hold(t, SCAN_END, FOUND + 0.1, HOLD_END, DOWN);
    face.add('browRaiseL', 0.5 * glee);
    face.add('browRaiseR', 0.5 * glee);
    face.add('mouthSmile', 0.15 * u + 0.45 * glee);
    face.add('mouthOpen', 0.25 * glee);
    if (s.phase === 0 && t >= FOUND) {
      s.act(0, SPOT_ACTS, 'spotted');
      s.next(1);
    }
    if (t >= DOWN) s.done();
  },
};
