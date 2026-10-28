// Glottal sources (port of csharp/Mumble/Dsp/Glottal.cs, mumble/synth.py): Rosenberg and
// Liljencrants-Fant pulses. Per-sample loops are allocation-free on Float64Array buffers.
//
// Track (C# struct): a per-sample control is null / undefined (absent, reads as 0), a number
// (constant) or an array (one value per sample). Tracks are read once per glottal cycle.
import { brentq, FS, interp, SQ } from './dspMath.js';

/** LF wavetable samples per period. */
export const LF_N = 2048;
/** Rd grid start. */
export const RD_MIN = 0.3;
/** Rd grid end. */
export const RD_MAX = 2.7;
/** Rd grid step. */
export const RD_STEP = 0.05;
/** Number of Rd grid points (0.3 .. 2.7 step 0.05). */
export const RD_COUNT = 49;

/** RD_GRID values (np.round(np.arange(0.3, 2.7 + 1e-9, 0.05), 4)). */
export const RD_GRID = Object.freeze(Array.from({ length: RD_COUNT }, (_, i) => (30 + 5 * i) / 100.0));
const RD_GRID_F64 = Float64Array.from(RD_GRID);

/** Per-sample control track helpers (C# Track). */
export const Track = Object.freeze({
  /** No track (reads as 0). */
  None: null,
  /** True for a constant or per-sample track. */
  hasValue: (t) => t !== null && t !== undefined,
  /** Value at sample i (0 when absent). */
  at: (t, i) => (t === null || t === undefined ? 0.0 : typeof t === 'number' ? t : t[i]),
});

const trackAt = Track.at;

// ------------------------------------------------------------------ Rosenberg
/** Rosenberg glottal flow (0..1) at a phase in [0, 1) of the cycle. */
export function rosenbergFlow(phase, oq, sq = SQ) {
  const tp = oq * sq / (1.0 + sq);
  const tn = oq / (1.0 + sq);
  if (phase < tp) return 0.5 * (1.0 - Math.cos(Math.PI * phase / tp));
  if (phase < tp + tn) return Math.cos(0.5 * Math.PI * (phase - tp) / tn);
  return 0.0;
}

const sourceNormCache = new Map();

/** RMS of d(flow)/d(phase) so the differenced source has unit RMS (cached). */
export function sourceNorm(oq, sq = SQ) {
  const key = oq + 1000.0 * sq;
  const hit = sourceNormCache.get(key);
  if (hit !== undefined) return hit;
  const n = 20000;
  let prev = rosenbergFlow(0.5 / n, oq, sq);
  let sum = 0.0;
  for (let i = 1; i < n; i++) {
    const f = rosenbergFlow((i + 0.5) / n, oq, sq);
    const d = (f - prev) * n;
    sum += d * d;
    prev = f;
  }
  const r = Math.sqrt(sum / (n - 1));
  sourceNormCache.set(key, r);
  return r;
}

// ------------------------------------------------------------------ LF model
/**
 * Fant (1995) Rd -> (tp, te, ta) as fractions of the period. Returns [tp, te, ta], also
 * readable as .tp / .te / .ta.
 * @returns {[number, number, number] & {tp:number, te:number, ta:number}}
 */
export function lfTiming(rd) {
  const ra = (-1.0 + 4.8 * rd) / 100.0;
  const rk = (22.4 + 11.8 * rd) / 100.0;
  const rg = rk / (4.0 * (0.11 * rd / (0.5 + 1.2 * rk) - ra));
  const tp = 1.0 / (2.0 * rg);
  const r = [tp, tp * (1.0 + rk), ra];
  Object.defineProperty(r, 'tp', { value: r[0], enumerable: false });
  Object.defineProperty(r, 'te', { value: r[1], enumerable: false });
  Object.defineProperty(r, 'ta', { value: r[2], enumerable: false });
  return /** @type {any} */ (r);
}

