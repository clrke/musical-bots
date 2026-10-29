// US English pronunciation for the voice (port of Magna.Core Voice/Text/Pronunciation.cs; new
// in this copy, not in upstream magna-vocalization, whose analysis is the letter rules only).
//
// A word found in the CMU Pronouncing Dictionary (cmudict.js) gets the dictionary's phones
// (ARPAbet mapped onto the engine's phones: enginePhone) and primary stress; a word it does not
// have keeps the letter-to-sound rules (spelling.js, lexicon.js). The text analysis (analyze.js)
// asks here for every word, so the sung syllables (syllabify(): a line's note count and the split
// of its words in the lyrics) and the phones the singer sings always agree.
//
// Variants ("hours" AW1 ER0 Z / AW1 R Z): one with as many syllables as the rules count (or as a
// manual split has pieces) is taken, so a line keeps its notes; when no variant has that many,
// the rules miscounted ("lovely" 3, "rhythm" 1) and the dictionary's first variant wins. The
// phones are put on the word's letters (for the lyric split and the typewriter timing) by
// aligning them with the rules' phones, whose letter spans are known.
import { DIPHTHONGS, phoneKind, phonePlace, VOWELS } from '../phones.js';
import { find as dictFind } from './cmudict.js';
import { EXCEPTIONS, FUNCTION_WORDS } from './lexicon.js';
import { spell } from './spelling.js';
import { syllabify } from './syllables.js';

let dictionaryOn = true;

/**
 * Look words up in the dictionary (default true). false: the letter-to-sound rules only, the
 * reference behaviour of upstream magna-vocalization (and of its goldens). Global: set it before
 * analysing / rendering.
 */
export function useDictionary(on) {
  if (on !== undefined) dictionaryOn = Boolean(on);
  return dictionaryOn;
}

// ------------------------------------------------------------------ ARPAbet -> engine phones
const ARPABET = Object.freeze({
  AA: 'ah', AE: 'ae', AH: 'uh', AO: 'aw', AW: 'ah-oo', AY: 'ah-ee',
  EH: 'eh', ER: 'er', EY: 'eh-ee', IH: 'ih', IY: 'ee', OW: 'oh',
  OY: 'oh-ee', UH: 'uu', UW: 'oo',
  B: 'b', CH: 'ch', D: 'd', DH: 'dh', F: 'f', G: 'g', HH: 'h',
  JH: 'j', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p',
  R: 'r', S: 's', SH: 'sh', T: 't', TH: 'th', V: 'v', W: 'w',
  Y: 'y', Z: 'z', ZH: 'zh',
});
const ARPABET_VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

const digitOf = (a) => {
  const last = a.charCodeAt(a.length - 1);
  return last >= 48 && last <= 50 ? last - 48 : -1;
};

/**
 * The engine phone of an ARPAbet phone ("AH0", "T"); next = the ARPAbet phone after it, or null.
 * Unstressed AH is the reduced "schwa" (today T AH0 D EY1), stressed AH is "uh"; AO before R is
 * "oh" ("for", "more", as the rules say it), else "aw"; the rest map one to one.
 * @param {string} arpabet
 * @param {string|null} [next]
 * @returns {string}
 */
export function enginePhone(arpabet, next = null) {
  if (!arpabet) throw new Error('no phone');
  const d = digitOf(arpabet);
  const bas = d >= 0 ? arpabet.slice(0, -1) : arpabet;
  if (!Object.hasOwn(ARPABET, bas)) throw new Error(`not an ARPAbet phone: ${arpabet}`);
  if (bas === 'AH' && d === 0) return 'schwa';
  if (bas === 'AO' && next === 'R') return 'oh';
  return ARPABET[bas];
}

const isSonorant = (sym) => {
  const k = phoneKind(sym);
  return k === 'nasal' || k === 'liquid';
};

function ruleNuclei(spelled) {
  let n = 0;
  for (const s of syllabify(spelled.map((p) => p.sym)).sylls) if (s.nucleus >= 0) n++;
  return n;
}

