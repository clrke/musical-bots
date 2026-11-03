// Voice profiles (port of csharp/Mumble/Voice.cs, mumble/voice.py): everything that makes one
// NPC sound different from another. Pitch and "tube length" are the two big ones: tube scales
// every formant together, so a woman or a child is not just a pitched-up man.
// Immutable; use voice.with({ ... }) to copy with some fields replaced.

/** Field defaults (match the Python dataclass). */
const DEFAULTS = Object.freeze({
  name: 'neutral',
  /** Base pitch (Hz). */
  f0: 120.0,
  /** Formant scale: 1.0 adult male, ~1.17 woman, ~1.3 child. */
  tube: 1.0,
  /** Typing speed factor (letter step = 1/13 s / speed). */
  speed: 1.0,
  /** Pitch-synchronous breath noise. */
  breath: 0.06,
  /** Cycle-to-cycle period jitter (fraction). */
  jitter: 0.006,
  /** Cycle-to-cycle amplitude shimmer (fraction). */
  shimmer: 0.03,
  /** Slow steady pitch wobble rate (Hz). */
  wobbleHz: 0.0,
  /** Wobble depth (+/- cents). */
  wobbleCents: 0.0,
  /** Scales declination / question rise / nudges. */
  pitchRange: 1.0,
  /** 1 = normal; < 1 pulls formants toward a closed vowel (mumbling). */
  mouth: 1.0,
  /** Spectral tilt: -1 dark .. +1 bright. */
  bright: 0.0,
  /** Plosive release burst loudness 0..1. */
  click: 0.35,
  /** p/t/k aspiration loudness 0..1. */
  aspiration: 0.3,
  /** Very quiet release of a final p/t/k (x click). */
  finalRelease: 0.35,
  /** Vowel swell time (s). */
  attack: 0.030,
  /** Vowel release time (s). */
  release: 0.045,
  /** How far a vowel runs into the next one (s). */
  overlap: 0.030,
  /** Glottal open quotient (lower = pressed / brighter). */
  oq: 0.6,
  /** Human mode: LF voice quality Rd (~0.5 pressed, ~1 modal, ~2 breathy). */
  rd: 1.0,
  /** Human mode: phrase-final creak amount 0..1. */
  creak: 0.5,
  /** Human mode: high-band aperiodicity amount (x the default level). */
  air: 1.0,
});

/** Field names in declaration order. */
export const VOICE_FIELDS = Object.freeze(Object.keys(DEFAULTS));

function checkKeys(kw) {
  for (const k of Object.keys(kw)) {
    if (!Object.hasOwn(DEFAULTS, k)) throw new TypeError(`unknown voice field '${k}'`);
  }
}

export class Voice {
  /**
   * Create a voice; omitted (or null / undefined) fields take the defaults.
   * @param {Partial<Voice>} [fields]
   */
  constructor(fields = {}) {
    checkKeys(fields);
    /** @type {string} */ this.name = DEFAULTS.name;
    /** @type {number} */ this.f0 = DEFAULTS.f0;
    /** @type {number} */ this.tube = DEFAULTS.tube;
    /** @type {number} */ this.speed = DEFAULTS.speed;
    /** @type {number} */ this.breath = DEFAULTS.breath;
    /** @type {number} */ this.jitter = DEFAULTS.jitter;
    /** @type {number} */ this.shimmer = DEFAULTS.shimmer;
    /** @type {number} */ this.wobbleHz = DEFAULTS.wobbleHz;
    /** @type {number} */ this.wobbleCents = DEFAULTS.wobbleCents;
    /** @type {number} */ this.pitchRange = DEFAULTS.pitchRange;
    /** @type {number} */ this.mouth = DEFAULTS.mouth;
    /** @type {number} */ this.bright = DEFAULTS.bright;
    /** @type {number} */ this.click = DEFAULTS.click;
    /** @type {number} */ this.aspiration = DEFAULTS.aspiration;
    /** @type {number} */ this.finalRelease = DEFAULTS.finalRelease;
    /** @type {number} */ this.attack = DEFAULTS.attack;
    /** @type {number} */ this.release = DEFAULTS.release;
    /** @type {number} */ this.overlap = DEFAULTS.overlap;
    /** @type {number} */ this.oq = DEFAULTS.oq;
    /** @type {number} */ this.rd = DEFAULTS.rd;
    /** @type {number} */ this.creak = DEFAULTS.creak;
    /** @type {number} */ this.air = DEFAULTS.air;
    for (const k of VOICE_FIELDS) {
      const v = fields[k];
      if (v !== undefined && v !== null) this[k] = v;
    }
    Object.freeze(this);
  }

