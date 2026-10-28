// Human-mode techniques (port of csharp/Mumble/Human/HumanProsody.cs, mumble/human.py):
// Fujisaki prosody, micro-prosody, creak, LF voice-quality tracks, high-band air and
// locus-equation articulation. Phrase types and the rhythm warp live in src/voice/text.

import { phraseType, highpassNoise, PH } from '../render/port.js';

const FS = 24000;

/** Pitch accents, phrase commands and per-unit prominence of one line (human.Prosody). */
export class Prosody {
  constructor() {
    /** Fujisaki phrase commands [t0, Ap]. @type {Array<[number, number]>} */
    this.phraseCmds = [];
    /** Fujisaki accent commands [t1, t2, Aa]. @type {Array<[number, number, number]>} */
    this.accentCmds = [];
    /** Prominence 0..1 per unit index. @type {Float64Array|null} */
    this.prominence = null;
    /** Phrase index -> decl / excl / cont / ynq / whq / trail. @type {Map<number, string>} */
    this.pType = new Map();
  }
}

/** Per-sample voice-quality control tracks (human.SourceTracks). */
export class SourceTracks {
  constructor() {
    /** Rd per sample, or null (Rosenberg pulses). @type {Float64Array|null} */
    this.rd = null;
    /** @type {Float64Array} */
    this.jitter = null;
    /** @type {Float64Array} */
    this.shimmer = null;
    /** Creak alternation per sample, or null when there is no creak. @type {Float64Array|null} */
    this.alt = null;
    /** @type {Float64Array} */
    this.breathScale = null;
    /** Linear gain applied to the voiced source. @type {Float64Array} */
    this.gain = null;
  }
}

const clip01 = (x) => (x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x);

function bump(t, t0, t1, ramp = 0.03) {
  const up = clip01((t - t0) / ramp + 0.5);
  const dn = clip01((t1 - t) / ramp + 0.5);
  return up * dn;
}

/** Units grouped by phrase index, in ascending phrase order (C# SortedDictionary). */
export function byPhrase(units) {
  const d = new Map();
  for (const u of units) {
    let l = d.get(u.phrase);
    if (l === undefined) d.set(u.phrase, (l = []));
    l.push(u);
  }
  return new Map([...d.entries()].sort((a, b) => a[0] - b[0]));
}

/** 15/25-tap moving average with edge padding (np.convolve of an edge-padded array). */
function movingAverage(x, k, out) {
  const n = x.length;
  const lo = -(k >> 1);
  const hi = k - 1 - (k >> 1);
  for (let i = 0; i < n; i++) {
    let s = 0.0;
    for (let j = lo; j <= hi; j++) {
      let q = i + j;
      q = q < 0 ? 0 : q >= n ? n - 1 : q;
      s += x[q];
    }
    out[i] = s / k;
  }
  return out;
}

/** numpy.interp(arange(n) / FS, ms, fp) for a 1 ms grid starting at 0 (Renderer.InterpGrid). */
export function interpGridMs(n, fp) {
  const y = new Float64Array(n);
  const len = fp.length;
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let j = Math.trunc(t * 1000.0);
    if (j >= len - 1) {
      y[i] = fp[len - 1];
      continue;
    }
    // guard against rounding at segment edges (xp[j] = j / 1000)
    while (j > 0 && j / 1000.0 > t) j--;
    while (j + 1 < len - 1 && (j + 1) / 1000.0 <= t) j++;
    const x0 = j / 1000.0;
    const y0 = fp[j];
    if (x0 === t) {
      y[i] = y0;
      continue;
    }
    const y1 = fp[j + 1];
    y[i] = ((y1 - y0) / ((j + 1) / 1000.0 - x0)) * (t - x0) + y0;
  }
  return y;
}

