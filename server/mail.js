// Email for the hosted app (server/app.js): any SMTP relay (production: the owner's Brevo relay; default Gmail) with STARTTLS on port 587, through nodemailer, configured by the
// same variables as the owner's other apps: SMTP_HOST (smtp.gmail.com), SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD (a
// Gmail app password), FROM_EMAIL (default SMTP_USER), FROM_NAME ("Musical Bots"). Without SMTP_USER and
// SMTP_PASSWORD the mailer reports `configured: false` and sends nothing; the app then keeps requests for the owner's
// admin page and tells the user email is not set up yet.

export function smtpSettings(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: env.SMTP_HOST || 'smtp.gmail.com', port, user: env.SMTP_USER || '', pass: env.SMTP_PASSWORD || '',
    from: env.FROM_EMAIL || env.SMTP_USER || '', fromName: env.FROM_NAME || 'Musical Bots',
  };
}

/** The SMTP mailer: { configured, send({ to, subject, text, html }) -> true | false }. Never throws; logs no secrets. */
export function smtpMailer(env = process.env, { log = console.error } = {}) {
  const s = smtpSettings(env);
  const configured = Boolean(s.user && s.pass && s.from);
  let transport = null;
  return {
    configured,
    async send({ to, subject, text, html }) {
      if (!configured) return false;
      try {
        if (!transport) {
          const nodemailer = (await import('nodemailer')).default;
          // 587: plain connection upgraded by STARTTLS (required); 465: TLS from the start
          transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, requireTLS: s.port !== 465, auth: { user: s.user, pass: s.pass } });
        }
        await transport.sendMail({ from: { name: s.fromName, address: s.from }, to, subject, text, html });
        return true;
      } catch (err) {
        log(`mail to ${String(to).replace(/^(.).*(@.*)$/, '$1…$2')} failed: ${err?.code ?? ''} ${String(err?.message ?? err).slice(0, 160)}`);
        return false;
      }
    },
  };
}

/** A mailer for the tests: keeps what it sends. */
export function memoryMailer({ configured = true } = {}) {
  const sent = [];
  return { configured, sent, async send(m) { if (!configured) return false; sent.push(m); return true; } };
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1c1f26">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">${body}
<p style="color:#6b7080;font-size:12px;margin-top:28px">Musical Bots: sixteen singing bots write, stage and sing an episode from one prompt.</p></div></body></html>`;
const button = (href, label, bg) => `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;margin:4px 8px 4px 0">${esc(label)}</a>`;

/** The one-time sign-in code (the atmoszk pattern: six digits, ten minutes). */
export function codeMail(code, minutes = 10) {
  return {
    subject: `Your Musical Bots sign-in code: ${code}`,
    text: `Your Musical Bots sign-in code is ${code}\n\nIt expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.\n`,
    html: page('Your sign-in code', `<h2 style="margin:0 0 8px">Your sign-in code</h2><p>Use this code to sign in to Musical Bots:</p>
<div style="background:#fff;border-radius:10px;padding:22px;text-align:center;margin:18px 0"><span style="font-size:32px;font-weight:800;letter-spacing:8px;color:#4f7cff">${esc(code)}</span></div>
<p>It expires in <strong>${minutes} minutes</strong>. If you didn't ask for it, you can ignore this email.</p>`),
  };
}

/** To the owner: a credit request, with its signed single-use Approve / Deny links. */
export function requestMail({ email, reason, credits, approveUrl, denyUrl, adminUrl }) {
  return {
    subject: `Musical Bots: ${email} asks for ${credits} runs`,
    text: `${email} asks for ${credits} director runs on your key (a run is about 10M tokens, mostly cached: about $2-3 at Muse Spark 1.3 list prices).\n\nWhy: ${reason}\n\nApprove: ${approveUrl}\nDeny: ${denyUrl}\n\nEach link works once (it opens a page to confirm). All requests: ${adminUrl}\n`,
    html: page('A credit request', `<h2 style="margin:0 0 8px">A credit request</h2><p><strong>${esc(email)}</strong> asks for <strong>${credits}</strong> director runs on your Meta API key (a run is about 10M tokens, mostly cached: about $2–3 at Muse Spark 1.3 list prices).</p>
<blockquote style="margin:14px 0;padding:10px 14px;background:#fff;border-left:4px solid #4f7cff;border-radius:6px">${esc(reason)}</blockquote>
<p>${button(approveUrl, `Approve ${credits} runs`, '#2e9d5b')}${button(denyUrl, 'Deny', '#c0392b')}</p>
<p style="font-size:13px;color:#6b7080">Each link works once and opens a page to confirm. All requests: <a href="${esc(adminUrl)}">the admin page</a>.</p>`),
  };
}

/** To the user: the owner's decision. */
export function outcomeMail({ approved, credits, appUrl }) {
  return approved ? {
    subject: 'Musical Bots: your runs are approved',
    text: `Good news: you have ${credits} director runs. Open ${appUrl}, sign in with this email, type a new prompt and press Make it.\n`,
    html: page('Approved', `<h2 style="margin:0 0 8px">Your runs are approved</h2><p>You have <strong>${credits}</strong> director runs. Sign in with this email, type a new prompt and press <strong>Make it</strong>.</p><p>${button(appUrl, 'Open Musical Bots', '#4f7cff')}</p>`),
  } : {
    subject: 'Musical Bots: your request',
    text: `Thanks for asking. The owner couldn't grant runs this time. The 14 curated episodes still play instantly at ${appUrl}, and you can run the director with your own Meta API key.\n`,
    html: page('Your request', `<h2 style="margin:0 0 8px">Thanks for asking</h2><p>The owner couldn't grant runs this time. The 14 curated episodes still play instantly, and you can run the director with your own Meta API key.</p><p>${button(appUrl, 'Open Musical Bots', '#4f7cff')}</p>`),
  };
}
