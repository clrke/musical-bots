// What the director and the crew really did while a production ran: the activity log of a bundle
// (activity.ndjson), the making-of's loading bar sung from real work (web/src/activity-lines.js turns
// each entry into a crew line). One compact, sanitized entry per tool call that means something:
//
//   { t, who, kind, detail?, sing?, beat?, reason?, seqs?, n? }
//     t       seconds since the production started (the bundle's clock: events' `t`)
//     who     "director" or the crew agent ("lyrics", "chords", ... vocab.js ROLES)
//     kind    search | fetch | read | look | git | think | status | plan | write | queue | reject |
//             retry | launch | check | done
//     detail  short, for the log (a query trimmed, a domain, a file's base name, a commit subject),
//             never a path under a home directory, a key, a token or an environment value
//     sing    the detail in a few plain words the singer knows (craft.js knownWord), or absent
//     beat    the beat the call was about (an emit), reason: a rejection's kind (REASONS),
//     seqs    the events a write or a queue sent (the bundle's seqs: the making-of sings a queued
//             thought from when it was written), n: a plan's beat count
//
// Where it comes from (measured Oct 31 on Muse Code 1.4.14):
//   - the Muse session logs ($XDG_DATA_HOME/muse/sessions/YYYY/MM/DD/<id>/session.jsonl, and
//     subagent/<id>/session.jsonl for each crew agent of the Workflow): every tool call with its args,
//     its result and a microsecond timestamp (recorded_at), for the director and each subagent (a
//     subagent's role is in its prompt: "Musical Bots crew role: <agent>"). The `muse exec --json`
//     stdout stream carries only the director's own tool results, without args or the crew, and
//     its recorded_at values are not wall time, so it is not used;
//   - the emit tool's own log (.director/attempts.ndjson, emit.js logAttempt): every call through
//     the gate, ok, queued or rejected, with the agent, the beat and the first problem. Every crew
//     write goes through emit.js, so this is the crew's side even when the session logs are missing;
//     when present it replaces the emit calls read from the session logs.
// A long silence between an agent's tool calls (THINK_S) is its thinking: a `think` entry at its
// start, about the beat it wrote next.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { knownWord } from './craft.js';
import { ROLES, AGENT_BOT } from './vocab.js';
import { commitPhrase } from '../../web/src/activity-lines.js';

export const KINDS = ['search', 'fetch', 'read', 'look', 'git', 'think', 'status', 'plan', 'write', 'queue', 'reject', 'retry', 'launch', 'check', 'done'];
export const WHO = ['director', ...ROLES];
/** A rejection's kind, from the gate's message (the making-of says it in a few words). */
export const REASONS = ['copy', 'nobody', 'word', 'meter', 'opening', 'repeat', 'tense', 'filler', 'question', 'rhyme', 'fourth-wall', 'story', 'done', 'long', 'closed', 'plan', 'other'];
/** s: an agent silent this long between two tool calls was thinking. */
export const THINK_S = 20;
export const ACTIVITY_FILE = 'activity.ndjson';
const DETAIL_MAX = 60;

// ---------------------------------------------------------------------------------------------
// Sanitizing

const HOME = homedir();
/**
 * A detail fit for the log: no path under a home or temp directory (its base name stays), no URL but
 * its host, no key, token, secret or environment value, no long opaque string; trimmed.
 */
