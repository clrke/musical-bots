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
export const CHECKS = ['dictionary', 'rhyme', 'meter', 'balance', 'filler', 'inversion', 'repeat'];
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
  if (NAME_SET.has(a) || NAME_SET.has(b)) return null; // a name: the gate trusts it
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
      if (x === 'really' && i === 0 && /^\s*really\s*[?!]/i.test(body)) return; // Benny's "Really?"
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
  return new Set(all.filter((x, i) => !(i > 0 && /^[A-Z]/.test(x) && x !== 'I')).map(lower)
    .filter((x) => !FUNCTION_WORDS.has(x) && !LIGHT.has(x) && !DETERMINERS.has(x) && !NAME_SET.has(x.replace(/'s$/, '')) && x.length > 2).map(stem));
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
 * turned line: chorus 1's Y, whose frame it keeps), allow (Set: words an earlier bypass accepted) }.
 * A line the song form fixes (the hook, chorus 2, chorus 3's X, the callback) is checked once, where
 * it is first written: here only its reply.
 */
export function lineCraft(lyric, ctx = {}) {
  const { section = 'verse1', pos = 0, stanza = [], hook = '', frame = null, allow = null } = ctx;
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
  return out;
}

/** The words of the premise (the episode's one-line prompt), lower case: the hook may sing them unknown. */
export const premiseWords = (prompt) => new Set(wordsOf(prompt ?? '').map(lower));

/**
 * The craft findings of the plan's hook (the director's: never bypassed). allow: the premise's own
 * words (the hook keeps the premise's key word; one the singer does not know is accepted there, and
 * reported, so a lexicon entry can follow: "hackathon").
 */
export function hookCraft(hook, { allow = null } = {}) {
  const out = [];
  const d = dictionaryFinding(parseLyric(hook, NAMES).text, allow);
  if (d) out.push({ ...d, bypass: null });
  const f = fillerFinding(hook);
  if (f) out.push({ ...f, bypass: null });
  const inv = inversionFinding(hook);
  if (inv) out.push({ ...inv, bypass: null });
  return out;
}

/** The craft findings of a summary (sung in the making-of): its words. */
export function summaryCraft(summary, { allow = null } = {}) {
  const d = dictionaryFinding(summary, allow, 'summary');
  return d ? [d] : [];
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
        frame: b.section === 'chorus3' && pos === 3 ? y : null, allow: null });
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
    for (const f of hookCraft(beats.hook, { allow: premiseWords(beats.prompt) })) hooks.push(`${d} hook "${beats.hook}": [${f.check}] ${f.message}`);
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
  for (const c of CHECKS) {
    console.log(`\n== ${c}: ${pct(per[c].reject.length)} rejected, ${per[c].note.length} notes`);
    for (const x of [...per[c].reject, ...per[c].note.map((y) => `(note) ${y}`)]) console.log(`  ${x}`);
  }
  console.log(`\n== hooks (the plan's): ${hooks.length} with a finding`);
  for (const x of hooks) console.log(`  ${x}`);
  console.log(`\n== summaries: ${summaryFlags.length} of ${summaries} with an unknown word`);
  for (const x of summaryFlags) console.log(`  ${x}`);
}

const HERE = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--calibrate');
  if (i < 0) { console.log('usage: craft.js --calibrate [episodes dir]'); process.exit(1); }
  calibrate(resolve(process.argv[i + 1] ?? join(HERE, '../../episodes')));
}
