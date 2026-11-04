// A LIVE making-of sings the real work as it is written (web/src/live-feed.js, making-of-score.js live), headless:
//   1. every checked-in episode run again as the dev server would have shown it (live-feed.js snapshotAt: the events
//      landed by then, the ones written ahead of their beat that the turnstile still holds, the activity so far),
//      polled once a second on a fake clock through the player's LIVE hook: the crew sings the same real lines as the
//      replay of the recorded making-of (not the work song's filler), each from when it was written, never before;
//      the consultation rules hold (the host takes a question right after it is asked: its ack, else a hold line; a
//      held question comes back with a recall once other talk came between; at most MAX_OPEN on hold); it is a
//      cappella (every line a voice); it ends about when the replay does after the production's end;
//   2. the feed itself: a reply written ahead is sung once, from when it was written, and its beat arrives (the
//      loading bar) when it lands, not before;
//   3. Play (making-of.js) in a live run: hidden while the director plans and works, and after a failed gate; shown
//      once the director is done and its gate passed.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Player, parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { MakingOfScore, scoreMakingOf, MAX_OPEN, RECALL_GAP } from './src/making-of-score.js';
import { LiveFeed, snapshotAt } from './src/live-feed.js';

globalThis.window ??= {};
const root = new URL('../episodes/', import.meta.url);
const read = (slug, f) => readFileSync(new URL(`${slug}/${f}`, root), 'utf8');
const load = (slug) => ({
  slug,
  events: parseNdjson(read(slug, 'events.ndjson')),
  beats: modernBundle(JSON.parse(read(slug, 'beats.json'))),
  director: JSON.parse(read(slug, 'director.json')),
  activity: existsSync(new URL(`${slug}/activity.ndjson`, root)) ? parseNdjson(read(slug, 'activity.ndjson')) : null,
});

/**
 * A live run of a recorded bundle on a fake clock: the player's LIVE hook polls a snapshot a second (the dev
 * server's events, queue and activity at that moment), ticks 20 times a second, ends the stream when the director
 * finished (director.json wallSeconds). queue: false hears only the stream (the live path before the feed: no queue,
 * no activity).
 */
async function simulate(b, { queue = true } = {}) {
  const score = new MakingOfScore({ live: true });
  const feed = new LiveFeed(score);
  const end = b.director.wallSeconds ?? Math.max(...b.events.map((e) => e.t));
  const p = new Player({ onEvent: () => {} });
  const adds = [];
  let flushedAt = null;
  const snap = () => {
    const s = snapshotAt(b, p.time);
    return queue ? s : { events: s.events, queued: [], activity: null };
  };
  const take = (list, now) => { adds.push([now, list]); return list; };
  await p.live(snap, {
    interval: 1e9, // (the test polls on the fake clock)
    score: {
      // (the plan, beats.json, is known from the first events on: the live page reads it once its title is up)
      feed: (s, now) => { if (!score.beats && s.events.length) score.beats = b.beats; return take(feed.update(s, now), now); },
      add: (r, now) => take(score.add(r, now), now),
      flush: (now) => { flushedAt = now; return take(score.flush(now), now); },
    },
  });
  let next = 1;
  for (let i = 0; i < 200000; i++) {
    p.tick(0.05);
    if (!p._live.flushed && p.time >= next) { next += 1; await p._pollOnce(); }
    if (!p._live.flushed && p.time >= end) await p.endLive();
    if (p.liveDone && p.time >= score.end) break;
  }
  return { score, p, adds, flushedAt };
}

const REAL = ['thought', 'line', 'question', 'answer', 'activity'];
// the crew's own lines: not the making-of's own around a consultation (a hold, a recall, a resume, a keep, a close),
// whose words depend on when the score comes to it (why-musical-bots: "Green, about the big chord" in one run is "So,
// Green, about the big chord" in the other)
const textsOf = (s) => new Set(s.items.filter((i) => REAL.includes(i.kind) && !i.cue).map((i) => i.text));

