// Heteronyms: words spelled alike and said differently by meaning ("wind" the noun W IH1 N D,
// the verb W AY1 N D). Port of Magna.Core Voice/Text/Heteronyms.cs; new in this copy (not in
// upstream magna-vocalization).
//
// The data (heteronymData.js, from Magna.Core tools/heteronyms/heteronyms.json): per word its
// senses (id, part of speech, ARPAbet, gloss) and a default; per preset line that has one, which
// sense it means. A line says which sense it means with a senses string: "wind=noun", several
// separated by spaces or commas ("close=verb tears=noun"), "word#2=id" for the word's second
// occurrence in the line; a part of speech works as an id ("bow=noun" is the ribbon). The text
// analysis sings each heteronym with, in this order: the sense the senses string names (a sung
// job's `senses`), the data's annotation of the line, a guess from the words around it (guess:
// after "the" / "my" a noun, after "to" / "will" a verb, before "your" / "the" an imperative
// verb, ...), else the word's default. Only with the dictionary on (pronunciation.js).
import { HETERONYM_DATA } from './heteronymData.js';
import { FUNCTION_WORDS } from './lexicon.js';

/** @typedef {{id:string, pos:string, arpabet:string, gloss:string}} Sense */
/** @typedef {{word:string, default:string, senses:Sense[]}} Entry */

/** @type {{words: Map<string, Entry>, lines: Map<string, string>}|null} */
let table = null;

function get() {
  if (table) return table;
  const words = new Map();
  for (const [w, e] of Object.entries(HETERONYM_DATA.words ?? {})) {
    if (!e || !Array.isArray(e.senses)) continue;
    words.set(w, { word: w, default: e.default ?? null, senses: e.senses.map((s) => ({ ...s })) });
  }
  const lines = new Map();
  for (const [k, v] of Object.entries(HETERONYM_DATA.lines ?? {})) if (typeof v === 'string') lines.set(k.trim().toLowerCase(), v);
  table = { words, lines };
  return table;
}

/** The sense with this id, else the first with this part of speech, else null. */
export function findSense(entry, idOrPos) {
  if (!entry || !idOrPos) return null;
  const x = String(idOrPos).toLowerCase();
  return entry.senses.find((s) => String(s.id).toLowerCase() === x)
    ?? entry.senses.find((s) => String(s.pos).toLowerCase() === x) ?? null;
}

/** Letters only, lower case (C# Heteronyms.Key: char.IsLetter). */
function key(word) {
  let k = '';
  for (const c of String(word ?? '')) if (/\p{L}/u.test(c)) k += c.toLowerCase();
  return k;
}

/** The heteronym spelled `word` (any case, apostrophes ignored), or null. */
export function findHeteronym(word) {
  const k = key(word);
  return k.length > 0 ? get().words.get(k) ?? null : null;
}

/** Every heteronym, by its lower-case spelling. */
export function heteronymWords() {
  return get().words;
}

/** The data's annotation of line `text` ("wind=noun"), or null (case-insensitive, trimmed). */
export function lineSenses(text) {
  return text != null ? get().lines.get(String(text).trim().toLowerCase()) ?? null : null;
}

// ------------------------------------------------------------------ senses strings
/** The longest senses string kept (characters) and the most items. */
export const MAX_SENSES = 160;
export const MAX_CHOICES = 8;

/**
 * The items of a senses string ("wind=noun, close#2=adj"); malformed items are skipped.
 * @returns {Array<{word:string, occurrence:number, sense:string}>} occurrence 1-based, 0 = every one
 */
export function parseSenses(senses) {
  const out = [];
  if (typeof senses !== 'string' || !senses.trim()) return out;
  for (const raw of senses.split(/[ ,;\t\n]+/).filter((x) => x.length > 0)) {
    const eq = raw.indexOf('=');
    if (eq <= 0 || eq === raw.length - 1) continue;
    let w = raw.slice(0, eq);
    const sense = raw.slice(eq + 1).toLowerCase();
    let occ = 0;
    const hash = w.indexOf('#');
    if (hash >= 0) {
      const tail = w.slice(hash + 1);
      if (!/^[+-]?\d+$/.test(tail)) continue;
      occ = Number(tail);
      if (occ < 1 || occ > 99) continue;
      w = w.slice(0, hash);
    }
    const k = key(w);
    if (k.length === 0 || k.length > 32 || sense.length > 24 || !/^[a-z-]+$/.test(sense)) continue;
    out.push({ word: k, occurrence: occ, sense });
  }
  return out;
}

/**
 * A valid senses string for saving: its well-formed items in canonical form ("wind=noun
 * close#2=adj"), at most MAX_CHOICES; null when none is left.
 */
