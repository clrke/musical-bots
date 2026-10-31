// LIVE: the dev server's door to the Muse Code director (a Vite plugin for `npm --prefix web run dev`
// only; `vite build` stays a static site with zero keys). The page's Live button POSTs a prompt; the
// plugin starts scripts/director/direct.js writing to episodes/live/<slug>/ (git-ignored), and the
// page polls the bundle as the crew appends to it.
//   GET  /api/direct                     { available, running, muse }      (the page probes this)
//   POST /api/direct  { prompt }         { slug, events, beats, status, queued, activity }   (409 while a run is going)
//   GET  /api/direct/<slug>              { state: planning|working|done|failed, events, title, log, director }
//   GET  /api/direct/<slug>/events.ndjson | beats.json | director.json      (no-cache, as they grow)
//   GET  /api/direct/<slug>/queued.ndjson    the events written but not landed yet (the turnstile holds them for a
//                                            later beat): each with `n` (its call) and `t` (when it was written)
//   GET  /api/direct/<slug>/activity.ndjson  the production's activity so far (activity.js liveActivity; the
//                                            recorded log once the run has written it)
//   DELETE /api/direct/<slug>            stops the run
// MB_DIRECT_ARGS passes options to the orchestrator (a stub Muse for a free rehearsal, the efforts).
// One run at a time (a run costs real tokens). The build hook drops dist/episodes/live, which the
// public/episodes symlink would otherwise copy into a local build.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveActivity, ACTIVITY_FILE } from './activity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

