// Particle presets ported from the author's own Squatopia 2 effects (Unity), module by module.
// Pure data + small helpers (no three.js, no DOM).
//
// Sources (all first-party; read from the Unity YAML and the C# that builds it):
// - Debuffs: Assets/Squatopia/Resources/Debuffs/Fx/{Burn,Blind,Fragile,Chill,Charm,Frostbite,Froth,
//   Paralyze,Slow}.prefab (built by Assets/Editor/Enemies/DebuffFxBuilder.cs) and their materials in
//   Debuffs/Fx/Materials (URP Particles/Unlit, additive SrcAlpha/One, _BaseColor tints that may
//   exceed 1 and clip). The ParticleSystem modules used: Initial (lifetime, speed, size, colour,
//   rotation 0..2pi), Emission (rate), Shape (cone 25 deg / hemisphere / sphere, radius 1, tilted +/-90
//   deg about X), Color over Lifetime, Size over Lifetime and Rotation over Lifetime (Burn, Blind),
//   Texture Sheet (Burn, Blind: one random flame-wisp frame, held), Noise (Froth), Trails in Ribbon
//   mode (Fragile, Paralyze, Slow), Renderer (billboards, trail material).
//   Runtime sizing (Scripts/Enemies/DebuffFx.cs): every effect is scaled by Margin * bodyRadius /
//   Reach(fx) with Margin = 1.3, so its particles reach 1.3 body radii from the centre.
// - embers: the brazier embers of the POI fires, e.g. Prefabs/Pois/Volcanic/FireShrine.prefab "fire"
//   markers, which Scripts/World/EnvironmentFire.cs builds as Kind.Brazier (s = 0.6): BuildEmbers.
// - glow: the island's glowing motes (Scripts/World/IslandWorld.cs BuildMotes, noisy glow, soft fade)
//   with the fireflies' pulse (IslandFireflies.cs), coloured with the Glow Cavern's bioluminescent
//   glows (tools/blender/props/poi_glowcavern.py: CYAN, VIOLET, MAGENTA, LIME, WHITE_GLOW).
// Textures (public/fx): copies of the author's procedural textures, CombatVFX/{flamewisps, burst,
// beam, capsule, noisyglow}.png (tools/make_combat_vfx_textures.py) and ElementVFX/spark.png
// (tools/make_element_vfx_textures.py): drawn from maths, white RGB with the shape in alpha.
//
// Units: debuff values are Unity units at scale 1 (sized to the head by `reach`); embers and glow
// are metres (sized by `fit`). Colours are display (sRGB) values as in Unity's inspector; `tint`
// is the material colour. Curves are [t0, v0, t1, v1, ...] keys over the particle's life (0..1).
// Shape `dir`: +1 = up (Unity rotation x = -90), -1 = down (x = +90).

/** Unity DebuffFx.Margin: debuff particles reach this many head radii. */
export const DEBUFF_MARGIN = 1.3;

/** The head radius (m) the POI presets' `fit` factors were tuned for (scale 1 head). */
export const FIT_RADIUS = 0.13;

const FADE_OUT = [0, 1, 1, 0]; // DebuffFxBuilder.Fade(false): alpha 1 -> 0
const FADE_IN_OUT = [0, 0, 0.5, 1, 1, 0]; // Fade(true): alpha 0 -> 1 -> 0

const burstLike = (label, color, extra = {}) => ({
  label,
  source: `Debuffs/Fx/${label}.prefab`,
  reach: 2.27,
  space: 'local',
  texture: 'burst',
  tint: [1, 1, 1], // DebuffBurst.mat
  colors: [color],
  life: [1, 1],
  speed: [1, 1],
  size: [1, 1],
  rotation: true,
  rate: 20,
  max: 120,
  shape: { type: 'hemisphere', radius: 1, dir: -1 },
  alphaOverLife: FADE_OUT,
  ...extra,
});

