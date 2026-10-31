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
    if (o.isPointLight) {
      points++;
      // RAW light export: Blender W read as candela 1:1 (no runtime scale hack)
      assert.ok(o.intensity >= 1 && o.intensity <= 12, `${file} ${o.name} intensity ${o.intensity} (RAW candela)`);
    }
  });
  if (expect.meshNames) assert.deepEqual(meshes.sort(), expect.meshNames, `${file} meshes`);
  if (expect.minMeshes) assert.ok(meshes.length >= expect.minMeshes, `${file} mesh count ${meshes.length}`);
  for (const n of expect.has ?? []) assert.ok(meshes.some((m) => m === n || m.startsWith(n)), `${file} has ${n}`);
  assert.ok(tris < 60000, `${file} tris ${tris} over budget`);
  assert.equal(points, expect.points, `${file} point lights`);
  return meshes.length;
}

const nSmoke = await checkEnv('smoke.glb', {
  extensions: [], meshNames: ['BackWall', 'Counter', 'Floor'], points: 0,
});
// the set pieces the marks in web/src/scene/environments/sets.js stand by
const nDiner = await checkEnv('diner.glb', {
  extensions: ['KHR_lights_punctual'], minMeshes: 70, points: 4,
  has: ['Counter', 'StoolSeat', 'BenchBack', 'DoorJamb', 'KitchenDoorJamb', 'HatchSill', 'Window', 'Sign', 'Ceiling', 'PrepTable'],
});
const nHouse = await checkEnv('big_house.glb', {
  extensions: ['KHR_lights_punctual'], minMeshes: 70, points: 4,
  has: ['Fireplace', 'Fire', 'Sofa', 'Fridge', 'Cabinets', 'Step0', 'GardenDoor', 'PorchDoor', 'Lawn', 'Hedge', 'Ceiling'],
});
const nStreet = await checkEnv('street.glb', {
  extensions: ['KHR_lights_punctual'], minMeshes: 85, points: 3,
  has: ['Road', 'Zebra', 'Picket', 'FenceRail', 'LampPole', 'LampGlobe', 'Hydrant', 'BusSign', 'Far'],
});

// the outdoor sets: their set pieces, their lamps, the Squatopia props' vertex colours, a byte budget
const OUTDOOR = {
  village: { points: 2, has: ['Floor', 'CottageL', 'WellRing', 'Stall', 'Bench', 'Lamp', 'Windmill', 'Bunting'] },
  winter: { points: 2, has: ['Snow', 'Chalet', 'SnowmanHead', 'Pond', 'Sledge', 'Pine', 'Mountain', 'Lantern'] },
  haunted: { points: 4, has: ['Ground', 'GatePost', 'Fence', 'Chapel', 'Grave', 'Cauldron', 'JackOLantern', 'Ghost'] },
  beach: { points: 0, has: ['Sand', 'Sea', 'UmbrellaCanopy', 'CastleBase', 'TowerHut', 'Palm', 'Lighthouse', 'BeachBall'] },
  pool: { points: 0, has: ['Floor', 'Water', 'Coping', 'Board', 'SlideChute', 'Lounger', 'LadderRail', 'Duck'] },
  pier: { points: 2, has: ['Plank', 'WalkPlank', 'Piling', 'SailBoat', 'RowBoat', 'ShackWalls', 'Crates', 'Lamp'] },
  ocean: { points: 1, has: ['Sea', 'Log', 'Mast', 'Sail', 'HutRoof', 'Chest', 'LifeRing', 'Whale'] },
};
const nOut = [];
for (const [name, e] of Object.entries(OUTDOOR)) {
  const file = `${name}.glb`;
  nOut.push(`${name} ${await checkEnv(file, { extensions: e.points ? ['KHR_lights_punctual'] : [], minMeshes: 25, ...e })}`);
  const bytes = readFileSync(join(root, 'environments', file));
  assert.ok(bytes.length < 900 * 1024, `${file}: ${bytes.length} bytes (budget 900 KB)`);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  const props = json.meshes.filter((m) => m.primitives.some((p) => p.attributes.COLOR_0 !== undefined));
  assert.ok(props.length >= 3, `${file}: the props carry their vertex colours (${props.length})`);
}
// a panorama sky follows the moods: the set's own mood as painted, darker at night, never black or blown out
{
  globalThis.document ??= { createElementNS: () => ({ style: {} }) };
  const { panoGain } = await import('./src/scene/environments/stage.js');
  assert.equal(panoGain('bright', 'bright'), 1);
  assert.ok(panoGain('bright', 'night') < 0.3 && panoGain('bright', 'night') >= 0.22);
  assert.ok(panoGain('night', 'bright') <= 1.4);
}

// loader module contract
const env = await import('./src/scene/environments/index.js');
assert.equal(typeof env.loadEnvironment, 'function');

console.log(`env ok: smoke ${nSmoke}, diner ${nDiner} + 4, house ${nHouse} + 4, street ${nStreet} + 3 lights (RAW candela), ${nOut.join(", ")} meshes, panorama gains, loader contract holds`);
