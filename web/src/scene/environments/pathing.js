// Paths through a set for floating heads: the set's furniture and walls as boxes in plan view
// (x, z) with a height range, a visibility-graph A* around the boxes inflated by the bot's radius,
// and a push-out for points that end up inside. Pure and deterministic (no randomness, fixed
// iteration order), so the frame-exact capture replays the same paths every run.

/**
 * Obstacle boxes of a loaded set: { name, x0, x1, z0, z1, y0, y1 } per mesh (world AABB). Floors,
 * rugs and paint (top below minTop) and everything above maxBottom (ceiling, lamp heads) are left
 * out; walls and furniture stay. Box3 comes from three (passed in, so this module stays pure).
 */
export function obstaclesFromGroup(group, Box3, { minTop = 0.3, maxBottom = 2.4 } = {}) {
  const out = [];
  const box = new Box3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    if (box.isEmpty() || box.max.y < minTop || box.min.y > maxBottom) return;
    out.push({ name: o.name, x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, y0: box.min.y, y1: box.max.y });
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.x0 - b.x0));
  return out;
}

/** The boxes a head at height range [yLo, yHi] can hit, grown by r in plan. */
export function activeBoxes(obstacles, { radius = 0.38, yLo = 0.9, yHi = 1.6 } = {}) {
  const out = [];
  for (const o of obstacles) {
    if (o.y1 <= yLo || o.y0 >= yHi) continue;
    out.push({ name: o.name, x0: o.x0 - radius, x1: o.x1 + radius, z0: o.z0 - radius, z1: o.z1 + radius });
  }
  return out;
}

const inside = (b, x, z, e = 0) => x > b.x0 + e && x < b.x1 - e && z > b.z0 + e && z < b.z1 - e;

/** Does the segment (ax, az) -> (bx, bz) cross the open interior of box b? (Liang-Barsky) */
export function segmentHitsBox(ax, az, bx, bz, b, eps = 1e-6) {
  const x0 = b.x0 + eps, x1 = b.x1 - eps, z0 = b.z0 + eps, z1 = b.z1 - eps;
  if (x0 >= x1 || z0 >= z1) return false;
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, ax - x0) || !clip(dx, x1 - ax) || !clip(-dz, az - z0) || !clip(dz, z1 - az)) return false;
  return t1 - t0 > 1e-9;
}

const clear = (ax, az, bx, bz, boxes) => {
  for (const b of boxes) if (segmentHitsBox(ax, az, bx, bz, b)) return false;
  return true;
};

/**
 * Moves (x, z) out of every box it is inside (to the nearest edge, plus margin), a few rounds for
 * overlapping boxes. Returns [x, z]. bounds: optional [x0, x1, z0, z1] clamp applied after.
 */
export function pushOut(x, z, boxes, { margin = 0.02, bounds = null } = {}) {
  for (let round = 0; round < 6; round++) {
    let moved = false;
    for (const b of boxes) {
      if (!inside(b, x, z)) continue;
      const opts = [[b.x0 - margin - x, 0], [b.x1 + margin - x, 0], [0, b.z0 - margin - z], [0, b.z1 + margin - z]];
      let best = opts[0];
      for (const o of opts) if (Math.abs(o[0]) + Math.abs(o[1]) < Math.abs(best[0]) + Math.abs(best[1])) best = o;
      x += best[0];
      z += best[1];
      moved = true;
    }
    if (bounds) {
      x = Math.min(bounds[1], Math.max(bounds[0], x));
      z = Math.min(bounds[3], Math.max(bounds[2], z));
    }
    if (!moved) break;
  }
  return [x, z];
}

/**
 * Waypoints from `from` to `to` ([x, z] each) around the boxes (already inflated: activeBoxes).
 * Returns the list after `from`, ending at `to` (pushed out of any box it sits in). Boxes that
 * contain `from` are ignored (a bot can always leave where it is). Straight when clear, else the
 * shortest path over the boxes' corners (A*, ties broken by corner order: deterministic).
 */
export function planPath(from, to, boxes, { margin = 0.06, bounds = null } = {}) {
  const live = boxes.filter((b) => !inside(b, from[0], from[1]));
  const [tx, tz] = pushOut(to[0], to[1], live, { bounds });
  if (clear(from[0], from[1], tx, tz, live)) return [[tx, tz]];
  // nodes: the start, the goal, then every box corner that is free and inside the bounds
  const nodes = [[from[0], from[1]], [tx, tz]];
  for (const b of live) {
    for (const [cx, cz] of [[b.x0 - margin, b.z0 - margin], [b.x1 + margin, b.z0 - margin],
      [b.x1 + margin, b.z1 + margin], [b.x0 - margin, b.z1 + margin]]) {
      if (bounds && (cx < bounds[0] || cx > bounds[1] || cz < bounds[2] || cz > bounds[3])) continue;
      if (live.some((o) => inside(o, cx, cz))) continue;
      nodes.push([cx, cz]);
    }
  }
  const n = nodes.length;
  const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const h = (i) => Math.hypot(nodes[i][0] - tx, nodes[i][1] - tz);
  g[0] = 0;
  for (;;) {
    let cur = -1, fBest = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && g[i] < Infinity && g[i] + h(i) < fBest - 1e-12) { fBest = g[i] + h(i); cur = i; }
    if (cur < 0) return [[tx, tz]]; // unreachable: go straight (the push-out handles the rest)
    if (cur === 1) break;
    done[cur] = 1;
    const [cx, cz] = nodes[cur];
    for (let j = 0; j < n; j++) {
      if (done[j] || j === cur) continue;
      const d = Math.hypot(nodes[j][0] - cx, nodes[j][1] - cz);
      if (g[cur] + d >= g[j] - 1e-12) continue;
      if (!clear(cx, cz, nodes[j][0], nodes[j][1], live)) continue;
      g[j] = g[cur] + d;
      prev[j] = cur;
    }
  }
  const path = [];
  for (let i = 1; i > 0; i = prev[i]) path.unshift([nodes[i][0], nodes[i][1]]);
  return path;
}

/** Length of a path from `from` through the waypoints. */
export function pathLength(from, pts) {
  let L = 0, x = from[0], z = from[1];
  for (const p of pts) { L += Math.hypot(p[0] - x, p[1] - z); x = p[0]; z = p[1]; }
  return L;
}
