// The sets as staging data (pure, no three.js): where each set's named marks are, where the
// beat's cast gathers, where extras sit, the entrances, the parade loop, the camera's room to move
// and the lighting rig. Coordinates are three.js world metres (x right, y up, z toward the camera);
// marks are [x, z, y] with y the head-centre height. They follow the Blender layouts in
// scripts/blender/{diner,big_house,street}.py (environments/*.glb): change both together.
//
// Who uses it: web/src/blocking.js (marks, slots, moves), web/src/scene/environments/stage.js
// (lights, moods, sky, env map) and the camera in web/src/main.js (shot bounds, wide presets).

/** The sets a beat may name (protocol v2 beats[].set). 'studio' is the default panorama stage. */
export const SET_NAMES = ['studio', 'diner', 'big_house', 'street'];

/** Mark name aliases (any set): what a producer may write in walk-to-<mark>. */
const ALIASES = {
  stage: ['center', 'centre', 'mic', 'front', 'spotlight', 'middle'],
  gathering: ['gather', 'group', 'crowd', 'together', 'everyone'],
  door: ['gate', 'entrance', 'exit', 'front-door', 'street-door', 'doorway'],
  kitchen: ['stove', 'oven', 'fridge', 'cook'],
  counter: ['bar', 'register', 'stools', 'stool'],
  booth: ['table', 'booths', 'seat'],
  window: ['windows', 'glass'],
  porch: ['front-door', 'deck', 'door'],
  garden: ['yard', 'backyard', 'flowers', 'lawn', 'tree'],
  fireplace: ['fire', 'hearth', 'mantel', 'chimney'],
  sofa: ['couch', 'settee'],
  stairs: ['staircase', 'steps', 'upstairs'],
  rug: ['carpet'],
  lamp: ['streetlamp', 'street-lamp', 'lamppost', 'lamp-post', 'light', 'streetlight'],
  fence: ['picket', 'pickets'],
  crossing: ['crosswalk', 'zebra', 'road', 'street'],
  'bus-stop': ['bus', 'busstop', 'sign'],
  hydrant: ['fire-hydrant'],
  curb: ['kerb', 'sidewalk', 'pavement'],
};

