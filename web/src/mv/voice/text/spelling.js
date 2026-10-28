// Spelling -> sound heuristics (port of csharp/Mumble/Text/Spelling.cs, mumble/text.py spell()).
// Letters -> [{ sym, a, b }]: the phone and its first / one-past-last letter in the word.
// Characters are one-char strings; '' stands for "no character" (C# '\0', Python "").
import {
  CH_AS_K, CONS_DIGRAPHS, DH_WORDS, EI_EE, EXCEPTIONS, H_SILENT, HARD_G, NG_HARD, OW_OH,
  S_BETWEEN_VOWELS, SUFFIX_EXCEPTIONS, VOWEL_DIGRAPHS, WH_AS_H, Z_AFTER_VOWEL,
} from './lexicon.js';

/** Vowel letters. */
export const VOWEL_LETTERS = 'aeiou';

/**
 * @typedef {{sym:string, a:number, b:number}} SpelledPhone  phone with its letter span [a, b)
 */

// ------------------------------------------------------------------ python string helpers
/** Python `c in chars` for one (possibly absent) character; false for ''. */
function inS(c, chars) {
  return c !== '' && c !== undefined && chars.indexOf(c) >= 0;
}

/** Python s[i] if 0 <= i < len else ''. */
function at(s, i) {
  return i >= 0 && i < s.length ? s[i] : '';
}

function startsAny(s, ...ps) {
  for (const p of ps) if (s.startsWith(p)) return true;
  return false;
}

function eq(s, ...ps) {
  for (const p of ps) if (s === p) return true;
  return false;
}

// ------------------------------------------------------------------ vowel groups
function isVowelStart(w, i) {
  const c = w[i];
  const n = w.length;
  if (inS(c, VOWEL_LETTERS)) {
    if (c === 'u' && i > 0 && w[i - 1] === 'q') return false;
    if (c === 'u' && i > 0 && w[i - 1] === 'g' && i + 1 < n && inS(w[i + 1], 'aeiouy')) {
      return false; // guess, guide, league: silent u keeps the g hard
    }
    return true;
  }
  if (c === 'y') return !(i + 1 < n && inS(w[i + 1], VOWEL_LETTERS));
  return false;
}

function groupEnd(w, i) {
  const tri = w.slice(i, i + 3);
  if (eq(tri, 'eau', 'iew', 'ieu')) return i + 3;
  const di = w.slice(i, i + 2);
  if (di.length === 2 && VOWEL_DIGRAPHS.has(di)) {
    const after = w.slice(i + 2);
    if (inS(di[1], 'wy') && after.length > 0 && inS(after[0], VOWEL_LETTERS)) {
      // "away", "beyond": w/y starts the next syllable; "power", "player": digraph
      const joined = eq(after.slice(0, 2), 'er', 'el') || eq(after, 'e', 'ed', 'es');
      return joined ? i + 2 : i + 1;
    }
    if (eq(di, 'oi', 'ei') && after === 'ng') return i + 1; // going, doing, being
    return i + 2;
  }
  return i + 1;
}

/** @returns {Array<[number, number]>} vowel letter groups [a, b) */
function vowelGroups(w) {
  const groups = [];
  let i = 0;
  while (i < w.length) {
    if (isVowelStart(w, i)) {
      const j = groupEnd(w, i);
      groups.push([i, j]);
      i = j;
    } else i += 1;
  }
  return groups;
}

function sibilantBefore(w, i) {
  return (i >= 1 && inS(w[i - 1], 'sxzcg')) || eq(w.slice(Math.max(0, i - 2), i), 'ch', 'sh');
}

function magicLink(w, span, eIndex) {
  const a = span[0];
  const b = span[1];
  if (b - a !== 1 || !inS(w[a], 'aeiouy')) return false;
  const cons = w.slice(b, eIndex);
  if (cons.length === 1 && !inS(cons[0], VOWEL_LETTERS + 'wxy')) return true;
  if (CONS_DIGRAPHS.has(cons)) return true;
  return w[a] === 'a' && eq(cons, 'ng', 'st'); // change, taste
}

