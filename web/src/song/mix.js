// The story song's mix (Soothing Bots: Magna.Core Audio/StoryMix.cs): whoever tells the story (the
// lead, or a character singing its own line on the tune) plays at its own level and every other part
// sits under it by its layer; where nobody tells the story (the intro before the lead comes in, a rest
// of more than a bar and a half, the last chord) the words and the backing come up (the lift). Pure:
// web/src/audio.js turns the levels into gains and the lift into gain automation.
import { sectionKind } from './form.js';

/** Levels under the storyteller (dB), by layer (StoryMix.cs ECHO_DB, REPLY_DB, WORDS_DB, BACKING_DB). */
export const LAYER_DB = { story: 0, reply: 0, echo: -4, words: -9, backing: -14 };
/** The bridges: every layer but the storyteller's 3 dB more under it (a softer grown-up voice over a held choir). */
export const BRIDGE_DB = -3;
/** The words and the backing where nobody tells the story (dB). */
export const FREE_DB = -4;
/** A storyteller's rest shorter than this (bars) keeps the backing under it (no pumping between lines). */
export const GAP_BARS = 1.5;
/** The backing is down this long (s) before the story's first note and comes up this long after its last. */
export const DUCK_LEAD = 0.25, DUCK_HOLD = 0.3;
/** How long (s) the backing takes to go down before a story line and to come back up after one. */
export const DUCK_FALL = 0.6, DUCK_RISE = 1.2;

/** A layer's level (dB) in a section. */
export const layerDb = (layer, section) => (LAYER_DB[layer] ?? LAYER_DB.backing)
  + (layer !== 'story' && sectionKind(section) === 'bridge' ? BRIDGE_DB : 0);

/** How far (dB) a layer comes up where nobody tells the story: the words and the backing to FREE_DB. */
export const liftDb = (layer, section) => (layer === 'words' || layer === 'backing' ? Math.max(0, FREE_DB - layerDb(layer, section)) : 0);

/** The note span [start, end] (song s) of a planned line or of each of its segments. */
function noteSpans(l) {
  const one = (at, job) => [at + job.notes[0].t, at + job.notes.at(-1).t + job.notes.at(-1).dur];
  return l.segments?.length ? l.segments.map((g) => one(g.at, g.job)) : [one(l.at, l.job)];
}

/**
 * When the song tells its story (StoryMix.StorySpans): the note spans of its story lines, rests
 * shorter than GAP_BARS bridged, from DUCK_LEAD before the first note to DUCK_HOLD after the last.
 */
export function storySpans(lines, barSec) {
  const spans = lines.filter((l) => l.layer === 'story').flatMap(noteSpans).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] - last[1] < GAP_BARS * barSec) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged.map(([a, b]) => [a - DUCK_LEAD, b + DUCK_HOLD]);
}

/** How much the story is on at song time t (1: a storyteller sings; 0: nobody; cosine ramps between). */
export function storyAt(spans, t) {
  let on = 0;
  for (const [a, b] of spans) {
    if (t >= a && t <= b) return 1;
    const x = t < a ? (t > a - DUCK_FALL ? 1 - (a - t) / DUCK_FALL : 0) : t < b + DUCK_RISE ? 1 - (t - b) / DUCK_RISE : 0;
    on = Math.max(on, 0.5 - 0.5 * Math.cos(Math.PI * x));
  }
  return on;
}

/**
 * A line's level: { db } its layer's, and for the words and the backing { lift: [[t, db], ...] } the
 * extra dB over song time (0 under the story, up to liftDb where nobody tells it), sampled where it
 * changes (every 0.1 s inside the ramps).
 */
export function layerGain(line, spans) {
  const db = layerDb(line.layer, line.section);
  const up = liftDb(line.layer, line.section);
  if (!(up > 0)) return { db, lift: null };
  const [t0, t1] = noteSpans(line).reduce((r, [a, b]) => [Math.min(r[0], a - 0.35), Math.max(r[1], b + 0.1)], [Infinity, -Infinity]);
  const ts = new Set([t0, t1]);
  for (const [a, b] of spans) {
    for (let t = a - DUCK_FALL; t <= a + 1e-9; t += 0.1) ts.add(+t.toFixed(3));
    for (let t = b; t <= b + DUCK_RISE + 1e-9; t += 0.1) ts.add(+t.toFixed(3));
    ts.add(a); ts.add(b);
  }
  const pts = [...ts].filter((t) => t >= t0 && t <= t1).sort((a, b) => a - b).map((t) => [t, +(up * (1 - storyAt(spans, t))).toFixed(3)]);
  // keep the corners only (a point between two equal neighbours says nothing)
  const lift = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !(pts[i - 1][1] === p[1] && pts[i + 1][1] === p[1]));
  return { db, lift: lift.some((p) => p[1] > 0) ? lift : null };
}
