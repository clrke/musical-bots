// Phone inventory (port of csharp/Mumble/Phones.cs, mumble/phones.py): vowel formants,
// consonant classes and acoustic targets. All formants are for an adult male tract
// (tube = 1.0); voices scale them with their tube factor.
//
// Data shapes: C# Dictionary -> frozen null-prototype object (`T[sym]`, `sym in T`; also
// non-enumerable `T.get(sym)` / `T.has(sym)`). C# named tuples -> frozen arrays that also
// carry their names, camelCase and PascalCase: VOWELS.ee[0] === VOWELS.ee.f1 === VOWELS.ee.F1.

/**
 * Frozen array with named aliases (non-enumerable), e.g. tuple(['F1', 'F2'], [1, 2]).f1 === 1.
 * @param {string[]} names C# tuple element names
 * @param {any[]} values
 */
export function tuple(names, values) {
  const a = values.slice();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const camel = name[0].toLowerCase() + name.slice(1);
    Object.defineProperty(a, camel, { value: values[i], enumerable: false });
    if (camel !== name) Object.defineProperty(a, name, { value: values[i], enumerable: false });
  }
  return Object.freeze(a);
}

/**
 * Frozen dictionary (C# Dictionary<string, T>): null prototype, plus non-enumerable
 * Map-style get / has.
 * @template T
 * @param {Record<string, T>} obj
 * @returns {Readonly<Record<string, T>>}
 */
export function dict(obj) {
  const d = Object.create(null);
  for (const k of Object.keys(obj)) d[k] = obj[k];
  Object.defineProperty(d, 'get', { value: (k) => (Object.hasOwn(d, k) ? d[k] : undefined), enumerable: false });
  Object.defineProperty(d, 'has', { value: (k) => Object.hasOwn(d, k), enumerable: false });
  return Object.freeze(d);
}

const F3 = ['F1', 'F2', 'F3'];
const f3 = (a, b, c) => tuple(F3, [a, b, c]);
const band = (lo, hi) => tuple(['Lo', 'Hi'], [lo, hi]);

// ------------------------------------------------------------------ vowels
/** sym -> (F1, F2, F3). F4 is a fixed ~3.5 kHz resonance added by the synth. */
export const VOWELS = dict({
  ee: f3(270.0, 2290.0, 3010.0), // P&B /i/   heed
  ih: f3(390.0, 1990.0, 2550.0), // P&B /I/   hid
  eh: f3(530.0, 1840.0, 2480.0), // P&B /E/   head
  ae: f3(660.0, 1720.0, 2410.0), // P&B /ae/  had
  ah: f3(730.0, 1090.0, 2440.0), // P&B /a/   hod
  aw: f3(570.0, 840.0, 2410.0), // P&B /c/   hawed
  oh: f3(497.0, 910.0, 2459.0), // Hillenbrand /o/ hoed
  uu: f3(440.0, 1020.0, 2240.0), // P&B /U/   hood
  oo: f3(300.0, 870.0, 2240.0), // P&B /u/   who'd
  uh: f3(640.0, 1190.0, 2390.0), // P&B /^/   hud
  er: f3(490.0, 1350.0, 1690.0), // P&B /3r/  heard
  schwa: f3(500.0, 1500.0, 2500.0), // neutral tube
});

/** Diphthong glides: sym -> (start vowel, end vowel). */
export const DIPHTHONGS = dict({
  'eh-ee': tuple(['Start', 'End'], ['eh', 'ee']), // rain, say, they, make
  'ah-ee': tuple(['Start', 'End'], ['ah', 'ee']), // I, my, time, night
  'ah-oo': tuple(['Start', 'End'], ['ah', 'oo']), // out, town
  'oh-ee': tuple(['Start', 'End'], ['oh', 'ee']), // coin, boy
});

/** The six vowels of the original video. */
export const VIDEO_VOWELS = Object.freeze(['ah', 'eh', 'ee', 'oh', 'oo', 'uh']);

