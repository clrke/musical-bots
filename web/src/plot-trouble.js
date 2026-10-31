// The plot's trouble (Nov 1, the owner: "One of the rival bots should have the responsibility of making the plot
// interesting by introducing problems"): Black, the kid next door who schemes and dares, joins the crew as its eighth
// role (`trouble`). For the beats it works on, Black dreams up an obstacle, a complication or a twist that raises the
// stakes, gently (rivals are rivals, not villains), and pitches it to Green (lyrics) or Gold (deals) through a
// consultation (consultation.js); when the host takes it, the problem goes into the story: Green sings it in a verse,
// and a later line solves it (every problem is solved by the friends by the finale).
//
// The record, on the events (all optional; bundles before Nov 1 have none):
//   problem   on Black's `question` move: the problem pitched, one plain sentence ("The cake slides off the cart"); a
//             consultation may pitch up to MAX_PITCHED (one a question: the act-1 one, then the act-2 one)
//   verdict   on the host's answer of the same rank (its first answer for the first problem, its second for the
//             second): "accept" (the story takes it) or "decline"
//   trouble   on Green's sung line that brings an accepted problem into the story: its id ("c4", the consultation's
//             first problem; "c4.2" its second)
//   resolves  on a later sung line that solves it: the same consultation id
// beats.json `crew` lists the roles of the run; with `trouble` in it the gate wants the plot's trouble (troubleGate).
// Shared by the emit tool (scripts/director/emit.js: send-time rules), validate-bundle.js (the shape) and the gate.
// Pure.
import { SECTIONS } from './gen/form.js';
import { threadsOf } from './consultation.js';

/** The plot-trouble role and its bot. */
export const TROUBLE_ROLE = 'trouble';
export const TROUBLE_BOT = 'Black';
/** The crewmates Black pitches a problem to: the story's words (Green) and its deals (Gold). */
export const TROUBLE_HOSTS = ['Green', 'Gold'];
export const VERDICTS = ['accept', 'decline'];
/** The sections a problem is sung in (the setup and the complication: the verses of acts 1 and 2). */
export const TROUBLE_SECTIONS = ['verse1', 'verse1b', 'verse2', 'verse2b'];
/** The latest section a problem may be pitched for (act 3 solves them). */
export const LAST_PITCH = 'verse2b';
/** The acts (the song's three: the setup to the first chorus, the complication to the second, the turn to the end). */
export const ACTS = [
  ['intro', 'verse1', 'verse1b', 'chorus1'],
  ['verse2', 'verse2b', 'chorus2'],
  ['bridge', 'bridge2', 'chorus3', 'outro'],
];
export const actOf = (section) => ACTS.findIndex((a) => a.includes(section)) + 1;
/** The acts that each want an accepted problem sung (acts 1 and 2: act 3 is where they are solved). */
export const TROUBLE_ACTS = [1, 2];
/** An episode wants at least this many accepted problems, sung, each solved later. */
export const MIN_TROUBLES = 2;
/** The bypassable check of the gate (an event's `bypass`: {"trouble": "<why>"}): the count, never the solving. */
export const TROUBLE_CHECK = 'trouble';
/** A consultation pitches at most this many problems (one a question; Black's one open question carries both acts'). */
export const MAX_PITCHED = 2;
/** The id of a consultation's k-th problem (1-based): "c4", "c4.2". */
export const troubleId = (thread, k) => (k === 1 ? thread : `${thread}.${k}`);
export const TROUBLE_ID_RE = /^c\d+(\.[2-9])?$/;
/** A problem is told in this many words at most. */
export const MAX_PROBLEM_WORDS = 20;

/**
 * Whether a sung line at stanza position `pos` of `section` may solve a problem: one of the song's own lines (a verse,
 * a bridge, chorus 3's turned line, the outro's last two), not a copy of the hook or of chorus 1.
 */
export function canResolve(section, pos) {
  if (/^verse/.test(section) || /^bridge/.test(section)) return true;
  if (section === 'chorus3') return pos === 3;
  if (section === 'outro') return pos >= 2;
  return false;
}

