// Melody templates (schema MELODIES): rhythm + contour presets that turn a line's syllable
// count into one note per syllable over whole bars, following the block's chords.
// Deterministic: the same inputs always give the same notes.
//
// Rhythm. Every template lays the syllables on a beat grid and rounds the line up to 1, 2, 4
// or 8 bars (phrases that line up with the 8-bar block). Phrase templates (steady, lilting,
// rising, falling, syncopated) sing 2-bar sub-phrases: a fuller first bar, then a lighter
// second bar whose last syllable is held (with a breath before the next phrase). Bar
// templates (call, answer, arpeggio, bassline) give every bar its own cell; sustain holds one
// or two long notes per bar.
//
// Pitch. Strong notes (beats 1 and 3, long notes, phrase endings) are chord tones of their
// bar's chord: a chord-tone role sings its anchor (root, third, fifth, seventh, octave, bass),
// 'lead' picks the chord tone nearest the template's contour. Weak notes move by the
// template's motion (neighbour, approach, arpeggio climb, bass walk) in the key's scale with
// the chord's tones spelled in. Every note stays inside VOICES[voice].low..high.

import { BARS_PER_BLOCK, BEATS_PER_BAR, MELODIES } from '../model/schema.js';
import { chordFromRoman, chordScale, mod12, roleTone, voiceCentre, voiceRange } from './theory.js';

const BAR = BEATS_PER_BAR;
const EPS = 1e-6;
/** Possible line lengths in bars (phrases line up with the block). */
export const LINE_BARS = [1, 2, 4, 8].filter((b) => b <= BARS_PER_BLOCK);

const on = (...xs) => xs.map((x) => (Array.isArray(x) ? { at: x[0], dur: x[1] } : { at: x }));

/**
 * Cell function: c onsets inside one bar. Uses `table[c-1]` when present, else the c most
 * important positions of `dense` (sorted), else an even grid.
 */
function cells(table, dense) {
  return (c) => {
    if (c <= 0) return [];
    if (c <= table.length) return table[c - 1];
    if (c <= dense.length) return dense.slice(0, c).sort((a, b) => a - b).map((at) => ({ at }));
    return Array.from({ length: c }, (_, i) => ({ at: (i * BAR) / c }));
  };
}

/** Call / answer cells: everything inside one half of the bar, then a rest. */
function halfBar(offset) {
  const table = [
    on([0, 1.75]),
    on([0, 1], [1, 0.75]),
    on([0, 0.5], [0.5, 0.5], [1, 0.75]),
    on([0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.4]),
  ];
  return (c) => {
    if (c <= 0) return [];
    const base = c <= table.length
      ? table[c - 1]
      : Array.from({ length: c }, (_, i) => ({ at: (2 * i) / c, dur: (2 / c) * 0.9 }));
    return base.map((x) => ({ at: x.at + offset, dur: x.dur }));
  };
}

const EIGHTHS = [0, 2, 1, 3, 0.5, 2.5, 1.5, 3.5];
const STEADY_FIRST = cells([on(0), on(0, 2), on(0, 1, 2), on(0, 1, 2, 3)], EIGHTHS);
const STEADY_LAST = cells([on(0), on(0, 2), on(0, 1, 2)], [0, 1, 2, 0.5, 1.5, 3, 2.5, 3.5]);

/**
 * Template definitions. family: 'phrase' | 'bars' | 'pad'. contour: lead shape. motion: how
 * weak notes move. ending: which chord tone a lead lands on at phrase ends ('stable' = root or
 * third, 'open' = fifth or third, 'root'). finals: which notes count as phrase ends in bar
 * templates.
 */
