// Rhymes and tense for the lyric gates, from the voice engine's own letter-to-sound analyzer
// (web/src/mv/voice/text/analyze.js): a line's rhyme is its last sung syllable's vowel and coda.
// Measured on Soothing Bots' 96 V5 rhyme pairs (verse lines 2 and 4, chorus Y and turn against X):
// 93 match exactly, and the 3 others ("run / son", "dinosaur / roar") are letter-to-sound quirks
// the near-vowel families below absorb. Pure.
import { analyze, LETTER_DT } from '../../web/src/mv/voice/text/analyze.js';
import { parseLyric } from '../../web/src/cues.js';
import { NAMES } from '../../web/src/gen/cast.js';

// vowels the speller confuses at a rhyme (cup / cop, saw / so, hood / who'd)
const FAMILY = { uh: 'a', ah: 'a', schwa: 'a', aw: 'o', oh: 'o', oo: 'u', uu: 'u' };

/**
 * The rhyme of a sung line (markup, pickup and reply removed): { vowel, coda } or null (unknown). A
 * line ending on a cast name is unknown: the speller reads names by spelling rules ("Lou" as "lout").
 */
export function rhymeOf(lyric) {
  const text = parseLyric(lyric, NAMES).text.replace(/[^A-Za-z' -]/g, ' ').trim();
  if (!text) return null;
  const last = (text.match(/[A-Za-z']+$/) ?? [''])[0].replace(/'s$/i, '');
  if (NAMES.some((n) => n.toLowerCase() === last.toLowerCase())) return null;
  let an;
  try {
    // the engine's speller cannot take "has" / "get" yet (the arranger sings them as "haz" / "gett")
    an = analyze(text.replace(/\b(has|get)\b/gi, (w) => (/^h/i.test(w) ? 'haz' : 'gett')), LETTER_DT);
  } catch { return null; }
  const syl = an.syllables.filter((x) => x.nucleus >= 0).at(-1);
  if (!syl) return null;
  return { vowel: an.phones[syl.nucleus].sym, coda: syl.coda.map((i) => an.phones[i].sym).join(' ') };
}

/** Whether two lines rhyme (the same coda, the same vowel or one of its near family). Unknown: true. */
export function rhymes(a, b) {
  const x = rhymeOf(a), y = rhymeOf(b);
  if (!x || !y) return true;
  return x.coda === y.coda && (x.vowel === y.vowel || Boolean(FAMILY[x.vowel] && FAMILY[x.vowel] === FAMILY[y.vowel]));
}

/** The last word of a line as sung (for messages). */
export const lastWord = (lyric) => (parseLyric(lyric).text.match(/[A-Za-z']+(?=[^A-Za-z']*$)/) ?? [''])[0];

// Past tense, the obvious cases (the story sings in the plain present): the common irregular simple
// pasts, minus the ones a child's song also uses in the present (got, made, sold, sent, stuck, bent,
// built, seen, done, gone, lost, left, found, bit, read, beat, lit, set, put, cut, let, hit, shut),
// and a regular "-ed" right after its subject ("I dropped", "it tipped", "Lou counted").
const IRREGULAR = new Set(('was were had did went came saw said took gave held kept told felt ran sat stood threw flew grew knew '
  + 'drew ate fell brought bought thought caught taught won met spent slept woke wrote spoke broke chose froze rode drove '
  + 'began sang rang swam drank forgot hid slid spun swung hung dug shook wore tore heard meant fled led').split(' '));
const SUBJECT = /\b(i|he|she|it|they|you)\s+([a-z]{3,}ed)\b/i;
/** The first past-tense word of a line, or null. names: the cast (a name is a subject too). */
export function pastTense(lyric, names = []) {
  const text = parseLyric(lyric, names).text;
  for (const w of text.toLowerCase().match(/[a-z']+/g) ?? []) if (IRREGULAR.has(w)) return w;
  const subj = names.length ? new RegExp(`\\b(${names.join('|')})\\s+([a-z]{3,}ed)\\b`, 'i') : null;
  for (const re of [SUBJECT, subj]) {
    const m = re && re.exec(text);
    if (m && !/eed$/i.test(m[2])) return m[2].toLowerCase();
  }
  return null;
}
