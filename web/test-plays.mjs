// Headless checks for the Soothing Bots hand plays (web/src/plays): each ported play runs its phases on real Bots,
// the duo plays' hands really meet (handshake palms pressed, the high five's palm plates and the fist bump's knuckles
// touching at the hit, laced hands, the pinky's hook), beat-locked steps land on the song's beats, aims stay within
// reach and never jump, every bot is handed back after the end, and a run is deterministic.
import assert from 'node:assert/strict';
import * as THREE from 'three';

function stub2d() {
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return () => ({ width: 12 });
      return () => undefined;
    },
    set() { return true; },
  });
}
globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }) };
globalThis.Image = class { set src(v) { void v; } };

const { Bot } = await import('./src/rig.js');
const { CATALOG, startPlay, updatePlays, playHistory, resetPlays, runningPlays } = await import('./src/plays/index.js');
const { PLAYS, PLAY_PRIORITY } = await import('./src/actions.js');
const { handDistance, posedCapsules, makeCapsules, measure, CAP_COUNT, digitOf, segmentDistance } = await import('./src/scene/hand-touch.js');

const FPS = 30, DT = 1 / FPS;
const VIEWER = new THREE.Vector3(0, 2.1, 6.6);

/** A little studio: bots side by side in a front row (as main.js's studioHome), 1.35 apart. */
function studio(names, { spacing = 1.35, y = 0.75, z = 0.5 } = {}) {
  const bots = new Map();
  names.forEach((n, i) => {
    const x = (i - (names.length - 1) / 2) * spacing;
    const b = new Bot(n, new THREE.Vector3(x, y, z), i * 2);
    b.viewer = VIEWER;
    bots.set(n, b);
  });
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots, viewer: VIEWER };
  let t = 0;
  const frames = [];
  const step = () => {
    t += DT;
    ctx.time = t;
    updatePlays(DT, ctx);
    bots.forEach((b) => b.update(DT, t, ctx));
  };
  return { bots, ctx, step, run: (sec, each) => { for (let f = 0; f < Math.round(sec * FPS); f++) { step(); each?.(t); } }, get t() { return t; }, frames };
}

const finite = (v, what) => assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `${what} not finite`);
const notesOf = (id) => playHistory().filter((s) => s.id === id).at(-1)?.notes ?? [];
const steps = (id) => notesOf(id).map((n) => n.step);

/** The drawn hand of `bot` on `side` in the world (scale: world metres per rig metre). */
const drawn = (bot, side) => bot.hands.drawnWorld(side);
/** The closest the two drawn hands' surfaces come, in rig metres (negative: overlapping that deep). */
function gapRig(a, sa, b, sb) {
  const A = drawn(a, sa), B = drawn(b, sb);
  const d = handDistance(A.shape, sa, A.position, A.rotation, A.scale, B.shape, sb, B.position, B.rotation, B.scale);
  return d / Math.sqrt(A.scale * B.scale);
}

// ------------------------------------------------------------------ 1. every ported play runs on real bots, finite, ends, hands back

for (const id of Object.keys(CATALOG)) {
  resetPlays();
  const kind = PLAYS[id];
  assert.ok(kind, `${id} is an actions.js PLAYS id`);
  const names = kind === 'group' ? ['Gray', 'White', 'Gold', 'Pink'] : ['Gray', 'White'];
  const st = studio(names);
  const [a, ...rest] = [...st.bots.values()];
  st.run(0.4);
  assert.equal(startPlay(id, a, kind === 'duo' ? [rest[0]] : kind === 'group' ? rest : [], st.ctx), true, `${id} should play`);
  const max = (CATALOG[id].maxSeconds ?? 16) + 2;
  let jumps = 0, frames = 0;
  const last = new Map();
  st.run(max, () => {
    frames++;
    for (const b of st.bots.values()) for (const side of [-1, 1]) {
      const d = b.hands.drawn(side);
      finite(d.position, `${id} ${b.name} ${side}`);
      // within reach of its head (3 half-widths + the follow's slack)
      const c = b._centre;
      assert.ok(d.position.distanceTo(c) <= 3.4 * b.unit, `${id}: ${b.name} hand ${side} out of reach ${(d.position.distanceTo(c) / b.unit).toFixed(2)}`);
      const key = `${b.name}${side}`;
      if (last.has(key) && d.position.distanceTo(last.get(key)) > 0.6 * b.unit) jumps++;
      last.set(key, d.position.clone());
    }
  });
  assert.equal(jumps, 0, `${id}: hands jumped ${jumps} times`);
  assert.equal(runningPlays().length, 0, `${id} still running after ${max} s`);
  for (const b of st.bots.values()) {
    assert.equal(b.aims.left, null, `${id}: ${b.name} left hand handed back`);
    assert.equal(b.aims.right, null, `${id}: ${b.name} right hand handed back`);
    assert.ok(b.playOffset.length() < 1e-3, `${id}: ${b.name} head home (${b.playOffset.length()})`);
  }
  assert.ok(notesOf(id).length > 0, `${id} noted nothing`);
}

