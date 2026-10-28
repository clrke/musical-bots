// Appearance and particle settings of one robot head: defaults, validation and random picks.
// Pure (no three.js, no DOM) so the editor, the dev preview and the tests can share it.
import {
  ANTENNAS,
  BROW_SHAPES,
  EYE_SHAPES,
  FACE_SHAPES,
  FINISHES,
  FLOAT_STYLES,
  MOUTH_SHAPES,
  PALETTE,
  PARTICLE_PRESETS,
} from '../model/schema.js';

export const SCALE_RANGE = [0.8, 1.25];
export const PARTICLE_RATE_RANGE = [0, 2];
export const PARTICLE_SIZE_RANGE = [0.5, 2];
export const PARTICLE_SPEED_RANGE = [0.5, 2];

/** @type {import('../model/schema.js').Appearance} */
export const DEFAULT_APPEARANCE = Object.freeze({
  faceShape: 'dome',
  eyeShape: 'lens',
  browShape: 'bar',
  mouthShape: 'lips',
  antenna: 'single',
  finish: 'painted',
  faceColor: '#e8edf5',
  eyeColor: '#4fc3ff',
  accentColor: '#8a6bff',
  scale: 1,
  floatStyle: 'bob',
});

/** v1 look names -> v2 (the model migrates saved projects; this keeps a stray v1 look drawable). */
export const V1_LOOKS = Object.freeze({
  faceShape: { orb: 'egg', box: 'box', capsule: 'capsule', tv: 'tv', dome: 'dome', hexa: 'hex', lantern: 'bucket', bolt: 'bullet' },
  eyeShape: { round: 'lens', oval: 'bulb', visor: 'visor', pixel: 'lens', cyclops: 'monocle', happy: 'bulb', star: 'goggle', ring: 'telescope' },
  mouthShape: { grille: 'grille', oval: 'iris', led: 'shutter', speaker: 'jaw' },
  antenna: { halo: 'dish' },
});

/** @type {import('../model/schema.js').Particles} */
export const DEFAULT_PARTICLES = Object.freeze({ preset: 'none', color: null, rate: 1, size: 1, speed: 1 });

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value);
}

function oneOf(list, value, fallback, v1 = null) {
  if (list.includes(value)) return value;
  const mapped = v1?.[value];
  return mapped && list.includes(mapped) ? mapped : fallback;
}

function clampNumber(value, [lo, hi], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** A complete, valid Appearance (unknown or missing fields fall back to the defaults). */
export function normalizeAppearance(a = {}) {
  const d = DEFAULT_APPEARANCE;
  a = a || {};
  return {
    faceShape: oneOf(FACE_SHAPES, a.faceShape, d.faceShape, V1_LOOKS.faceShape),
    eyeShape: oneOf(EYE_SHAPES, a.eyeShape, d.eyeShape, V1_LOOKS.eyeShape),
    browShape: oneOf(BROW_SHAPES, a.browShape, d.browShape),
    mouthShape: oneOf(MOUTH_SHAPES, a.mouthShape, d.mouthShape, V1_LOOKS.mouthShape),
    antenna: oneOf(ANTENNAS, a.antenna, d.antenna, V1_LOOKS.antenna),
    finish: oneOf(FINISHES, a.finish, d.finish),
    faceColor: isHexColor(a.faceColor) ? a.faceColor.toLowerCase() : d.faceColor,
    eyeColor: isHexColor(a.eyeColor) ? a.eyeColor.toLowerCase() : d.eyeColor,
    accentColor: isHexColor(a.accentColor) ? a.accentColor.toLowerCase() : d.accentColor,
    scale: clampNumber(a.scale, SCALE_RANGE, d.scale),
    floatStyle: oneOf(FLOAT_STYLES, a.floatStyle, d.floatStyle),
  };
}

/** A complete, valid Particles setting. */
export function normalizeParticles(p = {}) {
  const d = DEFAULT_PARTICLES;
  p = p || {};
  return {
    preset: oneOf(PARTICLE_PRESETS, p.preset, d.preset),
    color: isHexColor(p.color) ? p.color.toLowerCase() : null,
    rate: clampNumber(p.rate, PARTICLE_RATE_RANGE, d.rate),
    size: clampNumber(p.size, PARTICLE_SIZE_RANGE, d.size),
    speed: clampNumber(p.speed, PARTICLE_SPEED_RANGE, d.speed),
  };
}

/** '#rrggbb' -> [r, g, b] in 0..1 (display / sRGB values, no colour-space conversion). */
export function hexToRgb(hex, out = [0, 0, 0]) {
  const n = parseInt(hex.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return out;
}

/** Relative luminance-ish lightness (0..1) of a display colour, for contrast decisions. */
export function lightness(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * The trim colour the brows, lips and rims are painted with: the accent colour, pushed lighter or
 * darker when it is too close to the face paint to read from across the room.
 */
export function trimColor(faceColor, accentColor, minContrast = 0.22) {
  const lf = lightness(faceColor);
  const la = lightness(accentColor);
  if (Math.abs(lf - la) >= minContrast) return accentColor;
  const rgb = hexToRgb(accentColor);
  const up = lf < 0.5;
  // move the accent away from the face's lightness until the gap is enough
  const target = up ? Math.min(1, lf + minContrast) : Math.max(0, lf - minContrast);
  const k = la > 1e-3 ? target / la : 1;
  const out = up ? rgb.map((v) => v + (1 - v) * Math.min(1, Math.max(0, (target - la) / Math.max(1e-3, 1 - la)))) : rgb.map((v) => v * Math.min(1, k));
  return toHex(out);
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

/** A random, pleasant appearance: the eyes glow brightly, the trims contrast with the paint. */
export function randomAppearance(rng = Math.random) {
  const faceColor = pick(rng, PALETTE);
  let eyeColor = pick(rng, PALETTE);
  for (let i = 0; i < 8 && lightness(eyeColor) < 0.35; i++) eyeColor = pick(rng, PALETTE);
  let accentColor = pick(rng, PALETTE);
  for (let i = 0; i < 8 && (accentColor === faceColor || Math.abs(lightness(accentColor) - lightness(faceColor)) < 0.15); i++) accentColor = pick(rng, PALETTE);
  return {
    faceShape: pick(rng, FACE_SHAPES),
    eyeShape: pick(rng, EYE_SHAPES),
    browShape: pick(rng, BROW_SHAPES),
    mouthShape: pick(rng, MOUTH_SHAPES),
    antenna: pick(rng, ANTENNAS),
    finish: pick(rng, FINISHES),
    faceColor,
    eyeColor,
    accentColor,
    scale: Math.round((SCALE_RANGE[0] + rng() * (SCALE_RANGE[1] - SCALE_RANGE[0])) * 100) / 100,
    floatStyle: pick(rng, FLOAT_STYLES),
  };
}

/** Random particle settings (any preset but 'none' unless `allowNone`). */
export function randomParticles(rng = Math.random, { allowNone = false } = {}) {
  const presets = allowNone ? PARTICLE_PRESETS : PARTICLE_PRESETS.filter((p) => p !== 'none');
  return {
    preset: pick(rng, presets),
    color: rng() < 0.25 ? pick(rng, PALETTE) : null,
    rate: 1,
    size: 1,
    speed: 1,
  };
}
