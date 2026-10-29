// Group: a conga line swaying (Unity Plays/CongaSway.cs). Three to five neighbours in a row line up behind a leader (the
// end of the row nearer the starter): each puts a hand on the side of the next one's head toward the leader, as on a
// shoulder, the hand following that head wherever it goes. The whole line sways together side to side on the beat (a
// swing every two beats, the heads leaning into it) with a little hop at the end of every bar, while the leader waves
// the line on with its free hand; after three bars the hands come off and they giggle.
import * as THREE from 'three';
import { SHAPES, lerpShape, rowAt, rowFrame, rowOrder, smooth, v3 } from './kit.js';
import { aimInBot, aimOnHead } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
/** The palm rests this far from the hand's head at most (half-widths). */
const REACH = 2.55;
/** The hand rests on the other head this far out from its ear, down and forward (that head's half-widths). */
const REST = v3(0.2, -0.45, 0.1);
const BARS = 3;
const REACH_S = 0.8, LET_GO = 0.5;
const ON_SHAPE = lerpShape(SHAPES.relaxed, SHAPES.flat, 0.5);

/** The member that member k puts its hand on (its neighbour toward the leader), -1 for the leader. */
function towardLeader(s, k) {
  const r = s.I[k] + (s.value > 0 ? 1 : -1);
  return r < 0 || r >= s.count ? -1 : rowAt(s, r);
}

const leader = (s) => rowAt(s, s.value > 0 ? s.count - 1 : 0);

/** About where a hand rests on member `on`'s head (at `at`) coming from a head at `from` (world). */
function shoulder(s, on, at, from) {
  const toward = from.clone().sub(at);
  toward.y = 0;
  if (toward.lengthSq() > 1e-10) toward.normalize();
  else toward.copy(s.viewerRight).negate();
  const u = s.unit(on);
  return at.clone().addScaledVector(toward, (0.95 + REST.x) * u).addScaledVector(UP, REST.y * u).addScaledVector(s.frontOf(on), REST.z * u);
}

/** The line draws in toward its middle until every hand reaches the next head (Unity's caps first, then the stage's). */
function fit(s) {
  const n = s.count;
  const c = v3();
  for (let k = 0; k < n; k++) c.add(s.place(k));
  c.divideScalar(n);
  for (const loose of [false, true]) {
    // the stage's rows stand wider than Unity's choir: a loose cast draws the line in further
    const capMul = loose ? 3.2 : 0.8, fMax = loose ? 0.6 : 0.3, least = loose ? 0.6 : 0.5;
    for (let f = 0; f <= fMax + 1e-6; f += 0.02) {
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        const d = c.clone().sub(s.place(k));
        d.y = 0;
        s.V[k].copy(d).multiplyScalar(f);
        ok = s.V[k].length() <= capMul * s.radius(k) * Math.max(least, Math.min(1, s.profile(k).move));
      }
      if (!ok) break;
      for (let k = 0; k < n && ok; k++) {
        const to = towardLeader(s, k);
        if (to < 0) continue;
        const pa = s.place(k).add(s.V[k]), pb = s.place(to).add(s.V[to]);
        if (pb.distanceTo(pa) < 1.05 * (s.radius(k) + s.radius(to))) ok = false;
        else ok = shoulder(s, to, pb, pa).distanceTo(pa) <= REACH * s.unit(k);
      }
      if (!ok) continue;
      for (let k = 0; k < n; k++) {
        const to = towardLeader(s, k);
        s.side[k] = to >= 0 ? s.sideToward(k, s.place(to)) : 1;
        s.allowTravel(k, s.V[k].length() + 0.3 * s.radius(k));
      }
      return true;
    }
  }
  return false;
}

/** Member k's hand on `side` rests on member `on`'s head by its ear nearest k (head space: it follows that head). */
function onShoulder(s, k, side, on, weight) {
  const sideOn = s.sideToward(on, s.head(k)); // the side of `on` facing k
  s.hand(k, side, aimOnHead(s.bot(on).head, 'ear', sideOn, v3(REST.x * sideOn, REST.y, REST.z),
    v3(-0.3 * sideOn, 1, -0.25), v3(-sideOn, 0, 0), ON_SHAPE, 'palm', weight));
}

/** A free hand hangs loose at the side, swinging a little with the sway. */
function loose(s, k, side, sway, weight) {
  s.hand(k, side, aimInBot(side, v3(1.18, -0.7, 0.25 + 0.08 * sway * side), v3(0.15, -0.5, 0.85), v3(-0.9, -0.3, 0.1), SHAPES.relaxed, weight));
}

