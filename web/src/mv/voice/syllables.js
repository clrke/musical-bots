// Syllables the synthesizer sings, one note each.
//
// Built on the ported mumble-speech analyzer: in the "full" / "human" modes the planner turns
// every syllable with a nucleus (a vowel, or a syllabic nasal / liquid as in "hmm") into
// exactly one voiced unit, in syllable order. Those are the syllables returned here. Words
// without one ("Shh", "psst") are not sung (they only make noise) and are not listed.
//
// A manual hyphenation ("be-lieve in you") forces the syllables of the words it covers; the
// renderer must analyse with the same hyphenation: analyze(text, dt, manual) gives exactly
// these syllables as its voiced syllables (see text/hyphenation.js).
import { analyze, LETTER_DT } from './text/analyze.js';

/**
 * @typedef {Object} SungSyllable
 * @property {string} text      this syllable's part of the word (the parts join to the word)
 * @property {string} word      the word as written in the line
 * @property {number} wordIndex word index in the analysis (words = letter runs of the line)
 * @property {number} syllable  syllable index in the analysis (LineAnalysis.syllables)
 * @property {number} charStart text = line.slice(charStart, charEnd)
 * @property {number} charEnd
 */

/**
 * Indices of the syllables that become voiced units (one note each), in order.
 * @param {import('./text/textData.js').LineAnalysis} an
 * @returns {number[]}
 */
export function voicedSyllables(an) {
  const out = [];
  for (let si = 0; si < an.syllables.length; si++) if (an.syllables[si].nucleus >= 0) out.push(si);
  return out;
}

function isLetter(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/**
 * The sung syllables of an analysis, with their spelling (the parts of each word).
 * @param {import('./text/textData.js').LineAnalysis} an
 * @returns {SungSyllable[]}
 */
export function sungSyllables(an) {
  const out = [];
  for (let wi = 0; wi < an.words.length; wi++) {
    const w = an.words[wi];
    const sung = w.syllables.filter((si) => an.syllables[si].nucleus >= 0);
    if (sung.length === 0) continue;
    // where each syllable starts in the line text
    const starts = [];
    const splits = an.manualSplits ? an.manualSplits.get(wi) : undefined;
    if (splits && splits.length + 1 === sung.length) {
      const letterPos = [];
      for (let k = 0; k < w.text.length; k++) if (isLetter(w.text[k])) letterPos.push(w.charStart + k);
      starts.push(w.charStart);
      for (const p of splits) starts.push(letterPos[p]);
    } else {
      for (let k = 0; k < sung.length; k++) {
        if (k === 0) {
          starts.push(w.charStart);
          continue;
        }
        const s = an.syllables[sung[k]];
        const ph = an.phones[s.onset.length > 0 ? s.onset[0] : s.nucleus];
        let a = ph.charStart;
        // a doubled consonant letter is split as written: "hel-lo", "lit-tle", "hap-py"
        if (ph.charEnd - a >= 2 && an.text[a].toLowerCase() === an.text[a + 1].toLowerCase()) a += 1;
        starts.push(Math.max(a, starts[k - 1]));
      }
    }
    for (let k = 0; k < sung.length; k++) {
      const a = starts[k];
      const b = k + 1 < sung.length ? starts[k + 1] : w.charEnd;
      out.push({ text: an.text.slice(a, b), word: w.text, wordIndex: wi, syllable: sung[k], charStart: a, charEnd: b });
    }
  }
  return out;
}

/**
 * The syllables the synthesizer will sing, one note each.
 * @param {string} text the line
 * @param {string|null} [manual] optional hyphenation, e.g. "be-lieve in you"
 * @returns {SungSyllable[]} ({ text, word, wordIndex } plus syllable / charStart / charEnd)
 */
export function syllabify(text, manual = null) {
  return sungSyllables(analyze(text ?? '', LETTER_DT, manual));
}
