// Shared DSP constants and small numeric helpers ported from numpy / scipy
// (port of csharp/Mumble/Dsp/DspMath.cs).

/** Sample rate (Hz). */
export const FS = 24000;
/** Control-rate block for time-varying filters (samples). */
export const BLOCK = 16;
/** Rosenberg speed quotient (opening / closing time). */
export const SQ = 2.5;

/** Shared DSP constants (C# DspConst). */
export const DspConst = Object.freeze({ k_Fs: FS, k_Block: BLOCK, k_Sq: SQ });

/**
 * scipy.optimize.brentq (same algorithm and default tolerances: xtol 2e-12, rtol 4 eps,
 * 100 iterations). f(a) and f(b) must bracket a root.
 * @param {(x:number) => number} f
 */
export function brentq(f, xa, xb, xtol = 2e-12, rtol = 8.881784197001252e-16, maxIter = 100) {
  let xpre = xa;
  let xcur = xb;
  let xblk = 0.0;
  let fblk = 0.0;
  let spre = 0.0;
  let scur = 0.0;
  let fpre = f(xpre);
  let fcur = f(xcur);
  if (fpre * fcur > 0) throw new Error('brentq: f(a) and f(b) must have different signs');
  if (fpre === 0) return xpre;
  if (fcur === 0) return xcur;
  for (let i = 0; i < maxIter; i++) {
    if (fpre !== 0 && fcur !== 0 && (fpre < 0) !== (fcur < 0)) {
      xblk = xpre;
      fblk = fpre;
      spre = scur = xcur - xpre;
    }
    if (Math.abs(fblk) < Math.abs(fcur)) {
      xpre = xcur;
      xcur = xblk;
      xblk = xpre;
      fpre = fcur;
      fcur = fblk;
      fblk = fpre;
    }
    const delta = (xtol + rtol * Math.abs(xcur)) / 2;
    const sbis = (xblk - xcur) / 2;
    if (fcur === 0 || Math.abs(sbis) < delta) return xcur;
    if (Math.abs(spre) > delta && Math.abs(fcur) < Math.abs(fpre)) {
      let stry;
      if (xpre === xblk) {
        stry = -fcur * (xcur - xpre) / (fcur - fpre);
      } else {
        const dpre = (fpre - fcur) / (xpre - xcur);
        const dblk = (fblk - fcur) / (xblk - xcur);
        stry = -fcur * (fblk * dblk - fpre * dpre) / (dblk * dpre * (fblk - fpre));
      }
      if (2 * Math.abs(stry) < Math.min(Math.abs(spre), 3 * Math.abs(sbis) - delta)) {
        spre = scur;
        scur = stry;
      } else {
        spre = sbis;
        scur = sbis;
      }
    } else {
      spre = sbis;
      scur = sbis;
    }
    xpre = xcur;
    fpre = fcur;
    if (Math.abs(scur) > delta) xcur += scur;
    else xcur += sbis > 0 ? delta : -delta;
    fcur = f(xcur);
  }
  return xcur;
}

/**
 * Segment index for numpy.interp: -1 if x < xp[0], len if x > xp[last], else the j with
 * xp[j] <= x < xp[j+1] (len-1 when x == xp[last]).
 * @param {number} x
 * @param {ArrayLike<number>} xp
 * @param {number} len
 */
