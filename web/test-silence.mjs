// No silence in the making-of (owner, Nov 5: "I don't want any silence during the making-of!"; Nov 2: "There should
// never be a point when the bots do not sing anything"), measured on the scores' voice jobs (web/silence.mjs: the notes
// the voice pool renders):
//   1. every curated episode's recorded making-of, from its first second to its end: something always sounds (the
//      crew's backing at least: never a quarter second without), and between two sung lines (a phrase, a duet, a gap
//      answer, the real work, a filler, the work song) never more than a bar of the backing alone (the breath, and the
//      last syllable's release: 3 s); a rest inside one line (the tune's split of a long line after its opening word,
//      song/tunes.js) a bar and a half at most; the last word rings over the home chord to the end;
//   2. LIVE, as making-of.js plays it (the warm-up's first bars prerolled, the dev server's snapshot polled once a
//      second: web/silence.mjs simulateLive): two episodes the same; the director planning with nothing written for three
//      minutes: the crew sings all along; a run that stopped (failed): the crew sings on for the minute after, the
//      fillers still drawn without a repeat;
//   3. the measure itself, on made-up notes.
import assert from 'node:assert/strict';
import { loadEpisode, episodes, replayScore, simulateLive, silences, sungGaps, gapsIn, gapStats } from './silence.mjs';
import { FILLER_FACTS } from './src/making-of-score.js';

globalThis.window ??= {};
const BREATH = 3.0; // s: a bar (2.5 s) of the backing alone and the last syllable's release (live: room for a pickup)
const REST = 3.75 + 0.01; // s: a rest inside one line at most (a bar and a half)
const SOUND = 0.25; // s: nothing sounding at all, at most (between two backing cells)

// 3. the measure ----------------------------------------------------------------------------------
assert.deepEqual(gapsIn([[0, 1], [0.5, 2], [3, 4]], 0, 5), [[2, 3], [4, 5]]);
assert.deepEqual(gapsIn([[0, 1], [1.2, 2]], 0, 2, 0.5), [], 'shorter than min: none');
assert.deepEqual(gapStats([[0, 3], [5, 5.5]], 2.5), { longest: 3, at: 0, overBar: 1, overTwo: 0, total: 3.5 });

const check = (s, how, { from = 0, to = s.end } = {}) => {
  const { sound } = silences(s, { from, to, min: SOUND });
  assert.deepEqual(sound.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`), [], `${how}: nothing sounding`);
  const gaps = sungGaps(s, { from, to, min: BREATH });
  const between = gaps.filter((g) => !g.inside), inside = gaps.filter((g) => g.inside && g.t1 - g.t0 > REST);
  const say = (g) => `${g.t0.toFixed(1)}-${g.t1.toFixed(1)} s after "${g.before?.text ?? ''}"`;
  assert.deepEqual(between.map(say), [], `${how}: nothing sung longer than a bar between two lines`);
  assert.deepEqual(inside.map(say), [], `${how}: a rest inside a line a bar and a half at most`);
  return sungGaps(s, { from, to });
};

// 1. every curated episode, replayed ----------------------------------------------------------------
const report = [];
for (const slug of episodes()) {
  const s = replayScore(loadEpisode(slug));
  const all = check(s, `${slug} replay`);
  // (the end: the last word rings over the home chord, nothing sung a bar at most before the end)
  const tail = all.at(-1);
  assert.ok(!tail || tail.t1 < s.end - 1e-6 || tail.t1 - tail.t0 <= s.bar, `${slug}: the making-of ends sung (${tail?.t0.toFixed(1)}-${tail?.t1.toFixed(1)})`);
  const st = gapStats(all.map((g) => [g.t0, g.t1]), s.bar);
  report.push(`${slug} ${st.longest} s`);
}
console.log(`silence ok, replay: the longest stretch with nothing sung ${report.join(', ')}`);

// 2. LIVE ---------------------------------------------------------------------------------------------
for (const slug of ['why-musical-bots', 'hackathon-win']) {
  const b = loadEpisode(slug);
  const { score } = await simulateLive(b);
  assert.ok(score.closed, `${slug} live: the score closes`);
  check(score, `${slug} live`);
}
{
  // the director planning, nothing written for three minutes: the work song and the fillers all along, each fact once
  const b = loadEpisode('hackathon-win');
  const { score } = await simulateLive(b, { events: false, until: 180, seed: 'plan' });
  check(score, 'live planning', { to: 180 });
  const facts = score.items.filter((i) => i.kind === 'filler' && !/^Filler time/.test(i.text)).map((i) => i.text);
  assert.ok(facts.length >= 6 && new Set(facts).size === facts.length, `live planning: ${facts.length} facts, none twice`);
  assert.ok(facts.every((f) => FILLER_FACTS.some(([, x]) => x === f)));
  assert.ok(score.items.some((i) => i.kind === 'refrain'), 'live planning: the work song');
}
{
  // a run that stops halfway (failed): what waited is sung and closed, then the crew sings on, never silent, while the
  // making-of stays up with the reason on its banner
  const b = loadEpisode('hackathon-win');
  const half = Math.round(b.director.wallSeconds / 2);
  const { score, ended, time } = await simulateLive(b, { end: half, failed: true, hold: 900 });
  assert.ok(ended !== null && !score.closed && score.stopped, 'a stopped run: the score stays open');
  check(score, 'live stopped', { from: 0, to: time });
  // (the consultations that waited, sung and closed first; then the groove's own lines, a minute and more of them)
  const talk = score.items.filter((i) => i.t0 >= ended && !['filler', 'refrain'].includes(i.kind)).reduce((m, i) => Math.max(m, i.t1), ended);
  const fill = score.items.filter((i) => i.t0 >= talk && ['filler', 'refrain'].includes(i.kind));
  assert.ok(time - talk >= 60 && fill.length >= 10, `stopped: the crew sings on after the last talk (${fill.length} lines in ${(time - talk).toFixed(0)} s)`);
  assert.ok(![...score.th.values()].some((th) => th.state === 'held'), 'stopped: no question left on hold');
}
console.log('silence ok, live: two episodes, the director planning, a run that stopped');