/** `video` mode collapses every vowel / diphthong onto the six video vowels. */
export const VIDEO_MAP = dict({
  ah: 'ah', eh: 'eh', ee: 'ee', oh: 'oh', oo: 'oo', uh: 'uh',
  ih: 'ee', ae: 'ah', aw: 'oh', uu: 'oo', er: 'uh', schwa: 'uh',
  'eh-ee': 'eh', 'ah-ee': 'ah', 'ah-oo': 'ah', 'oh-ee': 'oh',
});

/** Intrinsic loudness offsets (dB): open vowels are a little louder. */
export const VOWEL_INTRINSIC_DB = dict({
  ah: 1.0, ae: 1.0, aw: 0.8, uh: 0.5, eh: 0.3, oh: 0.3,
  er: 0.0, schwa: -0.5, ih: -1.0, uu: -1.0, ee: -1.5, oo: -1.5,
});

/** Default bandwidths (Hz) for F1..F4 of vowels. */
export const VOWEL_BW = Object.freeze([70.0, 100.0, 140.0, 250.0]);
/** Fixed F4 (Hz). */
export const F4_HZ = 3500.0;
/** Higher-pole correction: the next uniform-tube resonances (Hz). */
export const HIGHER_POLES = Object.freeze([4500.0, 5500.0, 6500.0]);
/** Bandwidths of the higher poles (Hz). */
export const HIGHER_BW = Object.freeze([300.0, 450.0, 600.0]);
/** Higher-pole bandwidths during nasals (Hz). */
export const NASAL_HIGHER_BW = Object.freeze([700.0, 900.0, 1100.0]);

// ------------------------------------------------------------------ consonants
const cons = (kind, voiced, place) => tuple(['Kind', 'Voiced', 'Place'], [kind, voiced, place]);

/** sym -> (kind, voiced, place). */
export const CONSONANTS = dict({
  p: cons('plosive', false, 'labial'),
  b: cons('plosive', true, 'labial'),
  t: cons('plosive', false, 'alveolar'),
  d: cons('plosive', true, 'alveolar'),
  k: cons('plosive', false, 'velar'),
  g: cons('plosive', true, 'velar'),
  f: cons('fricative', false, 'labiodental'),
  v: cons('fricative', true, 'labiodental'),
  th: cons('fricative', false, 'dental'),
  dh: cons('fricative', true, 'dental'),
  s: cons('fricative', false, 'alveolar'),
  z: cons('fricative', true, 'alveolar'),
  sh: cons('fricative', false, 'postalveolar'),
  zh: cons('fricative', true, 'postalveolar'),
  h: cons('aspirate', false, 'glottal'),
  ch: cons('affricate', false, 'postalveolar'),
  j: cons('affricate', true, 'postalveolar'),
  m: cons('nasal', true, 'labial'),
  n: cons('nasal', true, 'alveolar'),
  ng: cons('nasal', true, 'velar'),
  w: cons('glide', true, 'labial'),
  y: cons('glide', true, 'palatal'),
  l: cons('liquid', true, 'alveolar'),
  r: cons('liquid', true, 'postalveolar'),
});

/** Kinds that are sonorant. */
export const SONORANT_KINDS = Object.freeze(['vowel', 'nasal', 'glide', 'liquid']);
/** Kinds that are obstruent. */
export const OBSTRUENT_KINDS = Object.freeze(['plosive', 'fricative', 'affricate', 'aspirate']);

function isVowelSym(sym) {
  return Object.hasOwn(VOWELS, sym) || Object.hasOwn(DIPHTHONGS, sym);
}

function consonant(sym) {
  const c = Object.hasOwn(CONSONANTS, sym) ? CONSONANTS[sym] : undefined;
  if (c === undefined) throw new Error(`unknown phone '${sym}'`);
  return c;
}

/** vowel / plosive / fricative / affricate / aspirate / nasal / glide / liquid. */
export function phoneKind(sym) {
  return isVowelSym(sym) ? 'vowel' : consonant(sym)[0];
}

