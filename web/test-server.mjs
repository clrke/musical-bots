// The hosted director's API (server/app.js: the Vercel deployment's /api/*) without Vercel, a model or email: an
// in-memory store, the local runner (scripts/director/sandbox-run.js as a child process, the stub Muse) and a mailer
// that keeps what it sends.
//   1. the probe and the guards: prompt length, modes, a pasted key's shape, cross-site posts, the admin's rehearsal;
//   2. a run with the user's own key: 202 and the live doors (status planning -> working -> done, the growing bundle,
//      what is queued, the activity), the final bundle kept (it validates), the key never stored or shown;
//   3. runs at once and run starts per IP;
//   4. sign-in by an emailed one-time code (single use, limited tries), a credit request emailed to the owner with
//      signed single-use Approve / Deny links (a confirm page first), credits spent one per run, none left -> 402;
//   5. before email is set up: sign-in says so, a request is still kept, the owner approves it on the admin page;
//   6. the production backends' error mapping, and the sandbox runner's args;
//   7. resume (a fake Vercel Sandbox): a sandbox of its own per session, seeded with the kept files; who may, how
//      often, when not (running, done, refunded), a sandbox that can't start, the runs-at-once guard;
//   8. resume end to end (the stub Muse): a run that failed with work done goes on and finishes, its events a prefix;
//   9. a crew that is busy but slow is not stopped by the stall watch.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createApp, configFrom } from '../server/app.js';
import { memoryStore, update } from '../server/store.js';
import { localRunner } from '../server/runner.js';
import { memoryMailer } from '../server/mail.js';
import { sign, verify, normalEmail, hashOf, SESSION_COOKIE } from '../server/auth.js';
import { parseNdjson } from './src/player.js';

const STUB = 'scripts/director/stub-muse.js';
const VALIDATE = new URL('../scripts/validate-bundle.js', import.meta.url).pathname;
const KEY = 'sk-test-0123456789-abcdefghij-SECRET';
const OWNER_KEY = 'owner-key-9876543210-zyxwvut';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a stand-in for Muse Image (the poster a run draws: scripts/director/poster.js): a tiny WebP for the run's key
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 9)]);
const posterCalls = [];
const museImage = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    posterCalls.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    // (Muse Spark reading the title back: chat completions; the stub crew's plan is titled Hot Soup)
    if (req.url.endsWith('/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { content: '{"title": "Hot Soup", "garbled": false}' } }] }));
    res.end(JSON.stringify({ data: [{ b64_json: WEBP.toString('base64') }], output_format: 'webp' }));
  });
});
await new Promise((ok) => museImage.listen(0, '127.0.0.1', ok));
const POSTER_BASE = `http://127.0.0.1:${museImage.address().port}/v1`;

/** runnerEnv: the runs' own environment (read at each start: a test may change it between a run and its resume). */
function appWith({ env = {}, mail = true, runnerEnv = {}, runner: given = null } = {}) {
  const store = memoryStore();
  const mailer = memoryMailer({ configured: mail });
  Object.assign(runnerEnv, { MB_EMIT_LINGER_S: '1', MB_EMIT_WAIT_S: '4', MB_POSTER_BASE: POSTER_BASE, ...runnerEnv });
  const runner = given ?? localRunner({ root: mkdtempSync(join(tmpdir(), 'mb-server-')), env: runnerEnv });
  const config = configFrom({ SESSION_SECRET: 'test-secret-0123456789', ADMIN_TOKEN: 'admin-token-xyz', OWNER_EMAIL: 'owner@example.com', MB_RUNNER_ARGS: `--muse ${STUB} --stall 90`, ...env });
  const logs = [];
  return { app: createApp({ store, runner, mailer, config, log: (m) => logs.push(m) }), store, mailer, runner, config, logs, runnerEnv };
}
function call(app, method, url, { body, headers = {}, ip = '203.0.113.7' } = {}) {
  const form = typeof body === 'string';
  const req = Readable.from(body === undefined ? [] : [Buffer.from(form ? body : JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { host: 'mb.test', 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }), ...headers } });
  return new Promise((ok) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b = '') { ok({ status: this.statusCode, headers: this.headers, body: String(b), json() { return JSON.parse(this.body); } }); } };
    app(req, res);
  });
}
const cookieOf = (r) => String(r.headers['set-cookie'] ?? '').split(';')[0];
/** Polls a run's status until it is over; returns { s, states, seen }. */
async function follow(app, run, { files = true } = {}) {
  const states = new Set();
  const seen = { queued: 0, activity: 0, events: 0 };
  let s;
  // headroom: a loaded CI runner takes 2x+ the local time for these spawn-heavy runs; the loop
  // still breaks as soon as the run is over, so this only costs wall time when genuinely stuck
  for (let i = 0; i < 1600; i++) {
    s = (await call(app, 'GET', run.status)).json();
    states.add(s.state);
    if (s.state === 'done' || s.state === 'failed') break;
    if (files && s.state === 'working') {
      const ev = await call(app, 'GET', run.events);
      assert.equal(ev.headers['cache-control'], 'no-store');
      seen.events = Math.max(seen.events, parseNdjson(ev.body).length);
      const q = await call(app, 'GET', run.queued);
      for (const e of parseNdjson(q.body)) { assert.ok(Number.isInteger(e.n) && e.beat && e.agent && e.seq === undefined, `a queued event: ${JSON.stringify(e)}`); seen.queued++; }
      seen.activity = Math.max(seen.activity, parseNdjson((await call(app, 'GET', run.activity)).body).length);
    }
    await sleep(150);
  }
  return { s, states, seen };
}
const dump = async (store) => JSON.stringify(await Promise.all((await store.list('')).map(async (k) => [k, (await store.get(k))?.value])));

