import { chordNotes, chordsInWindow, melodyFor, midiToHz, VOICES, VOWELS } from './audio-theory.js';
import { CAST } from './gen/cast.js';

const BAR = 2.0; // seconds per bar at 120 bpm, 4/4

// Raw Web Audio: lookahead chord scheduler + formant-ish voices.
export class Choir {
  constructor() {
    this.ctx = null;
    this.chords = [];
    this.origin = 0;
    this.scheduledTo = 0;
    this.notes = 0;
    this.muted = false;
    this._timer = null;
  }

  // Must run from a user gesture.
  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.origin = this.ctx.currentTime + 0.1;
      this.scheduledTo = this.origin;
      this._timer = setInterval(() => this._schedule(), 50);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  setChords(c) { this.chords = c; }

  _schedule() {
    const now = this.ctx.currentTime, to = now + 0.25;
    for (const { time, chord } of chordsInWindow(this.chords, this.origin, BAR, Math.max(this.scheduledTo, now), to)) {
      this._pad(chord, time);
    }
    this.scheduledTo = Math.max(this.scheduledTo, to);
  }

  _pad(sym, time) {
    const { root, notes } = chordNotes(sym);
    for (const m of [root - 12, ...notes]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = m < root ? 'sine' : 'triangle';
      o.frequency.value = midiToHz(m);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(m < root ? 0.16 : 0.07, time + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, time + BAR / 2);
      o.connect(g).connect(this.master);
      o.start(time); o.stop(time + BAR / 2 + 0.05);
      this.notes++;
    }
  }

  // Sing a lyric as a melody; one note per word through two vowel formants.
  sing(botName, lyric) {
    if (!this.ctx || !lyric) return;
    const voiceName = CAST[botName]?.voice ?? 'alto';
    const voice = VOICES[voiceName] ?? VOICES.alto;
    let t = this.ctx.currentTime + 0.05;
    for (const n of melodyFor(lyric, voiceName)) {
      const dur = n.beats * (BAR / 4) * 1.5;
      const src = this.ctx.createOscillator();
      src.type = voice.robot ? 'square' : 'sawtooth';
      src.frequency.setValueAtTime(midiToHz(n.midi), t);
      const vib = this.ctx.createOscillator(), vg = this.ctx.createGain();
      vib.frequency.value = 5.5; vg.gain.value = 4; vib.connect(vg).connect(src.frequency);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.04);
      env.gain.setValueAtTime(0.5, t + dur - 0.08);
      env.gain.linearRampToValueAtTime(0, t + dur);
      for (const f of VOWELS[n.vowel]) {
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
        const g = this.ctx.createGain(); g.gain.value = f < 1000 ? 0.5 : 0.3;
        src.connect(bp).connect(g).connect(env);
      }
      env.connect(this.master);
      src.start(t); src.stop(t + dur); vib.start(t); vib.stop(t + dur);
      t += dur;
      this.notes++;
    }
  }
}