export function interpIndex(x, xp, len) {
  if (x < xp[0]) return -1;
  if (x > xp[len - 1]) return len;
  if (x === xp[len - 1]) return len - 1;
  let lo = 0;
  let hi = len - 1; // xp[lo] <= x < xp[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * numpy.interp for one point, given the segment index from interpIndex; fp is read at
 * fpOffset + k * fpStride (a column of a row-major table).
 */
export function interpAt(x, xp, fp, fpOffset, fpStride, len, j) {
  if (j < 0) return fp[fpOffset];
  if (j >= len - 1) return fp[fpOffset + (len - 1) * fpStride];
  const y0 = fp[fpOffset + j * fpStride];
  if (xp[j] === x) return y0;
  const y1 = fp[fpOffset + (j + 1) * fpStride];
  const slope = (y1 - y0) / (xp[j + 1] - xp[j]);
  let r = slope * (x - xp[j]) + y0;
  if (Number.isNaN(r)) {
    r = slope * (x - xp[j + 1]) + y1;
    if (Number.isNaN(r) && y0 === y1) r = y0;
  }
  return r;
}

/**
 * numpy.interp(x, xp, fp) for one point.
 * @param {number} x
 * @param {ArrayLike<number>} xp
 * @param {ArrayLike<number>} fp
 */
export function interp(x, xp, fp) {
  const len = xp.length;
  return interpAt(x, xp, fp, 0, 1, len, interpIndex(x, xp, len));
}

// ------------------------------------------------------------------ FFT
// JS deviation from the C# radix-2 + Bluestein code (same results to ~1e-15, several times
// faster): mixed-radix Stockham FFT for lengths 2^a 3^b 5^c (24000, 7200, 2048, ...),
// Bluestein over a power of two otherwise. Plans are cached per length; setup-time use.
const SQRT3_2 = Math.sqrt(3) / 2;
const C5_1 = Math.cos(2 * Math.PI / 5);
const C5_2 = Math.cos(4 * Math.PI / 5);
const S5_1 = Math.sin(2 * Math.PI / 5);
const S5_2 = Math.sin(4 * Math.PI / 5);

const fftPlans = new Map();

function smoothFactors(n) {
  const f = [];
  let m = n;
  while (m % 4 === 0) {
    f.push(4);
    m /= 4;
  }
  for (const r of [2, 3, 5]) {
    while (m % r === 0) {
      f.push(r);
      m /= r;
    }
  }
  return m === 1 ? f : null;
}

/** Stockham plan for a smooth length (twiddles w^t = exp(-2 pi i t / n)), or null. */
function stockhamPlan(n) {
  let p = fftPlans.get(n);
  if (p !== undefined) return p;
  const factors = smoothFactors(n);
  p = null;
  if (factors) {
    const wr = new Float64Array(n);
    const wi = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const a = 2 * Math.PI * t / n;
      wr[t] = Math.cos(a);
      wi[t] = -Math.sin(a);
    }
    p = { n, factors, wr, wi, tr: new Float64Array(n), ti: new Float64Array(n) };
  }
  fftPlans.set(n, p);
  return p;
}