/** Sung syllables of a dictionary variant: its vowels (a vowel-less word sings a nasal or liquid). */
function variantNuclei(variant) {
  let vowels = 0;
  let sonorant = false;
  for (const a of variant) {
    if (digitOf(a) >= 0) vowels++;
    else if (isSonorant(enginePhone(a))) sonorant = true;
  }
  return vowels > 0 ? vowels : sonorant ? 1 : 0;
}

/**
 * The engine phones of a dictionary variant, its stressed vowel (the primary stress: the last
 * one where the dictionary marks several, "d n a"; else the first secondary; else -1) and the
 * stress digit of every phone (-1 a consonant).
 */
function variantPhones(variant) {
  const syms = [];
  const lexical = [];
  let primary = -1;
  let secondary = -1;
  for (let i = 0; i < variant.length; i++) {
    const a = variant[i];
    syms.push(enginePhone(a, i + 1 < variant.length ? variant[i + 1] : null));
    const st = digitOf(a);
    lexical.push(st);
    if (st === 1) primary = syms.length - 1;
    else if (st === 2 && secondary < 0) secondary = syms.length - 1;
  }
  return { syms, lexical, stressed: primary >= 0 ? primary : secondary };
}

/**
 * The engine phones of an ARPAbet pronunciation ("W IH1 N D": a heteronym's sense), as for a
 * dictionary variant; null when it is not ARPAbet with a stress digit on every vowel.
 * @param {string} arpabet
 * @returns {{syms:string[], lexical:number[], stressed:number}|null}
 */
export function arpabetPhones(arpabet) {
  const parts = String(arpabet ?? '').split(' ').filter((x) => x.length > 0).map((x) => x.toUpperCase());
  if (parts.length === 0) return null;
  for (const a of parts) {
    const d = digitOf(a);
    const bas = d >= 0 ? a.slice(0, -1) : a;
    if (!Object.hasOwn(ARPABET, bas) || ARPABET_VOWELS.has(bas) !== d >= 0) return null;
  }
  return variantPhones(parts);
}

/**
 * The phones of one word.
 * @param {string} text the word as written (apostrophes kept: "one's")
 * @param {string} letters its letters, lower case
 * @param {number} pieces pieces of a manual split covering it (0: none)
 * @param {string|null} [arpabet] a heteronym's sense ("W IH1 N D"): these phones in place of the
 *   dictionary's (with the dictionary on, when they parse and a manual split, if any, has as many
 *   pieces as they have vowels)
 * @returns {{phones: Array<{sym:string, a:number, b:number}>, stressed:number, lexical:number[]|null,
 *   fromDictionary:boolean}} stressed: phone index of the dictionary's stressed vowel, or -1;
 *   lexical: per phone the dictionary's stress digit (-1 a consonant), null from the rules.
 *
 * Among the variants with the syllable count wanted, a word takes the dictionary's first (its
 * usual US form), except a function word ("the", "and") or a word of the hand-made lexicon
 * (EXCEPTIONS: "live" the verb): the one closest to the hand-made phones, which sing the strong
 * forms ("dh uh", "ae n d"; "a" stays a schwa).
 */