/**
 * One period of the LF flow derivative (Ee = 1, closure at the period end) at times t.
 * @param {number} rd
 * @param {ArrayLike<number>} t phases in [0, 1]
 * @param {Float64Array|number[]} [output]
 * @returns {Float64Array|number[]} output
 */
export function lfDerivative(rd, t, output = new Float64Array(t.length)) {
  const [tp, te, ta] = lfTiming(rd);
  const wg = Math.PI / tp;
  const d = 1.0 - te;
  const eps = brentq((e) => e * ta - 1.0 + Math.exp(-e * d), 1e-6, 50.0 / ta);
  const retArea = -((1.0 - Math.exp(-eps * d)) / eps - d * Math.exp(-eps * d)) / (eps * ta);
  const s = Math.sin(wg * te);
  const c = Math.cos(wg * te);
  const area = (a) => {
    const e0a = -1.0 / (Math.exp(a * te) * Math.sin(wg * te));
    return e0a * (Math.exp(a * te) * (a * s - wg * c) + wg) / (a * a + wg * wg) + retArea;
  };
  // zero net flow over the cycle: scan for a sign change, then refine
  const grid = 441;
  const stepA = 110.0 / (grid - 1);
  let prevV = area(-30.0);
  let k = -1;
  for (let i = 1; i < grid; i++) {
    const v = area(i === grid - 1 ? 80.0 : -30.0 + i * stepA);
    if (Math.sign(prevV) !== Math.sign(v)) {
      k = i - 1;
      break;
    }
    prevV = v;
  }
  if (k < 0) throw new Error('lfDerivative: no root for alpha');
  const ga = -30.0 + k * stepA;
  const gb = k + 1 === grid - 1 ? 80.0 : -30.0 + (k + 1) * stepA;
  const alpha = brentq(area, ga, gb);
  const e0 = -1.0 / (Math.exp(alpha * te) * Math.sin(wg * te));
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    output[i] = x <= te
      ? e0 * Math.exp(alpha * x) * Math.sin(wg * x)
      : -(Math.exp(-eps * (x - te)) - Math.exp(-eps * d)) / (eps * ta);
  }
  return output;
}

let lfTablesArr = null; // [RD_COUNT * (LF_N + 1)]
let lfNormsArr = null;

function ensureTables() {
  if (lfTablesArr) return;
  const w = LF_N + 1;
  const tables = new Float64Array(RD_COUNT * w);
  const norms = new Float64Array(RD_COUNT);
  const t = new Float64Array(LF_N);
  const e = new Float64Array(LF_N);
  for (let i = 0; i < LF_N; i++) t[i] = (i + 0.5) / LF_N;
  for (let r = 0; r < RD_COUNT; r++) {
    lfDerivative(RD_GRID[r], t, e);
    const o = r * w;
    tables[o] = 0.0;
    let cs = 0.0;
    for (let i = 0; i < LF_N; i++) {
      cs += e[i];
      tables[o + i + 1] = cs / LF_N;
    }
    const last = tables[o + LF_N];
    const lstep = last / LF_N;
    let max = 0.0;
    for (let i = 0; i <= LF_N; i++) {
      const lin = i === LF_N ? last : i * lstep;
      let f = tables[o + i] - lin;
      if (!(f > 0.0)) f = 0.0;
      tables[o + i] = f;
      if (f > max) max = f;
    }
    let sum = 0.0;
    for (let i = 0; i <= LF_N; i++) tables[o + i] /= max;
    for (let i = 0; i < LF_N; i++) {
      const dd = (tables[o + i + 1] - tables[o + i]) * LF_N;
      sum += dd * dd;
    }
    norms[r] = Math.sqrt(sum / LF_N);
  }
  lfNormsArr = norms;
  lfTablesArr = tables;
}

/** LF flow tables, row-major [RD_COUNT, LF_N + 1], peak 1 (built once; do not modify). */
export function lfTables() {
  ensureTables();
  return lfTablesArr;
}

/** RMS of d(flow)/d(phase) per Rd grid point (do not modify). */
export function lfNorms() {
  ensureTables();
  return lfNormsArr;
}

