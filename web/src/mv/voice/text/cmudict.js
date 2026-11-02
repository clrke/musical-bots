// The CMU Pronouncing Dictionary (US English, ARPAbet phones with stress marks 0 / 1 / 2) for
// the singer (port of Magna.Core Voice/Text/CmuDict.cs; new in this copy, not in upstream
// magna-vocalization).
//
// The shipped table (cmudictData.js, built by ../../tools/build-cmudict.mjs) is a trimmed form:
// common English words, the app's names and lyric vocabulary, and only the words whose sung
// analysis differs from the letter-to-sound rules (a word the rules already get right sounds the
// same either way, so it is left out). Words it does not have keep the rules (Pronunciation.js).
// Decoded on first use, once (a Map from the word to its variants); a lookup is one Map get.
//
// Data format (cmudictData.js): DATA is the words in ordinal order, front-coded, one entry per line:
//   <shared prefix length><rest of the word> <variant>[ <variant>...]
// where the shared prefix length (with the word before) is one character of
// '0123456789abcdefghijklmnopqrstuvwxyz' (0..35) and a variant is one character per phone:
// ALPHABET[code] for SYMBOLS[code] (codes 0..68, the C# CmuDictData.Symbols order; printable ASCII
// without quotes, backslash, backtick or '$').
import { ALPHABET, DATA, SYMBOLS } from './cmudictData.js';

const CODE = new Int8Array(128).fill(-1);
for (let c = 0; c < ALPHABET.length; c++) CODE[ALPHABET.charCodeAt(c)] = c;

/** @type {Map<string, string>|null} word -> its variants (encoded, space separated) */
let table = null;
/** A replacement table installed by tools / tests (see useTable), or null. */
let custom = null;

function decode() {
  const t = new Map();
  let p = 0;
  let prev = '';
  const n = DATA.length;
  while (p < n) {
    let e = DATA.indexOf('\n', p);
    if (e < 0) e = n;
    if (e > p) {
      const sp = DATA.indexOf(' ', p);
      const shared = parseInt(DATA[p], 36);
      if (sp < 0 || sp >= e || !(shared <= prev.length)) throw new Error(`cmudict: bad entry at ${p}`);
      const word = prev.slice(0, shared) + DATA.slice(p + 1, sp);
      t.set(word, DATA.slice(sp + 1, e));
      prev = word;
    }
    p = e + 1;
  }
  return t;
}

function get() {
  if (custom) return custom;
  table ??= decode();
  return table;
}

/** A word as a lookup key: lower-case ASCII letters and apostrophes (’ = '), else null. */
export function keyOf(word) {
  if (typeof word !== 'string' || word.length === 0 || word.length > 120) return null;
  let k = '';
  for (const c of word) {
    let x = c;
    if (x >= 'A' && x <= 'Z') x = x.toLowerCase();
    else if (x === '’') x = "'";
    if (!((x >= 'a' && x <= 'z') || x === "'")) return null;
    k += x;
  }
  return k;
}

const decodeVariant = (s) => Array.from(s, (ch) => SYMBOLS[CODE[ch.charCodeAt(0)]]);

/**
 * The word's pronunciations in the dictionary's order, each an array of ARPAbet phones
 * (['T', 'AH0', 'D', 'EY1']); null if the table does not have it.
 * @param {string} word any case, ’ or '
 * @returns {string[][]|null}
 */
/** Entries the table gets wrong for this show (the company "Meta" is MEH-tuh, not MEE-tuh). */
export const OVERRIDES = new Map([['meta', 'M EH1 T AH0'],
  // the app's own word, as Americans say it (the table's AO, "bawt", was heard as "boss" / "box"; CMUdict: B AA1 T)
  ['bot', 'B AA1 T'], ['bots', 'B AA1 T S'],
  // words the director's dictionary check (scripts/director/craft.js) found the letter rules sing wrong
  ['hackathons', 'HH AE1 K AH0 TH AA2 N Z'], ['llama', 'L AA1 M AH0'], ['llamas', 'L AA1 M AH0 Z'],
  ['forgiving', 'F ER0 G IH1 V IH0 NG'], ['soften', 'S AO1 F AH0 N'], ['softens', 'S AO1 F AH0 N Z'],
  // the hero song's competitor, KOH-koh-MEL-uhn (the rules sang "kah-kah-MEH-lun"), and the filler songs' dinosaur
  ['cocomelon', 'K OW1 K OW0 M EH2 L AH0 N'], ['triceratops', 'T R AY0 S EH1 R AH0 T AA2 P S']]);

export function find(word) {
  const k = keyOf(word);
  if (k === null) return null;
  if (OVERRIDES.has(k)) return [OVERRIDES.get(k).split(' ')];
  const t = get();
  const v = t.get(k);
  if (v === undefined) return null;
  return Array.isArray(v) ? v.map((x) => x.slice()) : v.split(' ').map(decodeVariant);
}

/** True if the table has the word. */
export function has(word) {
  const k = keyOf(word);
  return k !== null && get().has(k);
}

/** The word's pronunciations as strings ("T AH0 D EY1"); empty if it has none (CmuDict.Lookup). */
export function lookup(word) {
  return (find(word) ?? []).map((v) => v.join(' '));
}

/** Words in the table (the shipped one unless a custom table is installed). */
export function size() {
  return get().size;
}

/**
 * Tools and tests: look words up in `entries` (Map or object, word -> array of variants, each an
 * array of ARPAbet phones or a "T AH0 D EY1" string) instead of the shipped table; null puts the
 * shipped table back.
 */
export function useTable(entries) {
  if (entries == null) {
    custom = null;
    return;
  }
  const m = new Map();
  const it = entries instanceof Map ? entries.entries() : Object.entries(entries);
  for (const [w, vs] of it) m.set(w, vs.map((v) => (Array.isArray(v) ? v : String(v).split(' '))));
  custom = m;
}

/** Decode the shipped table now (it is otherwise decoded by the first lookup). */
export function preload() {
  get();
}
