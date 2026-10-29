#!/usr/bin/env node
// A stand-in for `muse exec --json` in the tests (no model, no network, no cost): it plays the
// director and the seven crew agents with the fixture episode (fixture.js), through the real emit
// command, the crew as seven concurrent processes, so the turnstile, the atomic appends, the gate and
// the orchestrator's JSONL parsing all run for real. It checks the call carries the crew overlay.
//   STUB_MUSE_STALL=<n>   Teddy stops after n stanzas (the gate fails; a repair run resumes him)
//   STUB_MUSE_DELAY_MS    pause between a role's calls (default 30)
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAN, LINES, CUES } from './fixture.js';
import { ROLES, beatId, agentType } from './vocab.js';

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

async function role(agent) {
  emit(['--status', '--as', agent]);
  const stall = process.env.STUB_MUSE_STALL ? Number(process.env.STUB_MUSE_STALL) : Infinity;
  const repair = process.env.STUB_MUSE_REPAIR === '1';
  if (agent === 'lyrics') {
    for (let i = 0; i < LINES.length; i++) {
      if (!repair && i >= stall) return; // stalls: no --done, the gate finds the open beat
      const r = emit(['--as', 'lyrics'], LINES[i].map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l })));
      if (r.code !== 0 && !/is closed|already has its/.test(r.text)) { console.error(`stub lyrics: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  } else {
    for (const c of CUES[agent] ?? []) {
      const { beat, ...rest } = c;
      const r = emit(['--as', agent], { agent, beat: beatId(beat - 1), ...rest });
      if (r.code !== 0 && !/is closed/.test(r.text)) { console.error(`stub ${agent}: ${r.text}`); process.exit(2); }
      await sleep(delay);
    }
  }
  emit(['--done', agent]);
}

async function exec(argv) {
  const overlay = JSON.parse(argv[argv.indexOf('--agents') + 1] ?? '{}');
  const missing = ROLES.map(agentType).filter((t) => !overlay[t]?.prompt);
  if (missing.length) { console.error(`stub muse: the crew overlay lacks ${missing.join(', ')}`); return 3; }
  const promptFile = argv[argv.indexOf('--prompt-file') + 1];
  const repair = /This is a repair run/.test(readFileSync(promptFile, 'utf8'));
  out('run.model.configured', { model_id: 'stub-model' });
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
