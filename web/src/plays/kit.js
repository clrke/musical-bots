// Shared geometry for the plays: ports of Unity HandPlays/Plays/{DuoKit,SoloKit,Row}.cs. Duo: where a pair's hands
// meet (a Meet: between or on the two heads), how far each head drifts toward the other so every hand reaches its
// marks, the pair's frame, hands by fingers and thumb, same-handed grips coming in under the chin. Solo: side-
// normalised poses on the bot's own head, paths round the face, shapes, the eyes' look. Row: a row of neighbours
// and its order from the viewer's left.
import * as THREE from 'three';
import { RIGHT, LEFT, SHAPES, clamp01, copyShape, handShape, lerpShape, mir, orientation, slerpVec, smooth, smoother } from '../scene/hand-rig.js';
import { claspSolve, laceSize, laceSolve } from '../scene/hand-touch.js';
import { aimFromPose, aimInBot, aimInWorld, aimOnHead } from './stage.js';

const UP = new THREE.Vector3(0, 1, 0);
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ DuoKit

/**
 * A place the hands go to: on the line from A's head (along 0) to B's (1), then `shift` half-widths further toward B,
 * `up` above and `front` toward the viewer. A's hand must reach it from within reachA half-widths of its head (0: it
 * does not go there), B's within reachB.
 */
export const meet = (along, shift, up, front, reachA, reachB) => ({ along, shift, up, front, reachA, reachB });

/** Level, from `p` toward the viewer. */
export function toViewerFrom(s, p) {
  const d = s.viewer.clone().sub(p);
  d.y = 0;
  return d.lengthSq() > 1e-8 ? d.normalize() : v3(0, 0, 1);
}

/**
 * A mark's world point for heads at ha, hb. A mark under the chins (up <= -1) is that far under the lower head; one over
 * the heads (up >= 1.25) over the higher: a same-handed pair's hand reaching across stays out of its face.
 */
export function meetPoint(ha, hb, across, toViewer, u, m) {
  const p = ha.clone().lerp(hb, m.along);
  if (m.up <= -1) p.y = Math.min(ha.y, hb.y);
  else if (m.up >= 1.25) p.y = Math.max(ha.y, hb.y);
  return p.addScaledVector(across, m.shift * u).addScaledVector(UP, m.up * u).addScaledVector(toViewer, m.front * u);
}

/** The pair's frame now: across (A toward B, level), toward the viewer (level), the mean half-width. */
export function duoFrame(s) {
  const ha = s.head(0), hb = s.head(1);
  const across = hb.clone().sub(ha);
  across.y = 0;
  if (across.lengthSq() > 1e-10) across.normalize();
  else across.copy(s.viewerRight);
  return { across, toViewer: toViewerFrom(s, ha.clone().add(hb).multiplyScalar(0.5)), u: 0.5 * (s.unit(0) + s.unit(1)) };
}

/** A mark now (the heads where they are). */
export function duoNow(s, m, f = duoFrame(s)) {
  return meetPoint(s.head(0), s.head(1), f.across, f.toViewer, f.u, m);
}

/** The most a duo's heads may glide toward each other in all (world metres): a partner farther off gets a wave instead. */
export const DUO_TRAVEL = 2.6;
/**
 * A pair leans in until their centres are about this many mean half-widths apart (the shells nearly touching): the
 * stage's rows stand wider than Unity's choir, and hands reaching across a wide gap look detached from their heads.
 */
export const SNUG = 2.9;

/**
 * Can A and B reach every mark? Sets the drifts (V[0], V[1]: offsets off their places, world) and value (the gap after the
 * drifts, in mean half-widths). First with Unity's caps (0.85 radius x move each); a pair the stage put together from
 * farther off comes together as far as it must (the starter doing its share), as close as `apart` summed radii.
 */
