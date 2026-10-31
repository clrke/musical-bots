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
 * The moves a making-of that runs behind may show rather than sing (on the singer's card, as an aside): the ok, the
 * acknowledgement, and the context and the reasoning past the first line (behind further: all of them). Every ask,
 * question, answer, follow-up, agreement and thanks is always sung.
 */
export const OPTIONAL = new Set(['ok', 'ack', 'context', 'reasoning']);