// ------------------------------------------------------------------ 2. handshake: right to right, palms pressed, three pumps on the beat

{
  resetPlays();
  const st = studio(['Gray', 'White']);
  const [a, b] = st.bots.values();
  st.run(0.3);
  assert.ok(startPlay('handshake', a, [b], st.ctx));
  const s = runningPlays()[0];
  assert.equal(s.side[0], -1, 'handshake: the anatomical right hand (side -1 in this mirrored port)');
  assert.equal(s.side[1], -1);
  let minGap = Infinity, maxGap = -Infinity, pumpPhaseFrames = 0;
  st.run(8, () => {
    if (s.phase === 1 && s.beat - s.mark >= 0.1 && s.beat - s.mark <= 2.9) {
      pumpPhaseFrames++;
      const g = gapRig(s.bot(0), -1, s.bot(1), -1);
      minGap = Math.min(minGap, g);
      maxGap = Math.max(maxGap, g);
    }
  });
  assert.deepEqual(steps('handshake').filter((x) => ['clasp', 'pump', 'let go'].includes(x)), ['clasp', 'pump', 'let go']);
  assert.ok(pumpPhaseFrames > 20, `pumped ${pumpPhaseFrames} frames`);
  // gripping: the hands touch (palms pressed, the fingers round the heel): within 1.5 mm of rig, never deeper than a finger radius
  assert.ok(minGap < 0.0015 && minGap > -0.005, `handshake grip gap ${(minGap * 1000).toFixed(2)} mm .. ${(maxGap * 1000).toFixed(2)} mm (rig)`);
  console.log(`handshake: grip gap ${(minGap * 1000).toFixed(2)}..${(maxGap * 1000).toFixed(2)} mm of rig while pumping`);
}

// ------------------------------------------------------------------ 2b. the duo plays' hands really meet (rig mm), beat-locked

/** Both drawn hands as capsules; { closest, palms, fingerIn } in rig metres (Unity HandTouch.Measure). */
const pair = makeCapsules(2 * CAP_COUNT);
function meet(a, sa, b, sb) {
  const A = drawn(a, sa), B = drawn(b, sb);
  posedCapsules(A.shape, sa, A.position, A.rotation, A.scale, pair, 0);
  posedCapsules(B.shape, sb, B.position, B.rotation, B.scale, pair, CAP_COUNT);
  const m = measure(pair, 0, pair, CAP_COUNT), k = Math.sqrt(A.scale * B.scale);
  return { closest: m.closest / k, palms: m.palms / k, fingerIn: m.fingerIn / k };
}
/** Runs play `id` on two bots at `fps`, calling each(s, t) every frame while it runs. */
function duo(id, each, { fps = 120, seconds = 12, beatSec = 0.625 } = {}) {
  resetPlays();
  const st = studio(['Gray', 'White']);
  st.ctx.beatSec = beatSec;
  const [a, b] = st.bots.values();
  st.run(0.3);
  assert.ok(startPlay(id, a, [b], st.ctx), `${id} plays`);
  const s = runningPlays()[0];
  const dt = 1 / fps;
  let t = st.t;
  for (let f = 0; f < seconds * fps && runningPlays().includes(s); f++) {
    t += dt;
    st.ctx.time = t;
    updatePlays(dt, st.ctx);
    st.bots.forEach((bot) => bot.update(dt, t, st.ctx));
    each(s, t);
  }
  return s;
}
const mm = (x) => `${(x * 1000).toFixed(2)} mm`;

