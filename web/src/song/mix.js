// The story song's mix (Soothing Bots: Magna.Core Audio/StoryMix.cs): whoever tells the story (the
// lead, or a character singing its own line on the tune) plays at its own level and every other part
// sits under it by its layer; where nobody tells the story (the intro before the lead comes in, a rest
// of more than a bar and a half, the last chord) the words and the backing come up (the lift). Pure:
// web/src/audio.js turns the levels into gains and the lift into gain automation.
import { sectionKind } from './form.js';
import { syllabify } from '../mv/voice/syllables.js';
import { properWord } from '../mv/voice/text/sungStress.js';

/**
 * Levels under the storyteller (dB), by layer (StoryMix.cs ECHO_DB, REPLY_DB, WORDS_DB, BACKING_DB). The
 * backing sits 3 dB under StoryMix's -14: measured with Whisper per line on the curated episodes, the
 * engine's voices under -14 dB still masked the story's words (the lift brings it up where nobody sings).
 */
export const LAYER_DB = { story: 0, reply: 0, echo: -4, words: -9, backing: -17 };
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

/**
 * Parts of the backing under their layer's level (dB): the off-beat "doo dee" groove, the most
 * speech-like of the choir, and the bridges' hum, in the grown-up's register.
 */
export const ROLE_DB = { rhythm: -4, hum: -3 };

/** A line's level (dB): its layer's in its section, and its part's offset. */
export const lineDb = (line) => layerDb(line.layer, line.section) + (line.layer === 'backing' ? ROLE_DB[line.role] ?? 0 : 0);

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
 * Under the story's sung syllables (every note of a story line) the words and the backing dip this much
 * more (dB): down SYL_ATTACK before the note, back up SYL_RELEASE after it (notes closer than SYL_MERGE
 * are one dip), like a sidechain on the storyteller's voice, so its consonants find a clear spot.
 */
export const SYLLABLE_DUCK_DB = { words: -2, backing: -4 };
export const SYL_ATTACK = 0.04, SYL_RELEASE = 0.25, SYL_MERGE = 0.12;

/**
 * Under a proper noun's syllables (a name, a brand: sungStress.js properWord) the dip is PROPER_DUCK times as deep (QA v24:
 * "Meta" lost under the verse's backing, heard "for midden").
 */
export const PROPER_DUCK = 2;

const mergeSpans = (spans) => {
  const merged = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && s[0] - last[1] < SYL_MERGE) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged;
};

/** The story's sung notes as merged spans [start, end] (song s); `.proper`: those of its proper nouns, merged apart. */
export function syllableSpans(lines) {
  const story = lines.filter((l) => l.layer === 'story');
  const merged = mergeSpans(story.flatMap((l) => l.job.notes.map((n) => [l.at + n.t, l.at + n.t + n.dur])));
  const proper = [];
  for (const l of story) {
    let sy = null;
    try { sy = syllabify(l.job.text ?? '', l.job.syllables ?? null, l.job.senses ?? null); } catch { sy = null; }
    if (!sy || sy.length !== l.job.notes.length) continue;
    sy.forEach((s, i) => { if (properWord(s.word, s.wordIndex)) proper.push([l.at + l.job.notes[i].t, l.at + l.job.notes[i].t + l.job.notes[i].dur]); });
  }
  Object.defineProperty(merged, 'proper', { value: mergeSpans(proper), enumerable: false });
  return merged;
}

const duckOf = (spans, t) => {
  let x = 0;
  for (const [a, b] of spans) {
    if (a - SYL_ATTACK > t) break;
    const k = t < a ? (t - (a - SYL_ATTACK)) / SYL_ATTACK : t <= b ? 1 : 1 - (t - b) / SYL_RELEASE;
    x = Math.max(x, Math.min(1, Math.max(0, k)));
  }
  return x;
};

