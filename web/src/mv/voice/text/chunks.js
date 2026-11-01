// Words sung together (new in this copy, not in upstream magna-vocalization). Owner, 2026-11-01: "Tag
// adjectives, nouns, etc. We should keep adjectives + nouns on the same beat. Articles, such as the, an and a
// should also be on the same beat as their next words. Figure out which combinations should be sung together."
//
// Every word of a line gets a part of speech (the vendored compromise tagger, web/src/vendor) and a bind: how
// tightly it is sung to the word before it (0: free; the melody layouts may cut, breathe or hold there):
//
//   LEAD 1.0   an article or a determiner into its noun phrase       "the | FIRE", "my old friend"
//   LEAN 0.7   a preposition into its object, "to" into its verb      "by the fire", "to win"
//   MOD  0.6   a modifier into its head: adjectives, numbers and      "giant cake", "two eggs",
//              nouns before a noun, a proper name's words              "chalk start line", "Musical Bots"
//   DEG  0.5   a degree adverb into its adjective                     "so bright", "very tall"
//   AUX  0.4   an auxiliary / modal into its verb                     "can't stop", "will go"
//
// A bind never crosses punctuation (a comma, a dash: the analysis' phrases). A weak lead (an article, a
// preposition) is sung as a short pickup into its word, never held over a beat on its own; a modifier and its
// head are never split by a breath or a pulse. The layouts read the binds as costs (song/tunes.js,
// music/melody.js, music/stressFit.js), and a line that opens on an article sings it as a pickup (sing-plan.js).
import nlp from '../../../vendor/compromise-two.mjs';

export const LEAD = 1.0;
export const LEAN = 0.7;
export const MOD = 0.6;
export const DEG = 0.5;
export const AUX = 0.4;

export const ARTICLES = new Set(['a', 'an', 'the']);
/** Determiners compromise tags as nouns or pronouns (possessive pronouns, quantifiers). */
const DETERMINERS = new Set(['my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those', 'every', 'each', 'some', 'no', 'any', 'another', 'whose']);
/** "'s" that is "is" / "us", not a possessive. */
const NOT_POSSESSIVE = new Set(["it's", "that's", "he's", "she's", "there's", "here's", "what's", "who's", "where's", "let's", "how's"]);

const lettersOf = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}']/gu, '').replace(/^'+|'+$/g, '');
const has = (t, k) => t.tags.includes(k);

/** Part of speech of a compromise term: det, num, adj, adv, noun, pron, verb, aux, prep, to, conj, other. */
function posOf(t, word) {
  const w = lettersOf(word);
  if (ARTICLES.has(w)) return 'det';
  if (w === 'to') return 'to';
  if (DETERMINERS.has(w) && !has(t, 'Pronoun') && w !== 'that') return 'det';
  if (['my', 'your', 'our', 'their', 'his', 'its', 'every', 'each'].includes(w)) return 'det';
  if (has(t, 'Determiner')) return 'det';
  if (has(t, 'Value') || has(t, 'Cardinal') || has(t, 'TextValue')) return 'num';
  if (has(t, 'Auxiliary') || has(t, 'Modal') || has(t, 'Copula')) return 'aux';
  if (has(t, 'Preposition')) return 'prep';
  if (has(t, 'Pronoun')) return 'pron';
  if (has(t, 'Adjective')) return 'adj';
  if (has(t, 'Adverb')) return 'adv';
  if (has(t, 'Verb')) return 'verb';
  if (has(t, 'Noun') || has(t, 'ProperNoun') || has(t, 'Acronym')) return 'noun';
  if (has(t, 'Conjunction')) return 'conj';
  return 'other';
}

const NOMINAL = new Set(['adj', 'num', 'noun']);

/**
 * Fixes the tagger's usual slips on short lyric lines: a clause with no verb sings its last plural "noun" as one
 * ("The giant cake wobbles"); a present-tense "verb" right after a determiner or an adjective in a noun phrase is
 * the phrase's noun ("Navy's tiny boat").
 */
