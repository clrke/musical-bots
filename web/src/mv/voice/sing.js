// Singing renderer: one sung line of a formant voice (JS port of the approved prototype
// /tmp/mv-sing/sing.py, which monkeypatches mumble-speech; mode 'human' = LF glottis by Rd,
// formant articulation and high-band air, with the speech prosody replaced by the notes).
//
//   renderLine(job) -> { pcm, sampleRate: 24000, startOffset, syllableTimes, peak }
//   job = { voice, text, syllables?, senses?, notes: [{ t, dur, midi, downbeat? }], seed, vibrato: { rate, depth }, mode }
//
// What makes it sing (each step is one sing.py patch):
// * beat-grid retiming: every phone is moved onto its note - the vowel on the beat, onset
//   consonants just before it, coda consonants at the note end (or right before the next onset
//   when the next note follows legato);
// * every voiced unit sings its note (cents re the line's mean pitch), 25 ms glides between notes
//   (the speech tune's smoothing), delayed vibrato (job.vibrato, rate wander +-2 %);
// * phrase-final vowels and vowels before a rest hold to the note end; vowels may ring as long
//   as their note (no speech caps), barely reduce, and monophthongs stay put;
// * sung diphthongs hold the first vowel and glide to the second only near the end ("ah-ee");
// * per-note level calibration: every keyframe target is re-levelled at its note's pitch, so a
//   harmonic landing on F1 does not make one note jump out.
// Level refinements over sing.py (steady parts of notes unchanged): transition (locus) targets
// share their vowel's correction, the correction follows the pitch glide where a unit overlaps
// the previous / next note, and formant sweeps get calibrated points; together they remove the
// up-to-15 dB transients sing.py makes on leaps and diphthong glides at high pitch.
// Changed in this copy (vs upstream magna-vocalization): the words are sung as CMUdict says them
// (text/pronunciation.js) and job.senses picks a heteronym's sense ("wind=noun"); notes are
// levelled by their syllable's stress (text/sungStress.js, Magna.Core Sing.cs: function words and
// articles softer, stressed syllables louder, the downbeat accent mostly under stressed ones);
// stop consonants are articulated more clearly than in speech (SungPlanner: bursts, aspiration,
// coda releases).
//
// Extensions over sing.py: a manual hyphenation (job.syllables) is analysed with the line, so
// each hyphen piece is one sung syllable (src/voice/text/hyphenation.js); should syllabify() and
// the analyser ever disagree, a syllable spans several notes (melisma) or a note several
// syllables instead of failing; nucleus-less syllables ("shh") are parked before the next sung
// syllable (sing.py leaves them at their typing times).

import { syllabify } from './syllables.js';
import { isArticle, level as stressLevel, properWord, stressAware, sungGainDb } from './text/sungStress.js';
import { Planner, noNucleus } from './render/planner.js';
import { Target } from './render/renderData.js';
import { FS, K, prepare, streams, synthesize, interpGrid, edgeFade } from './render/renderer.js';
import { analyze, LETTER_DT, PH, voiceWith, voicedLevelDb, interp } from './render/port.js';

export const SAMPLE_RATE = FS;
/** Lead-in (s) rendered before the first note: onset consonants sit before the beat. */
export const PRE = 0.3;
/**
 * Output gain on the synthesiser's calibrated level (a sustained vowel is unit RMS): pcm has a
 * sung vowel at about -20 dBFS RMS, peaks around -10 dBFS. Same for every line and voice, so
 * lines can be mixed as they are.
 */
export const LEVEL = 0.1;
/** Human-mode techniques used for singing (sing.py HUMANIZE): LF pulse, CV transitions, air. */
export const HUMANIZE = ['glottis', 'articulation', 'air'];
export const DEFAULT_VIBRATO = { rate: 5.5, depth: 35.0 };

// natural onset / coda consonant lengths on the beat grid (s)
const NAT = { plosive: 0.065, fricative: 0.085, affricate: 0.11, aspirate: 0.06 };
const SON_LEAD = { nasal: 0.075, glide: 0.06, liquid: 0.06 };
const CODA_SON = 0.1; // sung coda nasal / liquid ("in", "wind"): hum the last 100 ms of the note
const lead = (kind) => SON_LEAD[kind] ?? NAT[kind] ?? 0.06;
// sung stop bursts (see SungPlanner): +6 dB, and the labial band widened from 600..1200 Hz
const SUNG_BURST_BOOST_DB = 6.0;
const SUNG_BURST_BANDS = Object.freeze({ ...PH.BURST_BANDS, labial: Object.freeze([300.0, 3000.0]) });
const codaLen = (kind) => (SON_LEAD[kind] !== undefined ? CODA_SON : NAT[kind] ?? 0.06);
/** A held note (s): its syllable's final consonants are sung at the end of the hold, a final stop released clearly. */
export const HELD_NOTE = 0.4;
// a held note's coda stop before another consonant: released this long (s) after its closure starts
const HELD_CODA_RELEASE = 0.04;
// ... and a voiceless one breathes out this long (s) after its release
const HELD_CODA_PUFF = 0.05;
/**
 * A voiced onset stop (b, d, g before its vowel) is prevoiced: the voice hums through the last PREVOICE s of its closure
 * (a voice bar: the closed tract's murmur, VOICE_BAR_DB re the vowel), as a singer's /b/ is. Without it the closure was
 * silent and the release a voiceless one's: "Musical Bots" was heard as "musical pots" (Whisper, QA v24), b-words 40%.
 */