export const TEMPLATES = {
  steady: {
    family: 'phrase', first: STEADY_FIRST, last: STEADY_LAST, maxFirst: 4, maxLast: 3, breath: 0.5,
    contour: 'arch', motion: 'hold', ending: 'stable',
  },
  lilting: {
    family: 'phrase',
    first: cells([on(0), on(0, 1.5), on(0, 1.5, 2), on(0, 1.5, 2, 3.5)], [0, 2, 1.5, 3.5, 1, 3, 0.5, 2.5]),
    last: cells([on(0), on(0, 1.5), on(0, 1.5, 2)], [0, 2, 1.5, 1, 0.5, 3, 2.5, 3.5]),
    maxFirst: 4, maxLast: 3, breath: 0.5, contour: 'wave', motion: 'neighbor', ending: 'stable',
  },
  rising: {
    family: 'phrase', first: STEADY_FIRST, last: STEADY_LAST, maxFirst: 4, maxLast: 3, breath: 0.5,
    contour: 'rise', motion: 'below', ending: 'open',
  },
  falling: {
    family: 'phrase', first: STEADY_FIRST, last: cells([on(0), on(0, 2)], [0, 2, 1, 0.5, 1.5, 3, 2.5, 3.5]),
    maxFirst: 4, maxLast: 2, breath: 0.5, contour: 'fall', motion: 'above', ending: 'root',
  },
  call: {
    family: 'bars', cell: halfBar(0), comfy: 3, breath: 0, finals: 'bar',
    contour: 'ask', motion: 'hold', ending: 'open',
  },
  answer: {
    family: 'bars', cell: halfBar(2), comfy: 3, breath: 0, finals: 'bar',
    contour: 'reply', motion: 'hold', ending: 'root',
  },
  sustain: {
    family: 'pad', cell: cells([on(0), on(0, 2), on(0, 2, 3), on(0, 1, 2, 3)], EIGHTHS), breath: 0.25,
    finals: 'line', contour: 'pad', motion: 'hold', ending: 'stable',
  },
  syncopated: {
    family: 'phrase',
    first: cells([on(0), on(0, 1.5), on(0, 1.5, 3), on(0, 1.5, 2.5, 3.5)], [0, 1.5, 3, 2.5, 3.5, 0.5, 1, 2]),
    last: cells([on(0), on(0, 1.5), on(0, 0.5, 1.5)], [0, 1.5, 0.5, 1, 2.5, 3, 2, 3.5]),
    maxFirst: 4, maxLast: 3, breath: 0.5, contour: 'zigzag', motion: 'neighbor', ending: 'stable',
  },
  arpeggio: {
    family: 'bars', cell: cells([], [0, 0.5, 1, 2, 2.5, 3, 1.5, 3.5]), comfy: 6, breath: 0.25, finals: 'none',
    contour: 'climb', motion: 'arp', ending: 'stable',
    centreShift: -5, // room for the climb
    longIsStrong: false, // every note is a chord tone anyway: a held top note stays on top
  },
  bassline: {
    family: 'bars', cell: cells([on(0), on(0, 2), on(0, 2, 3), on(0, 1, 2, 3)], [0, 2, 3, 1, 3.5, 1.5, 2.5, 0.5]),
    comfy: 3, breath: 0.25, detached: true, finals: 'none', contour: 'low', motion: 'walk', ending: 'root',
  },
};

for (const id of Object.keys(MELODIES)) {
  if (!TEMPLATES[id]) throw new Error(`melody.js: no template for MELODIES.${id}`);
}

function templateOf(melody) {
  return TEMPLATES[melody] ?? TEMPLATES.steady;
}

function capacity(tpl, bars) {
  if (tpl.family === 'phrase') return bars === 1 ? tpl.maxLast : (bars / 2) * (tpl.maxFirst + tpl.maxLast);
  return bars * tpl.comfy;
}

/** Line length in bars (1, 2, 4 or 8) a template gives `syllableCount` syllables; 0 for none. */
export function lineBars(melody, syllableCount) {
  const n = Math.max(0, Math.floor(Number(syllableCount) || 0));
  if (n === 0) return 0;
  const tpl = templateOf(melody);
  if (tpl.family === 'pad') {
    // one (or more) held syllable per bar, never one note across a chord change
    let b = LINE_BARS[0];
    for (const x of LINE_BARS) if (x <= n) b = x;
    return b;
  }
  return LINE_BARS.find((b) => n <= capacity(tpl, b)) ?? LINE_BARS[LINE_BARS.length - 1];
}

/** Splits n syllables into `units` groups, preferring cuts at word boundaries. */
function splitSizes(n, units, words) {
  if (units <= 1) return [n];
  const minStep = n >= units ? 1 : 0;
  const cuts = [0];
  for (let k = 1; k < units; k++) {
    const lo = cuts[k - 1] + minStep;
    const hi = n - minStep * (units - k);
    const ideal = Math.round((n * k) / units);
    let cut = Math.max(lo, Math.min(hi, ideal));
    if (words) {
      for (const d of [0, 1, -1]) {
        const c = ideal + d;
        if (c >= lo && c <= hi && c > 0 && c < n && words[c] !== words[c - 1]) {
          cut = c;
          break;
        }
      }
    }
    cuts.push(cut);
  }
  cuts.push(n);
  return cuts.slice(1).map((c, i) => c - cuts[i]);
}

