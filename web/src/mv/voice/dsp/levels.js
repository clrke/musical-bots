// Level calibration and envelopes (port of csharp/Mumble/Dsp/Levels.cs: synth.voiced_rms /
// noise_rms / voiced_level_db / lf_breath_match, ahr_env / burst_env).
// Setup-time code: allocates and caches (per worker); not for the per-sample path.
import { FS, powerSpectrum, pyRound } from './dspMath.js';
import { sosFilterNew, impulseNorm, sosPower, staticSos } from './filters.js';
import {
  glottalSource, glottalSourceDyn, LF_N, lfNorm, lfTables, RD_COUNT, RD_MIN, RD_STEP, rosenbergFlow, sourceNorm,
} from './glottal.js';

/** IRandom that always returns 0 (deterministic calibration sources). */
export const ZeroRandom = Object.freeze({
  nextGaussian: () => 0.0,
  nextDouble: () => 0.0,
});

const calibCache = new Map();
const voicedRmsCache = new Map();
const noiseRmsCache = new Map();
const pulseCache = new Map();
const breathCache = new Map();

const roundAll = (a) => Array.from(a, (v) => pyRound(v, 1));

/**
 * Steady unit-RMS calibration source (0.3 s): LF at rd when rd > 0, else Rosenberg.
 * Cached; do not modify.
 * @returns {Float64Array}
 */
export function calibSource(f0, oq, rd) {
  const key = `${f0}|${oq}|${rd}`;
  let src = calibCache.get(key);
  if (src) return src;
  const n = Math.trunc(0.3 * FS);
  const f = new Float64Array(n).fill(f0);
  src = new Float64Array(n);
  const shape = new Float64Array(n);
  if (rd > 0) glottalSourceDyn(f, n, ZeroRandom, rd, rd, 0.6, 0.0, 0.0, null, 0.5, src, shape);
  else glottalSource(f, n, oq, 0.0, 0.0, ZeroRandom, src, shape);
  calibCache.set(key, src);
  return src;
}

/**
 * Output RMS of a steady unit-RMS glottal source through this formant set (rd > 0: LF pulses,
 * else Rosenberg). Inputs are rounded as in Python (formants / bandwidths to 0.1 Hz).
 * @param {ArrayLike<number>} f formants (Hz)
 * @param {ArrayLike<number>} b bandwidths (Hz)
 */
export function voicedRms(f, b, f0, bright, oq, rd = 0.0) {
  f0 = pyRound(f0, 1);
  bright = pyRound(bright, 3);
  oq = pyRound(oq, 3);
  rd = pyRound(rd, 3);
  const F = roundAll(f);
  const B = roundAll(b);
  const key = `${F.join(',')}/${B.join(',')}/${f0}|${bright}|${oq}|${rd}`;
  const hit = voicedRmsCache.get(key);
  if (hit !== undefined) return hit;
  const src = calibSource(f0, oq, rd);
  const y = sosFilterNew(staticSos(F, B, bright), src);
  const s0 = Math.trunc(0.1 * FS);
  let sum = 0.0;
  for (let i = s0; i < y.length; i++) sum += y[i] * y[i];
  const r = Math.sqrt(sum / (y.length - s0));
  voicedRmsCache.set(key, r);
  return r;
}

/** Output RMS for unit-variance white noise through this formant set. */
export function noiseRms(f, b, bright) {
  bright = pyRound(bright, 3);
  const F = roundAll(f);
  const B = roundAll(b);
  const key = `${F.join(',')}/${B.join(',')}/${bright}`;
  const hit = noiseRmsCache.get(key);
  if (hit !== undefined) return hit;
  const r = impulseNorm(staticSos(F, B, bright));
  noiseRmsCache.set(key, r);
  return r;
}

/**
 * |c_k|^2 of one period of the unit-RMS source pulse (index = harmonic), 1025 bins. Cached;
 * do not modify.
 * @returns {Float64Array}
 */
export function pulsePower(oq, rd) {
  const n = 2048;
  const key = `${oq}|${rd}`;
  let p = pulseCache.get(key);
  if (p) return p;
  const d = new Float64Array(n);
  if (rd > 0) {
    const tables = lfTables();
    const w = LF_N + 1;
    const pos = (rd - RD_MIN) / RD_STEP;
    const fl = Math.floor(pos);
    const r0 = fl < 0 ? 0 : fl > RD_COUNT - 2 ? RD_COUNT - 2 : fl;
    const wt = Math.min(1.0, Math.max(0.0, pos - r0));
    const norm = lfNorm(rd);
    let prev = tables[r0 * w] * (1 - wt) + tables[(r0 + 1) * w] * wt;
    for (let i = 0; i < LF_N; i++) {
      const cur = tables[r0 * w + i + 1] * (1 - wt) + tables[(r0 + 1) * w + i + 1] * wt;
      d[i] = (cur - prev) * LF_N / norm;
      prev = cur;
    }
  } else {
    const norm = sourceNorm(oq);
    let prev = rosenbergFlow(0.0, oq);
    for (let i = 0; i < n; i++) {
      const ph = Math.min((i + 1) / n, 1 - 1e-12);
      const cur = rosenbergFlow(ph, oq);
      d[i] = (cur - prev) * n / norm;
      prev = cur;
    }
  }
  p = powerSpectrum(d);
  for (let k = 0; k < p.length; k++) p[k] /= n * n;
  pulseCache.set(key, p);
  return p;
}