/** Source normaliser at any Rd (linear interpolation over the grid). */
export function lfNorm(rd) {
  return interp(rd, RD_GRID_F64, lfNorms());
}

// ------------------------------------------------------------------ sources
function clip3(z) {
  return z < -3.0 ? -3.0 : z > 3.0 ? 3.0 : z;
}

function maxOf(a, n) {
  let m = a[0];
  for (let i = 1; i < n; i++) if (a[i] > m) m = a[i];
  return m;
}

/**
 * Classic glottal source: per-sample f0 (Hz) -> unit-RMS differenced Rosenberg flow (outD)
 * and the 0..1 flow shape (outShape). Draws two Gaussians per cycle (jitter, shimmer).
 * Allocation-free.
 * @param {ArrayLike<number>} f0
 * @param {number} n
 * @param {number} oq
 * @param {number} jitter
 * @param {number} shimmer
 * @param {{nextGaussian():number}} rng
 * @param {Float64Array|number[]} outD
 * @param {Float64Array|number[]} outShape
 * @param {number} [sq]
 */
export function glottalSource(f0, n, oq, jitter, shimmer, rng, outD, outShape, sq = SQ) {
  if (n <= 0) return;
  const dur = n / FS;
  const maxCycles = Math.trunc(dur * maxOf(f0, n) * 1.3) + 16;
  const norm = sourceNorm(oq, sq);
  let t = 0.0;
  let k = 0;
  let i = 0;
  let prevFlow = 0.0;
  while (t < dur && k < maxCycles) {
    const idx = Math.min(Math.trunc(t * FS), n - 1);
    const jit = clip3(rng.nextGaussian()) * jitter;
    const amp = 1.0 + clip3(rng.nextGaussian()) * shimmer;
    const period = (1.0 / f0[idx]) * (1.0 + jit);
    const start = t;
    t += period;
    k++;
    const last = !(t < dur && k < maxCycles);
    for (; i < n; i++) {
      const ts = i / FS;
      if (!last && ts >= t) break;
      const phase = (ts - start) / period;
      const shape = rosenbergFlow(phase, oq, sq);
      const flow = shape * amp;
      outShape[i] = shape;
      outD[i] = (flow - prevFlow) * (FS / f0[i]) / norm;
      prevFlow = flow;
    }
  }
}

/**
 * Glottal source with per-sample control tracks, read once per cycle. rd: Rd track (LF
 * pulses) or null for the Rosenberg pulse with oq. jitter / shimmer: per-cycle period /
 * amplitude perturbation (fraction). alt: creak alternation 0..1. Output is unit RMS at
 * rdRef; other Rd keep a fraction levelExp of the natural level change. Draws two Gaussians
 * per cycle. Allocation-free.
 * @param {ArrayLike<number>} f0 per-sample pitch (Hz)
 * @param {number} n
 * @param {{nextGaussian():number}} rng
 * @param {number|ArrayLike<number>|null} rd
 * @param {number} rdRef
 * @param {number} oq
 * @param {number|ArrayLike<number>|null} jitter
 * @param {number|ArrayLike<number>|null} shimmer
 * @param {number|ArrayLike<number>|null} alt
 * @param {number} levelExp
 * @param {Float64Array|number[]} outD
 * @param {Float64Array|number[]} outShape
 */