function layoutPhrase(tpl, n, bars, words) {
  const unitBars = bars >= 2 ? 2 : 1;
  const unitLen = unitBars * BAR;
  const notes = [];
  splitSizes(n, bars / unitBars, words).forEach((m, u) => {
    const u0 = u * unitLen;
    let parts;
    if (unitBars === 1) parts = [[0, tpl.last(m)]];
    else {
      let c0;
      let c1;
      if (m <= 1) [c0, c1] = [m, 0];
      else if (m <= tpl.maxFirst + tpl.maxLast) {
        c0 = Math.min(tpl.maxFirst, m - 1);
        c1 = m - c0;
      } else {
        c1 = Math.floor(m / 2);
        c0 = m - c1;
      }
      parts = c1 > 0 ? [[0, tpl.first(c0)], [BAR, tpl.last(c1)]] : [[0, tpl.last(c0)]];
    }
    const unit = [];
    for (const [off, cs] of parts) for (const c of cs) unit.push({ beat: u0 + off + c.at, dur: c.dur ?? null });
    const end = u0 + (unitBars === 2 && parts.length === 1 ? BAR : unitLen);
    unit.forEach((nt, k) => {
      nt.p = (nt.beat - u0) / unitLen;
      if (k === unit.length - 1) {
        nt.final = true;
        nt.holdTo = end - tpl.breath;
      }
    });
    notes.push(...unit);
  });
  return notes;
}

function layoutBars(tpl, n, bars) {
  const base = Math.floor(n / bars);
  const extra = n % bars;
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const cs = tpl.cell(base + (b < extra ? 1 : 0));
    cs.forEach((c, k) => {
      notes.push({ beat: b * BAR + c.at, dur: c.dur ?? null, final: tpl.finals === 'bar' && k === cs.length - 1 });
    });
  }
  if (tpl.finals === 'line' && notes.length) notes[notes.length - 1].final = true;
  const total = bars * BAR;
  for (const nt of notes) nt.p = nt.beat / total;
  return notes;
}

function finishDurations(tpl, notes, total) {
  notes.forEach((nt, i) => {
    const next = i + 1 < notes.length ? notes[i + 1].beat : total;
    let end;
    if (nt.dur != null) end = Math.min(nt.beat + nt.dur, next);
    else if (nt.holdTo != null) end = Math.min(nt.holdTo, next);
    else if (i === notes.length - 1) end = total - tpl.breath;
    else if (tpl.detached) end = next - (next - nt.beat >= 1 ? 0.25 : 0.1);
    else end = next;
    const minDur = Math.min(0.125, (next - nt.beat) / 2);
    nt.dur = Math.max(end - nt.beat, minDur);
  });
}

/**
 * The rhythm a template gives a line, in beats from the line's first downbeat.
 * @param {string} melody key of MELODIES
 * @param {number} syllableCount
 * @param {Array<{wordIndex:number}>|null} [syllables] syllabify() output: sub-phrases split at words
 * @returns {{bars:number, notes:Array<{beat:number, dur:number, bar:number, harmonyBar:number,
 *   strong:boolean, final:boolean, p:number}>}}
 */
export function rhythmFor(melody, syllableCount, syllables = null) {
  const n = Math.max(0, Math.floor(Number(syllableCount) || 0));
  const bars = lineBars(melody, n);
  if (!n) return { bars: 0, notes: [] };
  const tpl = templateOf(melody);
  const words = Array.isArray(syllables) && syllables.length === n ? syllables.map((s) => s.wordIndex) : null;
  const notes = tpl.family === 'phrase' ? layoutPhrase(tpl, n, bars, words) : layoutBars(tpl, n, bars);
  finishDurations(tpl, notes, bars * BAR);
  for (const nt of notes) {
    nt.final = Boolean(nt.final);
    classify(tpl, nt);
    delete nt.holdTo;
  }
  return { bars, notes };
}

