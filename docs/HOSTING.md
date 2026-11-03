# Hosting: https://musical-bots.vercel.app

The site is the static app (`web/dist`) plus one Vercel Function (`api/index.js` → `server/app.js`) for the
live director. Curated prompts never touch the function: they replay their checked-in bundles instantly. A new
prompt's **Make it** opens a dialog: run the Muse Code director with **your own Meta Model API key**, or **log in
and request credits** to run it on the owner's key. Each run gets its own Vercel Sandbox; the page plays the
making-of while the crew writes it, then the premiere.

## How a run flows

```
browser ──POST /api/direct {prompt, mode, key?}──▶ Vercel Function (server/app.js)
   │                                                  │ guards: prompt 1-200 chars, runs at once, starts per IP,
   │                                                  │ a credit spent (credits mode)
   │                                                  ▼
   │                                    Vercel Sandbox "mb-<run id>" (2 vCPU, 4 GB, not persistent)
   │                                      scripts/director/sandbox-run.js: installs Muse Code from Meta's
   │                                      launcher, runs direct.js --live, writes .run/snapshot.json each second
   │◀── GET /api/direct/<run>[/events.ndjson|beats.json|director.json|queued.ndjson|activity.ndjson]
   │       (the function reads the snapshot; the same doors as the dev server's scripts/director/live.js)
   ▼
 when the run is over: its bundle is kept in the Blob store (runs/<id>), the sandbox is stopped, and the
 address bar shows the run's link: /?run=<id> premieres it, /?run=<id>&makingof replays its making-of
```

- **One function, one store.** `vercel.json` rewrites `/api/*` to `api/index.js`. Users, sign-in codes, credit
  requests, run records and finished bundles are JSON records in a private Vercel Blob store
  (`musical-bots-store`, `server/store.js`), written with ETag compare-and-swap (a credit is spent once, a
  request is decided once). Polls never touch the store: they read the run's sandbox.
- **Modes.** `byok`: the user's key. `credits`: a signed-in user's approved runs on `META_API_KEY`.
  `rehearsal`: the owner only (`ADMIN_TOKEN`): the stub Muse (`scripts/director/stub-muse.js`) in a real
  sandbox, free; the admin page links it.
- **Guards.** `MAX_CONCURRENT_RUNS` (2), `RUNS_PER_IP_PER_DAY` (4), `MAX_PROMPT` (200), `RUN_TIMEOUT_MIN` (40:
  a poll stops a run over it; the sandbox's own session limit is 2 minutes longer), sign-in codes (8 per IP and
  4 per email an hour, 5 tries per code, 10 minutes), 3 credit requests per IP a day, one pending request per
  user. A run that is over is wrapped up by the next poll or the next run's start (its sandbox stopped).

## Security model

- **Your own key (BYOK).** It stays in the browser: this tab's `sessionStorage`, and `localStorage` only with
  "Remember on this device" ("Forget my key" clears both). It is sent once, over HTTPS, in the body of the
  `POST /api/direct` that starts the run. The server never stores or logs it: it is passed only into the
  environment of the run's one command in its sandbox (not the sandbox's own environment, never a file), the
  sandbox is not persistent (nothing is snapshotted when it stops), and it is stopped when the run ends.
  `sandbox-run.js` replaces any copy of the key in what the run writes (lines, logs, errors) with
  `[redacted]`; the function does the same for the owner's key. `web/test-server.mjs` checks the key appears in
  no stored record, status, file or log.
- **Credits.** Sign-in is an emailed six-digit code (stored only as an HMAC, single use); the session is an
  HMAC-signed `HttpOnly; Secure; SameSite=Lax` cookie (30 days). The owner gets each request by email with
  signed Approve / Deny links (14 days) that open a confirm page first (a mail scanner that opens them changes
  nothing) and work once. The user is emailed the outcome. Approved runs (`CREDITS_PER_GRANT`, 3) are spent
  one per run, atomically; a run whose sandbox never got to direct gives its credit back.
- **The owner's key** (`META_API_KEY`) is a server-side environment variable, used only for credit runs, in the
  same per-command way. A credit run is a stranger's prompt with your key in its environment and a shell in its
  tools (the crew's `bash`): a prompt could try to make the model print or send the key. Outputs are redacted,
  but only you decide who gets credits: use a **dedicated key with a spending limit** for this app.
- **Requests and records.** IPs are kept only as keyed hashes; a run's id is 96 random bits (whoever has the
  link can watch it, and stop it while it runs). Cross-site POSTs are refused (JSON bodies, an Origin check).

## Environment variables (Vercel project `musical-bots`, Production)

| Variable | Set? | What |
|---|---|---|
| `SESSION_SECRET` | set (random) | Signs sessions, approval links; keys the code and IP hashes. Without it the API reports `available: false` and the page falls back to the offline generator. |
| `ADMIN_TOKEN` | set (random) | The owner's admin page and rehearsals. Its value is in `~/.config/musical-bots/admin-token` on the owner's Mac (mode 600). |
| `OWNER_EMAIL` | `clarke.plumo@gmail.com` | Gets the credit requests; signing in as this email also opens the admin page. |
| `APP_URL` | `https://musical-bots.vercel.app` | The links in emails. |
| `BLOB_READ_WRITE_TOKEN` | set by `vercel blob create-store` | The private Blob store. |
| `META_API_KEY` | **owner step** | The owner's Meta Model API key, for credit runs only. Until it is set the dialog says credit runs can't start yet (requests still work). |
| `SMTP_USER`, `SMTP_PASSWORD` | set (Nov 1) | The owner's SMTP login (the same Brevo SMTP relay as his other apps; a Gmail app password also works). Without them sign-in is off, requests are kept for the admin page, and the user is told email isn't set up yet. |
| `SMTP_HOST`, `SMTP_PORT`, `FROM_EMAIL`, `FROM_NAME` | set (Nov 1) | The Brevo relay, `587` (STARTTLS), the owner's verified sender, `Musical Bots`. Defaults if unset: `smtp.gmail.com`, `587`, `SMTP_USER`, `Musical Bots`. |
| `CREDITS_PER_GRANT`, `MAX_CONCURRENT_RUNS`, `RUNS_PER_IP_PER_DAY`, `MAX_PROMPT`, `RUN_TIMEOUT_MIN` | optional | 3, 2, 4, 200, 40. |
| `MB_RUNNER_ARGS` | optional | More `direct.js` options for every run, e.g. `--model muse-spark-1.3 --lyrics-effort medium`. |