export function duoFit(s, marks, extra = 0.15, apart = 1.05) {
  const pa = s.place(0), pb = s.place(1);
  const u = 0.5 * (s.unit(0) + s.unit(1));
  const across = pb.clone().sub(pa);
  across.y = 0;
  const gap = across.length();
  if (gap < 1e-5) return false;
  across.divideScalar(gap);
  const toViewer = toViewerFrom(s, pa.clone().add(pb).multiplyScalar(0.5));
  const moveA = Math.min(1, Math.max(0.3, s.profile(0).move)), moveB = Math.min(1, Math.max(0.3, s.profile(1).move));
  const share = moveA / (moveA + moveB);
  const room = Math.max(0, gap - apart * (s.radius(0) + s.radius(1)));
  for (const loose of [false, true]) {
    let capA = 0.85 * s.radius(0) * moveA, capB = 0.85 * s.radius(1) * moveB;
    if (loose) {
      capA = Math.max(capA, Math.min(room, DUO_TRAVEL) * Math.max(share, 0.5));
      capB = Math.max(capB, Math.min(room, DUO_TRAVEL) * Math.max(1 - share, 0.35));
    }
    const most = Math.min(room, capA + capB, DUO_TRAVEL);
    const least = Math.min(Math.max(extra * u, gap - SNUG * u), most);
    for (let i = 0; i <= 12; i++) {
      const closer = lerp(least, most, i / 12);
      let da = Math.min(closer * share, capA);
      const db = Math.min(closer - da, capB);
      da = Math.min(closer - db, capA);
      const va = across.clone().multiplyScalar(da), vb = across.clone().multiplyScalar(-db);
      const ha = pa.clone().add(va), hb = pb.clone().add(vb);
      let ok = true;
      for (const m of marks) {
        const at = meetPoint(ha, hb, across, toViewer, u, m);
        if (m.reachA > 0 && at.distanceTo(ha) > m.reachA * s.unit(0)) ok = false;
        if (m.reachB > 0 && at.distanceTo(hb) > m.reachB * s.unit(1)) ok = false;
        if (!ok) break;
      }
      if (!ok) continue;
      s.V[0].copy(va);
      s.V[1].copy(vb);
      s.allowTravel(0, da);
      s.allowTravel(1, db);
      s.value = hb.distanceTo(ha) / u;
      return true;
    }
  }
  return false;
}

/** Duo casting (Unity DuoKit.Cast with the stage's given pair): the hand rule, then the drifts. */
export const duoCast = (s, marks, extra = 0.15, apart = 1.05) => s.count === 2 && s.fitHands() && duoFit(s, marks, extra, apart);

/** The palm's direction for a hand on `side` whose fingers point along `fingers` and thumb along `thumb`. */
export function palmOf(side, fingers, thumb) {
  const p = new THREE.Vector3().crossVectors(fingers, thumb).multiplyScalar(side < 0 ? -1 : 1);
  return p.lengthSq() > 1e-10 ? p.normalize() : v3(0, 0, 1);
}

/** A world aim by fingers and thumb directions. */
export const aimByThumb = (side, at, fingers, thumb, shape, effector, weight = 1) => aimInWorld(at, fingers, palmOf(side, fingers, thumb), shape, effector, weight);

/** A laced pair with shapes of the play's own (DuoKit.Lace). */
export function duoLace(s, a, sideA, b, sideB, clasp, shapeA, shapeB, weight) {
  const size = laceSize(s.handScale(a), s.handScale(b));
  const [pa, pb] = laceSolve(sideA, sideB, size, clasp);
  pa.shape = shapeA;
  pb.shape = shapeB;
  s.hand(a, sideA, aimFromPose(pa, weight, { scale: size, exact: 1, laced: true }));
  s.hand(b, sideB, aimFromPose(pb, weight, { scale: size, exact: 1, laced: true }));
}

/** A grip coming in: how far each hand starts back toward its own side and apart across the palms (rig metres). */
const SLIDE_BACK = 0.03, SLIDE_APART = 0.012, HOOK_PAST = 0.15;

/**
 * A same-handed grip (scene/hand-touch.js GRIP_SHAKE / GRIP_HOOK): A's fingers along `fingers` (toward B), the thumbs
 * along `thumbs`, gripping at `centre`, drawn exactly at one size. `reach` (0..1) brings the hands in from beside their bots
 * (the one that reaches across goes under its chin); at 1 they grip (Unity DuoKit.Clasp).
 */
