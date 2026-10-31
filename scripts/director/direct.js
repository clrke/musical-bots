#!/usr/bin/env node
// The AI director: Muse Code (Meta's agentic coding CLI, headless) directs one episode with a crew of
// seven role subagents, each its own Muse agent definition with its own prompt (director/prompts):
// Green/lyrics, White/chords, Gray/dance, Blue/lighting, Gold/deals, Yellow/hype, Pink/comedy.
//
//   node scripts/director/direct.js "<prompt>" [--slug x] [--out dir] [--live]
//   node scripts/director/direct.js --all [--out episodes]      the 14 curated seeds (web/src/curated.js)
//     [--only slug,slug | --skip slug,slug]                       a part of them
//   npm run direct -- "<prompt>" ...                            (the same)
// Options: --effort low|medium|high (the crew; default low), --lyrics-effort <e> and --director-effort <e>
//   (Green's lines and the plan; default: high, or --effort when it is higher),
//   --model <id> (default: Muse's own default), --provider meta|echo, --muse <bin> ($MUSE_BIN,
//   default ~/.local/bin/muse), --timeout <s> (1500: the consultations take their time), --repairs <n> (1), --keep (keep .director/),
//   --no-web (no web_search / web_fetch: by default the director researches a real-world premise),
//   --no-repo (no read-only access to this repo and its git history: by default the director and the
//   crew may read it, $MB_REPO, so a premise about the project is told from its real commits),
//   --brief <file> (the premise's fact sheet; default director/briefs/<slug>.md when it exists),
//   --craft strict|warn|off (the craft checks, craft.js: strict rejects a weak line unless the agent
//   bypasses it with a reason, the default; warn only notes; off skips them),
//   --dry-run (write the prompts and the agent overlay, run nothing).
//
// How a run goes:
//   1. The bundle's scratch (.director/) gets the clock (t0), a one-line emit command and the
//      rendered prompts; the vocabulary comes from actions.js, cues.js, form.js and cast.js at run
//      time, so the prompts never drift from the stage.
//   2. `muse exec` runs the director prompt with the crew as an --agents overlay. The director plans
//      beats.json (emit.js --beats), then launches the Workflow scripts/director/workflow.js, which
//      starts the seven agents at once; they append their events through emit.js (validated, in beat
//      order, `t` = real seconds) while the LIVE page polls the bundle.
//   3. The gate (emit.js checkBundle: validate-bundle.js, the stanza form, >=2 consultations, all
//      seven roles) decides; a failed gate gets one repair run (the crew resumes at the open beat).
//   4. director.json records the provenance: Muse version, model, effort, wall time, tokens (the
//      director and every subagent, from Muse's session logs) and an estimated cost, per-role counts,
//      and the craft checks (the mode, every bypass and its reason, the counts per check).
//   5. activity.ndjson records what the director and the crew really did, when (activity.js: their
//      tool calls from Muse's session logs, every gate call from emit.js's log, sanitized): the
//      making-of sings it in its waits, and each queued thought from when it was written.
// Without --live the run works in a temp dir and replaces <out> only when the gate passes.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initState, readState, readBeats, readEvents, checkBundle, finalize, slugify, MAX_SUMMARY_SYLLABLES, MIN_EXCHANGES } from './emit.js';
import { MAX_MOVE_SYLLABLES, MIN_ASKED, MIN_CONSULTATIONS } from '../../web/src/consultation.js';
import { MODES, CHECKS, MAX_BYPASSES, MIN_REASON_WORDS } from './craft.js';
import { ROLES, SETS, STANZA, ARC, SECTIONS, NAMES, AGENT_BOT, HAND_CUES, ACTS, LIGHT_MOODS, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, roleMenu, agentType, progressionMenu, parsePrompt } from './vocab.js';
import { SEEDS, curatedSlug } from '../../web/src/curated.js';
import { activityOf, activityProblems, sessionTexts, sessionDir, readAttempts, writeActivity, noteSession, ACTIVITY_FILE } from './activity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PROMPTS = join(REPO, 'director/prompts');
const EMIT_JS = join(HERE, 'emit.js');
const WORKFLOW_JS = join(HERE, 'workflow.js');
export const TOOLSET = ['bash', 'read_file', 'workflow']; // the crew needs a shell for the emit command; the director the Workflow tool
export const WEB_TOOLS = ['web_search', 'web_fetch']; // the director's research on a premise about something real (on by default; --no-web)
const BUNDLE_FILES = ['beats.json', 'events.ndjson', 'director.json', ACTIVITY_FILE]; // (the activity log when it could be recorded)

