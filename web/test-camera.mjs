// Headless checks for the camera's follow (camera-follow.js): it follows the bots smoothly at all times. The springs
// keep their speed and acceleration limits and never overshoot a step, the path is the same at 30, 60 or 144 fps, a
// swing to another angle orbits round the look point (not through the bots), a cut jumps; the group shot's swing to a
// better angle has hysteresis; and on the v12 premiere's recorded camera goals (hackathon-win, chorus 3 at the
// trailer's 1:55, where the group shot swung between the set's three angles every half second) the old follow
// shakes and the new one is smooth by the jitter measure the render QA uses (pathJitter).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Spring, CameraFollow, SmoothVec, SwingGate, pathJitter, FOLLOW } from './src/camera-follow.js';

const v = (x, y, z) => ({ x, y, z });
const deg = Math.PI / 180;

// 1. a spring: a step of 5 m eases in and out within its limits, no overshoot, and settles
{
  const s = new Spring({ smooth: 0.5, vmax: 2, amax: 4 });
  s.snap(0);
  let prevV = 0, maxA = 0, maxV = 0, over = 0;
  const dt = 1 / 120;
  for (let k = 0; k < 120 * 8; k++) {
    s.step(dt, 5);
    maxA = Math.max(maxA, Math.abs(s.v - prevV) / dt);
    maxV = Math.max(maxV, Math.abs(s.v));
    over = Math.max(over, s.x - 5);
    prevV = s.v;
  }
  assert.ok(maxV <= 2 + 1e-9, `speed ${maxV}`);
  assert.ok(maxA <= 4 + 1e-6, `acceleration ${maxA}`);
  assert.ok(over < 0.01, `overshoot ${over}`);
  assert.ok(Math.abs(s.x - 5) < 1e-3 && Math.abs(s.v) < 1e-3, 'settles on the goal');
}

// 2. frame-rate independent: the same goal path followed at 30, 60 and 144 fps lands in the same place
{
  // (the goal steps on times every rate has a frame at: what is compared is the follow, not the sampling of the goal)
  const goal = (t) => (t < 0.5 ? [v(0, 1.8, 4), v(0, 1.2, 0)] : t < 1.5 ? [v(3, 1.6, 3), v(0.5, 1.3, 0)]
    : t < 2.5 ? [v(-2.5, 2.0, 2.5), v(1, 1.1, -0.5)] : [v(-3, 1.7, 3.5), v(-1, 1.2, 0)]);
  const run = (fps) => {
    const f = new CameraFollow(), p = v(0, 0, 0), l = v(0, 0, 0);
    const [gp, gl] = goal(0);
    f.cut(gp, gl);
    const out = [];
    for (let k = 1; k <= 4 * fps; k++) {
      const [a, b] = goal((k - 1) / fps); // (the goal over the frame to come)
      f.update(1 / fps, a, b, p, l);
      if (k % (fps / 2) === 0 || fps === 144) out.push({ t: k / fps, p: { ...p }, l: { ...l } });
    }
    return out;
  };
  const at = (path, t) => path.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best));
  const p30 = run(30), p60 = run(60), p144 = run(144);
  for (const t of [1, 2, 2.5, 3, 4]) {
    for (const other of [p60, p144]) {
      const a = at(p30, t), b = at(other, t);
      const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y, a.p.z - b.p.z) + Math.hypot(a.l.x - b.l.x, a.l.y - b.l.y, a.l.z - b.l.z);
      assert.ok(d < 0.03, `t=${t}: 30 fps vs ${other === p60 ? 60 : 144} fps differ by ${d.toFixed(3)} m`);
    }
  }
}

