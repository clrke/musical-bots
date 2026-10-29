// Duo: a handshake (Unity Plays/Handshake.cs). Two neighbours greet each other with a look and a nod; their RIGHT hands
// (always) meet on the diagonal in front of the gap between them, low (the one whose right hand is its outer one reaches
// across under its chin), and grip (GRIP_SHAKE: palms pressed, fingers round the heel, thumbs up over the back). They
// pump up and down on the beat, three times, both heads nodding with each pump, a polite smile; then let go and nod.
import * as THREE from 'three';
import { GRIP_SHAKE } from '../scene/hand-touch.js';
import { clamp01, duoCast, duoClasp, duoFrame, duoNow, meet, smooth } from './kit.js';

const UP = new THREE.Vector3(0, 1, 0);
const CLASP = meet(0.5, 0, -1.25, 0.85, 2.6, 2.6);
const MARKS = [CLASP];
const REACH = 0.85, PUMPS = 3, LET_GO = 0.7, AFTER = 0.9;
/** A pump's height (half-widths). */
const PUMP = 0.28;
const NODS = ['nod', 'kindnod'];

export default {
  id: 'handshake',
  cast: 'duo',
  maxSeconds: 11,
  blendIn: 0.45,
  blendOut: 0.45,
  handOf: () => 'right',
  pair: 'same',
  tryCast: (s) => duoCast(s, MARKS, 0.2),

  begin(s) {
    s.note('greet', 0, 1);
    s.look(0, 1, 2);
    s.look(1, 0, 2);
    s.act(0, s.profile(0).exchange, 'greet', 1);
    s.react(1, 0.3, s.profile(1).ret, 'greet', 0, 1.6);
  },

  step(s) {
    const f = duoFrame(s);
    const c = duoNow(s, CLASP, f);
    const t = s.phaseT;
    let weight = 1, pump = 0, reach = 1;
    switch (s.phase) {
      case 0:
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        reach = clamp01(t / REACH);
        if (t >= REACH) {
          s.note('clasp', 0, 1);
          s.mark = s.nextBeat(s.beat, 0.2);
          s.next(1);
        }
        break;
      case 1: {
        // pump on the beat: down on each beat
        const b = s.beat - s.mark;
        if (b >= 0) {
          if (s.round === 0) {
            s.note('pump', 0, 1);
            s.round = 1;
          }
          pump = b < PUMPS ? -Math.sin(2 * Math.PI * b) : 0;
        }
        if (b >= PUMPS) {
          s.note('let go', 0, 1);
          s.next(2);
        }
        break;
      }
      case 2: // let go: back the way they came (under the chin)
        reach = 1 - clamp01(t / LET_GO);
        if (t >= LET_GO) {
          s.act(0, NODS, 'nod', 1);
          s.react(1, 0.2, NODS, 'nod', 0, 1);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(3);
        }
        break;
      default:
        reach = 0;
        weight = 1 - smooth(t / 0.4);
        if (t >= AFTER) s.done();
        break;
    }
    for (let k = 0; k < 2; k++) {
      const face = s.face(k);
      face.tilt(0, 0.09 * pump);
      face.add('mouthSmile', s.phase === 1 ? 0.35 : 0);
    }
    if (weight <= 0) return;
    // right to right: A's fingers toward B, both thumbs up; the hand that reached across in front
    duoClasp(s, s.side[0], GRIP_SHAKE, c.addScaledVector(UP, PUMP * f.u * pump), f.across, UP, GRIP_SHAKE.shape, GRIP_SHAKE.shape, weight, reach);
  },
};
