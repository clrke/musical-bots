#!/usr/bin/env node
// A stand-in for `muse exec --json` in the tests (no model, no network, no cost): it plays the
// director and the eight crew agents with the fixture episode (fixture.js), through the real emit
// command, the crew as eight concurrent processes, so the turnstile, the atomic appends, the gate and
// the orchestrator's JSONL parsing all run for real. It checks the call carries the crew overlay.
//   STUB_MUSE_STALL=<n>   Green stops after n stanzas (the gate fails; a repair run resumes him)
//   STUB_MUSE_STALL_STICKY=1  ... and stops there again when the host starts him again (a test that needs the gate to fail)
//   STUB_MUSE_DELAY_MS    pause between a role's calls (default 30)
//   STUB_MUSE_NO_SHELL=1  the host can't run Muse's shell sandbox (a Vercel Sandbox: no usable bubblewrap): unless the
//                         call has --disable-sandbox, every bash call fails as Muse 1.4.14's does there, and the
//                         director ends its turn, exit 0, with no plan
//   STUB_MUSE_REFUSALS=<n>  a busy crew that gets nowhere for a while: before his stanza STUB_MUSE_REFUSE_AT (default 0)
//                         Green sends n lines the gate refuses (future tense), STUB_MUSE_REFUSAL_MS apart (default 500),
//                         unless his run carries the nudge about them (a repair after the watchdog stopped the crew)
// It also plays the crew as the host runs it (direct.js --crew processes): a prompt that is one crew member's
// definition and task ("## Your task now") plays that role alone; a director prompt that hands the plan over
// ("Step 2: hand the plan to the crew") only plans; a director's fix run (no overlay) only checks.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAN, LINES, CUES, GREEN_STEPS, TROUBLE_MARKS, stepEvents } from './fixture.js';
import { ROLES, beatId, agentType } from './vocab.js';
import { readEvents, readState } from './emit.js';
import { threadsOf } from '../../web/src/consultation.js';
import { troublesOf } from '../../web/src/plot-trouble.js';

