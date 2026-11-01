// Signing and identities for the hosted app (server/app.js): HMAC-signed tokens (the session cookie, the owner's
// Approve / Deny links, a run's id), one-time email codes, and keyed hashes that name records without storing an IP.
// Everything is keyed by SESSION_SECRET (server-only, set once in the Vercel project's environment).
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'mb_session';
export const SESSION_DAYS = 30;
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;

const mac = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/** A signed, expiring token: base64url(JSON payload) + "." + its HMAC. */
export function sign(secret, payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}
/** The payload of a signed token, or null (forged, malformed or expired). */
export function verify(secret, token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || !same(mac(secret, body), sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && typeof p === 'object' && Number(p.exp) * 1000 > now ? p : null;
  } catch { return null; }
}
/** Constant-time string comparison (an admin token). */
export const sameSecret = (a, b) => Boolean(a && b) && same(a, b);

/** A stable, keyed name for an email or an IP (records never hold the raw IP; one email maps to one user record). */
export const hashOf = (secret, kind, value) => createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex').slice(0, 32);
/** A random id (base64url). */
export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');
/** A run's id: 24 lowercase hex characters (96 random bits: whoever has it may watch and stop the run). */
export const newRunId = () => randomBytes(12).toString('hex');
/** A six-digit one-time code. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
/** The code's keyed hash (the store never holds the code itself). */
export const codeHash = (secret, email, code) => mac(secret, `code:${email}:${code}`);
export const sameCode = (a, b) => same(a, b);

/** A normalized email, or null when it is not one. */
export function normalEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>()",;:]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !e.includes('..') ? e : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
/** The Set-Cookie value of the session (HttpOnly, Secure on https, SameSite=Lax); maxAge 0 clears it. */
export function sessionCookie(value, { maxAge = SESSION_DAYS * 86400, secure = true } = {}) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
