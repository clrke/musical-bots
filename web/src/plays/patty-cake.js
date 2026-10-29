// Duo: patty-cake, played face to face (Unity Plays/PattyCake.cs). Two neighbours turn to each other and play on the
// beat: a clap of their own hands in front of them, then RIGHT hand to right hand (crossed, on the diagonal: the one whose
// right is its outer hand reaches across under its chin), clap, LEFT hand to left hand, clap, right to right... for two
// bars (fewer when the song is slow); their mouths sing along on every beat. The last beat is the double pat, both hands
// straight across (each one's right to the other's left: the inner hands high, the outer ones crossing low), two quick
// pats, and they giggle. Every clap and pat really meets (the palm plates touch): the hands decelerate into it, stay
// pressed a moment and bounce apart, drawn without lag.
import * as THREE from 'three';
import { FLAT_SHAPE, PAD_LOCAL, palmSame, palmTouch, touchOpen, touchPlace } from '../scene/hand-touch.js';
import { clamp01, duoCast, duoFrame, duoNow, meet, slerpDir, smooth, smoother, toward } from './kit.js';
import { aimInWorld } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
/** The pats between them (low and high) and the own claps in front of each (half-widths). */
const PAT_UP = -1.05, PAT_HIGH = 0.15, PAT_FRONT = 1, CLAP_DOWN = 1.0, CLAP_FRONT = 1.0, OUTER = 1.15, WAIT_DOWN = 1.05, WAIT_FRONT = -0.1;
/** Between hits each palm backs off this far (half-widths); a hit stays pressed this long (s). */
const BACK = 0.22, PRESS = 0.045;
const MARKS = [meet(0.5, 0, PAT_HIGH, PAT_FRONT, 2.5, 2.5), meet(0.5, 0, PAT_UP, PAT_FRONT, 2.5, 2.5)];
/** A hand's part in a move: it gets out of the way (waits, or goes high), or it crosses under its chin. */
const ASIDE = 1, ACROSS = 2;

/** What the hands do on beat n (0 clap, 1 right hands crossed, 2 left hands crossed, 3 the double pat, straight). */
const move = (n, beats) => (n >= beats - 1 ? 3 : (n & 1) === 0 ? 0 : (n & 2) === 0 ? 1 : 2);
/** The hits: one on every beat, and the double pat's second half a beat after the last one. */
const hitsOf = (beats) => beats + 1;
/** When hit i lands (beats from the first) and what it is. */
const hitAt = (i, beats) => (i < beats ? i : beats - 0.5);
const hitMove = (i, beats) => (i < beats ? move(i, beats) : 3);

/**
 * One hand's hit for a move: the point it hits (the middle of the plane where it meets the other palm), the way it faces
 * (toward that palm), where its fingers point, whether the hand it meets is of its own side, and its part.
 */
function hit(s, k, side, mv, across, toViewer, u) {
  const head = s.head(k);
  const sideDir = s.rightOf(k).multiplyScalar(side); // outward for this hand
  const dir = across.clone().multiplyScalar(k === 0 ? 1 : -1);
  const h0 = s.head(0), h1 = s.head(1);
  const mid = h0.clone().add(h1).multiplyScalar(0.5).addScaledVector(toViewer, PAT_FRONT * u);
  const low = Math.min(h0.y, h1.y) - mid.y; // the crossed and outer pats: under the lower chin
  if (mv === 0) {
    // own clap: the palms meet in front of the face, low
    return { at: head.addScaledVector(DOWN, CLAP_DOWN * u).addScaledVector(toViewer, CLAP_FRONT * u), facing: sideDir.negate(),
      fingers: UP.clone().addScaledVector(toViewer, 0.35).normalize(), same: false, role: 0 };
  }
  if (mv === 3) {
    // straight across: the inner hands high, the outer ones low
    const inner = side === toward(s, k, 1 - k);
    return { at: mid.addScaledVector(UP, inner ? PAT_HIGH * u : low + PAT_UP * u), facing: dir, fingers: UP.clone(), same: false, role: inner ? ASIDE : ACROSS };
  }
  const pats = mv === 1 ? s.side[0] : -s.side[0];
  if (side === pats) {
    // crossed: palm to the other's palm of the same side, between them, low
    return { at: mid.addScaledVector(UP, low + PAT_UP * u), facing: dir, fingers: UP.clone(), same: true, role: side === toward(s, k, 1 - k) ? 0 : ACROSS };
  }
  // the other hand waits beside the bot, palm in, back (the crossing hand goes by in front of it)
  return { at: head.addScaledVector(sideDir, OUTER * u).addScaledVector(DOWN, WAIT_DOWN * u).addScaledVector(toViewer, WAIT_FRONT * u),
    facing: sideDir.clone().negate(), fingers: UP.clone().addScaledVector(toViewer, 0.3).normalize(), same: false, role: ASIDE };
}

