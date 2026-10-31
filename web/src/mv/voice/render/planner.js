// Text analysis -> timed voiced units, noise events and closures
// (port of csharp/Mumble/Render/Planner.cs, mumble/render.py _Targets / _Planner).
//
// Changed in this copy (vs upstream magna-vocalization): the stop consonants' burst level and
// bands, aspiration, voicing onset and coda releases are Planner fields (burstDb, burstBands,
// aspLen, voicelessOnset, releaseCodas) with upstream's values as defaults, so the singer
// (sing.js) can articulate stops more clearly while speech stays as it was.

import { Target, VoicedUnit, NoiseEvent, Closure } from './renderData.js';
import { PH, voicedRms } from './port.js';
import { Human, byPhrase } from '../human/humanProsody.js';

/** Formant targets of one voice, level-calibrated and cached (render._Targets). */
export class Targets {
  /** rd > 0: calibrate with LF pulses of this Rd. */
  constructor(voice, mode, rd = 0.0) {
    this.v = voice;
    this.mode = mode;
    this.rd = rd;
    this.bwScale = Math.sqrt(voice.tube);
    /** @type {Map<string, Target>} */
    this.cache = new Map();
  }

  calib(F, B) {
    const v = this.v;
    return -20.0 * Math.log10(voicedRms(F, B, v.f0, v.bright, v.oq, this.rd));
  }

  /** Same target with new formants / bandwidths, level re-calibrated (keeps its intrinsic offset). */
  modified(T, F, B) {
    return new Target(F, B, T.levelDb + this.calib(F, B) - this.calib(T.F, T.B));
  }

  schwa(shout) {
    const p = this.place(PH.VOWELS.schwa, this.v.mouth, shout);
    return [p[0], p[1], p[2]];
  }

  place(f3, pull, shout) {
    const C = PH.CLOSED_TARGET;
    let a = C[0] + pull * (f3[0] - C[0]);
    const b = C[1] + pull * (f3[1] - C[1]);
    const c = C[2] + pull * (f3[2] - C[2]);
    if (shout) a *= 1.06;
    const t = this.v.tube;
    const hp = PH.HIGHER_POLES;
    return [a * t, b * t, c * t, PH.F4_HZ * t, hp[0] * t, hp[1] * t, hp[2] * t];
  }

  bw(nasal) {
    const lo = nasal ? PH.NASAL_BW : PH.VOWEL_BW;
    const hi = nasal ? PH.NASAL_HIGHER_BW : PH.HIGHER_BW;
    const r = new Array(lo.length + hi.length);
    for (let i = 0; i < lo.length; i++) r[i] = lo[i] * this.bwScale;
    for (let i = 0; i < hi.length; i++) r[lo.length + i] = hi[i] * this.bwScale;
    return r;
  }

  vowel(sym, shout) {
    const key = 'v|' + sym + '|' + shout;
    let T = this.cache.get(key);
    if (T === undefined) {
      const F = this.place(PH.VOWELS[sym], this.v.mouth, shout);
      const B = this.bw(false);
      T = new Target(F, B, this.calib(F, B) + PH.VOWEL_INTRINSIC_DB[sym]);
      this.cache.set(key, T);
    }
    return T;
  }

  sonorant(sym, position, shout) {
    const key = 's|' + sym + '|' + position + '|' + shout;
    let T = this.cache.get(key);
    if (T === undefined) {
      let F;
      let B;
      let level;
      const nt = PH.NASAL_TARGETS[sym];
      if (nt !== undefined) {
        const t = this.v.tube;
        const hp = PH.HIGHER_POLES;
        F = [nt[0] * t, nt[1] * t, nt[2] * t, PH.F4_HZ * t, hp[0] * t, hp[1] * t, hp[2] * t];
        B = this.bw(true);
        level = position === 'syllabic' ? -3.0 : -6.0;
      } else {
        const gsym = sym === 'l' && position !== 'onset' ? 'L' : sym;
        F = this.place(PH.GLIDE_TARGETS[gsym], 0.5 + 0.5 * this.v.mouth, false);
        B = this.bw(false);
        level = position === 'syllabic' ? 0.0 : PH.GLIDE_GAIN_DB[gsym];
      }
      T = new Target(F, B, this.calib(F, B) + level);
      this.cache.set(key, T);
    }
    return T;
  }

