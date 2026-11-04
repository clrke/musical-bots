// Surface detail for the sets. The .glb sets carry flat-colour materials (no textures, and most meshes have no UVs, so
// image normal maps cannot be applied), so the detail is procedural and anchored in world space: a bump from a 3D noise
// field (a normal perturbation, no UVs or tangents needed), a gentle albedo mottling and a roughness variation. Applied
// to a set's opaque standard materials when it is adopted (stage.js); lamps, daylight panes and glass are left alone.
import * as THREE from 'three';

const NOISE = /* glsl */ `
float mbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mbNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mbHash(i), mbHash(i + vec3(1,0,0)), f.x), mix(mbHash(i + vec3(0,1,0)), mbHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mbHash(i + vec3(0,0,1)), mbHash(i + vec3(1,0,1)), f.x), mix(mbHash(i + vec3(0,1,1)), mbHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float mbFbm(vec3 p) { return 0.5 * mbNoise(p) + 0.3 * mbNoise(p * 2.07 + 11.3) + 0.2 * mbNoise(p * 4.13 + 5.7); }
`;

/** Whether a material gets the detail: an opaque, unlit-by-itself standard material (not a lamp, a pane or glass). */
export function wantsDetail(m) {
  return !!m && m.isMeshStandardMaterial && !m.transparent && m.opacity >= 1 && !m.map && !m.normalMap
    && (!m.emissive || m.emissive.r + m.emissive.g + m.emissive.b <= 0.01) && !(m.transmission > 0) && !(m.userData?.mbDetail);
}

/**
 * Adds the detail to `mat` (once). strength 0..1 scales the bump, the mottling and the roughness variation.
 * The program is the same for every material that has it (the shader differs only in uniforms), so the cache key is shared.
 */
export function addDetail(mat, { strength = 1 } = {}) {
  if (!wantsDetail(mat)) return false;
  mat.userData.mbDetail = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uMbDetail = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMbPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMbPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uMbDetail;\nvarying vec3 vMbPos;\n${NOISE}`)
      // the paint: a slow mottle and a fine grain over the flat colour (darker in the grain's low points)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float mbBroad = mbFbm(vMbPos * 0.9), mbFine = mbFbm(vMbPos * 7.0);
      diffuseColor.rgb *= 1.0 + uMbDetail * (0.20 * (mbBroad - 0.5) + 0.16 * (mbFine - 0.5));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + uMbDetail * 0.35 * (mbFine - 0.5), 0.05, 1.0);`)
      // a bump from the same field: the screen-space derivatives of the height give the normal's tilt (three's own bump method)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float mbH = mbFbm(vMbPos * 11.0) * 0.7 + mbFbm(vMbPos * 2.3) * 0.3;
        vec2 mbD = vec2(dFdx(mbH), dFdy(mbH));
        vec3 mbSX = dFdx(-vViewPosition), mbSY = dFdy(-vViewPosition);
        vec3 mbR1 = cross(mbSY, normal), mbR2 = cross(normal, mbSX);
        float mbDet = dot(mbSX, mbR1);
        vec3 mbGrad = sign(mbDet) * (mbD.x * mbR1 + mbD.y * mbR2);
        normal = normalize(abs(mbDet) * normal - 0.045 * uMbDetail * mbGrad);
      }`);
  };
  mat.customProgramCacheKey = () => 'mb-detail';
  mat.needsUpdate = true;
  return true;
}

/** Adds the detail to every opaque material of a set's group. Returns how many materials got it. */
export function detailSet(group, opts) {
  const seen = new Set();
  let n = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (addDetail(m, opts)) n++;
    }
  });
  return n;
}
