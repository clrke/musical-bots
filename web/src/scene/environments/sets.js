// The sets as staging data (pure, no three.js): where each set's named marks are, where the
// beat's cast gathers, where extras sit, the entrances, the parade loop, the camera's room to move
// and the lighting rig. Coordinates are three.js world metres (x right, y up, z toward the camera);
// marks are [x, z, y] with y the head-centre height. They follow the Blender layouts in
// scripts/blender/{diner,big_house,street}.py (environments/*.glb): change both together.
//
// Who uses it: web/src/blocking.js (marks, slots, moves), web/src/scene/environments/stage.js
// (lights, moods, sky, env map) and the camera in web/src/main.js (shot bounds, wide presets).
//
// Colours follow the bots' theory (scene/color-theory.js FRIENDLY_BAND): one soft band,
// L 0.40-0.95, nothing neon; whites are the cast's warm/cool whites, darks its charcoal.
import { FRIENDLY_WHITE_WARM, FRIENDLY_WHITE_COOL, FRIENDLY_LIGHT_WARM, FRIENDLY_CHARCOAL, FRIENDLY_NIGHT } from '../color-theory.js';

/** The sets a beat may name (protocol v2 beats[].set): the three Blender sets, each a real room. */
export const SET_NAMES = ['diner', 'big_house', 'street', 'village', 'winter', 'haunted', 'beach', 'pool', 'pier', 'ocean'];

/** Where a beat plays when nothing says (the first beat without a set, a v1 bundle, the idle screen): Gold's Diner. */
export const DEFAULT_SET = 'diner';

/**
 * Old set names a bundle may still carry, read as a real set. 'studio' was the bare grey TV stage (protocol v2's
 * default until Oct 31, the hackathon-win outro's "closing show"): it plays on the diner's stage mark, the front of
 * the room where the cast gathers to sing (the diner is also where the crew works and where most stories open, so
 * a closing number comes home there).
 */
export const SET_ALIASES = Object.freeze({ studio: 'diner' });

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
  lamp: ['streetlamp', 'street-lamp', 'lamppost', 'lamp-post', 'light', 'streetlight', 'lantern', 'lanterns'],
  fence: ['picket', 'pickets'],
  crossing: ['crosswalk', 'zebra', 'road', 'street'],
  'bus-stop': ['bus', 'busstop', 'sign'],
  hydrant: ['fire-hydrant'],
  curb: ['kerb', 'sidewalk', 'pavement'],
  // the outdoor sets (a word several sets use resolves to the one mark of it the set has)
  well: ['wishing-well', 'bucket'],
  stall: ['market', 'market-stall', 'shop', 'stand', 'fruit'],
  bench: ['park-bench', 'seat'],
  cottage: ['cottages', 'house', 'home', 'front-door'],
  snowman: ['snow-man', 'frosty', 'snowball'],
  pond: ['ice', 'rink', 'skating', 'skate', 'frozen-pond', 'lake'],
  sledge: ['sled', 'sleigh', 'toboggan'],
  chalet: ['cabin', 'lodge', 'hut', 'house', 'home'],
  gate: ['chapel', 'church', 'churchyard', 'iron-gate'],
  graves: ['grave', 'gravestone', 'gravestones', 'tombstone', 'tombstones', 'graveyard', 'cemetery'],
  cauldron: ['pot', 'potion', 'brew', 'witch'],
  pumpkins: ['pumpkin', 'jack-o-lantern', 'jack-o-lanterns', 'jackolantern'],
  path: ['flagstones', 'walkway'],
  umbrella: ['parasol', 'towel', 'towels', 'blanket', 'shade'],
  sandcastle: ['castle', 'sand-castle', 'bucket', 'spade', 'sand'],
  lifeguard: ['tower', 'lifeguard-tower', 'lookout', 'chair'],
  sea: ['ocean', 'water', 'waves', 'shore', 'surf', 'beach'],
  palm: ['palms', 'palm-tree', 'coconut', 'tree', 'trees'],
  ball: ['beach-ball', 'beachball'],
  pool: ['swim', 'water', 'swimming-pool', 'deep-end', 'shallow-end'],
  'diving-board': ['board', 'diving', 'dive', 'springboard', 'high-dive'],
  slide: ['waterslide', 'water-slide', 'chute'],
  lounger: ['loungers', 'deckchair', 'deck-chair', 'sunbed', 'sun-lounger', 'chair'],
  ladder: ['steps', 'pool-ladder'],
  duck: ['rubber-duck', 'ducky', 'swim-ring', 'float'],
  boat: ['boats', 'rowboat', 'rowing-boat', 'dinghy'],
  sailboat: ['sail', 'yacht', 'sailing-boat'],
  shack: ['hut', 'shed', 'fish-shop', 'boathouse', 'cabin'],
  crates: ['crate', 'barrels', 'barrel', 'cargo', 'boxes'],
  end: ['pier-end', 'dock-end', 'edge', 'water', 'sea', 'ocean', 'dock', 'docks', 'pier'],
  mast: ['sail', 'flag', 'pole'],
  hut: ['shelter', 'hammock', 'roof'],
  chest: ['treasure', 'treasure-chest', 'gold', 'coins'],
  ring: ['life-ring', 'lifebuoy', 'buoy', 'life-preserver'],
  edge: ['sea', 'ocean', 'water', 'waves', 'side', 'raft', 'raft-edge'],
};