/**
 * The plot's troubles of a stream (events in order; beats: the plan, for each beat's section): Map thread id ->
 * { id, asker, host, beat (the ask's), problem, verdict, accepted, pitch (the question's seq), answer (the verdict's
 * event), sung (the line bringing it in), resolved (the line solving it) }. A consultation is a trouble when its
 * asker's question carries `problem`.
 */
export function troublesOf(events, beats = null) {
  const out = new Map();
  const list = events ?? [];
  for (const th of threadsOf(list).values()) {
    const qs = th.events.filter((e) => e.move === 'question' && typeof e.problem === 'string' && e.problem.trim());
    const answers = th.events.filter((e) => e.move === 'answer');
    qs.forEach((q, i) => {
      const a = answers[i] ?? null;
      const verdict = a && VERDICTS.includes(a.verdict) ? a.verdict : null;
      const id = troubleId(th.id, i + 1);
      out.set(id, {
        id, thread: th.id, rank: i + 1, asker: th.asker, host: th.host, beat: th.beat, problem: q.problem.trim(), verdict, accepted: verdict === 'accept',
        pitch: q.seq, question: q, answer: a, sung: null, resolved: null,
      });
    });
  }
  for (const e of list) {
    if (!e?.lyric) continue;
    const t = out.get(e.trouble);
    if (t && !t.sung) t.sung = e;
    const r = out.get(e.resolves);
    if (r && !r.resolved) r.resolved = e;
  }
  return out;
}

const beatPos = (beats, events) => {
  // each sung line's [section, stanza position, beat index]
  const at = new Map();
  (beats?.beats ?? []).forEach((b, i) => events.filter((e) => e.beat === b.id && e.lyric).forEach((e, k) => at.set(e, [b.section, k, i])));
  return at;
};
const beatIdx = (beats, id) => (beats?.beats ?? []).findIndex((b) => b.id === id);

/**
 * The shape of a stream's trouble record (hard rules; validate-bundle.js and the gate): `problem` only on a question
 * of Black's, to Green or Gold; `verdict` only on the first answer of such a consultation, and there always; `trouble`
 * only on a verse line, naming an accepted problem sung once, in the pitch's beat or later; `resolves` on one of the
 * song's own lines in a later beat than the line that sang it; every accepted problem sung is solved. Returns problems.
 */