// ---------------------------------------------------------------------------------------------
// Prompts

const read = (f) => readFileSync(join(PROMPTS, f), 'utf8').trim();
const fill = (tpl, vars) => tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const list = (xs) => xs.map((x) => `\`${x}\``).join(', ');

function sectionsText() {
  return SECTIONS.map((s, i) => `  ${i + 1}. ${s} (${STANZA[s]} lines): ${ARC[s]}`).join('\n');
}
function chordSetsText() {
  const label = { 'intro:scene': 'intro (sets the scene, ends on G)', 'verse:narrative': 'verse1 / verse2 (tells the story, home on C)',
    'verse:build': 'verse1b / verse2b (builds to G, into the chorus)', 'chorus:bright': 'chorus 1 and 2 (bright; the arranger ends every chorus G7 C)',
    'chorus3:lift': 'chorus 3 (lifts: starts away from home)', 'bridge:suspense': 'bridge (suspense)', 'bridge:tender': 'bridge (tender)',
    'bridge2:suspense': 'bridge2 (suspense: never home)', 'bridge2:tender': 'bridge2 (tender: leans on G)', 'outro:conclusive': 'outro (conclusive)', 'outro:soft': 'outro (soft)' };
  return progressionMenu().map(([job, opts]) => `  - ${label[job] ?? job}: ${opts.slice(0, 3).map((o) => `[${o}]`).join(' or ')}`).join('\n');
}
/** What the generator's parser reads in a prompt (web/src/gen/prompt.js): a hint for the plan. */
function promptHints(prompt) {
  try {
    const p = parsePrompt(prompt);
    const bits = [];
    if (p.names?.length) bits.push(`it names ${p.names.join(', ')}`);
    if (p.sets?.length) bits.push(`its words point to the set${p.sets.length > 1 ? 's' : ''} ${p.sets.join(', ')}`);
    if (p.subject) bits.push(`its subject is "${p.subject}"`);
    return bits.length ? `The premise's words: ${bits.join('; ')}.` : '';
  } catch { return ''; }
}
/** The shared variables of every prompt. */
function vars(ctx, agent = null) {
  return {
    EMIT: ctx.emit, PROMPT: ctx.prompt, WORKFLOW: ctx.workflow ?? WORKFLOW_JS, ARGS: '{}',
    AGENT: agent ?? '', BOT: agent ? AGENT_BOT[agent] : '', NAMES: NAMES.join(', '),
    SECTIONS: sectionsText(), SETS: list(SETS), HAND_CUES: list([...HAND_CUES]), ACTS: list(ACTS),
    LIGHT_MOODS: list(LIGHT_MOODS), CHORD_SETS: chordSetsText(), HINTS: promptHints(ctx.prompt), BRIEF: briefText(ctx), RESEARCH: researchText(ctx), REPO_ACCESS: repoText(ctx),
    MAX_LINE: String(MAX_LINE_SYLLABLES), MAX_REPLY: String(MAX_REPLY_SYLLABLES),
    MAX_THOUGHT: String(MAX_SUMMARY_SYLLABLES), MIN_EXCHANGES: String(MIN_EXCHANGES), MAX_MOVE: String(MAX_MOVE_SYLLABLES), MIN_ASKED: String(MIN_ASKED), MIN_CONSULTATIONS: String(MIN_CONSULTATIONS), MAX_BYPASSES: String(MAX_BYPASSES), MIN_REASON: String(MIN_REASON_WORDS), CHECKS: list(CHECKS),
    MENU: agent ? list(roleMenu(agent)) : '', CAST: read('cast.md'), EXAMPLE: read('example.md'),
  };
}
/**
 * The premise's fact sheet (checked homework, given to the director and the crew; the web research
 * fills in around it): --brief <file>, else
 * director/briefs/<slug>.md when it exists. The story must stay true to it.
 */