  /** @returns {Target[]} */
  nucleus(u) {
    if (u.kind === 'syllabic') return [this.sonorant(u.sym, 'syllabic', u.shout)];
    const sym = this.mode === 'video' ? PH.VIDEO_MAP[u.sym] : u.sym;
    const d = PH.DIPHTHONGS[sym];
    if (d !== undefined) return [this.vowel(d[0], u.shout), this.vowel(d[1], u.shout)];
    return [this.vowel(sym, u.shout)];
  }
}

// ---- timing (letter steps unless noted)
export const MIN_NUC = 1.5;
export const MIN_NUC_BEFORE_SON = 1.1;
export const MIN_SON = 0.8;
export const VOWEL_CAP = 6.0;
export const SON_LINK_CAP = 3.0;
export const MAX_STRETCH = 1.5;
export const SON_CAP = 1.6;
export const PHRASE_TAIL = 2.6;
export const FRIC_MAX = 0.1;
export const FINAL_CLOSURE = 0.07;
export const CUT = 0.006;
// ---- levels (dB relative to a calibrated vowel)
export const BURST_DB = -12.0;
export const ASP_DB = -10.0;
export const ASP_LEN = 0.018;
/** The breath after a released final voiceless stop (Planner.codaRelease puff): its band by place (Hz). */
const PUFF_BANDS = Object.freeze({ labial: [800.0, 4000.0], alveolar: [1800.0, 6500.0], velar: [1200.0, 4500.0] });
export const H_DB = -11.0;
export const SHOUT_DB = 6.0;
export const SHOUT_CENTS = 350.0;
export const QUESTION_RISE = 450.0;
export const VIDEO_BREATH = 0.25;

const isSonorant = (kind) => kind === 'nasal' || kind === 'glide' || kind === 'liquid';
const isObstruent = (kind) =>
  kind === 'plosive' || kind === 'fricative' || kind === 'affricate' || kind === 'aspirate';
const isStopOrFric = (kind) => kind === 'plosive' || kind === 'fricative' || kind === 'affricate';
/** Syllable without a nucleus (Python None; the port may use -1 or null). */
export const noNucleus = (n) => n === null || n === undefined || n < 0;

const minDur = (kind) =>
  kind === 'plosive' ? 0.04 : kind === 'fricative' ? 0.045 : kind === 'affricate' ? 0.075 : 0.04;
const naturalDur = (kind) =>
  kind === 'plosive' ? 0.065 : kind === 'fricative' ? 0.085 : kind === 'affricate' ? 0.11 : 0.06;

function declination(mark) {
  switch (mark) {
    case ',':
      return [60.0, -10.0, 25.0];
    case '!':
      return [250.0, -20.0, -60.0];
    case '?':
      return [40.0, -30.0, 0.0];
    case '...':
      return [40.0, -80.0, -70.0];
    default:
      return [60.0, -50.0, -80.0];
  }
}

function setPre(u, kind, phone, level, voiced) {
  u.preKind = kind;
  u.prePhone = phone;
  u.preLevel = level;
  u.preVoiced = voiced;
}

/** Text analysis -> timed voiced units, noise events and closures (render._Planner). */
export class Planner {
  /**
   * @param {object} an LineAnalysis
   * @param {object} voice Voice
   * @param {string} mode video / full / human
   * @param {Set<string>} tech human-mode techniques
   * @param {object} rArt articulation random stream
   */
  constructor(an, voice, mode, tech, rArt) {
    this.an = an;
    this.P = an.phones;
    this.V = voice;
    this.mode = mode;
    this.tech = tech;
    this.rArt = rArt;
    this.prosody = null;
    this.dt = an.dt;
    /** @type {VoicedUnit[]} */
    this.units = [];
    /** @type {NoiseEvent[]} */
    this.noises = [];
    /** @type {Closure[]} */
    this.closures = [];
    this.tubeF = 1.0 + 0.5 * (voice.tube - 1.0);
    // Module constants in Python that the singer overrides (render.VOWEL_CAP, human.REDUCE, ...).
    this.vowelCap = VOWEL_CAP;
    this.sonLinkCap = SON_LINK_CAP;
    this.reduceUnstressed = Human.REDUCE_UNSTRESSED;
    this.reduceFunction = Human.REDUCE_FUNCTION;
    this.visc = Human.VISC;
    // Stop consonants (JS extension; the singer's are clearer, see sing.js): the release burst's
    // level (dB re vowel) and band by place, the aspiration after a voiceless release (s), the
    // voicing onset after it (s), and whether voiced coda stops and stops before another
    // obstruent ("box": the k before the s) are released too. Defaults: the speech planner's.
    this.burstDb = BURST_DB;
    this.burstBands = PH.BURST_BANDS;
    this.aspLen = ASP_LEN;
    this.voicelessOnset = 0.022;
    this.releaseCodas = false;
    // A coda stop's release, per phone (JS extension; the singer's held notes, sing.js): null (the default), or
    // { db, early, puff }: dB added to its final release, released `early` s after its closure starts when that is
    // sooner than the next sound (a silence before the next consonant, so the release is heard on its own), and a
    // voiceless one's breath after it (`puff` s; 0: none).
    this.codaRelease = null;
  }

