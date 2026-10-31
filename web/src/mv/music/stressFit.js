// Fits a line's rhythm to its words' stress (port of Magna.Core Music/StressFit.cs; new in this
// copy, not in upstream magna-vocalization). Owner, 2026-10-23: "allow subtle changes to cadence to
// avoid awkward word stresses ... 'Relax by THE fire' should be subtly changed to 'Relax by the
// FIRE'".
//
// A melody template lays a line's syllables on its cells in order, by count alone, so a stressed
// syllable can land on a weak beat next to a weak one ("the", the "re" of "relax") on a strong beat
// or a long note. This pass moves note onsets (the boundary between two notes) by a quarter or half
// a beat, at most MAX_SHIFT, so the stressed syllable comes earlier (it takes time from the weak
// note before it, and is held over the beat it anticipates) or the weak one later, whichever makes
// the rhythm's accents follow the words best:
//
// - accent of a note = its onset's metric weight (a bar's downbeat 1, beat 3 0.8, beats 2 and 4
//   0.45, an off-beat eighth 0.2, a sixteenth 0.1; an off-beat note held over a stronger beat
//   within half a beat carries 0.85 of it) plus 0.35 per doubling of its length (within -0.5..+0.6);
// - cost of two neighbouring syllables = how much their accents disagree with their stresses,
//   plus what a move does to a note on its own, plus MOVE_COST per beat moved (a sixteenth move a
//   little more): the cheapest set of moves wins (dynamic programming over the boundaries,
//   deterministic); no move at all is a candidate, so a line never scans worse than before.
//
// What stays: the line's first onset and its last note's end, every note's pitch and order, the
// bar lines; no note shorter than a quarter beat or half its length, no function word longer than
// it was; a detached note's length; the cadence's landing note; what sounds on every strong beat
// (beats 1 and 3); and a note on a downbeat is never anticipated. Triplet rhythms are left alone.

/** The most a note onset moves (beats). */
export const MAX_SHIFT = 0.5;
/** Cost of moving an onset, per beat (plus SIXTEENTH_COST for a move off the eighth grid). */
export const MOVE_COST = 0.3;
export const SIXTEENTH_COST = 0.15;
/** No note gets shorter than this (beats) nor than half its length. */
export const MIN_NOTE = 0.25;
const EPS = 1e-6;
const BAR = 4;
const STEPS = [0, -0.25, 0.25, -0.5, 0.5];

const near = (a, b) => Math.abs(a - b) < EPS;
const inBarOf = (beat) => beat - Math.floor(beat / BAR + EPS) * BAR;

/** Metric weight of an onset at `beat` (beats from the line's first downbeat). */
export function metric(beat) {
  const inBar = inBarOf(beat);
  if (near(inBar, 0) || near(inBar, BAR)) return 1.0;
  if (near(inBar, 2)) return 0.8;
  if (near(inBar, Math.round(inBar))) return 0.45;
  if (near(inBar * 2, Math.round(inBar * 2))) return 0.2;
  return 0.1;
}

/** A strong beat (beat 1 or 3 of a bar): what sounds there never changes. */
function strongPoint(beat) {
  const inBar = inBarOf(beat);
  return near(inBar, 0) || near(inBar, 2) || near(inBar, BAR);
}

function isDownbeat(beat) {
  const inBar = inBarOf(beat);
  return near(inBar, 0) || near(inBar, BAR);
}

/** A strong beat in [from, to). */
function crossesStrong(from, to) {
  for (let p = Math.ceil(from * 2 - EPS) / 2; p < to - EPS; p += 0.5) if (strongPoint(p)) return true;
  return false;
}

/** Accent of a note sounding from beat b to beat e. */
export function accent(b, e) {
  let m = metric(b);
  // an off-beat onset held over a stronger beat within half a beat carries it (a syncopation)
  for (let p = Math.ceil(b * 2 - EPS) / 2; p <= b + 0.5 + EPS; p += 0.5) {
    if (p <= b + EPS || p >= e - EPS) continue;
    m = Math.max(m, 0.85 * metric(p));
  }
  const d = Math.max(e - b, 1e-3);
  return m + Math.max(-0.5, Math.min(0.6, (0.35 * Math.log(d)) / Math.log(2)));
}

