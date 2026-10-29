// The sets on screen: loads the Blender sets, switches between them and the studio, and lights
// them. Per set: a hemisphere fill and a key light (from the heads' own key direction), the set's
// practical lamps at their exported candela (scripts/blender: RAW lights, no scale hack), the
// exposure, the "daylight" materials (windows, sky) and a reflection environment built from the
// set's colours with the studio's softboxes, so the chrome heads reflect the room they are in and
// still get their crisp highlights. Moods (the lighting agent's lights-<mood>) fade over ~1 s;
// spot-<Bot> follows a bot with a beam and a pool of light. Floating heads get soft blob shadows.
// Deterministic: everything animates from the dt it is given.
import * as THREE from 'three';
import { loadEnvironment } from './index.js';
import { SETS, MOODS } from './sets.js';
import { SHARED_UNIFORMS } from '../head-material.js';
import { ENV_SIZE } from '../studio-env.js';

const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to the linear working space
const FADE = 1.0; // seconds a mood takes
const SPOT_IN = 0.5, SPOT_OUT = 0.7;
const _src = new THREE.Vector3(), _axis = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ reflection environment rig

const roomVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// the studio's gradient room (studio-env.js), with the set's floor / wall / ceiling colours
const roomFragment = /* glsl */ `
uniform vec3 uFloor, uWall, uCeil, uGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = y < 0.0 ? mix(uWall * 0.55, uFloor, smoothstep(0.0, 0.35, -y)) : mix(uWall, uCeil, smoothstep(0.05, 0.85, y));
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
    uCeil: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() } };
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
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
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

function createSky() {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uMoon: { value: lin('#fff6e0') }, uStars: { value: 1 }, uMoonOn: { value: 1 },
  };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: roomVertex, fragmentShader: skyFragment, uniforms, side: THREE.BackSide, depthWrite: false }));
  mesh.renderOrder = -1;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

// ------------------------------------------------------------------ spot beam, pool, blob shadows

const beamVertex = /* glsl */ `
varying float vV;
varying vec3 vN, vView;
void main() {
  vV = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vV;
varying vec3 vN, vView;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
  float a = uAlpha * edge * (0.2 + 0.8 * vV) * 0.45;
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
   * studio environment ({ texture }), backdrop: the studio panorama mesh, bots: Map name -> Bot.
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
    // the follow spot
    this.spotTarget = null;
    this.spotLevel = 0;
    this.spotLight = new THREE.SpotLight(0xfff1d8, 0, 0, 0.36, 0.6, 2);
    scene.add(this.spotLight, this.spotLight.target);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1, 1, 40, 1, true),
      new THREE.ShaderMaterial({ vertexShader: beamVertex, fragmentShader: beamFragment, side: THREE.DoubleSide, ...additive,
        uniforms: { uColor: { value: lin('#fff0d0') }, uAlpha: { value: 0 } } }));
    this.beam.visible = false;
    this.beam.renderOrder = 5;
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: discVertex, fragmentShader: discFragment, ...additive,
        uniforms: { uColor: { value: lin('#ffe6bf') }, uAlpha: { value: 0 }, uDark: { value: 0 } } }));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.visible = false;
    scene.add(this.beam, this.pool);
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

  /** Loads set `name` once (hidden), resolves its group or null when it cannot load. */
  load(name) {
    if (this.sets.has(name)) return Promise.resolve(this.sets.get(name).group);
    if (!this.loading.has(name)) {
      this.loading.set(name, loadEnvironment(name).then(({ group }) => {
        this.adopt(name, group);
        return group;
      }).catch((err) => {
        console.warn(`[stage] set ${name}:`, err.message);
        return null;
      }));
    }
    return this.loading.get(name);
  }

  /** Takes a loaded set group: hidden, its lamps and daylight materials noted for the moods. */
  adopt(name, group) {
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
          if (dayNames.has(m.name)) daylight.push({ mat: m, base: m.emissiveIntensity, color: m.color.clone() });
        }
      }
    });
    group.visible = false;
    group.name = `set-${name}`;
    this.scene.add(group);
    this.sets.set(name, { group, practicals, daylight });
  }

  /** Compiles every loaded set's materials now (no hitch at the first cut). */
  warm() {
    if (!this.renderer || !this.camera) return;
    const shown = [...this.sets.values()].map((s) => [s.group, s.group.visible]);
    for (const [g] of shown) g.visible = true;
    try { this.renderer.compile(this.scene, this.camera); } catch { /* best effort */ }
    for (const [g, v] of shown) g.visible = v;
    // and the first set's environment, so the opening frame is right
    this.envDirty = true;
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
      return;
    }
    this.scene.background = new THREE.Color(this.def.lights?.sky ? 0x070b1e : 0x15110f);
    this.moodName = this.def.lights?.mood ?? 'warm';
    this.goal = this._rigFor(this.moodName);
    this.cur = cloneRig(this.goal);
    this.envDirty = true;
    this._apply();
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

  /** spot-<Bot>: a follow spot on bot (null: off). */
  spot(bot, { now = false } = {}) {
    this.spotTarget = bot ?? null;
    if (now) this.spotLevel = bot ? 1 : 0;
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    this.time += dt;
    if (this.name !== 'studio' && this.cur && this.goal) {
      const k = 1 - Math.exp(-dt * (4.6 / FADE)); // ~99% of the way in FADE seconds
      const moved = lerpRig(this.cur, this.goal, k);
      if (moved) this.envDirty = true;
    }
    // the spot fades in on its bot, out when released
    const want = this.spotTarget && this.spotTarget.group.visible ? 1 : 0;
    const prev = this.spotLevel;
    this.spotLevel = want ? Math.min(1, this.spotLevel + dt / SPOT_IN) : Math.max(0, this.spotLevel - dt / SPOT_OUT);
    if (this.spotLevel !== prev && this.name !== 'studio') this.envDirty = true;
    if (this.spotLevel > 0 && this.spotTarget) this._lastSpot = this.spotTarget;
    if (this.name !== 'studio') this._apply();
    this._updateSpot();
    this._updateShadows();
    if (this.envDirty && this.name !== 'studio') this._buildEnv();
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
    };
  }

  _apply() {
    const c = this.cur;
    if (!c) return;
    const set = this.sets.get(this.name);
    const dim = 1 - 0.42 * this.spotLevel; // the room dims under a spot
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemi * dim;
    this.key.color.copy(c.keyColor);
    this.key.intensity = c.key * dim;
    const L = this.def.lights ?? SETS.diner.lights;
    const d = L.key.dir;
    this.key.position.set(d[0] * 10, d[1] * 10 + 1, d[2] * 10 - 1);
    for (const p of set?.practicals ?? []) p.light.intensity = p.base * c.practical * (1 - 0.2 * this.spotLevel);
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
      this.scene.background.copy(c.zenith);
    }
  }

  /** Rebuilds the set's reflection environment (when the set or the mood changes). */
  _buildEnv() {
    this.envDirty = false;
    if (!this.renderer || !this.cur) return;
    const L = this.def.lights ?? SETS.diner.lights;
    const E = L.env;
    const c = this.cur;
    const g = c.env * (1 - 0.35 * this.spotLevel);
    const u = this.rig.uniforms;
    const t = c.envTint;
    if (this.sky.mesh.visible) {
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
      if (!b.key) col.multiply(t);
      col.multiplyScalar(b.key ? (E.key ?? 1) * Math.max(0.55, g) : g);
      if (c.party > 0.01 && b.rim) col.lerp(lin(b.rim > 0 ? '#ff3fa4' : '#38d6ff').multiplyScalar(5), c.party);
    }
    this.cubeCam.update(this.renderer, this.rig.scene);
    if (!this.envRT) this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    else this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.scene.environment = this.envRT.texture;
    SHARED_UNIFORMS.uEnvMap.value = this.envRT.texture;
  }

  _updateSpot() {
    const lvl = this.spotLevel;
    const bot = this.spotTarget ?? this._lastSpot;
    const on = lvl > 0.001 && bot;
    this.beam.visible = !!on;
    this.pool.visible = !!on && this.name !== 'studio';
    this.spotLight.intensity = on && this.name !== 'studio' ? 75 * lvl : 0;
    if (!on) return;
    const p = bot.group.position;
    const floor = this.name === 'studio' ? p.y - 1.1 : floorAt(this.def, p.x, p.z);
    const top = this.name === 'studio' ? p.y + 3.2 : Math.min(3.15, p.y + 2.2) + (this.def.lights?.sky ? 1.6 : 0);
    const src = _src.set(p.x + 0.35, top, p.z + 0.5);
    // the cone's narrow top at the lamp, its wide foot on the floor under the bot
    _axis.set(src.x - p.x, src.y - floor, src.z - p.z);
    const h = _axis.length();
    this.beam.position.set((src.x + p.x) / 2, (src.y + floor) / 2, (src.z + p.z) / 2);
    this.beam.quaternion.setFromUnitVectors(_up, _axis.normalize());
    this.beam.scale.set(0.95, h, 0.95);
    this.beam.material.uniforms.uAlpha.value = lvl * (this.name === 'studio' ? 0.7 : 1);
    this.pool.position.set(p.x, floor + 0.015, p.z);
    this.pool.scale.setScalar(2.4);
    this.pool.material.uniforms.uAlpha.value = 0.32 * lvl;
    this.spotLight.position.set(p.x + 0.55, src.y + 1.2, p.z + 1.1);
    this.spotLight.target.position.set(p.x, floor, p.z);
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
