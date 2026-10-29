// Headless checks for the Bot rig: cast looks reach the head, lyric lines drive
// non-blank captions + integer syllable progress, the singing envelope responds.
import assert from 'node:assert/strict';
import * as THREE from 'three';

// --- minimal DOM stub (the lyrics panel draws captions on a 2D canvas;
// particle textures never load headless, so Image stays pending forever)
const fillTexts = [];
function stub2d() {
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return () => ({ width: 12 });
      if (p === 'fillText') return (text) => { fillTexts.push(String(text)); };
      return () => undefined;
    },
    set() { return true; },
  });
}
globalThis.document = {
  baseURI: 'http://localhost/',
  createElement: (tag) => {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, style: {}, getContext: () => stub2d() };
  },
};
globalThis.Image = class { set src(v) { /* never loads headless */ } };

const { Bot, ringTargets } = await import('./src/rig.js');
const { CAST16 } = await import('./src/cast16.js');
const { normalizeAppearance, normalizeParticles } = await import('./src/scene/appearance.js');

const finite3 = (v, what) => {
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `${what} not finite`);
};

// 1. every cast member: the look, particles and personality reach the head,
// and each bot gets a distinct head index (own RNG stream, own names)
CAST16.forEach((m, i) => {
  const bot = new Bot(m.name, new THREE.Vector3(0, 1, 0), i);
  assert.equal(bot.head.index, i);
  assert.equal(bot.head.group.name, `robot-head-${i}`);
  const look = normalizeAppearance(m.look);
  assert.equal(bot.head.appearance.faceShape, look.faceShape, `${m.name} faceShape`);
  assert.equal(bot.head.appearance.eyeShape, look.eyeShape, `${m.name} eyeShape`);
  assert.equal(bot.head.appearance.mouthShape, look.mouthShape, `${m.name} mouthShape`);
  assert.equal(bot.head.particles.preset, normalizeParticles(m.fx).preset, `${m.name} fx`);
  assert.equal(bot.head.personality, m.personality, `${m.name} personality`);
  assert.ok(bot.unit > 0 && Number.isFinite(bot.unit), `${m.name} unit ${bot.unit}`);
});
assert.throws(() => new Bot('Nobody', new THREE.Vector3(), 0), /unknown bot/);

// 2. a lyric line drives a non-blank caption and advancing integer progress
{
  const bot = new Bot('Teddy', new THREE.Vector3(0, 1, 0), 7);
  fillTexts.length = 0;
  bot.sing(2, 'la wah father');
  assert.equal(bot.head.progress, 0);
  bot.update(1 / 60, 0);
  assert.ok(fillTexts.some((s) => s.includes('la')), `caption drew ${JSON.stringify(fillTexts)}`);
  for (let f = 1; f <= 60; f++) bot.update(1 / 60, f / 60);
  assert.equal(bot.head.progress, 2); // halfway through 4 sung syllables (la wah fa-ther)
  assert.ok(bot.head.level > 0.2, `mid-phrase level ${bot.head.level}`);
  for (let f = 61; f <= 180; f++) bot.update(1 / 60, f / 60);
  assert.equal(bot.head.progress, -1);
  assert.ok(bot.head.level < 0.05, `settled level ${bot.head.level}`);
  // an empty lyric clears instead of throwing
  bot.sing(1, '');
  assert.equal(bot.head.progress, -1);
  bot.update(1 / 60, 200);
}

// 2b. voice-engine timing: silent until the first note, then the highlight follows each syllable
{
  const bot = new Bot('Teddy', new THREE.Vector3(0, 1, 0), 7);
  const syllables = [{ t0: 0, t1: 0.4 }, { t0: 0.5, t1: 0.9 }, { t0: 1.0, t1: 1.3 }, { t0: 1.4, t1: 2.0 }];
  bot.sing(2.2, 'la wah father', { delay: 0.5, length: 2.0, syllables });
  assert.equal(bot.head.progress, -1); // the card shows, the voice has not started
  let t = 0;
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) bot.update(1 / 60, (t += 1 / 60)); };
  run(0.3);
  assert.equal(bot.head.progress, -1);
  run(0.5); // 0.8 s: 0.3 s into the line
  assert.equal(bot.head.progress, 0);
  run(0.9); // 1.7 s: 1.2 s into the line
  assert.equal(bot.head.progress, 2);
  run(1.5);
  assert.equal(bot.head.progress, -1);
}