export function normalizeSenses(v) {
  if (typeof v !== 'string') return null;
  const items = parseSenses(v).slice(0, MAX_CHOICES).map((c) => `${c.word}${c.occurrence > 0 ? `#${c.occurrence}` : ''}=${c.sense}`);
  const o = items.join(' ');
  return o.length === 0 || o.length > MAX_SENSES ? null : o;
}

// ------------------------------------------------------------------ context
const set = (s) => new Set(s.split(' '));
const DETERMINERS = set('a an the this that these those my your his her its our their some any no every each one own gentle soft warm cool little evening morning night summer winter autumn spring north south east west cold chilly salty sea mountain');
const VERB_BEFORE = set("to will would can could shall should may might must let's lets don't dont won't can't cannot didn't doesn't never i we they you please i'll you'll we'll they'll gonna wanna help softly gently slowly");
const PAST_BEFORE = set("have has had i've you've we've they've was were been already once being");
const ADJ_BEFORE = set("so too very as more most quite stay stays feel feels be is are am was were keep get it's i'm you're we're they're felt seem seems sit hold stand stick");
const SUBJECT_OF = set('is are was were can will could would may might must should do does did has have had blows blow fall falls come comes go goes fade fades flow flows sing sings dry dries heal heals whispers whisper sighs carries sways');
const OBJECT_START = set('the a an your my our their his her its this that these those me us them him it up down out away yourself myself every all some');
const ADVERBS = set('more less ago later away too now again then here there still left long so very or and but yet soon today tonight');
const PREPOSITIONS = set('in on at with by from of through across into over under upon beneath above like without after before against along around for');

/** Letters (lower case) and apostrophes (’ = ') of a word (C# Heteronyms.Lower). */
function lower(w) {
  let o = '';
  for (const c of String(w)) {
    if (/\p{L}/u.test(c)) o += c.toLowerCase();
    else if (c === "'" || c === '’') o += "'";
  }
  return o;
}

/**
 * The sense id heteronym words[i] has by the words around it (words as written; phraseStart: it
 * starts a phrase; nextBreak: a phrase ends after it). After a determiner or a possessive a noun
 * (an adjective before a content word); after "have" / "was" the past; after "to", a modal or a
 * subject pronoun a verb; after "so" / "is" / "stay" an adjective; before "is" / "can" the
 * subject: a noun; before "the" / "your" / "it" / "up" a verb; after a preposition a noun; else
 * the word's default. null when words[i] is not a heteronym.
 */
export function guessSense(words, i, phraseStart, nextBreak = false) {
  const e = findHeteronym(words[i]);
  if (!e) return null;
  const prev = !phraseStart && i > 0 ? lower(words[i - 1]) : null;
  const next = i + 1 < words.length ? lower(words[i + 1]) : null;
  const pick = (pos) => e.senses.find((s) => s.pos === pos || s.id === pos)?.id ?? null;
  const nextContent = next !== null && !nextBreak && !FUNCTION_WORDS.has(next.replaceAll("'", ''))
    && !PREPOSITIONS.has(next) && !SUBJECT_OF.has(next) && !OBJECT_START.has(next) && !ADVERBS.has(next);
  let r = null;
  if (prev !== null) {
    if (DETERMINERS.has(prev)) r = (nextContent ? pick('adj') : null) ?? pick('noun') ?? pick('adj');
    else if (PAST_BEFORE.has(prev)) r = pick('past') ?? pick('verb') ?? pick('adj');
    else if (VERB_BEFORE.has(prev)) r = pick('present') ?? pick('verb');
    else if (ADJ_BEFORE.has(prev)) r = pick('adj');
    else if (PREPOSITIONS.has(prev)) r = pick('noun');
  }
  if (r === null && next !== null) {
    if (SUBJECT_OF.has(next) && (phraseStart || prev === null || DETERMINERS.has(prev))) r = pick('noun');
    else if (OBJECT_START.has(next)) r = pick('present') ?? pick('verb');
  }
  return r ?? e.default;
}

function choose(e, choices, k, occurrence) {
  let any = null;
  for (const c of choices) {
    if (c.word !== k) continue;
    const s = findSense(e, c.sense);
    if (!s) continue;
    if (c.occurrence === occurrence) return s;
    if (c.occurrence === 0 && any === null) any = s;
  }
  return any;
}

/**
 * The ARPAbet each word of an analysed line sings (null entries: not a heteronym, the dictionary
 * as usual): the senses string's choice, else the data's annotation of `text`, else guessSense.
 * @param {string} text the line
 * @param {Array<{text:string, phrase:number}>} words the analysis' words
 * @param {string|null} senses
 * @returns {Array<string|null>|null} null: no heteronym in the line
 */
export function resolveHeteronyms(text, words, senses) {
  let out = null;
  let chosen = null;
  let annotated = null;
  let texts = null;
  const seen = new Map();
  for (let wi = 0; wi < words.length; wi++) {
    const e = findHeteronym(words[wi].text);
    if (!e) continue;
    const n = (seen.get(e.word) ?? 0) + 1;
    seen.set(e.word, n);
    chosen ??= parseSenses(senses);
    annotated ??= parseSenses(lineSenses(text));
    let s = choose(e, chosen, e.word, n) ?? choose(e, annotated, e.word, n);
    if (!s) {
      texts ??= words.map((w) => w.text);
      s = findSense(e, guessSense(texts, wi, wi === 0 || words[wi - 1].phrase !== words[wi].phrase,
        wi + 1 < words.length && words[wi + 1].phrase !== words[wi].phrase)) ?? findSense(e, e.default) ?? e.senses[0] ?? null;
    }
    if (!s) continue;
    out ??= new Array(words.length).fill(null);
    out[wi] = s.arpabet;
  }
  return out;
}