  // ---- structure
  phraseSequence(phraseIndex) {
    const an = this.an;
    const P = this.P;
    const seq = [];
    for (const wi of an.phrases[phraseIndex].words) {
      const word = an.words[wi];
      for (const si of word.syllables) {
        const s = an.syllables[si];
        if (noNucleus(s.nucleus)) {
          if (this.mode !== 'video') {
            for (const k of s.onset) if (isObstruent(P[k].kind)) seq.push({ unit: null, phone: k });
          }
          continue;
        }
        const nuc = P[s.nucleus];
        const syllabic = nuc.kind !== 'vowel';
        if (this.mode === 'video') {
          if (syllabic) continue;
          seq.push({ unit: this.makeUnit(si, [], [], false), phone: -1 });
          continue;
        }
        const onset = s.onset;
        const coda = s.coda;
        let n = onset.length;
        while (n > 0 && isSonorant(P[onset[n - 1]].kind)) n--;
        const sonOn = onset.slice(n);
        const obsOn = [];
        for (let x = 0; x < n; x++) if (isObstruent(P[onset[x]].kind)) obsOn.push(onset[x]);
        n = 0;
        while (n < coda.length && isSonorant(P[coda[n]].kind)) n++;
        const sonCo = coda.slice(0, n);
        const obsCo = [];
        for (let x = n; x < coda.length; x++) if (isObstruent(P[coda[x]].kind)) obsCo.push(coda[x]);
        for (const x of obsOn) seq.push({ unit: null, phone: x });
        seq.push({ unit: this.makeUnit(si, sonOn, sonCo, syllabic), phone: -1 });
        for (const x of obsCo) seq.push({ unit: null, phone: x });
      }
    }
    return seq;
  }

  makeUnit(si, sonOn, sonCo, syllabic) {
    const s = this.an.syllables[si];
    const P = this.P;
    const nuc = P[s.nucleus];
    const word = this.an.words[s.word];
    const u = new VoicedUnit(
      si, s.word, s.phrase, s.nucleus, nuc.sym, syllabic ? 'syllabic' : 'vowel', sonOn, sonCo, word.shout,
    );
    u.label = word.text + ':' + nuc.sym;
    const dt = this.dt;
    u.nucT = nuc.t;
    if (sonOn.length > 0) {
      const last = P[sonOn[sonOn.length - 1]];
      const leadMax = last.kind === 'nasal' ? 0.075 : 0.055;
      u.leadStart = Math.max(P[sonOn[0]].t, nuc.t - leadMax);
    } else u.leadStart = nuc.t;
    let tPrev = nuc.t;
    let minPrev = (sonCo.length > 0 ? MIN_NUC_BEFORE_SON : MIN_NUC) * dt;
    for (const k of sonCo) {
      const st = Math.max(P[k].t, tPrev + minPrev);
      u.codaStarts.push(st);
      tPrev = st;
      minPrev = MIN_SON * dt;
    }
    u.lastSonStart = tPrev;
    u.coreMinEnd = tPrev + minPrev;
    return u;
  }