// 1. the probe and the guards -----------------------------------------------------------------------
{
  const { app } = appWith();
  const p = (await call(app, 'GET', '/api/direct')).json();
  assert.deepEqual({ available: p.available, hosted: p.hosted, modes: p.modes, email: p.email, user: p.user }, { available: true, hosted: true, modes: { byok: true, credits: false }, email: true, user: null });
  assert.equal(p.limits.maxPrompt, 200);
  // Vercel's rewrite: /api/* arrives as /api/index?path=...
  assert.equal((await call(app, 'GET', '/api/index?path=direct')).json().hosted, true);
  assert.equal((await call(app, 'GET', '/api/health')).json().store, 'memory');
  const bad = async (body, code, headers) => assert.equal((await call(app, 'POST', '/api/direct', { body, headers })).status, code, JSON.stringify(body));
  await bad({ prompt: '', mode: 'byok', key: KEY }, 400);
  await bad({ prompt: 'x'.repeat(201), mode: 'byok', key: KEY }, 400);
  await bad({ prompt: 'A bot sings', mode: 'free' }, 400);
  await bad({ prompt: 'A bot sings', mode: 'byok', key: 'short' }, 400);
  await bad({ prompt: 'A bot sings', mode: 'byok', key: 'has a space in it 1234567890' }, 400);
  await bad({ prompt: 'A bot sings', mode: 'credits' }, 401);
  await bad({ prompt: 'A bot sings', mode: 'rehearsal' }, 403);
  await bad({ prompt: 'A bot sings', mode: 'byok', key: KEY }, 403, { origin: 'https://evil.example' });
  assert.equal((await call(app, 'GET', '/api/direct/..%2Fetc')).status, 400);
  assert.equal((await call(app, 'GET', '/api/direct/0123456789abcdef01234567')).status, 404, 'no such run');
  assert.equal((await call(app, 'GET', '/api/nothing')).status, 404);
  const { app: unset } = appWith({ env: { SESSION_SECRET: '' } });
  assert.equal((await call(unset, 'GET', '/api/direct')).json().available, false, 'without SESSION_SECRET the page falls back');
}

// 2. a run with the user's own key ---------------------------------------------------------------------
{
  const { app, store, logs } = appWith();
  const started = await call(app, 'POST', '/api/direct', { body: { prompt: 'Gold sells hot soup on a cold day', mode: 'byok', key: KEY } });
  assert.equal(started.status, 202, started.body);
  const run = started.json();
  assert.match(run.slug, /^[a-f0-9]{24}$/, 'the run id: 96 random bits');
  assert.equal(run.events, `/api/direct/${run.slug}/events.ndjson`);
  assert.equal(run.share, `/?run=${run.slug}`);
  const { s, states, seen } = await follow(app, run);
  assert.equal(s.state, 'done', `the run: ${JSON.stringify(s.log)}`);
  assert.ok(states.has('working'), `the status shows the crew at work (${[...states].join(' -> ')})`);
  assert.ok(seen.activity > 0 && seen.events > 0, `the bundle and the activity as the run goes (${JSON.stringify(seen)})`);
  assert.equal(s.title, 'Hot Soup');
  assert.equal(s.director.gate.ok, true);
  assert.equal(s.mode, 'byok');
  // the final bundle, kept: it validates, and stays after the run (the premiere, the share link)
  const dir = mkdtempSync(join(tmpdir(), 'mb-server-bundle-'));
  for (const f of ['events.ndjson', 'beats.json', 'director.json', 'activity.ndjson']) {
    const r = await call(app, 'GET', `/api/direct/${run.slug}/${f}`);
    assert.equal(r.status, 200, f);
    assert.match(r.headers['cache-control'], /max-age/, 'a finished run\'s files may be cached');
    writeFileSync(join(dir, f), r.body);
  }
  execFileSync(process.execPath, [VALIDATE, dir]);
  assert.equal(parseNdjson((await call(app, 'GET', run.events)).body).length, s.events);
  assert.equal((await call(app, 'GET', `/api/direct/${run.slug}/secret.txt`)).status, 404);
  // its poster: drawn by Muse Image on the run's key (here the stand-in), kept apart from the record, served as a WebP
  assert.ok(posterCalls.some((c) => c.url === '/v1/images/edits' && c.auth === `Bearer ${KEY}`), 'the poster is drawn on the run\'s key');
  assert.ok(posterCalls.some((c) => c.url === '/v1/chat/completions' && c.auth === `Bearer ${KEY}`), 'its title is read back by Muse Spark vision, on the same key');
  const poster = await call(app, 'GET', `/api/direct/${run.slug}/poster.webp`);
  assert.equal(poster.status, 200, 'the poster is served');
  assert.equal(poster.headers['content-type'], 'image/webp');
  assert.ok(poster.body.startsWith('RIFF'));
  assert.ok((await store.get(`posters/${run.slug}`))?.value?.webp, 'kept in its own key');
  assert.ok(!JSON.stringify((await store.get(`runs/${run.slug}`)).value).includes(WEBP.toString('base64')), 'not in the run record');
  assert.equal((await call(app, 'GET', '/api/direct/abcdefabcdefabcdefabcdef/poster.webp')).status, 404, 'no poster, no run: 404');
  // its share link as a link crawler sees it (middleware.js sends a crawler's /?run=<id> here): its title and poster
  const share = await call(app, 'GET', `/api/share/${run.slug}`);
  assert.equal(share.status, 200);
  assert.ok(share.body.includes(`<meta property="og:image" content="https://mb.test/api/direct/${run.slug}/poster.webp">`), share.body);
  assert.ok(share.body.includes('<meta property="og:title" content="Hot Soup · Musical Bots">'));
  assert.ok(share.body.includes(`url=https://mb.test/?run=${run.slug}`), 'then the app');
  assert.ok(!share.body.includes(KEY));
  const other = (await call(app, 'GET', '/api/share/abcdefabcdefabcdefabcdef')).body;
  assert.ok(other.includes('content="https://mb.test/episodes/why-musical-bots/poster.webp"') && other.includes('og:title" content="Musical Bots"'), 'no such run: the site\'s own preview');
  assert.ok((await call(app, 'GET', '/api/share/<script>')).body.includes('url=https://mb.test/"'), 'a bad id: the app, escaped');
  // the routing middleware (middleware.js, before the static files) sends link crawlers there, people to the app
  const { shareTarget, config: mwConfig } = await import('../middleware.js');
  assert.equal(mwConfig.matcher, '/');
  for (const bot of ['Twitterbot/1.0', 'facebookexternalhit/1.1', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'WhatsApp/2.23', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0']) {
    assert.equal(shareTarget(`https://mb.test/?run=${run.slug}`, bot), `https://mb.test/api/share/${run.slug}`, bot);
  }
  for (const person of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '']) {
    assert.equal(shareTarget(`https://mb.test/?run=${run.slug}`, person), null, person);
  }
  assert.equal(shareTarget('https://mb.test/', 'Twitterbot/1.0'), null, 'no run: the app');
  assert.equal(shareTarget('https://mb.test/?run=../etc', 'Twitterbot/1.0'), null, 'a bad id: the app');
  assert.equal(shareTarget('https://mb.test/admin?run=' + run.slug, 'Twitterbot/1.0'), null, 'only /');
  // the key: in the run's environment only, never in the store, the status, the files or the logs
  const everything = `${await dump(store)}${JSON.stringify(s)}${logs.join('\n')}`;
  assert.ok(!everything.includes(KEY), 'the pasted key is never stored, served or logged');
  assert.equal((await call(app, 'DELETE', run.status)).json().stopped, true);
  assert.equal((await call(app, 'GET', run.status)).json().state, 'done', 'a finished run stays done');
}