export function troubleProblems(beats, events) {
  const p = [];
  const list = events ?? [];
  const troubles = troublesOf(list, beats);
  const at = beatPos(beats, list);
  for (const e of list) {
    const where = `event ${e.seq}`;
    if (e.problem !== undefined) {
      if (typeof e.problem !== 'string' || !e.problem.trim()) p.push(`${where}: problem is the trouble pitched, one plain sentence`);
      else if (e.move !== 'question' || e.bot !== TROUBLE_BOT) p.push(`${where}: problem goes on ${TROUBLE_BOT}'s question (the trouble pitched)`);
      else if (!TROUBLE_HOSTS.includes(e.consult?.[0])) p.push(`${where}: ${TROUBLE_BOT} pitches a problem to ${TROUBLE_HOSTS.join(' or ')}`);
    }
    if (e.verdict !== undefined) {
      const t = [...troubles.values()].find((x) => x.answer === e);
      if (!VERDICTS.includes(e.verdict)) p.push(`${where}: verdict is "accept" or "decline"`);
      else if (!t) p.push(`${where}: verdict goes on the answer to ${TROUBLE_BOT}'s pitched problem (its first answer for his first problem, the second for the second)`);
    }
    if (e.trouble !== undefined) {
      const t = troubles.get(e.trouble);
      const [section] = at.get(e) ?? [];
      if (!e.lyric) p.push(`${where}: trouble goes on a sung line`);
      else if (!t || !t.accepted) p.push(`${where}: trouble ${JSON.stringify(e.trouble)} is no accepted problem`);
      else if (t.sung !== e) p.push(`${where}: problem ${t.id} is sung already (event ${t.sung.seq})`);
      else if (!TROUBLE_SECTIONS.includes(section)) p.push(`${where}: a problem is sung in a verse (${TROUBLE_SECTIONS.join(', ')})`);
      else if (beatIdx(beats, e.beat) < beatIdx(beats, t.beat)) p.push(`${where}: problem ${t.id} is sung before ${TROUBLE_BOT} pitched it`);
    }
    if (e.resolves !== undefined) {
      const t = troubles.get(e.resolves);
      const [section, pos] = at.get(e) ?? [];
      if (!e.lyric) p.push(`${where}: resolves goes on a sung line`);
      else if (!t || !t.sung) p.push(`${where}: resolves ${JSON.stringify(e.resolves)} is no problem sung before`);
      else if (t.resolved !== e) p.push(`${where}: problem ${t.id} is solved already (event ${t.resolved.seq})`);
      else if (!(beatIdx(beats, e.beat) > beatIdx(beats, t.sung.beat))) p.push(`${where}: problem ${t.id} is solved in a later beat than the line that sings it`);
      else if (!canResolve(section, pos)) p.push(`${where}: a problem is solved in one of the song's own lines (a verse, a bridge, chorus 3's turned line, the outro's last two), not a copy of the hook`);
    }
  }
  for (const t of troubles.values()) {
    if (!t.verdict && t.answer) p.push(`${t.id}: the answer to ${TROUBLE_BOT}'s problem carries its verdict ("accept" or "decline")`);
    if (t.sung && !t.resolved) p.push(`${t.id}: ${TROUBLE_BOT}'s problem ("${t.problem}") is sung in ${t.sung.beat} and never solved: every problem is solved by the friends by the finale`);
  }
  return p;
}

/**
 * The gate's want (beats.json crew with `trouble`): at least MIN_TROUBLES accepted problems sung and solved, one sung
 * in each of TROUBLE_ACTS. Bendable: a recorded `trouble` bypass (an event's bypassed, with its reason) waives it. The
 * solving never bends (troubleProblems). Returns { problems, stats }.
 */
export function troubleGate(beats, events) {
  const list = events ?? [];
  const troubles = [...troublesOf(list, beats).values()];
  const done = troubles.filter((t) => t.accepted && t.sung && t.resolved);
  const sectionOf = (id) => (beats?.beats ?? []).find((b) => b.id === id)?.section;
  const acts = new Set(done.map((t) => actOf(sectionOf(t.sung.beat))));
  const bypass = list.flatMap((e) => (Array.isArray(e.bypassed) ? e.bypassed : []).filter((b) => b?.check === TROUBLE_CHECK).map((b) => ({ seq: e.seq, reason: b.reason })));
  const want = [];
  if (done.length < MIN_TROUBLES) want.push(`${done.length} problem(s) of ${TROUBLE_BOT}'s accepted, sung and solved; an episode needs at least ${MIN_TROUBLES}`);
  for (const a of TROUBLE_ACTS) if (!acts.has(a)) want.push(`no accepted problem of ${TROUBLE_BOT}'s is sung in act ${a} (${ACTS[a - 1].filter((s) => TROUBLE_SECTIONS.includes(s)).join(', ')})`);
  const stats = {
    pitched: troubles.length, accepted: troubles.filter((t) => t.accepted).length, declined: troubles.filter((t) => t.verdict === 'decline').length,
    sung: troubles.filter((t) => t.sung).length, resolved: done.length, acts: [...acts].sort(), bypassed: bypass,
  };
  return { problems: bypass.length ? [] : want.map((w) => `${w} (the plot's trouble: ${TROUBLE_BOT} pitches a problem to Green or Gold, the host accepts it, Green sings it with "trouble" and solves it later with "resolves"; or ${TROUBLE_BOT} bypasses it with a reason, "bypass": {"trouble": "..."})`), stats };
}

/** Whether a section index (0-based) may still take a new problem's pitch. */
export const pitchOpen = (i) => i >= 0 && i <= SECTIONS.indexOf(LAST_PITCH);
