// Filters (port of csharp/Mumble/Dsp/Filters.cs, mumble/synth.py).
//
// Second-order sections in scipy layout: flat arrays, 6 per section (b0, b1, b2, a0 = 1, a1,
// a2). State: 2 values per section (direct form II transposed). Per-sample paths are
// allocation-free and work on Float64Array (or plain arrays).
import { BLOCK, FS, interpAt, interpIndex } from './dspMath.js';

// ------------------------------------------------------------------ Sos
/**
 * scipy.signal.sosfilt with state: filters x[start .. start+count) into y (may alias x).
 * zi holds 2 values per section and is updated. Allocation-free.
 * @param {ArrayLike<number>} sos
 * @param {number} nSec
 * @param {Float64Array|number[]} zi
 * @param {ArrayLike<number>} x
 * @param {Float64Array|number[]} y
 * @param {number} start
 * @param {number} count
 */
export function sosFilter(sos, nSec, zi, x, y, start, count) {
  const end = start + count;
  for (let n = start; n < end; n++) {
    let xc = x[n];
    for (let s = 0, o = 0, z = 0; s < nSec; s++, o += 6, z += 2) {
      const xn = sos[o] * xc + zi[z];
      zi[z] = sos[o + 1] * xc - sos[o + 4] * xn + zi[z + 1];
      zi[z + 1] = sos[o + 2] * xc - sos[o + 5] * xn;
      xc = xn;
    }
    y[n] = xc;
  }
}

/**
 * sosfilt from zero state over a whole array (allocates the output).
 * @param {ArrayLike<number>} sos
 * @param {ArrayLike<number>} x
 * @returns {Float64Array}
 */
export function sosFilterNew(sos, x) {
  const nSec = (sos.length / 6) | 0;
  const y = new Float64Array(x.length);
  sosFilter(sos, nSec, new Float64Array(2 * nSec), x, y, 0, x.length);
  return y;
}

/** |H(e^jw)|^2 of the cascade at frequency f (Hz) - sosfreqz magnitude. */
export function sosPower(sos, f, fs = FS) {
  const w = 2.0 * Math.PI * f / fs;
  const c1 = Math.cos(w);
  const s1 = -Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = -Math.sin(2 * w);
  let p = 1.0;
  const nSec = (sos.length / 6) | 0;
  for (let s = 0; s < nSec; s++) {
    const o = 6 * s;
    const br = sos[o] + sos[o + 1] * c1 + sos[o + 2] * c2;
    const bi = sos[o + 1] * s1 + sos[o + 2] * s2;
    const ar = sos[o + 3] + sos[o + 4] * c1 + sos[o + 5] * c2;
    const ai = sos[o + 4] * s1 + sos[o + 5] * s2;
    p *= (br * br + bi * bi) / (ar * ar + ai * ai);
  }
  return p;
}

/** sqrt(sum h^2) of the first len impulse-response samples. */
export function impulseNorm(sos, len = 8192) {
  const imp = new Float64Array(len);
  imp[0] = 1.0;
  const h = sosFilterNew(sos, imp);
  let s = 0.0;
  for (let i = 0; i < len; i++) s += h[i] * h[i];
  return Math.sqrt(s);
}

/**
 * The C# static class Sos. filter(sos, nSec, zi, x, y, start, count) filters in place with
 * state; filter(sos, x) filters a whole array from zero state into a new Float64Array.
 */
export const Sos = Object.freeze({
  filter(sos, nSec, zi, x, y, start, count) {
    if (arguments.length === 2) return sosFilterNew(sos, nSec);
    return sosFilter(sos, nSec, zi, x, y, start, count);
  },
  power: sosPower,
  impulseNorm,
});

// ------------------------------------------------------------------ Butterworth
// complex helpers ([re, im]; setup-time only), matching System.Numerics.Complex
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cscale = (a, k) => [a[0] * k, a[1] * k];
const cneg = (a) => [-a[0], -a[1]];
const creal = (x) => [x, 0.0];
const cabs = (a) => Math.hypot(a[0], a[1]);

/** Smith's division, as .NET. */
function cdiv(a, b) {
  const [x, y] = a;
  const [c, d] = b;
  if (Math.abs(d) < Math.abs(c)) {
    const doc = d / c;
    return [(x + y * doc) / (c + d * doc), (y - x * doc) / (c + d * doc)];
  }
  const cod = c / d;
  return [(y + x * cod) / (d + c * cod), (-x + y * cod) / (d + c * cod)];
}

