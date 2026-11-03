// The hosted Muse Code director (the Vercel deployment's API; api/index.js). The same doors as the dev server's
// scripts/director/live.js, so the page's LIVE making-of plays a hosted run as it is written, then its premiere:
//   GET    /api/direct                        { available, hosted, modes, email, user, limits }   (the page probes it)
//   POST   /api/direct { prompt, mode, key? } 202 { slug (the run's id), status, events, beats, director, queued, activity, share }
//            mode byok:      the user's own Meta Model API key, sent once, used for this run only (never stored or logged)
//            mode credits:   a signed-in user's approved runs, on the owner's key (one credit, spent atomically)
//            mode rehearsal: the owner only (ADMIN_TOKEN): the stub Muse in a real sandbox, free
//   GET    /api/direct/<run>                  { state: planning|working|done|failed, phase, events, title, log, director, ... }
//   GET    /api/direct/<run>/events.ndjson | beats.json | director.json | queued.ndjson | activity.ndjson
//   GET    /api/direct/<run>/poster.webp      the episode's poster (Muse Image), once the run is done
//   DELETE /api/direct/<run>                  stops it
//   GET    /api/share/<run>                   a share link's preview for link crawlers (middleware.js sends their
//                                             /?run=<id> here): the episode's title and poster, then the app
// Sign-in and credits (email one-time codes; the owner approves requests by signed single-use links or the admin page):
//   POST /api/auth/code { email }   POST /api/auth/verify { email, code }   POST /api/auth/logout   GET /api/auth/me
//   POST /api/credits/request { reason[, email] }   GET|POST /api/credits/decide?t=<signed link>
//   GET /api/admin (the owner's page)   GET /api/admin/requests   POST /api/admin/requests/<id> { action }
//   GET /api/health
// Guards: a prompt of 1-200 characters, at most MAX_CONCURRENT_RUNS runs at once, RUNS_PER_IP_PER_DAY run starts per
// IP, a run timeout (the sandbox's session limit, and a stop when a poll finds it over time), the code and request
// rate limits, one credit spent per run (refunded when the sandbox never got to direct).
import { codeHash, CODE_ATTEMPTS, CODE_MINUTES, hashOf, newCode, newId, newRunId, normalEmail, parseCookies, sameCode, sameSecret, sessionCookie, SESSION_COOKIE, SESSION_DAYS, sign, verify } from './auth.js';
import { codeMail, outcomeMail, requestMail } from './mail.js';
import { update } from './store.js';

export const FILES = ['events.ndjson', 'beats.json', 'director.json', 'queued.ndjson', 'activity.ndjson'];
const RUN_ID = /^[a-z0-9]{20,40}$/;
const KEY = /^[\x21-\x7e]{16,512}$/; // printable, no spaces
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugOf = (prompt) => `${String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '') || 'episode'}`;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const hour = (t = Date.now()) => new Date(t).toISOString().slice(0, 13);

/** The settings from the environment (each with its default). */
export function configFrom(env = process.env) {
  const num = (k, d) => (Number.isFinite(Number(env[k])) && env[k] !== '' && env[k] !== undefined ? Number(env[k]) : d);
  return {
    secret: env.SESSION_SECRET || '',
    ownerEmail: normalEmail(env.OWNER_EMAIL || 'clarke.plumo@gmail.com'),
    adminToken: env.ADMIN_TOKEN || '',
    ownerKey: env.META_API_KEY || '',
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    creditsPerGrant: num('CREDITS_PER_GRANT', 3),
    maxConcurrent: num('MAX_CONCURRENT_RUNS', 2),
    runsPerIpPerDay: num('RUNS_PER_IP_PER_DAY', 4),
    maxPrompt: num('MAX_PROMPT', 200),
    runMinutes: num('RUN_TIMEOUT_MIN', 40),
    directArgs: (env.MB_RUNNER_ARGS || '').trim().split(/\s+/).filter(Boolean),
  };
}

/**
 * The app: a connect-style (req, res) handler. deps: { store, runner, mailer, config, log, now }. The request's body
 * may be parsed already (Vercel's req.body) or not (the tests and the local server stream it).
 */