/**
 * Weight of a stress level (text/sungStress.js: 2 stressed, 1 secondary, 0 unstressed, -1 a
 * function word): a stressed syllable against a weak one counts most.
 */
export function weight(level) {
  return level >= 2 ? 2.0 : level === 1 ? 1.2 : level === 0 ? 0.4 : 0.0;
}

/** How much two neighbours' accents disagree with their stresses. */
function pairCost(sa, sb, aa, ab) {
  if (sa === sb) return 0;
  const ds = weight(sa) - weight(sb);
  const da = aa - ab;
  return ds * da < 0 ? Math.abs(ds) * Math.abs(da) : 0;
}

const log2 = (x) => Math.log(x) / Math.log(2);

/** Cost of what a move does to one note on its own (a weak syllable made longer / more accented, a stressed one less). */
function noteCost(level, accOld, accNew, durOld, durNew) {
  const longer = 0.35 * log2(durNew / durOld);
  if (level <= 0) return (level < 0 ? 0.6 : 0.3) * (Math.max(0, accNew - accOld) + Math.max(0, longer));
  return (level >= 2 ? 0.6 : 0.3) * (Math.max(0, accOld - accNew) + Math.max(0, -longer));
}

/**
 * How badly a rhythm (onsets, ends in beats) fits the stresses (one level per note): the sum of
 * the neighbours' disagreements. 0 = every stressed syllable has at least the accent of its
 * weaker neighbours.
 */
export function mismatch(onsets, ends, stress) {
  let c = 0;
  for (let i = 0; i + 1 < onsets.length; i++) {
    c += pairCost(stress[i], stress[i + 1], accent(onsets[i], ends[i]), accent(onsets[i + 1], ends[i + 1]));
  }
  return c;
}

function penalty(d) {
  if (d === 0) return 0;
  const a = Math.abs(d);
  return MOVE_COST * a + (near(a * 2, Math.round(a * 2)) ? 0 : SIXTEENTH_COST);
}

/**
 * Fits `notes` (a line's rhythm, beats from its first downbeat, as melody.js lays it out:
 * { beat, dur, cadence? }) to `stress` (one level per note) in place. opts (the making-of's sung
 * talk): minIoi, the shortest a syllable may become, onset to onset (beats; default MIN_NOTE);
 * steps, the moves an onset may make (default STEPS); keepSpan, the last onset never comes earlier (the
 * line is never sung quicker than its template).
 * @returns {number[]|null} each note's onset move (beats; 0 = unmoved), or null when nothing moved
 */
