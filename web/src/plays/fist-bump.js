// Duo: a fist bump with an "explosion" (Unity Plays/FistBump.cs). Two neighbours nod to each other and bring their RIGHT
// fists (a quarter of the time both left) up in front of the gap between them, low (the one whose fist is its outer hand
// reaches across under its chin), knuckles to knuckles, thumbs up. A little draw back, then bump, decelerating into it:
// the knuckles really touch with a spark. Then both fists burst open, fingers wide, and fly back and up with a wiggle,
// the mouths round in an "ooh", and they giggle.
import * as THREE from 'three';
import { KNUCKLES_LOCAL, touchPlace } from '../scene/hand-touch.js';
import { FIST, SPREAD, aimByThumb, approach, bump, crosses, duoCast, duoFrame, duoNow, lerpShape, meet, slerpDir, smooth, smoother } from './kit.js';

const UP = new THREE.Vector3(0, 1, 0);
/** Where the knuckles meet: between the heads, a little low, toward the viewer (half-widths). */
const BUMP = meet(0.5, 0, -1.15, 0.9, 2.6, 2.6);
const MARKS = [BUMP];
const UP_S = 0.9, DRAW = 0.3, HIT = 0.16, TOUCH = 0.18, BURST = 0.75, DOWN_S = 0.5;
/** How far the fists' fronts are from the meeting point: ready, drawn back, bumping (half-widths). */
const READY = 0.4, DRAWN = 0.75, CONTACT = 0;
const NODS = ['nod'];
const lerp = (a, b, t) => a + (b - a) * t;

export default {
  id: 'fist-bump',
  cast: 'duo',
  maxSeconds: 10,
  blendIn: 0.4,
  blendOut: 0.45,
  handOf: () => 'right',
  leftPairs: 0.25,
  pair: 'same',
  tryCast: (s) => duoCast(s, MARKS, 0.15),

  begin(s) {
    s.note('raise', 0, 1);
    s.look(0, 1, 1.2);
    s.look(1, 0, 1.2);
    s.act(0, NODS, 'nod', 1);
    s.react(1, 0.2, NODS, 'nod', 0, 1);
  },

  step(s) {
    const f = duoFrame(s);
    const { across, toViewer, u } = f;
    const at = duoNow(s, BUMP, f);
    const t = s.phaseT;
    let gap = READY, weight = 1, low = 0, open = 0, fly = 0, ooh = 0;
    switch (s.phase) {
      case 0:
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        low = 1 - smooth(t / UP_S);
        if (t >= UP_S) {
          s.lookAt(0, at, 1.2);
          s.lookAt(1, at, 1.2);
          s.next(1);
        }
        break;
      case 1: // draw back, bump
        gap = t < DRAW ? lerp(READY, DRAWN, smooth(t / DRAW)) : lerp(DRAWN, CONTACT, smooth((t - DRAW) / HIT));
        if (t >= DRAW + HIT) {
          s.note('bump', 0, 1);
          s.sparkle(0, at.clone().addScaledVector(toViewer, 0.1 * u), 'sparks');
          for (let k = 0; k < 2; k++) s.jolt(k, across.clone().multiplyScalar((k === 0 ? -1 : 1) * 0.8 * s.radius(k)));
          s.next(2);
        }
        break;
      case 2: // the touch
        gap = CONTACT;
        if (t >= TOUCH) {
          s.note('explode', 0, 1);
          for (let k = 0; k < 2; k++) s.face(k).flickAntenna(new THREE.Vector3(k === 0 ? -0.1 : 0.1, 0.12, 0));
          s.next(3);
        }
        break;
      case 3: // burst open, fly back and up, wiggling
        gap = CONTACT;
        open = smooth(t / 0.15);
        fly = smoother(t / 0.5);
        ooh = bump(t, 0, BURST);
        if (t >= BURST) {
          s.react(0, 0.05, s.profile(0).giggle, 'giggle', 1, 1.2);
          s.react(1, 0.2, s.profile(1).giggle, 'giggle', 0, 1.2);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(4);
        }
        break;
      default: // down
        gap = CONTACT;
        open = 1 - smooth(t / DOWN_S);
        fly = 1;
        low = smooth(t / DOWN_S);
        weight = 1 - smooth(t / DOWN_S);
        if (t >= DOWN_S) s.done();
        break;
    }
    const wiggle = s.phase === 3 ? Math.sin(t * 26) * open * (1 - smooth((t - 0.3) / 0.45)) : 0;
    for (let k = 0; k < 2; k++) {
      const dir = across.clone().multiplyScalar(k === 0 ? 1 : -1);
      const side = s.side[k];
      // a fist: fingers toward the other, thumb up (the curled fingers to the viewer); open: fingers up and out
      const fingers = slerpDir(dir.clone().addScaledVector(UP, 0.1).normalize(), UP.clone().addScaledVector(dir, 0.35).normalize(), open)
        .addScaledVector(dir, 0.25 * wiggle).normalize();
      const shape = lerpShape(FIST, SPREAD, open);
      shape.spread += 0.3 * wiggle;
      const aim = aimByThumb(side, at, fingers, UP.clone().addScaledVector(dir, -open).normalize(), shape, 'knuckles', weight);
      // the fist's front (its middle knuckle) `gap` short of the meeting point: the knuckles touch at the bump
      touchPlace(shape, side, aim.rotation, s.handScale(k), KNUCKLES_LOCAL, at, dir, (gap + 0.15 * fly) * u, false, aim.position);
      // the one that reached across flies out toward the viewer, staying under its chin
      if (crosses(s, k, side, 1 - k)) aim.position.addScaledVector(UP, 0.15 * fly * u).addScaledVector(toViewer, 0.7 * fly * u);
      else aim.position.addScaledVector(UP, 0.9 * fly * u).addScaledVector(toViewer, 0.4 * fly * u);
      // in from beside the head (the one reaching across under its chin), and back the same way
      if (low > 0) aim.position = approach(s, k, side, aim.position, 1 - low);
      aim.exact = 1;
      s.hand(k, side, aim);
      const face = s.face(k);
      face.add('mouthRound', 0.55 * ooh);
      face.add('mouthOpen', 0.4 * ooh);
      face.add('eyeZoom', 0.3 * ooh);
      face.add('mouthSmile', 0.3 * (1 - low));
    }
  },
};
