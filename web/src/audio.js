import { chordNotes, midiToHz } from './audio-theory.js';
import { planEpisode, chordAtBar, BAR } from './sing-plan.js';
import { createVoicePool } from './mv/voice/pool.js';

const DUCK = 0.4; // an earlier line still ringing when a new one starts drops to a backing level
const VOICE_GAIN = 2.6; // the engine renders at LEVEL 0.1 full scale
const MASTER = 0.55;

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

// Web Audio choir: sung lines from the Magna Vocalization voice engine (pre-rendered per episode
// in a worker pool), a soft chord pad on the same bar grid, and one shared room reverb.
export class Choir {
  constructor() {
    this.ctx = null;
    this.chords = [];
    this.songStart = null; // ctx time of song time 0
    this.scheduledTo = 0;
    this.notes = 0;
    this.muted = false;
    this.lines = new Map(); // seq -> { plan, buffer, syllables }
    this._active = [];
    this._timer = null;
    this.pool = null;
  }

  // Must run from a user gesture.
  async start() {
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
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.28;
      this.wet.connect(verb).connect(this.master);
      this._timer = setInterval(() => this._schedule(), 50);
    }
    // never await: without a user gesture resume() stays pending (autoplay policy)
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : MASTER; }
  setChords(c) { this.chords = c; }

  /**
   * Render every sung line of an episode (before playback; ~1-3 s for a whole episode).
   * append: keep the lines already rendered and add the new events' (LIVE).
   */
  async prepare(events, { append = false, lines = null } = {}) {
    await this.start();
    this.pool ??= createVoicePool({ size: Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)) });
    if (!append) this.lines.clear();
    const plans = (lines ?? planEpisode(events)).filter((p) => !this.lines.has(p.seq));
    const results = await Promise.all(plans.map((p) => this.pool.render(p.job).catch((err) => {
      console.warn('[voice]', p.bot, err.message);
      return null;
    })));
    plans.forEach((plan, i) => {
      const r = results[i];
      if (!r || !r.pcm?.length) return;
      const buffer = this.ctx.createBuffer(1, r.pcm.length, r.sampleRate);
      buffer.copyToChannel(r.pcm, 0);
      this.lines.set(plan.seq, {
        plan, buffer, offset: r.startOffset,
        syllables: r.syllableTimes, length: r.syllableTimes.at(-1)?.t1 ?? plan.bars * BAR,
      });
    });
    return this.lines.size;
  }

  /** Song time 0 is now (call with the player's play()). */
  begin() {
    if (!this.ctx) return;
    this.songStart = this.ctx.currentTime + 0.05;
    this.scheduledTo = this.songStart;
    this._active = [];
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
    let bar = Math.ceil((Math.max(this.scheduledTo, now) - this.songStart) / BAR - 1e-9);
    for (let time = this.songStart + bar * BAR; time < to; bar++, time += BAR) {
      if (this.chords.length) this._pad(chordAtBar(this.chords, bar), time);
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

  /** Sing an event's prepared line on the song clock. */
  sing(e) {
    if (!this.ctx || this.songStart === null) return;
    const l = this.lines.get(e.seq);
    if (!l) return;
    const at = this.songStart + l.plan.at + l.offset; // buffer start (offset < 0: the pre-roll)
    const now = this.ctx.currentTime;
    const skip = Math.max(0, now - at);
    if (skip >= l.buffer.duration) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = l.buffer;
    g.gain.value = VOICE_GAIN;
    src.connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    const start = Math.max(at, now);
    for (const a of this._active) {
      if (a.end > start) a.gain.gain.setTargetAtTime(VOICE_GAIN * DUCK, Math.max(now, this.songStart + l.plan.at), 0.15);
    }
    src.start(start, skip);
    this._active = this._active.filter((a) => a.end > now);
    this._active.push({ gain: g, end: start + l.buffer.duration - skip });
    this.notes += l.plan.job.notes.length;
  }
}
