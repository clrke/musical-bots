// The frame loop's clock when frames stop coming: a hidden tab or an occluded window gets no requestAnimationFrame
// at all (and its timers throttled to about once a second), while the AudioContext plays on. Before Nov 2 the
// transport only advanced in frames, so a hidden making-of or premiere froze (silent, the director's work piling up)
// and the choir's song clock was moved by the whole gap on return. Now a low-rate timer (main.js) keeps the stage
// running from the wall clock while no frame comes, the transport exact, and the lines due before the next timer
// are scheduled on the audio clock ahead of time (audio.js singAhead), so the choir sings on, in time, unseen.

/** Seconds without a frame after which the frame loop is taken as stopped (a hidden tab, an occluded window, a stall). */
export const STALE = 0.3;
/** A step's animation dt at most (the frame loop's own clamp: springs and walks stay stable). */
export const SIM_DT = 0.1;
/** Catch-up steps at most per call (a tab throttled to a timer a minute: the transport exact, the animation coarser). */
export const MAX_STEPS = 30;
/** Seconds of sung lines scheduled ahead while no frame comes (a hidden tab's timers run about once a second). */
export const SING_AHEAD = 2.5;

/**
 * The steps that cover `elapsed` seconds since the last one: [{ sim, transport }], the animation's dt (clamped) and
 * the transport's (their sum is `elapsed`, exactly, unless `cinema`). A normal frame is one step; a gap longer than
 * STALE is cut into steps of SIM_DT (at most MAX_STEPS). cinema (a frame-exact capture, ?cinema): one step, both
 * clamped to SIM_DT, as the frame loop always did (the capture's clock is stepped a frame at a time).
 */
export function frameSteps(elapsed, { cinema = false } = {}) {
  const e = Math.max(0, Number(elapsed) || 0);
  if (cinema) return [{ sim: Math.min(SIM_DT, e), transport: Math.min(SIM_DT, e) }];
  if (e <= STALE) return [{ sim: Math.min(SIM_DT, e), transport: e }];
  const n = Math.min(MAX_STEPS, Math.ceil(e / SIM_DT - 1e-9));
  return Array.from({ length: n }, () => ({ sim: Math.min(SIM_DT, e / n), transport: e / n }));
}

/** The events not staged yet (from `cursor`) whose time comes within `ahead` seconds of `time`. */
export function dueAhead(events, cursor, time, ahead = SING_AHEAD) {
  const out = [];
  for (let i = cursor; i < events.length && events[i].t <= time + ahead; i++) out.push(events[i]);
  return out;
}
