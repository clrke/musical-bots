// Duo: a high five (Unity Plays/HighFive.cs). Two neighbours look at each other and raise their RIGHT hands (a quarter
// of the time both left) high between them (the one whose hand is its outer one swings it up over its head), fingers
// spread, palms to each other. A short wind-up, then slap: the palms square up and meet above the gap (the palm plates
// touch, decelerating into it) with a spark, both heads bounce back a touch and their antennas swing; the hands bounce
// apart with a little shake, come down, and both cheer or giggle.
import * as THREE from 'three';
import { SPREAD_SHAPE, PAD_LOCAL, palmFor, touchPlace } from '../scene/hand-touch.js';
import { SHAPES, approach, duoCast, duoFrame, duoNow, lerpShape, meet, slerpDir, smooth } from './kit.js';
import { aimInWorld } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
/** Where the palms meet: high between the heads, a little toward the viewer (half-widths). */
const SLAP = meet(0.5, 0, 1.3, 0.75, 2.65, 2.65);
const MARKS = [SLAP];
/** Up, wind-up, the slap, pressed, springing apart, down (s). */
const UP_S = 0.8, WIND = 0.28, HIT = 0.15, PRESS = 0.3, SPRING = 0.5, DOWN_S = 0.5;
/** How far each palm is from the meeting point when ready and wound up (half-widths). */
const READY = 0.55, WOUND = 0.8;
const CHEERS = ['bounce', 'brighten', 'squeal', 'giggle'];
const lerp = (a, b, t) => a + (b - a) * t;

export default {
  id: 'high-five',
  cast: 'duo',
  maxSeconds: 10,
  blendIn: 0.4,
  blendOut: 0.45,
  handOf: () => 'right',
  leftPairs: 0.25,
  pair: 'same',
  tryCast: (s) => duoCast(s, MARKS, 0.2),

  begin(s) {
    s.note('raise', 0, 1);
    s.look(0, 1, 1.2);
    s.look(1, 0, 1.2);
    s.act(0, s.profile(0).exchange, 'smile', 1);
  },

  step(s) {
    const f = duoFrame(s);
    const { across, toViewer, u } = f;
    const at = duoNow(s, SLAP, f);
    // square: the palms turn from facing a little toward the viewer to facing each other for the slap, and back
    const t = s.phaseT;
    let gap = READY, weight = 1, shake = 0, low = 0, square = 0;
    switch (s.phase) {
      case 0: // up they come
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        low = 1 - smooth(t / UP_S);
        if (t >= UP_S) {
          s.lookAt(0, at, 1);
          s.lookAt(1, at, 1);
          s.next(1);
        }
        break;
      case 1: // the wind-up, then the slap: decelerating into it, the palms square to each other
        square = smooth(t / WIND);
        gap = t < WIND ? lerp(READY, WOUND, smooth(t / WIND)) : lerp(WOUND, 0, smooth((t - WIND) / HIT));
        if (t >= WIND + HIT) {
          s.note('slap', 0, 1);
          s.sparkle(0, at.clone().addScaledVector(toViewer, 0.1 * u), 'stardust');
          for (let k = 0; k < 2; k++) {
            s.jolt(k, across.clone().multiplyScalar((k === 0 ? -1 : 1) * 1.2 * s.radius(k)).addScaledVector(UP, 0.4 * s.radius(k)));
            s.face(k).flickAntenna(new THREE.Vector3((k === 0 ? -1 : 1) * 0.12, 0.08, 0));
          }
          s.next(2);
        }
        break;
      case 2: // pressed a moment, eyes squeezed with glee
        gap = 0;
        square = 1;
        if (t >= PRESS) {
          s.act(0, CHEERS, 'cheer', 1);
          s.react(1, 0.15, s.profile(1).giggle, 'giggle', 0, 1.2);
          s.next(3);
        }
        break;
      case 3: { // bounce apart (fast, then slowing) with a shake
        const x = Math.min(1, t / 0.25);
        gap = READY * (1 - (1 - x) * (1 - x));
        square = 1 - smooth(t / SPRING);
        shake = Math.sin(t * 30) * (1 - smooth(t / SPRING));
        if (t >= SPRING) {
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(4);
        }
        break;
      }
      default: // down
        gap = READY;
        low = smooth(t / DOWN_S);
        weight = 1 - smooth(t / DOWN_S);
        if (t >= DOWN_S) s.done();
        break;
    }
    const glee = s.phase === 2 ? 1 : s.phase === 3 ? 1 - smooth(t / SPRING) : 0;
    for (let k = 0; k < 2; k++) {
      const dir = across.clone().multiplyScalar(k === 0 ? 1 : -1); // toward the other
      const side = s.side[k];
      const fingers = UP.clone().addScaledVector(dir, 0.12).addScaledVector(across, 0.15 * shake).normalize();
      const palm = slerpDir(dir.clone().multiplyScalar(0.8).addScaledVector(toViewer, 0.6).normalize(), dir, square);
      const shape = lerpShape(SHAPES.relaxed, SPREAD_SHAPE, 1 - low * 0.6);
      const aim = aimInWorld(at, fingers, palm, shape, 'palm', weight);
      palmFor(aim.rotation, side, s.side[1 - k], aim.rotation);
      // the hand's front `gap` short of where the palms meet (the palm plates touching at the slap), drawn without lag
      touchPlace(shape, side, aim.rotation, s.handScale(k), PAD_LOCAL, at, dir, gap * u, s.side[0] === s.side[1], aim.position);
      aim.position.addScaledVector(DOWN, 0.12 * u * Math.max(0, gap - READY)).addScaledVector(UP, 0.05 * u * shake);
      // up from beside the head (the one reaching across goes over it)
      if (low > 0) aim.position = approach(s, k, side, aim.position, 1 - low, true);
      aim.exact = 1;
      s.hand(k, side, aim);
      const face = s.face(k);
      face.add('mouthSmile', 0.4 * (1 - low));
      face.add('mouthOpen', 0.35 * glee);
      face.add('lidLowL', 0.4 * glee);
      face.add('lidLowR', 0.4 * glee);
    }
  },
};
