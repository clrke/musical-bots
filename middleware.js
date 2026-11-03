// Vercel Routing Middleware (runs before the static files): a link crawler fetching a hosted run's share link
// (/?run=<id>: X, Facebook, Slack, Discord, WhatsApp, Telegram, LinkedIn...) is sent to /api/share/<id>, a page with
// the episode's own title and Muse Image poster (server/app.js sharePage). Everyone else gets the app, untouched.
// (A vercel.json rewrite can't do it: the static index.html at / wins over rewrites.)
export const config = { matcher: '/' };

export const CRAWLER = /bot|crawler|spider|facebookexternalhit|slack|discord|whatsapp|telegram|linkedin|skype|embedly|preview/i;
export const RUN = /^[a-z0-9]{20,40}$/;

/** The share page's URL for a crawler's request of a run's link, else null (the request goes on as it is). */
export function shareTarget(url, userAgent) {
  try {
    const u = new URL(url);
    const run = u.searchParams.get('run');
    if (u.pathname !== '/' || !run || !RUN.test(run) || !CRAWLER.test(userAgent ?? '')) return null;
    return new URL(`/api/share/${run}`, u).toString();
  } catch { return null; }
}

export default function middleware(request) {
  const to = shareTarget(request.url, request.headers.get('user-agent'));
  return to ? Response.redirect(to, 302) : undefined;
}
