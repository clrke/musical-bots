// The crew's summaries in the team's voice: the making-of's role bot sings its thought as the crew's, "we"
// ("White asks Green where the hook lands" -> "We ask Green where the hook lands"; the owner, Oct 30: the cast
// sings together, "we", not "I"). Runs since Oct 30 write "We ..." (beats.json summaries: "we"); the Oct 29-30
// bundles sang each bot's own "I ..." ("I set the key" -> "We set the key"); older ones say it in the third
// person: all three work. Conservative by design: a third-person summary changes only where the subject is
// plainly the bot itself (its Capitalised name, first, with a verb after it); anything else (another subject,
// a list of names, a sentence it cannot read) is sung as written. Pure; tested in web/test-making-of.mjs.

/** Third person singular -> the form after "we", where the -s rules get it wrong (or the verb is irregular). */
const IRREGULAR = {
  is: 'are', has: 'have', does: 'do', goes: 'go', was: 'were', undoes: 'undo', echoes: 'echo', vetoes: 'veto',
  focuses: 'focus', unties: 'untie', quizzes: 'quiz', whizzes: 'whiz', aches: 'ache', biases: 'bias',
  "isn't": "aren't", "doesn't": "don't", "hasn't": "haven't", "wasn't": "weren't",
};
/** Words between the name and its verb that leave the verb as it is ("White gently lifts" -> "We gently lift"). */
const ADVERBS = new Set(['also', 'always', 'still', 'just', 'then', 'now', 'never', 'often', 'only', 'even', 'again', 'really',
  'already', 'almost', 'soon', 'here', 'too', 'once', 'quietly', 'proudly']);
/** Modals and past forms: the verb after the name stays ("White can't wait" -> "We can't wait"). */
const KEEP = new Set(['can', 'could', 'should', 'would', 'might', 'must', 'may', 'will', "can't", "won't", "couldn't",
  "shouldn't", "wouldn't", 'did', "didn't", 'had', "hadn't"]);
/** After "<Name>'s": the contraction of is ("White's ready" -> "We're ready"), else a possessive ("White's chords" -> "Our chords"). */
const IS_NEXT = new Set(['ready', 'happy', 'sure', 'proud', 'done', 'here', 'there', 'back', 'off', 'on', 'up', 'in', 'out', 'not',
  'so', 'very', 'really', 'almost', 'still', 'just', 'always', 'never', 'busy', 'glad', 'keen', 'late', 'early', 'free', 'sorry',
  'excited', 'thrilled', 'certain', 'curious', 'right', 'set', 'about', 'a', 'an', 'the', 'too', 'all']);
const HAS_NEXT = new Set(['got', 'been']);
/** Verbs a clause may add after a comma or "and" with the same subject ("..., asks Green" / "and nods"): only these. */
const COORDINATED = new Set(('ask tell nod sing count lift set bring give take make add keep let point wave clap cheer wink giggle ' +
  'spin check hum tap plan call show send write hold put pick turn open close start end find see hear feel try say play stay ' +
  'lead follow join slip drop catch throw paint dim flood warm glow shine crown beam celebrate dance march sway step share ' +
  'steady soften hush lean burst shake trust loosen rest watch trip reach grab use film correct fit repeat ground slide swing ' +
  'bounce boing grin smile laugh gasp sigh shrug hug help cue mark match rhyme pair swap pass toss roll spot scan aim tune strum ' +
  'conduct build raise lower push pull carry lend trade sell buy pay seal agree promise approve decide choose sketch draft ' +
  'polish fix tweak trim land hit miss chase race run walk jump hop skip twirl twist wiggle wobble crash splash tease joke ' +
  'whistle ring knock wonder think guess know notice want need hope wish imagine remember answer reply suggest offer counts ' +
  'nudge wrap close cut tip blink peek beckon salute clink toast chant hug huddle cross dive bake bathe gild crave dream fear feed ' +
  'fill flip freeze gather greet harrumph hurry jog lose win sweep stir pour serve taste sniff lick munch bite drum tick tock ' +
  'glide float drift circle loop lift brighten darken soothe calm comfort cheer whisper shout call echo stamp stomp tumble ' +
  'giggle chuckle beam blush preen pose bow curtsy kneel sit stand rise fall settle snuggle cuddle rock sway ladle scoop spoon ' +
  'slurp sip cook fry dish chop mix whisk sprinkle frost decorate wrap unwrap paint sketch draw color colour plant water dig').split(' '));