export function createApp({ store, runner, mailer, config = configFrom(), log = console.error, now = () => Date.now(), info = () => ({}) }) {
  const C = config;
  const runs = new Map(); // runId -> { at, rec } (a warm instance keeps a run's record; a finished one for good)

  // ---- plumbing ------------------------------------------------------------------------------
  const send = (res, code, body, headers = {}) => {
    res.statusCode = code;
    for (const [k, v] of Object.entries({ 'cache-control': 'no-store', ...headers })) res.setHeader(k, v);
    res.end(body);
  };
  const json = (res, code, body, headers = {}) => send(res, code, JSON.stringify(body), { 'content-type': 'application/json', ...headers });
  const html = (res, code, body) => send(res, code, body, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  async function bodyOf(req) {
    let parsed;
    try { parsed = req.body; } catch { return null; } // (Vercel parses it on access: bad JSON throws)
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) return parsed;
    let raw = typeof parsed === 'string' ? parsed : Buffer.isBuffer(parsed) ? parsed.toString('utf8') : '';
    if (!raw && req.readable !== false && typeof req.on === 'function') {
      raw = await new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 64 * 1024) b = b.slice(0, 64 * 1024); }); req.on('end', () => ok(b)); req.on('error', () => ok(b)); });
    }
    const type = String(req.headers?.['content-type'] ?? '');
    if (/x-www-form-urlencoded/.test(type)) return Object.fromEntries(new URLSearchParams(raw));
    try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
  }
  const ipOf = (req) => String(req.headers?.['x-forwarded-for'] ?? req.headers?.['x-real-ip'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim() || 'unknown';
  const originOf = (req) => C.appUrl || `${req.headers?.['x-forwarded-proto'] ?? 'https'}://${req.headers?.['x-forwarded-host'] ?? req.headers?.host ?? 'localhost'}`;
  const secure = (req) => !/^http:\/\/(localhost|127\.0\.0\.1)/.test(originOf(req));
  /** A cross-site POST is refused: JSON bodies need a preflight, and a foreign Origin is turned away. */
  function sameSite(req) {
    const o = req.headers?.origin;
    if (!o) return true;
    try { return new URL(o).host === (req.headers?.['x-forwarded-host'] ?? req.headers?.host); } catch { return false; }
  }
  const userKey = (email) => `users/${hashOf(C.secret, 'email', email)}`;
  function sessionOf(req) {
    const t = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
    const p = t ? verify(C.secret, t) : null;
    return p?.kind === 'session' && normalEmail(p.email) ? { email: p.email } : null;
  }
  function isAdmin(req) {
    const auth = String(req.headers?.authorization ?? '');
    if (auth.startsWith('Bearer ') && sameSecret(auth.slice(7).trim(), C.adminToken)) return true;
    const s = sessionOf(req);
    return Boolean(s && C.ownerEmail && s.email === C.ownerEmail);
  }
  /** Counts one action in a window; false once the window has had `limit` (a write per action: only real actions count). */
  async function allow(kind, who, limit, window) {
    if (!(limit > 0)) return true;
    let ok = false;
    await update(store, `limits/${kind}/${hashOf(C.secret, kind, who)}-${window}`, (cur) => {
      const n = cur?.n ?? 0;
      ok = n < limit;
      return ok ? { n: n + 1 } : undefined;
    });
    return ok;
  }
  const redactOwner = (text) => (C.ownerKey && C.ownerKey.length >= 8 ? String(text ?? '').split(C.ownerKey).join('[redacted]') : text);

  // ---- users and credits --------------------------------------------------------------------
  async function userOf(email) { return (await store.get(userKey(email)))?.value ?? null; }
  const publicUser = (email, u) => ({ email, credits: u?.credits ?? 0, used: u?.used ?? 0, request: u?.request ?? null });
  /** Spend one credit (false when there is none). */
  async function spend(email) {
    let spent = false;
    await update(store, userKey(email), (u) => {
      spent = false;
      if (!u || !(u.credits > 0)) return undefined;
      spent = true;
      return { ...u, credits: u.credits - 1, used: (u.used ?? 0) + 1 };
    });
    return spent;
  }
  const refund = (email) => update(store, userKey(email), (u) => (u ? { ...u, credits: (u.credits ?? 0) + 1, used: Math.max(0, (u.used ?? 1) - 1) } : undefined));

  // ---- runs ------------------------------------------------------------------------------------
  const runKey = (id) => `runs/${id}`;
  const posterKey = (id) => `posters/${id}`;
  /** The snapshot's poster (base64 WebP, at most 2 MB), or null. */
  const posterOf = (snap) => {
    const b64 = snap?.poster;
    if (typeof b64 !== 'string' || b64.length > 2_800_000) return null;
    const b = Buffer.from(b64, 'base64');
    return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? b : null;
  };
  const urlsOf = (id) => {
    const base = `/api/direct/${id}`;
    return { slug: id, status: base, events: `${base}/events.ndjson`, beats: `${base}/beats.json`, director: `${base}/director.json`, queued: `${base}/queued.ndjson`, activity: `${base}/activity.ndjson`, share: `/?run=${id}` };
  };
  async function record(id, { fresh = false } = {}) {
    const c = runs.get(id);
    if (c && (c.rec.state !== 'running' || (!fresh && now() - c.at < 30_000))) return c.rec;
    const rec = (await store.get(runKey(id)))?.value ?? null;
    if (rec) runs.set(id, { ...c, at: now(), rec });
    return rec;
  }
  /** A run over: its bundle kept for good (the premiere and the share link), its sandbox stopped, a credit back if it never directed. */
  async function finalize(id, rec, snap, why = null) {
    const files = Object.fromEntries(FILES.map((f) => [f, typeof snap?.files?.[f] === 'string' ? redactOwner(snap.files[f]) : null]));
    const state = why ? 'failed' : snap?.state === 'done' ? 'done' : 'failed';
    const log = [...(snap?.log ?? []), ...(why ? [why] : [])].slice(-8).map(redactOwner);
    const reason = state === 'failed' ? redactOwner(why ?? snap?.reason ?? log.at(-1) ?? 'the run ended') : null;
    const final = { ...rec, state, phase: snap?.phase ?? null, reason, exit: snap?.exit ?? null, title: snap?.title ?? null, events: snap?.events ?? 0,
      seconds: snap?.seconds ?? Math.round((now() - rec.startedAt) / 1000), log, files, finishedAt: now() };
    const r = await update(store, runKey(id), (cur) => (cur?.state === 'running' ? final : undefined));
    // the episode's poster (Muse Image, drawn in the sandbox: sandbox-run.js), kept apart from the record (it is big)
    const poster = state === 'done' && r.changed ? posterOf(snap) : null;
    if (poster) await store.put(posterKey(id), { webp: poster.toString('base64') }).catch((err) => log(`run ${id}: poster not kept: ${String(err?.message ?? err).slice(0, 200)}`));
    await runner.stop(id).catch(() => {});
    if (r.changed && rec.mode === 'credits' && rec.email && (snap?.phase === 'install-failed' || !snap)) await refund(rec.email).catch(() => {});
    const done = r.changed ? final : r.value ?? final;
    runs.set(id, { at: now(), rec: done });
    return done;
  }
  /** The run as it is now: { rec, snap } while it runs (snap: its sandbox's snapshot), { rec } once it is over. */
  async function view(id) {
    let rec = await record(id);
    if (!rec) return null;
    if (rec.state !== 'running') return { rec };
    let snap;
    try { snap = await runner.read(id); } catch (err) { log(`run ${id}: read failed: ${String(err?.message ?? err).slice(0, 200)}`); snap = undefined; }
    // (a hiccup reading the sandbox: the last snapshot this instance saw, and the next poll tries again)
    if (snap === undefined) return { rec, snap: runs.get(id)?.snap ?? { state: 'planning', phase: 'waiting', files: {}, log: [] } };
    if (snap) runs.set(id, { ...runs.get(id), rec, snap });
    if (snap === null) {
      // the sandbox is gone: another instance finalized it, or it ended without a bundle
      rec = await record(id, { fresh: true });
      if (rec.state !== 'running') return { rec };
      if (now() - rec.startedAt < 90_000) return { rec, snap: { state: 'planning', phase: 'starting', files: {}, log: [] } };
      return { rec: await finalize(id, rec, null, 'the run ended before its bundle was saved') };
    }
    if (snap.state === 'done' || snap.state === 'failed') return { rec: await finalize(id, rec, snap) };
    if (now() - rec.startedAt > C.runMinutes * 60_000) return { rec: await finalize(id, rec, snap, `stopped: over the ${C.runMinutes}-minute limit`) };
    return { rec, snap };
  }
  const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  function statusOf(id, { rec, snap }) {
    const s = snap ?? rec;
    const files = (snap ?? rec).files ?? {};
    const director = parse(files['director.json']);
    return { slug: id, state: s.state, phase: s.phase ?? null, reason: s.reason ? redactOwner(s.reason) : null, prompt: rec.prompt, title: s.title ?? parse(files['beats.json'])?.title ?? null,
      events: s.events ?? 0, seconds: snap ? (snap.seconds ?? Math.round((now() - rec.startedAt) / 1000)) : rec.seconds ?? null,
      exit: s.exit ?? null, log: (s.log ?? []).map(redactOwner), director, mode: rec.mode, share: `/?run=${id}` };
  }
  /** Runs still going, oldest first; one that is over (or over time) is wrapped up on the way, so it frees its slot. */
  async function running() {
    const list = (await runner.list()).filter((r) => r.running);
    const live = [];
    for (const r of list) {
      const rec = await record(r.runId).catch(() => null);
      if (!rec) { if (now() - r.createdAt > (C.runMinutes + 5) * 60_000) await runner.stop(r.runId).catch(() => {}); else live.push(r); continue; }
      const v = await view(r.runId).catch(() => null);
      if (v?.rec?.state === 'running') live.push(r);
    }
    return live;
  }

  async function startRun(req, res) {
    if (!sameSite(req)) return json(res, 403, { error: 'cross-site request refused' });
    const b = await bodyOf(req);
    if (!b) return json(res, 400, { error: 'a JSON body' });
    const prompt = String(b.prompt ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!prompt || prompt.length > C.maxPrompt) return json(res, 400, { error: `a prompt of 1-${C.maxPrompt} characters` });
    const mode = String(b.mode ?? '');
    let email = null, key = null, args = [...C.directArgs], env = {}, installMuse = true;
    if (mode === 'byok') {
      key = typeof b.key === 'string' ? b.key.trim() : '';
      if (!KEY.test(key)) return json(res, 400, { error: 'paste a Meta Model API key (16-512 characters, no spaces)' });
    } else if (mode === 'credits') {
      const s = sessionOf(req);
      if (!s) return json(res, 401, { error: 'sign in first' });
      if (!C.ownerKey) return json(res, 503, { error: "the owner's key isn't set up yet: use your own key for now" });
      email = s.email;
      key = C.ownerKey;
    } else if (mode === 'rehearsal') {
      if (!isAdmin(req)) return json(res, 403, { error: 'rehearsals are for the owner' });
      args = ['--muse', 'scripts/director/stub-muse.js'];
      env = { STUB_MUSE_DELAY_MS: String(Number(b.delayMs) > 0 ? Math.min(5000, Number(b.delayMs)) : 700) };
      installMuse = false;
      // (the owner's key, when set, for the poster only: the stub crew needs none; a rehearsal then checks the Muse
      // Image path end to end in a real sandbox, for one $0.01 image)
      key = C.ownerKey || null;
    } else return json(res, 400, { error: 'mode: byok, credits or rehearsal' });
    // the guards: runs at once, then run starts per IP
    const live = await running();
    if (live.length >= C.maxConcurrent) return json(res, 503, { error: `the director is busy with ${live.length} run${live.length > 1 ? 's' : ''}: try again in a few minutes`, busy: true });
    if (mode !== 'rehearsal' && !(await allow('run', ipOf(req), C.runsPerIpPerDay, day(now())))) return json(res, 429, { error: `at most ${C.runsPerIpPerDay} new runs a day from one place: try again tomorrow` });
    if (mode === 'credits' && !(await spend(email))) return json(res, 402, { error: 'no runs left: request more credits', credits: 0 });
    const id = newRunId();
    const slug = slugOf(prompt);
    const rec = { id, slug, prompt, mode, state: 'running', startedAt: now(), ...(email ? { email } : {}), ip: hashOf(C.secret, 'ip', ipOf(req)) };
    try {
      await store.put(runKey(id), rec, { ifNone: true });
      runs.set(id, { at: now(), rec });
      await runner.start({ runId: id, prompt, slug, key, args: [...args, '--no-repo', '--timeout', String(Math.max(300, Math.floor((C.runMinutes * 60 - 120) / 2)))], env, installMuse });
    } catch (err) {
      log(`run ${id}: start failed: ${redactOwner(String(err?.message ?? err)).split(key || '\u0000').join('[redacted]').slice(0, 300)}`);
      await update(store, runKey(id), (cur) => (cur ? { ...cur, state: 'failed', log: ['the sandbox could not start'], files: {}, finishedAt: now() } : undefined)).catch(() => {});
      runs.delete(id);
      if (email) await refund(email).catch(() => {});
      return json(res, 502, { error: 'the run could not start: try again in a minute' });
    }
    return json(res, 202, urlsOf(id));
  }

  async function serveRun(req, res, id, file) {
    if (!RUN_ID.test(id)) return json(res, 400, { error: 'bad run id' });
    if (req.method === 'DELETE' && !file) {
      const rec = await record(id);
      if (!rec) return json(res, 404, { error: 'no such run' });
      if (rec.state === 'running') {
        const snap = await runner.read(id).catch(() => null);
        await finalize(id, rec, snap, 'stopped');
      }
      return json(res, 200, { stopped: true });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'GET' });
    if (file === 'poster.webp') {
      const p = (await store.get(posterKey(id)))?.value?.webp;
      if (typeof p !== 'string') return send(res, 404, '');
      return send(res, 200, Buffer.from(p, 'base64'), { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' });
    }
    const v = await view(id);
    if (!v) return json(res, 404, { error: 'no such run' });
    if (!file) return json(res, 200, statusOf(id, v));
    if (!FILES.includes(file)) return json(res, 404, { error: 'not found' });
    const text = redactOwner((v.snap ?? v.rec).files?.[file] ?? null);
    if (text === null || text === undefined || (text === '' && file.endsWith('.json'))) return send(res, 404, '');
    const over = !v.snap;
    return send(res, 200, text, { 'content-type': file.endsWith('.ndjson') ? 'application/x-ndjson' : 'application/json', 'cache-control': over ? 'private, max-age=300' : 'no-store' });
  }

  /** A share link as a link crawler sees it (X, Slack, Discord, WhatsApp...): the episode's title and poster. */
  async function sharePage(req, res, id) {
    const origin = originOf(req).replace(/\/+$/, '');
    let title = 'Musical Bots', image = `${origin}/episodes/why-musical-bots/poster.webp`;
    let description = 'Eight AI agents write an original sing-along episode from a prompt, singing their thinking as they work.';
    const app = RUN_ID.test(id) ? `${origin}/?run=${id}` : `${origin}/`;
    if (RUN_ID.test(id)) {
      const rec = await record(id).catch(() => null);
      if (rec?.state === 'done') {
        title = `${rec.title ?? 'A new episode'} · Musical Bots`;
        description = `"${String(rec.prompt ?? '').slice(0, 140)}": written live by a Muse Code crew of eight AI agents, then sung by 16 bots.`;
        if ((await store.get(posterKey(id)).catch(() => null))?.value?.webp) image = `${origin}/api/direct/${id}/poster.webp`;
      }
    }
    const m = (k, v, attr = 'property') => `<meta ${attr}="${k}" content="${esc(v)}">`;
    return html(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
${m('og:title', title)}${m('og:description', description)}${m('og:image', image)}${m('og:url', app)}${m('og:type', 'website')}
${m('twitter:card', 'summary_large_image', 'name')}${m('twitter:image', image, 'name')}<link rel="canonical" href="${esc(app)}">
<meta http-equiv="refresh" content="0;url=${esc(app)}"></head><body><a href="${esc(app)}">${esc(title)}</a></body></html>`);
  }

  // ---- sign-in -------------------------------------------------------------------------------
  async function sendCode(req, res) {
    if (!sameSite(req)) return json(res, 403, { error: 'cross-site request refused' });
    const b = await bodyOf(req);
    const email = normalEmail(b?.email);
    if (!email) return json(res, 400, { error: 'an email address' });
    if (!mailer.configured) return json(res, 200, { sent: false, emailConfigured: false, message: "Email sign-in isn't set up yet. You can still ask for runs below, or use your own key." });
    if (!(await allow('code-ip', ipOf(req), 8, hour(now()))) || !(await allow('code-email', email, 4, hour(now())))) return json(res, 429, { error: 'too many codes: try again in an hour' });
    const code = newCode();
    await store.put(`codes/${hashOf(C.secret, 'email', email)}`, { h: codeHash(C.secret, email, code), exp: now() + CODE_MINUTES * 60_000, tries: 0 });
    const ok = await mailer.send({ to: email, ...codeMail(code, CODE_MINUTES) });
    if (!ok) return json(res, 502, { error: "the code couldn't be emailed: try again later" });
    return json(res, 200, { sent: true, minutes: CODE_MINUTES });
  }
  async function verifyCode(req, res) {
    if (!sameSite(req)) return json(res, 403, { error: 'cross-site request refused' });
    const b = await bodyOf(req);
    const email = normalEmail(b?.email);
    const code = String(b?.code ?? '').replace(/\D/g, '');
    if (!email || code.length !== 6) return json(res, 400, { error: 'the email and its six-digit code' });
    const key = `codes/${hashOf(C.secret, 'email', email)}`;
    let verdict = 'missing';
    await update(store, key, (cur) => {
      if (!cur || cur.exp < now()) { verdict = 'expired'; return undefined; }
      if (cur.tries >= CODE_ATTEMPTS) { verdict = 'locked'; return undefined; }
      if (cur.used) { verdict = 'expired'; return undefined; }
      if (sameCode(cur.h, codeHash(C.secret, email, code))) { verdict = 'ok'; return { ...cur, used: true }; } // single use
      verdict = 'wrong';
      return { ...cur, tries: cur.tries + 1 };
    });
    if (verdict === 'expired' || verdict === 'missing') return json(res, 400, { error: 'that code has expired: ask for a new one' });
    if (verdict === 'locked') return json(res, 429, { error: 'too many tries: ask for a new code' });
    if (verdict === 'wrong') return json(res, 400, { error: "that code doesn't match" });
    await store.del(key).catch(() => {});
    const token = sign(C.secret, { kind: 'session', email }, SESSION_DAYS * 86400);
    return json(res, 200, { user: publicUser(email, await userOf(email)) }, { 'set-cookie': sessionCookie(token, { secure: secure(req) }) });
  }

  // ---- credit requests -------------------------------------------------------------------------
  async function requestCredits(req, res) {
    if (!sameSite(req)) return json(res, 403, { error: 'cross-site request refused' });
    const b = await bodyOf(req);
    const reason = String(b?.reason ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim();
    if (reason.length < 3 || reason.length > 500) return json(res, 400, { error: 'a short reason (3-500 characters)' });
    const s = sessionOf(req);
    let email = s?.email ?? null;
    const verified = Boolean(email);
    // without email (no SMTP yet) a request can still be left with an email address: kept for the owner's admin page;
    // the runs it brings are used once that email signs in
    if (!email && !mailer.configured) email = normalEmail(b?.email);
    if (!email) return json(res, 401, { error: mailer.configured ? 'sign in first' : 'an email address' });
    if (!(await allow('request-ip', ipOf(req), 3, day(now())))) return json(res, 429, { error: 'at most 3 requests a day from one place' });
    const u = await userOf(email);
    if (u?.request?.status === 'pending') return json(res, 409, { error: 'your request is waiting for the owner', request: u.request });
    const id = newId(9).replace(/[^A-Za-z0-9]/g, 'x');
    const r = { id, email, reason, verified, status: 'pending', credits: C.creditsPerGrant, createdAt: now() };
    await store.put(`requests/${id}`, r, { ifNone: true });
    await update(store, userKey(email), (cur) => ({ email, credits: 0, used: 0, ...(cur ?? {}), request: { id, status: 'pending', at: now() } }));
    const base = originOf(req);
    const link = (act) => `${base}/api/credits/decide?t=${encodeURIComponent(sign(C.secret, { kind: 'decide', rid: id, act }, 14 * 86400))}`;
    const emailed = mailer.configured && C.ownerEmail
      ? await mailer.send({ to: C.ownerEmail, ...requestMail({ email, reason, credits: r.credits, approveUrl: link('approve'), denyUrl: link('deny'), adminUrl: `${base}/api/admin` }) })
      : false;
    return json(res, 200, { request: { id, status: 'pending' }, emailed, emailConfigured: mailer.configured,
      message: emailed ? "Sent: you'll get an email when the owner decides." : mailer.configured ? "Saved: the owner will see it on the admin page (the email didn't go out)." : "Saved. Email isn't set up yet, so the owner will see it on the admin page; sign in with this email once email works to use your runs." });
  }
  /** The owner's decision, once: a pending request turns approved (its credits added) or denied, and the user is told. */
  async function decide(rid, act, base, credits = null) {
    if (!['approve', 'deny'].includes(act)) return { error: 'approve or deny' };
    let r0 = null;
    const n = Number(credits) > 0 ? Math.min(50, Math.floor(Number(credits))) : null;
    const { value: r, changed } = await update(store, `requests/${rid}`, (r) => {
      r0 = r;
      if (!r || r.status !== 'pending') return undefined;
      return { ...r, status: act === 'approve' ? 'approved' : 'denied', credits: act === 'approve' ? n ?? r.credits : 0, decidedAt: now() };
    });
    if (!r0) return { error: 'no such request' };
    if (!changed) return { already: true, request: r };
    if (r.status === 'approved') {
      await update(store, userKey(r.email), (u) => ({ email: r.email, used: 0, ...(u ?? {}), credits: (u?.credits ?? 0) + r.credits, request: { id: rid, status: 'approved', at: now() } }));
    } else {
      await update(store, userKey(r.email), (u) => ({ email: r.email, credits: 0, used: 0, ...(u ?? {}), request: { id: rid, status: 'denied', at: now() } }));
    }
    const told = await mailer.send({ to: r.email, ...outcomeMail({ approved: r.status === 'approved', credits: r.credits, appUrl: `${base}/` }) });
    return { request: r, told };
  }
  async function decideLink(req, res, url) {
    const b = req.method === 'POST' ? await bodyOf(req) : null;
    const t = String((req.method === 'POST' ? b?.t : null) ?? url.searchParams.get('t') ?? '');
    const p = verify(C.secret, t);
    if (!p || p.kind !== 'decide') return html(res, 400, pageOf('This link is not valid', '<p>The link is broken or has expired. Use the admin page instead.</p>'));
    const cur = (await store.get(`requests/${p.rid}`))?.value;
    if (!cur) return html(res, 404, pageOf('No such request', '<p>That request is gone.</p>'));
    const verb = p.act === 'approve' ? 'Approve' : 'Deny';
    if (req.method !== 'POST') {
      if (cur.status !== 'pending') return html(res, 200, pageOf(`Already ${cur.status}`, `<p>${esc(cur.email)}'s request was already ${esc(cur.status)}. Each link works once.</p>`));
      // a page to confirm (a mail scanner that opens the link changes nothing)
      return html(res, 200, pageOf(`${verb} this request?`, `<p><strong>${esc(cur.email)}</strong>${cur.verified ? '' : ' (not signed in yet)'} asks for runs:</p><blockquote>${esc(cur.reason)}</blockquote>
<form method="post" action="/api/credits/decide"><input type="hidden" name="t" value="${esc(t)}">${p.act === 'approve' ? `<label>Runs <input name="credits" type="number" min="1" max="50" value="${cur.credits}"></label> ` : ''}<button type="submit">${verb}</button></form>`));
    }
    const out = await decide(p.rid, p.act, originOf(req), b?.credits);
    if (out.error) return html(res, 400, pageOf('Not done', `<p>${esc(out.error)}</p>`));
    if (out.already) return html(res, 200, pageOf(`Already ${out.request.status}`, '<p>Each link works once.</p>'));
    return html(res, 200, pageOf(out.request.status === 'approved' ? `Approved: ${out.request.credits} runs` : 'Denied', `<p>${esc(out.request.email)} ${out.told ? 'has been told by email' : "wasn't emailed (email isn't set up): they'll see it when they sign in"}.</p>`));
  }

  // ---- the owner's admin page -------------------------------------------------------------------
  async function adminRequests(req, res, id) {
    if (!isAdmin(req)) return json(res, 401, { error: 'the owner only' });
    if (req.method === 'GET' && !id) {
      const keys = await store.list('requests/');
      const list = (await Promise.all(keys.map(async (k) => (await store.get(k, { cached: false }))?.value))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, { requests: list, email: mailer.configured, ownerKey: Boolean(C.ownerKey) });
    }
    if (req.method === 'POST' && id) {
      if (!sameSite(req)) return json(res, 403, { error: 'cross-site request refused' });
      const b = await bodyOf(req);
      const out = await decide(id, b?.action, originOf(req), b?.credits);
      return json(res, out.error ? 400 : 200, out);
    }
    return json(res, 405, { error: 'GET the list, POST a decision' });
  }

  // ---- routing ---------------------------------------------------------------------------------
  return async function app(req, res, next = null) {
    const url = new URL(req.url ?? '/', 'http://x');
    // (Vercel: /api/* is rewritten to the one function with ?path=; elsewhere the path is the URL's)
    const path = url.searchParams.has('path') && url.pathname.startsWith('/api/index') ? `/api/${url.searchParams.get('path')}` : url.pathname;
    if (!path.startsWith('/api/')) return next ? next() : json(res, 404, { error: 'not found' });
    const parts = path.split('/').filter(Boolean).slice(1); // after 'api'
    try {
      // (a share link's preview only reads: it works before the director is configured too)
      if (parts[0] === 'share' && parts[1] && req.method === 'GET') return await sharePage(req, res, parts[1]);
      if (!C.secret) return json(res, 503, { available: false, error: 'the hosted director is not configured (SESSION_SECRET)' });
      const [a, b, c] = parts;
      if (a === 'direct') {
        if (!b && req.method === 'GET') {
          const s = sessionOf(req);
          return json(res, 200, { available: true, hosted: true, modes: { byok: true, credits: Boolean(C.ownerKey) }, email: mailer.configured,
            user: s ? publicUser(s.email, await userOf(s.email)) : null, limits: { maxPrompt: C.maxPrompt, minutes: C.runMinutes, perGrant: C.creditsPerGrant } });
        }
        if (!b && req.method === 'POST') return await startRun(req, res);
        if (b && parts.length <= 3) return await serveRun(req, res, b, c ?? null);
      }
      if (a === 'auth') {
        if (b === 'code' && req.method === 'POST') return await sendCode(req, res);
        if (b === 'verify' && req.method === 'POST') return await verifyCode(req, res);
        if (b === 'logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', { maxAge: 0, secure: secure(req) }) });
        if (b === 'me' && req.method === 'GET') { const s = sessionOf(req); return json(res, 200, { user: s ? publicUser(s.email, await userOf(s.email)) : null, email: mailer.configured }); }
      }
      if (a === 'credits') {
        if (b === 'request' && req.method === 'POST') return await requestCredits(req, res);
        if (b === 'decide') return await decideLink(req, res, url);
      }
      if (a === 'admin') {
        if (!b && req.method === 'GET') return html(res, 200, ADMIN_PAGE);
        if (b === 'requests') return await adminRequests(req, res, c ?? null);
      }
      if (a === 'health') return json(res, 200, { ok: true, store: store.kind, runner: runner.kind, email: mailer.configured, ownerKey: Boolean(C.ownerKey), admin: Boolean(C.adminToken), ...info() });
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      log(`${req.method} ${path}: ${redactOwner(String(err?.stack ?? err?.message ?? err)).slice(0, 600)}`);
      return json(res, 500, { error: 'something went wrong: try again' });
    }
  };
}