export function applyStressFit(notes, stress, { minIoi = MIN_NOTE, steps = STEPS, keepSpan = false } = {}) {
  const n = notes.length;
  if (!Array.isArray(stress) || stress.length !== n || n < 2) return null;
  for (const nt of notes) if (!near(nt.beat * 4, Math.round(nt.beat * 4))) return null; // triplets: as they are
  let any = false;
  for (let i = 0; i + 1 < n; i++) any ||= stress[i] !== stress[i + 1];
  if (!any) return null;

  const b0 = notes.map((nt) => nt.beat);
  const e0 = notes.map((nt) => nt.beat + nt.dur);
  const legato = notes.map((nt, i) => i + 1 < n && Math.abs(e0[i] - notes[i + 1].beat) < EPS);
  // the moves each onset may make (onset 0 never moves; the cadence's landing neither)
  const cand = new Array(n + 1);
  cand[0] = [0];
  cand[n] = [0]; // (the end of the last note)
  for (let k = 1; k < n; k++) {
    const list = [];
    for (const d of steps) {
      if (d !== 0 && notes[k].cadence) continue;
      if (d < 0 && keepSpan && k === n - 1) continue;
      if (d < 0 && (crossesStrong(b0[k] + d, b0[k]) || isDownbeat(b0[k]))) continue;
      if (d > 0 && crossesStrong(b0[k], b0[k] + d)) continue;
      list.push(d);
    }
    cand[k] = list;
  }

  const on = (i, di) => b0[i] + di;
  // a legato note ends where the next starts; a detached one keeps its length
  const end = (i, dNext, di) => {
    if (i === n - 1) return e0[i];
    const next = b0[i + 1] + dNext;
    return legato[i] ? next : Math.min(b0[i] + di + (e0[i] - b0[i]), next);
  };
  const valid = (i, di, dNext) => {
    const b = on(i, di);
    const e = end(i, dNext, di);
    const next = i + 1 < n ? b0[i + 1] + dNext : Infinity;
    const min = Math.min(Math.max(MIN_NOTE, 0.5 * (e0[i] - b0[i])), e0[i] - b0[i]);
    // a function word never gets longer ("by the FIRE", not "by THE fire")
    if (stress[i] < 0 && e - b > e0[i] - b0[i] + EPS) return false;
    // it sounds on the strong beats it sounded on, and on no other
    for (let p = Math.ceil(Math.min(b, b0[i]) * 2 - EPS) / 2; p < Math.max(e, e0[i]) - EPS; p += 0.5) {
      if (strongPoint(p) && (p >= b - EPS && p < e - EPS) !== (p >= b0[i] - EPS && p < e0[i] - EPS)) return false;
    }
    return e - b >= min - EPS && next - b >= minIoi - EPS;
  };
  const own = (i, di, dNext) => {
    if (di === 0 && dNext === 0) return 0;
    const b = on(i, di);
    const e = end(i, dNext, di);
    return noteCost(stress[i], accent(b0[i], e0[i]), accent(b, e), e0[i] - b0[i], e - b);
  };

  // dynamic programming over the onsets: cost[x][y] = the cheapest moves of onsets 0..k with onset
  // k-1 moved by cand[k-1][x] and onset k by cand[k][y]; back[k][y][z] = the x that led to (y, z)
  // (index order: ties keep the smaller moves, which come first)
  const back = new Array(n + 1);
  let cost = [cand[1].map((d) => (valid(0, 0, d) ? penalty(d) + own(0, 0, d) : Infinity))];
  for (let k = 1; k < n; k++) {
    const nx = cand[k - 1].length;
    const ny = cand[k].length;
    const nz = cand[k + 1].length;
    const next = Array.from({ length: ny }, () => new Array(nz).fill(Infinity));
    const from = Array.from({ length: ny }, () => new Array(nz).fill(-1));
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        const c0 = cost[x][y];
        if (c0 === Infinity) continue;
        const dx = cand[k - 1][x];
        const dy = cand[k][y];
        const accPrev = accent(on(k - 1, dx), end(k - 1, dy, dx));
        for (let z = 0; z < nz; z++) {
          const dz = cand[k + 1][z];
          if (!valid(k, dy, dz)) continue;
          const total = c0 + penalty(dz) + own(k, dy, dz) + pairCost(stress[k - 1], stress[k], accPrev, accent(on(k, dy), end(k, dz, dy)));
          if (total < next[y][z] - 1e-12) {
            next[y][z] = total;
            from[y][z] = x;
          }
        }
      }
    }
    cost = next;
    back[k] = from;
  }
  // the end: onset n (the last note's end) does not move
  let endY = -1;
  let bestCost = Infinity;
  for (let y = 0; y < cand[n - 1].length; y++) {
    if (cost[y][0] < bestCost - 1e-12) {
      bestCost = cost[y][0];
      endY = y;
    }
  }
  if (endY < 0) return null;
  const idx = new Array(n + 1).fill(0);
  idx[n - 1] = endY;
  for (let k = n - 1; k >= 1; k--) idx[k - 1] = back[k][idx[k]][idx[k + 1]];
  const shift = new Array(n);
  let moved = false;
  for (let k = 0; k < n; k++) {
    shift[k] = cand[k][idx[k]];
    moved ||= shift[k] !== 0;
  }
  if (!moved) return null;
  for (let i = 0; i < n; i++) {
    const b = on(i, shift[i]);
    const e = end(i, i + 1 < n ? shift[i + 1] : 0, shift[i]);
    notes[i].beat = b;
    notes[i].dur = e - b;
  }
  return shift;
}
