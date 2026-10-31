// The typed opening's keyboard (owner, Nov 1: "When typing the prompt, add keyboard clacking sound effects"): a
// mechanical key's click for every letter the prompt bar shows, a hollower, longer one for the space bar, and a
// heavier strike for the Enter that presses Make it / Premiere. Synthesized with Web Audio (no sample files): each
// stroke is a bright contact tick (band-passed noise), the key's body (a short pitch-dropping thud and a mid noise
// band) and, a few tens of ms later, the softer upstroke as the key comes back. The strokes vary a little in pitch,
// level and timing by a seeded random (the prompt's text: the same every run, so a frame-exact capture renders the
// same audio). Pure planning (keystrokes) + a renderer on any AudioContext (playStroke); audio.js Choir.typeKeys
// routes them through the master gain, so Mute mutes them. Tested in web/test-keys.mjs.

/** A small, seeded random in [0, 1) (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** The stroke kinds: the letters (and punctuation), the space bar, Enter. */
export const KINDS = ['key', 'space', 'enter'];

/**
 * The keystrokes of the typed opening for `text` on its typing plan (staging.js typingPlan: character i shows at
 * start + i * step, the button pressed at pressAt): [{ t (s from the opening's start), kind, pitch (a ratio near 1),
 * gain (near 1), up (s from the stroke to its upstroke) }]. A stroke sounds a few ms after its character's moment
 * (a key bottoms out as the letter lands), never before it. enter: false leaves the press out.
 */
export function keystrokes(text, plan, { enter = true } = {}) {
  const s = String(text ?? '');
  const rnd = seeded(hash(s) ^ 0x5eed);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const kind = /\s/.test(s[i]) ? 'space' : 'key';
    const jitter = 0.002 + rnd() * 0.014; // (a typist's unevenness, after the frame the letter lands on)
    out.push({
      t: +(plan.start + i * plan.step + jitter).toFixed(5), kind,
      pitch: kind === 'space' ? 0.94 + rnd() * 0.08 : 0.9 + rnd() * 0.2,
      gain: kind === 'space' ? 1.05 + rnd() * 0.15 : 0.8 + rnd() * 0.35,
      up: kind === 'space' ? 0.085 + rnd() * 0.03 : 0.055 + rnd() * 0.035,
    });
  }
  if (enter && plan.pressAt !== undefined) out.push({ t: +(plan.pressAt + 0.004).toFixed(5), kind: 'enter', pitch: 0.97 + rnd() * 0.05, gain: 1, up: Math.max(0.12, (plan.total - plan.pressAt) - 0.02) });
  return out;
}

/** The voicing of each kind: the contact tick's band, the body's thud and band, levels and decays (s). */
const VOICING = {
  key: { tick: 3800, tickQ: 1.4, tickGain: 0.55, tickDecay: 0.006, body: 520, bodyQ: 2.2, bodyGain: 0.42, bodyDecay: 0.018,
    thud: 260, thudGain: 0.28, thudDecay: 0.022, upGain: 0.28, upTick: 4600 },
  space: { tick: 2400, tickQ: 1.1, tickGain: 0.45, tickDecay: 0.009, body: 300, bodyQ: 1.6, bodyGain: 0.55, bodyDecay: 0.04,
    thud: 150, thudGain: 0.38, thudDecay: 0.045, upGain: 0.32, upTick: 2900, rattle: 1700 },
  enter: { tick: 3000, tickQ: 1.2, tickGain: 0.7, tickDecay: 0.009, body: 380, bodyQ: 1.8, bodyGain: 0.7, bodyDecay: 0.035,
    thud: 170, thudGain: 0.55, thudDecay: 0.05, upGain: 0.34, upTick: 3600, rattle: 1300 },
};

const noiseOf = new WeakMap(); // ctx -> a seeded white-noise buffer (the same every run)
function noise(ctx) {
  let b = noiseOf.get(ctx);
  if (!b) {
    const n = Math.floor(ctx.sampleRate * 0.25);
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0), rnd = seeded(1979);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    noiseOf.set(ctx, b);
  }
  return b;
}

/** A burst of band-passed noise at `time`: peak, decay (s), from `offset` s into the noise. */
function burst(ctx, out, time, { f, q, peak, decay, offset = 0 }) {
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(ctx);
  bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.0008);
  g.gain.setTargetAtTime(0, time + 0.0008, decay);
  src.connect(bp).connect(g).connect(out);
  src.start(time, offset % 0.2, decay * 8 + 0.01);
}

/** A short thud: a sine dropping from 1.8x to its pitch, at `time`. */
function thud(ctx, out, time, { f, peak, decay }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 1.8, time);
  o.frequency.exponentialRampToValueAtTime(f, time + 0.012);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.0015);
  g.gain.setTargetAtTime(0, time + 0.0015, decay);
  o.connect(g).connect(out);
  o.start(time); o.stop(time + decay * 8 + 0.02);
}

/**
 * Render one keystroke (keystrokes()) on `ctx` into `out` at ctx time `time`: the down stroke (the tick, the body,
 * the thud; the space bar's and Enter's stabilizer rattle a moment after) and the upstroke `stroke.up` s later.
 * Returns the nodes started (tests count them).
 */
export function playStroke(ctx, out, time, stroke, level = 1) {
  const v = VOICING[stroke.kind] ?? VOICING.key, p = stroke.pitch ?? 1, a = level * (stroke.gain ?? 1);
  const off = (time * 7.31) % 0.2; // (each stroke a different stretch of the noise)
  burst(ctx, out, time, { f: v.tick * p, q: v.tickQ, peak: v.tickGain * a, decay: v.tickDecay, offset: off });
  burst(ctx, out, time + 0.0015, { f: v.body * p, q: v.bodyQ, peak: v.bodyGain * a, decay: v.bodyDecay, offset: off + 0.05 });
  thud(ctx, out, time + 0.001, { f: v.thud * p, peak: v.thudGain * a, decay: v.thudDecay });
  let n = 3;
  if (v.rattle) { burst(ctx, out, time + 0.011, { f: v.rattle * p, q: 3, peak: 0.12 * a, decay: 0.012, offset: off + 0.1 }); n++; }
  const up = time + (stroke.up ?? 0.07);
  burst(ctx, out, up, { f: v.upTick * p, q: 1.6, peak: v.upGain * a, decay: 0.005, offset: off + 0.15 });
  burst(ctx, out, up + 0.001, { f: v.body * 1.15 * p, q: 2, peak: v.upGain * 0.5 * a, decay: 0.01, offset: off + 0.17 });
  return n + 2;
}