/** Group indices of silent e's (final e, and the e of -ed / -es endings). */
function silentEs(w, groups) {
  const silent = new Set();
  const ng = groups.length;
  for (let gi = 0; gi < ng; gi++) {
    const i = groups[gi][0];
    const j = groups[gi][1];
    if (w.slice(i, j) !== 'e' || ng < 2) continue;
    const after = w.slice(j);
    if (j === w.length) silent.add(gi);
    else if (after === 'd') {
      if (!inS(w[i - 1], 'td')) silent.add(gi); // asked, played (but wanted, needed)
    } else if (after === 's') {
      if (sibilantBefore(w, i)) continue; // boxes, wishes, pages
      if (gi >= 1 && magicLink(w, groups[gi - 1], i)) silent.add(gi); // makes, times
      else if (w[i - 1] === 'l' && i >= 2 && !inS(w[i - 2], 'aeiouy')) silent.add(gi); // tables
    }
  }
  return silent;
}

/** After index j: one consonant letter (or a doubled one) and then a vowel. */
function singleOnsetThenVowel(w, j) {
  const rest = w.slice(j);
  if (rest.length >= 2 && !inS(rest[0], VOWEL_LETTERS + 'y') && inS(rest[1], VOWEL_LETTERS)) return true;
  return rest.length >= 3 && rest[0] === rest[1] && !inS(rest[0], VOWEL_LETTERS) && inS(rest[2], VOWEL_LETTERS);
}

function unstressedFinal(w, j) {
  const rest = w.slice(j);
  return rest.length === 1 && inS(rest[0], 'nlm');
}

/**
 * Vowel sound of group gi -> [symbol or null if silent, end index].
 * @returns {[string|null, number]}
 */
