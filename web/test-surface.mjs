// Procedural surface detail for the sets (scene/environments/surface.js): the .glb sets have flat-colour materials and
// mostly no UVs, so the detail is world-space noise (a fine grain with a bump, a mid grain, a mottle) added in
// onBeforeCompile. Checked: by finish (matte: grain and bump; glossy: a faint tint, no bump; metal: roughness only; water:
// ripples only), by size (a wide surface: a finer grain, its walls keep less), lamps and glass left alone, every set's
// opaque materials get it (once), the shader patch lands and stays cheap (four noise fetches a pixel), and the noise
// texture is made here, seeded (no download; every load the same).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addDetail, detailSet, detailParams, wantsDetail, noiseTexture, DETAIL } from './src/scene/environments/surface.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
const lamp = std({ emissive: new THREE.Color(1, 0.9, 0.6) });
const glass = std({ transparent: true, opacity: 0.4 });
const plain = std({ color: 0x88aa66 });
assert.equal(wantsDetail(lamp), false, 'a lamp keeps its glow');
assert.equal(wantsDetail(glass), false, 'glass stays clear');
assert.equal(wantsDetail(new THREE.MeshBasicMaterial()), false, 'unlit materials are not touched');
assert.equal(wantsDetail(plain), true);
assert.equal(addDetail(plain), true);
assert.equal(addDetail(plain), false, 'once');

// by finish: [freq, albedo, roughness, bump height] (grain), [albedo, roughness, bump height, wall keeps] (mid)
const stone = detailParams(std({ roughness: 0.9 }), 1), vinyl = detailParams(std({ roughness: 0.4 }), 1);
const steel = detailParams(std({ roughness: 0.25, metalness: 0.9 }), 1);
const sea = detailParams(std({ roughness: 0.12, name: 'SeaMat' }), 40);
assert.ok(stone.grain[1] > 0.05 && stone.grain[3] > 0 && stone.mid[2] > 0, 'matte: a tinted grain and a bump');
assert.ok(vinyl.grain[1] > 0 && vinyl.grain[1] < stone.grain[1] / 3 && vinyl.grain[3] === 0 && vinyl.mid[2] === 0, 'glossy: faint, no bump (no sponge duck)');
assert.ok(steel.grain[1] === 0 && steel.mottle[1] === 0 && steel.grain[3] === 0 && steel.grain[2] > 0, 'metal: its roughness only (no granite stools)');
assert.ok(sea.grain[1] === 0 && sea.mottle[1] === 0 && sea.grain[3] > 0 && sea.grain[0] < stone.grain[0] / 2, 'water: broad ripples, no tint');
// the bump's typical slope stays a few degrees (b95's crumpled walls were ~9): height x frequency
assert.ok(stone.grain[3] * 0.6 * stone.grain[0] <= 0.15, 'a gentle fine bump');
// by size: a wall or the ground has a finer grain than a prop; its walls keep half the fine grain and none of the mid one
const wall = detailParams(std({ roughness: 0.9 }), 10);
assert.ok(wall.grain[0] > stone.grain[0], 'finer on a wide surface');
assert.equal(wall.mottle[3], DETAIL.wall);
assert.equal(wall.mid[3], 0);
assert.equal(stone.mottle[3], 1, 'a prop keeps all of it on every face');
// the authored finish: detailSet runs before stage.js raises a pale floor's roughness (glazed tiles stay tiles)
assert.ok(detailParams(std({ roughness: 0.55 }), 10).grain[3] < 0.1 * wall.grain[3]);

// the shader patch, and its cost: four noise fetches a pixel (no ALU hash fbm)
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
  fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>' };
plain.onBeforeCompile(shader, null);
for (const u of ['uMbNoise', 'uMbGrain', 'uMbMid', 'uMbMottle']) assert.ok(u in shader.uniforms, u);
assert.equal(shader.uniforms.uMbNoise.value, noiseTexture());
assert.match(shader.vertexShader, /vMbPos = \(modelMatrix \* mbP\)\.xyz/);
assert.match(shader.vertexShader, /USE_INSTANCING/);
const main = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#include <color_fragment>'));
assert.equal((main.match(/mbOctave\(/g) ?? []).length, 4, 'four octaves');
assert.equal((shader.fragmentShader.match(/textureLod\(/g) ?? []).length, 1, 'one fetch an octave');
for (const part of ['diffuseColor.rgb *=', 'roughnessFactor = clamp', 'normal = normalize(normal - mbGrad', 'smoothstep(0.18, 0.45']) {
  assert.ok(shader.fragmentShader.includes(part), part);
}
assert.equal(plain.customProgramCacheKey(), 'mb-detail', 'one program for all of them');

// the noise texture: 256x256 RG8, seeded, green = red's next z layer (shifted 37, 17)
const tex = noiseTexture(), d = tex.image.data;
assert.equal(tex.image.width, 256);
assert.equal(tex.format, THREE.RGFormat);
assert.equal(tex.wrapS, THREE.RepeatWrapping);
for (const [x, y] of [[0, 0], [10, 200], [250, 250]]) assert.equal(d[2 * (y * 256 + x) + 1], d[2 * (((y + 17) % 256) * 256 + ((x + 37) % 256))]);
let sum = 0;
for (let i = 0; i < d.length; i += 2) sum += d[i];
assert.ok(Math.abs(sum / (d.length / 2) - 127.5) < 3, 'uniform noise');
assert.equal(d[0], 238, 'seeded: every load the same');

const dir = new URL('../environments/', import.meta.url);
let sets = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.glb') && x !== 'smoke.glb')) {
  const b = readFileSync(new URL(f, dir));
  const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const n = detailSet(g.scene);
  assert.ok(n >= 5, `${f}: ${n} materials`);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01) assert.ok(!m.userData.mbDetail, `${f} ${m.name}: lamps keep their glow`);
  });
  sets++;
}
assert.ok(sets >= 10);
console.log(`surface ok: world-space grain, bump and mottle on ${sets} sets' opaque materials by finish and size (metal and glossy plastic smooth, water rippled, wide walls subtler), lamps and glass left alone, four noise fetches a pixel from a seeded texture`);
