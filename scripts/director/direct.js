#!/usr/bin/env node
// The AI director: Muse Code (Meta's agentic coding CLI, headless) directs one episode with a crew of
// seven role subagents, each its own Muse agent definition with its own prompt (director/prompts):
// Teddy/lyrics, Nora/chords, Vera/dance, Gigi/lighting, Lou/deals, Frankie/hype, Pearl/comedy.
//
//   node scripts/director/direct.js "<prompt>" [--slug x] [--out dir] [--live]
//   node scripts/director/direct.js --all [--out episodes]      the 12 curated seeds (web/src/curated.js)
//     [--only slug,slug | --skip slug,slug]                       a part of them
//   npm run direct -- "<prompt>" ...                            (the same)
// Options: --effort low|medium|high (the crew; default low), --lyrics-effort <e> and --director-effort <e>
//   (Teddy's lines and the plan; default: high and medium, or --effort when it is higher),
//   --model <id> (default: Muse's own default), --provider meta|echo, --muse <bin> ($MUSE_BIN,
//   default ~/.local/bin/muse), --timeout <s> (900), --repairs <n> (1), --keep (keep .director/),
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
//      director and every subagent, from Muse's session logs) and an estimated cost, per-role counts.
// Without --live the run works in a temp dir and replaces <out> only when the gate passes.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initState, readState, readBeats, readEvents, checkBundle, finalize, slugify } from './emit.js';
import { ROLES, SETS, STANZA, ARC, SECTIONS, NAMES, AGENT_BOT, HAND_CUES, ACTS, LIGHT_MOODS, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, roleMenu, agentType, progressionMenu, parsePrompt } from './vocab.js';
import { SEEDS, curatedSlug } from '../../web/src/curated.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PROMPTS = join(REPO, 'director/prompts');
const EMIT_JS = join(HERE, 'emit.js');
const WORKFLOW_JS = join(HERE, 'workflow.js');
export const TOOLSET = ['bash', 'read_file', 'workflow']; // the crew needs a shell for the emit command; the director the Workflow tool
const BUNDLE_FILES = ['beats.json', 'events.ndjson', 'director.json'];

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
    LIGHT_MOODS: list(LIGHT_MOODS), CHORD_SETS: chordSetsText(), HINTS: promptHints(ctx.prompt),
    MAX_LINE: String(MAX_LINE_SYLLABLES), MAX_REPLY: String(MAX_REPLY_SYLLABLES),
    MENU: agent ? list(roleMenu(agent)) : '', CAST: read('cast.md'), EXAMPLE: read('example.md'),
  };
}
/** One crew member's agent definition prompt: its role prompt + the crew's rules. */
export function rolePrompt(ctx, agent) {
  const v = vars(ctx, agent);
  const extra = `\n\n${read('cast.md')}`;
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

/** Find a Muse session's directory by id (sessions/YYYY/MM/DD/<id>). */
function sessionDir(id) {
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
    '--approval-mode', 'never', '--no-foreign-personal-context', '--disable-web-tools', '--disable-reminders',
    '--reasoning-effort', opts.directorEffort,
    '-c', `run.toolset=${JSON.stringify(TOOLSET)}`,
    '-c', 'run.context_slimming.meta_context_note_enabled=false',
    '--agents', JSON.stringify(overlay)];
  if (opts.model) args.push('--model', opts.model);
  if (opts.provider) args.push('--provider', opts.provider);
  const bin = museBin(opts);
  const t0 = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(...museCmd(bin, args), {
      cwd: work,
      env: { ...process.env, MB_DIRECTOR_DIR: work, MB_EMIT: emit, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
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
        if (r.stream?.kind === 'session') sessionId ??= r.stream.id;
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
  const opts = { effort: 'low', timeout: 900, stall: 240, settle: 75, repairs: 1, ...o };
  // the story is made in two places: the plan (one director session) and Teddy's lines; they think
  // harder by default, the six other roles place cues at low effort
  // (measured: Teddy at high costs about the same tokens as at medium and reads clearly better)
  opts.lyricsEffort ??= atLeast(opts.effort, 'high');
  opts.directorEffort ??= atLeast(opts.effort, 'medium');
  const log = opts.log ?? ((m) => process.stderr.write(`[direct] ${m}\n`));
  const slug = opts.slug ?? curatedSlug(prompt) ?? slugify(prompt);
  const out = resolve(opts.out ?? join(REPO, opts.live ? 'episodes/live' : 'episodes', slug));
  const inPlace = Boolean(opts.live || opts.inPlace);
  if (inPlace) rmSync(out, { recursive: true, force: true });
  const work = inPlace ? out : mkdtempSync(join(tmpdir(), `mb-direct-${slug}-`));
  mkdirSync(join(work, '.director'), { recursive: true });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  initState(work, { prompt, slug, seed: `muse-${slug}`, t0 });
  const emit = join(work, '.director', 'emit');
  writeFileSync(emit, `#!/bin/sh\nexec "${process.execPath}" "${EMIT_JS}" --dir "${work}" "$@"\n`);
  chmodSync(emit, 0o755);
  const crew = ROLES.map((a) => ({ agent: a, bot: AGENT_BOT[a], agentType: agentType(a), ...(a === 'lyrics' && opts.lyricsEffort !== opts.effort ? { effort: opts.lyricsEffort } : {}) }));
  const args = { emit, brief: prompt, effort: opts.effort, crew };
  // the run's own copy of the crew workflow, its args baked in (a director may pass them as a string)
  const workflow = join(work, '.director', 'workflow.js');
  writeFileSync(workflow, readFileSync(WORKFLOW_JS, 'utf8').replace('const BAKED = {};', `const BAKED = ${JSON.stringify(args)};`));
  const ctx = { prompt, slug, emit, workflow, args };
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
  const provenance = provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0 });
  writeFileSync(join(work, 'director.json'), JSON.stringify(provenance, null, 2) + '\n');
  log(gate.ok ? `GATE OK: ${gate.stats.events} events, ${gate.stats.lines} lines, ${gate.stats.consultations} consultations; ${provenance.wallSeconds}s, ${provenance.usage.total.input_tokens} input tokens, ~$${provenance.cost?.usd ?? '?'}`
    : `GATE FAILED:\n${gate.problems.map((p) => `  - ${p}`).join('\n')}`);
  if (!inPlace && gate.ok) {
    mkdirSync(out, { recursive: true });
    for (const f of BUNDLE_FILES) copyFileSync(join(work, f), join(out, `${f}.tmp`));
    for (const f of BUNDLE_FILES) renameSync(join(out, `${f}.tmp`), join(out, f));
  }
  if (gate.ok && !opts.keep) rmSync(join(work, '.director'), { recursive: true, force: true });
  if (gate.ok && !inPlace && !opts.keep) rmSync(work, { recursive: true, force: true });
  else if (!gate.ok) log(`the failed run is kept in ${work}`);
  return { ok: gate.ok, out, work, gate, provenance };
}

/** A repair run resumes the crew: nobody is done any more. */
function reopenCrew(work) {
  const p = join(work, '.director/state.json');
  const s = readState(work);
  if (!s) return;
  s.done = {};
  writeFileSync(p, JSON.stringify(s, null, 1));
}

function provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0 }) {
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
    muse: { version: muse.version, provider: opts.provider ?? 'meta', model, effort: opts.effort, lyricsEffort: opts.lyricsEffort, directorEffort: opts.directorEffort, contributorMode: model ? /contributor/.test(model) : null },
    prompt, slug, startedAt, wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    makingOfSeconds: events.at(-1)?.t ?? 0,
    runs: runs.map((r, i) => ({ kind: r.kind, exit: r.exit, wallSeconds: r.wallSeconds, sessionId: r.sessionId, subagents: sessions[i].s?.children.filter((c) => c.role).length ?? null, ...(r.stderr?.length && r.exit !== 0 ? { stderr: r.stderr } : {}) })),
    usage: { director, crew, total },
    cost: usd !== null ? { usd: Math.round(usd * 10000) / 10000, basis: `${model} at $${price.input}/M input, $${price.cached}/M cached, $${price.output}/M output (Muse's model catalog); an estimate` } : null,
    perRole,
    events: events.length, lines: events.filter((e) => e.lyric).length,
    consultations: events.filter((e) => e.status === 'consulting' && e.consult?.length).length,
    turnstile: state ? { rejected: state.rejected ?? 0, queued: state.queued ?? 0 } : null,
    gate: { ok: gate.ok, problems: gate.problems },
  };
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const o = { positional: [] };
  const valued = new Set(['--slug', '--out', '--effort', '--lyrics-effort', '--director-effort', '--model', '--provider', '--muse', '--timeout', '--stall', '--settle', '--repairs', '--only', '--skip']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.has(a)) o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (a === '--live') o.live = true;
    else if (a === '--all') o.all = true;
    else if (a === '--keep') o.keep = true;
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
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
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
