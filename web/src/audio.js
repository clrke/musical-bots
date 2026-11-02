import { chordNotes, midiToHz } from './audio-theory.js';
import { planEpisode, chordAtBar, BAR } from './sing-plan.js';
import { createVoicePool } from './mv/voice/pool.js';
import { WET, LAYER_EQ, ROLE_EQ, PAN } from './song/mix.js';
import { playStroke } from './keys.js';

const DUCK = 0.4; // LIVE: an earlier line still ringing when a later one starts drops to a backing level
const VOICE_GAIN = 2.6; // the engine renders at LEVEL 0.1 full scale; the storyteller's level
const MASTER = 0.55;
const KEYS_GAIN = 0.32; // the typed opening's keyboard, under the voices to come
const dbGain = (db) => 10 ** (db / 20);
/**
 * Measurement hook: ?layers=story,reply plays only those layers of the premiere (song/mix.js layers;
 * LIVE lines count as the story), e.g. the lead alone through the same room and limiter as the mix.
 */
const LAYERS = (() => {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get('layers')?.split(',').filter(Boolean) ?? null; } catch { return null; }
})();

/** A planned line's lift (song/mix.js: [[song s, dB], ...]) at song time t, interpolated. */
export function liftAt(lift, t) {
  if (!lift?.length) return 0;
  if (t <= lift[0][0]) return lift[0][1];
  for (let i = 1; i < lift.length; i++) {
    const [t1, d1] = lift[i];
    if (t <= t1) {
      const [t0, d0] = lift[i - 1];
      return t1 > t0 ? d0 + ((d1 - d0) * (t - t0)) / (t1 - t0) : d1;
    }
  }
  return lift.at(-1)[1];
}

/**
 * Whether a line that starts at `start` ducks a line still ringing (LIVE only: the premiere is mixed
 * by layer). Lines that start together are sung together (a harmony): never ducked.
 */
export const ducks = (earlierStart, earlierEnd, start) => earlierEnd > start && earlierStart < start - 0.05;

/** BiquadFilters in series after `from` (settings: song/mix.js LAYER_EQ / ROLE_EQ); returns the last node. */
function filterChain(ctx, from, eq = []) {
  let node = from;
  for (const f of eq ?? []) {
    const b = ctx.createBiquadFilter();
    b.type = f.type;
    b.frequency.value = f.f;
    if (f.q !== undefined) b.Q.value = f.q;
    if (f.gain !== undefined) b.gain.value = f.gain;
    node.connect(b);
    node = b;
  }
  return node;
}

// A generated room impulse (decaying stereo noise with a darkening tail): no impulse files.
function roomImpulse(ctx, seconds = 2.2, decay = 3.2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      lp += (rnd() - lp) * (0.9 - 0.75 * u); // high frequencies die first
      d[i] = lp * Math.pow(1 - u, decay);
    }
  }
  return ir;
}

// Web Audio choir: sung lines from the Magna Vocalization voice engine (pre-rendered per episode in a
// worker pool) and one shared room reverb. The premiere (arranged lines, sing-plan.js arrange) is all
// sung, the backing too, each line at its layer's level (song/mix.js); the making-of is a cappella too (setVamp);
// only an old LIVE plan (planEpisode, no score) gets a soft chord pad on the bar grid. And the typed opening's
// keyboard (typeKeys, keys.js), through the same master.
export class Choir {
  constructor() {
    this.ctx = null;
    this.chords = [];
    this.songStart = null; // ctx time of song time 0
    this.scheduledTo = 0;
    this.notes = 0;
    this.muted = false;
    this.arranged = false; // the premiere: its backing is sung (no synth pad)
    this.lines = new Map(); // seq -> { plan, segments: [{ at, buffer, offset }], syllables, length }
    this.stats = null; // the last prepare: { lines, jobs, distinct, ms }
    this._active = [];
    this._playing = []; // the sung lines scheduled or sounding: { gain, srcs, end } (hush)
    this._ahead = new Set(); // the events whose lines singAhead scheduled before they were staged (sing skips them once)
    this._timer = null;
    this.pool = null;
  }