## Owner steps

1. **Email: done Nov 1** (the owner's Brevo SMTP relay, copied from his own other app; a sign-in code was delivered). To switch to Gmail instead: turn on 2-Step Verification for the Gmail account, create an app password
   (Google Account → Security → App passwords), then:
   `vercel env add SMTP_USER production` (the Gmail address) and `vercel env add SMTP_PASSWORD production`
   (the 16-character app password; paste it at the prompt, never in a file or chat), then redeploy
   (`vercel deploy --prod` from a clean checkout, or `vercel redeploy <the latest deployment>`).
2. **Your key for credit runs.** Create a dedicated Meta Model API key, ideally with a spending limit, then
   `vercel env add META_API_KEY production` and redeploy. Check the admin page: the "META_API_KEY is not set"
   note disappears.
3. **The admin page:** https://musical-bots.vercel.app/api/admin. Paste the token from
   `cat ~/.config/musical-bots/admin-token` (kept in that tab only). It lists requests with Approve / Deny, and
   links a free rehearsal (the stub Muse in a real sandbox). Once email works, signing in on the site as
   `OWNER_EMAIL` opens it too.
4. **Optional:** a real run with your key, end to end (Make it on a new prompt, "Use your own key"). About
   10–12 minutes and ~10 M tokens (about $2–3 at Muse Spark 1.3 list prices; the contributor tier costs far less).

## Limits and cost (this account is on Vercel Hobby)

- **Vercel Sandbox, Hobby** (free within): 45-minute sessions, 10 at once, 5 h of Active CPU, 420 GB-hours of
  memory, 5,000 creations and 20 GB of data transfer a month; past them, sandbox creation pauses until the
  month resets (no charge). A run is ~10–12 minutes on 2 vCPU / 4 GB: ~0.8 GB-hours, and little Active CPU
  (the sandbox mostly waits on the model), so roughly 100+ runs a month fit; idle waiting is not billed as CPU.
  **Pro**: 24-hour sessions, $0.128 per Active CPU hour, $0.0212 per GB-hour of memory, $0.60 per million
  creations: about $0.02–0.03 of sandbox per run. Credential brokering (the key injected by the network proxy,
  never inside the sandbox) needs Pro.
- **Vercel Blob, Hobby**: 1 GB, 10,000 reads and 2,000 writes a month (Blob stops until the month resets if
  exceeded). Writes: a run 3-4 (its IP's counter, its record at the start and the end, a credit), a sign-in 4
  (two counters, the code, its use), a request 3 and its decision 2. Polls and share links only read.
- **Vercel Functions, Hobby**: the API function runs at most 60 s a call (a run start takes ~3 s; Muse is
  installed inside the sandbox). A watched run polls ~4 requests a second.
- **The model** (the key's owner pays): ~10 M tokens a run, 93% cached, ~130 k output. The 14 curated runs cost
  $0.09–0.13 each on the contributor tier; at Muse Spark 1.3 list prices ($1.25 / $0.15 cached / $4.25 per M)
  that is about $2.2–3.0.
- **The poster** (the key's owner pays): one Muse Image call a run (`muse-image-1.0`, $0.01, ~30 s, in parallel
  with the crew), drawn in the sandbox once the plan has its title; kept in Blob as `posters/<run>` (one more write,
  ~0.5 MB) and served at `/api/direct/<run>/poster.webp`. A failure only means no poster.

## Testing

- `npm test` includes `web/test-server.mjs`: the whole API with an in-memory store, the local runner (the real
  `sandbox-run.js` and `direct.js` with the stub Muse) and a mailer that keeps what it sends.
- `npm run build && node scripts/vercel/serve.mjs --stub`: the hosted site on this machine (codes print in its
  terminal; admin token `local-admin`).
- `npm ci` (the root's `@vercel/sandbox`, `@vercel/blob`, `nodemailer`), `vercel link`, `vercel env pull
  .env.local`, then `node --env-file=.env.local scripts/vercel/e2e-sandbox.mjs` (`--stub`, the default: a
  rehearsal in a real Vercel Sandbox, ~20 s; `--fake-key`: the BYOK path, Muse installed and the made-up key
  rejected cleanly; `--install`: only the Muse Code install).
- The deployed site: the admin page's rehearsal link plays a stub run in a real sandbox end to end.

## Deploying

From a clean checkout: `vercel deploy --prod` (project `musical-bots`; `vercel.json` installs both
`package.json`s, builds `web/dist` with base `/`, Node 22). `.vercelignore` keeps private notes, `.env*`,
`node_modules`, builds and renders out of the upload. GitHub Pages is retired: Vercel is the one site.