/** Sets a laid-out note's bar, harmonyBar and strong flag from its beat, duration and final. */
function classify(tpl, nt) {
  const bar = Math.floor(nt.beat / BAR + EPS);
  const inBar = nt.beat - bar * BAR;
  // a note pushed in just before the bar line and held across it belongs to the next chord
  const anticipates = inBar >= 3.5 - EPS && nt.beat + nt.dur > (bar + 1) * BAR + EPS;
  nt.bar = bar;
  nt.harmonyBar = anticipates ? bar + 1 : bar;
  const long = tpl.longIsStrong !== false && nt.dur >= 1.5 - EPS;
  nt.strong = Math.abs(inBar) < EPS || Math.abs(inBar - 2) < EPS || long || nt.final || anticipates;
}

// ------------------------------------------------------------------ cadence rhythm

/** Beats of silence after the cadence's last note (a release before the next block). */
export const CADENCE_RELEASE = 0.25;
/** Beat (inside the home bar) the last note lands on when other syllables share the bar. */
const CADENCE_LANDING = 2;

/**
 * Retimes the home bar (line bar `home`, the line's last bar) so the line ends on a long
 * note on a strong beat: a lone syllable lands on the downbeat and holds the bar; otherwise
 * the bar's other syllables keep their template onsets when they fit before beat 3 (else an
 * even grid before it) and the last one lands on beat 3, held until the release. Bars before
 * the home bar keep their rhythm (a note held into the home bar is cut at its first note).
 * The landing note gets `cadence: true`. Mutates `notes`.
 */
function cadenceRhythm(tpl, notes, home) {
  if (!notes.length) return;
  const b0 = home * BAR;
  const end = b0 + BAR - CADENCE_RELEASE;
  let first = notes.findIndex((nt) => nt.beat >= b0 - EPS);
  if (first < 0) first = notes.length - 1; // nothing starts in the home bar: the last note moves there
  const inBar = notes.slice(first);
  const pre = inBar.slice(0, -1);
  const land = inBar[inBar.length - 1];
  const landAt = pre.length ? b0 + CADENCE_LANDING : b0;
  const fits = pre.every((nt) => nt.beat >= b0 - EPS && nt.beat <= landAt - 0.25 + EPS);
  if (!fits) {
    const span = landAt - b0;
    const raw = span / pre.length;
    const step = pre.length <= 8 ? Math.max(0.25, Math.floor(raw * 4 + EPS) / 4) : raw;
    pre.forEach((nt, k) => { nt.beat = b0 + k * step; });
  }
  pre.forEach((nt, k) => {
    const next = k + 1 < pre.length ? pre[k + 1].beat : landAt;
    const room = next - nt.beat;
    const legato = tpl.detached ? next - (room >= 1 ? 0.25 : 0.1) : next;
    nt.dur = Math.max(Math.min(nt.dur, legato - nt.beat), Math.min(0.125, room / 2));
    nt.final = false;
  });
  land.beat = landAt;
  land.dur = end - landAt;
  land.final = true;
  land.cadence = true;
  if (first > 0) {
    // the last note before the home bar must not ring into it
    const prev = notes[first - 1];
    const cut = inBar[0].beat;
    if (prev.beat + prev.dur > cut - EPS) prev.dur = Math.max(cut - prev.beat, 0.125);
  }
  for (let i = Math.max(0, first - 1); i < notes.length; i++) {
    classify(tpl, notes[i]);
    if (notes[i].cadence) notes[i].harmonyBar = home;
    if (notes[i].bar === home && notes[i].harmonyBar > home) notes[i].harmonyBar = home;
  }
}

// ------------------------------------------------------------------ pitch

const LEAD_W = { prev: 0.2, leap: 7, leapCost: 2, tritone: 1.5 };
const ROLE_W = { prev: 0.5, leap: 5, leapCost: 2, tritone: 0 };

/**
 * Cost of moving from `prev` to `m` against the contour's direction (`slope` = change of the
 * contour target): a falling passage should not climb or stand still, a rising one not fall.
 */
function directionCost(m, prev, slope) {
  if (prev === null || Math.abs(slope) < 0.25) return 0;
  if (m === prev) return 1.5;
  return (slope < 0) === (m > prev) ? 1.5 : 0;
}

/**
 * MIDI note in [low, high] with a pitch class in `pcs`, near `target`, smooth from `prev`
 * (and following the contour's direction when `slope` is given). Pitch classes outside
 * `prefer` (when given) cost a little more.
 */