// 2b. the key is redacted from whatever the run writes (here: the prompt itself, in the plan and the log) -------
{
  const { app, store } = appWith();
  const run = (await call(app, 'POST', '/api/direct', { body: { prompt: `Gold sells soup ${KEY}`, mode: 'byok', key: KEY } })).json();
  const { s } = await follow(app, run, { files: false });
  const files = await Promise.all(['events.ndjson', 'beats.json', 'director.json', 'activity.ndjson'].map(async (f) => (await call(app, 'GET', `/api/direct/${run.slug}/${f}`)).body));
  const shown = `${JSON.stringify(s.log)}${files.join('')}`;
  assert.ok(!shown.includes(KEY), 'a copy of the key in the run\'s output is redacted');
  assert.ok(shown.includes('[redacted]'), 'the copy was there, and is marked');
  const kept = (await store.get(`runs/${run.slug}`)).value;
  assert.ok(!JSON.stringify(kept.files).includes(KEY), 'and so is the kept bundle');
}

// 3. runs at once, run starts per IP ----------------------------------------------------------------------------
{
  const { app } = appWith({ env: { MAX_CONCURRENT_RUNS: '1', RUNS_PER_IP_PER_DAY: '2' } });
  const a = await call(app, 'POST', '/api/direct', { body: { prompt: 'Blue paints the fence', mode: 'byok', key: KEY } });
  assert.equal(a.status, 202);
  const busy = await call(app, 'POST', '/api/direct', { body: { prompt: 'Pink bakes a cake', mode: 'byok', key: KEY }, ip: '198.51.100.9' });
  assert.equal(busy.status, 503, 'one run at a time');
  assert.equal(busy.json().busy, true);
  await follow(app, a.json(), { files: false });
  assert.equal((await call(app, 'POST', '/api/direct', { body: { prompt: 'Pink bakes a cake', mode: 'byok', key: KEY } })).status, 202, 'the slot is free once the run is over');
  const third = await call(app, 'POST', '/api/direct', { body: { prompt: 'Gray dances', mode: 'byok', key: KEY } });
  assert.ok([429, 503].includes(third.status), `the third run start from one IP in a day is refused (${third.status})`);
}

