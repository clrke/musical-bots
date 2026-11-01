#!/usr/bin/env node
// The crew's craft checks: measurable tests of how a sung line sounds and reads, on top of the hard
// rules (emit.js lineProblems / formProblems: the pronouns, the tense, brands, syllable limits, the
// song form and its rhymes, which never bend). A craft check can be wrong about a good line, so it is
// bypassable: the emit tool rejects a line that fails one with how to fix it and how to bypass it
// (resend the event with "bypass": {"<check>": "<why, in at least 4 words>"}), and records the bypass.
//
//   dictionary  every sung word is one the singer is known to pronounce as the CMU dictionary does:
//               a word of its table (web/src/mv/voice/text/cmudict.js), of knownWords.js (the
//               dictionary's other words its letter rules sing exactly right), of the lexicon's
//               hand-made exceptions (lexicon.js EXCEPTIONS: "hackathon"), an override ("Meta"), or
//               a regular form of those it sings as stem + ending ("wobbles"); cast names are fine.
//               No digits, no acronyms (the singer sings "AI" as "eye"), no letters beyond a-z.
//   rhyme       a rhyme pair ends on two different words (day / day is no rhyme); a near rhyme the
//               gate lets through (cup / cop) or the same last syllable (inside / outside) is a note
//   meter       the stresses sit on the beat: no 4 stressed syllables in a row in one phrase (the
//               duple tunes put only every other one on a beat; the engine's stress fit absorbs the
//               rest, web/src/mv/music/stressFit.js)
//   balance     the rhyming pair is sung alike: within 2 syllables and 2 stresses of each other
//   filler      no padding to fill a line: so + adjective / very / really / just + verb / quite /
//               kind of / thing / stuff / an emphatic do / a line-final "a lot" (a catchphrase, a
//               [pickup] and the pal's reply aside)
//   inversion   no word order bent for the rhyme: a noun's adjective after it ("earns the name
//               strong"), a postposed "near" ("barks at pigeons near"), a fronted object or phrase
//               before a final subject and verb ("Cake I eat", "Down the hill I run")
//   repeat      no content word in two lines of one stanza (the hook's words, the form's repeats and
//               lines that open alike aside)
//   voice       the story says "we": "I" / "me" / "my" only in a catchphrase or a dare; never (no
//               bypass) on a line that brings in or solves the plot's trouble, nor in a bridge
//   singable    a listener catches the words as the synth sings them: the mean heardChance of the
//               line's content words (a model of their sounds, fitted on Whisper transcribing every
//               story line rendered alone) is at least SING_MIN, and it never opens cold on a name of
//               a thing ("Press Premiere, they sing" is heard "Best friend in the sea")
//   genuine     (a consultation's question or follow-up, not a sung line) it puts a decision to the
//               crewmate asked: no yes or no about a fact ("Does White ring out as Why?"), no question
//               that says again what the asker's own lines just said, and Black's pitch asks whether
//               and where the story takes his problem ("Should we put the mush in verse one?")
// Calibrated on the 13 checked-in bundles (546 lines): each check rejects 0-4.6% of them.
//
// Pure (no I/O beyond the word list). `node scripts/director/craft.js --calibrate [episodes]` runs
// every check over the checked-in bundles and prints how many lines fail each, with examples.
import { inflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA as KNOWN_DATA } from './knownWords.js';
import { has as inTable, OVERRIDES } from '../../web/src/mv/voice/text/cmudict.js';
import { EXCEPTIONS, FUNCTION_WORDS } from '../../web/src/mv/voice/text/lexicon.js';
import { NAMES, CAST } from '../../web/src/gen/cast.js';
import { parseLyric } from '../../web/src/cues.js';
import { syllabify } from '../../web/src/mv/voice/syllables.js';
import { rhymeOf, rhymes, lastWord } from './rhyme.js';
import { analyze, LETTER_DT } from '../../web/src/mv/voice/text/analyze.js';

/** The craft checks, in the order the tool reports them (the keys of an event's "bypass"). */
export const CHECKS = ['dictionary', 'rhyme', 'meter', 'balance', 'filler', 'inversion', 'repeat', 'voice', 'singable', 'genuine'];
/** At most this many bypasses per agent per episode (a dictionary bypass covers its word from then on). */
export const MAX_BYPASSES = 3;
/** A bypass reason has at least this many words. */
export const MIN_REASON_WORDS = 4;
/** Run-level modes: strict (a failed check rejects unless bypassed), warn (notes only), off. */
export const MODES = ['strict', 'warn', 'off'];

const NAME_SET = new Set(NAMES.map((n) => n.toLowerCase()));
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g; // a word as the singer's analyzer reads it (analyze.js)
const wordsOf = (s) => [...String(s).matchAll(WORD_RE)].map((m) => m[0]);
const lower = (w) => w.toLowerCase().replace(/’/g, "'");

// ---------------------------------------------------------------------------------------------
// dictionary

let known = null;
/** The dictionary words outside the singer's table that its letter rules sing right (knownWords.js). */
function knownSet() {
  if (known) return known;
  const text = inflateRawSync(Buffer.from(KNOWN_DATA.replace(/\s+/g, ''), 'base64')).toString('ascii');
  known = new Set();
  let prev = '';
  for (const line of text.split('\n')) {
    if (!line) continue;
    const w = prev.slice(0, parseInt(line[0], 36)) + line.slice(1);
    known.add(w);
    prev = w;
  }
  return known;
}

/** A word the singer sings as the dictionary does, by its own entry (no derivation). */
function listed(w) {
  return NAME_SET.has(w) || NAME_SET.has(w.replace(/'s$/, '')) || Object.hasOwn(EXCEPTIONS, w.replace(/'/g, ''))
    || OVERRIDES.has(w) || inTable(w) || knownSet().has(w);
}

/** The singer's phones of a word (sung symbols) and the phone index of its stressed vowel (-1: none). */
function soundOf(w) {
  let an;
  try { an = analyze(w, LETTER_DT); } catch { return null; }
  const s = an.syllables.find((x) => x.stress && x.nucleus >= 0);
  return { p: an.phones.map((x) => x.sym), stress: s ? s.nucleus : -1 };
}
const SIBILANT = new Set(['s', 'z', 'sh', 'zh', 'ch', 'j']);
const VOICELESS = new Set(['p', 't', 'k', 'f', 'th', 's', 'sh', 'ch']);
/** The sounds a regular ending adds after a stem ending on `last` (English allomorphy: cats s, dogs z, buses ih z). */
function endings(kind, last) {
  switch (kind) {
    case 's': return SIBILANT.has(last) ? [['ih', 'z'], ['schwa', 'z']] : VOICELESS.has(last) ? [['s']] : [['z']];
    case 'ed': return last === 't' || last === 'd' ? [['ih', 'd'], ['schwa', 'd']] : VOICELESS.has(last) ? [['t']] : [['d']];
    case 'ing': return [['ih', 'ng']];
    case 'er': return [['er']];
    case 'est': return [['ih', 's', 't'], ['schwa', 's', 't']];
    case 'ly': return [['l', 'ee']];
    case 'y': return [['ee']];
    default: return [];
  }
}
/**
 * Stems a word may be a regular form of, the likeliest first: [stem, ending kind] ("taped": tape
 * before tap; "tapped": tap; "slices": slice).
 */