// high five: the palm plates meet at the slap (within a millimetre of rig), nothing goes through
{
  let pressed = Infinity, deepest = 0, apartBefore = 0;
  duo('high-five', (s) => {
    const m = meet(s.bot(0), s.side[0], s.bot(1), s.side[1]);
    if (s.phase === 2) {
      pressed = Math.min(pressed, Math.abs(m.palms));
      deepest = Math.max(deepest, m.fingerIn);
    }
    if (s.phase === 1 && s.phaseT < 0.25) apartBefore = Math.max(apartBefore, m.closest);
  });
  assert.ok(pressed < 0.001, `high five: palm plates ${mm(pressed)} apart when pressed`);
  assert.ok(deepest < 0.002, `high five: a finger ${mm(deepest)} into the other hand`);
  assert.ok(apartBefore > 0.01, `high five: apart before the slap (${mm(apartBefore)})`);
  console.log(`high five: palm plates ${mm(pressed)} at the slap, ${mm(apartBefore)} apart in the wind-up`);
}

// fist bump: the knuckles touch at the bump
{
  let touch = Infinity;
  duo('fist-bump', (s) => {
    if (s.phase === 2) touch = Math.min(touch, Math.abs(meet(s.bot(0), s.side[0], s.bot(1), s.side[1]).closest));
  });
  // each fist's front is on the shared contact plane (Unity HandTouch.Place), their frontmost knuckles at mirrored
  // spots in it: a hair apart (about 1.7 mm of a 65 mm hand), never through
  assert.ok(touch < 0.002, `fist bump: the fists ${mm(touch)} apart at the bump`);
  console.log(`fist bump: fists ${mm(touch)} apart at the touch`);
}

// hold hands: laced (fingers pressing between each other, never into a palm), swinging one swing a beat
{
  let worst = Infinity, palms = Infinity, frames = 0;
  const swing = [];
  duo('hold-hands-swing', (s, t) => {
    if (s.phase !== 1 || s.beat - s.mark < 0.2) return;
    const m = meet(s.bot(0), s.side[0], s.bot(1), s.side[1]);
    worst = Math.min(worst, m.closest);
    palms = Math.min(palms, m.palms);
    frames++;
    swing.push([s.beat - s.mark, s.bot(0).hands.drawnWorld(s.side[0]).position.x]);
    void t;
  });
  assert.ok(frames > 100, `hold hands: laced ${frames} frames`);
  assert.ok(worst < 0 && worst > -0.0045, `hold hands: laced fingers press ${mm(-worst)} (no deeper than a finger)`);
  assert.ok(palms > -0.001, `hold hands: a palm went into the other's (${mm(palms)})`);
  // one swing a beat: the clasp crosses the middle near every whole beat (sin(pi u) is 0 there)
  let crossings = 0;
  for (let i = 1; i < swing.length; i++) {
    const [u0] = swing[i - 1], [u1] = swing[i];
    if (Math.floor(u1) !== Math.floor(u0) && u1 > 1 && u1 < 7) crossings++;
  }
  assert.ok(crossings >= 5, `hold hands: swung through ${crossings} beats`);
  console.log(`hold hands: laced ${frames} frames, fingers press ${mm(-worst)}, palms ${mm(palms)} apart`);
}

// pinky promise: B's little finger curls round A's, touching, while they shake
{
  let gap = Infinity, worstIn = 0;
  duo('pinky-promise', (s) => {
    if (s.phase !== 2) return;
    const A = drawn(s.bot(0), s.side[0]), B = drawn(s.bot(1), s.side[1]);
    posedCapsules(A.shape, s.side[0], A.position, A.rotation, A.scale, pair, 0);
    posedCapsules(B.shape, s.side[1], B.position, B.rotation, B.scale, pair, CAP_COUNT);
    let best = Infinity;
    for (let i = 0; i < CAP_COUNT; i++) {
      if (digitOf(pair[i].part) !== 4) continue;
      for (let j = CAP_COUNT; j < 2 * CAP_COUNT; j++) {
        if (digitOf(pair[j].part) !== 4) continue;
        best = Math.min(best, segmentDistance(pair[i].a, pair[i].b, pair[j].a, pair[j].b) - pair[i].r - pair[j].r);
      }
    }
    gap = Math.min(gap, Math.abs(best / Math.sqrt(A.scale * B.scale)));
    worstIn = Math.max(worstIn, measure(pair, 0, pair, CAP_COUNT).fingerIn / Math.sqrt(A.scale * B.scale));
  });
  assert.ok(gap < 0.001, `pinky promise: the little fingers ${mm(gap)} apart while hooked`);
  console.log(`pinky promise: little fingers ${mm(gap)} apart while hooked, deepest press ${mm(worstIn)}`);
}