const SELF = fileURLToPath(import.meta.url);
const EMIT = process.env.MB_EMIT;
const delay = Number(process.env.STUB_MUSE_DELAY_MS ?? 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (payload_type, payload, sid = 'stub-session') => console.log(JSON.stringify({ stream: { kind: 'session', id: sid }, payload_type, payload }));

/** One emit call with retries on WAIT; returns { code, text }. */
function emit(args, input) {
  for (let tries = 0; tries < 200; tries++) {
    const r = spawnSync(EMIT, args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8' });
    if (r.status !== 75) return { code: r.status, text: r.stdout + r.stderr };
  }
  return { code: 75, text: 'gave up waiting' };
}

const BOT = { lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue', deals: 'Gold', hype: 'Yellow', comedy: 'Pink', trouble: 'Black' };
/** Green's stanza i with the plot's trouble marked (fixture.js TROUBLE_MARKS: the n-th problem's consultation id). */
function marked(i) {
  const dir = process.env.MB_DIRECTOR_DIR;
  const ids = [...troublesOf([...readEvents(dir), ...(readState(dir)?.queue ?? []).map((q) => q.e)]).keys()];
  return LINES[i].map((l, k) => {
    const m = TROUBLE_MARKS[i]?.[k];
    return m && ids[m[1] - 1] ? { ...l, [m[0]]: ids[m[1] - 1] } : l;
  });
}
const openBeat = (text) => { const m = /OPEN BEAT: beat-(\d+)-/.exec(text); return m ? Number(m[1]) : 1; };
/** The role's script steps (its consultations' openings, replies and closings). */
const stepsOf = (agent) => (agent === 'lyrics' ? Object.values(GREEN_STEPS).flat() : (CUES[agent] ?? []).filter((c) => c.step));
/** The consultation lines this role has sent ("Pink:ack:Ooh, a fun question"): a reply sends the rest. */
const said = new Set();
const keyOf = (other, [move, summary]) => `${other}:${move}:${summary}`;

/**
 * An emit call of the role's own work, as a crew agent makes it: when the tool says a crewmate asked it a question
 * (a host takes it in its very next call: emit.js ackProblems), it sends its ok and ack first (from its reply step
 * for that crewmate), then the call again; when its last question still waits for its answer (one question at a
 * time), it waits and sends it again.
 */
async function send(agent, args, input) {
  for (let tries = 0; ; tries++) {
    const r = emit(args, input);
    if (r.code === 0 || tries > 600) return r;
    const asked = [...r.text.matchAll(/(\w+) asked you a question \((c\d+)\)/g)].map((m) => m[1]);
    if (asked.length) { for (const a of asked) await ackFirst(agent, a); continue; }
    if (/still waits for its answer/.test(r.text)) { await sleep(50); continue; }
    // (its third call with no consultation opened yet, as the tool counts them: answering an early question first
    // costs calls the script does not plan for, so a slow host hits it; the role opens its next one now, as an
    // agent would, at the open beat, then sends the call again)
    if (/opened no consultation yet/.test(r.text) && !input?.some?.((e) => e.move === 'ask')) {
      const next = stepsOf(agent).find((s) => s.step === 'open' && s.moves.some((m) => !said.has(keyOf(s.to, m))));
      if (next) { await sendStep(agent, { ...next, beat: 0, moves: next.moves.filter((m) => !said.has(keyOf(next.to, m))) }); continue; }
    }
    return r;
  }
}

/** The host's ok and ack to `asker`, at once (its reply step's first lines; the rest goes with the step). */
async function ackFirst(agent, asker) {
  const step = stepsOf(agent).find((s) => s.step === 'reply' && s.from === asker && s.moves.some((m) => m[0] === 'ack' && !said.has(keyOf(asker, m))));
  if (!step) { console.error(`stub ${agent}: no ack for ${asker}`); process.exit(2); }
  const moves = step.moves.slice(0, step.moves.findIndex((m) => m[0] === 'ack') + 1).filter((m) => !said.has(keyOf(asker, m)));
  await sendStep(agent, { ...step, moves, extra: {} });
}

/** A step's events sent for its beat, or the open beat, or the thread's last beat, whichever is latest. */
async function sendStep(agent, step) {
  const other = step.to ?? step.from;
  let beat = Math.max(step.beat, openBeat(emit(['--status', '--as', agent]).text));
  for (let tries = 0; tries < 20; tries++) {
    const r = await send(agent, ['--as', agent], stepEvents(step, agent, beatId(beat - 1)));
    if (r.code === 0) { for (const m of step.moves) said.add(keyOf(other, m)); return; }
    const at = /is at beat-(\d+)-\S+ already/.exec(r.text);
    if (at) { beat = Number(at[1]); continue; }
    if (/is closed/.test(r.text)) { beat = openBeat(r.text); continue; }
    console.error(`stub ${agent} ${step.step} ${other}: ${r.text}`);
    process.exit(2);
  }
}

/**
 * A consultation step (fixture.js): an opening goes out at once; a reply or a closing waits until its blackboard
 * shows its turn in that consultation (the stub's crew checks --status, as a crew agent sees it on its next call).
 * Sent for the step's beat, or the open beat, or the thread's last beat, whichever is latest. Returns false when the
 * run is a repair and the step was already done.
 */
async function consultStep(agent, step) {
  const me = BOT[agent];
  const other = step.to ?? step.from;
  if (process.env.STUB_MUSE_REPAIR === '1') {
    // a repair run resumes: a step that went out already is not sent again
    const dir = process.env.MB_DIRECTOR_DIR;
    const sent = [...readEvents(dir), ...(readState(dir)?.queue ?? []).map((q) => q.e)];
    for (const e of sent) if (e.bot === me && e.move) said.add(keyOf(e.consult?.[0], [e.move, e.summary]));
    if (step.step === 'open' && [...threadsOf(sent).values()].some((t) => t.asker === me && t.host === other)) return;
    if (step.moves.every((m) => said.has(keyOf(other, m)))) return;
  }
  const re = step.step === 'reply' ? new RegExp(`CONSULTATION (c\\d+) \\(${other} asks ${me},[^\\n]*\\n(?:      [^\\n]*\\n)*    -> YOUR TURN`)
    : new RegExp(`CONSULTATION (c\\d+) \\(${me} asks ${other},[^\\n]*\\n(?:      [^\\n]*\\n)*    -> YOUR TURN`);
  let board = '';
  if (step.step !== 'open') {
    for (let tries = 0; ; tries++) {
      board = emit(['--status', '--as', agent]).text;
      if (re.test(board)) break;
      if (tries > 1200) { console.error(`stub ${agent}: no turn for ${step.step} with ${other}\n${board}`); process.exit(2); }
      await sleep(50);
    }
  }
  // (a reply whose ok and ack went out already, when the question came in: the rest of it)
  const moves = step.moves.filter((m) => !said.has(keyOf(other, m)));
  if (moves.length) await sendStep(agent, { ...step, moves });
}

/** Lines the gate refuses (future tense), sent `n` times `ms` apart: a crew member busy and getting nowhere. */
async function refusals(agent, i, n, ms) {
  for (let k = 0; k < n; k++) {
    const r = emit(['--as', agent], { agent, beat: beatId(i), summary: `We will sing it later, take ${k + 1}`, lyric: 'We will sing it later', singer: 'Green' });
    if (r.code === 0) { console.error(`stub ${agent}: a refusal was accepted: ${r.text}`); process.exit(2); }
    await sleep(ms);
  }
}

async function role(agent) {
  emit(['--status', '--as', agent]);
  const stall = process.env.STUB_MUSE_STALL ? Number(process.env.STUB_MUSE_STALL) : Infinity;
  const repair = process.env.STUB_MUSE_REPAIR === '1';
  const refuse = process.env.STUB_MUSE_NUDGED === '1' ? 0 : Number(process.env.STUB_MUSE_REFUSALS ?? 0);
  if (agent === 'lyrics') {
    for (let i = 0; i < LINES.length; i++) {
      // stalls: no --done, the gate finds the open beat (a repair run or a restart goes on, unless the stall is sticky)
      if ((!repair || process.env.STUB_MUSE_STALL_STICKY === '1') && i >= stall) return;
      if (refuse && i === Number(process.env.STUB_MUSE_REFUSE_AT ?? 0)) await refusals(agent, i, refuse, Number(process.env.STUB_MUSE_REFUSAL_MS ?? 500));
      for (const step of GREEN_STEPS[i] ?? []) await consultStep(agent, step);
      const r = await send(agent, ['--as', 'lyrics'], marked(i).map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l })));
      if (r.code !== 0 && !/is closed|already has its/.test(r.text)) { console.error(`stub lyrics: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  } else {
    for (const c of CUES[agent] ?? []) {
      if (c.step) { await consultStep(agent, c); continue; }
      const { beat, ...rest } = c;
      // (a repair run resumes: a cue that went out already is not sent again; the tool refuses a repeat)
      if (repair && readEvents(process.env.MB_DIRECTOR_DIR).some((e) => e.bot === BOT[agent] && e.summary === c.summary)) continue;
      let r = await send(agent, ['--as', agent], { agent, beat: beatId(beat - 1), ...rest });
      // (its beat closed while it took a question first: the cue goes to the open beat, as an agent would send it)
      if (r.code !== 0 && /is closed/.test(r.text)) r = await send(agent, ['--as', agent], { agent, beat: beatId(openBeat(r.text) - 1), ...rest });
      if (r.code !== 0 && !/is closed/.test(r.text)) { console.error(`stub ${agent}: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  }
  for (let k = 0; k < 4 && /NOT YET/.test(emit(['--done', agent]).text); k++); // reminded: done
}

async function exec(argv) {
  // the kernel's cap on one argument ($MB_MAX_ARG_BYTES plays Linux's MAX_ARG_STRLEN on any OS; on
  // Linux itself the spawn already fails with E2BIG)
  const cap = Number(process.env.MB_MAX_ARG_BYTES);
  const long = cap ? argv.find((a) => Buffer.byteLength(a) + 1 > cap) : null;
  if (long) { console.error(`stub muse: E2BIG: an argument of ${Buffer.byteLength(long) + 1} bytes is over the ${cap}-byte cap`); return 5; }
  const promptFile = argv[argv.indexOf('--prompt-file') + 1];
  const promptText = readFileSync(promptFile, 'utf8');
  // (a repair run, or a crew member started again after it ended its session before --done, direct.js continueNote:
  // either goes on from where the episode is)
  const repair = /This is a repair run|You ended your last session before/.test(promptText);
  // (the gate's refusals handed to this run, direct.js nudgeLine / nudgeText: the stub's Green no longer repeats them)
  const nudged = /refused your calls again and again|the gate kept refusing/.test(promptText);
  // a crew member the host started itself (direct.js --crew processes): its definition (with the crew's rules) and its task
  const member = /^Musical Bots crew role: ([a-z]+) /.exec(promptText)?.[1];
  if (member && /\n## Your task now\n/.test(promptText)) {
    if (!ROLES.includes(member)) { console.error(`stub muse: no such crew role ${member}`); return 3; }
    if (!/^# The crew's rules/m.test(promptText)) { console.error(`stub muse: no crew rules for ${member}`); return 3; }
    if (argv.includes('--agents')) { console.error('stub muse: a crew member got the crew overlay'); return 3; }
    out('run.model.configured', { model_id: 'stub-model' }, `stub-${member}`);
    if (repair) process.env.STUB_MUSE_REPAIR = '1';
    if (nudged) process.env.STUB_MUSE_NUDGED = '1';
    await role(member);
    out('run.usage', { models: [{ model: 'stub-model', input_tokens: 500, cached_tokens: 200, output_tokens: 50, reasoning_tokens: 5, calls: 1 }] }, `stub-${member}`);
    out('run.terminal.completed', { text: `${member} is done` }, `stub-${member}`);
    return 0;
  }
  // the director when the host runs the crew: it plans and hands over (no Workflow), or fixes and checks (a repair)
  const handsOver = /\n## Step 2: hand the plan to the crew\n/.test(promptText) || (repair && !argv.includes('--agents'));
  if (!handsOver) {
    const overlay = JSON.parse(argv[argv.indexOf('--agents') + 1] ?? '{}');
    const missing = ROLES.map(agentType).filter((t) => !overlay[t]?.prompt);
    if (missing.length) { console.error(`stub muse: the crew overlay lacks ${missing.join(', ')}`); return 3; }
    // every role gets the crew's rules: in its prompt, or (a slim overlay) in the file its prompt names, as read_file reads it
    const rulesOf = (p) => (/^# The crew's rules/m.test(p) ? p : (/`([^`]*crew-rules-[a-z-]+\.md)`/.exec(p)?.[1] ?? null));
    const noRules = ROLES.map(agentType).filter((t) => {
      const r = rulesOf(overlay[t].prompt);
      return !r || (r !== overlay[t].prompt && (!existsSync(r) || !/^# The crew's rules/m.test(readFileSync(r, 'utf8'))));
    });
    if (noRules.length) { console.error(`stub muse: no crew rules for ${noRules.join(', ')}`); return 3; }
  } else if (/Workflow/.test(promptText)) {
    console.error('stub muse: a director that hands the crew over is told about the Workflow tool'); return 3;
  }
  out('run.model.configured', { model_id: 'stub-model' });
  if (process.env.STUB_MUSE_NO_SHELL === '1' && !argv.includes('--disable-sandbox')) {
    const why = "Bubblewrap candidate `/stub/muse-bin` failed --help capability validation with status exit status: 1; Bubblewrap is unavailable for linux: no capability-valid system bwrap was found on PATH and no usable embedded fallback is available; install your distribution's bwrap package";
    console.error(`muse: workspace root: ${process.env.MB_DIRECTOR_DIR} (explicit)`);
    console.error(`muse: ${why}`);
    out('tool.result', { text: `tool failed: environment failure: sandbox enforcement unavailable: ${why}\nThe execution environment is broken: the command was never started and every later command will fail the same way.` });
    out('run.terminal.completed', { text: 'Blocked at Step 1: the emit step needs bash and bash cannot run here.' });
    return 0;
  }
  // the project's repository, read-only ($MB_REPO, on unless --no-repo): the prompt offers it and its
  // git history reads from the run's shell, as a real director's `git -C "$MB_REPO" log` does
  const repo = process.env.MB_REPO;
  const offered = /## The project itself \(read-only/.test(promptText);
  if (Boolean(repo) !== offered) { console.error(`stub muse: MB_REPO ${repo ? 'set' : 'unset'} but the prompt ${offered ? 'offers' : 'lacks'} the repository`); return 4; }
  if (repo) {
    const g = spawnSync('git', ['-C', repo, 'log', '--oneline', '-1'], { encoding: 'utf8' });
    if (g.status !== 0 || !g.stdout.trim()) { console.error(`stub muse: cannot read the repository's history: ${g.stderr}`); return 4; }
    out('tool.result', { text: g.stdout.trim() });
  }
  if (!repair) {
    const r = emit(['--beats'], PLAN);
    if (r.code !== 0) { console.error(r.text); return 2; }
  }
  if (handsOver) {
    // (the plan is written, or the fixes are the crew's: the host runs the crew; a repair only checks)
    const check = repair ? spawnSync(EMIT, ['--check'], { encoding: 'utf8' }).stdout.split('\n')[0] : 'Hot Soup: the plan is handed over';
    out('run.usage', { models: [{ model: 'stub-model', input_tokens: 800, cached_tokens: 300, output_tokens: 80, reasoning_tokens: 8, calls: 1 }] });
    out('run.terminal.completed', { text: check });
    return 0;
  }
  out('tool.result', { text: '{"status":"launched","entryId":"musical-bots-crew"}' });
  const env = { ...process.env, ...(repair ? { STUB_MUSE_REPAIR: '1' } : {}), ...(nudged ? { STUB_MUSE_NUDGED: '1' } : {}) };
  const kids = ROLES.map((a) => new Promise((res) => spawn(process.execPath, [SELF, '--role', a], { env, stdio: 'inherit' }).on('close', res)));
  const codes = await Promise.all(kids);
  const check = spawnSync(EMIT, ['--check'], { encoding: 'utf8' });
  out('run.usage', { models: [{ model: 'stub-model', input_tokens: 1000, cached_tokens: 400, output_tokens: 100, reasoning_tokens: 10, calls: 2 }] });
  out('run.terminal.completed', { text: check.stdout.split('\n')[0] });
  return codes.every((c) => c === 0) ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('Muse Code 0.0.0-stub (stub)'); process.exit(0); }
if (argv[0] === '--role') await role(argv[1]);
else if (argv[0] === 'exec') process.exit(await exec(argv));
else { console.error('stub muse: usage: exec ... | --version'); process.exit(1); }