export default {
  id: 'patty-cake',
  cast: 'duo',
  maxSeconds: 14,
  blendIn: 0.5,
  blendOut: 0.45,
  handOf: () => 'right',
  pair: 'same',
  tryCast: (s) => duoCast(s, MARKS, 0.35),

  begin(s) {
    // 8 beats (two bars), 4 when the song is slow; the last one the double pat
    s.I[0] = s.beatSec * 9 > 7 ? 5 : 9;
    s.look(0, 1, 2);
    s.look(1, 0, 2);
    s.note('ready', 0, 1);
  },

  step(s) {
    const f = duoFrame(s);
    const { across, toViewer, u } = f;
    const beats = s.I[0], hits = hitsOf(beats);
    const t = s.phaseT;
    let weight = 1;
    const b = s.phase >= 1 ? s.beat - s.mark : -1;
    switch (s.phase) {
      case 0: // turn, drift a touch closer, hands up for the first clap
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        if (t >= 0.7) {
          s.mark = s.nextBeat(s.beat, 0.6); // at least half a beat to close into the first clap
          s.next(1);
        }
        break;
      case 1:
        if (b >= 0 && s.round < hits && b >= hitAt(s.round, beats)) {
          const m = hitMove(s.round, beats);
          if (s.round < beats) {
            s.note(m === 0 ? 'clap' : m === 3 ? 'double pat' : 'pat', 0, 1);
            if (m === 1 || m === 2) {
              // the hands that cross: the same side on both (logged as each pat lands)
              const pats = m === 1 ? s.side[0] : -s.side[0];
              s.noteHand(0, pats, 1);
              s.noteHand(1, pats, 0);
            }
          }
          if (s.round === beats - 1) {
            s.sparkle(0, duoNow(s, MARKS[0], f).addScaledVector(toViewer, 0.2 * u), 'notes');
            for (let k = 0; k < 2; k++) s.face(k).flickAntenna(new THREE.Vector3(0, 0.12, 0));
          }
          s.round++;
        }
        if (b >= hitAt(hits - 1, beats) + 0.5) {
          s.react(0, 0.05, s.profile(0).giggle, 'giggle', 1, 1.2);
          s.react(1, 0.2, s.profile(1).giggle, 'giggle', 0, 1.2);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.next(2);
        }
        break;
      default:
        weight = 1 - smooth(t / 0.5);
        if (t >= 0.5) s.done();
        break;
    }
    // between hit i and hit i + 1, moving from one hit's place to the next, backed off from where they hit
    let from, to, x, open;
    const sec = Math.max(0.1, s.beatSec), beat = 0.5 * (sec - PRESS);
    if (b < 0) {
      from = to = hitMove(0, beats);
      x = 0;
      open = s.phase === 0 ? 1 : touchOpen(b * sec, beat, PRESS, beat);
    } else {
      let i = 0;
      while (i + 1 < hits && b >= hitAt(i + 1, beats)) i++;
      const j = Math.min(i + 1, hits - 1);
      const t0 = hitAt(i, beats), t1 = hitAt(j, beats);
      from = hitMove(i, beats);
      to = hitMove(j, beats);
      x = j > i ? clamp01((b - t0) / (t1 - t0)) : 0;
      if (j === i) open = touchOpen((b - t0) * sec, beat, PRESS, beat); // after the last: off and apart
      else {
        const half = 0.5 * ((t1 - t0) * sec - PRESS);
        open = b - t0 < t1 - b ? touchOpen((b - t0) * sec, half, PRESS, half) : touchOpen((b - t1) * sec, half, PRESS, half);
      }
    }
    const blend = smoother((x - 0.15) / 0.75);
    for (let k = 0; k < 2; k++) {
      const scale = s.handScale(k);
      for (let h = 0; h < 2; h++) {
        const side = h === 0 ? 1 : -1;
        const A = hit(s, k, side, from, across, toViewer, u);
        const B = hit(s, k, side, to, across, toViewer, u);
        // a hand that gets out of the way goes early and the hand that crosses (under it) a little late; coming back to
        // the clap the other way round (from waiting beside straight across to the double pat: the whole beat)
        const bh = A.role === ASIDE && B.role === ACROSS ? smooth(x)
          : to === 0 && A.role === ASIDE ? smoother((x - 0.4) / 0.6)
          : to === 0 && A.role === ACROSS ? smoother((x - 0.05) / 0.7)
          : B.role === ASIDE && A.role !== ASIDE ? smoother(x / 0.6)
          : B.role === ACROSS && A.role !== ACROSS ? smoother((x - 0.25) / 0.7)
          : blend;
        const at = A.at.clone().lerp(B.at, bh);
        // a palm turning right round (a clap to a pat) turns through facing the viewer
        const n = A.facing.dot(B.facing) < -0.5
          ? (bh < 0.5 ? slerpDir(A.facing, toViewer, 2 * bh) : slerpDir(toViewer, B.facing, 2 * bh - 1))
          : slerpDir(A.facing, B.facing, bh);
        const fingers = slerpDir(A.fingers, B.fingers, bh);
        const aim = aimInWorld(at, fingers, n, FLAT_SHAPE, 'palm', weight);
        // a crossed pat meets the other's hand of the same side (no roll); claps and straight pats meet an opposite one
        const rot = aim.rotation.clone();
        const r0 = A.same ? palmSame(rot) : palmTouch(rot, side), r1 = B.same ? palmSame(rot) : palmTouch(rot, side);
        aim.rotation = r0.slerp(r1, bh);
        // the palm plate's front `BACK x open` short of where it hits (touching on the beat)
        touchPlace(FLAT_SHAPE, side, aim.rotation, scale, PAD_LOCAL, at, n, BACK * u * open, bh < 0.5 ? A.same : B.same, aim.position);
        aim.exact = 1;
        s.hand(k, side, aim);
      }
      if (b >= 0 && s.phase === 1) {
        const y = b - Math.floor(b);
        const sing = y < 0.4 ? Math.sin((Math.PI * y) / 0.4) : 0;
        const face = s.face(k);
        face.add('mouthOpen', 0.3 * sing);
        face.add('mouthSmile', 0.3);
        face.tilt(0.05 * s.side[k], -0.05 * sing);
      }
    }
  },
};
