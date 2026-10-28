// Transport clock + NDJSON event player. REPLAY: whole bundle, deterministic.
// LIVE: polls the bundle URL and stages events as they are appended.
export function parseNdjson(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
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
    this._drain();
  }

  _drain() {
    while (this.cursor < this.events.length && this.events[this.cursor].t <= this.time) {
      this.onEvent(this.events[this.cursor++]);
    }
  }

  get duration() { return this.events.length ? this.events[this.events.length - 1].t : 0; }
  get finished() { return this.cursor >= this.events.length && this.events.length > 0; }

  async replay(url) {
    this.stopLive();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bundle ${url}: ${res.status}`);
    this.load(parseNdjson(await res.text()));
    this.play();
  }

  // LIVE: re-fetch periodically; append only events with a new seq.
  async live(url, intervalMs = 1000) {
    this.stopLive();
    this.load([]);
    this.play();
    const poll = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const all = parseNdjson(await res.text());
          if (all.length > this.events.length) {
            this.events.push(...all.slice(this.events.length));
            this.onAppend(this.events);
          }
        }
      } catch { /* retry next poll */ }
    };
    await poll();
    this._poll = setInterval(poll, intervalMs);
  }

  stopLive() { if (this._poll) clearInterval(this._poll); this._poll = null; }
}