function repair(pos, words, terms) {
  for (let i = 1; i < pos.length; i++) {
    if (pos[i] === 'verb' && (pos[i - 1] === 'det' || (pos[i - 1] === 'adj' && i >= 2 && (pos[i - 2] === 'det' || /'s$/i.test(words[i - 2].text))))) {
      if (terms[i] && !has(terms[i], 'PastTense') && !has(terms[i], 'Gerund')) pos[i] = 'noun';
    }
  }
  // a subject and its verb read as a noun phrase ("Black struts up", "Copper dreams of", "Blue hums the night"): an
  // -s "noun" after a noun or an adjective, with an object, a preposition or a pronoun after it, is the verb
  for (let i = pos.length - 2; i >= 1; i--) {
    if (pos[i] !== 'noun' || !/[^s']s$/i.test(lettersOf(words[i].text)) || words[i + 1].phrase !== words[i].phrase) continue;
    if (!['noun', 'adj'].includes(pos[i - 1]) || (terms[i] && has(terms[i], 'ProperNoun'))) continue;
    const nx = pos[i + 1];
    if (nx === 'det' || nx === 'prep' || nx === 'pron' || nx === 'to' || (nx === 'conj' && pos[i + 2] === 'verb')) pos[i] = 'verb';
    if (nx === 'conj' && i + 2 < pos.length && pos[i + 2] === 'noun' && /[^s']s$/i.test(lettersOf(words[i + 2].text))
      && ['det', 'prep', 'pron'].includes(pos[i + 3])) { pos[i] = 'verb'; pos[i + 2] = 'verb'; }
  }
  const byPhrase = new Map();
  words.forEach((w, i) => { if (!byPhrase.has(w.phrase)) byPhrase.set(w.phrase, []); byPhrase.get(w.phrase).push(i); });
  for (const idx of byPhrase.values()) {
    if (idx.some((i) => pos[i] === 'verb' || pos[i] === 'aux')) continue;
    const last = idx[idx.length - 1];
    if (idx.length >= 3 && pos[last] === 'noun' && pos[last - 1] === 'noun' && /[^s]s$/i.test(lettersOf(words[last].text))
      && !(terms[last] && has(terms[last], 'ProperNoun'))) pos[last] = 'verb';
  }
}

/** The bind of word b to word a before it (part-of-speech pa, pb; `headAhead`: a noun ends the nominal run from b). */
function bindOf(pa, pb, wa, headAhead) {
  const a = lettersOf(wa);
  if (pa === 'det') return NOMINAL.has(pb) || pb === 'adv' ? LEAD : 0;
  if (pa === 'prep') return NOMINAL.has(pb) || pb === 'det' || pb === 'pron' ? LEAN : 0;
  if (pa === 'to') return pb === 'verb' || pb === 'adv' ? LEAN : 0;
  if (pa === 'aux') return pb === 'verb' ? AUX : 0;
  if (pa === 'adv') return pb === 'adj' && !/ly$/.test(a) ? DEG : 0;
  if (pa === 'num' && (pb === 'noun' || pb === 'adj')) return MOD;
  if ((pa === 'adj' || pa === 'noun') && (pb === 'noun' || (pb === 'adj' && headAhead))) return MOD;
  return 0;
}

const cache = new Map();

/**
 * Parts of speech and binds of a line's words.
 * @param {string} text the line
 * @param {Array<{text:string, charStart:number, charEnd:number, phrase:number}>} words its words (analysis words:
 *   letter runs, in order)
 * @returns {Array<{pos:string, bind:number, article:boolean}>} per word: its part of speech, its bind to the word
 *   before it (0 for the first word and across punctuation), and whether it is an article
 */
export function wordChunks(text, words) {
  const key = `${text}\u0000${words.map((w) => `${w.charStart}:${w.charEnd}:${w.phrase}`).join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let terms = [];
  try {
    terms = nlp(String(text ?? '')).json({ offset: true }).flatMap((s) => s.terms).filter((t) => t.text && t.offset);
  } catch { terms = []; }
  const termOf = (w) => terms.find((t) => w.charStart >= t.offset.start && w.charStart < t.offset.start + Math.max(1, t.offset.length))
    ?? terms.find((t) => t.offset.start >= w.charStart && t.offset.start < w.charEnd) ?? null;
  const ts = words.map(termOf);
  const pos = words.map((w, i) => (ts[i] ? posOf(ts[i], w.text) : ARTICLES.has(lettersOf(w.text)) ? 'det' : 'other'));
  // a possessive ("Navy's") leads into its noun phrase as a modifier
  words.forEach((w, i) => { if (/'s$/i.test(w.text) && !NOT_POSSESSIVE.has(lettersOf(w.text)) && pos[i] !== 'pron') pos[i] = 'noun'; });
  repair(pos, words, ts);
  const out = words.map((w, i) => {
    let bind = 0;
    if (i > 0 && words[i - 1].phrase === w.phrase) {
      let headAhead = false;
      for (let k = i; k < words.length && words[k].phrase === w.phrase && NOMINAL.has(pos[k]); k++) if (pos[k] === 'noun') { headAhead = true; break; }
      bind = bindOf(pos[i - 1], pos[i], words[i - 1].text, headAhead);
    }
    return { pos: pos[i], bind, article: ARTICLES.has(lettersOf(w.text)) };
  });
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * The groups of a line sung together: runs of words joined by a bind, as word index lists (a free word alone).
 * @param {Array<{bind:number}>} chunks wordChunks output
 * @returns {number[][]}
 */
export function groupsOf(chunks) {
  const out = [];
  chunks.forEach((c, i) => {
    if (i > 0 && c.bind > 0) out[out.length - 1].push(i);
    else out.push([i]);
  });
  return out;
}