export const PRESET_DEFS = {
  burn: {
    label: 'Burn',
    source: 'Debuffs/Fx/Burn.prefab',
    reach: 4.05,
    space: 'local',
    texture: 'flamewisps',
    frames: 4, // one random wisp per particle, held for its life
    tint: [2.4, 1.2, 0.5], // DebuffFlame.mat
    colors: [[1, 0.354, 0.354, 1]],
    life: [1, 1],
    speed: [3, 3],
    size: [2, 2],
    rotation: true,
    spin: [-60, 60], // deg/s
    rate: 50,
    max: 120,
    shape: { type: 'cone', angle: 25, radius: 1, dir: 1 },
    sizeOverLife: [0, 0.7, 1, 1],
    alphaOverLife: FADE_OUT,
  },
  blind: {
    label: 'Blind',
    source: 'Debuffs/Fx/Blind.prefab',
    reach: 4.05,
    space: 'local',
    texture: 'flamewisps',
    frames: 4,
    tint: [3, 3, 3], // DebuffShade.mat
    colors: [[0.211, 0, 0.349, 1]],
    life: [1, 1],
    speed: [3, 3],
    size: [2, 2],
    rotation: true,
    spin: [-60, 60],
    rate: 50,
    max: 120,
    shape: { type: 'cone', angle: 25, radius: 1, dir: -1 },
    sizeOverLife: [0, 0.7, 1, 1],
    alphaOverLife: FADE_OUT,
  },
  fragile: burstLike('Fragile', [1, 0.509, 0, 1], {
    // a ribbon through every particle in age order: orange cracks (DebuffBeamYellow.mat, tiled)
    trail: {
      texture: 'beam',
      mode: 'tile',
      ribbons: 1,
      width: 0.5,
      inherit: true,
      tint: [1.6, 1.2, 0.3],
      color: [1, 1, 1, 1],
      alphaOverLife: FADE_OUT,
      alphaOverTrail: [0, 1, 1, 0],
    },
  }),
  chill: burstLike('Chill', [0.75, 0.95, 1, 1]),
  charm: burstLike('Charm', [1, 0.35, 0.65, 1]),
  frostbite: burstLike('Frostbite', [0.35, 0.75, 1, 1]),
  froth: burstLike('Froth', [0.401, 0.502, 1, 1], {
    reach: 4.15,
    size: [3, 3],
    noise: { strength: 1, frequency: 0.5, scroll: 0 },
  }),
  paralyze: {
    label: 'Paralyze',
    source: 'Debuffs/Fx/Paralyze.prefab',
    reach: 2.85,
    space: 'local',
    texture: 'burst',
    tint: [1, 1, 1],
    colors: [[1, 0.937, 0, 0]], // the particles are invisible: only their lightning ribbons show
    life: [0.5, 0.5],
    speed: [2, 2],
    size: [2, 2],
    rotation: true,
    rate: 20,
    max: 120,
    shape: { type: 'sphere', radius: 1, dir: 1 },
    alphaOverLife: FADE_OUT,
    trail: {
      texture: 'beam',
      mode: 'stretch',
      ribbons: 1,
      width: 0.35,
      inherit: false,
      tint: [3.2, 1.7, 0.2], // ParalyzeBolt.mat
      color: [1, 0.85, 0, 1],
      alphaOverLife: FADE_OUT,
      alphaOverTrail: [0, 1, 1, 0],
    },
  },
  slow: {
    label: 'Slow',
    source: 'Debuffs/Fx/Slow.prefab',
    reach: 4.3,
    space: 'local',
    texture: 'burst',
    tint: [1, 1, 1],
    colors: [[0.105, 1, 0, 1]],
    life: [1, 1],
    speed: [3, 3],
    size: [1, 1],
    rotation: true,
    rate: 4,
    max: 120,
    shape: { type: 'sphere', radius: 1, dir: 1 },
    alphaOverLife: FADE_IN_OUT,
    trail: {
      texture: 'capsule',
      mode: 'stretch',
      ribbons: 3,
      width: 1,
      inherit: false,
      tint: [0.5, 1.8, 0.25], // DebuffCapsuleGreen.mat
      color: [1, 1, 1, 1],
      alphaOverLife: FADE_IN_OUT,
      alphaOverTrail: [0, 1, 1, 0],
    },
  },
  embers: {
    label: 'Embers',
    source: 'EnvironmentFire.BuildEmbers (Brazier, s = 0.6), POI fires such as Volcanic/FireShrine',
    fit: { space: 0.32, size: 0.9 },
    space: 'world',
    anchorY: 0.35, // rise from the crown (fraction of the head radius above the centre)
    texture: 'spark',
    tint: [1, 1, 1],
    colors: [
      [1, 0.78, 0.25, 1], // k_Yellow
      [1, 0.42, 0.08, 1], // k_Orange
    ],
    life: [1.4, 3.2],
    speed: [0.3, 0.9],
    size: [0.015, 0.036],
    rotation: true,
    gravity: -0.05, // x 9.81: they rise
    rate: 18, // a brazier throws 7 a second; a singing robot about three braziers' worth
    max: 60,
    shape: { type: 'cone', angle: 14, radius: 0.108, dir: 1 },
    colorOverLife: [0, 1, 0.78, 0.25, 0.4, 1, 0.42, 0.08, 1, 0.65, 0.08, 0.02], // yellow -> orange -> red
    alphaOverLife: [0, 1, 0.6, 0.8, 1, 0],
    noise: { strength: 0.54, frequency: 0.7, scroll: 0.5 },
  },
  glow: {
    label: 'Glow',
    source: 'IslandWorld.BuildMotes + IslandFireflies pulse, Glow Cavern palette',
    fit: { space: 1, size: 1.6 },
    space: 'world',
    texture: 'noisyglow',
    tint: [1, 1, 1],
    palette: [
      // the cavern's glow colours; alpha raised from the motes' 0.5-0.7 so they show on a dark room
      [0.3, 0.98, 1, 0.95], // CYAN
      [0.66, 0.38, 1, 0.9], // VIOLET
      [1, 0.32, 0.82, 0.9], // MAGENTA
      [0.82, 1, 0.38, 0.8], // LIME
      [0.92, 1, 1, 0.85], // WHITE_GLOW
    ],
    life: [4, 7], // the motes live 6-10 s around the player; shortened so they stay near the head
    speed: [0.03, 0.15],
    size: [0.03, 0.07],
    rotation: false,
    gravity: -0.002,
    rate: 10, // the island's 9 a second fill 24 x 24 m; around one head they gather closer
    max: 80,
    shape: { type: 'sphere', radius: 1.25, dir: 1, headRelative: true }, // radius in head radii
    alphaOverLife: [0, 0, 0.2, 1, 0.8, 1, 1, 0],
    noise: { strength: 0.25, frequency: 0.3, scroll: 0.3 },
    pulse: true,
  },
  // ---- ambience presets (Magna's own, from Unity's SparklePresets.cs — values verbatim).
  // Metres at a 0.13 m head, world space like embers and glow. Streak draws the cell
  // stretched tail to head (field.js); Size is then the width.
  confetti: {
    label: 'Confetti',
    source: 'SparklePresets.confetti',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 1, // a popper at the crown
    texture: 'capsule',
    palette: [
      [1, 0.25, 0.55, 1], [1, 0.85, 0.2, 1], [0.25, 0.85, 1, 1],
      [0.55, 1, 0.3, 1], [1, 0.5, 0.15, 1], [0.7, 0.45, 1, 1],
    ],
    life: [1.3, 2],
    speed: [0.3, 0.65],
    size: [0.018, 0.032],
    rotation: true,
    spin: [-600, 600],
    gravity: 0.045,
    rate: 22,
    max: 50,
    shape: { type: 'cone', angle: 42, radius: 0.05, dir: 1 },
    alphaOverLife: [0, 0, 0.05, 1, 0.14, 0.6, 0.24, 1, 0.34, 0.6, 0.44, 1, 0.54, 0.6, 0.64, 1, 0.74, 0.6, 0.85, 0.9, 1, 0], // glints as the paper turns
    noise: { strength: 0.12, frequency: 1.5, scroll: 1.2 },
  },
  bubbles: {
    label: 'Bubbles',
    source: 'SparklePresets.bubbles',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 0.9,
    texture: 'noisyglow',
    colors: [[1, 1, 1, 0.5]],
    life: [3.2, 4.8],
    speed: [0.05, 0.1],
    size: [0.07, 0.13],
    rotation: false,
    gravity: -0.003,
    rate: 4,
    max: 28,
    shape: { type: 'cone', angle: 60, radius: 0.12, dir: 1 },
    colorOverLife: [0, 1, 0.65, 0.9, 0.3, 0.6, 0.9, 1, 0.6, 0.75, 1, 0.7, 1, 1, 0.7, 0.95], // soap-film hues: pink, cyan, mint, pink
    sizeOverLife: [0, 0.4, 0.12, 1, 0.92, 1, 0.97, 1.2, 1, 1.5], // grow, hold, pop
    alphaOverLife: [0, 0, 0.1, 1, 0.92, 0.85, 0.965, 1, 1, 0],
    noise: { strength: 0.06, frequency: 1.4, scroll: 0.7 },
  },
  stardust: {
    label: 'Stardust',
    source: 'SparklePresets.stardust',
    fit: { space: 1, size: 1 },
    space: 'world',
    texture: 'burst',
    frames: 2, // star glints and dots
    palette: [
      [1, 0.96, 0.8, 1], [0.75, 0.88, 1, 1], [1, 0.85, 0.45, 1], [0.88, 0.8, 1, 1],
    ],
    life: [1.6, 2.8],
    speed: [0.02, 0.08],
    size: [0.035, 0.07],
    rotation: true,
    spin: [-30, 30],
    gravity: 0.003,
    rate: 18,
    max: 56,
    shape: { type: 'sphere', radius: 1.8, thickness: 0.55, dir: 1, headRelative: true },
    sizeOverLife: [0, 0.3, 0.15, 1, 1, 0.6],
    alphaOverLife: [0, 0, 0.08, 1, 0.2, 0.25, 0.32, 1, 0.46, 0.2, 0.6, 1, 0.72, 0.3, 0.85, 0.9, 1, 0], // twinkles
    noise: { strength: 0.04, frequency: 1, scroll: 0.6 },
  },
  petals: {
    label: 'Petals',
    source: 'SparklePresets.petals',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 2,
    texture: 'flamewisps',
    frames: 4, // the veined wisps read as petals
    palette: [
      [1, 0.72, 0.84, 1], [1, 0.55, 0.72, 1], [1, 0.88, 0.93, 1], [1, 0.62, 0.78, 1],
    ],
    life: [4, 6],
    speed: [0.08, 0.15],
    size: [0.045, 0.08],
    rotation: true,
    spin: [-70, 70],
    rate: 6.5,
    max: 48,
    shape: { type: 'cone', angle: 20, radius: 0.22, dir: -1 }, // fall from above the head
    alphaOverLife: [0, 0, 0.12, 1, 0.82, 1, 1, 0],
    noise: { strength: 0.13, frequency: 1.6, scroll: 0.8 },
  },
  snow: {
    label: 'Snow',
    source: 'SparklePresets.snow',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 2.3,
    texture: 'spark',
    frames: 2, // bright flakes and soft ones
    colors: [[0.92, 0.96, 1, 1], [0.8, 0.9, 1, 0.9]],
    life: [3.2, 5],
    speed: [0.1, 0.2],
    size: [0.025, 0.05],
    rotation: false,
    rate: 11,
    max: 56,
    shape: { type: 'cone', angle: 12, radius: 0.26, dir: -1 }, // constant fall (no gravity), swirled by the noise
    alphaOverLife: [0, 0, 0.12, 1, 0.8, 1, 1, 0],
    noise: { strength: 0.07, frequency: 2, scroll: 0.5 },
  },
  fireflies: {
    label: 'Fireflies',
    source: 'SparklePresets.fireflies',
    fit: { space: 1, size: 1 },
    space: 'world',
    texture: 'spark',
    colors: [[0.85, 1, 0.3, 1], [1, 0.95, 0.45, 1]],
    life: [3, 5.5],
    speed: [0.01, 0.05],
    size: [0.055, 0.09],
    rotation: false,
    gravity: -0.002,
    rate: 9,
    max: 48,
    shape: { type: 'sphere', radius: 2.2, thickness: 0.55, dir: 1, headRelative: true },
    alphaOverLife: [0, 0, 0.05, 0.9, 0.17, 0, 0.36, 0, 0.42, 1, 0.55, 0, 0.74, 0, 0.8, 0.95, 0.9, 0, 1, 0], // three blinks
    noise: { strength: 0.09, frequency: 1.2, scroll: 0.9 },
  },
  rain: {
    label: 'Rain',
    source: 'SparklePresets.rain',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 2.6, // a cloud over the head
    texture: 'capsule',
    streak: 0.045, // thin streaks (Size is the width)
    colors: [[0.62, 0.82, 1, 0.75]],
    life: [0.55, 0.8],
    speed: [1.1, 1.6],
    size: [0.004, 0.007],
    rotation: false,
    rate: 64,
    max: 60,
    shape: { type: 'cone', angle: 3, radius: 0.24, dir: -1 },
    alphaOverLife: [0, 0, 0.08, 1, 0.85, 1, 1, 0],
  },
  smoke: {
    label: 'Smoke',
    source: 'SparklePresets.smoke',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 0.8, // a plume off the crown
    texture: 'noisyglow',
    colors: [[0.66, 0.7, 0.8, 0.38]],
    life: [2.4, 3.6],
    speed: [0.06, 0.12],
    size: [0.07, 0.12],
    rotation: true,
    spin: [-20, 20],
    gravity: -0.006,
    rate: 8,
    max: 40,
    shape: { type: 'cone', angle: 12, radius: 0.035, dir: 1 },
    sizeOverLife: [0, 0.5, 0.5, 1, 1, 1.8],
    alphaOverLife: [0, 0, 0.2, 1, 0.6, 0.7, 1, 0],
    noise: { strength: 0.1, frequency: 1.2, scroll: 0.5 },
  },
  sparks: {
    label: 'Sparks',
    source: 'SparklePresets.sparks',
    fit: { space: 1, size: 1 },
    space: 'world',
    texture: 'capsule',
    streak: 0.05, // short bright dashes along their flight
    colors: [[1, 1, 1, 1]],
    life: [0.4, 0.85],
    speed: [0.5, 1.3],
    size: [0.006, 0.011],
    rotation: false,
    gravity: 0.14,
    rate: 36,
    max: 56,
    shape: { type: 'hemisphere', radius: 1, thickness: 0.15, dir: 1, headRelative: true }, // off the head's upper half
    colorOverLife: [0, 1, 1, 0.9, 0.25, 1, 0.85, 0.45, 0.7, 1, 0.5, 0.15, 1, 0.8, 0.2, 0.05], // white-hot, yellow, orange, ember
    sizeOverLife: [0, 1, 1, 0.4],
    alphaOverLife: [0, 1, 0.7, 1, 1, 0],
  },
  aurora: {
    label: 'Aurora',
    source: 'SparklePresets.aurora',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 2.4,
    texture: 'soft',
    streak: 6, // tall soft light pillars drifting up above the head
    colors: [[1, 1, 1, 0.5]],
    life: [3.5, 5.5],
    speed: [0.04, 0.08],
    size: [0.08, 0.135],
    rotation: false,
    rate: 2.4,
    max: 14,
    pulse: true,
    shape: { type: 'cone', angle: 8, radius: 0.26, dir: 1 },
    colorOverLife: [0, 0.25, 1, 0.6, 0.35, 0.2, 0.9, 1, 0.7, 0.6, 0.45, 1, 1, 0.85, 0.4, 0.9], // green, teal, violet, magenta
    sizeOverLife: [0, 0.8, 1, 1.2],
    alphaOverLife: [0, 0, 0.25, 1, 0.7, 1, 1, 0],
    noise: { strength: 0.05, frequency: 0.8, scroll: 0.4 },
  },
  hearts: {
    label: 'Hearts',
    source: 'SparklePresets.hearts',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 1.1,
    texture: 'heart',
    palette: [
      [1, 0.3, 0.5, 1], [1, 0.45, 0.6, 1], [1, 0.2, 0.35, 1], [1, 0.6, 0.7, 1],
    ],
    life: [2.6, 3.8],
    speed: [0.12, 0.2],
    size: [0.06, 0.1],
    rotation: false,
    gravity: -0.002,
    rate: 5,
    max: 30,
    shape: { type: 'cone', angle: 25, radius: 0.1, dir: 1 },
    sizeOverLife: [0, 0.6, 0.1, 1.1, 0.16, 0.85, 0.24, 1.15, 0.34, 0.85, 0.5, 1.1, 0.58, 0.9, 0.66, 1.1, 0.8, 1, 1, 0.7], // lub-dub
    alphaOverLife: [0, 0, 0.15, 1, 0.75, 1, 1, 0],
    noise: { strength: 0.08, frequency: 1.4, scroll: 0.6 },
  },
  notes: {
    label: 'Notes',
    source: 'SparklePresets.notes',
    fit: { space: 1, size: 1 },
    space: 'world',
    anchorY: 0.9,
    texture: 'note',
    palette: [
      [1, 0.85, 0.35, 1], [1, 0.98, 0.9, 1], [0.6, 0.85, 1, 1], [0.6, 1, 0.8, 1],
    ],
    life: [2.4, 3.4],
    speed: [0.13, 0.22],
    size: [0.045, 0.065],
    rotation: false,
    rate: 6,
    max: 32,
    shape: { type: 'cone', angle: 35, radius: 0.08, dir: 1 },
    sizeOverLife: [0, 0.6, 0.1, 1.15, 0.2, 0.85, 0.3, 1.15, 0.4, 0.85, 0.5, 1.15, 0.6, 0.85, 0.7, 1.15, 0.8, 0.9, 1, 0.7], // a steady beat
    alphaOverLife: [0, 0, 0.1, 1, 0.75, 1, 1, 0],
    noise: { strength: 0.22, frequency: 0.9, scroll: 1.4 }, // lilting S-curves
  },
};

