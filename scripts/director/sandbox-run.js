#!/usr/bin/env node
// A hosted director run, inside its sandbox (server/runner.js: a Vercel Sandbox, or the local stand-in the tests and
// `npm run dev` use). It installs Muse Code when asked, runs direct.js --live on the prompt, and about once a second
// writes the run's snapshot for the API to serve (the same views as the dev server's scripts/director/live.js): the
// bundle so far, the events written ahead of their beat (queued), the production's activity so far, the state and
// the log's tail.
//
//   node scripts/director/sandbox-run.js --prompt-file <file> --out <bundle dir> --slug <slug> --snapshot <file>
//     [--install-muse] [-- <more direct.js options>]
//
// The key (META_API_KEY) comes only from this process's environment: it is passed on to direct.js and Muse and never
// written anywhere; any copy of it in what the snapshot carries (a line, a log, an error) is replaced by [redacted].
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { queuedOf } from './live.js';
import { liveActivity, ACTIVITY_FILE } from './activity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_VERSION = 1;
/** The bundle's files a snapshot carries, as text (the API serves each under /api/direct/<run>/<file>). */
export const SNAPSHOT_FILES = ['events.ndjson', 'beats.json', 'director.json', 'queued.ndjson', 'activity.ndjson'];
const MUSE_LAUNCHER = 'https://api.meta.ai/muse-launcher.sh';

/** Every copy of each secret (8+ characters) in a text replaced by [redacted]. */
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const k of secrets) if (k && k.length >= 8) s = s.split(k).join('[redacted]');
  return s;
}

/**
 * The run's state as the dev server reports it (live.js status): planning (no plan yet), working, then done (the
 * gate passed) or failed. phase says more while planning: installing (Muse Code is being installed) or directing.
 */
export function stateOf({ running, beats, director, exit, phase }) {
  if (running) return beats ? 'working' : 'planning';
  if (phase === 'install-failed') return 'failed';
  return director?.gate?.ok && exit === 0 ? 'done' : 'failed';
}

/**
 * Why a run failed, in a line for the page: Muse's own error when it stopped with one (a rejected key, a quota), else
 * the gate's first problem; null when it did not fail.
 */
export function reasonOf(director, { phase = null } = {}) {
  if (phase === 'install-failed') return 'Muse Code could not be installed in the sandbox';
  if (director?.gate?.ok) return null;
  const err = (director?.runs ?? []).flatMap((r) => (r.exit !== 0 ? r.stderr ?? [] : []));
  const muse = err.find((l) => /reject|authenticat|unauthori|forbidden|quota|rate.?limit|billing|credit|invalid|denied|expired/i.test(l)) ?? err.at(-1);
  // (Muse's "authentication failed: your API key from META_API_KEY was rejected — update or unset it", for the page)
  if (muse && /META_API_KEY was rejected|authentication failed/i.test(muse)) return 'the Meta API key was rejected: check it, then press Make it again';
  if (muse) return `Muse Code: ${muse}`;
  return director?.gate?.problems?.[0] ?? null;
}

function parseArgs(argv) {
  const o = { extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.extra = argv.slice(i + 1); break; }
    if (a === '--install-muse') o.installMuse = true;
    else if (['--prompt-file', '--out', '--slug', '--snapshot'].includes(a)) o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return o;
}

const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const readLines = (text) => (text ?? '').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const ndjson = (list) => list.map((e) => JSON.stringify(e)).join('\n') + (list.length ? '\n' : '');

/** Install Muse Code from Meta's launcher into ~/.local/bin/muse (a public download, no login). Returns { ok, bin, version, log }. */
export function installMuse({ home = homedir(), launcher = MUSE_LAUNCHER } = {}) {
  const bin = join(home, '.local/bin/muse');
  const script = `set -eu
mkdir -p "$(dirname "$MB_MUSE_BIN")"
curl -fsSL --retry 3 --max-time 120 "$MB_MUSE_LAUNCHER" -o "$MB_MUSE_BIN.tmp"
chmod 0755 "$MB_MUSE_BIN.tmp"
mv -f "$MB_MUSE_BIN.tmp" "$MB_MUSE_BIN"
MUSE_LOGIN=0 MUSE_SYNC_UPDATE=1 "$MB_MUSE_BIN" --version`;
  // (only what the install needs: the key stays out of it)
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, MB_MUSE_BIN: bin, MB_MUSE_LAUNCHER: launcher };
  const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  const version = (r.stdout || '').trim().split('\n').at(-1)?.replace(/^Muse Code\s*/i, '') ?? '';
  return { ok: r.status === 0 && /\d+\.\d+/.test(version), bin, version, log: (r.stderr || '').trim().split('\n').filter(Boolean).slice(-3) };
}

