// Plan data of one line (port of csharp/Mumble/Render/RenderData.cs, mumble/render.py dataclasses).

/**
 * Formant target: F1..F7 and bandwidths (Hz) plus the gain (dB) that makes it unit RMS with
 * its intrinsic level offset. Compared by reference (as Python's `is`).
 */
export class Target {
  /** @param {number[]} F @param {number[]} B @param {number} levelDb */
  constructor(F, B, levelDb) {
    this.F = F;
    this.B = B;
    this.levelDb = levelDb;
  }
}

/**
 * One syllable's continuous voicing: optional onset sonorant, the vowel (or syllabic nasal /
 * liquid), optional coda sonorants (render.VoicedUnit).
 */
export class VoicedUnit {
  constructor(syllable, word, phrase, nucleus, sym, kind, sonOnset, sonCoda, shout) {
    /** Position in the line's unit list. */
    this.index = 0;
    this.syllable = syllable;
    this.word = word;
    this.phrase = phrase;
    this.nucleus = nucleus;
    this.sym = sym;
    /** "vowel" or "syllabic". */
    this.kind = kind;
    /** @type {number[]} */
    this.sonOnset = sonOnset;
    /** @type {number[]} */
    this.sonCoda = sonCoda;
    this.shout = shout;
    this.leadStart = 0.0;
    this.nucT = 0.0;
    /** @type {number[]} */
    this.codaStarts = [];
    this.lastSonStart = 0.0;
    this.coreMinEnd = 0.0;
    /** Obstruent right before (plosive / fricative / affricate / aspirate) or null. */
    this.preKind = null;
    this.prePhone = -1;
    /** Plosive release level: "full", "final" or null. */
    this.preLevel = null;
    this.preVoiced = false;
    /** Obstruent right after: phone index, or -1. */
    this.postPhone = -1;
    /** Start time of the obstruent right after. */
    this.postStart = 0.0;
    /** Unit that follows with no obstruent in between, or null. @type {VoicedUnit|null} */
    this.nextUnit = null;
    this.on = 0.0;
    this.off = 0.0;
    this.attack = 0.03;
    this.release = 0.045;
    this.hasAsp = false;
    this.aspOn = 0.0;
    this.aspOff = 0.0;
    this.aspDb = -60.0;
    this.aspAttack = 0.015;
    this.aspRelease = 0.03;
    this.breath = 0.0;
    this.bright = 0.0;
    this.gainDb = 0.0;
    this.fadeDb = 0.0;
    /** Pitch (cents re the voice f0) at the start / end of the unit. */
    this.cOn = 0.0;
    this.cOff = 0.0;
    /** @type {Array<{t:number, target:Target}>} */
    this.keyframes = [];
    /** Steady part of the nucleus (s). */
    this.holdStart = 0.0;
    this.holdEnd = 0.0;
    this.label = '';
    /** Human mode: times / dB that undo pitch-driven level swings (null = none). */
    this.levelFixT = null;
    this.levelFixDb = null;
    /** Human mode: level change from the end of the swell to off (dB). */
    this.gainSlopeDb = 0.0;
  }
}

/** Fricative / affricate noise or plosive burst (render.NoiseEvent). */
export class NoiseEvent {
  constructor(kind, sym, on, off, attack, release, lo, hi, gainDb, buzzDb, phone, shape, label) {
    /** fricative / affricate / burst / final_burst. */
    this.kind = kind;
    this.sym = sym;
    this.on = on;
    this.off = off;
    this.attack = attack;
    this.release = release;
    this.lo = lo;
    this.hi = hi;
    this.gainDb = gainDb;
    /** gainDb as planned, before the human-mode prosody follow. */
    this.baseGainDb = gainDb;
    /** Low voicing buzz under voiced fricatives (dB), or null. */
    this.buzzDb = buzzDb;
    this.phone = phone;
    /** "ahr" or "burst". */
    this.shape = shape;
    this.label = label;
  }
}

/** Silent stop closure (render.Closure). */
export class Closure {
  constructor(t0, t1, sym, released, wordFinal, phone, label) {
    this.t0 = t0;
    this.t1 = t1;
    this.sym = sym;
    this.released = released;
    this.wordFinal = wordFinal;
    this.phone = phone;
    this.label = label;
  }
}

/** One rendered line plus its plan (render.RenderResult). */
export class RenderResult {
  constructor(fields) {
    /** Peak-normalised mono samples at fs. @type {Float32Array} */
    this.audio = fields.audio;
    this.fs = fields.fs;
    this.text = fields.text;
    this.voice = fields.voice;
    this.mode = fields.mode;
    this.analysis = fields.analysis;
    /** @type {VoicedUnit[]} */
    this.units = fields.units;
    /** @type {NoiseEvent[]} */
    this.noises = fields.noises;
    /** @type {Closure[]} */
    this.closures = fields.closures;
    /** Pitch track, one value per millisecond (null for a plan only). */
    this.f0Ms = fields.f0Ms ?? null;
    /** Normalisation gain that was applied. */
    this.scale = fields.scale ?? 1.0;
    this.renderSeconds = fields.renderSeconds ?? 0.0;
  }

  /** Length in seconds. */
  get duration() {
    return this.audio.length / this.fs;
  }

  /** Pitch (Hz) at time t. */
  f0At(t) {
    const f = this.f0Ms;
    const x = t * 1000.0;
    if (x <= 0) return f[0];
    const i = Math.floor(x);
    if (i >= f.length - 1) return f[f.length - 1];
    return f[i] + (x - i) * (f[i + 1] - f[i]);
  }
}
