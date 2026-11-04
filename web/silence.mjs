// The making-of's silences (owner, Nov 5: "I don't want any silence during the making-of!"; Nov 2: "There should never
// be a point when the bots do not sing anything"), measured from a score's voice jobs (making-of-score.js: the notes
// the voice pool renders, in transport seconds):
//   - nothing sung: no phrase, duet, seal, gap answer, activity line, filler or work song (the backing alone, the
//     crew's "Ooh" / "Mm" pads holding the chords);
//   - nothing sounding: not even the backing (the score's own idea of audio silence: the capture's RMS scan checks the
//     rendered audio).
// Also a LIVE run of a recorded bundle on a fake clock (as test-live-feed.mjs: the dev server's snapshot polled once a
// second through the player's LIVE hook), and the waits only live has (the director planning with nothing written yet,
// a run that stopped).
//
//   node web/silence.mjs [slug ...] [--live] [--seed S]   a table per episode (replay; --live: the live run too)
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Player, parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { MakingOfScore, scoreMakingOf } from './src/making-of-score.js';
import { LiveFeed, snapshotAt } from './src/live-feed.js';

const root = new URL('../episodes/', import.meta.url);
const EPS = 1e-6;

/** A curated bundle: its events, plan, director's record and activity log. */
export function loadEpisode(slug) {
  const read = (f) => readFileSync(new URL(`${slug}/${f}`, root), 'utf8');
  const has = (f) => existsSync(new URL(`${slug}/${f}`, root));
  return {
    slug,
    events: parseNdjson(read('events.ndjson')),
    beats: modernBundle(JSON.parse(read('beats.json'))),
    director: has('director.json') ? JSON.parse(read('director.json')) : {},
    activity: has('activity.ndjson') ? parseNdjson(read('activity.ndjson')) : null,
  };
}

/** The curated episodes with a recorded production (director.json and an activity log). */
export const episodes = () => readdirSync(root).filter((d) => existsSync(new URL(`${d}/director.json`, root)) && existsSync(new URL(`${d}/events.ndjson`, root))).sort();

