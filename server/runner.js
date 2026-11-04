// Where a hosted director run happens (server/app.js). Both runners start scripts/director/sandbox-run.js, which
// installs Muse Code (when asked), runs direct.js --live and writes the run's snapshot about once a second:
//   sandboxRunner()  one Vercel Sandbox (a Firecracker microVM) per run: the director's files are copied in, the run
//                    starts detached with the key in that one command's environment, the sandbox is not persistent
//                    (nothing is snapshotted on stop) and is stopped when the run is over (its session timeout is the
//                    backstop);
//   localRunner()    a child process on this machine (the tests, scripts/vercel/serve.mjs).
// Interface: start({ runId, prompt, slug, key, args, env, installMuse, session, seed }) -> { name }; read(runId,
// session) -> the snapshot or null (no such run, or it is gone); stop(runId, session); list() -> [{ runId, session,
// createdAt, running }]. A run's first sandbox is session 0; a resumed run (server/app.js resumeRun) starts session k in
// a sandbox of its own (a stopped one keeps its name), seeded with the files the run had kept ({ file: text }: written
// into the bundle's folder before the wrapper starts, so direct.js --resume goes on from them).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** What a run needs, relative to the repo: the director, its prompts and briefs, the gate, the web modules it imports. */
export const SHIPPED = ['director', 'scripts/director', 'scripts/validate-bundle.js', 'web/src'];
export const SANDBOX_TAG = 'musical-bots';
// (a stopped sandbox, non-persistent too, still holds its name: a resumed run's k-th session is mb-<run>-r<k>)
export const nameOf = (runId, session = 0) => `mb-${runId}${session ? `-r${session}` : ''}`;
/** A sandbox's name back to its run and session, or null (not one of ours). */
export const runOf = (name) => {
  const m = /^mb-([a-z0-9]+?)(?:-r(\d+))?$/.exec(String(name ?? ''));
  return m ? { runId: m[1], session: Number(m[2] ?? 0) } : null;
};
/** The kept files a resumed session starts from, as { path, content } under its bundle's folder (only the bundle's own names). */
const seedFiles = (dir, seed = {}) => Object.entries(seed ?? {})
  .filter(([f, text]) => /^[a-z]+\.(ndjson|json)$/.test(f) && typeof text === 'string')
  .map(([f, text]) => ({ path: `${dir}/${f}`, content: Buffer.from(text) }));

let shipped = null;
/** The director's files as { path, content } (read once), plus package.json files that make them ES modules. */
export function directorFiles(root = ROOT) {
  if (shipped && root === ROOT) return shipped;
  const out = [];
  const add = (rel) => {
    const st = statSync(join(root, rel));
    if (st.isDirectory()) { for (const f of readdirSync(join(root, rel)).sort()) add(`${rel}/${f}`); return; }
    // (and the poster's cast reference, scripts/director/poster-ref.jpg: Muse Image draws from it)
    if (/\.(js|mjs|json|md|jpg)$/.test(rel)) out.push({ path: rel, content: readFileSync(join(root, rel)) });
  };
  for (const p of SHIPPED) if (existsSync(join(root, p))) add(p);
  const pkg = Buffer.from('{"private":true,"type":"module"}\n');
  out.push({ path: 'package.json', content: pkg }, { path: 'web/package.json', content: pkg });
  if (root === ROOT) shipped = out;
  return out;
}

/** The wrapper's argv for a run laid out under `base`. */
function wrapperArgs(base, { slug, installMuse, args = [] }) {
  return [`${base}/scripts/director/sandbox-run.js`, '--prompt-file', `${base}/.run/prompt.txt`, '--out', `${base}/episodes/live/${slug}`,
    '--slug', slug, '--snapshot', `${base}/.run/snapshot.json`, ...(installMuse ? ['--install-muse'] : []), '--', ...args];
}

/**
 * Vercel Sandbox. opts: vcpus (4: 8 GB, the Hobby maximum, vercel.com/docs/sandbox/pricing: the crew is eight Muse
 * sessions at once), timeoutMs (the session's hard limit: Hobby allows 45 min), files (the director's), sdk (the
 * @vercel/sandbox module, for tests), credentials (token/teamId/projectId outside Vercel; on Vercel and with
 * `vercel env pull` the OIDC token is used).
 */
