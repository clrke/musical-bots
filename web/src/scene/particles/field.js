// GPU billboard particles for the whole choir: one InstancedBufferGeometry, one draw call.
// After the author's Pool particle system (instanced quads, CPU simulation, additive
// tints that clip at 1), reworked to be allocation-free: particles live in one Float32Array, each
// emitter (robot head) owns a ring of slots (spawn order kept for Unity-style ribbon trails), and
// ribbons are drawn by the same shader as camera-facing segments between consecutive particles.
import * as THREE from 'three';
import { hexToRgb } from '../appearance.js';
import { makeRng } from '../motion.js';
import { ATLAS_CELLS, ATLAS_GRID } from './atlas.js';
import { PRESET_DEFS, curve, fitScale, gradient } from './presets.js';
import { noiseField, sampleShape } from './shapes.js';

// Particle record (floats).
const P = 18;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, SIZE = 8, ROT = 9, SPIN = 10;
const CR = 11, CG = 12, CB = 13, CA = 14, CELLF = 15, SEED = 16, SEQ = 17;
// Instance record (floats): pos 3, end 3, color 4, params 4 (size|width, rotation, cell, mode), uv 2.
const S = 16;
const MODE_BILLBOARD = 0;
const MODE_STRETCH = 1;
const MODE_TILE = 2;

