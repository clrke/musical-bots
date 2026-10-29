// Text-analysis data (port of csharp/Mumble/Text/TextData.cs, the dataclasses of mumble/text.py).
// Changed in this copy (vs upstream magna-vocalization): Syllable.lexical (Magna.Core).
// Indices are into the LineAnalysis lists; char positions are UTF-16 indices into the line text.

/** One phone of a line. */
export class Phone {
  /**
   * @param {string} sym
   * @param {string} kind vowel / plosive / fricative / affricate / aspirate / nasal / glide / liquid
   * @param {boolean} voiced
   * @param {string} place
   * @param {number} charStart index into the line text of the phone's first letter
   * @param {number} charEnd one past its last letter
   * @param {number} word
   */
  constructor(sym, kind, voiced, place, charStart, charEnd, word) {
    this.sym = sym;
    this.kind = kind;
    this.voiced = voiced;
    this.place = place;
    this.charStart = charStart;
    this.charEnd = charEnd;
    this.word = word;
    this.syllable = -1;
    /** onset / nucleus / coda / free. */
    this.role = '';
    /** When its first letter appears (s). */
    this.t = 0.0;
    /** When the next phone's letter appears (bounded at pauses). */
    this.tNext = 0.0;
    this.wordFinal = false;
    /** Nasal / liquid used as a syllable nucleus ("hmm", "hmph"). */
    this.syllabic = false;
  }
}

/** One syllable. nucleus = -1 stands for Python's None. */
export class Syllable {
  /**
   * @param {number} word
   * @param {number} phrase
   * @param {number[]} onset
   * @param {number} nucleus phone index of the nucleus, or -1 (no nucleus)
   * @param {number[]} coda
   * @param {number} indexInWord
   * @param {number} nInWord
   */
  constructor(word, phrase, onset, nucleus, coda, indexInWord, nInWord) {
    this.word = word;
    this.phrase = phrase;
    this.onset = onset;
    this.nucleus = nucleus;
    this.coda = coda;
    this.indexInWord = indexInWord;
    this.nInWord = nInWord;
    /** 1 = primary stress of a content word, else 0. */
    this.stress = 0;
    /**
     * The pronunciation dictionary's stress digit of its vowel (1 primary, 2 secondary, 0 none),
     * -1 when not known (the rules' phones, a manual split).
     */
    this.lexical = -1;
  }
}

/** One word. */
export class Word {
  /**
   * @param {string} text
   * @param {number} charStart
   * @param {number} charEnd
   * @param {boolean} shout
   * @param {number} phrase
   * @param {boolean} functionWord
   */
  constructor(text, charStart, charEnd, shout, phrase, functionWord) {
    this.text = text;
    this.charStart = charStart;
    this.charEnd = charEnd;
    this.shout = shout;
    this.phrase = phrase;
    this.functionWord = functionWord;
    /** @type {number[]} */
    this.phones = [];
    /** @type {number[]} */
    this.syllables = [];
  }
}

/** One phrase. */
export class Phrase {
  /**
   * @param {number[]} words
   * @param {string} mark "." "," "?" "!" "..." or "" (no punctuation)
   * @param {number} tStart
   * @param {number} tEnd
   */
  constructor(words, mark, tStart, tEnd) {
    this.words = words;
    this.mark = mark;
    this.tStart = tStart;
    this.tEnd = tEnd;
  }
}

/** Full analysis of one line of dialogue. */
export class LineAnalysis {
  /**
   * @param {{text:string, dt:number, charSteps:number[], charTimes:number[], endTime:number,
   *   words:Word[], phrases:Phrase[], syllables:Syllable[], phones:Phone[],
   *   manualSplits?:Map<number, number[]>|null}} f
   */
  constructor(f) {
    this.text = f.text;
    this.dt = f.dt;
    /** Wait after each char, in letter steps. */
    this.charSteps = f.charSteps;
    /** When each char appears (s). */
    this.charTimes = f.charTimes;
    this.endTime = f.endTime;
    /** @type {Word[]} */
    this.words = f.words;
    /** @type {Phrase[]} */
    this.phrases = f.phrases;
    /** @type {Syllable[]} */
    this.syllables = f.syllables;
    /** @type {Phone[]} */
    this.phones = f.phones;
    /**
     * JS extension: words whose syllables were forced by a manual hyphenation, word index ->
     * split positions (letter indices inside the word's letters), or null.
     */
    this.manualSplits = f.manualSplits ?? null;
  }
}