function pageOf(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Musical Bots</title>
<style>body{margin:0;background:#111;color:#eee;font:16px/1.55 system-ui,sans-serif}main{max-width:560px;margin:8vh auto;padding:24px;background:rgba(255,255,255,.06);border-radius:14px}
h1{font-size:22px;margin:0 0 12px}blockquote{margin:12px 0;padding:10px 14px;background:rgba(255,255,255,.08);border-left:4px solid #4f7cff;border-radius:6px}
button{padding:10px 18px;min-height:44px;border:0;border-radius:8px;background:#4f7cff;color:#fff;font-weight:700;font-size:16px;cursor:pointer}input{padding:8px;border-radius:6px;border:0;width:5em;font-size:16px;min-height:44px;box-sizing:border-box}a{color:#9db4ff}
@media (max-width:600px){main{margin:max(12px,env(safe-area-inset-top)) 10px;padding:18px 16px}}</style></head>
<body><main><h1>${esc(title)}</h1>${body}<p><a href="/">Musical Bots</a> · <a href="/api/admin">all requests</a></p></main></body></html>`;
}

/** The owner's page: the ADMIN_TOKEN (kept in this tab's sessionStorage) or the owner's own sign-in; requests to approve or deny. */
const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Requests · Musical Bots</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.5 system-ui,sans-serif;-webkit-text-size-adjust:100%}main{max-width:820px;margin:4vh auto;padding:20px}
h1{font-size:22px}button{padding:7px 14px;min-height:44px;border:0;border-radius:8px;background:#4f7cff;color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-right:6px}
button.deny{background:#a33}input{padding:8px 10px;border-radius:8px;border:0;min-width:18em;font-size:16px;min-height:44px;box-sizing:border-box}table{width:100%;border-collapse:collapse;margin-top:14px}
td,th{padding:8px;border-bottom:1px solid #333;text-align:left;vertical-align:top;overflow-wrap:anywhere}.muted{color:#999}a{color:#9db4ff}
#f{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#f label{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
@media (max-width:640px){main{margin:max(10px,env(safe-area-inset-top)) 0;padding:14px max(14px,env(safe-area-inset-left))}input{min-width:0;width:100%}#f label{flex:1 1 100%}#f button{flex:1 1 100%;margin:0}
thead{display:none}table,tbody,tr,td{display:block;width:auto}tr{border:1px solid #333;border-radius:10px;padding:6px 10px;margin:10px 0}
td{border:0;padding:4px 0}td[data-k]::before{content:attr(data-k) ': ';color:#999}td:last-child button{min-width:44%}}</style></head>
<body><main><h1>Credit requests</h1>
<form id="f"><label>Admin token <input id="tok" type="password" autocomplete="off"></label> <button>Show</button></form>
<p id="msg" class="muted" role="status"></p><table id="t" hidden><thead><tr><th>When</th><th>Who</th><th>Why</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
<p class="muted">Rehearse a run (the stub Muse in a real sandbox, free): <a id="reh" href="/?prompt=A%20rehearsal%20on%20the%20night%20street&makingof&rehearsal">open the app</a> in this tab after showing the list.</p>
<p><a href="/">Musical Bots</a></p></main>
<script>
const $=(s)=>document.querySelector(s);const esc=(t)=>String(t??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const tok=()=>sessionStorage.getItem('mb.admin')||'';$('#tok').value=tok();
async function load(){const r=await fetch('/api/admin/requests',{headers:tok()?{authorization:'Bearer '+tok()}:{}});const j=await r.json().catch(()=>({}));
if(!r.ok){$('#msg').textContent=j.error||('error '+r.status);$('#t').hidden=true;return;}
$('#msg').textContent=(j.requests.length?j.requests.length+' requests':'No requests yet')+(j.email?'':' · email is not set up (SMTP)')+(j.ownerKey?'':' · META_API_KEY is not set: approved runs cannot start');
$('#t').hidden=!j.requests.length;$('#t tbody').innerHTML=j.requests.map((q)=>'<tr><td data-k="When">'+esc(new Date(q.createdAt).toLocaleString())+'</td><td data-k="Who">'+esc(q.email)+(q.verified?'':' <span class="muted">(not signed in)</span>')+'</td><td data-k="Why">'+esc(q.reason)+'</td><td data-k="Status">'+esc(q.status)+(q.status==='approved'?' ('+q.credits+')':'')+'</td><td>'+(q.status==='pending'?'<button data-id="'+esc(q.id)+'" data-a="approve">Approve '+q.credits+'</button><button class="deny" data-id="'+esc(q.id)+'" data-a="deny">Deny</button>':'')+'</td></tr>').join('');}
$('#f').onsubmit=(e)=>{e.preventDefault();sessionStorage.setItem('mb.admin',$('#tok').value.trim());load();};
$('#t').onclick=async(e)=>{const b=e.target.closest('button');if(!b)return;b.disabled=true;const r=await fetch('/api/admin/requests/'+encodeURIComponent(b.dataset.id),{method:'POST',headers:{'content-type':'application/json',...(tok()?{authorization:'Bearer '+tok()}:{})},body:JSON.stringify({action:b.dataset.a})});const j=await r.json().catch(()=>({}));$('#msg').textContent=r.ok?(j.already?'Already decided':'Done: '+j.request.status+(j.told?' (emailed)':'')):(j.error||'error');load();};
if(tok())load();
</script></body></html>`;