const vertexShader = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iEnd;
attribute vec4 iColor;
attribute vec4 iParams;
attribute vec2 iUv;
uniform float uGrid;
varying vec2 vSt;
varying vec2 vCell;
varying vec4 vColor;
varying float vTile;
void main() {
  vec2 corner = position.xy;
  vec4 mvA = modelViewMatrix * vec4(iPos, 1.0);
  vec3 p;
  if (iParams.w < 0.5) {
    float c = cos(iParams.y);
    float s = sin(iParams.y);
    p = mvA.xyz + vec3(c * corner.x - s * corner.y, s * corner.x + c * corner.y, 0.0) * iParams.x;
    vSt = uv;
  } else {
    // a ribbon segment from iPos to iEnd, turned to face the eye
    vec3 a = mvA.xyz;
    vec3 b = (modelViewMatrix * vec4(iEnd, 1.0)).xyz;
    vec3 side = cross(b - a, 0.5 * (a + b));
    float l = length(side);
    side = l > 1e-9 ? side / l : vec3(0.0, 1.0, 0.0);
    p = mix(a, b, corner.x + 0.5) + side * (corner.y * iParams.x);
    vSt = vec2(mix(iUv.x, iUv.y, corner.x + 0.5), uv.y);
  }
  vTile = step(1.5, iParams.w);
  vCell = vec2(mod(iParams.z, uGrid), floor(iParams.z / uGrid + 0.001));
  vColor = iColor;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGrid;
varying vec2 vSt;
varying vec2 vCell;
varying vec4 vColor;
varying float vTile;
void main() {
  float u = vTile > 0.5 ? fract(vSt.x) : clamp(vSt.x, 0.0, 1.0);
  const float inset = 1.5 / 256.0;
  vec2 st = mix(vec2(inset), vec2(1.0 - inset), vec2(u, 1.0 - clamp(vSt.y, 0.0, 1.0)));
  vec2 uv = (vCell + st) / uGrid;
  vec2 g = vec2((1.0 - 2.0 * inset) / uGrid);
  float a = textureGrad(uAtlas, uv, dFdx(vSt) * g, dFdy(vSt) * g).r * vColor.a;
  // additive light (rgb), alpha left untouched so passthrough shows through in mixed reality
  gl_FragColor = vec4(vColor.rgb * a, 0.0);
}
`;

const tmpP = [0, 0, 0];
const tmpD = [0, 0, 0];
const tmpN = [0, 0, 0];
const tmpC = [0, 0, 0];
const tmpO = [0, 0, 0];

/**
 * @param {{ maxEmitters?: number, perEmitter?: number, seed?: number }} opts
 * @returns {{ mesh: THREE.Mesh, createEmitter: () => Emitter, update: (dt:number, t:number) => void,
 *   setAtlas: (tex: THREE.Texture) => void, stats: () => {particles:number, segments:number} }}
 */
export function createParticleField({ maxEmitters = 16, perEmitter = 128, seed = 7 } = {}) {
  const capacity = maxEmitters * perEmitter;
  const parts = new Float32Array(capacity * P);
  const maxInstances = capacity * 2;
  const inst = new Float32Array(maxInstances * S);
  const rng = makeRng(seed);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const buffer = new THREE.InstancedInterleavedBuffer(inst, S, 1);
  buffer.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 4, 6));
  geometry.setAttribute('iParams', new THREE.InterleavedBufferAttribute(buffer, 4, 10));
  geometry.setAttribute('iUv', new THREE.InterleavedBufferAttribute(buffer, 2, 14));
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    name: 'magna-particles',
    vertexShader,
    fragmentShader,
    uniforms: { uAtlas: { value: null }, uGrid: { value: ATLAS_GRID } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'magna-particles';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false; // until the atlas is in

  const emitters = [];
  let time = 0;
  const counts = { particles: 0, segments: 0 };
  const range = { start: 0, count: 0 };

  function setAtlas(texture) {
    material.uniforms.uAtlas.value = texture;
  }

  function createEmitter() {
    const index = emitters.length;
    if (index >= maxEmitters) throw new Error(`particle field: more than ${maxEmitters} emitters`);
    const base = index * perEmitter;
    const e = {
      index,
      base,
      head: 0,
      seq: 0,
      alive: 0,
      acc: 0,
      level: 0,
      x: 0,
      y: 0,
      z: 0,
      fx: 0,
      fz: 1,
      cfg: null,
      /** Settings: { preset, color, rate, size, speed } (normalised Particles) and the head radius (m). */
      configure(settings, headRadius) {
        e.cfg = buildConfig(settings, headRadius);
      },
      /** Emitter position in the field's parent space. */
      setPosition(x, y, z) {
        e.x = x;
        e.y = y;
        e.z = z;
      },
      /** Horizontal facing of the head (unit x, z in field space), for offsets behind the face. */
      setFacing(x, z) {
        e.fx = x;
        e.fz = z;
      },
      /** 0..1: emission follows the singing level (0 = no new particles). */
      setLevel(level) {
        e.level = level > 0 ? Math.min(1, level) : 0;
      },
      /** Removes every live particle of this emitter. */
      clear() {
        for (let i = 0; i < perEmitter; i++) parts[(base + i) * P + LIFE] = 0;
        e.alive = 0;
      },
    };
    for (let i = 0; i < perEmitter; i++) parts[(base + i) * P + LIFE] = 0;
    emitters.push(e);
    return e;
  }

  function buildConfig(settings, headRadius) {
    const def = PRESET_DEFS[settings?.preset];
    if (!def) return null;
    const k = fitScale(def, headRadius);
    const speedMul = settings.speed ?? 1;
    const sizeMul = settings.size ?? 1;
    const override = settings.color ? hexToRgb(settings.color, [0, 0, 0]) : null;
    const tint = def.tint ?? [1, 1, 1];
    const colors = (def.palette ?? def.colors).map((c) =>
      override
        ? [override[0], override[1], override[2], c[3] ?? 1]
        : [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], c[3] ?? 1],
    );
    let lum0 = 1;
    if (def.colorOverLife) {
      const g0 = gradient(def.colorOverLife, 0, [0, 0, 0]);
      lum0 = Math.max(0.05, 0.3 * g0[0] + 0.59 * g0[1] + 0.11 * g0[2]);
    }
    const trail = def.trail
      ? {
          ...def.trail,
          rgb: override
            ? override.slice()
            : [def.trail.color[0] * def.trail.tint[0], def.trail.color[1] * def.trail.tint[1], def.trail.color[2] * def.trail.tint[2]],
          tintRgb: override ? [1, 1, 1] : def.trail.tint,
          cell: ATLAS_CELLS[def.trail.texture],
          mode: def.trail.mode === 'tile' ? MODE_TILE : MODE_STRETCH,
        }
      : null;
    // Placement on a robot. The debuff effects were made to wrap a creature's body; a robot head is
    // opaque and has its lyrics panel right under it, so their volume shapes start at the head's
    // surface and every shape opens upward (Burn's flames rise off the crown). All other module
    // values (rates, lifetimes, speeds, sizes, curves, colours, noise, ribbons) stay as ported.
    let shape = def.shape;
    let radius = shape.radius * (shape.headRelative ? headRadius : k.space);
    let anchorY = (def.anchorY ?? 0) * headRadius;
    let anchorBack = 0;
    if (def.reach) {
      if (shape.type === 'cone') {
        radius = Math.max(radius, 0.55 * headRadius);
        anchorY = 0.5 * headRadius;
        anchorBack = 0.3 * headRadius; // off the crown, a little behind the face screen
        shape = { ...shape, dir: 1 };
      } else {
        radius = headRadius;
        shape = { ...shape, dir: 1, thickness: 0.3 };
      }
    }
    return {
      def,
      local: def.space === 'local',
      rate: def.rate * (settings.rate ?? 1),
      cap: Math.min(perEmitter, Math.round(def.max * Math.max(1, settings.rate ?? 1))),
      life: def.life,
      speed: [def.speed[0] * k.space * speedMul, def.speed[1] * k.space * speedMul],
      size: [def.size[0] * k.size * sizeMul, def.size[1] * k.size * sizeMul],
      radius,
      shape,
      anchorY,
      anchorBack,
      gravity: (def.gravity ?? 0) * 9.81 * k.space,
      noise: def.noise
        ? { strength: def.noise.strength * k.space * speedMul, freq: def.noise.frequency / k.space, scroll: def.noise.scroll }
        : null,
      colors,
      palette: !!def.palette,
      override: !!override,
      lum0,
      cell: ATLAS_CELLS[def.texture],
      frames: def.frames ?? 1,
      rotation: def.rotation !== false,
      spin: def.spin ? [(def.spin[0] * Math.PI) / 180, (def.spin[1] * Math.PI) / 180] : null,
      streak: def.streak ?? 0,
      trail,
    };
  }

  function spawn(e, c) {
    // Ring slot in spawn order; when it is still alive (random lifetimes) probe for a free one.
    let slot = -1;
    for (let i = 0; i < perEmitter; i++) {
      const s = (e.head + i) % perEmitter;
      if (parts[(e.base + s) * P + LIFE] <= 0) {
        slot = s;
        break;
      }
    }
    if (slot < 0) return;
    e.head = (slot + 1) % perEmitter;
    const o = (e.base + slot) * P;
    sampleShape(rng, c.shape, c.radius, tmpP, tmpD);
    const speed = c.speed[0] + rng() * (c.speed[1] - c.speed[0]);
    const lx = tmpP[0] - e.fx * c.anchorBack;
    const ly = tmpP[1] + c.anchorY;
    const lz = tmpP[2] - e.fz * c.anchorBack;
    parts[o + PX] = c.local ? lx : e.x + lx;
    parts[o + PY] = c.local ? ly : e.y + ly;
    parts[o + PZ] = c.local ? lz : e.z + lz;
    parts[o + VX] = tmpD[0] * speed;
    parts[o + VY] = tmpD[1] * speed;
    parts[o + VZ] = tmpD[2] * speed;
    parts[o + AGE] = 0;
    parts[o + LIFE] = c.life[0] + rng() * (c.life[1] - c.life[0]);
    parts[o + SIZE] = c.size[0] + rng() * (c.size[1] - c.size[0]);
    parts[o + ROT] = c.rotation ? rng() * Math.PI * 2 : 0;
    parts[o + SPIN] = c.spin ? c.spin[0] + rng() * (c.spin[1] - c.spin[0]) : 0;
    let col;
    if (c.palette) col = c.colors[Math.floor(rng() * c.colors.length) % c.colors.length];
    else if (c.colors.length > 1) {
      // Unity "random between two colours"
      const a = c.colors[0];
      const b = c.colors[1];
      const f = rng();
      tmpC[0] = a[0] + (b[0] - a[0]) * f;
      tmpC[1] = a[1] + (b[1] - a[1]) * f;
      tmpC[2] = a[2] + (b[2] - a[2]) * f;
      parts[o + CR] = tmpC[0];
      parts[o + CG] = tmpC[1];
      parts[o + CB] = tmpC[2];
      parts[o + CA] = a[3] + (b[3] - a[3]) * f;
    } else col = c.colors[0];
    if (col) {
      parts[o + CR] = col[0];
      parts[o + CG] = col[1];
      parts[o + CB] = col[2];
      parts[o + CA] = col[3];
    }
    parts[o + CELLF] = c.cell + (c.frames > 1 ? Math.min(c.frames - 1, Math.floor(rng() * c.frames)) : 0);
    parts[o + SEED] = rng() * 100;
    parts[o + SEQ] = e.seq++;
    e.alive++;
  }

  // ---------------------------------------------------------------- per frame

  function update(dt, t = time + dt) {
    time = t;
    dt = Math.min(dt, 0.1);
    let n = 0; // instances written
    let nParticles = 0;
    let nSegments = 0;
    for (const e of emitters) {
      const c = e.cfg;
      // spawn
      if (c && e.level > 0 && c.rate > 0) {
        e.acc += c.rate * e.level * dt;
        let guard = 64;
        while (e.acc >= 1 && guard-- > 0) {
          e.acc -= 1;
          if (e.alive < c.cap) spawn(e, c);
        }
        if (guard <= 0) e.acc = 0;
      } else {
        e.acc = 0;
      }
      // simulate + write billboards
      let alive = 0;
      for (let i = 0; i < perEmitter; i++) {
        const o = (e.base + i) * P;
        const life = parts[o + LIFE];
        if (life <= 0) continue;
        const age = parts[o + AGE] + dt;
        if (age >= life || !c) {
          parts[o + LIFE] = 0;
          continue;
        }
        parts[o + AGE] = age;
        alive++;
        if (c.gravity) parts[o + VY] -= c.gravity * dt;
        let x = parts[o + PX] + parts[o + VX] * dt;
        let y = parts[o + PY] + parts[o + VY] * dt;
        let z = parts[o + PZ] + parts[o + VZ] * dt;
        if (c.noise) {
          const f = c.noise.freq;
          noiseField(x * f + parts[o + SEED], y * f, z * f, t * c.noise.scroll + parts[o + SEED], tmpN);
          x += tmpN[0] * c.noise.strength * dt;
          y += tmpN[1] * c.noise.strength * dt;
          z += tmpN[2] * c.noise.strength * dt;
        }
        parts[o + PX] = x;
        parts[o + PY] = y;
        parts[o + PZ] = z;
        parts[o + ROT] += parts[o + SPIN] * dt;
        const u = age / life;
        let alpha = parts[o + CA] * curve(c.def.alphaOverLife, u);
        let size = parts[o + SIZE] * curve(c.def.sizeOverLife, u);
        if (c.def.pulse) {
          const seed = parts[o + SEED];
          const pulse = 0.6 + 0.4 * Math.sin(t * (1.6 + (seed % 1.3)) + seed);
          alpha *= pulse;
          size *= 0.85 + 0.3 * pulse;
        }
        if (alpha <= 0.002 || n >= maxInstances) continue;
        writeColor(c, o, u, tmpO);
        const w = n * S;
        if (c.streak) {
          // a streak: the cell stretched from the tail (pos - v * streak seconds) to the head
          const bx = c.local ? e.x : 0;
          const by = c.local ? e.y : 0;
          const bz = c.local ? e.z : 0;
          inst[w] = bx + x - parts[o + VX] * c.streak;
          inst[w + 1] = by + y - parts[o + VY] * c.streak;
          inst[w + 2] = bz + z - parts[o + VZ] * c.streak;
          inst[w + 3] = bx + x;
          inst[w + 4] = by + y;
          inst[w + 5] = bz + z;
          inst[w + 6] = tmpO[0];
          inst[w + 7] = tmpO[1];
          inst[w + 8] = tmpO[2];
          inst[w + 9] = alpha;
          inst[w + 10] = size;
          inst[w + 11] = 0;
          inst[w + 12] = parts[o + CELLF];
          inst[w + 13] = MODE_STRETCH;
          inst[w + 14] = 0;
          inst[w + 15] = 1;
        } else {
          inst[w] = c.local ? e.x + x : x;
          inst[w + 1] = c.local ? e.y + y : y;
          inst[w + 2] = c.local ? e.z + z : z;
          inst[w + 6] = tmpO[0];
          inst[w + 7] = tmpO[1];
          inst[w + 8] = tmpO[2];
          inst[w + 9] = alpha;
          inst[w + 10] = size;
          inst[w + 11] = parts[o + ROT];
          inst[w + 12] = parts[o + CELLF];
          inst[w + 13] = MODE_BILLBOARD;
          inst[w + 14] = 0;
          inst[w + 15] = 1;
        }
        n++;
        nParticles++;
      }
      e.alive = alive;
      if (c && c.trail && alive > 1) {
        const before = n;
        n = writeRibbons(e, c, n);
        nSegments += n - before;
      }
    }
    geometry.instanceCount = n;
    if (n > 0) {
      // upload only the used part (a reused range object: no per-frame garbage)
      buffer.updateRanges.length = 0;
      range.count = n * S;
      buffer.updateRanges.push(range);
      buffer.needsUpdate = true;
    }
    mesh.visible = !!material.uniforms.uAtlas.value && n > 0;
    counts.particles = nParticles;
    counts.segments = nSegments;
  }

  function writeColor(c, o, u, out) {
    let r = parts[o + CR];
    let g = parts[o + CG];
    let b = parts[o + CB];
    if (c.def.colorOverLife) {
      gradient(c.def.colorOverLife, u, tmpC);
      if (c.override) {
        const l = (0.3 * tmpC[0] + 0.59 * tmpC[1] + 0.11 * tmpC[2]) / c.lum0;
        r *= l;
        g *= l;
        b *= l;
      } else {
        r *= tmpC[0];
        g *= tmpC[1];
        b *= tmpC[2];
      }
    }
    // the game's non-HDR clip: a tint above 1 saturates toward white-hot in dense overlaps
    out[0] = r > 1 ? 1 : r;
    out[1] = g > 1 ? 1 : g;
    out[2] = b > 1 ? 1 : b;
    return out;
  }

  // Unity Ribbon trails: each ribbon threads its particles (every `ribbons`-th by spawn order) in age
  // order; width = particle size x widthOverTrail, alpha = trail colour over the particle's life x
  // colour over the trail (1 at the newest end, 0 at the oldest).
  const ribbonCount = [0, 0, 0, 0];
  const ribbonIndex = [0, 0, 0, 0];
  const ribbonPrev = [-1, -1, -1, -1];
  function writeRibbons(e, c, n) {
    const tr = c.trail;
    const ribbons = Math.min(4, tr.ribbons);
    for (let r = 0; r < ribbons; r++) {
      ribbonCount[r] = 0;
      ribbonIndex[r] = 0;
      ribbonPrev[r] = -1;
    }
    // oldest -> newest: walk the ring starting at the next spawn slot
    for (let i = 0; i < perEmitter; i++) {
      const o = (e.base + ((e.head + i) % perEmitter)) * P;
      if (parts[o + LIFE] > 0) ribbonCount[parts[o + SEQ] % ribbons]++;
    }
    for (let i = 0; i < perEmitter; i++) {
      const o = (e.base + ((e.head + i) % perEmitter)) * P;
      if (parts[o + LIFE] <= 0) continue;
      const r = parts[o + SEQ] % ribbons;
      const prev = ribbonPrev[r];
      ribbonPrev[r] = o;
      const k = ribbonIndex[r]++;
      if (prev < 0 || n >= maxInstances) continue;
      const count = ribbonCount[r];
      const uA = parts[prev + AGE] / parts[prev + LIFE];
      const uB = parts[o + AGE] / parts[o + LIFE];
      const width = 0.5 * (parts[prev + SIZE] * curve(c.def.sizeOverLife, uA) + parts[o + SIZE] * curve(c.def.sizeOverLife, uB)) * tr.width;
      // position along the trail: 0 = newest end, 1 = oldest end
      const along = 1 - (k - 0.5) / Math.max(1, count - 1);
      const alpha = 0.5 * (curve(tr.alphaOverLife, uA) + curve(tr.alphaOverLife, uB)) * curve(tr.alphaOverTrail, along) * (tr.color[3] ?? 1);
      if (alpha <= 0.002) continue;
      let r0;
      let g0;
      let b0;
      if (tr.inherit) {
        writeColor(c, o, uB, tmpO);
        r0 = tmpO[0] * tr.tintRgb[0];
        g0 = tmpO[1] * tr.tintRgb[1];
        b0 = tmpO[2] * tr.tintRgb[2];
      } else {
        r0 = tr.rgb[0];
        g0 = tr.rgb[1];
        b0 = tr.rgb[2];
      }
      const w = n * S;
      const lp = c.local;
      inst[w] = lp ? e.x + parts[prev + PX] : parts[prev + PX];
      inst[w + 1] = lp ? e.y + parts[prev + PY] : parts[prev + PY];
      inst[w + 2] = lp ? e.z + parts[prev + PZ] : parts[prev + PZ];
      inst[w + 3] = lp ? e.x + parts[o + PX] : parts[o + PX];
      inst[w + 4] = lp ? e.y + parts[o + PY] : parts[o + PY];
      inst[w + 5] = lp ? e.z + parts[o + PZ] : parts[o + PZ];
      inst[w + 6] = r0 > 1 ? 1 : r0;
      inst[w + 7] = g0 > 1 ? 1 : g0;
      inst[w + 8] = b0 > 1 ? 1 : b0;
      inst[w + 9] = alpha;
      inst[w + 10] = width;
      inst[w + 11] = 0;
      inst[w + 12] = tr.cell;
      inst[w + 13] = tr.mode;
      if (tr.mode === MODE_TILE) {
        inst[w + 14] = 0;
        inst[w + 15] = 1;
      } else {
        inst[w + 14] = (k - 1) / Math.max(1, count - 1);
        inst[w + 15] = k / Math.max(1, count - 1);
      }
      n++;
    }
    return n;
  }

  return {
    mesh,
    createEmitter,
    update,
    setAtlas,
    stats: () => counts,
    get capacity() {
      return capacity;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