export function briefText(ctx) {
  const f = ctx.brief ?? join(REPO, 'director/briefs', `${ctx.slug}.md`);
  if (!f || !existsSync(f)) return '';
  const text = readFileSync(f, 'utf8').trim();
  if (!text) return '';
  return `## The facts behind the premise (true; the story must stay true to them)

The premise is about something real. These facts are checked; build the story from them and never
invent a detail they contradict (no prize, place or event the facts do not name). Names these facts
give may be sung (they are not brands here).

${text}`;
}
/** The director's research step (web tools on): check a real-world premise before planning. */
export function researchText(ctx) {
  if (!ctx.web) return '';
  return `## Step 0: do the homework (web_search, web_fetch)

If the premise is about something real (an event, a place, a product, a person, a contest, a
holiday, a science fact), research it before you plan: web_search for it, web_fetch the official
page or two, and note what is true (names, dates, what happens, what the prize or outcome really
is). Never invent a detail the sources do not support (no trophy, prize or place they do not name);
the fact sheet above, when there is one, is checked and wins over anything you find. Keep it short:
at most 4 searches and 4 fetches, then plan. Put what you learned in the plan's "facts": up to 10
short, plain sentences the crew writes from (each with its source's domain in parentheses). A pure
make-believe premise needs no research: skip this step and leave "facts" out.

The facts are the story, not decoration: a premise about something real is told through what really
happens there. Every beat's summary shows a real part of it (for a hackathon: signing up, the
kickoff, building with the event's tools, the deadline, the judges, the finals), the cast's traits
color how they live through it, and nothing drifts to an unrelated plot (no pancakes, syrup or soup
unless the facts bring them). When the premise has the bots take part, their entry is Musical Bots
itself (this show: sixteen bots who write, stage and sing a musical from a one-line prompt).`;
}
/**
 * The project's own repository, read-only (on by default; --no-repo): the director (and the crew,
 * briefly) may read this repo and its git history, so a premise about the project itself (the
 * hackathon episode) is told from real commits. Muse runs in a scratch workspace; its shell and
 * read_file reach the repo by absolute path ($MB_REPO; measured Oct 30: `git -C "$MB_REPO" log`,
 * `ls` and read_file all work under the run's flags). Read only: the prompt forbids writes there.
 */
export function repoText(ctx) {
  if (!ctx.repo) return '';
  return `## The project itself (read-only: its files and git history)

This show's own repository is at \`${ctx.repo}\` (also \`$MB_REPO\`): its code, docs, episodes and
its git history (every commit since the first). When the premise is about the project itself (the
bots, how they were built, the hackathon they entered), tell it from what really happened: before
you plan, look with read-only commands, e.g.
\`git -C "$MB_REPO" log --reverse --date=short --format='%ad %s' | head -40\`,
\`git -C "$MB_REPO" log --oneline -30\`, \`git -C "$MB_REPO" show --stat <hash>\`, \`ls "$MB_REPO"\`, and read_file on \`${ctx.repo}/README.md\` or \`${ctx.repo}/docs/SUBMISSION.md\`.
At most 6 such commands, then plan; put what you use in the plan's "facts" (short plain sentences,
each ending "(git log)" or the file it came from) so the crew sings real moments (the first commit,
a bug fixed at midnight, the day the bots first sang). Read only: never write, commit, check out,
stash or run anything else there. A premise that is not about the project needs none of this.`;
}
/** The crew's line about the repository (the director's facts usually hold what a line needs). */
function repoCrewText(ctx) {
  if (!ctx.repo) return '';
  return `\n\nThe project's repository \`${ctx.repo}\` (\`$MB_REPO\`) is readable, read-only: when the plan's
facts are about the project itself and a line needs a real detail, one quick look is fine
(\`git -C "$MB_REPO" log --oneline -20\`, read_file on a file there). Never write there.`;
}
/** One crew member's agent definition prompt: its role prompt + the crew's rules. */
export function rolePrompt(ctx, agent) {
  const v = vars(ctx, agent);
  const brief = briefText(ctx);
  const extra = `${repoCrewText(ctx)}\n\n${read('cast.md')}${brief ? `\n\n${brief}` : ''}`;
  return `Musical Bots crew role: ${agent} (${AGENT_BOT[agent]})\n\n${fill(read(`${agent}.md`), v)}\n\n${fill(read('rules.md'), v)}${extra}\n`;
}
/** The --agents overlay: the seven role definitions. */
export function crewOverlay(ctx) {
  return Object.fromEntries(ROLES.map((a) => [agentType(a), {
    description: `${AGENT_BOT[a]}, the ${a} agent of the Musical Bots crew: adds the ${a} of each beat through the emit command.`,
    prompt: rolePrompt(ctx, a),
  }]));
}
export function directorPrompt(ctx) {
  return fill(read('director.md'), vars(ctx)) + '\n';
}
function repairPrompt(ctx, problems) {
  return `${fill(read('director.md'), vars(ctx))}

## This is a repair run

The plan (beats.json) is already written and the crew has worked on it, but the gate failed:
${problems.slice(0, 30).map((p) => `- ${p}`).join('\n')}

Do not plan again. Start at Step 2 if beats are missing lines (the crew resumes at the open beat),
otherwise fix the rest as Step 3 says. Then run \`${ctx.emit} --check\` and stop.
`;
}

