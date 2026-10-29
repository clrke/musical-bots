// Text analysis (port of csharp/Mumble/Text/Analyze.cs, mumble/text.py analyze()).
// The typewriter rule: every character appears after a fixed step (~1/13 s, scaled per
// voice); a comma waits 3 steps, a period / ? / ! waits 6. Every phone is scheduled at the
// time its first letter appears.
//
// JS deviation: characters are UTF-16 code units (as in C#; Python counts code points), which
// only matters for text with astral characters such as emoji.
//
// Changed in this copy (vs upstream magna-vocalization), ported from Magna.Core Analyze.cs: every
// word's phones come from pronunciation.js (CMUdict first, heteronyms by sense, the letter rules
// for words it does not have), with the dictionary's stress (Syllable.stress) and stress digits
// (Syllable.lexical); analyze() takes an optional heteronym senses string.
import { phoneKind, phonePlace, phoneVoiced } from '../phones.js';
import { resolveHeteronyms } from './heteronyms.js';
import { alignManual, forceSyllables, parseManual } from './hyphenation.js';
import {
  CH_AS_K, CONS_DIGRAPHS, DH_WORDS, EI_EE, EXCEPTIONS, FUNCTION_WORDS, H_SILENT, HARD_G,
  LEGAL_ONSETS, NG_HARD, OW_OH, S_BETWEEN_VOWELS, STRESS_EXCEPTIONS, SUFFIX_EXCEPTIONS,
  VOWEL_DIGRAPHS, WH_AS_H, Z_AFTER_VOWEL,
} from './lexicon.js';
import { contraction, useDictionary, wordPhones } from './pronunciation.js';
import { spell, VOWEL_LETTERS } from './spelling.js';
import { syllabify, SUFFIX_STRESS, WEAK_PREFIXES, wordStress } from './syllables.js';
import { LineAnalysis, Phone, Phrase, Syllable, Word } from './textData.js';

/** Seconds per normal letter / space (~77 ms). */
export const LETTER_DT = 1.0 / 13.0;
/** , ; : and dashes. */
export const COMMA_STEPS = 3.0;
/** . ? ! (twice a comma). */
export const STOP_STEPS = 6.0;
/** Each dot of "..." (so "..." waits 9 steps in total). */
export const ELLIPSIS_DOT_STEPS = 3.0;

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const PAUSE_CHARS = ',;:.?!…—–';

// ------------------------------------------------------------------ timing
/**
 * Wait after each character, in letter steps.
 * @param {string} text
 * @returns {number[]}
 */
export function typewriterSteps(text) {
  const n = text.length;
  const waits = new Array(n);
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    const nxt = i + 1 < n ? text[i + 1] : '';
    if (',;:—–'.includes(ch)) waits[i] = COMMA_STEPS;
    else if (ch === '…') waits[i] = 3 * ELLIPSIS_DOT_STEPS;
    else if (ch === '.' && (prev === '.' || nxt === '.')) waits[i] = ELLIPSIS_DOT_STEPS;
    // in "?!" / "!!" only the last mark of the run gets the long wait
    else if ('.?!'.includes(ch)) waits[i] = nxt !== '' && '.?!'.includes(nxt) ? 1.0 : STOP_STEPS;
    else waits[i] = 1.0;
  }
  return waits;
}

/**
 * Appear time of every character, plus the time after the last wait.
 * Returns [times, end]; also readable as .times / .end.
 * @param {string} text
 * @param {number} [dt]
 * @returns {[number[], number] & {times:number[], end:number}}
 */
export function typewriterTimes(text, dt = LETTER_DT) {
  const times = [];
  let t = 0.0;
  for (const w of typewriterSteps(text)) {
    times.push(t);
    t += w * dt;
  }
  const r = [times, t];
  Object.defineProperty(r, 'times', { value: times, enumerable: false });
  Object.defineProperty(r, 'end', { value: t, enumerable: false });
  return /** @type {any} */ (r);
}

// ------------------------------------------------------------------ line
function phraseMark(punct) {
  if (punct.includes('?')) return '?';
  if (punct.includes('!')) return '!';
  let dots = 0;
  for (const c of punct) if (c === '.') dots++;
  if (punct.includes('…') || dots >= 2) return '...';
  if (dots > 0) return '.';
  return ',';
}

/** char.IsLetter / str.isalpha for one UTF-16 unit. */
function isAlpha(c) {
  if (c < '\u0080') return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  return /\p{L}/u.test(c);
}

