// Pure music helpers (no Web Audio) so they are testable in node.
import { hashString } from './gen/rng.js';

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// Chord qualities: [what follows the root, semitones above the root]. In order: the first match wins.
const QUALITIES = [
  [/^(?:maj|ma|M)(?:7|9|11|13)$|^Δ(?:7|9)?$/, [0, 4, 7, 11]], [/^(?:m|mi|min|-)(?:maj|M|Δ)(?:7|9)?$/, [0, 3, 7, 11]],
  [/^(?:m7b5|m7♭5|mi7b5|min7b5|ø7?)$/, [0, 3, 6, 10]], [/^(?:dim7|°7|o7)$/, [0, 3, 6, 9]], [/^(?:dim|°|o)$/, [0, 3, 6]],
  [/^(?:aug|\+|\+5|#5|♯5)$/, [0, 4, 8]], [/^(?:7?sus2)$/, [0, 2, 7]], [/^(?:7?sus4?)$/, [0, 5, 7]],
  [/^(?:m|mi|min|-)(?:7|9|11|13)$/, [0, 3, 7, 10]], [/^(?:7|9|11|13)$/, [0, 4, 7, 10]],
  [/^(?:m|mi|min|-)6(?:\/9)?$/, [0, 3, 7, 9]], [/^6(?:\/9)?$/, [0, 4, 7, 9]],
  [/^(?:m|mi|min|-)(?:add9|add2)$/, [0, 3, 7, 14]], [/^(?:add9|add2|2)$/, [0, 4, 7, 14]],
  [/^(?:m|mi|min|-)$/, [0, 3, 7]], [/^(?:5|maj|M)?$/, [0, 4, 7]],
];

/**
 * A chord symbol -> its root pitch class and the semitones of its tones above the root
 * ('F#m' -> { pc: 6, intervals: [0, 3, 7] }, 'Cmaj7' -> [0, 4, 7, 11], 'Bb' -> pc 10); a slash
 * bass is left out ('C/E'). null when it is not a chord symbol.
 */
export function parseChord(sym) {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)([^/\s]*)(?:\/\S*)?\s*$/.exec(String(sym ?? ''));
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  const quality = m[3].replace(/[()]/g, '');
  const q = QUALITIES.find(([re]) => re.test(quality));
  // (an unknown quality: minor if it starts with "m" but not "maj", plus a seventh if it has a 7)
  const minor = /^m(?!aj)/.test(quality);
  const intervals = q ? q[1] : [0, minor ? 3 : 4, 7, ...(quality.includes('7') ? [10] : [])];
  return { letter, acc, pc: (((SEMI[letter] + acc) % 12) + 12) % 12, intervals };
}

// 'Am' -> { root: 57, notes: [57,60,64] } (octave 3): the triad, plus a seventh / sixth / ninth
// when the symbol has one ('Cmaj7' -> [48,52,55,59]); sharps and flats move the root ('F#m',
// 'Bb'). Unknown symbols are C.
export function chordNotes(sym, octave = 3) {
  const c = parseChord(sym) ?? { letter: 'C', acc: 0, intervals: [0, 4, 7] };
  const root = SEMI[c.letter] + c.acc + 12 * (octave + 1);
  return { root, notes: c.intervals.map((i) => root + i) };
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