  /**
   * Copy with some fields replaced (C# voice.With(...), Python voice.with_(**kw)).
   * @param {Partial<Voice>} kw
   * @returns {Voice}
   */
  with(kw = {}) {
    checkKeys(kw);
    const f = this.asDict();
    for (const k of Object.keys(kw)) if (kw[k] !== undefined && kw[k] !== null) f[k] = kw[k];
    return new Voice(f);
  }

  /** Python spelling of {@link Voice#with}. */
  with_(kw = {}) {
    return this.with(kw);
  }

  /** Plain object with every field. */
  asDict() {
    const o = {};
    for (const k of VOICE_FIELDS) o[k] = this[k];
    return o;
  }

  /**
   * Profile by name; throws for unknown names.
   * @param {string} name
   * @returns {Voice}
   */
  static get(name) {
    if (Object.hasOwn(VOICES, name)) return VOICES[name];
    throw new Error(`unknown voice '${name}'; choose from ${Object.keys(VOICES).join(', ')}`);
  }
}

/** Guard: low, dark, narrow range, lots of creak. */
const guard = new Voice({
  name: 'guard', f0: 92.0, tube: 0.93, speed: 0.9, breath: 0.05, jitter: 0.006, shimmer: 0.03,
  pitchRange: 0.65, mouth: 0.9, bright: -0.2, click: 0.35, attack: 0.035, release: 0.05, oq: 0.55,
  rd: 0.9, creak: 0.8,
});

/** Woman. */
const woman = new Voice({
  name: 'woman', f0: 205.0, tube: 1.17, speed: 1.0, breath: 0.07, jitter: 0.006, shimmer: 0.03,
  pitchRange: 1.1, bright: 0.0, click: 0.33, attack: 0.030, release: 0.045, oq: 0.62, rd: 1.3,
  creak: 0.5,
});

/** Child. */
const child = new Voice({
  name: 'child', f0: 290.0, tube: 1.30, speed: 1.08, breath: 0.06, jitter: 0.007, shimmer: 0.035,
  pitchRange: 1.25, bright: 0.1, click: 0.30, attack: 0.025, release: 0.040, oq: 0.6, rd: 1.2,
  creak: 0.15,
});

/** Old: slow, wobbly, breathy. */
const old = new Voice({
  name: 'old', f0: 135.0, tube: 1.0, speed: 0.82, breath: 0.10, jitter: 0.010, shimmer: 0.06,
  wobbleHz: 2.0, wobbleCents: 50.0, pitchRange: 0.85, mouth: 0.95, bright: -0.35, click: 0.30,
  attack: 0.045, release: 0.060, oq: 0.65, rd: 1.6, creak: 0.7,
});

/** Pirate: mumbles (mouth 0.45). */
const pirate = new Voice({
  name: 'pirate', f0: 100.0, tube: 0.97, speed: 0.92, breath: 0.08, jitter: 0.010, shimmer: 0.06,
  pitchRange: 0.8, mouth: 0.45, bright: -0.3, click: 0.20, attack: 0.040, release: 0.055, oq: 0.55,
  rd: 1.1, creak: 0.9,
});

