// The hosted director's door (the Vercel deployment: server/app.js). Curated prompts replay at once; any other prompt
// opens this dialog when Make it is pressed: the run needs a Meta Model API key, either
//   - the user's own (BYOK): kept in this tab's sessionStorage (localStorage only with "Remember on this device"),
//     sent once over HTTPS with the run, never stored or logged by the server (it goes into the run's sandbox only), or
//   - the owner's, through credits: sign in with an emailed one-time code, ask for runs with a short reason, the
//     owner approves (each approval: a few runs, spent one per run).
// open(prompt, probe) starts the run from here (the errors are shown in the dialog, to retry or switch) and resolves
// with the run's doors (POST /api/direct's 202 body), or null when the user cancels. A native <dialog> (showModal):
// focus moves in and stays, Escape cancels, every control is a labelled input or button.
const KEY_ITEM = 'mb.metaKey';

/** Where the pasted key lives: this tab always, this device too when asked (and forgotten there when not). */
export function keyStore(session, local) {
  return {
    get: () => session?.getItem(KEY_ITEM) || local?.getItem(KEY_ITEM) || '',
    remembered: () => Boolean(local?.getItem(KEY_ITEM)),
    save(key, remember) {
      session?.setItem(KEY_ITEM, key);
      if (remember) local?.setItem(KEY_ITEM, key); else local?.removeItem(KEY_ITEM);
    },
    forget() { session?.removeItem(KEY_ITEM); local?.removeItem(KEY_ITEM); },
  };
}
/** A pasted key, trimmed, or null when it can't be one (the server checks the same: 16-512 printable, no spaces). */
export const cleanKey = (raw) => { const k = String(raw ?? '').trim(); return /^[\x21-\x7e]{16,512}$/.test(k) ? k : null; };

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * opts: { api ('/api/direct'), base ('/'), fetchImpl, doc, storage: { session, local }, rehearsal: { token } | null }
 */