// ---------------------------------------------------------------------------------------------
// Muse

export const museBin = (o = {}) => resolve(o.muse ?? process.env.MUSE_BIN ?? join(homedir(), '.local/bin/muse'));
const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
/** [command, args] for the Muse binary (a .js stand-in runs on this node). */
const museCmd = (bin, args) => (bin.endsWith('.js') ? [process.execPath, [bin, ...args]] : [bin, args]);

/** `muse --version` -> "1.4.14 (1.4.14-R7309.1)". */
function museVersion(bin) {
  const r = spawnSync(...museCmd(bin, ['--version']), { encoding: 'utf8', timeout: 30000 });
  return (r.stdout || '').trim().replace(/^Muse Code\s*/i, '') || null;
}

/** Sum model usage over a session and its subagents; attribute subagents to crew roles. */
export function sessionUsage(id) {
  const dir = sessionDir(id);
  if (!dir) return null;
  const add = (a, u) => { for (const [k, v] of Object.entries(u ?? {})) if (typeof v === 'number') a[k] = (a[k] ?? 0) + v; };
  const scan = (file) => {
    const usage = { calls: 0 };
    let role = null, model = null;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      if (!role) { const m = /Musical Bots crew role: ([a-z]+)/.exec(line); if (m) role = m[1]; }
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const ev = r.payload?.event;
      if (ev?.kind === 'model_completed') { add(usage, ev.usage); usage.calls++; }
      model ??= r.payload?.record?.model_id ?? null;
    }
    return { usage, role, model };
  };
  const parent = scan(join(dir, 'session.jsonl'));
  const children = [];
  const sub = join(dir, 'subagent');
  if (existsSync(sub)) for (const c of readdirSync(sub)) {
    const f = join(sub, c, 'session.jsonl');
    if (existsSync(f)) children.push({ id: c, ...scan(f) });
  }
  return { dir, parent, children };
}

/** The model catalog's USD price per million tokens for a model, if Muse cached it. */
function priceOf(model) {
  try {
    const dir = join(dataHome(), 'muse/model-catalog');
    for (const f of readdirSync(dir)) {
      const row = JSON.parse(readFileSync(join(dir, f), 'utf8')).rows?.find((r) => r.model_id === model);
      if (row?.cost) return { input: Number(row.cost.input), output: Number(row.cost.output), cached: Number(row.cost.cached), currency: row.cost.currency ?? 'USD' };
    }
  } catch { /* no catalog */ }
  return null;
}
const defaultModel = () => {
  try { return JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'muse/settings.json'), 'utf8')).model ?? null; } catch { return null; }
};

/**
 * One headless Muse run: the director prompt + the crew overlay. Streams progress to log().
 * Resolves { exit, wallSeconds, sessionId, model, usage (Muse's own run.usage, director only), text }.
 */