// 3. social moves step without NaN: a consultation, then the real hand plays (plays/) on two bots, with the song clock
{
  const { startPlay, updatePlays, resetPlays } = await import('./src/plays/index.js');
  resetPlays();
  const a = new Bot('Vera', new THREE.Vector3(-1, 1, 0), 0);
  const b = new Bot('Nora', new THREE.Vector3(1, 1, 0), 1);
  a.consult(b);
  for (let f = 0; f < 120; f++) { a.update(1 / 60, f / 60); b.update(1 / 60, f / 60); }
  finite3(a.group.position, 'consult a');
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots: new Map([['Vera', a], ['Nora', b]]), viewer: new THREE.Vector3(0, 1.6, 7) };
  for (const id of ['handshake', 'high-five']) {
    assert.ok(startPlay(id, a, [b], ctx), `${id} plays`);
    for (let f = 0; f < 600; f++) {
      ctx.time += 1 / 60;
      updatePlays(1 / 60, ctx);
      a.update(1 / 60, ctx.time, ctx);
      b.update(1 / 60, ctx.time, ctx);
    }
    finite3(a.group.position, `${id} a`);
    finite3(b.group.position, `${id} b`);
    finite3(a.hands.drawn(-1).position, `${id} a hand`);
    assert.equal(a.aims.left, null, `${id}: hands handed back`);
  }
  // the song clock drives the hands' beat; without one they keep their own time
  assert.ok(Math.abs(a.beat - ctx.time / 0.625) < 1e-9 && a.beatSec === 0.625, `beat ${a.beat}`);
  a.update(1 / 60, 20, null);
  assert.equal(a.beatSec, 0);
}

// 3b. gliding swings the hands: walk rises while the bot moves and settles when it stops
{
  const c = new Bot('Lou', new THREE.Vector3(0, 1, 0), 3);
  for (let f = 0; f < 30; f++) c.update(1 / 60, f / 60);
  assert.ok(c.walk < 0.01, `standing walk ${c.walk}`);
  c.walkTo(new THREE.Vector3(2, 1, 0));
  let most = 0;
  for (let f = 0; f < 60; f++) { c.update(1 / 60, 1 + f / 60); most = Math.max(most, c.walk); }
  assert.ok(most > 0.5, `gliding walk ${most}`);
  for (let f = 0; f < 600; f++) c.update(1 / 60, 2 + f / 60);
  assert.ok(c.walk < 0.05, `arrived walk ${c.walk}`);
}

// 4. formations: ring geometry + group convergence (march / huddle)
{
  const c = new THREE.Vector3(0, 1, 0);
  const ts = ringTargets(c, 2.2, 16);
  assert.equal(ts.length, 16);
  const spots = new Set();
  for (const v of ts) {
    assert.equal(v.y, 1);
    assert.ok(Math.abs(Math.hypot(v.x - c.x, v.z - c.z) - 2.2) < 1e-9, `radius ${v.x},${v.z}`);
    spots.add(`${v.x.toFixed(6)},${v.z.toFixed(6)}`);
  }
  assert.equal(spots.size, 16);
  // 4 bots walk to a tight huddle ring and arrive together
  const bots = ['Vera', 'Nora', 'Lou', 'Pearl'].map((n, i) => new Bot(n, new THREE.Vector3(i * 2 - 3, 1, 0), i));
  const hug = ringTargets(new THREE.Vector3(0, 1, 0), 0.9, 4);
  bots.forEach((b, i) => b.walkTo(hug[i]));
  for (let f = 0; f < 600; f++) bots.forEach((b) => b.update(1 / 60, f / 60));
  bots.forEach((b, i) => {
    finite3(b.group.position, 'huddle');
    assert.ok(b.group.position.distanceTo(hug[i]) < 0.05, 'huddle did not converge');
  });
}
console.log('rig ok: 16 cast looks, lyric captions + progress, social moves, hand plays, song clock, walk');
