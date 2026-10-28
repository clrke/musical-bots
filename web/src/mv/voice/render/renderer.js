// Plan -> audio (port of csharp/Mumble/Render/Renderer.cs, the synthesis half of
// mumble/render.py): pitch tracks, glottal source, per-unit formant filtering, noise events,
// peak normalisation. `synthesize` is split out so the singer (src/voice/sing.js) can plan
// its own retimed line and supply its own pitch track.

import { Planner } from './planner.js';
import { RenderResult } from './renderData.js';
import { Human, interpGridMs } from '../human/humanProsody.js';
import {
  analyze, applyRhythm, LETTER_DT, voiceOf, voiceWith, RD_MIN, RD_MAX, lineStreams,
  voicedRms, noiseRms, voicedLevelDb, lfBreathMatch, formantFilter, glottalSource, glottalSourceDyn,
  breathNoise, bandpass, lowpass, sosFilter, interp,
} from './port.js';

/** Sample rate (Hz). */
export const FS = 24000;
/** Output peak (dBFS). */
export const PEAK_DBFS = -3.0;
/** Edge fade length (s). */
export const EDGE_FADE = 0.005;
/** Valid modes. */
export const MODES = ['video', 'full', 'human'];
/** Number of independent random streams per line. */
export const K_STREAMS = 11;
/** Stream indices (Python's _rngs order). */
export const K = {
  plan: 0, glot: 1, breath: 2, asp: 3, fric: 4, pitch: 5, pros: 6, micro: 7, creak: 8, art: 9, air: 10,
};

/**
 * The line's 11 independent generators, seeded from CRC-32 of "lower(text)|voice|seed" and the
 * seed, split per stream with SplitMix64 (Renderer.Streams).
 */
export function streams(text, voice, seed) {
  return lineStreams(text, voice.name, seed, K_STREAMS);
}

/** numpy.interp(arange(n) / FS, ms, fp) for a 1 ms grid from 0 (Renderer.InterpGrid). */
export const interpGrid = interpGridMs;