// heart together: the halves meet (fingertips at the top, wrists at the point)
{
  let held = Infinity, deepest = 0;
  duo('heart-together', (s) => {
    if (s.phase !== 2) return;
    const m = meet(s.bot(0), s.side[0], s.bot(1), s.side[1]);
    held = Math.min(held, Math.abs(m.closest));
    deepest = Math.max(deepest, m.fingerIn);
  });
  assert.ok(held < 0.001, `heart: the halves ${mm(held)} apart when held`);
  assert.ok(deepest < 0.0025, `heart: ${mm(deepest)} through the other half`);
  console.log(`heart together: halves ${mm(held)} apart`);
}

// patty-cake: every clap and pat lands on its beat with the palm plates touching, apart between
{
  const hits = [];
  let between = Infinity;
  duo('patty-cake', (s) => {
    if (s.phase !== 1) return;
    const b = s.beat - s.mark;
    const near = Math.abs(b - Math.round(b));
    // own claps (even beats) and crossed pats (odd beats); measure the hands that meet on this beat
    const n = Math.round(b);
    if (n < 0 || n >= s.I[0] - 1 || near > 0.5 / 120 / s.beatSec + 1e-3) {
      if (near > 0.3 && n >= 0) between = Math.min(between, meet(s.bot(0), 1, s.bot(0), -1).closest);
      return;
    }
    let m;
    if (n % 2 === 0) m = meet(s.bot(0), 1, s.bot(0), -1); // own clap: its two hands
    else {
      const pats = (n & 2) === 0 ? s.side[0] : -s.side[0];
      m = meet(s.bot(0), pats, s.bot(1), pats); // crossed: the same hands of both
    }
    hits.push({ n, palms: Math.abs(m.palms), closest: m.closest });
  });
  const per = new Map();
  for (const h of hits) per.set(h.n, Math.min(per.get(h.n) ?? Infinity, h.palms));
  assert.ok(per.size >= 4, `patty-cake: ${per.size} hits sampled`);
  for (const [n, p] of per) assert.ok(p < 0.0012, `patty-cake: beat ${n} palm plates ${mm(p)} apart`);
  assert.ok(between > 0.004, `patty-cake: own hands only ${mm(between)} apart between hits`);
  console.log(`patty-cake: ${per.size} hits on the beat, palm plates within ${mm(Math.max(...per.values()))}`);
}

// beat locks: the conductor's downbeats and count-beats' counts land on whole song beats
{
  const at = [];
  resetPlays();
  const st = studio(['Gray']);
  const [a] = st.bots.values();
  st.ctx.beatSec = 0.6;
  st.run(0.37);
  assert.ok(startPlay('count-beats', a, [], st.ctx));
  st.run(8, () => {
    const notes = notesOf('count-beats');
    while (at.length < notes.length) at.push({ step: notes[at.length].step, beat: st.ctx.time / st.ctx.beatSec });
  });
  const counts = at.filter((x) => ['1', '2', '3', '4'].includes(x.step));
  assert.deepEqual(counts.map((x) => x.step), ['1', '2', '3', '4']);
  for (let i = 0; i < counts.length; i++) {
    const off = counts[i].beat - Math.round(counts[i].beat);
    assert.ok(off >= 0 && off < (1 / FPS) / 0.6 + 1e-6, `count ${counts[i].step} at beat ${counts[i].beat.toFixed(3)}`);
    if (i) assert.equal(Math.round(counts[i].beat) - Math.round(counts[i - 1].beat), 1, 'one count a beat');
  }
  console.log(`count-beats: 1-2-3-4 on song beats ${counts.map((x) => Math.round(x.beat)).join(', ')}`);
}

