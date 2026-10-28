// Manual hyphenation for singing (JS extension, no C# / Python counterpart).
//
// A manual hyphenation ("I be-lieve in you") forces the syllables of the words it covers:
// every hyphen piece becomes exactly one syllable with a nucleus, i.e. one voiced unit, i.e.
// one sung note. Words are matched by their letters (case, apostrophes and punctuation
// ignored); words the hyphenation does not cover (or misspells) keep the automatic
// syllables, so a partial hyphenation ("be-lieve") works too.
//
// Forcing a word:
//   * a phone goes to the piece of its first letter (vowels) or last letter (consonants), so a
//     consonant split by the hyphen ("hel-lo", "hap-py") starts the next note, as sung;
//   * a piece with several vowels keeps one as its nucleus (the stressed one, else the first
//     full vowel) and drops the others ("every" as one note);
//   * a piece with no vowel promotes its first nasal / liquid to a syllabic nucleus
//     ("fi-re", "rhy-thm"), else gets a short schwa ("it-s").
// A word with one piece keeps its automatic analysis unless that has several syllables, so
// unpronounceable words ("Shh", "psst") stay unsung as in the automatic analysis.
import { phoneKind } from '../phones.js';
import { spell } from './spelling.js';
import { syllabify, wordStress } from './syllables.js';

/** Characters that split pieces inside a token. */
export const HYPHENS = '-‐‑­·‧–—';

const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/**
 * Manual hyphenation -> tokens, each a list of lower-case letter pieces. Whitespace and other
 * punctuation separate tokens; hyphen-like characters separate pieces; apostrophes are ignored.
 * @param {string|null|undefined} manual
 * @returns {string[][]}
 */
export function parseManual(manual) {
  const tokens = [];
  if (typeof manual !== 'string' || !manual) return tokens;
  let pieces = [];
  let cur = '';
  const endPiece = () => {
    if (cur) pieces.push(cur);
    cur = '';
  };
  const endToken = () => {
    endPiece();
    if (pieces.length) tokens.push(pieces);
    pieces = [];
  };
  for (const ch of manual) {
    if (isLetter(ch)) cur += ch.toLowerCase();
    else if (HYPHENS.includes(ch)) endPiece();
    else if (ch === "'" || ch === '’') continue;
    else endToken();
  }
  endToken();
  return tokens;
}

/** Words i.. and tokens j.. with equal letters: { i1, j1 } (exclusive ends) or null. */
function matchAt(words, tokens, i, j) {
  let a = words[i];
  let b = tokens[j].join('');
  let i1 = i + 1;
  let j1 = j + 1;
  while (a !== b) {
    if (a.length < b.length) {
      if (!b.startsWith(a) || i1 >= words.length) return null;
      a += words[i1++];
    } else {
      if (!a.startsWith(b) || j1 >= tokens.length) return null;
      b += tokens[j1++].join('');
    }
  }
  return { i1, j1 };
}

/**
 * Align manual tokens with the line's words.
 * @param {string[]} words lower-case letters of every word of the line
 * @param {string[][]} tokens from {@link parseManual}
 * @returns {Map<number, number[]>} covered word index -> split positions (letter indices,
 *   0 < p < word length, ascending); an empty list means "one piece"
 */
export function alignManual(words, tokens) {
  const out = new Map();
  let i = 0;
  let j = 0;
  while (i < words.length && j < tokens.length) {
    const m = matchAt(words, tokens, i, j);
    if (!m) {
      // skip the word if this token belongs to a later word, else skip the token
      let later = false;
      for (let k = i + 1; k < words.length && !later; k++) later = matchAt(words, tokens, k, j) !== null;
      if (later) i++;
      else j++;
      continue;
    }
    // piece starts in the concatenated letters, mapped onto the covered words
    const cuts = new Set();
    let pos = 0;
    for (let t = j; t < m.j1; t++) {
      for (const piece of tokens[t]) {
        if (pos > 0) cuts.add(pos);
        pos += piece.length;
      }
    }
    let start = 0;
    for (let w = i; w < m.i1; w++) {
      const len = words[w].length;
      const splits = [];
      for (let p = start + 1; p < start + len; p++) if (cuts.has(p)) splits.push(p - start);
      out.set(w, splits);
      start += len;
    }
    i = m.i1;
    j = m.j1;
  }
  return out;
}

