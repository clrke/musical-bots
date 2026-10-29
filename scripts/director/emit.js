#!/usr/bin/env node
// The director's emit tool: the one way the Muse Code crew writes an episode bundle. Every role
// subagent (Teddy/lyrics ... Pearl/comedy) appends its events through it, and the tool is the stage
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
//     lead-in first: Nora's chords, Gigi's lights), events for a closed beat are refused. Nothing
//     blocks. So the stream is the song's order and its `t` is the real making-of timeline;
//   - after each call it prints the blackboard: the open beat, its lines so far, who is waited on
//     and the consultations addressed to the caller.
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
import { lineProblems as genLineProblems, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES } from '../../web/src/gen/lyrics.js';
import { parseLyric, plainLyric } from '../../web/src/cues.js';
import { syllabify } from '../../web/src/mv/voice/syllables.js';
import {
  ROLES, SETS, STATUSES, STANZA, ARC, NO_REPLY, SECTIONS, TITLES, NAMES, AGENT_BOT, ACTS, HAND_CUES, LIGHT_MOODS,
  CHORD_RE, resolveAction, beatId, sectionChords, REAL_PLAYS, PLAY_PRIORITY,
} from './vocab.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
export const LINGER_S = env('MB_EMIT_LINGER_S', 15); // a complete stanza waits this long for laggards
const MAX_BATCH = 6;
const FIELDS = ['agent', 'bot', 'status', 'beat', 'summary', 'lyric', 'chords', 'action', 'consult', 'singer', 'with'];
const IGNORED = ['seq', 't']; // the tool assigns them

// ---------------------------------------------------------------------------------------------
// Text helpers

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
/** A prompt as a bundle slug: "lou-sells-hot-soup-on-a-cold". */
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'episode';
/** A line reduced for "same words" comparisons: no markup, pickup, reply or punctuation. */
export function coreText(lyric) {
  const { text, pickup } = parseLyric(lyric, NAMES);
  const body = pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text;
  return body.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const nameRe = new RegExp(`\\b(${NAMES.join('|')})\\b`, 'gi');
const syllables = (s) => (s.trim() ? syllabify(s).length : 0);

/** Problems of a summary (short, present tense, rule-clean, no markup). */
export function summaryProblems(summary) {
  const p = [];
  if (typeof summary !== 'string' || !summary.trim()) return ['summary is required: one short present-tense sentence of what the bot does now'];
  const s = summary.trim();
  if (/[\n\r]/.test(s)) p.push('summary must be one line');
  if (s.length > 90 || words(s).length > 14) p.push(`summary is too long (${words(s).length} words; at most 14 words / 90 characters)`);
  if (/[{}]|>>|\[/.test(s)) p.push('summary is plain text (markup goes in the lyric)');
  for (const r of lyricProblems(s)) p.push(`summary breaks a lyric rule: ${r}`);
  return p;
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
  if (/[{}]/.test(braces)) p.push('bad {Name} or {Name:act} markup (a cue is {Lou} or {Lou:gasp}, a canon name and an act)');
  for (const m of line.matchAll(/\{([A-Za-z][A-Za-z-]*)(?::([a-z][a-z0-9-]*))?\}/g)) {
    if (!NAMES.some((n) => n.toLowerCase() === m[1].toLowerCase())) p.push(`{${m[1]}} is not a bot (names: ${NAMES.join(', ')})`);
    if (m[2] && !HAND_CUES.has(m[2]) && !ACTS.includes(m[2])) p.push(`{${m[1]}:${m[2]}}: "${m[2]}" is not a cue (hand cues: ${[...HAND_CUES].join(', ')}; face acts: ${ACTS.join(', ')})`);
  }
  const pick = /^\s*\[([^\]]+)\]\s*/.exec(line);
  if (/\[|\]/.test(pick ? line.slice(pick[0].length) : line)) p.push('[Pickup] goes only at the very start of the line, e.g. "[And] Lou counts every cent"');
  if (pick && words(pick[1]).length > 3) p.push('a [Pickup] is 1-3 words');
  const { text, pickup, reply } = parseLyric(s, NAMES);
  const body = (pickup && text.startsWith(pickup) ? text.slice(pickup.length) : text).trim();
  if (!body) p.push('the line has no words');
  const named = (body.match(nameRe) ?? []).length;
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
    if (reply && (reply.match(nameRe) ?? []).length) p.push('a reply names nobody');
  }
  for (const r of lyricProblems(plainLyric(s))) p.push(`lyric rule: ${r} (no we/us/our/all, no future tense, no brands, nothing menacing)`);
  if (/(^|[\s,!.?])(a|an|the|my|his|her|its|your|their|this|that|one)\s+box(es)?\b/i.test(plainLyric(s)) || /^\s*box(es)?\b/i.test(body))
    p.push('"box" alone sings badly (its final /ks/ blurs): use a noun phrase, e.g. "toy box", "cardboard box"');
  return p;
}