/**
 * The outdoor sets' shared frame (village, winter, haunted, beach, pool, pier, ocean: scripts/blender/<set>.py): the
 * street's open square. The middle (x within 5.6 m, z within 2.6 m) is clear for the cast: the gathering, the crew's
 * rows and the parade loop; the set's props stand at the back and the sides, out of the two side lanes (z -0.4 and 2.2)
 * the cast walks in by from beyond the frame. A set overrides what differs (its marks, its far-side places, its rig).
 */
const OPEN = Object.freeze({
  headY: 1.25,
  floor: 0,
  audience: [0, 9.5],
  bounds: [-6.5, 6.5, -4.6, 5.5],
  gather: [
    [-1.3, 0.85, 1.15], [1.3, 0.85, 1.15], [-0.7, -0.2, 1.45], [0.7, -0.2, 1.45],
    [-2.6, 0.35, 1.22], [2.6, 0.35, 1.22], [0, -1.25, 1.62], [-2.0, -1.05, 1.52], [2.0, -1.05, 1.52],
    [-1.3, -2.1, 1.62], [1.3, -2.1, 1.62], [-3.4, 1.4, 1.15], [3.4, 1.4, 1.15],
  ],
  crew: { front: { z: 0.8, ends: 0.75, half: 2.7, y: 1.1 }, back: { z: -1.2, ends: 0.8, half: 3.3, y: 1.8 } },
  entrances: {
    left: { inside: [-4.6, -0.4], outside: [-8.6, -0.4] },
    right: { inside: [4.6, -0.4], outside: [8.6, -0.4] },
    'near-left': { inside: [-4.6, 2.2], outside: [-8.6, 2.6] },
    'near-right': { inside: [4.6, 2.2], outside: [8.6, 2.6] },
  },
  parade: { loop: [[-5.0, -2.0], [5.0, -2.0], [5.0, 1.0], [-5.0, 1.0]], y: 1.25 },
  camera: {
    bounds: [-6.5, 6.5, 0.9, 3.4, -4.0, 7.2],
    wide: [{ pos: [0, 1.95, 6.1], look: [0, 1.55, -1.6] }, { pos: [-3.0, 2.2, 5.6], look: [0.8, 1.5, -1.8] },
      { pos: [3.2, 2.1, 5.7], look: [-0.8, 1.55, -1.6] }],
  },
});

/** An outdoor set: OPEN with the set's own data over it (its entrances added to the side lanes). */
function outdoor(def) {
  return { ...OPEN, ...def, entrances: { ...OPEN.entrances, ...def.entrances } };
}