function pickVowel(w, gi, groups, silent) {
  const i = groups[gi][0];
  const j = groups[gi][1];
  if (silent.has(gi)) return [null, j];
  const g = w.slice(i, j);
  const n = w.length;
  const ng = groups.length;
  const after = w.slice(j);
  const prevC = i > 0 ? w[i - 1] : '';
  const nc = at(after, 0);
  const first = gi === 0;
  const last = gi === ng - 1;
  const magic = silent.has(gi + 1) && magicLink(w, [i, j], groups[gi + 1][0]);
  const rClosed = nc === 'r' && (j + 1 === n || !inS(w[j + 1], 'aeiouy'));
  const unstressedR = !first && last && nc === 'r' && j + 1 === n;

  if (g === 'a') {
    if (magic) return [nc === 'r' ? 'eh' : 'eh-ee', j];
    if (unstressedR) return ['er', j + 1]; // dollar, sugar
    if (rClosed) return ['ah', j];
    if (startsAny(after, 'll', 'lk', 'lt')) return ['aw', j];
    if (after.startsWith('lm')) return ['ah', j]; // calm, palm
    if (prevC === 'w' || (prevC === 'u' && i >= 2 && w[i - 2] === 'q')) {
      if (nc !== 'k' && nc !== 'g' && nc !== 'x' && !after.startsWith('ng')) return ['ah', j]; // want, swan
    }
    if (j === n) return [ng > 1 ? 'schwa' : 'ah', j];
    if (first && i === 0 && ng > 1 && singleOnsetThenVowel(w, j)) return ['schwa', j]; // about
    if (!first && last && unstressedFinal(w, j)) return ['schwa', j]; // animal, human
    return ['ae', j];
  }
  if (g === 'e') {
    if (j === n) return ['ee', j]; // he, me, be
    if (magic) return ['ee', j];
    if (rClosed) return ['er', j + 1]; // her, sister
    if (eq(after, 'd', 's') && ng > 1) return ['ih', j]; // wanted, boxes
    if (first && ng > 1 && eq(w.slice(0, j), 'be', 'de', 're', 'pre', 'e') && singleOnsetThenVowel(w, j)) {
      return ['ih', j]; // because, begin, remember, eleven
    }
    if (!first && last && unstressedFinal(w, j)) return ['schwa', j]; // seven, garden
    if (inS(nc, VOWEL_LETTERS)) return ['ee', j]; // being, video
    return ['eh', j];
  }
  if (g === 'i') {
    if (magic) return ['ah-ee', j];
    if (rClosed) return ['er', j + 1]; // bird, first
    if (after.startsWith('gh') || eq(after, 'nd', 'ld')) return ['ah-ee', j]; // night, find
    if (j === n) return [ng === 1 ? 'ah-ee' : 'ee', j];
    if (inS(nc, VOWEL_LETTERS)) return [first ? 'ah-ee' : 'ee', j]; // lion / radio
    return ['ih', j];
  }
  if (g === 'o') {
    if (magic) return ['oh', j];
    if (unstressedR) return ['er', j + 1]; // doctor, color
    if (rClosed) return prevC === 'w' ? ['er', j + 1] : ['oh', j]; // word / for
    if (j === n) return ['oh', j];
    if (startsAny(after, 'ld', 'lt') || after === 'll') return ['oh', j];
    if (startsAny(after, 'ng', 'ff', 'ss', 'ft', 'th')) return ['aw', j];
    if (!first && last && unstressedFinal(w, j)) return ['schwa', j]; // person, lemon
    if (inS(nc, VOWEL_LETTERS)) return ['oh', j]; // going
    return ['ah', j];
  }
  if (g === 'u') {
    if (magic) return ['oo', j];
    if (unstressedR) return ['er', j + 1];
    if (rClosed) return ['er', j + 1]; // turn, hurt
    if ((prevC === 'p' || prevC === 'b' || prevC === 'f') && startsAny(after, 'll', 'sh')) {
      return ['uu', j]; // pull, full, push
    }
    if (j === n || inS(nc, VOWEL_LETTERS)) return ['oo', j];
    if (last && !first && eq(after, 's', 'l', 'm')) return ['schwa', j]; // bonus, careful
    return ['uh', j];
  }
  if (g === 'y') {
    if (magic) return ['ah-ee', j];
    if (j === n) return [ng === 1 ? 'ah-ee' : 'ee', j]; // my, try / happy
    return ['ih', j];
  }
  // ---- digraphs / trigraphs
  if (eq(g, 'ai', 'ay')) return [nc === 'r' ? 'eh' : 'eh-ee', j];
  if (eq(g, 'au', 'aw')) return ['aw', j];
  if (g === 'ea') {
    if (nc === 'r') {
      if (j + 1 < n && !inS(w[j + 1], 'aeiouy')) return ['er', j + 1]; // earth, learn
      return ['ee', j]; // hear, year
    }
    if (startsAny(after, 'd', 'th', 'lth', 'lt', 'su', 'ther', 'vy', 'vi', 'ven', 'nt')) {
      return ['eh', j]; // head, death, health, measure, heavy, meant
    }
    return ['ee', j];
  }
  if (g === 'ee') return ['ee', j];
  if (g === 'ei') {
    if (prevC === 'c' || EI_EE.has(w)) return ['ee', j];
    return ['eh-ee', j];
  }
  if (g === 'ey') return [j === n && ng > 1 ? 'ee' : 'eh-ee', j]; // money / hey, they
  if (eq(g, 'eu', 'ew', 'ue', 'ui', 'iew', 'ieu')) return ['oo', j];
  if (g === 'ie') {
    if (j === n) return [ng === 1 ? 'ah-ee' : 'ee', j]; // pie / movie
    if (eq(after, 'd', 's') && ng === 1) return ['ah-ee', j]; // tied, lies
    return ['ee', j];
  }
  if (eq(g, 'oa', 'oe', 'eau')) return ['oh', j];
  if (eq(g, 'oi', 'oy')) return ['oh-ee', j];
  if (g === 'oo') {
    if (nc === 'r') return ['oh', j]; // door, floor
    if (startsAny(after, 'k', 'd')) return ['uu', j]; // book, good
    return ['oo', j];
  }
  if (g === 'ou') {
    if (after.startsWith('ght')) return ['aw', j]; // bought
    if (after.startsWith('gh')) return ['oh', j]; // though
    if (after.startsWith('ld')) return ['uu', j]; // could
    if (last && !first && after === 's') return ['schwa', j]; // famous
    return ['ah-oo', j];
  }
  if (g === 'ow') {
    if (OW_OH.has(w) || (j === n && ng > 1)) return ['oh', j];
    return ['ah-oo', j];
  }
  if (g === 'uy') return ['ah-ee', j];
  return ['uh', j];
}