// Interiors face the camera across their open fourth wall (+z); the street faces the near sidewalk.
export const SETS = {
  studio: {
    name: 'studio',
    glb: null,
    headY: 1.1,
    audience: [0, 8.5],
  },

  diner: {
    name: 'diner',
    glb: 'diner',
    headY: 1.2,
    floor: 0,
    audience: [0, 7.5],
    // walkable box for head centres (inside the walls, out to the open front)
    bounds: [-4.55, 4.55, -3.55, 4.5],
    marks: {
      stage: [0, 0.9, 1.2],
      counter: [0.75, -2.15, 1.25],
      booth: [-3.1, -1.0, 1.15],
      'booth-right': [3.1, -1.0, 1.15],
      door: [-4.2, -3.15, 1.2],
      kitchen: [4.2, -3.15, 1.2],
      window: [-2.85, -3.25, 1.45],
      'window-right': [2.85, -3.25, 1.45],
      hatch: [-0.75, -2.15, 1.3],
    },
    // the beat's cast together around the stage, centre first: front row low, back rows higher
    // (faces clear over the row in front), the outer wings last
    gather: [
      [-1.25, 0.35, 1.12], [1.25, 0.35, 1.12], [-0.65, -0.65, 1.42], [0.65, -0.65, 1.42],
      [-2.4, -0.1, 1.2], [2.4, -0.1, 1.2], [0, -1.6, 1.6], [-1.75, -1.35, 1.5], [1.75, -1.35, 1.5],
      [-1.1, -2.2, 1.62], [1.1, -2.2, 1.62], [-3.0, 0.9, 1.1], [3.0, 0.9, 1.1],
    ],
    // where the cast stands when the scene plays out (verses): the set's own places first
    // (the room's near places: the doors and the kitchen are for entrances and walk-to)
    spread: ['counter', 'booth', 'booth-right', 'hatch', 'window', 'window-right'],
    // background patrons: the far bench of each booth (facing the room)
    extras: [[-4.15, -1.66, 0.98], [4.15, -1.66, 0.98]],
    entrances: {
      door: { inside: [-4.2, -3.15], outside: [-4.2, -4.75] },
      kitchen: { inside: [4.2, -3.15], outside: [4.2, -5.05] },
      'front-left': { inside: [-3.4, 2.4], outside: [-7.0, 3.2] },
      'front-right': { inside: [3.4, 2.4], outside: [7.0, 3.2] },
    },
    parade: { loop: [[-2.3, 1.2], [2.3, 1.2], [2.3, -1.45], [-2.3, -1.45]], y: 1.2 },
    camera: {
      bounds: [-4.5, 4.5, 0.85, 2.85, -3.3, 6.0], // x0, x1, y0, y1, z0, z1
      wide: [{ pos: [0, 1.8, 4.3], look: [0, 1.3, -1.2] }, { pos: [-2.2, 2.0, 3.9], look: [0.6, 1.25, -1.3] },
        { pos: [2.4, 1.95, 4.0], look: [-0.5, 1.25, -1.2] }],
    },
    lights: {
      exposure: 0.98, mood: 'warm',
      hemi: { sky: '#fff3e6', ground: '#8f7a70', intensity: 1.1 },
      key: { color: '#fff2e2', intensity: 1.7, dir: [0.45, 0.62, 0.65] },
      practical: 1.0,
      daylight: ['WindowMat', 'OutsideMat'], // emissive "outside" materials that follow the mood
      env: { floor: '#a33a2c', wall: '#f0e2cc', ceil: '#f2e6d2', glow: '#ffd2a0', key: 1.0 },
    },
  },

  big_house: {
    name: 'big_house',
    glb: 'big_house',
    headY: 1.2,
    floor: 0,
    audience: [0, 8.5],
    bounds: [-5.55, 5.55, -4.55, 5.5],
    marks: {
      stage: [0, 1.2, 1.2],
      fireplace: [-0.95, -3.45, 1.2],
      rug: [0.95, -2.6, 1.2],
      sofa: [-4.05, -0.7, 1.15],
      kitchen: [-4.7, -3.3, 1.2],
      garden: [-3.8, -4.15, 1.25],
      porch: [3.5, -4.15, 1.25],
      stairs: [4.05, 0.2, 1.3],
    },
    gather: [
      [-1.3, 0.6, 1.12], [1.3, 0.6, 1.12], [-0.7, -0.45, 1.42], [0.7, -0.45, 1.42],
      [-2.55, 0.1, 1.2], [2.55, 0.1, 1.2], [0, -1.5, 1.6], [-1.85, -1.25, 1.5], [1.85, -1.25, 1.5],
      [-1.2, -2.3, 1.62], [1.2, -2.3, 1.62], [-3.2, 1.3, 1.1], [3.2, 1.3, 1.1],
    ],
    spread: ['fireplace', 'rug', 'sofa', 'stairs'],
    extras: [[-5.05, -0.7, 0.98], [5.35, -1.0, 2.1]], // on the sofa, sitting on the stairs
    entrances: {
      garden: { inside: [-3.8, -4.1], outside: [-3.8, -6.7] },
      porch: { inside: [3.5, -4.1], outside: [3.5, -6.0] },
    },
    parade: { loop: [[-2.6, 1.5], [2.6, 1.5], [2.6, -2.1], [-2.6, -2.1]], y: 1.2 },
    camera: {
      bounds: [-5.5, 5.5, 0.85, 2.85, -4.3, 7.0],
      wide: [{ pos: [0, 1.85, 5.2], look: [0, 1.3, -1.6] }, { pos: [-2.6, 2.1, 4.8], look: [0.8, 1.25, -1.8] },
        { pos: [2.8, 2.0, 4.9], look: [-0.9, 1.3, -1.5] }],
    },
    lights: {
      exposure: 1.0, mood: 'warm',
      hemi: { sky: '#fff3e2', ground: '#94806c', intensity: 1.1 },
      key: { color: '#fff0dc', intensity: 1.6, dir: [0.45, 0.62, 0.65] },
      practical: 1.1,
      daylight: ['SkyMat', 'GrassMat'],
      env: { floor: '#7d5026', wall: '#efe4d2', ceil: '#f4eee2', glow: '#ffd9a8', key: 1.0 },
    },
  },

  street: {
    name: 'street',
    glb: 'street',
    headY: 1.25,
    floor: 0,
    raised: [[-14, 14, -6.0, -4.0, 0.12], [-14, 14, 4.0, 6.0, 0.12]], // the sidewalks: x0, x1, z0, z1, top
    audience: [0, 9.5],
    bounds: [-7.5, 7.5, -5.4, 5.5],
    marks: {
      stage: [0, 1.4, 1.25],
      lamp: [-4.5, -2.95, 1.25],
      'lamp-right': [4.5, -2.95, 1.25],
      fence: [2.1, -4.9, 1.37],
      crossing: [-2.5, 0.0, 1.25],
      'bus-stop': [-5.45, -4.55, 1.37],
      hydrant: [5.3, -4.55, 1.37],
      curb: [0.2, -3.3, 1.25],
      corner: [-3.4, -1.9, 1.25], // on the road by the left lamp and the bus stop
      'fence-front': [2.4, -3.35, 1.25], // on the road in front of the fence
    },
    gather: [
      [-1.3, 0.85, 1.15], [1.3, 0.85, 1.15], [-0.7, -0.2, 1.45], [0.7, -0.2, 1.45],
      [-2.6, 0.35, 1.22], [2.6, 0.35, 1.22], [0, -1.25, 1.62], [-2.0, -1.05, 1.52], [2.0, -1.05, 1.52],
      [-1.3, -2.1, 1.62], [1.3, -2.1, 1.62], [-3.4, 1.4, 1.15], [3.4, 1.4, 1.15],
    ],
    // the street is wide: the verses stay near the middle (the far props are for walk-to)
    spread: ['crossing', 'curb', 'fence-front', 'corner'],
    extras: [[-5.75, -4.75, 1.33]],
    entrances: {
      left: { inside: [-4.6, -0.4], outside: [-8.6, -0.4] },
      right: { inside: [4.6, -0.4], outside: [8.6, -0.4] },
      'near-left': { inside: [-4.6, 2.2], outside: [-8.6, 2.6] },
      'near-right': { inside: [4.6, 2.2], outside: [8.6, 2.6] },
    },
    // along the street: out along the far lane, back along the near one
    parade: { loop: [[-5.2, -2.0], [5.2, -2.0], [5.2, 1.0], [-5.2, 1.0]], y: 1.25 },
    camera: {
      bounds: [-7.0, 7.0, 0.9, 3.4, -4.6, 7.2],
      wide: [{ pos: [0, 1.95, 6.1], look: [0, 1.55, -1.6] }, { pos: [-3.0, 2.2, 5.6], look: [0.8, 1.5, -1.8] },
        { pos: [3.2, 2.1, 5.7], look: [-0.8, 1.55, -1.6] }],
    },
    lights: {
      exposure: 1.15, mood: 'night',
      hemi: { sky: '#c9d8ff', ground: '#2a2a30', intensity: 1.2 },
      key: { color: '#fff4e8', intensity: 1.6, dir: [0.45, 0.62, 0.65] },
      practical: 3.0,
      daylight: [],
      sky: true,
      env: { floor: '#2b2d33', wall: '#59607a', ceil: '#9fb6e8', glow: '#ffcf96', key: 1.0 },
    },
  },
};

