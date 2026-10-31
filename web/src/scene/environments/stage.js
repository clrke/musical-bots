// The sets on screen: loads the Blender sets, cuts between them (no set shown: the bare dark stage, no backdrop), and lights
// them. Per set: a hemisphere fill and a key light (from the heads' own key direction), the set's
// practical lamps at their exported candela (scripts/blender: RAW lights, no scale hack), the
// exposure, the "daylight" materials (windows, sky) and a reflection environment built from the
// set's colours with the studio's softboxes, so the chrome heads reflect the room they are in and
// still get their crisp highlights. Moods (the lighting agent's lights-<mood>) fade over ~1 s. An outdoor set's sky
// is the street's painted gradient (stars and a moon) or a panorama (sets.js lights.panorama: environments/skies/*.jpg,
// the Squatopia 2 skies) the moods tint and dim; the heads' reflections see the same sky.
// Follow spots (a beam, a pool of light, a halo) find whoever sings: the story's line first, then
// the harmonies and the pal's answers, then the backing (softer), MAX_SPOTS at most; each fades in
// as its bot starts to sing and out after. The lighting agent's spot-<Bot> is an accent on top: that
// bot gets a spot for a few seconds. Floating heads get soft blob shadows.
// Deterministic: everything animates from the dt it is given.
import * as THREE from 'three';
import { loadEnvironment } from './index.js';
import { SETS, MOODS } from './sets.js';
import { SHARED_UNIFORMS, MAX_LOCAL, STUDIO_KEY, createGlowMaterial, getGlowQuad } from '../head-material.js';
import { ENV_SIZE } from '../studio-env.js';

const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to the linear working space
const FADE = 1.0; // seconds a mood takes
const SPOT_IN = 0.5, SPOT_OUT = 0.7;
const _src = new THREE.Vector3(), _axis = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _q = new THREE.Vector3();
// the heads' own shader lights itself (head-material.js): what it takes from a set's lights
const HEAD_PRACTICALS = 4; // the set's lamps nearest the stage (the rest of MAX_LOCAL: spots + party)
const HEAD_LAMP = { spot: 1.0, party: 0.35, practical: 0.3 }; // lamp radii (m): the lamp's disc on chrome
const HEAD_SPOT = 2.5; // the spot on its head: the beam's lamp is held at 40 cd for the walls near the camera
const HEAD_CAST = 0.55; // how much more of the mood's tint the heads' reflections take than the set's env map

// ------------------------------------------------------------------ the follow spots

/** Follow spots at most (three SpotLights always in the scene: one shader program per set, whatever is lit). */
export const MAX_SPOTS = 3;
/** Who gets a spot first when more sing than there are spots (higher first). */
export const SPOT_RANK = Object.freeze({ lead: 3, duet: 2.8, accent: 2.5, harmony: 2, reply: 2, echo: 2, backing: 1 });
/**
 * How bright each one's spot is: the lead brightest, the two of a making-of duet (rig.js spotPart 'duet') a little
 * softer, the backing clearly dimmer (QA v14: a bot only singing the backing was lit as brightly as the lead).
 */
export const SPOT_GAIN = Object.freeze({ lead: 1, accent: 1, duet: 0.8, harmony: 0.75, reply: 0.7, echo: 0.7, backing: 0.35 });
const SPOT_CD = 40; // the beam's lamp (75 burnt walls near the camera to white)
const SPOT_HOLD = 0.6; // s a spot stays on its singer after the line (its next line keeps it)
const SPOT_SWAP = 0.15; // s a spot takes to go out when a higher-ranked singer needs it now
const ACCENT_SECONDS = 4; // a lighting cue's spot-<Bot>: that bot's spot lasts this long
const ROOM_DIM = 0.22; // the room dims this much under the singers' spots (a lighting cue's accent: ACCENT_DIM)
const ACCENT_DIM = 0.42;
const STUDIO_HEAD_SPOT = 0.55; // the studio's heads take this share of a spot's lamp (its look stays its own)
const BEAM_SINGER = 0.6; // a singer's beam, of a lighting cue's (spots are on through the whole song: not a white haze)

/**
 * Which bots get the spots: the highest ranked of `cands` ([{ bot, rank, serial }]), a bot lit already before an equal
 * one, then the earlier singer (serial), at most `max`. Pure.
 */
export function pickSpots(cands, lit = new Set(), max = MAX_SPOTS) {
  return cands.slice().sort((a, b) => b.rank - a.rank || (lit.has(b.bot) ? 1 : 0) - (lit.has(a.bot) ? 1 : 0) || a.serial - b.serial)
    .slice(0, max).map((c) => c.bot);
}

// ------------------------------------------------------------------ reflection environment rig

const roomVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// an equirectangular panorama's colour in direction d (yaw: radians the panorama turns about the vertical)
const panoSample = /* glsl */ `
uniform sampler2D uPano;
uniform float uPanoOn, uPanoYaw;
uniform vec3 uPanoTint;
vec3 pano(vec3 d) {
  float u = atan(d.x, -d.z) / 6.2831853 + 0.5 + uPanoYaw / 6.2831853;
  float v = asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5;
  return texture2D(uPano, vec2(fract(u), v)).rgb * uPanoTint;
}
`;

// the studio's gradient room (studio-env.js), with the set's floor / wall / ceiling colours (a panorama set: its sky
// above the horizon, the ground below)
const roomFragment = /* glsl */ `
uniform vec3 uFloor, uWall, uCeil, uGlow;
varying vec3 vDir;
${panoSample}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = y < 0.0 ? mix(uWall * 0.55, uFloor, smoothstep(0.0, 0.35, -y)) : mix(uWall, uCeil, smoothstep(0.05, 0.85, y));
  if (uPanoOn > 0.5) c = y < 0.0 ? mix(pano(vec3(d.x, 0.02, d.z)) * 0.6, uFloor, smoothstep(0.0, 0.3, -y)) : pano(d);
  c *= 0.85 + 0.25 * smoothstep(-0.6, 0.6, d.z);
  c += uGlow * exp(-y * y * 60.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

// softboxes as in the studio: key, fill, overhead strip, two rims, a low bounce (direction, size, gain)
const BOXES = [
  { dir: [0.45, 0.62, 0.65], w: 3.6, h: 2.6, gain: [8.5, 8.1, 7.6], key: true },
  { dir: [-0.9, 0.18, 0.42], w: 2.4, h: 3.6, gain: [2.8, 2.95, 3.2] },
  { dir: [0.05, 1, 0.12], w: 5.0, h: 0.9, gain: [3.4, 3.4, 3.5] },
  { dir: [0.75, 0.28, -0.6], w: 0.7, h: 3.6, gain: [4.2, 4.4, 4.8], rim: 1 },
  { dir: [-0.75, 0.28, -0.6], w: 0.7, h: 3.6, gain: [4.6, 4.3, 4.0], rim: -1 },
  { dir: [0, -0.3, 1], w: 3.4, h: 1.2, gain: [0.9, 0.85, 0.8] },
];

function createEnvRig() {
  const scene = new THREE.Scene();
  const uniforms = { uFloor: { value: new THREE.Color() }, uWall: { value: new THREE.Color() },
    uCeil: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, ...panoUniforms() };
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: roomVertex, fragmentShader: roomFragment, uniforms, side: THREE.BackSide, depthWrite: false })));
  const boxes = BOXES.map((b) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(...b.dir).normalize().multiplyScalar(6);
    m.lookAt(0, 0, 0);
    scene.add(m);
    return { ...b, mesh: m };
  });
  return { scene, uniforms, boxes };
}

// ------------------------------------------------------------------ the street sky

const skyFragment = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGlow, uMoon;
uniform float uStars, uMoonOn;
varying vec3 vDir;
${panoSample}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  if (uPanoOn > 0.5) {
    // a painted sky (its lower half is haze: the set's ground and sea cover it)
    gl_FragColor = vec4(pano(d), 1.0);
    #include <colorspace_fragment>
    return;
  }
  float y = max(d.y, -0.2);
  vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, y));
  c += uGlow * exp(-max(y, 0.0) * 9.0) * 0.8;
  // stars: a fine fixed lattice, a few cells lit, each a soft dot
  vec3 sp = d * 420.0;
  vec3 g = floor(sp);
  float s = step(0.9975, hash(g)) * smoothstep(0.5, 0.15, length(fract(sp) - 0.5)) * smoothstep(0.08, 0.35, y) * uStars;
  c += vec3(s) * (0.6 + 0.6 * hash(g + 7.0));
  // the moon, up and to the left
  float m = dot(d, normalize(vec3(-0.35, 0.55, -0.76)));
  c += uMoon * (smoothstep(0.9993, 0.9996, m) * 1.6 + pow(max(m, 0.0), 300.0) * 0.35) * uMoonOn;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

const SKIES = {
  night: { zenith: '#070b1e', horizon: '#26304f', glow: '#3a2f3a', stars: 1, moon: 1 },
  dusk: { zenith: '#16204a', horizon: '#6a5a7a', glow: '#c27a5a', stars: 0.35, moon: 1 },
  sunset: { zenith: '#2a2a5a', horizon: '#e0905a', glow: '#ffb070', stars: 0, moon: 0 },
  day: { zenith: '#5a9ae0', horizon: '#cfe4f5', glow: '#ffffff', stars: 0, moon: 0 },
  party: { zenith: '#1a0830', horizon: '#5a1a6a', glow: '#ff4fb0', stars: 0.8, moon: 0 },
};

/** The panorama uniforms (sky sphere and reflection rig): off until a panorama set is shown. */
function panoUniforms() {
  return { uPano: { value: null }, uPanoOn: { value: 0 }, uPanoYaw: { value: 0 }, uPanoTint: { value: new THREE.Color(1, 1, 1) } };
}

/**
 * How bright a panorama is in a mood, against the set's own mood (its sky is painted for that one): the moods' daylight
 * ratio, kept between a night and a bright day.
 */
export function panoGain(setMood, mood) {
  const base = MOODS[setMood]?.daylight ?? 1, m = MOODS[mood]?.daylight ?? base;
  return Math.min(1.4, Math.max(0.22, m / base));
}

const texLoader = new THREE.TextureLoader();

function createSky() {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uMoon: { value: lin('#fff6e0') }, uStars: { value: 1 }, uMoonOn: { value: 1 }, ...panoUniforms(),
  };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: roomVertex, fragmentShader: skyFragment, uniforms, side: THREE.BackSide, depthWrite: false }));
  mesh.renderOrder = -1;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

// ------------------------------------------------------------------ spot beam, pool, blob shadows

const beamVertex = /* glsl */ `
varying float vV, vDist;
varying vec3 vN, vView;
void main() {
  vV = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vDist = length(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vV, vDist;
varying vec3 vN, vView;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
  // a camera close to (or inside) the cone sees its walls face-on across the frame: fade them out
  float near = smoothstep(1.5, 4.0, vDist);
  float a = uAlpha * edge * (0.2 + 0.8 * vV) * 0.36 * near;
  gl_FragColor = vec4(uColor * a, 0.0);
  #include <colorspace_fragment>
}
`;
const discFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDark;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = uAlpha * smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.55, r);
  if (uDark > 0.5) gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  else gl_FragColor = vec4(uColor * a, 0.0);
  #include <colorspace_fragment>
}
`;
const discVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

// ------------------------------------------------------------------ the stage

export class Stage {
  /**
   * renderer (null in tests: no env maps), scene, camera (for the warm-up compile), studio: the
   * studio environment ({ texture }: the heads' reflections before a set is shown), backdrop: none (an old option:
   * a mesh shown only with no set), bots: Map name -> Bot.
   */
  constructor({ renderer = null, scene, camera = null, studio = null, backdrop = null, bots = new Map() }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.studio = studio;
    this.backdrop = backdrop;
    this.bots = bots;
    this.sets = new Map(); // name -> { group, practicals: [{ light, base }], daylight: [{ mat, base }] }
    this.loading = new Map();
    this.name = 'studio';
    this.def = SETS.studio;
    this.time = 0;
    // the studio's own fill (its look does not use it; kept as it was)
    this.studioHemi = new THREE.HemisphereLight(0xffffff, 0x333355, 0.35);
    scene.add(this.studioHemi);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0);
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.key.target.position.set(0, 1, -1);
    scene.add(this.hemi, this.key, this.key.target);
    // mood: the current blend of a set's rig, eased toward the target mood
    this.cur = null;
    this.goal = null;
    this.moodName = null;
    this.envDirty = true;
    // the reflection environment for sets (heads, hands and set materials)
    this.rig = createEnvRig();
    this.pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
    this.cubeRT = renderer ? new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType }) : null;
    this.cubeCam = renderer ? new THREE.CubeCamera(0.1, 100, this.cubeRT) : null;
    this.envRT = null;
    this.sky = createSky();
    this.sky.mesh.visible = false;
    scene.add(this.sky.mesh);
    // party lights (the party mood): three coloured lamps circling the stage
    this.party = ['#ff3fa4', '#38d6ff', '#ffc23a'].map((c) => {
      const l = new THREE.PointLight(lin(c), 0, 0, 2);
      scene.add(l);
      return l;
    });
    // the follow spots: each a lamp, a beam, a pool on the floor and a halo, given to a singer (_updateSpots)
    this.spotLevel = 0; // how much the room dims under the spots (0..ACCENT_DIM)
    this._envDim = 0; // the dim the reflection environment was last built with
    this.accent = null; // the lighting cue's spot-<Bot>: { bot, until }
    this._sungAt = new Map(); // bot -> stage time it last sang (a spot holds over a short gap)
    const beamGeo = new THREE.CylinderGeometry(0.06, 1, 1, 40, 1, true), poolGeo = new THREE.PlaneGeometry(1, 1);
    this.spots = Array.from({ length: MAX_SPOTS }, () => {
      const light = new THREE.SpotLight(0xfff1d8, 0, 0, 0.36, 0.6, 2);
      const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ vertexShader: beamVertex, fragmentShader: beamFragment,
        side: THREE.DoubleSide, ...additive, uniforms: { uColor: { value: lin('#fff0d0') }, uAlpha: { value: 0 } } }));
      beam.visible = false;
      beam.renderOrder = 5;
      const pool = new THREE.Mesh(poolGeo, new THREE.ShaderMaterial({ vertexShader: discVertex, fragmentShader: discFragment, ...additive,
        uniforms: { uColor: { value: lin('#ffe6bf') }, uAlpha: { value: 0 }, uDark: { value: 0 } } }));
      pool.rotation.x = -Math.PI / 2;
      pool.visible = false;
      // the heads light themselves (their own shader, fed by _feedHeads): the spot also leaves a warm halo
      const halo = new THREE.Mesh(getGlowQuad(), createGlowMaterial());
      halo.material.uniforms.uColor.value.set('#ffe6c0');
      halo.visible = false;
      halo.renderOrder = 4;
      scene.add(light, light.target, beam, pool, halo);
      // bot: whose spot it is (kept while it fades out); next: the singer it goes to once out; lamp: cd on the heads
      return { light, beam, pool, halo, bot: null, next: null, want: false, level: 0, gain: 1, accent: false, lamp: 0 };
    });
    // soft contact shadows under the floating heads (sets only)
    this.shadows = new Map();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const b of bots.values()) {
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: discVertex, fragmentShader: discFragment,
        transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uDark: { value: 1 } } }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.shadows.set(b, m);
    }
  }

  // ---------------------------------------------------------------- sets

  /** Loads set `name` once (hidden; its sky panorama too), resolves its group or null when it cannot load. */
  load(name) {
    if (this.sets.has(name)) return Promise.resolve(this.sets.get(name).group);
    if (!this.loading.has(name)) {
      const file = SETS[name]?.lights?.panorama?.file;
      const pano = file ? texLoader.loadAsync(`${import.meta.env?.BASE_URL ?? '/'}environments/skies/${file}`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearFilter; // (no mipmaps: no seam where u wraps)
        t.generateMipmaps = false;
        return t;
      }).catch((err) => {
        console.warn(`[stage] sky ${file}:`, err?.message ?? err);
        return null;
      }) : Promise.resolve(null);
      this.loading.set(name, Promise.all([loadEnvironment(name), pano]).then(([{ group }, tex]) => {
        this.adopt(name, group, tex);
        return group;
      }).catch((err) => {
        console.warn(`[stage] set ${name}:`, err.message);
        return null;
      }));
    }
    return this.loading.get(name);
  }

  /** Takes a loaded set group (and its sky panorama texture): hidden, its lamps and daylight materials noted for the moods. */
  adopt(name, group, pano = null) {
    const practicals = [], daylight = [];
    const def = SETS[name] ?? SETS.diner;
    const dayNames = new Set(def.lights?.daylight ?? []);
    const seen = new Set();
    group.traverse((o) => {
      if (o.isLight) practicals.push({ light: o, base: o.intensity });
      if (o.isMesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (seen.has(m)) continue;
          seen.add(m);
          if (dayNames.has(m.name)) daylight.push({ mat: m, base: m.emissiveIntensity });
        }
      }
    });
    group.visible = false;
    group.name = `set-${name}`;
    this.scene.add(group);
    // the lamps the heads take: the strongest at the stage first (fixed per set: deterministic)
    group.updateMatrixWorld(true);
    const st = def.marks?.stage ?? [0, 0, def.headY ?? 1.2];
    const stage = new THREE.Vector3(st[0], st[2], st[1]);
    const lamps = practicals.filter((p) => p.light.isPointLight || p.light.isSpotLight).map((p) => {
      const pos = p.light.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3();
      if (p.light.isSpotLight) {
        p.light.target.updateMatrixWorld(true);
        dir.copy(p.light.target.getWorldPosition(_q)).sub(pos).normalize();
      }
      return { ...p, pos, dir, rank: p.base / (1 + pos.distanceToSquared(stage)) };
    }).sort((a, b) => b.rank - a.rank).slice(0, HEAD_PRACTICALS);
    this.sets.set(name, { group, practicals, daylight, lamps, pano });
  }

  /**
   * Compiles the shaders each loaded set needs now (no hitch at its first cut): three builds a
   * program per light setup, so each set is shown with its own lamps and compiled in turn.
   */
  warm() {
    if (!this.renderer || !this.camera) return;
    const was = this.name;
    for (const n of this.sets.keys()) {
      this.show(n);
      try { this.renderer.compile(this.scene, this.camera); } catch { /* best effort */ }
    }
    this.show(was);
  }

  /** Shows set `name` ('studio': the panorama) with its default mood, at once (a cut). */
  show(name) {
    if (name !== 'studio' && !this.sets.has(name)) name = 'studio';
    this.name = name;
    this.def = SETS[name] ?? SETS.diner;
    for (const [n, s] of this.sets) s.group.visible = n === name;
    const studio = name === 'studio';
    if (this.backdrop) this.backdrop.visible = studio;
    this.studioHemi.visible = studio;
    this.sky.mesh.visible = !studio && !!this.def.lights?.sky;
    // a panorama set: its painted sky on the sky sphere and in the reflections (none loaded: the gradient sky)
    const pano = studio ? null : this.sets.get(name)?.pano ?? null;
    for (const u of [this.sky.uniforms, this.rig.uniforms]) {
      u.uPano.value = pano;
      u.uPanoOn.value = pano ? 1 : 0;
      u.uPanoYaw.value = THREE.MathUtils.degToRad(this.def.lights?.panorama?.yaw ?? 0);
    }
    this.spot(null, { now: true });
    if (studio) {
      this.hemi.intensity = this.key.intensity = 0;
      for (const l of this.party) l.intensity = 0;
      this.scene.environment = this.studio?.texture ?? null;
      this.scene.environmentIntensity = 0.6;
      this.scene.background = new THREE.Color(0x2a2826);
      if (this.renderer) this.renderer.toneMappingExposure = 0.8;
      if (this.studio?.texture) SHARED_UNIFORMS.uEnvMap.value = this.studio.texture;
      this.cur = this.goal = null;
      for (const sh of this.shadows.values()) sh.visible = false;
      this._feedHeads();
      return;
    }
    this.scene.background = new THREE.Color(this.def.lights?.sky ? 0x070b1e : 0x15110f);
    this.moodName = this.def.lights?.mood ?? 'warm';
    this.goal = this._rigFor(this.moodName);
    this.cur = cloneRig(this.goal);
    this.envDirty = true;
    this._apply();
    this._feedHeads();
  }

  /** Back to the set's default mood, no spot (a player reset). */
  reset() {
    this.spot(null, { now: true });
    if (this.name !== 'studio') this.show(this.name);
  }

  // ---------------------------------------------------------------- cues

  /** lights-<mood>: the set fades to mood over FADE seconds (the studio keeps its look). */
  mood(name) {
    if (this.name === 'studio' || !MOODS[name]) return;
    this.moodName = name;
    this.goal = this._rigFor(name);
  }

  /**
   * spot-<Bot> (the lighting agent's cue): an accent on top of the singers' spots, that bot lit for ACCENT_SECONDS
   * (null: the accent off). now: every spot out at once (a cut, a reset).
   */
  spot(bot, { now = false } = {}) {
    this.accent = bot ? { bot, until: this.time + ACCENT_SECONDS } : null;
    if (now) {
      for (const r of this.spots) Object.assign(r, { bot: null, next: null, want: false, level: 0, accent: false, lamp: 0 });
      this._sungAt.clear();
      this.spotLevel = 0;
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    this.time += dt;
    if (this.name !== 'studio' && this.cur && this.goal) {
      const k = 1 - Math.exp(-dt * (4.6 / FADE)); // ~99% of the way in FADE seconds
      const moved = lerpRig(this.cur, this.goal, k);
      if (moved) this.envDirty = true;
    }
    // the spots find the singers, fade in on them and out after; the room dims under them (the reflections in steps)
    this._updateSpots(dt);
    if (Math.round(this.spotLevel * 20) / 20 !== this._envDim && this.name !== 'studio') this.envDirty = true;
    if (this.name !== 'studio') this._apply();
    for (const r of this.spots) this._drawSpot(r);
    this._updateShadows();
    this._feedHeads();
    if (this.envDirty && this.name !== 'studio') this._buildEnv();
  }

  /**
   * Who is lit: every visible bot singing now (rig.js: bot.singing, its part) or a moment ago with its spot still on,
   * and the lighting cue's accent, ranked (pickSpots); the spots keep their singers, a free one takes a new singer, and
   * a spot whose singer is no longer wanted goes out (fast when a higher-ranked singer is waiting for it).
   */
  _updateSpots(dt) {
    const lit = new Set();
    for (const r of this.spots) if (r.bot && r.want) lit.add(r.bot);
    if (this.accent && this.time >= this.accent.until) this.accent = null;
    const cands = [];
    for (const b of this.bots.values()) {
      if (!b?.group?.visible) continue;
      const singing = b.singing > 0;
      if (singing) this._sungAt.set(b, this.time);
      const on = singing || (lit.has(b) && this.time - (this._sungAt.get(b) ?? -Infinity) <= SPOT_HOLD);
      const accent = this.accent?.bot === b;
      if (!on && !accent) continue;
      const part = on ? b.spotPart ?? b.part ?? 'lead' : 'accent';
      const rank = Math.max(SPOT_RANK[part] ?? SPOT_RANK.lead, accent ? SPOT_RANK.accent : 0);
      cands.push({ bot: b, rank, serial: b.singSerial ?? 0, gain: accent ? SPOT_GAIN.accent : SPOT_GAIN[part] ?? 1, accent });
    }
    const want = pickSpots(cands, lit, this.spots.length);
    for (const r of this.spots) {
      r.want = !!r.bot && want.includes(r.bot);
      if (r.next && !want.includes(r.next)) r.next = null;
    }
    for (const b of want) {
      if (this.spots.some((r) => r.bot === b || r.next === b)) continue;
      const free = this.spots.find((r) => !r.bot);
      if (free) Object.assign(free, { bot: b, want: true, level: 0 });
      else {
        // all taken: the dimmest one going out hands over to it
        const going = this.spots.filter((r) => !r.want && !r.next).sort((x, y) => x.level - y.level)[0];
        if (going) going.next = b;
      }
    }
    let room = 0;
    for (const r of this.spots) {
      const c = r.want ? cands.find((x) => x.bot === r.bot) : null;
      if (c) { r.gain = c.gain; r.accent = c.accent; }
      r.level = r.want ? Math.min(1, r.level + dt / SPOT_IN) : Math.max(0, r.level - dt / (r.next ? SPOT_SWAP : SPOT_OUT));
      if (!r.want && r.level <= 0) Object.assign(r, { bot: r.next, next: null, want: !!r.next, level: 0 });
      if (r.bot) room = Math.max(room, r.level * r.gain * (r.accent ? ACCENT_DIM : ROOM_DIM));
    }
    this.spotLevel = room; // how much the room dims (0 .. ACCENT_DIM)
  }

  /** The spots' lamps on the heads (lamp: _feedHeads' adder), brightest first, at `share` of their candela. */
  _spotLamps(lamp, share) {
    const lit = this.spots.filter((r) => r.lamp > 0).sort((a, b) => b.lamp - a.lamp);
    for (const r of lit) {
      const sp = r.light;
      _p.copy(sp.target.position).sub(sp.position).normalize();
      lamp(sp.position, sp.color, r.lamp * HEAD_SPOT * share, HEAD_LAMP.spot, _p, Math.cos(sp.angle), Math.cos(sp.angle * (1 - sp.penumbra)));
    }
  }

  /**
   * The heads' shader (head-material.js) does not see three's lights: hand it the set's light.
   * The key takes the mood's colour and level (dimmed under the spots), the exposure the set's; the
   * follow spots, the party lamps and the set's lamps nearest the stage become local lamps. The
   * studio: the studio key, exposure 1, and only the singers' spots, softer (its look is its own).
   */
  _feedHeads() {
    const U = SHARED_UNIFORMS;
    const c = this.cur;
    let n = 0;
    const lamp = (pos, color, intensity, radius, dir = null, cosOuter = -2, cosInner = -1) => {
      if (n >= MAX_LOCAL || intensity <= 1e-4) return;
      U.uLocalPos.value[n].set(pos.x, pos.y, pos.z, radius);
      U.uLocalCol.value[n].set(color.r * intensity, color.g * intensity, color.b * intensity, cosInner);
      if (dir) U.uLocalDir.value[n].set(dir.x, dir.y, dir.z, cosOuter);
      else U.uLocalDir.value[n].set(0, 0, 0, cosOuter);
      n++;
    };
    if (this.name === 'studio' || !c) {
      U.uKeyC.value.set(STUDIO_KEY[0], STUDIO_KEY[1], STUDIO_KEY[2]);
      U.uAmb.value.set(1, 1, 1);
      U.uExposure.value = 1;
      // the studio's look, plus the singers' spots on their heads (softer)
      if (this.name === 'studio') this._spotLamps(lamp, STUDIO_HEAD_SPOT);
      U.uLocalN.value = n;
      return;
    }
    const L = this.def.lights ?? SETS.diner.lights;
    const dim = 1 - this.spotLevel;
    const k = (c.key / L.key.intensity) * dim;
    U.uKeyC.value.set(STUDIO_KEY[0] * c.keyColor.r * k, STUDIO_KEY[1] * c.keyColor.g * k, STUDIO_KEY[2] * c.keyColor.b * k);
    // the reflections: the env map already carries the mood's env gain and tint; the heads also
    // follow the mood's light level (night, dim and party are darker than their env gain) and
    // take a little more of its colour, so they sit in the set's light
    const lvl = Math.sqrt(Math.max(0.05, c.hemi / L.hemi.intensity) / Math.max(0.05, c.env));
    const t = c.envTint;
    U.uAmb.value.set(lvl * (1 + (t.r - 1) * HEAD_CAST), lvl * (1 + (t.g - 1) * HEAD_CAST), lvl * (1 + (t.b - 1) * HEAD_CAST));
    U.uExposure.value = c.exposure;
    this._spotLamps(lamp, 1);
    for (const l of this.party) lamp(l.position, l.color, l.intensity, HEAD_LAMP.party);
    for (const p of this.sets.get(this.name)?.lamps ?? []) {
      const l = p.light;
      if (l.isSpotLight) lamp(p.pos, l.color, l.intensity, HEAD_LAMP.practical, p.dir, Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra)));
      else lamp(p.pos, l.color, l.intensity, HEAD_LAMP.practical);
    }
    U.uLocalN.value = n;
  }

  _rigFor(moodName) {
    const L = this.def.lights ?? SETS.diner.lights;
    const m = MOODS[moodName] ?? MOODS.warm;
    const tint = lin(m.tint);
    const sky = SKIES[m.sky] ?? SKIES.night;
    return {
      hemiSky: lin(L.hemi.sky).multiply(tint), hemiGround: lin(L.hemi.ground).multiply(tint),
      hemi: L.hemi.intensity * m.light,
      keyColor: lin(L.key.color).multiply(tint), key: L.key.intensity * m.light,
      practical: (L.practical ?? 1) * m.practical,
      daylight: m.daylight,
      exposure: (L.exposure ?? 1) * (m.exposure ?? 1),
      env: m.env,
      envTint: tint.clone(),
      party: m.party ? 1 : 0,
      zenith: lin(sky.zenith), horizon: lin(sky.horizon), glow: lin(sky.glow), stars: sky.stars, moon: sky.moon,
      // a panorama: half the mood's tint (the painted sky keeps its colours), its daylight against the set's own mood
      pano: lin('#ffffff').lerp(tint, 0.5).multiplyScalar(panoGain(L.mood ?? 'warm', moodName)),
    };
  }

  _apply() {
    const c = this.cur;
    if (!c) return;
    const set = this.sets.get(this.name);
    const dim = 1 - this.spotLevel; // the room dims under the spots
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemi * dim;
    this.key.color.copy(c.keyColor);
    this.key.intensity = c.key * dim;
    const L = this.def.lights ?? SETS.diner.lights;
    const d = L.key.dir;
    this.key.position.set(d[0] * 10, d[1] * 10 + 1, d[2] * 10 - 1);
    for (const p of set?.practicals ?? []) p.light.intensity = p.base * c.practical * (1 - 0.48 * this.spotLevel);
    for (const s of set?.daylight ?? []) s.mat.emissiveIntensity = s.base * c.daylight;
    if (this.renderer) this.renderer.toneMappingExposure = c.exposure;
    this.scene.environmentIntensity = 0.45 * c.env * dim;
    // party lamps circle the stage
    const pr = c.party;
    this.party.forEach((l, i) => {
      const a = this.time * 0.9 + (i * Math.PI * 2) / 3;
      l.position.set(Math.cos(a) * 2.6, 2.5, Math.sin(a) * 2.0 - 0.6);
      l.intensity = 9 * pr;
    });
    if (this.sky.mesh.visible) {
      const u = this.sky.uniforms;
      u.uZenith.value.copy(c.zenith);
      u.uHorizon.value.copy(c.horizon);
      u.uGlow.value.copy(c.glow);
      u.uStars.value = c.stars;
      u.uMoonOn.value = c.moon;
      u.uPanoTint.value.copy(c.pano);
      this.rig.uniforms.uPanoTint.value.copy(c.pano);
      if (u.uPanoOn.value) this.scene.background.copy(lin(L.env?.ceil ?? '#808080')).multiply(c.pano);
      else this.scene.background.copy(c.zenith);
    }
  }

  /** Rebuilds the set's reflection environment (when the set or the mood changes). */
  _buildEnv() {
    this.envDirty = false;
    if (!this.renderer || !this.cur) return;
    const L = this.def.lights ?? SETS.diner.lights;
    const E = L.env;
    const c = this.cur;
    this._envDim = Math.round(this.spotLevel * 20) / 20; // (rebuilt in steps as the spots fade)
    const g = c.env * (1 - 0.83 * this._envDim);
    const u = this.rig.uniforms;
    const t = c.envTint;
    if (this.sky.mesh.visible && !this.rig.uniforms.uPanoOn.value) {
      // outdoors: the sky above, the street below
      u.uCeil.value.copy(c.zenith).multiplyScalar(1.6);
      u.uWall.value.copy(c.horizon).multiplyScalar(0.9);
      u.uGlow.value.copy(c.glow).multiplyScalar(0.5);
    } else {
      u.uCeil.value.copy(lin(E.ceil)).multiply(t).multiplyScalar(0.95 * g);
      u.uWall.value.copy(lin(E.wall)).multiply(t).multiplyScalar(0.62 * g);
      u.uGlow.value.copy(lin(E.glow)).multiply(t).multiplyScalar(0.12 * g);
    }
    u.uFloor.value.copy(lin(E.floor)).multiply(t).multiplyScalar(0.55 * g);
    for (const b of this.rig.boxes) {
      const col = b.mesh.material.color;
      col.setRGB(b.gain[0], b.gain[1], b.gain[2], THREE.LinearSRGBColorSpace);
      col.multiply(t); // the key softbox too: the chrome's highlights take the mood's colour
      col.multiplyScalar(b.key ? (E.key ?? 1) * Math.max(0.55, g) : g);
      if (c.party > 0.01 && b.rim) col.lerp(lin(b.rim > 0 ? '#ff3fa4' : '#38d6ff').multiplyScalar(5), c.party);
    }
    this.cubeCam.update(this.renderer, this.rig.scene);
    if (!this.envRT) this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    else this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.scene.environment = this.envRT.texture;
    SHARED_UNIFORMS.uEnvMap.value = this.envRT.texture;
  }

  /**
   * One spot as drawn on its bot (also while it fades out): the beam from above, the pool on the floor, the halo
   * behind the head, the lamp (held at SPOT_CD: the walls near the camera never burn out). The studio has no floor to
   * light: its beam and halo only, and the heads take a share of the lamp (_feedHeads).
   */
  _drawSpot(r) {
    const bot = r.bot;
    const lvl = r.level * r.gain;
    const on = lvl > 0.001 && !!bot && bot.group.visible;
    const studio = this.name === 'studio';
    r.beam.visible = r.halo.visible = on;
    r.pool.visible = on && !studio;
    r.light.intensity = on && !studio ? SPOT_CD * lvl : 0;
    r.lamp = on ? SPOT_CD * lvl : 0;
    if (!on) return;
    const p = bot.group.position;
    r.halo.position.copy(p);
    r.halo.scale.setScalar(bot.unit * 2.4 * 3.4);
    r.halo.material.uniforms.uIntensity.value = 0.55 * lvl;
    const floor = studio ? p.y - 1.1 : floorAt(this.def, p.x, p.z);
    const top = studio ? p.y + 3.2 : Math.min(3.15, p.y + 2.2) + (this.def.lights?.sky ? 1.6 : 0);
    const src = _src.set(p.x + 0.35, top, p.z + 0.5);
    // the cone's narrow top at the lamp, its wide foot on the floor under the bot
    _axis.set(src.x - p.x, src.y - floor, src.z - p.z);
    const h = _axis.length();
    r.beam.position.set((src.x + p.x) / 2, (src.y + floor) / 2, (src.z + p.z) / 2);
    r.beam.quaternion.setFromUnitVectors(_up, _axis.normalize());
    r.beam.scale.set(0.95, h, 0.95);
    // the singers' beams are softer than a lighting cue's; a camera in (or at) a cone would see its walls all over
    // the frame (a white veil): that beam fades out round the camera
    let veil = 1;
    const cam = this.camera?.position;
    if (cam) {
      const ax = p.x - src.x, ay = floor - src.y, az = p.z - src.z;
      const u = Math.min(1, Math.max(0, ((cam.x - src.x) * ax + (cam.y - src.y) * ay + (cam.z - src.z) * az) / (ax * ax + ay * ay + az * az)));
      const d = Math.hypot(cam.x - src.x - ax * u, cam.y - src.y - ay * u, cam.z - src.z - az * u);
      const rad = 0.95 * (0.06 + 0.94 * u);
      veil = THREE.MathUtils.smoothstep(d, rad + 0.3, rad + 1.6);
    }
    // (a beam reads in the dark: in a bright mood it is fainter)
    const L = this.def.lights, day = this.cur && L ? this.cur.hemi / L.hemi.intensity : 0.6;
    const dark = Math.min(1, Math.max(0.35, 1.25 - 0.5 * day));
    r.beam.material.uniforms.uAlpha.value = lvl * (r.accent ? 1 : BEAM_SINGER) * (studio ? 0.55 : dark) * veil;
    r.beam.visible = veil > 0.01;
    r.pool.position.set(p.x, floor + 0.015, p.z);
    r.pool.scale.setScalar(r.accent ? 2.4 : 2.1);
    r.pool.material.uniforms.uAlpha.value = (r.accent ? 0.32 : 0.24) * lvl;
    r.light.position.set(p.x + 0.55, src.y + 1.2, p.z + 1.1);
    r.light.target.position.set(p.x, floor, p.z);
  }

  _updateShadows() {
    const sets = this.name !== 'studio';
    for (const [b, m] of this.shadows) {
      m.visible = sets && b.group.visible;
      if (!m.visible) continue;
      const p = b.group.position;
      const fy = floorAt(this.def, p.x, p.z);
      const h = Math.max(0, p.y - fy);
      const r = b.unit * 2.4;
      m.position.set(p.x, fy + 0.012, p.z);
      m.scale.setScalar(r * 2.3 * (1 + h * 0.12));
      m.material.uniforms.uAlpha.value = 0.3 / (1 + h * 0.6);
    }
  }
}

/** Floor height under (x, z): the street's sidewalks are raised. */
export function floorAt(def, x, z) {
  for (const r of def?.raised ?? []) if (x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) return r[4];
  return def?.floor ?? 0;
}

function cloneRig(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = v?.isColor ? v.clone() : v;
  return o;
}

/** Eases rig a toward b by k; true when anything still changes visibly. */
function lerpRig(a, b, k) {
  let moved = false;
  for (const [key, v] of Object.entries(b)) {
    if (v?.isColor) {
      const c = a[key];
      const d = Math.abs(c.r - v.r) + Math.abs(c.g - v.g) + Math.abs(c.b - v.b);
      if (d > 1e-3) { c.lerp(v, k); moved = true; } else c.copy(v);
    } else if (typeof v === 'number') {
      const d = Math.abs(a[key] - v);
      if (d > 1e-3) { a[key] += (v - a[key]) * k; moved = true; } else a[key] = v;
    }
  }
  return moved;
}
