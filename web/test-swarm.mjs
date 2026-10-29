// Headless checks for the swarm (web/src/swarm.js via blocking.js): the bots' head volumes never pass through each
// other while they MOVE (head-on and crossing glides, an entrance of many through the doors, a march round a set, the
// studio huddle drawing in), they still get to their marks, contact on purpose still happens (a handshake's hands
// meet), every curated episode plays with no unintended overlap (web/collisions.mjs, the meter), and the same run twice
// is the same to the last digit (no randomness, no wall clock).
import assert from 'node:assert/strict';
import * as THREE from 'three';

// the meter (it stubs the DOM the heads' lyric panels draw on, and loads the Blender sets)
const { simulate, loadSets, headOf, headRadius, DT } = await import('./collisions.mjs');
const { SEEDS } = await import('./src/curated.js');
const { Bot } = await import('./src/rig.js');
const { NAMES } = await import('./src/gen/cast.js');
const { Blocking, studioHome } = await import('./src/blocking.js');
const { resolveAction } = await import('./src/actions.js');
const { startPlay, updatePlays, resetPlays, runningPlays } = await import('./src/plays/index.js');
const { handDistance } = await import('./src/scene/hand-touch.js');
const { steer, SWARM } = await import('./src/swarm.js');

const groups = await loadSets();
const VIEWER = new THREE.Vector3(0, 2.1, 6.6);

/** A choir of 16 and its blocking (sets loaded); step(seconds, each) runs blocking, plays and the bots (heads + hands). */
function stage({ beats = null, events = [] } = {}) {
  resetPlays();
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  for (const b of bots.values()) b.viewer = VIEWER;
  const blocking = new Blocking({ bots, scene: new THREE.Scene() });
  for (const [n, g] of Object.entries(groups)) blocking.addSet(n, g);
  blocking.load(beats, events);
  blocking.reset();
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots, viewer: VIEWER };
  const heads = new Map([...bots.values()].map((b) => [b, new THREE.Vector3()]));
  let worst = 0, worstWhat = '';
  const meter = () => {
    for (const b of bots.values()) headOf(b, heads.get(b));
    const list = [...bots.values()].filter((b) => b.group.visible);
    const running = runningPlays();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (running.some((s) => s.cast.includes(a) && s.cast.includes(b))) continue; // contact on purpose
      const depth = headRadius(a) + headRadius(b) - heads.get(a).distanceTo(heads.get(b));
      if (depth > worst) { worst = depth; worstWhat = `${a.name}/${b.name} at ${ctx.time.toFixed(2)} s`; }
    }
  };
  const step = (seconds, each = null) => {
    for (let f = 0; f < Math.round(seconds / DT); f++) {
      ctx.time += DT;
      blocking.update(DT);
      updatePlays(DT, ctx);
      for (const b of bots.values()) b.update(DT, ctx.time, ctx);
      meter();
      each?.(ctx.time);
    }
  };
  return { bots, blocking, ctx, step, get worst() { return worst; }, get worstWhat() { return worstWhat; } };
}
const TOL = 0.005; // m of penetration the meter lets pass (as web/collisions.mjs)
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 1. the steering itself (pure): head-on movers sidestep to their own right, a settled bot yields a little, an
//    immobile one not at all, a pair in contact on purpose is left alone, and a mark that clashes draws no dodge
{
  const bot = (index, unit = 0.12) => ({ index, unit, push: new THREE.Vector3() });
  const agent = (b, x, z, wx, wz, extra = {}) => ({ bot: b, x, y: 1, z, bx: x, by: 1, bz: z, gx: x + wx * 3, gz: z + wz * 3, vx: wx, vz: wz, wx, wz, r: 0.3, mobile: true, moving: true, left: 3, ...extra });
  const a = bot(0), b = bot(1);
  steer([agent(a, 0, 0, 1.4, 0), agent(b, 2, 0, -1.4, 0)]);
  // a goes +x: its right (seen from above, z toward the viewer) is +z; b goes -x: its right is -z
  assert.ok(a.push.z > 0.3 && b.push.z < -0.3, `head-on: each to its own right (${a.push.z.toFixed(2)}, ${b.push.z.toFixed(2)})`);
  assert.ok(a.push.x < 0 && b.push.x > 0, 'and eases off');
  const c = bot(2), d = bot(3);
  steer([agent(c, 0, 0, 1.4, 0), agent(d, 1.5, 0.05, 0, 0, { moving: false, left: 0, gx: 1.5, gz: 0.05 })]);
  assert.ok(Math.abs(c.push.z) > 0.3, 'a mover goes round a settled bot');
  assert.ok(d.push.length() > 0 && d.push.length() < Math.abs(c.push.z), 'the settled one sidesteps a little (it yields)');
  const e = bot(4), f = bot(5);
  steer([agent(e, 0, 0, 1.4, 0), agent(f, 1.5, 0.05, 0, 0, { moving: false, mobile: false, left: 0 })]);
  assert.equal(f.push.length(), 0, 'an immobile bot (seated, held by a hand play) is never pushed');
  const g = bot(6), h = bot(7);
  steer([agent(g, 0, 0, 1.4, 0), agent(h, 0.4, 0, -1.4, 0)], (x, y) => (x === g && y === h) || (x === h && y === g));
  assert.equal(g.push.length() + h.push.length(), 0, 'contact on purpose: no steering');
  // two bots whose marks clash: only the separation (no circling round each other)
  const k = bot(8), l = bot(9);
  steer([agent(k, 0, 0, 0.2, 0, { gx: 0.5, gz: 0 }), agent(l, 0.75, 0, -0.2, 0, { gx: 0.25, gz: 0 })]);
  assert.ok(Math.abs(k.push.z) < 1e-9 && Math.abs(l.push.z) < 1e-9, 'clashing marks: no sidestep');
  assert.ok(SWARM.horizon > 0 && SWARM.maxPush >= 1.8, 'the swarm can out-steer an entrance glide');
}

