// Human-mode rhythm (port of csharp/Mumble/Text/Rhythm.cs, mumble/human.py apply_rhythm).
// Syllable duration weights (Klatt-style rules): stress, function words, the vowel's inherent
// length, voicing of the coda, phrase-final lengthening.

export const RHYTHM_W_STRESSED = 1.3;
export const RHYTHM_W_UNSTRESSED = 0.8;
export const RHYTHM_W_FUNCTION = 0.6;
export const RHYTHM_W_BARE = 1.0;
/** Vowels with long inherent duration. */
export const LONG_VOWELS = new Set(['ee', 'oo', 'ah', 'aw', 'oh', 'ae', 'er', 'eh-ee', 'ah-ee', 'ah-oo', 'oh-ee']);
/** Vowels with short inherent duration. */
export const SHORT_VOWELS = new Set(['ih', 'eh', 'uu', 'uh', 'schwa']);
export const VOWEL_W_LONG = 1.2;
export const VOWEL_W_SHORT = 0.85;
export const CODA_W_VOICED = 1.15;
export const CODA_W_VOICELESS = 0.88;
export const FINAL_LENGTHEN = 1.4;
/** No sound moves more than this from its letter time (s). */
export const MAX_SHIFT = 0.09;
/** Deviation that is smooth over this scale (s) is drift and is removed. */
export const DRIFT_SMOOTH = 0.3;
/** A syllable never gets less than this share of its letter time. */
export const MIN_SPAN = 0.4;

/** @param {import('./textData.js').LineAnalysis} an */
function sylWeight(an, si) {
  const s = an.syllables[si];
  if (s.nucleus < 0) return RHYTHM_W_BARE;
  let w = an.words[s.word].functionWord ? RHYTHM_W_FUNCTION
    : (s.stress !== 0 ? RHYTHM_W_STRESSED : RHYTHM_W_UNSTRESSED);
  const sym = an.phones[s.nucleus].sym;
  if (LONG_VOWELS.has(sym)) w *= VOWEL_W_LONG;
  else if (SHORT_VOWELS.has(sym)) w *= VOWEL_W_SHORT;
  for (const k of s.coda) {
    const kind = an.phones[k].kind;
    if (kind === 'plosive' || kind === 'fricative' || kind === 'affricate') {
      w *= an.phones[k].voiced ? CODA_W_VOICED : CODA_W_VOICELESS;
      break;
    }
  }
  return w;
}

/** Phones of syllable si: onset, nucleus, coda. */
export function sylPhones(an, si) {
  const s = an.syllables[si];
  const r = s.onset.slice();
  if (s.nucleus >= 0) r.push(s.nucleus);
  for (const k of s.coda) r.push(k);
  return r;
}

/**
 * Re-time the phones of every phrase (in place) by syllable weight. Inside a phrase the
 * syllables share the time in proportion to (letter span x weight); the slow drift the
 * weights build up is removed, each phrase keeps its start and end, and no sound moves
 * more than MAX_SHIFT from the time its letter appears.
 * @param {import('./textData.js').LineAnalysis} an
 */