/** Principal square root, as .NET Complex.Sqrt (no rescaling needed here). */
function csqrt(a) {
  const [re, im] = a;
  if (im === 0.0) return re < 0.0 ? [0.0, Math.sqrt(-re)] : [Math.sqrt(re), 0.0];
  if (re >= 0.0) {
    const x = Math.sqrt((Math.hypot(re, im) + re) * 0.5);
    return [x, im / (2.0 * x)];
  }
  let y = Math.sqrt((Math.hypot(re, im) - re) * 0.5);
  if (im < 0.0) y = -y;
  return [im / (2.0 * y), y];
}

const cexpi = (theta) => [Math.cos(theta), Math.sin(theta)];

function warp(f, fs) {
  const wn = 2.0 * f / fs;
  return 2.0 * 2.0 * Math.tan(Math.PI * wn / 2.0);
}

function setSection(sos, o, z, p, k) {
  sos[o] = k;
  sos[o + 1] = -2.0 * z * k;
  sos[o + 2] = z * z * k;
  sos[o + 3] = 1.0;
  sos[o + 4] = -2.0 * p[0];
  sos[o + 5] = p[0] * p[0] + p[1] * p[1];
}

/** 2nd-order Butterworth designs matching scipy.signal.butter(2, ..., output='sos'). */
function design(f1, f2, kind, fs) {
  // buttap(2)
  const pa = [cneg(cexpi(Math.PI * -1 / 4.0)), cneg(cexpi(Math.PI * 1 / 4.0))];
  const fs2 = 4.0; // bilinear at fs = 2 -> 2 * fs
  if (kind === 2) {
    const w1 = warp(f1, fs);
    const w2 = warp(f2, fs);
    const wo = Math.sqrt(w1 * w2);
    const bw = w2 - w1;
    // lp2bp_zpk: no zeros, 2 poles -> 4 poles, 2 zeros at 0, k = bw^2
    const p = new Array(4);
    for (let i = 0; i < 2; i++) {
      const pl = cscale(cscale(pa[i], bw), 0.5);
      const r = csqrt(csub(cmul(pl, pl), creal(wo * wo)));
      p[i] = cadd(pl, r);
      p[i + 2] = csub(pl, r);
    }
    let k = bw * bw;
    // bilinear_zpk: zeros 0,0 -> 1,1 ; plus two at -1
    let den = creal(1.0);
    for (let i = 0; i < 4; i++) {
      den = cmul(den, csub(creal(fs2), p[i]));
      p[i] = cdiv(cadd(creal(fs2), p[i]), csub(creal(fs2), p[i]));
    }
    k *= cdiv(creal(fs2 * fs2), den)[0];
    // zpk2sos 'nearest': keep one pole of each conjugate pair (positive imaginary)
    let pA = [0, 0];
    let pB = [0, 0];
    let found = 0;
    for (let i = 0; i < 4; i++) {
      if (p[i][1] > 0) {
        if (found === 0) pA = p[i];
        else pB = p[i];
        found++;
      }
    }
    // "worst" (closest to the unit circle) goes last
    let last = pA;
    let first = pB;
    if (Math.abs(1 - cabs(pB)) < Math.abs(1 - cabs(pA))) {
      last = pB;
      first = pA;
    }
    // last section takes the zero pair nearest its pole; first gets the rest
    const zl = cabs(csub(last, creal(1.0))) <= cabs(cadd(last, creal(1.0))) ? 1.0 : -1.0;
    const zf = -zl;
    const sos = new Float64Array(12);
    setSection(sos, 0, zf, first, k);
    setSection(sos, 6, zl, last, 1.0);
    return sos;
  }
  const wo = warp(f1, fs);
  let p;
  let k;
  if (kind === 0) {
    p = [cscale(pa[0], wo), cscale(pa[1], wo)];
    k = wo * wo;
  } else {
    p = [cdiv(creal(wo), pa[0]), cdiv(creal(wo), pa[1])];
    k = cdiv(creal(1.0), cmul(cneg(pa[0]), cneg(pa[1])))[0];
  }
  const num = kind === 0 ? creal(1.0) : creal(fs2 * fs2);
  const den = cmul(csub(creal(fs2), p[0]), csub(creal(fs2), p[1]));
  k *= cdiv(num, den)[0];
  let pz = cdiv(cadd(creal(fs2), p[0]), csub(creal(fs2), p[0]));
  if (pz[1] < 0) pz = [pz[0], -pz[1]];
  const sos = new Float64Array(6);
  setSection(sos, 0, kind === 0 ? -1.0 : 1.0, pz, k);
  return sos;
}

/** 2nd-order Butterworth designs matching scipy.signal.butter(2, ..., output='sos'). */
export const Butter = Object.freeze({
  /** Low-pass, cutoff fc (Hz). One section. */
  lowpass: (fc, fs = FS) => design(fc, 0.0, 0, fs),
  /** High-pass, cutoff fc (Hz). One section. */
  highpass: (fc, fs = FS) => design(fc, 0.0, 1, fs),
  /** Band-pass lo..hi (Hz): 4 poles, two sections, as scipy's zpk2sos orders them. */
  bandpass: (lo, hi, fs = FS) => design(lo, hi, 2, fs),
});

