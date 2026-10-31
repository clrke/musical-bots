#!/usr/bin/env node
// The director's emit tool: the one way the Muse Code crew writes an episode bundle. Every role
// subagent (Green/lyrics ... Pink/comedy) appends its events through it, and the tool is the stage
// manager:
//   - it assigns `seq` and `t` (real seconds since the director started) and appends atomically
//     (one write per call, under a lock), so the bundle is a valid NDJSON stream at every moment and
//     the LIVE page can poll it;
//   - it validates every field, the lyric rules (web/src/gen/rules.js on cues.js plainLyric), the
//     names, the v2 markup and the actions (actions.js resolveAction), and rejects a bad event with a
//     clear message so the agent fixes it and retries (nothing of a rejected call is appended);
//   - it keeps the stream in beat order while seven agents work at once (the turnstile): a beat is
//     open until its stanza is complete and every active agent has moved past it (or LINGER_S
//     seconds after the stanza); events for a later beat are queued and land when it opens (the
//     lead-in first: White's chords, Blue's lights), events for a closed beat are refused. Nothing
//     blocks. So the stream is the song's order and its `t` is the real making-of timeline;
//   - after each call it prints the blackboard: the open beat, its lines so far, who is waited on
//     and the consultations addressed to the caller. A consulted bot's answer is its first event
//     after the question that names the asker back in `consult` (it may be sent ahead: the role
//     prompts arrange some); the tool tags it `answers: <the question's seq>`, so the making-of
//     sings the pair as a duet. A beat's questions land first, so its answers follow them;
//   - it runs the craft checks (craft.js: the dictionary, rhyme quality, meter, balance, filler,
//     inversion, repeats) on every sung line and summary. Unlike the hard rules they can be wrong
//     about a good line, so they bend: a failed check rejects with how to fix it and how to bypass
//     it (resend with "bypass": {"<check>": "<why, at least 4 words>"}); a bypass is recorded on the
//     event (`bypassed`), at most MAX_BYPASSES per agent per episode, never on the hook. The run's
//     mode (state.craft.mode, direct.js --craft): strict (the default), warn (notes only), off.
//
//   emit.js [--dir D] [--as AGENT] ['<json>']   append events (JSON object, array, or NDJSON on stdin)
//   emit.js --beats ['<json>']                   write beats.json (the director's plan) and open beat 1
//   emit.js --status [--as AGENT]                the plan and the blackboard (registers AGENT)
//   emit.js --read [BEAT]                        every sung line so far (or one beat's events)
//   emit.js --done AGENT                         AGENT has nothing more to add
//   emit.js --check                              the gate: the finished bundle (exit 1 on problems)
// D defaults to $MB_DIRECTOR_DIR. Exit codes: 0 ok or queued, 2 rejected, 1 usage.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lyricProblems } from '../../web/src/gen/rules.js';
import { lineProblems as genLineProblems, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, endsKs } from '../../web/src/gen/lyrics.js';
import { rhymes, lastWord, pastTense } from './rhyme.js';
import { parseLyric, plainLyric, namesIn } from '../../web/src/cues.js';
import { modernBundle } from '../../web/src/cast16.js';
import { syllabify } from '../../web/src/mv/voice/syllables.js';
import {
  ROLES, SETS, STATUSES, STANZA, ARC, NO_REPLY, SECTIONS, TITLES, NAMES, AGENT_BOT, ACTS, HAND_CUES, LIGHT_MOODS,
  CHORD_RE, resolveAction, beatId, sectionChords, REAL_PLAYS, PLAY_PRIORITY, rolePlays,
} from './vocab.js';
import {
  CHECKS, MAX_BYPASSES, MIN_REASON_WORDS, MODES, lineCraft, hookCraft, summaryCraft, premiseWords, isHookLine,
} from './craft.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
export const LINGER_S = env('MB_EMIT_LINGER_S', 15); // a complete stanza waits this long for laggards
const MAX_BATCH = 6;
const FIELDS = ['agent', 'bot', 'status', 'beat', 'summary', 'lyric', 'chords', 'action', 'consult', 'singer', 'with', 'bypass'];
const IGNORED = ['seq', 't', 'answers', 'bypassed']; // the tool assigns them
/** A summary (the crew's sung thought) sings at most this many syllables. */
export const MAX_SUMMARY_SYLLABLES = 10;
/**
 * beats.json `summaries`: the crew's summaries are their talk to each other (every run since Oct 31: TALK_VOICE);
 * TEAM_VOICE bundles (Oct 30-31) sang the team's thought in "we"; FIRST_PERSON bundles (Oct 29-30) each bot's own
 * "I"; bundles before them have none (third person). Each keeps its own checks, so every bundle still validates.
 */
export const TEAM_VOICE = 'we';
export const FIRST_PERSON = 'first-person';
/**
 * Every run since Oct 31 (the owner: "It should sound conversational between the bots, not towards the audience. Do
 * not break the fourth wall."): a summary is a line said to a crewmate while they work ("White, is G too bright
 * here?"), or a reaction / an answer to one; sung as written (web/src/team-voice.js TALK).
 */
export const TALK_VOICE = 'talk';
/** The crew (the seven role bots): the crewmates a summary talks to. */
export const CREW_NAMES = Object.values(AGENT_BOT);
/** At most this share of an agent's summaries may talk to nobody (no crewmate named, no reaction, no answer). */
export const MAX_PLAIN_SHARE = 1 / 3;

// ---------------------------------------------------------------------------------------------
// Text helpers

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
/** A prompt as a bundle slug: "gold-sells-hot-soup-on-a-col". */
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'episode';
/** A line reduced for "same words" comparisons: no markup, pickup, reply or punctuation. */
export function coreText(lyric) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  const body = pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text;
  return body.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The example songs' lines (director/prompts/example.md and the V5 stanzas in lyrics.md), as core
 * texts: the crew meets their bar with lines of its own, never a copy.
 */
let borrowed = null;
export function borrowedLines() {
  if (borrowed) return borrowed;
  borrowed = new Set();
  for (const f of ['example.md', 'lyrics.md']) {
    let text = '';
    try { text = readFileSync(join(REPO, 'director/prompts', f), 'utf8'); } catch { continue; }
    const code = [...text.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    const lines = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
      .concat(code.split('\n').map((l) => l.replace(/^[A-Za-z0-9 ]+:\s+/, '').replace(/\s+\(.*\)\s*$/, '')));
    for (const l of lines) {
      const c = coreText(l.replace(/^@\w+\s+/, ''));
      if (c.split(' ').length >= 3) borrowed.add(c);
    }
  }
  return borrowed;
}
const syllables = (s) => (s.trim() ? syllabify(s).length : 0);
const lastWordOf = (s) => (String(s).match(/[A-Za-z']+(?=[^A-Za-z']*$)/) ?? [''])[0];