// 3. a swing from one of a set's angles to another (120 degrees round the bots) orbits: it never comes nearer the look
// point than the shot's distance (the old lerp cut the chord, through the group), and it is smooth all the way
{
  const look = v(0, 1.2, 0), a = v(0, 1.8, 4), b = v(4 * Math.sin(120 * deg), 1.8, 4 * Math.cos(120 * deg));
  const f = new CameraFollow(), p = v(0, 0, 0), l = v(0, 0, 0);
  f.cut(a, look);
  let nearest = Infinity;
  const rows = [];
  for (let k = 0; k < 30 * 6; k++) {
    f.update(1 / 30, b, look, p, l);
    nearest = Math.min(nearest, Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z));
    rows.push({ pos: [p.x, p.y, p.z], look: [l.x, l.y, l.z], cut: false });
  }
  const want = Math.hypot(a.x - look.x, a.y - look.y, a.z - look.z);
  assert.ok(nearest > want * 0.98, `the swing came within ${nearest.toFixed(2)} m of the look point (shot at ${want.toFixed(2)} m)`);
  assert.ok(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < 0.02, 'arrives at the new angle');
  const j = pathJitter(rows);
  assert.ok(j.angAccMax < 150 && j.flipsPerSec === 0, `swing jitter ${JSON.stringify(j)}`);
  // the old follow (lerp 1 - e^(-2.5 dt)) on the same step: through the chord, and a jolt at its start
  const q = { ...a };
  let oldNearest = Infinity;
  const oldRows = [{ pos: [a.x, a.y, a.z], look: [look.x, look.y, look.z], cut: false }];
  for (let k = 0; k < 30 * 6; k++) {
    const kk = 1 - Math.exp(-2.5 / 30);
    q.x += (b.x - q.x) * kk; q.y += (b.y - q.y) * kk; q.z += (b.z - q.z) * kk;
    oldNearest = Math.min(oldNearest, Math.hypot(q.x - look.x, q.y - look.y, q.z - look.z));
    oldRows.push({ pos: [q.x, q.y, q.z], look: [look.x, look.y, look.z], cut: false });
  }
  assert.ok(oldNearest < want * 0.6, 'the old lerp swung through the middle');
  assert.ok(pathJitter([oldRows[0], oldRows[0], ...oldRows]).angAccMax > 500, 'the old lerp jolts');
}

// 4. a cut jumps (no glide), and the hold smoothing snaps with it
{
  const f = new CameraFollow(), p = v(0, 0, 0), l = v(0, 0, 0);
  f.cut(v(0, 2, 5), v(0, 1, 0));
  f.update(1 / 30, v(0, 2, 5), v(0, 1, 0), p, l);
  f.cut(v(6, 2, -1), v(5, 1, -4));
  f.update(0, v(6, 2, -1), v(5, 1, -4), p, l);
  assert.ok(Math.hypot(p.x - 6, p.y - 2, p.z + 1) < 1e-9 && Math.hypot(l.x - 5, l.y - 1, l.z + 4) < 1e-9);
  const h = new SmoothVec(), o = v(0, 0, 0);
  h.snap(v(0, 0.3, 0));
  h.update(0, v(0, 0.3, 0), o);
  assert.equal(o.y, 0.3);
  // a hold correction that jumps (a head bobbing past the card floor) is eased in, not taken in one frame
  h.update(1 / 30, v(0, 0.6, 0), o);
  assert.ok(o.y > 0.3 && o.y < 0.32, `hold eased ${o.y}`);
}

// 5. the group shot's swing gate: a face hidden at every other check (a head bobbing past) never swings; a face hidden
// for good swings once the shot has held 4 s, to a clearly better angle only; at most twice a shot
{
  const g = new SwingGate();
  let swings = 0;
  for (let t = 0; t < 30; t += 0.5) if (g.offer(t, (t * 2) % 2 ? 0.6 : 0.1, 0)) swings++;
  assert.equal(swings, 0, 'a flicker of a hidden face does not swing');
  g.reset(0);
  const at = [];
  for (let t = 0; t < 30; t += 0.5) if (g.offer(t, 0.6, 0.05)) at.push(t);
  assert.deepEqual(at, [4, 8], 'held 4 s between swings, two at most');
  g.reset(0);
  for (let t = 0; t < 10; t += 0.5) assert.equal(g.offer(t, 0.6, 0.45), false, 'not clearly better: stays');
  // the v12 behaviour this replaces: re-picked every 0.5 s check while a face stayed hidden from each angle in turn
  const oldRule = (hidden, better) => hidden > 0.2 && better < hidden - 0.15;
  let oldSwings = 0;
  for (let t = 0; t < 3; t += 0.5) if (oldRule(0.5, 0.3)) oldSwings++;
  assert.equal(oldSwings, 6);
}