  // ---- obstruent gaps
  gap(A, run, B) {
    const P = this.P;
    const x1 = P[run[0]].t;
    const xLast = P[run[run.length - 1]].t;
    let gapEnd = B !== null ? B.leadStart : Math.max(P[run[run.length - 1]].tNext, xLast + 0.03);
    gapEnd = Math.max(gapEnd, x1 + 0.01);
    const nat = new Array(run.length);
    let natSum = 0.0;
    for (let r = 0; r < run.length; r++) {
      const kind = P[run[r]].kind;
      const same =
        r > 0 && kind === 'plosive' && (P[run[r - 1]].kind === 'plosive' || P[run[r - 1]].kind === 'affricate');
      nat[r] = same ? 0.03 : naturalDur(kind);
      natSum += nat[r];
    }
    let start;
    if (A !== null) {
      let totalMin = 0.0;
      for (const k of run) totalMin += minDur(P[k].kind);
      const excess = gapEnd - x1 - natSum;
      const stretch = Math.min(Math.max(excess, 0.0), MAX_STRETCH * this.dt);
      const desired = Math.max(x1 + stretch, A.coreMinEnd);
      start = Math.max(x1, Math.min(desired, gapEnd - totalMin));
      start = Math.min(Math.max(start, A.leadStart + 0.06), gapEnd - 0.005);
    } else start = x1;
    const knots = new Array(run.length + 1);
    let cs = 0.0;
    knots[0] = start + (gapEnd - start) * (0.0 / natSum);
    for (let r = 0; r < run.length; r++) {
      cs += nat[r];
      knots[r + 1] = start + (gapEnd - start) * (cs / natSum);
    }
    if (A !== null) {
      A.postPhone = run[0];
      A.postStart = knots[0];
    }
    for (let r = 0; r < run.length; r++) {
      this.obstruent(
        run[r], knots[r], knots[r + 1], r === 0 ? A : null, r === run.length - 1 ? B : null,
        r === run.length - 1 && B === null,
      );
    }
  }