/** The cast who are "she" in the crew's summaries ("Green hears Yellow call from her porch"); the rest are "he". */
const SHE = new Set(['White', 'Pink', 'Blue', 'Gray', 'Yellow', 'Red', 'Jade', 'Lilac']);
/** Words after "her" that make it an object ("asks her about"), not a possessive ("her baton"). */
const NOT_A_NOUN = new Set(['a', 'an', 'the', 'to', 'for', 'with', 'about', 'and', 'or', 'but', 'in', 'on', 'at', 'up', 'down', 'out',
  'off', 'back', 'over', 'that', 'this', 'how', 'why', 'what', 'where', 'when', 'if', 'so', 'too', 'again', 'now', 'then', 'into',
  'onto', 'from', 'by', 'as', 'is', 'was', 'today', 'tonight', 'here', 'there', 'sing', 'dance', 'go', 'be', 'lift', 'miss', 'fly',
  'spin', 'jump', 'run', 'wait', 'stay', 'sleep', 'smile', 'laugh', 'cry', 'win', 'know', 'see', 'hear', 'feel', 'way']);
/** Words that open a summary before its subject ("Now White lifts ..."). */
const OPENERS = new Set(['now', 'then', 'next', 'here', 'finally', 'softly', 'quickly', 'again', 'so', 'still', 'meanwhile', 'together', 'first', 'last']);