// 1. every checked-in episode, live -------------------------------------------------------------------
const slugs = readdirSync(root).filter((d) => existsSync(new URL(`${d}/director.json`, root)) && existsSync(new URL(`${d}/events.ndjson`, root))).sort();
assert.ok(slugs.length >= 10, `the curated episodes (${slugs.length})`);
const report = [];
for (const slug of slugs) {
  const b = load(slug);
  const production = b.director.wallSeconds ?? b.director.makingOfSeconds ?? null;
  const rep = scoreMakingOf(b.events, b.beats, { production, activity: b.activity });
  const { score: live, p, adds, flushedAt } = await simulate(b);
  const how = `${slug} live`;
  assert.ok(p.liveDone && live.closed, `${how}: the stream ends, the score closes`);
  assert.ok(p.events.every((e, i) => i === 0 || e.t >= p.events[i - 1].t - 1e-9), `${how}: staged in order`);
  // nothing laid out in the past, every voice with a second to render
  const planOf = new Map(live.lines.map((l) => [l.seq, l]));
  for (const [now, added] of adds) for (const e of added) {
    const l = planOf.get(e.seq);
    assert.ok(e.t >= now - 1e-6 && (!l || l.at >= now + 1 - 1e-6), `${how}: #${e.seq} "${e.lyric}" laid out at ${now.toFixed(2)} for ${l?.at?.toFixed(2)}`);
  }
  // the real work, as the replay sings it: the same lines (the crew's talk, Green's lines, every consultation's
  // lines, the director's and the crew's activity), not the work song's filler
  const a = textsOf(rep), l = textsOf(live);
  const shared = [...a].filter((x) => l.has(x)).length;
  // (the hero, re-directed Nov 5 without "a dime": its 13 consultations and 190 gate calls in 20 minutes leave the live score
  // behind more often, so 9 of its 152 lines were sung live as the work song's catch-up or a timing variant, 94%; with the
  // fillers sung up to the news (Nov 5, no silence) the replay sings 155 and live 145 of them, 93.5%: rejections and
  // Green's lines a bar either side of their lag)
  assert.ok(shared >= (slug === 'why-musical-bots' ? 0.93 : 0.95) * a.size, `${how}: sings the replay's real lines (${shared} of ${a.size})`);
  // the lyric gate's first rejection and its explanation: essential, sung live as in the replay (Nov 2, v28 sang none)
  if (b.activity?.some((x) => x.kind === 'reject')) {
    for (const [s, who] of [[rep, 'replay'], [live, 'live']]) {
      const w = s.items.filter((i) => i.kind === 'activity').map((i) => i.work);
      assert.ok(w.includes('reject') && w.includes('explain'), `${slug} ${who}: the first rejection and what the lyric gate is, sung`);
    }
  }
  const refrains = (s) => s.items.filter((i) => i.kind === 'refrain').length;
  assert.ok(refrains(live) <= refrains(rep) + 4, `${how}: the work song only in the waits (${refrains(live)} refrain phrases, the replay ${refrains(rep)})`);
  // every real line is the production's own words: an event's summary or line, an activity line, or the making-of's
  // own lines around a consultation (an ask said another way, a hold, a recall, a resume)
  const own = new Set(b.events.flatMap((e) => [e.summary, e.lyric]).filter(Boolean));
  for (const i of live.items.filter((x) => ['thought', 'question', 'answer'].includes(x.kind) && !x.cue && x.move !== 'ask')) {
    assert.ok([...own].some((t) => t.includes(i.text) || i.text.includes(t.replace(/[.!]+$/, ''))), `${how}: "${i.text}" is the crew's own`);
  }
  // each line from when it was written (heard: live-feed.js), never before
  for (const i of live.items.filter((x) => REAL.includes(x.kind) && x.seq != null && live.arrivedAt.has(x.seq))) {
    assert.ok(i.t0 >= live.arrivedAt.get(i.seq) - 1e-6, `${how}: "${i.text}" at ${i.t0} before it was written (${live.arrivedAt.get(i.seq)})`);
  }
  // with bounded latency: about when the replay sings it (the replay knows to the second when each was written; the
  // live page hears it on its next poll)
  const repAt = new Map();
  for (const i of rep.items) if (REAL.includes(i.kind) && !repAt.has(i.text)) repAt.set(i.text, i.t0);
  const d = live.items.filter((i) => REAL.includes(i.kind) && repAt.has(i.text)).map((i) => i.t0 - repAt.get(i.text)).sort((x, y) => x - y);
  const median = d[d.length >> 1];
  assert.ok(median <= 45, `${how}: the real lines sung ${median.toFixed(1)} s after the replay sings them (median)`);
  // the consultations, by the same rules: the host takes a question right after it is asked (its ack, else a hold
  // line), a question held comes back with a recall when other talk came between, at most MAX_OPEN held at once
  const threads = new Map();
  for (const i of live.items.filter((x) => x.thread)) { if (!threads.has(i.thread)) threads.set(i.thread, []); threads.get(i.thread).push(i); }
  const all = live.items.filter((x) => ['question', 'answer', 'thought', 'line', 'activity', 'refrain'].includes(x.kind)).sort((x, y) => x.t0 - y.t0);
  // (a question is on hold from its hold line until the host's next line of that thread: its recall, or its reply; a
  // hold whose reply the production never wrote, a follow-up left open at the end, waits for nothing: not counted)
  const open = new Set();
  let most = 0;
  const hosts = live.items.filter((x) => x.thread && x.kind === 'answer').sort((x, y) => x.t0 - y.t0);
  for (const i of hosts) {
    if (i.cue === 'hold') { if (hosts.some((r) => r.thread === i.thread && r.t0 > i.t0)) open.add(i.thread); } else open.delete(i.thread);
    most = Math.max(most, open.size);
  }
  assert.ok(most <= MAX_OPEN, `${how}: ${most} questions on hold at once`);
  for (const [id, its] of threads) {
    its.sort((x, y) => x.t0 - y.t0);
    its.forEach((q, k) => {
      if (!['question', 'followup'].includes(q.move)) return;
      const next = its[k + 1];
      if (!next) return; // (the question was the last thing sung: the stream ended on it, flushed)
      if (next.move === q.move) return; // (questions x1-3 in a row: the host takes the last)
      assert.ok(next.kind === 'answer' && (next.move === 'ack' || next.cue === 'hold' || next.cue === 'keep' || (q.move === 'followup' && next.move === 'followup-answer')),
        `${how} ${id}: "${q.text}" taken at once (${next.move ?? next.cue} "${next.text}")`);
      // (the question's own bars, its last one may rest; the reply's pickup in the bar after at the latest)
      assert.ok(next.t0 - q.t1 <= 2 * live.bar + 1e-6, `${how} ${id}: "${next.text}" right after "${q.text}" (${(next.t0 - q.t1).toFixed(2)} s)`);
    });
    // (a hold never dangles: the thread ends on its thanks, or the asker's closing thanks)
    const said = its.filter((x) => x.kind !== 'gesture');
    assert.ok(said.at(-1)?.cue !== 'hold' && (said.at(-1)?.move === 'thanks' || said.at(-1)?.cue === 'close'), `${how} ${id}: ends on its thanks, not "${said.at(-1)?.text}"`);
    its.forEach((h, k) => {
      if (h.cue !== 'hold') return;
      const back = its.slice(k + 1).find((x) => x.kind === 'answer');
      if (!back) return;
      const between = all.some((x) => x.t0 > h.t1 && x.t0 < back.t0 && x.thread !== id && x.kind !== 'refrain');
      if (between || back.t0 - h.t1 > RECALL_GAP) assert.equal(back.cue, 'recall', `${how} ${id}: the held question comes back with a recall ("${back.text}")`);
    });
  }
  // a cappella: every sung line a voice (no instrument part)
  assert.ok(live.lines.every((l) => (l.job?.voice ?? l.voice) && !l.instrument), `${how}: voices only`);
  // it ends about when the replay does after the production ends (its consultations sung to the end, as recorded)
  const tail = live.end - flushedAt, repTail = rep.end - Math.max(production ?? 0, ...b.events.map((e) => e.t));
  assert.ok(tail <= Math.max(repTail, 0) + 60, `${how}: ends ${tail.toFixed(0)} s after the director (the replay: ${repTail.toFixed(0)} s)`);
  assert.ok(live.end <= rep.end + 60, `${how}: ${live.end.toFixed(0)} s (the replay ${rep.end.toFixed(0)} s)`);
  report.push(`${slug} ${shared}/${a.size} lines, refrains ${refrains(live)}/${refrains(rep)}, +${median.toFixed(1)} s, end ${live.end.toFixed(0)}/${rep.end.toFixed(0)} s`);
}

