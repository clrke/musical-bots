// The lyricist: Meta's Muse Wonder (muse-wonder-1.0, the Meta Model API) writes an episode's sung lyrics.
//
// The Muse Code crew (Muse Spark 1.3) plans the story and works out every beat, consultation and cue; Green's drafts
// fix what each line says. Then this pass hands the sung lines to Muse Wonder, which writes the words: one request
// for the whole song, the story beat by beat, with the same rules the crew's tool enforces and the craft that gives a
// line its punch (since Nov 5: the owner, "It's still lacking oomph"; see SYSTEM). Every line it writes goes
// through the director's own gates (emit.js lineProblems and formProblems, craft.js lineCraft: the lyric rules, the
// singable-line limits, the rhymes, the dictionary the voice can sing), plus this pass's own truth gate (the names and
// numbers a draft sings stay in its line; no number or amount the story does not give) and a line that fails is sent
// back with its problems (up to four more rounds); a line that still fails keeps the crew's own. The song form's
// repeats (chorus 2's X and Y, chorus 3's X, the outro's callback) follow the lines they repeat; the hook keeps its
// words (Muse Wonder writes only its reply, the crowd's shout back); the lines that bring in or solve the plot's
// trouble are rewritten like the rest and keep their marks. The plan's facts and the premise's fact sheet
// (director/briefs/<slug>.md, when there is one) go in the prompt. The finished bundle then goes through the full
// gate; if that finds anything new, the original lyrics are restored.
//
//   wonderLyrics(dir, { key, base, model, fetchImpl, slug, briefPath }) -> a report (the bundle in dir is rewritten in place)
// Env: MB_WONDER_BASE (default https://api.meta.ai/v1; tests point it at a stub), MB_WONDER_MODEL.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineProblems, formProblems, checkBundle, coreText } from './emit.js';
import { lineCraft, fixedByForm, rhymePartner, isHookLine, BRANDS, premiseThings } from './craft.js';
import { NAMES, STANZA, ARC } from './vocab.js';
import { pastTense } from './rhyme.js';
import { parseLyric } from '../../web/src/cues.js';
import { MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES } from '../../web/src/gen/lyrics.js';
import { parseNdjson } from '../../web/src/player.js';
import { toNdjson } from '../../web/src/gen/index.js';

export const WONDER_MODEL = 'muse-wonder-1.0';
export const WONDER_BASE = 'https://api.meta.ai/v1';
/** muse-wonder-1.0, standard mode, $ per million tokens (https://dev.meta.ai/docs/pricing-rate-limits, Nov 4 2026). */
export const WONDER_PRICE = Object.freeze({ input: 4.0, cached: 0.2, output: 20.0 });
export const ROUNDS = 5; // the first request and four rounds of repairs

export const usdOf = (u) => (u ? ((u.input_tokens - u.cached_tokens) * WONDER_PRICE.input + u.cached_tokens * WONDER_PRICE.cached + u.output_tokens * WONDER_PRICE.output) / 1e6 : 0);
const zero = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 });

const SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, lyric: { type: 'string' } }, required: ['id', 'lyric'], additionalProperties: false } } },
  required: ['lines'],
  additionalProperties: false,
};

// The craft's examples come from a story no episode tells (a kite on a windy hill), and the gate refuses a copy of
// one (exampleCopy): the crew's rules showed a model pasting its examples into the song word for word.
export const EXAMPLE_LINES = Object.freeze([
  'We see the kite fly high', 'The wind yanks the kite!', 'We feel the cold today', 'Frost nips at our feet',
  'Kite dips, string snaps', 'The string snaps in two!', 'Look out, a tree! >> Too late!', 'Who wants a turn? >> Me first!',
  'Hold tight, and run!', 'Whoosh! The kite dips down', 'The scarf flaps loose >> Grab it!', 'The scarf flaps loose >> Flap, flap!',
  '{Gold:gasp} drops the spool', 'Watch this, it can fly!', 'We fly the kite up here', 'The wind blows far and near',
  'The wind steals our hat', 'The kite lands with a splat!', 'The wind brings back our hat', 'We race to Zoomtown Fair',
]);

