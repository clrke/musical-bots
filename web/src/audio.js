import { chordNotes, midiToHz } from './audio-theory.js';
import { planEpisode, chordAtBar, BAR } from './sing-plan.js';
import { createVoicePool } from './mv/voice/pool.js';
import { WET, LAYER_EQ, ROLE_EQ, PAN } from './song/mix.js';

const DUCK = 0.4; // LIVE: an earlier line still ringing when a later one starts drops to a backing level
const VOICE_GAIN = 2.6; // the engine renders at LEVEL 0.1 full scale; the storyteller's level
const MASTER = 0.55;
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
// sung, the backing too, each line at its layer's level (song/mix.js); LIVE plays a soft chord pad on
// the bar grid under the role bots' lines.
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
    // never await: without a user gesture resume() stays pending (autoplay policy)
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : MASTER; }
  setChords(c) { this.chords = c; }

  /**
   * The making-of's groove under the crew's sung thoughts (making-of-score.js): a light vamp on the song clock, half
   * bar by half bar. 4/4 (halfBeats 2): a bass on beats 1 and 3, a soft chord on 2 and 4, a shaker on the eighths.
   * 6/4 (halfBeats 3, the show's meter since Oct 31): two dotted-half pulses a bar, lilting: the bass on 1 and 4 (the
   * root, then its fifth), the soft chord on 2-3 and 5-6 ("oom-pa-pa"), the shaker on the eighths, leaning on each
   * pulse. And the home chord held at the end. vamp: { beatSec, halfBeats, chordAtHalf(h) -> chord name, startHalf() -> the half bar it comes in on
   * (Infinity: not yet), endHalf() -> the half bar it ends on, or null while it goes on (live) } | null (none: the
   * premiere is all sung).
   */
  setVamp(vamp) {
    this.vamp = vamp ?? null;
    this._vampFrom = null;
  }

  /**
   * Render every sung line of an episode before playback (a backing line's cells one job each: the
   * pool renders identical cells once). lines: the arranged song's (the premiere), else the LIVE plan
   * of `events`. append: keep the lines already rendered and add the new events' (LIVE).
   */
  async prepare(events, { append = false, lines = null } = {}) {
    await this.start();
    const t0 = performance.now();
    this.pool ??= createVoicePool({ size: Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)), maxBytes: 160 * 1024 * 1024 });
    // a newer full prepare (another episode) supersedes this one: its stale renders must not land in
    // this.lines (the same seq numbers would sing the old episode's lines)
    const token = append ? this._prep : (this._prep = {});
    if (!append) this.lines.clear();
    this.arranged = Boolean(lines);
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
    if (this.vamp) this._scheduleVamp(now, to);
    else {
      let bar = Math.ceil((Math.max(this.scheduledTo, now) - this.songStart) / BAR - 1e-9);
      for (let time = this.songStart + bar * BAR; time < to; bar++, time += BAR) {
        if (this.chords.length && !this.arranged) this._pad(chordAtBar(this.chords, bar), time);
      }
    }
    this.scheduledTo = Math.max(this.scheduledTo, to);
  }

  /** The vamp's half bars that start before `to` and have not been scheduled (each once, never in the past). */
  _scheduleVamp(now, to) {
    const v = this.vamp, half = (v.halfBeats ?? 2) * v.beatSec;
    let h = this._vampFrom ?? Math.max(0, Math.ceil((now - this.songStart) / half - 1e-9));
    for (let time = this.songStart + h * half; time < to; h++, time += half) {
      const end = v.endHalf?.();
      if (end !== null && end !== undefined && h >= end) {
        if (h === end) this._vampEnd(v.chordAtHalf(Math.max(0, h - 1)), time, v.beatSec, v.halfBeats ?? 2);
        h++;
        break;
      }
      if (time >= now - 0.02 && h >= (v.startHalf?.() ?? 0)) this._groove(v.chordAtHalf(h), v.chordAtHalf(h - 1), h, time, v.beatSec, v.halfBeats ?? 2);
    }
    this._vampFrom = h;
  }

  /** The vamp's output: dry and a little room, under the voices. */
  _vampBus() {
    if (!this._vbus) {
      this._vbus = this.ctx.createGain();
      this._vbus.gain.value = 0.9;
      this._vbus.connect(this.dry);
      const send = this.ctx.createGain();
      send.gain.value = 0.12;
      this._vbus.connect(send).connect(this.room);
      // the shaker's noise: a seeded buffer (the same every run)
      const n = Math.floor(this.ctx.sampleRate * 0.25);
      this._noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      let seed = 2027;
      for (let i = 0; i < n; i++) d[i] = ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    }
    return this._vbus;
  }

  _tone(midi, time, dur, peak, type, cutoff) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = midiToHz(midi);
    lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.012);
    g.gain.setTargetAtTime(peak * 0.4, time + 0.012, dur * 0.35);
    g.gain.setTargetAtTime(0, time + dur, 0.05);
    o.connect(lp).connect(g).connect(this._vampBus());
    o.start(time); o.stop(time + dur + 0.4);
    this.notes++;
  }

  _shake(time, peak) {
    const src = this.ctx.createBufferSource(), hp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this._noise;
    hp.type = 'highpass'; hp.frequency.value = 7000;
    g.gain.setValueAtTime(peak, time);
    g.gain.setTargetAtTime(0, time + 0.005, 0.025);
    src.connect(hp).connect(g).connect(this._vampBus());
    src.start(time, (time * 7.31) % 0.15, 0.12);
  }

  /** One half bar of the groove: the bass (the root on 1, the fifth on 3 unless the chord changed), a chord on the backbeat, the shaker. */
  _groove(sym, before, h, time, beat, halfBeats = 2) {
    this._vampBus();
    const { root, notes } = chordNotes(sym);
    const changed = sym !== before || h % 2 === 0;
    const bass = (changed ? root : root + 7) - 12; // C2..B2 (C3 + a fifth: under the voices)
    if (halfBeats === 3) {
      // 6/4: the pulse (a dotted half): the bass rings over it, the chord on its two weak beats, the second softer
      this._tone(bass, time, beat * 1.8, h % 2 === 0 ? 0.17 : 0.14, 'sine', 600);
      this._tone(bass + 12, time, beat * 0.8, 0.03, 'triangle', 900);
      for (const [k, peak] of [[1, 0.02], [2, 0.014]]) for (const m of notes) this._tone(m, time + k * beat, beat * 0.45, peak, 'triangle', 1200);
      for (let k = 0; k < 6; k++) this._shake(time + (k * beat) / 2, k === 0 ? 0.045 : k % 2 ? 0.022 : 0.034);
      return;
    }
    this._tone(bass, time, beat * 1.1, 0.16, 'sine', 600);
    this._tone(bass + 12, time, beat * 0.6, 0.03, 'triangle', 900);
    // the backbeat: a short soft chord in the third octave, under the voices' formants
    for (const m of notes) this._tone(m, time + beat, beat * 0.4, 0.02, 'triangle', 1200);
    for (let k = 0; k < 4; k++) this._shake(time + (k * beat) / 2, k % 2 ? 0.05 : 0.025);
  }

  /** The end: the home chord held a bar, fading. */
  _vampEnd(sym, time, beat, halfBeats = 2) {
    this._vampBus();
    const { root, notes } = chordNotes('C');
    void sym;
    const bar = 2 * halfBeats * beat;
    this._tone(root - 12, time, bar, 0.16, 'sine', 600);
    for (const m of notes) this._tone(m, time, bar, 0.03, 'triangle', 1400);
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

  /** Sing an event's prepared line on the song clock (its segments, at its layer's level with its lift). */
  sing(e) {
    if (!this.ctx || this.songStart === null) return;
    const l = this.lines.get(e.seq);
    if (!l) return;
    if (LAYERS && !LAYERS.includes(l.plan.layer ?? 'story')) return;
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
    for (const s of l.segments) {
      const at = this.songStart + s.at + s.offset; // buffer start (offset < 0: the pre-roll)
      const skip = Math.max(0, now - at);
      if (skip >= s.buffer.duration) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = s.buffer;
      src.connect(g);
      src.start(Math.max(at, now), skip);
      start = Math.min(start, Math.max(at, now));
      end = Math.max(end, at + s.buffer.duration);
    }
    if (end === 0) return;
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
  }
}