  obstruent(k, s, e, prvUnit, nxtUnit, phraseEnd) {
    const ph = this.P[k];
    const v = this.V;
    const word = this.an.words[ph.word];
    const bare = noNucleus(this.an.syllables[ph.syllable].nucleus);
    const gdb = word.shout ? SHOUT_DB : 0.0;
    const L = Math.max(e - s, 0.0);
    const tf = this.tubeF;
    const label = word.text + ':' + ph.sym;
    if (ph.kind === 'fricative') {
      const d = Math.min(L, bare ? 0.45 : FRIC_MAX);
      let on;
      let off;
      if (ph.role === 'onset') {
        on = e - d;
        off = e;
      } else {
        on = s;
        off = s + d;
      }
      let att = 0.012;
      let rel = 0.018;
      if (nxtUnit !== null && ph.role === 'onset') {
        off += 0.012;
        rel = 0.02;
      }
      if (prvUnit !== null && Math.abs(on - s) < 1e-9) {
        on -= 0.004;
        att = 0.016;
      }
      const [lo, hi] = PH.FRICATIVE_BANDS[ph.sym];
      this.noises.push(
        new NoiseEvent(
          'fricative', ph.sym, on, off, att, rel, lo * tf, hi * tf, PH.FRICATIVE_LEVEL_DB[ph.sym] + gdb,
          ph.voiced ? PH.VOICED_BUZZ_DB + gdb : null, k, 'ahr', label,
        ),
      );
      if (nxtUnit !== null) setPre(nxtUnit, 'fricative', k, null, ph.voiced);
    } else if (ph.kind === 'affricate') {
      const d = Math.min(L, 0.16);
      let a0;
      let a1;
      if (ph.role === 'onset') {
        a0 = e - d;
        a1 = e;
      } else {
        a0 = s;
        a1 = s + d;
      }
      const cl = Math.max(0.025, 0.4 * d);
      const nOn = a0 + cl;
      const nOff = a1 + (nxtUnit !== null ? 0.01 : 0.0);
      const [lo, hi] = PH.FRICATIVE_BANDS[ph.sym];
      this.closures.push(new Closure(s, nOn, ph.sym, true, ph.wordFinal, k, label));
      this.noises.push(
        new NoiseEvent(
          'affricate', ph.sym, nOn, nOff, 0.004, 0.015, lo * tf, hi * tf, PH.FRICATIVE_LEVEL_DB[ph.sym] + gdb,
          ph.voiced ? PH.VOICED_BUZZ_DB + gdb : null, k, 'ahr', label,
        ),
      );
      if (nxtUnit !== null) setPre(nxtUnit, 'affricate', k, null, ph.voiced);
    } else if (ph.kind === 'plosive') {
      let level = null;
      if (nxtUnit !== null) {
        if (ph.role === 'onset' || bare) level = 'full';
        else if (!ph.voiced || this.releaseCodas) level = 'final';
      } else if (phraseEnd) {
        if (bare) level = 'full';
        else if (!ph.voiced || this.releaseCodas) level = 'final';
      } else if (this.releaseCodas && ph.role === 'coda') level = 'final'; // released into the obstruent after it
      let tRel = nxtUnit !== null || !phraseEnd ? e : s + Math.min(L, FINAL_CLOSURE);
      const cr = level === 'final' && ph.role === 'coda' && this.codaRelease ? this.codaRelease(ph) : null;
      if (cr && nxtUnit === null && !phraseEnd) tRel = Math.min(tRel, s + Math.max(cr.early, 0.5 * L));
      let released = false;
      if (level !== null && v.click > 0) {
        let db = this.burstDb + 20 * Math.log10(v.click) + (ph.voiced ? -4.0 : 0.0) + gdb;
        if (level === 'final') db += v.finalRelease > 0 ? 20 * Math.log10(v.finalRelease) : -200.0;
        if (cr) db += cr.db;
        if (db > -90) {
          const [lo, hi] = this.burstBands[ph.place];
          const blen = PH.BURST_LEN[ph.place];
          this.noises.push(
            new NoiseEvent(
              level === 'full' ? 'burst' : 'final_burst', ph.sym, tRel + 0.001, tRel + 0.001 + blen, 0.0007, blen,
              lo * tf, hi * tf, db, null, k, 'burst', label,
            ),
          );
          released = true;
          // (a voiceless one: its puff of breath after the release, where no vowel follows to carry the aspiration)
          if (cr?.puff > 0 && !ph.voiced && nxtUnit === null && v.aspiration > 0) {
            const [plo, phi] = PUFF_BANDS[ph.place];
            this.noises.push(
              new NoiseEvent(
                'fricative', ph.sym, tRel + 0.002, tRel + 0.002 + cr.puff, 0.004, 0.6 * cr.puff, plo * tf, phi * tf,
                ASP_DB + 20 * Math.log10(v.aspiration) + gdb, null, k, 'ahr', label,
              ),
            );
          }
        }
      }
      this.closures.push(new Closure(s, tRel, ph.sym, released, ph.wordFinal, k, label));
      if (nxtUnit !== null) {
        setPre(nxtUnit, 'plosive', k, level, ph.voiced);
        if (level === 'full' && !ph.voiced && released && v.aspiration > 0) {
          nxtUnit.hasAsp = true;
          nxtUnit.aspOn = tRel + 0.003;
          nxtUnit.aspOff = tRel + this.aspLen;
          nxtUnit.aspDb = ASP_DB + 20 * Math.log10(v.aspiration) + gdb;
          nxtUnit.aspAttack = 0.003;
          nxtUnit.aspRelease = 0.008;
        }
      }
    } else if (ph.kind === 'aspirate') {
      if (nxtUnit !== null) {
        nxtUnit.hasAsp = true;
        nxtUnit.aspOn = Math.max(s, e - 0.08);
        nxtUnit.aspOff = e + 0.02;
        nxtUnit.aspDb = H_DB + gdb;
        nxtUnit.aspAttack = 0.015;
        nxtUnit.aspRelease = 0.03;
        setPre(nxtUnit, 'aspirate', k, null, false);
      }
    }
  }

  // ---- unit timing
  setOn(u) {
    u.on = u.leadStart;
    u.attack = this.V.attack;
    if (u.preKind === null) return;
    if (u.preKind === 'plosive') {
      let delay;
      if (u.preLevel === 'full') delay = u.preVoiced ? 0.015 : this.voicelessOnset;
      else if (u.preLevel === 'final') delay = 0.01;
      else delay = 0.006;
      u.on = u.leadStart + delay;
      u.attack = 0.008;
    } else if (u.preKind === 'affricate') u.attack = 0.01;
    else if (u.preKind === 'fricative') u.attack = 0.014;
  }