export function duoClasp(s, side, grip, centre, fingers, thumbs, shapeA, shapeB, weight, reach = 1) {
  const size = laceSize(s.handScale(0), s.handScale(1));
  const g = { ...grip };
  let shA = shapeA, shB = shapeB;
  if (reach < 1) {
    let slide, meetW, close;
    if (grip.hookIn) {
      slide = 1 - smooth((reach - 0.55) / 0.15) - HOOK_PAST * smooth((reach - 0.6) / 0.15) * (1 - smooth((reach - 0.88) / 0.12));
      meetW = 1 - smooth((reach - 0.7) / 0.18);
      close = 1 - smooth((reach - 0.55) / 0.15);
    } else {
      slide = 1 - smooth((reach - 0.6) / 0.2);
      meetW = 1 - smooth((reach - 0.82) / 0.18);
      close = 1 - smooth((reach - 0.74) / 0.16);
    }
    g.along -= SLIDE_BACK * slide;
    g.depth -= SLIDE_APART * meetW;
    g.yaw *= 1 - meetW;
    shA = lerpShape(shapeA, SHAPES.open, close);
    shB = lerpShape(shapeB, SHAPES.open, close);
  }
  const poses = claspSolve(side, size, g, centre, fingers, thumbs, shA, shB);
  for (let k = 0; k < 2; k++) {
    const p = poses[k];
    if (reach < 1) p.position = approach(s, k, side, p.position, smooth(reach / 0.8));
    s.hand(k, side, aimFromPose(p, weight, { scale: size, exact: 1, laced: reach >= 1 }));
  }
}

/** Member k's side toward the other's head (+1 its +x side). */
export const toward = (s, k, other) => s.sideToward(k, s.head(other));

/** Member k's hand on `side` is its outer one (away from `other`): in a same-handed pair it reaches across. */
export const crosses = (s, k, side, other) => side !== toward(s, k, other);

/** A hand is past the middle of its face once this far across (half-widths). */
const MIDDLE = 0.25;
/** A crossing hand's height (half-widths from the head's centre) as it passes the middle of its face: under the chin, over the head. */
export const UNDER_CHIN = -1.05, OVER_HEAD = 1.1;

/**
 * A hand coming in to `target` (world) from beside its bot (member k, its hand on `side`): at p 0 low beside its head
 * (`over`: beside it, up), at 1 on the target. A hand that crosses to the far side of its face dips under its chin on
 * the way (`over`: rises over its head), never passing in front of its face.
 */
export function approach(s, k, side, target, p, over = false) {
  const from = v3(side * 1.15, over ? 0.45 : -0.95, 0.45);
  const to = s.worldToBot(k, target);
  const e = clamp01(p);
  const at = from.clone().lerp(to, e);
  const xs = to.x * side; // the target across its face: negative past the middle
  if (xs < MIDDLE) {
    // from where it passes the middle on, it stays under the chin (over the head)
    const e1 = (from.x * side - MIDDLE) / (from.x * side - xs);
    const y1 = lerp(from.y, to.y, clamp01(e1));
    const shift = over ? Math.max(0, OVER_HEAD - y1) : Math.min(0, UNDER_CHIN - y1);
    const w = e < e1 ? smooth(e / Math.max(1e-3, e1)) : (1 - e) / Math.max(1e-3, 1 - e1);
    at.y += shift * w;
    at.z = Math.max(at.z, lerp(at.z, 0.65, Math.sin(Math.PI * e))); // and in front, clear of the head
  }
  return s.botToWorld(k, at);
}

/** A tight fist, the thumb across it. */
export const FIST = handShape(0.75, 1.05, 1.08, 1.1, 1.1, 0, 0.15);
/** Open, fingers fanned wide (a high five, paper, an explosion). */
export const SPREAD = handShape(0, 0, 0, 0.02, 0.04, 1.25, 0.95);
/** The index pointing, the others curled (a boop). */
export const POINT1 = handShape(0.7, 0, 1.05, 1.08, 1.1, 0.1, 0.2);

/** A smooth bump 0 -> 1 -> 0 over [a, b] (sine). */
export const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));

// ------------------------------------------------------------------ SoloKit

/** Where the hands rest while the bot sings (HandGestures' singing pose; bot frame, x outward). */
export const REST = v3(1.2, -0.5, 0.34);
export const REST_FINGERS = v3(-0.12, 0.5, 0.86), REST_PALM = v3(-0.85, 0.15, 0.5);
/** The index finger out, the others folded, the thumb over them. */
export const S_POINT = handShape(0.8, 0, 1.05, 1.05, 1.05, 0.05, 0.05);
/** A soft fist (knuckles to rub an eye with). */
export const S_FIST = handShape(0.75, 0.95, 1, 1.02, 1.05, 0, 0.15);
/** Fingers hooked like a little claw (to scratch). */
export const S_CLAW = handShape(0.35, 0.35, 0.38, 0.42, 0.45, 0.45, 0.45, 0.85);
/** Wide open, fingers splayed (jazz hands, a reveal). */
export const S_SPLAYED = handShape(0, 0, 0, 0.02, 0.04, 1.25, 1);

