// The story song's tunes (Soothing Bots: Magna.Core Music/MelodyChild.cs, MelodyReply.cs,
// MelodyMore.cs and the pickups of Compile.cs, ported as a specification): the child melodies the
// story is sung on, the echo's replies in the gap after a line, and the backing's cells ("Bom" on
// the beat, "doo" on the ands, held "ooh", "la la" arpeggios, the descant's long notes).
//
// Every function returns notes the way the engine's generateNotes does ({ notes: [{ t, dur, midi,
// bar, beat, strong }], bars }: t and dur in seconds from the line's first downbeat), so a line on a
// child tune renders through the same voice jobs. Pure and deterministic; the engine's own
// templates (web/src/mv/music/melody.js) are untouched: notesFor() hands them anything it does not
// know.
import { generateNotes as engineNotes, fitPhraseSplit } from '../mv/music/melody.js';
import { applyStressFit } from '../mv/music/stressFit.js';
import { chordFromRoman, chordScale, mod12, roleTone, voiceRange, voiceCentre, scalePcs, keyPc } from '../mv/music/theory.js';
import { syllabify } from '../mv/voice/syllables.js';
import { CHILD_TUNES, ECHO_SHAPES } from './form.js';

const BAR = 4;
const EPS = 1e-6;
const LINE_BARS = [1, 2, 4, 8];

// ------------------------------------------------------------------ cells

const on = (...ats) => ats.map((at) => ({ at }));
const onD = (...xs) => xs.map(([at, dur]) => ({ at, dur }));
/** c onsets in one bar: table[c - 1], else the c first positions of `dense` (sorted), else an even grid. */
function cells(table, dense) {
  return (c) => {
    if (c <= 0) return [];
    if (c <= table.length) return table[c - 1];
    if (c <= dense.length) return dense.slice(0, c).sort((a, b) => a - b).map((at) => ({ at }));
    return Array.from({ length: c }, (_, i) => ({ at: (i * BAR) / c }));
  };
}
/** Cells with at least `dur` beats each (detached notes). */
const withDur = (f, dur) => (c) => f(c).map((x) => ({ at: x.at, dur: x.dur ?? dur }));
const EIGHTHS = [0, 2, 1, 3, 0.5, 2.5, 1.5, 3.5];