// 2. crossing paths in the studio: a head-on swap, a crossing at right angles and a diagonal, all at one height
{
  const s = stage();
  const { bots } = s;
  const y = 1.0;
  const moves = [
    ['Teddy', [-2.6, 2.6], [2.6, 2.6]], ['Ivy', [2.6, 2.6], [-2.6, 2.6]], // head-on
    ['Dan', [0, 4.6], [0, 1.2]], // across them, at right angles
    ['Nora', [-2.2, 4.4], [2.2, 1.4]], ['Lou', [2.2, 4.4], [-2.2, 1.4]], // diagonals crossing in the middle
  ];
  for (const [n, from] of moves) bots.get(n).place(new THREE.Vector3(from[0], y, from[1]), 0);
  const walk = (n, to) => bots.get(n).walkTo(new THREE.Vector3(to[0], y, to[1]));
  s.step(0.1);
  for (const [n, , to] of moves) walk(n, to);
  const arrived = new Map();
  s.step(9, (t) => {
    for (const [n, , to] of moves) {
      const b = bots.get(n);
      if (!arrived.has(n) && Math.hypot(b.pos.x - to[0], b.pos.z - to[1]) < 0.1) arrived.set(n, t);
    }
  });
  assert.ok(s.worst <= TOL, `crossing: heads overlap ${s.worst.toFixed(3)} m (${s.worstWhat})`);
  for (const [n, from, to] of moves) {
    const straight = Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.45;
    assert.ok(arrived.has(n), `crossing: ${n} gets to its mark`);
    assert.ok(arrived.get(n) < straight + 3.5, `crossing: ${n} took ${arrived.get(n).toFixed(2)} s (straight ${straight.toFixed(2)} s)`);
  }
  // and back to rest: nobody drifts on its mark
  for (const b of bots.values()) assert.ok(Math.hypot(b.vel.x, b.vel.z) < 0.03, `${b.name} still drifting at ${Math.hypot(b.vel.x, b.vel.z).toFixed(3)} m/s`);
  console.log(`crossing: 5 bots head-on, across and diagonal: worst ${s.worst.toFixed(3)} m, slowest ${Math.max(...arrived.values()).toFixed(2)} s`);
}

// 3. an entrance through the doors: a beat in the diner, then a beat whose cast of nine mostly comes in from outside
{
  const cast1 = ['Teddy', 'Lou'], cast2 = ['Teddy', 'Lou', 'Ivy', 'Nora', 'Pearl', 'Hattie', 'Gigi', 'Benny', 'Knox'];
  const beats = { beats: [{ id: 'b1', section: 'verse1', set: 'diner', cast: cast1 }, { id: 'b2', section: 'chorus1', set: 'diner', cast: cast2 }] };
  const ev = (seq, t, beat, bot) => ({ seq, t, beat, bot, lyric: 'la la', action: '', consult: [], chords: [] });
  const events = [ev(0, 0, 'b1', 'Teddy'), ev(1, 1, 'b2', 'Ivy')];
  const s = stage({ beats, events });
  const { bots, blocking } = s;
  s.step(1);
  blocking.onEvent(events[1], bots.get('Ivy'));
  let most = 0;
  s.step(14, () => { most = Math.max(most, blocking.onSet().length); });
  assert.ok(s.worst <= TOL, `entrance: heads overlap ${s.worst.toFixed(3)} m (${s.worstWhat})`);
  for (const n of cast2) {
    const b = bots.get(n), st = blocking.state.get(b);
    assert.equal(st.mode, 'on', `${n} on set`);
    assert.ok(b.group.visible && flat(b.pos, b.target) < 0.25, `entrance: ${n} at its place (${flat(b.pos, b.target).toFixed(2)} m off)`);
  }
  console.log(`entrance: ${cast2.length} in the diner (${most} on set at most), worst ${s.worst.toFixed(3)} m`);
}

