// The render / human / sing modules' only bridge to the text, DSP, phone and voice ports
// (src/voice/{text,dsp}, phones.js, voice.js). Keeps the planner and renderer written against
// one small surface, mirroring the C# calls they port.

import { analyze as analyzeText, LETTER_DT } from '../text/analyze.js';
import { phraseType as phraseTypeText } from '../text/phraseType.js';
import { applyRhythm as applyRhythmText } from '../text/rhythm.js';
import * as Phones from '../phones.js';
import { Voice } from '../voice.js';
import { Seed } from '../dsp/rng.js';
import { DspMath } from '../dsp/dspMath.js';
import { Sos, Filters } from '../dsp/filters.js';
import { Glottal } from '../dsp/glottal.js';
import { Levels } from '../dsp/levels.js';

export { LETTER_DT };

/** Phone tables: dictionaries index by symbol, tuples are arrays ([F1, F2, F3], [lo, hi], [start, end]). */
export const PH = Phones;

/**
 * Text analysis (MumbleText.Analyze); `manual` is the optional hyphenation of the line (JS
 * extension: each piece one syllable with a nucleus, as syllabify() counts them).
 */
export function analyze(text, dt, manual = null) {
  return analyzeText(text, dt, manual);
}

/** decl / excl / cont / ynq / whq / trail (Human.PhraseType). */
export function phraseType(an, pi) {
  return phraseTypeText(an, pi);
}

/** Human-mode rhythm warp of the phone times, in place (Human.ApplyRhythm). */
export function applyRhythm(an) {
  applyRhythmText(an);
}

/** Voice profile by name, or the voice itself. */
export function voiceOf(voice) {
  return typeof voice === 'string' ? Voice.get(voice) : voice;
}

/** Copy of a voice with some fields replaced (Voice.With). */
export function voiceWith(v, patch) {
  return v.with(patch);
}

export const RD_MIN = Glottal.k_RdMin;
export const RD_MAX = Glottal.k_RdMax;

/**
 * The line's independent random streams (C# Renderer.Streams): xoshiro256** generators seeded
 * from CRC-32 of "lower(text)|voice|seed" and the seed, split per stream with SplitMix64.
 */
export function lineStreams(text, voiceName, seed, count) {
  return Seed.streams(text, voiceName, seed, count);
}

/** numpy.interp(x, xp, fp) for one point. */
export function interp(x, xp, fp) {
  return DspMath.interp(x, xp, fp);
}

// ---- levels (Levels)
export function voicedRms(F, B, f0, bright, oq, rd = 0.0) {
  return Levels.voicedRms(F, B, f0, bright, oq, rd);
}
export function noiseRms(F, B, bright) {
  return Levels.noiseRms(F, B, bright);
}
export function voicedLevelDb(F, B, bright, f0s, oq, rd = 0.0) {
  return Levels.voicedLevelDb(F, B, bright, f0s, oq, rd);
}
export function lfBreathMatch(f0, oq, rd) {
  return Levels.lfBreathMatch(f0, oq, rd);
}

// ---- sources (Glottal)
export function glottalSource(f0, n, oq, jitter, shimmer, rng, outD, outShape) {
  Glottal.glottalSource(f0, n, oq, jitter, shimmer, rng, outD, outShape);
}
export function glottalSourceDyn(f0, n, rng, rd, rdRef, oq, jitter, shimmer, alt, levelExp, outD, outShape) {
  Glottal.glottalSourceDyn(f0, n, rng, rd, rdRef, oq, jitter, shimmer, alt, levelExp, outD, outShape);
}
export function breathNoise(shape, n, rng, out) {
  Glottal.breathNoise(shape, n, rng, out);
}

// ---- filters (Filters, Sos)
export function formantFilter(x, y, n, t0, kt, kF, kB, nRes, bright) {
  Filters.formantFilter(x, y, n, t0, kt, kF, kB, nRes, bright);
}
/** 4-pole band-pass (cached) and its unit-RMS gain for white noise. @returns {{sos: Float64Array|number[], gain: number}} */
export function bandpass(lo, hi) {
  return Filters.bandpass(lo, hi);
}
export function lowpass(fc) {
  return Filters.lowpass(fc);
}
export function highpassNoise(n, fc, rng, out) {
  Filters.highpassNoise(n, fc, rng, out);
}
export function sosFilter(sos, nSec, zi, x, y, start, count) {
  Sos.filter(sos, nSec, zi, x, y, start, count);
}