const SYSTEM = `You are the lyricist of a kids' sing-along cartoon musical, sung by a choir of friendly robots. A crew of AI agents planned the episode and drafted every sung line. The drafts tell the story truly, but they are flat: lines that report ("We see the kite fly high") instead of showing, line after line opening on "We", replies anyone could say. Your job is the oomph: rewrite the lines so a four-year-old wants to shout them back, and keep every fact true.

THE CRAFT: what makes a line hit. (The examples come from a kite story, not this one: never reuse their words; write this story's own.)
1. Sense first. Every line is a natural little sentence a child would say, its small words (the, a, our, to, and) in place: "The string snaps in two!", never "Kite dips, string snaps". A listener follows the whole story from the lines alone. No word is there only for the rhyme or to fill the count. If the picture does not fit in the syllables with its small words, pick a shorter picture; a plain, clear line beats a clever, crooked one, and a draft line that already sings well may stay close to the draft.
2. Show it, don't report it. Each line is one picture you could see or hear on the stage, with a strong verb. Not "We see the kite fly high" but "The wind yanks the kite!"; not "We feel the cold today" but "Frost nips at our feet". Strong verbs: grab, yank, flip, stomp, splash, wobble, zoom, scoop, gulp, plop, tug, tumble, slam, drip, toss. Weak when a stronger one fits: sing, chant, cheer, shine, glow, see, hear, want, make, show, keep, have, get, go, feel. Strong words are loud: keep a small word between two of them, or the line stomps.
3. Vary the shape. A song whose lines all open on "We" or "Our" drones. Mix them: an exclamation ("Look out, a tree! >> Too late!"), a question ("Who wants a turn? >> Me first!"), a command ("Hold tight, and run!"), a sound ("Whoosh! The kite dips down"), someone or something else doing it ("The scarf flaps loose >> Grab it!", "{Gold:gasp} drops the spool"), a character's own words on a line that character sings ("Watch this, it can fly!"). At most one line in three opens on "We" or "Our"; never three lines in a row on the same word.
4. The last word is the loudest. Rhyme on words that carry the picture, and never pad a line to reach a rhyme (here, near, dear, bright, tonight, today, true, in sight, day and night). Not "We fly the kite up here / The wind blows far and near" but "The wind steals our hat / The kite lands with a splat!". If a rhyme needs padding, change both lines.
5. The replies are the call and response: the pal's quick shout back at that very line, in new words of the pal's own: a gasp, a dare, a joke, a worry or a question ("The scarf flaps loose >> Grab it!"; not ">> Flap, flap!", which only says the line's word again). Every reply in the song is different. A stock one (Wow!, Yay!, Hooray!, Oh no!, How true!, So sweet!, Thanks!) only when nothing sharper fits; a doubled word ("Clap, clap!") at most twice in the song.
6. Play with sound, a little: a sound word a child joins in on (whoosh, splat, clang, boing, plop, zoom) in a few lines, an inner rhyme, two words that start alike.
7. The chorus is the chant. Its lines 2 and 4 (X and Y) are short, rhythmic, natural lines a kid can shout after one hearing, like a playground chant, and tell this story's case in a picture; X is sung in all three choruses, so make every syllable count. The hook keeps its words; on a hook line you write only the reply, the crowd shouting back, and those replies grow from chorus 1 to the outro.
8. Build it. The verses tell the story with punch; verse 2b is the peak, the loudest and funniest moment; the bridges go quiet and tender (soft, short words, still a picture a line, no replies); bridge 2 turns toward the fix; chorus 3's turned line is the payoff and the best line of the song: it keeps the frame of chorus 1's last line and flips it to land the irony ("The wind steals our hat" becomes "The wind brings back our hat"), in words the whole street could shout; the outro is the big warm finish, the world changed.

THE TRUTH
- Keep each line's facts: the same people, things and action of that story beat; never invent an object or an event. Every name (a place, an event, a product, a team) and every number its draft sings stays in that line, as words. Never add a number, a price or an amount that the draft, its beat and the facts do not give.
- A line marked TROUBLE brings in the plot's problem: the same problem as its draft, said as plainly (or more plainly), with punch. A line marked FIX solves it: say plainly how, the friends together.
- Names the story or its facts give are not brands here. Still, never open a line on one (its first sound is lost): put a little word first ("We race to Zoomtown Fair").

THE RULES (a strict tool checks every line; a line that breaks one is sent back to you)
- One line of plain words, at most 80 characters with its markup. The main line sings 2 to ${MAX_LINE_SYLLABLES} syllables (names count; a [Pickup] of 1 to 3 words at the very start, "[And]", "[Oh,]", "[Look,]", comes on top).
- The plain present tense only: "the kite dips", "we run". Never past tense, never "will", "going to" or "'ll". No brand names, nothing scary.
- The echo reply after " >> ": 1 to ${MAX_REPLY_SYLLABLES} syllables of plain words, no names, no markup. Keep a reply where the draft has one. No replies in the bridge sections, and none on a line the pal sings.
- Cues the stage acts out: {Gold} makes Gold look at the word, {Gold:gasp} acts it. Keep the draft's cues while the line still names that bot or moment. At most two names in a line; the singer never sings their own name. Names: ${NAMES.join(', ')}.
- The cast speaks of itself as one: "we", "us", "our", never "I" or "my" (or "me"); only a character's own catchphrase or dare, on a line that character sings, may say "I", and never on a TROUBLE or FIX line or in a bridge. "We" is the voice, not the opening: most lines start on something else.
- Rhyme: in a verse or a bridge, line 4 rhymes with line 2; in a chorus, line 4 rhymes with line 2. The last words truly rhyme (day / away, door / floor) and are two different words.
- Meter: strong and weak syllables take turns (da-DUM da-DUM). Never four stressed syllables in a row ("Hold one warm bowl" stomps; "We hold a warm bowl" sings).
- A stanza says each thing once: no content word twice in a stanza (two lines that open on the same two words are a deliberate echo, and fine). No padding words (so, very, really, just, quite, kind of, thing, stuff). Plain word order, never bent for a rhyme ("the sky so blue", "home we go").
- Everyday words a small child knows and the voice can sing: no digits, no acronyms, no rare words ("ladle"). The voice blurs a final "ng" (sing, song), the "oh" in "glow", and "g", "l", "z"; it rings on sh, ch, f, r, t, p, d, k, m, n and "er". Never end a line on a /ks/ sound (box, snacks, cakes, Black); "box" alone sings badly: say "toy box".
Reply with JSON only: {"lines":[{"id":"L3","lyric":"..."}]}, one entry for every line you were asked to write.`;