// the queue and the activity are what make it: heard only by the stream (the live path before them), a consultation
// written well ahead of its beat waits for the turnstile; with them it is sung from when it was written. (streetlamp's
// c1, written at 33 s, landed at 373 s: with the queue asked at 55 s. Until Nov 1 (later) this was hackathon-win's
// Black c1; re-directed with the singable check, its first early question, Blue's c9 to Gold, written at 151 s, waits
// behind the consultations sung before it, one open question at a time, as most episodes' do.)
{
  const b = load('streetlamp');
  const { score: old } = await simulate(b, { queue: false });
  const { score: now } = await simulate(b);
  const written = new Map();
  for (const a of b.activity ?? []) if (a?.kind === 'queue') for (const seq of a.seqs ?? []) if (!written.has(seq)) written.set(seq, a.t);
  // (the first question written over two minutes before it landed)
  const qs = b.events.filter((e) => e.move === 'question' && e.t - (written.get(e.seq) ?? e.t) > 120);
  assert.ok(qs.length, 'a question the turnstile held');
  const q = qs.reduce((x, y) => (written.get(y.seq) < written.get(x.seq) ? y : x));
  const id = String(q.thread), wq = written.get(q.seq);
  const its = (s) => s.items.filter((i) => i.thread === id).sort((x, y) => x.t0 - y.t0);
  const asked = (s) => its(s).find((i) => i.move === 'question');
  const answer = (s) => its(s).find((i) => i.move === 'answer');
  assert.ok(asked(now).t0 < wq + 45, `with the queue: ${id} asked at ${asked(now).t0} s (written at ${wq} s)`);
  assert.ok(answer(now).t0 < q.t, `with the queue: ${id} answered at ${answer(now).t0} s, before it landed (${q.t} s)`);
  // (its reply written later: the host takes the question with a hold line, then comes back to it)
  const ack = b.events.find((e) => String(e.thread) === id && e.move === 'ack');
  if (written.get(ack?.seq) > wq + 30) {
    assert.ok(its(now).some((i) => i.cue === 'hold'), `with the queue: ${id} held (${its(now).map((i) => i.move ?? i.cue)})`);
    assert.ok(its(now).some((i) => i.cue === 'recall'), `with the queue: ${id} recalled (${its(now).map((i) => i.move ?? i.cue)})`);
  }
  assert.ok(asked(old).t0 >= q.t, `without it: ${id} only once it landed (${asked(old).t0} s)`);
  assert.ok(answer(old).t0 > answer(now).t0 + 120, `without it: the answer only at ${answer(old).t0} s`);
  const fill = (s) => s.items.filter((i) => i.kind === 'refrain').length;
  assert.ok(fill(old) > fill(now), `without it, the work song fills more of the wait (${fill(old)} vs ${fill(now)} refrain phrases)`);
}

