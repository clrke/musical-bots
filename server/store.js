// The hosted app's small datastore (server/app.js): JSON records by key, with compare-and-swap writes, so a credit is
// spent once and a request is decided once. Two backends with one interface:
//   blobStore()   a private Vercel Blob store (production): conditional writes on ETags, consistent reads. Its Hobby
//                 allowance is 2,000 writes and 10,000 reads a month, so the app writes only on real actions (a code
//                 sent, a request made or decided, a run started or finished) and polls never touch it.
//   memoryStore() in memory (the tests, `npm run dev`).
// Interface: get(key, { cached }) -> { value, etag } | null; put(key, value, { ifMatch, ifNone }) -> { etag } (throws
// Conflict when the condition fails); del(key); list(prefix) -> keys. update() is the read-modify-write loop on top.

export class Conflict extends Error {
  constructor(key) { super(`conflict on ${key}`); this.name = 'Conflict'; }
}

export function memoryStore() {
  const m = new Map();
  let n = 0;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  return {
    kind: 'memory',
    async get(key) { const r = m.get(key); return r ? { value: copy(r.value), etag: r.etag } : null; },
    async put(key, value, { ifMatch, ifNone } = {}) {
      const cur = m.get(key);
      if ((ifNone && cur) || (ifMatch && cur?.etag !== ifMatch)) throw new Conflict(key);
      const etag = `"m${++n}"`;
      m.set(key, { value: copy(value), etag });
      return { etag };
    },
    async del(key) { m.delete(key); },
    async list(prefix = '') { return [...m.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

/** A private Vercel Blob store (BLOB_READ_WRITE_TOKEN, or Vercel's OIDC token with BLOB_STORE_ID). Keys live under `prefix`. */
export function blobStore({ prefix = 'mb/', token = undefined, sdk = null } = {}) {
  let mod = sdk;
  const blob = async () => (mod ??= await import('@vercel/blob'));
  const path = (k) => `${prefix}${k}.json`;
  const auth = token ? { token } : {};
  return {
    kind: 'blob',
    async get(key, { cached = false } = {}) {
      const { get } = await blob();
      const r = await get(path(key), { access: 'private', useCache: cached, ...auth });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      const text = await new Response(r.stream).text();
      // (a big record comes back compressed, with a weak ETag, W/"..."; a conditional put needs the strong one, the same
      // value without W/: kept weak, every update of a run that holds its files was refused, "the store is busy")
      return { value: JSON.parse(text), etag: String(r.blob.etag ?? '').replace(/^W\//, '') || r.blob.etag };
    },
    async put(key, value, { ifMatch, ifNone } = {}) {
      const { put, BlobPreconditionFailedError } = await blob();
      try {
        const r = await put(path(key), JSON.stringify(value), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60,
          allowOverwrite: !ifNone, ...(ifMatch ? { ifMatch } : {}), ...auth,
        });
        return { etag: r.etag };
      } catch (err) {
        // (another writer got there first: the ETag moved, "The conditional request cannot succeed", or the blob exists)
        const m = String(err?.message ?? '');
        if ((BlobPreconditionFailedError && err instanceof BlobPreconditionFailedError) || /precondition|conditional request/i.test(m) || (ifNone && /exist/i.test(m))) throw new Conflict(key);
        throw err;
      }
    },
    async del(key) { const { del } = await blob(); await del(path(key), auth); },
    async list(p = '') {
      const { list } = await blob();
      const keys = [];
      let cursor;
      do {
        const r = await list({ prefix: `${prefix}${p}`, cursor, limit: 1000, ...auth });
        for (const b of r.blobs) keys.push(b.pathname.slice(prefix.length).replace(/\.json$/, ''));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return keys.sort();
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-modify-write: fn(current value or null) returns the new value (undefined: leave it). Retried when another
 * writer got there first. Returns { value, changed }.
 */
export async function update(store, key, fn, { tries = 8 } = {}) {
  for (let i = 0; i < tries; i++) {
    const cur = await store.get(key);
    const next = await fn(cur ? cur.value : null);
    if (next === undefined) return { value: cur ? cur.value : null, changed: false };
    try {
      await store.put(key, next, cur ? { ifMatch: cur.etag } : { ifNone: true });
      return { value: next, changed: true };
    } catch (err) {
      if (!(err instanceof Conflict)) throw err;
      await sleep(15 + Math.random() * 60 * (i + 1));
    }
  }
  throw new Error(`the store is busy (${key}); try again`);
}

/** The store the environment provides: Vercel Blob when connected (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID), else memory. */
export function storeFromEnv(env = process.env) {
  if (env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID) return blobStore({ prefix: env.MB_STORE_PREFIX || 'mb/' });
  return memoryStore();
}