// ------------------------------------------------------------------ synth filters
/**
 * Unity-DC-gain two-pole resonator as an SOS row written at sos[o..o+6):
 * [1 - b - c, 0, 0, 1, -b, -c].
 */
export function resonatorRow(f, bw, sos, o) {
  const r = Math.exp(-Math.PI * bw / FS);
  const c = -(r * r);
  const b = 2.0 * r * Math.cos(2.0 * Math.PI * f / FS);
  sos[o] = 1.0 - b - c;
  sos[o + 1] = 0.0;
  sos[o + 2] = 0.0;
  sos[o + 3] = 1.0;
  sos[o + 4] = -b;
  sos[o + 5] = -c;
}

/** First-order spectral tilt row (unity DC gain). bright < 0: low-pass, > 0: pre-emphasis. */
export function tiltRow(bright, sos, o) {
  sos[o + 2] = 0.0;
  sos[o + 3] = 1.0;
  sos[o + 5] = 0.0;
  if (bright < 0) {
    const p = Math.min(0.85, 0.6 * -bright);
    sos[o] = 1.0 - p;
    sos[o + 1] = 0.0;
    sos[o + 4] = -p;
  } else if (bright > 0) {
    const q = Math.min(0.6, 0.5 * bright);
    sos[o] = 1.0 / (1.0 - q);
    sos[o + 1] = -q / (1.0 - q);
    sos[o + 4] = 0.0;
  } else {
    sos[o] = 1.0;
    sos[o + 1] = 0.0;
    sos[o + 4] = 0.0;
  }
}

/**
 * Static cascade: tilt row followed by the resonators in the given order.
 * @param {ArrayLike<number>} f
 * @param {ArrayLike<number>} bw
 * @param {number} bright
 * @returns {Float64Array}
 */
export function staticSos(f, bw, bright) {
  const sos = new Float64Array(6 * (f.length + 1));
  tiltRow(bright, sos, 0);
  for (let i = 0; i < f.length; i++) resonatorRow(f[i], bw[i], sos, 6 * (i + 1));
  return sos;
}

const MAX_RES = 16;
const FF_ZI = new Float64Array(2 * (MAX_RES + 1));
const FF_SOS = [new Float64Array(6 * (MAX_RES + 1)), new Float64Array(6 * (MAX_RES + 1))];

function blockTime(k, t0) {
  return t0 + (k * BLOCK + 0.5 * BLOCK) / FS;
}

/**
 * Interpolates F / B at block k; writes the b0 = 1 resonator rows (highest resonator first)
 * from sos[6] and returns the summed log DC gain.
 */
function blockRows(k, t0, kt, kF, kB, nRes, nk, sos) {
  const tb = blockTime(k, t0);
  const j = interpIndex(tb, kt, nk);
  let lg = 0.0;
  for (let q = nRes - 1; q >= 0; q--) {
    const f = interpAt(tb, kt, kF, q, nRes, nk, j);
    const bw = interpAt(tb, kt, kB, q, nRes, nk, j);
    const r = Math.exp(-Math.PI * bw / FS);
    const c = -(r * r);
    const b = 2.0 * r * Math.cos(2.0 * Math.PI * f / FS);
    lg += Math.log(1.0 - b - c);
    const p = 6 + 6 * (nRes - 1 - q);
    sos[p] = 1.0;
    sos[p + 1] = 0.0;
    sos[p + 2] = 0.0;
    sos[p + 3] = 1.0;
    sos[p + 4] = -b;
    sos[p + 5] = -c;
  }
  return lg;
}

function interpSeg(x, x0, x1, y0, y1) {
  if (x === x0) return y0;
  const slope = (y1 - y0) / (x1 - x0);
  return slope * (x - x0) + y0;
}

/**
 * Time-varying formant cascade (synth.formant_filter). Formants F / B are interpolated from
 * keyframes (kt [nk], kF / kB row-major [nk, nRes]) at block centres; resonators run highest
 * first with b0 = 1 and the cascade DC gain is applied to the input as a per-sample
 * interpolated log gain. x and y may alias. Allocation-free (nRes <= 16).
 * @param {ArrayLike<number>} x input (n samples, starting at time t0)
 * @param {Float64Array|number[]} y output
 * @param {number} n
 * @param {number} t0 time of x[0] (s)
 * @param {ArrayLike<number>} kt keyframe times
 * @param {ArrayLike<number>} kF formants, row-major [nk, nRes]
 * @param {ArrayLike<number>} kB bandwidths, row-major [nk, nRes]
 * @param {number} nRes
 * @param {number} bright
 */
