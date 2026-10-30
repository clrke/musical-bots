// The crew's summaries in their own voice: the making-of's role bot sings its thought in the first person
// ("Nora asks Teddy where the hook lands" -> "I ask Teddy where the hook lands"). Bundles from before the
// director wrote first-person summaries say it in the third person; new ones already say "I ...": both work.
// Conservative by design: the summary changes only where the subject is plainly the bot itself (its name,
// first, with a verb after it); anything else (another subject, a list of names, a sentence it cannot read)
// is sung as written. Pure; tested in web/test-making-of.mjs.

/** Third person singular -> base form, where the -s rules get it wrong (or the verb is irregular). */
const IRREGULAR = {
  is: 'am', has: 'have', does: 'do', goes: 'go', was: 'was', undoes: 'undo', echoes: 'echo', vetoes: 'veto',
  focuses: 'focus', unties: 'untie', quizzes: 'quiz', whizzes: 'whiz', aches: 'ache', biases: 'bias',
  "isn't": 'am not', "doesn't": "don't", "hasn't": "haven't", "wasn't": "wasn't",
};
/** Words between the name and its verb that leave the verb as it is ("Nora gently lifts" -> "I gently lift"). */
const ADVERBS = new Set(['also', 'always', 'still', 'just', 'then', 'now', 'never', 'often', 'only', 'even', 'again', 'really',
  'already', 'almost', 'soon', 'here', 'too', 'once', 'quietly', 'proudly']);
/** Modals and past forms: the verb after the name stays ("Nora can't wait" -> "I can't wait"). */
const KEEP = new Set(['can', 'could', 'should', 'would', 'might', 'must', 'may', 'will', "can't", "won't", "couldn't",
  "shouldn't", "wouldn't", 'did', "didn't", 'had', "hadn't"]);
/** After "<Name>'s": the contraction of is ("Nora's ready" -> "I'm ready"), else a possessive ("Nora's chords" -> "My chords"). */
const IS_NEXT = new Set(['ready', 'happy', 'sure', 'proud', 'done', 'here', 'there', 'back', 'off', 'on', 'up', 'in', 'out', 'not',
  'so', 'very', 'really', 'almost', 'still', 'just', 'always', 'never', 'busy', 'glad', 'keen', 'late', 'early', 'free', 'sorry',
  'excited', 'thrilled', 'certain', 'curious', 'right', 'set', 'about', 'a', 'an', 'the', 'too', 'all']);
const HAS_NEXT = new Set(['got', 'been']);
/** Verbs a clause may add after a comma or "and" with the same subject ("..., asks Teddy" / "and nods"): only these. */
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
/** The cast who are "she" in the crew's summaries ("Teddy hears Frankie call from her porch"); the rest are "he". */
const SHE = new Set(['Nora', 'Pearl', 'Gigi', 'Vera', 'Frankie', 'Ivy', 'Hattie', 'Constance']);
/** Words after "her" that make it an object ("asks her about"), not a possessive ("her baton"). */
const NOT_A_NOUN = new Set(['a', 'an', 'the', 'to', 'for', 'with', 'about', 'and', 'or', 'but', 'in', 'on', 'at', 'up', 'down', 'out',
  'off', 'back', 'over', 'that', 'this', 'how', 'why', 'what', 'where', 'when', 'if', 'so', 'too', 'again', 'now', 'then', 'into',
  'onto', 'from', 'by', 'as', 'is', 'was', 'today', 'tonight', 'here', 'there', 'sing', 'dance', 'go', 'be', 'lift', 'miss', 'fly',
  'spin', 'jump', 'run', 'wait', 'stay', 'sleep', 'smile', 'laugh', 'cry', 'win', 'know', 'see', 'hear', 'feel', 'way']);
/** Words that open a summary before its subject ("Now Nora lifts ..."). */
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

/**
 * `text` (an event's summary) in the first person of `bot` (its canon name). names (optional): every cast name, so
 * the bot's own "his" / "her" become "my" while no one of its pronoun has been named. Unchanged when it speaks as "I", when the
 * bot is not its subject, or when it is unsure.
 */
