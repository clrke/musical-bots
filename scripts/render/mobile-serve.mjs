// Audit server: a frozen web/dist served statically plus the real API (server/app.js) on a memory store, so the run
// dialog, sign-in, credit requests and the admin page behave as on Vercel. A fake finished run (RUN id) serves the hero
// episode's bundle for the share link (?run=).
//   node scripts/render/mobile-serve.mjs <repo root> <dist (a frozen copy of web/dist)> <port>   (scripts/render/mobile-audit.mjs)
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

const [REPO0, DIST0, PORT] = process.argv.slice(2);
const REPO = resolve(REPO0), DIST = resolve(DIST0);
const load = (f) => import(pathToFileURL(join(REPO, f)).href);
const { createApp, configFrom } = await load('server/app.js');
const { memoryStore } = await load('server/store.js');
const { localRunner } = await load('server/runner.js');
const { memoryMailer } = await load('server/mail.js');
const RUN = 'abcdefghijklmnopqrstuvwx';
const mailer = memoryMailer({ configured: true });
const app = createApp({
  store: memoryStore(), mailer,
  runner: localRunner({ root: mkdtempSync(join(tmpdir(), 'mb-audit-')), env: { MB_EMIT_LINGER_S: '1', MB_EMIT_WAIT_S: '4' } }),
  config: configFrom({ SESSION_SECRET: 'audit-secret-0123456789', ADMIN_TOKEN: 'audit-admin', OWNER_EMAIL: 'owner@example.com', MB_RUNNER_ARGS: '--muse scripts/director/stub-muse.js --stall 20' }),
  log: () => {},
});
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ndjson': 'application/x-ndjson',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  // the last code mailed (the audit types it)
  if (u.pathname === '/__mail') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(mailer.sent ?? mailer.outbox ?? [])); }
  const m = u.pathname.match(new RegExp(`^/api/direct/${RUN}/([a-z.]+)$`));
  if (m) {
    const f = join(DIST, 'episodes/why-musical-bots', m[1]);
    if (!existsSync(f)) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', TYPES[extname(f)] ?? 'application/octet-stream');
    return res.end(readFileSync(f));
  }
  if (u.pathname.startsWith('/api/')) {
    const body = await new Promise((ok) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => ok(Buffer.concat(b))); });
    const r2 = Readable.from(body.length ? [body] : []);
    Object.assign(r2, { method: req.method, url: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'http' } });
    return app(r2, res);
  }
  let f = join(DIST, decodeURIComponent(u.pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  res.setHeader('content-type', TYPES[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(+PORT, '127.0.0.1', () => console.log(`serving ${DIST} on ${PORT}`));