// the child tunes' first bars (MelodyChild.cs AddChildTunes): quarters (three notes: the third on beat 4,
// short, leading into the next bar), the rocking sway, the syncopated chant, the quick call
const QUARTERS = cells([on(0), on(0, 2), on(0, 1, 3), on(0, 1, 2, 3)], EIGHTHS);
const SWAY = cells([on(0), on(0, 2), on(0, 1.5, 3), on(0, 1.5, 2, 3)], EIGHTHS);
const CHANT = cells([on(0), on(0, 1.5), on(0, 1.5, 3), onD([0, 0.5], [0.5, 1], [1.5, 1.5], [3, 1])], EIGHTHS);
const CALL = cells([onD([0, 1.5]), onD([0, 1], [1, 1]), onD([0, 1], [1, 0.5], [1.5, 0.5]), onD([0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5])], EIGHTHS);
// the second bar: done by beat 3, so the echo has the bar's second half
const EARLY = cells([onD([0, 2]), onD([0, 1], [1, 1]), onD([0, 0.5], [0.5, 0.5], [1, 1])], [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
const FIRST = { nursery: QUARTERS, bouncy: QUARTERS, rocking: SWAY, march: QUARTERS, risefall: QUARTERS, arch: SWAY, chant: CHANT, pentatonic: QUARTERS, anthem: QUARTERS, callback: CALL };
// long notes with a breath between them, floating above (MelodyMore.cs descant)
const FLOATING = cells([onD([0, 3.25]), onD([0, 1.75], [2, 1.75])], EIGHTHS);

// the making-of's sung talk (tuneNotes talk: nothing quicker than an eighth; since Oct 31 the tune's beat is the
// groove's, the premiere's pace): the closing bar (done by beat 4; four syllables at most, the first two eighths),
// and the cells of a bar that opens on a crewmate's name (hold: the name on the bar line, held two beats)
const TALK_LAST = cells([onD([0, 2]), onD([0, 1], [1, 1]), onD([0, 1], [1, 1], [2, 1]), onD([0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5])], []);
/** The most syllables a talk line's closing bar holds (TALK_LAST: two of them eighths): eight a two-bar line. */
const TALK_MAX_LAST = 4;
const HOLD_FIRST = [on(0), on(0, 2), on(0, 2, 3), on(0, 2, 2.5, 3)];
const HOLD_LAST = [onD([0, 2]), onD([0, 2], [2, 1]), onD([0, 2], [2, 1], [3, 0.75])];
// a closing bar that ends the line on a name: the name on a beat of the groove (tune beat 0 or 2), held to the end
const HOLD_END = [onD([0, 2]), onD([0, 2], [2, 2]), onD([0, 1], [1, 1], [2, 2])];
/** The most notes a bar opening on a held name has: a first bar, a closing bar. */
const HOLD_MAX = { first: HOLD_FIRST.length, last: HOLD_LAST.length };
const evenOnsets = (cs) => cs.every((x, i) => i === 0 || x.at - cs[i - 1].at >= 1 - EPS);

/** The templates this module sings (the child tunes, and the backing's: MelodyMore.cs / melody.js). */
export const TUNE_TEMPLATES = {
  ...Object.fromEntries(CHILD_TUNES.map((id) => [id, { family: 'phrase', first: FIRST[id], last: EARLY, maxFirst: 4, maxLast: 3, breath: 0.5, child: id }])),
  descant: { family: 'phrase', first: FLOATING, last: FLOATING, maxFirst: 2, maxLast: 2, breath: 0.75, centreShift: 2 },
  staccato: { family: 'bars', cell: withDur(cells([on(0), on(0, 2), on(0, 1, 2), on(0, 1, 2, 3)], EIGHTHS), 0.35), comfy: 4, breath: 0.5, finals: 'none', motion: 'repeat' },
  offbeat: {
    family: 'bars', cell: withDur(cells([on(0.5), on(0.5, 2.5), on(0.5, 1.5, 2.5), on(0.5, 1.5, 2.5, 3.5)], [0.5, 2.5, 1.5, 3.5, 1, 3, 2, 0]), 0.5),
    comfy: 4, breath: 0.5, finals: 'line', strongBeats: [0, 0.5, 2, 2.5],
  },
  sustain: { family: 'pad', cell: cells([on(0), on(0, 2), on(0, 2, 3), on(0, 1, 2, 3)], EIGHTHS), breath: 0.25, finals: 'line' },
  arpeggio: { family: 'bars', cell: cells([], [0, 0.5, 1, 2, 2.5, 3, 1.5, 3.5]), comfy: 6, breath: 0.25, finals: 'none', motion: 'arp', centreShift: -5, longIsStrong: false },
};
export const isChildTune = (melody) => CHILD_TUNES.includes(melody);

// ------------------------------------------------------------------ rhythm (Melody.cs layout, cadence)

function capacity(tpl, bars) {
  if (tpl.family === 'phrase') return bars === 1 ? tpl.maxLast : (bars / 2) * (tpl.maxFirst + tpl.maxLast);
  return bars * tpl.comfy;
}

/** Line length in bars (1, 2, 4 or 8) a template gives n syllables, at least minBars; 0 for none. */
export function tuneBars(melody, n, minBars = 0, { talk = false } = {}) {
  const tpl0 = TUNE_TEMPLATES[melody];
  const tpl = talk && tpl0?.family === 'phrase' ? talkTemplate(tpl0) : tpl0;
  if (!tpl || n <= 0) return 0;
  let bars;
  if (tpl.family === 'pad') {
    bars = 1;
    for (const x of LINE_BARS) if (x <= n) bars = x;
  } else bars = LINE_BARS.find((b) => n <= capacity(tpl, b)) ?? 8;
  if (bars < minBars) bars = LINE_BARS.find((b) => b >= minBars) ?? 8;
  return bars;
}

function splitSizes(n, units, words) {
  if (units <= 1) return [n];
  const minStep = n >= units ? 1 : 0;
  const cuts = [0];
  for (let k = 1; k < units; k++) {
    const lo = cuts[k - 1] + minStep, hi = n - minStep * (units - k);
    const ideal = Math.round((n * k) / units);
    let cut = Math.max(lo, Math.min(hi, ideal));
    if (words) {
      for (const d of [0, 1, -1]) {
        const c = ideal + d;
        if (c >= lo && c <= hi && c > 0 && c < n && words[c] !== words[c - 1]) { cut = c; break; }
      }
    }
    cuts.push(cut);
  }
  cuts.push(n);
  return cuts.slice(1).map((c, i) => c - cuts[i]);
}

/**
 * The making-of's sung talk: a template whose first bars never go quicker than a tune beat (a quicker figure: plain
 * quarters) and whose closing bar is TALK_LAST.
 */
function talkTemplate(tpl) {
  return { ...tpl, first: (c) => { const cs = tpl.first(c); return evenOnsets(cs) ? cs : QUARTERS(c); }, last: TALK_LAST, maxLast: Math.max(tpl.maxLast, TALK_MAX_LAST), talk: true };
}

/**
 * The split of a talk line (sizes: syllables a unit of two bars; firsts: of them in its first bar) that puts every
 * held syllable (a name: `hold`, indices) first in its bar, that bar holding it (HOLD_FIRST / HOLD_LAST), the line's
 * last syllable aside (it is held at the line's end); the one nearest `pref` (the stress fit's, else the plain
 * split), a bar line inside a word costing more. Null: none in `bars` bars.
 */
export function holdSplit(tpl, n, bars, hold, words = null, pref = null) {
  const units = bars >= 2 ? bars / 2 : 1;
  if (n < units) return null;
  const held = new Set([...hold].filter((k) => k >= 0 && k < n - 1));
  const base = pref ?? { sizes: splitSizes(n, units, words), firsts: null };
  const want0 = (m, u) => base.firsts?.[u] ?? Math.min(tpl.maxFirst, m - 1);
  let best = null;
  const sizes = [], firsts = [];
  const barOk = (from, count, kind) => {
    for (let k = from + 1; k < from + count; k++) if (held.has(k)) return false;
    return !held.has(from) || count <= HOLD_MAX[kind];
  };
  const cut = (k) => (words && k > 0 && k < n && words[k] === words[k - 1] ? 2 : 0);
  const walk = (u, from, cost) => {
    if (best && cost >= best.cost) return;
    if (u === units) {
      if (from === n) best = { cost, sizes: [...sizes], firsts: [...firsts] };
      return;
    }
    const left = units - u - 1;
    for (let m = 1; m <= tpl.maxFirst + tpl.maxLast && from + m + left <= n; m++) {
      if (u === units - 1 && from + m !== n) continue;
      const c0s = m === 1 ? [1] : Array.from({ length: m - 1 }, (_, i) => i + 1).filter((c) => c <= tpl.maxFirst && m - c <= tpl.maxLast);
      for (const c0 of c0s) {
        const ok = m === 1 ? barOk(from, 1, 'last') : barOk(from, c0, 'first') && barOk(from + c0, m - c0, 'last');
        if (!ok) continue;
        sizes.push(m); firsts.push(c0);
        walk(u + 1, from + m, cost + Math.abs(m - (base.sizes[u] ?? m)) + 0.5 * Math.abs(c0 - want0(m, u)) + cut(from) + (m > 1 ? cut(from + c0) : 0));
        sizes.pop(); firsts.pop();
      }
    }
  };
  walk(0, 0, 0);
  return best && { sizes: best.sizes, firsts: best.firsts };
}

/** Line length in bars of a talk line holding `hold` (tuneBars, longer when the names need it). */
export function holdBars(melody, n, minBars = 0, hold = [], syllables = null, { talk = true } = {}) {
  const bars = tuneBars(melody, n, minBars, { talk });
  const tpl = TUNE_TEMPLATES[melody];
  if (!bars || !tpl || tpl.family !== 'phrase' || !hold?.length) return bars;
  const words = Array.isArray(syllables) && syllables.length === n ? syllables.map((x) => x.wordIndex) : null;
  for (const b of LINE_BARS) if (b >= bars && holdSplit(talkTemplate(tpl), n, b, hold, words)) return b;
  return bars;
}

function layoutPhrase(tpl, n, bars, words, fit = null, hold = null) {
  const unitBars = bars >= 2 ? 2 : 1, unitLen = unitBars * BAR;
  const notes = [];
  // (hold: a bar that opens on a held syllable holds it)
  let k = 0;
  const cellsOf = (kind, c) => {
    const held = hold?.has(k) && c <= HOLD_MAX[kind];
    const ends = kind === 'last' && k + c === n && hold?.has(n - 1) && c <= HOLD_END.length;
    k += c;
    if (ends && !(held && c > 1)) return HOLD_END[c - 1];
    return held ? (kind === 'first' ? HOLD_FIRST : HOLD_LAST)[c - 1] : kind === 'first' ? tpl.first(c) : tpl.last(c);
  };
  // (fit: the engine's split for the words' stress, melody.js fitPhraseSplit: sizes and first bars)
  (fit ? fit.sizes : splitSizes(n, bars / unitBars, words)).forEach((m, u) => {
    const u0 = u * unitLen;
    let parts;
    if (unitBars === 1) parts = [[0, cellsOf('last', m)]];
    else {
      let c0, c1;
      if (m <= 1) [c0, c1] = [m, 0];
      else if (fit && m <= tpl.maxFirst + tpl.maxLast) { c0 = fit.firsts[u]; c1 = m - c0; }
      else if (m <= tpl.maxFirst + tpl.maxLast) { c0 = Math.min(tpl.maxFirst, m - 1); c1 = m - c0; }
      else { c1 = Math.floor(m / 2); c0 = m - c1; }
      parts = c1 > 0 ? [[0, cellsOf('first', c0)], [BAR, cellsOf('last', c1)]] : [[0, cellsOf('last', c0)]];
    }
    const unit = [];
    for (const [off, cs] of parts) for (const c of cs) unit.push({ beat: u0 + off + c.at, cellDur: c.dur ?? null });
    const end = u0 + (unitBars === 2 && parts.length === 1 ? BAR : unitLen);
    unit.forEach((nt, k) => {
      nt.p = (nt.beat - u0) / unitLen;
      if (k === unit.length - 1) { nt.final = true; nt.holdTo = end - tpl.breath; }
    });
    notes.push(...unit);
  });
  return notes;
}

function layoutBars(tpl, n, bars) {
  const base = Math.floor(n / bars), extra = n % bars;
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const cs = tpl.cell(base + (b < extra ? 1 : 0));
    cs.forEach((c, k) => notes.push({ beat: b * BAR + c.at, cellDur: c.dur ?? null, final: tpl.finals === 'bar' && k === cs.length - 1 }));
  }
  if (tpl.finals === 'line' && notes.length) notes[notes.length - 1].final = true;
  for (const nt of notes) nt.p = nt.beat / (bars * BAR);
  return notes;
}

function finishDurations(tpl, notes, total) {
  notes.forEach((nt, i) => {
    const next = i + 1 < notes.length ? notes[i + 1].beat : total;
    let end;
    if (nt.cellDur != null) end = Math.min(nt.beat + nt.cellDur, next);
    else if (nt.holdTo != null) end = Math.min(nt.holdTo, next);
    else if (i === notes.length - 1) end = total - tpl.breath;
    else end = next;
    nt.dur = Math.max(end - nt.beat, Math.min(0.125, (next - nt.beat) / 2));
  });
}

function classify(tpl, nt) {
  const bar = Math.floor(nt.beat / BAR + EPS);
  const inBar = nt.beat - bar * BAR;
  const anticipates = inBar >= 3.5 - EPS && nt.beat + nt.dur > (bar + 1) * BAR + EPS;
  nt.bar = bar;
  nt.harmonyBar = anticipates ? bar + 1 : bar;
  const strongBeat = tpl.strongBeats ? tpl.strongBeats.some((b) => Math.abs(inBar - b) < EPS) : Math.abs(inBar) < EPS || Math.abs(inBar - 2) < EPS;
  nt.strong = strongBeat || (tpl.longIsStrong !== false && nt.dur >= 1.5 - EPS) || Boolean(nt.final) || anticipates;
}

/** The making-of's sung talk: the shortest a syllable is, onset to onset (tune beats: 0.26 s at the making-of's tempo). */
export const TALK_MIN_IOI = 0.75;

/** Beats of silence after a cadence's last note. */
const CADENCE_RELEASE = 0.25;

/** The home bar: the line lands on a long note on beat 3 (alone: the downbeat), held to the release (Melody.CadenceRhythm). */
function cadenceRhythm(tpl, notes, home) {
  if (!notes.length) return;
  const b0 = home * BAR, end = b0 + BAR - CADENCE_RELEASE;
  let first = notes.findIndex((nt) => nt.beat >= b0 - EPS);
  if (first < 0) first = notes.length - 1;
  const inBar = notes.slice(first), pre = inBar.slice(0, -1), land = inBar[inBar.length - 1];
  const landAt = pre.length ? b0 + 2 : b0;
  if (!pre.every((nt) => nt.beat >= b0 - EPS && nt.beat <= landAt - 0.25 + EPS)) {
    const raw = (landAt - b0) / pre.length;
    const step = pre.length <= 8 ? Math.max(0.25, Math.floor(raw * 4 + EPS) / 4) : raw;
    pre.forEach((nt, k) => { nt.beat = b0 + k * step; });
  }
  pre.forEach((nt, k) => {
    const next = k + 1 < pre.length ? pre[k + 1].beat : landAt;
    nt.dur = Math.max(Math.min(nt.dur, next - nt.beat), Math.min(0.125, (next - nt.beat) / 2));
    nt.final = false;
  });
  Object.assign(land, { beat: landAt, dur: end - landAt, final: true, cadence: true });
  if (first > 0) {
    const prev = notes[first - 1], cut = inBar[0].beat;
    if (prev.beat + prev.dur > cut - EPS) prev.dur = Math.max(cut - prev.beat, 0.125);
  }
  for (let i = Math.max(0, first - 1); i < notes.length; i++) {
    classify(tpl, notes[i]);
    if (notes[i].cadence) notes[i].harmonyBar = home;
    if (notes[i].bar === home && notes[i].harmonyBar > home) notes[i].harmonyBar = home;
  }
}

/** Where a reply starts in its bar (beats): beat 3, when the tune's line is done (MelodyReply.cs REPLY_START). */
export const REPLY_START = 2.0;
/**
 * A breath (beats) between the storyteller's last note and the pal's reply: the two voices heard apart
 * (sung right on beat 3, the reply runs into the line's last word). Its shapes are squeezed after it.
 */
export const REPLY_BREATH = 0.5;

/**
 * A cadence that leaves the home bar's second half to the echo's reply (Melody.CadenceGapRhythm):
 * the last note lands where the template has it, no later than the bar's middle, and ends there.
 */
function cadenceGapRhythm(tpl, notes, home) {
  if (!notes.length) return;
  const b0 = home * BAR, mid = b0 + REPLY_START, land = notes[notes.length - 1];
  if (land.beat > mid - 0.5 + EPS) land.beat = Math.max(b0, mid - 1);
  if (land.beat + land.dur > mid + EPS) land.dur = mid - land.beat;
  for (let i = notes.length - 2; i >= 0 && notes[i].beat + notes[i].dur > land.beat + EPS; i--) notes[i].dur = Math.max(0.125, land.beat - notes[i].beat);
  land.final = true;
  land.cadence = true;
  classify(tpl, land);
}

// ------------------------------------------------------------------ pitch

const LEAD_W = { prev: 0.2, leap: 7, leapCost: 2, tritone: 1.5 };
const ROLE_W = { prev: 0.5, leap: 5, leapCost: 2, tritone: 0 };

function pick(pcs, target, prev, low, high, w) {
  let best = null, bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (!pcs.includes(mod12(m))) continue;
    let cost = Math.abs(m - target);
    if (prev !== null) {
      const leap = Math.abs(m - prev);
      cost += w.prev * leap + (leap > w.leap ? w.leapCost : 0) + (leap === 6 ? w.tritone : 0);
    }
    if (cost < bestCost - 1e-9) { best = m; bestCost = cost; }
  }
  return best;
}