/** Voicing of a word-final s. */
function finalS(w, i, phones) {
  if (Z_AFTER_VOWEL.has(w)) return 'z';
  const prev = phones.length > 0 ? phones[phones.length - 1].sym : '';
  if (prev === 'ih' && i >= 1 && w[i - 1] === 'e') return sibilantBefore(w, i - 1) ? 'z' : 's'; // boxes vs Agnes
  if (eq(prev, 'b', 'd', 'g', 'l', 'm', 'n', 'ng', 'r', 'v', 'dh', 'j', 'w', 'y')) return 'z';
  if (i >= 2 && eq(w.slice(i - 2, i), 'ay', 'ey', 'oy', 'ee', 'oe', 'ue', 'ie', 'ew', 'ow', 'aw')) {
    return 'z'; // days, boys, trees
  }
  return 's';
}

/** @returns {[number, SpelledPhone[]]} */
function one(i, sym, length = 1) {
  return [i + length, [{ sym, a: i, b: i + length }]];
}

/** @returns {[number, SpelledPhone[]]} */
function silentL(i, length = 1) {
  return [i + length, []];
}

/** @returns {[number, SpelledPhone[]]} */
function two(next, a, b) {
  return [next, [a, b]];
}

/**
 * Consonant letter(s) at i -> [next index, phones].
 * @param {string} w
 * @param {number} i
 * @param {Map<number, number>} groupsAt vowel group start letter -> group index
 * @param {Set<number>} silentLetters
 * @param {SpelledPhone[]} phones phones so far
 * @returns {[number, SpelledPhone[]]}
 */