  setOff(u, mark) {
    const dt = this.dt;
    if (u.postPhone >= 0) {
      const ph = this.P[u.postPhone];
      const start = u.postStart;
      if (ph.kind === 'plosive' || ph.kind === 'affricate') {
        u.off = start + CUT;
        u.release = CUT;
      } else if (ph.kind === 'fricative') {
        if (ph.voiced) {
          u.off = start + 0.022;
          u.release = 0.025;
        } else {
          u.off = start + 0.012;
          u.release = 0.02;
        }
      } else {
        u.off = start + 0.015;
        u.release = 0.025;
      }
    } else if (u.nextUnit !== null) {
      const nxt = u.nextUnit;
      const cap = u.lastSonStart + (u.sonCoda.length > 0 ? this.sonLinkCap : this.vowelCap) * dt;
      const fade = Math.max(nxt.attack, this.V.overlap);
      if (nxt.on + fade <= cap) {
        u.off = nxt.on + fade;
        u.release = fade;
      } else {
        u.off = cap;
        u.release = this.V.release;
      }
    } else {
      let tail = (u.sonCoda.length > 0 ? SON_CAP : PHRASE_TAIL) * dt;
      if (mark === '...') tail *= 1.3;
      u.off = u.lastSonStart + tail;
      u.release = mark === '...' ? 0.12 : 0.07;
    }
    u.off = Math.max(u.off, u.on + Math.max(0.05, u.attack + 0.5 * u.release));
  }

  // ---- articulation (human mode)
  /** Unstressed reduction toward schwa + token-to-token formant variation. */
  articulate(u, V0, tg) {
    if (u.kind !== 'vowel') return V0;
    const word = this.an.words[u.word];
    const r = word.functionWord
      ? this.reduceFunction
      : this.an.syllables[u.syllable].stress !== 0
        ? 0.0
        : this.reduceUnstressed;
    const sch = tg.schwa(u.shout);
    const rng = this.rArt;
    const zf = [rng.nextGaussian(), rng.nextGaussian(), rng.nextGaussian()];
    const zb = [rng.nextGaussian(), rng.nextGaussian(), rng.nextGaussian()];
    let out = [];
    for (const T of V0) {
      const F = T.F.slice();
      const B = T.B.slice();
      for (let i = 0; i < 3; i++) {
        F[i] = (sch[i] + (1.0 - r) * (F[i] - sch[i])) * Math.exp(Human.SCATTER * zf[i]);
        B[i] *= Math.exp(Human.BW_SCATTER * zb[i]);
      }
      F[1] = Math.max(F[1], F[0] + 150.0);
      F[2] = Math.max(F[2], F[1] + 200.0);
      out.push(tg.modified(T, F, B));
    }
    const spec = out.length === 1 ? this.visc[u.sym] : undefined;
    if (spec !== undefined) {
      // vowel-inherent spectral change: even "monophthongs" move a little
      const T = out[0];
      const ends = [];
      for (const sp of spec) {
        if (sp === null) {
          ends.push(T);
          continue;
        }
        const [other, amt] = sp;
        const G = other === 'schwa' ? sch : tg.vowel(other, u.shout).F;
        const F = T.F.slice();
        for (let i = 0; i < 3; i++) F[i] = F[i] + amt * (G[i] - F[i]);
        ends.push(tg.modified(T, F, T.B));
      }
      out = ends;
    }
    return out;
  }

  /** @returns {{L: Target, dur: number}|null} */
  onsetLocus(u, V0) {
    if (u.preKind === null || u.sonOnset.length > 0 || !isStopOrFric(u.preKind)) return null;
    const place = this.P[u.prePhone].place;
    const L = new Target(Human.locus(V0.F, place, u.preKind, this.V.tube), V0.B, V0.levelDb);
    L.levelOf = V0; // a transition shares its vowel's level (read by the singer's re-levelling)
    return { L, dur: u.preKind !== 'fricative' ? Human.TRANS_S[place] : 0.04 };
  }

  /** @returns {{C: Target, dur: number}|null} */
  codaLocus(u, cur) {
    if (u.postPhone < 0 || u.sonCoda.length > 0) return null;
    const ph = this.P[u.postPhone];
    if (!isStopOrFric(ph.kind)) return null;
    const C = new Target(Human.locus(cur.F, ph.place, ph.kind, this.V.tube), cur.B, cur.levelDb);
    C.levelOf = cur;
    return { C, dur: Human.CODA_TRANS };
  }

