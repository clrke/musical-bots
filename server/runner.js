// Where a hosted director run happens (server/app.js). Both runners start scripts/director/sandbox-run.js, which
// installs Muse Code (when asked), runs direct.js --live and writes the run's snapshot about once a second:
//   sandboxRunner()  one Vercel Sandbox (a Firecracker microVM) per run: the director's files are copied in, the run
//                    starts detached with the key in that one command's environment, the sandbox is not persistent
//                    (nothing is snapshotted on stop) and is stopped when the run is over (its session timeout is the
//                    backstop);
//   localRunner()    a child process on this machine (the tests, scripts/vercel/serve.mjs).
// Interface: start({ runId, prompt, slug, key, args, env, installMuse }) -> { name }; read(runId) -> the snapshot or
// null (no such run, or it is gone); stop(runId); list() -> [{ runId, createdAt, running }].
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** What a run needs, relative to the repo: the director, its prompts and briefs, the gate, the web modules it imports. */
export const SHIPPED = ['director', 'scripts/director', 'scripts/validate-bundle.js', 'web/src'];
export const SANDBOX_TAG = 'musical-bots';
const nameOf = (runId) => `mb-${runId}`;
const runIdOf = (name) => (String(name).startsWith('mb-') ? String(name).slice(3) : null);

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
 * Vercel Sandbox. opts: vcpus (2: 4 GB), timeoutMs (the session's hard limit: Hobby allows 45 min), files (the
 * director's), sdk (the @vercel/sandbox module, for tests), credentials (token/teamId/projectId outside Vercel; on
 * Vercel and with `vercel env pull` the OIDC token is used).
 */
export function sandboxRunner({ vcpus = 2, timeoutMs = 42 * 60_000, files = () => directorFiles(), sdk = null, credentials = {}, base = '/vercel/mb' } = {}) {
  // Muse's own shell sandbox can't run in a Vercel Sandbox (its bubblewrap: the user's processes hold every capability,
  // Ubuntu's bwrap lacks --perms, the embedded one can't mount /proc), so every bash call failed and the director ended
  // its turn without a plan (Nov 1-2). The microVM, one per run and never kept, is the boundary: Muse's shell runs bare.
  const directArgs = ['--no-muse-sandbox'];
  let mod = sdk;
  const S = async () => (mod ??= await import('@vercel/sandbox')).Sandbox;
  const handles = new Map(); // runId -> Sandbox (a warm function reuses it)
  const cache = new Map(); //   runId -> { at, value: Promise<snapshot|null> } (one read per ~second, however many requests)
  const handle = async (runId) => {
    if (handles.has(runId)) return handles.get(runId);
    const sbx = await (await S()).get({ name: nameOf(runId), ...credentials });
    handles.set(runId, sbx);
    return sbx;
  };
  return {
    kind: 'sandbox',
    async start({ runId, prompt, slug, key = null, args = [], env = {}, installMuse = true }) {
      const Sandbox = await S();
      const sbx = await Sandbox.create({ name: nameOf(runId), resources: { vcpus }, timeout: timeoutMs, persistent: false, tags: { app: SANDBOX_TAG }, ...credentials });
      try {
        await sbx.writeFiles([...files().map((f) => ({ path: `${base}/${f.path}`, content: f.content })), { path: `${base}/.run/prompt.txt`, content: Buffer.from(prompt) }]);
        // detached: the run goes on after this request; the key is in this one command's environment only
        await sbx.runCommand({ cmd: 'node', args: wrapperArgs(base, { slug, installMuse, args: [...directArgs, ...args] }), cwd: base, env: { ...env, ...(key ? { META_API_KEY: key } : {}) }, detached: true });
      } catch (err) {
        await sbx.stop().catch(() => {});
        throw err;
      }
      handles.set(runId, sbx);
      return { name: nameOf(runId) };
    },
    /** The run's snapshot, or null when the sandbox is gone (stopped, timed out, never was). */
    async read(runId) {
      const c = cache.get(runId);
      if (c && Date.now() - c.at < 900) return c.value;
      const value = (async () => {
        try {
          const buf = await (await handle(runId)).readFileToBuffer({ path: `${base}/.run/snapshot.json` });
          return buf ? JSON.parse(buf.toString('utf8')) : { v: 1, state: 'planning', phase: 'starting', files: {}, log: [] };
        } catch (err) {
          handles.delete(runId);
          // gone: stopped (a non-persistent sandbox can't resume: "Cannot resume sandbox: no snapshot available"),
          // timed out, or never was; anything else is a hiccup (the caller keeps the last snapshot)
          if (/not.?found|404|410|stopped|gone|cannot resume|no snapshot/i.test(`${err?.message} ${err?.status ?? ''}`)) return null;
          throw err;
        }
      })();
      cache.set(runId, { at: Date.now(), value });
      value.catch(() => cache.delete(runId));
      return value;
    },
    async stop(runId) {
      cache.delete(runId);
      try { await (await handle(runId)).stop(); } catch { /* already gone */ }
      handles.delete(runId);
    },
    /** The latest runs' sandboxes (newest first): enough to count the running ones and find stale ones. */
    async list() {
      const r = await (await S()).list({ tags: { app: SANDBOX_TAG }, sortBy: 'createdAt', sortOrder: 'desc', limit: 25, ...credentials });
      return (r.sandboxes ?? []).map((s) => ({ runId: runIdOf(s.name), createdAt: s.createdAt, running: ['pending', 'running'].includes(s.status) })).filter((s) => s.runId);
    },
  };
}

/** A local stand-in (the tests and the local server): the same wrapper as a child process; root holds each run. */
export function localRunner({ root = join(tmpdir(), 'mb-runs'), repo = ROOT, env: baseEnv = {} } = {}) {
  const runs = new Map(); // runId -> { child, dir, createdAt, running }
  return {
    kind: 'local',
    // (never installs Muse here: this machine's own Muse, MUSE_BIN or ~/.local/bin/muse, or the stub in `args`)
    async start({ runId, prompt, slug, key = null, args = [], env = {} }) {
      const dir = join(root, runId);
      mkdirSync(join(dir, '.run'), { recursive: true });
      writeFileSync(join(dir, '.run/prompt.txt'), prompt);
      const argv = wrapperArgs(dir, { slug, installMuse: false, args }).map((a) => a.replace(`${dir}/scripts/`, `${repo}/scripts/`));
      const child = spawn(process.execPath, argv, { cwd: repo, stdio: 'ignore', env: { ...process.env, ...baseEnv, ...env, ...(key ? { META_API_KEY: key } : {}) } });
      const run = { child, dir, createdAt: Date.now(), running: true };
      child.on('close', () => { run.running = false; });
      runs.set(runId, run);
      return { name: runId };
    },
    async read(runId) {
      const run = runs.get(runId);
      if (!run || run.stopped) return null;
      try { return JSON.parse(readFileSync(join(run.dir, '.run/snapshot.json'), 'utf8')); } catch { return run.running ? { v: 1, state: 'planning', phase: 'starting', files: {}, log: [] } : null; }
    },
    async stop(runId) {
      const run = runs.get(runId);
      if (!run) return;
      run.stopped = true;
      if (run.running) run.child.kill('SIGTERM');
    },
    async list() { return [...runs.entries()].map(([runId, r]) => ({ runId, createdAt: r.createdAt, running: r.running && !r.stopped })).reverse(); },
  };
}