  // Must run from a user gesture.
  async start() {
    // iOS Safari (16.4+): Web Audio as media playback, so the ring / silent switch does not mute the choir (older iOS:
    // the page's touch hint asks for the switch)
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not settable */ }
    if (!this.ctx) {
      const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER;
      // a gentle bus limiter: several lines plus the room can stack past full scale
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 8;
      limiter.attack.value = 0.004; limiter.release.value = 0.2;
      this.master.connect(limiter).connect(ctx.destination);
      this.dry = ctx.createGain();
      this.dry.connect(this.master);
      const verb = ctx.createConvolver();
      verb.buffer = roomImpulse(ctx);
      this.room = ctx.createGain(); // the room's input (each layer sends its own level)
      this.room.connect(verb).connect(this.master);
      this.wet = ctx.createGain(); // LIVE lines and the synth pad
      this.wet.gain.value = 0.28;
      this.wet.connect(this.room);
      // the premiere's layers (song/mix.js): each its EQ, then dry and its room send
      this.buses = {};
      for (const layer of Object.keys(WET)) {
        const input = ctx.createGain();
        const out = filterChain(ctx, input, LAYER_EQ[layer]);
        out.connect(this.dry);
        const send = ctx.createGain();
        send.gain.value = WET[layer];
        out.connect(send).connect(this.room);
        this.buses[layer] = input;
      }
      this._timer = setInterval(() => this._schedule(), 50);
    }
    // never await: without a user gesture resume() stays pending (autoplay policy). iOS also leaves it 'interrupted'
    // (a call, the app sent to the background): resumed by the next tap the same way.
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : MASTER; }
  setChords(c) { this.chords = c; }

  /**
   * The making-of is on (making-of.js vampOf: its clock, beatSec, halfBeats, chordAtHalf ...) or off (null). Since
   * Nov 1 the making-of is a cappella (owner: "Make the making-of purely a cappella. No percussion."): no bass, no
   * chord stabs, no shaker; the crew's sung backing (making-of-score.js BACKING: the "Ooh" / "Ah" pads, the "Mm" on
   * the root, the "Bom, bom" bass, the home chord rung at the end) carries the chords. While it is set the choir
   * plays no instrument at all (not the LIVE pad either): only the prepared, sung lines (sing).
   */
  setVamp(vamp) {
    this.vamp = vamp ?? null;
  }

  /** The prompt bar's keystrokes (keys.js keystrokes) from ctx time `at` (default now): through the master (Mute). */
  typeKeys(strokes, at = null) {
    if (!this.ctx) return 0;
    if (!this.keys) {
      this.keys = this.ctx.createGain();
      this.keys.gain.value = KEYS_GAIN;
      this.keys.connect(this.dry);
      const send = this.ctx.createGain();
      send.gain.value = 0.08; // (a little of the room: the keyboard is in it)
      this.keys.connect(send).connect(this.room);
    }
    const t0 = at ?? this.ctx.currentTime + 0.01;
    for (const k of strokes) playStroke(this.ctx, this.keys, t0 + k.t, k);
    return strokes.length;
  }

  /**
   * Stop every sung line now, with a short fade (the making-of skipped by Play, or a Premiere pressed over it):
   * lines already scheduled ahead (a backing run's later bars) never sound.
   */
  hush(fade = 0.06) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const a of this._playing) {
      if (a.end <= now) continue;
      try {
        a.gain.gain.cancelScheduledValues(now);
        a.gain.gain.setValueAtTime(a.gain.gain.value, now);
        a.gain.gain.linearRampToValueAtTime(0, now + fade);
      } catch { /* a gain already gone */ }
      for (const src of a.srcs) try { src.stop(now + fade + 0.01); } catch { /* not started / stopped */ }
    }
    this._playing = [];
    this._active = [];
    this._ahead.clear();
    this.songStart = null;
  }

  /**
   * Render every sung line of an episode before playback (a backing line's cells one job each: the
   * pool renders identical cells once). lines: the arranged song's (the premiere), else the LIVE plan
   * of `events`. append: keep the lines already rendered and add the new events' (LIVE).
   */
  async prepare(events, { append = false, lines = null } = {}) {
    await this.start();
    const t0 = performance.now();
    // (a touch screen, a phone's memory: a smaller cache of rendered voices; it only re-renders what fell out of it)
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.pool ??= createVoicePool({ size: Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)), maxBytes: (touch ? 96 : 160) * 1024 * 1024 });
    // a newer full prepare (another episode) supersedes this one: its stale renders must not land in
    // this.lines (the same seq numbers would sing the old episode's lines)
    const token = append ? this._prep : (this._prep = {});
    if (!append) this.lines.clear();
    // (the player's own append, no lines: the making-of's staged events bring theirs; the mode stays)
    if (lines || !append) this.arranged = Boolean(lines);
    // the making-of's staged events (`kind`) bring their own plans (making-of-score.js): never the LIVE planner's
    const plans = (lines ?? (events.some((e) => e.kind) ? [] : planEpisode(events))).filter((p) => !this.lines.has(p.seq));
    const parts = plans.map((p) => p.segments?.length ? p.segments : [{ at: p.at, job: p.job }]);
    const jobs = parts.flat();
    const results = await Promise.all(jobs.map((g) => this.pool.render(g.job).catch((err) => {
      console.warn('[voice]', g.job.voice, err.message);
      return null;
    })));
    if (token !== this._prep) return this.lines.size;
    const buffers = new Map(); // render result -> AudioBuffer (identical cells share one)
    const bufferOf = (r) => {
      if (!r?.pcm?.length) return null;
      let b = buffers.get(r);
      if (!b) {
        b = this.ctx.createBuffer(1, r.pcm.length, r.sampleRate);
        b.copyToChannel(r.pcm, 0);
        buffers.set(r, b);
      }
      return b;
    };
    let k = 0;
    plans.forEach((plan, i) => {
      const segments = [], syllables = [];
      for (const g of parts[i]) {
        const r = results[k++];
        const buffer = bufferOf(r);
        if (!buffer) continue;
        segments.push({ at: g.at, buffer, offset: r.startOffset });
        const dt = g.at - plan.at;
        for (const s of r.syllableTimes) syllables.push({ t0: s.t0 + dt, t1: s.t1 + dt });
      }
      if (!segments.length) return;
      this.lines.set(plan.seq, { plan, segments, syllables, length: syllables.at(-1)?.t1 ?? plan.bars * BAR });
    });
    this.stats = { lines: plans.length, jobs: jobs.length, distinct: buffers.size, ms: Math.round(performance.now() - t0) };
    console.info(`[choir] ${this.stats.lines} lines, ${this.stats.jobs} jobs (${this.stats.distinct} distinct) rendered in ${this.stats.ms} ms`);
    return this.lines.size;
  }

  /** Song time 0 is now (call with the player's play()). */
  begin() {
    if (!this.ctx) return;
    this.songStart = this.ctx.currentTime + 0.05;
    this.scheduledTo = this.songStart;
    this._active = [];
    this._ahead.clear();
  }

  /** Keep song time locked to the transport (after a late resume, a tab stall, or drift). */
  follow(playerTime) {
    if (!this.ctx || this.songStart === null || this.ctx.state !== 'running') return;
    const drift = this.ctx.currentTime - this.songStart - playerTime;
    if (Math.abs(drift) > 0.25) { this.songStart += drift; this.scheduledTo = this.ctx.currentTime; }
  }

  /** The prepared line for an event: { delay (s after the event), length, syllables } or null. */
  lineFor(e) {
    const l = this.lines.get(e.seq);
    return l ? { delay: Math.max(0, l.plan.at - e.t), length: l.length, syllables: l.syllables } : null;
  }

  _schedule() {
    if (this.songStart === null) return;
    const now = this.ctx.currentTime, to = now + 0.25;
    // (the making-of, this.vamp: a cappella, nothing to schedule; the premiere is all sung)
    if (!this.vamp && !this.arranged && this.chords.length) {
      let bar = Math.ceil((Math.max(this.scheduledTo, now) - this.songStart) / BAR - 1e-9);
      for (let time = this.songStart + bar * BAR; time < to; bar++, time += BAR) this._pad(chordAtBar(this.chords, bar), time);
    }
    this.scheduledTo = Math.max(this.scheduledTo, to);
  }

  _pad(sym, time) {
    const { root, notes } = chordNotes(sym);
    for (const m of [root - 12, ...notes]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
      o.type = m < root ? 'sine' : 'triangle';
      o.frequency.value = midiToHz(m);
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      const peak = m < root ? 0.09 : 0.035;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.12);
      g.gain.setTargetAtTime(peak * 0.55, time + 0.12, 0.6);
      g.gain.setTargetAtTime(0, time + BAR - 0.15, 0.08);
      o.connect(lp).connect(g);
      g.connect(this.dry);
      g.connect(this.wet);
      o.start(time); o.stop(time + BAR + 0.4);
      this.notes++;
    }
  }

  /**
   * A hidden tab (no frames; its timers about once a second, main.js): the lines of events due soon (transport-clock.js
   * dueAhead) scheduled now on the song clock, so each starts on time, not up to a timer's period late (clipped);
   * the event's own sing, when the stage gets to it, is then skipped. Returns how many were scheduled.
   */
  singAhead(events) {
    let n = 0;
    for (const e of events) if (!this._ahead.has(e) && this.sing(e)) { this._ahead.add(e); n++; }
    return n;
  }

  /**
   * Sing an event's prepared line on the song clock (its segments, at its layer's level with its lift). Returns
   * whether anything was scheduled (a line singAhead scheduled already: not again).
   */
  sing(e) {
    if (this._ahead.delete(e)) return false;
    if (!this.ctx || this.songStart === null) return false;
    const l = this.lines.get(e.seq);
    if (!l) return false;
    if (LAYERS && !LAYERS.includes(l.plan.layer ?? 'story')) return false;
    const now = this.ctx.currentTime;
    const { plan } = l;
    const g = this.ctx.createGain();
    // (a panned mono part keeps its loudness: the equal-power panner takes 3 dB off)
    const pan = plan.layer && this.ctx.createStereoPanner ? PAN[plan.role] ?? 0 : 0;
    const level = VOICE_GAIN * dbGain(plan.db ?? 0) * (pan ? Math.SQRT2 : 1);
    const songNow = now - this.songStart;
    g.gain.setValueAtTime(level * dbGain(liftAt(plan.lift, songNow)), now);
    for (const [t, db] of plan.lift ?? []) if (t > songNow) g.gain.linearRampToValueAtTime(level * dbGain(db), this.songStart + t);
    const bus = plan.layer && this.buses[plan.layer];
    if (bus) {
      // the premiere: its part's EQ and stereo place, into its layer (EQ, dry + room send)
      let out = filterChain(this.ctx, g, ROLE_EQ[plan.role]);
      if (pan) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        out = out.connect(p);
      }
      out.connect(bus);
    } else {
      g.connect(this.dry);
      g.connect(this.wet);
    }
    let start = Infinity, end = 0;
    const srcs = [];
    for (const s of l.segments) {
      const at = this.songStart + s.at + s.offset; // buffer start (offset < 0: the pre-roll)
      const skip = Math.max(0, now - at);
      if (skip >= s.buffer.duration) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = s.buffer;
      src.connect(g);
      src.start(Math.max(at, now), skip);
      srcs.push(src);
      start = Math.min(start, Math.max(at, now));
      end = Math.max(end, at + s.buffer.duration);
    }
    if (end === 0) return false;
    this._playing = this._playing.filter((a) => a.end > now);
    this._playing.push({ gain: g, srcs, end });
    if (!plan.layer) {
      // LIVE: a line still ringing from an earlier start drops to a backing level (a line sung together is not)
      const voice = this.songStart + plan.at;
      for (const a of this._active) {
        if (ducks(a.start, a.end, voice)) a.gain.gain.setTargetAtTime(VOICE_GAIN * DUCK, Math.max(now, voice), 0.15);
      }
      this._active = this._active.filter((a) => a.end > now);
      this._active.push({ gain: g, start: voice, end });
    }
    this.notes += plan.job.notes.length;
    return true;
  }
}
