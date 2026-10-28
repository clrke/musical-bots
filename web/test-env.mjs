// Headless checks for the environment pipeline: each .glb is a valid glTF 2.0
// binary, parses with the real three GLTFLoader, and the loader module exposes
// its contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

async function checkEnv(file, expect) {
  const bytes = readFileSync(join(root, 'environments', file));
  // binary header: magic, version, length + JSON chunk shape
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF', `${file} magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${file} version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${file} length`);
  const jsonLen = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${file} chunk`); // 'JSON'
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  assert.ok(json.asset.version.startsWith('2'), `${file} asset ${json.asset.version}`);
  assert.ok(json.scenes?.length >= 1, `${file} no scenes`);
  assert.ok(json.meshes?.length >= 1, `${file} no meshes`);
  assert.deepEqual(json.extensionsUsed ?? [], expect.extensions, `${file} extensions`);

  // the real three GLTFLoader parses it into the expected scene
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
  const meshes = [];
  let points = 0, tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      meshes.push(o.name);
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
    if (o.isPointLight) points++;
  });
  if (expect.meshNames) assert.deepEqual(meshes.sort(), expect.meshNames, `${file} meshes`);
  if (expect.meshCount) assert.equal(meshes.length, expect.meshCount, `${file} mesh count`);
  if (expect.tris) assert.equal(tris, expect.tris, `${file} tris`);
  assert.equal(points, expect.points, `${file} point lights`);
  return meshes.length;
}

const nSmoke = await checkEnv('smoke.glb', {
  extensions: [], meshNames: ['BackWall', 'Counter', 'Floor'], points: 0,
});
const nDiner = await checkEnv('diner.glb', {
  extensions: ['KHR_lights_punctual'], meshCount: 41, tris: 1968, points: 3,
});
const nHouse = await checkEnv('big_house.glb', {
  extensions: ['KHR_lights_punctual'], meshCount: 35, tris: 448, points: 3,
});
const nStreet = await checkEnv('street.glb', {
  extensions: ['KHR_lights_punctual'], meshCount: 42, tris: 764, points: 3,
});

// loader module contract
const env = await import('./src/scene/environments/index.js');
assert.equal(typeof env.loadEnvironment, 'function');

console.log(`env ok: smoke ${nSmoke}, diner ${nDiner} + 3, house ${nHouse} + 3, street ${nStreet} + 3 lights, loader contract holds`);