const FIRST_PERSON_RE = /\b(i|i'm|i've|i'd|me|my|mine|myself)\b/i;
const WE_RE = /\b(we|we're|we've|we'd|us|our|ours|ourselves)\b/i;
/** "I" / "me" / "my" in a text (the capital "I" only: the letter in a lower-case word is no pronoun). */
const SINGULAR_RE = /(^|[^A-Za-z'])(I|I'm|I've|I'd|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)(?![A-Za-z'])/;
const voiceOf = (voice, firstPerson) => voice ?? (firstPerson ? 'I' : null);

/**
 * The fourth wall: words that speak to (or of) the people watching, never said in the crew's talk. [regex, what it
 * is]. Their work is fine ("the hook", "this chorus", "the bridge", "the beat"); the story's own crowd is the
 * story's, so it goes in Green's lines, not in the crew's talk.
 */
const FOURTH_WALL = [
  [/\b(audiences?|viewers?|onlookers?|spectators?|listeners?)\b/i, 'the people watching'],
  [/\b(watch|watches|watched|watching|watchers?)\b/i, 'being watched'],
  [/\b(folks|everyone|everybody|y'all|kids|children|boys and girls|ladies and gentlemen|friends at home|at home)\b/i, 'the viewers'],
  [/\b(you all|all of you|you guys|you lot)\b/i, 'the viewers'],
  [/\b(look at us|see us|hear us|join us|with us tonight)\b/i, 'the viewers'],
  [/\b(episodes?|cartoons?|trailers?|videos?|cameras?|premieres?|making-of|on screen|on air|tv|television|livestream|channel|subscribe|showtime)\b/i, 'the show being filmed'],
  [/\b(the|our|this|a|your|tonight's|big|whole|great) show\b/i, 'the show being filmed'],
];
/** The fourth-wall words of a summary: [{ word, what }]. */
export function fourthWall(summary) {
  const out = [];
  for (const [re, what] of FOURTH_WALL) {
    const m = re.exec(String(summary ?? ''));
    if (m) out.push({ word: m[0], what });
  }
  return out;
}
/** A summary that opens on a reaction to a crewmate ("Nice one, Pink!", "Ooh, let me try a warmer one", "Sure!"). */
const REACTION_RE = /^\W*(nice|ooh|oh|ah|aw|aha|ha|yes|yeah|yep|yay|sure|okay|ok|alright|all right|wow|whoa|great|good|hmm|right|got it|love it|perfect|deal|cool|sweet|hey|thanks|thank you|of course|uh-oh|oops|no way|hooray|agreed|totally|exactly|me too|you bet|lovely|brilliant|true|fair|ooh la la|bravo|neat|wait|hold on|look|listen)\b/i;
/**
 * Whether a "talk" summary talks to the crew: it names a crewmate (not the speaker), opens on a reaction, or is an
 * answer / a deal with a crewmate (its `consult`, outside a question). e: { summary, bot, status, consult }.
 */
export function talks(e) {
  const s = String(e?.summary ?? '');
  if (namesIn(s, CREW_NAMES).some((n) => n !== e?.bot)) return true;
  return dialogue(e);
}
/** A suggestion to the crew ("Let's try amber", "What if Pink trips?", "How about a slower G?", "Try the gold one"). */
const SUGGEST_RE = /(^\W*|[,.!?]\s+)(let's|let us|what if|how about|can we|could we|shall we|why not|maybe we|try)\b/i;
/** A summary that asks something (a "?" in it). */
export const isQuestion = (e) => /\?/.test(String(e?.summary ?? ''));
/**
 * A summary that is dialogue, not a remark into the air: a question, an answer (`answers`, or a deal or reply to a
 * crewmate: its consult outside a question), a reaction ("Ha! That puddle gag kills me, Pink"), a suggestion ("Too
 * bright? Let's try amber").
 */
export function dialogue(e) {
  const s = String(e?.summary ?? '');
  if (isQuestion(e) || REACTION_RE.test(s) || SUGGEST_RE.test(s) || e?.answers !== undefined) return true;
  return e?.status !== 'consulting' && (e?.consult ?? []).some((n) => n !== e?.bot);
}
/**
 * A formula: "<Name>, we ..." (the first talk runs: a name, then a remark into the air), or the tag question that
 * replaced it ("Cloudy take, huh, Yellow?", "Too bright, right, Blue?").
 */
export function isFormula(e) {
  const t = String(e?.summary ?? '');
  const m = /^\W*([A-Z][a-z]+),\s+(we|we're|we've|our|us)\b/.exec(t);
  if (m && NAMES.includes(m[1])) return true;
  return /,\s*(huh|right|yeah|eh|okay|ok|yes)\s*(,\s*[A-Z][a-z]+)?\s*\?\s*$/i.test(t);
}
/** A summary that opens on a name ("Gold, ..."). */
export function opensOnName(e) {
  const m = /^\W*([A-Z][a-z]+)\s*[,!?]/.exec(String(e?.summary ?? ''));
  return !!m && NAMES.includes(m[1]);
}
/** At most this share of an agent's summaries may be the formula ("<Name>, we ..."). */
export const MAX_FORMULA_SHARE = 1 / 4;
/** At most this share may open on a name (a name where a person would use it: often at the end, or none at all). */
export const MAX_NAME_FIRST_SHARE = 1 / 2;
/** At least this share of an agent's summaries is dialogue (a question, an answer, a suggestion, a reaction). */
export const MIN_DIALOGUE_SHARE = 1 / 3;
/** At least this share of an agent's summaries asks something (a "?"): pitching, checking, asking for feedback. */
export const MIN_QUESTION_SHARE = 1 / 4;
/** At most this share opens on a reaction ("Yes!", "Ha!", "Good!"), and on any one word. */
export const MAX_REACTION_SHARE = 1 / 3;
export const MAX_OPENER_SHARE = 1 / 6;
/** A summary's first word, lower case ("Yes! Keep it" -> "yes", "Let's go" -> "let's"). */
const openerOf = (e) => (/[A-Za-z][A-Za-z']*/.exec(String(e?.summary ?? ''))?.[0] ?? '').toLowerCase();
/** Questions (status "consulting") each role asks in an episode; answered consultations an episode needs. */
export const MIN_QUESTIONS = 2;
export const MIN_EXCHANGES = 8;
/**
 * A summary reduced for the anti-copy gate: its words without the names, the openers and the small words ("Ooh, Gold,
 * frosty blue for the street!" and "Blue, frosty blue for a street" are one), so swapping a name or an "Ooh" is no
 * way round it. Null when fewer than three words are left (too short to be a copy of anything).
 */
const COPY_SKIP = new Set(['ooh', 'oh', 'ah', 'wow', 'nice', 'yes', 'yeah', 'okay', 'ok', 'sure', 'hey', 'so', 'a', 'an', 'the', 'this', 'that', 'just', 'now']);
export function copyKey(summary) {
  const w = coreText(String(summary ?? '')).split(' ').filter((x) => x && !COPY_SKIP.has(x) && !NAMES.some((n) => n.toLowerCase() === x));
  return w.length >= 3 ? w.join(' ') : null;
}
/**
 * The example summaries of the prompts (director/prompts/*.md: every `"summary": "..."` and every quoted example in
 * the prose), as copy keys: the crew talks in its own words, never a copy (a name or an "Ooh" swapped is a copy too).
 * Every stretch between two quote marks is a candidate (so a stray quote never hides one); the rest is harmless.
 */
let borrowedTalk = null;
export function borrowedSummaries() {
  if (borrowedTalk) return borrowedTalk;
  borrowedTalk = new Set();
  for (const f of ['rules.md', 'director.md', 'lyrics.md', 'chords.md', 'dance.md', 'lighting.md', 'deals.md', 'hype.md', 'comedy.md']) {
    let text = '';
    try { text = readFileSync(join(REPO, 'director/prompts', f), 'utf8'); } catch { continue; }
    for (const x of text.split('"')) {
      if (x.length < 8 || x.length > 100 || /[{}]|\.\.\./.test(x)) continue;
      const k = copyKey(x.replace(/\s+/g, ' '));
      if (k) borrowedTalk.add(k);
    }
  }
  return borrowedTalk;
}
/**
 * Problems of a summary (the crew's sung thought; the making-of sings it). opts: { voice, bot, status, consult }:
 *   voice 'talk' (TALK_VOICE, every run since Oct 31): what the bot says to a crewmate as it works, present tense,
 *     2-10 sung syllables, rule-clean, plain text ("White, is G too bright here?", "Nice one, Pink!"); never a
 *     fourth-wall word (fourthWall: the audience, being watched or filmed), never the bot's own name, a crewmate's
 *     name at most once, a question (status consulting) names a bot it asks (consult), never a prompt's example
 *     word for word (borrowedSummaries); the share of an agent's summaries that talk to nobody: talkProblems;
 *   voice 'we' (TEAM_VOICE, Oct 30-31): the team's thought in "we", present tense, 2-10
 *     sung syllables, rule-clean, plain text ("We ask Green where the hook lands", "We put a gold spot
 *     on Purple"); never "I" / "my", never the bot's own name as its subject;
 *   voice 'I' (FIRST_PERSON bundles, Oct 29-30; `firstPerson: true` says the same): the bot's own "I";
 *   no voice (older bundles, third person, "White sets the key"): short, rule-clean, plain text.
 */
export function summaryProblems(summary, { voice = null, firstPerson = false, bot = null, status = null, consult = [] } = {}) {
  const v = voiceOf(voice, firstPerson);
  const p = [];
  if (typeof summary !== 'string' || !summary.trim()) {
    if (v === 'talk') return ['summary is required: what you say to a crewmate as you work, sung in the making-of ("White, is G too bright here?", "Nice one, Pink!")'];
    return [v === 'we' ? 'summary is required: the team\'s thought, sung in the making-of, in "we" ("We ask Green where the hook lands")'
      : v ? 'summary is required: your thought, sung in the making-of, in your own "I" ("I ask Green where the hook lands")'
        : 'summary is required: one short present-tense sentence of what the bot does now'];
  }
  const s = summary.trim();
  if (/[\n\r]/.test(s)) p.push('summary must be one line');
  if (/[{}]|>>|\[/.test(s)) p.push('summary is plain text (markup goes in the lyric)');
  for (const r of lyricProblems(s)) p.push(`summary breaks a lyric rule: ${r}`);
  if (!v) {
    if (s.length > 90 || words(s).length > 14) p.push(`summary is too long (${words(s).length} words; at most 14 words / 90 characters)`);
    return p;
  }
  // the bot's own name as the subject ("Gold counts ..."): the Capitalised name only ("gold coins shine" is fine)
  const own = bot && new RegExp(`^\\W*${bot}\\b(?!,)`).test(s);
  if (v === 'talk') {
    // the crew talking to each other as they work, in character: never to the people watching
    for (const { word, what } of fourthWall(s)) {
      p.push(`summary: "${word}" speaks to ${what === 'the people watching' || what === 'the viewers' ? 'the viewers' : `the viewers (${what})`}: never break the fourth wall. Talk to a crewmate about the work instead ("Blue, dim it down for the bridge", "Gold, can we fit one more bar?")`);
    }
    if (bot && namesIn(s, [bot]).length) p.push(`summary names ${bot}, the one saying it: you are ${bot}, so name the crewmate you talk to ("White, is G too bright here?") or say "I" / "we" ("I try a warmer one")`);
    const named = namesIn(s, CREW_NAMES).filter((n) => n !== bot);
    const twice = named.find((n, i) => named.indexOf(n) !== i);
    if (twice) p.push(`summary names ${twice} twice: call the crewmate you talk to by name once ("Pink, is the slip too big?")`);
    if (status === 'consulting' && consult?.length && !consult.some((n) => namesIn(s, [n]).length)) {
      p.push(`a question names the bot it asks: say it to ${consult[0]}, by name ("${consult[0]}, ${consult[0] === 'Green' ? 'where does the hook land?' : 'can you help me here?'}")`);
    }
    if (borrowedSummaries().has(copyKey(s))) p.push('summary copies an example from the prompt (a name or an "Ooh" swapped is still a copy): say it in your own words, about this episode\'s story');
    // the crew talks among itself: the story's cast are in the song, not at work in the studio
    const hail = /^\W*([A-Z][a-z]+)\s*[,!?]/.exec(s)?.[1] ?? /,\s*([A-Z][a-z]+)\s*[?!.]*$/.exec(s)?.[1];
    if (hail && NAMES.includes(hail) && !CREW_NAMES.includes(hail)) {
      p.push(`summary talks to ${hail}, who is in the story, not on the crew: say it to a crewmate (${CREW_NAMES.filter((n) => n !== bot).join(', ')}) about ${hail} ("${CREW_NAMES.find((n) => n !== bot)}, ${hail} ...")`);
    }
  } else if (v === 'we') {
    if (own || !WE_RE.test(s) || SINGULAR_RE.test(s)) {
      p.push(`summary is the team's sung thought, in "we"${own ? `, never "${bot} ..."` : SINGULAR_RE.test(s) ? ', never "I" or "my"' : ''}: "We ask Green where the hook lands", "We put a gold spot on Purple", "We land the hook on soup"`);
    }
  } else if (own || !FIRST_PERSON_RE.test(s)) {
    p.push(`summary is your sung thought, in your own "I"${own ? `, never "${bot} ..."` : ''}: "I ask Green where the hook lands", "I land the hook on soup"`);
  }
  const n = syllables(s.replace(/[^A-Za-z' ,.!?-]/g, ' '));
  if (n > MAX_SUMMARY_SYLLABLES) p.push(`summary sings ${n} syllables: ${v === 'talk' ? `what you say is short and singable, at most ${MAX_SUMMARY_SYLLABLES} ("White, is G too bright here?" is 6)` : `a thought is short and singable, at most ${MAX_SUMMARY_SYLLABLES} ("We ask Green where the hook lands" is 7)`}`);
  else if (n < 2) p.push(`summary sings at least 2 syllables ("${v === 'talk' ? 'Nice, Pink!' : v === 'we' ? 'We nod' : 'I nod'}")`);
  const past = pastTense(s, NAMES);
  if (past) p.push(`summary: "${past}" is past tense: ${v === 'talk' ? 'talk in the present ("Let\'s pick the chords", not "We picked")' : 'think in the present ("We pick the chords", not "We picked")'}`);
  return p;
}
/** The voice a bundle's summaries are checked in (beats.json `summaries`): 'we', 'I' or null (third person). */
export const summaryVoice = (beats) => (beats?.summaries === TALK_VOICE ? 'talk' : beats?.summaries === TEAM_VOICE ? 'we' : beats?.summaries === FIRST_PERSON ? 'I' : null);

/**
 * The talk of an agent's summaries ("talk" bundles): at most MAX_PLAIN_SHARE of them (rounded up, so one of its
 * first two) may talk to nobody (talks: no crewmate named, no reaction, no answer), and none says again what the
 * agent said before (word for word). prev: the agent's events sent
 * so far; fresh: its new ones. Returns the problems of the fresh ones, each with its index in `fresh`.
 */
export function talkProblems(prev, fresh) {
  let total = prev.length, plain = prev.filter((e) => !talks(e)).length;
  let formula = prev.filter(isFormula).length, first = prev.filter(opensOnName).length, said_ = prev.filter(dialogue).length;
  let asks = prev.filter(isQuestion).length, reacts = prev.filter((e) => REACTION_RE.test(String(e.summary ?? ''))).length;
  const openers = new Map(), recent = prev.slice(-2).map(openerOf);
  for (const e of prev) openers.set(openerOf(e), (openers.get(openerOf(e)) ?? 0) + 1);
  const out = [];
  const said = new Set(prev.map((e) => coreText(e.summary ?? '')));
  fresh.forEach((e, i) => {
    const k = coreText(e.summary ?? '');
    if (k && said.has(k)) out.push({ i, message: `summary "${e.summary}": you said that already this episode. Say what is new in this beat's work, in fresh words` });
    said.add(k);
    total++;
    const problems = [];
    if (!talks(e) && plain + 1 > Math.ceil(total * MAX_PLAIN_SHARE - 1e-9)) {
      problems.push(`summary "${e.summary}" talks to nobody: the crew talks to each other as they work. Ask a crewmate something ("Too bright, White?"), answer or react to what one just said ("Ha! That puddle gag kills me, Pink"), or suggest ("Let's try amber"). At most one in three of yours is a plain remark (you have ${plain} of ${total - 1})`);
    }
    if (isFormula(e) && formula + 1 > Math.max(1, Math.ceil(total * MAX_FORMULA_SHARE - 1e-9))) {
      problems.push(`summary "${e.summary}" is a formula ("<Name>, we ..." or a tag like "..., huh, Gold?"): a remark into the air, not talk. Vary it as people do, in a whole little sentence: ask a real question ("Does this sit on the beat, White?"), suggest ("What if Pink trips here?"), react ("Ooh, that works!"), or tell one crewmate what you need ("I need one more bar, Gold"). At most one in four of yours (you have ${formula} of ${total - 1})`);
    }
    if (opensOnName(e) && first + 1 > Math.max(2, Math.ceil(total * MAX_NAME_FIRST_SHARE - 1e-9))) {
      problems.push(`summary "${e.summary}" opens on a name again (${first} of your ${total - 1} do): use a name where a person would, often at the end ("Too bright, Blue?"), or none when you answer straight back ("Yes! Let's keep it")`);
    }
    if (!dialogue(e) && total >= 3 && said_ < Math.floor(total * MIN_DIALOGUE_SHARE + 1e-9)) {
      problems.push(`summary "${e.summary}": too few of yours are dialogue (${said_} of ${total - 1}). Make this one a question to a crewmate, a suggestion ("Let's ...", "What if ...", "Can we ...?"), or a reaction to what one just said on the blackboard ("Ha! I love that, Pink")`);
    }
    const w = openerOf(e), reaction = REACTION_RE.test(String(e.summary ?? ''));
    if (w && recent.includes(w) && (reaction || w === "let's")) {
      problems.push(`summary "${e.summary}" opens with "${w}" again, as one of your last two did: people do not start every line the same way. Start this one differently (a question, a suggestion, a thought about the line)`);
    } else if (w && (openers.get(w) ?? 0) + 1 > Math.max(2, Math.ceil(total * MAX_OPENER_SHARE - 1e-9))) {
      problems.push(`summary "${e.summary}" opens with "${w}" for the ${(openers.get(w) ?? 0) + 1}th time: vary how you start`);
    }
    if (reaction && reacts + 1 > Math.max(2, Math.ceil(total * MAX_REACTION_SHARE - 1e-9))) {
      problems.push(`summary "${e.summary}" opens on a reaction ("Yes!", "Ha!", "Good!") again (${reacts} of your ${total - 1}): react only to something a crewmate really said; otherwise ask about the work ("Does this line sit on the beat, White?") or say what you think of it`);
    }
    if (!isQuestion(e) && !(e.consult ?? []).some((n) => n !== e.bot) && total >= 4 && asks < Math.floor(total * MIN_QUESTION_SHARE + 1e-9)) {
      problems.push(`summary "${e.summary}": you ask too little (${asks} questions in your ${total - 1}). Make this one a real question to a crewmate about the work (pitch it and ask: "Is this line funny enough, Pink?")`);
    }
    if (problems.length) { out.push(...problems.map((message) => ({ i, message }))); total--; return; } // (refused: not said)
    openers.set(w, (openers.get(w) ?? 0) + 1);
    recent.push(w); if (recent.length > 2) recent.shift();
    if (isQuestion(e)) asks++;
    if (reaction) reacts++;
    if (!talks(e)) plain++;
    if (isFormula(e)) formula++;
    if (opensOnName(e)) first++;
    if (dialogue(e)) said_++;
  });
  return out;
}

/**
 * Problems of one sung line (v2 markup): ctx { section, singer, roles }.
 * The lyric rules apply to what is sung (plainLyric: the line and its reply, markup removed).
 */
export function lineProblems(lyric, { section, singer, roles = {} } = {}) {
  const p = [];
  const s = String(lyric);
  if (/[\n\r]/.test(s)) return ['a lyric is one line (one event per line)'];
  if (s.length > 80) p.push(`the line is too long (${s.length} characters, at most 80 with markup)`);
  if ((s.match(/>>/g) ?? []).length > 1) p.push('a line takes at most one " >> reply"');
  const [line, replyRaw = null] = s.split('>>');
  const braces = line.replace(/\{[A-Za-z][A-Za-z-]*(?::[a-z][a-z0-9-]*)?\}/g, '');
  if (/[{}]/.test(braces)) p.push('bad {Name} or {Name:act} markup (a cue is {Gold} or {Gold:gasp}, a canon name and an act)');
  for (const m of line.matchAll(/\{([A-Za-z][A-Za-z-]*)(?::([a-z][a-z0-9-]*))?\}/g)) {
    if (!NAMES.some((n) => n.toLowerCase() === m[1].toLowerCase())) p.push(`{${m[1]}} is not a bot (names: ${NAMES.join(', ')})`);
    if (m[2] && !HAND_CUES.has(m[2]) && !ACTS.includes(m[2])) p.push(`{${m[1]}:${m[2]}}: "${m[2]}" is not a cue (hand cues: ${[...HAND_CUES].join(', ')}; face acts: ${ACTS.join(', ')})`);
  }
  const pick = /^\s*\[([^\]]+)\]\s*/.exec(line);
  if (/\[|\]/.test(pick ? line.slice(pick[0].length) : line)) p.push('[Pickup] goes only at the very start of the line, e.g. "[And] Gold counts every cent"');
  if (pick && words(pick[1]).length > 3) p.push('a [Pickup] is 1-3 words');
  const { text, pickup, reply } = parseLyric(s, NAMES);
  const body = (pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text).trim();
  if (!body) p.push('the line has no words');
  const named = namesIn(body, NAMES).length; // the Capitalised name only: "a gold coin" names nobody
  if (named > 2) p.push('at most two names a line');
  // the generator's own gates (web/src/gen/lyrics.js lineProblems), explained for the agent
  for (const q of genLineProblems(s)) {
    if (/syllables$/.test(q)) p.push(`the line sings ${syllables(body)} syllables (names included, the [pickup] aside): a line sings 2-${MAX_LINE_SYLLABLES}, so the tune can carry it`);
    else if (q === 'reply length') p.push(`the reply "${reply}" sings ${syllables(reply)} syllables: a reply sings 1-${MAX_REPLY_SYLLABLES}`);
  }
  if (replyRaw !== null) {
    if (!reply) p.push('an empty " >> reply"');
    if (NO_REPLY.has(section)) p.push(`no " >> replies" in the ${section} (the echo hums there)`);
    if (singer && roles.pal && singer === roles.pal) p.push(`${singer} is the echo: a line the pal sings gets no reply`);
    if (/[{}[\]]/.test(replyRaw)) p.push('a reply is plain words (no cues or pickups)');
    if (reply && namesIn(reply, NAMES).length) p.push('a reply names nobody');
  }
  for (const r of lyricProblems(plainLyric(s))) p.push(`lyric rule: ${r} (no future tense, no brands, nothing menacing)`);
  if (borrowedLines().has(coreText(s))) p.push('this line is from the example song: meet its bar with this story\'s own words');
  // the voice blurs a final /ks/ (box, Black, snacks, cakes): a line ends on another sound
  if (body && endsKs(body)) p.push(`the line ends on a /ks/ sound ("${lastWordOf(body)}"), which the voice blurs: end it on another word`);
  const past = pastTense(line, NAMES);
  if (past) p.push(`"${past}" is past tense: the story sings in the plain present ("we hold the cake", "it tips over", "{Gold} counts the coins")`);
  if (/(^|[\s,!.?])(a|an|the|my|his|her|its|your|their|this|that|one)\s+box(es)?\b/i.test(plainLyric(s)) || /^\s*box(es)?\b/i.test(body))
    p.push('"box" alone sings badly (its final /ks/ blurs): use a noun phrase, e.g. "toy box", "cardboard box"');
  return p;
}

// ---------------------------------------------------------------------------------------------
// beats.json (the director's plan)

/**
 * Validate + complete a plan. Returns { beats, errors, notes }. fill: { prompt, seed, summaries
 * (TALK_VOICE: the tool's marker for the crew's talk; TEAM_VOICE and FIRST_PERSON kept from the "we" and "I" bundles), craft (the run's craft mode: the
 * hook's craft checks, never bypassed, are errors when strict and notes when warn; none when unset,
 * as at the gate) }. notes: what the craft checks saw (and the premise's words the hook may sing
 * though the singer does not know them: notes.accepted).
 */
export function validateBeats(raw, fill = {}) {
  const errors = [];
  const notes = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { beats: null, errors: ['beats.json is one JSON object'], notes };
  const out = {
    prompt: fill.prompt || (typeof raw.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : undefined), // the run's own prompt wins
    seed: typeof raw.seed === 'string' && raw.seed.trim() ? raw.seed.trim() : fill.seed,
    version: 2,
    title: raw.title, roles: raw.roles, tags: raw.tags, hook: raw.hook, irony: raw.irony,
    // the checked facts behind a premise about something real (the director's web research / the brief)
    ...(Array.isArray(raw.facts) && raw.facts.some((f) => typeof f === 'string' && f.trim())
      ? { facts: raw.facts.filter((f) => typeof f === 'string' && f.trim()).slice(0, 12).map((f) => f.trim().slice(0, 300)) } : {}),
    // the crew's summaries are their talk to each other ("talk", the tool's marker since Oct 31; "we" bundles sang
    // the team's thought, "first-person" ones "I", older ones have none)
    ...([TALK_VOICE, TEAM_VOICE, FIRST_PERSON].includes(fill.summaries ?? raw.summaries) ? { summaries: fill.summaries ?? raw.summaries } : {}),
    director: raw.director ?? fill.director,
    beats: [],
  };
  if (!out.prompt) errors.push('prompt: the episode prompt');
  if (!out.seed) errors.push('seed: a non-empty string');
  if (raw.version !== undefined && raw.version !== 2) errors.push('version must be 2');
  if (typeof out.title !== 'string' || !out.title.trim() || out.title.length > 40) errors.push('title: the episode title, 1-40 characters');
  else for (const r of lyricProblems(out.title)) errors.push(`title breaks a lyric rule: ${r}`);
  const roles = out.roles;
  if (!roles || typeof roles !== 'object') errors.push('roles: { lead, pal, grown, rival } (canon names)');
  else {
    for (const k of ['lead', 'pal', 'grown']) if (!NAMES.includes(roles[k])) errors.push(`roles.${k} must be a canon name (${NAMES.join(', ')})`);
    if (roles.rival !== undefined && !NAMES.includes(roles.rival)) errors.push('roles.rival must be a canon name (or leave it out)');
    for (const k of Object.keys(roles)) if (!['lead', 'pal', 'grown', 'rival'].includes(k)) errors.push(`roles.${k}: only lead, pal, grown, rival`);
    const vals = ['lead', 'pal', 'grown', 'rival'].map((k) => roles[k]).filter(Boolean);
    if (new Set(vals).size !== vals.length) errors.push('roles: lead, pal, grown and rival are four different bots');
  }
  if (!out.tags || !['suspense', 'tender'].includes(out.tags.bridge)) errors.push('tags: { "bridge": "suspense" | "tender", "outro": "conclusive" | "soft" } (bridge 2 a cliffhanger or a warm decision; the outro ends home or fades)');
  else if (out.tags.outro !== undefined && !['conclusive', 'soft'].includes(out.tags.outro)) errors.push('tags.outro: "conclusive" (ends home) or "soft" (a night or a lullaby ending)');
  else out.tags = { bridge: out.tags.bridge, outro: out.tags.outro ?? 'conclusive' };
  if (typeof out.hook !== 'string' || !out.hook.trim()) errors.push('hook: the chorus hook line (sung first and third in every chorus)');
  else {
    for (const q of lineProblems(out.hook, { section: 'chorus1' })) errors.push(`hook: ${q}`);
    if (/>>/.test(out.hook)) errors.push('hook: the plain hook line (Green adds replies when he sings it)');
    // the craft checks: the hook is sung seven times, so it is never bypassed; the premise's own words
    // it keeps are accepted even when the singer does not know them (reported: a lexicon entry follows)
    if (fill.craft && fill.craft !== 'off') {
      const premise = premiseWords(out.prompt);
      for (const f of hookCraft(out.hook, { allow: premise })) {
        const q = `hook (${f.check}): ${f.message}; ${f.fix} (the hook is never bypassed)`;
        if (fill.craft === 'strict' && f.severity === 'reject') errors.push(q); else notes.push(q);
      }
      const unknown = hookCraft(out.hook).find((f) => f.check === 'dictionary')?.words ?? [];
      const accepted = unknown.filter((w) => premise.has(w));
      if (accepted.length) {
        notes.accepted = accepted;
        notes.push(`hook: the singer does not know ${accepted.map((w) => `"${w}"`).join(', ')}, the premise's own word${accepted.length > 1 ? 's' : ''}: accepted for this episode (it sings ${accepted.length > 1 ? 'them' : 'it'} by its spelling rules; a lexicon entry in web/src/mv/voice/text/lexicon.js makes ${accepted.length > 1 ? 'them' : 'it'} right)`);
      }
    }
  }
  if (typeof out.irony !== 'string' || words(out.irony).length < 6) errors.push('irony: one sentence, the irony rooted in the premise that chorus 3\'s turned line and the outro pay off');
  else if (out.irony.length > 400) errors.push('irony: one sentence (at most 400 characters)');
  const list = raw.beats;
  if (!Array.isArray(list) || list.length !== SECTIONS.length) {
    errors.push(`beats: exactly ${SECTIONS.length} beats, one per section in order: ${SECTIONS.join(', ')}`);
    return { beats: errors.length ? null : out, errors, notes };
  }
  list.forEach((b, i) => {
    const section = SECTIONS[i];
    const where = `beats[${i}] (${section})`;
    if (!b || typeof b !== 'object') { errors.push(`${where}: an object`); return; }
    if (b.section !== undefined && b.section !== section) errors.push(`${where}: section must be "${section}" (the 11 sections in order)`);
    if (b.id !== undefined && b.id !== beatId(i)) errors.push(`${where}: id must be "${beatId(i)}" (or leave it out)`);
    if (!SETS.includes(b.set)) errors.push(`${where}: set must be one of ${SETS.join(', ')}`);
    const cast = Array.isArray(b.cast) ? b.cast : [];
    if (cast.length < 2 || cast.length > 8 || !cast.every((n) => NAMES.includes(n)) || new Set(cast).size !== cast.length)
      errors.push(`${where}: cast is 2-8 different canon names (who is on stage)`);
    const needs = section.startsWith('bridge') ? 'grown' : 'lead';
    if (roles && NAMES.includes(roles[needs]) && !cast.includes(roles[needs])) errors.push(`${where}: the cast must include the ${needs} (${roles[needs]}), who sings it`);
    if (typeof b.summary !== 'string' || words(b.summary).length < 4) errors.push(`${where}: summary is one present-tense sentence of what happens`);
    else if (words(b.summary).length > 40) errors.push(`${where}: summary is at most 40 words`);
    else for (const r of lyricProblems(b.summary)) errors.push(`${where}: summary breaks a lyric rule: ${r}`);
    out.beats.push({ id: beatId(i), title: typeof b.title === 'string' && b.title.trim() ? b.title.trim() : TITLES[section], section, set: b.set, cast, summary: b.summary });
  });
  return { beats: errors.length ? null : out, errors, notes };
}

// ---------------------------------------------------------------------------------------------
// Events

/** Resolve a beat reference (id, section name, or 1-based number) to its index, or -1. */
export function beatIndex(beats, ref) {
  if (typeof ref === 'number') return ref >= 1 && ref <= beats.beats.length ? ref - 1 : -1;
  const s = String(ref ?? '').trim();
  let i = beats.beats.findIndex((b) => b.id === s);
  if (i < 0) i = beats.beats.findIndex((b) => b.section === s);
  return i;
}

/**
 * Validate + complete one event against the plan (context-free checks: fields, names, rules,
 * actions). ctx: { beats, as }. Returns { event, beat, errors } (beat: its index).
 */
export function prepareEvent(raw, { beats, as = null } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { event: null, beat: -1, errors: ['an event is one JSON object'] };
  for (const k of Object.keys(raw)) if (!FIELDS.includes(k) && !IGNORED.includes(k)) errors.push(`unknown field "${k}" (fields: ${FIELDS.join(', ')})`);
  const agent = raw.agent ?? as;
  if (!ROLES.includes(agent)) errors.push(`agent must be one of ${ROLES.join(', ')}`);
  if (as && raw.agent && raw.agent !== as) errors.push(`you are the ${as} agent; this event says agent "${raw.agent}"`);
  const bot = raw.bot ?? AGENT_BOT[agent];
  if (ROLES.includes(agent) && bot !== AGENT_BOT[agent]) errors.push(`the ${agent} agent is embodied by ${AGENT_BOT[agent]}, not ${bot}`);
  const bi = beatIndex(beats, raw.beat);
  if (bi < 0) errors.push(`beat must be a beat id from beats.json (${beats.beats.map((b) => b.id).join(', ')})`);
  const beat = bi >= 0 ? beats.beats[bi] : null;
  const section = beat?.section;
  const roles = beats.roles ?? {};
  const str = (k) => (raw[k] === undefined || raw[k] === null ? '' : raw[k]);
  const arr = (k) => (raw[k] === undefined || raw[k] === null ? [] : raw[k]);
  for (const k of ['summary', 'lyric', 'action', 'singer']) if (raw[k] !== undefined && raw[k] !== null && typeof raw[k] !== 'string') errors.push(`${k} must be a string`);
  for (const k of ['chords', 'consult', 'with']) if (raw[k] !== undefined && raw[k] !== null && (!Array.isArray(raw[k]) || !raw[k].every((x) => typeof x === 'string'))) errors.push(`${k} must be an array of strings`);
  const bypass = bypassOf(raw.bypass, errors);
  if (errors.length) return { event: null, beat: bi, errors };

  const lyric = str('lyric').trim();
  const consult = arr('consult').map((n) => NAMES.find((x) => x.toLowerCase() === n.toLowerCase()) ?? n);
  const status = raw.status ?? (agent === 'lyrics' && lyric ? 'proposing' : 'working');
  if (!STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  errors.push(...summaryProblems(raw.summary, { voice: summaryVoice(beats), bot, status, consult: consult.filter((n) => NAMES.includes(n) && n !== bot) }));

  // consultations: bot + the bots it asks (on screen: approach, exchange, nod, resume)
  for (const n of consult) if (!NAMES.includes(n)) errors.push(`consult: "${n}" is not a bot`);
  if (consult.includes(bot)) errors.push(`consult names the bots ${bot} asks, not ${bot}`);
  if (new Set(consult).size !== consult.length || consult.length > 3) errors.push('consult: 1-3 different bots');
  if (status === 'consulting' && !consult.length) errors.push('status "consulting" needs consult: the bot(s) you ask, e.g. ["Green"]');

  // the sung line (lyrics only): singer + harmony from the beat's cast
  let singer = str('singer').trim() || null;
  const withList = arr('with');
  if (lyric && agent !== 'lyrics') errors.push(`only Green (lyrics) writes the sung lines; ${bot}'s lyric stays "" and the summary says what ${bot} does (that is what ${bot} sings in the making-of)`);
  if (agent === 'lyrics' && status === 'proposing' && !lyric) errors.push('a proposing lyrics event carries its line in "lyric"');
  if (lyric && beat) {
    singer ??= section.startsWith('bridge') ? roles.grown : roles.lead;
    errors.push(...lineProblems(lyric, { section, singer, roles }));
    if (/^[A-Za-z]+$/.test(singer ?? '') && namesIn(parseLyric(lyric, NAMES).text, [singer]).length)
      errors.push(`${singer} sings this line, so it says "we" (or "I"), never "${singer}" (or give the line to another singer; the colour word "${singer.toLowerCase()}" is fine)`);
  }
  if (singer !== null) {
    const c = NAMES.find((n) => n.toLowerCase() === singer.toLowerCase());
    if (!c) errors.push(`singer "${singer}" is not a bot`);
    else if (beat && !beat.cast.includes(c)) errors.push(`singer ${c} is not on stage in ${beat.id} (cast: ${beat.cast.join(', ')})`);
    singer = c ?? singer;
  }
  const withC = withList.map((n) => NAMES.find((x) => x.toLowerCase() === n.toLowerCase()) ?? n);
  if (withC.length && !lyric) errors.push('"with" (harmony) needs a sung line');
  for (const n of withC) {
    if (!NAMES.includes(n)) errors.push(`with: "${n}" is not a bot`);
    else if (beat && !beat.cast.includes(n)) errors.push(`with: ${n} is not on stage in ${beat.id} (cast: ${beat.cast.join(', ')})`);
    if (n === singer) errors.push('with lists the bots singing along, not the singer');
  }
  if (withC.length > 4) errors.push('with: at most 4 harmony singers');

  // the band's chords: White's (Green may copy them onto his lines)
  const chords = arr('chords').map((c) => c.trim());
  if (chords.length && !['chords', 'lyrics'].includes(agent)) errors.push('only White (chords) sets the band\'s chords; leave chords []');
  if (chords.length > 8 || !chords.every((c) => CHORD_RE.test(c))) errors.push('chords: up to 8 chord names like "C", "Am", "F", "G7"');

  // the action: an id of web/src/actions.js
  let action = str('action').trim();
  if (action) {
    const r = resolveAction(action);
    if (r.kind === 'none') errors.push(`action "${action}" is not in the vocabulary (web/src/actions.js); leave it "" or pick from your menu`);
    else if (r.kind === 'light') {
      if (agent !== 'lighting') errors.push('light cues (lights-*, spot-*) are Blue\'s (lighting)');
      if (r.id === 'lights' && !LIGHT_MOODS.includes(r.target)) errors.push(`lights-<mood>: mood is one of ${LIGHT_MOODS.join(', ')}`);
      if (r.id === 'spot' && r.target !== 'hero') {
        const c = NAMES.find((n) => n.toLowerCase() === String(r.target).toLowerCase());
        if (!c) errors.push(`spot-<Bot>: "${r.target}" is not a bot`); else action = `spot-${c}`;
      }
    } else if (r.kind === 'move' && r.id === 'walk-to') {
      const c = NAMES.find((n) => n.toLowerCase() === String(r.target).toLowerCase());
      if (c) action = `walk-to-${c}`;
      else if (!/^[a-z][a-z0-9_]*$/.test(r.target ?? '')) errors.push('walk-to-<Bot|mark>: a bot name (walk-to-Gold) or a set mark');
    }
    if (agent === 'lighting' && r.kind !== 'light' && !(r.kind === 'play' && rolePlays('lighting').includes(r.id))) {
      errors.push(`Blue (lighting) cues lights only (lights-<mood>, spot-<Bot>, spot-hero), or a hand play of her menu: ${rolePlays('lighting').join(', ')}`);
    }
  }

  const event = { agent, bot, status, beat: beat?.id ?? raw.beat, summary: typeof raw.summary === 'string' ? raw.summary.trim() : '', lyric, chords, action, consult };
  if (singer && (lyric || str('singer'))) event.singer = singer;
  if (withC.length) event.with = withC;
  return { event, beat: bi, errors, bypass };
}

/**
 * An event's "bypass" (the craft checks it asks to pass: { check: reason }), validated: a known
 * check, a reason of at least MIN_REASON_WORDS words. Pushes problems; returns the map ({} if none).
 */
function bypassOf(raw, errors) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`bypass is an object: {"<check>": "<why, in at least ${MIN_REASON_WORDS} words>"} (checks: ${CHECKS.join(', ')})`);
    return {};
  }
  const out = {};
  for (const [check, reason] of Object.entries(raw)) {
    if (!CHECKS.includes(check)) errors.push(`bypass: "${check}" is not a craft check (${CHECKS.join(', ')}); the hard rules never bend`);
    else if (typeof reason !== 'string' || words(reason).length < MIN_REASON_WORDS) errors.push(`bypass.${check}: say why in at least ${MIN_REASON_WORDS} words (what makes this line right as it is)`);
    else out[check] = reason.trim().slice(0, 200);
  }
  return out;
}

/** Lines (lyric events) of beat i, in order. */
const linesOf = (beats, events, i) => events.filter((e) => e.beat === beats.beats[i].id && e.lyric);

/**
 * The song-form rules for a new line at stanza position pos of beat i (the earlier beats are
 * complete): chorus 1 Hook X Hook Y; chorus 2 the same words; chorus 3 Hook X Hook Turn; the outro
 * the hook, then the intro's first line again. Returns problems.
 */
export function formProblems(beats, events, i, pos, lyric) {
  const section = beats.beats[i].section;
  const mine = linesOf(beats, events, i);
  const rhymeWith = (k, what) => {
    const other = mine[k]?.lyric;
    return other && !rhymes(other, lyric)
      ? [`${section} line ${pos + 1} rhymes with ${what}: "${lastWord(other)}" and "${lastWord(lyric)}" do not rhyme (end on a rhyming word: day / away, door / floor)`]
      : [];
  };
  if (pos === 3 && /^(verse|bridge)/.test(section)) return rhymeWith(1, 'line 2');
  const core = coreText(lyric);
  const at = (sec, k) => { const j = SECTIONS.indexOf(sec); const l = linesOf(beats, events, j)[k]; return l ? l.lyric : null; };
  const same = (want, what) => (want === null || coreText(want) === core ? [] : [`${section} line ${pos + 1} sings ${what}: "${parseLyric(want, NAMES).text}" (the same words; cues, pickups and replies may change)`]);
  const hook = beats.hook ?? at('chorus1', 0);
  if (section === 'chorus1') {
    if (pos === 0) return same(hook, 'the hook');
    if (pos === 2) return same(at('chorus1', 0), 'the hook again');
    if ((pos === 1 || pos === 3) && hook && coreText(hook) === core) return [`${section} line ${pos + 1} is the chorus's own line (X or Y), not the hook`];
    if (pos === 3) return rhymeWith(1, 'its line 2 (Y rhymes with X)');
  }
  if (section === 'chorus2') return same(at('chorus1', pos), "chorus 1's words");
  if (section === 'chorus3') {
    if (pos < 3) return same(at('chorus1', pos), "chorus 1's words");
    const y = at('chorus1', 3);
    if (y && coreText(y) === core) return ['chorus3 line 4 is the turned line: it changes chorus 1\'s last line to pay off the irony'];
    return rhymeWith(1, 'its line 2 (the turned line rhymes with X)');
  }
  if (section === 'outro') {
    if (pos === 0) return same(hook, 'the hook');
    if (pos === 1) return same(at('intro', 0), "the intro's first line (the callback)");
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// State, lock, turnstile

const scratch = (dir) => join(dir, '.director');
const statePath = (dir) => join(scratch(dir), 'state.json');
export function readState(dir) {
  try { return JSON.parse(readFileSync(statePath(dir), 'utf8')); } catch { return null; }
}
function writeState(dir, state) {
  mkdirSync(scratch(dir), { recursive: true });
  const tmp = `${statePath(dir)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, statePath(dir));
}
/**
 * A fresh scratch state (the orchestrator writes it before Muse starts: t0 is the making-of's zero).
 * craft: the run's craft mode (craft.js MODES; default strict: a failed check rejects unless bypassed).
 */
export function initState(dir, { prompt, slug, seed, t0 = Date.now(), craft = 'strict' } = {}) {
  if (!MODES.includes(craft)) throw new Error(`craft mode: one of ${MODES.join(', ')}`);
  const state = { t0, prompt, slug, seed, open: -1, openedAt: {}, stanzaAt: {}, pos: {}, seen: {}, done: {}, queue: [], rejected: 0, queued: 0, craft: freshCraft(craft) };
  writeState(dir, state);
  return state;
}
/**
 * The craft record of a run: its mode, the words accepted for the episode (a dictionary bypass, or
 * the premise's own word in the hook: word -> { agent, reason }), the bypasses each agent used, and
 * per check how often it rejected, was bypassed, or left a note.
 */
const freshCraft = (mode = 'strict') => ({ mode, accepted: {}, bypasses: {}, counts: {} });
function craftOf(state) {
  state.craft ??= freshCraft();
  for (const [k, v] of Object.entries(freshCraft(state.craft.mode))) state.craft[k] ??= v;
  return state.craft;
}
function count(craft, check, kind) {
  const c = (craft.counts[check] ??= { rejected: 0, bypassed: 0, noted: 0 });
  c[kind]++;
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
/** Run fn under the bundle's lock (a mkdir lock; a lock older than 15 s is stale). */
export function withLock(dir, fn) {
  const lock = join(scratch(dir), 'lock');
  mkdirSync(scratch(dir), { recursive: true });
  for (let tries = 0; ; tries++) {
    try { mkdirSync(lock); break; } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) { rmdirSync(lock); continue; } } catch { /* gone */ }
      if (tries > 2000) throw new Error('emit: the bundle lock is stuck');
      sleepSync(5 + (tries % 7));
    }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch { /* already gone */ } }
}

export function readBeats(dir) {
  try { return modernBundle(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'))); } catch { return null; }
}
export function readEvents(dir) {
  try {
    return modernBundle(readFileSync(join(dir, 'events.ndjson'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Close every beat that is done and land the events queued for the beat that opens. A beat is done
 * when its stanza is complete and every active agent has moved past it (an agent is active while
 * it called within IDLE_S and is not --done), or LINGER_S seconds after the stanza. The last beat
 * stays open until the end. Mutates state; returns the events due to land (settle() appends them).
 */
export function advance(state, beats, events, now = Date.now(), linger = LINGER_S, idle = IDLE_S) {
  const landed = [];
  state.queue ??= [];
  for (;;) {
    const k = state.open;
    // the open beat's queued events land first: its questions (an answer sent with or before them
    // lands after them), the lead-in (White's chords, Blue's lights: the lines take the chords in
    // force), then the rest in the order they were sent
    const due = state.queue.filter((q) => q.beat === k);
    if (due.length) {
      state.queue = state.queue.filter((q) => q.beat !== k);
      const lead = (q) => (q.e.status === 'consulting' && q.e.consult?.length ? 0 : ['chords', 'lighting'].includes(q.e.agent) ? 1 : 2);
      due.sort((a, b) => lead(a) - lead(b) || a.n - b.n);
      for (const q of due) landed.push(stamp(q.e, beats, [...events, ...landed]));
    }
    if (k < 0 || k >= beats.beats.length - 1) break;
    if (linesOf(beats, [...events, ...landed], k).length < STANZA[beats.beats[k].section]) break;
    state.stanzaAt[k] ??= now;
    if (lagging(state, k, now, idle).length && now - state.stanzaAt[k] < linger * 1000) break;
    state.open = k + 1;
    state.openedAt[k + 1] = now;
  }
  return landed;
}
export const IDLE_S = env('MB_EMIT_IDLE_S', 60); // an agent silent this long is not waited for
/** The agents a beat still waits for: active (called within idle s), not done, not yet past it. */
function lagging(state, k, now, idle = IDLE_S) {
  return Object.keys(state.pos).filter((a) => !state.done[a] && state.pos[a] <= k && now - (state.seen?.[a] ?? 0) < idle * 1000);
}
/** A line takes the band's chords in force on its beat (White's), else the section's. */
function stamp(e, beats, events) {
  if (!e.lyric || e.chords.length) return e;
  const b = beats.beats.find((x) => x.id === e.beat);
  const nora = events.filter((x) => x.beat === e.beat && x.chords?.length).at(-1);
  return { ...e, chords: nora ? nora.chords : sectionChords(b.section, beats.tags, beats.seed) };
}
/**
 * Append events to the stream (under the lock): seq, t (real seconds since t0), one write. An event
 * that answers a consultation gets `answers` (answerTo); a consultation is noted in state.questions.
 */
function land(dir, state, events, list, now) {
  if (!list.length) return [];
  const prevT = events.length ? events.at(-1).t : 0;
  const t = Math.max(prevT, Math.round((now - state.t0) / 100) / 10);
  state.questions ??= {};
  const final = [];
  for (const e of list) {
    const ev = { seq: events.length + final.length, t, ...e };
    const a = answerTo(state.questions, ev);
    if (a !== null) { ev.answers = a; state.questions[a].answered[ev.bot] = ev.seq; }
    if (ev.status === 'consulting' && ev.consult?.length) state.questions[ev.seq] = { bot: ev.bot, consult: ev.consult, answered: {} };
    final.push(ev);
  }
  appendFileSync(join(dir, 'events.ndjson'), final.map((e) => JSON.stringify(e)).join('\n') + '\n');
  events.push(...final);
  return final;
}
/**
 * The question an event answers: the earliest consultation (landed before it) that names its bot,
 * that it has not answered yet, and whose asker the event names back in its `consult` ("I play this
 * one for free, Gold", a handshake with Gold). The blackboard asks every consulted bot to answer so,
 * and the role prompts arrange some answers ahead (sent before the question, they count when they
 * land after it). Measured on two live runs (8 questions): all 7 real answers named the asker back,
 * while the plain "first event after the question" paired a question with an unrelated event twice
 * (the bot's next beat, written before its answer). Returns the question's seq, or null.
 */
function answerTo(questions, e) {
  const hit = Object.entries(questions).sort((x, y) => Number(x[0]) - Number(y[0]))
    .find(([, q]) => q.bot !== e.bot && q.consult.includes(e.bot) && q.answered[e.bot] === undefined && (e.consult ?? []).includes(q.bot));
  return hit ? Number(hit[0]) : null;
}
/** advance() + land() until nothing moves: close what is done, land what is due. */
function settle(dir, state, beats, events, now, linger) {
  const out = [];
  for (;;) {
    const landed = advance(state, beats, events, now, linger);
    if (!landed.length) return out;
    out.push(...land(dir, state, events, landed, now));
  }
}

/** Two sends of one event (a retry, a repair run) are one event. */
const sameKey = (e) => [e.agent, e.beat, e.summary, e.lyric, e.action, (e.consult ?? []).join(',')].join('|');

/** Who a beat waits on: the stanza count and the agents still on it. */
function waitingOn(state, beats, events, now = Date.now()) {
  const k = state.open;
  if (k < 0) return 'the director (no plan yet)';
  const b = beats.beats[k];
  const n = linesOf(beats, events, k).length;
  const parts = [];
  if (n < STANZA[b.section]) parts.push(`Green's lines ${n}/${STANZA[b.section]}`);
  const lag = lagging(state, k, now).filter((a) => a !== 'lyrics').map((a) => AGENT_BOT[a]);
  if (lag.length) parts.push(lag.join(', '));
  return parts.join('; ') || 'nobody';
}

const sungText = (e) => parseLyric(e.lyric, NAMES).text + (parseLyric(e.lyric, NAMES).reply ? ` >> ${parseLyric(e.lyric, NAMES).reply}` : '');

/** The blackboard for an agent: the plan's open beat, its lines, who is waited on, consults to it. */
export function blackboard(beats, events, state, agent = null, { plan = false, now = Date.now() } = {}) {
  const out = [];
  const r = beats.roles ?? {};
  out.push(`Episode "${beats.title}": lead ${r.lead}, pal ${r.pal} (the echo), grown-up ${r.grown}${r.rival ? `, rival ${r.rival}` : ''}; hook "${beats.hook}"; bridge ${beats.tags?.bridge}.`);
  if (plan) {
    out.push(`Irony: ${beats.irony}`);
    if (beats.facts?.length) out.push(`Facts (checked; the story stays true to them): ${beats.facts.map((f) => `- ${f}`).join(' ')}`);
    out.push('Plan:');
    beats.beats.forEach((b, i) => out.push(`  ${i + 1}. ${b.id} [${b.set}; ${b.cast.join(', ')}] ${STANZA[b.section]} lines: ${b.summary}`));
  }
  const k = state.open;
  if (k < 0) { out.push('No beat is open yet.'); return out.join('\n'); }
  const b = beats.beats[k];
  const lines = linesOf(beats, events, k);
  out.push(`OPEN BEAT: ${b.id} (${b.section}: ${ARC[b.section]}) set ${b.set}, cast ${b.cast.join(', ')}. Lines ${lines.length}/${STANZA[b.section]}. Plan: ${b.summary}`);
  const prev = k > 0 ? linesOf(beats, events, k - 1) : [];
  if (agent === 'lyrics' && prev.length) out.push(`  previous stanza (${beats.beats[k - 1].section}): ${prev.map((e) => `${e.singer ?? e.bot}: "${sungText(e)}"`).join(' | ')}`);
  for (const e of lines) out.push(`  line: ${e.singer ?? e.bot}: "${sungText(e)}"`);
  const others = events.filter((e) => e.beat === b.id && !e.lyric).slice(-6);
  for (const e of others) out.push(`  ${e.bot}${e.action ? ` [${e.action}]` : ''}${e.chords?.length ? ` chords ${e.chords.join(' ')}` : ''}: ${e.summary}`);
  if (agent && summaryVoice(beats) === 'talk') {
    // the crew's talk: the last things said, so a crewmate can answer, react or ask back
    const me = AGENT_BOT[agent];
    const recent = events.filter((e) => e.bot !== me && e.summary).slice(-5);
    if (recent.length) out.push(`  RECENT TALK (reply to one of these when it fits: answer it, react to it, ask back):\n${recent.map((e) => `    ${e.bot}${e.lyric ? ` (proposing "${sungText(e)}")` : ''}: "${e.summary}"`).join('\n')}`);
    const mineAll = [...events, ...(state.queue ?? []).map((q) => q.e)].filter((e) => e.agent === agent);
    const asked = mineAll.filter((e) => e.status === 'consulting').length;
    out.push(`  your talk so far: ${mineAll.length} said, ${asked} question${asked === 1 ? '' : 's'} asked (ask at least ${MIN_QUESTIONS} this episode), ${mineAll.filter(isFormula).length} formula lines (at most one in four).`);
    const done = ROLES.filter((r) => state.done?.[r] && r !== agent).map((r) => AGENT_BOT[r]);
    if (done.length) out.push(`  done (ask the others): ${done.join(', ')}.`);
  }
  out.push(`  waiting on: ${waitingOn(state, beats, events, now)}.`);
  const mine = (state.queue ?? []).filter((q) => q.e.agent === agent);
  if (mine.length) out.push(`  your queued events: ${[...new Set(mine.map((q) => beats.beats[q.beat].id))].join(', ')} (they land when those beats open).`);
  if (agent) {
    const me = AGENT_BOT[agent];
    const queued = (state.queue ?? []).map((q) => q.e);
    const answerOf = (c, bot) => (c.seq === undefined ? null : events.find((x) => x.answers === c.seq && x.bot === bot) ?? null);
    // questions to me: the open ones first, plainly (the tool tags my next event as the answer)
    const asks = [...events, ...queued].filter((e) => e.status === 'consulting' && e.consult.includes(me) && e.bot !== me);
    for (const c of asks.filter((x) => !answerOf(x, me)).slice(0, 2)) {
      out.push(`  QUESTION FOR YOU from ${c.bot} (${c.beat}${c.seq === undefined ? ', lands when its beat opens' : `, seq ${c.seq}`}): "${c.summary}"`
        + `\n    -> Answer it in your next event for ${c.beat} or a later beat: its summary ${summaryVoice(beats) === 'talk' ? `says your answer back to ${c.bot}, by name ("Let's land it on soup, ${c.bot}")` : `sings your answer to ${c.bot}, in the team's "we" ("We land the hook on 'soup'")`},`
        + ` and it names ${c.bot} back in "consult", sealed with a duo play when it fits (${['fist-bump', 'high-five', 'handshake', 'pinky-promise'].join(', ')}): that is how the tool links it as the answer.`);
    }
    for (const c of asks.filter((x) => answerOf(x, me)).slice(-2)) {
      const a = answerOf(c, me);
      out.push(`  ${c.bot} asked you (seq ${c.seq}): "${c.summary}"; you answered (seq ${a.seq}): "${a.summary}".`);
    }
    // my questions and their answers
    for (const c of [...events, ...queued].filter((e) => e.status === 'consulting' && e.bot === me && e.consult.length).slice(-2)) {
      const got = c.consult.map((n) => {
        const a = answerOf(c, n);
        if (a) return `${n} answers (seq ${a.seq}): "${a.summary}"`;
        const ahead = queued.find((x) => x.bot === n && (x.consult ?? []).includes(me)); // an answer sent ahead, waiting for its beat
        return ahead ? `${n} answers (in ${ahead.beat}, when it opens): "${ahead.summary}"` : `${n}: no answer yet`;
      });
      out.push(`  you asked ${c.consult.join(', ')} (${c.seq === undefined ? 'queued' : `seq ${c.seq}`}, ${c.beat}): "${c.summary}"; ${got.join('; ')}.`);
    }
    const craft = state.craft;
    if (craft && craft.mode === 'strict') {
      const used = craft.bypasses?.[agent] ?? 0;
      if (used) out.push(`  craft bypasses: ${used} of ${MAX_BYPASSES} used.`);
    }
  }
  if (k === beats.beats.length - 1) out.push('This is the last beat. When you have added your part, run --done.');
  return out.join('\n');
}

/**
 * Send events (one agent, one beat, 1-6 events) through the turnstile. The open beat appends them
 * at once; a later beat queues them (validated now; they land when it opens, the lead-in first);
 * a closed beat refuses them. Nothing blocks: Muse moves a long shell call to the background, and an
 * agent waiting on one can end its turn. Returns
 * { status: 'ok'|'queued'|'rejected'|'error', message, events }. opts: { as, linger (s), now () => ms }.
 */
export async function emitEvents(dir, raws, opts = {}) {
  const { as = null, linger = LINGER_S, now = () => Date.now() } = opts;
  const beats = readBeats(dir);
  if (!beats) return { status: 'error', message: 'No beats.json yet: the director writes the plan first (emit.js --beats).' };
  const list = Array.isArray(raws) ? raws : [raws];
  if (!list.length || list.length > MAX_BATCH) return { status: 'rejected', message: `REJECTED: send 1-${MAX_BATCH} events per call (a stanza is fine).` };
  const prepared = list.map((raw) => prepareEvent(raw, { beats, as }));
  const errs = prepared.flatMap((p, i) => p.errors.map((e) => (list.length > 1 ? `event ${i + 1}: ${e}` : e)));
  const agents = new Set(prepared.map((p) => p.event?.agent)), beatSet = new Set(prepared.map((p) => p.beat));
  if (agents.size > 1) errs.push('one agent per call');
  if (beatSet.size > 1) errs.push('one beat per call (the stream plays in beat order)');
  if (errs.length) return reject(dir, errs);
  const agent = prepared[0].event.agent, j = prepared[0].beat;
  return withLock(dir, () => {
    const t = now();
    const state = readState(dir) ?? initState(dir, { prompt: beats.prompt, seed: beats.seed });
    state.queue ??= [];
    state.seen = { ...(state.seen ?? {}), [agent]: t };
    const events = readEvents(dir);
    if (state.open < 0) { state.open = 0; state.openedAt[0] = t; }
    settle(dir, state, beats, events, t, linger);
    if (j < state.open) {
      state.rejected = (state.rejected ?? 0) + 1;
      writeState(dir, state);
      return { status: 'rejected', message: `REJECTED: ${beats.beats[j].id} is closed (the band moved on). The open beat is ${beats.beats[state.open].id}: add your part there or to a later beat.\n${blackboard(beats, events, state, agent, { now: t })}` };
    }
    // the stanza's capacity and the song-form rules, against the lines sent so far (landed + queued)
    const section = beats.beats[j].section;
    const sent = [...events, ...state.queue.map((q) => q.e)];
    const sentKeys = new Set(sent.map(sameKey));
    const fresh = prepared.filter((p) => !sentKeys.has(sameKey(p.event))); // a resend is a no-op
    if (!fresh.length) {
      writeState(dir, state);
      return { status: 'ok', events: [], message: `OK: already sent; nothing new.\n${blackboard(beats, events, state, agent, { now: t })}` };
    }
    let pos = linesOf(beats, sent, j).length;
    const problems = [];
    const staged = [];
    // the craft checks (craft.js): a failed one rejects unless the event bypasses it (strict), or
    // only leaves a note (warn); none at all when off
    const craft = craftOf(state);
    const allow = new Set(Object.keys(craft.accepted));
    let used = craft.bypasses[agent] ?? 0;
    const notes = [], hits = [], accepting = [];
    const chorus1 = SECTIONS.indexOf('chorus1');
    for (const [i, p] of fresh.entries()) {
      const e = p.event;
      const tag = fresh.length > 1 ? `event ${i + 1}: ` : '';
      if (e.lyric && !e.with?.length && ((/^chorus/.test(section) && (pos === 0 || pos === 2)) || (section === 'outro' && pos === 0))) {
        const cast = beats.beats[j].cast, r = beats.roles ?? {};
        const along = [r.pal, r.grown, r.rival, ...cast].filter((n, k, a) => n && cast.includes(n) && n !== e.singer && a.indexOf(n) === k).slice(0, 2);
        if (along.length) e.with = along;
      }
      let at = -1; // the line's stanza position
      if (e.lyric) {
        if (pos >= STANZA[section]) problems.push(`${tag}${beats.beats[j].id} already has its ${STANZA[section]} lines`);
        else { problems.push(...formProblems(beats, [...sent, ...staged], j, pos, e.lyric).map((q) => `${tag}${q}`)); at = pos; }
        pos++;
      }
      if (craft.mode !== 'off') {
        const stanza = linesOf(beats, [...sent, ...staged], j).map((x) => x.lyric);
        const frame = section === 'chorus3' && at === 3 ? linesOf(beats, sent, chorus1)[3]?.lyric ?? null : null;
        const findings = [...(at >= 0 ? lineCraft(e.lyric, { section, pos: at, stanza, hook: beats.hook, frame, allow }) : []), ...summaryCraft(e.summary, { allow })];
        const bypassed = [];
        for (const f of findings) {
          const why = p.bypass[f.check];
          if (f.severity === 'note' || craft.mode === 'warn') { notes.push(`${tag}${f.check}: ${f.message}`); hits.push([f.check, 'noted']); continue; }
          if (why && at >= 0 && isHookLine(section, at)) { problems.push(`${tag}[${f.check}] ${f.message}. The hook line is never bypassed: ${f.fix}.`); hits.push([f.check, 'rejected']); continue; }
          const again = bypassed.some((b) => b.check === f.check); // one bypass covers a check on the line and its summary
          if (why && !again && used >= MAX_BYPASSES) { problems.push(`${tag}[${f.check}] ${f.message}. You have used your ${MAX_BYPASSES} bypasses this episode: ${f.fix}.`); hits.push([f.check, 'rejected']); continue; }
          if (!why) { problems.push(`${tag}${craftText(f, MAX_BYPASSES - used)}`); hits.push([f.check, 'rejected']); continue; }
          if (!again) { used++; bypassed.push({ check: f.check, reason: why }); hits.push([f.check, 'bypassed']); }
          if (f.check === 'dictionary') {
            const rec = bypassed.find((b) => b.check === 'dictionary');
            for (const w of f.words ?? []) { allow.add(w); accepting.push([w, why]); if (!(rec.words ??= []).includes(w)) rec.words.push(w); }
          }
        }
        if (bypassed.length) e.bypassed = bypassed;
      }
      staged.push(e);
    }
    // the crew talks to each other: most of an agent's summaries say it to a crewmate, react or answer
    if (summaryVoice(beats) === 'talk') {
      // a question goes to a crewmate still at work (one who is done can no longer answer)
      for (const [i, e] of staged.entries()) {
        // (unless its answer was sent ahead: an event of that bot naming the asker, for this beat or later, not yet linked)
        const ahead = (n) => sent.some((x) => x.bot === n && x.status !== 'consulting' && x.answers === undefined && x.consult?.includes(e.bot) && beats.beats.findIndex((b) => b.id === x.beat) >= j);
        const gone = e.status === 'consulting' && e.consult.length && e.consult.every((n) => { const a = ROLES.find((r) => AGENT_BOT[r] === n); return a && state.done?.[a] && !ahead(n); });
        if (gone) problems.push(`${staged.length > 1 ? `event ${i + 1}: ` : ''}${e.consult.join(', ')} ${e.consult.length > 1 ? 'are' : 'is'} done and cannot answer any more: ask a crewmate still at work (${ROLES.filter((r) => !state.done?.[r] && r !== agent).map((r) => AGENT_BOT[r]).join(', ') || 'nobody'})`);
      }
      for (const { i, message } of talkProblems(sent.filter((e) => e.agent === agent), staged)) problems.push(`${staged.length > 1 ? `event ${i + 1}: ` : ''}${message}`);
    }
    if (problems.length) {
      state.rejected = (state.rejected ?? 0) + 1;
      for (const [c, kind] of hits) if (kind === 'rejected') count(craft, c, kind);
      writeState(dir, state);
      return { status: 'rejected', message: rejectText(problems) };
    }
    for (const [c, kind] of hits) count(craft, c, kind);
    craft.bypasses[agent] = used;
    for (const [w, reason] of accepting) craft.accepted[w] ??= { agent, reason };
    state.pos[agent] = Math.max(state.pos[agent] ?? -1, j); // the agent is done with every beat before j
    let final = [];
    if (j === state.open) {
      final = land(dir, state, events, staged.map((e) => stamp(e, beats, [...events, ...staged])), t);
    } else {
      state.n = (state.n ?? 0) + 1;
      for (const e of staged) state.queue.push({ beat: j, n: state.n, e });
      state.queued = (state.queued ?? 0) + staged.length;
    }
    const after = settle(dir, state, beats, events, t, linger);
    writeState(dir, state);
    const extra = craftNotes(staged, notes, craft.mode) + answerNote([...final, ...after].filter((e) => e.agent === agent), events);
    const board = blackboard(beats, events, state, agent, { now: t }) + playNote(staged) + extra;
    if (final.length) {
      const head = `OK: ${final.length} event${final.length > 1 ? 's' : ''} appended (seq ${final[0].seq}${final.length > 1 ? `-${final.at(-1).seq}` : ''}, t ${final[0].t}s).`;
      return { status: 'ok', events: final, message: `${head}\n${board}` };
    }
    const landedNow = after.filter((e) => e.agent === agent && e.beat === beats.beats[j].id);
    if (landedNow.length) return { status: 'ok', events: landedNow, message: `OK: ${landedNow.length} event(s) appended to ${beats.beats[j].id} (it just opened).\n${board}` };
    return { status: 'queued', events: staged, message: `QUEUED: ${staged.length} event${staged.length > 1 ? 's' : ''} for ${beats.beats[j].id}; ${staged.length > 1 ? 'they land' : 'it lands'} when that beat opens (the open beat is ${beats.beats[state.open].id}). Go on with your next beat.\n${board}` };
  });
}
/** A failed craft check, for the agent: what is wrong, how to fix it, and how to bypass it (and when). */
function craftText(f, left) {
  const how = f.bypass && left > 0
    ? ` Bypass it only if ${f.bypass}: add "bypass": {"${f.check}": "<why, in at least ${MIN_REASON_WORDS} words>"} to this event and send it again (${left} of ${MAX_BYPASSES} bypasses left for you this episode).`
    : f.bypass ? ` (You have used your ${MAX_BYPASSES} bypasses this episode.)` : '';
  return `[${f.check}] ${f.message}. Fix: ${f.fix}.${how}`;
}
/** The craft notes and bypasses of an accepted call, for the agent. */
function craftNotes(staged, notes, mode) {
  const by = staged.flatMap((e) => (e.bypassed ?? []).map((b) => `${b.check} ("${b.reason}")`));
  return (by.length ? `\nBYPASSED (recorded on the event): ${by.join('; ')}.` : '')
    + (notes.length ? `\nCRAFT NOTE${notes.length > 1 ? 'S' : ''}${mode === 'warn' ? ' (warn mode: nothing refused)' : ''}:\n${notes.map((n) => `  - ${n}`).join('\n')}` : '');
}
/** Which of the caller's events just answered a question. */
function answerNote(mine, events) {
  const a = mine.filter((e) => e.answers !== undefined);
  return a.map((e) => `\nANSWER: seq ${e.seq} answers ${events.find((x) => x.seq === e.answers)?.bot ?? '?'}'s question (seq ${e.answers}).`).join('');
}
/** A hand play the stage only stands in for with a gesture: say which plays are choreographed. */
function playNote(list) {
  const fake = [...new Set(list.map((e) => resolveAction(e.action)).filter((r) => r.kind === 'play' && !REAL_PLAYS.has(r.id)).map((r) => r.id))];
  return fake.length ? `\nNOTE: ${fake.join(', ')} ${fake.length > 1 ? 'have' : 'has'} no choreography yet (a gesture stands in). The choreographed hand plays: ${PLAY_PRIORITY.join(', ')}.` : '';
}
function rejectText(errs) {
  return `REJECTED (nothing was appended):\n${errs.map((e) => `  - ${e}`).join('\n')}\nFix it and send it again.`;
}
function reject(dir, errs) {
  try { withLock(dir, () => { const s = readState(dir); if (s) { s.rejected = (s.rejected ?? 0) + 1; writeState(dir, s); } }); } catch { /* best effort */ }
  return { status: 'rejected', message: rejectText(errs) };
}

/** Write the plan (beats.json) and open beat 1. Refused once events exist. */
export function writeBeats(dir, raw, { now = () => Date.now() } = {}) {
  return withLock(dir, () => {
    const state = readState(dir) ?? initState(dir, {});
    if (readEvents(dir).length) return { status: 'rejected', message: 'REJECTED: the crew is already working on this plan (events exist).' };
    const prompt = state.prompt ?? (typeof raw?.prompt === 'string' ? raw.prompt : '');
    const seed = state.seed ?? `muse-${state.slug ?? slugify(prompt)}`;
    const craft = craftOf(state);
    const { beats, errors, notes } = validateBeats(raw, { prompt: state.prompt, seed, director: state.director, summaries: TALK_VOICE, craft: craft.mode });
    if (errors.length) {
      for (const e of errors) { const m = /^hook \(([a-z]+)\)/.exec(e); if (m) count(craft, m[1], 'rejected'); }
      writeState(dir, state);
      return { status: 'rejected', message: rejectText(errors.map((e) => `beats.json: ${e}`)) };
    }
    writeFileSync(join(dir, 'beats.json'), JSON.stringify(beats, null, 2) + '\n');
    if (!existsSync(join(dir, 'events.ndjson'))) writeFileSync(join(dir, 'events.ndjson'), '');
    for (const w of notes.accepted ?? []) craft.accepted[w] ??= { agent: 'director', reason: "the premise's own word, sung in the hook" };
    state.open = 0;
    state.openedAt = { 0: now() };
    writeState(dir, state);
    const said = notes.length ? `\nCRAFT NOTE${notes.length > 1 ? 'S' : ''}:\n${notes.map((n) => `  - ${n}`).join('\n')}` : '';
    return { status: 'ok', message: `OK: beats.json written; ${beats.beats[0].id} is open.${said}\n${blackboard(beats, [], state, null, { plan: true, now: now() })}` };
  });
}

/** Register an agent (it is waited on from now) and return its blackboard; lands what is due. */
export function status(dir, agent = null, { now = () => Date.now() } = {}) {
  return withLock(dir, () => {
    const beats = readBeats(dir);
    if (!beats) return { status: 'error', message: 'No beats.json yet: the director is still planning. Run --status again in a few seconds.' };
    const t = now();
    const state = readState(dir) ?? initState(dir, {});
    const events = readEvents(dir);
    if (state.open < 0) state.open = 0;
    if (agent && ROLES.includes(agent) && !state.done[agent]) {
      state.pos[agent] = Math.max(state.pos[agent] ?? -1, state.open);
      state.seen = { ...(state.seen ?? {}), [agent]: t };
    }
    settle(dir, state, beats, events, t, LINGER_S);
    writeState(dir, state);
    return { status: 'ok', message: blackboard(beats, events, state, agent, { plan: true, now: t }) };
  });
}

export function markDone(dir, agent, { now = () => Date.now() } = {}) {
  if (!ROLES.includes(agent)) return { status: 'rejected', message: `--done needs your agent: ${ROLES.join(', ')}` };
  return withLock(dir, () => {
    const beats = readBeats(dir);
    const state = readState(dir) ?? initState(dir, {});
    // the crew talks: before a role finishes, it has asked its questions and answered the ones put to it (once: a
    // second --done is accepted, so nobody is stuck)
    if (beats && summaryVoice(beats) === 'talk' && !state.done[agent] && !(state.nudged ?? {})[agent]) {
      const events = [...readEvents(dir), ...(state.queue ?? []).map((q) => q.e)];
      const me = AGENT_BOT[agent];
      const asked = events.filter((e) => e.agent === agent && e.status === 'consulting' && e.consult?.length).length;
      const open = events.filter((e) => e.status === 'consulting' && e.consult?.includes(me) && e.bot !== me && !events.some((x) => x.bot === me && (x.answers === e.seq || (x.seq === undefined || x.seq > e.seq) && x.consult?.includes(e.bot) && x.status !== 'consulting')));
      const want = [];
      if (asked < MIN_QUESTIONS) want.push(`you asked ${asked} question${asked === 1 ? '' : 's'}: ask ${MIN_QUESTIONS - asked} more (an event with "status": "consulting", "consult": ["<Crewmate>"], its summary the question, e.g. "Is this too dark for the bridge, White?")`);
      for (const q of open.slice(0, 2)) want.push(`${q.bot} asked you "${q.summary}": answer it (its summary your answer, "consult": ["${q.bot}"])`);
      if (want.length) {
        state.nudged = { ...(state.nudged ?? {}), [agent]: true };
        writeState(dir, state);
        const k = Math.max(state.open, 0);
        return { status: 'rejected', message: `NOT YET: the crew talks as it works. ${want.join('; ')}. Send them for the open beat (${beats.beats[k].id}) or a later one, then --done.` };
      }
    }
    state.done[agent] = true;
    if (beats) settle(dir, state, beats, readEvents(dir), now(), LINGER_S);
    writeState(dir, state);
    const left = (state.queue ?? []).filter((q) => q.e.agent === agent).length;
    return { status: 'ok', message: `OK: ${AGENT_BOT[agent]} (${agent}) is done${left ? `; ${left} queued event(s) still land when their beats open` : ''}. Thank you!` };
  });
}

/** The orchestrator's end of the stream: everyone is done, and what is due lands now. */
export function finalize(dir, { now = () => Date.now() } = {}) {
  return withLock(dir, () => {
    const beats = readBeats(dir);
    const state = readState(dir);
    if (!beats || !state) return { landed: 0, dropped: 0 };
    for (const a of ROLES) state.done[a] = true;
    const landed = settle(dir, state, beats, readEvents(dir), now(), 0);
    const dropped = (state.queue ?? []).length;
    writeState(dir, state);
    return { landed: landed.length, dropped };
  });
}

/** Every sung line so far (or every event of one beat), compact. */
export function readout(dir, ref = null) {
  const beats = readBeats(dir);
  if (!beats) return { status: 'error', message: 'No beats.json yet.' };
  const events = readEvents(dir);
  if (ref) {
    const i = beatIndex(beats, ref);
    if (i < 0) return { status: 'rejected', message: `unknown beat ${ref}` };
    return { status: 'ok', message: events.filter((e) => e.beat === beats.beats[i].id).map((e) => `${e.seq} ${e.bot}${e.singer ? `/${e.singer}` : ''} ${e.status}${e.action ? ` [${e.action}]` : ''}: ${e.lyric ? `"${sungText(e)}"` : e.summary}`).join('\n') || '(nothing yet)' };
  }
  return { status: 'ok', message: beats.beats.map((b, i) => `${b.id}: ${linesOf(beats, events, i).map((e) => `${e.singer ?? e.bot}: "${sungText(e)}"`).join(' | ') || '(no lines yet)'}`).join('\n') };
}

/**
 * The gate for a finished bundle: validate-bundle.js, every stanza complete and in form, >=2
 * consultations, all seven roles on the record. Returns { ok, problems, stats }.
 */
export function checkBundle(dir) {
  const problems = [];
  const raw = readBeats(dir);
  if (!raw) return { ok: false, problems: ['no beats.json'], stats: null };
  const { errors } = validateBeats(raw, {});
  problems.push(...errors.map((e) => `beats.json: ${e}`));
  let events = [];
  try { events = readEvents(dir); } catch (err) { problems.push(`events.ndjson: ${err.message}`); }
  const v = spawnSync(process.execPath, [join(REPO, 'scripts/validate-bundle.js'), dir], { encoding: 'utf8' });
  if (v.status !== 0) problems.push(...(v.stderr || v.stdout).trim().split('\n').map((l) => `validate-bundle: ${l.trim()}`));
  if (!errors.length && Array.isArray(raw.beats)) {
    raw.beats.forEach((b, i) => {
      const lines = linesOf(raw, events, i);
      if (lines.length !== STANZA[b.section]) problems.push(`${b.id}: ${lines.length}/${STANZA[b.section]} lines`);
      lines.forEach((e, pos) => {
        for (const q of formProblems(raw, events.filter((x) => x.seq < e.seq), i, pos, e.lyric)) problems.push(`${b.id}: ${q}`);
      });
    });
    for (const e of events) {
      const { errors: ee } = prepareEvent({ ...e, seq: undefined, t: undefined }, { beats: raw });
      for (const q of ee) problems.push(`event ${e.seq}: ${q}`);
    }
    problems.push(...craftRecordProblems(raw, events), ...answerProblems(events));
  }
  const consults = events.filter((e) => e.status === 'consulting' && e.consult?.length).length;
  if (consults < 2) problems.push(`${consults} consultation(s); an episode needs at least 2 (status "consulting" with consult names)`);
  if (raw && summaryVoice(raw) === 'talk') {
    // the crew's talk is a back-and-forth: questions answered, and no formula
    const answered = new Set(events.filter((e) => e.answers !== undefined).map((e) => e.answers)).size;
    if (answered < MIN_EXCHANGES) problems.push(`${answered} answered question(s); the crew's talk needs at least ${MIN_EXCHANGES} (a consulting question, and the event of the bot asked that names the asker back in "consult")`);
    const talkers = events.filter((e) => e.summary);
    const formula = talkers.filter(isFormula).length;
    if (talkers.length && formula > Math.ceil(talkers.length * MAX_FORMULA_SHARE)) problems.push(`${formula} of ${talkers.length} summaries are "<Name>, we ...": at most one in four`);
  }
  const perRole = Object.fromEntries(ROLES.map((r) => [r, events.filter((e) => e.agent === r).length]));
  for (const [r, n] of Object.entries(perRole)) if (!n) problems.push(`${AGENT_BOT[r]} (${r}) has no events`);
  const stats = {
    events: events.length, lines: events.filter((e) => e.lyric).length, consultations: consults,
    questions: events.filter(isQuestion).length, dialogue: events.filter(dialogue).length, formula: events.filter(isFormula).length,
    answers: events.filter((e) => e.answers !== undefined).length, perRole, duration: events.at(-1)?.t ?? 0,
    bypasses: events.flatMap((e) => (Array.isArray(e.bypassed) ? e.bypassed : []).map((b) => ({ seq: e.seq, agent: e.agent, check: b.check, reason: b.reason, ...(b.words ? { words: b.words } : {}) }))),
  };
  return { ok: problems.length === 0, problems, stats };
}

/**
 * The craft record of a bundle, checked: every `bypassed` entry names a craft check with a reason
 * of at least MIN_REASON_WORDS words, at most MAX_BYPASSES per agent, never on a hook line.
 */
export function craftRecordProblems(beats, events) {
  const p = [];
  const per = {};
  const posOf = new Map();
  for (const b of beats.beats ?? []) events.filter((e) => e.beat === b.id && e.lyric).forEach((e, k) => posOf.set(e.seq, [b.section, k]));
  for (const e of events) {
    if (e.bypassed === undefined) continue;
    const ok = Array.isArray(e.bypassed) && e.bypassed.length > 0 && e.bypassed.every((b) => b && CHECKS.includes(b.check)
      && typeof b.reason === 'string' && words(b.reason).length >= MIN_REASON_WORDS);
    if (!ok) { p.push(`event ${e.seq}: bypassed is a list of { check (${CHECKS.join(', ')}), reason (at least ${MIN_REASON_WORDS} words) }`); continue; }
    per[e.agent] = (per[e.agent] ?? 0) + e.bypassed.length;
    const at = posOf.get(e.seq);
    if (at && isHookLine(...at)) p.push(`event ${e.seq}: a hook line is never bypassed`);
  }
  for (const [a, n] of Object.entries(per)) if (n > MAX_BYPASSES) p.push(`${AGENT_BOT[a] ?? a} (${a}) bypassed ${n} craft checks: at most ${MAX_BYPASSES} per agent per episode`);
  return p;
}
/** `answers`: an earlier consultation that names the event's bot (not its own), answered once per bot. */
export function answerProblems(events) {
  const p = [];
  const seen = new Set();
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  for (const e of events) {
    if (e.answers === undefined) continue;
    const q = bySeq.get(e.answers);
    if (!Number.isInteger(e.answers) || !q || q.seq >= e.seq || q.status !== 'consulting' || !(q.consult ?? []).includes(e.bot) || q.bot === e.bot) {
      p.push(`event ${e.seq}: answers ${e.answers}, which is no earlier consultation naming ${e.bot}`);
    } else if (seen.has(`${q.seq}:${e.bot}`)) p.push(`event ${e.seq}: ${e.bot} already answered consultation ${q.seq}`);
    seen.add(`${e.answers}:${e.bot}`);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// CLI

/**
 * The gate's own log of every call (.director/attempts.ndjson; activity.js reads it into the bundle's activity
 * log): { t (s since t0), op: emit | beats | status | read | done | check, agent, status (ok | queued | rejected |
 * error), beat?, sent? (the summaries sent), problem? (the first, trimmed), title?, n? (a plan's) }. Best effort:
 * a failed write never fails the call. Nothing of the environment is logged.
 */
export function logAttempt(dir, rec) {
  try {
    if (!existsSync(scratch(dir))) return;
    const s = readState(dir);
    const t = s?.t0 ? Math.round((Date.now() - s.t0) / 100) / 10 : null;
    appendFileSync(join(scratch(dir), 'attempts.ndjson'), JSON.stringify({ t, ...rec }) + '\n');
  } catch { /* best effort */ }
}
const problemOf = (r) => (r.status === 'rejected' || r.status === 'error' ? (/^\s*-\s+(.*)$/m.exec(r.message ?? '')?.[1] ?? String(r.message ?? '').split('\n')[0]).slice(0, 200) : undefined);

function parseInput(text) {
  const s = text.trim();
  if (!s) return { error: 'no JSON given: pass the event as one argument, or on stdin (a heredoc is safest: emit.js <<\'EOF\' ... EOF)' };
  try { return { value: JSON.parse(s) }; } catch { /* NDJSON? */ }
  const lines = s.split('\n').filter((l) => l.trim());
  try { return { value: lines.map((l) => JSON.parse(l)) }; } catch (err) {
    return { error: `not valid JSON (${err.message}). Send one JSON object, a JSON array, or one object per line; use a quoted heredoc (<<'EOF') so quotes and apostrophes need no escaping.` };
  }
}
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main(argv) {
  const args = [...argv];
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1); return v !== undefined && !v.startsWith('--') ? v : true; };
  const dirArg = flag('--dir');
  const dir = resolve(typeof dirArg === 'string' ? dirArg : process.env.MB_DIRECTOR_DIR ?? '');
  if (!dirArg && !process.env.MB_DIRECTOR_DIR) { console.log('emit: no bundle dir (--dir or MB_DIRECTOR_DIR)'); return 1; }
  const as = flag('--as');
  const asAgent = typeof as === 'string' ? as : null;
  const out = (r, rec = null) => {
    if (rec) logAttempt(dir, { ...rec, status: r.status, ...(problemOf(r) ? { problem: problemOf(r) } : {}) });
    console.log(r.message);
    return r.status === 'ok' || r.status === 'queued' ? 0 : r.status === 'rejected' ? 2 : 1;
  };
  if (args.includes('--check')) {
    const r = checkBundle(dir);
    logAttempt(dir, { op: 'check', agent: asAgent, status: r.ok ? 'ok' : 'rejected' });
    console.log(r.ok ? `GATE OK: ${r.stats.events} events, ${r.stats.lines} lines, ${r.stats.consultations} consultations` : `GATE FAILED:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`);
    return r.ok ? 0 : 1;
  }
  const done = flag('--done');
  if (done) { const agent = typeof done === 'string' ? done : asAgent; return out(markDone(dir, agent), { op: 'done', agent }); }
  if (args.includes('--status')) return out(status(dir, asAgent), { op: 'status', agent: asAgent });
  const rd = flag('--read');
  if (rd) return out(readout(dir, typeof rd === 'string' ? rd : null), { op: 'read', agent: asAgent });
  const isBeats = args.includes('--beats');
  const rest = args.filter((a) => a !== '--beats');
  const input = parseInput(rest.length ? rest.join(' ') : readStdin());
  if (input.error) return out({ status: 'rejected', message: `REJECTED: ${input.error}` }, { op: isBeats ? 'beats' : 'emit', agent: asAgent });
  if (isBeats) {
    const v = input.value ?? {};
    return out(writeBeats(dir, v), { op: 'beats', agent: null, title: typeof v.title === 'string' ? v.title.slice(0, 60) : undefined, n: Array.isArray(v.beats) ? v.beats.length : undefined });
  }
  const list = (Array.isArray(input.value) ? input.value : [input.value]).filter((e) => e && typeof e === 'object');
  const agent = typeof list[0]?.agent === 'string' ? list[0].agent : asAgent;
  return out(await emitEvents(dir, input.value, { as: asAgent }), {
    op: 'emit', agent, beat: typeof list[0]?.beat === 'string' ? list[0].beat : undefined, sent: list.map((e) => String(e.summary ?? '').slice(0, 120)),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.log(`emit: ${err.stack || err.message}`); process.exit(1); });
}
