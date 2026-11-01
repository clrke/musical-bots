#!/usr/bin/env node
// The hosted site on this machine: the built app (web/dist) and its API (server/app.js) as Vercel serves them, with a
// local runner instead of a sandbox, an in-memory store, and a mailer that prints each email here instead of sending
// it. For trying the Make it dialog, sign-in, credits and a hosted run end to end before a deploy.
//   npm run build && node scripts/vercel/serve.mjs [--port 4300] [--stub] [--no-email] [--sandbox]
//     --stub      every run uses the stub Muse (free; scripts/director/stub-muse.js), slowed down to be watchable
//     --no-email  as before SMTP is set up (sign-in unavailable, requests kept for the admin page)
//     --sandbox   runs go to a real Vercel Sandbox (needs `vercel env pull` for the OIDC token: node --env-file=.env.local)
// The admin token is "local-admin"; META_API_KEY from the environment is the owner's key for credit runs.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFrom, createApp } from '../../server/app.js';
import { memoryStore } from '../../server/store.js';
import { localRunner, sandboxRunner } from '../../server/runner.js';
import { memoryMailer } from '../../server/mail.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'web/dist');
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const port = Number(argv[argv.indexOf('--port') + 1]) || 4300;
if (!existsSync(join(DIST, 'index.html'))) { console.error('web/dist is missing: npm run build first'); process.exit(1); }

const env = {
  ...process.env, SESSION_SECRET: process.env.SESSION_SECRET || 'local-dev-secret-not-for-production', ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'local-admin',
  ...(flag('--stub') ? { MB_RUNNER_ARGS: '--muse scripts/director/stub-muse.js' } : {}),
};
const config = configFrom(env);
const mailer = memoryMailer({ configured: !flag('--no-email') });
const send = mailer.send;
mailer.send = async (m) => { const ok = await send(m); if (ok) console.log(`\n[mail] to ${m.to}: ${m.subject}\n${m.text}`); return ok; };
// (--stub-delay <ms>: the stub's pause between a role's calls; ~3000 makes a run last about a minute, events trickling in as a real run's do)
const stubDelay = argv.includes('--stub-delay') ? argv[argv.indexOf('--stub-delay') + 1] : '3000';
const runner = flag('--sandbox') ? sandboxRunner({ timeoutMs: (config.runMinutes + 2) * 60_000 })
  : localRunner({ env: flag('--stub') ? { STUB_MUSE_DELAY_MS: stubDelay } : {} });
const app = createApp({ config, store: memoryStore(), runner, mailer });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ndjson': 'application/x-ndjson',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return app(req, res);
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Musical Bots (hosted, local) on http://localhost:${port}  [runner: ${runner.kind}${flag('--stub') ? ', stub Muse' : ''}; email: ${mailer.configured ? 'printed here' : 'off'}; admin token: local-admin]`));