function stepFrom(m, pcs, dir, low, high) {
  for (let x = m + dir; x >= low && x <= high; x += dir) if (pcs.includes(mod12(x))) return x;
  return null;
}

/** A semitone above a chord tone, or the tritone over a chord without one: grates against the held chord. */
function isAvoid(pc, chord) {
  const tones = chord.tones;
  if (tones.includes(pc)) return false;
  if (tones.some((t) => mod12(pc - t) === 1)) return true;
  const hasTritone = tones.some((a) => tones.some((b) => mod12(a - b) === 6));
  return !hasTritone && mod12(pc - tones[0]) === 6;
}

/** The home-chord tone a role holds at the cadence (a seventh resolves down to the third). */
const cadenceTone = (chord, role) => (role === 'seventh' ? chord.tones[1] : roleTone(chord, role));

function nearestPc(pc, m, low, high) {
  let best = null;
  for (let x = low; x <= high; x++) if (mod12(x) === pc && (best === null || Math.abs(x - m) < Math.abs(best - m))) best = x;
  return best ?? m;
}

function approachNote(current, before, tonic, chord, dominant, home, key, low, high, strong) {
  const root = home.tones[0];
  const scale = chordScale(chord, key);
  const has = (pc) => scale.includes(pc) || dominant.tones.includes(pc);
  const below = has(mod12(root - 1)) ? -1 : -2, above = has(mod12(root + 2)) ? 2 : 1;
  const ref = before ?? current;
  const homes = tonic !== null ? [tonic] : [nearestPc(root, current, low, high)];
  let best = current, bestCost = Infinity;
  for (const t of homes) {
    for (const [d, bias] of [[below, 0], [above, 0.5]]) {
      const m = t + d;
      if (m < low || m > high || (strong && !chord.tones.includes(mod12(m)))) continue;
      const cost = Math.abs(m - ref) + bias;
      if (cost < bestCost - 1e-9) { best = m; bestCost = cost; }
    }
  }
  return best;
}

