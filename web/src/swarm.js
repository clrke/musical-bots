// The swarm: the bots' glides steer round each other (blocking.js calls it every frame, in the sets and in the studio).
// Each bot wants its glide velocity (rig.js glideVelocity: toward its next waypoint / its mark); steer() bends that wish
// with two terms per neighbour, Reynolds-style:
//   - predictive avoidance (unaligned collision avoidance by time to collision): the two heads' circles (summed
//     half-widths + a margin, level, allowing for their heights) are extrapolated along the relative velocity; a contact
//     due within the horizon makes the bot sidestep away from the side the other will be on (and ease off a little),
//     harder the sooner it comes. Head-on, each goes to its own right (they pass). Two movers share the dodge; a mover
//     passing a settled bot takes it all while the settled one sidesteps a little (polite yielding). The look-ahead
//     never runs past the end of the glides, so it fades as a bot parks beside a settled one; a bot whose mark is where
//     another stands does not dodge at all (no circling round each other): the separation sets them side by side.
//   - separation: heads closer than touching (+ a small buffer while either moves) push apart, by mobility.
// Heads count as they are drawn (the acting's and a hand play's offsets) and, while they are off their places, as they
// come back. The result goes to rig.push (the rig adds it to the glide's wish). Then resolve(), the last resort: two
// heads that would still meet in this frame's step are moved apart (millimetres; a crowd presses, never passes through).
// Immobile bots (seated extras, bots held still by a hand play) are obstacles only; pairs in contact on purpose
// (contact(a, b): a hand play's cast, the acting's partners) are left alone. Plain arithmetic in a stable order (the
// list as given), no randomness: deterministic.

const BRAKE = 0.3; // share of a dodge that slows the bot (the rest is sideways)

export const SWARM = Object.freeze({
  horizon: 1.6, //   s of look-ahead
  margin: 0.1, //    m kept between two heads' circles (on top of their half-widths)
  buffer: 0.08, //   m: separation starts this far out while either bot moves
  sepGain: 7, //     m/s of push per metre inside the separation zone
  dodge: 1.25, //    x the relative speed: the sidestep at a contact due now
  yieldShare: 0.3, // share of a dodge a settled bot takes (the mover takes the rest)
  maxPush: 2.6, //   m/s, the steering's cap
  skin: 0.012, //    m: resolve() keeps heads at least this far from touching
});

/**
 * Steer the agents (in place: each agent's bot.push). agents: [{ bot, x, y, z (head centre, world), bx, by, bz (the
 * head's centre without its offsets: where it comes back to), gx, gz (its mark), vx, vz (its glide now), wx, wz (its
 * glide's wish), r (head half-width, m), mobile, moving, left (s of glide left) }], in a stable order. contact(a, b):
 * bots a and b may touch (no steering between them).
 */
export function steer(agents, contact = null) {
  const n = agents.length;
  for (const a of agents) { a.px = 0; a.pz = 0; }
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    const offA = Math.abs(a.x - a.bx) + Math.abs(a.y - a.by) + Math.abs(a.z - a.bz);
    for (let j = i + 1; j < n; j++) {
      const b = agents[j];
      if (!a.mobile && !b.mobile) continue;
      if (Math.abs(b.bx - a.bx) + Math.abs(b.bz - a.bz) > 6) continue; // far apart (heads travel ~1 m at most)
      if (contact?.(a.bot, b.bot)) continue;
      // the heads as they are now (offsets and all); while either is off its place, also as they come back to it
      pair(a, b, b.x - a.x, b.y - a.y, b.z - a.z);
      const offB = Math.abs(b.x - b.bx) + Math.abs(b.y - b.by) + Math.abs(b.z - b.bz);
      if (offA + offB > 0.03) pair(a, b, b.bx - a.bx, b.by - a.by, b.bz - a.bz);
    }
  }
  const { maxPush } = SWARM;
  for (const a of agents) {
    if (!a.mobile) { a.bot.push.set(0, 0, 0); continue; }
    let { px, pz } = a;
    const l = Math.hypot(px, pz);
    if (l > maxPush) { px *= maxPush / l; pz *= maxPush / l; }
    a.bot.push.set(px, 0, pz);
  }
}

/** The steering between a and b for heads at b - a = (px, dy, pz): separation, then predictive avoidance. */
function pair(a, b, px, dy, pz) {
  const { horizon: H, margin, buffer, sepGain, dodge, yieldShare } = SWARM;
  const touch = a.r + b.r;
  const R = touch + margin;
  if (Math.abs(dy) >= R) return; // one passes over the other
  const Rh = Math.sqrt(R * R - dy * dy); // level distance that keeps the two heads' spheres apart (+ margin)
  const Rt = Math.sqrt(Math.max(0, touch * touch - dy * dy)); // ... that keeps them from touching
  const d = Math.hypot(px, pz);
  // separation: inside touching (settled pairs), inside margin + buffer (when either moves)
  const zone = a.moving || b.moving ? Rh + buffer : Rt;
  if (d < zone) {
    let ux, uz;
    if (d > 1e-5) { ux = px / d; uz = pz / d; } else { ux = a.bot.index < b.bot.index ? 1 : -1; uz = 0; }
    const f = sepGain * (zone - d);
    const ma = a.mobile ? 1 : 0, mb = b.mobile ? 1 : 0;
    const sum = ma + mb;
    a.px -= ux * f * (ma / sum) * 2;
    a.pz -= uz * f * (ma / sum) * 2;
    b.px += ux * f * (mb / sum) * 2;
    b.pz += uz * f * (mb / sum) * 2;
  }
  // predictive avoidance: while either still glides (no further than the end of the glides)
  const window = Math.min(H, Math.max(a.left, b.left));
  if (window <= 0 || d <= Rt) return;
  avoid(a, b, px, pz, Rh, window, H, dodge, yieldShare);
  avoid(b, a, -px, -pz, Rh, window, H, dodge, yieldShare);
}

