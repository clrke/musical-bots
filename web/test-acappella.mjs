// The making-of a cappella, the typed opening's keyboard, and Play (owner, Nov 1), headless on a fake AudioContext:
//   1. a recorded making-of (hackathon-win, as the app replays it) schedules only sung lines: no oscillator, no noise,
//      no buffer that is not a voice render, from its first bar to its end (the home chord rung, sung); every line a
//      voice job on the score's grid; the backing (the chords) sung by the crew;
//   2. the typed opening's keystrokes (keys.js): one a letter, the space bar its own, a heavier Enter at the press,
//      a few ms after each letter's moment, seeded (the same every run) yet varied; rendered through the master
//      (Mute mutes them);
//   3. Play (making-of.js skip): shown only once the episode is ready (a recorded making-of as it plays; a live one
//      only once the director is done), it stops the making-of's voices (the lines scheduled ahead too), clears its
//      stage and plays the premiere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Choir } from './src/audio.js';
import { scoreMakingOf } from './src/making-of-score.js';
import { keystrokes, playStroke, seeded } from './src/keys.js';
import { typingPlan, INTRO_SECONDS } from './src/staging.js';
import { parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { VOICES } from './src/mv/voice/voice.js';

globalThis.window ??= {};
const { vampOf, createMakingOf, readyToPlay } = await import('./src/making-of.js');

// ---- a fake AudioContext: every node it makes, by kind
function fakeContext() {
  const made = { osc: 0, src: [], buffers: new Set(), gains: [] };
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => ({ outs: [], connect(n) { this.outs.push(n); return n; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: node(), made,
    resume: async () => {},
    createGain() { const g = node({ gain: param(1) }); made.gains.push(g); return g; },
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param(), gain: param() }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createConvolver: () => node({ buffer: null }),
    createStereoPanner: () => node({ pan: param() }),
    createOscillator() { made.osc++; return node({ type: '', frequency: param(), start() {}, stop() {} }); },
    createBufferSource() {
      const s = node({ buffer: null, started: null, stopped: null, start(t) { this.started = t; }, stop(t) { this.stopped = t; } });
      made.src.push(s);
      return s;
    },
    createBuffer(ch, n, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(n));
      return { numberOfChannels: ch, length: n, sampleRate: sr, duration: n / sr, getChannelData: (c) => data[c], copyToChannel(pcm, c) { data[c].set(pcm.subarray(0, n)); } };
    },
  };
  return ctx;
}
/** A Choir on a fake context (its scheduler timer off: the test drives it), its voices rendered by a fake pool. */
async function fakeChoir() {
  const ctx = fakeContext();
  globalThis.window.AudioContext = function () { return ctx; };
  const choir = new Choir();
  await choir.start();
  clearInterval(choir._timer);
  const voiceBuffers = new Set();
  const create = ctx.createBuffer.bind(ctx);
  choir.pool = { render: async (job) => ({ pcm: new Float32Array(480), sampleRate: 48000, startOffset: 0, syllableTimes: job.notes?.map((n) => ({ t0: n.t, t1: n.t + n.dur })) ?? [{ t0: 0, t1: 0.5 }], job }) };
  // (the buffers prepare() makes from the renders are the voices; any other buffer source would be an instrument)
  ctx.createBuffer = (ch, n, sr) => { const b = create(ch, n, sr); if (n === 480) voiceBuffers.add(b); return b; };
  return { ctx, choir, voiceBuffers };
}

const root = new URL('../episodes/', import.meta.url);
const slug = 'hackathon-win';
const events = parseNdjson(readFileSync(new URL(`${slug}/events.ndjson`, root), 'utf8'));
const beats = modernBundle(JSON.parse(readFileSync(new URL(`${slug}/beats.json`, root), 'utf8')));
const activity = readFileSync(new URL(`${slug}/activity.ndjson`, root), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const production = JSON.parse(readFileSync(new URL(`${slug}/director.json`, root), 'utf8')).wallSeconds;

// 1. a cappella -----------------------------------------------------------------------------------------------
{
  const score = scoreMakingOf(events, beats, { production, activity });
  // every line is sung: a voice of the cast singing notes (syllables), the backing among them, holding the chords
  for (const l of score.lines) {
    assert.ok(l.job && VOICES[l.job.voice] && l.job.notes?.length, `line ${l.seq} (${l.role ?? l.layer}) is a voice singing notes`);
    assert.ok(l.bot, `line ${l.seq} has a singer`);
  }
  const backing = score.lines.filter((l) => l.layer === 'backing');
  assert.ok(backing.length > 20, `${backing.length} sung backing runs`);
  assert.ok(new Set(backing.map((l) => l.role)).size >= 3, 'the backing sings several parts (pads, root, bass)');
  // the backing covers the song: most bars from the first to the end have a sung chord under them
  const bars = Math.round(score.end / score.bar);
  const sungBars = new Set(backing.flatMap((l) => l.cells.map((c) => c.bar)));
  assert.ok(sungBars.size / (bars - score.startBar) > 0.85, `${sungBars.size}/${bars - score.startBar} bars carry a sung chord`);
  assert.ok(sungBars.has(bars - 1), 'the home chord rings at the end, sung');

  const { ctx, choir, voiceBuffers } = await fakeChoir();
  await choir.prepare(score.staged, { lines: score.lines });
  assert.equal(choir.lines.size, score.lines.length, 'every line rendered');
  const before = { osc: ctx.made.osc, src: ctx.made.src.length };
  choir.setVamp(vampOf(score));
  choir.setChords(['C', 'G', 'Am', 'F']); // (chords on the stage's events must not bring an instrument in either)
  choir.prepare(score.staged.slice(0, 3), { append: true }); // (the player's own append: no lines)
  choir.begin();
  const staged = [...score.staged].sort((a, b) => a.t - b.t);
  let k = 0;
  for (let t = 0; t <= score.end + 2; t += 0.05) {
    ctx.currentTime = choir.songStart + t;
    choir._schedule();
    while (k < staged.length && staged[k].t <= t) choir.sing(staged[k++]);
  }
  assert.equal(k, staged.length);
  assert.equal(ctx.made.osc, before.osc, 'the making-of made no oscillator (no bass, no chord, no pad)');
  const sources = ctx.made.src.slice(before.src);
  assert.ok(sources.length > 200, `${sources.length} sung segments`);
  assert.ok(sources.every((s) => voiceBuffers.has(s.buffer)), 'every buffer the making-of played is a voice render (no shaker, no noise, no drum)');
  // no percussive helper left on the choir
  for (const name of ['_groove', '_shake', '_tone', '_vampEnd', '_vampBus']) assert.equal(typeof choir[name], 'undefined', `Choir.${name} is gone`);

  // hush (Play, a Premiere over it): every line still to sound stops, the ones scheduled ahead too
  const { ctx: c2, choir: ch2 } = await fakeChoir();
  await ch2.prepare(score.staged, { lines: score.lines });
  ch2.setVamp(vampOf(score));
  ch2.begin();
  const backRun = staged.find((e) => e.part === 'backing' && ch2.lines.get(e.seq)?.segments.length > 3);
  c2.currentTime = ch2.songStart + backRun.t;
  ch2.sing(backRun);
  const ahead = c2.made.src.filter((s) => s.started > c2.currentTime + 1);
  assert.ok(ahead.length >= 2, 'a backing run schedules its later bars ahead');
  ch2.hush();
  assert.ok(c2.made.src.every((s) => s.stopped !== null && s.stopped <= c2.currentTime + 0.1), 'hush stops every scheduled line');
  assert.equal(ch2.songStart, null);
}

// 2. the typed opening's keyboard ------------------------------------------------------------------------------
{
  const text = 'Blue brings home the biggest toy box on the street';
  const plan = typingPlan(text.length);
  const ks = keystrokes(text, plan);
  assert.equal(ks.length, text.length + 1, 'a stroke a letter, and Enter');
  assert.deepEqual(ks.map((k) => k.kind), [...text].map((c) => (c === ' ' ? 'space' : 'key')).concat('enter'));
  ks.slice(0, -1).forEach((k, i) => {
    const shown = plan.start + i * plan.step;
    assert.ok(k.t >= shown && k.t - shown < 0.02, `stroke ${i} lands with its letter (${(k.t - shown).toFixed(4)} s after)`);
    assert.equal(plan.typed(k.t), i + 1, `letter ${i} shows when its key sounds`);
  });
  assert.ok(ks.at(-1).t >= plan.pressAt && ks.at(-1).t < plan.pressAt + 0.02 && plan.pressed(ks.at(-1).t), 'Enter as the button goes down');
  assert.ok(ks.at(-1).t + ks.at(-1).up <= INTRO_SECONDS, 'its upstroke before the opening ends');
  assert.deepEqual(keystrokes(text, plan), ks, 'seeded: the same every run (a frame-exact capture)');
  const keys = ks.filter((k) => k.kind === 'key');
  assert.ok(new Set(keys.map((k) => k.pitch.toFixed(3))).size > keys.length * 0.8, 'the keys vary in pitch');
  assert.ok(keys.every((k) => k.pitch > 0.85 && k.pitch < 1.15 && k.gain > 0.7 && k.gain < 1.2), 'slightly');
  assert.ok(Math.abs(seeded(1)() - seeded(1)()) < 1e-12);
  // rendered on the choir's clock, into its master (Mute: the master's gain 0)
  const { ctx, choir } = await fakeChoir();
  const src0 = ctx.made.src.length;
  ctx.currentTime = 10;
  assert.equal(choir.typeKeys(ks, 10), ks.length);
  const strokes = ctx.made.src.slice(src0);
  assert.ok(strokes.length >= ks.length * 4 && ctx.made.osc >= ks.length, "a tick, a body, a thud and the upstroke a stroke");
  assert.ok(strokes.every((s) => s.started >= 10 && s.started < 10 + INTRO_SECONDS), 'within the opening');
  // (each stroke's chain ends in the keyboard's bus, which feeds the dry bus to the master)
  const reaches = (n, target, depth = 0) => n === target || (depth < 8 && n.outs.some((o) => reaches(o, target, depth + 1)));
  assert.ok(strokes.every((s) => reaches(s, choir.keys)) && reaches(choir.keys, choir.master), 'through the master');
  choir.setMuted(true);
  assert.equal(choir.master.gain.value, 0, 'Mute mutes the keyboard too');
  // the space bar and Enter are heavier strokes than a letter
  const count = (kind) => { const c = fakeContext(); playStroke(c, c.createGain(), 0, { kind, pitch: 1, gain: 1, up: 0.07 }); return c.made.src.length + c.made.osc; };
  assert.ok(count('space') > count('key') && count('enter') > count('key'));
}

// 3. Play: the making-of skipped once the episode is ready ---------------------------------------------------
{
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const classes = new Set();
  globalThis.document = { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle() {} } } };
  globalThis.fetch = async () => ({ ok: false, headers: { get: () => '' } });
  const playEl = { hidden: true, cls: new Set(), classList: { contains(c) { return playEl.cls.has(c); }, toggle(c, on) { if (on) playEl.cls.add(c); else playEl.cls.delete(c); } } };
  const log = [];
  const player = { events: [], time: 0, finished: false, liveDone: false, load() {}, play() { log.push('play'); }, pause() { log.push('pause'); }, stopLive() { log.push('stopLive'); }, live() {}, endLive: async () => {} };
  const choir = { start: async () => {}, begin() {}, prepare: async () => 0, setVamp() {}, hush() { log.push('hush'); } };
  let premiered = null, release;
  const bundle = { events, beats };
  const m = createMakingOf({
    player, choir, el: null, captionEl: null, playEl,
    episodeFor: () => new Promise((r) => { release = () => r(bundle); }),
    stopStage: () => log.push('stopStage'),
    onPremiere: (ev, bt) => { premiered = { ev, bt }; },
  });
  assert.equal(m.skip(), false, 'nothing to skip');
  const p = m.start('The bots join the Meta Global AI Hackathon and win!');
  await tick();
  assert.equal(m.ready, false, 'not ready while the bundle loads');
  release();
  await p;
  if (m.active) {
    assert.equal(m.active.kind, 'replay');
    assert.equal(m.ready, true, 'a recorded making-of: ready as it plays');
    assert.ok(!playEl.hidden && playEl.cls.has('ready'), 'the Play button shows');
    assert.equal(m.skip(), true);
    await tick();
    assert.ok(['hush', 'pause', 'stopLive', 'stopStage'].every((x) => log.includes(x)), `the making-of stopped (${log})`);
    assert.equal(premiered?.ev, events, 'the premiere plays the episode');
    assert.equal(m.active, null);
    assert.ok(playEl.hidden && !playEl.cls.has('ready'), 'the Play button goes');
    assert.equal(m.skip(), false, 'once');
  } else assert.fail('the hackathon prompt is curated: it replays its making-of');

  // live: never before the director is done (poll: planning, working, then done or failed)
  const live = { kind: 'live', playing: true, state: 'planning' };
  for (const state of ['planning', 'working', 'failed']) assert.equal(readyToPlay({ ...live, state }), false, `live, ${state}: no Play`);
  assert.equal(readyToPlay({ ...live, state: 'done' }), true, 'live, done: Play');
  assert.equal(readyToPlay({ ...live, state: 'done', finishing: true }), false, 'not once it goes to the premiere');
  assert.equal(readyToPlay({ kind: 'replay', playing: false }), false, 'a replay still preparing its voices: no Play');
}
console.log('a cappella ok: the making-of sings only voices (no oscillator, no noise, no drum), the keyboard clacks, Play skips when ready');