/** The lead's note before the landing leads into the home root by step (Melody.ApplyApproach). */
function applyApproach(out, notes, ctx) {
  if (ctx.role !== 'lead' || !ctx.cadence) return;
  const f = notes.findIndex((nt) => nt.cadence);
  const p = f >= 0 ? f - 1 : ctx.cadence.approachOnly ? notes.length - 1 : -1;
  if (p < 0) return;
  out[p] = approachNote(out[p], p > 0 ? out[p - 1] : null, f >= 0 ? out[f] : null, ctx.chordAt(notes[p].harmonyBar),
    ctx.chordAt(ctx.cadence.homeBar - 1), ctx.cadence.homeChord, ctx.key, ctx.low, ctx.high, notes[p].strong);
}

function landingPitch(ctx, nt, prev) {
  const chord = ctx.chordAt(nt.harmonyBar);
  return ctx.role === 'lead'
    ? pick([chord.tones[0]], ctx.centre, prev, ctx.low, ctx.high, LEAD_W)
    : pick([cadenceTone(chord, ctx.role)], ctx.centre, prev, ctx.low, ctx.high, ROLE_W);
}

/** Where a child lead's do..la window is centred (MIDI): its mi nearest E4/F4. */
const CHILD_CENTRE = 64.5;

/**
 * The do (MIDI) of a child lead line in `key` for a voice: the tonic whose mi is nearest CHILD_CENTRE
 * (+ octaves) among those whose window (do - 1 .. do + 9) fits the voice, else the one overlapping it
 * most (Melody.ChildDo: a basso, a crooner, a robo sing the tune an octave down).
 */
export function childDo(key, octave, low, high) {
  const tonic = keyPc(key);
  const want = CHILD_CENTRE + 12 * (Number(octave) || 0) - 4;
  const r = (want - tonic) / 12;
  const near = tonic + 12 * (r < 0 ? -Math.round(-r) : Math.round(r));
  let best = near, bestCost = Infinity;
  for (const d of [near, near - 12, near + 12]) {
    const overlap = Math.min(d + 9, high) - Math.max(d - 1, low);
    const fits = d - 1 >= low && d + 9 <= high;
    const cost = (fits ? 0 : 100 - overlap) + Math.abs(d - want) / 12;
    if (cost < bestCost - 1e-9) { best = d; bestCost = cost; }
  }
  return best;
}

function childWindow(key, octave, low, high) {
  const d = childDo(key, octave, low, high);
  const lo = Math.max(low, d - 1), hi = Math.min(high, d + 9);
  return lo <= hi ? { lo, hi } : { lo: low, hi: high };
}

/**
 * The child melodies' figures (MelodyChild.cs CHILD_FIGURES): per tune, the asking lines' (1 and 3 of a
 * stanza) and the answering lines' (2 and 4, lower, heading home) first-bar figure, [beat in the bar,
 * semitones above do]; the last entry at or before a note's beat applies.
 */
const CHILD_FIGURES = {
  nursery: [[[0, 7], [1, 9], [2, 7], [3, 4]], [[0, 7], [1, 5], [2, 4], [3, 2]]],
  bouncy: [[[0, 0], [1, 4], [2, 7], [3, 9]], [[0, 4], [1, 7], [2, 4], [3, 2]]],
  rocking: [[[0, 4], [1.5, 7], [2, 4], [3, 2]], [[0, 7], [1.5, 4], [2, 4], [3, 2]]],
  march: [[[0, 0], [1, 0], [2, 7], [3, 7]], [[0, 9], [1, 7], [2, 5], [3, 4]]],
  risefall: [[[0, 0], [1, 2], [2, 4], [3, 5]], [[0, 9], [1, 7], [2, 5], [3, 4]]],
  arch: [[[0, 4], [1.5, 7], [2, 9], [3, 7]], [[0, 7], [1.5, 5], [2, 4], [3, 2]]],
  chant: [[[0, 7], [0.5, 4], [1.5, 7], [3, 4]], [[0, 9], [0.5, 7], [1.5, 4], [3, 2]]],
  pentatonic: [[[0, 9], [1, 7], [2, 4], [3, 7]], [[0, 4], [1, 2], [2, 4], [3, 2]]],
  anthem: [[[0, 4], [1, 7], [2, 7], [3, 9]], [[0, 9], [1, 7], [2, 4], [3, 2]]],
  callback: [[[0, 7], [0.5, 7], [1, 4], [1.5, 4]], [[0, 9], [0.5, 7], [1, 5], [1.5, 4]]],
};
/** The scale steps a closing bar walks down to do (mi re do, fa mi re do ...). */
const CHILD_DOWN = [0, 2, 4, 5, 7, 9];

/**
 * A child lead line's pitches (Melody.PitchChild): a child's range (do - 1 .. la), the playground chant;
 * lines 1 and 3 of a stanza ask (end up on so; the anthem holds the high la), 2 and 4 answer (home to do
 * down the scale). Strong notes take the chord's tone nearest the figure, the others the figure's note
 * unless it rubs against the chord. A role (harmony, pad ...) sings its chord tone.
 */