/** a's dodge of b (p: b relative to a): a contact of their circles (radius R) due within `window` turns a aside. */
function avoid(a, b, px, pz, R, window, H, dodge, yieldShare) {
  if (!a.mobile) return;
  // a's mark is where b stands (or is going): no way round, so no dodging (they would circle each other for good);
  // the separation alone sets them side by side, still. A b only passing through a's mark on its way elsewhere (one
  // leaving the place a takes over) is dodged as any other: it will be gone
  const bOn = Math.hypot(a.gx - b.bx, a.gz - b.bz) < R && !(b.moving && Math.hypot(b.gx - b.bx, b.gz - b.bz) >= R);
  if (bOn || Math.hypot(a.gx - b.gx, a.gz - b.gz) < R) return;
  // a's wish against what b does now
  const wx = a.wx - b.vx, wz = a.wz - b.vz;
  const ww = wx * wx + wz * wz;
  if (ww < 1e-6) return;
  const pw = px * wx + pz * wz;
  if (pw <= 0) return; // not closing
  const c = px * px + pz * pz - R * R;
  const disc = pw * pw - ww * c;
  if (disc <= 0) return; // passes clear
  const t = c <= 0 ? 0 : (pw - Math.sqrt(disc)) / ww;
  if (t >= window) return;
  // where b is (relative to a) at the contact: a steers aside, away from that side of its way (a sidestep, not a stop:
  // braking alone stalls a bot in front of a settled one), and eases off a little
  const s = Math.sqrt(ww);
  const fx = wx / s, fz = wz / s;
  const across = (fx * (pz - wz * t) - fz * (px - wx * t)) / R; // b's side of a's way at the contact (+: its right)
  // right of (fx, fz) seen from above (x right, z toward the viewer) is (-fz, fx); head-on: each to its own right
  const side = across > 0.15 ? -1 : 1;
  const urgency = (H - t) / H;
  const share = !a.moving ? yieldShare : b.mobile && b.moving ? 0.5 : 1;
  const m = urgency * s * dodge * share;
  a.px += (-fz * side - fx * BRAKE) * m;
  a.pz += (fx * side - fz * BRAKE) * m;
}

/**
 * The last resort (after steer(), before the glides move): where two heads would still meet in this frame's step (each
 * glides on at its velocity for dt), the mobile ones are moved apart along the line between them (a few millimetres a
 * frame, by mobility) and lose their closing speed. A crowd squeezing through a gap can then press, never pass
 * through. Same pairs and order as steer(); moves bot.pos and bot.vel.
 */
export function resolve(agents, dt, contact = null) {
  const n = agents.length;
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    for (let j = i + 1; j < n; j++) {
      const b = agents[j];
      if (!a.mobile && !b.mobile) continue;
      if (Math.abs(b.bx - a.bx) + Math.abs(b.bz - a.bz) > 3) continue;
      if (contact?.(a.bot, b.bot)) continue;
      const ma = a.mobile ? 1 : 0, mb = b.mobile ? 1 : 0, sum = ma + mb;
      // now (offsets and all) and at their places, each a step on
      for (const rest of [false, true]) {
        const dy = rest ? b.by - a.by : b.y - a.y;
        const touch = a.r + b.r + SWARM.skin;
        if (Math.abs(dy) >= touch) continue;
        const need = Math.sqrt(touch * touch - dy * dy);
        const vax = a.bot.vel.x, vaz = a.bot.vel.z, vbx = b.bot.vel.x, vbz = b.bot.vel.z;
        const px = (rest ? b.bx - a.bx : b.x - a.x) + (vbx - vax) * dt;
        const pz = (rest ? b.bz - a.bz : b.z - a.z) + (vbz - vaz) * dt;
        const d = Math.hypot(px, pz);
        if (d >= need) continue;
        let ux, uz;
        if (d > 1e-5) { ux = px / d; uz = pz / d; } else { ux = a.bot.index < b.bot.index ? 1 : -1; uz = 0; }
        const fix = need - d;
        for (const [m, sgn, w] of [[a, -1, ma / sum], [b, 1, mb / sum]]) {
          if (!w) continue;
          m.bot.pos.x += ux * fix * w * sgn;
          m.bot.pos.z += uz * fix * w * sgn;
          m.bx += ux * fix * w * sgn;
          m.bz += uz * fix * w * sgn;
          m.x += ux * fix * w * sgn;
          m.z += uz * fix * w * sgn;
          // no closing speed left along the line between them
          const along = (m.bot.vel.x * ux + m.bot.vel.z * uz) * sgn;
          if (along < 0) { m.bot.vel.x -= ux * along * sgn; m.bot.vel.z -= uz * along * sgn; }
        }
      }
    }
  }
}
