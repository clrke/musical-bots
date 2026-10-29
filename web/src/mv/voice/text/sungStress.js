// Word stress for singing (port of Magna.Core Voice/Text/SungStress.cs; new in this copy, not in
// upstream magna-vocalization). Owner, 2026-10-23: "allow subtle changes to cadence to avoid
// awkward word stresses. Reduce stress on articles as well ... 'Relax by THE fire' should be
// subtly changed to 'Relax by the FIRE'".
//
// Every sung syllable gets a stress level (level): a one-syllable content word is stressed; a
// longer one takes the dictionary's stress marks (CMUdict primary = stressed, secondary = medium,
// none = unstressed; the rules' stress for a word the dictionary does not have); a function word
// (the analysis' functionWord: "the", "a", "by", "your", plus WEAK_WORDS) is weak. music/stressFit.js
// moves note onsets a little so the stressed syllables take the accents of a line's rhythm, and
// the singer sings weak syllables softer and stressed ones a little louder (sungGainDb).

let aware = true;

/**
 * Stress-aware singing (default true): the singer levels syllables by their stress (sing.js) and
 * generateNotes fits notes to a `stress` list when given one. false: upstream's levels (only
 * downbeats and function words level the notes). Global: set it before rendering.
 */
export function stressAware(on) {
  if (on !== undefined) aware = Boolean(on);
  return aware;
}

export const PRIMARY = 2;
export const SECONDARY = 1;
export const UNSTRESSED = 0;
export const WEAK = -1;

/** Words sung weak besides the analysis' function words (lexicon.js FUNCTION_WORDS). */
export const WEAK_WORDS = new Set(['into', 'onto', 'upon', 'unto', 'than', 'their', 'nor']);

/** The articles: the weakest words of all (sung the softest). */
export const ARTICLES = new Set(['a', 'an', 'the']);

const lettersOf = (s) => {
  let o = '';
  for (const c of String(s)) if (/\p{L}/u.test(c)) o += c.toLowerCase();
  return o;
};

/** A word sung weak: a function word or one of WEAK_WORDS. */
export function isWeakWord(w) {
  return Boolean(w.functionWord) || WEAK_WORDS.has(lettersOf(w.text));
}

/** An article ("a", "an", "the"). */
export function isArticle(w) {
  return ARTICLES.has(lettersOf(w.text));
}

/**
 * How stressed syllable `si` of the analysis is sung: PRIMARY (a one-syllable content word, or
 * the dictionary's primary stress / the rules' stress of a longer one), SECONDARY (the
 * dictionary's secondary stress), UNSTRESSED, or WEAK (a function word; a two-syllable one such
 * as "into" keeps its stressed syllable at UNSTRESSED). A syllable without a vowel is UNSTRESSED.
 * @param {import('./textData.js').LineAnalysis} an
 * @param {number} si
 */
export function level(an, si) {
  const s = an.syllables[si];
  if (s.nucleus < 0) return UNSTRESSED;
  const w = an.words[s.word];
  let sung = 0;
  for (const k of w.syllables) if (an.syllables[k].nucleus >= 0) sung++;
  if (isWeakWord(w)) return sung > 1 && (s.lexical === 1 || (s.lexical < 0 && s.stress !== 0)) ? UNSTRESSED : WEAK;
  if (sung <= 1) return PRIMARY;
  if (s.lexical >= 0) return s.lexical === 1 ? PRIMARY : s.lexical === 2 ? SECONDARY : UNSTRESSED;
  return s.stress !== 0 ? PRIMARY : UNSTRESSED;
}

/**
 * Sung level (dB) of a syllable at `lvl` (level()), on a downbeat or not: stressed +0.5,
 * secondary 0, unstressed -0.75, a function word -1.5 (an article -2); a downbeat adds 1 under a
 * stressed syllable, 0.25 under another. (Upstream, without stress: downbeat +1, function word -1.)
 */
export function sungGainDb(lvl, article, downbeat) {
  let g = lvl >= PRIMARY ? 0.5 : lvl === SECONDARY ? 0.0 : lvl === UNSTRESSED ? -0.75 : article ? -2.0 : -1.5;
  if (downbeat) g += lvl >= SECONDARY ? 1.0 : 0.25;
  return g;
}