// Interiors face the camera across their open fourth wall (+z); the street and the outdoor sets face the near side.
// crew: the making-of's formation in the set (making-of-score.js crewFormation): the eight role bots in an arc in
// front ({ z: its middle, ends: how much nearer the camera its ends come, half: its half-width, y }), the rest of the
// cast in a row behind (back: the same, higher: their faces over the crew's), all clear of the furniture, with a
// duet's room (a metre toward the camera) in front of the arc.
export const SETS = {
  // no set loaded (headless tests without a stage, a set that failed to load): the bare formation rows. Never a beat's
  // set (SET_ALIASES maps the old name), and nothing is shown for it (no backdrop).
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
    crew: { front: { z: 0.35, ends: 0.75, half: 2.7, y: 1.05 }, back: { z: -1.55, ends: 0.75, half: 3.3, y: 1.75 } },
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
      hemi: { sky: FRIENDLY_LIGHT_WARM, ground: '#8f7a70', intensity: 1.1 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.7, dir: [0.45, 0.62, 0.65] },
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
    crew: { front: { z: 0.6, ends: 0.75, half: 2.7, y: 1.05 }, back: { z: -1.4, ends: 0.8, half: 3.3, y: 1.75 } },
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
      hemi: { sky: FRIENDLY_LIGHT_WARM, ground: '#94806c', intensity: 1.1 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.6, dir: [0.45, 0.62, 0.65] },
      practical: 1.1,
      daylight: ['SkyMat', 'GrassMat'],
      env: { floor: '#7d5026', wall: '#efe4d2', ceil: FRIENDLY_WHITE_WARM, glow: '#ffd9a8', key: 1.0 },
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
    crew: { front: { z: 0.8, ends: 0.75, half: 2.7, y: 1.1 }, back: { z: -1.2, ends: 0.8, half: 3.3, y: 1.8 } },
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
      hemi: { sky: '#c9d8ff', ground: FRIENDLY_CHARCOAL, intensity: 1.2 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.6, dir: [0.45, 0.62, 0.65] },
      practical: 3.0,
      daylight: [],
      sky: true,
      env: { floor: FRIENDLY_CHARCOAL, wall: '#59607a', ceil: '#9fb6e8', glow: '#ffcf96', key: 1.0 },
    },
  },

  // the village square on a sunny day: cottages at the back corners, the well and the market stall at the back, a bench
  // on the left, a lamp on the right (scripts/blender/village.py)
  village: outdoor({
    name: 'village',
    glb: 'village',
    marks: {
      stage: [0, 1.4, 1.25],
      well: [-1.8, -2.6, 1.25],
      stall: [2.6, -2.6, 1.25],
      bench: [-5.1, -2.75, 1.2],
      lamp: [4.8, -2.6, 1.25],
      cottage: [-5.5, -4.15, 1.25], // at the left cottage's door
      'cottage-right': [5.6, -4.4, 1.25],
    },
    spread: ['well', 'stall', 'bench', 'lamp'],
    extras: [[-6.1, -2.75, 0.95]], // on the bench
    entrances: { cottage: { inside: [-5.5, -4.15], outside: [-6.2, -6.4] } },
    lights: {
      exposure: 1.0, mood: 'bright',
      hemi: { sky: FRIENDLY_WHITE_COOL, ground: '#a8967a', intensity: 1.0 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.5, dir: [0.45, 0.62, 0.65] },
      practical: 1.0,
      daylight: [],
      sky: true,
      panorama: { file: 'village.jpg', yaw: 0 },
      env: { floor: '#cdb48c', wall: '#a9c8e6', ceil: '#6fa3e0', glow: FRIENDLY_LIGHT_WARM, key: 1.0 },
    },
  }),

  // a snowy clearing: the chalet at the back left, the snowman left of centre with a sledge, the frozen pond at the back
  // right (flat: the cast can skate on it), lantern poles, snowy pines (scripts/blender/winter.py)
  winter: outdoor({
    name: 'winter',
    glb: 'winter',
    raised: [[1.0, 5.0, -5.4, -2.4, 0.1]], // the frozen pond
    marks: {
      stage: [0, 1.4, 1.25],
      snowman: [-2.4, -2.5, 1.25],
      pond: [3.0, -3.7, 1.35],
      sledge: [-4.3, -2.2, 1.2],
      lamp: [4.9, -2.6, 1.25],
      chalet: [-5.0, -4.45, 1.25], // at the chalet's door
    },
    spread: ['snowman', 'pond', 'sledge', 'lamp'],
    extras: [[-4.3, -3.2, 0.75]], // on the sledge
    entrances: { chalet: { inside: [-5.0, -4.45], outside: [-5.6, -6.6] } },
    lights: {
      exposure: 0.95, mood: 'cool',
      hemi: { sky: FRIENDLY_WHITE_COOL, ground: '#c8d4e6', intensity: 1.05 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.5, dir: [0.45, 0.62, 0.65] },
      practical: 1.2,
      daylight: [],
      sky: true,
      panorama: { file: 'winter.jpg', yaw: 0 },
      env: { floor: '#e8eef6', wall: '#bcd4ec', ceil: '#7aa6dc', glow: '#ffe8d0', key: 1.0 },
    },
  }),

  // a friendly-spooky churchyard at night: the open gate in the iron fence at the back (the chapel beyond), graves at the
  // back left, the bubbling cauldron on the left, pumpkins and a jack-o'-lantern at the back right (scripts/blender/haunted.py)
  haunted: outdoor({
    name: 'haunted',
    glb: 'haunted',
    marks: {
      stage: [0, 1.4, 1.25],
      gate: [0, -4.25, 1.25],
      graves: [-4.4, -3.1, 1.25],
      cauldron: [-4.85, -2.3, 1.25],
      pumpkins: [4.2, -2.7, 1.25],
      path: [0, -2.9, 1.25], // on the flagstones before the gate
    },
    spread: ['graves', 'cauldron', 'pumpkins', 'path'],
    extras: [[5.0, -3.4, 0.95]], // by the pumpkins
    entrances: { gate: { inside: [0, -4.25], outside: [0, -7.4] } },
    lights: {
      exposure: 1.15, mood: 'night',
      hemi: { sky: '#b9c6ff', ground: FRIENDLY_CHARCOAL, intensity: 1.25 },
      key: { color: '#e8ecff', intensity: 1.6, dir: [0.45, 0.62, 0.65] },
      practical: 2.4,
      daylight: ['GhostMat', 'BrewMat'],
      sky: true,
      panorama: { file: 'haunted.jpg', yaw: -140 }, // (the moon up on the left)
      env: { floor: '#4e5a4e', wall: '#434f7d', ceil: FRIENDLY_NIGHT, glow: '#ffb46a', key: 1.0 },
    },
  }),

  // a sunny beach: the sea at the back, the striped umbrella and towels at the back left, the sandcastle at the back
  // right, the lifeguard tower on the right, palms either side (scripts/blender/beach.py)
  beach: outdoor({
    name: 'beach',
    glb: 'beach',
    marks: {
      stage: [0, 1.4, 1.25],
      umbrella: [-3.3, -3.2, 1.25],
      sandcastle: [2.3, -3.15, 1.25],
      lifeguard: [4.85, -2.9, 1.25],
      sea: [0.4, -4.55, 1.25], // at the water's edge
      palm: [-5.1, -3.2, 1.25],
      ball: [-1.3, -2.95, 1.2],
    },
    spread: ['umbrella', 'sandcastle', 'ball', 'lifeguard'],
    extras: [[-2.6, -3.7, 0.55]], // on a towel
    entrances: { sea: { inside: [0.4, -4.55], outside: [0.4, -8.0] } },
    lights: {
      exposure: 0.98, mood: 'bright',
      hemi: { sky: FRIENDLY_WHITE_COOL, ground: '#e0c890', intensity: 1.0 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.5, dir: [0.45, 0.62, 0.65] },
      practical: 1.0,
      daylight: [],
      sky: true,
      panorama: { file: 'beach.jpg', yaw: 0 },
      env: { floor: '#f0d6a0', wall: '#8fdce6', ceil: '#3ea4d8', glow: FRIENDLY_LIGHT_WARM, key: 1.0 },
    },
  }),

  // an outdoor swimming pool: the pool across the back (sunk: the cast floats over its water), the diving board at its
  // far end, the slide at the back left, loungers under an umbrella on the right, the ladder (scripts/blender/pool.py)
  pool: outdoor({
    name: 'pool',
    glb: 'pool',
    bounds: [-6.5, 6.5, -6.0, 5.5], // (out over the water to the diving board's tip)
    raised: [[-4.5, 4.5, -6.5, -3.0, -0.22]], // the water
    marks: {
      stage: [0, 1.4, 1.25],
      pool: [0, -4.3, 1.0],
      'diving-board': [0, -5.85, 1.8],
      slide: [-4.6, -2.5, 1.25],
      lounger: [5.0, -1.7, 1.15],
      ladder: [3.6, -2.35, 1.2],
      duck: [-2.2, -3.6, 1.0],
    },
    spread: ['pool', 'ladder', 'slide', 'lounger'],
    extras: [[6.1, -2.3, 0.75]], // on a lounger
    entrances: { 'diving-board': { inside: [0, -4.3], outside: [0, -7.6] } },
    lights: {
      exposure: 0.98, mood: 'bright',
      hemi: { sky: FRIENDLY_WHITE_COOL, ground: '#d8e4ea', intensity: 1.0 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.5, dir: [0.45, 0.62, 0.65] },
      practical: 1.0,
      daylight: [],
      sky: true,
      panorama: { file: 'pool.jpg', yaw: 0 },
      env: { floor: '#e8eef0', wall: '#7fd6ea', ceil: '#3f86e0', glow: FRIENDLY_LIGHT_WARM, key: 1.0 },
    },
  }),

  // the docks at golden hour: a plank deck over the water, the moored sailboat (back left) and rowboat (back right), the
  // fishing shack on the left, crates on the right, lamps at the back where the walkway runs on out (scripts/blender/pier.py)
  pier: outdoor({
    name: 'pier',
    glb: 'pier',
    marks: {
      stage: [0, 1.4, 1.25],
      boat: [4.6, -4.5, 1.25],
      sailboat: [-4.6, -4.5, 1.25],
      shack: [-5.95, -3.15, 1.25],
      crates: [4.9, -3.3, 1.3],
      lamp: [-1.75, -3.8, 1.25],
      end: [0, -4.4, 1.25], // where the walkway runs on out to the pier's end
    },
    spread: ['boat', 'sailboat', 'crates', 'shack'],
    extras: [[6.5, -2.5, 0.95]], // on the barrels
    entrances: { end: { inside: [0, -4.4], outside: [0, -9.5] } },
    lights: {
      exposure: 1.0, mood: 'gold',
      hemi: { sky: '#ffe2c4', ground: '#8a6a4a', intensity: 1.05 },
      key: { color: '#ffe6c8', intensity: 1.55, dir: [0.45, 0.62, 0.65] },
      practical: 1.3,
      daylight: ['ShackWindowMat'],
      sky: true,
      panorama: { file: 'pier.jpg', yaw: -140 }, // (the low sun out past the pier's end)
      env: { floor: '#9c6a3e', wall: '#e8a070', ceil: '#6a6aa8', glow: '#ffc890', key: 1.0 },
    },
  }),

  // a big log raft in the middle of the ocean: the mast and its striped sail at the back left, the palm-roofed hut at
  // the back right, a treasure chest on the left, a life ring on its post, a whale and an island out at sea
  // (scripts/blender/ocean.py)
  ocean: outdoor({
    name: 'ocean',
    glb: 'ocean',
    marks: {
      stage: [0, 1.4, 1.25],
      mast: [-3.0, -3.55, 1.25],
      hut: [3.9, -2.65, 1.25],
      chest: [-4.6, -1.85, 1.2],
      ring: [5.3, -3.9, 1.25],
      edge: [0, -4.4, 1.25], // the raft's back edge, the sea beyond
    },
    spread: ['mast', 'hut', 'chest', 'edge'],
    extras: [[3.9, -4.75, 1.05]], // in the hammock
    entrances: {},
    lights: {
      exposure: 0.98, mood: 'bright',
      hemi: { sky: FRIENDLY_WHITE_COOL, ground: '#3a7aa8', intensity: 1.0 },
      key: { color: FRIENDLY_LIGHT_WARM, intensity: 1.5, dir: [0.45, 0.62, 0.65] },
      practical: 1.0,
      daylight: [],
      sky: true,
      panorama: { file: 'ocean.jpg', yaw: 0 },
      env: { floor: '#2a8cc4', wall: '#9ee0d4', ceil: '#4aaec8', glow: FRIENDLY_LIGHT_WARM, key: 1.0 },
    },
  }),
};