function interp2(x, x0, x1, y0, y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Swell-hold-release envelope (raised-cosine edges), synth.ahr_env; cos skipped on the flat part. */
function ahr(t, on, off, attack, release) {
  let a = (t - on) / (attack > 1e-4 ? attack : 1e-4);
  let r = (off - t) / (release > 1e-4 ? release : 1e-4);
  if (a <= 0.0 || r <= 0.0) return 0.0;
  a = a >= 1.0 ? 1.0 : 0.5 - 0.5 * Math.cos(Math.PI * a);
  r = r >= 1.0 ? 1.0 : 0.5 - 0.5 * Math.cos(Math.PI * r);
  return a * r;
}

/** Soft burst: 0.7 ms rise, exponential decay, faded to zero at off (synth.burst_env). */
function burstEnv(t, on, off) {
  const rise = 0.0007;
  const x = t - on;
  if (!(x >= 0)) return 0.0;
  const c01 = (v) => (v < 0.0 ? 0.0 : v > 1.0 ? 1.0 : v);
  const up = 0.5 - 0.5 * Math.cos(Math.PI * c01(x / rise));
  const tau = Math.max((off - on) / 3.0, 1e-4);
  const decay = Math.exp(-Math.max(x - rise, 0.0) / tau);
  const tail = 0.5 - 0.5 * Math.cos(Math.PI * c01((off - t) / (0.4 * (off - on) + 1e-5)));
  return up * decay * tail;
}

// ------------------------------------------------------------------ full-mode pitch
/** The full-mode tune (declination + marks + nudges) in cents, one value per ms. */
export function tuneCents(units, nMs) {
  const cents = new Float64Array(nMs);
  if (units.length === 0) return cents;
  // stable sort by on (Python's sorted)
  const us = units.map((u, i) => ({ u, i })).sort((a, b) => (a.u.on !== b.u.on ? a.u.on - b.u.on : a.i - b.i));
  const T = [];
  const C = [];
  for (let k = 0; k < us.length; k++) {
    const u = us[k].u;
    const t0 = u.on;
    let t1 = Math.max(u.off - u.release, t0 + 0.01);
    if (k + 1 < us.length) t1 = Math.min(t1, us[k + 1].u.on - 0.003);
    t1 = Math.max(t1, t0 + 0.005);
    for (let q = 0; q < 2; q++) {
      let t = q === 0 ? t0 : t1;
      const c = q === 0 ? u.cOn : u.cOff;
      if (T.length > 0 && t <= T[T.length - 1]) t = T[T.length - 1] + 1e-4;
      T.push(t);
      C.push(c);
    }
  }
  const raw = new Float64Array(nMs);
  for (let i = 0; i < nMs; i++) raw[i] = interp(i / 1000.0, T, C);
  const k = 25; // 25 ms smoothing, edge-padded
  const lo = -(k >> 1);
  const hi = k - 1 - (k >> 1);
  for (let i = 0; i < nMs; i++) {
    let s = 0.0;
    for (let j = lo; j <= hi; j++) {
      let q = i + j;
      q = q < 0 ? 0 : q >= nMs ? nMs - 1 : q;
      s += raw[q];
    }
    cents[i] = s / k;
  }
  return cents;
}

/** Full-mode pitch: tune + the voice's wobble. */
export function pitchTrack(units, voice, n, rng) {
  const nMs = Math.ceil((n / FS) * 1000) + 2;
  const cents = tuneCents(units, nMs);
  const phase = 2 * Math.PI * rng.nextDouble();
  const f0Ms = new Float64Array(nMs);
  for (let i = 0; i < nMs; i++) {
    const c = cents[i] + voice.wobbleCents * Math.sin(2 * Math.PI * voice.wobbleHz * (i / 1000.0) + phase);
    f0Ms[i] = voice.f0 * Math.pow(2.0, c / 1200.0);
  }
  return { f0: interpGrid(n, f0Ms), f0Ms };
}

// ------------------------------------------------------------------ units
let s_exc = new Float64Array(0);
function scratch(n) {
  if (s_exc.length < n) s_exc = new Float64Array(Math.max(n, 2 * s_exc.length));
  return s_exc;
}

const LN10_20 = Math.LN10 / 20.0;

function renderUnit(output, u, voice, src, breath, asp, air, rd) {
  const n = output.length;
  const nk = u.keyframes.length;
  const nRes = 7;
  const kt = new Float64Array(nk);
  const kF = new Float64Array(nk * nRes);
  const kB = new Float64Array(nk * nRes);
  const kG = new Float64Array(nk);
  for (let k = 0; k < nk; k++) {
    const { t, target } = u.keyframes[k];
    kt[k] = t;
    for (let q = 0; q < nRes; q++) {
      kF[k * nRes + q] = target.F[q];
      kB[k * nRes + q] = target.B[q];
    }
    kG[k] = target.levelDb + u.gainDb;
  }
  if (u.fadeDb !== 0) for (let k = 0; k < nk; k++) kG[k] += interp2(kt[k], u.on, u.off, 0.0, u.fadeDb);
  const tail = u.release <= 0.01 ? 0.004 : 0.012;
  const tStart = u.hasAsp ? Math.min(u.on, u.aspOn) : u.on;
  const s0 = Math.max(0, Math.floor(tStart * FS));
  const s1 = Math.min(n, Math.ceil((u.off + tail) * FS) + 1);
  if (s1 - s0 < 16) return;
  const m = s1 - s0;
  const exc = scratch(m);
  let aspLin = 0.0;
  if (u.hasAsp) {
    const T0 = u.keyframes[0].target;
    aspLin = (Math.pow(10.0, u.aspDb / 20.0) * voicedRms(T0.F, T0.B, voice.f0, u.bright, voice.oq, rd)) /
      noiseRms(T0.F, T0.B, u.bright);
  }
  const on = u.on;
  const off = u.off;
  const att = u.attack;
  const rel = u.release;
  const br = u.breath;
  const hasAsp = u.hasAsp;
  const slope = u.gainSlopeDb;
  const slopeT0 = u.on + u.attack;
  const lt = u.levelFixT;
  const ld = u.levelFixDb;
  const nl = lt !== null ? lt.length : 0;
  let jk = 0;
  let jl = 0;
  for (let i = 0; i < m; i++) {
    const s = s0 + i;
    const tt = s / FS;
    let e = src[s] + br * breath[s];
    if (air !== null) e += air[s];
    e *= ahr(tt, on, off, att, rel);
    if (hasAsp) e += asp[s] * ahr(tt, u.aspOn, u.aspOff, u.aspAttack, u.aspRelease) * aspLin;
    // gain (dB): keyframe levels + slope + level fix
    while (jk + 1 < nk && kt[jk + 1] <= tt) jk++;
    let gdb;
    if (tt < kt[0]) gdb = kG[0];
    else if (jk >= nk - 1) gdb = kG[nk - 1];
    else if (kt[jk] === tt) gdb = kG[jk];
    else gdb = ((kG[jk + 1] - kG[jk]) / (kt[jk + 1] - kt[jk])) * (tt - kt[jk]) + kG[jk];
    if (slope !== 0) gdb += interp2(tt, slopeT0, off, 0.0, slope);
    if (nl > 0) {
      while (jl + 1 < nl && lt[jl + 1] <= tt) jl++;
      if (tt < lt[0]) gdb += ld[0];
      else if (jl >= nl - 1) gdb += ld[nl - 1];
      else if (lt[jl] === tt) gdb += ld[jl];
      else gdb += ((ld[jl + 1] - ld[jl]) / (lt[jl + 1] - lt[jl])) * (tt - lt[jl]) + ld[jl];
    }
    exc[i] = e * Math.exp(gdb * LN10_20);
  }
  formantFilter(exc, exc, m, s0 / FS, kt, kF, kB, nRes, u.bright);
  // stop the resonators ringing on past the end (clean cuts)
  const endT = off + tail;
  const fade = tail + 0.002;
  for (let i = 0; i < m; i++) {
    const tt = (s0 + i) / FS;
    const r = (endT - tt) / fade;
    if (r >= 1.0) output[s0 + i] += exc[i];
    else if (r > 0.0) output[s0 + i] += exc[i] * (0.5 - 0.5 * Math.cos(Math.PI * r));
  }
}

/** Undo pitch-driven loudness swings of every unit (render._level_fix). */
export function levelFix(units, voice, f0Ms, rd) {
  const nMs = f0Ms.length;
  const ms = new Float64Array(nMs);
  for (let i = 0; i < nMs; i++) ms[i] = i / 1000.0;
  for (const u of units) {
    const mid = 0.5 * (u.holdStart + u.holdEnd);
    let T = u.keyframes[0].target;
    let best = Math.abs(u.keyframes[0].t - mid);
    for (const k of u.keyframes) {
      if (Math.abs(k.t - mid) < best) {
        best = Math.abs(k.t - mid);
        T = k.target;
      }
    }
    const start = u.on - 0.01;
    const stop = u.off + 0.03;
    const cnt = Math.max(0, Math.ceil((stop - start) / 0.01));
    const tt = new Float64Array(cnt);
    const f0s = new Float64Array(cnt + 1);
    f0s[0] = voice.f0;
    for (let i = 0; i < cnt; i++) {
      tt[i] = start + i * 0.01;
      f0s[i + 1] = interp(tt[i], ms, f0Ms);
    }
    const lv = voicedLevelDb(T.F, T.B, voice.bright, f0s, voice.oq, rd);
    const db = new Float64Array(cnt);
    for (let i = 0; i < cnt; i++) db[i] = lv[0] - lv[i + 1];
    if (cnt > 0) {
      u.levelFixT = tt;
      u.levelFixDb = db;
    }
  }
}

function renderNoise(output, e, voice, src, fric) {
  const n = output.length;
  const pre = Math.trunc(0.01 * FS);
  const s0 = Math.floor(e.on * FS);
  const s1 = Math.min(n, Math.ceil(e.off * FS) + 1);
  if (s1 - s0 < 4 || s0 >= n) return;
  const a0 = Math.max(0, s0 - pre);
  const len = s1 - a0;
  const off0 = Math.max(0, s0 - a0);
  const bp = bandpass(e.lo, e.hi);
  const y = scratch(2 * len);
  const zi = new Float64Array(2 * (bp.sos.length / 6));
  for (let i = 0; i < len; i++) y[i] = fric[a0 + i];
  sosFilter(bp.sos, bp.sos.length / 6, zi, y, y, 0, len);
  const g = bp.gain;
  const gain = Math.pow(10.0, e.gainDb / 20.0);
  const burst = e.shape === 'burst';
  const buzz = e.buzzDb !== null;
  let buzzGain = 0.0;
  let bnorm = 0.0;
  if (buzz) {
    const lp = lowpass(450.0 * Math.sqrt(voice.tube));
    const zb = new Float64Array(2 * (lp.length / 6));
    for (let i = 0; i < len; i++) y[len + i] = src[a0 + i];
    sosFilter(lp, lp.length / 6, zb, y, y, len, len);
    let ss = 0.0;
    const cnt = len - off0;
    for (let i = off0; i < len; i++) ss += y[len + i] * y[len + i];
    bnorm = 1.0 / (Math.sqrt(ss / Math.max(cnt, 1)) + 1e-9);
    buzzGain = Math.pow(10.0, e.buzzDb / 20.0);
  }
  for (let i = off0; i < len; i++) {
    const s = a0 + i;
    const tt = s / FS;
    const env = burst ? burstEnv(tt, e.on, e.off) : ahr(tt, e.on, e.off, e.attack, e.release);
    if (env === 0.0) continue;
    let v = y[i] * g * env * gain;
    if (buzz) v += y[len + i] * bnorm * env * buzzGain;
    output[s] += v;
  }
}

/**
 * n samples of white noise, of which only the first `need` are drawn (the rest are never read):
 * the same values as drawing all n, as the C# renderer does.
 */
function gaussians(n, rng, need = n) {
  const a = new Float64Array(n);
  const m = Math.min(n, need);
  for (let i = 0; i < m; i++) a[i] = rng.nextGaussian();
  return a;
}

// ------------------------------------------------------------------ render
/** Human-mode voice-quality knobs kept in their valid ranges (render.render). */
export function clampHumanVoice(v) {
  return voiceWith(v, {
    rd: Math.min(Math.max(v.rd, RD_MIN), RD_MAX),
    creak: Math.min(Math.max(v.creak, 0.0), 1.0),
    air: Math.max(v.air, 0.0),
  });
}

/** Mode check, voice clamp, technique set (Renderer.MakePlan, first half). */
export function prepare(voice, mode, humanize) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  let v = voiceOf(voice ?? 'woman');
  const tech = Human.techniques(mode, humanize);
  if (tech.has('room')) throw new Error("humanize 'room' is not ported: the mixer adds the room");
  if (mode === 'human') v = clampHumanVoice(v);
  return { v, tech };
}