export function wordPhones(text, letters, pieces, arpabet = null) {
  const rules = spell(letters);
  const result = { phones: rules, stressed: -1, lexical: null, fromDictionary: false };
  if (dictionaryOn && arpabet != null) {
    const own = arpabetPhones(arpabet);
    if (own) {
      const nuclei = own.lexical.filter((x) => x >= 0).length;
      if (pieces <= 0 || nuclei === pieces) {
        const m = new Array(own.syms.length);
        alignment(own.syms, rules, m);
        result.phones = spans(own.syms, rules, m, letters);
        ownLetters(result.phones, letters.length);
        result.stressed = own.stressed;
        result.lexical = own.lexical;
        result.fromDictionary = true;
        return result;
      }
    }
  }
  if (!dictionaryOn) return result;
  const variants = dictFind(text);
  if (!variants || variants.length === 0) return result;
  const target = pieces > 0 ? pieces : ruleNuclei(rules);
  const handMade = FUNCTION_WORDS.has(letters) || Object.hasOwn(EXCEPTIONS, letters);
  let chosen = -1;
  let bestCost = Infinity;
  for (let v = 0; v < variants.length; v++) {
    if (variantNuclei(variants[v]) !== target) continue;
    if (!handMade) {
      chosen = v;
      break;
    }
    const c = alignment(variantPhones(variants[v]).syms, rules, null);
    if (c < bestCost) {
      bestCost = c;
      chosen = v;
    }
  }
  const { syms, lexical, stressed } = variantPhones(variants[chosen >= 0 ? chosen : 0]);
  const match = new Array(syms.length);
  alignment(syms, rules, match);
  result.phones = spans(syms, rules, match, letters);
  ownLetters(result.phones, letters.length);
  result.stressed = stressed;
  result.lexical = lexical;
  result.fromDictionary = true;
  return result;
}

/**
 * Every sung syllable starts on a letter of its own where the word has letters enough, so the
 * lyric split (syllables.js sungSyllables) has no empty piece: letter names ("dna" D IY1 EH1 N
 * EY1: d-n-a), a vowel the rules had no letter for.
 */
function ownLetters(phones, nLetters) {
  const syms = phones.map((p) => p.sym);
  let prev = 0; // the first sung syllable's piece starts at the word
  let first = true;
  for (const { onset, nucleus } of syllabify(syms, true).sylls) {
    if (nucleus < 0) continue;
    const f = onset.length > 0 ? onset[0] : nucleus;
    if (first) {
      first = false;
      continue;
    }
    let a = phones[f].a;
    if (a <= prev && prev + 1 < nLetters) {
      a = prev + 1;
      for (let k = f; k < phones.length; k++) {
        const p = phones[k];
        if (p.a >= a) break;
        phones[k] = { sym: p.sym, a, b: Math.max(p.b, a + 1) };
      }
    }
    prev = Math.max(a, phones[f].a);
  }
}

/**
 * A dictionary word's syllables, fixed for "n't": the consonant before a syllabic n (a schwa on
 * the n's letter) ends the syllable before ("couldn't" K UH1 D AH0 N T: could-n't). In place.
 * @param {string} text the word as written
 * @param {Array<{sym:string, a:number, b:number}>} phones
 * @param {Array<{onset:number[], nucleus:number, coda:number[]}>} sylls
 */
export function contraction(text, phones, sylls) {
  const n = text.length;
  if (n < 4 || sylls.length < 2 || (text[n - 2] !== "'" && text[n - 2] !== '’') || text[n - 3].toLowerCase() !== 'n'
    || text[n - 1].toLowerCase() !== 't') return;
  const last = sylls[sylls.length - 1];
  const prev = sylls[sylls.length - 2];
  const v = last.nucleus;
  if (v < 0 || prev.nucleus < 0 || last.onset.length !== 1 || phones[v].sym !== 'schwa' || v + 1 >= phones.length
    || phones[v + 1].sym !== 'n' || phones[v + 1].a !== phones[v].a) return;
  prev.coda.push(last.onset[0]);
  last.onset.length = 0;
}

// ------------------------------------------------------------------ phones -> letters
const INSERT = 4;
const DELETE = 4;

const isVowel = (sym) => Object.hasOwn(VOWELS, sym) || Object.hasOwn(DIPHTHONGS, sym);

/** Cost of reading rule phone b as dictionary phone a. */
function substitute(a, va, b, vb) {
  if (a === b) return 0;
  if (va && vb) return 2;
  if (!va && !vb) return phonePlace(a) === phonePlace(b) || phoneKind(a) === phoneKind(b) ? 2 : 3;
  if ((va && b === 'y') || (a === 'er' && b === 'r') || (a === 'r' && b === 'er')) return 3;
  return 9; // a vowel for any other consonant: never better than one phone on each side
}

