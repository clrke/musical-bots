// A second Premiere / Live while one is loading: the newest wins, the older one stands down.
import assert from 'node:assert/strict';
import { Choir } from './src/audio.js';
import { createMakingOf, directorApi } from './src/making-of.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- Choir.prepare: an older prepare finishing last must not write its lines over the newer episode's
{
  const choir = new Choir();
  choir.ctx = { state: 'running', createBuffer: (ch, n, sr) => ({ n, sr, copyToChannel() {} }) };
  const gates = [];
  choir.pool = { render: (job) => new Promise((resolve) => gates.push({ job, go: () => resolve({ pcm: new Float32Array(4), sampleRate: 48000, startOffset: 0, syllableTimes: [{ t0: 0, t1: 1 }], job }) })) };
  const plan = (seq, who) => ({ seq, at: 0, bars: 1, job: { voice: who } });
  const a = choir.prepare([], { lines: [plan(1, 'A'), plan(2, 'A')] });
  const b = choir.prepare([], { lines: [plan(1, 'B')] });
  await tick();
  gates.filter((g) => g.job.voice === 'B').forEach((g) => g.go());
  await b;
  gates.filter((g) => g.job.voice === 'A').forEach((g) => g.go());
  await a;
  assert.equal(choir.lines.size, 1, 'the stale episode added no lines');
  assert.equal(choir.lines.get(1).plan.job.voice, 'B', 'seq 1 sings the newer episode');
  // a LIVE append on the current episode still lands
  const c = choir.prepare([], { append: true, lines: [plan(3, 'B')] });
  await tick();
  gates.at(-1).go();
  await c;
  assert.equal(choir.lines.size, 2);
}

// ---- the making-of: a Premiere pressed (cancel) while Live loads its recorded bundle stands it down
{
  globalThis.document = { body: { classList: { add() {}, remove() {}, toggle() {} } } };
  globalThis.window = {};
  let release;
  let lived = 0;
  const player = { events: [], cursor: 0, live: () => { lived++; }, load: () => { lived++; }, play() {}, stopLive() {}, liveDone: false };
  const m = createMakingOf({
    player, choir: { start: async () => {}, begin() {}, prepare: async () => 0, setVamp() {} }, el: null, captionEl: null,
    episodeFor: () => new Promise((r) => { release = () => r({ events: [{ t: 0 }], beats: null }); }),
  });
  globalThis.fetch = async () => ({ ok: false });
  const p = m.start('Blue brings home the biggest toy box on the street');
  await tick();
  m.cancel(); // the Premiere button
  release();
  await p;
  assert.equal(m.active, null, 'no making-of after the cancel');
  assert.equal(lived, 0, 'the player was not taken over');
  // without a cancel it does start
  const q = m.start('Blue brings home the biggest toy box on the street');
  await tick();
  release();
  await q;
  assert.equal(lived, 1);
  assert.equal(m.active?.kind, 'replay');
  m.cancel();
}

// ---- the director: the dev server's, or the hosted one (the Vercel deployment: `hosted`); a plain static host's 404 or
// HTML page is no director (a new prompt falls back to the offline generator). Only a new prompt's Make it probes.
{
  const json = (body) => async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => body });
  assert.deepEqual(await directorApi(json({ available: true })), { available: true });
  assert.deepEqual(await directorApi(json({ available: true, hosted: true })), { available: true, hosted: true });
  assert.equal(await directorApi(json({ available: false })), null, 'a hosted director without its settings');
  assert.equal(await directorApi(async () => ({ ok: true, headers: { get: () => 'text/html' }, json: async () => { throw new Error('html'); } })), null);
  assert.equal(await directorApi(async () => ({ ok: false, status: 404, headers: { get: () => 'text/plain' } })), null);
  assert.equal(await directorApi(async () => { throw new Error('offline'); }), null);
}
console.log('premiere race ok');