/**
 * Lighting moods (the lighting agent's lights-<mood> cues): multipliers and tints over a set's rig.
 * light: key + hemisphere gain; tint: their colour; practical: the set's own lamps; daylight: the
 * windows/sky emissive gain; env: the head reflections' gain; sky: the street sky preset.
 */
export const MOODS = {
  warm: { light: 1.0, tint: '#fff1e0', practical: 1.0, daylight: 1.0, env: 1.0, sky: 'dusk', exposure: 1.0 },
  gold: { light: 1.05, tint: '#ffc77a', practical: 1.25, daylight: 0.9, env: 1.0, sky: 'sunset', exposure: 1.02 },
  cool: { light: 0.9, tint: '#cddcff', practical: 0.75, daylight: 1.1, env: 0.95, sky: 'dusk', exposure: 1.0 },
  dim: { light: 0.42, tint: '#ffe2c4', practical: 0.8, daylight: 0.45, env: 0.55, sky: 'night', exposure: 0.95 },
  night: { light: 0.3, tint: '#9fb3ff', practical: 1.3, daylight: 0.18, env: 0.5, sky: 'night', exposure: 1.0 },
  party: { light: 0.5, tint: '#e6b8ff', practical: 0.7, daylight: 0.35, env: 0.8, sky: 'party', exposure: 1.05, party: true },
  bright: { light: 1.35, tint: '#ffffff', practical: 1.0, daylight: 1.25, env: 1.2, sky: 'day', exposure: 1.05 },
};

