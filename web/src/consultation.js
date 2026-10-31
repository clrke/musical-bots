// The consultation protocol (Oct 31, owner: "make making-of lyrics more comprehensive and structured ... an initial
// permission to ask, permission approval, context, question, question acknowledgement, reasoning, answer, follow up
// question, follow up answer, agreement, appreciation"): a consultation is a conversation between two crew bots, one
// event per sung line, each event a typed `move` of one `thread`:
//
//   the asker:   ask ("Hey White, got a minute?")          the asker opens it, by name
//   the host:    ok ("Sure, shoot!")                       any time after the ask, before the ack
//   the asker:   context x1-3                              what the asker knows: the brief, the plan, a fact, the work
//   the asker:   question x1-3                             what it needs decided
//   the host:    ack                                       the host takes the question
//   the host:    reasoning x1-3                            thinks aloud: the options, the trade-offs
//   the host:    answer x1-3                               the decision (it changes the work)
//   the asker:   followup x0-3                             when the answer raises an issue
//   the host:    followup-answer x1-3                      (after a followup)
//   the asker:   agree, thanks                             it closes; a hand play seals it in the making-of
//
// Shared by the emit tool (scripts/director/emit.js: validates each move as it is sent), validate-bundle.js and the
// making-of's score (making-of-score.js: each part of a consultation is a part of the song). Pure.

/** The moves, in the order a consultation sings them. */
export const MOVES = ['ask', 'ok', 'context', 'question', 'ack', 'reasoning', 'answer', 'followup', 'followup-answer', 'agree', 'thanks'];
/** The asker's moves; the others are the host's (the bot consulted). */
export const ASKER_MOVES = new Set(['ask', 'context', 'question', 'followup', 'agree', 'thanks']);
export const HOST_MOVES = new Set(['ok', 'ack', 'reasoning', 'answer', 'followup-answer']);
/** At most this many of a move in one consultation (the rest: once). */
export const MOVE_MAX = { context: 3, question: 3, reasoning: 3, answer: 3, followup: 3, 'followup-answer': 3 };
/** A move sings at most this many syllables (a line of talk, said naturally: two bars of the making-of hold eight, four bars more). */
export const MAX_MOVE_SYLLABLES = 10;
/** An episode needs at least this many complete consultations (ask to thanks); each role opens at least MIN_ASKED. */
export const MIN_CONSULTATIONS = 8;
export const MIN_ASKED = 2;
/** beats.json `consultations`: the bundle's consultations are move threads (every director run since Oct 31). */
export const CONSULT_MOVES = 'moves';

/** What a move is, said plainly (the emit tool's messages, the making-of's captions). */
export const MOVE_SAYS = {
  ask: 'asks for a minute', ok: 'says go ahead', context: 'gives the context', question: 'asks', ack: 'takes the question',
  reasoning: 'thinks it through', answer: 'answers', followup: 'follows up', 'followup-answer': 'answers the follow-up',
  agree: 'agrees', thanks: 'says thanks',
};

/**
 * The parts of a consultation as the making-of sings them (making-of-score.js), each a part of the song with a
 * progression from a function set of song/form.js and the tune of a section kind: the permission a pickup couplet,
 * the context a verse, the question and its acknowledgement a pre-chorus (a build to V: it ends open), the reasoning
 * the host's own verse (a bridge), the answer the chorus (V7 -> I: it lands home), the follow-up a bridge, the
 * agreement and the thanks the outro tag (home; the hand play seals it).
 */
