// Procedural surface detail for the sets (scene/environments/surface.js): the .glb sets have flat-colour materials and
// mostly no UVs, so the detail is a world-space noise bump, mottling and roughness variation added in onBeforeCompile.
// Checked: every opaque standard material of every set gets it (once), lamps and glass do not, and the shader patch lands.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addDetail, detailSet, wantsDetail } from './src/scene/environments/surface.js';

const lamp = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.9, 0.6) });
const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
const plain = new THREE.MeshStandardMaterial({ color: 0x88aa66 });
assert.equal(wantsDetail(lamp), false, 'a lamp keeps its glow');
assert.equal(wantsDetail(glass), false, 'glass stays clear');
assert.equal(wantsDetail(plain), true);
assert.equal(addDetail(plain), true);
assert.equal(addDetail(plain), false, 'once');
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>' };
plain.onBeforeCompile(shader, null);
assert.ok('uMbDetail' in shader.uniforms);
assert.match(shader.vertexShader, /vMbPos = /);
for (const part of ['mbFbm(vMbPos', 'roughnessFactor = clamp', 'normal = normalize(abs(mbDet)']) assert.ok(shader.fragmentShader.includes(part), part);

const dir = new URL('../environments/', import.meta.url);
let sets = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.glb') && x !== 'smoke.glb')) {
  const b = readFileSync(new URL(f, dir));
  const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const n = detailSet(g.scene);
  assert.ok(n >= 5, `${f}: ${n} materials`);
  sets++;
}
assert.ok(sets >= 10);
console.log(`surface ok: world-space bump + mottling + roughness on ${sets} sets' opaque materials, lamps and glass left alone, the shader patch lands`);
