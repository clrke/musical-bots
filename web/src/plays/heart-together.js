// Duo: a heart made together (Unity Plays/HeartTogether.cs). Two neighbours side by side look at each other and drift a
// little closer; each curls its inner hand (one left, one right: mirror images) into half a heart, the palm toward the
// other, leaning out from the wrist, the fingers arched over the top and back in, the thumb along the index. The halves
// form a little apart in front of the gap between them, then slide together into one heart and meet cleanly: the
// fingertips at its top, the wrists at its point. Both beam (a smile, a blush, happy eyes, heads tipped toward each
// other) while the heart sways gently on the beat. Then the halves part and both giggle.
import * as THREE from 'three';
import { D2R, handShape, lookRotation } from '../scene/hand-rig.js';
import { touchPlace } from '../scene/hand-touch.js';
import { SHAPES, duoCast, duoFrame, duoNow, lerpShape, meet, smooth, smoother } from './kit.js';
import { aimInWorld } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), ZERO = new THREE.Vector3();
/** The heart's middle: between the heads, a little below their middle, toward the viewer (half-widths). */
const MARKS = [meet(0.5, 0, -0.1, 1.0, 2.3, 2.3)];
/** Half a heart, seen from the side: the four fingers curled over into the heart's round top, the thumb along the index. */
export const HALF = handShape(0, 0.6, 0.62, 0.65, 0.68, 0, -0.3, 0.2);
/** How far each hand leans out from upright (deg), turning in the heart's plane. */
const LEAN = 20;
/** Forming, apart, sliding together, held, parting (s). */
const FORM = 0.9, SLIDE = 0.45, HOLD = 2.6, PART = 0.5;

export default {
  id: 'heart-together',
  cast: 'duo',
  maxSeconds: 14,
  blendIn: 0.5,
  blendOut: 0.5,
  handOf: () => 'inner',
  pair: 'opposite',
  tryCast: (s) => duoCast(s, MARKS, 0.45),

  begin(s) {
    s.look(0, 1, 1.5);
    s.act(0, s.profile(0).exchange, 'smile', 1);
    s.react(1, 0.3, s.profile(1).ret, 'smile', 0, 1.3);
  },

  step(s) {
    const f = duoFrame(s);
    const { across, toViewer, u } = f;
    let apart = 1, weight = 1, glow = 0;
    const t = s.phaseT;
    switch (s.phase) {
      case 0: // the halves form, apart (the heads drift a little closer)
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        if (t >= FORM) {
          s.note('halves', 0, 1);
          s.next(1);
        }
        break;
      case 1: // they slide together
        apart = 1 - smoother(t / SLIDE);
        if (t >= SLIDE) {
          s.note('heart', 0, 1);
          s.sparkle(0, duoNow(s, MARKS[0], f).addScaledVector(toViewer, 0.15 * u), 'hearts');
          s.act(0, s.profile(0).giggle, 'beam', 1);
          s.react(1, 0.2, s.profile(1).giggle, 'beam', 0, 1.2);
          s.next(2);
        }
        break;
      case 2: // held: both beam, the heart sways on the beat
        apart = 0;
        glow = smooth(t / 0.4);
        if (s.round === 0 && t >= 1.3) {
          s.sparkle(1, duoNow(s, MARKS[0], f).addScaledVector(UP, 0.3 * u), 'hearts');
          s.round = 1;
        }
        if (t >= HOLD) {
          s.react(0, 0.1, s.profile(0).giggle, 'giggle', 1, 1.2);
          s.react(1, 0.3, s.profile(1).giggle, 'giggle', 0, 1.2);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(3);
        }
        break;
      default: // the halves part
        apart = smooth(t / PART);
        glow = 1 - smooth(t / PART);
        weight = 1 - smooth(t / PART);
        if (t >= PART) s.done();
        break;
    }
    const sway = s.phase >= 2 ? glow * Math.sin(Math.PI * s.beat * 0.5) : 0;
    // the heart's point (where the wrists meet) and the rock of the whole heart on the beat, about its middle
    const point = duoNow(s, MARKS[0], f).addScaledVector(DOWN, 0.32 * u).addScaledVector(UP, 0.04 * u * sway * sway);
    const rock = new THREE.Quaternion().setFromAxisAngle(toViewer, 6 * sway * D2R);
    const middle = point.clone().addScaledVector(UP, 0.32 * u);
    const form = smooth(s.phase === 0 ? t / (FORM * 0.8) : 1);
    const shape = lerpShape(SHAPES.relaxed, HALF, form);
    const lean = LEAN * D2R;
    for (let k = 0; k < 2; k++) {
      const dir = across.clone().multiplyScalar(k === 0 ? 1 : -1); // toward the other
      const side = s.side[k];
      // seen edge on, in the heart's plane: the palm toward the other and a little up, the hand leaning out from the
      // wrist, the fingers curling back in over the top; its front `apart` short of the middle: touching when together
      const fingers = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(dir, -Math.sin(lean));
      const palm = dir.clone().multiplyScalar(Math.cos(lean)).addScaledVector(UP, Math.sin(lean));
      const rot = lookRotation(fingers, palm);
      const wrist = touchPlace(shape, side, rot, s.handScale(k), ZERO, point, dir, 0.55 * apart * u);
      const aim = aimInWorld(wrist.sub(middle).applyQuaternion(rock).add(middle), fingers.applyQuaternion(rock), palm.applyQuaternion(rock), shape, 'wrist', weight);
      aim.rotation = rock.clone().multiply(rot);
      aim.exact = 1;
      s.hand(k, side, aim);
      const face = s.face(k);
      face.add('mouthSmile', 0.5 * glow);
      face.add('blush', 0.45 * glow);
      face.add('lidLowL', 0.3 * glow);
      face.add('lidLowR', 0.3 * glow);
      face.tilt(0.12 * s.side[k] * glow, 0.03 * glow);
      if (s.phase === 2 && t < 0.1) s.lookAt(k, middle, 1);
    }
  },
};