function pick(pcs, target, prev, low, high, w, slope = 0, prefer = null) {
  let best = null;
  let bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (!pcs.includes(mod12(m))) continue;
    let cost = Math.abs(m - target) + (prefer && !prefer.includes(mod12(m)) ? 1.5 : 0);
    if (prev !== null) {
      const leap = Math.abs(m - prev);
      cost += w.prev * leap + (leap > w.leap ? w.leapCost : 0) + (leap === 6 ? w.tritone : 0);
      cost += directionCost(m, prev, slope);
    }
    if (cost < bestCost - 1e-9) {
      best = m;
      bestCost = cost;
    }
  }
  return best;
}

/** The nearest note strictly above (dir 1) or below (dir -1) `m` with a pitch class in `pcs`. */
function stepFrom(m, pcs, dir, low, high) {
  for (let x = m + dir; x >= low && x <= high; x += dir) if (pcs.includes(mod12(x))) return x;
  return null;
}

/**
 * Lead contour: semitones above the line centre at phrase position p (0..1). Phrase endings
 * aim at the contour's end point (p = 1).
 */
function contour(kind, nt, i) {
  const p = nt.final ? 1 : nt.p;
  switch (kind) {
    case 'arch': return -2 + 6 * Math.sin(Math.PI * p);
    case 'wave': return 2 * Math.sin(2 * Math.PI * p) + (nt.strong ? 0 : 1.5);
    case 'rise': return -5 + 10 * p;
    case 'fall': return 5 - 9 * p;
    case 'zigzag': return (i % 2 ? 2 : -1) + 2 * Math.sin(Math.PI * p);
    case 'ask': return -2 + 6 * p;
    case 'reply': return 3 - 6 * p;
    case 'pad': return 2 * Math.sin(Math.PI * p);
    case 'climb': return -3;
    case 'low': return -6;
    default: return 0;
  }
}

function endingPcs(kind, chord) {
  if (kind === 'root') return [chord.tones[0]];
  if (kind === 'open') return [chord.tones[2], chord.tones[1]];
  return [chord.tones[0], chord.tones[1]];
}

/**
 * "Avoid notes" over a chord: a semitone above a chord tone (the 4th over a major triad), or
 * a tritone above the root of a chord without a tritone of its own. They grate against held
 * chord tones in other parts, so weak notes steer clear of them.
 */
function isAvoid(pc, chord) {
  const tones = chord.tones;
  if (tones.includes(pc)) return false;
  if (tones.some((t) => mod12(pc - t) === 1)) return true;
  const hasTritone = tones.some((a) => tones.some((b) => mod12(a - b) === 6));
  return !hasTritone && mod12(pc - tones[0]) === 6;
}

/** Weak lead note: a scale tone near the contour, moving by step between its neighbours. */
function leadWeak(scale, chord, durBeats, target, before, after, slope, low, high) {
  const avoidCost = durBeats >= 1 ? 2 : 1.5;
  let best = null;
  let bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (!scale.includes(mod12(m))) continue;
    let cost = Math.abs(m - target) + (isAvoid(mod12(m), chord) ? avoidCost : 0);
    if (before !== null) {
      const d = Math.abs(m - before);
      cost += 0.6 * Math.max(0, d - 2) + (d === 0 ? 0.8 : 0) + (d === 6 ? 1.5 : 0) + directionCost(m, before, slope);
    }
    if (after !== null) cost += 0.4 * Math.max(0, Math.abs(m - after) - 2);
    if (cost < bestCost - 1e-9) {
      best = m;
      bestCost = cost;
    }
  }
  return best;
}

