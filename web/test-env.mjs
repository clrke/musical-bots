// Headless checks for the environment pipeline: smoke.glb is a valid glTF 2.0
// binary, parses with the real three GLTFLoader, and the loader module exposes
// its contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'environments', 'smoke.glb'));

// 1. binary header: magic, version, length + JSON chunk shape
assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF');
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLen = bytes.readUInt32LE(12);
assert.equal(bytes.readUInt32LE(16), 0x4e4f534a); // 'JSON'
const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
assert.ok(json.asset.version.startsWith('2'), json.asset.version);
assert.ok(json.scenes?.length >= 1, 'no scenes');
assert.ok(json.meshes?.length >= 1, 'no meshes');

// 2. the real three GLTFLoader parses it into the expected scene
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
);
const meshes = [];
gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o.name); });
assert.deepEqual(meshes.sort(), ['BackWall', 'Counter', 'Floor']);

// 3. loader module contract
const env = await import('./src/scene/environments/index.js');
assert.equal(typeof env.loadEnvironment, 'function');

console.log('env ok: smoke.glb valid, parses to 3 meshes, loader contract holds');
