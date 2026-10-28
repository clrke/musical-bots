// Phrase types (port of csharp/Mumble/Text/PhraseType.cs, mumble/human.py phrase_type).

/** Words that make a question a wh-question. */
export const WH_WORDS = new Set([
  'what', 'where', 'when', 'why', 'who', 'whom', 'whose', 'which', 'how',
  'whats', 'wheres', 'whos', 'hows',
]);

/** Leading conjunctions / fillers skipped when classifying a question. */
export const LEAD_WORDS = new Set([
  'and', 'but', 'so', 'or', 'well', 'oh', 'um', 'uh', 'er', 'then', 'now', 'ok',
  'okay', 'hey', 'huh', 'hmm', 'yeah', 'no', 'yes',
]);

function lettersLower(s) {
  let out = '';
  for (const c of s) if (/\p{L}/u.test(c)) out += c;
  return out.toLowerCase();
}

/**
 * decl / excl / cont / ynq (yes-no question) / whq / trail (...). A question is a
 * wh-question when its first real word is a wh-word, skipping leading conjunctions /
 * fillers ("And where...?") and cut-off starts ("Wh-what?").
 * @param {import('./textData.js').LineAnalysis} an
 * @param {number} pi phrase index
 * @returns {string}
 */
export function phraseType(an, pi) {
  const p = an.phrases[pi];
  if (p.mark === '?') {
    const words = p.words.map((wi) => lettersLower(an.words[wi].text));
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (LEAD_WORDS.has(w)) continue;
      if (k + 1 < words.length && w.length <= 3 && words[k + 1].startsWith(w)) continue; // "wh-what", "I-I"
      return WH_WORDS.has(w) ? 'whq' : 'ynq';
    }
    return 'ynq';
  }
  switch (p.mark) {
    case '!': return 'excl';
    case ',': return 'cont';
    case '...': return 'trail';
    default: return 'decl';
  }
}
