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
  const bot = new Bot('Green', new THREE.Vector3(0, 1, 0), 7);
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
  const bot = new Bot('Green', new THREE.Vector3(0, 1, 0), 7);
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

// 2c. the card comes up CARD_SHOW_LEAD before the first note, not with the event (QA v22: a bar-line cut caught the
// next line's card 0.4 s early); the line before stays on the card until then, and a line cleared before it never shows
{
  const { CARD_SHOW_LEAD, CARD_LEAD } = await import('./src/sing-plan.js');
  assert.ok(CARD_SHOW_LEAD > 0 && CARD_SHOW_LEAD <= 0.15 && CARD_SHOW_LEAD < CARD_LEAD, `${CARD_SHOW_LEAD}`);
  const bot = new Bot('Green', new THREE.Vector3(0, 1, 0), 7);
  const syllables = [{ t0: 0, t1: 0.4 }, { t0: 0.5, t1: 0.9 }];
  let t = 0;
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) bot.update(1 / 60, (t += 1 / 60)); };
  const text = () => bot.head.card.text;
  bot.sing(2.2, 'first line here', { delay: CARD_LEAD, length: 1, syllables });
  assert.equal(text(), '', 'no card at the event');
  run(CARD_LEAD - CARD_SHOW_LEAD - 0.05);
  assert.equal(text(), '', 'no card before its lead');
  assert.equal(bot.head.card.opacity, 0);
  run(0.1);
  assert.equal(text(), 'first line here', 'the card is up before the first note');
  run(1.2);
  bot.sing(2.2, 'second line now', { delay: CARD_LEAD, length: 1, syllables });
  run(0.2);
  assert.equal(text(), 'first line here', 'the line before stays until the next card is due');
  run(CARD_LEAD - 0.2);
  assert.equal(text(), 'second line now');
  bot.sing(2.2, 'never shown', { delay: CARD_LEAD, length: 1, syllables });
  bot.sing(1, '');
  run(1);
  assert.equal(text(), '', 'a line cleared before its card never shows');
  // a line without voice timing shows at once
  bot.sing(2, 'la wah father');
  assert.equal(text(), 'la wah father');
}

// 3. social moves step without NaN: a consultation, then the real hand plays (plays/) on two bots, with the song clock
{
  const { startPlay, updatePlays, resetPlays } = await import('./src/plays/index.js');
  resetPlays();
  const a = new Bot('Gray', new THREE.Vector3(-1, 1, 0), 0);
  const b = new Bot('White', new THREE.Vector3(1, 1, 0), 1);
  a.consult(b);
  for (let f = 0; f < 120; f++) { a.update(1 / 60, f / 60); b.update(1 / 60, f / 60); }
  finite3(a.group.position, 'consult a');
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots: new Map([['Gray', a], ['White', b]]), viewer: new THREE.Vector3(0, 1.6, 7) };
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
  const c = new Bot('Gold', new THREE.Vector3(0, 1, 0), 3);
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
  const bots = ['Gray', 'White', 'Gold', 'Pink'].map((n, i) => new Bot(n, new THREE.Vector3(i * 2 - 3, 1, 0), i));
  const hug = ringTargets(new THREE.Vector3(0, 1, 0), 0.9, 4);
  bots.forEach((b, i) => b.walkTo(hug[i]));
  for (let f = 0; f < 600; f++) bots.forEach((b) => b.update(1 / 60, f / 60));
  bots.forEach((b, i) => {
    finite3(b.group.position, 'huddle');
    assert.ok(b.group.position.distanceTo(hug[i]) < 0.05, 'huddle did not converge');
  });
}
// 7. a lyric card moves CARD_MAX_STEP (0.05 m) a frame at most, off its head: a snap of the layout, a fade-in, a cut that
// turns it round its head to face the new camera (owner, Nov 5: "A lyric box should not be able to move more than 0.05m
// at a time")
{
  const { CARD_MAX_STEP } = await import('./src/scene/robot-head.js');
  const bot = new Bot('Gold', new THREE.Vector3(0, 1, 0), 3);
  const off = () => { const p = new THREE.Vector3(); bot.head.cardObject.getWorldPosition(p); const h = new THREE.Vector3(); bot.head.group.getWorldPosition(h); return p.sub(h); };
  let t = 0, worst = 0, prev = null;
  const frame = (viewer) => { bot.update(1 / 60, (t += 1 / 60), viewer ? { viewer } : undefined); const o = off(); if (prev && bot.head.cardObject.visible !== false) { const d = o.distanceTo(prev); if (d > worst) { worst = d; if (process.env.DBG) console.log('frame', Math.round(t * 60), d.toFixed(3), o.toArray().map((v) => v.toFixed(2)), bot.head.card.opacity.toFixed(2)); } } prev = o; };
  bot.sing(4, 'la wah father la wah father');
  for (let f = 0; f < 60; f++) frame(); // (the card comes up where it belongs: measured from here on)
  prev = off(); worst = 0;
  bot.head.setCardShift(-3, -2, false, 'snap'); // the layout's snap: far off at once
  for (let f = 0; f < 120; f++) frame();
  bot.head.setCardShift(0, 0, false, 'snap');
  for (let f = 0; f < 120; f++) frame();
  assert.ok(worst <= CARD_MAX_STEP + 1e-6, `a lyric card moved ${worst.toFixed(3)} m in one frame (at most ${CARD_MAX_STEP})`);
  assert.ok(worst > 0.01, `the card did move (${worst.toFixed(3)} m a frame at most)`);
}
console.log('rig ok: 16 cast looks, lyric captions + progress, social moves, hand plays, song clock, walk, a lyric card 0.05 m a frame at most');
