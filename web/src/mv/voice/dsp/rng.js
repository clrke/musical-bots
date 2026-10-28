// Random source and seeds (port of csharp/Mumble/Dsp/Rng.cs).
//
// Rng: xoshiro256** seeded through SplitMix64, with Marsaglia-polar Gaussians, bit-exact with
// the C# port (64-bit arithmetic on 32-bit halves, no BigInt). Like the C# port it does NOT
// reproduce numpy's streams. nextDouble() is bit-identical to C#; nextGaussian() can differ
// from .NET in the last ulp only where Math.log / Math.sqrt round differently.
//
// IRandom (C# interface) = any object with nextGaussian() and nextDouble().

const TWO32 = 4294967296;
const INV53 = 1.0 / 9007199254740992.0;

// ------------------------------------------------------------------ 64-bit helpers
// Values are (hi, lo) pairs of uint32; results of the helpers land in RH / RL.
let RH = 0;
let RL = 0;

/** (ah:al) * (bh:bl) mod 2^64 -> RH:RL. */
function mul64(ah, al, bh, bl) {
  const a0 = al & 0xffff;
  const a1 = al >>> 16;
  const b0 = bl & 0xffff;
  const b1 = bl >>> 16;
  const p00 = a0 * b0;
  const mid = a1 * b0 + a0 * b1 + (p00 >>> 16); // < 2^34, exact
  RL = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  RH = (a1 * b1 + Math.floor(mid / 65536) + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
}

/** (ah:al) + (bh:bl) mod 2^64 -> RH:RL. */
function add64(ah, al, bh, bl) {
  const lo = (al >>> 0) + (bl >>> 0);
  RL = lo >>> 0;
  RH = ((ah >>> 0) + (bh >>> 0) + (lo >= TWO32 ? 1 : 0)) >>> 0;
}

/** Logical (h:l) >> k for 0 < k < 32 -> RH:RL. */
function shr64(h, l, k) {
  RL = ((l >>> k) | (h << (32 - k))) >>> 0;
  RH = h >>> k;
}

/** SplitMix64 output function of (h:l) -> RH:RL. */
function mix64(h, l) {
  shr64(h, l, 30);
  mul64(h ^ RH, l ^ RL, 0xbf58476d, 0x1ce4e5b9);
  h = RH;
  l = RL;
  shr64(h, l, 27);
  mul64(h ^ RH, l ^ RL, 0x94d049bb, 0x133111eb);
  h = RH;
  l = RL;
  shr64(h, l, 31);
  RH = (h ^ RH) >>> 0;
  RL = (l ^ RL) >>> 0;
}

const GOLDEN_HI = 0x9e3779b9;
const GOLDEN_LO = 0x7f4a7c15;

/**
 * k-th SplitMix64 output (k >= 1) from state (hi:lo): mix(state + 0x9E3779B97F4A7C15 * k).
 * @returns {[number, number]} [hi, lo] uint32
 */
export function splitMix64At(hi, lo, k) {
  mul64(GOLDEN_HI, GOLDEN_LO, Math.floor(k / TWO32) >>> 0, k >>> 0);
  add64(hi, lo, RH, RL);
  mix64(RH, RL);
  return [RH, RL];
}

/** Number seed (safe integer, negative = two's complement) -> [hi, lo]. */
function splitSeed(seed) {
  if (!Number.isSafeInteger(seed)) throw new RangeError(`Rng seed must be a safe integer, got ${seed}`);
  const hi = Math.floor(seed / TWO32);
  return [hi >>> 0, (seed - hi * TWO32) >>> 0];
}

// ------------------------------------------------------------------ xoshiro256**
/**
 * One xoshiro256** step. s = Int32Array [s0h, s0l, s1h, s1l, s2h, s2l, s3h, s3l, rh, rl]; the
 * 64-bit result goes to s[8] (hi) / s[9] (lo).
 */
function step(s) {
  const s0h = s[0];
  const s0l = s[1];
  const s1h = s[2];
  const s1l = s[3];
  let s2h = s[4];
  let s2l = s[5];
  let s3h = s[6];
  let s3l = s[7];
  // result = rotl(s1 * 5, 7) * 9
  let lo = (s1l >>> 0) * 5;
  const xl = lo >>> 0;
  const xh = (Math.imul(s1h, 5) + Math.floor(lo / TWO32)) | 0;
  const yh = (xh << 7) | (xl >>> 25);
  const yl = (xl << 7) | (xh >>> 25);
  lo = (yl >>> 0) * 9;
  s[9] = lo >>> 0;
  s[8] = (Math.imul(yh, 9) + Math.floor(lo / TWO32)) | 0;
  // t = s1 << 17
  const th = (s1h << 17) | (s1l >>> 15);
  const tl = s1l << 17;
  s2h ^= s0h;
  s2l ^= s0l;
  s3h ^= s1h;
  s3l ^= s1l;
  s[2] = s1h ^ s2h;
  s[3] = s1l ^ s2l;
  s[0] = s0h ^ s3h;
  s[1] = s0l ^ s3l;
  s[4] = s2h ^ th;
  s[5] = s2l ^ tl;
  // s3 = rotl(s3, 45): swap the halves, then rotl 13
  s[6] = (s3l << 13) | (s3h >>> 19);
  s[7] = (s3h << 13) | (s3l >>> 19);
}

/**
 * Deterministic xoshiro256** generator (seeded through SplitMix64) with Marsaglia-polar
 * Gaussians; same streams as the C# Rng.
 */
export class Rng {
  /**
   * @param {number} [seed] 64-bit seed as a safe integer (negative = two's complement, as
   *   C# (ulong)(long)seed); use Rng.fromHiLo for full 64-bit seeds
   */
  constructor(seed = 0) {
    /** @private state + last result */
    this.s = new Int32Array(10);
    this.spare = 0.0;
    this.hasSpare = false;
    const [hi, lo] = splitSeed(seed);
    this.seedHiLo(hi, lo);
  }

  /** @private */
  seedHiLo(hi, lo) {
    for (let k = 0; k < 4; k++) {
      const [h, l] = splitMix64At(hi, lo, k + 1);
      this.s[2 * k] = h | 0;
      this.s[2 * k + 1] = l | 0;
    }
    this.hasSpare = false;
    this.spare = 0.0;
  }

  /**
   * Generator from a 64-bit seed given as uint32 halves.
   * @param {number} hi
   * @param {number} lo
   */
  static fromHiLo(hi, lo) {
    const r = new Rng(0);
    r.seedHiLo(hi >>> 0, lo >>> 0);
    return r;
  }

  /**
   * The C# Renderer.Streams derivation: generator i of `count` is seeded with the (i+1)-th
   * SplitMix64 output from state (baseHi:baseLo).
   * @returns {Rng[]}
   */
  static streams(baseHi, baseLo, count) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const [h, l] = splitMix64At(baseHi, baseLo, i + 1);
      out[i] = Rng.fromHiLo(h, l);
    }
    return out;
  }

  /**
   * Next raw 64-bit value as uint32 halves.
   * @param {Uint32Array|number[]} [out]
   * @returns {Uint32Array|number[]} out = [hi, lo]
   */
  nextULong(out = new Uint32Array(2)) {
    step(this.s);
    out[0] = this.s[8] >>> 0;
    out[1] = this.s[9] >>> 0;
    return out;
  }

  /** Uniform deviate in [0, 1) with 53 random bits. */
  nextDouble() {
    const s = this.s;
    step(s);
    return ((s[8] >>> 0) * 2097152 + (s[9] >>> 11)) * INV53;
  }

  /** Standard normal deviate (Marsaglia polar method; second value cached). */
  nextGaussian() {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u;
    let v;
    let s;
    do {
      u = 2.0 * this.nextDouble() - 1.0;
      v = 2.0 * this.nextDouble() - 1.0;
      s = u * u + v * v;
    } while (s >= 1.0 || s === 0.0);
    const m = Math.sqrt(-2.0 * Math.log(s) / s);
    this.spare = v * m;
    this.hasSpare = true;
    return u * m;
  }
}