export const PARTS = [
  { part: 'pickup', moves: ['ask', 'ok'], set: 'intro:scene', section: 'intro', kind: 'intro' },
  { part: 'context', moves: ['context'], set: 'verse:narrative', section: 'verse1', kind: 'verse' },
  { part: 'question', moves: ['question', 'ack'], set: 'verse:build', section: 'verse1b', kind: 'build' },
  { part: 'reasoning', moves: ['reasoning'], set: 'bridge:{bridge}', section: 'bridge', kind: 'bridge' },
  { part: 'answer', moves: ['answer'], set: 'chorus:bright', section: 'chorus1', kind: 'chorus', cadence: true },
  { part: 'followup', moves: ['followup', 'followup-answer'], set: 'bridge2:{bridge}', section: 'bridge2', kind: 'bridge' },
  { part: 'outro', moves: ['agree', 'thanks'], set: 'outro:{outro}', section: 'outro', kind: 'outro', cadence: true },
];
export const PART_OF = Object.fromEntries(PARTS.flatMap((p) => p.moves.map((m) => [m, p])));
/** The function set a part draws its progression from (the episode's tags: tender / suspense bridges, a soft outro). */
export const partSet = (p, tags = {}) => p.set.replace('{bridge}', tags.bridge === 'suspense' ? 'suspense' : 'tender').replace('{outro}', tags.outro === 'soft' ? 'soft' : 'conclusive');

const countOf = (moves) => {
  const c = Object.fromEntries(MOVES.map((m) => [m, 0]));
  for (const m of moves) if (m in c) c[m]++;
  return c;
};

/**
 * The moves that may come next in a consultation whose moves so far are `moves` (names, in the order sent): the
 * opening (ask, context 1-3, question 1-3; the host's ok once after the ask), then the host's ack, reasoning 1-3,
 * answer 1-3, then the asker's follow-up (1-3, the host's follow-up answers 1-3) or its agree, then its thanks.
 */
export function nextMoves(moves) {
  const c = countOf(moves);
  const last = moves.at(-1);
  if (!moves.length) return ['ask'];
  if (c.ask !== 1 || moves[0] !== 'ask') return [];
  if (c.thanks) return [];
  if (c.agree) return ['thanks'];
  if (c['followup-answer']) return [...(c['followup-answer'] < MOVE_MAX['followup-answer'] && last === 'followup-answer' ? ['followup-answer'] : []), 'agree'];
  if (c.followup) return [...(c.followup < MOVE_MAX.followup && last === 'followup' ? ['followup'] : []), 'followup-answer'];
  if (c.answer) return [...(c.answer < MOVE_MAX.answer && last === 'answer' ? ['answer'] : []), 'followup', 'agree'];
  if (c.reasoning) return [...(c.reasoning < MOVE_MAX.reasoning ? ['reasoning'] : []), 'answer'];
  if (c.ack) return ['reasoning'];
  const out = [];
  if (!c.question && c.context < MOVE_MAX.context) out.push('context');
  if (c.context && c.question < MOVE_MAX.question) out.push('question');
  if (!c.ok) out.push('ok');
  if (c.ok && c.question) out.push('ack');
  return out;
}

/** Whether a consultation is complete (its asker said thanks). */
export const isComplete = (moves) => moves.includes('thanks') && nextMoves(moves).length === 0;

/** Who says a move: 'asker' or 'host'. */
export const sideOf = (move) => (ASKER_MOVES.has(move) ? 'asker' : HOST_MOVES.has(move) ? 'host' : null);

/**
 * The moves of consultation `th` that are `bot`'s turn: the next moves its side says, but not one more of its own
 * last move while the other side has a move to make (after the asker's question the host's ok is due: "another
 * question" is no turn; after the host's answer the asker's agree is due). [] when it waits on the other.
 */
export function turnOf(th, bot) {
  const next = nextMoves(th.moves);
  const said = (m) => (sideOf(m) === 'asker' ? th.asker : th.host);
  const mine = next.filter((m) => said(m) === bot);
  const theirs = next.filter((m) => said(m) !== bot);
  if (bot === th.host && !th.moves.includes('question')) return []; // (the host replies once the question is there)
  return theirs.length ? mine.filter((m) => m !== th.moves.at(-1)) : mine;
}

/**
 * The consultations of a stream (events with a `move` and a `thread`, in stream order): Map thread ->
 * { id, asker, host, events (in order), moves, complete, beat (its ask's) }.
 */