function runMuse({ kind, promptText, overlay, work, emit, opts, log }) {
  const scratch = join(work, '.director');
  const promptFile = join(scratch, `${kind}-prompt.md`);
  writeFileSync(promptFile, promptText);
  const args = ['exec', '--json', '--prompt-file', promptFile, '--workspace', work, '--trust-workspace',
    '--approval-mode', 'never', '--no-foreign-personal-context', ...(opts.web ? [] : ['--disable-web-tools']), '--disable-reminders',
    '--reasoning-effort', opts.directorEffort,
    '-c', `run.toolset=${JSON.stringify(opts.web ? [...TOOLSET, ...WEB_TOOLS] : TOOLSET)}`,
    '-c', 'run.context_slimming.meta_context_note_enabled=false',
    '--agents', JSON.stringify(overlay)];
  if (opts.model) args.push('--model', opts.model);
  if (opts.provider) args.push('--provider', opts.provider);
  const bin = museBin(opts);
  const t0 = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(...museCmd(bin, args), {
      cwd: work,
      // MB_REPO: the project, read-only (--no-repo leaves it out); GIT_OPTIONAL_LOCKS=0: a git look never takes the index lock
      env: { ...process.env, MB_DIRECTOR_DIR: work, MB_EMIT: emit, ...(opts.repo ? { MB_REPO: REPO, GIT_OPTIONAL_LOCKS: '0' } : {}), PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // its own process group: a stop reaches Muse and everything it started
    });
    const raw = [];
    let buf = '', sessionId = null, model = null, text = '';
    const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 };
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        raw.push(line);
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.stream?.kind === 'session' && !sessionId) {
          sessionId = r.stream.id;
          noteSession(work, sessionId); // (the LIVE making-of reads the crew's activity from it as the run goes: live.js)
        }
        const p = r.payload ?? {};
        if (r.payload_type === 'run.model.configured') model ??= p.model_id;
        if (r.payload_type === 'run.usage') for (const m of p.models ?? []) for (const k of Object.keys(usage)) usage[k] += m[k] ?? 0;
        if (r.payload_type === 'run.terminal.completed' && p.text) text = p.text;
        if (r.payload_type === 'tool.result' && /"status":"launched"/.test(p.text ?? '')) log('workflow launched: the crew is at work');
      }
    });
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    const kill = (why) => {
      log(`${why}: stopping Muse`);
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    };
    const timer = setTimeout(() => kill(`timeout after ${opts.timeout}s`), opts.timeout * 1000);
    // the watchdog: a crew that stops appending (a dead or lost agent holds a beat) is stopped, and
    // the repair run resumes it at the open beat
    let lastCount = -1, lastChange = Date.now();
    const watch = setInterval(() => {
      if (!existsSync(join(work, 'beats.json'))) { lastChange = Date.now(); return; }
      let n = lastCount;
      try { n = readEvents(work).length; } catch { /* mid-write */ }
      if (n !== lastCount) { lastCount = n; lastChange = Date.now(); return; }
      const quiet = (Date.now() - lastChange) / 1000;
      // a crew that stops appending: stalled (stop it; the repair run resumes it), or finished with
      // an agent idling on (the episode passes the gate: stop waiting for it)
      if (quiet > opts.settle && checkBundle(work).ok) kill(`the episode passes the gate and the crew is quiet for ${opts.settle}s`);
      else if (quiet > opts.stall) kill(`no event for ${opts.stall}s`);
    }, 2000);
    const onSignal = () => kill('interrupted');
    process.once('SIGINT', onSignal);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(watch);
      process.removeListener('SIGINT', onSignal);
      writeFileSync(join(scratch, `${kind}-muse.jsonl`), raw.join('\n') + '\n');
      writeFileSync(join(scratch, `${kind}-muse.err`), err);
      resolveRun({ kind, exit: code ?? signal, wallSeconds: Math.round((Date.now() - t0) / 100) / 10, sessionId, model, usage, text: text.slice(0, 500),
        stderr: err.split('\n').filter((l) => l.trim() && !/invalid skill package|Run `muse skills|skills_catalog|Skills:/.test(l)).slice(-5) });
    });
    child.on('error', (e) => { clearTimeout(timer); clearInterval(watch); process.removeListener('SIGINT', onSignal); resolveRun({ kind, exit: 'spawn-error', error: e.message, wallSeconds: 0, sessionId: null, model: null, usage, text: '' }); });
  });
}

/** Print the crew's events as they land (the console making-of). */
function follow(work, log) {
  let seen = 0;
  const tick = () => {
    let events = [];
    try { events = readEvents(work); } catch { return; }
    for (const e of events.slice(seen)) log(`${String(e.t).padStart(6)}s ${e.bot.padEnd(7)} ${e.beat.padEnd(16)} ${e.lyric ? `♪ ${e.lyric}` : `${e.summary}${e.action ? ` [${e.action}]` : ''}`}`);
    seen = events.length;
  };
  const id = setInterval(tick, 1000);
  return () => { clearInterval(id); tick(); };
}

// ---------------------------------------------------------------------------------------------
// The run

const TIERS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** An effort tier, raised to a floor ("low" at least "high" is "high"; "max" stays "max"). */
export const atLeast = (e, floor) => (TIERS.indexOf(e) >= TIERS.indexOf(floor) ? e : floor);

/** Direct one episode. Returns { ok, out, gate, provenance }. */
export async function direct(prompt, o = {}) {
  const opts = { effort: 'low', timeout: 1500, stall: 240, settle: 75, repairs: 1, web: true, repo: true, craft: 'strict', ...o };
  if (!MODES.includes(opts.craft)) throw new Error(`--craft: one of ${MODES.join(', ')}`);
  // the story is made in two places: the plan (one director session) and Green's lines; they think
  // harder by default, the six other roles place cues at low effort
  // (measured: high costs about the same tokens as medium; Green's lines and the plan read clearly better)
  opts.lyricsEffort ??= atLeast(opts.effort, 'high');
  opts.directorEffort ??= atLeast(opts.effort, 'high');
  const log = opts.log ?? ((m) => process.stderr.write(`[direct] ${m}\n`));
  const slug = opts.slug ?? curatedSlug(prompt) ?? slugify(prompt);
  const out = resolve(opts.out ?? join(REPO, opts.live ? 'episodes/live' : 'episodes', slug));
  const inPlace = Boolean(opts.live || opts.inPlace);
  if (inPlace) rmSync(out, { recursive: true, force: true });
  const work = inPlace ? out : mkdtempSync(join(tmpdir(), `mb-direct-${slug}-`));
  mkdirSync(join(work, '.director'), { recursive: true });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  initState(work, { prompt, slug, seed: `muse-${slug}`, t0, craft: opts.craft });
  const emit = join(work, '.director', 'emit');
  writeFileSync(emit, `#!/bin/sh\nexec "${process.execPath}" "${EMIT_JS}" --dir "${work}" "$@"\n`);
  chmodSync(emit, 0o755);
  const crew = ROLES.map((a) => ({ agent: a, bot: AGENT_BOT[a], agentType: agentType(a), ...(a === 'lyrics' && opts.lyricsEffort !== opts.effort ? { effort: opts.lyricsEffort } : {}) }));
  const args = { emit, brief: prompt, effort: opts.effort, crew };
  // the run's own copy of the crew workflow, its args baked in (a director may pass them as a string)
  const workflow = join(work, '.director', 'workflow.js');
  writeFileSync(workflow, readFileSync(WORKFLOW_JS, 'utf8').replace('const BAKED = {};', `const BAKED = ${JSON.stringify(args)};`));
  const ctx = { prompt, slug, emit, workflow, args, brief: opts.brief ? resolve(opts.brief) : undefined, web: opts.web, repo: opts.repo ? REPO : undefined };
  const overlay = crewOverlay(ctx);
  writeFileSync(join(work, '.director', 'agents.json'), JSON.stringify(overlay, null, 1));
  writeFileSync(join(work, '.director', 'director-prompt.md'), directorPrompt(ctx));
  if (opts.dryRun) {
    log(`dry run: prompts and the crew overlay are in ${join(work, '.director')}`);
    return { ok: true, dry: true, out, work, overlay, directorPrompt: directorPrompt(ctx) };
  }
  const muse = { bin: museBin(opts), version: museVersion(museBin(opts)) };
  log(`${prompt} -> ${out}${inPlace ? '' : ` (working in ${work})`}; Muse Code ${muse.version ?? '?'}, effort ${opts.effort} (director ${opts.directorEffort}, lyrics ${opts.lyricsEffort})`);
  const stop = follow(work, log);
  const runs = [await runMuse({ kind: 'direct', promptText: directorPrompt(ctx), overlay, work, emit, opts, log })];
  finalize(work); // the crew is done: what is queued for the open beat lands
  let gate = checkBundle(work);
  for (let r = 0; !gate.ok && r < opts.repairs && readBeats(work) && runs.at(-1).exit !== 'spawn-error'; r++) {
    log(`gate failed (${gate.problems.length} problems): repair run ${r + 1}`);
    reopenCrew(work);
    runs.push(await runMuse({ kind: `repair${r + 1}`, promptText: repairPrompt(ctx, gate.problems), overlay, work, emit, opts, log }));
    finalize(work);
    gate = checkBundle(work);
  }
  stop();
  const activity = recordActivity({ runs, work, t0, log });
  const provenance = provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0, activity });
  writeFileSync(join(work, 'director.json'), JSON.stringify(provenance, null, 2) + '\n');
  log(gate.ok ? `GATE OK: ${gate.stats.events} events, ${gate.stats.lines} lines, ${gate.stats.consultations} consultations (${gate.stats.consult ? `${gate.stats.consult.complete} complete, ${gate.stats.consult.moves} lines, ${gate.stats.consult.followups} with a follow-up, ${gate.stats.consult.applied} applied` : `${gate.stats.answers} answered`}), ${gate.stats.bypasses.length} craft bypasses; ${provenance.wallSeconds}s, ${provenance.usage.total.input_tokens} input tokens, ~$${provenance.cost?.usd ?? '?'}`
    : `GATE FAILED:\n${gate.problems.map((p) => `  - ${p}`).join('\n')}`);
  if (!inPlace && gate.ok) {
    mkdirSync(out, { recursive: true });
    const files = BUNDLE_FILES.filter((f) => existsSync(join(work, f)));
    if (!files.includes(ACTIVITY_FILE)) rmSync(join(out, ACTIVITY_FILE), { force: true }); // (an older run's log is not this one's)
    for (const f of files) copyFileSync(join(work, f), join(out, `${f}.tmp`));
    for (const f of files) renameSync(join(out, `${f}.tmp`), join(out, f));
  }
  if (gate.ok && !opts.keep) rmSync(join(work, '.director'), { recursive: true, force: true });
  if (gate.ok && !inPlace && !opts.keep) rmSync(work, { recursive: true, force: true });
  else if (!gate.ok) log(`the failed run is kept in ${work}`);
  return { ok: gate.ok, out, work, gate, provenance };
}