/**
 * The minimum-cost alignment of the dictionary's phones d with the rules' phones r: its cost,
 * and (if match is given) the rule phone of each dictionary phone (-1: none).
 * @param {string[]} d
 * @param {Array<{sym:string}>} r
 * @param {number[]|null} match
 */
function alignment(d, r, match) {
  const P = d.length;
  const R = r.length;
  const W = R + 1;
  const dv = d.map(isVowel);
  const rv = r.map((p) => isVowel(p.sym));
  const cost = new Int32Array((P + 1) * W);
  const move = new Uint8Array((P + 1) * W); // 0 both, 1 dictionary phone only, 2 rule phone only
  for (let i = 0; i <= P; i++) {
    for (let j = 0; j <= R; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let mv = 0;
      if (i > 0 && j > 0) {
        best = cost[(i - 1) * W + j - 1] + substitute(d[i - 1], dv[i - 1], r[j - 1].sym, rv[j - 1]);
        mv = 0;
      }
      if (j > 0 && cost[i * W + j - 1] + DELETE < best) {
        best = cost[i * W + j - 1] + DELETE;
        mv = 2;
      }
      if (i > 0 && cost[(i - 1) * W + j] + INSERT < best) {
        best = cost[(i - 1) * W + j] + INSERT;
        mv = 1;
      }
      cost[i * W + j] = best;
      move[i * W + j] = mv;
    }
  }
  if (match == null) return cost[P * W + R];
  for (let i = 0; i < P; i++) match[i] = -1;
  for (let i = P, j = R; i > 0 || j > 0;) {
    const mv = move[i * W + j];
    if (mv === 0) match[--i] = --j;
    else if (mv === 1) i--;
    else j--;
  }
  return cost[P * W + R];
}

const isVowelLetter = (c) => c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' || c === 'y';

/** A letter that sounds as a vowel here (a y before a vowel letter is a consonant: "beyond"). */
const vowelAt = (letters, k) => isVowelLetter(letters[k])
  && !(letters[k] === 'y' && k + 1 < letters.length && isVowelLetter(letters[k + 1]));

/** The y / w that ends the spelling of a vowel gliding to it (play-ing, glow-ing, draw-ing). */
const glides = (vowel, letter) => (letter === 'y'
  ? vowel === 'eh-ee' || vowel === 'ah-ee' || vowel === 'oh-ee'
  : letter === 'w' && (vowel === 'oh' || vowel === 'ah-oo' || vowel === 'oo' || vowel === 'aw'));

/** Letters that can spell each consonant ("music": u spells the Y of Y UW; "one": o the W). */
const SPELLED_BY = Object.freeze({
  b: 'b', ch: 'ct', d: 'd', dh: 't', f: 'fpg', g: 'gx', h: 'hwj',
  j: 'jgd', k: 'kcqx', l: 'l', m: 'm', n: 'n', ng: 'n', p: 'p',
  r: 'r', s: 'scxz', sh: 'sctx', t: 'td', th: 't', v: 'vfw', w: 'wuo',
  y: 'yiuej', z: 'zsx', zh: 'sgzt',
});
const spelledBy = (sym) => (Object.hasOwn(SPELLED_BY, sym) ? SPELLED_BY[sym] : null);

/**
 * Letter spans for the dictionary's phones d, aligned (match) with the rules' phones r (see the
 * C# Pronunciation.Spans for the rules: aligned phones take their rule phone's letters; extra
 * phones take silent letters between their neighbours, else share a neighbour's; consonants move
 * to a letter that can spell them; two vowels on one spelling split it).
 */