export const PREVOICE = 0.05;
/**
 * A proper noun inside a line (a capitalised word that does not open it, not "I": a name, a brand, "Musical Bots", "Meta")
 * is sung out: its vowels PROPER_DB louder, its consonants PROPER_CONS_DB (QA v24: "Meta" lost in the full mix as "for
 * midden", "Musical Bots" as "musical pots").
 */
export const PROPER_DB = 2.0, PROPER_CONS_DB = 3.0;
/** ... and a breath before it (s): the vowel before it ends this long before it starts (when that vowel is long enough). */
export const PROPER_BREATH = 0.05;
/** A proper noun inside a line (sungStress.js properWord). Pure. */
export function properNoun(an, wi) {
  return properWord(an.words[wi]?.text, wi);
}
export const VOICE_BAR_DB = -18.0;
/** A nasal + glide onset ("mu", "new") starts this long (s) before its vowel at most: the nasal's murmur, then the glide. */
export const NASAL_GLIDE = 0.13;
const VOICE_BAR_F = Object.freeze([190.0, 900.0, 2200.0]);

/** MIDI note -> Hz. */
export function hz(m) {
  return 440.0 * Math.pow(2.0, (m - 69) / 12.0);
}

const clip01 = (x) => (x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x);

// ------------------------------------------------------------------ notes -> syllables
/**
 * Note of every analysed syllable with a nucleus. One note per syllable when the counts agree
 * (always, unless a manual hyphenation disagrees with the analyser); otherwise per word (or
 * over the whole line) a syllable takes several notes (melisma, `sub`) or a note is shared by
 * several syllables (split evenly in time).
 * @returns {{sylNote: Map<number, {T:number, E:number, midi:number, downbeat:boolean, sub:Array|null}>, noteSyls: number[][]}}
 *   noteSyls[i]: the analysed syllables note i sings.
 */
export function assignNotes(an, sylls, notes) {
  const nuc = [];
  for (let si = 0; si < an.syllables.length; si++) if (!noNucleus(an.syllables[si].nucleus)) nuc.push(si);
  const sylNote = new Map();
  const noteSyls = notes.map(() => []);
  if (nuc.length === notes.length) {
    for (let i = 0; i < nuc.length; i++) {
      sylNote.set(nuc[i], { ...notes[i], sub: null });
      noteSyls[i].push(nuc[i]);
    }
    return { sylNote, noteSyls };
  }
  // group analysed syllables and notes into matching runs (per word when the words line up)
  const groups = [];
  const aw = new Map();
  for (const si of nuc) {
    const w = an.syllables[si].word;
    if (!aw.has(w)) aw.set(w, []);
    aw.get(w).push(si);
  }
  const bw = new Map();
  sylls.forEach((s, i) => {
    const w = s.wordIndex ?? 0;
    if (!bw.has(w)) bw.set(w, []);
    bw.get(w).push(i);
  });
  const all = notes.map((_, i) => i);
  if (aw.size === bw.size && aw.size > 0) {
    const A = [...aw.values()];
    const B = [...bw.values()];
    for (let w = 0; w < A.length; w++) groups.push([A[w], B[w]]);
  } else if (nuc.length > 0) groups.push([nuc, all]);
  for (const [ss, ns] of groups) {
    if (ss.length === ns.length) {
      ss.forEach((si, i) => {
        sylNote.set(si, { ...notes[ns[i]], sub: null });
        noteSyls[ns[i]].push(si);
      });
    } else if (ss.length < ns.length) {
      // melisma: syllable j sings notes [a_j, a_{j+1}), the extra notes spread evenly
      for (let j = 0; j < ss.length; j++) {
        const a = Math.floor((j * ns.length) / ss.length);
        const b = Math.floor(((j + 1) * ns.length) / ss.length);
        const sub = ns.slice(a, b).map((i) => notes[i]);
        const first = sub[0];
        sylNote.set(ss[j], { T: first.T, E: sub[sub.length - 1].E, midi: first.midi, downbeat: first.downbeat, sub: sub.length > 1 ? sub : null });
        for (let q = a; q < b; q++) noteSyls[ns[q]].push(ss[j]);
      }
    } else {
      // several syllables per note: split the note evenly between them
      for (let k = 0; k < ns.length; k++) {
        const a = Math.floor((k * ss.length) / ns.length);
        const b = Math.floor(((k + 1) * ss.length) / ns.length);
        const q = b - a;
        const nt = notes[ns[k]];
        const D = (nt.E - nt.T) / q;
        for (let j = 0; j < q; j++) {
          sylNote.set(ss[a + j], { T: nt.T + j * D, E: nt.T + (j + 1) * D, midi: nt.midi, downbeat: j === 0 && nt.downbeat, sub: null });
          noteSyls[ns[k]].push(ss[a + j]);
        }
      }
    }
  }
  return { sylNote, noteSyls };
}

/**
 * Move every phone onto the beat grid, in place (sing.py _retime): vowel on the beat, onset
 * consonants backward from it, coda consonants backward from the next onset (legato) or from
 * the note end; then next-phone times and phrase spans.
 */