export function threadsOf(events) {
  const out = new Map();
  for (const e of events ?? []) {
    if (!e?.move || e.thread === undefined || e.thread === null) continue;
    const id = String(e.thread);
    let th = out.get(id);
    if (!th) {
      th = { id, asker: e.move === 'ask' ? e.bot : null, host: e.move === 'ask' ? e.consult?.[0] ?? null : null, events: [], moves: [], complete: false, beat: e.beat };
      out.set(id, th);
    }
    th.events.push(e);
    th.moves.push(e.move);
  }
  for (const th of out.values()) th.complete = isComplete(th.moves);
  return out;
}

/** What the next move of a consultation may be, said for an agent: "context or question (Green)", "ok (White)". */
export function nextText(th) {
  const next = nextMoves(th.moves);
  if (!next.length) return 'nothing: it is complete';
  return next.map((m) => `${m} (${sideOf(m) === 'asker' ? th.asker : th.host})`).join(' or ');
}

/**
 * Problems of a stream's consultations (validate-bundle.js, the gate): every move a known one, each thread opened by
 * an ask naming one bot, its moves in order (nextMoves), each said by its side (the asker's by the asker, the host's
 * by the host) and naming the other in `consult`.
 */
export function threadProblems(events) {
  const p = [];
  for (const e of events ?? []) {
    if (e?.move === undefined) continue;
    if (!MOVES.includes(e.move)) p.push(`event ${e.seq}: move "${e.move}" is none of ${MOVES.join(', ')}`);
    if (typeof e.thread !== 'string' || !e.thread) p.push(`event ${e.seq}: a move needs its thread (the consultation's id)`);
  }
  for (const th of threadsOf(events).values()) {
    const seen = [];
    for (const e of th.events) {
      if (!MOVES.includes(e.move)) continue;
      const ok = nextMoves(seen);
      if (!ok.includes(e.move)) { p.push(`event ${e.seq}: ${th.id} "${e.move}" out of order (after ${seen.at(-1) ?? 'nothing'}, the next is ${ok.join(' or ') || 'nothing: it is complete'})`); break; }
      const who = sideOf(e.move) === 'asker' ? th.asker : th.host;
      if (!th.asker || !th.host) { p.push(`event ${e.seq}: ${th.id} has no ask naming the bot it asks`); break; }
      if (e.bot !== who) p.push(`event ${e.seq}: ${th.id} "${e.move}" is said by ${who}, not ${e.bot}`);
      const other = e.bot === th.asker ? th.host : th.asker;
      if (!(e.consult ?? []).includes(other)) p.push(`event ${e.seq}: ${th.id} "${e.move}" names ${other} in consult`);
      seen.push(e.move);
    }
  }
  return p;
}

/**
 * A consultation's moves in the order the making-of sings them (the canonical order: MOVES, stable within a move),
 * whatever order they were sent in (the asker's context is often sent with its ask, before the host's ok).
 */
export function canonicalOrder(events) {
  const rank = (m) => MOVES.indexOf(m);
  return [...events].sort((a, b) => rank(a.move) - rank(b.move) || a.seq - b.seq);
}

/**
 * The blocks a consultation is sung in, as its moves arrive (the making-of is the loading bar: each is sung as soon
 * as it is written): the asker's opening (ask, context, question), the host's reply (ok, ack, reasoning, answer), the
 * follow-up (followup, followup-answer), the closing (agree, thanks). Returns the block (0-3) of a move.
 */
export const BLOCKS = 4;
export const blockOf = (move) => (['ask', 'context', 'question'].includes(move) ? 0 : ['followup', 'followup-answer'].includes(move) ? 2
  : ['agree', 'thanks'].includes(move) ? 3 : 1);