export function applyRhythm(an) {
  const P = an.phones;
  for (const p of an.phrases) {
    const sylls = [];
    for (const wi of p.words) {
      for (const si of an.words[wi].syllables) if (sylPhones(an, si).length > 0) sylls.push(si);
    }
    if (sylls.length < 2) continue;
    const ns = sylls.length;
    const nb = ns + 1;
    const bounds = new Float64Array(nb);
    let lastT = -Infinity;
    for (let q = 0; q < ns; q++) {
      const sp = sylPhones(an, sylls[q]);
      bounds[q] = P[sp[0]].t;
      for (const k of sp) lastT = Math.max(lastT, P[k].t);
    }
    const end = Math.max(p.tEnd, lastT + 1e-3);
    bounds[ns] = end;
    const w = new Float64Array(ns);
    for (let q = 0; q < ns; q++) w[q] = Math.max(bounds[q + 1] - bounds[q], 1e-4) * sylWeight(an, sylls[q]);
    w[ns - 1] *= FINAL_LENGTHEN;
    const wSum = npSum(w, 0, ns);
    const dev = new Float64Array(nb);
    let cum = 0.0;
    for (let q = 0; q < nb; q++) {
      if (q > 0) cum += w[q - 1];
      const nw = bounds[0] + cum * (end - bounds[0]) / wSum;
      dev[q] = nw - bounds[q];
    }
    // keep the syllable-to-syllable contrast but not the slow drift it builds up
    const g = new Float64Array(nb);
    const smoothed = new Float64Array(nb);
    for (let a = 0; a < nb; a++) {
      let dot = 0.0;
      for (let b = 0; b < nb; b++) {
        const d = (bounds[a] - bounds[b]) / DRIFT_SMOOTH;
        g[b] = Math.exp(-0.5 * (d * d));
        dot += g[b] * dev[b];
      }
      smoothed[a] = dot / npSum(g, 0, nb);
    }
    for (let a = 0; a < nb; a++) dev[a] = dev[a] - smoothed[a];
    dev[0] = 0.0;
    dev[nb - 1] = 0.0;
    for (let a = 0; a < nb; a++) dev[a] = Math.min(Math.max(dev[a], -MAX_SHIFT), MAX_SHIFT);
    // every syllable keeps at least MIN_SPAN of its letter span (so times stay in order)
    let scale = Infinity;
    let any = false;
    for (let q = 0; q < ns; q++) {
      const shrink = dev[q] - dev[q + 1];
      const room = (1.0 - MIN_SPAN) * (bounds[q + 1] - bounds[q]);
      if (shrink > room) {
        any = true;
        scale = Math.min(scale, room / shrink);
      }
    }
    if (any) for (let a = 0; a < nb; a++) dev[a] *= scale;
    const orig = new Float64Array(nb + 2);
    const nu = new Float64Array(nb + 2);
    orig[0] = nu[0] = bounds[0] - 10.0;
    orig[nb + 1] = nu[nb + 1] = bounds[nb - 1] + 10.0;
    for (let a = 0; a < nb; a++) {
      orig[a + 1] = bounds[a];
      nu[a + 1] = bounds[a] + dev[a];
    }
    for (const wi of p.words) {
      for (const k of an.words[wi].phones) {
        P[k].t = interp(P[k].t, orig, nu);
        P[k].tNext = interp(P[k].tNext, orig, nu);
      }
    }
    for (const wi of p.words) {
      for (const k of an.words[wi].phones) if (P[k].tNext <= P[k].t) P[k].tNext = P[k].t + 0.5 * an.dt;
    }
  }
}

/**
 * numpy.interp for increasing xp (clamps to fp[0] / fp[last] outside).
 * @param {number} x
 * @param {ArrayLike<number>} xp
 * @param {ArrayLike<number>} fp
 */
export function interp(x, xp, fp) {
  const n = xp.length;
  if (x < xp[0]) return fp[0];
  if (x > xp[n - 1]) return fp[n - 1];
  // largest j with xp[j] <= x
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (x >= xp[mid]) lo = mid + 1;
    else hi = mid;
  }
  const j = lo - 1;
  if (j === n - 1) return fp[j];
  if (xp[j] === x) return fp[j];
  const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
  return slope * (x - xp[j]) + fp[j];
}

/**
 * numpy's pairwise float64 sum (same rounding as np.sum for contiguous data).
 * @param {ArrayLike<number>} a
 * @param {number} start
 * @param {number} n
 */
export function npSum(a, start, n) {
  if (n < 8) {
    let res = 0.0;
    for (let i = 0; i < n; i++) res += a[start + i];
    return res;
  }
  if (n <= 128) {
    let r0 = a[start];
    let r1 = a[start + 1];
    let r2 = a[start + 2];
    let r3 = a[start + 3];
    let r4 = a[start + 4];
    let r5 = a[start + 5];
    let r6 = a[start + 6];
    let r7 = a[start + 7];
    let i;
    for (i = 8; i < n - (n % 8); i += 8) {
      r0 += a[start + i];
      r1 += a[start + i + 1];
      r2 += a[start + i + 2];
      r3 += a[start + i + 3];
      r4 += a[start + i + 4];
      r5 += a[start + i + 5];
      r6 += a[start + i + 6];
      r7 += a[start + i + 7];
    }
    let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return npSum(a, start, n2) + npSum(a, start + n2, n - n2);
}