/** Interpolate a per-ms track at time t (numpy.interp on the 1 ms grid). */
export function interpMs(t, fp) {
  const len = fp.length;
  if (!(t >= 0)) return fp[0];
  let j = Math.trunc(t * 1000.0);
  if (j >= len - 1) return fp[len - 1];
  while (j > 0 && j / 1000.0 > t) j--;
  while (j + 1 < len - 1 && (j + 1) / 1000.0 <= t) j++;
  const x0 = j / 1000.0;
  if (x0 === t) return fp[j];
  return ((fp[j + 1] - fp[j]) / ((j + 1) / 1000.0 - x0)) * (t - x0) + fp[j];
}

const AP_TYPE = (pt) => (pt === 'excl' ? 1.2 : pt === 'trail' ? 0.7 : 1.0);
const AA_TYPE = (pt) => (pt === 'excl' ? 1.25 : pt === 'trail' ? 0.6 : pt === 'whq' ? 1.1 : 1.0);
const CREAK_TYPE = (pt) =>
  pt === 'decl' || pt === 'trail' ? 1.0 : pt === 'whq' ? 0.8 : pt === 'excl' ? 0.35 : 0.0;
const F1_ONSET = (kind) => (kind === 'plosive' ? 0.45 : kind === 'affricate' ? 0.5 : 0.7);
const EXTENT = (kind) => (kind === 'plosive' ? 1.0 : kind === 'affricate' ? 0.9 : 0.6);

const LOCUS_F2 = {
  labial: [0.85, 200.0],
  labiodental: [0.8, 300.0],
  dental: [0.55, 800.0],
  alveolar: [0.45, 1100.0],
  postalveolar: [0.5, 1050.0],
  velar_front: [0.8, 450.0],
  velar_back: [0.95, 450.0],
};
const LOCUS_F3 = {
  labial: [1.0, -100.0],
  labiodental: [1.0, -100.0],
  dental: [0.6, 1050.0],
  alveolar: [0.5, 1350.0],
  postalveolar: [0.6, 900.0],
};