// ------------------------------------------------------------------ CRC-32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3, same as Python's zlib.crc32). */
export const Crc32 = Object.freeze({
  /**
   * @param {Uint8Array|number[]} data bytes
   * @returns {number} uint32
   */
  compute(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  },
});

const utf8 = new TextEncoder();

/** Per-line seed helpers. */
export const Seed = Object.freeze({
  /**
   * CRC-32 of UTF-8 `${text.lower()}|${voice}|${seed}`, as render._rngs in Python (lower-cased
   * so shouting a line keeps its tune).
   * @param {string} text
   * @param {string} voiceName
   * @param {number} seed
   * @returns {number} uint32
   */
  fromText(text, voiceName, seed) {
    return Crc32.compute(utf8.encode((text ?? '').toLowerCase() + '|' + voiceName + '|' + String(seed)));
  },

  /**
   * The line's independent generators (C# Renderer.Streams): base seed
   * ((ulong)crc << 32) | (uint)seed, split per stream with SplitMix64.
   * @param {string} text
   * @param {string} voiceName
   * @param {number} seed int
   * @param {number} [count] 11 in the renderer
   * @returns {Rng[]}
   */
  streams(text, voiceName, seed, count = 11) {
    return Rng.streams(Seed.fromText(text, voiceName, seed), seed >>> 0, count);
  },
});