// ------------------------------------------------------------------ 2c. the hands' gestures: the clap's palms meet 4 times at 2.3 Hz; palm is a mode

{
  const { RobotHands, GESTURE, HandGestures, clapHit, CLAPS, CLAP_RATE } = await import('./src/scene/hands.js');
  assert.ok(HandGestures.modeOf('palm') === GESTURE.palm && GESTURE.palm > 0, 'palm is a gesture mode');
  assert.ok(HandGestures.modeOf('wave') > 0 && HandGestures.modeOf('loveyou') === GESTURE.loveYou);
  const parent = new THREE.Object3D();
  const hands = new RobotHands(5);
  hands.attach(parent);
  const o = { centre: new THREE.Vector3(0, 1, 0), unit: 0.12, dt: 1 / 240, singing: false, level: 0, beat: 0, beatSec: 0 };
  for (let f = 0; f < 240; f++) hands.update(o);
  assert.equal(hands.play('clap'), GESTURE.clap);
  const gaps = [];
  for (let f = 0; f < 2.4 * 240; f++) {
    hands.update(o);
    const t = (f + 1) / 240;
    const L = hands.drawnWorld(-1), R = hands.drawnWorld(1);
    const d = handDistance(L.shape, -1, L.position, L.rotation, L.scale, R.shape, 1, R.position, R.rotation, R.scale) / L.scale;
    gaps.push({ t, d });
  }
  assert.equal(CLAPS, 4);
  assert.equal(CLAP_RATE, 2.3);
  for (let k = 0; k < CLAPS; k++) {
    const hit = clapHit(k);
    const at = gaps.reduce((best, g) => (Math.abs(g.t - hit) < Math.abs(best.t - hit) ? g : best));
    assert.ok(Math.abs(at.d) < 0.0008, `clap ${k + 1} at ${hit.toFixed(3)} s: palms ${mm(at.d)} apart`);
    const mid = gaps.reduce((best, g) => (Math.abs(g.t - (hit + 0.5 / CLAP_RATE)) < Math.abs(best.t - (hit + 0.5 / CLAP_RATE)) ? g : best));
    if (k < CLAPS - 1) assert.ok(mid.d > 0.01, `between claps ${k + 1} and ${k + 2}: only ${mm(mid.d)} apart`);
  }
  console.log(`clap: ${CLAPS} claps at ${CLAP_RATE} Hz, the palms touching at each hit`);
  // the walk swing: a gliding bot's hands swing to and fro in turn
  const w = new RobotHands(6);
  w.attach(new THREE.Object3D());
  const zs = [];
  for (let f = 0; f < 240; f++) {
    w.update({ ...o, dt: 1 / 60, walk: f > 60 ? 1 : 0 });
    if (f > 120) zs.push(w.drawn(1).position.z - w.drawn(-1).position.z);
  }
  assert.ok(Math.max(...zs) > 0.02 && Math.min(...zs) < -0.02, `walk swing ${Math.min(...zs).toFixed(3)}..${Math.max(...zs).toFixed(3)}`);
}

// ------------------------------------------------------------------ 2d. deterministic: the same start gives the same notes

{
  const run = () => {
    resetPlays();
    const st = studio(['Gray', 'White', 'Gold', 'Pink']);
    const [a, ...rest] = st.bots.values();
    st.run(0.3);
    startPlay('patty-cake', a, [rest[0]], st.ctx);
    st.run(4);
    startPlay('stadium-wave', rest[1], [], st.ctx);
    st.run(8);
    return playHistory().map((s) => `${s.id}:${s.side.slice(0, s.count).join(',')}:` + s.notes.map((n) => `${n.t}/${n.step}/${n.who}/${n.act}`).join(' ')).join('\n');
  };
  assert.equal(run(), run(), 'plays are deterministic');
}

// ------------------------------------------------------------------ 3. a consultation that ends in a handshake (acting.js): the grip holds

