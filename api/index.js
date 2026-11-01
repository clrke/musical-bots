// The Vercel Function behind every /api/* path (vercel.json rewrites them here, the path in ?path=): the hosted Muse
// Code director with sign-in and credits (server/app.js), on the project's private Vercel Blob store, one Vercel
// Sandbox per run, and Gmail SMTP when it is configured. Settings: the README's "Hosting" section.
import { configFrom, createApp } from '../server/app.js';
import { storeFromEnv } from '../server/store.js';
import { directorFiles, sandboxRunner } from '../server/runner.js';
import { smtpMailer } from '../server/mail.js';

const config = configFrom(process.env);
const app = createApp({
  config,
  store: storeFromEnv(process.env),
  // (the sandbox's session outlasts the run's own limit by two minutes: the run is wrapped up first)
  runner: sandboxRunner({ timeoutMs: (config.runMinutes + 2) * 60_000 }),
  mailer: smtpMailer(process.env),
  // /api/health: how many of the director's files this function carries (vercel.json includeFiles)
  info: () => ({ directorFiles: directorFiles().length }),
});

export default function handler(req, res) {
  return app(req, res);
}