function retime(an, sylNote, lastE) {
  const P = an.phones;
  const S = an.syllables;
  const sylls = [...sylNote.keys()].sort((a, b) => a - b);
  const onsetLead = (si) => {
    let s = 0;
    for (const k of S[si].onset) s += lead(P[k].kind);
    return s;
  };
  for (let i = 0; i < sylls.length; i++) {
    const si = sylls[i];
    const { T, E } = sylNote.get(si);
    const s = S[si];
    P[s.nucleus].t = T;
    let cur = T;
    for (let q = s.onset.length - 1; q >= 0; q--) {
      const k = s.onset[q];
      cur -= lead(P[k].kind);
      P[k].t = cur;
    }
    // the coda ends where the next syllable's onset begins (legato) or at the note end (a held note's too: the vowel
    // rings through the hold, its final consonants sung at its end; SungPlanner.codaRelease)
    let ce;
    if (i + 1 < sylls.length && sylNote.get(sylls[i + 1]).T - E < 0.05) {
      ce = sylNote.get(sylls[i + 1]).T - onsetLead(sylls[i + 1]);
    } else ce = E - 0.02;
    cur = ce;
    for (let q = s.coda.length - 1; q >= 0; q--) {
      const k = s.coda[q];
      cur -= codaLen(P[k].kind);
      P[k].t = cur;
    }
  }
  // nucleus-less syllables ("shh", "psst"): park them right before the next sung syllable
  // (or after the last one); sing.py leaves them at their typing times
  for (let si = 0; si < S.length; si++) {
    const s = S[si];
    if (!noNucleus(s.nucleus)) continue;
    const ks = [...s.onset, ...s.coda];
    if (ks.length === 0) continue;
    let nextSi = -1;
    for (const x of sylls) if (x > si) { nextSi = x; break; }
    if (nextSi >= 0) {
      const ns = S[nextSi];
      let cur = ns.onset.length > 0 ? P[ns.onset[0]].t : P[ns.nucleus].t;
      cur -= 0.02;
      for (let q = ks.length - 1; q >= 0; q--) {
        cur -= lead(P[ks[q]].kind);
        P[ks[q]].t = Math.max(cur, 0.005);
      }
    } else {
      let cur = lastE;
      for (const k of ks) {
        P[k].t = cur;
        cur += lead(P[k].kind);
      }
    }
  }
  const order = P.map((p, k) => k).sort((a, b) => (P[a].t !== P[b].t ? P[a].t - P[b].t : a - b));
  for (let r = 0; r < order.length; r++) {
    const k = order[r];
    P[k].tNext = r + 1 < order.length ? P[order[r + 1]].t : lastE;
    if (P[k].tNext <= P[k].t) P[k].tNext = P[k].t + 0.02;
  }
  for (const p of an.phrases) {
    let t0 = Infinity;
    for (const wi of p.words) for (const k of an.words[wi].phones) t0 = Math.min(t0, P[k].t);
    p.tStart = t0;
    p.tEnd = lastE;
  }
}

// ------------------------------------------------------------------ planner
/** The speech planner with sing.py's patches (_tune, _set_off, _keyframes, caps, reduction). */
class SungPlanner extends Planner {
  constructor(an, voice, mode, tech, rArt, sylNote) {
    super(an, voice, mode, tech, rArt);
    this.sylNote = sylNote;
    this.vowelCap = 1e3; // a vowel may ring on as long as its note
    this.sonLinkCap = 1e3;
    this.visc = {}; // sung monophthongs stay put
    this.reduceUnstressed = 0.1; // sung vowels barely reduce
    this.reduceFunction = 0.15;
    // clearer stops (sung over notes, upstream's speech-level stops were mostly misheard: Whisper
    // on "I put the X on the shelf" got 14 of 80 b / p / t / d / k / g words right, 29 with these):
    // louder bursts, the labial burst spread over 300..3000 Hz (600..1200 was heard as g / k / d),
    // 40 ms aspiration with the voice 35 ms after a voiceless release (p / b apart), and coda
    // stops released: voiced ones ("bed", "dog") and those before another obstruent ("box" k-s)
    this.burstDb += SUNG_BURST_BOOST_DB;
    this.burstBands = SUNG_BURST_BANDS;
    this.aspLen = 0.04;
    this.voicelessOnset = 0.035;
    this.releaseCodas = true;
    // a held note's final stop ("White" held two beats, QA v19: heard as "Why"): the vowel rings to the end of the
    // hold and the stop closes there (retime), released as clearly as an onset's, on its own before the next consonant
    this.codaRelease = (ph) => {
      const nt = sylNote.get(ph.syllable);
      if (!nt || nt.E - nt.T < HELD_NOTE) return null;
      return { db: -20 * Math.log10(Math.max(0.05, Math.min(1, voice.finalRelease || 1))), early: HELD_CODA_RELEASE, puff: HELD_CODA_PUFF };
    };
  }

  /** A voiced onset stop's vowel starts in its closure (PREVOICE): its voice bar. */
  setOn(u) {
    super.setOn(u);
    u.voiceBar = null;
    if (u.preKind !== 'plosive' || !u.preVoiced || u.preLevel !== 'full' || !(PREVOICE > 0)) return;
    const cl = this.closures.find((c) => c.phone === u.prePhone);
    if (!cl) return;
    const t0 = Math.max(cl.t0 + 0.008, cl.t1 - PREVOICE);
    if (cl.t1 - t0 < 0.015) return;
    u.voiceBar = { t0, rel: cl.t1, on: u.on, attack: u.attack };
    u.on = t0;
    u.attack = 0.012;
  }