function consonant(w, i, groupsAt, silentLetters, phones) {
  const n = w.length;
  const c = w[i];
  const nxt = at(w, i + 1);
  const nxt2 = at(w, i + 2);
  const prev = i > 0 ? w[i - 1] : '';
  const isVowel = (k) => groupsAt.has(k);

  switch (c) {
    case 'b':
      if (nxt === 'b') return one(i, 'b', 2);
      if (prev === 'm' && i === n - 1) return silentL(i); // climb, lamb
      if (nxt === 't') return silentL(i); // debt, doubt
      return one(i, 'b');
    case 'c':
      if (nxt === 'h') {
        if ((i === 0 && nxt2 === 'r') || CH_AS_K.has(w)) return one(i, 'k', 2);
        return one(i, 'ch', 2);
      }
      if (nxt === 'k') return one(i, 'k', 2);
      if (nxt === 'c') {
        if (nxt2 === 'e' || nxt2 === 'i' || nxt2 === 'y') {
          return two(i + 2, { sym: 'k', a: i, b: i + 1 }, { sym: 's', a: i + 1, b: i + 2 }); // accept
        }
        return one(i, 'k', 2);
      }
      if (nxt === 'e' || nxt === 'i' || nxt === 'y') {
        if (prev === 's') return silentL(i); // scene: the s already covers it
        if (nxt === 'i' && (nxt2 === 'a' || nxt2 === 'o' || nxt2 === 'e') && i + 3 < n) {
          return one(i, 'sh', 2); // special, musician, ancient
        }
        return one(i, 's');
      }
      if (nxt === 'q') return silentL(i);
      return one(i, 'k');
    case 'd':
      if (nxt === 'd') return one(i, 'd', 2);
      if (nxt === 'g' && (nxt2 === 'e' || nxt2 === 'i' || nxt2 === 'y')) return one(i, 'j', 2); // edge
      if (i === n - 1 && prev === 'e' && silentLetters.has(i - 1)) {
        const before = phones.length > 0 ? phones[phones.length - 1].sym : '';
        if (eq(before, 'p', 'k', 'f', 's', 'sh', 'ch', 'th')) return one(i, 't'); // asked
      }
      return one(i, 'd');
    case 'f':
      return one(i, 'f', nxt === 'f' ? 2 : 1);
    case 'g':
      if (nxt === 'g') return one(i, 'g', 2);
      if (nxt === 'h') return i === 0 ? one(i, 'g', 2) : silentL(i, 2); // ghost / night
      if (nxt === 'n' && (i === 0 || i + 2 === n)) return silentL(i); // gnome, sign
      if (nxt === 'u' && inS(nxt2, 'aeiouy')) return one(i, 'g', 2); // guess, guide
      if ((nxt === 'e' || nxt === 'i' || nxt === 'y') && !HARD_G.has(w)) return one(i, 'j');
      return one(i, 'g');
    case 'h':
      if (i > 0 && inS(prev, VOWEL_LETTERS + 'y') && !(nxt !== '' && isVowel(i + 1))) {
        return silentL(i); // oh, ah, yeah
      }
      if (i === 0 && H_SILENT.has(w)) return silentL(i);
      if (i === 0 || (nxt !== '' && isVowel(i + 1)) || nxt === 'm' || nxt === 'n') return one(i, 'h');
      return silentL(i);
    case 'j':
      return one(i, 'j');
    case 'k':
      if (i === 0 && nxt === 'n') return silentL(i); // knight, know
      return one(i, 'k', nxt === 'k' ? 2 : 1);
    case 'l': {
      if (nxt === 'l') return one(i, 'l', 2);
      const tail = w.slice(i + 1);
      if (eq(tail, 'e', 'es', 'ed') && prev !== '' && !inS(prev, VOWEL_LETTERS + 'yl') && silentLetters.has(i + 1)) {
        return two(i + 1, { sym: 'schwa', a: i, b: i + 1 }, { sym: 'l', a: i, b: i + 1 }); // table, tables
      }
      if ((prev === 'a' || prev === 'o') && (nxt === 'k' || nxt === 'm')) return silentL(i); // talk
      if (prev === 'u' && i >= 2 && w[i - 2] === 'o' && nxt === 'd') return silentL(i); // could
      return one(i, 'l');
    }
    case 'm':
      return one(i, 'm', nxt === 'm' ? 2 : 1);
    case 'n':
      if (nxt === 'n') return one(i, 'n', 2);
      if (nxt === 'g') {
        if ((nxt2 === 'e' || nxt2 === 'y') && !NG_HARD.has(w)) return one(i, 'n'); // change
        if (NG_HARD.has(w)) return two(i + 2, { sym: 'ng', a: i, b: i + 1 }, { sym: 'g', a: i + 1, b: i + 2 });
        return one(i, 'ng', 2);
      }
      if (nxt === 'k') return one(i, 'ng'); // think, bank
      if (prev === 'm' && i === n - 1) return silentL(i); // autumn, hymn
      return one(i, 'n');
    case 'p':
      if (nxt === 'h') return one(i, 'f', 2);
      if (nxt === 'p') return one(i, 'p', 2);
      if (i === 0 && (nxt === 's' || nxt === 'n') && !(nxt2 === 's' || nxt2 === 't' || nxt2 === '')) {
        return silentL(i); // psychology, pneumonia
      }
      return one(i, 'p');
    case 'q':
      if (nxt === 'u') {
        if (w.slice(i + 2) === 'e') return [n, [{ sym: 'k', a: i, b: n }]]; // unique, antique
        return two(i + 2, { sym: 'k', a: i, b: i + 1 }, { sym: 'w', a: i + 1, b: i + 2 });
      }
      return one(i, 'k');
    case 'r':
      if (nxt === 'r' || nxt === 'h') return one(i, 'r', 2);
      return one(i, 'r');
    case 's': {
      if (nxt === 'h') return one(i, 'sh', 2);
      if (nxt === 's') {
        if (nxt2 === 'i' && i + 3 < n && (w[i + 3] === 'o' || w[i + 3] === 'a')) return one(i, 'sh', 3); // mission
        return one(i, 's', 2);
      }
      if (nxt === 'c' && (nxt2 === 'e' || nxt2 === 'i' || nxt2 === 'y')) return one(i, 's', 2); // scene
      const prevVowel = i > 0 && inS(prev, VOWEL_LETTERS);
      if (nxt === 'i' && (nxt2 === 'o' || nxt2 === 'a') && i + 3 < n) {
        return one(i, prevVowel ? 'zh' : 'sh', 2); // vision / mansion
      }
      if (nxt === 'u' && nxt2 === 'r' && w.slice(i + 3, i + 4) === 'e') {
        return one(i, prevVowel ? 'zh' : 'sh'); // measure / sure
      }
      if (nxt === 'u' && nxt2 === 'a' && w.slice(i + 3, i + 4) === 'l') return one(i, 'zh'); // usual
      if (i === n - 1) return one(i, finalS(w, i, phones));
      if (prevVowel && inS(nxt, VOWEL_LETTERS + 'y') && !S_BETWEEN_VOWELS.has(w)) {
        if (!(prev === 'u' && i >= 2 && inS(w[i - 2], 'oa'))) return one(i, 'z'); // rose, music
        return one(i, w.slice(i - 2, i) === 'au' ? 'z' : 's'); // house, cause
      }
      return one(i, 's');
    }
    case 't':
      if (nxt === 'h') {
        const voiced = DH_WORDS.has(w) || startsAny(w.slice(i), 'ther', 'thers')
          || (w.endsWith('the') && i === n - 3 && groupsAt.size > 1);
        return one(i, voiced ? 'dh' : 'th', 2);
      }
      if (nxt === 'c' && nxt2 === 'h') return silentL(i); // watch: "ch" follows
      if (nxt === 'i' && (((nxt2 === 'a' || nxt2 === 'o') && i + 3 < n && inS(w[i + 3], 'nlu'))
                          || w.slice(i + 2, i + 4) === 'en')) {
        return one(i, 'sh', 2); // nation, partial, patient
      }
      if (w.slice(i + 1, i + 4) === 'ure') return one(i, 'ch'); // nature, picture
      if (nxt === 't') return one(i, 't', 2);
      if (prev === 's' && eq(w.slice(i + 1), 'en', 'le')) return silentL(i); // listen, castle
      return one(i, 't');
    case 'v':
      return one(i, 'v');
    case 'w':
      if (i === 0 && nxt === 'r') return silentL(i); // write, wrong
      if (nxt === 'h') return one(i, WH_AS_H.has(w) ? 'h' : 'w', 2);
      if (nxt !== '' && (inS(nxt, VOWEL_LETTERS) || nxt === 'y' || isVowel(i + 1))) return one(i, 'w');
      return silentL(i);
    case 'x':
      if (i === 0) return one(i, 'z');
      if (i === 1 && prev === 'e' && inS(nxt, VOWEL_LETTERS)) {
        return two(i + 1, { sym: 'g', a: i, b: i + 1 }, { sym: 'z', a: i, b: i + 1 }); // exam, exact
      }
      return two(i + 1, { sym: 'k', a: i, b: i + 1 }, { sym: 's', a: i, b: i + 1 });
    case 'y':
      return one(i, 'y');
    case 'z':
      return one(i, 'z', nxt === 'z' ? 2 : 1);
    default:
      return silentL(i);
  }
}