/**
 * The production's activity log (activity.js): what the director and the crew really did and when, from Muse's
 * session logs (the director's and each crew subagent's tool calls) and the emit tool's own log, sanitized;
 * written to the bundle (activity.ndjson) for the making-of to sing. An entry that still looks like a local path or
 * a secret is dropped. Returns the log, or null when nothing could be recorded.
 */
function recordActivity({ runs, work, t0, log }) {
  try {
    const sessions = runs.flatMap((r) => (r.sessionId ? sessionTexts(sessionDir(r.sessionId)) : []));
    const attempts = readAttempts(work);
    let list = activityOf({ sessions, attempts, events: readEvents(work), t0 });
    list = list.filter((e) => !activityProblems([e]).some((p) => /local path|secret/.test(p)));
    if (!list.length) return null;
    const bad = activityProblems(list, { events: readEvents(work) });
    if (bad.length) { log(`activity log not written: ${bad.slice(0, 3).join('; ')}`); return null; }
    writeActivity(work, list);
    log(`activity: ${list.length} entries (${sessions.length} session logs, ${attempts?.length ?? 0} gate calls)`);
    return list;
  } catch (err) {
    log(`activity log not written: ${err.message}`);
    return null;
  }
}
const countBy = (list, k) => list.reduce((m, e) => ({ ...m, [e[k]]: (m[e[k]] ?? 0) + 1 }), {});