  /** The voice bar's target: the closed tract (low F1, damped), VOICE_BAR_DB under a vowel. */
  voiceBarTarget(tg) {
    if (!this._voiceBar) {
      const t = this.V.tube, hp = PH.HIGHER_POLES;
      const F = [VOICE_BAR_F[0] * t, VOICE_BAR_F[1] * t, VOICE_BAR_F[2] * t, PH.F4_HZ * t, hp[0] * t, hp[1] * t, hp[2] * t];
      const B = tg.bw(true).map((b) => b * 1.5);
      this._voiceBar = new Target(F, B, tg.calib(F, B) + VOICE_BAR_DB);
    }
    return this._voiceBar;
  }

  /** Every voiced unit sings its syllable's note (flat within the note). */
  tune() {
    for (const u of this.units) {
      const nt = this.sylNote.get(u.syllable);
      const c = 1200.0 * Math.log2(hz(nt.midi) / this.V.f0);
      u.cOn = c;
      u.cOff = c;
      let g = 0.0;
      if (stressAware()) {
        // by the syllable's stress: weak words softer (articles the softest), stressed syllables a little louder
        g = sungGainDb(stressLevel(this.an, u.syllable), isArticle(this.an.words[u.word]), nt.downbeat);
      } else {
        if (nt.downbeat) g += 1.0;
        if (this.an.words[u.word].functionWord) g -= 1.0;
      }
      if (properNoun(this.an, u.word)) g += PROPER_DB;
      u.gainDb = g;
    }
  }

  run(rng, rProsody) {
    super.run(rng, rProsody);
    // a proper noun's consonants sung out too (PROPER_CONS_DB)
    for (const e of this.noises) if (properNoun(this.an, this.P[e.phone].word)) e.gainDb += PROPER_CONS_DB;
  }

  /** Phrase-final / pre-rest vowels hold to the note end. A breath (PROPER_BREATH) before a proper noun. */
  setOff(u, mark) {
    this.properOff(u, mark);
    const nx = u.nextUnit;
    if (nx && PROPER_BREATH > 0 && nx.word !== u.word && properNoun(this.an, nx.word) && u.postPhone < 0) {
      const cut = nx.leadStart - PROPER_BREATH;
      if (cut > u.on + 0.12 && cut < u.off) {
        u.off = cut;
        u.release = Math.min(u.release, 0.04);
      }
    }
  }

  properOff(u, mark) {
    super.setOff(u, mark);
    const E = this.sylNote.get(u.syllable).E;
    if (u.postPhone < 0 && u.nextUnit === null) {
      u.off = E - 0.03;
      u.release = 0.12;
    } else if (u.nextUnit !== null) {
      const nT = this.sylNote.get(u.nextUnit.syllable).T;
      if (nT - E >= 0.05) {
        // a rest follows: end the note instead of linking over the rest
        u.off = E - 0.03;
        u.release = 0.08;
      }
    }
    u.off = Math.max(u.off, u.on + Math.max(0.05, u.attack + 0.5 * u.release));
  }

  /** Sung diphthong: hold the first vowel, glide to the second only near the end. A voice bar before a prevoiced vowel. */
  keyframes(u, tg) {
    const vb = u.voiceBar;
    if (vb) {
      // (the vowel's own transitions from its release, as without the voice bar; the hum before them)
      const on = u.on, attack = u.attack;
      u.on = vb.on;
      u.attack = vb.attack;
      this.vowelKeyframes(u, tg);
      u.on = on;
      u.attack = attack;
      const VB = this.voiceBarTarget(tg);
      const first = u.keyframes[0].t;
      u.keyframes = [{ t: Math.min(vb.t0 - 0.01, first - 0.004), target: VB }, { t: Math.min(vb.rel - 0.002, first - 1e-4), target: VB }, ...u.keyframes];
      return;
    }
    this.vowelKeyframes(u, tg);
  }

  /** A nasal before a glide or liquid ("Musical": m-y-oo, "new", "smile"): its murmur sung before the glide (NASAL_GLIDE). */
  makeUnit(si, sonOn, sonCo, syllabic) {
    const u = super.makeUnit(si, sonOn, sonCo, syllabic);
    if (sonOn.length > 1 && this.P[sonOn[0]].kind === 'nasal') u.leadStart = Math.max(this.P[sonOn[0]].t, u.nucT - NASAL_GLIDE);
    return u;
  }

  vowelKeyframes(u, tg) {
    super.keyframes(u, tg);
    const on = u.sonOnset;
    if (on.length > 1 && this.P[on[0]].kind === 'nasal' && this.P[on[on.length - 1]].kind !== 'nasal' && u.keyframes.length >= 3) {
      // (the planner glides from the last onset sonorant only: "Musical" was sung "yusical", heard "use it", QA v24; and
      // "Muse" as "you's")
      const [g, , v] = u.keyframes;
      const N = tg.sonorant(this.P[on[0]].sym, 'onset', u.shout);
      const t0 = g.t, tv = Math.max(v.t, t0 + 0.09);
      const tg0 = Math.max(t0 + 0.045, tv - 0.065);
      const rest = u.keyframes.slice(3).filter((k) => k.t > tv + 1e-4);
      u.keyframes = [{ t: t0, target: N }, { t: tg0 - 0.012, target: N }, { t: tg0 + 0.008, target: g.target }, { t: tv, target: v.target }, ...rest];
    }
    if (u.kind !== 'vowel' || PH.DIPHTHONGS[u.sym] === undefined) return;
    const nucEnd = u.sonCoda.length > 0 ? u.codaStarts[0] : u.off - 0.5 * u.release;
    const ta = Math.max(u.on, u.nucT);
    const D = Math.max(nucEnd - ta, 0.04);
    const ta3 = ta + 0.3 * D;
    const ta85 = ta + 0.85 * D;
    const kf = u.keyframes.map((k) => ({ t: k.t, target: k.target }));
    let ia = 0;
    let ib = 0;
    for (let k = 1; k < kf.length; k++) {
      if (Math.abs(kf[k].t - ta3) < Math.abs(kf[ia].t - ta3)) ia = k;
      if (Math.abs(kf[k].t - ta85) < Math.abs(kf[ib].t - ta85)) ib = k;
    }
    if (Math.abs(kf[ia].t - ta3) > 2e-3 || Math.abs(kf[ib].t - ta85) > 2e-3 || ib <= ia) return;
    const newB = nucEnd - Math.min(0.05, 0.12 * D);
    const newA = Math.max(ta3, newB - Math.min(0.17, 0.45 * D));
    kf[ia].t = newA;
    kf[ib].t = newB;
    kf.sort((x, y) => x.t - y.t); // stable
    let last = -1e9;
    for (const k of kf) {
      k.t = Math.max(k.t, last + 1e-4);
      last = k.t;
    }
    u.keyframes = kf;
  }
}

