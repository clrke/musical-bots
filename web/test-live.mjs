// LIVE without a browser or a model:
//   1. the player's LIVE pacing: a recorded making-of replayed on its authoring timeline, bursts
//      staged one after another, the authoring time kept as `at`, the end detected; a half-written
//      NDJSON line is ignored until it is complete;
//   2. the making-of's score live (making-of-score.js): the role bot performs its own work as it lands (Green sings
//      his line, White her thought in the team's "we", on the bar grid), staged through the player's score hook;
//   3. the dev middleware (scripts/director/live.js) driving the real orchestrator against the stub
//      Muse: POST starts a run (one at a time), the status walks planning -> working -> done, the
//      growing bundle is served no-cache, bad requests are refused.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { Player, parseNdjson } from './src/player.js';
import { MakingOfScore } from './src/making-of-score.js';
import { directorMiddleware } from '../scripts/director/live.js';

// 1. pacing ---------------------------------------------------------------------------------------
{
  const rec = [
    { seq: 0, t: 10, bot: 'White', agent: 'chords', summary: 'White sets the key', lyric: '', chords: ['C'], action: 'conductor', consult: [] },
    { seq: 1, t: 30, bot: 'Green', agent: 'lyrics', summary: 'Green writes', lyric: 'Steam on a frosty street >> Brr!', chords: [], action: '', consult: [], singer: 'Gold' },
    { seq: 2, t: 30, bot: 'Green', agent: 'lyrics', summary: 'Green writes', lyric: '{Gold} stirs a giant pot', chords: [], action: '', consult: [] },
    { seq: 3, t: 31, bot: 'Blue', agent: 'lighting', summary: 'Blue paints it blue', lyric: '', chords: [], action: 'lights-cool', consult: [] },
  ];
  const staged = [];
  const p = new Player({ onEvent: (e) => staged.push({ seq: e.seq, at: p.time }) });
  await p.live(rec, { lead: 1, gapOf: () => 3, speed: 2 });
  for (let i = 0; i < 400; i++) p.tick(0.05);
  assert.ok(p.liveDone, 'a replay ends once everything has arrived and played');
  assert.deepEqual(staged.map((s) => s.seq), [0, 1, 2, 3]);
  const ts = p.events.map((e) => e.t);
  assert.equal(ts[0], 1, 'the first arrival plays after the lead');
  assert.ok(ts[1] >= 10 + 1 - 1e-9, 'authoring t 30 arrives at 10 (speed 2) + lead');
  assert.equal(ts[2], ts[1] + 3, 'a burst is paced by gapOf');
  assert.equal(ts[3], ts[2] + 3);
  assert.deepEqual(p.events.map((e) => e.at), [10, 30, 30, 31], 'the authoring time stays on the event');
  // the making-of's score through the same LIVE hook: Green sings his line (plain words, the markup kept for the
  // cues, for Gold to sing in the premiere), White her thought in the team's "we"; nothing in the past, all in order
  const score = new MakingOfScore({ live: true });
  const sp = new Player({ onEvent: () => {} });
  await sp.live(rec, { speed: 2, score: { add: (r, now) => score.add(r, now), flush: (now) => score.flush(now) } });
  for (let i = 0; i < 4000 && !(sp.liveDone && sp.time >= score.end); i++) sp.tick(0.05);
  assert.ok(sp.liveDone, 'the scored stream ends');
  const line = sp.events.find((e) => e.kind === 'line');
  assert.equal(line.lyric, 'Steam on a frosty street');
  assert.equal(line.line, rec[1].lyric);
  assert.equal(line.bot, 'Green', 'the making-of: the role bot performs');
  assert.equal(line.singsFor, 'Gold');
  assert.equal(sp.events.find((e) => e.bot === 'White').lyric, 'We set the key', 'the thought in the team\'s voice, "we"');
  assert.ok(sp.events.every((e, i) => i === 0 || e.t >= sp.events[i - 1].t), 'staged in order');
  assert.ok(score.lines.every((l) => l.at >= 1.5 - 1e-6), 'each voice has a lead to render');
  // a half-written last line is ignored until complete
  assert.equal(parseNdjson('{"seq":0}\n{"seq":1}\n{"se').length, 2);
  assert.throws(() => parseNdjson('{"seq":0}\n{bad}\n{"seq":2}\n'));
}

// 2. the middleware -------------------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), 'mb-live-'));
const STUB = new URL('../scripts/director/stub-muse.js', import.meta.url).pathname;
const VALIDATE = new URL('../scripts/validate-bundle.js', import.meta.url).pathname;
const mw = directorMiddleware({ root, args: ['--muse', STUB, '--stall', '20', '--timeout', '120'], env: { MB_EMIT_LINGER_S: '1', MB_EMIT_WAIT_S: '4' } });
function call(method, url, body = null) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url });
  return new Promise((ok) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b = '') { ok({ status: this.statusCode, headers: this.headers, body: String(b) }); } };
    mw(req, res, () => ok({ status: 'next' }));
  });
}
const j = (r) => JSON.parse(r.body);
assert.equal((await call('GET', '/index.html')).status, 'next', 'other paths pass through');
assert.equal(j(await call('GET', '/api/direct')).available, true);
assert.equal((await call('POST', '/api/direct', { prompt: '' })).status, 400);
const started = await call('POST', '/api/direct', { prompt: 'Gold sells hot soup on a cold day' });
assert.equal(started.status, 202);
const run = j(started);
assert.equal(run.slug, 'gold-sells-hot-soup-on-a-col');
assert.equal(run.events, `/api/direct/${run.slug}/events.ndjson`);
const busy = await call('POST', '/api/direct', { prompt: 'Another one' });
assert.equal(busy.status, 409, 'one run at a time');
assert.equal(j(busy).slug, run.slug);
assert.equal((await call('GET', '/api/direct/..%2Fetc')).status, 400);
const states = new Set();
let s;
for (let i = 0; i < 240; i++) {
  s = j(await call('GET', `/api/direct/${run.slug}`));
  states.add(s.state);
  if (s.state === 'done' || s.state === 'failed') break;
  if (s.state === 'working') {
    const ev = await call('GET', run.events);
    assert.equal(ev.headers['cache-control'], 'no-store');
    parseNdjson(ev.body); // the growing bundle parses at any moment
  }
  await new Promise((r) => setTimeout(r, 250));
}
assert.equal(s.state, 'done', `the run: ${JSON.stringify(s.log)}`);
assert.ok(states.has('working'), 'the status shows the crew at work');
assert.equal(s.title, 'Hot Soup');
assert.equal(s.director.gate.ok, true);
const final = parseNdjson((await call('GET', run.events)).body);
assert.equal(final.length, s.events);
assert.equal(j(await call('GET', `/api/direct/${run.slug}/beats.json`)).version, 2);
execFileSync(process.execPath, [VALIDATE, join(root, run.slug)]);
assert.equal((await call('GET', `/api/direct/${run.slug}/secret.txt`)).status, 404);
console.log(`live ok: paced replay, the making-of's live score, middleware run (${[...states].join(' -> ')}, ${final.length} events)`);
