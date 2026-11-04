// Surface detail for the sets. The .glb sets carry flat-colour materials (no textures, and most meshes have no UVs, so
// image normal maps cannot be applied), so the detail is procedural and anchored in world space, three scales of noise:
// a fine grain (2.5-3.5 cm, and a finer octave) that tints the albedo, varies the roughness and tilts the normal (a
// bump: no UVs or tangents needed), a mid grain (~10 cm: clumps of grass and sand, a path's stones) and a slow mottle.
// Sized in metres, as the real thing, and scaled to the surface: a wide one (a wall, a floor, the ground: DETAIL.wide)
// has a finer grain and a broader mottle, and its walls and ceiling keep half the fine grain and none of the mid one (a
// wall across the room is never blotchy) while its floor keeps all of it (the ground is seen up close, at the bots'
// feet). Each octave fades out where its features would be smaller than a few pixels (far away, at a grazing angle: no
// shimmer while the camera moves). By finish: a matte surface (stone, plaster, wood, sand, grass) gets all of it, a
// glossy one (painted plastic, vinyl, tile) a faint tint and no bump, metal only its roughness varied, water only
// ripples; lamps, daylight panes and glass are left alone.
// Cheap on a phone: each octave is one bilinear fetch (four a pixel) from a 256x256 noise texture made here (no
// download; value noise in 3D from a 2D texture whose green is its red's next z layer, iq's trick) and ~40 ALU ops, the
// bump a few dozen more (the first version's twelve hashed value noises cost about 3x as much: QA Nov 5, M4 Max, 14.7 MP).
import * as THREE from 'three';

/**
 * Frequencies (1/m) on a prop and on a wide surface (`wide` m across: from the first, all of it at the second): the fine
 * grain (its finer octave at 2.3x, the mid grain at MID x), and the mottle. Amplitudes, matte and glossy: albedo (the share
 * it brightens or darkens, x the noise's spread), the bump as a typical slope of the surface (0.1: ~6 degrees), and the
 * roughness (all finishes). wall: what a wide surface's walls and ceiling keep of the fine grain (of the mid grain: none).
 * Water (WATER, by name: the sea, a pool, a well) gets ripples only: a bump at its own, broader frequency, no tint.
 */
export const DETAIL = Object.freeze({
  grain: [28, 40], mottle: [0.8, 0.5], wide: [1.5, 5], wall: 0.5,
  matte: { grain: 0.09, mid: 0.08, mottle: 0.09, bump: 0.12, midBump: 0.1 },
  gloss: { grain: 0.02, mid: 0.02, mottle: 0.04, bump: 0, midBump: 0 },
  rough: { grain: 0.05, mid: 0.04, mottle: 0.08 },
  water: { grain: 7, bump: 0.08, midBump: 0.06 },
});
export const MID = 0.27;
const WATER = /water|^sea/i;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/**
 * The detail's uniforms for material `m` on meshes `size` m across (the geometric mean of a bounding box's two longest
 * sides; the largest of its meshes). grain: [freq, albedo, roughness, bump height m]; mid: [albedo, roughness, bump
 * height m, what a wall keeps of it]; mottle: [freq, albedo, roughness, what a wall keeps of the fine grain]. Pure.
 */
export function detailParams(m, size = 1, strength = 1) {
  if (WATER.test(m.name ?? '')) {
    const { grain: f, bump, midBump } = DETAIL.water;
    return { grain: [f, 0, 0, strength * bump / (0.6 * f)], mid: [0, 0, strength * midBump / (0.4 * MID * f), 1], mottle: [0.5, 0, 0, 1] };
  }
  const metal = smooth(0.3, 0.7, m.metalness ?? 0);
  const matte = smooth(0.5, 0.9, m.roughness ?? 1);
  const wide = smooth(DETAIL.wide[0], DETAIL.wide[1], size);
  const f = mix(DETAIL.grain[0], DETAIL.grain[1], wide);
  const paint = strength * (1 - metal); // (metal: no tint, no bump)
  const amp = (k) => paint * mix(DETAIL.gloss[k], DETAIL.matte[k], matte);
  // (a height whose typical slope is s: two octaves f and 2.3 f, the second at half height, slope ~0.6 f a metre of
  // height; the mid octave alone ~0.4 x its frequency)
  return {
    grain: [f, amp('grain'), strength * DETAIL.rough.grain, amp('bump') / (0.6 * f)],
    mid: [amp('mid'), strength * DETAIL.rough.mid, amp('midBump') / (0.4 * MID * f), 1 - wide],
    mottle: [mix(DETAIL.mottle[0], DETAIL.mottle[1], wide), amp('mottle'), strength * DETAIL.rough.mottle, mix(1, DETAIL.wall, wide)],
  };
}

let noise = null;
/**
 * The noise texture (made once, seeded: every load and every capture the same): 256x256 RG8, red a random lattice, green
 * the same lattice shifted (37, 17): the next z layer of the 3D noise (mbNoise).
 */
export function noiseTexture() {
  if (noise) return noise;
  const N = 256, lattice = new Uint8Array(N * N), data = new Uint8Array(N * N * 2);
  let s = 0x2f6b34;
  for (let i = 0; i < N * N; i++) { // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    lattice[i] = ((t ^ (t >>> 14)) >>> 0) >>> 24;
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      data[2 * (y * N + x)] = lattice[y * N + x];
      data[2 * (y * N + x) + 1] = lattice[((y + 17) % N) * N + ((x + 37) % N)];
    }
  }
  noise = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = noise.minFilter = THREE.LinearFilter;
  noise.generateMipmaps = false;
  noise.needsUpdate = true;
  return noise;
}