/**
 * Steady-state output level (dB) of the unit-RMS source through this formant set at each
 * pitch in f0s, from the harmonic sum; averaged over +/- smoothSt semitones.
 * @param {ArrayLike<number>} f
 * @param {ArrayLike<number>} b
 * @param {number} bright
 * @param {ArrayLike<number>} f0s
 * @returns {Float64Array}
 */
export function voicedLevelDb(f, b, bright, f0s, oq, rd = 0.0, smoothSt = 0.5) {
  const pw = pulsePower(pyRound(oq, 3), pyRound(rd, 3));
  const sos = staticSos(f, b, bright);
  const offs = new Float64Array(5);
  for (let j = 0; j < 5; j++) offs[j] = Math.pow(2.0, (-1.0 + 0.5 * j) * smoothSt / 12.0);
  let fmin = Number.MAX_VALUE;
  for (let i = 0; i < f0s.length; i++) for (let j = 0; j < 5; j++) fmin = Math.min(fmin, f0s[i] * offs[j]);
  const kmax = Math.min(pw.length - 1, Math.trunc(0.5 * FS / fmin));
  const out = new Float64Array(f0s.length);
  for (let i = 0; i < f0s.length; i++) {
    let acc = 0.0;
    for (let j = 0; j < 5; j++) {
      const fj = f0s[i] * offs[j];
      let p = 0.0;
      for (let k = 1; k <= kmax; k++) {
        const fr = fj * k;
        if (fr < 0.5 * FS) p += sosPower(sos, fr) * pw[k];
      }
      acc += 2.0 * p;
    }
    out[i] = 10.0 * Math.log10(acc / 5.0 + 1e-30);
  }
  return out;
}

function band(x, lo, hi) {
  const m = (x.length >> 1) * 2;
  const xw = new Float64Array(m);
  for (let i = 0; i < m; i++) xw[i] = x[i] * (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / (m - 1)));
  const p = powerSpectrum(xw);
  const val = 1.0 / (m * (1.0 / FS));
  let inBand = 0.0;
  let total = 0.0;
  for (let k = 0; k < p.length; k++) {
    const fr = k * val;
    total += p[k];
    if (fr >= lo && fr < hi) inBand += p[k];
  }
  return inBand / total;
}

/**
 * Amplitude ratio of the LF (rd) to the Rosenberg (oq) source in lo..hi Hz, used to scale the
 * flat breath noise in human mode (cached).
 */
export function lfBreathMatch(f0, oq, rd, lo = 1500.0, hi = 4500.0) {
  const key = `${f0}|${oq}|${rd}|${lo}|${hi}`;
  const hit = breathCache.get(key);
  if (hit !== undefined) return hit;
  const a = calibSource(pyRound(f0, 1), pyRound(oq, 3), 0.0);
  const n = FS;
  const f = new Float64Array(n).fill(f0);
  const b = new Float64Array(n);
  const shape = new Float64Array(n);
  glottalSourceDyn(f, n, ZeroRandom, rd, rd, 0.6, 0.0, 0.0, null, 0.5, b, shape);
  const r = Math.sqrt(band(b, lo, hi) / band(a, lo, hi));
  breathCache.set(key, r);
  return r;
}

/** The C# static class Levels as one namespace object. */
export const Levels = Object.freeze({
  calibSource, voicedRms, noiseRms, pulsePower, voicedLevelDb, lfBreathMatch,
});

// ------------------------------------------------------------------ envelopes
const clip01 = (x) => (x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x);

/** Swell-hold-release envelope (raised-cosine edges) at time t. */
export function ahr(t, on, off, attack, release) {
  const a = clip01((t - on) / Math.max(attack, 1e-4));
  const r = clip01((off - t) / Math.max(release, 1e-4));
  return (0.5 - 0.5 * Math.cos(Math.PI * a)) * (0.5 - 0.5 * Math.cos(Math.PI * r));
}

/** Soft burst: 0.7 ms rise, exponential decay, faded to zero at off. */
export function burst(t, on, off) {
  const rise = 0.0007;
  const x = t - on;
  if (!(x >= 0)) return 0.0;
  const up = 0.5 - 0.5 * Math.cos(Math.PI * clip01(x / rise));
  const tau = Math.max((off - on) / 3.0, 1e-4);
  const decay = Math.exp(-Math.max(x - rise, 0.0) / tau);
  const tail = 0.5 - 0.5 * Math.cos(Math.PI * clip01((off - t) / (0.4 * (off - on) + 1e-5)));
  return up * decay * tail;
}

/** Amplitude envelopes (C# Envelopes: synth.ahr_env / burst_env, one time at a time). */
export const Envelopes = Object.freeze({ ahr, burst });