// 4. a march round the street, the line following its leader, then everyone back to their places
{
  const cast = ['Teddy', 'Lou', 'Ivy', 'Nora', 'Pearl', 'Hattie', 'Gigi'];
  const beats = { beats: [{ id: 'b1', section: 'verse1', set: 'street', cast }] };
  const events = [{ seq: 0, t: 0, beat: 'b1', bot: 'Teddy', lyric: 'la', action: '', consult: [], chords: [] }];
  const s = stage({ beats, events });
  const { bots, blocking } = s;
  s.step(0.5);
  blocking.move(resolveAction('march'), bots.get('Ivy'));
  assert.equal(blocking.activity?.kind, 'march');
  s.step(20);
  assert.equal(blocking.activity, null, 'the march is over');
  assert.ok(s.worst <= TOL, `march: heads overlap ${s.worst.toFixed(3)} m (${s.worstWhat})`);
  for (const n of cast) assert.ok(flat(bots.get(n).pos, blocking.state.get(bots.get(n)).slot) < 0.25, `march: ${n} back at its place`);
  console.log(`march: ${cast.length} round the street and back, worst ${s.worst.toFixed(3)} m`);
}

// 5. the studio huddle: the whole choir draws in round one bot, as tight as the heads allow, and back to the rows
{
  const s = stage();
  const { bots, blocking } = s;
  const lead = bots.get('Gigi');
  s.step(0.2);
  blocking.move(resolveAction('huddle'), lead);
  const goals = new Map([...bots.values()].map((b) => [b, b.target.clone()]));
  s.step(9);
  assert.ok(s.worst <= TOL, `huddle: heads overlap ${s.worst.toFixed(3)} m (${s.worstWhat})`);
  let far = 0;
  for (const b of bots.values()) far = Math.max(far, flat(b.pos, goals.get(b)));
  assert.ok(far < 0.2, `huddle: everyone at the ring (${far.toFixed(2)} m off at most)`);
  const ring = [...bots.values()].filter((b) => b !== lead).map((b) => flat(b.pos, lead.home));
  assert.ok(Math.max(...ring) < 2, `drawn in: ring radius ${Math.max(...ring).toFixed(2)} m`);
  // back to the rows (the studio formation: no two heads touching at rest)
  for (const b of bots.values()) b.walkTo(b.home, { face: 0 });
  s.step(9);
  assert.ok(s.worst <= TOL, `huddle and back: heads overlap ${s.worst.toFixed(3)} m (${s.worstWhat})`);
  for (const b of bots.values()) assert.ok(flat(b.pos, b.home) < 0.12, `${b.name} back in its row (${flat(b.pos, b.home).toFixed(2)} m off)`);
  console.log(`huddle: 15 round Gigi (ring ${Math.max(...ring).toFixed(2)} m) and back, worst ${s.worst.toFixed(3)} m`);
}

// 6. contact on purpose still happens: a handshake between neighbours in the front row, the swarm running all along
{
  const s = stage();
  const { bots, ctx } = s;
  const a = bots.get('Hattie'), b = bots.get('Gigi'); // front row, side by side
  s.step(0.3);
  const at = [a.pos.clone(), b.pos.clone()];
  assert.ok(startPlay('handshake', a, [b], { ...ctx }), 'the handshake plays');
  const play = runningPlays().find((x) => x.id === 'handshake');
  let gap = Infinity;
  s.step(8, () => {
    if (play.phase !== 1) return;
    const A = a.hands.drawnWorld(-1), B = b.hands.drawnWorld(-1);
    gap = Math.min(gap, handDistance(A.shape, -1, A.position, A.rotation, A.scale, B.shape, -1, B.position, B.rotation, B.scale) / Math.sqrt(A.scale * B.scale));
  });
  assert.ok(gap < 0.0015, `handshake: the hands meet (gap ${(gap * 1000).toFixed(2)} mm of rig)`);
  assert.ok(flat(a.pos, at[0]) < 0.02 && flat(b.pos, at[1]) < 0.02, 'the pair is not pushed apart');
  assert.ok(s.worst <= TOL, `handshake: no third head touched (${s.worstWhat})`);
  console.log(`handshake: hands meet (gap ${(gap * 1000).toFixed(2)} mm of rig), the pair held its marks`);
}

// 7. every curated episode, as main.js stages it (blocking + acting + hand plays + heads and hands): no unintended
//    overlap in any frame, the scene's bots on their marks at the end of nearly every beat; one of them twice: the same
const rows = [];
for (const [slug] of SEEDS) {
  const r = await simulate(slug);
  assert.equal(r.overlapFrames, 0, `${slug}: ${r.overlapFrames} frames with unintended overlaps (worst ${r.worst} m, ${JSON.stringify(r.worstAt)})`);
  assert.ok(r.offMarks <= 0.1 * r.onMarks, `${slug}: ${r.offMarks} of ${r.onMarks} bots off their marks at the beats' ends`);
  rows.push(`${slug} ${r.frames}f`);
}
{
  const a = await simulate('block-race'), b = await simulate('block-race');
  assert.equal(a.fingerprint, b.fingerprint, 'deterministic: the same positions every run');
  assert.deepEqual(a.orders, b.orders, 'deterministic: the same moves, the same arrivals');
}

console.log(`swarm ok: no head through another while moving (crossing, entrance, march, huddle), handshake contact kept, ${rows.length} curated episodes with no unintended overlap, deterministic`);