/** Human-mode constants and techniques (C# static class Human, this file's part). */
export const Human = {
  TECHNIQUES: ['prosody', 'rhythm', 'micro', 'glottis', 'air', 'creak', 'articulation', 'room'],
  DEFAULT: ['prosody', 'rhythm', 'micro', 'glottis', 'air', 'creak', 'articulation'],

  /** Techniques for a mode (empty unless mode is "human"; null humanize = DEFAULT). */
  techniques(mode, humanize) {
    if (mode !== 'human') return new Set();
    if (humanize === null || humanize === undefined) return new Set(Human.DEFAULT);
    const tech = new Set(humanize);
    const bad = [...tech].filter((t) => !Human.TECHNIQUES.includes(t)).sort();
    if (bad.length > 0) {
      throw new Error(`unknown technique(s) ${bad.join(', ')}; choose from ${Human.TECHNIQUES.join(', ')}`);
    }
    return tech;
  },

  // ---- prosody
  ALPHA: 2.0,
  BETA: 20.0,
  GAMMA: 0.9,
  FB_ST: 3.7,
  AP_FIRST: 0.34,
  AP_NEXT: 0.24,
  AP_CONT_NEXT: 0.16,
  AA: 0.24,
  DOWNSTEP: 0.88,
  PRENUCLEAR_P: 0.75,
  YNQ_RISE: 0.4,
  CONT_RISE: 0.1,
  FINAL_LOWER: -0.1,
  SHOUT_AA: 0.3,
  GAIN_ACCENT: 2.0,
  GAIN_STRESSED: 0.5,
  GAIN_UNSTRESSED: -2.0,
  GAIN_FUNCTION: -3.5,
  FINAL_DB: -1.5,
  SLOPE_ACCENT: -1.5,
  SLOPE_STRESSED: -2.0,
  SLOPE_UNSTRESSED: -2.5,
  SLOPE_FUNCTION: -2.5,
  SLOPE_FINAL: -4.5,
  CONSONANT_FOLLOW: 1.0,

  /**
   * Phrase / accent commands and unit gains (sets gainDb, gainSlopeDb, fadeDb). Draws one fixed
   * set of four values per unit, so shouting a word changes only that word.
   */
  planProsody(pl, rng) {
    const an = pl.an;
    const pr = pl.V.pitchRange;
    const pros = new Prosody();
    const n = pl.units.length;
    pros.prominence = new Float64Array(n);
    const rPick = new Float64Array(n);
    const rSize = new Float64Array(n);
    const rT1 = new Float64Array(n);
    const rGain = new Float64Array(n);
    for (let i = 0; i < n; i++) rPick[i] = rng.nextDouble();
    for (let i = 0; i < n; i++) rSize[i] = 0.82 + (1.18 - 0.82) * rng.nextDouble();
    for (let i = 0; i < n; i++) rT1[i] = -0.015 + (0.015 - -0.015) * rng.nextDouble();
    for (let i = 0; i < n; i++) rGain[i] = 0.0 + 0.5 * rng.nextGaussian();
    let firstPhrase = true;
    for (const [pi, us] of byPhrase(pl.units)) {
      const pt = phraseType(an, pi);
      pros.pType.set(pi, pt);
      const prevMark = pi > 0 ? an.phrases[pi - 1].mark : null;
      let ap = firstPhrase ? Human.AP_FIRST : prevMark === ',' ? Human.AP_CONT_NEXT : Human.AP_NEXT;
      firstPhrase = false;
      ap *= AP_TYPE(pt) * pr;
      pros.phraseCmds.push([us[0].on - 0.12, ap]);
      const last = us[us.length - 1];
      const lEnd = Math.max(last.off - last.release, last.on + 0.05);
      const lDur = lEnd - last.on;
      const cands = us.filter((u) => an.syllables[u.syllable].stress !== 0);
      if (cands.length === 0) cands.push(last);
      const nuclear = cands[cands.length - 1];
      const accented = cands.filter((u) => u === nuclear || u === cands[0] || rPick[u.index] < Human.PRENUCLEAR_P);
      const shouted = us.filter((u) => u.shout && !accented.includes(u));
      const all = accented.concat(shouted);
      for (const u of all) {
        const i = u.index;
        const word = an.words[u.word];
        const ai = accented.indexOf(u);
        const down = ai >= 0 ? Math.pow(Human.DOWNSTEP, ai) : 1.0;
        let size = Human.AA * pr * AA_TYPE(pt) * down * rSize[i];
        if (word.functionWord) size *= 0.6;
        if (u.shout) size += Human.SHOUT_AA * pr;
        const vEnd = Math.max(u.off - u.release, u.on + 0.05);
        const dur = vEnd - u.on;
        const t1 = u.leadStart - 0.04 + rT1[i];
        if (u === nuclear && pt === 'ynq') {
          const rise = Human.YNQ_RISE * pr + (u.shout ? Human.SHOUT_AA * pr : 0.0);
          pros.accentCmds.push([u.on + 0.35 * dur, Math.max(vEnd, lEnd) + 0.25, rise]);
        } else {
          pros.accentCmds.push([t1, u.on + 0.65 * dur, size]);
        }
        pros.prominence[i] = 1.0;
      }
      const accentedSet = new Set(all);
      if (pt === 'cont') pros.accentCmds.push([last.on + 0.5 * lDur, lEnd + 0.2, Human.CONT_RISE * pr]);
      else if (pt === 'decl' || pt === 'whq' || pt === 'trail' || pt === 'excl') {
        const k = pt === 'excl' ? 0.6 : 1.0;
        pros.accentCmds.push([last.on + 0.4 * lDur, lEnd + 0.3, k * Human.FINAL_LOWER * pr]);
      }
      const falls = pt === 'decl' || pt === 'whq' || pt === 'trail';
      for (const u of us) {
        const syl = an.syllables[u.syllable];
        const word = an.words[u.word];
        let g;
        let slope;
        if (accentedSet.has(u)) {
          g = Human.GAIN_ACCENT;
          slope = Human.SLOPE_ACCENT;
        } else if (word.functionWord) {
          g = Human.GAIN_FUNCTION;
          slope = Human.SLOPE_FUNCTION;
          pros.prominence[u.index] = 0.0;
        } else if (syl.stress !== 0) {
          g = Human.GAIN_STRESSED;
          slope = Human.SLOPE_STRESSED;
          pros.prominence[u.index] = 0.5;
        } else {
          g = Human.GAIN_UNSTRESSED;
          slope = Human.SLOPE_UNSTRESSED;
          pros.prominence[u.index] = 0.0;
        }
        g += rGain[u.index];
        u.gainSlopeDb = slope;
        if (u === last && falls) u.gainSlopeDb = Human.SLOPE_FINAL;
        else if (u === last && pt === 'ynq') u.gainSlopeDb = 0.0;
        if (pt === 'excl') g += 2.0;
        if (u === last && falls) g += Human.FINAL_DB;
        if (u.shout) g += 6.0;
        if (pt === 'trail' && u.word === last.word) u.fadeDb = u === last ? -12.0 : -4.0;
        u.gainDb = g;
      }
    }
    return pros;
  },

  /** ln(F0 / Fb) at time t from the phrase and accent commands. */
  fujisaki(t, p) {
    const A = Human.ALPHA;
    const Bt = Human.BETA;
    const G = Human.GAMMA;
    let y = 0.0;
    for (const [t0, ap] of p.phraseCmds) {
      const x = Math.max(t - t0, 0.0);
      y += ap * A * A * x * Math.exp(-A * x);
    }
    for (const [t1, t2, aa] of p.accentCmds) {
      let x1 = t - t1;
      if (x1 < 0.0) x1 = 0.0;
      let x2 = t - t2;
      if (x2 < 0.0) x2 = 0.0;
      const g1 = Math.min(1.0 - (1.0 + Bt * x1) * Math.exp(-Bt * x1), G);
      const g2 = Math.min(1.0 - (1.0 + Bt * x2) * Math.exp(-Bt * x2), G);
      y += aa * (g1 - g2);
    }
    return y;
  },

  // ---- micro
  DRIFT_CENTS: 12.0,
  DRIFT_HZ: 1.5,
  FLUTTER_CENTS: 9.0,
  MICRO_VOICELESS: 70.0,
  MICRO_VOICED: -45.0,
  MICRO_NASAL: -30.0,
  MICRO_TAU: 0.03,
  /** Intrinsic F0 of vowels (cents). */
  INTRINSIC_F0: {
    ee: 35.0, oo: 35.0, ih: 20.0, uu: 20.0, er: 5.0, schwa: 0.0,
    eh: 0.0, oh: 5.0, uh: -10.0, aw: -15.0, ae: -20.0, ah: -25.0,
  },

  /** Adds micro-prosody (drift, flutter, consonant / nasal / intrinsic F0) in cents to c[0..nMs). */
  microCents(pl, nMs, rng, c) {
    const a = Math.exp((-2 * Math.PI * Human.DRIFT_HZ) / 1000.0);
    const m = nMs + 2000;
    let y1 = 0.0;
    let y2 = 0.0;
    const d = new Float64Array(nMs);
    for (let i = 0; i < m; i++) {
      y1 = (1 - a) * rng.nextGaussian() + a * y1;
      y2 = (1 - a) * y1 + a * y2;
      if (i >= 2000) d[i - 2000] = y2;
    }
    let mean = 0.0;
    let sq = 0.0;
    for (let i = 0; i < nMs; i++) mean += d[i];
    mean /= Math.max(nMs, 1);
    for (let i = 0; i < nMs; i++) sq += (d[i] - mean) * (d[i] - mean);
    const sd = Math.sqrt(sq / Math.max(nMs, 1));
    const ph0 = 2 * Math.PI * rng.nextDouble();
    const ph1 = 2 * Math.PI * rng.nextDouble();
    const ph2 = 2 * Math.PI * rng.nextDouble();
    const w0 = 2 * Math.PI * 12.7;
    const w1 = 2 * Math.PI * 7.1;
    const w2 = 2 * Math.PI * 4.7;
    for (let i = 0; i < nMs; i++) {
      const t = i / 1000.0;
      const fl = (Math.sin(w0 * t + ph0) + Math.sin(w1 * t + ph1) + Math.sin(w2 * t + ph2)) / 3.0;
      c[i] += (d[i] / (sd + 1e-12)) * Human.DRIFT_CENTS + Human.FLUTTER_CENTS * fl;
    }
    for (const u of pl.units) {
      const size = u.preVoiced ? Human.MICRO_VOICED : Human.MICRO_VOICELESS;
      const nasal = u.sonOnset.length > 0 && pl.P[u.sonOnset[u.sonOnset.length - 1]].kind === 'nasal';
      let sym = u.sym;
      if (PH.VOWELS[sym] === undefined && sym.includes('-')) sym = sym.split('-')[0];
      const intr = Human.INTRINSIC_F0[sym] ?? 0.0;
      for (let i = 0; i < nMs; i++) {
        const t = i / 1000.0;
        if (u.preKind !== null) {
          const x = t - u.on;
          if (x >= -0.005) c[i] += size * Math.exp(-Math.max(x, 0.0) / Human.MICRO_TAU) * bump(t, u.on - 0.005, u.off, 0.01);
        }
        if (nasal) c[i] += Human.MICRO_NASAL * bump(t, u.leadStart, u.nucT + 0.02, 0.02);
        if (intr !== 0.0) c[i] += intr * bump(t, u.on, u.off - u.release);
      }
    }
  },

  // ---- creak
  CREAK_LEN: 0.17,
  CREAK_RATIO: 0.5,
  ONSET_CREAK: 0.55,
  ONSET_LEN: 0.045,

  /** Creak amount 0..1 per ms: phrase-final fry and glottalised phrase-initial vowels. */
  creakTrack(pl, ptypes, nMs, rng) {
    const c = new Float64Array(nMs);
    const amt = pl.V.creak;
    if (amt <= 0) return c;
    for (const [pi, us] of byPhrase(pl.units)) {
      const pt = ptypes !== null && ptypes !== undefined && ptypes.has(pi) ? ptypes.get(pi) : phraseType(pl.an, pi);
      const last = us[us.length - 1];
      const k = CREAK_TYPE(pt) * amt * (0.75 + (1.0 - 0.75) * rng.nextDouble());
      if (k > 0) {
        const tb = last.off - 0.4 * last.release;
        const ta = Math.max(last.on + 0.35 * (tb - last.on), tb - Human.CREAK_LEN);
        const den = Math.max(0.06, 0.4 * (tb - ta));
        for (let i = 0; i < nMs; i++) {
          const t = i / 1000.0;
          if (t > last.off + 0.02) continue;
          const v = k * clip01((t - ta) / den);
          if (v > c[i]) c[i] = v;
        }
      }
      const first = us[0];
      if (first.preKind === null && first.sonOnset.length === 0 && first.kind === 'vowel') {
        for (let i = 0; i < nMs; i++) {
          const x = i / 1000.0 - first.on;
          if (x < -0.005 || x > Human.ONSET_LEN * 2) continue;
          const v = Human.ONSET_CREAK * amt * Math.exp((-Math.max(x, 0) / Human.ONSET_LEN) * 2.2);
          if (v > c[i]) c[i] = v;
        }
      }
    }
    return c;
  },

  // ---- pitch
  /**
   * Human pitch track: { f0 per sample, f0Ms per ms, creak per ms }. baseCents is the full-mode
   * tune when prosody is off. Also sets every unit's cOn / cOff.
   */
  pitchTrack(pl, prosody, baseCents, n, tech, rMicro, rCreak) {
    const v = pl.V;
    const nMs = Math.ceil((n / FS) * 1000) + 2;
    const cents = new Float64Array(nMs);
    if (prosody !== null) {
      const k = 1200.0 / Math.log(2.0);
      for (let i = 0; i < nMs; i++) cents[i] = Human.fujisaki(i / 1000.0, prosody) * k - Human.FB_ST * 100.0 * v.pitchRange;
    } else cents.set(baseCents.subarray(0, nMs));
    if (tech.has('micro')) Human.microCents(pl, nMs, rMicro, cents);
    if (v.wobbleCents !== 0) {
      const ph = 2 * Math.PI * rMicro.nextDouble();
      for (let i = 0; i < nMs; i++) cents[i] += v.wobbleCents * Math.sin(2 * Math.PI * v.wobbleHz * (i / 1000.0) + ph);
    }
    let creak = new Float64Array(nMs);
    if (tech.has('creak')) {
      creak = Human.creakTrack(pl, prosody !== null ? prosody.pType : null, nMs, rCreak);
      const low = 1200.0 * Math.log2(Human.CREAK_RATIO);
      for (let i = 0; i < nMs; i++) cents[i] += creak[i] * Math.min(low - cents[i], 0.0);
    }
    const f0Ms = new Float64Array(nMs);
    for (let i = 0; i < nMs; i++) f0Ms[i] = v.f0 * Math.pow(2.0, cents[i] / 1200.0);
    const f0 = interpGridMs(n, f0Ms);
    for (const u of pl.units) {
      u.cOn = interpMs(u.on, cents);
      u.cOff = interpMs(Math.max(u.off - u.release, u.on), cents);
    }
    return { f0, f0Ms, creak };
  },

  // ---- voice quality
  RD_ACCENT: -0.2,
  RD_FINAL: 0.45,
  RD_ONSET: 0.25,
  RD_SHOUT: 0.6,
  RD_CREAK: -0.45,
  CREAK_JITTER: 0.05,
  CREAK_SHIMMER: 0.15,
  CREAK_DB: -4.0,
  BREATH_EXP: 1.5,

  /** Rd / jitter / shimmer / creak / breath tracks per sample. */
  makeSourceTracks(pl, prosody, creakMs, n, tech) {
    const v = pl.V;
    const nMs = creakMs.length;
    const glottis = tech.has('glottis');
    const logRd = new Float64Array(nMs);
    if (glottis) {
      for (const [pi, us] of byPhrase(pl.units)) {
        const pt = prosody !== null ? prosody.pType.get(pi) : phraseType(pl.an, pi);
        for (const u of us) {
          const prom = prosody !== null ? prosody.prominence[u.index] : 0.0;
          const a = prom !== 0 ? Math.log(1.0 + Human.RD_ACCENT * prom) : 0.0;
          const b = u.shout ? Math.log(Human.RD_SHOUT) : 0.0;
          if (a === 0 && b === 0) continue;
          for (let i = 0; i < nMs; i++) logRd[i] += (a + b) * bump(i / 1000.0, u.on, u.off, 0.04);
        }
        const last = us[us.length - 1];
        const first = us[0];
        if (pt !== 'ynq') {
          const lf = Math.log(1.0 + Human.RD_FINAL);
          const den = Math.max(last.off - last.on, 0.05);
          for (let i = 0; i < nMs; i++) {
            const t = i / 1000.0;
            if (t <= last.off + 0.05) logRd[i] += lf * clip01((t - last.on) / den);
          }
        }
        const lo = Math.log(1.0 + Human.RD_ONSET);
        for (let i = 0; i < nMs; i++) {
          const x = i / 1000.0 - first.on;
          if (x >= -0.01 && x <= 0.15) logRd[i] += lo * Math.exp(-Math.max(x, 0) / 0.04);
        }
      }
    }
    let anyCreakMs = false;
    for (let i = 0; i < nMs; i++) {
      if (creakMs[i] !== 0) {
        anyCreakMs = true;
        logRd[i] += Math.log(1.0 + Human.RD_CREAK * creakMs[i]);
      }
    }
    // 15-tap moving average with edge padding
    const sm = movingAverage(logRd, 15, new Float64Array(nMs));
    for (let i = 0; i < nMs; i++) sm[i] = v.rd * Math.exp(sm[i]);
    const tr = new SourceTracks();
    tr.rd = glottis ? interpGridMs(n, sm) : null;
    tr.jitter = new Float64Array(n);
    tr.shimmer = new Float64Array(n);
    tr.breathScale = new Float64Array(n);
    tr.gain = new Float64Array(n);
    const c = anyCreakMs ? interpGridMs(n, creakMs) : null;
    const rdV = v.rd;
    const rdT = tr.rd;
    let anyCreak = false;
    for (let i = 0; i < n; i++) {
      const ci = c !== null ? c[i] : 0.0;
      if (ci > 0) anyCreak = true;
      let bs = 1.0;
      if (glottis) {
        const x = rdT[i] / rdV;
        bs = x * Math.sqrt(x); // (Rd / Rd_voice) ** BREATH_EXP (1.5)
        bs = bs < 0.4 ? 0.4 : bs > 3.0 ? 3.0 : bs;
      }
      tr.jitter[i] = v.jitter + Human.CREAK_JITTER * ci;
      tr.shimmer[i] = v.shimmer + Human.CREAK_SHIMMER * ci;
      tr.breathScale[i] = bs * (1.0 - 0.6 * ci);
      tr.gain[i] = ci === 0.0 ? 1.0 : Math.pow(10.0, (Human.CREAK_DB * ci) / 20.0);
    }
    tr.alt = anyCreak ? c : null;
    return tr;
  },

  // ---- air
  AIR_DB: -30.0,
  AIR_FC: 3000.0,

  /** Pitch-synchronous high-band noise (human.air_noise); null when the voice has no air. */
  airNoise(shape, n, voice, breathScale, rng) {
    if (voice.air <= 0) return null;
    const hp = new Float64Array(n);
    highpassNoise(n, Human.AIR_FC * voice.tube, rng, hp);
    const k = voice.air * Math.pow(10.0, Human.AIR_DB / 20.0);
    for (let i = 0; i < n; i++) hp[i] *= (0.25 + 0.75 * shape[i]) * Math.sqrt(breathScale[i]) * k;
    return hp;
  },

  // ---- articulation
  F1_MIN: 220.0,
  CODA_TRANS: 0.045,
  REDUCE_UNSTRESSED: 0.3,
  REDUCE_FUNCTION: 0.45,
  SCATTER: 0.025,
  BW_SCATTER: 0.08,
  /** Formant transition time into a vowel by place (s). */
  TRANS_S: { labial: 0.032, labiodental: 0.035, dental: 0.04, alveolar: 0.042, postalveolar: 0.045, velar: 0.05 },
  /**
   * Vowel-inherent spectral change: [start, end] where each is null (the target itself) or
   * [vowel to move toward, fraction].
   */
  VISC: {
    oh: [null, ['oo', 0.45]],
    ee: [['ih', 0.2], null],
    oo: [['uu', 0.2], null],
    ae: [null, ['schwa', 0.25]],
    ih: [null, ['schwa', 0.15]],
    eh: [null, ['schwa', 0.15]],
    uu: [null, ['schwa', 0.12]],
    uh: [null, ['schwa', 0.1]],
    aw: [null, ['schwa', 0.12]],
    ah: [null, ['schwa', 0.08]],
  },

  /** Formant onset values (F1..F3 replaced, tube-scaled) of a consonant next to vowel F. */
  locus(F, place, kind, tube) {
    const f1 = F[0] / tube;
    const f2 = F[1] / tube;
    const f3 = F[2] / tube;
    let key = place;
    if (place === 'velar') key = f2 > 1500 ? 'velar_front' : 'velar_back';
    const [k2, c2] = LOCUS_F2[key];
    const l2 = k2 * f2 + c2;
    let l3;
    if (place === 'velar') l3 = f2 > 1500 ? Math.max(f3, l2 + 450.0) : f3;
    else {
      const [k3, c3] = LOCUS_F3[key];
      l3 = k3 * f3 + c3;
    }
    const l1 = Math.max(Human.F1_MIN, F1_ONSET(kind) * f1);
    const e = EXTENT(kind);
    const o1 = f1 + e * (l1 - f1);
    const o2 = f2 + e * (l2 - f2);
    let o3 = f3 + e * (l3 - f3);
    o3 = Math.max(o3, o2 + 250.0);
    const r = F.slice();
    r[0] = o1 * tube;
    r[1] = o2 * tube;
    r[2] = o3 * tube;
    return r;
  },
};