function isUpper(c) {
  if (c < '\u0080') return c >= 'A' && c <= 'Z';
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Only the letters of s, lower-cased. */
export function lettersOf(s) {
  let out = '';
  for (const c of s) if (isAlpha(c)) out += c;
  return out.toLowerCase();
}

/**
 * ALL-CAPS word of at least two letters.
 * @param {string} wordText
 */
export function isShout(wordText) {
  let count = 0;
  for (const c of wordText) {
    if (!isAlpha(c)) continue;
    count++;
    if (!isUpper(c)) return false;
  }
  return count >= 2;
}

function pauseOnly(s) {
  let out = '';
  for (const c of s) if (PAUSE_CHARS.includes(c)) out += c;
  return out;
}

function sl(s, a, b) {
  return s.slice(a, b);
}

/**
 * Analyse one line of dialogue (times in seconds for a letter step of dt).
 *
 * JS extension: `manual` is an optional hyphenation of the line ("I be-lieve in you") that
 * forces the syllables of the words it covers (see hyphenation.js); every syllable with a
 * nucleus is one voiced unit (one sung note). The covered words are listed in
 * `an.manualSplits`. Without `manual` the result is exactly the C# / Python analysis.
 *
 * `senses`: which sense of a heteronym the line means ("wind=noun", heteronyms.js); null = the
 * data's annotation of this text, else a guess from the context (with the dictionary on).
 * @param {string} text
 * @param {number} [dt]
 * @param {string|null} [manual]
 * @param {string|null} [senses]
 * @returns {LineAnalysis}
 */
export function analyze(text, dt = LETTER_DT, manual = null, senses = null) {
  text = text ?? '';
  const steps = typewriterSteps(text);
  const times = new Array(steps.length);
  let t = 0.0;
  for (let i = 0; i < steps.length; i++) {
    times[i] = t;
    t += steps[i] * dt;
  }
  const endTime = t;

  // words and phrases
  /** @type {Word[]} */
  const words = [];
  /** @type {Phrase[]} */
  const phrases = [];
  let cur = [];
  let pos = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const between = sl(text, pos, m.index);
    const punct = pauseOnly(between);
    if (punct.length > 0 && cur.length > 0) {
      phrases.push(new Phrase(cur, phraseMark(punct), 0.0, 0.0));
      cur = [];
    }
    const wtext = m[0];
    const letters = lettersOf(wtext);
    words.push(new Word(wtext, m.index, m.index + wtext.length, isShout(wtext), phrases.length,
      FUNCTION_WORDS.has(letters)));
    cur.push(words.length - 1);
    pos = m.index + wtext.length;
  }
  if (cur.length > 0) {
    const tail = pauseOnly(text.slice(pos));
    phrases.push(new Phrase(cur, tail.length > 0 ? phraseMark(tail) : '', 0.0, 0.0));
  }

  // manual hyphenation (JS extension)
  let aligned = null;
  if (typeof manual === 'string' && manual.trim()) {
    aligned = alignManual(words.map((w) => lettersOf(w.text)), parseManual(manual));
  }
  const manualSplits = aligned ? new Map() : null;
  // heteronyms ("wind" the noun or the verb): the phones of the sense the line means
  const heteronyms = useDictionary() ? resolveHeteronyms(text, words, senses) : null;

  // phones and syllables
  /** @type {Phone[]} */
  const phones = [];
  /** @type {Syllable[]} */
  const syllables = [];
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    const letterPos = [];
    for (let k = 0; k < word.text.length; k++) if (isAlpha(word.text[k])) letterPos.push(word.charStart + k);
    const letters = lettersOf(word.text);
    let spelled;
    let sylls;
    let syllabic;
    const split = aligned && aligned.has(wi) ? aligned.get(wi) : null;
    // the dictionary's phones (US English) or the letter-to-sound rules' (dictionary off, unknown words)
    const pron = wordPhones(word.text, letters, split ? split.length + 1 : 0, heteronyms ? heteronyms[wi] : null);
    const stressedPhone = pron.fromDictionary && pron.stressed >= 0 ? pron.stressed : -2;
    const forced = split ? forceSyllables(letters, split, pron.phones, stressedPhone) : null;
    if (forced) {
      manualSplits.set(wi, split);
      spelled = forced.spelled;
      sylls = forced.sylls;
      syllabic = forced.syllabic;
    } else {
      spelled = pron.phones;
      const r = syllabify(spelled.map((p) => p.sym), pron.fromDictionary);
      sylls = r.sylls;
      if (pron.fromDictionary) contraction(word.text, spelled, sylls);
      syllabic = r.syllabic >= 0 ? [r.syllabic] : [];
    }
    const b0 = phones.length;
    for (const { sym, a, b } of spelled) {
      phones.push(new Phone(sym, phoneKind(sym), phoneVoiced(sym), phonePlace(sym),
        letterPos[a], letterPos[b - 1] + 1, wi));
      word.phones.push(phones.length - 1);
    }
    if (word.phones.length > 0) phones[word.phones[word.phones.length - 1]].wordFinal = true;
    for (const x of syllabic) phones[b0 + x].syllabic = true;
    for (let k = 0; k < sylls.length; k++) {
      const { onset: on, nucleus: nuc, coda: co } = sylls[k];
      const si = syllables.length;
      const syl = new Syllable(wi, word.phrase, on.map((x) => b0 + x), nuc < 0 ? -1 : b0 + nuc,
        co.map((x) => b0 + x), k, sylls.length);
      // the dictionary's stress digit of its vowel (not known for a manual split's or the rules' phones)
      syl.lexical = !forced && pron.lexical && nuc >= 0 && nuc < pron.lexical.length ? pron.lexical[nuc] : -1;
      syllables.push(syl);
      word.syllables.push(si);
      for (const x of on) {
        phones[b0 + x].syllable = si;
        phones[b0 + x].role = nuc >= 0 ? 'onset' : 'free';
      }
      if (nuc >= 0) {
        phones[b0 + nuc].syllable = si;
        phones[b0 + nuc].role = 'nucleus';
      }
      for (const x of co) {
        phones[b0 + x].syllable = si;
        phones[b0 + x].role = 'coda';
      }
    }
    if (!word.functionWord) {
      let ks = -1;
      if (stressedPhone >= 0) {
        // the dictionary's primary stress: the syllable of that vowel (if a manual split kept it)
        const want = forced ? forced.source.indexOf(stressedPhone) : stressedPhone;
        for (let k = 0; k < word.syllables.length && want >= 0; k++) {
          if (syllables[word.syllables[k]].nucleus === b0 + want) ks = k;
        }
      }
      if (ks < 0) {
        const info = [];
        for (const si of word.syllables) {
          const nuc = syllables[si].nucleus;
          if (nuc < 0) {
            info.push({ sym: null, head: '' });
            continue;
          }
          const end = phones[nuc].charEnd - word.charStart;
          info.push({ sym: phones[nuc].sym, head: lettersOf(sl(word.text, 0, end)) });
        }
        ks = wordStress(letters, info);
      }
      if (ks >= 0 && syllables[word.syllables[ks]].nucleus >= 0) syllables[word.syllables[ks]].stress = 1;
    }
  }

  // phone times: letter appear time; phones sharing a letter split its step
  for (const ph of phones) ph.t = times[ph.charStart];
  let kk = 0;
  while (kk < phones.length) {
    let same = 1;
    while (kk + same < phones.length && phones[kk + same].charStart === phones[kk].charStart) same++;
    if (same > 1) {
      const c = phones[kk].charStart;
      const t0 = times[c];
      const t1 = c + 1 < times.length ? times[c + 1] : endTime;
      for (let r = 0; r < same; r++) phones[kk + r].t = t0 + (t1 - t0) * r / same;
    }
    kk += same;
  }
  for (let k = 0; k < phones.length; k++) {
    const ph = phones[k];
    const afterLast = ph.charEnd < times.length ? times[ph.charEnd] : endTime;
    const bound = afterLast + dt; // never let a phone's slot run through a pause
    const nxtT = k + 1 < phones.length ? phones[k + 1].t : bound;
    const samePhrase = k + 1 < phones.length && words[phones[k + 1].word].phrase === words[ph.word].phrase;
    ph.tNext = !samePhrase ? Math.min(nxtT, bound) : nxtT;
    if (ph.tNext <= ph.t) ph.tNext = ph.t + dt * 0.5;
  }

  for (const p of phrases) {
    const first = words[p.words[0]];
    const last = words[p.words[p.words.length - 1]];
    p.tStart = times[first.charStart];
    p.tEnd = times[last.charEnd - 1] + dt;
  }

  return new LineAnalysis({
    text, dt, charSteps: steps, charTimes: times, endTime, words, phrases, syllables, phones, manualSplits,
  });
}

