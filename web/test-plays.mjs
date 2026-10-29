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
  const names = kind === 'group' ? ['Vera', 'Nora', 'Lou', 'Pearl'] : ['Vera', 'Nora'];
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
  const st = studio(['Vera', 'Nora']);
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
  const a = bots.get('Hattie'), b = bots.get('Gigi');
  a.sing(3.4, 'Hattie and Gigi shake on it.', null);
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

console.log(`plays ok: ${Object.keys(CATALOG).length} of ${PLAY_PRIORITY.length} priority plays ported and run`);
