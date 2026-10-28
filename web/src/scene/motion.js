// Small, allocation-free animation helpers for the robot heads (pure: no three.js, no DOM).

/** Deterministic PRNG (mulberry32): a function returning floats in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame-rate independent exponential approach: move `current` toward `target` at `rate` (1/s). */
export function approach(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Envelope follower: fast attack, slower release (both 1/s rates). */
export function follow(current, target, attack, release, dt) {
  return approach(current, target, target > current ? attack : release, dt);
}

/**
 * Damped spring, in place: state = { x, v }. `k` stiffness (1/s^2), `c` damping (1/s).
 * Semi-implicit Euler, sub-stepped so large dt (tab switches) stays stable.
 */
export function springStep(state, target, k, c, dt) {
  const steps = Math.min(8, Math.max(1, Math.ceil(dt / 0.016)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -k * (state.x - target) - c * state.v;
    state.v += a * h;
    state.x += state.v * h;
  }
  return state.x;
}

/**
 * Idle float offsets per style, written into `out` = { x, y, z, rx, ry, rz } (metres / radians, head-local).
 * `phase` desynchronises heads; `amount` scales everything (muted heads float less).
 */
export function floatOffset(style, t, phase, amount, out) {
  let x = 0;
  let y = 0;
  let z = 0;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  switch (style) {
    case 'bob': {
      const w = (2 * Math.PI) / 2.8;
      const s = Math.sin(w * t + phase);
      y = 0.012 * s;
      rx = -0.045 * Math.cos(w * t + phase); // nods with the bob
      rz = 0.012 * Math.sin(0.5 * w * t + phase * 1.7);
      break;
    }
    case 'sway': {
      const w = (2 * Math.PI) / 3.4;
      const s = Math.sin(w * t + phase);
      rz = 0.11 * s; // a pendulum from a point above the head
      x = -0.012 * s;
      y = 0.004 * Math.cos(2 * (w * t + phase)) - 0.002;
      ry = 0.05 * Math.sin(w * t + phase + 0.6);
      break;
    }
    case 'drift': {
      x = 0.013 * Math.sin(0.53 * t + phase) + 0.005 * Math.sin(1.31 * t + phase * 2.3);
      y = 0.011 * Math.sin(0.71 * t + phase * 1.9) + 0.004 * Math.sin(1.7 * t + phase);
      z = 0.009 * Math.sin(0.47 * t + phase * 2.9);
      ry = 0.07 * Math.sin(0.37 * t + phase);
      rz = 0.05 * Math.sin(0.61 * t + phase * 1.3);
      rx = 0.03 * Math.sin(0.83 * t + phase * 0.7);
      break;
    }
    default: {
      // 'still': only a breath
      y = 0.0015 * Math.sin(1.1 * t + phase);
      break;
    }
  }
  out.x = x * amount;
  out.y = y * amount;
  out.z = z * amount;
  out.rx = rx * amount;
  out.ry = ry * amount;
  out.rz = rz * amount;
  return out;
}

/**
 * Blinking: returns eye openness 1 (open) .. 0 (shut). Random gaps of 2.2-6 s, sometimes a double blink.
 * state = createBlinkState(rng); blinkStep(state, dt) each frame.
 */
export function createBlinkState(rng) {
  return { rng, wait: 1 + rng() * 4, t: -1, double: false };
}

const BLINK_TIME = 0.14;

export function blinkStep(state, dt) {
  if (state.t < 0) {
    state.wait -= dt;
    if (state.wait > 0) return 1;
    state.t = 0;
  }
  state.t += dt;
  const u = state.t / BLINK_TIME;
  if (u >= 1) {
    if (state.double) {
      state.double = false;
      state.t = -1;
      state.wait = 2.2 + state.rng() * 3.8;
    } else if (state.rng() < 0.18) {
      state.double = true;
      state.t = -1;
      state.wait = 0.09;
    } else {
      state.t = -1;
      state.wait = 2.2 + state.rng() * 3.8;
    }
    return 1;
  }
  // close fast, open a little slower
  return u < 0.4 ? 1 - u / 0.4 : (u - 0.4) / 0.6;
}

/**
 * Idle glances: a small look-around target (yaw, pitch radians) that changes every few seconds.
 * state = createGlanceState(rng); glanceStep(state, dt, out) writes out.yaw / out.pitch.
 */
export function createGlanceState(rng) {
  return { rng, wait: 1 + rng() * 3, yaw: 0, pitch: 0 };
}

export function glanceStep(state, dt, out) {
  state.wait -= dt;
  if (state.wait <= 0) {
    const r = state.rng;
    if (r() < 0.45) {
      // back to the viewer
      state.yaw = 0;
      state.pitch = 0;
      state.wait = 2.5 + r() * 4;
    } else {
      state.yaw = (r() * 2 - 1) * 0.32;
      state.pitch = (r() * 2 - 1) * 0.12;
      state.wait = 0.9 + r() * 2.2;
    }
  }
  out.yaw = state.yaw;
  out.pitch = state.pitch;
  return out;
}