export function sandboxRunner({ vcpus = 4, timeoutMs = 42 * 60_000, files = () => directorFiles(), sdk = null, credentials = {}, base = '/vercel/mb' } = {}) {
  // Muse's own shell sandbox can't run in a Vercel Sandbox (its bubblewrap: the user's processes hold every capability,
  // Ubuntu's bwrap lacks --perms, the embedded one can't mount /proc), so every bash call failed and the director ended
  // its turn without a plan (Nov 1-2). The microVM, one per run and never kept, is the boundary: Muse's shell runs bare.
  // The crew runs as eight processes of the host's own: Muse's Workflow tool seats only two agents at once on a host of
  // 4 vCPUs or fewer (measured).
  const directArgs = ['--no-muse-sandbox', '--crew', 'processes'];
  let mod = sdk;
  const S = async () => (mod ??= await import('@vercel/sandbox')).Sandbox;
  // (by the sandbox's name, not the run's: a resumed run's sessions are different sandboxes)
  const handles = new Map(); // name -> Sandbox (a warm function reuses it)
  const cache = new Map(); //   name -> { at, value: Promise<snapshot|null> } (one read per ~second, however many requests)
  const handle = async (name) => {
    if (handles.has(name)) return handles.get(name);
    const sbx = await (await S()).get({ name, ...credentials });
    handles.set(name, sbx);
    return sbx;
  };
  return {
    kind: 'sandbox',
    async start({ runId, prompt, slug, key = null, args = [], env = {}, installMuse = true, session = 0, seed = null }) {
      const Sandbox = await S();
      const name = nameOf(runId, session);
      const sbx = await Sandbox.create({ name, resources: { vcpus }, timeout: timeoutMs, persistent: false, tags: { app: SANDBOX_TAG }, ...credentials });
      try {
        await sbx.writeFiles([...files().map((f) => ({ path: `${base}/${f.path}`, content: f.content })), { path: `${base}/.run/prompt.txt`, content: Buffer.from(prompt) },
          ...seedFiles(`${base}/episodes/live/${slug}`, seed)]);
        // detached: the run goes on after this request; the key is in this one command's environment only
        await sbx.runCommand({ cmd: 'node', args: wrapperArgs(base, { slug, installMuse, args: [...directArgs, ...args] }), cwd: base, env: { ...env, ...(key ? { META_API_KEY: key } : {}) }, detached: true });
      } catch (err) {
        await sbx.stop().catch(() => {});
        throw err;
      }
      handles.set(name, sbx);
      return { name };
    },
    /** The run's snapshot (its session's sandbox), or null when the sandbox is gone (stopped, timed out, never was). */
    async read(runId, session = 0) {
      const name = nameOf(runId, session);
      const c = cache.get(name);
      if (c && Date.now() - c.at < 900) return c.value;
      const value = (async () => {
        try {
          const buf = await (await handle(name)).readFileToBuffer({ path: `${base}/.run/snapshot.json` });
          return buf ? JSON.parse(buf.toString('utf8')) : { v: 1, state: 'planning', phase: 'starting', files: {}, log: [] };
        } catch (err) {
          handles.delete(name);
          // gone: stopped (a non-persistent sandbox can't resume: "Cannot resume sandbox: no snapshot available"),
          // timed out, or never was; anything else is a hiccup (the caller keeps the last snapshot)
          if (/not.?found|404|410|stopped|gone|cannot resume|no snapshot/i.test(`${err?.message} ${err?.status ?? ''}`)) return null;
          throw err;
        }
      })();
      cache.set(name, { at: Date.now(), value });
      value.catch(() => cache.delete(name));
      return value;
    },
    async stop(runId, session = 0) {
      const name = nameOf(runId, session);
      cache.delete(name);
      try { await (await handle(name)).stop(); } catch { /* already gone */ }
      handles.delete(name);
    },
    /** The latest runs' sandboxes (newest first): enough to count the running ones and find stale ones. */
    async list() {
      const r = await (await S()).list({ tags: { app: SANDBOX_TAG }, sortBy: 'createdAt', sortOrder: 'desc', limit: 25, ...credentials });
      return (r.sandboxes ?? []).map((s) => ({ ...runOf(s.name), createdAt: s.createdAt, running: ['pending', 'running'].includes(s.status) })).filter((s) => s.runId);
    },
  };
}

/** A local stand-in (the tests and the local server): the same wrapper as a child process; root holds each session's folder. */
export function localRunner({ root = join(tmpdir(), 'mb-runs'), repo = ROOT, env: baseEnv = {} } = {}) {
  const runs = new Map(); // name (as a sandbox's) -> { runId, session, child, dir, createdAt, running }
  return {
    kind: 'local',
    // (never installs Muse here: this machine's own Muse, MUSE_BIN or ~/.local/bin/muse, or the stub in `args`)
    async start({ runId, prompt, slug, key = null, args = [], env = {}, session = 0, seed = null }) {
      const name = nameOf(runId, session);
      const dir = join(root, session ? `${runId}-r${session}` : runId); // (a fresh folder per session, as a sandbox is)
      mkdirSync(join(dir, '.run'), { recursive: true });
      writeFileSync(join(dir, '.run/prompt.txt'), prompt);
      const files = seedFiles(join(dir, 'episodes/live', slug), seed);
      if (files.length) mkdirSync(join(dir, 'episodes/live', slug), { recursive: true });
      for (const f of files) writeFileSync(f.path, f.content);
      const argv = wrapperArgs(dir, { slug, installMuse: false, args }).map((a) => a.replace(`${dir}/scripts/`, `${repo}/scripts/`));
      const child = spawn(process.execPath, argv, { cwd: repo, stdio: 'ignore', env: { ...process.env, ...baseEnv, ...env, ...(key ? { META_API_KEY: key } : {}) } });
      const run = { runId, session, child, dir, createdAt: Date.now(), running: true };
      child.on('close', () => { run.running = false; });
      runs.set(name, run);
      return { name };
    },
    async read(runId, session = 0) {
      const run = runs.get(nameOf(runId, session));
      if (!run || run.stopped) return null;
      try { return JSON.parse(readFileSync(join(run.dir, '.run/snapshot.json'), 'utf8')); } catch { return run.running ? { v: 1, state: 'planning', phase: 'starting', files: {}, log: [] } : null; }
    },
    async stop(runId, session = 0) {
      const run = runs.get(nameOf(runId, session));
      if (!run) return;
      run.stopped = true;
      if (run.running) run.child.kill('SIGTERM');
    },
    async list() { return [...runs.values()].map((r) => ({ runId: r.runId, session: r.session, createdAt: r.createdAt, running: r.running && !r.stopped })).reverse(); },
  };
}