/** Mixed-radix Stockham autosort FFT (decimation in frequency), natural-order output. */
function stockham(re, im, plan) {
  const { n, factors, wr, wi } = plan;
  let xr = re;
  let xi = im;
  let yr = plan.tr;
  let yi = plan.ti;
  let s = 1;
  let nc = n;
  for (const r of factors) {
    const m = nc / r;
    const sm = s * m;
    const ts = n / nc; // w_nc^e = w_n^(e * ts)
    for (let p = 0; p < m; p++) {
      const e = p * ts;
      const o0 = s * r * p;
      if (r === 4) {
        const w1r = wr[e]; const w1i = wi[e];
        const w2r = wr[2 * e]; const w2i = wi[2 * e];
        const w3r = wr[3 * e]; const w3i = wi[3 * e];
        for (let q = 0; q < s; q++) {
          const i0 = q + s * p; const i1 = i0 + sm; const i2 = i1 + sm; const i3 = i2 + sm;
          const t0r = xr[i0] + xr[i2]; const t0i = xi[i0] + xi[i2];
          const t1r = xr[i0] - xr[i2]; const t1i = xi[i0] - xi[i2];
          const t2r = xr[i1] + xr[i3]; const t2i = xi[i1] + xi[i3];
          const t3r = xr[i1] - xr[i3]; const t3i = xi[i1] - xi[i3];
          const b1r = t1r + t3i; const b1i = t1i - t3r;
          const b2r = t0r - t2r; const b2i = t0i - t2i;
          const b3r = t1r - t3i; const b3i = t1i + t3r;
          const o = o0 + q;
          yr[o] = t0r + t2r; yi[o] = t0i + t2i;
          yr[o + s] = b1r * w1r - b1i * w1i; yi[o + s] = b1r * w1i + b1i * w1r;
          yr[o + 2 * s] = b2r * w2r - b2i * w2i; yi[o + 2 * s] = b2r * w2i + b2i * w2r;
          yr[o + 3 * s] = b3r * w3r - b3i * w3i; yi[o + 3 * s] = b3r * w3i + b3i * w3r;
        }
      } else if (r === 2) {
        const w1r = wr[e]; const w1i = wi[e];
        for (let q = 0; q < s; q++) {
          const i0 = q + s * p; const i1 = i0 + sm;
          const dr = xr[i0] - xr[i1]; const di = xi[i0] - xi[i1];
          const o = o0 + q;
          yr[o] = xr[i0] + xr[i1]; yi[o] = xi[i0] + xi[i1];
          yr[o + s] = dr * w1r - di * w1i; yi[o + s] = dr * w1i + di * w1r;
        }
      } else if (r === 3) {
        const w1r = wr[e]; const w1i = wi[e];
        const w2r = wr[2 * e]; const w2i = wi[2 * e];
        for (let q = 0; q < s; q++) {
          const i0 = q + s * p; const i1 = i0 + sm; const i2 = i1 + sm;
          const t1r = xr[i1] + xr[i2]; const t1i = xi[i1] + xi[i2];
          const t2r = xr[i1] - xr[i2]; const t2i = xi[i1] - xi[i2];
          const cr = xr[i0] - 0.5 * t1r; const ci = xi[i0] - 0.5 * t1i;
          const b1r = cr + SQRT3_2 * t2i; const b1i = ci - SQRT3_2 * t2r;
          const b2r = cr - SQRT3_2 * t2i; const b2i = ci + SQRT3_2 * t2r;
          const o = o0 + q;
          yr[o] = xr[i0] + t1r; yi[o] = xi[i0] + t1i;
          yr[o + s] = b1r * w1r - b1i * w1i; yi[o + s] = b1r * w1i + b1i * w1r;
          yr[o + 2 * s] = b2r * w2r - b2i * w2i; yi[o + 2 * s] = b2r * w2i + b2i * w2r;
        }
      } else {
        // radix 5
        const w1r = wr[e]; const w1i = wi[e];
        const w2r = wr[2 * e]; const w2i = wi[2 * e];
        const w3r = wr[3 * e]; const w3i = wi[3 * e];
        const w4r = wr[4 * e]; const w4i = wi[4 * e];
        for (let q = 0; q < s; q++) {
          const i0 = q + s * p; const i1 = i0 + sm; const i2 = i1 + sm; const i3 = i2 + sm; const i4 = i3 + sm;
          const a0r = xr[i0]; const a0i = xi[i0];
          const t1r = xr[i1] + xr[i4]; const t1i = xi[i1] + xi[i4];
          const t2r = xr[i2] + xr[i3]; const t2i = xi[i2] + xi[i3];
          const t3r = xr[i1] - xr[i4]; const t3i = xi[i1] - xi[i4];
          const t4r = xr[i2] - xr[i3]; const t4i = xi[i2] - xi[i3];
          const ar1 = a0r + C5_1 * t1r + C5_2 * t2r; const ai1 = a0i + C5_1 * t1i + C5_2 * t2i;
          const ar2 = a0r + C5_2 * t1r + C5_1 * t2r; const ai2 = a0i + C5_2 * t1i + C5_1 * t2i;
          const ur = S5_1 * t3r + S5_2 * t4r; const ui = S5_1 * t3i + S5_2 * t4i;
          const vvr = S5_2 * t3r - S5_1 * t4r; const vvi = S5_2 * t3i - S5_1 * t4i;
          const b1r = ar1 + ui; const b1i = ai1 - ur; // A1 - i u
          const b4r = ar1 - ui; const b4i = ai1 + ur; // A1 + i u
          const b2r = ar2 + vvi; const b2i = ai2 - vvr; // A2 - i v
          const b3r = ar2 - vvi; const b3i = ai2 + vvr; // A2 + i v
          const o = o0 + q;
          yr[o] = a0r + t1r + t2r; yi[o] = a0i + t1i + t2i;
          yr[o + s] = b1r * w1r - b1i * w1i; yi[o + s] = b1r * w1i + b1i * w1r;
          yr[o + 2 * s] = b2r * w2r - b2i * w2i; yi[o + 2 * s] = b2r * w2i + b2i * w2r;
          yr[o + 3 * s] = b3r * w3r - b3i * w3i; yi[o + 3 * s] = b3r * w3i + b3i * w3r;
          yr[o + 4 * s] = b4r * w4r - b4i * w4i; yi[o + 4 * s] = b4r * w4i + b4i * w4r;
        }
      }
    }
    const tr = xr;
    const ti = xi;
    xr = yr;
    xi = yi;
    yr = tr;
    yi = ti;
    s *= r;
    nc = m;
  }
  if (xr !== re) {
    for (let k = 0; k < n; k++) {
      re[k] = xr[k];
      im[k] = xi[k];
    }
  }
}

/** Bluestein plans per length: chirp and the FFT of its kernel (deterministic, cached). */
const bluestein = new Map();