// ---------------------------------------------------------------------------------------------
// beats.json (the director's plan)

/** Validate + complete a plan. Returns { beats, errors }. fill: { prompt, seed }. */
export function validateBeats(raw, fill = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { beats: null, errors: ['beats.json is one JSON object'] };
  const out = {
    prompt: fill.prompt || (typeof raw.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : undefined), // the run's own prompt wins
    seed: typeof raw.seed === 'string' && raw.seed.trim() ? raw.seed.trim() : fill.seed,
    version: 2,
    title: raw.title, roles: raw.roles, tags: raw.tags, hook: raw.hook, irony: raw.irony,
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
    if (/>>/.test(out.hook)) errors.push('hook: the plain hook line (Teddy adds replies when he sings it)');
  }
  if (typeof out.irony !== 'string' || words(out.irony).length < 6) errors.push('irony: one sentence, the irony rooted in the premise that chorus 3\'s turned line and the outro pay off');
  else if (out.irony.length > 400) errors.push('irony: one sentence (at most 400 characters)');
  const list = raw.beats;
  if (!Array.isArray(list) || list.length !== SECTIONS.length) {
    errors.push(`beats: exactly ${SECTIONS.length} beats, one per section in order: ${SECTIONS.join(', ')}`);
    return { beats: errors.length ? null : out, errors };
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
  return { beats: errors.length ? null : out, errors };
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
  if (errors.length) return { event: null, beat: bi, errors };

  const lyric = str('lyric').trim();
  const consult = arr('consult').map((n) => NAMES.find((x) => x.toLowerCase() === n.toLowerCase()) ?? n);
  const status = raw.status ?? (agent === 'lyrics' && lyric ? 'proposing' : 'working');
  if (!STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  errors.push(...summaryProblems(raw.summary));

  // consultations: bot + the bots it asks (on screen: approach, exchange, nod, resume)
  for (const n of consult) if (!NAMES.includes(n)) errors.push(`consult: "${n}" is not a bot`);
  if (consult.includes(bot)) errors.push(`consult names the bots ${bot} asks, not ${bot}`);
  if (new Set(consult).size !== consult.length || consult.length > 3) errors.push('consult: 1-3 different bots');
  if (status === 'consulting' && !consult.length) errors.push('status "consulting" needs consult: the bot(s) you ask, e.g. ["Teddy"]');

  // the sung line (lyrics only): singer + harmony from the beat's cast
  let singer = str('singer').trim() || null;
  const withList = arr('with');
  if (lyric && agent !== 'lyrics') errors.push(`only Teddy (lyrics) writes the sung lines; ${bot}'s lyric stays "" and the summary says what ${bot} does (that is what ${bot} sings in the making-of)`);
  if (agent === 'lyrics' && status === 'proposing' && !lyric) errors.push('a proposing lyrics event carries its line in "lyric"');
  if (lyric && beat) {
    singer ??= section.startsWith('bridge') ? roles.grown : roles.lead;
    errors.push(...lineProblems(lyric, { section, singer, roles }));
    const self = parseLyric(lyric, NAMES).cues.find((c) => c.name.toLowerCase() === String(singer).toLowerCase());
    if (self) errors.push(`${self.name} sings this line, so it says "I", not {${self.name}} (or give the line to another singer)`);
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

  // the band's chords: Nora's (Teddy may copy them onto his lines)
  const chords = arr('chords').map((c) => c.trim());
  if (chords.length && !['chords', 'lyrics'].includes(agent)) errors.push('only Nora (chords) sets the band\'s chords; leave chords []');
  if (chords.length > 8 || !chords.every((c) => CHORD_RE.test(c))) errors.push('chords: up to 8 chord names like "C", "Am", "F", "G7"');

  // the action: an id of web/src/actions.js
  let action = str('action').trim();
  if (action) {
    const r = resolveAction(action);
    if (r.kind === 'none') errors.push(`action "${action}" is not in the vocabulary (web/src/actions.js); leave it "" or pick from your menu`);
    else if (r.kind === 'light') {
      if (agent !== 'lighting') errors.push('light cues (lights-*, spot-*) are Gigi\'s (lighting)');
      if (r.id === 'lights' && !LIGHT_MOODS.includes(r.target)) errors.push(`lights-<mood>: mood is one of ${LIGHT_MOODS.join(', ')}`);
      if (r.id === 'spot' && r.target !== 'hero') {
        const c = NAMES.find((n) => n.toLowerCase() === String(r.target).toLowerCase());
        if (!c) errors.push(`spot-<Bot>: "${r.target}" is not a bot`); else action = `spot-${c}`;
      }
    } else if (r.kind === 'move' && r.id === 'walk-to') {
      const c = NAMES.find((n) => n.toLowerCase() === String(r.target).toLowerCase());
      if (c) action = `walk-to-${c}`;
      else if (!/^[a-z][a-z0-9_]*$/.test(r.target ?? '')) errors.push('walk-to-<Bot|mark>: a bot name (walk-to-Lou) or a set mark');
    }
    if (agent === 'lighting' && r.kind !== 'light') errors.push('Gigi (lighting) cues lights only: lights-<mood>, spot-<Bot>, spot-hero');
  }

  const event = { agent, bot, status, beat: beat?.id ?? raw.beat, summary: typeof raw.summary === 'string' ? raw.summary.trim() : '', lyric, chords, action, consult };
  if (singer && (lyric || str('singer'))) event.singer = singer;
  if (withC.length) event.with = withC;
  return { event, beat: bi, errors };
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
  const core = coreText(lyric);
  const at = (sec, k) => { const j = SECTIONS.indexOf(sec); const l = linesOf(beats, events, j)[k]; return l ? l.lyric : null; };
  const same = (want, what) => (want === null || coreText(want) === core ? [] : [`${section} line ${pos + 1} sings ${what}: "${parseLyric(want, NAMES).text}" (the same words; cues, pickups and replies may change)`]);
  const hook = beats.hook ?? at('chorus1', 0);
  if (section === 'chorus1') {
    if (pos === 0) return same(hook, 'the hook');
    if (pos === 2) return same(at('chorus1', 0), 'the hook again');
    if (pos === 1 || pos === 3) return hook && coreText(hook) === core ? [`${section} line ${pos + 1} is the chorus's own line (X or Y), not the hook`] : [];
  }
  if (section === 'chorus2') return same(at('chorus1', pos), "chorus 1's words");
  if (section === 'chorus3') {
    if (pos < 3) return same(at('chorus1', pos), "chorus 1's words");
    const y = at('chorus1', 3);
    return y && coreText(y) === core ? ['chorus3 line 4 is the turned line: it changes chorus 1\'s last line to pay off the irony'] : [];
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
/** A fresh scratch state (the orchestrator writes it before Muse starts: t0 is the making-of's zero). */
export function initState(dir, { prompt, slug, seed, t0 = Date.now() } = {}) {
  const state = { t0, prompt, slug, seed, open: -1, openedAt: {}, stanzaAt: {}, pos: {}, seen: {}, done: {}, queue: [], rejected: 0, queued: 0 };
  writeState(dir, state);
  return state;
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
  try { return JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')); } catch { return null; }
}
export function readEvents(dir) {
  try {
    return readFileSync(join(dir, 'events.ndjson'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
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
    // the open beat's queued events land first: the lead-in (Nora's chords, Gigi's lights), then in
    // the order they were sent
    const due = state.queue.filter((q) => q.beat === k);
    if (due.length) {
      state.queue = state.queue.filter((q) => q.beat !== k);
      const lead = (q) => (['chords', 'lighting'].includes(q.e.agent) ? 0 : 1);
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
/** A line takes the band's chords in force on its beat (Nora's), else the section's. */
function stamp(e, beats, events) {
  if (!e.lyric || e.chords.length) return e;
  const b = beats.beats.find((x) => x.id === e.beat);
  const nora = events.filter((x) => x.beat === e.beat && x.chords?.length).at(-1);
  return { ...e, chords: nora ? nora.chords : sectionChords(b.section, beats.tags, beats.seed) };
}
/** Append events to the stream (under the lock): seq, t (real seconds since t0), one write. */
function land(dir, state, events, list, now) {
  if (!list.length) return [];
  const prevT = events.length ? events.at(-1).t : 0;
  const t = Math.max(prevT, Math.round((now - state.t0) / 100) / 10);
  const final = list.map((e, i) => ({ seq: events.length + i, t, ...e }));
  appendFileSync(join(dir, 'events.ndjson'), final.map((e) => JSON.stringify(e)).join('\n') + '\n');
  events.push(...final);
  return final;
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
  if (n < STANZA[b.section]) parts.push(`Teddy's lines ${n}/${STANZA[b.section]}`);
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
  out.push(`  waiting on: ${waitingOn(state, beats, events, now)}.`);
  const mine = (state.queue ?? []).filter((q) => q.e.agent === agent);
  if (mine.length) out.push(`  your queued events: ${[...new Set(mine.map((q) => beats.beats[q.beat].id))].join(', ')} (they land when those beats open).`);
  if (agent) {
    const me = AGENT_BOT[agent];
    const queued = (state.queue ?? []).map((q) => q.e);
    const asks = [...events, ...queued].filter((e) => e.status === 'consulting' && e.consult.includes(me)).slice(-3);
    for (const e of asks) {
      const answered = e.seq !== undefined && events.some((x) => x.seq > e.seq && x.bot === me);
      out.push(`  ${e.bot} ${answered ? 'consulted' : 'is consulting'} you (${e.beat}): "${e.summary}"${answered ? '' : ' — answer in your next event'}.`);
    }
    for (const c of events.filter((e) => e.status === 'consulting' && e.bot === me).slice(-2)) {
      const answers = [...events.filter((x) => x.seq > c.seq), ...queued].filter((x) => c.consult.includes(x.bot)).slice(0, 2);
      out.push(`  you consulted ${c.consult.join(', ')} (${c.beat}): ${answers.length ? answers.map((x) => `${x.bot} answers: "${x.summary}"`).join('; ') : 'no answer yet'}.`);
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
    for (const [i, p] of fresh.entries()) {
      const e = p.event;
      if (e.lyric) {
        const tag = fresh.length > 1 ? `event ${i + 1}: ` : '';
        if (pos >= STANZA[section]) problems.push(`${tag}${beats.beats[j].id} already has its ${STANZA[section]} lines`);
        else problems.push(...formProblems(beats, [...sent, ...staged], j, pos, e.lyric).map((q) => `${tag}${q}`));
        pos++;
      }
      staged.push(e);
    }
    if (problems.length) { state.rejected = (state.rejected ?? 0) + 1; writeState(dir, state); return { status: 'rejected', message: rejectText(problems) }; }
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
    const board = blackboard(beats, events, state, agent, { now: t }) + playNote(staged);
    if (final.length) {
      const head = `OK: ${final.length} event${final.length > 1 ? 's' : ''} appended (seq ${final[0].seq}${final.length > 1 ? `-${final.at(-1).seq}` : ''}, t ${final[0].t}s).`;
      return { status: 'ok', events: final, message: `${head}\n${board}` };
    }
    const landedNow = after.filter((e) => e.agent === agent && e.beat === beats.beats[j].id);
    if (landedNow.length) return { status: 'ok', events: landedNow, message: `OK: ${landedNow.length} event(s) appended to ${beats.beats[j].id} (it just opened).\n${board}` };
    return { status: 'queued', events: staged, message: `QUEUED: ${staged.length} event${staged.length > 1 ? 's' : ''} for ${beats.beats[j].id}; ${staged.length > 1 ? 'they land' : 'it lands'} when that beat opens (the open beat is ${beats.beats[state.open].id}). Go on with your next beat.\n${board}` };
  });
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
    const { beats, errors } = validateBeats(raw, { prompt: state.prompt, seed, director: state.director });
    if (errors.length) return { status: 'rejected', message: rejectText(errors.map((e) => `beats.json: ${e}`)) };
    writeFileSync(join(dir, 'beats.json'), JSON.stringify(beats, null, 2) + '\n');
    if (!existsSync(join(dir, 'events.ndjson'))) writeFileSync(join(dir, 'events.ndjson'), '');
    state.open = 0;
    state.openedAt = { 0: now() };
    writeState(dir, state);
    return { status: 'ok', message: `OK: beats.json written; ${beats.beats[0].id} is open.\n${blackboard(beats, [], state, null, { plan: true, now: now() })}` };
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
  }
  const consults = events.filter((e) => e.status === 'consulting' && e.consult?.length).length;
  if (consults < 2) problems.push(`${consults} consultation(s); an episode needs at least 2 (status "consulting" with consult names)`);
  const perRole = Object.fromEntries(ROLES.map((r) => [r, events.filter((e) => e.agent === r).length]));
  for (const [r, n] of Object.entries(perRole)) if (!n) problems.push(`${AGENT_BOT[r]} (${r}) has no events`);
  const stats = { events: events.length, lines: events.filter((e) => e.lyric).length, consultations: consults, perRole, duration: events.at(-1)?.t ?? 0 };
  return { ok: problems.length === 0, problems, stats };
}

// ---------------------------------------------------------------------------------------------
// CLI

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
  const out = (r) => { console.log(r.message); return r.status === 'ok' || r.status === 'queued' ? 0 : r.status === 'rejected' ? 2 : 1; };
  if (args.includes('--check')) {
    const r = checkBundle(dir);
    console.log(r.ok ? `GATE OK: ${r.stats.events} events, ${r.stats.lines} lines, ${r.stats.consultations} consultations` : `GATE FAILED:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`);
    return r.ok ? 0 : 1;
  }
  const done = flag('--done');
  if (done) return out(markDone(dir, typeof done === 'string' ? done : asAgent));
  if (args.includes('--status')) return out(status(dir, asAgent));
  const rd = flag('--read');
  if (rd) return out(readout(dir, typeof rd === 'string' ? rd : null));
  const isBeats = args.includes('--beats');
  const rest = args.filter((a) => a !== '--beats');
  const input = parseInput(rest.length ? rest.join(' ') : readStdin());
  if (input.error) return out({ status: 'rejected', message: `REJECTED: ${input.error}` });
  if (isBeats) return out(writeBeats(dir, input.value));
  return out(await emitEvents(dir, input.value, { as: asAgent }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.log(`emit: ${err.stack || err.message}`); process.exit(1); });
}