/**
 * Lighting moods (the lighting agent's lights-<mood> cues): multipliers and tints over a set's rig.
 * light: key + hemisphere gain; tint: their colour; practical: the set's own lamps; daylight: the
 * windows/sky emissive gain; env: the head reflections' gain; sky: the street sky preset.
 */
export const MOODS = {
  warm: { light: 1.0, tint: FRIENDLY_LIGHT_WARM, practical: 1.0, daylight: 1.0, env: 1.0, sky: 'dusk', exposure: 1.0 },
  gold: { light: 1.05, tint: '#ffc77a', practical: 1.25, daylight: 0.9, env: 1.0, sky: 'sunset', exposure: 1.02 },
  cool: { light: 0.9, tint: '#cddcff', practical: 0.75, daylight: 1.1, env: 0.95, sky: 'dusk', exposure: 1.0 },
  dim: { light: 0.42, tint: '#ffe2c4', practical: 0.8, daylight: 0.45, env: 0.55, sky: 'night', exposure: 0.95 },
  night: { light: 0.3, tint: '#9fb3ff', practical: 1.3, daylight: 0.18, env: 0.5, sky: 'night', exposure: 1.0 },
  party: { light: 0.5, tint: '#e6b8ff', practical: 0.7, daylight: 0.35, env: 0.8, sky: 'party', exposure: 1.05, party: true },
  bright: { light: 1.35, tint: FRIENDLY_LIGHT_WARM, practical: 1.0, daylight: 1.25, env: 1.2, sky: 'day', exposure: 1.05 },
};