// 4. sign-in, a credit request, the owner's links, credits spent ---------------------------------------------------
{
  const { app, mailer, store } = appWith({ env: { META_API_KEY: OWNER_KEY } });
  assert.equal((await call(app, 'GET', '/api/direct')).json().modes.credits, true, 'credits, once the owner\'s key is set');
  assert.equal((await call(app, 'POST', '/api/auth/code', { body: { email: 'not an email' } })).status, 400);
  const sent = await call(app, 'POST', '/api/auth/code', { body: { email: 'Fan@Example.com ' } });
  assert.equal(sent.json().sent, true);
  const mail = mailer.sent.at(-1);
  assert.equal(mail.to, 'fan@example.com');
  const code = /(\d{6})/.exec(mail.text)[1];
  assert.equal((await call(app, 'POST', '/api/auth/verify', { body: { email: 'fan@example.com', code: code === '000000' ? '000001' : '000000' } })).status, 400, 'a wrong code');
  const ok = await call(app, 'POST', '/api/auth/verify', { body: { email: 'fan@example.com', code } });
  assert.equal(ok.status, 200);
  const cookie = cookieOf(ok);
  assert.match(String(ok.headers['set-cookie']), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  assert.equal((await call(app, 'POST', '/api/auth/verify', { body: { email: 'fan@example.com', code } })).status, 400, 'a code works once');
  const me = (await call(app, 'GET', '/api/auth/me', { headers: { cookie } })).json();
  assert.deepEqual(me.user, { email: 'fan@example.com', credits: 0, used: 0, request: null });
  assert.equal((await call(app, 'POST', '/api/direct', { body: { prompt: 'Blue sings', mode: 'credits' }, headers: { cookie } })).status, 402, 'no credits yet');
  // too many tries on one code
  await call(app, 'POST', '/api/auth/code', { body: { email: 'other@example.com' } });
  for (let i = 0; i < 5; i++) await call(app, 'POST', '/api/auth/verify', { body: { email: 'other@example.com', code: '999999' } });
  const real = /(\d{6})/.exec(mailer.sent.at(-1).text)[1];
  assert.equal((await call(app, 'POST', '/api/auth/verify', { body: { email: 'other@example.com', code: real } })).status, 429, 'five wrong tries lock the code');
  // the request: emailed to the owner with signed links
  assert.equal((await call(app, 'POST', '/api/credits/request', { body: { reason: 'I want to try it' } })).status, 401, 'signed in first (email works)');
  const req1 = await call(app, 'POST', '/api/credits/request', { body: { reason: 'For my <b>class</b> demo' }, headers: { cookie } });
  assert.equal(req1.json().emailed, true);
  assert.equal((await call(app, 'POST', '/api/credits/request', { body: { reason: 'again please' }, headers: { cookie } })).status, 409, 'one pending request at a time');
  const owner = mailer.sent.at(-1);
  assert.equal(owner.to, 'owner@example.com');
  assert.ok(owner.html.includes('For my &lt;b&gt;class&lt;/b&gt; demo') && !owner.html.includes('<b>class</b>'), 'the reason is escaped');
  const approve = /(https:\/\/mb\.test\/api\/credits\/decide\?t=[^\s"]+)/.exec(owner.text.split('Approve: ')[1])[1];
  const t = decodeURIComponent(new URL(approve).searchParams.get('t'));
  assert.equal(verify('test-secret-0123456789', t).act, 'approve');
  assert.equal((await call(app, 'GET', '/api/credits/decide?t=forged.token')).status, 400);
  const page = await call(app, 'GET', `/api/credits/decide?t=${encodeURIComponent(t)}`);
  assert.match(page.body, /<form method="post"/, 'the link opens a page to confirm (a mail scanner changes nothing)');
  assert.equal((await store.get(`requests/${req1.json().request.id}`)).value.status, 'pending');
  const done = await call(app, 'POST', '/api/credits/decide', { body: `t=${encodeURIComponent(t)}&credits=3` });
  assert.match(done.body, /Approved: 3 runs/);
  assert.match(mailer.sent.at(-1).subject, /approved/, 'the user is told');
  assert.match((await call(app, 'POST', '/api/credits/decide', { body: `t=${encodeURIComponent(t)}` })).body, /Already approved/, 'each link works once');
  assert.equal((await call(app, 'GET', '/api/auth/me', { headers: { cookie } })).json().user.credits, 3);
  // a credit run on the owner's key: one credit spent
  const run = await call(app, 'POST', '/api/direct', { body: { prompt: 'Yellow cheers the parade', mode: 'credits' }, headers: { cookie } });
  assert.equal(run.status, 202, run.body);
  assert.equal((await call(app, 'GET', '/api/auth/me', { headers: { cookie } })).json().user.credits, 2);
  const { s } = await follow(app, run.json(), { files: false });
  assert.equal(s.state, 'done', `the credit run: ${s.reason ?? ''} ${JSON.stringify(s.log)}`);
  assert.equal(s.mode, 'credits');
  assert.ok(!(await dump(store)).includes(OWNER_KEY), "the owner's key is never stored");
  // spent at once by parallel starts: never below zero
  await update(store, `users/${(await import('../server/auth.js')).hashOf('test-secret-0123456789', 'email', 'fan@example.com')}`, (u) => ({ ...u, credits: 1 }));
  const both = await Promise.all([1, 2].map((i) => call(app, 'POST', '/api/direct', { body: { prompt: `Race ${i}`, mode: 'credits' }, headers: { cookie }, ip: `192.0.2.${i}` })));
  assert.deepEqual(both.map((r) => r.status).sort(), [202, 402], 'one credit, one run');
  for (const r of both) if (r.status === 202) await follow(app, r.json(), { files: false });
  // a denial
  const sent2 = await call(app, 'POST', '/api/auth/code', { body: { email: 'second@example.com' } });
  assert.equal(sent2.status, 200);
  const c2 = cookieOf(await call(app, 'POST', '/api/auth/verify', { body: { email: 'second@example.com', code: /(\d{6})/.exec(mailer.sent.at(-1).text)[1] } }));
  await call(app, 'POST', '/api/credits/request', { body: { reason: 'please' }, headers: { cookie: c2 } });
  const deny = decodeURIComponent(new URL(/Deny: (\S+)/.exec(mailer.sent.at(-1).text)[1]).searchParams.get('t'));
  assert.match((await call(app, 'POST', '/api/credits/decide', { body: `t=${encodeURIComponent(deny)}` })).body, /Denied/);
  assert.deepEqual((await call(app, 'GET', '/api/auth/me', { headers: { cookie: c2 } })).json().user.credits, 0);
  // the admin page's API: the owner only
  assert.equal((await call(app, 'GET', '/api/admin/requests')).status, 401);
  assert.equal((await call(app, 'GET', '/api/admin/requests', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const list = (await call(app, 'GET', '/api/admin/requests', { headers: { authorization: 'Bearer admin-token-xyz' } })).json();
  assert.deepEqual(list.requests.map((r) => r.status).sort(), ['approved', 'denied']);
  assert.match((await call(app, 'GET', '/api/admin')).body, /Credit requests/);
  // a rehearsal (the owner: the stub Muse, free but for its poster)
  const reh = await call(app, 'POST', '/api/direct', { body: { prompt: 'A rehearsal', mode: 'rehearsal' }, headers: { authorization: 'Bearer admin-token-xyz' } });
  assert.equal(reh.status, 202, reh.body);
  { const { s: rs } = await follow(app, reh.json(), { files: false }); assert.equal(rs.state, 'done', `the rehearsal: ${rs.reason ?? ''} ${JSON.stringify(rs.log)}`); }
  // (its poster on the owner's key: the Muse Image path end to end; the key itself never kept)
  assert.ok(posterCalls.some((c) => c.auth === `Bearer ${OWNER_KEY}`), 'the rehearsal draws its poster on the owner\'s key');
  assert.equal((await call(app, 'GET', `/api/direct/${reh.json().slug}/poster.webp`)).status, 200);
  assert.ok(!(await dump(store)).includes(OWNER_KEY), "the owner's key is never stored");
  assert.equal((await call(app, 'POST', '/api/auth/logout', { headers: { cookie } })).headers['set-cookie'].includes('Max-Age=0'), true);
}

// 5. before email is set up --------------------------------------------------------------------------------------
{
  const { app, store } = appWith({ mail: false });
  assert.equal((await call(app, 'GET', '/api/direct')).json().email, false);
  const code = (await call(app, 'POST', '/api/auth/code', { body: { email: 'fan@example.com' } })).json();
  assert.deepEqual([code.sent, code.emailConfigured], [false, false], "sign-in says email isn't set up");
  assert.equal((await call(app, 'POST', '/api/credits/request', { body: { reason: 'please' } })).status, 401, 'an email address is needed');
  const r = (await call(app, 'POST', '/api/credits/request', { body: { reason: 'For the judges', email: 'Fan@Example.com' } })).json();
  assert.deepEqual([r.request.status, r.emailed, r.emailConfigured], ['pending', false, false]);
  assert.match(r.message, /isn't set up/);
  const list = (await call(app, 'GET', '/api/admin/requests', { headers: { authorization: 'Bearer admin-token-xyz' } })).json();
  assert.equal(list.requests[0].verified, false);
  const d = (await call(app, 'POST', `/api/admin/requests/${r.request.id}`, { body: { action: 'approve' }, headers: { authorization: 'Bearer admin-token-xyz' } })).json();
  assert.deepEqual([d.request.status, d.told], ['approved', false]);
  assert.equal((await call(app, 'POST', `/api/admin/requests/${r.request.id}`, { body: { action: 'approve' }, headers: { authorization: 'Bearer admin-token-xyz' } })).json().already, true);
  const users = (await store.list('users/'));
  assert.equal((await store.get(users[0])).value.credits, 3, 'the runs wait for that email to sign in');
}

// 6. the production backends' error mapping (seen on Vercel): a Blob write that lost the race is a Conflict (retried),
// a stopped sandbox (non-persistent: it can't resume) is gone, a network hiccup is not
{
  const { blobStore, Conflict } = await import('../server/store.js');
  const { sandboxRunner } = await import('../server/runner.js');
  const lost = { put: async () => { throw new Error('Vercel Blob: The conditional request cannot succeed.'); }, BlobPreconditionFailedError: class extends Error {} };
  await assert.rejects(blobStore({ sdk: lost }).put('k', {}, { ifMatch: '"e1"' }), Conflict);
  const exists = { put: async () => { throw new Error('Vercel Blob: This blob already exists.'); }, BlobPreconditionFailedError: class extends Error {} };
  await assert.rejects(blobStore({ sdk: exists }).put('k', {}, { ifNone: true }), Conflict);
  const failing = (msg) => ({ Sandbox: { get: async () => ({ readFileToBuffer: async () => { throw new Error(msg); } }) } });
  assert.equal(await sandboxRunner({ sdk: failing('Status code 400 is not ok: Cannot resume sandbox: no snapshot available.') }).read('abc'), null);
  await assert.rejects(sandboxRunner({ sdk: failing('socket hang up') }).read('abc'));
  // in a Vercel Sandbox Muse's own shell sandbox can't run (no usable bubblewrap): the director runs with
  // --no-muse-sandbox; the crew as the host's own processes (Muse's Workflow seats two agents at once on 4 vCPUs)
  const calls = [], made = [];
  const fake = { Sandbox: { create: async (o) => { made.push(o); return { writeFiles: async () => {}, runCommand: async (c) => { calls.push(c); }, stop: async () => {} }; } } };
  await sandboxRunner({ sdk: fake, files: () => [] }).start({ runId: 'abc', prompt: 'p', slug: 's', key: 'k'.repeat(20), args: ['--no-repo'] });
  const argv = calls[0].args;
  assert.deepEqual(argv.slice(argv.indexOf('--') + 1), ['--no-muse-sandbox', '--crew', 'processes', '--no-repo']);
  assert.equal(made[0].resources.vcpus, 4, "4 vCPUs (8 GB): the Hobby plan's most");
}

// 7. resume: its doors and guards (a fake Vercel Sandbox: nothing is directed) ----------------------------------------
// a run that failed goes on where it stopped (POST /api/direct/<run>/resume), each session in a sandbox of its own (a
// stopped one keeps its name), seeded with the files the run kept; who may, how often, and when not
{
  const { sandboxRunner } = await import('../server/runner.js');
  const boxes = new Map(); // name -> { snap, stopped, files, cmd }
  let broken = false; // (the next sandbox can't start its run)
  const handleOf = (box) => ({
    writeFiles: async (fs) => { box.files.push(...fs); },
    runCommand: async (c) => { if (broken) { broken = false; throw new Error('the command could not start'); } box.cmd = c; },
    readFileToBuffer: async () => { if (box.stopped) throw new Error('Status code 410: Cannot resume sandbox: no snapshot available'); return Buffer.from(JSON.stringify(box.snap)); },
    stop: async () => { box.stopped = true; },
  });
  const sdk = { Sandbox: {
    create: async ({ name }) => {
      if (boxes.has(name)) throw new Error(`Status code 409: a sandbox named ${name} exists`); // (a stopped one keeps its name)
      const box = { snap: { v: 1, state: 'working', phase: 'directing', files: {}, log: [] }, stopped: false, files: [], cmd: null };
      boxes.set(name, box);
      return handleOf(box);
    },
    get: async ({ name }) => {
      if (!boxes.has(name)) throw new Error('Status code 404: not found');
      return handleOf(boxes.get(name));
    },
    list: async () => ({ sandboxes: [...boxes].map(([name, b], i) => ({ name, createdAt: i, status: b.stopped ? 'stopped' : 'running' })).reverse() }),
  } };
  const { app, store, logs } = appWith({ env: { META_API_KEY: OWNER_KEY, RUNS_PER_IP_PER_DAY: '2' }, runner: sandboxRunner({ sdk, files: () => [] }) });
  const SECRET = 'test-secret-0123456789';
  const cookieFor = (email) => `${SESSION_COOKIE}=${encodeURIComponent(sign(SECRET, { kind: 'session', email }, 3600))}`;
  const resume = (run, body = {}, headers = {}) => call(app, 'POST', `${run.status}/resume`, { body, headers });
  const status = async (run) => (await call(app, 'GET', run.status)).json();
  const run = (await call(app, 'POST', '/api/direct', { body: { prompt: 'Gold sells hot soup', mode: 'byok', key: KEY } })).json();
  const id = run.slug;
  const { slug } = (await store.get(`runs/${id}`)).value;
  assert.ok(boxes.has(`mb-${id}`), 'the first session: mb-<run>');
  assert.equal((await resume(run, { key: KEY })).status, 409, 'a run still going is not resumed');
  // it fails with work done: the status says it may go on
  const partial = '{"seq":0,"t":1,"bot":"Gold","summary":"Soup"}\n';
  const beats = '{"title":"Hot Soup","beats":[]}';
  boxes.get(`mb-${id}`).snap = { v: 1, state: 'failed', phase: 'directing', reason: 'the director stopped', exit: 1, log: ['boom'],
    files: { 'events.ndjson': partial, 'beats.json': beats, 'director.json': null, 'queued.ndjson': '', 'activity.ndjson': '' } };
  let s = await status(run);
  assert.deepEqual([s.state, s.reason, s.canResume, s.resumes], ['failed', 'the director stopped', true, 0]);
  assert.ok(boxes.get(`mb-${id}`).stopped);
  // the guards
  assert.equal((await resume(run, {})).status, 400, 'byok: a key, to pay for the rest');
  assert.equal((await resume(run, { key: 'short' })).status, 400);
  assert.equal((await resume(run, { key: KEY }, { origin: 'https://evil.example' })).status, 403, 'a cross-site POST');
  assert.equal((await call(app, 'POST', '/api/direct/..%2Fetc/resume', { body: { key: KEY } })).status, 400);
  assert.equal((await call(app, 'POST', '/api/direct/0123456789abcdef01234567/resume', { body: { key: KEY } })).status, 404);
  assert.equal((await call(app, 'GET', `${run.status}/resume`)).status, 404, 'POST only');
  // resumed: the same run and doors; a sandbox of its own, seeded with the kept files, the director with --resume
  const r1 = await resume(run, { key: KEY });
  assert.equal(r1.status, 202, r1.body);
  assert.deepEqual(r1.json(), run, 'the same run: its doors and share link');
  const box1 = boxes.get(`mb-${id}-r1`);
  assert.ok(box1, `the second session's own sandbox (${[...boxes.keys()]})`);
  const seeded = Object.fromEntries(box1.files.filter((f) => f.path.startsWith(`/vercel/mb/episodes/live/${slug}/`)).map((f) => [f.path.split('/').at(-1), f.content.toString()]));
  assert.deepEqual(seeded, { 'events.ndjson': partial, 'beats.json': beats, 'queued.ndjson': '', 'activity.ndjson': '' }, 'the kept files are the seed (none that was not there)');
  const argv = box1.cmd.args.slice(box1.cmd.args.indexOf('--') + 1);
  assert.ok(argv.includes('--resume') && argv.includes('--no-repo') && argv.join(' ').includes('--crew processes'), argv.join(' '));
  assert.equal(argv[argv.indexOf('--budget') + 1], String(40 * 60 - 240), "the whole run's time, as a fresh start's");
  assert.equal(box1.cmd.env.META_API_KEY, KEY, "the pasted key: in that one command's environment");
  s = await status(run);
  assert.deepEqual([s.state, s.resumes, s.canResume], ['working', 1, false], "read from the new session's sandbox");
  assert.equal((await resume(run, { key: KEY })).status, 409, 'a run going again is not resumed');
  // stopped: the session's own sandbox; a session that wrote nothing keeps the seed
  await call(app, 'DELETE', run.status);
  assert.ok(box1.stopped, "the new session's sandbox is stopped");
  s = await status(run);
  assert.deepEqual([s.state, s.reason, s.canResume], ['failed', 'stopped', true]);
  assert.equal((await store.get(`runs/${id}`)).value.files['events.ndjson'], partial);
  // a sandbox that can't start its run: the run as it was (failed, the resume given back, its files kept); the next
  // try gets yet another sandbox (the failed one keeps its name)
  assert.equal((await resume(run, { key: KEY })).status, 202);
  await call(app, 'DELETE', run.status);
  broken = true;
  assert.equal((await resume(run, { key: KEY })).status, 502);
  let kept = (await store.get(`runs/${id}`)).value;
  assert.deepEqual([kept.state, kept.resumes, kept.reason, kept.files['events.ndjson']], ['failed', 2, 'the run could not be resumed: the sandbox could not start', partial]);
  assert.ok(boxes.get(`mb-${id}-r3`)?.stopped, "the failed try's sandbox, stopped");
  assert.equal((await status(run)).canResume, true);
  const r3 = await resume(run, { key: KEY });
  assert.equal(r3.status, 202, `the third resume: ${r3.body}`);
  assert.ok(boxes.has(`mb-${id}-r4`), `never a taken name (${[...boxes.keys()]})`);
  await call(app, 'DELETE', run.status);
  s = await status(run);
  assert.deepEqual([s.state, s.resumes, s.canResume], ['failed', 3, false], 'three resumes: the most');
  const fourth = await resume(run, { key: KEY });
  assert.equal(fourth.status, 409, 'the fourth resume is refused');
  assert.match(fourth.json().error, /resumed 3 times/);
  kept = (await store.get(`runs/${id}`)).value;
  assert.ok(kept.firstStartedAt <= kept.startedAt && kept.sandbox === 4, JSON.stringify({ first: kept.firstStartedAt, at: kept.startedAt, sandbox: kept.sandbox }));
  // a done run is not resumed; resumes are not run starts (two a day from this place: both used)
  const second = (await call(app, 'POST', '/api/direct', { body: { prompt: 'Pink bakes a cake', mode: 'byok', key: KEY } })).json();
  boxes.get(`mb-${second.slug}`).snap = { v: 1, state: 'done', phase: 'directing', exit: 0, files: { 'events.ndjson': partial, 'beats.json': beats }, log: [] };
  assert.equal((await status(second)).state, 'done');
  assert.equal((await resume(second, { key: KEY })).status, 409, 'a done run is not resumed');
  assert.equal((await call(app, 'POST', '/api/direct', { body: { prompt: 'Gray dances', mode: 'byok', key: KEY } })).status, 429, 'the third start from here today');
  // a credit run: resumed by whoever started it (or the owner), on the owner's key, no credit spent
  await update(store, `users/${hashOf(SECRET, 'email', 'fan@example.com')}`, () => ({ email: 'fan@example.com', credits: 2, used: 1 }));
  const failedRec = (rid, extra) => store.put(`runs/${rid}`, { id: rid, slug: 'blue-sings', prompt: 'Blue sings', state: 'failed', startedAt: Date.now() - 60_000, reason: 'stopped', files: { 'events.ndjson': partial, 'beats.json': beats }, ...extra });
  const credit = { status: '/api/direct/c0ffee0123456789abcdef01' };
  await failedRec('c0ffee0123456789abcdef01', { mode: 'credits', email: 'fan@example.com' });
  assert.equal((await resume(credit)).status, 401, 'a credit run: signed in first');
  assert.equal((await resume(credit, {}, { cookie: cookieFor('other@example.com') })).status, 403, "another user can't resume it");
  const own = await resume(credit, {}, { cookie: cookieFor('fan@example.com') });
  assert.equal(own.status, 202, own.body);
  assert.equal(boxes.get('mb-c0ffee0123456789abcdef01-r1').cmd.env.META_API_KEY, OWNER_KEY, "on the owner's key");
  assert.equal((await call(app, 'GET', '/api/auth/me', { headers: { cookie: cookieFor('fan@example.com') } })).json().user.credits, 2, 'no credit spent');
  // (one that never got to direct had its credit back: it is started again, not resumed)
  const refunded = { status: '/api/direct/c0ffee0123456789abcdef02' };
  await failedRec('c0ffee0123456789abcdef02', { mode: 'credits', email: 'fan@example.com', refunded: true, files: {} });
  assert.equal((await status(refunded)).canResume, false);
  assert.equal((await resume(refunded, {}, { cookie: cookieFor('fan@example.com') })).status, 409);
  // a rehearsal: the owner's (the stub Muse, as its start)
  const reh = { status: '/api/direct/c0ffee0123456789abcdef03' };
  await failedRec('c0ffee0123456789abcdef03', { mode: 'rehearsal' });
  assert.equal((await resume(reh, {}, { cookie: cookieFor('fan@example.com') })).status, 403, 'rehearsals are the owner\'s');
  assert.equal((await resume(reh, {}, { authorization: 'Bearer admin-token-xyz' })).status, 202);
  const rehArgs = boxes.get('mb-c0ffee0123456789abcdef03-r1').cmd.args.join(' ');
  assert.ok(rehArgs.includes('--muse scripts/director/stub-muse.js') && rehArgs.includes('--resume'), rehArgs);
  // the runs-at-once guard holds (two going now: the credit run and the rehearsal)
  const busy = { status: '/api/direct/c0ffee0123456789abcdef04' };
  await failedRec('c0ffee0123456789abcdef04', { mode: 'byok' });
  const full = await resume(busy, { key: KEY });
  assert.deepEqual([full.status, full.json().busy], [503, true], 'the director is busy');
  // the sandbox runner on its own: a session's name, read and stopped by it (a cold function too), listed back
  const cold = sandboxRunner({ sdk, files: () => [] });
  assert.equal((await cold.read('c0ffee0123456789abcdef01', 1)).state, 'working');
  await cold.stop('c0ffee0123456789abcdef01', 1);
  assert.ok(boxes.get('mb-c0ffee0123456789abcdef01-r1').stopped && !boxes.get('mb-c0ffee0123456789abcdef03-r1').stopped);
  const listed = (await cold.list()).filter((r) => r.runId === id).map((r) => [r.session, r.running]);
  assert.deepEqual(listed, [[4, false], [3, false], [2, false], [1, false], [0, false]]);
  assert.ok(!`${await dump(store)}${logs.join('\n')}`.includes(KEY), 'the pasted key is never stored or logged');
}

// 8. resume, end to end: a run that failed with work done (after two stanzas Green only sends lines the gate refuses:
// the crew is busy and gets nowhere, stopped after --progress 15 s, no repair run, the gate fails; a Green who just
// stopped would be started again by the host) goes on in a fresh session from the files it kept (direct.js --resume)
// and finishes; its stream keeps what was there (the same events first, its clock never going back), so the page's
// live making-of goes on. The crew as the hosted runner runs it (--crew processes).
{
  const { app, store, logs, runnerEnv } = appWith({ env: { MB_RUNNER_ARGS: `--muse ${STUB} --crew processes --stall 90 --progress 15 --repairs 0` }, runnerEnv: { STUB_MUSE_REFUSALS: '400', STUB_MUSE_REFUSAL_MS: '250', STUB_MUSE_REFUSE_AT: '2' } });
  const run = (await call(app, 'POST', '/api/direct', { body: { prompt: 'Gold sells hot soup on a cold day', mode: 'byok', key: KEY } })).json();
  const { s: failed } = await follow(app, run, { files: false });
  assert.equal(failed.state, 'failed', `the first session fails: ${JSON.stringify(failed.log)}`);
  assert.equal(failed.canResume, true);
  const before = parseNdjson((await call(app, 'GET', run.events)).body);
  assert.ok(before.length > 0, 'with work done');
  delete runnerEnv.STUB_MUSE_REFUSALS; // (what stopped it is gone)
  const resumed = await call(app, 'POST', `${run.status}/resume`, { body: { key: KEY } });
  assert.equal(resumed.status, 202, resumed.body);
  assert.equal(resumed.json().slug, run.slug, 'the same run');
  const { s } = await follow(app, run, { files: false });
  assert.equal(s.state, 'done', `the resumed run: ${s.reason ?? ''} ${JSON.stringify(s.log)}`);
  const after = parseNdjson((await call(app, 'GET', run.events)).body);
  assert.ok(after.length > before.length, `it went on (${before.length} -> ${after.length} events)`);
  const sig = (e) => JSON.stringify([e.seq, e.bot, e.summary]);
  assert.deepEqual(after.slice(0, before.length).map(sig), before.map(sig), 'the events before the resume, as they were');
  for (let i = 1; i < after.length; i++) assert.ok(after[i].t >= after[i - 1].t, `t never goes back (#${after[i].seq}: ${after[i - 1].t} -> ${after[i].t})`);
  assert.deepEqual([s.resumes, s.canResume, s.director?.resumes], [1, false, 1], 'director.json counts the resume');
  const rec = (await store.get(`runs/${run.slug}`)).value;
  assert.deepEqual([rec.state, rec.resumes, rec.sandbox], ['done', 1, 1]);
  assert.ok(rec.firstStartedAt < rec.startedAt);
  const dir = mkdtempSync(join(tmpdir(), 'mb-server-resumed-'));
  for (const f of ['events.ndjson', 'beats.json', 'director.json', 'activity.ndjson']) writeFileSync(join(dir, f), (await call(app, 'GET', `/api/direct/${run.slug}/${f}`)).body);
  execFileSync(process.execPath, [VALIDATE, dir]);
  assert.ok(!`${await dump(store)}${logs.join('\n')}`.includes(KEY), 'the pasted key is never stored or logged');
  assert.equal((await call(app, 'POST', `${run.status}/resume`, { body: { key: KEY } })).status, 409, 'a done run is not resumed');
}

// 9. a crew that is busy but slow is not stopped: before his first stanza Green sends 16 lines the gate refuses, half a
// second apart (no event lands for ~8 s, but the gate's log grows) under a 3-second stall watch; the run is done
{
  const { app } = appWith({ env: { MB_RUNNER_ARGS: `--muse ${STUB} --stall 3` }, runnerEnv: { STUB_MUSE_REFUSALS: '16', STUB_MUSE_REFUSAL_MS: '500' } });
  const run = (await call(app, 'POST', '/api/direct', { body: { prompt: 'Gold sells hot soup on a cold day', mode: 'byok', key: KEY } })).json();
  const { s } = await follow(app, run, { files: false });
  assert.equal(s.state, 'done', `a busy crew is not stopped: ${s.reason ?? ''} ${JSON.stringify(s.log)}`);
  assert.ok(!s.director.runs.some((r) => r.stopped), `no run stopped by the watchdog: ${JSON.stringify(s.director.runs.map((r) => [r.kind, r.stopped ?? null]))}`);
}

assert.equal(normalEmail(' A.B+c@Example.ORG '), 'a.b+c@example.org');
assert.equal(verify('k', sign('k', { a: 1 }, -5)), null, 'an expired token');
museImage.close();
console.log('server ok: probe + guards, a BYOK run (live doors, bundle kept, its Muse Image poster and share preview, key never stored or shown, redacted), runs at once + per IP, sign-in codes, credit requests + signed single-use links, credits spent atomically, admin, rehearsal, no-email mode, resume (a sandbox per session, seeded; who, how often; end to end)');