/** What each section does for the song's energy (the build the SYSTEM's craft 8 asks for). */
const ENERGY = {
  intro: 'the opening shot: a bold picture or a call that makes a child look up',
  verse1: 'the setup, quick and vivid: who wants what, shown in action',
  verse1b: 'the trouble arrives: a gasp, a sudden picture',
  chorus1: 'the chant: X and Y short, punchy, easy to shout back',
  verse2: 'the first try goes wrong: action and comedy',
  verse2b: 'the peak: the loudest, funniest moment of the song',
  chorus2: 'the chant again, bigger',
  bridge: 'the hush: quiet and tender, soft short words, a picture a line, no replies',
  bridge2: 'the turn: the decision, rising and sure, no replies',
  chorus3: 'the payoff: the turned line is the best line of the song',
  outro: 'the finale: the world changed, a big warm finish',
};

/**
 * The slots of a bundle: Green's sung lines in order, each with its place in the song and what may change. free:
 * Wonder writes it (a hook line only its reply: replyOnly); the form's repeats follow their source. The lines that bring
 * in or solve the plot's trouble (plot) are written too: their marks stay on the event, the TROUBLE / FIX note tells
 * the lyricist what the line must still say.
 */
export function slotsOf(beats, events) {
  const slots = [];
  const perBeat = new Map();
  for (const e of events) {
    if (!e.lyric) continue;
    const i = beats.beats.findIndex((b) => b.id === e.beat);
    if (i < 0) continue;
    const pos = perBeat.get(i) ?? 0;
    perBeat.set(i, pos + 1);
    const section = beats.beats[i].section;
    const plot = Boolean(e.trouble || e.resolves);
    const replyOnly = isHookLine(section, pos);
    const fixed = fixedByForm(section, pos) && !replyOnly;
    slots.push({ id: `L${slots.length + 1}`, seq: e.seq, i, pos, section, original: e.lyric, plot, replyOnly,
      singer: e.singer ?? (section.startsWith('bridge') ? beats.roles?.grown : beats.roles?.lead), withMarks: { trouble: e.trouble, resolves: e.resolves },
      free: !fixed, source: null });
  }
  const at = (section, pos) => slots.find((s) => s.section === section && s.pos === pos);
  for (const s of slots) {
    if (s.section === 'chorus2' && (s.pos === 1 || s.pos === 3)) s.source = at('chorus1', s.pos);
    else if (s.section === 'chorus3' && s.pos === 1) s.source = at('chorus1', 1);
    else if (s.section === 'outro' && s.pos === 1) s.source = at('intro', 0);
    if (s.source && !s.source.free) s.source = null; // (a source that stays: nothing to follow)
  }
  return slots;
}

