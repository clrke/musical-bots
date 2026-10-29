// Pool of voice workers with an LRU cache of rendered lines.
//   const pool = createVoicePool({ size: 3 });
//   const line = await pool.render(job);   // { pcm, sampleRate, startOffset, syllableTimes, peak }
// Identical jobs (same content, see keyOf) share one render: cached results are returned as the
// same object, so treat them as read-only. Jobs go to the workers round-robin.
// Changed in this copy (vs upstream magna-vocalization): the key includes job.senses.

const MB = 1024 * 1024;

function defaultWorker() {
  // literal pattern so Vite bundles the module worker
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

const num = (x) => (Number.isFinite(x) ? x : null);

/** Cache key of a job: its content in a fixed order (voice, text, syllables, mode, seed, vibrato, notes, senses). */
export function keyOf(job) {
  const notes = (job?.notes ?? []).map((n) => [num(n.t), num(n.dur), num(n.midi), n.downbeat ? 1 : 0]);
  const vib = job?.vibrato ?? {};
  return JSON.stringify([
    job?.voice ?? null, job?.text ?? '', job?.syllables || null, job?.mode ?? 'human',
    Number.isFinite(job?.seed) ? Math.trunc(job.seed) | 0 : 0, num(vib.rate), num(vib.depth), notes,
    ...(job?.senses ? [job.senses] : []),
  ]);
}

/**
 * @param {{size?: number, maxBytes?: number, createWorker?: () => Worker}} [opts]
 *   size: workers (default 3); maxBytes: pcm cache budget (default 64 MB);
 *   createWorker: worker factory (tests), default a module worker running ./worker.js.
 * @returns {{render: (job: object) => Promise<object>, keyOf: (job: object) => string, clear: () => void,
 *   dispose: () => void, stats: () => {entries: number, bytes: number, pending: number}}}
 */
export function createVoicePool({ size = 3, maxBytes = 64 * MB, createWorker = defaultWorker } = {}) {
  const n = Math.max(1, Math.trunc(size) || 1);
  const workers = new Array(n).fill(null);
  /** id -> { resolve, reject, key, slot } */
  const pending = new Map();
  /** key -> Promise of the render in flight */
  const inflight = new Map();
  /** key -> result, in LRU order (oldest first) */
  const cache = new Map();
  let bytes = 0;
  let nextSlot = 0;
  let nextId = 1;

  const sizeOf = (result) => result?.pcm?.byteLength ?? 0;

  function store(key, result) {
    const b = sizeOf(result);
    if (b > maxBytes) return;
    cache.set(key, result);
    bytes += b;
    for (const [k, r] of cache) {
      if (bytes <= maxBytes) break;
      cache.delete(k);
      bytes -= sizeOf(r);
    }
  }

  function fail(slot, message) {
    for (const [id, p] of pending) {
      if (p.slot !== slot) continue;
      pending.delete(id);
      inflight.delete(p.key);
      p.reject(new Error(message));
    }
  }

  function onMessage(slot, data) {
    const p = pending.get(data?.id);
    if (!p) return;
    pending.delete(data.id);
    inflight.delete(p.key);
    if (data.error !== undefined) {
      p.reject(new Error(data.error));
      return;
    }
    store(p.key, data.result);
    p.resolve(data.result);
  }

  function worker(slot) {
    let w = workers[slot];
    if (w) return w;
    w = createWorker();
    w.onmessage = (ev) => onMessage(slot, ev.data);
    w.onerror = (ev) => {
      ev?.preventDefault?.();
      if (workers[slot] === w) workers[slot] = null; // replaced on the next render
      w.terminate?.();
      fail(slot, `voice worker failed: ${ev?.message ?? 'error'}`);
    };
    w.onmessageerror = () => fail(slot, 'voice worker: message could not be decoded');
    workers[slot] = w;
    return w;
  }

  function render(job) {
    let key;
    try {
      key = keyOf(job);
    } catch (err) {
      return Promise.reject(err);
    }
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key); // most recently used goes last
      cache.set(key, hit);
      return Promise.resolve(hit);
    }
    const running = inflight.get(key);
    if (running) return running;
    const slot = nextSlot;
    nextSlot = (nextSlot + 1) % n;
    const id = nextId++;
    const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject, key, slot }));
    inflight.set(key, promise);
    try {
      worker(slot).postMessage({ id, job });
    } catch (err) {
      pending.delete(id);
      inflight.delete(key);
      return Promise.reject(err);
    }
    return promise;
  }

  /** Drop every cached line (renders in flight still resolve, and are cached). */
  function clear() {
    cache.clear();
    bytes = 0;
  }

  /** Terminate the workers; pending renders are rejected. */
  function dispose() {
    for (let s = 0; s < n; s++) {
      fail(s, 'voice pool disposed');
      workers[s]?.terminate?.();
      workers[s] = null;
    }
    clear();
  }

  const stats = () => ({ entries: cache.size, bytes, pending: pending.size });

  return { render, keyOf, clear, dispose, stats };
}