// ------------------------------------------------------------------ pitch
/**
 * The notes as a pitch curve (render._tune_cents with knots at every unit's on / end, plus a
 * step at each melisma note), 25 ms smoothing -> 25 ms glides.
 */
function sungTuneCents(units, nMs, sylNote, f0) {
  const cents = new Float64Array(nMs);
  if (units.length === 0) return cents;
  const us = units.map((u, i) => ({ u, i })).sort((a, b) => (a.u.on !== b.u.on ? a.u.on - b.u.on : a.i - b.i));
  const T = [];
  const C = [];
  const push = (t, c) => {
    if (T.length > 0 && t <= T[T.length - 1]) t = T[T.length - 1] + 1e-4;
    T.push(t);
    C.push(c);
  };
  for (let k = 0; k < us.length; k++) {
    const u = us[k].u;
    const t0 = u.on;
    let t1 = Math.max(u.off - u.release, t0 + 0.01);
    if (k + 1 < us.length) t1 = Math.min(t1, us[k + 1].u.on - 0.003);
    t1 = Math.max(t1, t0 + 0.005);
    push(t0, u.cOn);
    const sub = sylNote.get(u.syllable)?.sub;
    let cLast = u.cOff;
    if (sub) {
      for (let j = 1; j < sub.length; j++) {
        const tb = sub[j].T;
        if (tb <= t0 || tb >= t1) continue;
        const cPrev = 1200.0 * Math.log2(hz(sub[j - 1].midi) / f0);
        cLast = 1200.0 * Math.log2(hz(sub[j].midi) / f0);
        push(tb - 0.001, cPrev);
        push(tb, cLast);
      }
    }
    push(t1, cLast);
  }
  const raw = new Float64Array(nMs);
  for (let i = 0; i < nMs; i++) raw[i] = interp(i / 1000.0, T, C);
  const k = 25;
  for (let i = 0; i < nMs; i++) {
    let s = 0.0;
    for (let j = -12; j <= 12; j++) {
      let q = i + j;
      q = q < 0 ? 0 : q >= nMs ? nMs - 1 : q;
      s += raw[q];
    }
    cents[i] = s / k;
  }
  return cents;
}

/** Delayed vibrato envelope per ms: notes of 0.4 s or more, in after 0.2 s over 0.3 s, out over the last 0.12 s. */
function vibratoEnv(notes, nMs) {
  const env = new Float64Array(nMs);
  for (const nt of notes) {
    if (nt.E - nt.T < 0.4) continue; // short notes: no vibrato
    const i0 = Math.max(0, Math.floor((nt.T + 0.2) * 1000));
    const i1 = Math.min(nMs, Math.ceil((nt.E - 0.04) * 1000) + 1);
    for (let i = i0; i < i1; i++) {
      const ms = i / 1000.0;
      const e = clip01((ms - (nt.T + 0.2)) / 0.3) * clip01((nt.E - 0.04 - ms) / 0.08);
      if (e > env[i]) env[i] = e;
    }
  }
  return env;
}

/** The note sounding at time t for a unit (its melisma sub-note, else its note). */
function noteAt(nt, t) {
  if (!nt.sub) return nt;
  let cur = nt.sub[0];
  for (const s of nt.sub) if (s.T <= t) cur = s;
  return cur;
}

/**
 * Per-note calibration: every keyframe target (vowel, diphthong end, coda nasal) is re-levelled
 * at its note's pitch (sing.py: render._level_fix only corrected the hold target, so an
 * "ee" / "n" whose F1 sits on the first harmonic jumped ~+10 dB at the end of a note).
 * Refinements over sing.py, all outside the steady part of a note: a transition (locus) target
 * takes the correction of the target it is derived from; formant sweeps get calibrated points
 * (calibrateSweeps); and where the shared pitch glides to the previous / next note (a unit's
 * swell and release overlap its neighbours) the correction follows the glide (u.levelFixT /
 * levelFixDb), so a leap does not leave a vowel boosted for its own note sounding at the next
 * note's pitch (up to +15 dB spikes).
 */