// 6. the v12 premiere (hackathon-win) as recorded: chorus 3 (the trailer's 1:55) and the chorus 2 / bridge stretch.
// The recorded camera (lerp + hold) shook: jolts of thousands of deg/s^2 between cuts. Replayed through the follow,
// the very same goals (still swinging between angles every 0.5 s) give a smooth camera; through the old lerp they
// do not. The bounds: 200 deg/s^2 (the yaw spring's limit is 110), positions under 20 m/s^2 (the orbit and the look
// point each limited), under 0.5 reversals a second (these goals still swing back and forth; in the app the swing
// gate stops that, 0.03 a second over the whole v13 premiere).
{
  const fx = JSON.parse(readFileSync(new URL('./test-data/camera-path-hackathon-v12.json', import.meta.url), 'utf8'));
  const LIMIT = { angAccMax: 200, posAccMax: 20, flipsPerSec: 0.5 };
  const smooth = (j) => j.angAccMax < LIMIT.angAccMax && j.posAccMax < LIMIT.posAccMax && j.flipsPerSec < LIMIT.flipsPerSec;
  for (const w of fx.windows) {
    const rec = pathJitter(w.rows, fx.fps);
    assert.ok(!smooth(rec), `the recorded v12 camera ${w.t0}-${w.t1} s should fail the measure: ${JSON.stringify(rec)}`);
    const follow = new CameraFollow(), p = v(0, 0, 0), l = v(0, 0, 0);
    const old = { p: null, l: null };
    const mine = [], lerp = [];
    for (const r of w.rows) {
      const gp = v(r[6], r[7], r[8]), gl = v(r[9], r[10], r[11]), cut = !!r[12];
      if (cut || !old.p) { follow.cut(gp, gl); old.p = { ...gp }; old.l = { ...gl }; }
      else {
        const k = 1 - Math.exp(-2.5 / fx.fps);
        for (const [a, b] of [[old.p, gp], [old.l, gl]]) { a.x += (b.x - a.x) * k; a.y += (b.y - a.y) * k; a.z += (b.z - a.z) * k; }
      }
      follow.update(cut ? 0 : 1 / fx.fps, gp, gl, p, l);
      mine.push([p.x, p.y, p.z, l.x, l.y, l.z, 0, 0, 0, 0, 0, 0, cut ? 1 : 0]);
      lerp.push([old.p.x, old.p.y, old.p.z, old.l.x, old.l.y, old.l.z, 0, 0, 0, 0, 0, 0, cut ? 1 : 0]);
    }
    const jl = pathJitter(lerp, fx.fps), jm = pathJitter(mine, fx.fps);
    assert.ok(!smooth(jl), `the old lerp on ${w.t0}-${w.t1} s should fail: ${JSON.stringify(jl)}`);
    assert.ok(smooth(jm), `the follow on ${w.t0}-${w.t1} s: ${JSON.stringify(jm)}`);
    assert.ok(jm.angAccMax < jl.angAccMax / 5, 'at least 5x smoother than the old lerp');
    console.log(`  v12 goals ${w.t0}-${w.t1} s: recorded ${rec.angAccMax.toFixed(0)} deg/s^2, old lerp ${jl.angAccMax.toFixed(0)}, follow ${jm.angAccMax.toFixed(0)} (pos ${jm.posAccMax.toFixed(1)} m/s^2)`);
  }
  assert.ok(FOLLOW.yaw.amax / deg <= LIMIT.angAccMax);
}

console.log('test-camera: all passed');
