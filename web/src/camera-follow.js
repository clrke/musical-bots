// The camera's follow (main.js): the shot logic picks a goal (where to stand, what to look at) every frame; the camera
// as rendered follows it smoothly. The goal can move in steps (a group shot swinging to another of the set's angles,
// a bot stepping in front of the line of sight, the framing re-fitting a head that bobs); the camera never does.
//
// The look point follows on a critically damped spring (smooth-damp) with a speed and an acceleration limit; the
// camera's place follows as an orbit around it (yaw, pitch, distance, each on its own limited spring), so a swing to
// another angle goes round the bots, not through them. Fixed substeps: the same path at 30, 60 or 144 fps.
// A cut (cut()) jumps straight to the goal: a cut is an edit, not a move.
//
// Also here, pure and tested headless: the hysteresis of the group shot's swing to a better angle (SwingGate), and
// the camera path's jitter measure (pathJitter) the tests and the render QA share.

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU); // to [-pi, pi]

/**
 * One scalar critically damped spring toward a goal, with a speed limit `vmax` and an acceleration limit `amax`
 * (it also brakes in time: never faster than sqrt(2 amax |error|) toward the goal, so a long move eases out without
 * overshoot). smooth: the spring's time (s, ~ the time to cover most of a step).
 */
export class Spring {
  constructor({ smooth = 0.5, vmax = Infinity, amax = Infinity } = {}) {
    this.w = 2 / smooth;
    this.vmax = vmax;
    this.amax = amax;
    this.x = 0;
    this.v = 0;
  }
  snap(x) { this.x = x; this.v = 0; }
  /** Advances dt (s) toward `goal` (err: the error to use instead of goal - x, e.g. a wrapped angle). */
  step(dt, goal, err = goal - this.x) {
    const { w, amax } = this;
    let a = w * w * err - 2 * w * this.v;
    if (a > amax) a = amax; else if (a < -amax) a = -amax;
    let v = this.v + a * dt;
    // brake in time: the speed toward the goal stays what the acceleration limit can still stop
    const brake = Number.isFinite(amax) ? Math.sqrt(2 * amax * Math.abs(err)) : Infinity;
    const lim = Math.min(this.vmax, Math.max(brake, Math.abs(err) * w));
    if (v * err > 0 && Math.abs(v) > lim) v = Math.sign(v) * lim;
    if (Math.abs(v) > this.vmax) v = Math.sign(v) * this.vmax;
    this.v = v;
    this.x += v * dt;
    return this.x;
  }
}

/** The follow's tuning: the look point (m), the orbit's yaw and pitch (rad), its distance (m). */
export const FOLLOW = {
  look: { smooth: 0.55, vmax: 2.6, amax: 5 },
  yaw: { smooth: 0.6, vmax: (65 * Math.PI) / 180, amax: (110 * Math.PI) / 180 },
  pitch: { smooth: 0.6, vmax: (35 * Math.PI) / 180, amax: (80 * Math.PI) / 180 },
  dist: { smooth: 0.6, vmax: 2.5, amax: 4.5 },
  substep: 1 / 120,
};

/**
 * The camera as rendered, following a goal (pos, look: anything with x, y, z). update() writes the rendered pos and
 * look; cut() jumps to the goal.
 */
export class CameraFollow {
  constructor(tuning = FOLLOW) {
    this.t = tuning;
    this.look = [0, 1, 2].map(() => new Spring(tuning.look));
    this.yaw = new Spring(tuning.yaw);
    this.pitch = new Spring(tuning.pitch);
    this.dist = new Spring(tuning.dist);
    this.ready = false;
  }
  static orbit(pos, look) {
    const dx = pos.x - look.x, dy = pos.y - look.y, dz = pos.z - look.z;
    const d = Math.max(1e-4, Math.hypot(dx, dy, dz));
    return { yaw: Math.atan2(dx, dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / d))), dist: d };
  }
  cut(pos, look) {
    const o = CameraFollow.orbit(pos, look);
    this.look[0].snap(look.x); this.look[1].snap(look.y); this.look[2].snap(look.z);
    this.yaw.snap(o.yaw); this.pitch.snap(o.pitch); this.dist.snap(o.dist);
    this.ready = true;
  }
  update(dt, goalPos, goalLook, outPos, outLook) {
    if (!this.ready) this.cut(goalPos, goalLook);
    const o = CameraFollow.orbit(goalPos, goalLook);
    const n = Math.max(1, Math.ceil(dt / this.t.substep - 1e-9)), h = dt / n;
    for (let k = 0; k < n; k++) {
      this.look[0].step(h, goalLook.x);
      this.look[1].step(h, goalLook.y);
      this.look[2].step(h, goalLook.z);
      this.yaw.step(h, 0, wrap(o.yaw - this.yaw.x));
      this.pitch.step(h, o.pitch);
      this.dist.step(h, o.dist);
    }
    this.yaw.x = wrap(this.yaw.x);
    this.write(outPos, outLook);
  }
  write(outPos, outLook) {
    const lx = this.look[0].x, ly = this.look[1].x, lz = this.look[2].x;
    const c = Math.cos(this.pitch.x), d = this.dist.x;
    outLook.x = lx; outLook.y = ly; outLook.z = lz;
    outPos.x = lx + Math.sin(this.yaw.x) * c * d;
    outPos.y = ly + Math.sin(this.pitch.x) * d;
    outPos.z = lz + Math.cos(this.yaw.x) * c * d;
  }
}

/**
 * A small vector smoothing (the hold correction: the rendered camera stepped back or tilted so the heads and cards
 * stay in frame): three limited springs. snap() on a cut.
 */