export { mir };
const _m1 = new THREE.Vector3(), _m2 = new THREE.Vector3(), _m3 = new THREE.Vector3();

/** A hand on member k's own head (its centre, following its tilt and turn), side-normalised (x outward). */
export function onFace(s, k, side, pos, fingers, palm, shape, effector = 'wrist', weight = 1) {
  return aimOnHead(s.bot(k).head, 'centre', 0, mir(side, pos, _m1), mir(side, fingers, _m2), mir(side, palm, _m3), shape, effector, weight);
}

/** A pose on the face whose rotation blends from (fingersA, palmA) to (fingersB, palmB) by u. */
export function onFaceBlend(s, k, side, pos, fA, pA, fB, pB, u, shape, effector = 'wrist') {
  const aim = onFace(s, k, side, pos, fB, pB, shape, effector);
  aim.rotation = orientation(side, fA, pA).slerp(aim.rotation, clamp01(u));
  return aim;
}

/** A pose in the bot's frame whose rotation blends from (fingersA, palmA) to (fingersB, palmB) by u. */
export function inBotBlend(side, pos, fA, pA, fB, pB, u, shape, effector = 'wrist') {
  const aim = aimInBot(side, pos, fB, pB, shape, 1, effector);
  aim.rotation = orientation(side, fA, pA).slerp(aim.rotation, clamp01(u));
  return aim;
}

/** Point `name` (its own side `pointSide`) of member k's head, side-normalised for `side` (x outward on that side). */
export const pointOf = (s, k, name, pointSide, side) => mir(side, s.pointLocal(k, name, pointSide));

/** A quadratic curve from a to b bent toward c (a path round the face). */
export function arc(a, c, b, u) {
  u = clamp01(u);
  const w = 1 - u;
  return v3(w * w * a.x + 2 * u * w * c.x + u * u * b.x, w * w * a.y + 2 * u * w * c.y + u * u * b.y, w * w * a.z + 2 * u * w * c.z + u * u * b.z);
}

/** 0 -> 1 over [a, b] then 1 -> 0 over [c, d] (smoother steps): a pose held between b and c. */
export const hold = (t, a, b, c, d) => smoother((t - a) / Math.max(1e-5, b - a)) * (1 - smoother((t - c) / Math.max(1e-5, d - c)));

/** A beat's pulse: 1 on the beat, decaying over it (`sharp` higher: shorter). */
export function pulse(beat, sharp = 6) {
  const f = beat - Math.floor(beat);
  return Math.exp(-sharp * f) * clamp01(f * 30);
}

// ------------------------------------------------------------------ Row

/** Each member's place in the row from the viewer's left (I[k]). */
export function rowOrder(s) {
  const right = s.viewerRight;
  const x = [];
  for (let k = 0; k < s.count; k++) x.push(s.place(k).dot(right));
  for (let k = 0; k < s.count; k++) {
    let rank = 0;
    for (let o = 0; o < s.count; o++) if (x[o] < x[k] || (x[o] === x[k] && o < k)) rank++;
    s.I[k] = rank;
  }
}

/** The member at place `rank` in the row (0 the leftmost), or -1. */
export function rowAt(s, rank) {
  for (let k = 0; k < s.count; k++) if (s.I[k] === rank) return k;
  return -1;
}

/** The way along the row (level, from its leftmost to its rightmost) and toward the viewer from its middle. */
export function rowFrame(s) {
  const mid = v3();
  let unit = 0;
  const n = s.count;
  for (let k = 0; k < n; k++) {
    mid.add(s.head(k));
    unit += s.unit(k);
  }
  mid.divideScalar(Math.max(1, n));
  unit /= Math.max(1, n);
  const along = s.head(rowAt(s, n - 1)).sub(s.head(rowAt(s, 0)));
  along.y = 0;
  if (along.lengthSq() > 1e-10) along.normalize();
  else along.copy(s.viewerRight);
  return { mid, along, toViewer: toViewerFrom(s, mid), unit };
}

export { smooth, smoother, clamp01, lerpShape, copyShape, SHAPES, RIGHT, LEFT, slerpVec as slerpDir };