function makePlan(text, voice, mode, seed, humanize) {
  const { v, tech } = prepare(voice, mode, humanize);
  const an = analyze(text, LETTER_DT / v.speed);
  if (tech.has('rhythm')) applyRhythm(an);
  const r = streams(text, v, seed);
  const pl = new Planner(an, v, mode, tech, r[K.art]);
  pl.run(r[K.plan], r[K.pros]);
  return { pl, v, tech, r };
}

/**
 * Plan one line without synthesising it: units, noise events, closures and gains exactly as
 * render uses them (audio is empty, f0Ms null).
 */
export function plan(text, voice, mode = 'human', seed = 0, humanize = null) {
  text = text ?? '';
  const { pl, v } = makePlan(text, voice, mode, seed, humanize);
  return new RenderResult({
    audio: new Float32Array(0), fs: FS, text, voice: v, mode, analysis: pl.an, units: pl.units,
    noises: pl.noises, closures: pl.closures, scale: 1.0,
  });
}

/**
 * Synthesise a planned line: pitch, glottal source, breath / air, units and noise events.
 * Returns the raw (un-normalised) samples.
 * @param {Planner} pl
 * @param {object} v voice (as planned)
 * @param {Set<string>} tech
 * @param {object[]} r the line's random streams
 * @param {{pitchTrack?: Function}} [opts] pitchTrack(pl, v, n, rng) -> {f0, f0Ms} replaces the
 *   speech pitch (and its level fix), as the singer does.
 * @returns {{out: Float64Array, f0Ms: Float64Array, n: number}}
 */