function relevel(pl, v, ctx, cents) {
  const { sylNote, rd } = ctx;
  const f0s = new Float64Array(2);
  f0s[0] = v.f0;
  const levelRef = (T) => (T.levelOf ? T.levelOf : T);
  for (const u of pl.units) {
    const nt = sylNote.get(u.syllable);
    let kfs = u.keyframes;
    if (nt.sub) kfs = melismaKeyframes(kfs, nt.sub);
    const memo = new Map();
    u.keyframes = kfs.map(({ t, target }) => {
      const fn = hz(noteAt(nt, t).midi);
      let byF = memo.get(target);
      if (byF === undefined) memo.set(target, (byF = new Map()));
      let T2 = byF.get(fn);
      if (T2 === undefined) {
        f0s[1] = fn;
        const ref = levelRef(target);
        const lv = voicedLevelDb(ref.F, ref.B, v.bright, f0s, v.oq, rd);
        T2 = new Target(target.F, target.B, target.levelDb + (lv[0] - lv[1]));
        byF.set(fn, T2);
      }
      return { t, target: T2 };
    });
    u.keyframes = calibrateSweeps(u.keyframes, (t) => hz(noteAt(nt, t).midi), v, rd);
    u.levelFixT = null;
    u.levelFixDb = null;
  }
  glideLevels(pl, v, ctx, cents, levelRef);
}

/** F1 change (octaves) per calibrated point inserted into a formant sweep. */
const SWEEP_STEP = 0.2;
const SWEEP_MAX = 6;

/**
 * Formant sweeps between keyframes (diphthong glides, consonant transitions) at the note's
 * pitch: the gain is interpolated in dB between keyframes, but a sweeping F1 that crosses a
 * harmonic makes the natural level bump by up to ~15 dB mid-way. Insert calibrated points so
 * the output level moves smoothly from one keyframe's output level to the next.
 * Inserted keyframes are flagged `inserted`.
 */
function calibrateSweeps(kfs, noteHz, v, rd) {
  const f0s = new Float64Array(1);
  const lvAt = new Map(); // target -> Map(fn -> level dB of a unit-RMS source through it)
  const level = (F, B, fn) => {
    f0s[0] = fn;
    return voicedLevelDb(F, B, v.bright, f0s, v.oq, rd)[0];
  };
  const lvOf = (T, fn) => {
    let m = lvAt.get(T);
    if (m === undefined) lvAt.set(T, (m = new Map()));
    let x = m.get(fn);
    if (x === undefined) m.set(fn, (x = level(T.F, T.B, fn)));
    return x;
  };
  const out = [];
  for (let k = 0; k < kfs.length; k++) {
    out.push(kfs[k]);
    if (k + 1 >= kfs.length) break;
    const A = kfs[k].target;
    const B = kfs[k + 1].target;
    const t0 = kfs[k].t;
    const t1 = kfs[k + 1].t;
    if (A.F === B.F || t1 - t0 < 0.008) continue;
    const oct = Math.abs(Math.log2(B.F[0] / A.F[0]));
    const nIns = Math.min(SWEEP_MAX, Math.floor(oct / SWEEP_STEP));
    if (nIns < 1) continue;
    const fn = noteHz(0.5 * (t0 + t1));
    const oA = A.levelDb + lvOf(A, fn);
    const oB = B.levelDb + lvOf(B, fn);
    for (let j = 1; j <= nIns; j++) {
      const a = j / (nIns + 1);
      const F = A.F.map((f, q) => f + a * (B.F[q] - f));
      const Bw = A.B.map((b, q) => b + a * (B.B[q] - b));
      const L = oA + a * (oB - oA) - level(F, Bw, fn);
      const T = new Target(F, Bw, L);
      out.push({ t: t0 + a * (t1 - t0), target: T, inserted: true });
    }
  }
  return out;
}

/** Cents of a note re the voice f0. */
const centsOf = (midi, f0) => 1200.0 * Math.log2(hz(midi) / f0);

/**
 * Level correction while the pitch glides away from a unit's note (see relevel): at time t
 * the target sounds at pitch c(t) instead of its note's c_u, so it is corrected by
 * w(t) * (lv(note) - lv(other note)), w = (c(t) - c_u) / (c_other - c_u) in 0..1.
 */