function assignPitches(notes, ctx) {
  const { tpl, role, low, high, centre, chordAt, key, bars } = ctx;
  const lead = role === 'lead';
  const out = new Array(notes.length).fill(null);
  const shape = notes.map((nt, i) => contour(tpl.contour, nt, i));
  const anchorAt = (chord, i, prev, slope = 0) => (lead
    ? pick(chord.tones, centre + shape[i], prev, low, high, LEAD_W, slope)
    : pick([roleTone(chord, role)], centre, prev, low, high, ROLE_W));

  // pass 1: strong notes, left to right (voice leading from the previous strong note)
  let prev = null;
  let prevIndex = -1;
  notes.forEach((nt, i) => {
    if (!nt.strong) return;
    const chord = chordAt(nt.harmonyBar);
    const slope = prevIndex >= 0 ? shape[i] - shape[prevIndex] : 0;
    if (nt.cadence) {
      // the cadence: the lead lands on the home chord's root, other parts on a home chord tone
      out[i] = lead
        ? pick([chord.tones[0]], centre + shape[i], prev, low, high, LEAD_W, slope)
        : pick([cadenceTone(chord, role)], centre, prev, low, high, ROLE_W);
    } else {
      out[i] = lead && nt.final
        ? pick(chord.tones, centre + shape[i], prev, low, high, LEAD_W, slope, endingPcs(tpl.ending, chord))
        : anchorAt(chord, i, prev, slope);
    }
    prev = out[i];
    prevIndex = i;
  });

  // pass 2: weak notes between them
  for (let i = 0; i < notes.length; i++) {
    if (out[i] !== null) continue;
    const nt = notes[i];
    const chord = chordAt(nt.harmonyBar);
    const scale = chordScale(chord, key);
    const before = i > 0 ? out[i - 1] : null;
    let j = i + 1;
    while (j < notes.length && out[j] === null) j++;
    const after = j < notes.length ? out[j] : null;
    const anchor = anchorAt(chord, i, before);
    let m = null;
    switch (tpl.motion) {
      case 'arp': // climb the chord; turn around at the top of the range
        m = before === null
          ? anchor
          : stepFrom(before, chord.tones, 1, low, high) ?? stepFrom(before, chord.tones, -1, low, high);
        break;
      case 'walk': {
        const goalBar = j < notes.length ? notes[j].harmonyBar : bars;
        const goal = after ?? anchorAt(chordAt(goalBar), i, before);
        if (goalBar !== nt.harmonyBar) {
          const dir = before === null || goal >= before ? -1 : 1; // rising: approach from below
          m = stepFrom(goal, scale, dir, low, high) ?? anchor;
        } else {
          m = pick([chord.tones[2]], before ?? centre, before, low, high, ROLE_W);
        }
        break;
      }
      default:
        if (lead) {
          const slope = i > 0 ? shape[i] - shape[i - 1] : 0;
          m = leadWeak(scale, chord, nt.dur, centre + shape[i], before, after, slope, low, high);
        } else if (tpl.motion === 'neighbor') {
          // upper neighbour, else lower neighbour, avoiding notes that grate on the chord
          const ok = (x) => x !== null && !isAvoid(mod12(x), chord);
          const up = stepFrom(anchor, scale, 1, low, high);
          const down = stepFrom(anchor, scale, -1, low, high);
          m = nt.dur >= 1 ? anchor : ok(up) ? up : ok(down) ? down : anchor;
        } else if (tpl.motion === 'below' || tpl.motion === 'above') {
          m = after === null || nt.dur >= 1.5 ? anchor : stepFrom(after, scale, tpl.motion === 'below' ? -1 : 1, low, high);
        } else m = anchor;
    }
    out[i] = m ?? anchor;
  }

  // the approach: the lead's note before the landing leads into the home root by step
  if (lead && ctx.cadence) {
    const { homeBar, homeChord } = ctx.cadence;
    const f = notes.findIndex((nt) => nt.cadence);
    const p = f >= 0 ? f - 1 : ctx.cadence.approachOnly ? notes.length - 1 : -1;
    if (p >= 0) {
      const tonic = f >= 0 ? out[f] : null;
      out[p] = approachNote(out[p], p > 0 ? out[p - 1] : null, tonic, chordAt(notes[p].harmonyBar),
        chordAt(homeBar - 1), homeChord, key, low, high, notes[p].strong);
    }
  }
  return out;
}

/** The home-chord tone a role holds at the cadence (a seventh resolves down to the third). */
export function cadenceTone(chord, role) {
  return role === 'seventh' ? chord.tones[1] : roleTone(chord, role);
}

/**
 * The note before a cadence's landing: the leading tone (a semitone below the home root;
 * allowed when the chord under it or the dominant holds it, e.g. the raised G# of E7 -> Am)
 * or the supertonic (a step above). `tonic` = the landing note (MIDI), or null when the
 * landing is in the next line (then the octave nearest `current` is used). A note on a strong
 * beat only takes a candidate that is a tone of its chord (else it stays as it is).
 */
