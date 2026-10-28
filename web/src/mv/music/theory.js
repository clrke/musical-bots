// Music theory helpers: pitch classes, major keys, roman-numeral chords, voice ranges.
// Pure and deterministic; no DOM. All pitch classes are 0..11 with C = 0.

import { KEYS, RETIRED_VOICES, VOICES } from '../model/schema.js';

export const MAJOR_SCALE = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
/** Semitones kept free at both ends of a voice range when placing a line's centre. */
export const RANGE_MARGIN = 5;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#']);
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function mod12(x) {
  return ((x % 12) + 12) % 12;
}

/** 'C#', 'Db', 'f', 'B♭' -> pitch class, or null. */
export function pitchClass(name) {
  if (typeof name !== 'string') return null;
  const m = /^\s*([A-Ga-g])([#♯b♭]*)\s*$/.exec(name);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return mod12(pc);
}

/** Any spelling of a major key ('Db', 'c#', 'G major') -> the KEYS entry, or null. */
export function normalizeKey(key) {
  if (KEYS.includes(key)) return key;
  if (typeof key !== 'string') return null;
  const pc = pitchClass(key.replace(/\s*(major|maj)\s*$/i, ''));
  return pc === null ? null : KEYS.find((k) => pitchClass(k) === pc) ?? null;
}

/** Tonic pitch class of a key (unknown keys fall back to C). */
export function keyPc(key) {
  return pitchClass(normalizeKey(key) ?? 'C');
}

/** The 7 pitch classes of the major scale on `key`, indexed by scale degree (0 = tonic). */
export function scalePcs(key) {
  const tonic = keyPc(key);
  return MAJOR_SCALE.map((i) => mod12(tonic + i));
}

/** Pitch class name, spelled with sharps in sharp keys and flats otherwise. */
export function noteName(pc, key = 'C') {
  const names = SHARP_KEYS.has(normalizeKey(key)) ? SHARP_NAMES : FLAT_NAMES;
  return names[mod12(pc)];
}

/** MIDI note -> name with octave ('C4' = 60). */
export function midiName(midi, key = 'C') {
  return `${noteName(midi, key)}${Math.floor(midi / 12) - 1}`;
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Roman-numeral suffixes -> chord kind.
const SUFFIXES = {
  '': '', 7: '7', maj7: 'maj7', M7: 'maj7', ma7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
  o: 'dim', '°': 'dim', dim: 'dim', o7: 'dim7', '°7': 'dim7', dim7: 'dim7',
  'ø': 'hdim7', 'ø7': 'hdim7', m7b5: 'hdim7', '+': 'aug', aug: 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4', 6: '6', add9: 'add9',
};

/**
 * Parses a roman numeral chord ('I', 'vi', 'iv', 'V7', 'bVII', 'vii°', 'IVmaj7', 'Isus4').
 * Upper case = major triad, lower case = minor triad.
 * @returns {{accidental:number, degree:number, upper:boolean, suffix:string}|null}
 */
export function parseRoman(roman) {
  if (typeof roman !== 'string') return null;
  const m = /^\s*([b#♭♯]?)([ivIV]+)(.*?)\s*$/.exec(roman);
  if (!m) return null;
  const upper = m[2] === m[2].toUpperCase();
  if (!upper && m[2] !== m[2].toLowerCase()) return null;
  const degree = NUMERALS.indexOf(m[2].toUpperCase());
  if (degree < 0 || !Object.hasOwn(SUFFIXES, m[3])) return null;
  const accidental = m[1] === 'b' || m[1] === '♭' ? -1 : m[1] ? 1 : 0;
  return { accidental, degree, upper, suffix: SUFFIXES[m[3]] };
}

export function isValidRoman(roman) {
  return parseRoman(roman) !== null;
}

// Chord shapes: [semitones above the root, scale steps above the root's degree] per tone.
function chordShape(upper, suffix) {
  const third = upper ? [4, 2] : [3, 2];
  const triad = [[0, 0], third, [7, 4]];
  const base = upper ? { quality: 'maj', symbol: '' } : { quality: 'min', symbol: 'm' };
  switch (suffix) {
    case 'dim': return { quality: 'dim', symbol: 'dim', shape: [[0, 0], [3, 2], [6, 4]] };
    case 'aug': return { quality: 'aug', symbol: 'aug', shape: [[0, 0], [4, 2], [8, 4]] };
    case 'dim7': return { quality: 'dim7', symbol: 'dim7', shape: [[0, 0], [3, 2], [6, 4], [9, 6]] };
    case 'hdim7': return { quality: 'hdim7', symbol: 'm7b5', shape: [[0, 0], [3, 2], [6, 4], [10, 6]] };
    case 'sus2': return { quality: 'sus2', symbol: 'sus2', shape: [[0, 0], [2, 1], [7, 4]] };
    case 'sus4': return { quality: 'sus4', symbol: 'sus4', shape: [[0, 0], [5, 3], [7, 4]] };
    case '7':
      return upper
        ? { quality: 'dom7', symbol: '7', shape: [...triad, [10, 6]] }
        : { quality: 'min7', symbol: 'm7', shape: [...triad, [10, 6]] };
    case 'maj7':
      return upper
        ? { quality: 'maj7', symbol: 'maj7', shape: [...triad, [11, 6]] }
        : { quality: 'minmaj7', symbol: 'm(maj7)', shape: [...triad, [11, 6]] };
    case '6': return { quality: upper ? 'maj6' : 'min6', symbol: upper ? '6' : 'm6', shape: [...triad, [9, 5]] };
    case 'add9': return { quality: upper ? 'add9' : 'madd9', symbol: upper ? 'add9' : 'madd9', shape: [...triad, [2, 1]] };
    default: return { ...base, shape: triad };
  }
}

/**
 * Chord of a roman numeral in a major key. Invalid numerals give the tonic triad with
 * `valid: false`.
 * @returns {{roman:string, valid:boolean, degree:number, root:number, quality:string,
 *   tones:number[], toneDegrees:number[], seventh:number, name:string}}
 *   tones: pitch classes [root, third, fifth, (extension)]; seventh: the pitch class a
 *   'seventh' role sings (the chord's own seventh, else the diatonic / idiomatic one).
 */
export function chordFromRoman(roman, key = 'C') {
  const parsed = parseRoman(roman);
  const valid = parsed !== null;
  const p = parsed ?? { accidental: 0, degree: 0, upper: true, suffix: '' };
  const scale = scalePcs(key);
  const root = mod12(scale[p.degree] + p.accidental);
  const { quality, symbol, shape } = chordShape(p.upper, p.suffix);
  const tones = shape.map(([semi]) => mod12(root + semi));
  const toneDegrees = shape.map(([, steps]) => steps);
  const own7 = shape.find(([, steps]) => steps === 6);
  let seventh;
  if (own7) seventh = mod12(root + own7[0]);
  else {
    const diatonic = p.accidental === 0 && tones.every((pc) => scale.includes(pc));
    if (diatonic) seventh = scale[(p.degree + 6) % 7];
    else if (quality === 'maj') seventh = mod12(root + (p.accidental < 0 ? 11 : 10));
    else seventh = mod12(root + 10);
  }
  return { roman: String(roman), valid, degree: p.degree, root, quality, tones, toneDegrees, seventh, name: noteName(root, key) + symbol };
}

/**
 * The key's scale with the chord's tones spelled in (a borrowed iv in C gives C D E F G Ab B),
 * as sorted pitch classes. Used for passing and neighbour notes.
 */
export function chordScale(chord, key = 'C') {
  const scale = scalePcs(key);
  chord.tones.forEach((pc, i) => {
    scale[(chord.degree + chord.toneDegrees[i]) % 7] = pc;
  });
  return [...new Set(scale)].sort((a, b) => a - b);
}

/** The pitch class a chord-tone role anchors on ('lead' gets the root). */
export function roleTone(chord, role) {
  switch (role) {
    case 'third': return chord.tones[1];
    case 'fifth': return chord.tones[2];
    case 'seventh': return chord.seventh;
    default: return chord.tones[0]; // root, octave, bass, lead
  }
}

/** The MIDI note of pitch class `pc` closest to `centre` (ties go down). */
export function nearestMidi(pc, centre) {
  const below = Math.floor(centre) - mod12(Math.floor(centre) - pc);
  const above = below + 12;
  return centre - below <= above - centre ? below : above;
}

/**
 * The VOICES key a robot sings with: retired voices (RETIRED_VOICES, e.g. the Sprite 'child')
 * map to their replacement; unknown names are returned unchanged.
 */
export function resolveVoice(voice) {
  if (Object.hasOwn(VOICES, voice)) return voice;
  return Object.hasOwn(RETIRED_VOICES, voice) ? RETIRED_VOICES[voice] : voice;
}

/** MIDI range a voice sings well, and its comfortable centre. Unknown voices use 'coach'. */
export function voiceRange(voice) {
  const v = VOICES[resolveVoice(voice)] ?? VOICES.coach;
  return { low: v.low, high: v.high, centre: Math.round((v.low + v.high) / 2) };
}

/**
 * Centre (MIDI) a line is placed around: the voice's comfortable centre shifted by `octave`
 * octaves plus `offset` semitones, kept RANGE_MARGIN inside the voice range (extreme
 * octave shifts saturate instead of leaving the range).
 */
export function voiceCentre(voice, octave = 0, offset = 0) {
  const { low, high, centre } = voiceRange(voice);
  const c = centre + 12 * (Number(octave) || 0) + offset;
  return Math.max(low + RANGE_MARGIN, Math.min(high - RANGE_MARGIN, c));
}

// ------------------------------------------------------------------ cadences

/**
 * Song sections whose block ends on a cadence: bar 7 is the dominant (approach), bar 8 the
 * home chord, and every part lands there on a held chord tone (melody.js `cadenceBar`).
 */
export const CADENCE_SECTIONS = Object.freeze(['chorus', 'outro']);
/** Progression presets whose home is the relative minor (vi): they cadence III7 -> vi. */
export const MINOR_PRESETS = Object.freeze(['minor']);

/** Whether a block of song section `section` ends on a cadence. */
export function isCadenceSection(section) {
  return CADENCE_SECTIONS.includes(section);
}

/**
 * The [bar 7, bar 8] chords a preset progression cadences on: V7 -> I, or for a minor-feel
 * preset the relative minor's own V7 (with its raised leading tone, e.g. E7 in C) -> vi.
 */
export function cadenceRomans(preset) {
  return MINOR_PRESETS.includes(preset) ? ['III7', 'vi'] : ['V7', 'I'];
}