export class SmoothVec {
  constructor(opts = { smooth: 0.3, vmax: 3, amax: 8 }) { this.s = [0, 1, 2].map(() => new Spring(opts)); }
  snap(v) { this.s[0].snap(v.x); this.s[1].snap(v.y); this.s[2].snap(v.z); }
  update(dt, goal, out) {
    const n = Math.max(1, Math.ceil(dt / FOLLOW.substep - 1e-9)), h = dt / n;
    for (let k = 0; k < n; k++) { this.s[0].step(h, goal.x); this.s[1].step(h, goal.y); this.s[2].step(h, goal.z); }
    out.x = this.s[0].x; out.y = this.s[1].x; out.z = this.s[2].x;
    return out;
  }
}

/**
 * When a group shot may swing to another of the set's angles because a singer's face is hidden: only once the shot
 * has held `hold` seconds (since its cut or its last swing), only when the face has stayed hidden over `confirm`
 * checks in a row (a head bobbing past is not a reason), only to an angle clearly better (`gain` less hidden), and
 * at most `max` swings a shot. offer() returns true when the swing is to happen (and counts it).
 */
export class SwingGate {
  constructor({ hold = 4, confirm = 2, gain = 0.25, hiddenAt = 0.2, max = 2 } = {}) {
    Object.assign(this, { hold, confirm, gain, hiddenAt, max });
    this.reset(0);
  }
  reset(t) { this.since = t; this.seen = 0; this.swings = 0; }
  /** t: the shot's age (s); hidden: the share of a singer's face hidden now; better: the best angle's (null: none). */
  offer(t, hidden, better) {
    if (!(hidden > this.hiddenAt)) { this.seen = 0; return false; }
    this.seen++;
    if (this.swings >= this.max || t - this.since < this.hold || this.seen < this.confirm) return false;
    if (better === null || better === undefined || !(better < hidden - this.gain)) return false;
    this.since = t;
    this.seen = 0;
    this.swings++;
    return true;
  }
}

/**
 * How smooth a camera path is: rows [px, py, pz, lx, ly, lz, ..., cut (index 12)] one per frame (main.js window.__mbCam,
 * capture's campath.json), or { pos: [x,y,z], look: [x,y,z], cut } objects. Frames next to a cut are left out (a cut is
 * an edit). Returns { angAccMax, angAccP99 (deg/s^2: the view direction's angular acceleration), angVelMax (deg/s),
 * posAccMax (m/s^2), flipsPerSec (sign changes of the yaw or pitch rate above 2 deg/s, per second), frames }.
 */
export function pathJitter(rows, fps = 30) {
  const n = rows.length;
  const P = [], D = [], C = [];
  for (const r of rows) {
    const p = Array.isArray(r) ? r.slice(0, 3) : r.pos, l = Array.isArray(r) ? r.slice(3, 6) : r.look;
    const cut = Array.isArray(r) ? !!r[12] : !!r.cut;
    const d = [l[0] - p[0], l[1] - p[1], l[2] - p[2]], m = Math.hypot(...d) || 1;
    P.push(p); D.push(d.map((x) => x / m)); C.push(cut);
  }
  const yaw = [], pitch = [];
  let prev = null;
  for (const d of D) {
    let y = Math.atan2(d[0], d[2]);
    if (prev !== null) y = prev + wrap(y - prev);
    yaw.push(y); prev = y;
    pitch.push(Math.asin(Math.max(-1, Math.min(1, d[1]))));
  }
  const deg = 180 / Math.PI;
  // central differences, valid only where no cut touches the stencil (f-2 .. f+2)
  const ok = (f) => f >= 2 && f < n - 2 && !C[f - 1] && !C[f] && !C[f + 1] && !C[f + 2];
  let angAccMax = 0, angVelMax = 0, posAccMax = 0, flips = 0, frames = 0;
  const accs = [];
  let lastY = 0, lastP = 0;
  for (let f = 2; f < n - 2; f++) {
    if (!ok(f)) { lastY = 0; lastP = 0; continue; }
    frames++;
    const wy = ((yaw[f + 1] - yaw[f - 1]) / 2) * fps * deg, wp = ((pitch[f + 1] - pitch[f - 1]) / 2) * fps * deg;
    const ay = (yaw[f + 1] - 2 * yaw[f] + yaw[f - 1]) * fps * fps * deg, ap = (pitch[f + 1] - 2 * pitch[f] + pitch[f - 1]) * fps * fps * deg;
    const acc = Math.hypot(ay, ap);
    accs.push(acc);
    angAccMax = Math.max(angAccMax, acc);
    angVelMax = Math.max(angVelMax, Math.hypot(wy, wp));
    let pa = 0;
    for (let k = 0; k < 3; k++) pa += ((P[f + 1][k] - 2 * P[f][k] + P[f - 1][k]) * fps * fps) ** 2;
    posAccMax = Math.max(posAccMax, Math.sqrt(pa));
    for (const [w, key] of [[wy, 'y'], [wp, 'p']]) {
      if (Math.abs(w) < 2) continue;
      const s = Math.sign(w);
      if (key === 'y') { if (lastY && s !== lastY) flips++; lastY = s; } else { if (lastP && s !== lastP) flips++; lastP = s; }
    }
  }
  accs.sort((a, b) => a - b);
  const angAccP99 = accs.length ? accs[Math.min(accs.length - 1, Math.floor(accs.length * 0.99))] : 0;
  return { angAccMax, angAccP99, angVelMax, posAccMax, flipsPerSec: frames ? (flips * fps) / frames : 0, frames };
}
