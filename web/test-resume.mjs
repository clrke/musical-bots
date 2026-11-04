// Resume on the page (web/src/making-of.js, player.js), headless with a fake director (server/app.js resumeRun):
//   1. the player: a held live stream is not ended (its score not flushed), so it can go on; an ended one can't;
//   2. a hosted live run that stops and may go on: its stream held, the banner says why, Resume shows; Resume (a byok
//      run's key asked for again, a credit run's cookie) goes on with the same making-of, polled again; an error is
//      said and Resume stays; resumed from another tab meanwhile, this one follows; a run that can't go on ends as before;
//   3. the status polls are never silent: misses in a row (offline, a 500, not JSON) are said and polled on, a good
//      poll clears it; a run the server no longer has (404) is said and the polling stops.
import assert from 'node:assert/strict';
import { Player } from './src/player.js';

globalThis.window ??= {};
globalThis.document = { body: { classList: { add() {}, remove() {}, toggle() {} } } };

// 1. the player -----------------------------------------------------------------------------------------------------
{
  let polls = 0, flushed = 0;
  const score = { feed: () => [], add: () => [], flush: () => { flushed++; return []; } };
  const p = new Player();
  await p.live(async () => { polls++; return { events: [], queued: [], activity: null }; }, { interval: 1e9, score });
  assert.ok(p._poll && polls === 1);
  p.holdLive();
  assert.equal(p._poll, null, 'held: not polled');
  await p.pollNow();
  assert.equal(polls, 1, 'nor when the tab is shown again');
  assert.equal(flushed, 0, 'the score is not ended');
  assert.equal(p.resumeLive(), true);
  assert.ok(p._poll, 'polled again');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(polls, 2, 'at once');
  await p.endLive();
  assert.equal(flushed, 1);
  assert.equal(p.resumeLive(), false, 'an ended stream does not go on');
  p.stopLive();
  // (held before its first poll is back: no timer of its own after it)
  let release;
  const q = new Player();
  const going = q.live(() => new Promise((ok) => { release = ok; }), { interval: 1e9, score });
  q.holdLive();
  await new Promise((r) => setTimeout(r, 0));
  release({ events: [] });
  await going;
  assert.equal(q._poll, null);
  q.stopLive();
}

// 2-3. the making-of with a fake director ------------------------------------------------------------------------------
const { createMakingOf, MISSES } = await import('./src/making-of.js');
const intervals = [];
globalThis.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
globalThis.clearInterval = () => {};
const ID = '0123456789abcdef01234567';
const KEY = 'sk-test-0123456789-resume';
const res = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
/** A making-of on a fake director: h.status is what a status poll answers (h.fail: the next polls' failures), h.answer the resume's. */
function harness({ mode = 'byok', key = KEY } = {}) {
  const h = { status: { state: 'working', title: 'Hot Soup', mode, prompt: 'Gold sells soup' }, fail: [], answer: [202, { slug: ID }], posts: [], calls: [], asked: [] };
  globalThis.fetch = async (url, o = {}) => {
    if (url === `/api/direct/${ID}/resume` && o.method === 'POST') { h.posts.push(JSON.parse(o.body)); return res(h.answer[1], h.answer[0]); }
    if (url === `/api/direct/${ID}`) {
      const f = h.fail.shift();
      if (f === 'offline') throw new TypeError('Failed to fetch');
      if (f === '500') return res({ error: 'something went wrong: try again' }, 500);
      if (f === 'html') return { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('Unexpected token <'); } };
      if (f === '404') return res({ error: 'no such run' }, 404);
      return res(h.status);
    }
    if (url.endsWith('beats.json')) return res({ version: 2, title: 'Hot Soup', beats: [] });
    return res('');
  };
  h.player = { events: [], time: 0, liveDone: false, live() { h.calls.push('live'); }, endLive: async () => { h.calls.push('end'); }, holdLive() { h.calls.push('hold'); },
    resumeLive() { h.calls.push('resume'); return true; }, stopLive() {}, pause() {}, play() {} };
  h.el = { innerHTML: '' };
  const cls = new Set();
  h.button = { hidden: true, disabled: false, classList: { contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) }, setAttribute() {} };
  h.m = createMakingOf({ player: h.player, choir: { start: async () => {}, begin() {}, prepare: async () => 0, setVamp() {}, hush() {} }, el: h.el, captionEl: null,
    resumeEl: h.button, askKey: async (info) => { h.asked.push(info); return key; } });
  return h;
}
const shown = (h) => !h.button.hidden && h.button.classList.contains('ready');
const poll = () => intervals.at(-1)();
const settle = () => new Promise((r) => setTimeout(r, 0));