export default {
  id: 'conga-sway',
  cast: 'group',
  maxSeconds: 16,
  blendIn: 0.55,
  blendOut: 0.45,
  handOf: () => 'inner',

  tryCast(s) {
    rowOrder(s);
    // the leader: the end of the row nearer the starter (value: +1 the leader is the row's last)
    s.value = s.I[0] * 2 >= s.count - 1 ? 1 : -1;
    return fit(s);
  },

  begin(s) {
    const lead = leader(s);
    s.note('line up', lead);
    s.act(lead, s.profile(lead).mischief, 'lead');
    for (let k = 0; k < s.count; k++) if (k !== lead) s.look(k, lead, 1.5);
  },

  step(s) {
    const n = s.count;
    const lead = leader(s);
    let weight = 1, sway = 0, wave = 0;
    const { along } = rowFrame(s);
    switch (s.phase) {
      case 0: // line up: drawing in a little, the hands go onto the shoulders
        for (let k = 0; k < n; k++) s.go(k, s.V[k], 4);
        weight = smooth(s.phaseT / REACH_S);
        if (s.phaseT >= REACH_S) {
          for (let k = 0; k < n; k++) if (k !== lead) s.note('hand on', k, towardLeader(s, k));
          s.mark = s.nextBeat(s.beat, 0.25);
          s.next(1);
        }
        break;
      case 1: { // sway on the beat, a hop at the end of every bar
        const u = s.beat - s.mark;
        if (u < 0) break;
        const beats = BARS * 4;
        if (s.round === 0) {
          s.note('sway', lead);
          s.round = 1;
        }
        const env = smooth(u / 1.2) * smooth((beats - u) / 1.2);
        sway = env * Math.sin(Math.PI * u * 0.5);
        wave = smooth(u / 0.8) * smooth(beats - u);
        // the hop: on the fourth beat of each bar (the line bobs up and lands)
        const inBar = u - 4 * Math.floor(u / 4);
        const hop = inBar >= 3 && u < beats - 0.5 ? Math.sin(Math.PI * (inBar - 3)) : 0;
        const bar = Math.floor(u / 4);
        if (inBar >= 3 && s.round === bar + 1 && u < beats - 0.5) {
          s.round = bar + 2;
          s.note('hop', lead);
        }
        for (let k = 0; k < n; k++) {
          const move = Math.min(1, s.profile(k).move);
          // everyone the same way and as far (the hands on the shoulders keep their reach)
          s.go(k, s.V[k].clone().addScaledVector(along, 0.28 * s.radius(k) * sway).addScaledVector(UP, 0.2 * s.radius(k) * hop), 14);
          s.leanBy(k, along.clone().multiplyScalar(0.12 * move * sway), 10);
          const face = s.face(k);
          face.add('mouthSmile', 0.35 * env);
          face.tilt(-0.06 * sway, 0);
        }
        if (u >= beats) {
          s.note('hands off', lead);
          for (let k = 0; k < n; k++) {
            s.home(k, 5, 0.9);
            const other = rowAt(s, s.I[k] + 1 < n ? s.I[k] + 1 : s.I[k] - 1);
            s.react(k, 0.12 + 0.13 * k, s.profile(k).giggle, 'giggle', other, 1.3);
          }
          s.next(2);
        }
        break;
      }
      default:
        weight = 1 - smooth(s.phaseT / LET_GO);
        if (s.phaseT >= LET_GO) s.done();
        break;
    }
    for (let k = 0; k < n; k++) {
      if (k === lead) {
        // the leader waves the line on with its outer hand; the other hangs loose, swaying
        const behind = rowAt(s, s.I[k] + (s.value > 0 ? -1 : 1));
        const outer = behind >= 0 ? -s.sideToward(k, s.head(behind)) : 1;
        const rock = Math.sin(s.t * 2 * Math.PI * 2.2) * 22 * wave;
        const aim = aimInBot(outer, v3(1.3, 0.15 + 0.1 * wave, 0.45), v3(0.2, 1, 0.05), v3(0.1, 0, 1), SHAPES.open, weight);
        aim.rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(Z, (rock * Math.PI) / 180));
        s.hand(k, outer, aim);
        loose(s, k, -outer, sway, weight);
        continue;
      }
      const to = towardLeader(s, k);
      const side = s.side[k];
      onShoulder(s, k, side, to, weight);
      loose(s, k, -side, sway, weight);
    }
  },
};