async function main(argv) {
  const o = parseArgs(argv);
  if (!o.promptFile || !o.out || !o.slug || !o.snapshot) {
    console.error('usage: sandbox-run.js --prompt-file <f> --out <dir> --slug <s> --snapshot <file> [--install-muse] [-- <direct.js options>]');
    return 2;
  }
  const prompt = readFileSync(o.promptFile, 'utf8').trim();
  const out = resolve(o.out);
  const secrets = [process.env.META_API_KEY].filter(Boolean);
  const startedAt = Date.now();
  const log = [];
  const keep = (chunk) => { for (const l of String(chunk).split('\n')) if (l.trim()) { log.push(redact(l.replace(/^\[direct\] /, ''), secrets).slice(0, 400)); if (log.length > 60) log.shift(); } };
  let phase = o.installMuse ? 'installing' : 'directing', exit = null, running = true, actAt = 0, actText = '';
  mkdirSync(dirname(resolve(o.snapshot)), { recursive: true });

  /** One snapshot, written whole (a reader never sees half of it). */
  function snapshot() {
    const events = readText(join(out, 'events.ndjson')) ?? '';
    const beats = readText(join(out, 'beats.json'));
    const director = readText(join(out, 'director.json'));
    // the activity: the recorded log once the run wrote it, else as it goes (the session logs are read every 3 s at most)
    if (existsSync(join(out, ACTIVITY_FILE))) actText = readText(join(out, ACTIVITY_FILE)) ?? '';
    else if (Date.now() - actAt >= 3000 || !running) { actAt = Date.now(); actText = ndjson(liveActivity(out, { events: readLines(events) })); }
    const dirJson = director ? (() => { try { return JSON.parse(director); } catch { return null; } })() : null;
    const beatsJson = beats ? (() => { try { return JSON.parse(beats); } catch { return null; } })() : null;
    const state = stateOf({ running, beats: beatsJson, director: dirJson, exit, phase });
    const snap = {
      v: SNAPSHOT_VERSION, slug: o.slug, prompt, state, phase, reason: state === 'failed' ? reasonOf(dirJson, { phase }) ?? log.at(-1) ?? null : null,
      startedAt, seconds: Math.round((Date.now() - startedAt) / 1000), exit, title: beatsJson?.title ?? null,
      events: readLines(events).length, log: log.slice(-8),
      files: { 'events.ndjson': events, 'beats.json': beats, 'director.json': director, 'queued.ndjson': ndjson(queuedOf(out)), 'activity.ndjson': actText },
    };
    const text = redact(JSON.stringify(snap), secrets);
    const tmp = `${o.snapshot}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, o.snapshot);
  }
  const tick = () => { try { snapshot(); } catch (err) { keep(`snapshot: ${err.message}`); } };
  tick();
  const timer = setInterval(tick, 1000);

  let museArgs = [];
  if (o.installMuse) {
    keep('installing Muse Code');
    const r = installMuse();
    if (!r.ok) {
      for (const l of r.log) keep(`muse install: ${l}`);
      keep('Muse Code could not be installed');
      phase = 'install-failed'; running = false; exit = 1;
      clearInterval(timer); tick();
      return 1;
    }
    keep(`Muse Code ${r.version} installed`);
    museArgs = ['--muse', r.bin];
  }
  phase = 'directing';
  const child = spawn(process.execPath, [join(HERE, 'direct.js'), prompt, '--live', '--out', out, '--slug', o.slug, ...museArgs, ...o.extra], {
    cwd: resolve(HERE, '../..'), stdio: ['ignore', 'pipe', 'pipe'],
    // (no update checks mid-run; the key reaches Muse through this environment only)
    env: { ...process.env, MUSE_NO_AUTO_UPDATE: '1', MUSE_LOGIN: '0' },
  });
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const stop = () => { try { child.kill('SIGINT'); } catch { /* gone */ } };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  exit = await new Promise((ok) => { child.on('close', (code) => ok(code ?? 1)); child.on('error', (e) => { keep(`spawn failed: ${e.message}`); ok(1); }); });
  running = false;
  clearInterval(timer);
  tick();
  return exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