export function formantFilter(x, y, n, t0, kt, kF, kB, nRes, bright) {
  if (n <= 0) return;
  if (nRes > MAX_RES) throw new RangeError(`formantFilter: at most ${MAX_RES} resonators`);
  const nb = ((n + BLOCK - 1) / BLOCK) | 0;
  const nSec = nRes + 1;
  const zi = FF_ZI;
  zi.fill(0, 0, 2 * nSec);
  tiltRow(bright, FF_SOS[0], 0);
  tiltRow(bright, FF_SOS[1], 0);
  const nk = kt.length;
  // block k's rows live in FF_SOS[k & 1]; log gains at block centres k-1, k, k+1 (rolling)
  let lgPrev = 0.0;
  let lgCur = blockRows(0, t0, kt, kF, kB, nRes, nk, FF_SOS[0]);
  let lgNext = nb > 1 ? blockRows(1, t0, kt, kF, kB, nRes, nk, FF_SOS[1]) : 0.0;
  const tbLast = blockTime(nb - 1, t0);
  for (let k = 0; k < nb; k++) {
    const sos = FF_SOS[k & 1];
    const a = k * BLOCK;
    const b = Math.min(n, a + BLOCK);
    const tbPrev = blockTime(k - 1, t0);
    const tbCur = blockTime(k, t0);
    const tbNext = blockTime(k + 1, t0);
    for (let i = a; i < b; i++) {
      // numpy.interp(ts, tb, log_gain): ts lies in segment k-1 or k
      const ts = t0 + i / FS;
      let g;
      if (ts >= tbLast) g = lgCur; // only reachable in the last block
      else if (ts < tbCur) g = k === 0 ? lgCur : interpSeg(ts, tbPrev, tbCur, lgPrev, lgCur);
      else g = interpSeg(ts, tbCur, tbNext, lgCur, lgNext);
      y[i] = x[i] * Math.exp(g);
    }
    sosFilter(sos, nSec, zi, y, y, a, b - a);
    lgPrev = lgCur;
    lgCur = lgNext;
    lgNext = k + 2 < nb ? blockRows(k + 2, t0, kt, kF, kB, nRes, nk, sos) : 0.0;
  }
}

const bandpassCache = new Map();
const lowpassCache = new Map();
const highpassCache = new Map();

/**
 * 4-pole band-pass (cached) plus the gain giving unit-RMS output for unit white noise.
 * hi is limited to 0.45 fs and lo to 0.8 hi. Returns [sos, gain], also readable as
 * .sos / .gain (C# returns the sos with `out gain`). Do not modify the sos.
 * @returns {[Float64Array, number] & {sos:Float64Array, gain:number}}
 */
export function bandpass(lo, hi) {
  const key = `${lo}|${hi}`;
  let hit = bandpassCache.get(key);
  if (hit) return hit;
  const h = Math.min(hi, 0.45 * FS);
  const l = Math.min(lo, h * 0.8);
  const sos = Butter.bandpass(l, h);
  const gain = 1.0 / impulseNorm(sos);
  hit = [sos, gain];
  Object.defineProperty(hit, 'sos', { value: sos, enumerable: false });
  Object.defineProperty(hit, 'gain', { value: gain, enumerable: false });
  Object.freeze(hit);
  bandpassCache.set(key, hit);
  return /** @type {any} */ (hit);
}

/** 2nd-order Butterworth low-pass (cached; do not modify). */
export function lowpass(fc) {
  let hit = lowpassCache.get(fc);
  if (!hit) {
    hit = Butter.lowpass(fc);
    lowpassCache.set(fc, hit);
  }
  return hit;
}

/**
 * Unit-RMS white noise high-passed at fc (2nd-order Butterworth), n samples into output.
 * @param {number} n
 * @param {number} fc
 * @param {{nextGaussian():number}} rng
 * @param {Float64Array|number[]} output
 */
export function highpassNoise(n, fc, rng, output) {
  const f = Math.min(fc, 0.45 * FS);
  let sos = highpassCache.get(f);
  if (!sos) {
    sos = Butter.highpass(f);
    highpassCache.set(f, sos);
  }
  for (let i = 0; i < n; i++) output[i] = rng.nextGaussian();
  sosFilter(sos, 1, new Float64Array(2), output, output, 0, n);
  let s = 0.0;
  for (let i = 0; i < n; i++) s += output[i] * output[i];
  const inv = 1.0 / (Math.sqrt(s / Math.max(n, 1)) + 1e-12);
  for (let i = 0; i < n; i++) output[i] *= inv;
}

/** The C# static class Filters as one namespace object. */
export const Filters = Object.freeze({
  resonatorRow, tiltRow, staticSos, formantFilter, bandpass, lowpass, highpassNoise,
});