export function synthesize(pl, v, tech, r, opts = {}) {
  let maxEnd = 0.2;
  for (const u of pl.units) maxEnd = Math.max(maxEnd, u.off);
  for (const e of pl.noises) maxEnd = Math.max(maxEnd, e.off);
  const n = Math.trunc((maxEnd + 0.06) * FS);
  let rd = 0.0;
  let air = null;
  let f0;
  let f0Ms;
  let creak;
  const pitchTech = tech.has('prosody') || tech.has('micro') || tech.has('creak');
  const nMs = Math.ceil((n / FS) * 1000) + 2;
  if (opts.pitchTrack) {
    ({ f0, f0Ms } = opts.pitchTrack(pl, v, n, r[K.pitch]));
    creak = new Float64Array(nMs);
  } else if (pitchTech) {
    const baseCents = pl.prosody !== null ? null : tuneCents(pl.units, nMs);
    ({ f0, f0Ms, creak } = Human.pitchTrack(pl, pl.prosody, baseCents, n, tech, r[K.micro], r[K.creak]));
  } else {
    ({ f0, f0Ms } = pitchTrack(pl.units, v, n, r[K.pitch]));
    creak = new Float64Array(nMs);
  }
  const src = new Float64Array(n);
  const shape = new Float64Array(n);
  const breath = new Float64Array(n);
  let bscale = null;
  if (tech.has('glottis') || tech.has('creak')) {
    const tr = Human.makeSourceTracks(pl, pl.prosody, creak, n, tech);
    rd = tr.rd !== null ? v.rd : 0.0;
    glottalSourceDyn(f0, n, r[K.glot], tr.rd, v.rd, v.oq, tr.jitter, tr.shimmer, tr.alt, 0.5, src, shape);
    const bfix = tr.rd !== null ? lfBreathMatch(v.f0, v.oq, v.rd) : 1.0;
    breathNoise(shape, n, r[K.breath], breath);
    bscale = new Float64Array(n);
    const g = tr.gain;
    const bs = tr.breathScale;
    for (let i = 0; i < n; i++) {
      src[i] *= g[i];
      bscale[i] = bs[i] * g[i];
      breath[i] *= bscale[i] * bfix;
    }
  } else {
    glottalSource(f0, n, v.oq, v.jitter, v.shimmer, r[K.glot], src, shape);
    breathNoise(shape, n, r[K.breath], breath);
  }
  if (tech.has('air')) {
    if (bscale === null) bscale = new Float64Array(n).fill(1.0);
    air = Human.airNoise(shape, n, v, bscale, r[K.air]);
  }
  if (pitchTech && !opts.pitchTrack) levelFix(pl.units, v, f0Ms, rd);
  // aspiration noise is read by aspirated units only, fricative noise by noise events only
  let needAsp = 0;
  for (const u of pl.units) if (u.hasAsp) needAsp = Math.max(needAsp, Math.ceil((u.off + 0.012) * FS) + 1);
  let needFric = 0;
  for (const e of pl.noises) needFric = Math.max(needFric, Math.ceil(e.off * FS) + 1);
  const asp = gaussians(n, r[K.asp], needAsp);
  const fric = gaussians(n, r[K.fric], needFric);
  const out = new Float64Array(n);
  for (const u of pl.units) renderUnit(out, u, v, src, breath, asp, air, rd);
  for (const e of pl.noises) renderNoise(out, e, v, src, fric);
  return { out, f0Ms, n };
}