function bluesteinPlan(n) {
  let p = bluestein.get(n);
  if (p) return p;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  const twoN = 2 * n;
  for (let k = 0; k < n; k++) {
    const kk = (k * k) % twoN; // exact: k * k < 2^53
    const ang = Math.PI * kk / n;
    wr[k] = Math.cos(ang);
    wi[k] = -Math.sin(ang); // exp(-i pi k^2 / n)
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = wr[0];
  bi[0] = -wi[0];
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = wr[k];
    bi[k] = bi[m - k] = -wi[k];
  }
  stockham(br, bi, stockhamPlan(m));
  p = { m, wr, wi, br, bi, ar: new Float64Array(m), ai: new Float64Array(m) };
  bluestein.set(n, p);
  return p;
}

/**
 * In-place complex FFT (forward, unnormalised) of any length.
 * @param {Float64Array|number[]} re
 * @param {Float64Array|number[]} im
 */
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  const plan = stockhamPlan(n);
  if (plan) {
    stockham(re, im, plan);
    return;
  }
  const { m, wr, wi, br, bi, ar, ai } = bluesteinPlan(n);
  const pm = stockhamPlan(m);
  ar.fill(0);
  ai.fill(0);
  for (let k = 0; k < n; k++) {
    ar[k] = re[k] * wr[k] - im[k] * wi[k];
    ai[k] = re[k] * wi[k] + im[k] * wr[k];
  }
  stockham(ar, ai, pm);
  for (let k = 0; k < m; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k];
    const i = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r;
    ai[k] = -i; // conjugate -> inverse via forward FFT
  }
  stockham(ar, ai, pm);
  for (let k = 0; k < n; k++) {
    const r = ar[k] / m;
    const i = -ai[k] / m;
    re[k] = r * wr[k] - i * wi[k];
    im[k] = r * wi[k] + i * wr[k];
  }
}

const rfftTwiddles = new Map();

/**
 * |rfft(x)|^2 for bins 0 .. n/2 (setup-time helper). Even lengths use one complex FFT of
 * half the length (real-input packing).
 * @param {ArrayLike<number>} x
 * @returns {Float64Array}
 */
export function powerSpectrum(x) {
  const n = x.length;
  const half = n >> 1;
  const p = new Float64Array(half + 1);
  if (n % 2 !== 0 || n < 4) {
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k <= half; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    return p;
  }
  const zr = new Float64Array(half);
  const zi = new Float64Array(half);
  for (let t = 0; t < half; t++) {
    zr[t] = x[2 * t];
    zi[t] = x[2 * t + 1];
  }
  fft(zr, zi);
  let tw = rfftTwiddles.get(n);
  if (!tw) {
    tw = { c: new Float64Array(half + 1), s: new Float64Array(half + 1) };
    for (let k = 0; k <= half; k++) {
      const a = 2 * Math.PI * k / n;
      tw.c[k] = Math.cos(a);
      tw.s[k] = -Math.sin(a);
    }
    rfftTwiddles.set(n, tw);
  }
  for (let k = 0; k <= half; k++) {
    const k1 = k === half ? 0 : k;
    const k2 = k === 0 ? 0 : half - k;
    const ar = zr[k1];
    const ai = zi[k1];
    const br = zr[k2];
    const bi = -zi[k2]; // conj(Z[half - k])
    const er = 0.5 * (ar + br);
    const ei = 0.5 * (ai + bi);
    const or = 0.5 * (ai - bi); // (Z[k] - conj Z[half-k]) / 2i
    const oi = -0.5 * (ar - br);
    const c = tw.c[k];
    const s = tw.s[k];
    const xr = er + (or * c - oi * s);
    const xi = ei + (or * s + oi * c);
    p[k] = xr * xr + xi * xi;
  }
  return p;
}

// ------------------------------------------------------------------ rounding
/**
 * Python round(x, digits): correctly rounded on the exact binary value, exact ties to even.
 * (C# Math.Round(x, d, ToEven) scales by 10^d first and can differ on near-ties; Python is
 * the reference.)
 * @param {number} x
 * @param {number} [digits] 0..20
 */
export function pyRound(x, digits = 0) {
  if (!Number.isFinite(x)) return x;
  // exact tie <=> x * 2^(digits+1) is an odd integer
  const y = x * 2 ** (digits + 1);
  if (Number.isInteger(y) && Math.abs(y % 2) === 1) {
    const p5 = y * 5 ** digits; // = 2 * x * 10^digits, odd
    if (Math.abs(p5) < 9007199254740992) {
      const lo = (p5 - 1) / 2;
      const even = lo % 2 === 0 ? lo : lo + 1;
      return even / 10 ** digits;
    }
  }
  return Number(x.toFixed(digits));
}

/** The C# static class DspMath as one namespace object. */
export const DspMath = Object.freeze({ brentq, interpIndex, interpAt, interp, fft, powerSpectrum, pyRound });