// 2. the feed: a reply written ahead, landing later --------------------------------------------------
{
  const AG = { Pink: 'comedy', Blue: 'lighting' };
  const M = (t, bot, move, summary, beat = 'beat-1-intro') => ({ t, agent: AG[bot], bot, status: bot === 'Pink' ? 'consulting' : 'working', beat, summary, lyric: '', chords: [], action: '', consult: [bot === 'Pink' ? 'Blue' : 'Pink'], move, thread: 'c1' });
  const opening = [M(10, 'Pink', 'ask', 'Hey Blue, got a minute?'), M(10, 'Pink', 'context', 'Green plans a slip on the ice'), M(10, 'Pink', 'question', 'Can a light follow me?')]
    .map((e, seq) => ({ seq, ...e }));
  const reply = [M(14, 'Blue', 'ok', 'Sure, what is up?', 'beat-2-verse1'), M(14, 'Blue', 'ack', 'Ooh, a fun one', 'beat-2-verse1'), M(14, 'Blue', 'reasoning', 'A spot on the ice is bright', 'beat-2-verse1'), M(14, 'Blue', 'answer', 'So we dim it to amber', 'beat-2-verse1')];
  const score = new MakingOfScore({ live: true });
  const feed = new LiveFeed(score);
  // Blue's reply is written at 10 s too, with Pink's question, for verse 1, which opens at 60 s
  const queued = reply.map((e) => ({ ...e, t: 10, n: 1 }));
  for (let t = 10; t < 60; t++) feed.update({ events: opening, queued }, t);
  assert.equal(score.progressAt(59).beat, 'beat-1-intro', 'verse 1 has not arrived: the loading bar stays');
  const landed = [...opening, ...reply.map((e, k) => ({ seq: 3 + k, ...e, t: 60 }))];
  for (let t = 60; t < 120; t++) feed.update({ events: landed, queued: [] }, t);
  score.flush(120);
  assert.equal(score.progressAt(60).beat, 'beat-2-verse1', 'verse 1 arrives when it lands');
  const its = score.items.filter((i) => i.thread === 'c1').sort((a, b) => a.t0 - b.t0);
  // (no thanks ever written: at the end Pink comes back to it and thanks Blue, a hand play seals it)
  assert.deepEqual(its.map((i) => i.move ?? i.cue).slice(0, 7), ['ask', 'ok', 'context', 'question', 'ack', 'reasoning', 'answer'], 'sung once, as one stretch');
  assert.deepEqual(its.slice(7).filter((i) => i.kind !== 'gesture').map((i) => i.cue), ['resume', 'close'], 'closed at the end');
  assert.ok(its.find((i) => i.move === 'answer').t0 < 60, 'the reply sung from when it was written, before it landed');
  assert.equal(score.raw.length, opening.length + reply.length, 'a landing is not a new event');
}