function approachNote(current, before, tonic, chord, dominant, home, key, low, high, strong) {
  const root = home.tones[0];
  const scale = chordScale(chord, key);
  const has = (pc) => scale.includes(pc) || dominant.tones.includes(pc);
  const below = has(mod12(root - 1)) ? -1 : -2;
  const above = has(mod12(root + 2)) ? 2 : 1;
  const ref = before ?? current;
  const homes = tonic !== null ? [tonic] : [nearestPc(root, current, low, high)];
  let best = current;
  let bestCost = Infinity;
  for (const t of homes) {
    for (const [d, bias] of [[below, 0], [above, 0.5]]) {
      const m = t + d;
      if (m < low || m > high) continue;
      if (strong && !chord.tones.includes(mod12(m))) continue;
      const cost = Math.abs(m - ref) + bias;
      if (cost < bestCost - 1e-9) {
        best = m;
        bestCost = cost;
      }
    }
  }
  return best;
}

/** The MIDI note of pitch class `pc` in [low, high] nearest `m`. */
function nearestPc(pc, m, low, high) {
  let best = null;
  for (let x = low; x <= high; x++) {
    if (mod12(x) !== pc) continue;
    if (best === null || Math.abs(x - m) < Math.abs(best - m)) best = x;
  }
  return best ?? m;
}

function toChord(c, key) {
  if (c && typeof c === 'object' && Array.isArray(c.tones)) return c;
  return chordFromRoman(typeof c === 'string' ? c : 'I', key);
}

/**
 * One line of notes.
 * @param {object} o
 * @param {string} o.melody          key of MELODIES (unknown -> 'steady')
 * @param {number} o.syllableCount   number of syllables (syllabify(text).length)
 * @param {Array<string|object>} o.chords  the block's chords (roman numerals or chordFromRoman
 *   objects), indexed by block bar; cycled when the line runs past the end
 * @param {string} o.role            one of PITCH_ROLES
 * @param {number} o.octave          OCTAVE_RANGE shift
 * @param {string} o.voice           key of VOICES
 * @param {string} o.key             one of KEYS
 * @param {number} o.tempo           BPM
 * @param {number} [o.startBar=0]    block bar the line starts on (selects its chords)
 * @param {Array} [o.syllables]      syllabify() output, to split sub-phrases at word boundaries
 * @param {number|null} [o.cadenceBar=null] block bar of a cadence's home chord (chorus / outro:
 *   the last bar). A line ending on it lands on a long note there (lead: the home chord's root,
 *   approached by the leading tone or the supertonic; other roles: their home chord tone, a
 *   seventh resolving to the third); a line ending just before it leads into it.
 * @returns {{notes:Array<{t:number, dur:number, midi:number, bar:number, beat:number, strong:boolean}>, bars:number}}
 *   t and dur in seconds from the line's first downbeat (the first note may start later);
 *   bar = bar index inside the line; beat = beats from the line start.
 */
export function generateNotes({
  melody = 'steady', syllableCount = 0, chords = ['I'], role = 'lead', octave = 0, voice = 'coach',
  key = 'C', tempo = 96, startBar = 0, syllables = null, cadenceBar = null,
} = {}) {
  const tpl = templateOf(melody);
  const rhythm = rhythmFor(melody, syllableCount, syllables);
  if (!rhythm.notes.length) return { notes: [], bars: 0 };
  const beatSec = 60 / (Number(tempo) > 0 ? Number(tempo) : 96);
  const list = (Array.isArray(chords) && chords.length ? chords : ['I']).map((c) => toChord(c, key));
  const chordAt = (bar) => list[(((startBar + bar) % list.length) + list.length) % list.length];
  const { low, high } = voiceRange(voice);
  const offset = role === 'bass' ? -12 : role === 'octave' ? 12 : 0;
  const centre = voiceCentre(voice, octave, offset) + (tpl.centreShift ?? 0);
  let cadence = null;
  if (Number.isInteger(cadenceBar)) {
    const homeBar = cadenceBar - startBar; // in line bars
    if (homeBar === rhythm.bars - 1) {
      cadenceRhythm(tpl, rhythm.notes, homeBar);
      cadence = { homeBar, homeChord: chordAt(homeBar), approachOnly: false };
    } else if (homeBar === rhythm.bars) {
      // the line ends just before the home bar: its last note leads into it
      cadence = { homeBar, homeChord: chordAt(homeBar), approachOnly: true };
    }
  }
  const midi = assignPitches(rhythm.notes, { tpl, role, low, high, centre, chordAt, key, bars: rhythm.bars, cadence });
  const notes = rhythm.notes.map((nt, i) => ({
    t: nt.beat * beatSec,
    dur: nt.dur * beatSec,
    midi: midi[i],
    bar: nt.bar,
    beat: nt.beat,
    strong: nt.strong,
  }));
  return { notes, bars: rhythm.bars };
}