/** The block's move that ends it (live: the block is sung once that one is there). */
export const BLOCK_ENDS = ['question', 'answer', 'followup-answer', 'thanks'];
/**
 * The moves a making-of that runs behind may show rather than sing (on the singer's card, as an aside): the ok, and
 * the context and the reasoning past the first line; the acknowledgement only when a hold line took the question
 * first (since Nov 1 the host's answer to a question is always sung right after it). Every ask, question, answer,
 * follow-up, agreement and thanks is always sung.
 */
export const OPTIONAL = new Set(['ok', 'ack', 'context', 'reasoning']);

// ------------------------------------------------------------------ the making-of's own lines around a consultation
//
// Nov 1, the owner: "It's rude that the bots don't acknowledge the question right after it's asked. If the bots need
// time to think, then they should say they'll get back to them with it. Once they have the answer, they should remind
// the bot of their question." The making-of (making-of-score.js consult) sings the host's acknowledgement right after
// the question: its own ack when it has written one by then, else a hold line ("Let me think on the glow, Blue"); when
// the answer comes after other talk, the host first recalls the question ("Blue, you asked: can I wink when they
// cheer?" / "Blue, back to the last name"), and an asker coming back to close it, its topic ("Gold, back to the
// glow"). Pure: the same words every time. No future tense (the lyric rules): "let me", "back to you soon".

/** The little words a topic is cut at (a preposition, a pronoun, an auxiliary: "the band | cost us"). */
const FUNC = new Set(('is are be was were am do does did can could should would will has have had '
  + 'in on at for with by from of to into over under when if or and but as so than then up down out off about after before '
  + 'me us it them you him her they we i he she here now there still best too again tonight enough more most').split(' '));
/** Verbs a question uses (a topic stops at one: "the hush | grow"), many of them nouns too: after an adjective, a noun ("the soft glow"). */
const VERBS = new Set(('get gets go goes grow grows cost costs carry carries land lands hold holds start starts crown crowns fit fits suit suits find '
  + 'finds lift lifts light lights take takes need needs feel feels sound sounds work works keep keeps stay stays read reads catch catches meet meets '
  + 'wrap wraps spill spills sing sings shine shines make makes help helps sit sits hit hits ring rings come comes end ends open opens move moves turn '
  + 'turns play plays match matches top tops pop pops stand stands step steps bounce bounces sway sways march marches glow glows look looks give gives '
  + 'tell tells let lets show shows wink winks blink blinks call calls').split(' '));
const ADJ = new Set(('soft big last first tender dark warm cool bright small little sweet loud quiet slow quick happy sad final shared whole grand '
  + 'high low long short golden gold red blue green new old hot cold cozy gentle huge tiny fun funny silly dim deep tall wide late early glad grand next kind proud bold calm wild').split(' '));