function glideLevels(pl, v, ctx, cents, levelRef) {
  const { sylNote, rd } = ctx;
  const us = pl.units.map((u, i) => ({ u, i })).sort((a, b) => (a.u.on !== b.u.on ? a.u.on - b.u.on : a.i - b.i)).map((x) => x.u);
  const f0s = new Float64Array(2);
  const nMs = cents.length;
  const cAt = (t) => {
    const x = t * 1000.0;
    if (x <= 0) return cents[0];
    const i = Math.floor(x);
    if (i >= nMs - 1) return cents[nMs - 1];
    return cents[i] + (x - i) * (cents[i + 1] - cents[i]);
  };
  const diff = (T, fRef, fOther) => {
    const ref = levelRef(T);
    f0s[0] = fRef;
    f0s[1] = fOther;
    const lv = voicedLevelDb(ref.F, ref.B, v.bright, f0s, v.oq, rd);
    return lv[0] - lv[1];
  };
  for (let k = 0; k < us.length; k++) {
    const u = us[k];
    const nt = sylNote.get(u.syllable);
    const first = nt.sub ? nt.sub[0] : nt;
    const last = nt.sub ? nt.sub[nt.sub.length - 1] : nt;
    const tStart = (u.hasAsp ? Math.min(u.on, u.aspOn) : u.on) - 0.005;
    const tEnd = u.off + 0.017;
    let t1 = Math.max(u.off - u.release, u.on + 0.01);
    if (k + 1 < us.length) t1 = Math.min(t1, us[k + 1].on - 0.003);
    t1 = Math.max(t1, u.on + 0.005);
    const sides = [];
    if (k > 0) {
      const prev = sylNote.get(us[k - 1].syllable);
      const other = prev.sub ? prev.sub[prev.sub.length - 1] : prev;
      if (other.midi !== first.midi) {
        const T = u.keyframes[0].target;
        sides.push({ a: tStart, b: Math.min(u.on + 0.0135, t1), cRef: centsOf(first.midi, v.f0), cOther: centsOf(other.midi, v.f0), D: diff(T, hz(first.midi), hz(other.midi)) });
      }
    }
    if (k + 1 < us.length) {
      const next = sylNote.get(us[k + 1].syllable);
      const other = next.sub ? next.sub[0] : next;
      if (other.midi !== last.midi) {
        const T = u.keyframes[u.keyframes.length - 1].target;
        sides.push({ a: Math.max(t1 - 0.0135, u.on), b: tEnd, cRef: centsOf(last.midi, v.f0), cOther: centsOf(other.midi, v.f0), D: diff(T, hz(last.midi), hz(other.midi)) });
      }
    }
    if (sides.length === 0) continue;
    const T = [];
    const Db = [];
    for (const sd of sides) {
      const span = sd.cOther - sd.cRef;
      for (let t = sd.a; ; t += 0.004) {
        const tt = Math.min(t, sd.b);
        const w = clip01((cAt(tt) - sd.cRef) / span);
        if (T.length > 0 && tt <= T[T.length - 1]) {
          if (tt >= sd.b) break;
          continue;
        }
        T.push(tt);
        Db.push(w * sd.D);
        if (tt >= sd.b) break;
      }
    }
    u.levelFixT = Float64Array.from(T);
    u.levelFixDb = Float64Array.from(Db);
  }
}

/** Melisma: the target in effect is re-levelled per note, ramping over 24 ms at each note start. */
function melismaKeyframes(kfs, sub) {
  const out = kfs.slice();
  for (let j = 1; j < sub.length; j++) {
    const tb = sub[j].T;
    if (tb <= out[0].t || tb >= out[out.length - 1].t) continue;
    let k = 0;
    while (k + 1 < out.length && out[k + 1].t <= tb - 0.012) k++;
    const T = out[k].target;
    out.push({ t: tb - 0.012, target: T }, { t: tb + 0.012, target: T });
  }
  out.sort((a, b) => a.t - b.t);
  let last = -1e9;
  for (const k of out) {
    k.t = Math.max(k.t, last + 1e-4);
    last = k.t;
  }
  return out;
}

/** Notes + 25 ms glides + delayed vibrato + per-note level calibration (sing.py pitch_track_sung). */
function sungPitchTrack(pl, v, n, rng, ctx) {
  const nMs = Math.ceil((n / FS) * 1000) + 2;
  const cents = sungTuneCents(pl.units, nMs, ctx.sylNote, v.f0);
  const env = vibratoEnv(ctx.notes, nMs);
  const ph0 = 2 * Math.PI * rng.nextDouble();
  const rate = ctx.vibrato.rate;
  const depth = ctx.vibrato.depth;
  const w = 2 * Math.PI * 0.7;
  const f0Ms = new Float64Array(nMs);
  let cum = 0.0;
  for (let i = 0; i < nMs; i++) {
    const ms = i / 1000.0;
    cum += rate * (1.0 + 0.02 * Math.sin(w * ms)); // tiny rate wander
    const phase = (2 * Math.PI * cum) / 1000.0 + ph0;
    const c = cents[i] + depth * env[i] * Math.sin(phase);
    f0Ms[i] = v.f0 * Math.pow(2.0, c / 1200.0);
  }
  const f0 = interpGrid(n, f0Ms);
  relevel(pl, v, ctx, cents);
  ctx.baseCents = cents;
  ctx.vibEnv = env;
  return { f0, f0Ms };
}

// ------------------------------------------------------------------ line
function checkJob(job) {
  if (!job || typeof job !== 'object') throw new Error('renderLine: job must be an object');
  const notes = job.notes ?? [];
  if (!Array.isArray(notes)) throw new Error('renderLine: job.notes must be an array');
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    if (!nt || !Number.isFinite(nt.t) || !Number.isFinite(nt.dur) || !Number.isFinite(nt.midi) || nt.dur <= 0) {
      throw new Error(`renderLine: bad note ${JSON.stringify(nt)}`);
    }
    if (i > 0 && nt.t < notes[i - 1].t) throw new Error(`renderLine: note ${i} starts before note ${i - 1}`);
  }
  const mode = job.mode ?? 'human';
  if (mode !== 'human' && mode !== 'full') throw new Error(`renderLine: mode must be 'human' or 'full', not '${mode}'`);
  return { notes, mode };
}

/**
 * Plan one sung line without synthesising it (also used by tests): the retimed analysis,
 * the sung planner and everything the synthesis needs.
 */