/** How deep (dB, <= 0) the syllable duck is at song time t (under a proper noun PROPER_DUCK times as deep). */
export function syllableDuckAt(syl, t, depth) {
  if (!depth || !syl?.length) return 0;
  const x = Math.max(duckOf(syl, t), syl.proper?.length ? PROPER_DUCK * duckOf(syl.proper, t) : 0);
  return x ? depth * x : 0;
}

/**
 * A line's level: { db } its layer's, and for the words and the backing { lift: [[t, db], ...] } the
 * extra dB over song time: up to liftDb where nobody tells the story (0 under it), minus the syllable
 * duck under the story's notes (SYLLABLE_DUCK_DB), sampled where it changes (every 0.1 s inside the
 * lift's ramps, at the duck's corners).
 */
export function layerGain(line, spans, syl = null) {
  const db = lineDb(line);
  const up = liftDb(line.layer, line.section);
  const depth = SYLLABLE_DUCK_DB[line.layer] ?? 0;
  if (!(up > 0) && !depth) return { db, lift: null };
  const [t0, t1] = noteSpans(line).reduce((r, [a, b]) => [Math.min(r[0], a - 0.35), Math.max(r[1], b + 0.1)], [Infinity, -Infinity]);
  const ts = new Set([t0, t1]);
  if (up > 0) {
    for (const [a, b] of spans) {
      for (let t = a - DUCK_FALL; t <= a + 1e-9; t += 0.1) ts.add(+t.toFixed(3));
      for (let t = b; t <= b + DUCK_RISE + 1e-9; t += 0.1) ts.add(+t.toFixed(3));
      ts.add(a); ts.add(b);
    }
  }
  if (depth) for (const [a, b] of [...(syl ?? []), ...(syl?.proper ?? [])]) if (b + SYL_RELEASE >= t0 && a - SYL_ATTACK <= t1) [a - SYL_ATTACK, a, b, b + SYL_RELEASE].forEach((t) => ts.add(+t.toFixed(3)));
  const pts = [...ts].filter((t) => t >= t0 && t <= t1).sort((a, b) => a - b)
    .map((t) => [t, +((up > 0 ? up * (1 - storyAt(spans, t)) : 0) + syllableDuckAt(syl, t, depth)).toFixed(3) + 0]);
  // keep the corners only (a point between two equal neighbours says nothing)
  const lift = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !(pts[i - 1][1] === p[1] && pts[i + 1][1] === p[1]));
  return { db, lift: lift.some((p) => p[1] !== 0) ? lift : null };
}

// ------------------------------------------------------------------ the room, the EQ and the stereo place (audio.js)

/** The room send per layer (the reverb's input level). */
export const WET = { story: 0.16, reply: 0.28, echo: 0.28, words: 0.2, backing: 0.15 };
/** EQ per layer (Web Audio BiquadFilter settings: type, f Hz, q, gain dB), in series. */
export const LAYER_EQ = {
  story: [], reply: [], echo: [], words: [],
  // the backing kept out of the consonants' band (where the story's words are understood)
  backing: [{ type: 'peaking', f: 2500, q: 0.8, gain: -8 }, { type: 'highshelf', f: 5000, gain: -4 }],
};
/** EQ per part (a line's role), before its layer's. */
export const ROLE_EQ = {
  // held vowels and hums: their warmth, not their edge
  pad: [{ type: 'lowpass', f: 1800, q: 0.7 }], lowpad: [{ type: 'lowpass', f: 1500, q: 0.7 }], hum: [{ type: 'lowpass', f: 1500, q: 0.7 }],
  bass: [{ type: 'lowpass', f: 1000, q: 0.7 }],
};
/** Stereo place per part (-1 left .. 1 right; StereoPannerNode). */
export const PAN = {
  // the story in the centre; the pal a little left; the harmonies either side; the choir spread behind
  reply: -0.15, echo: -0.15, third: 0.3, fifth: -0.3, root: -0.3, unison: 0.15,
  bass: 0, pad: -0.45, lowpad: 0.4, rhythm: 0.5, sparkle: -0.55, hum: -0.3, counter: 0.35,
};