  keyframes(u, tg) {
    const P = this.P;
    let Vs = tg.nucleus(u);
    const art = this.tech.has('articulation');
    if (art) Vs = this.articulate(u, Vs, tg);
    const tFirst = u.hasAsp ? Math.min(u.on, u.aspOn) : u.on;
    const kf = [];
    const ol = art ? this.onsetLocus(u, Vs[0]) : null;
    if (ol !== null) {
      kf.push([tFirst - 0.01, ol.L]);
      kf.push([u.on + ol.dur, Vs[0]]);
    } else if (u.sonOnset.length > 0) {
      const S = P[u.sonOnset[u.sonOnset.length - 1]];
      const TS = tg.sonorant(S.sym, 'onset', u.shout);
      if (S.kind === 'nasal') {
        kf.push([tFirst - 0.01, TS]);
        kf.push([u.nucT - 0.006, TS]);
        kf.push([u.nucT + 0.024, Vs[0]]);
      } else {
        // glide / liquid: formants glide to the vowel over ~55 ms
        const g0 = Math.max(tFirst, u.leadStart);
        kf.push([tFirst - 0.01, TS]);
        kf.push([g0 + 0.012, TS]);
        kf.push([g0 + 0.067, Vs[0]]);
      }
    } else kf.push([tFirst - 0.01, Vs[0]]);
    const nucEnd = u.sonCoda.length > 0 ? u.codaStarts[0] : u.off - 0.5 * u.release;
    if (Vs.length === 2) {
      const ta = Math.max(u.on, u.nucT);
      const D = Math.max(nucEnd - ta, 0.04);
      kf.push([ta + 0.3 * D, Vs[0]]);
      kf.push([ta + 0.85 * D, Vs[1]]);
    }
    let cur = Vs[Vs.length - 1];
    for (let i = 0; i < u.sonCoda.length; i++) {
      const k = u.sonCoda[i];
      const st = u.codaStarts[i];
      const T = tg.sonorant(P[k].sym, 'coda', u.shout);
      if (P[k].kind === 'nasal') {
        kf.push([st - 0.008, cur]); // vowel flows into a hum
        kf.push([st + 0.022, T]);
      } else {
        kf.push([st - 0.015, cur]); // glide toward l / r
        kf.push([st + 0.045, T]);
      }
      cur = T;
    }
    const cl = art ? this.codaLocus(u, cur) : null;
    if (cl !== null) {
      kf.push([u.off - cl.dur, cur]);
      kf.push([u.off + 0.004, cl.C]);
      cur = cl.C;
    }
    kf.push([u.off + 0.02, cur]);
    const fixed = [];
    let lastT = -1e9;
    for (const [t0, T] of kf) {
      const t = Math.max(t0, lastT + 1e-4);
      fixed.push({ t, target: T });
      lastT = t;
    }
    u.keyframes = fixed;
    // steady part of the nucleus (after onset transitions, before release / coda)
    let steady = u.on;
    for (const k of fixed) {
      if (k.target === Vs[0]) {
        steady = k.t;
        break;
      }
    }
    let h0 = Math.max(u.on + u.attack, steady) + 0.005;
    let h1 = (u.sonCoda.length > 0 ? u.codaStarts[0] : u.off - u.release) - 0.005;
    if (h1 - h0 < 0.02) {
      const c = 0.5 * (u.on + nucEnd);
      h0 = c - 0.01;
      h1 = c + 0.01;
    }
    u.holdStart = h0;
    u.holdEnd = h1;
  }