export function firstPerson(text, bot, names = []) {
  const s = String(text ?? '');
  const name = String(bot ?? '').trim();
  if (!s.trim() || !name) return s;
  if (/^\s*(I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|My|Me)\b/.test(s)) return s; // already the bot's own voice
  const words = [...s.matchAll(WORD)].map((m) => ({ w: m[0], at: m.index, end: m.index + m[0].length }));
  if (!words.length) return s;
  // the subject: the bot's name first (after an opener like "Now" at most)
  let k = 0;
  if (OPENERS.has(words[0].w.toLowerCase()) && words.length > 1 && words[1].w.toLowerCase().replace(/['’]s$/, '') === name.toLowerCase()) k = 1;
  const subj = words[k];
  const bare = subj.w.replace(/['’]s$/, '');
  if (bare.toLowerCase() !== name.toLowerCase()) return s;
  const between = s.slice(k ? words[k - 1].end : 0, subj.at);
  if (k && !/^[\s,]*$/.test(between)) return s;
  if (!k && subj.at > 0 && /\S/.test(s.slice(0, subj.at))) return s;
  const after = s.slice(subj.end);
  if (/^\s*(,|and\b|&|\+|or\b)/i.test(after)) return s; // "Nora, Lou and Gigi ..." / "Nora and Lou ...": a group
  const cut = subj.end; // the text after the subject is copied from here, with the edits
  const edits = []; // [start, end, replacement]
  const opener = s.slice(0, subj.at);
  const next = words[k + 1];
  if (/['’]s$/.test(subj.w)) {
    // "Nora's ...": a contraction ("Nora's ready" -> "I'm ready", "Nora's got" -> "I've got") or a possessive
    const n = next?.w.toLowerCase();
    const I = n && (IS_NEXT.has(n) || /ing$/.test(n)) ? "I'm" : n && HAS_NEXT.has(n) ? "I've" : k ? 'my' : 'My';
    return finish(s, [opener, I], cut, edits, name, names);
  }
  // the verb: after any adverbs ("Nora gently lifts" -> "I gently lift")
  let v = k + 1;
  while (v < words.length && (ADVERBS.has(words[v].w.toLowerCase()) || /ly$/i.test(words[v].w)) && v < k + 3) v++;
  const verb = words[v];
  if (!verb) return s;
  const lw = verb.w.toLowerCase().replace(/’/g, "'");
  if (!KEEP.has(lw) && !/ed$/.test(lw)) { // a modal or a past form stays ("I can't wait", "I lifted")
    const base = baseForm(verb.w);
    if (!base) return s; // no verb it can read ("Nora ready to go"): as written
    edits.push([verb.at, verb.end, keepCase(verb.w, base)]);
  }
  // verbs the same subject adds after a comma or "and" ("..., asks Teddy about the hook" / "and nods"); not when a
  // verb of another subject came first ("tells Vera the crew huddles and cheers": the crew cheers)
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
  return finish(s, [opener, 'I'], cut, edits, name, names);
}

const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'his', 'her', 'its', 'their', 'your', 'this', 'that', 'these', 'those', 'every',
  'each', 'some', 'any', 'no', 'two', 'three', 'four', 'five', 'few', 'many', 'more', 'both', 'its', 'new', 'old', 'big', 'little',
  'small', 'bright', 'soft', 'loud', 'first', 'last', 'next', 'of', 'in', 'on', 'with', 'for', 'to', 'from', 'by', 'at']);

/** Copies `s` from `cut` with the edits, then the possessive pronouns that are the bot's own ("his coins" -> "my coins"). */
function finish(s, out, cut, edits, name, names) {
  let rest = '';
  let at = cut;
  for (const [a, b, r] of edits.sort((x, y) => x[0] - y[0])) {
    rest += s.slice(at, a) + r;
    at = b;
  }
  rest += s.slice(at);
  // the bot's own possessive ("Lou counts his coins" -> "my coins", "Pearl giggles into her soup" -> "my soup") while
  // no one of its pronoun has been named before it ("Teddy gives Lou his line" stays); "her" only before a noun
  // ("asks her about" is an object); a pronoun not the bot's ("Teddy feels her lift") stays
  const she = SHE.has(name);
  const same = new Set((names ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase() && SHE.has(n) === she).map((n) => n.toLowerCase()));
  let named = false;
  rest = rest.replace(/[A-Za-z][A-Za-z'’-]*/g, (w, off, all) => {
    const lw = w.toLowerCase();
    if (same.has(lw.replace(/['’]s$/, '')) || (/^[A-Z]/.test(w) && !(names ?? []).length)) named = true;
    if (named) return w;
    if (!she && lw === 'his') return keepCase(w, 'my');
    if (lw === (she ? 'herself' : 'himself')) return keepCase(w, 'myself');
    if (she && lw === 'her') {
      const next = /^\s+([A-Za-z]+)/.exec(all.slice(off + w.length))?.[1]?.toLowerCase();
      if (next && !NOT_A_NOUN.has(next)) return keepCase(w, 'my');
    }
    return w;
  });
  return out.join('') + rest;
}

/** True when the text already speaks as the bot ("I ...", "My ..."). */
export const isFirstPerson = (text) => /^\s*(I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|My|Me)\b/.test(String(text ?? ''));