function stemsOf(w) {
  const out = [];
  const add = (stem, kind) => { if (stem.length >= 2 && /[aeiouy]/.test(stem)) out.push([stem, kind]); };
  const undouble = (s) => (/([bdgklmnprtz])\1$/.test(s) ? s.slice(0, -1) : null);
  if (/'s$/.test(w)) add(w.slice(0, -2), 's');
  const tries = [['ies', 's', 'y'], ['es', 's', ''], ['s', 's', ''], ['ied', 'ed', 'y'], ['ed', 'ed', ''], ['ing', 'ing', ''],
    ['ier', 'er', 'y'], ['er', 'er', ''], ['iest', 'est', 'y'], ['est', 'est', ''], ['ily', 'ly', 'y'], ['ly', 'ly', ''], ['y', 'y', '']];
  for (const [end, kind, back] of tries) {
    if (!w.endsWith(end) || w.length - end.length < 2) continue;
    const s = w.slice(0, -end.length) + back;
    if (end === 'es') { add(s, kind); add(`${s}e`, kind); continue; } // boxes = box + es; slices = slice + s
    if (back || kind === 's') { add(s, kind); continue; }
    add(`${s}e`, kind);
    const u = undouble(s);
    if (u) add(u, kind);
    add(s, kind);
  }
  return out;
}
const startsWith = (p, s) => s.length <= p.length && s.every((x, i) => p[i] === x);
const same = (a, b) => a.length === b.length && a.every((x, i) => b[i] === x);
/**
 * A word the dictionary lacks but the singer sings consistently with a word it knows: a regular form
 * of a known stem whose phones are the stem's plus the ending's right sound ("wobbles" = "wobble" +
 * z, "softens" + z, "munches" + ih z, "happier"; a stem's final schwa may drop: "wobbling"), stressed
 * where the stem is. The likeliest known stem decides; a form the singer bends ("basting" sung like
 * "bast", not "baste") stays unknown.
 */
function derived(w) {
  if (w.includes("'") && !/'s$/.test(w)) return false;
  const me = soundOf(w.replace(/'s$/, 's'));
  if (!me) return false;
  for (const [stem, kind] of stemsOf(w)) {
    if (!listed(stem)) continue;
    const s = soundOf(stem);
    if (!s || s.stress < 0 || s.stress !== me.stress) return false;
    const bases = [s.p];
    if (s.p.length >= 2 && s.p.at(-2) === 'schwa' && ['l', 'n', 'r'].includes(s.p.at(-1)) && s.stress < s.p.length - 2) bases.push([...s.p.slice(0, -2), s.p.at(-1)]);
    return bases.some((base) => startsWith(me.p, base) && endings(kind, base.at(-1)).some((e) => same(me.p.slice(base.length), e)));
  }
  return false;
}

/**
 * Whether the singer is known to sing a word as the CMU dictionary does: a cast name (or its
 * possessive), a lexicon exception, an override, a word of the singer's table or of knownWords.js,
 * or a regular form or compound of those it sings consistently (derived()).
 */
export function knownWord(word) {
  const w = lower(String(word));
  if (!/^[a-z]+(?:'[a-z]+)*$/.test(w)) return false;
  return listed(w) || derived(w);
}

/**
 * The words of a sung text the singer does not know: [{ word, why }] (why: "unknown", "acronym",
 * "digits", "letters"). allow: lower-case words accepted for this episode (an earlier bypass).
 */
export function unknownWords(text, allow = null) {
  const s = String(text ?? '');
  const out = [];
  const seen = new Set();
  for (const w of wordsOf(s)) {
    const k = lower(w);
    if (seen.has(k)) continue;
    seen.add(k);
    if (allow?.has(k)) continue;
    if (/^[A-Z]{2,}$/.test(w.replace(/['’]s$/, '')) && !NAME_SET.has(k)) out.push({ word: w, why: 'acronym' });
    else if (!knownWord(w)) out.push({ word: w, why: 'unknown' });
  }
  const digits = s.match(/\d+/g);
  if (digits) out.push({ word: digits[0], why: 'digits' });
  const odd = s.match(/[^\x00-\x7F’—–…]/gu)?.filter((c) => /\p{L}/u.test(c));
  if (odd?.length) out.push({ word: odd[0], why: 'letters' });
  return out;
}

function dictionaryFinding(text, allow, what = 'line') {
  const bad = unknownWords(text, allow);
  if (!bad.length) return null;
  const say = bad.map(({ word, why }) => (why === 'acronym' ? `"${word}" (an acronym: the singer sings it as a word, "AI" as "eye", never letter by letter)`
    : why === 'digits' ? `"${word}" (digits are not sung: write the number as words)`
      : why === 'letters' ? `"${word}" (the singer only reads plain a-z letters)` : `"${word}"`));
  return {
    check: 'dictionary', severity: 'reject', words: bad.filter((b) => b.why === 'unknown').map((b) => lower(b.word)),
    message: `the singer does not know ${say.join(', ')}: it would guess ${bad.length > 1 ? 'them' : 'it'} by its spelling rules (that is how "hackathon" came out "hack-KA-thun")`,
    fix: `use a common word it knows${what === 'summary' ? '' : ' (a cast name is always fine)'}`,
    bypass: 'it is a name or a word the premise or the fact sheet gives (once bypassed, the word is fine for the rest of the episode)',
  };
}

// ---------------------------------------------------------------------------------------------
// rhyme quality

/** The last sung syllable of a line: { onset, vowel, coda } (sung symbols) or null. */
function lastSyllable(lyric) {
  const text = parseLyric(lyric, NAMES).text.replace(/[^A-Za-z' -]/g, ' ').trim();
  if (!text) return null;
  let an;
  try { an = analyze(text, LETTER_DT); } catch { return null; }
  const s = an.syllables.filter((x) => x.nucleus >= 0).at(-1);
  if (!s) return null;
  const sym = (i) => an.phones[i].sym;
  return { onset: s.onset.map(sym).join(' '), vowel: sym(s.nucleus), coda: s.coda.map(sym).join(' ') };
}

/** How two rhyming lines rhyme: null (well), or a finding (the same word: reject; near or the same syllable: a note). */
export function rhymeFinding(other, lyric) {
  const a = lastWord(other).toLowerCase().replace(/'s$/, ''), b = lastWord(lyric).toLowerCase().replace(/'s$/, '');
  if (!a || !b) return null;
  if (a === b) {
    return {
      check: 'rhyme', severity: 'reject', message: `"${lastWord(lyric)}" rhymes with itself (the line it answers ends on "${lastWord(other)}" too): that is no rhyme`,
      fix: `end on a different word that rhymes with "${lastWord(other)}"`, bypass: 'the repeat is deliberate and the story needs it',
    };
  }
  if (!rhymes(other, lyric)) return null; // the hard gate reports it
  const x = rhymeOf(other), y = rhymeOf(lyric);
  // (before an r the dictionary splits vowels that sing alike, near / hear: no near rhyme there)
  if (x && y && x.vowel !== y.vowel && !x.coda.startsWith('r')) {
    return { check: 'rhyme', severity: 'note', message: `"${lastWord(other)}" / "${lastWord(lyric)}" is a near rhyme (its vowels differ): a true rhyme rings better` };
  }
  const p = lastSyllable(other), q = lastSyllable(lyric);
  if (p && q && p.onset === q.onset && p.vowel === q.vowel && p.coda === q.coda) {
    return { check: 'rhyme', severity: 'note', message: `"${lastWord(other)}" / "${lastWord(lyric)}" end on the same syllable, first sound and all: a rhyme with a new first sound rings better (day / play, not day / today)` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// meter and balance

const STRESSED = 2;
/** A line's own sung syllables (the [pickup] aside) with their stress levels (sungStress.js). */
function sungOf(lyric) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  const all = syllabify(text);
  const m = pickup ? syllabify(pickup).length : 0;
  return m > 0 && m < all.length ? all.slice(m) : all;
}
const stressCount = (syl) => syl.filter((s) => s.stress >= STRESSED).length;

// little words the singer stresses (they are not its function words) that a tune sets on a weak beat
// as readily: they neither count in a pile-up nor break it ("Sharp teeth chew through meat" is 4)
const LIGHT_STRESS = new Set(('through up out down off over past like near round each every this that these those some any no so '
  + 'too just very now then here there way must could would should him who what than').split(' '));

/**
 * The longest run of stressed content syllables a line sings in one phrase (no comma between), with
 * the singer's own stress levels (sungStress.js: a one-syllable content word is stressed, "the" /
 * "a" / "and" are weak; the light words above are skipped). The tunes are in duple time: of N
 * stresses in a row, at most every other one can take a beat, so a run of METER_RUN or more stomps
 * ("SUN FILLS BIG KIT-chen", the article dropped) however the engine's stress fit moves the notes
 * (measured: after the fit, the residual stress-vs-beat mismatch is zero for 96% of the checked-in
 * lines; what it cannot fix is a pile-up). Returns { run, words } (the words the run is sung on).
 */
export function stressRun(lyric) {
  const syl = sungOf(lyric);
  let best = { run: 0, at: [] }, run = 0, at = [], phrase = -1;
  for (const s of syl) {
    if (s.phrase !== phrase) { run = 0; at = []; phrase = s.phrase; }
    if (LIGHT_STRESS.has(lower(s.word)) && s.stress >= STRESSED) { if (run) at.push(s.wordIndex); continue; }
    if (s.stress >= STRESSED) { run++; at.push(s.wordIndex); } else { run = 0; at = []; }
    if (run > best.run) best = { run, at: [...at] };
  }
  const words = [...new Set(best.at)].map((k) => syl.find((s) => s.wordIndex === k).word);
  return { run: best.run, words };
}
export const METER_RUN = 4;

function meterFinding(lyric) {
  const { run, words } = stressRun(lyric);
  if (run < METER_RUN) return null;
  return {
    check: 'meter', severity: 'reject',
    message: `its stresses pile up: "${words.join(' ')}" sings ${run} stressed syllables back to back, and the tune can put only every other one on a beat, so the line stomps (often a little word is missing: "Sun fills big kitchen" wants "the")`,
    fix: 'let the stresses alternate with weak syllables (da-DUM da-DUM): add an article or a little word, or use a two-syllable word', bypass: 'it is a chant meant to stomp',
  };
}

/** Whether two rhyming lines are sung alike: { syllables: [a, b], stresses: [a, b] } off by too much, else null. */
export function balanceOff(other, lyric) {
  const a = sungOf(other), b = sungOf(lyric);
  if (!a.length || !b.length) return null;
  const ds = Math.abs(a.length - b.length), dt = Math.abs(stressCount(a) - stressCount(b));
  return ds > BALANCE_SYLLABLES || dt > BALANCE_STRESSES ? { syllables: [a.length, b.length], stresses: [stressCount(a), stressCount(b)] } : null;
}
export const BALANCE_SYLLABLES = 2;
export const BALANCE_STRESSES = 2;
function balanceFinding(other, lyric) {
  const off = balanceOff(other, lyric);
  if (!off) return null;
  return {
    check: 'balance', severity: 'reject',
    message: `it does not balance the line it rhymes with ("${parseLyric(other, NAMES).text}"): ${off.syllables[1]} sung syllables and ${off.stresses[1]} stresses against ${off.syllables[0]} and ${off.stresses[0]}, so the tune's answer limps`,
    fix: `match its length and stresses (within ${BALANCE_SYLLABLES} syllables and ${BALANCE_STRESSES} stresses)`, bypass: 'it is a deliberate short punch line',
  };
}

// ---------------------------------------------------------------------------------------------
// filler

const CATCHPHRASES = Object.values(CAST).map((c) => c.says.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim());
const PRONOUN_NEXT = new Set(['i', 'you', 'he', 'she', 'it', 'they', 'the', 'a', 'an', 'my', 'his', 'her', 'its', 'your', 'their', 'that', 'this', 'there', 'then', 'now', 'long', 'far']);
const FILLER_WORDS = new Set(['very', 'really', 'just', 'quite', 'kinda', 'sorta', 'totally', 'basically', 'literally', 'simply', 'truly', 'thing', 'things', 'stuff']);
const FILLER_PAIRS = [['kind', 'of'], ['sort', 'of']];
const EMPHATIC_DO = new Set(['do', 'does', 'did']);
// "just" that means "only" or "exactly" ("just for you", "just the same", "just in time"): not filler
const JUST_MEANS = new Set(['for', 'the', 'a', 'an', 'in', 'like', 'right', 'one', 'two', 'me', 'you', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'as', 'enough', 'once', 'now', 'then', 'about', 'because', 'when']);

/** The padding words of a line (its [pickup] and reply aside): [word...] */
export function fillerWords(lyric) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  let body = pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text;
  const flat = ` ${body.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const c of CATCHPHRASES) if (flat.includes(` ${c} `)) body = flat.replace(` ${c} `, ' ');
  const w = wordsOf(body).map(lower);
  const out = [];
  w.forEach((x, i) => {
    if (FILLER_WORDS.has(x)) {
      if (x === 'really' && i === 0 && /^\s*really\s*[?!]/i.test(body)) return; // Navy's "Really?"
      if (x === 'just' && (!w[i + 1] || JUST_MEANS.has(w[i + 1]))) return;
      out.push(x);
    } else if (x === 'so' && i > 0 && w[i + 1] && !PRONOUN_NEXT.has(w[i + 1])) out.push(`so ${w[i + 1]}`);
    else if (FILLER_PAIRS.some(([a, b]) => x === a && w[i + 1] === b)) out.push(`${x} ${w[i + 1]}`);
    else if (EMPHATIC_DO.has(x) && i > 0 && ['i', 'you', 'he', 'she', 'it', 'they'].includes(w[i - 1]) && w[i + 1] && !/n't$|^not$/.test(w[i + 1]) && !/\?\s*$/.test(body)) out.push(`${x} ${w[i + 1]}`);
  });
  if (w.length > 3 && w.at(-2) === 'a' && w.at(-1) === 'lot') out.push('a lot'); // "past a lot", "holds a lot": a rhyme bought cheap
  return out;
}
function fillerFinding(lyric) {
  const f = fillerWords(lyric);
  if (!f.length) return null;
  return {
    check: 'filler', severity: 'reject',
    message: `${f.map((x) => `"${x}"`).join(', ')} ${f.length > 1 ? 'pad' : 'pads'} the line: a word that only fills the beat`,
    fix: 'spend the syllables on a picture (a color, a sound, a thing) or a plot step', bypass: 'the word means something here',
  };
}

// ---------------------------------------------------------------------------------------------
// inversion

// adjectives that (nearly) never end a noun phrase in plain speech: "the name strong"
const ADJECTIVES = new Set(('strong sweet tall small big tiny huge pink red blue green yellow purple brown new old sad glad happy '
  + 'shy neat grand true dear bright soft round flat full empty shiny silly funny sunny snowy rainy cozy fuzzy sticky muddy messy '
  + 'tidy dirty wet sharp rough thick thin heavy young merry jolly gentle strange wild proud brave bold kind nice great good bad '
  + 'golden sour fresh crisp lovely pretty ugly lonely sleepy hungry tired busy lucky grumpy cheeky fancy plain tasty yummy deep').split(' '));
// verbs that take an object and an adjective after it ("paint the fence gold", "keep it warm", "hold the rung tight")
const RESULTATIVE = new Set(('make keep paint color colour dye turn get leave hold set push pull smooth pat wipe brush rub scrub lick eat '
  + 'drink serve pour like love want need prefer find call slice cut fold tie kick knock shake spin sweep wash fill pack squeeze '
  + 'press roll stir tear rip throw open shut wrap stretch bake cook fry boil chill warm heat cool fix build dig stack pile lift '
  + 'raise lay put place have prove think wish bring stay grow').split(' '));
const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'his', 'her', 'its', 'your', 'their', 'this', 'that', 'each', 'every', 'some', 'no', 'one']);
const PREPOSITIONS = new Set(['at', 'on', 'in', 'by', 'with', 'to', 'for', 'from', 'of', 'past', 'over', 'under', 'near', 'through']);
const SUBJECTS = new Set(['i', 'you', 'he', 'she', 'it', 'they']);
const NOMINATIVE = new Set(['i', 'he', 'she', 'they']); // a subject that is never an object
// a fronted word that starts a plain clause ("When the bell rings I sing", "And I sing")
const CLAUSE_START = new Set(['and', 'but', 'so', 'then', 'now', 'here', 'there', 'when', 'if', 'as', 'because', 'while', 'until', 'till',
  'before', 'after', 'once', 'since', 'where', 'how', 'what', 'who', 'that', 'yes', 'no', 'oh', 'look', 'see', 'wait', 'please', 'actually',
  'okay', 'well', 'wow', 'again', 'today', 'tonight']);
// a lone particle may lead its subject ("Off I go", "Up I climb"); with a noun after it, it is a fronted phrase ("Down the hill I run")
const PARTICLES = new Set(['away', 'off', 'up', 'down', 'in', 'out', 'back', 'home', 'over', 'round', 'around']);
const stem = (w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(?<=[a-z]{3})(es|s)$/, '');

/**
 * Word order bent for the rhyme: a description, or null. Measured on the plain shapes a forced line
 * takes: a noun's adjective after it ("earns the name strong"), "near" after its noun ("barks at
 * pigeons near"), a line's subject and verb last behind a fronted object or phrase ("Cake I eat",
 * "Down the hill I run"), an adjective before "is" ("Sweet is the cake").
 */
export function inversionOf(lyric) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  const body = (pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text).trim();
  const clause = body.split(/[,;:—–!?]/).filter((c) => c.trim()).at(-1) ?? ''; // the last phrase: an apposition after a comma ("thick and hot") is fine
  const w = wordsOf(clause).map(lower);
  const n = w.length;
  if (n >= 3) {
    const [v, det, noun, adj] = [w[n - 4], w[n - 3], w[n - 2], w[n - 1]];
    // "... earns the name strong": determiner + noun + adjective at the end, after a verb that takes no result
    if (ADJECTIVES.has(adj) && DETERMINERS.has(det) && !ADJECTIVES.has(noun) && !DETERMINERS.has(noun)
      && !(v && RESULTATIVE.has(stem(v)))) return `"${det} ${noun} ${adj}" puts the adjective after its noun`;
    // "... barks at pigeons near"
    if (adj === 'near' && (PREPOSITIONS.has(det) || DETERMINERS.has(det)) && !SUBJECTS.has(noun) && !/ing$/.test(noun)) return `"${noun} near" puts "near" after its noun`;
    // "Cake I eat", "Down the hill I run": subject + verb at the end, behind a fronted object or phrase
    // (a noun phrase with its relative clause is plain: "The cake I bake", "Each day I sing")
    const front = w.slice(0, n - 2);
    if (NOMINATIVE.has(w[n - 2]) && !FUNCTION_WORDS.has(w[n - 1]) && !CLAUSE_START.has(front[0]) && !NOMINATIVE.has(front[0])
      && !DETERMINERS.has(front[0]) && !/ly$/.test(front[0]) && !NAME_SET.has(front[0]) && !(front.length === 1 && PARTICLES.has(front[0]))
      && !front.some((x) => ['and', 'but', 'so', 'then', 'or'].includes(x))) {
      return `"${w.join(' ')}" puts "${front.join(' ')}" before its subject and verb`;
    }
  }
  // "Sweet is the cake"
  if (n >= 3 && ADJECTIVES.has(w[0]) && ['is', 'are'].includes(w[1])) return `"${w.slice(0, 3).join(' ')}" puts the adjective before "${w[1]}"`;
  return null;
}
function inversionFinding(lyric) {
  const why = inversionOf(lyric);
  if (!why) return null;
  return {
    check: 'inversion', severity: 'reject', message: `${why}: word order bent for the rhyme reads as a forced line`,
    fix: 'say it in plain word order and find another rhyme', bypass: 'it is a set phrase in this order',
  };
}

// ---------------------------------------------------------------------------------------------
// repeat

const LIGHT = new Set(('am is are be been being was were has have had do does did can could would should may might must '
  + 'get gets got go goes going say says said make makes made let lets see sees saw look looks one two up down out off on in '
  + 'not no yes oh so too very just now then here there what who how when where why all some any more most much many own '
  + 'me my mine you your he him his she her it its they them their this that these those with for from of to at by as and but or if').split(' '));
/** The content words of a line (its reply aside; names and other capitalized names aside), stemmed: Set. */
export function contentWords(lyric) {
  const text = parseLyric(lyric, NAMES).text;
  const all = wordsOf(text);
  return new Set(all.filter((x, i) => !(i > 0 && /^[A-Z]/.test(x) && x !== 'I') && !NAMES.includes(x.replace(/'s$/, ''))).map(lower) // a name is Capitalised: "gold" is a word
    .filter((x) => !FUNCTION_WORDS.has(x) && !LIGHT.has(x) && !DETERMINERS.has(x) && x.length > 2).map(stem));
}
/** Two lines that open alike ("I fear you feel blue" / "I fear an empty plate"): a deliberate parallel. */
const opening = (lyric) => wordsOf(parseLyric(lyric, NAMES).text).slice(0, 2).map(lower).join(' ');
function repeatFinding(lyric, others, hookWords, rhymed = null) {
  const mine = contentWords(lyric);
  if (rhymed) mine.delete(stem(rhymed)); // the rhyme check reports a word that rhymes with itself
  const hits = [];
  for (const o of others) {
    if (opening(o) === opening(lyric) && opening(lyric).includes(' ')) continue;
    for (const x of contentWords(o)) if (mine.has(x) && !hookWords.has(x) && !hits.includes(x)) hits.push(x);
  }
  if (!hits.length) return null;
  return {
    check: 'repeat', severity: 'reject',
    message: `${hits.map((x) => `"${x}"`).join(', ')} ${hits.length > 1 ? 'are' : 'is'} already sung in this stanza: a stanza says each thing once`,
    fix: 'say it with a new word, or show something new', bypass: 'it is a deliberate echo or parallel the story needs',
  };
}

// ---------------------------------------------------------------------------------------------
// voice: the story sings "we"

// "I", "me", "my" (the capital "I" only; "you and me" counts as "we")
const SINGULAR = /(^|[^A-Za-z'’])(I|I['’]m|I['’]ve|I['’]d|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)(?![A-Za-z'’])/g;
const DARE_RE = /\b(dare|dares|bet)\b/i;
/**
 * The singular first-person words of a story line's own text (its reply aside: the pal may say
 * "For me?"), or [] when the line is a character's own: its catchphrase ("Hold my juice", "Trust
 * me") or a dare ("Stay out late, I dare", "Bet you cannot"). "You and me" is the cast together.
 */
export function singularOf(lyric) {
  const { text } = parseLyric(lyric, NAMES);
  const flat = ` ${text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (CATCHPHRASES.some((c) => flat.includes(` ${c} `)) || DARE_RE.test(text)) return [];
  const plain = text.replace(/\b(you and me|me and you)\b/gi, 'us');
  return [...plain.matchAll(SINGULAR)].map((m) => m[2]);
}
/**
 * Whether a line must say "we" with no bypass: a line that brings in or solves the plot's trouble
 * (`trouble` / `resolves`: the friends fix it together) or a bridge line (sung for all of them).
 */
export const weOnly = (section, { plot = false } = {}) => plot || /^bridge/.test(section);
function voiceFinding(lyric, section, plot) {
  const w = singularOf(lyric);
  if (!w.length) return null;
  const strict = weOnly(section, { plot });
  const where = plot ? 'it brings in or solves the plot\'s trouble, and the friends do that together'
    : /^bridge/.test(section) ? 'a bridge is sung for all of them' : 'the cast sings the story as one';
  return {
    check: 'voice', severity: 'reject', words: [...new Set(w)],
    message: `${[...new Set(w)].map((x) => `"${x}"`).join(', ')}: the story says "we", not "I" (${where}); "I" is only for a catchphrase or a dare`,
    fix: `say it in "we" / "us" / "our" ("I tie the rope up tight" becomes "We tie the rope up tight", "I sing the new lines now" becomes "We sing the new lines now")`,
    bypass: strict ? null : 'it is the character\'s own boast or dare',
  };
}

// ---------------------------------------------------------------------------------------------
// singable: the words a listener catches

/**
 * How likely a listener catches a content word as the synth voice sings it: a logistic model of
 * the word's sounds, fitted on Whisper (large-v3) transcribing every premiere story line of the 14
 * curated bundles rendered alone by the voice engine, as arrange() sets it, in two voices (1600
 * content words x 2; 2-fold cross-validated by episode: lines predicted under 0.35 were heard 35%,
 * over 0.65 71%). Log-odds per sound present: the synth's "ng" fades ("sing" heard "sea", "song"
 * "soy"), its "oh" and "g" / "l" blur ("glow" heard as "door", "flows", "go": 0 of 13), "uu"
 * (book, look) and "z" are weak; "er", "sh", "j", "f", "r", "h" and a schwa ring clear. To measure
 * again: scripts/render/sung-lines.mjs (the lines, rendered) and scripts/render/sung_recall.py (Whisper).
 */
export const SOUND_WEIGHTS = Object.freeze({
  bias: 0.13, ae: -0.35, ah: 0.3, 'ah-ee': 0.23, 'ah-oo': 0.13, aw: 0.36, b: -0.24, ch: 0.29, d: 0.15, dh: 0.28, ee: -0.11, eh: -0.07,
  'eh-ee': 0.3, er: 0.96, f: 0.41, g: -0.62, h: 0.41, ih: -0.2, j: 0.62, k: -0.4, l: -0.35, m: 0.01, n: 0.12, ng: -0.68, oh: -0.66,
  oo: 0.24, p: -0.37, r: 0.43, s: 0.28, schwa: 0.57, sh: 0.7, t: -0.17, th: -0.31, uh: 0.09, uu: -0.83, v: -0.04, w: 0.23, y: -0.55,
  z: -0.56, endsStop: -0.24, endsNg: -0.43, proper: -0.56,
});
const STOP_SOUNDS = new Set(['p', 't', 'k', 'b', 'd', 'g']);
const heardMemo = new Map();
/** The chance a listener catches a word as sung (0-1); proper: a name that is no cast name (a brand, a title). */
export function heardChance(word, { proper = false } = {}) {
  const w = lower(word).replace(/'s$/, '');
  const key = `${w}|${proper}`;
  if (heardMemo.has(key)) return heardMemo.get(key);
  let an;
  try { an = analyze(w, LETTER_DT); } catch { return 0.5; }
  const ph = an.phones.map((x) => x.sym);
  let z = SOUND_WEIGHTS.bias;
  for (const p of new Set(ph)) z += SOUND_WEIGHTS[p] ?? 0;
  const last = ph.at(-1);
  if (STOP_SOUNDS.has(last)) z += SOUND_WEIGHTS.endsStop;
  if (last === 'ng') z += SOUND_WEIGHTS.endsNg;
  if (proper) z += SOUND_WEIGHTS.proper;
  const p = 1 / (1 + Math.exp(-z));
  heardMemo.set(key, p);
  return p;
}
/** Below this a line's content words are mostly lost (calibrated: see the README's craft table). */
export const SING_MIN = 0.35;
/** A word this hard to catch is named in the message, with a clearer one when the table has it. */
export const WEAK_WORD = 0.3;
/** Clearer words for weak ones the lyrics use (each scored higher by heardChance). */
export const CLEARER = Object.freeze({
  glow: ['shine', 'light'], glows: ['shines', 'lights up'], glowing: ['shining', 'bright'], song: ['tune', 'cheer'], songs: ['tunes'],
  sing: ['cheer', 'chant'], sings: ['cheers'], singing: ['cheering'], ring: ['chime'], rings: ['chimes'], long: ['far'], along: ['ahead'],
  look: ['see', 'peek'], looks: ['sees', 'peeks'], book: ['story'], books: ['stories'], block: ['street'], bowl: ['cup', 'dish'],
  bowls: ['cups', 'dishes'], cold: ['chilly', 'icy'], hold: ['keep', 'hug'], holds: ['keeps', 'hugs'], close: ['near'], lid: ['top'],
  glad: ['happy'], big: ['huge'], bag: ['sack'], snow: ['frost'], slow: ['soft'], flow: ['pour'], hums: ['whistles'], lamp: ['light'],
  lamps: ['lights'], laptop: ['screen'], plays: ['dances'], play: ['dance', 'fun'], bang: ['drum'], wing: ['wind'], king: ['chief'],
  gold: ['yellow'], go: ['run', 'race'], goes: ['runs', 'races'], blocks: ['streets'], box: ['chest'], track: ['race'], glance: ['peek'],
});
// names of things (not of the cast) the lyrics sing: a line that opens on one is not caught
export const BRANDS = new Set(['muse', 'meta', 'musical', 'premiere', 'indie', 'hackathon']);
const isContent = (w) => !FUNCTION_WORDS.has(lower(w)) && !NAME_SET.has(lower(w).replace(/'s$/, '')) && lower(w) !== 'i';

/**
 * How singable a line is: { score (the mean heardChance of the content words it could say
 * otherwise: function words, cast names, names of things and the words it keeps aside), weak ([{ word, p, clearer }] under WEAK_WORD, weakest first), coldOpen (the
 * line's first sung words when it opens on a name no listener can guess, a brand or a title, or on
 * a word before one: "Muse hums..." is heard "Use...", "Press Premiere..." "Best friend...",
 * "Hackathon win!" "Hager's on", where "We press Premiere", "We are the Musical Bots" and "We win
 * the hackathon" are caught) }. keep: lower-case words the line must keep (the hook's, the
 * premise's), never named as weak; things: more lower-case names of things (BRANDS: the premise's
 * capitalised words). A [pickup] does not save a cold open (measured: "[And] Musical Bots wins tonight" heard "And you see
 * the box...", "[So] Press Premiere" "So please, please"): the line after it opens on its own. The reply is not scored.
 */
export function singability(lyric, { keep = null, things = null } = {}) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  const all = wordsOf(pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text);
  const thing = (w) => !!w && (BRANDS.has(lower(w)) || !!things?.has(lower(w)));
  // the words the line could say otherwise: its content words, the names of things (proper nouns, the
  // premise's and the hook's words: the opening rule below is theirs) aside
  const scored = [];
  all.forEach((w, i) => {
    if (!isContent(w) || thing(w) || keep?.has(lower(w)) || (i > 0 && /^[A-Z]/.test(w))) return;
    scored.push({ word: w, i, p: heardChance(w) });
  });
  const score = scored.length ? scored.reduce((a, x) => a + x.p, 0) / scored.length : 1;
  const weak = scored.filter((x) => x.p < WEAK_WORD).sort((a, b) => a.p - b.p)
    .map((x) => ({ word: x.word, p: x.p, clearer: (CLEARER[lower(x.word)] ?? []).filter((c) => c.split(' ').every((y) => heardChance(y) > x.p + 0.1)) }));
  const [a0, b] = all;
  const a = a0 && a0[0].toUpperCase() + a0.slice(1); // (after a pickup the line's first word is lower case)
  let coldOpen = null;
  if (a && isContent(a)) {
    if (thing(a)) coldOpen = thing(b) || (b && /^[A-Z]/.test(b) && !NAMES.includes(b)) ? `${a} ${b}` : a;
    else if (b && /^[A-Z]/.test(b) && isContent(b) && b !== 'I') coldOpen = `${a} ${b}`;
  }
  return { score, weak, coldOpen };
}

function singableFinding(lyric, keep, things) {
  const { score, weak, coldOpen } = singability(lyric, { keep, things });
  if (score >= SING_MIN && !coldOpen) return null;
  const why = [];
  if (coldOpen) why.push(`it opens cold on "${coldOpen}": a name nobody can guess loses its first sound ("Muse hums" is heard "Use...", "Press Premiere" "Best friend"); put a little word first ("We press Premiere", "We win the hackathon", "We are the Musical Bots")`);
  if (score < SING_MIN) {
    const say = weak.slice(0, 3).map((x) => `"${x.word}" (${Math.round(100 * x.p)}%${x.clearer.length ? `: try ${x.clearer.map((c) => `"${c}"`).join(' or ')}` : ''})`);
    why.push(`its words are hard to catch as the voice sings them: a listener gets about ${Math.round(100 * score)}% of them${say.length ? `; the weakest ${say.join(', ')}` : ''}`);
  }
  return {
    check: 'singable', severity: 'reject', score, words: weak.map((x) => lower(x.word)),
    message: why.join('; and '),
    fix: 'use words with clear sounds (the voice blurs a final "ng", the "oh" in "glow", "g", "l", "z"; it rings on "sh", "ch", "f", "r", "er": "We sway beneath the light", not "the glow"), and open on a little word ("We", "The", "Our") before a name or a brand',
    bypass: 'the fact sheet requires this exact name or word',
  };
}

// ---------------------------------------------------------------------------------------------
// one line in its stanza

/** Stanza positions a line's words are fixed by the song form (the hook, chorus 2, chorus 3 X, the callback). */
export function fixedByForm(section, pos) {
  if (section === 'chorus2') return true;
  if (/^chorus/.test(section) && (pos === 0 || pos === 2)) return true;
  if (section === 'chorus3' && pos === 1) return true;
  if (section === 'outro' && pos <= 1) return true;
  return false;
}
/** The hook lines (chorus lines 1 and 3, the outro's first): never bypassed. */
export const isHookLine = (section, pos) => (/^chorus/.test(section) && (pos === 0 || pos === 2)) || (section === 'outro' && pos === 0);
/** The line a rhyme pair answers: the stanza position it rhymes with, or -1. */
export function rhymePartner(section, pos) {
  if (pos === 3 && /^(verse|bridge|chorus1|chorus3)/.test(section)) return 1;
  return -1;
}

/**
 * The craft findings of one sung line: [{ check, severity: 'reject'|'note', message, fix, bypass, words? }].
 * ctx: { section, pos, stanza (the beat's earlier lines, lyrics in order), hook, frame (chorus 3's
 * turned line: chorus 1's Y, whose frame it keeps), allow (Set: words an earlier bypass accepted), plot (the
 * line carries `trouble` or `resolves`: its voice check never bends), premise (the episode's prompt: its words
 * are kept, its capitalised ones are names of things) }.
 * A line the song form fixes (the hook, chorus 2, chorus 3's X, the callback) is checked once, where
 * it is first written: here only its reply.
 */
export function lineCraft(lyric, ctx = {}) {
  const { section = 'verse1', pos = 0, stanza = [], hook = '', frame = null, allow = null, plot = false, premise = '' } = ctx;
  const out = [];
  const { text, reply } = parseLyric(lyric, NAMES);
  const fixed = fixedByForm(section, pos);
  const sung = fixed ? reply : `${text} ${reply ?? ''}`;
  const dict = dictionaryFinding(sung, allow);
  if (dict) out.push(dict);
  if (fixed) return out;
  const partner = rhymePartner(section, pos);
  const other = partner >= 0 ? stanza[partner] : null;
  let rhymed = null;
  if (other) {
    const r = rhymeFinding(other, lyric);
    if (r) out.push(r);
    if (r?.severity === 'reject') rhymed = lastWord(lyric).toLowerCase().replace(/'s$/, '');
  }
  const m = meterFinding(lyric);
  if (m) out.push(m);
  if (other) {
    const b = balanceFinding(other, lyric);
    if (b) out.push(b);
  }
  const f = fillerFinding(lyric);
  if (f) out.push(f);
  const inv = inversionFinding(lyric);
  if (inv) out.push(inv);
  const hookWords = new Set([...(hook ? contentWords(hook) : []), ...(frame ? contentWords(frame) : [])]);
  const others = stanza.filter((l, k) => k !== pos && !(isHookLine(section, k)));
  const rep = repeatFinding(lyric, others, hookWords, rhymed);
  if (rep) out.push(rep);
  const v = voiceFinding(lyric, section, plot);
  if (v) out.push(v);
  const sg = singableFinding(lyric, new Set([...hookWords, ...premiseWords(premise), ...(allow ?? [])]), premiseThings(premise));
  if (sg) out.push(sg);
  return out;
}

/** The words of the premise (the episode's one-line prompt), lower case: the hook may sing them unknown. */
export const premiseWords = (prompt) => new Set(wordsOf(prompt ?? '').map(lower));
/** The premise's names of things (its capitalised words after the first, cast names aside), lower case: "meta", "hackathon". */
export const premiseThings = (prompt) => new Set(wordsOf(prompt ?? '').filter((w, i) => i > 0 && /^[A-Z]/.test(w) && !NAMES.includes(w) && w !== 'I').map(lower));

/**
 * The craft findings of the plan's hook (the director's: never bypassed). allow: the premise's own
 * words (the hook keeps the premise's key word; one the singer does not know is accepted there, and
 * reported, so a lexicon entry can follow: "hackathon").
 */
export function hookCraft(hook, { allow = null, things = null } = {}) {
  const out = [];
  const d = dictionaryFinding(parseLyric(hook, NAMES).text, allow);
  if (d) out.push({ ...d, bypass: null });
  const f = fillerFinding(hook);
  if (f) out.push({ ...f, bypass: null });
  const inv = inversionFinding(hook);
  if (inv) out.push({ ...inv, bypass: null });
  const sg = singableFinding(hook, allow, things);
  if (sg) out.push({ ...sg, bypass: null });
  return out;
}

/** The craft findings of a summary (sung in the making-of): its words. */
export function summaryCraft(summary, { allow = null } = {}) {
  const d = dictionaryFinding(summary, allow, 'summary');
  return d ? [d] : [];
}

// ---------------------------------------------------------------------------------------------
// genuine: a consultation's question puts a decision to the crewmate asked
//
// Nov 1, the owner: "I don't like the making-of lyrics. It keeps asking questions that it knows the answer to such as
// Black (Plot trouble) asking Green (Lyricist) if White rings out as Why and if the sung words come out mush. A better
// question coming from Black would be if it would be good to integrate that plot point as part of the lyrics." A
// consultation's question (and its follow-up) is a decision the bot asked owns and the asker cannot settle alone: "Gold,
// can we spend the gold light on the last chorus, or save it?", "Green, does the hook land better on the four or the
// one?", never a yes or no about a fact ("Does the tempo carry that sway?"), never what the asker's own lines just said.
// Measured on the 14 checked-in bundles and the Oct 31 fixture (351 questions and follow-ups, judged by hand:
// eval/questions.ndjson): 213 genuine decisions, 89 yes/no checks of a fact, 49 quizzes the asker could answer itself
// (all 28 of Black's pitches among them); the check flags none of the 213, 51 of the 89, 38 of the 49 (and of 62
// decisions and 30 quizzes written fresh for the tests, none and all 30). It is the emit tool's, for new runs: the
// recorded bundles are never checked (the gate and validate-bundle.js do not run it).

/** The check's name (an event's "bypass" key). */
export const QUESTION_CHECK = 'genuine';
/** A question whose content words are at least this share of its asker's own lines (two words at least) restates them. */
export const RESTATE_SHARE = 2 / 3;
const ADDRESS_RE = new RegExp(`^\\W*(?:[Hh]ey\\s+)?(?:${NAMES.join('|')})\\s*[,!:]\\s*|[,\\s]+(?:${NAMES.join('|')})\\s*([?!.]*)\\s*$`, 'g');
const LEAD_RE = /^(?:(?:but|so|and|oh|ooh|okay|ok|hmm|well|then|now|also|wait|hey|yes|yeah|no|right|later|next)\b[\s,!.]*)+/i;
/** A leading condition ("If we lose the bet, who pays?", "But if it runs short, can I still roar?"): its main clause asks. */
const CONDITION_RE = /^(?:if|when|once|after|before|with|at)\b[^,?]*,\s*(.+)$/i;
/** Little words of a question that carry no content (on top of the repeat check's), for "says it again". */
const QUESTION_LIGHT = new Set(['still', 'even', 'really', 'also', 'best', 'most', 'more', 'much', 'ever', 'else', 'enough', 'again', 'later', 'next', 'right']);

/** What a consultation's question asks: its address ("Gray, ..." / "..., Gray?"), lead-in ("But", "And later,") and leading condition off. */
export function bareQuestion(text) {
  const off = (x) => {
    let y = x;
    for (let k = 0; k < 3; k++) y = y.replace(ADDRESS_RE, '$1').trim().replace(LEAD_RE, '').trim(); // ("So, Gold, ...", "But Gold, ...")
    return y;
  };
  const s = off(String(text ?? '').trim());
  const cond = CONDITION_RE.exec(s);
  return cond ? off(cond[1]) : s;
}

/**
 * The form of a consultation's question (bareQuestion): 'choice' (A or B: "Spot or glow for the slip?"), 'proposal'
 * (should / shall ..., can / could / may we or I ..., do we ..., do you want ..., would it help ..., is it worth ...,
 * how about ..., bet ...: the bot asked decides it), 'open' (what, which, where, when, who, why, how ...), 'request'
 * (can / could / would / may a crewmate or a thing: "Can a spot find me there?"), 'fact' (does / do / is / are / has
 * ... a fact: "Does the tempo carry that sway?"), 'whatif' (a hypothetical: "What if the lid sticks?"), 'statement' (a
 * plain sentence with a "?": "And later, the wheel wobbles loose?").
 */
export function questionForm(text) {
  const s = bareQuestion(text);
  if (/\bor\b(?!\s+(?:not|so)\b)/i.test(s) && !/^or\b/i.test(s)) return 'choice';
  // (two sentences, "Too bright? Should we dim it?": the one that asks the most)
  return questionParts(s).map(formOf).sort((x, y) => FORM_RANK.indexOf(x) - FORM_RANK.indexOf(y))[0] ?? 'statement';
}
/** The forms, from the one that asks the most decision to the least. */
const FORM_RANK = ['choice', 'proposal', 'open', 'request', 'whatif', 'fact', 'statement'];
/** A question's sentences, each bare ("Too bright? Should we dim it?" -> "Too bright?", "Should we dim it?"). */
const questionParts = (s) => bareQuestion(s).split(/(?<=[.?!])\s+(?=\S)/).map(bareQuestion).filter(Boolean);
/** The form of one sentence (questionForm). */
function formOf(s) {
  const w = s.toLowerCase().replace(/’/g, "'").replace(/[^a-z' ]+/g, ' ').trim().split(/\s+/);
  const [a, b, c] = w;
  if (/\bor\b(?!\s+(?:not|so)\b)/i.test(s) && !/^or\b/i.test(s)) return 'choice';
  if (a === 'should' || a === 'shall') return 'proposal';
  if (['can', 'could', 'may', 'might'].includes(a) && ['we', 'i', 'us'].includes(b)) return 'proposal';
  if (a === 'do' && ['we', 'i'].includes(b) && c !== 'still') return 'proposal';
  if (a === 'do' && b === 'you' && ['want', 'need', 'prefer', 'mind'].includes(c)) return 'proposal';
  if (['is', 'does', 'do', 'would'].includes(a) && b === 'it' && ['worth', 'better', 'best', 'good', 'okay', 'ok', 'fine', 'fair', 'time', 'help', 'helps', 'work', 'works', 'be'].includes(c)) return 'proposal';
  if (a === 'would' && /\b(help|work|fit|be (?:good|better|fun|fair|okay|ok))\b/i.test(s)) return 'proposal';
  // (a yes or no that weighs a step all the same: "Is the gold light worth it?", "Does the bridge need a spot?", "Are
  // we okay to march here?", "Is there room for a gag?")
  if (['is', 'are', 'am', 'does', 'do'].includes(a) && /\b(worth|needs?|wants?|(?:okay|ok|fine|allowed|free) (?:to|with))\b/i.test(s)) return 'proposal';
  if (/\broom for\b/i.test(s) && !/^(what|which|where|when|who|whom|whose|why|how)$/.test(a)) return 'proposal';
  if ((a === 'how' && b === 'about') || (a === 'why' && b === 'not') || a === "let's" || a === 'bet' || a === 'wanna' || (a === 'want' && b === 'to')) return 'proposal';
  if (a === 'what' && b === 'if') return ['we', 'i', 'us'].includes(c) ? 'proposal' : 'whatif';
  if (/^(what|which|where|when|who|whom|whose|why|how)$/.test(a)) return 'open';
  if (/^(can|could|would|may|might|must|can't|couldn't|wouldn't)$/.test(a)) return 'request';
  if (/^(do|does|did|is|are|am|was|were|has|have|had|isn't|aren't|doesn't|don't|didn't|hasn't|haven't)$/.test(a)) return 'fact';
  return 'statement';
}
/** Forms that ask no decision: a yes or no about a fact, a hypothetical, a plain sentence with a "?". */
const QUIZ_FORMS = new Set(['fact', 'whatif', 'statement']);
/** A pitch of Black's asks where the story takes it: a proposal, A or B, or where / which / when / how we ... */
const PITCH_WH = /^(?:where|which|when)\b|^how\s+(?:should|do|can|could|would|about)\b|^what\s+(?:verse|line|beat|part|spot|place|section|chorus|stanza)\b/i;

const questionWords = (text) => new Set([...contentWords(text)].filter((x) => !QUESTION_LIGHT.has(x)));
/**
 * The content words of a question that its asker's own lines already said: { share (of the question's content words,
 * 0 when it has fewer than two), hits }. lines: the asker's context lines (a follow-up: the host's answers too).
 */
export function restatedBy(text, lines) {
  const q = questionWords(bareQuestion(text));
  if (q.size < 2) return { share: 0, hits: [] };
  const said = new Set((lines ?? []).flatMap((l) => [...questionWords(l)]));
  const hits = [...q].filter((x) => said.has(x));
  return { share: hits.length / q.size, hits };
}

const quote = (xs) => xs.map((x) => `"${x}"`).join(', ');
/**
 * The craft finding of a consultation's question or follow-up (emit time only), or []: it fails when it asks no decision, a yes or no about a fact ("Does the tempo carry that sway?"), a hypothetical
 * ("What if the lid sticks?") or a plain sentence with a "?"; when it says again what the asker's own context (a
 * follow-up: the host's answer too) just said, asked as a yes or no ("Can the lid stick?" after "The lid sticks on the
 * pot"); and Black's pitch (its `problem`) when it does not ask whether and where the story takes the problem ("Should
 * we put the mush in verse one?", "Where does it go, Green?") or the problem is sung nowhere (his context says it).
 * ctx: { move ('question' | 'followup'), problem (Black's pitch), host (the bot asked), context (the asker's context
 * lines of the thread), answers (the host's answers so far: a follow-up's) }.
 */
export function questionCraft(text, { move = 'question', problem = null, host = null, context = [], answers = [] } = {}) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  const who = host ?? 'the crewmate you ask';
  const form = questionForm(s);
  const why = [];
  let fix = `your context gives the facts; the question asks ${who} to decide something that is ${host ? `${host}'s` : 'their'} call and that you cannot settle yourself: "should we ...?", "which ...?", "where ...?", "how should we ...?", or A or B ("Should we slow it down for the sway, or keep it brisk?", "Which word takes the big chord?")`;
  if (problem) {
    if (!(form === 'proposal' || form === 'choice' || questionParts(s).some((x) => PITCH_WH.test(x)))) {
      why.push(`"${s}" asks ${who} whether your own problem happens: you made it up, so you know. A pitch asks ${who} to decide whether and where the story takes it`);
    }
    const p = questionWords(problem);
    const sung = new Set([...context, s].flatMap((l) => [...questionWords(l)]));
    if (p.size && ![...p].some((x) => sung.has(x))) why.push(`nobody hears the problem: neither your context nor your question says "${problem}"`);
    fix = `say the problem plainly in a context line ("The pot lid sticks tight"), then ask ${who} whether and where the story takes it ("Should we put the stuck lid in verse one?", "Where does the stuck lid go?", "Can we sing it in the second verse?")`;
  } else if (QUIZ_FORMS.has(form)) {
    why.push(form === 'whatif' ? `"${s}" asks what would happen, not what to do (${who} can only say "it does")`
      : `"${s}" asks a yes or no about a fact, not a decision (${who} can only say "yes" or "no")`);
  }
  if (!problem && !['proposal', 'choice', 'open'].includes(form)) {
    const mine = restatedBy(s, context), back = move === 'followup' ? restatedBy(s, [...context, ...answers]) : mine;
    if (back.share >= RESTATE_SHARE) {
      const own = mine.share >= RESTATE_SHARE;
      why.push(`it says again what ${own ? 'your own context just said' : `${who} just answered`} (${quote(back.hits)}): you know that already`);
    }
  }
  if (!why.length) return [];
  return [{
    check: QUESTION_CHECK, severity: 'reject', message: why.join('; and '), fix,
    bypass: `${who} really decides it as you put it, and you could not settle it yourself`,
  }];
}

/**
 * Every question and follow-up of a stream's consultations with its finding: [{ seq, thread, asker, host, move, text,
 * problem, findings }] (the calibration, the tests).
 */
export function bundleQuestions(events) {
  const out = [];
  const byThread = new Map();
  for (const e of events ?? []) if (e?.move && e.thread) { if (!byThread.has(e.thread)) byThread.set(e.thread, []); byThread.get(e.thread).push(e); }
  for (const [thread, list] of byThread) {
    const ask = list.find((e) => e.move === 'ask');
    if (!ask) continue;
    const asker = ask.bot, host = ask.consult?.[0] ?? null;
    for (const e of list) {
      if (e.move !== 'question' && e.move !== 'followup') continue;
      const before = list.filter((x) => x.seq < e.seq);
      const context = before.filter((x) => x.move === 'context' && x.bot === asker).map((x) => x.summary);
      const answers = before.filter((x) => (x.move === 'answer' || x.move === 'followup-answer') && x.bot === host).map((x) => x.summary);
      out.push({ seq: e.seq, thread, asker, host, move: e.move, text: e.summary, problem: e.problem ?? null,
        findings: questionCraft(e.summary, { move: e.move, problem: e.problem ?? null, host, context, answers }) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// calibration: every check over the checked-in bundles

/** Run the checks over a bundle's lines in order: [{ seq, beat, section, pos, lyric, findings }]. */
export function bundleCraft(beats, events) {
  const out = [];
  const y = events.filter((e) => e.beat === beats.beats.find((b) => b.section === 'chorus1')?.id && e.lyric)[3]?.lyric ?? null;
  for (const b of beats.beats) {
    const lines = events.filter((e) => e.beat === b.id && e.lyric);
    lines.forEach((e, pos) => {
      const findings = lineCraft(e.lyric, { section: b.section, pos, stanza: lines.slice(0, pos).map((x) => x.lyric), hook: beats.hook,
        frame: b.section === 'chorus3' && pos === 3 ? y : null, allow: null, plot: !!(e.trouble || e.resolves), premise: beats.prompt });
      out.push({ seq: e.seq, beat: b.id, section: b.section, pos, lyric: e.lyric, findings });
    });
  }
  return out;
}

function calibrate(root) {
  const per = Object.fromEntries(CHECKS.map((c) => [c, { reject: [], note: [] }]));
  let lines = 0, flagged = 0, summaries = 0, summaryFlags = [];
  const hooks = [];
  for (const d of readdirSync(root).sort()) {
    const dir = join(root, d);
    if (!existsSync(join(dir, 'beats.json')) || !existsSync(join(dir, 'director.json'))) continue;
    const beats = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
    const events = readFileSync(join(dir, 'events.ndjson'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    for (const f of hookCraft(beats.hook, { allow: premiseWords(beats.prompt), things: premiseThings(beats.prompt) })) hooks.push(`${d} hook "${beats.hook}": [${f.check}] ${f.message}`);
    for (const r of bundleCraft(beats, events)) {
      lines++;
      if (r.findings.some((f) => f.severity === 'reject')) flagged++;
      for (const f of r.findings) per[f.check][f.severity].push(`${d} ${r.beat} ${r.pos + 1}: ${parseLyric(r.lyric, NAMES).text}${parseLyric(r.lyric, NAMES).reply ? ` >> ${parseLyric(r.lyric, NAMES).reply}` : ''}  [${f.message}]`);
    }
    for (const e of events) {
      summaries++;
      for (const f of summaryCraft(e.summary)) summaryFlags.push(`${d} ${e.bot}: ${e.summary}  [${f.message}]`);
    }
  }
  const pct = (n) => `${n} (${((100 * n) / Math.max(1, lines)).toFixed(1)}%)`;
  console.log(`${lines} lines; ${pct(flagged)} fail at least one check`);
  for (const c of CHECKS.filter((x) => x !== QUESTION_CHECK)) { // (the sung lines' checks; the questions' below)
    console.log(`\n== ${c}: ${pct(per[c].reject.length)} rejected, ${per[c].note.length} notes`);
    for (const x of [...per[c].reject, ...per[c].note.map((y) => `(note) ${y}`)]) console.log(`  ${x}`);
  }
  console.log(`\n== hooks (the plan's): ${hooks.length} with a finding`);
  for (const x of hooks) console.log(`  ${x}`);
  console.log(`\n== summaries: ${summaryFlags.length} of ${summaries} with an unknown word`);
  for (const x of summaryFlags) console.log(`  ${x}`);
  // the consultations' questions and follow-ups (genuine)
  let asked = 0;
  const quizzes = [];
  for (const d of readdirSync(root).sort()) {
    const f = join(root, d, 'events.ndjson');
    if (!existsSync(f)) continue;
    const events = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    for (const q of bundleQuestions(events)) {
      asked++;
      if (q.findings.length) quizzes.push(`${d} ${q.thread} ${q.asker} to ${q.host} [${q.move}]: ${q.text}  [${q.findings[0].message}]`);
    }
  }
  console.log(`\n== ${QUESTION_CHECK} (the consultations' questions and follow-ups): ${quizzes.length} of ${asked} flagged`);
  for (const x of quizzes) console.log(`  ${x}`);
  // against the hand labels (eval/questions.ndjson): decision (genuine), yes-no (a fact checked, no decision asked), quiz
  const labels = join(HERE, '../../eval/questions.ndjson');
  if (existsSync(labels)) {
    const by = {};
    for (const r of readFileSync(labels, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))) {
      const flagged = questionCraft(r.text, { move: r.move, problem: r.problem ?? null, host: r.host, context: r.context, answers: r.answers ?? [] }).length > 0;
      (by[r.label] ??= { n: 0, flagged: 0 }).n++;
      if (flagged) by[r.label].flagged++;
    }
    console.log(`  hand labels (eval/questions.ndjson): ${Object.entries(by).map(([k, v]) => `${k} ${v.flagged} of ${v.n} flagged`).join(', ')}`);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--calibrate');
  if (i < 0) { console.log('usage: craft.js --calibrate [episodes dir]'); process.exit(1); }
  calibrate(resolve(process.argv[i + 1] ?? join(HERE, '../../episodes')));
}