function pitchChild(notes, ctx) {
  const out = new Array(notes.length).fill(null);
  if (ctx.role !== 'lead') {
    let p = null;
    notes.forEach((nt, i) => {
      out[i] = nt.cadence ? landingPitch(ctx, nt, p) : pick([roleTone(ctx.chordAt(nt.harmonyBar), ctx.role)], ctx.centre, p, ctx.low, ctx.high, ROLE_W);
      p = out[i];
    });
    return out;
  }
  const doM = childDo(ctx.key, ctx.octave, ctx.low, ctx.high);
  const { lo, hi } = childWindow(ctx.key, ctx.octave, ctx.low, ctx.high);
  const w = { ...ctx, low: lo, high: hi, centre: doM };
  const [asksFig, answersFig] = CHILD_FIGURES[ctx.tpl.child] ?? CHILD_FIGURES.nursery;
  const askEnd = ctx.tpl.child === 'anthem' ? 9 : 7;
  const closing = (nt, i) => ctx.bars === 1 || nt.bar % 2 === 1 || (ctx.closeLast && i === notes.length - 1);
  let prev = null;
  notes.forEach((nt, i) => {
    const chord = ctx.chordAt(nt.harmonyBar);
    if (nt.cadence) { out[i] = landingPitch(w, nt, prev); prev = out[i]; return; }
    const unitBar = nt.bar - (nt.bar % 2);
    const asks = Math.floor((ctx.startBar + unitBar) / 2) % 2 === 0;
    let step;
    if (closing(nt, i)) {
      let left = 0;
      for (let j = i + 1; j < notes.length && notes[j].bar - (notes[j].bar % 2) === unitBar && closing(notes[j], j); j++) left++;
      step = asks ? (left % 2 === 0 ? askEnd : askEnd === 9 ? 7 : 9) : CHILD_DOWN[Math.min(left, CHILD_DOWN.length - 1)];
    } else {
      const fig = asks ? asksFig : answersFig;
      const inBar = nt.beat - nt.bar * BAR;
      step = fig[0][1];
      for (const [b, s] of fig) if (b <= inBar + EPS) step = s;
    }
    const target = doM + step;
    let pcs = nt.strong ? chord.tones : [...new Set([...chordScale(chord, ctx.key), ...chord.tones])];
    // closeLast: the line's last note asks (so, the anthem's la) or answers (do) when its chord has that tone
    if (ctx.closeLast && i === notes.length - 1) {
      const end = (asks ? [askEnd, 7] : [0]).find((x) => chord.tones.includes(mod12(x)));
      if (end !== undefined) pcs = [mod12(end)];
    }
    let best = null, bestCost = Infinity;
    for (let m = lo; m <= hi; m++) {
      const pc = mod12(m);
      if (!pcs.includes(pc)) continue;
      let cost = Math.abs(m - target) + (!nt.strong && isAvoid(pc, chord) ? 4 : 0);
      if (prev !== null) {
        const leap = Math.abs(m - prev);
        cost += 0.5 * Math.max(0, leap - 2) + (leap > 5 ? 2 : 0);
      }
      if (cost < bestCost - 1e-9) { best = m; bestCost = cost; }
    }
    out[i] = best ?? pick(chord.tones, target, prev, ctx.low, ctx.high, LEAD_W);
    prev = out[i];
  });
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = pick(ctx.chordAt(notes[i].harmonyBar).tones, doM, i > 0 ? out[i - 1] : null, ctx.low, ctx.high, LEAD_W);
  }
  applyApproach(out, notes, w);
  return out;
}

/** A role part's pitches on a backing template: its chord tone (staccato repeats it, the arpeggio climbs the chord). */
function pitchRole(notes, ctx) {
  const out = new Array(notes.length).fill(null);
  const tone = (chord) => (ctx.role === 'lead' ? chord.tones[0] : roleTone(chord, ctx.role));
  let prev = null;
  notes.forEach((nt, i) => {
    if (!nt.strong) return;
    const chord = ctx.chordAt(nt.harmonyBar);
    out[i] = nt.cadence ? landingPitch(ctx, nt, prev) : pick([tone(chord)], ctx.centre, prev, ctx.low, ctx.high, ROLE_W);
    prev = out[i];
  });
  notes.forEach((nt, i) => {
    if (out[i] !== null) return;
    const chord = ctx.chordAt(nt.harmonyBar);
    const before = i > 0 ? out[i - 1] : null;
    const anchor = pick([tone(chord)], ctx.centre, before, ctx.low, ctx.high, ROLE_W);
    let m = null;
    if (ctx.tpl.motion === 'repeat') m = before;
    else if (ctx.tpl.motion === 'arp' && before !== null) m = stepFrom(before, chord.tones, 1, ctx.low, ctx.high) ?? stepFrom(before, chord.tones, -1, ctx.low, ctx.high);
    out[i] = m ?? anchor;
  });
  return out.map((m) => m ?? Math.round(ctx.centre));
}

const toChord = (c, key) => (c && typeof c === 'object' && Array.isArray(c.tones) ? c : chordFromRoman(typeof c === 'string' ? c : 'I', key));

/**
 * One line of notes on a template of this module (a child tune, or a backing template). Options as
 * the engine's generateNotes: melody, syllableCount, syllables (syllabify output: sub-phrases split at
 * words), chords (romans, indexed from bar 0 of the section: `startBar` picks the line's), role,
 * octave, voice, key, tempo, startBar, cadenceBar (the section bar of a cadence's home chord),
 * cadenceGap (the line lands by the home bar's middle: a reply follows it there), minBars, closeLast (a child
 * tune's last note closes its unit, asking or answering, wherever it falls: a short line held over its last bars).
 * @returns {{notes: Array<{t:number, dur:number, midi:number, bar:number, beat:number, strong:boolean}>, bars:number}}
 */
export function tuneNotes({
  melody, syllableCount = 0, syllables = null, chords = ['I'], role = 'lead', octave = 0, voice = 'woman', key = 'C', tempo = 96,
  startBar = 0, cadenceBar = null, cadenceGap = false, minBars = 0, stress = null, closeLast = false, talk = false, hold = null,
} = {}) {
  const tpl0 = TUNE_TEMPLATES[melody];
  const n = Math.max(0, Math.floor(Number(syllableCount) || 0));
  if (!tpl0 || !n) return { notes: [], bars: 0 };
  // talk (the making-of): nothing quicker than a tune beat; hold: syllables (a crewmate's name) on a bar line, held
  const tpl = talk && tpl0.family === 'phrase' ? talkTemplate(tpl0) : tpl0;
  const held = tpl.talk && hold?.length ? new Set(hold.filter((k) => k >= 0 && k < n)) : null;
  const bars = held ? holdBars(melody, n, minBars, [...held], syllables) : tuneBars(melody, n, minBars, { talk: Boolean(tpl.talk) });
  const words = Array.isArray(syllables) && syllables.length === n ? syllables.map((s) => s.wordIndex) : null;
  // the words' stress (as the engine's generateNotes): sub-phrases split for them, onsets fitted below
  const fitted = Array.isArray(stress) && stress.length === n ? stress : null;
  let fit = tpl.family === 'phrase' && fitted ? fitPhraseSplit(tpl, n, bars, syllables, fitted) : null;
  if (held) fit = holdSplit(tpl, n, bars, held, words, fit) ?? fit;
  const notes = tpl.family === 'phrase' ? layoutPhrase(tpl, n, bars, words, fit, held) : layoutBars(tpl, n, bars);
  finishDurations(tpl, notes, bars * BAR);
  // a name that ends the line is held there (two tune beats, to the bar's end at most)
  if (held?.has(n - 1)) {
    const last = notes[n - 1], barEnd = (Math.floor(last.beat / BAR + EPS) + 1) * BAR;
    last.dur = Math.max(last.dur, Math.min(2, barEnd - last.beat));
  }
  for (const nt of notes) { nt.final = Boolean(nt.final); classify(tpl, nt); }
  const list = (Array.isArray(chords) && chords.length ? chords : ['I']).map((c) => toChord(c, key));
  const chordAt = (bar) => list[(((startBar + bar) % list.length) + list.length) % list.length];
  const { low, high } = voiceRange(voice);
  const offset = role === 'bass' ? -12 : role === 'octave' ? 12 : 0;
  const centre = voiceCentre(voice, octave, offset) + (tpl.centreShift ?? 0);
  let cadence = null;
  if (Number.isInteger(cadenceBar)) {
    const homeBar = cadenceBar - startBar;
    if (homeBar === bars - 1) {
      if (cadenceGap) cadenceGapRhythm(tpl, notes, homeBar);
      else cadenceRhythm(tpl, notes, homeBar);
      cadence = { homeBar, homeChord: chordAt(homeBar), approachOnly: false };
    } else if (homeBar === bars) cadence = { homeBar, homeChord: chordAt(homeBar), approachOnly: true };
  }
  const ctx = { tpl, role, low, high, centre, chordAt, key, bars, cadence, startBar, octave, closeLast };
  const midi = tpl.child ? pitchChild(notes, ctx) : pitchRole(notes, ctx);
  // StressFit (the pitches stay): onsets move at most half a beat so stressed syllables take the accents
  // (talk: a quarter of a tune beat at most, no syllable shorter than TALK_MIN_IOI; a held name stays as it is)
  const shift = fitted ? applyStressFit(notes, held ? fitted.map((x, i) => (held.has(i) ? 2 : x)) : fitted,
    tpl.talk ? { minIoi: TALK_MIN_IOI, steps: [0, -0.25, 0.25], keepSpan: true } : undefined) : null;
  const beatSec = 60 / (Number(tempo) > 0 ? Number(tempo) : 96);
  return {
    bars,
    notes: notes.map((nt, i) => ({
      t: nt.beat * beatSec, dur: nt.dur * beatSec, midi: midi[i], bar: nt.bar, beat: nt.beat, strong: nt.strong, shift: shift ? shift[i] : 0,
    })),
  };
}