const slugOf = (prompt) => `${String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '') || 'episode'}`;
const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
const count = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { return 0; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const readLines = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
const ndjson = (list) => list.map((e) => JSON.stringify(e)).join('\n') + (list.length ? '\n' : '');

/**
 * The events a run has written that have not landed yet (emit.js state.queue: sent for a later beat, they land when it
 * opens), in the order sent: each with `n` (its emit call) and `t` (s since the production started, when it was
 * written). The LIVE making-of sings them from then, as a recorded one does (activity-lines.js writtenTimes).
 */
export function queuedOf(dir) {
  const state = readJson(join(dir, '.director', 'state.json'));
  return (state?.queue ?? []).map((q) => ({ ...q.e, n: q.n, t: Number.isFinite(q.t) ? q.t : null }));
}

/**
 * The middleware (connect-style), testable without Vite. opts: { root (episodes/live dir),
 * command (argv of the orchestrator; prompt and --out appended), env }.
 */
export function directorMiddleware(opts = {}) {
  const root = resolve(opts.root ?? join(REPO, 'episodes/live'));
  const command = opts.command ?? [process.execPath, join(HERE, 'direct.js')];
  // the orchestrator's options: MB_DIRECT_ARGS (space-separated, e.g. "--muse scripts/director/stub-muse.js"
  // to rehearse the making-of for free, or "--lyrics-effort high")
  const extra = opts.args ?? (process.env.MB_DIRECT_ARGS ? process.env.MB_DIRECT_ARGS.trim().split(/\s+/) : []);
  const runs = new Map(); // slug -> { child, prompt, startedAt, exit, log[] }
  const cache = new Map(); // slug -> { at, body }: the live activity log, read at most once a second
  const active = () => [...runs.entries()].find(([, r]) => r.exit === undefined)?.[0] ?? null;

  function start(prompt) {
    const slug = slugOf(prompt);
    const out = join(root, slug);
    const child = spawn(command[0], [...command.slice(1), prompt, '--live', '--out', out, '--slug', slug, ...extra], {
      cwd: REPO, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const run = { child, prompt, out, startedAt: Date.now(), exit: undefined, log: [] };
    const keep = (chunk) => { for (const l of String(chunk).split('\n')) if (l.trim()) { run.log.push(l.replace(/^\[direct\] /, '')); if (run.log.length > 60) run.log.shift(); } };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('close', (code) => { run.exit = code ?? 1; });
    child.on('error', (e) => { run.log.push(`spawn failed: ${e.message}`); run.exit = 1; });
    runs.set(slug, run);
    return slug;
  }

  function status(slug) {
    const run = runs.get(slug);
    const dir = run?.out ?? join(root, slug);
    const beats = readJson(join(dir, 'beats.json'));
    const director = readJson(join(dir, 'director.json'));
    const events = count(join(dir, 'events.ndjson'));
    const state = run && run.exit === undefined ? (beats ? 'working' : 'planning')
      : director?.gate?.ok ? 'done' : run || director ? 'failed' : 'unknown';
    return { slug, state, prompt: run?.prompt ?? beats?.prompt ?? null, title: beats?.title ?? null, events,
      seconds: run ? Math.round((Date.now() - run.startedAt) / 1000) : null, exit: run?.exit ?? null,
      log: run?.log.slice(-8) ?? [], director: director ?? null };
  }

  return async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/direct')) return next();
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'direct', slug?, file?]
    const slug = parts[2];
    if (slug && !SLUG.test(slug)) return json(res, 400, { error: 'bad slug' });
    if (!slug && req.method === 'GET') return json(res, 200, { available: true, running: active(), museBin: opts.museBin ?? null });
    if (!slug && req.method === 'POST') {
      let prompt = '';
      try { prompt = String(JSON.parse((await readBody(req)) || '{}').prompt ?? '').trim(); } catch { /* bad JSON */ }
      if (!prompt || prompt.length > 200) return json(res, 400, { error: 'a prompt of 1-200 characters' });
      const busy = active();
      if (busy) return json(res, 409, { error: 'a director run is already going', ...status(busy) });
      const s = start(prompt);
      const base = `/api/direct/${s}`;
      return json(res, 202, { slug: s, status: base, events: `${base}/events.ndjson`, beats: `${base}/beats.json`, director: `${base}/director.json`, queued: `${base}/queued.ndjson`, activity: `${base}/activity.ndjson` });
    }
    if (slug && parts.length === 3 && req.method === 'GET') return json(res, 200, status(slug));
    if (slug && parts.length === 3 && req.method === 'DELETE') {
      const run = runs.get(slug);
      if (run && run.exit === undefined) run.child.kill('SIGINT');
      return json(res, 200, { stopped: Boolean(run) });
    }
    if (slug && parts.length === 4 && req.method === 'GET' && ['queued.ndjson', 'activity.ndjson'].includes(parts[3])) {
      const dir = runs.get(slug)?.out ?? join(root, slug);
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/x-ndjson');
      if (parts[3] === 'queued.ndjson') return res.end(ndjson(queuedOf(dir)));
      // (the recorded log once the run wrote it; before, as it goes: read at most once a second, the session logs grow)
      if (existsSync(join(dir, ACTIVITY_FILE))) return res.end(readFileSync(join(dir, ACTIVITY_FILE)));
      const c = cache.get(slug);
      if (c && Date.now() - c.at < 1000) return res.end(c.body);
      const body = ndjson(liveActivity(dir, { events: readLines(join(dir, 'events.ndjson')) }));
      cache.set(slug, { at: Date.now(), body });
      return res.end(body);
    }
    if (slug && parts.length === 4 && req.method === 'GET' && ['events.ndjson', 'beats.json', 'director.json'].includes(parts[3])) {
      const file = join(runs.get(slug)?.out ?? join(root, slug), parts[3]);
      res.setHeader('cache-control', 'no-store');
      if (!existsSync(file)) { res.statusCode = 404; return res.end(''); }
      res.setHeader('content-type', parts[3].endsWith('.ndjson') ? 'application/x-ndjson' : 'application/json');
      return res.end(readFileSync(file));
    }
    return json(res, 404, { error: 'not found' });
  };
}

/** The Vite plugin: the middleware in `vite dev`, and a clean dist in `vite build`. */
export function directorDev(opts = {}) {
  let outDir = null;
  return [
    { name: 'musical-bots-director', apply: 'serve', configureServer(server) { server.middlewares.use(directorMiddleware(opts)); } },
    {
      name: 'musical-bots-director-clean-dist', apply: 'build',
      configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
      closeBundle() { if (outDir) rmSync(join(outDir, 'episodes/live'), { recursive: true, force: true }); },
    },
  ];
}
