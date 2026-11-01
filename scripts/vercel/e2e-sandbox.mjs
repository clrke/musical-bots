#!/usr/bin/env node
// The hosted pipeline end to end in a real Vercel Sandbox (server/app.js with the sandbox runner; an in-memory store
// and mailer): one run through the same doors the page polls, until its bundle is kept and its sandbox stopped.
//   node --env-file=.env.local scripts/vercel/e2e-sandbox.mjs [--stub | --fake-key | --install]
//     --stub      (default) a rehearsal: the stub Muse plays the director and its eight agents, free
//     --fake-key  the BYOK path with a made-up key: Muse Code is installed, rejects the key, the run fails cleanly and
//                 the key shows up nowhere
//     --install   only installs Muse Code in a sandbox and prints its version
// Needs Vercel credentials: `vercel link` + `vercel env pull .env.local` (a development OIDC token, 12 h).
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Sandbox } from '@vercel/sandbox';
import { createApp, configFrom } from '../../server/app.js';
import { memoryStore } from '../../server/store.js';
import { sandboxRunner, directorFiles } from '../../server/runner.js';
import { memoryMailer } from '../../server/mail.js';

const mode = process.argv.includes('--fake-key') ? 'fake-key' : process.argv.includes('--install') ? 'install' : 'stub';
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

if (mode === 'install') {
  const sbx = await Sandbox.create({ resources: { vcpus: 2 }, timeout: 10 * 60_000, persistent: false, tags: { app: 'musical-bots-check' } });
  try {
    await sbx.writeFiles(directorFiles().map((f) => ({ path: `/vercel/mb/${f.path}`, content: f.content })));
    const r = await sbx.runCommand({ cmd: 'node', args: ['--input-type=module', '-e', "import('/vercel/mb/scripts/director/sandbox-run.js').then((m) => console.log(JSON.stringify(m.installMuse())))"], cwd: '/vercel/mb' });
    const out = JSON.parse((await r.stdout()).trim().split('\n').at(-1));
    console.log(`${at()} Muse Code install in a sandbox: ${out.ok ? 'OK' : 'FAILED'} ${out.version} (${out.bin})`, out.ok ? '' : out.log);
    process.exitCode = out.ok ? 0 : 1;
  } finally { await sbx.stop(); }
  process.exit();
}

const FAKE = 'mb-fake-key-0123456789abcdefghijklmnop';
const config = configFrom({ SESSION_SECRET: 'e2e-secret-0123456789', ADMIN_TOKEN: 'e2e-admin', MAX_CONCURRENT_RUNS: '5', RUN_TIMEOUT_MIN: '15' });
const store = memoryStore();
const runner = sandboxRunner({ timeoutMs: 17 * 60_000 });
const logs = [];
const app = createApp({ store, runner, mailer: memoryMailer(), config, log: (m) => { logs.push(m); console.error(`[app] ${m}`); } });
function call(method, url, { body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { host: 'e2e.test', 'x-forwarded-for': '203.0.113.50', ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
  return new Promise((ok) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b = '') { ok({ status: this.statusCode, headers: this.headers, body: String(b) }); } };
    app(req, res);
  });
}

const body = mode === 'stub' ? { prompt: 'Blue paints the night street gold', mode: 'rehearsal', delayMs: 250 } : { prompt: 'Blue paints the night street gold', mode: 'byok', key: FAKE };
const started = await call('POST', '/api/direct', { body, headers: mode === 'stub' ? { authorization: 'Bearer e2e-admin' } : {} });
console.log(`${at()} POST /api/direct -> ${started.status}`);
assert.equal(started.status, 202, started.body);
const run = JSON.parse(started.body);
const states = [];
let s, maxEvents = 0, maxActivity = 0, maxQueued = 0, polls = 0;
for (;;) {
  s = JSON.parse((await call('GET', run.status)).body);
  polls++;
  if (states.at(-1) !== `${s.state}/${s.phase}`) { states.push(`${s.state}/${s.phase}`); console.log(`${at()} ${s.state} (${s.phase}) events ${s.events} ${s.log.at(-1) ?? ''}`); }
  if (s.state === 'done' || s.state === 'failed') break;
  if (s.state === 'working') {
    maxEvents = Math.max(maxEvents, (await call('GET', run.events)).body.split('\n').filter(Boolean).length);
    maxQueued = Math.max(maxQueued, (await call('GET', run.queued)).body.split('\n').filter(Boolean).length);
    maxActivity = Math.max(maxActivity, (await call('GET', run.activity)).body.split('\n').filter(Boolean).length);
  }
  if (Date.now() - t0 > 16 * 60_000) throw new Error('the run took too long');
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`${at()} over: ${s.state}; ${polls} status polls; seen while working: ${maxEvents} events, ${maxQueued} queued, ${maxActivity} activity entries`);
console.log('log:', s.log);
const list = await runner.list();
const mine = list.find((r) => r.runId === run.slug);
console.log(`${at()} the run's sandbox: ${mine ? (mine.running ? 'STILL RUNNING' : 'stopped') : 'not listed'}`);
assert.ok(!mine?.running, 'the sandbox is stopped once the run is over');
const everything = JSON.stringify([s, await Promise.all((await store.list('')).map(async (k) => (await store.get(k)).value)), logs]);
assert.ok(!everything.includes(FAKE), 'the key is nowhere');
if (mode === 'stub') {
  assert.equal(s.state, 'done', JSON.stringify(s.log));
  assert.ok(states.some((x) => x.startsWith('working')), 'seen at work');
  const dir = mkdtempSync(join(tmpdir(), 'mb-e2e-'));
  for (const f of ['events.ndjson', 'beats.json', 'director.json', 'activity.ndjson']) writeFileSync(join(dir, f), (await call('GET', `/api/direct/${run.slug}/${f}`)).body);
  execFileSync(process.execPath, [new URL('../validate-bundle.js', import.meta.url).pathname, dir], { stdio: 'inherit' });
  console.log(`${at()} E2E OK (stub Muse in a Vercel Sandbox): ${s.events} events, title "${s.title}", gate ${s.director?.gate?.ok}, bundle valid (${dir})`);
} else {
  assert.equal(s.state, 'failed', 'a made-up key fails the run');
  assert.ok(s.log.some((l) => /Muse Code .* installed/.test(l)), 'Muse Code was installed in the sandbox');
  assert.match(String(s.reason), /^Muse Code: .*(reject|authenticat)/i, `the page is told why: ${s.reason}`);
  console.log(`${at()} E2E OK (BYOK path, made-up key): Muse installed, the run failed cleanly ("${s.reason}"), the key appears nowhere`);
}