// ---------------------------------------------------------------------------------------------
// the truth gate: a rewrite keeps the names and numbers its draft sings, and adds no number or amount

const NUMBER_WORDS = new Set(('two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen '
  + 'eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds thousand thousands million millions '
  + 'billion billions dozen dozens').split(' '));
const MONEY_WORDS = new Set('dime dimes nickel nickels cent cents penny pennies dollar dollars buck bucks quarter quarters'.split(' '));
const WORDS_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const bodyOf = (lyric) => { const { text, pickup } = parseLyric(lyric, NAMES); return pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text; };
/**
 * The facts a sung text carries, lower case: { names } (names of things: a capitalised word inside a sentence that is no
 * cast name, a word with a capital inside it, or a word the premise or the brands list names: "meta", "muse",
 * "cocomelon", "musical", "bots"), { numbers } (number words, "one" aside: it is mostly "a") and { money } (dime,
 * cents, dollars...).
 */
export function factsOf(text, things = new Set()) {
  const s = String(text);
  const names = new Set(), numbers = new Set(), money = new Set();
  for (const m of s.matchAll(WORDS_RE)) {
    const base = m[0].replace(/['’]s$/i, ''), lw = base.toLowerCase();
    const opens = !/\S/.test(s.slice(0, m.index)) || /[.!?:;"]\s*$/.test(s.slice(0, m.index)); // (a sentence's first word)
    if (NUMBER_WORDS.has(lw)) numbers.add(lw.replace(/(hundred|thousand|million|billion|dozen)s$/, '$1')); // (thousands: thousand)
    else if (MONEY_WORDS.has(lw)) money.add(lw);
    else if (!NAMES.includes(base) && base !== 'I' && ((!opens && /^[A-Z]/.test(base)) || /[a-z][A-Z]/.test(base) || BRANDS.has(lw) || things.has(lw))) names.add(lw);
  }
  return { names, numbers, money };
}
/**
 * Problems of a rewrite against its draft (ctx: the beat's summary and the plan's facts, which may give a number): a
 * name or a number the draft's line sings and the rewrite drops, a number the draft, its beat and the facts never
 * give, an amount of money (dime, cents...) that the draft does not sing. (The hero: "pocket change" stays pocket
 * change, never "a dime".)
 */
export function truthProblems(draft, lyric, { summary = '', facts = [], premise = '' } = {}) {
  const things = premiseThings(premise);
  const was = factsOf(bodyOf(draft), things), now = factsOf(bodyOf(lyric), things);
  const out = [];
  const lost = [...was.names].filter((n) => !now.names.has(n)).concat([...was.numbers].filter((n) => !now.numbers.has(n)));
  if (lost.length) out.push(`truth: the draft sings ${lost.map((w) => `"${w}"`).join(', ')}: keep ${lost.length > 1 ? 'them' : 'it'} in this line (a name or a number the story gives stays)`);
  const given = factsOf(`${draft} ${summary} ${facts.join(' ')}`, things);
  const added = [...now.numbers].filter((n) => !given.numbers.has(n));
  if (added.length) out.push(`truth: ${added.map((w) => `"${w}"`).join(', ')}: a number the draft, its beat and the facts never give; sing only the story's own numbers`);
  const cash = [...factsOf(parseLyric(lyric, NAMES).text + ' ' + parseLyric(lyric, NAMES).reply, things).money].filter((m) => !factsOf(draft, things).money.has(m));
  if (cash.length) out.push(`truth: ${cash.map((w) => `"${w}"`).join(', ')}: an amount the draft never sings; say what the draft says about the cost`);
  return out;
}
const EXAMPLE_CORES = new Set(EXAMPLE_LINES.map((l) => coreText(l)).filter((c) => c.split(' ').length >= 3));

/** The rhyme partner of a stanza position: line 4 and line 2 answer each other. */
const partnerOfIn = (slots, s) => slots.find((x) => x.i === s.i && x !== s && (rhymePartner(s.section, s.pos) === x.pos || rhymePartner(s.section, x.pos) === s.pos));
/** A line as the cards show it: one space between words, the first letter capital (a model sometimes starts one in lower case). */
export const tidy = (t) => t.trim().replace(/\s+/g, ' ').replace(/^([a-z])/, (c) => c.toUpperCase());
const stanzaOf = (slots, cur, s) => slots.filter((x) => x.i === s.i && x.pos < s.pos).map((x) => cur.get(x.id));

/** The gate for one line, with the lines before it as they stand: [] when the director's tool would accept it. */
export function slotProblems(slot, lyric, { beats, events, cur, slots }) {
  const out = [];
  const roles = beats.roles ?? {};
  out.push(...lineProblems(lyric, { section: slot.section, singer: slot.singer, roles }));
  if (slot.singer && NAMES.some((n) => n === slot.singer) && new RegExp(`(^|[^A-Za-z])${slot.singer}([^A-Za-z]|$)`).test(parseLyric(lyric, NAMES).text.replace(/\{[^}]*\}/g, ' ')))
    out.push(`${slot.singer} sings this line, so it says "we" (or "I"), never "${slot.singer}"`);
  // the song form and the craft checks see the stream as it stands: earlier lines as they are now
  const before = events.filter((e) => e.seq < slot.seq).map((e) => { const s = slots.find((x) => x.seq === e.seq); return s ? { ...e, lyric: cur.get(s.id) } : e; });
  out.push(...formProblems(beats, before, slot.i, slot.pos, lyric));
  const findings = lineCraft(lyric, { section: slot.section, pos: slot.pos, stanza: stanzaOf(slots, cur, slot), hook: beats.hook, frame: frameOf(slots, cur, slot),
    plot: slot.plot, premise: beats.prompt });
  for (const f of findings) if (f.severity === 'reject') out.push(`${f.check}: ${f.message}${f.fix ? ` (${f.fix})` : ''}`);
  // this pass's own, on what Muse Wonder writes: the truth of the draft (a hook line keeps its words anyway), no line of
  // the craft's examples, a reply in the present too ("That was wild!"; the crew's tool reads the line alone), and a
  // cast name with no article ("The {Gold} counts" sings as a thing)
  if (lyric !== slot.original) {
    if (!slot.replyOnly) out.push(...truthProblems(slot.original, lyric, { summary: beats.beats[slot.i]?.summary, facts: beats.facts ?? [], premise: beats.prompt }));
    if (EXAMPLE_CORES.has(coreText(lyric))) out.push('this is a line from your instructions\' kite examples: write this story\'s own line');
    const { reply } = parseLyric(lyric, NAMES);
    const past = reply && pastTense(reply, NAMES);
    if (past) out.push(`the reply's "${past}" is past tense: the reply sings in the plain present too ("Catch it!", "So wild!")`);
    const named = new RegExp(`\\b(the|a|an)\\s+\\{?(${NAMES.join('|')})\\b`, 'i').exec(lyric.split('>>')[0]);
    if (named && /^[A-Z]/.test(named[2])) out.push(`"${named[1]} ${named[2]}": a name takes no article ("{${named[2]}} counts the cups", never "The {${named[2]}} counts")`);
  }
  return out;
}
/** Chorus 3's turned line keeps chorus 1's last line as its frame. */
const frameOf = (slots, cur, s) => (s.section === 'chorus3' && s.pos === 3 ? cur.get(slots.find((x) => x.section === 'chorus1' && x.pos === 3)?.id) ?? null : null);

/** A section's job in the story (vocab.js ARC; the bridge sings "we" here: its lines never say "I", craft.js weOnly). */
const arcOf = (section) => (section === 'bridge' ? 'the grown-up\'s quiet turn, sung for all of them in "we"' : ARC[section] ?? '');

/** What a slot is for, told to the lyricist under its line (its place in the form, the plot). */
function noteOf(s) {
  if (s.replyOnly) return 'the hook: keep its words exactly; write only a fresh reply, the crowd shouting back';
  const notes = [];
  if (s.withMarks.trouble) notes.push('TROUBLE: this line brings in the plot\'s problem; the draft\'s problem, said plainly, with punch');
  if (s.withMarks.resolves) notes.push('FIX: this line solves the plot\'s trouble; say plainly how, in "we"');
  if (s.section === 'intro' && s.pos === 0) notes.push('it comes back in the outro: a line worth hearing twice');
  if (s.section === 'chorus1' && s.pos === 1) notes.push('X: the chant, sung in all three choruses');
  if (s.section === 'chorus1' && s.pos === 3) notes.push('Y: sung in choruses 1 and 2; chorus 3 turns it');
  if (s.section === 'chorus3' && s.pos === 3) notes.push('the turned line: the payoff, the best line of the song');
  if (s.section === 'outro' && s.pos >= 2) notes.push('the world changed: the finish');
  return notes.join('; ');
}

function promptFor(beats, slots, cur, ask, problems = null, brief = '') {
  const lines = [`Episode: "${beats.title}" (the story: ${beats.prompt})`, `The hook (sung in every chorus, already fixed): "${beats.hook}"`, beats.irony ? `The irony the last chorus pays off: ${beats.irony}` : '',
    `The cast: lead ${beats.roles?.lead}, pal ${beats.roles?.pal} (echoes the lead), the grown-up ${beats.roles?.grown}${beats.roles?.rival ? `, the rival ${beats.roles.rival}` : ''}.`].filter((l) => l !== '');
  if (!problems) {
    // (the first ask only: the repairs are the same conversation)
    if (beats.facts?.length) lines.push('', 'The facts the story is built on (true; never sing anything they contradict):', ...beats.facts.map((f) => `- ${f}`));
    if (brief) lines.push('', 'The fact sheet the crew wrote the story from (true; what it asks of the sung lines binds yours too):', '"""', brief.trim(), '"""');
  }
  for (let i = 0; i < beats.beats.length; i++) {
    const b = beats.beats[i];
    const mine = slots.filter((s) => s.i === i);
    if (!mine.length) continue;
    lines.push('', `${b.id} (${b.section}, ${b.set}; ${arcOf(b.section)}; on stage: ${b.cast.join(', ')}): ${b.summary}`);
    if (!problems && ENERGY[b.section]) lines.push(`  How it sings: ${ENERGY[b.section]}`);
    for (const s of mine) {
      const now = cur.get(s.id);
      const role = ask.has(s.id) ? `WRITE ${s.id}` : s.free ? `${s.id} (done)` : s.source ? `${s.id} (repeats ${s.source.id})` : `${s.id} (fixed)`;
      const why = problems?.get(s.id);
      const mate = partnerOfIn(slots, s);
      lines.push(`  ${role}, line ${s.pos + 1} of ${STANZA[s.section]}${s.singer ? `, sung by ${s.singer}` : ''}: ${ask.has(s.id) ? `crew's draft "${s.original}"` : `"${now}"`}${ask.has(s.id) && mate && s.pos > mate.pos ? `; its last word must rhyme with ${mate.id}'s` : ''}`);
      const note = ask.has(s.id) ? noteOf(s) : '';
      if (note) lines.push(`    (${note})`);
      if (why) lines.push(`    your last try was "${why.candidate}" and it breaks: ${why.problems.join('; ')}`);
    }
  }
  const first = problems ? 'Rewrite only these lines (the others stand as they are, shown above), fixing what each breaks, with the same punch.'
    : 'Write the lines marked WRITE, all of them, in order. First hear the whole song in your head (the chant of X and Y, the peak in verse 2b, the hush of the bridges, the turned line), then give every line its picture, its strong verb and its shape.';
  return `${lines.join('\n')}\n\n${first} Reply with the JSON.`;
}

/** The premise's fact sheet for a bundle: briefPath, else director/briefs/<slug>.md when there is one; '' if none. */
export function briefOf({ slug = null, briefPath = null } = {}) {
  const f = briefPath ?? (slug ? join(REPO, 'director', 'briefs', `${slug}.md`) : null);
  return f && existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One chat call to Muse Wonder: { lines, usage } (usage as the Meta Model API reports it). */
export async function askWonder({ messages, key, base = WONDER_BASE, model = WONDER_MODEL, fetchImpl = fetch, timeoutMs = 240000 }) {
  const body = (strict) => JSON.stringify({ model, max_tokens: 24000, reasoning_effort: 'low', ...(strict ? { response_format: { type: 'json_schema', json_schema: { name: 'lyrics', schema: SCHEMA, strict: true } } } : {}), messages });
  const call = async (strict) => fetchImpl(`${base.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body(strict), signal: AbortSignal.timeout(timeoutMs) });
  let res = await call(true);
  if (res.status === 400) res = await call(false); // (a host that takes no strict schema: the same ask without it)
  const text = await res.text();
  if (!res.ok) throw new Error(`Muse Wonder ${res.status}: ${text.split(key).join('[redacted]').slice(0, 300)}`);
  const j = JSON.parse(text);
  const content = j.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(/\{[\s\S]*\}/.exec(content)?.[0] ?? 'null');
  const u = j.usage ?? {};
  return { lines: Array.isArray(parsed?.lines) ? parsed.lines : [], usage: { input_tokens: u.prompt_tokens ?? 0, cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0, output_tokens: u.completion_tokens ?? 0,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0, calls: 1 } };
}

/** A copy of the source's line for a slot that repeats it: the source's words (a reply only where the slot may have one). */
function follow(slot, cur, ctx) {
  const src = cur.get(slot.source.id);
  for (const l of [src, src.split('>>')[0].trimEnd()]) if (!slotProblems(slot, l, ctx).length) return l;
  return null;
}

/**
 * Rewrite the lyrics of the bundle in `dir` with Muse Wonder. Returns the report { ok, ... }; the bundle is changed only
 * when ok (accepted lines > 0 and the full gate finds nothing new).
 */
export async function wonderLyrics(dir, { key = process.env.META_API_KEY, base = process.env.MB_WONDER_BASE || WONDER_BASE, model = process.env.MB_WONDER_MODEL || WONDER_MODEL,
  fetchImpl = fetch, dry = false, log = () => {}, slug = null, briefPath = null } = {}) {
  const t0 = Date.now();
  const report = { ok: false, model, at: new Date().toISOString(), lines: 0, written: 0, kept: 0, rounds: 0, usage: zero(), usd: 0, changes: [], kept_lines: [] };
  if (!key) return { ...report, error: 'no META_API_KEY' };
  try {
    const beats = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
    const events = parseNdjson(readFileSync(join(dir, 'events.ndjson'), 'utf8'));
    const slots = slotsOf(beats, events);
    report.lines = slots.length;
    const cur = new Map(slots.map((s) => [s.id, s.original]));
    const ctx = { beats, events, cur, slots };
    const free = slots.filter((s) => s.free);
    if (!free.length) return { ...report, error: 'no lines to write' };
    const next = new Map(); // the lines Wonder has written and the gates accepted
    let ask = new Set(free.map((s) => s.id)), problems = null;
    const brief = briefOf({ slug, briefPath });
    report.brief = Boolean(brief);
    const messages = [{ role: 'system', content: SYSTEM }];
    for (let round = 1; round <= ROUNDS && ask.size; round++) {
      report.rounds = round;
      messages.push({ role: 'user', content: promptFor(beats, slots, cur, ask, problems, brief) });
      const { lines, usage } = await askWonder({ messages, key, base, model, fetchImpl });
      for (const k of Object.keys(report.usage)) report.usage[k] += usage[k] ?? 0;
      messages.push({ role: 'assistant', content: JSON.stringify({ lines }) });
      problems = new Map();
      const got = new Map(lines.map((l) => [String(l.id), typeof l.lyric === 'string' ? tidy(l.lyric) : '']));
      for (const s of free.filter((x) => ask.has(x.id))) {
        const c = got.get(s.id);
        const p = c ? slotProblems(s, c, ctx) : ['no line was written'];
        if (p.length) problems.set(s.id, { candidate: c ?? '', problems: p });
        else {
          cur.set(s.id, c); next.set(s.id, c);
          for (const f of slots.filter((x) => x.source === s)) cur.set(f.id, follow(f, cur, ctx) ?? f.original); // (a repeat follows at once: its rhyme partner is judged against it)
        }
      }
      ask = new Set(problems.keys());
      if (process.env.MB_WONDER_VERBOSE) for (const [id, w] of problems) log(`  ${id} "${w.candidate}": ${w.problems.join(' | ').slice(0, 300)}`);
      log(`Muse Wonder round ${round}: ${free.length - ask.size} of ${free.length} lines pass the gates${ask.size ? `, ${ask.size} sent back` : ''}`);
    }
    // a stanza with a line that still fails keeps the crew's own lines; then the repeats follow; the whole is checked again
    const revert = (s) => { cur.set(s.id, s.original); next.delete(s.id); };
    for (const s of free.filter((x) => ask.has(x.id))) revert(s);
    // the rhyme partner of a stanza position: line 4 and line 2 answer each other
    const partnerOf = (s) => partnerOfIn(slots, s);
    const settle = () => {
      for (let again = true, n = 0; again && n < 10; n++) {
        again = false;
        for (const s of slots) {
          // (a repeat follows its source only once the source is Wonder's)
          if (s.source) { cur.set(s.id, cur.get(s.source.id) === s.source.original ? s.original : follow(s, cur, ctx) ?? s.original); continue; }
          if (!s.free || !slotProblems(s, cur.get(s.id), ctx).length) continue;
          // a line that no longer fits the lines around it goes back to the crew's: itself if it is Wonder's, else its rhyme partner
          const mate = partnerOf(s), root = mate?.source ?? mate; // (a partner that repeats an earlier line: that line goes back)
          const back = next.has(s.id) ? s : root && next.has(root.id) ? root : null;
          if (back) { revert(back); again = true; }
        }
      }
    };
    settle();
    for (const s of slots) {
      const was = s.original, now = cur.get(s.id);
      if (now !== was) report.changes.push({ id: s.id, beat: beats.beats[s.i].id, from: was, to: now });
    }
    report.written = report.changes.length;
    report.kept = slots.length - report.written;
    report.kept_lines = slots.filter((s) => cur.get(s.id) === s.original && s.free).map((s) => s.original);
    report.usd = Math.round(usdOf(report.usage) * 10000) / 10000;
    report.seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (!report.written) return { ...report, error: 'no line passed the gates' };
    if (dry) return { ...report, ok: true, dry: true };
    // write it, and let the full gate have the last word: a beat it finds fault with goes back to the crew's lines
    // (once), anything still new restores the crew's lyrics
    const before = readFileSync(join(dir, 'events.ndjson'), 'utf8');
    const baseline = new Set(checkBundle(dir).problems);
    const write = () => {
      const bySeq = new Map(slots.map((x) => [x.seq, cur.get(x.id)]));
      writeFileSync(join(dir, 'events.ndjson'), toNdjson(events.map((e) => (bySeq.has(e.seq) ? { ...e, lyric: bySeq.get(e.seq) } : e))));
      return checkBundle(dir).problems.filter((p) => !baseline.has(p));
    };
    let fresh = write();
    if (fresh.length) {
      const beatsNamed = new Set(fresh.map((p) => /^(beat-\d+-[a-z0-9]+)\b/.exec(p)?.[1]).filter(Boolean));
      for (const x of slots.filter((y) => beatsNamed.has(beats.beats[y.i].id) && next.has(y.id))) revert(x);
      settle();
      fresh = write();
    }
    if (fresh.length) {
      writeFileSync(join(dir, 'events.ndjson'), before);
      return { ...report, ok: false, written: 0, error: `the full gate found ${fresh.length} new problem(s), the crew's lyrics stand: ${fresh.slice(0, 3).join('; ')}` };
    }
    report.changes = slots.filter((x) => cur.get(x.id) !== x.original).map((x) => ({ id: x.id, beat: beats.beats[x.i].id, from: x.original, to: cur.get(x.id) }));
    report.written = report.changes.length;
    report.kept = slots.length - report.written;
    report.kept_lines = slots.filter((x) => cur.get(x.id) === x.original && x.free).map((x) => x.original);
    if (!report.written) return { ...report, ok: false, error: 'no line passed the full gate' };
    return { ...report, ok: true };
  } catch (err) {
    return { ...report, ok: false, error: String(err?.message ?? err).split(key).join('[redacted]') };
  }
}