  // ---- intonation and levels (full mode)
  tune(rng) {
    const an = this.an;
    const ns = an.syllables.length;
    const nudges = new Float64Array(ns);
    const jitterDb = new Float64Array(ns);
    for (let i = 0; i < ns; i++) nudges[i] = 0.0 + 18.0 * rng.nextGaussian();
    for (let i = 0; i < ns; i++) jitterDb[i] = 0.0 + 0.7 * rng.nextGaussian();
    for (const [pi, us] of byPhrase(this.units)) {
      const p = an.phrases[pi];
      const [c0, c1, cFinal] = declination(p.mark);
      const span = Math.max(p.tEnd - p.tStart, 1e-3);
      const decl = (t) => {
        const x = Math.min(Math.max((t - p.tStart) / span, 0.0), 1.0);
        return c0 + (c1 - c0) * x;
      };
      const lastU = us[us.length - 1];
      const lastWord = lastU.word;
      let wFirst = null;
      let wLast = null;
      for (const x of us) {
        if (x.word === lastWord) {
          if (wFirst === null) wFirst = x;
          wLast = x;
        }
      }
      const w0 = wFirst.on;
      const w1 = Math.max(wLast.off - wLast.release, wFirst.on + 0.02);
      const rise = (t) => QUESTION_RISE * Math.pow(Math.min(Math.max((t - w0) / (w1 - w0), 0.0), 1.0), 1.3);
      for (const u of us) {
        const word = an.words[u.word];
        const syl = an.syllables[u.syllable];
        const tEnd = Math.max(u.off - u.release, u.on + 0.01);
        let cOn = decl(u.on);
        let cOff = decl(tEnd);
        if (u === lastU) cOff += cFinal;
        if (p.mark === '?' && u.word === lastWord) {
          cOn += rise(u.on);
          cOff += rise(tEnd);
        }
        const extra = nudges[u.syllable] + (word.functionWord ? -25.0 : 0.0);
        u.cOn = (cOn + extra) * this.V.pitchRange;
        u.cOff = (cOff + extra) * this.V.pitchRange;
        let g = jitterDb[u.syllable];
        if (p.mark === '!') g += 2.0;
        if (word.functionWord) g -= 2.5;
        else if (syl.indexInWord === 0 && syl.nInWord > 1) g += 1.0;
        if (u.shout) {
          u.cOn += SHOUT_CENTS;
          u.cOff += SHOUT_CENTS;
          g += SHOUT_DB;
        }
        if (p.mark === '...' && u.word === lastWord) u.fadeDb = u === lastU ? -12.0 : -4.0;
        u.gainDb = g;
      }
    }
  }

  // ---- main
  run(rng, rProsody) {
    const tg = new Targets(this.V, this.mode, this.tech.has('glottis') ? this.V.rd : 0.0);
    this.targets = tg;
    const breath = this.mode === 'video' ? VIDEO_BREATH : this.V.breath;
    const an = this.an;
    for (let pi = 0; pi < an.phrases.length; pi++) {
      const seq = this.phraseSequence(pi);
      let prev = null;
      let i = 0;
      while (i < seq.length) {
        if (seq[i].unit !== null) {
          if (i + 1 < seq.length && seq[i + 1].unit !== null) seq[i].unit.nextUnit = seq[i + 1].unit;
          prev = seq[i].unit;
          i++;
          continue;
        }
        let j = i;
        const run = [];
        while (j < seq.length && seq[j].unit === null) run.push(seq[j++].phone);
        const nxt = j < seq.length ? seq[j].unit : null;
        this.gap(prev, run, nxt);
        prev = null;
        i = j;
      }
      const us = [];
      for (const it of seq) if (it.unit !== null) us.push(it.unit);
      for (const u of us) this.setOn(u);
      for (const u of us) this.setOff(u, an.phrases[pi].mark);
      for (const u of us) {
        u.index = this.units.length;
        this.units.push(u);
      }
    }
    for (const u of this.units) {
      u.breath = breath * (u.shout ? 0.35 : 1.0);
      u.bright = this.V.bright + (u.shout ? 0.5 : 0.0);
      this.keyframes(u, tg);
    }
    if (this.tech.has('prosody')) {
      this.prosody = Human.planProsody(this, rProsody);
      // a weak syllable's consonants are weak too (shout is already in their level)
      const unitDb = new Map();
      for (const u of this.units) unitDb.set(u.syllable, u.gainDb - (u.shout ? SHOUT_DB : 0.0));
      for (const e of this.noises) {
        const db = unitDb.get(this.P[e.phone].syllable);
        if (db !== undefined) {
          e.gainDb += Human.CONSONANT_FOLLOW * db;
          if (e.buzzDb !== null) e.buzzDb = e.buzzDb + Human.CONSONANT_FOLLOW * db;
        }
      }
    } else this.tune(rng);
  }
}