/** The notes of a score's lines (transport seconds: [t0, t1]) whose layer passes `keep`. */
export function notesOf(score, keep = () => true) {
  const out = [];
  for (const l of score.lines) {
    if (!keep(l.layer ?? 'story')) continue;
    const segs = l.segments ?? (l.job ? [{ at: l.at, job: l.job }] : []);
    for (const s of segs) for (const n of s.job.notes) out.push([s.at + n.t, s.at + n.t + n.dur]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The stretches of [from, to] that no span covers, each longer than `min` s. */
export function gapsIn(spans, from, to, min = 0) {
  const gaps = [];
  let at = from;
  for (const [a, b] of spans) {
    if (b <= at) continue;
    if (a > at && Math.min(a, to) - at > min + EPS) gaps.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
    if (at >= to) break;
  }
  if (to - at > min + EPS) gaps.push([at, to]);
  return gaps;
}

/** The singing layers: everything but the backing (the pads, the bass, a thinking host's hum). */
export const SUNG = (layer) => layer !== 'backing';

/**
 * A score's silences in [from, to] (default: the whole making-of, transport 0 to its end): `sung` the stretches with
 * nothing sung (the backing alone) longer than `min` s, `sound` those with nothing sounding at all; `bar` the groove's
 * bar (s).
 */
export function silences(score, { from = 0, to = score.end, min = 0 } = {}) {
  return {
    bar: score.bar,
    sung: gapsIn(notesOf(score, SUNG), from, to, min),
    sound: gapsIn(notesOf(score), from, to, min),
  };
}

/**
 * The stretches of [from, to] with nothing sung, longer than `min` s, each { t0, t1, inside (a rest inside one line:
 * the notes on both sides are the same line's), before, after (the lines around it, null at the ends) }.
 */
export function sungGaps(score, { from = 0, to = score.end, min = 0 } = {}) {
  const notes = [];
  for (const l of score.lines) {
    if (!SUNG(l.layer ?? 'story')) continue;
    const segs = l.segments ?? (l.job ? [{ at: l.at, job: l.job }] : []);
    for (const s of segs) for (const n of s.job.notes) notes.push([s.at + n.t, s.at + n.t + n.dur, l]);
  }
  notes.sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = from, last = null;
  for (const [a, b, l] of notes) {
    if (b <= at) continue;
    if (a > at && Math.min(a, to) - at > min + EPS) out.push({ t0: at, t1: Math.min(a, to), inside: last === l, before: last, after: l });
    if (b > at) { at = b; last = l; }
    if (at >= to) break;
  }
  if (to - at > min + EPS) out.push({ t0: at, t1: to, inside: false, before: last, after: null });
  return out;
}

/** The numbers of a list of gaps: the longest (s), how many are longer than one bar and than two, their total (s). */
export function gapStats(gaps, bar) {
  const len = gaps.map(([a, b]) => b - a);
  const longest = len.length ? Math.max(...len) : 0;
  const at = len.length ? gaps[len.indexOf(longest)][0] : null;
  return {
    longest: +longest.toFixed(2), at: at === null ? null : +at.toFixed(1),
    overBar: len.filter((x) => x > bar + 0.05).length, overTwo: len.filter((x) => x > 2 * bar + 0.05).length,
    total: +len.reduce((s, x) => s + x, 0).toFixed(1),
  };
}

/** A recorded making-of, scored as the replay plays it. */
export function replayScore(b, { seed = undefined } = {}) {
  const production = b.director?.wallSeconds ?? b.director?.makingOfSeconds ?? null;
  return scoreMakingOf(b.events, b.beats, { production, activity: b.activity, seed });
}

/**
 * A LIVE run of a recorded bundle on a fake clock (test-live-feed.mjs simulate), as making-of.js start() plays it: the
 * warm-up's first bars laid out before the transport starts (preroll), the player's LIVE hook polling the dev server's
 * snapshot once a second, 20 ticks a second, the stream ended when the director finished. opts: end (s: when the
 * director finishes; default its wallSeconds), failed (the run stops there: the making-of stays up after it, the score's
 * stop(): measured `hold` s past it), events (false: nothing is ever written, the director planning all along: measured
 * to `until`), until (s: stop there), seed, preroll.
 */
export async function simulateLive(b, { until = Infinity, end = null, failed = false, hold = 60, seed = undefined, events = true, preroll = true } = {}) {
  const score = new MakingOfScore({ live: true, preroll, ...(seed !== undefined ? { seed } : {}) });
  const feed = new LiveFeed(score);
  const stop = end ?? b.director?.wallSeconds ?? Math.max(...b.events.map((e) => e.t));
  const p = new Player({ onEvent: () => {} });
  const snap = () => (events ? snapshotAt(b, p.time) : { events: [], queued: [], activity: null });
  const first = preroll ? score.add([], 0) : [];
  const going = p.live(snap, {
    interval: 1e9,
    score: {
      feed: (s, now) => { if (!score.beats && s.events.length) score.beats = b.beats; return feed.update(s, now); },
      add: (r, now) => score.add(r, now),
      flush: (now) => score.flush(now),
      stop: (now) => score.stop(now),
    },
  });
  if (first.length) p.stage(first);
  await going;
  let next = 1, ended = null;
  for (let i = 0; i < 400000; i++) {
    p.tick(0.05);
    if (p.time >= until) break;
    if (ended === null && p.time >= next) { next += 1; await p._pollOnce(); }
    if (ended === null && events && p.time >= stop) { await p.endLive({ linger: failed }); ended = p.time; }
    if (failed && ended !== null && p.time >= ended + hold) break;
    if (!failed && p.liveDone && p.time >= score.end) break;
  }
  const time = p.time;
  p.stopLive(); // (its poll timer)
  return { score, player: p, time, ended };
}

// ------------------------------------------------------------------ the command line
const isMain = (() => { try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1] ?? ''); } catch { return false; } })();
if (isMain) {
  globalThis.window ??= {};
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const si = args.indexOf('--seed');
  const seed = si >= 0 ? args[si + 1] : undefined;
  const slugs = args.filter((a, i) => !a.startsWith('--') && (si < 0 || i !== si + 1));
  const row = (name, s, from, to) => {
    const g = silences(s, { from, to });
    const a = gapStats(g.sung, s.bar), z = gapStats(g.sound, s.bar);
    return `${name.padEnd(28)} ${(to - from).toFixed(0).padStart(5)} s  nothing sung: longest ${String(a.longest).padStart(6)} s @${String(a.at).padStart(6)}  >1 bar ${String(a.overBar).padStart(3)}  >2 bars ${String(a.overTwo).padStart(3)}  total ${String(a.total).padStart(6)} s | nothing sounding: longest ${String(z.longest).padStart(6)} s, total ${String(z.total).padStart(5)} s`;
  };
  for (const slug of slugs.length ? slugs : episodes()) {
    const b = loadEpisode(slug);
    const rep = replayScore(b, { seed });
    console.log(row(`${slug} replay`, rep, 0, rep.end));
    if (live) {
      const { score } = await simulateLive(b, { seed });
      console.log(row(`${slug} live`, score, 0, score.end));
    }
  }
  if (args.includes('--waits')) {
    // the waits only live has: the director planning with nothing written (three minutes), a run that stopped
    // halfway (a minute after it), measured on the first episode asked for (else the hero)
    const b = loadEpisode(slugs[0] ?? 'why-musical-bots');
    const plan = await simulateLive(b, { events: false, until: 180, seed });
    console.log(row('live: planning, 180 s', plan.score, 0, 180));
    const half = Math.round((b.director?.wallSeconds ?? 600) / 2);
    const failed = await simulateLive(b, { end: half, failed: true, hold: 60, seed });
    console.log(row(`live: stopped at ${half} s, +60 s`, failed.score, 0, failed.time));
  }
}