function spans(d, r, match, letters) {
  const P = d.length;
  const nLetters = letters.length;
  const dv = d.map(isVowel);
  const A = new Array(P).fill(0);
  const B = new Array(P).fill(0);
  const has = new Array(P).fill(false);
  let any = false;
  for (let i = 0; i < P; i++) {
    if (match[i] < 0) continue;
    A[i] = r[match[i]].a;
    B[i] = r[match[i]].b;
    has[i] = any = true;
  }
  for (let i = 0; i < P;) {
    if (has[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < P && !has[end]) end++;
    const by0 = spelledBy(d[i]);
    if (any && i > 0 && !dv[i] && B[i - 1] - A[i - 1] >= 2 && by0 !== null && by0.includes(letters[B[i - 1] - 1])) {
      // an extra consonant spelled by the last letter of the phone before ("language": ng = NG G)
      A[i] = B[i - 1] - 1;
      B[i] = B[i - 1];
      B[i - 1] = A[i];
      if (++i === end) continue;
    }
    // a run of extra phones [i, end): the letters between their aligned neighbours, if the rules
    // left any silent, else as below; nothing aligned at all: all the letters
    const gapA = !any || i === 0 ? 0 : B[i - 1];
    const gapB = !any || end === P ? nLetters : A[end];
    let fits = !any;
    for (let k = i; k < end && !fits; k++) {
      for (let q = gapA; q < gapB && !fits; q++) {
        const sp = spelledBy(d[k]);
        fits = dv[k] ? isVowelLetter(letters[q]) : sp !== null && sp.includes(letters[q]);
      }
    }
    if (gapB > gapA && fits) {
      const m = end - i;
      const g = gapB - gapA;
      for (let k = 0; k < m; k++) {
        A[i + k] = gapA + Math.floor((k * g) / m);
        B[i + k] = Math.max(A[i + k] + 1, gapA + Math.floor(((k + 1) * g) / m));
      }
    } else {
      for (let k = i; k < end; k++) {
        if (dv[k] && k > 0 && dv[k - 1] && B[k - 1] - A[k - 1] >= 2) {
          A[k] = B[k - 1] - 1;
          B[k] = B[k - 1];
          B[k - 1] = A[k];
          continue;
        }
        const from = end < P ? end : k - 1;
        A[k] = A[from];
        B[k] = B[from];
      }
    }
    i = end;
  }
  for (let i = 0; i < P; i++) {
    // a consonant on letters that cannot spell it: the nearest letter that can, after the
    // previous phone's letters, up to the next one's first
    const by = spelledBy(d[i]);
    if (dv[i] || by === null) continue;
    let ok = false;
    for (let k = A[i]; k < B[i] && !ok; k++) ok = by.includes(letters[k]);
    if (ok) continue;
    const lo = i > 0 ? B[i - 1] : 0;
    const hi = i + 1 < P ? Math.min(A[i + 1] + 1, nLetters) : nLetters;
    let best = -1;
    for (let k = lo; k < hi; k++) {
      if (by.includes(letters[k]) && (best < 0 || Math.abs(k - A[i]) < Math.abs(best - A[i]))) best = k;
    }
    if (best < 0) continue;
    A[i] = best;
    B[i] = best + 1;
  }
  for (let i = 1; i < P; i++) {
    if (!dv[i] || !dv[i - 1]) continue;
    if (A[i] === A[i - 1] && B[i] === B[i - 1] && B[i] - A[i] >= 2) {
      // two vowels on one vowel spelling ("science": ie = AY1 AH0): the second takes its last letter
      A[i] = B[i] - 1;
      B[i - 1] = A[i];
      continue;
    }
    let a = A[i];
    while (a > B[i - 1] && a > 0 && !vowelAt(letters, a - 1) && !glides(d[i - 1], letters[a - 1])) a--;
    A[i] = a;
  }
  const out = [];
  let lastA = 0;
  for (let i = 0; i < P; i++) {
    const a = Math.min(Math.max(A[i], lastA), nLetters - 1);
    const b = Math.min(Math.max(B[i], a + 1), nLetters);
    out.push({ sym: d[i], a, b });
    lastA = a;
  }
  return out;
}
