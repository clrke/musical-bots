// Syllabification and word stress (port of csharp/Mumble/Text/Syllables.cs, mumble/text.py).
// Changed in this copy (vs upstream magna-vocalization): syllabify(syms, dictionary) takes the
// Magna.Core flag for the pronunciation dictionary's phones (a few more / fewer onsets).
import { phoneKind } from '../phones.js';
import { LEGAL_ONSETS, STRESS_EXCEPTIONS } from './lexicon.js';
import { VOWEL_LETTERS } from './spelling.js';

/**
 * @typedef {{onset:number[], nucleus:number, coda:number[]}} SyllableSplit
 *   word-local phone indices; nucleus -1 = none
 */

/** Onsets the dictionary's phones have and the rules never make ("argue" G Y UW: ar-gue). */
const DICTIONARY_ONSETS = new Set(['g|y', 's|k|y', 's|p|y']);
/** Onsets the dictionary's words split instead (only "sphere" words start a syllable with them: peace-ful). */
const DICTIONARY_NOT_ONSETS = new Set(['s|f']);

function legalOnset(cluster, dictionary) {
  if (cluster.length === 0) return true;
  if (cluster.length === 1) return cluster[0] !== 'ng';
  const key = cluster.join('|');
  if (!dictionary) return LEGAL_ONSETS.has(key);
  return (LEGAL_ONSETS.has(key) && !DICTIONARY_NOT_ONSETS.has(key)) || DICTIONARY_ONSETS.has(key);
}

function range(a, b) {
  const r = [];
  for (let k = a; k < b; k++) r.push(k);
  return r;
}

/**
 * Split a word's phones into (onset, nucleus, coda) index groups. nucleus -1 = none.
 * syllabic = index of the nasal / liquid promoted to a nucleus in vowel-less words
 * ("hmm", "hmph"), else -1. dictionary: the phones are the pronunciation dictionary's (a few
 * more onsets, Magna.Core).
 * @param {string[]} syms
 * @param {boolean} [dictionary]
 * @returns {{sylls: SyllableSplit[], syllabic: number}}
 */
export function syllabify(syms, dictionary = false) {
  const kinds = syms.map(phoneKind);
  const nuclei = [];
  for (let k = 0; k < kinds.length; k++) if (kinds[k] === 'vowel') nuclei.push(k);
  let syllabic = -1;
  if (nuclei.length === 0) {
    for (const want of ['nasal', 'liquid']) {
      const cand = kinds.indexOf(want);
      if (cand >= 0) {
        nuclei.push(cand);
        syllabic = cand;
        break;
      }
    }
  }
  const sylls = [];
  if (nuclei.length === 0) {
    sylls.push({ onset: range(0, syms.length), nucleus: -1, coda: [] });
    return { sylls, syllabic: -1 };
  }
  let onset = range(0, nuclei[0]);
  for (let q = 0; q + 1 < nuclei.length; q++) {
    const a = nuclei[q];
    const b = nuclei[q + 1];
    const cluster = range(a + 1, b);
    let split = cluster.length;
    for (let k = 0; k <= cluster.length; k++) {
      const tail = [];
      for (let x = k; x < cluster.length; x++) tail.push(syms[cluster[x]]);
      if (legalOnset(tail, dictionary)) {
        split = k;
        break;
      }
    }
    sylls.push({ onset, nucleus: a, coda: cluster.slice(0, split) });
    onset = cluster.slice(split);
  }
  const lastNuc = nuclei[nuclei.length - 1];
  sylls.push({ onset, nucleus: lastNuc, coda: range(lastNuc + 1, syms.length) });
  return { sylls, syllabic };
}

// ------------------------------------------------------------------ stress
/** Unstressed spelling prefixes (when they are a whole open first syllable). */
export const WEAK_PREFIXES = Object.freeze(['be', 'de', 're', 'pre']);

/** Suffix -> how many syllables from the end carry the stress (ordered). */
export const SUFFIX_STRESS = Object.freeze([
  ['ical', 3], ['ity', 3], ['ety', 3], ['tion', 2], ['sion', 2],
  ['cian', 2], ['tious', 2], ['cious', 2], ['ic', 2], ['ics', 2],
  ['eer', 1], ['oon', 1], ['ique', 1], ['ese', 1], ['ette', 1],
].map(([suffix, back]) => Object.freeze({ suffix, back })));

const NEVER_STRESSED = ['schwa', 'er'];

/**
 * Index of the primary-stressed syllable of a content word, or -1 (Python None).
 * @param {string} letters the word's letters, lower case
 * @param {Array<{sym:string|null, head:string}>} sylls nucleus symbol (null = none) and the
 *   word's letters up to the end of that nucleus
 * @returns {number}
 */
export function wordStress(letters, sylls) {
  const n = sylls.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  if (Object.hasOwn(STRESS_EXCEPTIONS, letters)) return Math.min(STRESS_EXCEPTIONS[letters], n) - 1;
  const full = [];
  for (let k = 0; k < n; k++) {
    const sym = sylls[k].sym;
    if (sym !== null && sym !== undefined && !NEVER_STRESSED.includes(sym)) full.push(k);
  }
  for (const { suffix, back } of SUFFIX_STRESS) {
    if (letters.endsWith(suffix) && n >= back) return n - back;
  }
  if (full.length === 0) return 0;
  let first = full[0];
  if (first === 0 && full.length > 1) {
    const head = sylls[0].head;
    const nxt = letters.slice(head.length, head.length + 2);
    const doubled = nxt.length === 2 && nxt[0] === nxt[1];
    if (WEAK_PREFIXES.includes(head) && nxt.length > 0 && !(VOWEL_LETTERS + 'y').includes(nxt[0]) && !doubled) {
      first = full[1];
    }
  }
  return first;
}