export function planLine(job, { sylls: syllsOverride = null } = {}) {
  const { notes: input, mode } = checkJob(job);
  const text = String(job.text ?? '');
  const sylls = syllsOverride ?? syllabify(text, job.syllables ?? null, job.senses ?? null);
  if (sylls.length !== input.length) {
    throw new Error(`renderLine: ${sylls.length} syllables but ${input.length} notes: "${text}"`);
  }
  const tBase = input.length > 0 ? input[0].t : 0.0;
  // buffer time of note i: PRE + (t - t0); the first note sits at PRE
  const notes = input.map((nt) => {
    const t = nt.t - tBase;
    return { T: PRE + t, E: PRE + t + nt.dur, midi: nt.midi, downbeat: Boolean(nt.downbeat) };
  });
  const seed = Number.isFinite(job.seed) ? Math.trunc(job.seed) | 0 : 0;
  const vib = job.vibrato ?? DEFAULT_VIBRATO;
  const vibrato = {
    rate: Number.isFinite(vib.rate) ? vib.rate : DEFAULT_VIBRATO.rate,
    depth: Number.isFinite(vib.depth) ? vib.depth : DEFAULT_VIBRATO.depth,
  };
  const { v: v0, tech } = prepare(job.voice, mode, mode === 'human' ? HUMANIZE : null);
  if (notes.length === 0) return { text, notes, empty: true, tBase };
  let lsum = 0.0;
  for (const nt of notes) lsum += Math.log(hz(nt.midi));
  const f0 = Math.exp(lsum / notes.length); // calibrate mid-range
  const v = voiceWith(v0, { f0 });
  const an = analyze(text, LETTER_DT / v.speed, job.syllables ?? null, job.senses ?? null);
  const { sylNote, noteSyls } = assignNotes(an, sylls, notes);
  const lastE = notes[notes.length - 1].E;
  retime(an, sylNote, lastE);
  const r = streams(text, v, seed);
  const pl = new SungPlanner(an, v, mode, tech, r[K.art], sylNote);
  pl.run(r[K.plan], r[K.pros]);
  const rd = mode === 'human' ? v.rd : 0.0;
  return { text, an, pl, v, tech, r, notes, sylNote, noteSyls, vibrato, rd, tBase, sylls, empty: false };
}

/**
 * Time span of each note's syllable(s) in buffer time: from its first onset sound to the end of
 * its voicing / coda noise. A melisma's notes split their syllable at the note starts.
 */
function noteTimes(ctx) {
  const { an, pl, sylNote, noteSyls, notes } = ctx;
  const P = an.phones;
  const span = new Map();
  for (const si of sylNote.keys()) {
    const s = an.syllables[si];
    let t0 = P[s.nucleus].t;
    for (const k of s.onset) t0 = Math.min(t0, P[k].t);
    span.set(si, [t0, sylNote.get(si).E]);
  }
  for (const u of pl.units) {
    const sp = span.get(u.syllable);
    if (!sp) continue;
    sp[0] = Math.min(sp[0], u.hasAsp ? Math.min(u.on, u.aspOn) : u.on);
    sp[1] = u.off;
  }
  for (const e of pl.noises) {
    const sp = span.get(P[e.phone].syllable);
    if (!sp) continue;
    sp[0] = Math.min(sp[0], e.on);
    sp[1] = Math.max(sp[1], e.off);
  }
  return notes.map((nt, i) => {
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const si of noteSyls[i]) {
      let [a, b] = span.get(si);
      const sub = sylNote.get(si).sub;
      if (sub) {
        const j = sub.indexOf(nt);
        if (j > 0) a = nt.T;
        if (j >= 0 && j < sub.length - 1) b = sub[j + 1].T;
      }
      t0 = Math.min(t0, a);
      t1 = Math.max(t1, b);
    }
    return Number.isFinite(t0) ? [t0, t1] : [nt.T, nt.E];
  });
}

/**
 * Render one sung line (pure, synchronous; used inside workers).
 * @param {{voice:string, text:string, syllables?:string|null, senses?:string|null, notes:Array<{t:number, dur:number, midi:number, downbeat?:boolean}>, seed?:number, vibrato?:{rate:number, depth:number}, mode?:string}} job
 *   notes: one per syllable of syllabify(text, syllables), t in seconds from the first note;
 *   downbeat (optional) accents the note (+1 dB under a stressed syllable, +0.25 dB under
 *   another: text/sungStress.js); senses (optional) picks heteronyms' senses ("wind=noun").
 * @returns {{pcm: Float32Array, sampleRate: number, startOffset: number, syllableTimes: Array<{t0:number, t1:number}>, peak: number}}
 */
export function renderLine(job) {
  return renderLineDetailed(job).line;
}

/**
 * renderLine plus the plan behind it (tests, tools): `plan` is planLine's context with the
 * re-levelled units, `baseCents` (notes + glides, per ms) and `vibEnv` (per ms).
 */
export function renderLineDetailed(job, opts = {}) {
  const ctx = planLine(job, opts);
  if (ctx.empty) return { line: { pcm: new Float32Array(0), sampleRate: FS, startOffset: 0, syllableTimes: [], peak: 0 }, plan: ctx };
  const { out, n } = synthesize(ctx.pl, ctx.v, ctx.tech, ctx.r, {
    pitchTrack: (pl, v, nn, rng) => sungPitchTrack(pl, v, nn, rng, ctx),
  });
  edgeFade(out, LEVEL);
  const pcm = new Float32Array(n);
  let peak = 0.0;
  for (let i = 0; i < n; i++) {
    const x = out[i];
    pcm[i] = x;
    const a = x < 0 ? -x : x;
    if (a > peak) peak = a;
  }
  const off = ctx.tBase - PRE;
  const syllableTimes = noteTimes(ctx).map(([t0, t1]) => ({ t0: t0 + off, t1: t1 + off }));
  return { line: { pcm, sampleRate: FS, startOffset: off, syllableTimes, peak }, plan: ctx };
}