const NOISE = /* glsl */ `
uniform sampler2D uMbNoise;
uniform vec4 uMbGrain, uMbMid, uMbMottle;
varying vec3 vMbPos;
// smooth 3D value noise, 0..1: the lattice cell's two z layers in one bilinear fetch (texture: noiseTexture)
float mbNoise(vec3 x) {
  x = mod(x, 256.0);
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = mod(i.xy + vec2(37.0, 17.0) * i.z, 256.0) + f.xy;
  vec2 rg = textureLod(uMbNoise, (uv + 0.5) / 256.0, 0.0).rg;
  return mix(rg.r, rg.g, f.z);
}
// an octave of frequency f (1/m) centred on 0, faded out as its features shrink under ~3 px (fw: metres a pixel)
float mbOctave(vec3 p, float f, float fw) { return (mbNoise(p * f) - 0.5) * (1.0 - smoothstep(0.18, 0.45, f * fw)); }
`;

/** Whether a material gets the detail: an opaque, unlit-by-itself standard material (not a lamp, a pane or glass). */
export function wantsDetail(m) {
  return !!m?.isMeshStandardMaterial && !m.transparent && m.opacity >= 1 && !m.map && !m.normalMap && !m.bumpMap
    && (!m.emissive || m.emissive.r + m.emissive.g + m.emissive.b <= 0.01) && !(m.transmission > 0) && !(m.userData?.mbDetail);
}

/**
 * Adds the detail to `mat` (once), for meshes `size` m across (detailParams); strength 0..1 scales all of it.
 * The program is the same for every material that has it (the shader differs only in uniforms), so the cache key is shared.
 */
export function addDetail(mat, { size = 1, strength = 1 } = {}) {
  if (!wantsDetail(mat)) return false;
  const p = detailParams(mat, size, strength);
  mat.userData.mbDetail = p;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uMbNoise = { value: noiseTexture() };
    shader.uniforms.uMbGrain = { value: new THREE.Vector4(...p.grain) };
    shader.uniforms.uMbMid = { value: new THREE.Vector4(...p.mid) };
    shader.uniforms.uMbMottle = { value: new THREE.Vector4(...p.mottle) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMbPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 mbP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      mbP = instanceMatrix * mbP;
      #endif
      vMbPos = (modelMatrix * mbP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      // the three scales (mbUp: 1 on a floor, 0 on a wall or a ceiling: what a wide surface keeps of the grains)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 mbDx = dFdx(vMbPos), mbDy = dFdy(vMbPos), mbC = cross(mbDx, mbDy);
      float mbFw = max(length(mbDx), length(mbDy));
      float mbUp = max(mbC.y, 0.0) / max(length(mbC), 1e-20);
      float mbFine = mix(uMbMottle.w, 1.0, mbUp) * (mbOctave(vMbPos, uMbGrain.x, mbFw)
        + 0.5 * mbOctave(vMbPos.zxy + 7.31, 2.3 * uMbGrain.x, mbFw));
      float mbMid = mix(uMbMid.w, 1.0, mbUp) * mbOctave(vMbPos.yzx + 1.93, ${MID} * uMbGrain.x, mbFw);
      float mbMottle = mbOctave(vMbPos + 3.17, uMbMottle.x, mbFw);
      diffuseColor.rgb *= 1.0 + 2.0 * (uMbGrain.y * mbFine + uMbMid.x * mbMid + uMbMottle.y * mbMottle);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + 2.0 * (uMbGrain.z * mbFine + uMbMid.y * mbMid + uMbMottle.z * mbMottle), 0.04, 1.0);`)
      // the bump: the grains as a height (m; the mid one only on the floor: clumps, not a hammered board); its screen
      // derivatives tilt the normal by the height's world gradient
      // (three's perturbNormalArb, unnormalised: the same tilt at any distance; at most ~19 degrees)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uMbGrain.w + uMbMid.z > 0.0) {
        float mbH = uMbGrain.w * mbFine + uMbMid.z * mbMid * mbUp;
        vec3 mbSX = dFdx(-vViewPosition), mbSY = dFdy(-vViewPosition);
        vec3 mbR1 = cross(mbSY, normal), mbR2 = cross(normal, mbSX);
        float mbDet = dot(mbSX, mbR1);
        vec3 mbGrad = sign(mbDet) * (dFdx(mbH) * mbR1 + dFdy(mbH) * mbR2) / max(abs(mbDet), 1e-12);
        normal = normalize(normal - mbGrad * min(1.0, 0.35 / max(length(mbGrad), 1e-6)));
      }`);
  };
  mat.customProgramCacheKey = () => 'mb-detail';
  mat.needsUpdate = true;
  return true;
}

const _box = new THREE.Box3(), _size = new THREE.Vector3();

/** Adds the detail to every opaque material of a set's group (each sized by its largest mesh). Returns how many got it. */
export function detailSet(group, opts) {
  group.updateMatrixWorld(true);
  const sizes = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const [, b, c] = _box.setFromObject(o).getSize(_size).toArray().sort((x, y) => x - y);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) sizes.set(m, Math.max(sizes.get(m) ?? 0, Math.sqrt(b * c)));
  });
  let n = 0;
  for (const [m, size] of sizes) if (addDetail(m, { ...opts, size })) n++;
  return n;
}