/** Raised-cosine fades over the first / last EDGE_FADE seconds, in place. */
export function edgeFade(x, scale = 1.0) {
  const n = x.length;
  const nf = Math.trunc(EDGE_FADE * FS);
  for (let i = 0; i < n; i++) {
    let y = x[i] * scale;
    if (i < nf) y *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nf);
    if (i >= n - nf) y *= 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / nf);
    x[i] = y;
  }
  return x;
}

/**
 * Render one line (24 kHz mono, peak -3 dBFS). Deterministic for a given (text, voice, mode,
 * seed, humanize). humanize (human mode only): techniques to use, null = all but "room".
 */
export function render(text, voice, mode = 'human', seed = 0, humanize = null) {
  const t0 = performance.now();
  text = text ?? '';
  const { pl, v, tech, r } = makePlan(text, voice, mode, seed, humanize);
  const { out, f0Ms, n } = synthesize(pl, v, tech, r);
  let peak = 0.0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak > 0 ? Math.pow(10.0, PEAK_DBFS / 20.0) / peak : 1.0;
  edgeFade(out, scale);
  return new RenderResult({
    audio: Float32Array.from(out), fs: FS, text, voice: v, mode, analysis: pl.an, units: pl.units,
    noises: pl.noises, closures: pl.closures, f0Ms, scale, renderSeconds: (performance.now() - t0) / 1000,
  });
}

/** Drop the near-silent tail (below floorDb re peak), keeping keep seconds (render.trim_tail). */
export function trimTail(audio, floorDb = -60.0, keep = 0.01) {
  let peak = 0.0;
  for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
  if (peak <= 0) return audio;
  const thr = peak * Math.pow(10.0, floorDb / 20.0);
  let last = audio.length - 1;
  while (last > 0 && !(Math.abs(audio[last]) > thr)) last--;
  const end = Math.min(audio.length, last + 1 + Math.trunc(keep * FS));
  const o = audio.slice(0, end);
  const nf = Math.min(Math.trunc(EDGE_FADE * FS), end);
  const den = Math.max(nf, 1);
  for (let i = 0; i < nf; i++) {
    const k = nf - 1 - i; // ramp reversed: sample end-nf+i gets ramp[nf-1-i]
    o[end - nf + i] = o[end - nf + i] * (0.5 - 0.5 * Math.cos((Math.PI * k) / den));
  }
  return o;
}