const WORD = /[A-Za-z][A-Za-z'’-]*/g;
const lowerFirst = (w) => w.charAt(0).toLowerCase() + w.slice(1);

/**
 * The base form of a third person singular verb ("asks" -> "ask", "catches" -> "catch", "tries" -> "try", "has" ->
 * "have", "is" -> "am"), or null when the word is not one (no -s ending: a past form, a modal, an adverb).
 */
export function baseForm(word) {
  const w = String(word ?? '').toLowerCase().replace(/’/g, "'");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length < 3 || !/[a-z]s$/.test(w) || /(ss|us|is|ous|'s)$/.test(w)) return null;
  if (/(ss|zz|x|ch|sh)es$/.test(w)) return w.slice(0, -2); // misses, buzzes, fixes, catches, hushes
  if (/[^aeiou]ies$/.test(w)) return w.length <= 4 ? w.slice(0, -1) : `${w.slice(0, -3)}y`; // ties -> tie, tries -> try
  return w.slice(0, -1); // asks, giggles, plays, sees, tiptoes
}

/** The word's case kept: a capital stays a capital ("Asks" -> "Ask"). */
const keepCase = (orig, repl) => (/^[A-Z]/.test(orig) ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl);

/** The singular first person -> the team's ("I" -> "we", "my" -> "our"; "I am" -> "we are"). */
const PLURAL = {
  i: 'we', "i'm": "we're", "i've": "we've", "i'd": "we'd", "i'll": "we'll", me: 'us', my: 'our', mine: 'ours', myself: 'ourselves',
};
/** A verb right after "I" that changes with "we" ("I am" -> "we are", "I was" -> "we were"). */
const AFTER_I = { am: 'are', was: 'were', "wasn't": "weren't", "ain't": "aren't" };

/**
 * A summary written in the bot's own "I" (the Oct 29-30 bundles) in the team's "we": "I set the key" ->
 * "We set the key", "I'm ready" -> "We're ready", "I hand Gold my ladle" -> "We hand Gold our ladle".
 * The verb after "I" is already the base form; "am" / "was" change.
 */
export function pluralize(text) {
  const s = String(text ?? '');
  return s.replace(/[A-Za-z][A-Za-z'’]*/g, (w, off) => {
    const k = w.replace(/’/g, "'");
    const lw = k.toLowerCase();
    if ((lw === 'i' || /^i'/.test(lw)) && k.charAt(0) !== 'I') return w; // the pronoun I is a capital
    if (Object.hasOwn(PLURAL, lw)) {
      const before = s.slice(0, off);
      const start = !/\S/.test(before) || /[.!?:]\s*$/.test(before);
      const r = PLURAL[lw];
      return start ? r.charAt(0).toUpperCase() + r.slice(1) : r;
    }
    const prev = /([A-Za-z'’]+)\s+$/.exec(s.slice(0, off))?.[1];
    if (prev === 'I' && Object.hasOwn(AFTER_I, lw)) return AFTER_I[lw];
    return w;
  });
}

/**
 * `text` (an event's summary) in the team's voice, "we", for `bot` (its canon name: the Capitalised word only, so
 * "Gold" is the bot and "gold" the colour). The crew sings together, so a thought is the team's: "White asks Green
 * where the hook lands" -> "We ask Green where the hook lands", "I set the key" -> "We set the key". names
 * (optional): every cast name, so the bot's own "his" / "her" become "our" while no one of its pronoun has been
 * named. Unchanged when it already says "we", when the bot is not its subject, or when it is unsure.
 */
export function teamVoice(text, bot, names = []) {
  const s = String(text ?? '');
  const name = String(bot ?? '').trim();
  if (!s.trim() || !name) return s;
  if (isTeamVoice(s)) return s; // already the team's voice
  if (isFirstPerson(s)) return pluralize(s); // the bot's own "I" (the Oct 29-30 bundles)
  const words = [...s.matchAll(WORD)].map((m) => ({ w: m[0], at: m.index, end: m.index + m[0].length }));
  if (!words.length) return s;
  // the subject: the bot's name first (after an opener like "Now" at most)
  let k = 0;
  if (OPENERS.has(words[0].w.toLowerCase()) && words.length > 1 && words[1].w.replace(/['’]s$/, '') === name) k = 1;
  const subj = words[k];
  const bare = subj.w.replace(/['’]s$/, '');
  if (bare !== name) return s; // the Capitalised name only ("Gold counts", not "gold coins")
  const between = s.slice(k ? words[k - 1].end : 0, subj.at);
  if (k && !/^[\s,]*$/.test(between)) return s;
  if (!k && subj.at > 0 && /\S/.test(s.slice(0, subj.at))) return s;
  const after = s.slice(subj.end);
  if (/^\s*(,|and\b|&|\+|or\b)/i.test(after)) return s; // "White, Gold and Blue ..." / "White and Gold ...": a group
  const cut = subj.end; // the text after the subject is copied from here, with the edits
  const edits = []; // [start, end, replacement]
  const opener = s.slice(0, subj.at);
  const next = words[k + 1];
  if (/['’]s$/.test(subj.w)) {
    // "White's ...": a contraction ("White's ready" -> "We're ready", "White's got" -> "We've got") or a possessive
    const n = next?.w.toLowerCase();
    const we = n && (IS_NEXT.has(n) || /ing$/.test(n)) ? (k ? "we're" : "We're") : n && HAS_NEXT.has(n) ? (k ? "we've" : "We've") : k ? 'our' : 'Our';
    return finish(s, [opener, we], cut, edits, name, names);
  }
  // the verb: after any adverbs ("White gently lifts" -> "We gently lift")
  let v = k + 1;
  while (v < words.length && (ADVERBS.has(words[v].w.toLowerCase()) || /ly$/i.test(words[v].w)) && v < k + 3) v++;
  const verb = words[v];
  if (!verb) return s;
  const lw = verb.w.toLowerCase().replace(/’/g, "'");
  if (!KEEP.has(lw) && !/ed$/.test(lw)) { // a modal or a past form stays ("We can't wait", "We lifted")
    const base = baseForm(verb.w);
    if (!base) return s; // no verb it can read ("White ready to go"): as written
    edits.push([verb.at, verb.end, keepCase(verb.w, base)]);
  }
  // verbs the same subject adds after a comma or "and" ("..., asks Green about the hook" / "and nods"); not when a
  // verb of another subject came first ("tells Gray the crew huddles and cheers": the crew cheers)
  for (let i = v + 1; i < words.length; i++) {
    const w = words[i];
    const gap = s.slice(words[i - 1].end, w.at);
    const joined = /,\s*$/.test(gap) || /^\s*(and|then)\s*$/i.test(gap) || (/^\s*$/.test(gap) && /^(and|then)$/i.test(words[i - 1].w));
    if (/^(and|then)$/i.test(w.w)) continue;
    if (!joined) continue;
    const base = baseForm(w.w);
    // right after the main verb ("spins and loses") any verb is the same subject's; later only the known ones
    const adjacent = i === v + 2 && /^(and|then)$/i.test(words[v + 1].w);
    if (!base || (!COORDINATED.has(base) && !adjacent)) continue;
    // a verb of its own in between ("the crew huddles"; not a noun after a determiner: "the steps")
    const inner = words.slice(v + 1, i).some((x, j, list) => {
      const b = baseForm(x.w);
      const before = (j > 0 ? list[j - 1] : words[v]).w.toLowerCase();
      return b && COORDINATED.has(b) && !DETERMINERS.has(before);
    });
    if (inner) break;
    edits.push([w.at, w.end, keepCase(w.w, base)]);
  }
  return finish(s, [opener, k ? 'we' : 'We'], cut, edits, name, names);
}

const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'his', 'her', 'its', 'their', 'your', 'this', 'that', 'these', 'those', 'every',
  'each', 'some', 'any', 'no', 'two', 'three', 'four', 'five', 'few', 'many', 'more', 'both', 'its', 'new', 'old', 'big', 'little',
  'small', 'bright', 'soft', 'loud', 'first', 'last', 'next', 'of', 'in', 'on', 'with', 'for', 'to', 'from', 'by', 'at']);

/** Copies `s` from `cut` with the edits, then the possessive pronouns that are the bot's own ("his coins" -> "our coins"). */
function finish(s, out, cut, edits, name, names) {
  let rest = '';
  let at = cut;
  for (const [a, b, r] of edits.sort((x, y) => x[0] - y[0])) {
    rest += s.slice(at, a) + r;
    at = b;
  }
  rest += s.slice(at);
  // the bot's own possessive ("Gold counts his coins" -> "our coins", "Pink giggles into her soup" -> "our soup") while
  // no one of its pronoun has been named before it ("Green gives Gold his line" stays); "her" only before a noun
  // ("asks her about" is an object); a pronoun not the bot's ("Green feels her lift") stays
  const she = SHE.has(name);
  const same = new Set((names ?? []).filter((n) => n !== name && SHE.has(n) === she)); // Capitalised: "a gold spot" names nobody
  let named = false;
  rest = rest.replace(/[A-Za-z][A-Za-z'’-]*/g, (w, off, all) => {
    const lw = w.toLowerCase();
    if (same.has(w.replace(/['’]s$/, '')) || (/^[A-Z]/.test(w) && !(names ?? []).length)) named = true;
    if (named) return w;
    if (!she && lw === 'his') return keepCase(w, 'our');
    if (lw === (she ? 'herself' : 'himself')) return keepCase(w, 'ourselves');
    if (she && lw === 'her') {
      const next = /^\s+([A-Za-z]+)/.exec(all.slice(off + w.length))?.[1]?.toLowerCase();
      if (next && !NOT_A_NOUN.has(next)) return keepCase(w, 'our');
    }
    return w;
  });
  return out.join('') + rest;
}

/** True when the text speaks as one bot ("I ...", "My ..."): an Oct 29-30 summary. */
export const isFirstPerson = (text) => /^\s*(I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|My|Me)\b/.test(String(text ?? ''));
/** True when the text already speaks as the team ("We ...", "Our ...", "Now we ..."). */
export function isTeamVoice(text) {
  const s = String(text ?? '');
  if (/^\s*(We|We're|We’re|We've|We’ve|We'd|We’d|We'll|We’ll|Our|Us)\b/.test(s)) return true;
  const m = /^\s*([A-Za-z]+)[\s,]+(we|we're|we’re|we've|we’ve|our)\b/.exec(s);
  return !!m && OPENERS.has(m[1].toLowerCase());
}