// 2. a byok run stops, Resume
{
  const h = harness();
  await h.m.join(ID, { ...h.status });
  await settle();
  assert.equal(h.m.active?.kind, 'live', 'a share link of a run still going joins its live making-of');
  h.status = { ...h.status, state: 'failed', reason: 'the sandbox died', canResume: true, resumes: 0 };
  await poll();
  assert.deepEqual(h.calls, ['live', 'hold'], 'stopped, and may go on: the stream held, not ended');
  assert.ok(shown(h), 'Resume shows');
  assert.match(h.el.innerHTML, /the director stopped: the sandbox died · Resume picks it up where it stopped/);
  // an error: said in the banner, Resume stays
  h.answer = [503, { error: 'the director is busy with 2 runs: try again in a few minutes', busy: true }];
  assert.equal(await h.m.resume(), false);
  assert.deepEqual([h.asked.length, h.asked[0].reason, h.posts.at(-1)], [1, 'the sandbox died', { key: KEY }], "a byok run's key, asked for again and sent");
  assert.match(h.el.innerHTML, /not resumed: the director is busy with 2 runs/);
  assert.ok(shown(h) && !h.button.disabled, 'Resume stays');
  // resumed: the same making-of goes on, polled again
  h.answer = [202, { slug: ID }];
  intervals.length = 0;
  assert.equal(await h.m.resume(), true);
  assert.deepEqual(h.calls, ['live', 'hold', 'resume'], 'the same stream goes on');
  assert.equal(intervals.length, 1, 'the director is polled again');
  assert.ok(!shown(h), 'Resume goes');
  h.status = { ...h.status, state: 'working', phase: 'installing', reason: null, canResume: false, resumes: 1 };
  await poll();
  assert.match(h.el.innerHTML, /resuming: a fresh sandbox is installing Muse Code/);
  h.status = { ...h.status, state: 'done', phase: 'directing', director: { gate: { ok: true } }, exit: 0 };
  await poll();
  assert.equal(h.calls.at(-1), 'end', 'done: the stream ends, the premiere follows');
  h.m.cancel();
}
// a cancelled key: nothing sent; a credit run: the cookie, no key; resumed from another tab: this one follows
{
  const h = harness({ key: null });
  h.status = { ...h.status, state: 'failed', reason: 'stopped', canResume: true };
  await h.m.join(ID, { ...h.status });
  await settle();
  assert.equal(await h.m.resume(), false);
  assert.deepEqual([h.asked.length, h.posts.length], [1, 0], 'cancelled: nothing sent');
  assert.ok(shown(h));
  h.m.cancel();
  const c = harness({ mode: 'credits' });
  c.status = { ...c.status, state: 'failed', reason: 'stopped', canResume: true };
  await c.m.join(ID, { ...c.status });
  await settle();
  c.answer = [409, { error: 'the run is still going' }];
  c.status = { ...c.status, state: 'working', canResume: false };
  assert.equal(await c.m.resume(), true, 'resumed elsewhere meanwhile: followed');
  assert.deepEqual([c.asked.length, c.posts], [0, [{}]], 'a credit run: no key');
  assert.equal(c.calls.at(-1), 'resume');
  c.m.cancel();
}
// a run that can't go on (resumed three times, or not the page's to resume): it ends as before, no Resume
{
  const h = harness();
  h.status = { ...h.status, state: 'failed', reason: 'stopped: over the 40-minute limit', canResume: false, resumes: 3 };
  await h.m.join(ID, { ...h.status });
  await settle();
  assert.equal(h.calls.at(-1), 'end');
  assert.ok(!shown(h));
  assert.match(h.el.innerHTML, /the director stopped: stopped: over the 40-minute limit</);
  h.m.cancel();
}

// 3. never silent
{
  const h = harness();
  await h.m.join(ID, { ...h.status });
  await settle();
  h.fail = ['offline', '500'];
  for (let i = 0; i < MISSES - 1; i++) await poll();
  assert.doesNotMatch(h.el.innerHTML, /lost contact/, 'a hiccup or two: not said');
  h.fail = ['html'];
  await poll();
  assert.match(h.el.innerHTML, /lost contact with the director: retrying…/, `${MISSES} in a row: said`);
  await poll();
  assert.doesNotMatch(h.el.innerHTML, /lost contact/, 'a good poll: cleared');
  assert.match(h.el.innerHTML, /the crew sings its thinking as it writes/);
  h.fail = Array(MISSES).fill('404');
  for (let i = 0; i < MISSES; i++) await poll();
  assert.match(h.el.innerHTML, /the run is gone/);
  assert.equal(h.calls.at(-1), 'end', 'gone: the polling stops, the stream ends');
  h.m.cancel();
}

console.log('resume ok: a held live stream goes on (an ended one does not), Resume on a stopped hosted run (the key asked again, errors said, followed when resumed elsewhere), polls never silent');
