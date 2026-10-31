#!/usr/bin/env node
// A stand-in for `muse exec --json` in the tests (no model, no network, no cost): it plays the
// director and the seven crew agents with the fixture episode (fixture.js), through the real emit
// command, the crew as seven concurrent processes, so the turnstile, the atomic appends, the gate and
// the orchestrator's JSONL parsing all run for real. It checks the call carries the crew overlay.
//   STUB_MUSE_STALL=<n>   Green stops after n stanzas (the gate fails; a repair run resumes him)
//   STUB_MUSE_DELAY_MS    pause between a role's calls (default 30)
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAN, LINES, CUES, GREEN_STEPS, stepEvents } from './fixture.js';
import { ROLES, beatId, agentType } from './vocab.js';
import { readEvents, readState } from './emit.js';
import { threadsOf } from '../../web/src/consultation.js';

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

const BOT = { lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue', deals: 'Gold', hype: 'Yellow', comedy: 'Pink' };
const openBeat = (text) => { const m = /OPEN BEAT: beat-(\d+)-/.exec(text); return m ? Number(m[1]) : 1; };

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
    if (step.step === 'open' && [...threadsOf(sent).values()].some((t) => t.asker === me && t.host === other)) return;
    if (step.step !== 'open' && sent.some((e) => e.bot === me && e.move === step.moves[0][0] && e.summary === step.moves[0][1])) return;
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
  } else board = emit(['--status', '--as', agent]).text;
  let beat = Math.max(step.beat, openBeat(board));
  for (let tries = 0; tries < 20; tries++) {
    const r = emit(['--as', agent], stepEvents(step, agent, beatId(beat - 1)));
    if (r.code === 0) return;
    const at = /is at beat-(\d+)-\S+ already/.exec(r.text);
    if (at) { beat = Number(at[1]); continue; }
    if (/is closed/.test(r.text)) { beat = openBeat(r.text); continue; }
    console.error(`stub ${agent} ${step.step} ${other}: ${r.text}`);
    process.exit(2);
  }
}

async function role(agent) {
  emit(['--status', '--as', agent]);
  const stall = process.env.STUB_MUSE_STALL ? Number(process.env.STUB_MUSE_STALL) : Infinity;
  const repair = process.env.STUB_MUSE_REPAIR === '1';
  if (agent === 'lyrics') {
    for (let i = 0; i < LINES.length; i++) {
      if (!repair && i >= stall) return; // stalls: no --done, the gate finds the open beat
      for (const step of GREEN_STEPS[i] ?? []) await consultStep(agent, step);
      const r = emit(['--as', 'lyrics'], LINES[i].map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l })));
      if (r.code !== 0 && !/is closed|already has its/.test(r.text)) { console.error(`stub lyrics: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  } else {
    for (const c of CUES[agent] ?? []) {
      if (c.step) { await consultStep(agent, c); continue; }
      const { beat, ...rest } = c;
      const r = emit(['--as', agent], { agent, beat: beatId(beat - 1), ...rest });
      if (r.code !== 0 && !/is closed/.test(r.text)) { console.error(`stub ${agent}: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  }
  for (let k = 0; k < 4 && /NOT YET/.test(emit(['--done', agent]).text); k++); // reminded: done
}

async function exec(argv) {
  const overlay = JSON.parse(argv[argv.indexOf('--agents') + 1] ?? '{}');
  const missing = ROLES.map(agentType).filter((t) => !overlay[t]?.prompt);
  if (missing.length) { console.error(`stub muse: the crew overlay lacks ${missing.join(', ')}`); return 3; }
  const promptFile = argv[argv.indexOf('--prompt-file') + 1];
  const promptText = readFileSync(promptFile, 'utf8');
  const repair = /This is a repair run/.test(promptText);
  out('run.model.configured', { model_id: 'stub-model' });
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
  out('tool.result', { text: '{"status":"launched","entryId":"musical-bots-crew"}' });
  const env = { ...process.env, ...(repair ? { STUB_MUSE_REPAIR: '1' } : {}) };
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