/** Preset names with an effect (PARTICLE_PRESETS minus 'none'). */
export const EFFECT_PRESETS = Object.keys(PRESET_DEFS);

/**
 * Space and size scale factors that fit preset `def` to a head of `headRadius` metres:
 * debuffs follow DebuffFx.ScaleFor (Margin * radius / Reach), POI presets their `fit`.
 */
export function fitScale(def, headRadius) {
  if (def.reach) {
    const k = (DEBUFF_MARGIN * headRadius) / def.reach;
    return { space: k, size: k };
  }
  const r = headRadius / FIT_RADIUS;
  return { space: def.fit.space * r, size: def.fit.size * r };
}

/** Piecewise-linear [t0, v0, t1, v1, ...] keys at u in 0..1 (1 when no keys). */
export function curve(keys, u) {
  if (!keys) return 1;
  if (u <= keys[0]) return keys[1];
  for (let i = 2; i < keys.length; i += 2) {
    if (u <= keys[i]) return keys[i - 1] + ((keys[i + 1] - keys[i - 1]) * (u - keys[i - 2])) / (keys[i] - keys[i - 2]);
  }
  return keys[keys.length - 1];
}

/** RGB gradient keys [t, r, g, b, ...] at u, written into out[0..2]. */
export function gradient(keys, u, out) {
  if (!keys) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  let i = 0;
  while (i + 4 < keys.length && u > keys[i + 4]) i += 4;
  if (u <= keys[0] || i + 4 >= keys.length) {
    const j = u <= keys[0] ? 0 : keys.length - 4;
    out[0] = keys[j + 1];
    out[1] = keys[j + 2];
    out[2] = keys[j + 3];
    return out;
  }
  const f = (u - keys[i]) / (keys[i + 4] - keys[i]);
  out[0] = keys[i + 1] + (keys[i + 5] - keys[i + 1]) * f;
  out[1] = keys[i + 2] + (keys[i + 6] - keys[i + 2]) * f;
  out[2] = keys[i + 3] + (keys[i + 7] - keys[i + 3]) * f;
  return out;
}