/** Canonical form of a mark / set / bot word: lower case, '_' and spaces to '-', no leading 'the-'. */
export function normalizeName(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/^the-/, '');
}

/** A known set name for s ('big-house', 'Big House' -> 'big_house'), else null. */
export function setName(s) {
  const n = normalizeName(s).replace(/-/g, '_');
  return SET_NAMES.includes(n) ? n : null;
}

/**
 * The set of every beat (protocol v2): beats[].set, else the previous beat's set, else 'studio'.
 * override (the ?set= URL driver): one set for every beat. Unknown names count as missing.
 * Returns a Map beatId -> set name, in beat order.
 */
export function resolveSets(beats, override = null) {
  const out = new Map();
  const forced = override ? setName(override) : null;
  let prev = 'studio';
  for (const b of beats?.beats ?? []) {
    const s = forced ?? setName(b.set) ?? prev;
    out.set(b.id, s);
    prev = s;
  }
  return out;
}

/** Every set an episode needs (the loader warms these before playback), studio excluded. */
export function setsNeeded(beats, override = null) {
  const names = new Set(resolveSets(beats, override).values());
  if (override && setName(override)) names.add(setName(override));
  names.delete('studio');
  return [...names];
}

/**
 * A named mark of a set: { name, x, y, z } (y: head-centre height), or null. Case, '_' / ' ' and
 * a leading 'the' are ignored; aliases resolve ('gate' -> door, 'couch' -> sofa, 'zebra' ->
 * crossing); 'gathering' is the first gather slot.
 */
export function markOf(set, name) {
  const s = typeof set === 'string' ? SETS[set] : set;
  if (!s?.marks) return null;
  const n = normalizeName(name);
  if (!n) return null;
  const at = (k) => {
    if (k === 'gathering' && s.gather?.length) return { name: 'gathering', x: s.gather[0][0], z: s.gather[0][1], y: s.gather[0][2] };
    const m = s.marks[k];
    return m ? { name: k, x: m[0], z: m[1], y: m[2] ?? s.headY } : null;
  };
  const direct = at(n) ?? at(n.replace(/s$/, ''));
  if (direct) return direct;
  for (const [k, list] of Object.entries(ALIASES)) if (list.includes(n) && at(k)) return at(k);
  // 'door-left' / 'left-door' style: the first mark whose name is a word of n
  for (const k of Object.keys(s.marks)) if (n.split('-').includes(k)) return at(k);
  return null;
}

/** The entrance of a set nearest to (x, z): { name, inside, outside }. */
export function nearestEntrance(set, x, z) {
  const s = typeof set === 'string' ? SETS[set] : set;
  let best = null, dBest = Infinity;
  for (const [name, e] of Object.entries(s?.entrances ?? {})) {
    const d = (e.inside[0] - x) ** 2 + (e.inside[1] - z) ** 2;
    if (d < dBest) { dBest = d; best = { name, ...e }; }
  }
  return best;
}

/** Closed polyline helpers for the parade loop: total length and the point at arc length s. */
export function loopLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

export function loopPoint(pts, s, out = [0, 0]) {
  const L = loopLength(pts);
  let u = ((s % L) + L) % L;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (u <= d || i === pts.length - 1) {
      const k = d > 0 ? Math.min(1, u / d) : 0;
      out[0] = a[0] + (b[0] - a[0]) * k;
      out[1] = a[1] + (b[1] - a[1]) * k;
      return out;
    }
    u -= d;
  }
  return out;
}

/** Arc length of the loop point nearest to (x, z). */
export function loopNearest(pts, x, z) {
  let best = 0, dBest = Infinity, acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const d = Math.hypot(dx, dz);
    const k = d > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (d * d))) : 0;
    const px = a[0] + dx * k, pz = a[1] + dz * k;
    const e = (px - x) ** 2 + (pz - z) ** 2;
    if (e < dBest) { dBest = e; best = acc + d * k; }
    acc += d;
  }
  return best;
}