export function glottalSourceDyn(f0, n, rng, rd, rdRef, oq, jitter, shimmer, alt, levelExp, outD, outShape) {
  if (n <= 0) return;
  const dur = n / FS;
  const maxCycles = Math.trunc(dur * maxOf(f0, n) * 1.6) + 16;
  const lf = rd !== null && rd !== undefined;
  const tables = lf ? lfTables() : null;
  const norms = lf ? lfNorms() : null;
  const norm = lf ? lfNorm(rdRef) : sourceNorm(oq);
  const w = LF_N + 1;
  let t = 0.0;
  let k = 0;
  let i = 0;
  let prevFlow = 0.0;
  while (t < dur && k < maxCycles) {
    const idx = Math.min(Math.trunc(t * FS), n - 1);
    const zj = clip3(rng.nextGaussian());
    const zs = clip3(rng.nextGaussian());
    const a = trackAt(alt, idx);
    const sign = k % 2 === 0 ? 1.0 : -1.0;
    const period = (1.0 / f0[idx]) * (1.0 + zj * trackAt(jitter, idx) + 0.08 * a * sign);
    const amp = Math.max(0.05, (1.0 + zs * trackAt(shimmer, idx)) * (1.0 - 0.5 * a * (sign < 0 ? 1.0 : 0.0)));
    let r0 = 0;
    let rw = 0.0;
    let gain = 1.0;
    if (lf) {
      let rdk = trackAt(rd, idx);
      rdk = rdk < RD_MIN ? RD_MIN : rdk > RD_MAX ? RD_MAX : rdk;
      const rpos = (rdk - RD_MIN) / RD_STEP;
      const fl = Math.floor(rpos);
      r0 = fl < 0 ? 0 : fl > RD_COUNT - 2 ? RD_COUNT - 2 : fl;
      rw = rpos - r0;
      rw = rw < 0.0 ? 0.0 : rw > 1.0 ? 1.0 : rw;
      const cycNorm = norms[r0] * (1 - rw) + norms[r0 + 1] * rw;
      gain = Math.pow(norm / cycNorm, 1.0 - levelExp);
    }
    const ag = amp * gain;
    const start = t;
    t += period;
    k++;
    const last = !(t < dur && k < maxCycles);
    const o0 = r0 * w;
    const o1 = (r0 + 1) * w;
    for (; i < n; i++) {
      const ts = i / FS;
      if (!last && ts >= t) break;
      let phase = (ts - start) / period;
      phase = phase < 0.0 ? 0.0 : phase > 1.0 ? 1.0 : phase;
      let shape;
      if (lf) {
        const x = phase * LF_N;
        const c0 = Math.min(Math.floor(x), LF_N - 1);
        const cw = x - c0;
        const lo = tables[o0 + c0] * (1 - cw) + tables[o0 + c0 + 1] * cw;
        const hi = tables[o1 + c0] * (1 - cw) + tables[o1 + c0 + 1] * cw;
        shape = lo * (1 - rw) + hi * rw;
      } else {
        shape = rosenbergFlow(Math.min(phase, 1.0 - 1e-9), oq);
      }
      const flow = shape * ag;
      outShape[i] = shape;
      outD[i] = (flow - prevFlow) * (FS / f0[i]) / norm;
      prevFlow = flow;
    }
  }
}

/**
 * Pitch-synchronous breath: white noise gated by the glottal flow, unit RMS. Writes n
 * samples to output; allocation-free.
 * @param {ArrayLike<number>} shape
 * @param {number} n
 * @param {{nextGaussian():number}} rng
 * @param {Float64Array|number[]} output
 */
export function breathNoise(shape, n, rng, output) {
  let sum = 0.0;
  for (let i = 0; i < n; i++) {
    const mod = 0.25 + 0.75 * shape[i];
    sum += mod * mod;
  }
  const inv = 1.0 / Math.sqrt(sum / n);
  for (let i = 0; i < n; i++) output[i] = rng.nextGaussian() * (0.25 + 0.75 * shape[i]) * inv;
}

/** The C# static class Glottal as one namespace object (lfTables / lfNorms as getters). */
export const Glottal = Object.freeze({
  k_LfN: LF_N, k_RdMin: RD_MIN, k_RdMax: RD_MAX, k_RdStep: RD_STEP, k_RdCount: RD_COUNT,
  LF_N, RD_MIN, RD_MAX, RD_STEP, RD_COUNT, RD_GRID,
  get rdGrid() { return RD_GRID; },
  get lfTables() { return lfTables(); },
  get lfNorms() { return lfNorms(); },
  rosenbergFlow, sourceNorm, lfTiming, lfDerivative, lfNorm, glottalSource, glottalSourceDyn, breathNoise,
});
