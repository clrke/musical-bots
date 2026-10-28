// Pure music helpers (no Web Audio) so they are testable in node.
import { hashString } from './gen/rng.js';

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// 'Am' -> { root: 57, notes: [57,60,64] } (triad, octave 3)
export function chordNotes(sym, octave = 3) {
  const root = SEMI[sym[0]] + 12 * (octave + 1);
  const minor = sym.includes('m');
  return { root, notes: [root, root + (minor ? 3 : 4), root + 7] };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// Voice class -> register (midi of the tonic) and formant sets per vowel.
export const VOICES = {
  soprano: { base: 72 }, alto: { base: 65 }, tenor: { base: 60 }, basso: { base: 48 },
  coach: { base: 57 }, old: { base: 55 }, crooner: { base: 53 }, robo: { base: 62, robot: true },
};
export const VOWELS = {
  a: [800, 1150], e: [400, 1700], i: [300, 2200], o: [500, 900], u: [350, 700],
};
export const vowelOf = (word) => (word.toLowerCase().match(/[aeiou]/) ?? ['a'])[0];

// Words of a lyric -> [{ word, midi, vowel, beats }] following a contour
// fixed by the word hash, constrained to the C-major scale near the voice base.
export function melodyFor(lyric, voiceName) {
  const voice = VOICES[voiceName] ?? VOICES.alto;
  const words = lyric.match(/[A-Za-z']+/g) ?? [];
  let degree = 0;
  return words.map((word) => {
    const step = (hashString(word) % 5) - 2; // -2..+2
    degree = Math.max(-3, Math.min(7, degree + step));
    const oct = Math.floor(degree / 7), idx = ((degree % 7) + 7) % 7;
    return { word, midi: voice.base + 12 * oct + MAJOR[idx], vowel: vowelOf(word), beats: Math.max(1, Math.ceil(word.length / 3)) / 2 };
  });
}

// Chord scheduler: given chord symbols and bar length, the (time, chord)
// pairs falling inside [from, to) on a grid starting at origin.
export function chordsInWindow(chords, origin, barSec, from, to) {
  if (!chords.length) return [];
  const out = [];
  const step = barSec / 2;
  for (let n = Math.ceil((from - origin) / step); origin + n * step < to; n++) {
    if (n < 0) continue;
    out.push({ time: origin + n * step, chord: chords[n % chords.length] });
  }
  return out;
}