{
  const { Acting } = await import('./src/acting.js');
  const { studioHome } = await import('./src/blocking.js');
  const { NAMES } = await import('./src/gen/cast.js');
  resetPlays();
  const bots = new Map();
  NAMES.forEach((n, i) => {
    const b = new Bot(n, studioHome(i), i);
    b.viewer = VIEWER;
    bots.set(n, b);
  });
  const acting = new Acting();
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots, viewer: VIEWER };
  let t = 0;
  const step = () => {
    t += DT;
    ctx.time = t;
    acting.update(DT, bots, ctx);
    updatePlays(DT, ctx);
    bots.forEach((b) => b.update(DT, t, ctx));
  };
  for (let f = 0; f < 15; f++) step();
  const a = bots.get('Jade'), b = bots.get('Blue');
  a.sing(3.4, 'Jade and Blue shake on it.', null);
  const scene = acting.consult(a, [b]);
  scene.agree = 'shake';
  let shook = false, gripFrames = 0, worst = -Infinity, homeDuringGrip = false;
  for (let f = 0; f < 9 * FPS; f++) {
    step();
    const s = runningPlays().find((x) => x.id === 'handshake');
    if (!s) continue;
    shook = true;
    if (scene.home) homeDuringGrip = true;
    if (s.phase === 1 && s.beat - s.mark >= 0.1) {
      gripFrames++;
      worst = Math.max(worst, gapRig(s.bot(0), s.side[0], s.bot(1), s.side[1]));
    }
  }
  assert.ok(shook, 'the consultation shook on it');
  assert.ok(gripFrames > 10, `gripped ${gripFrames} frames`);
  assert.ok(worst < 0.0015, `the grip came apart while the heads went home: ${(worst * 1000).toFixed(2)} mm of rig`);
  console.log(`consultation handshake: grip held ${gripFrames} frames (worst gap ${(worst * 1000).toFixed(2)} mm of rig${homeDuringGrip ? ', the scene sent the heads home meanwhile' : ''})`);
  assert.ok(a.group.position.equals(a.home) && b.group.position.equals(b.home), 'the bots keep their marks');
  assert.ok(a.playOffset.length() < 1e-3 && b.playOffset.length() < 1e-3, 'the heads are handed back');
}

// ------------------------------------------------------------------ 9. a making-of duet's seal still meets (the pair side by side, stepped down)

{
  const { Acting } = await import('./src/acting.js');
  const { NAMES } = await import('./src/gen/cast.js');
  const { crewFormation, SEALS } = await import('./src/making-of-score.js');
  const homes = crewFormation(NAMES);
  const touched = [];
  for (const [i, seal] of SEALS.entries()) {
    // a far pair and a near one, either way round (the visitor from its left or right)
    const [va, ho] = [['Gray', 'Yellow'], ['Pink', 'Green'], ['Yellow', 'Gold'], ['White', 'Blue']][i];
    resetPlays();
    const bots = new Map();
    NAMES.forEach((n, k) => {
      const b = new Bot(n, new THREE.Vector3(...homes.get(n)), k);
      b.viewer = VIEWER;
      bots.set(n, b);
    });
    const acting = new Acting();
    const ctx = { time: 0, beatSec: 0.625, playing: true, bots, viewer: VIEWER };
    let t = 0;
    const step = () => {
      t += DT;
      ctx.time = t;
      acting.update(DT, bots, ctx);
      updatePlays(DT, ctx);
      bots.forEach((b) => b.update(DT, t, ctx));
    };
    for (let f = 0; f < 15; f++) step();
    const a = bots.get(va), b = bots.get(ho);
    acting.duet(a, b, 12);
    for (let f = 0; f < 3 * FPS; f++) step();
    assert.ok(startPlay(seal.play, a, [b], ctx), `${seal.play} plays after the duet`);
    const s = runningPlays().find((x) => x.id === seal.play);
    let closest = Infinity;
    for (let f = 0; f < 8 * FPS && runningPlays().includes(s); f++) {
      step();
      closest = Math.min(closest, Math.abs(meet(s.bot(0), s.side[0], s.bot(1), s.side[1]).closest));
    }
    assert.ok(closest < 0.003, `${seal.play} (${va} + ${ho}): the hands ${mm(closest)} apart at best`);
    touched.push(`${seal.play} ${mm(closest)}`);
  }
  console.log(`making-of seals after a duet: ${touched.join(', ')}`);
}

console.log(`plays ok: ${Object.keys(CATALOG).length} of ${PLAY_PRIORITY.length} priority plays ported and run`);
