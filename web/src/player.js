// Transport clock + NDJSON event player. REPLAY: whole bundle, deterministic.
// LIVE (the making-of): events are staged as they arrive, from a bundle a director run is writing
// (polled) or from a finished bundle replayed on its authoring timeline (its `t` is when the crew
// wrote each event).
import { modernBundle } from './cast16.js';
/**
 * Parse NDJSON; a half-written last line (a poll caught an append mid-write) is dropped. A bundle
 * directed before the cast took its colour names comes back in them (cast16.js modernBundle).
 */
export function parseNdjson(text) {
  return modernBundle(parseLines(text));
}
function parseLines(text) {
  const out = [];
  const lines = text.split('\n').filter((l) => l.trim());
  for (const [i, l] of lines.entries()) {
    try { out.push(JSON.parse(l)); } catch (err) {
      if (i === lines.length - 1 && !text.endsWith('\n')) break;
      throw err;
    }
  }
  return out;
}

export class Player {
  constructor({ onEvent, onReset, onAppend } = {}) {
    this.events = [];
    this.cursor = 0;
    this.time = 0;
    this.playing = false;
    this.onEvent = onEvent ?? (() => {});
    this.onReset = onReset ?? (() => {});
    this.onAppend = onAppend ?? (() => {});
    this._poll = null;
    this._live = null; // LIVE state: { opts, seen, next, pending, ended }
  }

  load(events) {
    this.events = events;
    this.seek(0);
  }

  seek(t) {
    this.time = t;
    this.cursor = 0;
    this.onReset();
    this._drain();
  }

  play() { this.playing = true; }
  pause() { this.playing = false; }

  // Advance transport by dt seconds; fire every event whose t has arrived.
  tick(dt) {
    if (!this.playing) return;
    this.time += dt;
    if (this._live?.pending.length) this._arrive();
    this._tickScore();
    this._drain();
  }

  /**
   * LIVE with a score: every `tick` seconds (1) the score hears the clock even when nothing arrived (an empty add),
   * so it lays out what is due and, while nobody has news, the groove and the crew's work song (making-of-score.js).
   */
  _tickScore() {
    const L = this._live;
    if (!L?.opts.score || L.flushed) return;
    if (this.time - (L.ticked ?? -Infinity) < (L.opts.tick ?? 1) - 1e-9) return;
    L.ticked = this.time;
    this._staged(L.opts.score.add([], this.time));
  }

  _drain() {
    while (this.cursor < this.events.length && this.events[this.cursor].t <= this.time) {
      this.onEvent(this.events[this.cursor++]);
    }
  }

  get duration() { return this.events.length ? this.events[this.events.length - 1].t : 0; }
  get finished() { return this.cursor >= this.events.length && this.events.length > 0; }
  /** LIVE: every event that will come has arrived and been staged. */
  get liveDone() { return Boolean(this._live?.ended) && !this._live.pending.length && this.cursor >= this.events.length; }
  /** LIVE: events arrived but not staged yet. */
  get backlog() { return this.events.length - this.cursor; }