/** True if the phone is voiced (vowels always are). */
export function phoneVoiced(sym) {
  return isVowelSym(sym) || consonant(sym)[1];
}

/** Place of articulation ("vowel" for vowels). */
export function phonePlace(sym) {
  return isVowelSym(sym) ? 'vowel' : consonant(sym)[2];
}

/** Glide / liquid formant targets (F1, F2, F3). "L" = dark (coda) l. */
export const GLIDE_TARGETS = dict({
  w: f3(300.0, 650.0, 2200.0), // oo-like, lips rounded
  y: f3(270.0, 2200.0, 3000.0), // ee-like
  l: f3(360.0, 1100.0, 2700.0), // clear l (onset)
  L: f3(450.0, 850.0, 2700.0), // dark l (coda)
  r: f3(350.0, 1150.0, 1600.0), // low F3 ~1.6 kHz
});

/** Glide / liquid gain (dB). */
export const GLIDE_GAIN_DB = dict({ w: -4.0, y: -4.0, l: -5.0, L: -3.0, r: -4.0 });

/** Nasal murmur targets (F1, F2, F3). */
export const NASAL_TARGETS = dict({
  m: f3(270.0, 1050.0, 2300.0),
  n: f3(270.0, 1600.0, 2600.0),
  ng: f3(270.0, 2100.0, 2800.0),
});

/** Nasal bandwidths F1..F4 (Hz). */
export const NASAL_BW = Object.freeze([90.0, 300.0, 420.0, 520.0]);

/** "Closed mouth" target that mumbling pulls vowels toward. */
export const CLOSED_TARGET = f3(380.0, 1300.0, 2400.0);

// ------------------------------------------------------------------ noise
/** Fricative noise bands (Hz, male reference). */
export const FRICATIVE_BANDS = dict({
  s: band(4500.0, 8000.0), z: band(4500.0, 8000.0),
  sh: band(2000.0, 4500.0), zh: band(2000.0, 4500.0),
  f: band(1200.0, 8000.0), v: band(1200.0, 7000.0),
  th: band(1500.0, 8000.0), dh: band(1500.0, 7000.0),
  ch: band(2000.0, 4500.0), j: band(2000.0, 4500.0),
});

/** Fricative RMS level relative to a vowel (dB). */
export const FRICATIVE_LEVEL_DB = dict({
  s: -14.5, z: -18.0, sh: -14.0, zh: -17.5,
  f: -23.0, v: -25.0, th: -24.0, dh: -25.0,
  ch: -14.0, j: -17.5,
});

/** Low buzz under voiced fricatives / affricates (dB re vowel). */
export const VOICED_BUZZ_DB = -18.0;

/** Plosive release burst band by place (Hz). */
export const BURST_BANDS = dict({
  labial: band(600.0, 1200.0),
  alveolar: band(3500.0, 5000.0),
  velar: band(1500.0, 2500.0),
});

/** Plosive release burst length by place (s). */
export const BURST_LEN = dict({ labial: 0.005, alveolar: 0.006, velar: 0.009 });

/** The C# static class as one namespace object (Phones.VOWELS, Phones.phoneKind, ...). */
export const Phones = Object.freeze({
  VOWELS, DIPHTHONGS, VIDEO_VOWELS, VIDEO_MAP, VOWEL_INTRINSIC_DB, VOWEL_BW, F4_HZ, HIGHER_POLES,
  HIGHER_BW, NASAL_HIGHER_BW, CONSONANTS, SONORANT_KINDS, OBSTRUENT_KINDS, GLIDE_TARGETS,
  GLIDE_GAIN_DB, NASAL_TARGETS, NASAL_BW, CLOSED_TARGET, FRICATIVE_BANDS, FRICATIVE_LEVEL_DB,
  VOICED_BUZZ_DB, BURST_BANDS, BURST_LEN, phoneKind, phoneVoiced, phonePlace,
});