export function createRunDialog({ api, base = '/', fetchImpl = (...a) => fetch(...a), doc = document, storage = { session: globalThis.sessionStorage, local: globalThis.localStorage }, rehearsal = null } = {}) {
  const dlg = doc.getElementById('run-dialog');
  const $ = (id) => doc.getElementById(id);
  const keys = keyStore(storage.session, storage.local);
  const authApi = `${base}api/auth`, creditsApi = `${base}api/credits`;
  let pending = null, prompt = '', probe = null, email = '';

  const msg = (text, bad = false) => { const m = $('rd-msg'); m.textContent = text ?? ''; m.classList.toggle('bad', Boolean(bad)); };
  const busy = (on) => { for (const b of dlg.querySelectorAll('button, input, textarea')) if (b.id !== 'rd-cancel') b.disabled = on; dlg.setAttribute('aria-busy', String(on)); };
  async function post(url, body, headers = {}) {
    const r = await fetchImpl(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }
  const done = (value) => { const p = pending; pending = null; if (dlg.open) dlg.close(); p?.(value); };

  /** Start the run; on success the dialog closes with its doors (true), else the error stays in view (false). */
  async function run(body, headers = {}) {
    busy(true);
    msg('Starting a fresh sandbox for the director…');
    try {
      const r = await post(api, { prompt, ...body }, headers);
      if (r.status === 202) { msg(''); done(r.j); return true; }
      msg(r.j.error ?? `The run couldn't start (${r.status}).`, true);
      if (r.status === 401 || r.status === 402) await refresh();
    } catch { msg("The director can't be reached: check your connection and try again.", true); } finally { busy(false); renderCredits(); }
    return false;
  }

  function mode() { return dlg.querySelector('input[name="rd-mode"]:checked')?.value ?? 'byok'; }
  function showMode() {
    const m = mode();
    $('rd-byok').hidden = m !== 'byok';
    $('rd-credits').hidden = m !== 'credits';
  }
  /** The credits side, from what the server says about this browser's session. */
  function renderCredits() {
    const user = probe?.user ?? null;
    const mailOk = probe?.email !== false;
    const keyOk = probe?.modes?.credits !== false;
    const perGrant = probe?.limits?.perGrant ?? 3;
    $('rd-signin').hidden = Boolean(user) || !mailOk;
    $('rd-nomail').hidden = Boolean(user) || mailOk;
    $('rd-account').hidden = !user;
    $('rd-code-row').hidden = !email;
    $('rd-signin-go').textContent = email ? 'Sign in' : 'Email me a code';
    if (user) {
      $('rd-who').textContent = user.email;
      $('rd-left').textContent = `${user.credits} run${user.credits === 1 ? '' : 's'} left`;
      const waiting = user.request?.status === 'pending';
      $('rd-go-credits').hidden = !(user.credits > 0);
      $('rd-go-credits').disabled = !keyOk;
      $('rd-request').hidden = user.credits > 0 || waiting;
      $('rd-account-note').textContent = !keyOk ? "The owner's key isn't set up yet, so credit runs can't start: use your own key for now."
        : waiting ? 'Your request is waiting for the owner: you will get an email when it is decided.'
          : user.request?.status === 'denied' && !(user.credits > 0) ? "The owner couldn't grant runs this time." : user.credits > 0 ? '' : `Ask the owner for runs (${perGrant} per approval).`;
    }
  }
  async function refresh() {
    try { probe = { ...probe, ...(await (await fetchImpl(`${authApi}/me`, { credentials: 'same-origin', cache: 'no-store' })).json()) }; } catch { /* keep */ }
    renderCredits();
  }

  // ---- wiring (once) ----
  for (const r of dlg.querySelectorAll('input[name="rd-mode"]')) r.addEventListener('change', () => { showMode(); msg(''); });
  $('rd-byok').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = cleanKey($('rd-key').value);
    if (!key) { msg('Paste your Meta Model API key (16 characters or more, no spaces).', true); $('rd-key').focus(); return; }
    keys.save(key, $('rd-remember').checked);
    run({ mode: 'byok', key });
  });
  $('rd-forget').addEventListener('click', () => { keys.forget(); $('rd-key').value = ''; $('rd-remember').checked = false; msg('Forgotten: the key is gone from this browser.'); $('rd-key').focus(); });
  $('rd-signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    let next = null; // (focused once the form is enabled again)
    busy(true);
    try {
      if (!email || !$('rd-code').value.trim()) {
        const typed = $('rd-email').value.trim();
        const r = await post(`${authApi}/code`, { email: typed });
        if (!r.ok) { next = $('rd-email'); return msg(r.j.error ?? 'That did not work.', true); }
        if (r.j.sent === false) { probe = { ...probe, email: false }; next = $('rd-nomail-email'); return msg(r.j.message, true); }
        email = typed;
        msg(`A six-digit code is on its way to ${email}. It works for ${r.j.minutes ?? 10} minutes.`);
        next = $('rd-code');
      } else {
        const r = await post(`${authApi}/verify`, { email, code: $('rd-code').value });
        if (!r.ok) { next = $('rd-code'); return msg(r.j.error ?? 'That did not work.', true); }
        probe = { ...probe, user: r.j.user };
        email = '';
        $('rd-code').value = '';
        msg(`Signed in as ${r.j.user.email}.`);
        next = r.j.user.credits > 0 ? $('rd-go-credits') : $('rd-reason');
      }
    } catch { msg("The server can't be reached.", true); } finally {
      busy(false);
      renderCredits();
      next?.focus();
    }
  });
  $('rd-change-email').addEventListener('click', () => { email = ''; $('rd-code').value = ''; renderCredits(); msg(''); $('rd-email').focus(); });
  $('rd-go-credits').addEventListener('click', () => run({ mode: 'credits' }));
  $('rd-logout').addEventListener('click', async () => { await post(`${authApi}/logout`, {}).catch(() => {}); probe = { ...probe, user: null }; renderCredits(); msg('Signed out.'); });
  const ask = async (e, withEmail) => {
    e.preventDefault();
    const reason = (withEmail ? $('rd-nomail-reason') : $('rd-reason')).value.trim();
    busy(true);
    try {
      const r = await post(`${creditsApi}/request`, { reason, ...(withEmail ? { email: $('rd-nomail-email').value.trim() } : {}) });
      if (!r.ok) return msg(r.j.error ?? 'That did not work.', true);
      msg(r.j.message ?? 'Sent.');
      if (!withEmail) await refresh();
    } catch { msg("The server can't be reached.", true); } finally { busy(false); renderCredits(); }
  };
  $('rd-request').addEventListener('submit', (e) => ask(e, false));
  $('rd-nomail').addEventListener('submit', (e) => ask(e, true));
  $('rd-cancel').addEventListener('click', () => done(null));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); // Escape

  return {
    /** Resolves with the started run's doors, or null (cancelled). */
    open(text, info) {
      prompt = String(text ?? '').trim();
      probe = info ?? {};
      if (pending) done(null);
      $('rd-prompt').textContent = prompt;
      const stored = keys.get();
      $('rd-key').value = stored;
      $('rd-remember').checked = keys.remembered();
      const useCredits = !stored && (probe.user?.credits > 0);
      dlg.querySelector(`input[name="rd-mode"][value="${useCredits ? 'credits' : 'byok'}"]`).checked = true;
      showMode();
      renderCredits();
      msg('');
      busy(false);
      // the owner's rehearsal (the admin page's link): the stub Muse, no dialog (unless it can't start: then its error)
      if (rehearsal?.token) {
        return new Promise((ok) => {
          pending = ok;
          run({ mode: 'rehearsal' }, { authorization: `Bearer ${rehearsal.token}` }).then((started) => { if (!started && pending) dlg.showModal(); });
        });
      }
      return new Promise((ok) => {
        pending = ok;
        dlg.showModal();
        (useCredits ? $('rd-go-credits') : stored ? $('rd-go-byok') : $('rd-key')).focus();
      });
    },
    get isOpen() { return dlg.open; },
    escape: esc,
  };
}