/** A repair run resumes the crew: nobody is done any more. */
function reopenCrew(work) {
  const p = join(work, '.director/state.json');
  const s = readState(work);
  if (!s) return;
  s.done = {};
  writeFileSync(p, JSON.stringify(s, null, 1));
}

function provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0, activity = null }) {
  const events = readEvents(work);
  const sessions = runs.map((r) => ({ run: r, s: r.sessionId ? sessionUsage(r.sessionId) : null }));
  const zero = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 });
  const add = (a, u) => { for (const k of Object.keys(a)) a[k] += u?.[k] ?? 0; return a; };
  const director = zero(), crew = zero(), perRoleUsage = {};
  for (const { run, s } of sessions) {
    if (!s) { add(director, run.usage); continue; }
    add(director, s.parent.usage);
    for (const c of s.children) {
      if (!c.role) { add(director, c.usage); continue; } // Muse's own helpers (titles, reminders)
      add(crew, c.usage);
      perRoleUsage[c.role] = add(perRoleUsage[c.role] ?? zero(), c.usage);
    }
  }
  const total = add(add(zero(), director), crew);
  const model = runs.find((r) => r.model)?.model ?? opts.model ?? defaultModel();
  const price = model ? priceOf(model) : null;
  const usd = price ? ((total.input_tokens - total.cached_tokens) * price.input + total.cached_tokens * price.cached + total.output_tokens * price.output) / 1e6 : null;
  const perRole = Object.fromEntries(ROLES.map((r) => [r, { bot: AGENT_BOT[r], events: events.filter((e) => e.agent === r).length, lines: events.filter((e) => e.agent === r && e.lyric).length, ...(perRoleUsage[r] ? { usage: perRoleUsage[r] } : {}) }]));
  const state = readState(work);
  return {
    director: 'Muse Code (Meta), headless: a director session + a Workflow of 7 role subagents (scripts/director)',
    muse: { version: muse.version, provider: opts.provider ?? 'meta', model, effort: opts.effort, lyricsEffort: opts.lyricsEffort, directorEffort: opts.directorEffort, web: Boolean(opts.web), repo: Boolean(opts.repo), contributorMode: model ? /contributor/.test(model) : null },
    prompt, slug, startedAt, wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    makingOfSeconds: events.at(-1)?.t ?? 0,
    runs: runs.map((r, i) => ({ kind: r.kind, exit: r.exit, wallSeconds: r.wallSeconds, sessionId: r.sessionId, subagents: sessions[i].s?.children.filter((c) => c.role).length ?? null, ...(r.stderr?.length && r.exit !== 0 ? { stderr: r.stderr } : {}) })),
    usage: { director, crew, total },
    cost: usd !== null ? { usd: Math.round(usd * 10000) / 10000, basis: `${model} at $${price.input}/M input, $${price.cached}/M cached, $${price.output}/M output (Muse's model catalog); an estimate` } : null,
    perRole,
    events: events.length, lines: events.filter((e) => e.lyric).length,
    consultations: events.filter((e) => e.status === 'consulting' && e.consult?.length).length,
    answers: events.filter((e) => e.answers !== undefined).length,
    ...(gate.stats?.consult ? { consult: gate.stats.consult } : {}),
    turnstile: state ? { rejected: state.rejected ?? 0, queued: state.queued ?? 0 } : null,
    activity: activity ? { file: ACTIVITY_FILE, entries: activity.length, byWho: countBy(activity, 'who'), byKind: countBy(activity, 'kind') } : null,
    craft: {
      mode: state?.craft?.mode ?? opts.craft,
      bypasses: gate.stats?.bypasses ?? [],
      accepted: state?.craft?.accepted ?? {},
      counts: state?.craft?.counts ?? {},
    },
    gate: { ok: gate.ok, problems: gate.problems },
  };
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const o = { positional: [] };
  const valued = new Set(['--brief', '--slug', '--out', '--effort', '--lyrics-effort', '--director-effort', '--model', '--provider', '--muse', '--timeout', '--stall', '--settle', '--repairs', '--only', '--skip', '--craft']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.has(a)) o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (a === '--live') o.live = true;
    else if (a === '--all') o.all = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--no-web') o.web = false;
    else if (a === '--no-repo') o.repo = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.positional.push(a);
  }
  for (const k of ['timeout', 'stall', 'settle', 'repairs']) if (o[k] !== undefined) o[k] = Number(o[k]);
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.all && !o.positional.length)) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return o.help ? 0 : 1;
  }
  if (o.all) {
    const root = resolve(o.out ?? join(REPO, 'episodes'));
    const results = [];
    const pick = (v) => (typeof v === 'string' ? new Set(v.split(',').map((x) => x.trim())) : null);
    const only = pick(o.only), skip = pick(o.skip);
    for (const [slug, prompt] of SEEDS) {
      if ((only && !only.has(slug)) || skip?.has(slug)) continue;
      const r = await direct(prompt, { ...o, slug, out: join(root, slug), live: false });
      const p = r.provenance;
      results.push({ slug, ok: r.ok, title: readBeats(r.ok ? join(root, slug) : r.work)?.title ?? null, events: r.gate?.stats?.events, wall: p?.wallSeconds, usd: p?.cost?.usd, problems: r.ok ? undefined : r.gate?.problems?.slice(0, 5) });
      console.error(`[direct] ${slug}: ${r.ok ? 'OK' : 'FAILED'} ${JSON.stringify(results.at(-1))}`);
    }
    console.log(JSON.stringify(results, null, 1));
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const r = await direct(o.positional.join(' '), o);
  console.log(JSON.stringify({ ok: r.ok, out: r.out, events: r.gate?.stats?.events ?? null, wallSeconds: r.provenance?.wallSeconds ?? null, usd: r.provenance?.cost?.usd ?? null }));
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