  async replay(url) {
    this.stopLive();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bundle ${url}: ${res.status}`);
    this.load(parseNdjson(await res.text()));
    this.play();
  }

  /**
   * LIVE: stage events as they arrive. source: a bundle URL to poll (a director run in progress), a
   * function polled the same way that resolves a snapshot of the run (with a score: score.feed(snapshot,
   * now) takes it; the making-of's LiveFeed: the events landed, the ones written ahead, the activity), or
   * an events array to replay on its authoring timeline (a recorded making-of). Bursts are paced: an
   * arriving event is staged at max(now + lead, the previous event's end), so seven agents writing at
   * once read as one performance. The original authoring time stays on the event as `at`.
   * opts (or a number: the poll interval in ms):
   *   interval  poll period, ms (1000)
   *   lead      seconds between an arrival and its staging, for the voices to render (0)
   *   gapOf(e)  seconds an event holds the stage (0: arrival order only)
   *   transform(e, player)  the event as staged (e.g. the making-of's role bot singing its summary)
   *   speed     replay: authoring seconds per transport second (1)
   *   score     the making-of's score (making-of-score.js): add(raw, now) returns the staged events it lays out
   *             (timed on its bar grid, in order; one raw event may stage several, a duet waits for its answer),
   *             flush(now) the ones still waiting when the stream ends. Replaces transform / gapOf / lead.
   */
  async live(source, opts = {}) {
    if (typeof opts === 'number') opts = { interval: opts };
    const o = { interval: 1000, lead: 0, gapOf: () => 0, transform: (e) => e, speed: 1, ...opts };
    this.stopLive();
    this.load([]);
    this._live = { opts: o, seen: 0, next: 0, pending: [], ended: false };
    this.play();
    if (Array.isArray(source)) { // a recorded making-of: arrivals on the authoring timeline
      const t0 = source.length ? source[0].t : 0;
      this._live.pending = source.map((e) => ({ e, due: (e.t - t0) / o.speed }));
      this._live.ended = true;
      this._arrive();
      return;
    }
    if (typeof source === 'function') this._live.fetch = source;
    else this._live.url = source;
    await this._pollOnce();
    this._poll = setInterval(() => this._pollOnce(), o.interval);
  }

  /** LIVE: poll now (the tab shown again: its throttled timer may be a while yet), when polling. */
  pollNow() { return this._poll ? this._pollOnce() : Promise.resolve(); }

  async _pollOnce() {
    const L = this._live;
    if (L?.fetch) {
      const snap = await Promise.resolve().then(L.fetch).catch(() => null);
      if (!snap || this._live !== L || L.flushed) return;
      if (L.opts.score?.feed) { L.ticked = this.time; this._staged(L.opts.score.feed(snap, this.time)); } else if (Array.isArray(snap)) this.append(snap.slice(L.seen));
      return;
    }
    if (!L?.url) return;
    try {
      const res = await fetch(L.url, { cache: 'no-store' });
      if (res.ok && this._live === L) this.append(parseNdjson(await res.text()).slice(L.seen));
    } catch { /* retry next poll */ }
  }

  /** LIVE: append newly arrived raw events (paced and transformed). */
  append(raw) {
    const L = this._live;
    if (!L || !raw.length) return;
    L.seen += raw.length;
    if (L.opts.score) { L.ticked = this.time; return this._staged(L.opts.score.add(raw, this.time)); }
    const added = [];
    for (const r of raw) {
      const e = { ...L.opts.transform(r, this), at: r.t };
      e.t = Math.max(this.time + L.opts.lead, L.next);
      L.next = e.t + Math.max(0, L.opts.gapOf(e) || 0);
      this.events.push(e);
      added.push(e);
    }
    this.onAppend(this.events, added);
  }

  /** LIVE: events a score laid out (already timed): staged in time order with the rest. */
  _staged(added) {
    if (!added?.length) return;
    this.events.push(...added);
    // (a score lays out after what it has placed, so this is in order already; the stable sort keeps it so anyway)
    const rest = this.events.slice(this.cursor);
    if (rest.some((e, i) => i > 0 && e.t < rest[i - 1].t)) this.events = [...this.events.slice(0, this.cursor), ...rest.sort((a, b) => a.t - b.t)];
    this.onAppend(this.events, added);
  }

  _arrive() {
    const L = this._live;
    const due = [];
    while (L.pending.length && L.pending[0].due <= this.time) due.push(L.pending.shift().e);
    if (due.length) this.append(due);
    if (L.ended && !L.pending.length && L.opts.score && !L.flushed) {
      L.flushed = true;
      this._staged(L.opts.score.flush?.(this.time));
    }
  }

  /** LIVE: no more events will come (the director finished): one last poll, then the stream ends. */
  async endLive() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
    await this._pollOnce();
    const L = this._live;
    if (!L) return;
    if (L.opts.score && !L.flushed) {
      L.flushed = true;
      this._staged(L.opts.score.flush?.(this.time));
    }
    L.ended = true;
  }

  stopLive() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
    this._live = null;
  }
}