/** Coach: fast, bright, wide range. */
const coach = new Voice({
  name: 'coach', f0: 128.0, tube: 1.0, speed: 1.15, breath: 0.04, jitter: 0.005, shimmer: 0.025,
  pitchRange: 1.4, mouth: 1.05, bright: 0.3, click: 0.45, attack: 0.020, release: 0.040, oq: 0.5,
  rd: 0.7, creak: 0.3,
});

// Musical Bots: the five voices the Unity app added (Magna.Core/Voice/VoiceProfile.cs), same
// parameters. vibDepth / vibRate (C#-only) are applied by the caller through job.vibrato.
const basso = new Voice({
  name: 'basso', f0: 78.0, tube: 0.82, speed: 0.9, breath: 0.06, jitter: 0.005, shimmer: 0.03,
  pitchRange: 0.7, mouth: 1.1, bright: -0.15, click: 0.30, attack: 0.045, release: 0.070, oq: 0.58,
  rd: 1.2, creak: 0.7,
});
const robo = new Voice({
  name: 'robo', f0: 110.0, tube: 1.06, speed: 1.0, breath: 0.01, jitter: 0.0, shimmer: 0.0,
  pitchRange: 0.5, mouth: 1.1, bright: 0.6, click: 0.55, aspiration: 0.4, attack: 0.012, release: 0.030,
  overlap: 0.012, oq: 0.5, rd: 0.45, creak: 0.0, air: 0.0,
});
const crooner = new Voice({
  name: 'crooner', f0: 118.0, tube: 0.88, speed: 0.9, breath: 0.26, jitter: 0.007, shimmer: 0.04,
  pitchRange: 0.9, mouth: 0.95, bright: -0.3, click: 0.22, aspiration: 0.25, finalRelease: 0.3,
  attack: 0.050, release: 0.070, overlap: 0.045, oq: 0.65, rd: 2.4, creak: 0.4, air: 3.0,
});
const tenor = new Voice({
  name: 'tenor', f0: 155.0, tube: 1.16, speed: 1.0, breath: 0.03, jitter: 0.005, shimmer: 0.02,
  pitchRange: 1.2, mouth: 1.25, bright: 0.2, click: 0.30, attack: 0.032, release: 0.050, overlap: 0.045,
  oq: 0.52, rd: 0.95, creak: 0.15, air: 0.9,
});
const soprano = new Voice({
  name: 'soprano', f0: 255.0, tube: 1.30, speed: 1.0, breath: 0.05, jitter: 0.004, shimmer: 0.02,
  pitchRange: 1.2, mouth: 1.05, bright: 0.5, click: 0.30, attack: 0.030, release: 0.050, overlap: 0.040,
  oq: 0.6, rd: 0.95, creak: 0.0, air: 0.7,
});
/** C#-only vibrato scales per voice (VoiceProfile vibDepth / vibRate). */
export const VIBRATO_SCALE = Object.freeze({
  basso: { depth: 0.9, rate: 1 }, robo: { depth: 0.12, rate: 1 }, crooner: { depth: 1.5, rate: 0.9 },
  tenor: { depth: 1.15, rate: 1.05 }, soprano: { depth: 1.2, rate: 1.05 },
});

/** All named profiles (Python VOICES), in declaration order. */
export const VOICES = Object.freeze({ guard, woman, child, old, pirate, coach, basso, robo, crooner, tenor, soprano });

// static profiles: camelCase (Voice.woman) plus the C# PascalCase names (Voice.Woman)
for (const [k, v] of Object.entries(VOICES)) {
  Object.defineProperty(Voice, k, { value: v, enumerable: true });
  Object.defineProperty(Voice, k[0].toUpperCase() + k.slice(1), { value: v, enumerable: false });
}
Object.defineProperty(Voice, 'VOICES', { value: VOICES, enumerable: true });

/** Python get_voice(name). */
export function getVoice(name) {
  return Voice.get(name);
}