function range(a, b) {
  const r = [];
  for (let k = a; k < b; k++) r.push(k);
  return r;
}

/**
 * Phones and syllables of one word with forced pieces.
 * @param {string} letters the word's letters, lower case
 * @param {number[]} splits piece boundaries (letter indices, ascending)
 * @returns {{spelled: Array<{sym:string, a:number, b:number}>,
 *   sylls: Array<{onset:number[], nucleus:number, coda:number[]}>, syllabic: number[]} | null}
 *   null = keep the automatic analysis
 */
export function forceSyllables(letters, splits) {
  const spelled = spell(letters);
  const auto = syllabify(spelled.map((p) => p.sym));
  let autoVoiced = 0;
  for (const s of auto.sylls) if (s.nucleus >= 0) autoVoiced++;
  const nPieces = splits.length + 1;
  if (nPieces === 1 && autoVoiced <= 1) return null;

  const bounds = [0, ...splits, letters.length];
  const pieceOf = (x) => {
    let p = 0;
    while (p < nPieces - 1 && x >= bounds[p + 1]) p++;
    return p;
  };
  const isVowel = (k) => phoneKind(spelled[k].sym) === 'vowel';

  // the automatic stressed nucleus wins when a piece merges several vowels
  const info = auto.sylls.map((s) => (s.nucleus < 0 ? { sym: null, head: '' }
    : { sym: spelled[s.nucleus].sym, head: letters.slice(0, spelled[s.nucleus].b) }));
  const ks = wordStress(letters, info);
  const stressedNuc = ks >= 0 ? auto.sylls[ks].nucleus : -1;

  const byPiece = Array.from({ length: nPieces }, () => []);
  let lastPiece = 0;
  for (let k = 0; k < spelled.length; k++) {
    const p = spelled[k];
    const piece = Math.max(lastPiece, pieceOf(isVowel(k) ? p.a : p.b - 1));
    byPiece[piece].push(k);
    lastPiece = piece;
  }

  const outPh = [];
  const sylls = [];
  const syllabic = [];
  for (let q = 0; q < nPieces; q++) {
    let idx = byPiece[q];
    const vowels = idx.filter(isVowel);
    let nuc = -1;
    let promoted = false;
    let schwaAt = -1;
    if (vowels.length > 0) {
      let keep = vowels[0];
      if (vowels.length > 1) {
        if (vowels.includes(stressedNuc)) keep = stressedNuc;
        else keep = vowels.find((k) => spelled[k].sym !== 'schwa' && spelled[k].sym !== 'er') ?? vowels[0];
      }
      idx = idx.filter((k) => k === keep || !isVowel(k));
      nuc = idx.indexOf(keep);
    } else {
      for (const want of ['nasal', 'liquid']) {
        nuc = idx.findIndex((k) => phoneKind(spelled[k].sym) === want);
        if (nuc >= 0) break;
      }
      if (nuc >= 0) promoted = true;
      else schwaAt = idx.length > 0 ? spelled[idx[idx.length - 1]].a : bounds[q];
    }
    const base = outPh.length;
    for (const k of idx) outPh.push({ sym: spelled[k].sym, a: spelled[k].a, b: spelled[k].b });
    if (schwaAt >= 0) {
      outPh.push({ sym: 'schwa', a: schwaAt, b: schwaAt + 1 });
      nuc = idx.length;
    }
    const n = outPh.length - base;
    sylls.push({ onset: range(base, base + nuc), nucleus: base + nuc, coda: range(base + nuc + 1, base + n) });
    if (promoted) syllabic.push(base + nuc);
  }
  return { spelled: outPh, sylls, syllabic };
}