/** An adjective (the list, or its look: "leafy", "shared", "joyful"). */
const isAdj = (w) => ADJ.has(w.toLowerCase()) || /[a-z]{2}(y|ed|ful|ish|ous|less)$/i.test(w);
const DETS = { the: 'the', our: 'our', a: 'the', an: 'the', this: 'this', that: 'that', these: 'these', those: 'those', my: 'my', your: 'your', his: 'his', her: 'her', their: 'their' };
const WH_NOUN = /^\W*(?:but|so|and|oh|hmm|ooh)?\W*(what|which)\s+([a-z][a-z'-]*)\b/i;
const tokens = (t) => String(t ?? '').replace(/[?!.,:;"“”()]/g, ' ').split(/\s+/).filter(Boolean);
/** A crewmate's name said to the other at either end of a line ("Pink, ..." / "..., Pink?"): dropped from it. */
export function unaddressed(text, name) {
  const s = String(text ?? '').trim();
  if (!name) return s;
  return s.replace(new RegExp(`^\\W*(hey\\s+)?${name}\\s*[,!:]\\s*`, 'i'), '').replace(new RegExp(`[,\\s]+${name}\\s*([?!.]*)\\s*$`), '$1').trim();
}

/**
 * The topic of a question, a few words (null when it has none to say): its first noun phrase ("What glow crowns the
 * last name?" -> "the last name", "How big can the hush grow?" -> "the hush", "Does the band cost us extra?" -> "the
 * band", "Can a soft glow find me?" -> "the soft glow"), else the one it asks about ("Which plop lands funniest?" ->
 * "the plop"). speaker 'host': the asker's "my" said back as "your" (and its "your" as "my"). name: the crewmate the
 * question is said to (dropped).
 */
export function topicOf(question, { name = null, speaker = 'asker' } = {}) {
  const plain = unaddressed(question, name);
  const ws = tokens(plain);
  for (let i = 0; i < ws.length; i++) {
    const det = DETS[ws[i].toLowerCase()];
    if (!det) continue;
    const out = [];
    for (let k = i + 1; k < ws.length && out.length < 3; k++) {
      const w = ws[k].toLowerCase();
      // (right after the determiner or an adjective, a verb-noun is the noun: "a light", "the soft glow"; a second word
      // only after an adjective: "the light | follow")
      const adj = out.length === 1 && isAdj(out[0]);
      if (FUNC.has(w) || DETS[w] || (VERBS.has(w) && out.length && !adj) || (out.length === 1 && !adj)) break;
      out.push(ws[k]);
    }
    if (!out.length || out.length > 2 || (out.length === 1 && isAdj(out[0]))) continue;
    const d = speaker === 'host' ? ({ my: 'your', your: 'my' }[det] ?? det) : det;
    return `${d} ${out.join(' ')}`;
  }
  const m = WH_NOUN.exec(plain);
  const w = m?.[2]?.toLowerCase();
  if (w && !FUNC.has(w) && !VERBS.has(w) && !DETS[w]) return `the ${w}`;
  return null;
}

/** The asker's question said back by the host ("Can I wink?" -> "can you wink?"); null when it talks of "you" or a name. */
export function questionBack(question, { host = null, asker = null } = {}) {
  let q = unaddressed(question, host).replace(/^\W*(but|so|and|oh|hmm|ooh|okay|ok)\b[,\s]*/i, '').trim();
  if (!q || /\b(you|your|yours|you're|you've|you'd|yourself)\b/i.test(q)) return null;
  if ((host && new RegExp(`\\b${host}\\b`).test(q)) || (asker && new RegExp(`\\b${asker}\\b`).test(q))) return null;
  const swaps = [[/\bam I\b/g, 'are you'], [/\bI am\b/g, 'you are'], [/\bI'm\b/g, "you're"], [/\bI've\b/g, "you've"], [/\bI'd\b/g, "you'd"], [/\bI\b/g, 'you'],
    [/\b[Mm]yself\b/g, 'yourself'], [/\b[Mm]ine\b/g, 'yours'], [/\b[Mm]y\b/g, 'your'], [/\b[Mm]e\b/g, 'you']];
  for (const [re, to] of swaps) q = q.replace(re, to);
  q = q.replace(/[.!]+$/, '');
  if (!/\?$/.test(q)) q += '?';
  return /^[A-Z][a-z]/.test(q) ? q[0].toLowerCase() + q.slice(1) : q;
}

/** The first of `cands` (rotated from k) that sings at most `soft` syllables, else at most `hard`; else null. */
function pickLine(cands, k, count, soft, hard) {
  const list = cands.filter(Boolean);
  const rot = list.map((_, i) => list[(i + k) % list.length]);
  const ok = (c, max) => { const n = count(c); return n >= 2 && n <= max; };
  return rot.find((c) => ok(c, soft)) ?? rot.find((c) => ok(c, hard)) ?? null;
}

/**
 * The host's hold line, right after a question it needs time for: it takes the question and says it comes back to it
 * (the owner: "they should say they'll get back to them"), naming the asker and the topic when they fit.
 * count: the syllable counter (syllabify(text).length); k: a turn (the thread's: varied, the same every time).
 */
export function holdLine(asker, question, { count, k = 0, max = MAX_MOVE_SYLLABLES } = {}) {
  const t = topicOf(question, { speaker: 'host' });
  const A = asker;
  const withTopic = t ? [`Let me think on ${t}, ${A}`, `Hmm, ${t}... Back to you soon, ${A}`, `Good one, ${A}! Let me think on ${t}`, `${A}, let me get back to you on ${t}`] : [];
  const plain = [`${A}, let me think. Back to you soon`, `Good one, ${A}! Let me get back to you`, `Hmm, let me think on that, ${A}`];
  // (two bars when it can: the topic if it fits, else a plain one; four bars for the topic before none)
  return pickLine(withTopic, k, count, 8, 8) ?? pickLine(plain, k, count, 8, max) ?? pickLine(withTopic, k, count, max, max) ?? `Let me think, ${A}`;
}

/**
 * The host coming back to a question after other talk: the question said back to the asker ("Blue, you asked: can I
 * wink when they cheer?"), or its topic ("Blue, back to the last name"), else "back to your question".
 */
export function recallLine(asker, host, question, { count, k = 0, max = MAX_MOVE_SYLLABLES } = {}) {
  const back = questionBack(question, { host, asker });
  const t = topicOf(question, { name: host, speaker: 'host' });
  const said = back ? `${asker}, you asked: ${back}` : null;
  return pickLine([said], 0, count, 8, 8) ?? pickLine(t ? [`${asker}, back to ${t}`, `So, ${asker}, about ${t}`] : [], k, count, 8, max)
    ?? pickLine([said], 0, count, max, max) ?? `${asker}, back to your question`;
}

/**
 * The asker taking a consultation up again after other talk: its follow-up ("Gold, back to the glow", else "Gold,
 * one more thing") or its closing ("So, Gold, about the glow", else "Gold, about your answer").
 */
export function resumeLine(host, question, { count, k = 0, max = MAX_MOVE_SYLLABLES, closing = false } = {}) {
  const t = topicOf(question, { name: host, speaker: 'asker' });
  const cands = t ? (closing ? [`So, ${host}, about ${t}`, `${host}, about ${t}`] : [`${host}, back to ${t}`, `So, ${host}, about ${t}`]) : [];
  return pickLine(cands, k, count, 8, max) ?? (closing ? `${host}, about your answer` : `${host}, one more thing`);
}

/**
 * Asking for a minute, said many ways (the owner, Nov 1: "vary how bots ask permission: many say 'got a sec'"): the
 * making-of sings one of these for a stock ask the episode already had ("Hey Gold, got a sec?" a third time).
 */
export const ASK_POOL = [
  (h) => `${h}, can I ask you something?`, (h) => `Quick question, ${h}?`, (h) => `${h}, can I pick your brain?`, (h) => `${h}, do you have a moment?`,
  (h) => `${h}, can we talk this through?`, (h) => `Hey ${h}, I need your take`, (h) => `${h}, can I run this by you?`, (h) => `Hey ${h}, are you free?`,
  (h) => `${h}, can you help me with something?`, (h) => `${h}, I'm stuck. Can you help?`,
];
/** A stock way to ask for a minute ("got a sec", "have you a minute", "spare a moment", "you free now"). */
export const STOCK_ASK = /\b(got|have|spare|lend|share|steal|need)\b[^?]*\b(secs?|seconds?|minutes?|moments?|ticks?|flash|bit)\b|\byou free\b/i;
/** An ask reduced for "the same words" (no names, no "hey", no punctuation): "Hey Gold, got a sec?" -> "got a sec". */
export const askKey = (text, names = []) => names.reduce((s, n) => (n ? s.replace(new RegExp(`\\b${n}\\b`, 'g'), ' ') : s), String(text ?? ''))
  .toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\b(hey|hi|oh|so|um|yo)\b/g, ' ').replace(/\s+/g, ' ').trim();