function splitWs(s) {
  return s.split(' ').filter((t) => t.length > 0);
}

/** @returns {SpelledPhone[]} */
function parseException(spec, offset = 0) {
  const output = [];
  const toks = splitWs(spec);
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    const pos = k + offset;
    if (tok === '-') continue;
    if (tok === '+') {
      output[output.length - 1].b = pos + 1;
      continue;
    }
    for (const sym of tok.split(',')) output.push({ sym, a: pos, b: pos + 1 });
  }
  return output;
}

/** @returns {SpelledPhone[]} */
function spellRules(w) {
  const groups = vowelGroups(w);
  const silent = silentEs(w, groups);
  const silentLetters = new Set();
  for (const g of silent) silentLetters.add(groups[g][0]);
  const groupsAt = new Map();
  for (let gi = 0; gi < groups.length; gi++) groupsAt.set(groups[gi][0], gi);
  const phones = [];
  let i = 0;
  while (i < w.length) {
    const gi = groupsAt.get(i);
    if (gi !== undefined) {
      const [sym, j] = pickVowel(w, gi, groups, silent);
      if (sym !== null) phones.push({ sym, a: i, b: j });
      i = j;
      continue;
    }
    const [jn, ph] = consonant(w, i, groupsAt, silentLetters, phones);
    for (const p of ph) phones.push(p);
    i = Math.max(jn, i + 1);
  }
  return phones;
}

/**
 * Letters-only word -> [{ sym, a, b }] (phone, first letter, one past its last letter).
 * @param {string} word
 * @returns {SpelledPhone[]}
 */
export function spell(word) {
  const w = word.toLowerCase();
  if (Object.hasOwn(EXCEPTIONS, w)) {
    const spec = EXCEPTIONS[w];
    if (splitWs(spec).length !== w.length) throw new Error(`bad exception ${w}`);
    return parseException(spec);
  }
  for (const { suffix, spec } of SUFFIX_EXCEPTIONS) {
    if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
      const head = w.slice(0, w.length - suffix.length);
      const res = spellRules(head);
      for (const p of parseException(spec, head.length)) res.push(p);
      return res;
    }
  }
  return spellRules(w);
}