/**
 * Human-readable dump: word -> syllables with phones.
 * @param {LineAnalysis} an
 * @returns {string}
 */
export function describe(an) {
  const lines = [];
  for (const w of an.words) {
    const parts = [];
    for (const si of w.syllables) {
      const s = an.syllables[si];
      const on = s.onset.map((i) => an.phones[i].sym);
      const nu = s.nucleus >= 0 ? an.phones[s.nucleus].sym : '';
      const co = s.coda.map((i) => an.phones[i].sym);
      parts.push((s.stress !== 0 ? "'" : '') + '[' + on.join(' ') + '|' + nu + '|' + co.join(' ') + ']');
    }
    const flag = w.shout ? ' SHOUT' : '';
    lines.push(w.text.padStart(10) + flag + ': ' + parts.join(' '));
  }
  return lines.join('\n');
}

/** The C# static partial class MumbleText (Analyze / Lexicon / Spelling / Syllables) as one object. */
export const MumbleText = Object.freeze({
  LETTER_DT, COMMA_STEPS, STOP_STEPS, ELLIPSIS_DOT_STEPS, VOWEL_LETTERS,
  EXCEPTIONS, SUFFIX_EXCEPTIONS, OW_OH, HARD_G, NG_HARD, DH_WORDS, Z_AFTER_VOWEL, S_BETWEEN_VOWELS,
  CH_AS_K, WH_AS_H, EI_EE, H_SILENT, FUNCTION_WORDS, VOWEL_DIGRAPHS, CONS_DIGRAPHS, LEGAL_ONSETS,
  STRESS_EXCEPTIONS, WEAK_PREFIXES, SUFFIX_STRESS,
  typewriterSteps, typewriterTimes, isShout, analyze, describe, spell, syllabify, wordStress,
});