/**
 * Notes for any melody id: this module's templates, else the engine's generateNotes (the options pass
 * through as they are). Drop-in for the engine's generateNotes.
 */
export function notesFor(opts) {
  return TUNE_TEMPLATES[opts?.melody] ? tuneNotes(opts) : engineNotes(opts);
}

// ------------------------------------------------------------------ pickups (Compile.cs)

/** A pickup's notes, in beats (eighth notes, legato into the line's first note). */
export const PICKUP_NOTE_BEATS = 0.5;
/** A line before a pickup ends at least this many beats before it. */
export const PICKUP_GAP_BEATS = 0.1;
/** The shortest a line's last note may become to make room for the next line's pickup (beats). */
export const PICKUP_MIN_LAST_BEATS = 0.25;
/** The most pickup syllables sung (more: the pickup is not sung on its own notes). */
export const MAX_PICKUP_SYLLABLES = 3;

/**
 * The pickup's pitches leading into `first` (Compile.PickupPitches): up the key's scale to a step
 * below it; when one rubs against the chord under the pickup (a semitone or tritone from one of its
 * tones), the pickup that steps into a note at most a fourth below `first` (or onto it) rubbing least.
 */
export function pickupPitches(first, count, key, low, high, chordTones = null) {
  const scale = scalePcs(key);
  const inScale = (m) => scale.includes(mod12(m));
  let plain = null;
  const below = [];
  for (let m = first - 1; m >= low && below.length < count; m--) if (inScale(m)) below.push(m);
  if (below.length === count) plain = below.reverse();
  if (!plain) {
    const above = [];
    for (let m = first + 1; m <= high && above.length < count; m++) if (inScale(m)) above.push(m);
    plain = above.length === count ? above.reverse() : Array(count).fill(first);
  }
  if (!chordTones?.length) return plain;
  const rubs = (m) => chordTones.some((t) => [1, 6, 11].includes(mod12(m - t)));
  const cost = (s) => s.reduce((c, m, i) => c + (rubs(m) ? (i === s.length - 1 ? 3 : 1) : 0), 0);
  if (cost(plain) === 0) return plain;
  let best = plain, bestCost = cost(plain) * 10;
  for (let d = 0; d <= 5; d++) {
    const last = first - d;
    if (last < low || last > high || (d > 0 && !inScale(last))) continue;
    const s = new Array(count);
    s[count - 1] = last;
    let ok = true;
    for (let i = count - 2; i >= 0 && ok; i--) {
      let m = s[i + 1] - 1;
      while (m >= low && !inScale(m)) m--;
      if (m < low) ok = false;
      else s[i] = m;
    }
    if (!ok) continue;
    const distance = d === 1 || d === 2 ? 0 : d === 3 || d === 4 ? 0.5 : d === 0 ? 0.75 : 1;
    const c = cost(s) * 10 + distance;
    if (c < bestCost - 1e-9) { best = s; bestCost = c; }
  }
  return best;
}

// ------------------------------------------------------------------ the echo (StorySong.cs EchoOf, MelodyReply.cs)

const WEAK_STARTS = new Set(['the', 'a', 'an', 'it', 'and', 'who', 'that', 'so', 'but']);

/**
 * The words an echo repeats of `line` (Factory.EchoOf): its last word, with the words before it while
 * they add up to three sung syllables at most (across a comma only while the echo is one syllable),
 * not starting on a weak word (an article, "it", "and" ...) unless leaving it out leaves one syllable.
 * "Flip, flip, pancake!" -> "Pancake"; "Stars above the fence" -> "The fence".
 */
