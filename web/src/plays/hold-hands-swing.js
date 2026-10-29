// Duo: two neighbours side by side hold hands and swing them (Unity Plays/HoldHandsSwing.cs). They look at each other,
// drift a little closer if they must, and their inner hands reach out and lace just below and in front of the gap
// between their heads; from the next beat the laced hands swing like a pendulum, one swing each beat, for 2-4 bars, the
// heads swaying with them; then they let go and both react (a giggle or a happy act, looking at each other).
import * as THREE from 'three';
import { D2R } from '../scene/hand-rig.js';
import { laceClasp } from '../scene/hand-touch.js';
import { DUO_TRAVEL, SNUG, smooth, toViewerFrom } from './kit.js';
import { letGo, LET_GO_SECONDS } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0);
/** The clasp hangs this far below the heads' middle and this far toward the viewer (half-widths). */
const BELOW = 1.2, FRONT = 0.45;
/** A hand reaches the clasp from this many half-widths of its head at most (the swing needs the rest of its reach). */
const REACH = 2.35;
/** The swing: its pendulum's length (half-widths) and widest angle (deg). */
const ROD = 1.05, SWING = 32;
/** Reaching out, letting go (s). */
const REACH_S = 0.9, LET_GO = LET_GO_SECONDS;

/** Where the hands meet: below and in front of the middle of the two heads. */
function claspAt(s, a, b, unit) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return mid.addScaledVector(UP, -BELOW * unit).addScaledVector(toViewerFrom(s, mid), FRONT * unit);
}

/** Can the two reach the clasp? Sets the drifts (V[0], V[1]); a pair the stage put together from farther off comes closer. */
function fit(s) {
  const pa = s.place(0), pb = s.place(1);
  const u = 0.5 * (s.unit(0) + s.unit(1));
  const c = claspAt(s, pa, pb, u);
  const need = Math.max(c.distanceTo(pa) - REACH * s.unit(0), c.distanceTo(pb) - REACH * s.unit(1));
  const across = pb.clone().sub(pa);
  across.y = 0;
  const gap = across.length();
  if (gap < 1e-5) return false;
  across.divideScalar(gap);
  const closer = Math.max(Math.max(0, need) + 0.15 * u, gap - SNUG * u); // a little closer anyway: holding hands
  const moveA = Math.min(1, s.profile(0).move), moveB = Math.min(1, s.profile(1).move);
  const share = moveA + moveB > 1e-4 ? moveA / (moveA + moveB) : 0.5;
  for (const loose of [false, true]) {
    const capA = loose ? DUO_TRAVEL * Math.max(share, 0.5) : 0.8 * s.radius(0) * moveA;
    const capB = loose ? DUO_TRAVEL * Math.max(1 - share, 0.35) : 0.8 * s.radius(1) * moveB;
    let da = Math.min(closer * share, capA);
    let db = Math.max(0, Math.min(closer - da, capB));
    if (loose) da = Math.min(closer - db, capA);
    // the heads keep apart: never closer than their radii (and a little)
    const room = gap - 1.05 * (s.radius(0) + s.radius(1));
    if (da + db > room) {
      const k = Math.max(0, room) / Math.max(1e-6, da + db);
      da *= k;
      db *= k;
    }
    s.V[0].copy(across).multiplyScalar(da);
    s.V[1].copy(across).multiplyScalar(-db);
    const ha = pa.clone().add(s.V[0]), hb = pb.clone().add(s.V[1]);
    const after = claspAt(s, ha, hb, u);
    if (after.distanceTo(ha) > REACH * s.unit(0) * 1.06 || after.distanceTo(hb) > REACH * s.unit(1) * 1.06) continue;
    s.allowTravel(0, da);
    s.allowTravel(1, db);
    return true;
  }
  return false;
}

export default {
  id: 'hold-hands-swing',
  cast: 'duo',
  maxSeconds: 18,
  blendIn: 0.5,
  blendOut: 0.45,
  /** The inner hands (one left, one right) hold each other. */
  handOf: () => 'inner',
  pair: 'opposite',
  tryCast: (s) => s.count === 2 && s.fitHands() && fit(s),

  begin(s) {
    // 2..4 bars of swinging, fewer when the song is slow (a play never drags on)
    let bars = 2 + s.pick(3);
    const barSec = 4 * Math.max(0.3, s.beatSec);
    while (bars > 2 && bars * barSec > 10) bars--;
    s.I[0] = bars;
    s.look(0, 1, 2.2);
    s.act(0, s.profile(0).exchange, 'smile', 1);
    s.react(1, 0.35, s.profile(1).ret, 'answer', 0, 2);
  },

  step(s) {
    const sa = s.side[0], sb = s.side[1];
    const ha = s.head(0), hb = s.head(1);
    const unit = 0.5 * (s.unit(0) + s.unit(1));
    const across = hb.clone().sub(ha);
    across.y = 0;
    if (across.lengthSq() > 1e-10) across.normalize();
    else across.copy(s.viewerRight);
    const mid = ha.clone().add(hb).multiplyScalar(0.5);
    const toViewer = toViewerFrom(s, mid);
    const pivot = mid.clone().addScaledVector(UP, -(BELOW - ROD) * unit).addScaledVector(toViewer, FRONT * unit);
    let theta = 0, weight = 1;
    switch (s.phase) {
      case 0: // reach out (the heads drift a little closer)
        s.go(0, s.V[0], 4);
        s.go(1, s.V[1], 4);
        weight = smooth(s.phaseT / REACH_S);
        if (s.phaseT >= REACH_S) {
          s.note('lace', 0, 1);
          s.mark = s.nextBeat(s.beat, 0.25);
          s.next(1);
        }
        break;
      case 1: { // swing from the next beat, a swing each beat for the bars chosen, easing in and out over a beat
        const beats = s.I[0] * 4;
        const u = s.beat - s.mark;
        if (u < 0) break;
        if (s.round === 0) {
          s.note('swing', 0, 1);
          s.round = 1;
        }
        const env = smooth(u) * smooth(beats - u);
        theta = SWING * D2R * env * Math.sin(Math.PI * u);
        // the heads sway with the swing: a lean and a small slide the way it goes
        const sway = env * Math.sin(Math.PI * u);
        for (let k = 0; k < 2; k++) {
          const move = Math.min(1, s.profile(k).move);
          s.go(k, s.V[k].clone().addScaledVector(across, 0.22 * s.radius(k) * move * sway), 12);
          s.leanBy(k, across.clone().multiplyScalar(0.09 * move * sway), 12);
        }
        if (u >= beats) {
          s.note('let go', 0, 1);
          for (let k = 0; k < 2; k++) s.home(k, 5, 0.9);
          s.react(0, 0.15, s.profile(0).giggle, 'giggle', 1, 1.6);
          s.react(1, 0.35, s.profile(1).giggle, 'giggle', 0, 1.6);
          s.next(2);
        }
        break;
      }
      default: // let go
        weight = letGo(s.phaseT, LET_GO);
        if (s.phaseT >= LET_GO) s.done();
        break;
    }
    // the laced hands hang from the pivot on a rod that swings across: fingers down along it, A's palm toward B
    const c = Math.cos(theta), sn = Math.sin(theta);
    const down = across.clone().multiplyScalar(sn).addScaledVector(UP, -c);
    const centre = pivot.clone().addScaledVector(down, ROD * unit);
    const normal = across.clone().multiplyScalar(c).addScaledVector(UP, sn);
    s.lace(0, sa, 1, sb, laceClasp(centre, normal, down), weight);
  },
};