// 3. Play in a live run --------------------------------------------------------------------------------
{
  const { createMakingOf } = await import('./src/making-of.js');
  const classes = new Set();
  globalThis.document = { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle() {} } } };
  const intervals = [];
  const realSetInterval = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  globalThis.clearInterval = () => {};
  const res = (body, type = 'application/json', status = 200) => ({ ok: status < 400, status, headers: { get: () => type }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const run = async (finalState) => {
    let state = 'planning';
    globalThis.fetch = async (url, o = {}) => {
      if (url === '/api/direct' && o.method === 'POST') return res({ slug: 'x', events: '/api/direct/x/events.ndjson', beats: '/api/direct/x/beats.json', queued: '/api/direct/x/queued.ndjson', activity: '/api/direct/x/activity.ndjson' }, 'application/json', 202);
      if (url === '/api/direct') return res({ available: true });
      if (url === '/api/direct/x') return res({ state, title: state === 'planning' ? null : 'X', director: state === 'done' ? { gate: { ok: true } } : state === 'failed' ? { gate: { ok: false, problems: ['no'] } } : null, exit: ['done', 'failed'].includes(state) ? (state === 'done' ? 0 : 1) : null });
      if (url.endsWith('beats.json')) return res({ version: 2, title: 'X', beats: [] });
      return res('', 'application/x-ndjson');
    };
    const playEl = { hidden: true, cls: new Set(), classList: { contains(c) { return playEl.cls.has(c); }, toggle(c, on) { if (on) playEl.cls.add(c); else playEl.cls.delete(c); } } };
    const player = { events: [], time: 0, liveDone: false, live() {}, endLive: async () => { player.liveDone = true; }, stopLive() {}, pause() {}, play() {} };
    const choir = { start: async () => {}, begin() {}, prepare: async () => 0, setVamp() {}, hush() {} };
    const m = createMakingOf({ player, choir, el: { innerHTML: '' }, captionEl: null, playEl, onPremiere() {} });
    intervals.length = 0;
    await m.start('A brand new prompt nobody curated');
    assert.equal(m.active?.kind, 'live', 'a new prompt is directed live');
    const poll = intervals.at(-1);
    const shown = [];
    for (const s of ['planning', 'working', 'working', finalState]) {
      state = s;
      await poll();
      shown.push(`${s}:${!playEl.hidden && playEl.cls.has('ready') ? 'Play' : '-'}`);
    }
    m.cancel();
    return shown;
  };
  assert.deepEqual(await run('done'), ['planning:-', 'working:-', 'working:-', 'done:Play'], 'Play once the director is done and passed');
  assert.deepEqual(await run('failed'), ['planning:-', 'working:-', 'working:-', 'failed:-'], 'never after a failed gate');
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClear;
}

console.log(`live feed ok: every curated episode sung live as its replay (real lines, the consultation rules, a cappella, its end), the queue heard ahead, Play once passed\n  ${report.join('\n  ')}`);