export function echoOf(line) {
  const s = String(line ?? '');
  const words = [...s.matchAll(/[A-Za-z][A-Za-z']*/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, word: m[0] }));
  if (!words.length) return '';
  const count = (k) => Math.max(1, syllabify(words[k].word).length);
  let from = words.length - 1, syll = count(from);
  while (from > 0) {
    const n = count(from - 1);
    const comma = s.slice(words[from - 1].end, words[from].start).includes(',');
    if (syll + n > 3 || (comma && syll > 1)) break;
    syll += n;
    from--;
  }
  while (from < words.length - 1 && WEAK_STARTS.has(words[from].word.toLowerCase()) && syll - count(from) > 1) {
    syll -= count(from);
    from++;
  }
  const tail = s.slice(words[from].start).replace(/[.!?,\s]+$/, '');
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** A reply ends this many beats before the storyteller's next note. */
const REPLY_GAP = 0.15;
/** Beat (in the bar) by which an echo's last note ends: before the next line's downbeat. */
const ECHO_END = 3.85;
const REPLY_MIN_NOTE = 0.25;

// the shapes' rhythms over the whole gap (beat 2 .. 3.85), for 1..5 notes: [beat in the bar, beats long]
const REPLY_EVEN = [[[2, 1.75]], [[2, 1], [3, 0.75]], [[2, 0.5], [2.5, 0.5], [3, 0.75]], [[2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.35]], [[2, 0.25], [2.25, 0.25], [2.5, 0.5], [3, 0.5], [3.5, 0.35]]];
const REPLY_DOTTED = [[[2, 1.75]], [[2, 1.5], [3.5, 0.35]], [[2, 0.75], [2.75, 0.25], [3, 0.75]], [[2, 0.75], [2.75, 0.25], [3, 0.5], [3.5, 0.35]], [[2, 0.75], [2.75, 0.25], [3, 0.25], [3.25, 0.25], [3.5, 0.35]]];
const REPLY_QUICK = [[[2, 1]], [[2, 0.25], [2.25, 1.5]], [[2, 0.25], [2.25, 0.25], [2.5, 1.25]], [[2, 0.25], [2.25, 0.25], [2.5, 0.25], [2.75, 1]], [[2, 0.25], [2.25, 0.25], [2.5, 0.25], [2.75, 0.25], [3, 0.75]]];
const REPLY_LATE = [[[2.5, 1.25]], [[2.5, 0.5], [3, 0.75]], [[2.5, 0.25], [2.75, 0.25], [3, 0.75]], [[2.5, 0.25], [2.75, 0.25], [3, 0.5], [3.5, 0.35]], [[2.5, 0.25], [2.75, 0.25], [3, 0.25], [3.25, 0.25], [3.5, 0.35]]];
const REPLY_SLOW = [[[2, 1.85]], [[2, 1.25], [3.25, 0.6]], [[2, 1], [3, 0.4], [3.4, 0.45]], [[2, 0.75], [2.75, 0.5], [3.25, 0.25], [3.5, 0.35]], [[2, 0.5], [2.5, 0.5], [3, 0.25], [3.25, 0.25], [3.5, 0.35]]];

function replyTemplate(shape, n) {
  const table = ['sixth', 'stepdown', 'rise'].includes(shape) ? REPLY_DOTTED : shape === 'stepup' ? REPLY_QUICK
    : shape === 'fragment' ? REPLY_LATE : ['sigh', 'augment'].includes(shape) ? REPLY_SLOW : REPLY_EVEN;
  if (shape === 'neighbor' && n === 2) return [[2, 0.5], [2.5, 1.25]];
  if (n >= 1 && n <= table.length) return table[n - 1];
  const span = ECHO_END - REPLY_START;
  return Array.from({ length: n }, (_, i) => [REPLY_START + (span * i) / n, span / n]);
}

/** A rhythm made for the whole gap fitted into [s, e]: as it is when it fits, else squeezed (MelodyReply.FitRhythm). */
function fitRhythm(r, s, e) {
  const n = r.length;
  const end = r[n - 1][0] + r[n - 1][1];
  if (end <= e + EPS && r[0][0] >= s - EPS) return r.map((x) => [...x]);
  const k = (e - s) / Math.max(EPS, end - REPLY_START);
  const onGrid = (grid) => {
    const x = [];
    for (let i = 0; i < n; i++) {
      let at = s + (r[i][0] - REPLY_START) * k;
      at = Math.round(at / grid) * grid;
      if (i > 0 && at < x[i - 1][0] + grid - EPS) at = x[i - 1][0] + grid;
      x.push([at, r[i][1] * k]);
    }
    return x;
  };
  let o = onGrid(0.25);
  if (o[n - 1][0] > e - REPLY_MIN_NOTE + EPS) o = onGrid(0.125);
  if (o[n - 1][0] > e - 0.1 + EPS) o = Array.from({ length: n }, (_, i) => [s + ((e - s) * i) / n, (e - s) / n]);
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? o[i + 1][0] : e;
    o[i][1] = Math.max(Math.min(o[i][1], next - o[i][0]), Math.min(0.05, next - o[i][0]));
  }
  return o;
}

/** The lead's own rhythm for its last n notes, from the gap's start (squeezed), or null (MelodyReply.ReplyLeadRhythm). */
function replyLeadRhythm(beats, n, s, e) {
  if (n < 2 || beats.length < n) return null;
  const offs = beats.map((b) => b - beats[0]);
  const span = offs[n - 1];
  if (!(span > EPS)) return null;
  const room = Math.min(1.25, e - s - 0.35);
  if (room < (n - 1) * REPLY_MIN_NOTE - EPS) return null;
  const scale = span > room ? room / span : 1;
  const o = [];
  for (let i = 0; i < n; i++) {
    let at = s + Math.round(offs[i] * scale * 4) / 4;
    if (i > 0 && at <= o[i - 1][0] + EPS) at = o[i - 1][0] + 0.25;
    o.push([at, 0]);
  }
  if (o[n - 1][0] > e - 0.3 + EPS) return null;
  for (let i = 0; i < n; i++) o[i][1] = Math.max(0.2, (i + 1 < n ? o[i + 1][0] : e) - o[i][0]);
  return o;
}

/** The shape an echo sings on its answer number `index` of a section whose first shape is `first` (Melody.EchoShapeOf). */
export const echoShape = (first, index) => ECHO_SHAPES[(((first + index) % ECHO_SHAPES.length) + ECHO_SHAPES.length) % ECHO_SHAPES.length];

/**
 * The echo's line in the gap after a storyteller's line (MelodyReply.cs ReplyLine): its reply's words
 * (or the line's end), one bar long, its notes from beat 3 of the bar to the storyteller's next note
 * (less a breath), shaped on the notes the storyteller just sang there (repeat, third, fragment ...),
 * then fitted: the gap's downbeat, the last and any long note on the bar's chord, the others in its
 * scale and never a semitone above a chord tone, in the singer's child window.
 * answering: [{ beat, midi }] the storyteller's notes in the echo's bar (beats from its downbeat, the
 * pickup aside); answerEnd: beats from the bar's downbeat where the next line (its pickup) starts.
 * @returns {{notes: Array, bars: 1} | null}
 */
export function replyNotes({ shape = 'repeat', syllableCount = 0, chord = 'I', voice = 'woman', key = 'C', tempo = 96, octave = 0,
  answering = null, answerEnd = null, answerIndex = 0 } = {}) {
  const n = Math.max(0, Math.floor(Number(syllableCount) || 0));
  if (n < 1 || !ECHO_SHAPES.includes(shape)) return null;
  const ch = toChord(chord, key);
  const { low: vlow, high: vhigh } = voiceRange(voice);
  const doMidi = childDo(key, octave, vlow, vhigh);
  let low = Math.max(vlow, doMidi - 1), high = Math.min(vhigh, doMidi + 12);
  if (high - low < 9) { low = vlow; high = vhigh; }
  const scale = scalePcs(key), cScale = chordScale(ch, key);
  const isChord = (m) => ch.tones.includes(mod12(m));
  const inScale = (m) => scale.includes(mod12(m));
  const inChordScale = (m) => cScale.includes(mod12(m)) && !isAvoid(mod12(m), ch);
  const fits = (ms) => ms.every((m) => m >= low && m <= high);
  const step = (m, k) => {
    let x = m;
    while (!inScale(x)) x--;
    const dir = Math.sign(k);
    for (let i = 0; i < Math.abs(k); i++) { x += dir; while (!inScale(x)) x += dir; }
    return x;
  };
  const degree = (m) => {
    let x = m;
    while (!inScale(x)) x--;
    let d = 0;
    for (let y = 0; y < x; y++) if (inScale(y)) d++;
    return d;
  };
  const nearestChord = (m, dir = 1, not = null) => {
    let best = null, bestCost = Infinity;
    for (let x = low - 12; x <= high + 12; x++) {
      if (!isChord(x)) continue;
      const cost = Math.abs(x - m) + (x < low || x > high ? 50 : 0) + (Math.sign(x - m) === (dir >= 0 ? 1 : -1) ? 0 : 0.1) + (not !== null && x === not && x !== m ? 1.5 : 0);
      if (cost < bestCost - 1e-9) { best = x; bestCost = cost; }
    }
    return best ?? m;
  };
  const nextChord = (m, dir) => {
    for (let x = m + dir; x >= low - 12 && x <= high + 12; x += dir) if (isChord(x)) return x;
    return m;
  };
  const path = (a, b, count) => {
    if (count === 1) return [b];
    const d = degree(b) - degree(a);
    return Array.from({ length: count }, (_, i) => (i === count - 1 ? b : i === 0 ? a : step(a, Math.round((d * i) / (count - 1)))));
  };
  const s = REPLY_START + REPLY_BREATH;
  let e = Math.min(ECHO_END, (answerEnd ?? BAR) - REPLY_GAP);
  if (e < s + 0.05) e = s + 0.05;

  // the notes answered: the lead's last n, moved by octaves into the window; none: so fa re falling to do's chord
  const lead = (answering ?? []).slice().sort((a, b) => a.beat - b.beat);
  let src = [], srcBeats = [];
  if (lead.length) {
    for (let i = Math.max(0, lead.length - n); i < lead.length; i++) { src.push(lead[i].midi); srcBeats.push(lead[i].beat); }
    while (src.length < n) { src.unshift(src[0]); srcBeats.unshift(srcBeats[0] - 0.5); }
  } else {
    const top = nearestChord(doMidi + 7);
    for (let i = 0; i < n; i++) src.push(i === n - 1 ? nearestChord(step(top, -2 * i), -1) : step(top, -2 * i));
  }
  const centre = (low + high) / 2;
  const avg = src.reduce((a, b) => a + b, 0) / src.length;
  const r = (centre - avg) / 12;
  const shift = 12 * (r < 0 ? -Math.round(-r) : Math.round(r));
  src = src.map((m) => m + shift);
  const before = lead.length > n ? lead[lead.length - n - 1].midi + shift : src[0];
  const last = src[n - 1], first = src[0];

  let pitches;
  switch (shape) {
    case 'repeat': case 'augment': pitches = [...src]; break;
    case 'third': { const up = src.map((m) => step(m, 2)); pitches = fits(up) ? up : src.map((m) => step(m, -2)); break; }
    case 'sixth': {
      const down = src.map((m) => step(m, -5)), up = src.map((m) => step(m, 5));
      pitches = fits(down) ? down : fits(up) ? up : src.map((m) => step(m, -2));
      break;
    }
    case 'invert': {
      const d0 = degree(first);
      pitches = src.map((m) => step(first, -(degree(m) - d0)));
      if (pitches.every((m, i) => m === src[i])) pitches = Array.from({ length: n }, (_, i) => step(first, i === n - 1 && n > 1 ? -1 : i));
      break;
    }
    case 'fragment': {
      let a = n >= 2 ? src[n - 2] : lead.length >= 2 ? lead[lead.length - 2].midi + shift : last;
      const b = last;
      if (a === b) a = nextChord(b, 1);
      pitches = Array.from({ length: n }, (_, i) => ((n - 1 - i) % 2 === 0 ? b : a));
      break;
    }
    case 'sigh': {
      const top = nextChord(last + 2, 1), bottom = nextChord(top, -1);
      const down = n === 1 ? [top] : path(top, bottom, Math.min(n, 3));
      pitches = [...Array(n - down.length).fill(top), ...down];
      break;
    }
    case 'stepup': pitches = src.map((m) => step(m, 1)); break;
    case 'stepdown': pitches = src.map((m) => step(m, -1)); break;
    case 'answer': {
      let dir = last < before ? 1 : -1, root = null;
      for (const d of [dir, -dir]) {
        for (let x = last + d; x >= low && x <= high && root === null; x += d) if (mod12(x) === ch.tones[0]) root = x;
        if (root !== null) { dir = d; break; }
      }
      const end = root ?? nearestChord(last, dir);
      pitches = n === 1 ? [end] : path(nextChord(end, -dir), end, n);
      break;
    }
    case 'neighbor': {
      const x = nearestChord(last);
      let up = step(x, 1);
      if (isAvoid(mod12(up), ch)) up = step(up, 1);
      let down = step(x, -1);
      if (isAvoid(mod12(down), ch)) down = step(down, -1);
      const turn = [x, up, x, down, x];
      pitches = n === 2 ? [x, nextChord(x, 1)] : Array.from({ length: n }, (_, i) => turn[i % turn.length]);
      break;
    }
    case 'rise': {
      const bottom = nextChord(first + 1, -1);
      let topOpen = nextChord(bottom, 1);
      if (mod12(topOpen) === ch.tones[0] && nextChord(topOpen, 1) - bottom <= 7) topOpen = nextChord(topOpen, 1);
      pitches = n === 1 ? [topOpen] : path(bottom, topOpen, n);
      break;
    }
    default: return null;
  }

  const rhythm = (shape === 'repeat' ? replyLeadRhythm(srcBeats, n, s, e) : null) ?? fitRhythm(replyTemplate(shape, n), s, e);

  // into the window: the whole line by octaves, then any note still outside by its own octave
  let ms = [...pitches];
  for (let k = 0; k < 2 && !fits(ms); k++) {
    const dir = Math.max(...ms) > high ? -12 : 12;
    if (fits(ms.map((m) => m + dir)) || (dir < 0 ? Math.min(...ms) + dir >= low - 2 : Math.max(...ms) + dir <= high + 2)) ms = ms.map((m) => m + dir);
    else break;
  }
  for (let i = 0; i < n; i++) {
    while (ms[i] > high && ms[i] - 12 >= low) ms[i] -= 12;
    while (ms[i] < low && ms[i] + 12 <= high) ms[i] += 12;
  }

  const beatSec = 60 / (Number(tempo) > 0 ? Number(tempo) : 96);
  const fit = (want) => {
    const o = [];
    for (let i = 0; i < n; i++) {
      const [beat, dur] = rhythm[i];
      const inBar = beat % BAR;
      const strong = Math.abs(inBar) < EPS || Math.abs(inBar - 2) < EPS || i === n - 1 || dur >= 1.5 - EPS;
      let m = want[i];
      const dir = i > 0 ? Math.sign(m - want[i - 1]) : i + 1 < n ? Math.sign(want[i + 1] - m) : 1;
      const beside = o.length ? o[o.length - 1].midi : i + 1 < n ? want[i + 1] : null;
      if (strong && !isChord(m)) m = nearestChord(m, dir, beside);
      else if (!strong && !inChordScale(m)) {
        let best = null;
        for (let d = 1; d <= 3 && best === null; d++) {
          for (const x of dir >= 0 ? [m + d, m - d] : [m - d, m + d]) if (x >= low && x <= high && inChordScale(x)) { best = x; break; }
        }
        m = best ?? nearestChord(m, dir);
      }
      if (o.length) {
        const prev = o[o.length - 1].midi;
        if (m - prev > 9 && m - 12 >= low) m -= 12;
        else if (prev - m > 9 && m + 12 <= high) m += 12;
      }
      o.push({ t: beat * beatSec, dur: dur * beatSec, midi: m, bar: 0, beat, strong });
    }
    return o;
  };
  let notes = fit(ms);
  // a shape the fitting left on one note moves after all: into its last note from the chord tone above (every other answer: below)
  if (n >= 2 && notes.every((x) => x.midi === notes[0].midi) && shape !== 'augment' && shape !== 'repeat') {
    const end = notes[n - 1].midi;
    let from = nextChord(end, answerIndex % 2 === 0 ? 1 : -1);
    if (from < low || from > high) from = nextChord(end, answerIndex % 2 === 0 ? -1 : 1);
    notes = fit(path(from, end, n));
  }
  return { notes, bars: 1 };
}