export function sanitize(text, max = DETAIL_MAX) {
  let s = String(text ?? '');
  if (HOME && HOME.length > 1) s = s.split(HOME).join('~');
  s = s.replace(/https?:\/\/([^/\s"'?#]+)[^\s"']*/g, '$1') // a URL: its host
    .replace(/\b(?:sk|pk|ghp|gho|xox[bap]|AKIA|key|tok)[-_][A-Za-z0-9_-]{8,}/g, '') // keys and tokens
    .replace(/\bauthorization\b\s*:?\s*(?:(?:bearer|basic|token)\s+)?\S+/gi, '').replace(/\bbearer\s+\S+/gi, '')
    .replace(/\b(api[_-]?key|token|secret|password|passwd|auth|bearer|cookie|session)\b\s*[=:]\s*\S+/gi, '')
    .replace(/\$\{?[A-Z_][A-Z0-9_]*\}?/g, '') // environment variables
    .replace(/(?:~|\/(?:Users|home|private|var|tmp|opt|Volumes)\b)[^\s"'`]*/g, (p) => p.split('/').filter(Boolean).at(-1) ?? '') // a path: its base name
    .replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, '') // opaque strings (hashes, ids, base64)
    .replace(/[`"'\\]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '').trim();
  return s;
}

// words a sung detail never carries (kid-friendly, and nothing that only fills)
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are', 'was', 'be', 'how', 'what', 'when', 'where', 'who', 'why',
  'www', 'com', 'org', 'net', 'http', 'https', 'html', 'dev', 'docs', 'md', 'js', 'json', 'vs', 'via', 'per', 'etc', 'it', 'its', 'this', 'that', 'into', 'as']);
const UNSAFE = /^(kill|killed|kills|die|died|dead|death|blood|gun|guns|weapon|drug|drugs|sex|sexy|hate|stupid|idiot|damn|hell|crap|war|bomb|murder|suicide|drunk|beer|wine|naked)$/;
/**
 * The words of a detail the making-of may sing: plain words the singer knows (craft.js knownWord),
 * kid-friendly, at most `max`, lower case (a cast name keeps its capital); '' when none.
 */
export function singable(text, max = 3) {
  const out = [];
  for (const w of String(text ?? '').split(/[^A-Za-z']+/)) {
    const k = w.replace(/^'+|'+$/g, '').toLowerCase();
    if (k.length < 2 || STOP.has(k) || UNSAFE.test(k) || out.includes(k)) continue;
    if (/^[A-Z]{2,}$/.test(w)) continue; // an acronym: sung as a word
    if (!knownWord(k)) continue;
    out.push(k);
    if (out.length >= max) break;
  }
  return out.join(' ');
}

/** A rejection's kind (REASONS) from the gate's message. */
export function reasonOf(message) {
  const m = String(message ?? '');
  const rules = [
    ['copy', /copies an example|from the example song|said that already/],
    ['nobody', /talks to nobody|names nobody/],
    ['word', /\[dictionary\]|does not know/],
    ['meter', /\[meter\]|stresses pile up/],
    ['opening', /opens with|opens on a (?:name|reaction)|vary how you start/],
    ['repeat', /\[repeat\]|already sung in this stanza|already has its/],
    ['tense', /past tense|future tense/],
    ['filler', /\[filler\]/],
    ['question', /ask too little|questions?: ask|asked \d+ question/],
    ['rhyme', /\[rhyme\]|do not rhyme/],
    ['fourth-wall', /fourth wall|speaks to the viewers/],
    ['story', /who is in the story|not on stage|sings this line, so|names \w+, the one saying it/],
    ['done', /is done and cannot answer|are done and cannot answer/],
    ['long', /sings \d+ syllables|too long|syllables \(names/],
    ['closed', /is closed \(the band moved on\)/],
    ['plan', /beats\.json:/],
  ];
  for (const [k, re] of rules) if (re.test(m)) return k;
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// The session logs

/** The records of a Muse session log (a retained frame's children unwrapped). */
export function sessionRecords(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (Array.isArray(r.children)) {
      for (const c of r.children) { try { out.push(JSON.parse(c.record_json)); } catch { /* not a record */ } }
    } else out.push(r);
  }
  return out;
}

/** The crew role a subagent's session plays ("Musical Bots crew role: <agent>" in its prompt), or null. */
export function roleOfSession(text) {
  return /Musical Bots crew role: ([a-z]+)/.exec(String(text ?? ''))?.[1] ?? null;
}

/**
 * The tool calls of a session: [{ at (ms since the epoch), name, args (object), result (text: a shell
 * call's output), done (ms: its result) }], in order; and `marks` (ms): every model step, for the
 * thinking between calls.
 */
export function toolCalls(records) {
  const calls = [], byId = new Map();
  for (const r of records) {
    const ev = r.payload?.event;
    const at = Number(r.recorded_at) / 1000;
    if (!ev || !Number.isFinite(at)) continue;
    if (ev.kind === 'assistant_tool_calls_committed') {
      for (const c of ev.tool_calls ?? []) {
        let args = {};
        try { args = typeof c.args === 'string' ? JSON.parse(c.args) : c.args ?? {}; } catch { args = {}; }
        const call = { at, name: c.name, args, result: '', done: at };
        calls.push(call);
        byId.set(c.call_id ?? c.id, call);
      }
    } else if (ev.kind === 'tool_result_batch_committed') {
      for (const x of ev.results ?? []) {
        const call = byId.get(x.tool_call_id);
        if (!call) continue;
        let text = String(x.text ?? '');
        try { const j = JSON.parse(text); if (typeof j?.output === 'string') text = j.output; } catch { /* plain text */ }
        call.result = text;
        call.done = at;
      }
    }
  }
  return calls;
}

const emitCall = (cmd) => /(?:^|[\s/"'])emit(?:\.js)?["']?(?:\s|$|<)|\$\{?MB_EMIT\b/.test(cmd);
/** The events a shell call sends through emit (its heredoc or argument JSON): [{ agent, beat, summary }]. */
/** The JSON a shell call hands emit: its heredoc, or its single-quoted argument; null when none. */
const heredoc = (cmd) => {
  const s = String(cmd ?? '');
  return /<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/.exec(s)?.[2] ?? /emit[^'\n]*?\s'(\[[\s\S]*\]|\{[\s\S]*\})'/.exec(s)?.[1] ?? null;
};
export function sentEvents(cmd) {
  const body = heredoc(cmd);
  if (!body) return [];
  let v = null;
  try { v = JSON.parse(body); } catch {
    try { v = body.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { return []; }
  }
  return (Array.isArray(v) ? v : [v]).filter((e) => e && typeof e === 'object').map((e) => ({ agent: e.agent ?? null, beat: e.beat ?? null, summary: e.summary ?? '' }));
}
/** The status an emit call came back with: ok, queued, rejected (or not yet), or null. */
export function emitStatus(out) {
  const o = String(out ?? '');
  if (/^\s*(?:REJECTED|NOT YET)/m.test(o)) return 'rejected';
  if (/^\s*QUEUED:/m.test(o)) return 'queued';
  if (/^\s*(?:OK:|GATE OK)/m.test(o)) return 'ok';
  if (/^\s*GATE FAILED/m.test(o)) return 'rejected';
  return null;
}
const firstProblem = (out) => /^\s*-\s+(.*)$/m.exec(String(out ?? ''))?.[1] ?? /^(?:REJECTED|NOT YET)[: ]*(.*)$/m.exec(String(out ?? ''))?.[1] ?? '';

/** Commit subjects in a git call's output (`%ad %s`, `--oneline`), the ones worth singing first. */
export function commitSubjects(out) {
  const subs = [];
  for (const line of String(out ?? '').split('\n')) {
    const m = /^(?:\d{4}-\d\d-\d\d\s+|[0-9a-f]{7,12}\s+)(.+)$/.exec(line.trim());
    if (m && !/^(?:Merge|Revert)\b/.test(m[1])) subs.push(m[1].trim());
  }
  return subs;
}
const FUN = /\b(sing|sings|singing|sang|sung|song|songs|bots?|first|fix|fixes|fixed|voice|voices|dance|win|stage|lights?|crew|tunes?|musical|hands?|plays?)\b/i;
const INNER = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are', 'its', 'it', 'as', 'we', 'our', 'into']);
/**
 * The part of a commit subject worth singing, as written: a clause of it (split at : ; , + and brackets)
 * whose every word the singer knows, two to five words with two that say something, never ending on a
 * small word ("Real singing", "Bridges sing in we too", "first ten plays"); null when it has none.
 */
export function singablePhrase(subject) {
  let best = null;
  for (const piece of String(subject ?? '').split(/[:;,+()[\]]|\s-\s|\s—\s/)) {
    const ws = piece.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ''));
    if (!ws.length || ws.some((w) => !w || /^[A-Z]{2,}$/.test(w) || UNSAFE.test(w.toLowerCase()) || !(INNER.has(w.toLowerCase()) || knownWord(w.toLowerCase())))) continue;
    while (ws.length && INNER.has(ws.at(-1).toLowerCase())) ws.pop();
    const content = ws.filter((w) => !INNER.has(w.toLowerCase()));
    if (content.length < 2 || ws.length > 6) continue;
    const text = ws.join(' ').toLowerCase();
    const score = (FUN.test(text) ? 2 : 0) + (ws.length <= 5 ? 1 : 0);
    if (!best || score > best.score) best = { text, score };
  }
  return best;
}
/**
 * The commit subject a git look sings: the first that names a fix or feature in plain words (activity-lines.js
 * commitPhrase: "the camera fix"), and that phrase; else the one with the best clause (a fun one first), not sung
 * (the making-of never sings a raw subject).
 */
export function pickSubject(subjects) {
  for (const s of subjects) {
    const phrase = commitPhrase(s);
    if (phrase) return { subject: s, sing: phrase };
  }
  let best = null;
  for (const s of subjects) {
    const p = singablePhrase(s);
    if (p && (!best || p.score > best.p.score)) best = { s, p };
  }
  return best ? { subject: best.s, sing: '' } : subjects[0] ? { subject: subjects[0], sing: '' } : null;
}

const SECTION_WORD = (beat) => {
  const s = /^beat-\d+-([a-z]+)/.exec(String(beat ?? ''))?.[1] ?? '';
  return s.replace(/\d+b?$|b$/, '') || null;
};
const base = (p) => String(p ?? '').replace(/\/+$/, '').split('/').at(-1) ?? '';
/** What a file read is sung as: the project's docs by what they are ("our notes"), else nothing (the line says "our notes"). */
const READ_WORDS = { readme: 'notes', submission: 'submission', protocol: 'rules', rules: 'rules', cast: 'cast list', brief: 'facts', facts: 'facts', story: 'story', handoff: 'notes', changelog: 'notes' };
const readWord = (f) => READ_WORDS[String(f).replace(/\.[a-z0-9]+$/i, '').toLowerCase()] ?? '';

/**
 * One tool call as an activity entry ({ kind, detail?, sing?, beat?, reason?, sent? } without t and
 * who), or null (a call that says nothing: an echo, a sleep). The emit calls are classified too
 * (activityOf skips them when emit.js logged its own).
 */
export function classify(call) {
  const { name, args = {}, result = '' } = call;
  if (name === 'web_search') {
    const q = sanitize(args.query ?? args.q ?? '', 50);
    return { kind: 'search', detail: q, sing: singable(q, 3) };
  }
  if (name === 'web_fetch') {
    let host = '';
    try { host = new URL(args.url).hostname; } catch { host = sanitize(args.url ?? '', 40); }
    const label = host.split('.').filter((x) => !['www', 'dev', 'en', 'docs', 'm', 'com', 'org', 'net', 'ai', 'io', 'gov', 'edu', 'co', 'uk'].includes(x))[0] ?? '';
    return { kind: 'fetch', detail: sanitize(host, 40), sing: singable(label, 1) };
  }
  if (name === 'read_file') {
    const f = base(args.path ?? args.file_path ?? '');
    return { kind: 'read', detail: sanitize(f, 40), sing: readWord(f) };
  }
  if (name === 'workflow') return { kind: 'launch', detail: sanitize(args.name ?? 'the crew', 30) };
  if (name !== 'bash') return null;
  const cmd = String(args.command ?? '');
  if (emitCall(cmd)) {
    const st = emitStatus(result);
    if (/--beats\b/.test(cmd)) {
      let plan = null;
      try { plan = JSON.parse(heredoc(cmd) ?? ''); } catch { plan = null; }
      const n = Array.isArray(plan?.beats) ? plan.beats.length : null;
      const title = typeof plan?.title === 'string' ? plan.title : /"title"\s*:\s*"([^"]{1,60})"/.exec(cmd)?.[1] ?? '';
      if (st === 'rejected') return { kind: 'reject', reason: 'plan', detail: sanitize(firstProblem(result), 50) };
      return { kind: 'plan', detail: sanitize(title, 40), sing: singable(title, 3), ...(n ? { n } : {}) };
    }
    if (/--status\b/.test(cmd)) return { kind: 'status' };
    if (/--check\b/.test(cmd)) return { kind: 'check', detail: st === 'ok' ? 'gate ok' : 'gate failed' };
    if (/--read\b/.test(cmd)) return { kind: 'read', detail: 'the lines so far', sing: 'lines' };
    if (/--done\b/.test(cmd)) return st === 'rejected' ? { kind: 'reject', reason: reasonOf(result), detail: sanitize(firstProblem(result), 50) } : { kind: 'done' };
    const sent = sentEvents(cmd);
    const beat = sent[0]?.beat ?? null;
    const extra = { ...(beat ? { beat } : {}), sent };
    if (st === 'rejected') return { kind: 'reject', reason: reasonOf(result), detail: sanitize(firstProblem(result), 50), ...extra };
    if (st === 'queued') return { kind: 'queue', ...extra };
    if (st === 'ok') return { kind: 'write', ...extra };
    return null;
  }
  if (/\bgit\b[^|;&]*\b(?:log|show)\b/.test(cmd)) {
    const s = pickSubject(commitSubjects(result));
    return s ? { kind: 'git', detail: sanitize(s.subject, 50), sing: s.sing } : { kind: 'git' };
  }
  const file = /\b(?:cat|head|tail|less|sed -n [^ ]+)\s+["']?([^\s"'|;&]+)/.exec(cmd)?.[1];
  if (file && !/^-/.test(file)) {
    const f = base(file);
    return { kind: 'read', detail: sanitize(f, 40), sing: readWord(f) };
  }
  if (/(?:^|[;&|]\s*)(?:ls|find|tree)\b/.test(cmd)) return { kind: 'look' };
  return null;
}

/**
 * A session's activity: its classified calls (t in seconds from t0, ms), and its thinking (a silence
 * of THINK_S or more before a call: a `think` entry where it began, about that call's beat; the
 * director's before its plan is about the plan). skipEmit: leave the emit calls out (emit.js logged them).
 */
export function sessionActivity(records, { t0, who, skipEmit = false }) {
  const out = [];
  const calls = toolCalls(records);
  const sec = (ms) => Math.round((ms - t0) / 100) / 10;
  let prevEnd = null, launched = false;
  for (const c of calls) {
    const a = classify(c);
    // (the director waiting on the Workflow it launched is not thinking)
    if (prevEnd !== null && (c.at - prevEnd) / 1000 >= THINK_S && a && !(launched && who === 'director')) {
      const beat = a.beat ?? null;
      const about = a.kind === 'plan' || (a.kind === 'reject' && a.reason === 'plan') ? 'plan' : SECTION_WORD(beat);
      out.push({ t: sec(prevEnd), who, kind: 'think', ...(about ? { detail: about, sing: about } : {}), ...(beat ? { beat } : {}), seconds: Math.round((c.at - prevEnd) / 1000) });
    }
    prevEnd = Math.max(prevEnd ?? 0, c.done);
    if (!a) continue;
    if (a.kind === 'launch') launched = true;
    if (skipEmit && ['plan', 'status', 'check', 'write', 'queue', 'done'].includes(a.kind) && c.name === 'bash') continue;
    if (skipEmit && a.kind === 'reject' && c.name === 'bash') continue;
    if (skipEmit && a.kind === 'read' && a.sing === 'lines') continue;
    out.push({ t: sec(c.at), who, ...a });
  }
  // a session that ends long after its last call (an agent stopped mid-thought, a stalled crew) was thinking to the end
  const last = records.reduce((m, r) => Math.max(m, Number(r.recorded_at) / 1000 || 0), 0);
  if (prevEnd !== null && (last - prevEnd) / 1000 >= THINK_S && !(launched && who === 'director')) {
    out.push({ t: sec(prevEnd), who, kind: 'think', seconds: Math.round((last - prevEnd) / 1000) });
  }
  return out.filter((e) => e.t >= 0);
}

// ---------------------------------------------------------------------------------------------
// The emit tool's log

/** The emit tool's attempts (.director/attempts.ndjson) as activity entries. */
export function attemptActivity(attempts) {
  const out = [];
  for (const a of attempts) {
    const who = a.agent && ROLES.includes(a.agent) ? a.agent : a.op === 'beats' || a.op === 'check' ? 'director' : null;
    if (!who) continue;
    const t = Number(a.t);
    if (!Number.isFinite(t) || t < 0) continue;
    const base0 = { t, who };
    const sent = (a.sent ?? []).map((s) => ({ agent: a.agent, beat: a.beat, summary: s }));
    if (a.op === 'beats') out.push(a.status === 'rejected' ? { ...base0, kind: 'reject', reason: 'plan', detail: sanitize(a.problem ?? '', 50) }
      : { ...base0, kind: 'plan', detail: sanitize(a.title ?? '', 40), sing: singable(a.title ?? '', 3), ...(a.n ? { n: a.n } : {}) });
    else if (a.op === 'status') out.push({ ...base0, kind: 'status' });
    else if (a.op === 'check') out.push({ ...base0, kind: 'check', detail: a.status === 'ok' ? 'gate ok' : 'gate failed' });
    else if (a.op === 'read') out.push({ ...base0, kind: 'read', detail: 'the lines so far', sing: 'lines' });
    else if (a.op === 'done') out.push(a.status === 'rejected' ? { ...base0, kind: 'reject', reason: reasonOf(a.problem), detail: sanitize(a.problem ?? '', 50) } : { ...base0, kind: 'done' });
    else if (a.op === 'emit') {
      const extra = { ...(a.beat ? { beat: a.beat } : {}), sent };
      if (a.status === 'rejected') out.push({ ...base0, kind: 'reject', reason: reasonOf(a.problem), detail: sanitize(a.problem ?? '', 50), ...extra });
      else if (a.status === 'queued') out.push({ ...base0, kind: 'queue', ...extra });
      else if (a.status === 'ok') out.push({ ...base0, kind: 'write', ...extra });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The log

/**
 * The activity of a production: the director's and the crew's session logs and the emit tool's log,
 * merged in time order; a rejection followed by the same agent's accepted call (on the same beat, or
 * the plan) marks that call a `retry`; the events each write and queue sent resolved to the bundle's
 * seqs. sessions: [{ text (a session.jsonl), who? (else its crew role, else "director") }];
 * attempts: emit.js's log (or null); events: the bundle's; t0: ms the production started.
 */
export function activityOf({ sessions = [], attempts = null, events = [], t0 }) {
  const skipEmit = Array.isArray(attempts) && attempts.length > 0;
  let list = [];
  for (const s of sessions) {
    const who = s.who ?? roleOfSession(s.text) ?? 'director';
    list.push(...sessionActivity(sessionRecords(s.text), { t0, who, skipEmit }));
  }
  if (skipEmit) list.push(...attemptActivity(attempts));
  list.sort((a, b) => a.t - b.t || WHO.indexOf(a.who) - WHO.indexOf(b.who) || (a.kind === 'think') - (b.kind === 'think'));
  // a rejection, then the same agent's next accepted call on that beat (or plan): its retry
  const open = new Map();
  for (const e of list) {
    const key = `${e.who}:${e.kind === 'plan' || e.reason === 'plan' ? 'plan' : e.beat ?? ''}`;
    if (e.kind === 'reject') { open.set(key, e); continue; }
    if (['write', 'queue', 'plan'].includes(e.kind) && open.has(key)) {
      e.retry = true;
      open.delete(key);
    }
  }
  // the events a call sent, as the bundle's seqs (the first unclaimed event of that agent, beat and summary)
  const claimed = new Set();
  for (const e of list) {
    const sent = e.sent;
    delete e.sent;
    if (!sent?.length || !['write', 'queue'].includes(e.kind)) continue;
    const seqs = [];
    for (const s of sent) {
      // (the beat as sent may be a reference, "intro" or "3": the same beat id first, else any)
      const cands = events.filter((x) => !claimed.has(x.seq) && x.summary === s.summary && (!s.agent || x.agent === s.agent));
      const hit = cands.find((x) => x.beat === s.beat) ?? cands[0];
      if (hit) { claimed.add(hit.seq); seqs.push(hit.seq); }
    }
    if (seqs.length) {
      e.seqs = seqs;
      e.beat = events.find((x) => x.seq === seqs[0]).beat;
    }
  }
  for (const e of list) { delete e.sent; for (const k of ['detail', 'sing']) if (e[k] === '' || e[k] == null) delete e[k]; }
  return list;
}

/** Checks an activity log's entries: [] or the problems. */
export function activityProblems(list, { events = null } = {}) {
  const p = [];
  const seqs = events ? new Set(events.map((e) => e.seq)) : null;
  let prev = -Infinity;
  list.forEach((e, i) => {
    const at = `activity ${i}`;
    if (!e || typeof e !== 'object') { p.push(`${at}: not an object`); return; }
    if (typeof e.t !== 'number' || !(e.t >= 0) || e.t < prev) p.push(`${at}: t must be a non-decreasing number >= 0`);
    prev = typeof e.t === 'number' ? e.t : prev;
    if (!WHO.includes(e.who)) p.push(`${at}: who ${JSON.stringify(e.who)} (director or a crew agent)`);
    if (!KINDS.includes(e.kind)) p.push(`${at}: kind ${JSON.stringify(e.kind)}`);
    for (const k of ['detail', 'sing', 'beat']) if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > 80)) p.push(`${at}: ${k} must be a short string`);
    if (e.reason !== undefined && !REASONS.includes(e.reason)) p.push(`${at}: reason ${JSON.stringify(e.reason)}`);
    if (e.seqs !== undefined && (!Array.isArray(e.seqs) || !e.seqs.every((s) => Number.isInteger(s) && (!seqs || seqs.has(s))))) p.push(`${at}: seqs must be the bundle's event seqs`);
    const text = JSON.stringify(e);
    if (/\/Users\/|\/home\/|\/private\/|\/var\/folders\//.test(text)) p.push(`${at}: a local path`);
    if (/\b(?:sk|ghp|xox[bap])[-_][A-Za-z0-9]{8,}|api[_-]?key|bearer\s|password|secret\s*[=:]/i.test(text)) p.push(`${at}: looks like a secret`);
  });
  return p;
}

export function writeActivity(dir, list) {
  writeFileSync(join(dir, ACTIVITY_FILE), list.map((e) => JSON.stringify(e)).join('\n') + (list.length ? '\n' : ''));
}
export function readActivity(dir) {
  const f = join(dir, ACTIVITY_FILE);
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
export function readAttempts(dir) {
  const f = join(dir, '.director', 'attempts.ndjson');
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * A Muse session's log and its subagents' ([{ text, who? }]), from its directory. who: whose the session itself is
 * (the director's by default; a crew member's when the host runs each crew agent as its own Muse session).
 */
export function sessionTexts(dir, { who = 'director' } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  const main = join(dir, 'session.jsonl');
  if (existsSync(main)) out.push({ text: readFileSync(main, 'utf8'), who });
  const sub = join(dir, 'subagent');
  if (existsSync(sub)) for (const c of readdirSync(sub).sort()) {
    const f = join(sub, c, 'session.jsonl');
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    const role = roleOfSession(text);
    if (role && ROLES.includes(role)) out.push({ text, who: role }); // (Muse's own helpers: titles, reminders)
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The log as the production runs (the LIVE making-of: scripts/director/live.js)

const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
/** A Muse session's directory by id (sessions/YYYY/MM/DD/<id>), or null. */
export function sessionDir(id) {
  const root = join(dataHome(), 'muse/sessions');
  if (!id || !existsSync(root)) return null;
  for (const y of readdirSync(root).filter((d) => /^\d{4}$/.test(d)).sort().reverse()) {
    for (const m of readdirSync(join(root, y)).sort().reverse()) {
      for (const d of readdirSync(join(root, y, m)).sort().reverse()) {
        const p = join(root, y, m, d, id);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export const SESSIONS_FILE = 'sessions.json';
/** The activity a resumed run had recorded before it died (direct.js --resume moves the bundle's log here). */
export const PRIOR_ACTIVITY_FILE = 'prior-activity.ndjson';
/**
 * A run's Muse session, noted as soon as it is known (.director/sessions.json: the ids in order; a crew member's own
 * session as { id, who }). Best effort.
 */
export function noteSession(work, id, who = null) {
  try {
    const f = join(work, '.director', SESSIONS_FILE);
    const list = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
    if (!list.some((x) => (typeof x === 'string' ? x : x?.id) === id)) writeFileSync(f, JSON.stringify([...list, who ? { id, who } : id]));
  } catch { /* best effort */ }
}
/** The Muse sessions noted for a run: [{ id, who }] (who: 'director' unless a crew member's own session). */
export function notedSessions(work) {
  try {
    const f = join(work, '.director', SESSIONS_FILE);
    return (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []).map((x) => (typeof x === 'string' ? { id: x, who: 'director' } : x)).filter((x) => x?.id);
  } catch { return []; }
}
/** A resumed run's earlier activity (PRIOR_ACTIVITY_FILE), or []. */
export function priorActivity(work) {
  const f = join(work, '.director', PRIOR_ACTIVITY_FILE);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
/** A resumed run's earlier activity, then what followed (entries before its last one are not this session's). */
export const withPrior = (prior, list) => [...prior, ...list.filter((e) => e.t >= (prior.at(-1)?.t ?? -1))];

/**
 * The activity log of a production still running (its bundle dir: the session logs noted so far, the gate's log,
 * the events landed), sanitized as the recorded one (an entry that looks like a local path or a secret is left out),
 * or []. opts: t0 (ms the production started; else the emit state's), sessionDir (id -> dir: a test's), events.
 */
export function liveActivity(work, { t0 = null, sessionDir: dirOf = sessionDir, events = [] } = {}) {
  try {
    const scratch = join(work, '.director');
    const start = t0 ?? JSON.parse(readFileSync(join(scratch, 'state.json'), 'utf8')).t0;
    const sessions = notedSessions(work).flatMap((x) => sessionTexts(dirOf(x.id), { who: x.who }));
    const list = activityOf({ sessions, attempts: readAttempts(work), events, t0: start });
    // (a resumed run: what was recorded before it died comes first; its t0 was set so the new entries follow it)
    return withPrior(priorActivity(work), list).filter((e) => !activityProblems([e]).some((p) => /local path|secret/.test(p)));
  } catch { return []; }
}

export { AGENT_BOT };