/** Canonical form of a mark / set / bot word: lower case, '_' and spaces to '-', no leading 'the-'. */
export function normalizeName(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/^the-/, '');
}

/** A known set name for s ('big-house', 'Big House' -> 'big_house'; an old 'studio' -> its set), else null. */
export function setName(s) {
  const k = normalizeName(s);
  if (SET_ALIASES[k]) return SET_ALIASES[k];
  const n = k.replace(/-/g, '_');
  return SET_NAMES.includes(n) ? n : null;
}

/**
 * The set of every beat (protocol v2): beats[].set, else the previous beat's set, else DEFAULT_SET (the diner).
 * override (the ?set= URL driver): one set for every beat. Unknown names count as missing.
 * Returns a Map beatId -> set name, in beat order.
 */
export function resolveSets(beats, override = null) {
  const out = new Map();
  const forced = override ? setName(override) : null;
  let prev = DEFAULT_SET;
  for (const b of beats?.beats ?? []) {
    const s = forced ?? setName(b.set) ?? prev;
    out.set(b.id, s);
    prev = s;
  }
  return out;
}

/**
 * Every set an episode needs (the loader warms these before playback): its beats' sets, the forced one, and the
 * default set when there are no beats (a v1 bundle, the idle screen).
 */
export function setsNeeded(beats, override = null) {
  const names = new Set(resolveSets(beats, override).values());
  if (override && setName(override)) names.add(setName(override));
  if (!names.size) names.add(DEFAULT_SET);
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
