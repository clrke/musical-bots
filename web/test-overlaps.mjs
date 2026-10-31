// No z-fighting in the sets: every environments/*.glb has no two overlapping faces in one plane (web/overlaps.mjs).
// The checker itself first, on made-up geometry: a jamb flush with a wall's reveal and a decal flipped into its wall
// flicker; a box on the floor, two tiles side by side and a decal a few mm off its wall do not.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { coplanarOverlaps, loadGlb, setFiles } from './overlaps.mjs';

const mat = (name) => Object.assign(new THREE.MeshStandardMaterial(), { name });
const boxAt = (name, x0, x1, y0, y1, z0, z1) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat(name));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.name = name;
  return m;
};
const plane = (name, w, h, pos, rotX = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(name));
  m.position.set(...pos);
  m.rotation.x = rotX;
  m.name = name;
  return m;
};
const pairsOf = (...objs) => {
  const g = new THREE.Group();
  g.add(...objs);
  return coplanarOverlaps(g).pairs.map((p) => `${p.facing}:${p.a.split('[')[0]}/${p.b.split('[')[0]}`).sort();
};

{
  // a wall with a doorway reveal at x = 1, a jamb flush with it (the old diner door frames)
  assert.deepEqual(pairsOf(boxAt('Wall', 0, 1, 0, 3, 0, 0.12), boxAt('Jamb', 0.9, 1.0, 0, 2.3, -0.02, 0.14)), ['same:Jamb/Wall']);
  // the jamb standing proud of the reveal (set_kit.REVEAL): clear
  assert.deepEqual(pairsOf(boxAt('Wall', 0, 1, 0, 3, 0, 0.12), boxAt('Jamb', 0.9, 1.006, -0.006, 2.3, -0.02, 0.14)), []);
  // a box on a floor sheet, two tiles edge to edge: hidden / no area in common
  const floor = plane('Floor', 4, 4, [0, 0, 0], -Math.PI / 2);
  assert.deepEqual(pairsOf(floor, boxAt('Box', -0.5, 0.5, 0, 1, -0.5, 0.5)), []);
  assert.deepEqual(pairsOf(plane('TileA', 1, 1, [0, 0, 0], -Math.PI / 2), plane('TileB', 1, 1, [1, 0, 0], -Math.PI / 2)), []);
  // a decal on its wall: flush (either way round) flickers, 3 mm off does not
  const wall = () => boxAt('Wall', -2, 2, 0, 3, -0.12, 0);
  assert.deepEqual(pairsOf(wall(), plane('Decal', 1, 1, [0, 1.5, 0])), ['same:Decal/Wall']);
  assert.deepEqual(pairsOf(wall(), plane('Decal', 1, 1, [0, 1.5, 0], Math.PI)), ['opposite:Decal/Wall']);
  assert.deepEqual(pairsOf(wall(), plane('Decal', 1, 1, [0, 1.5, 0.003])), []);
  // two walls sharing a corner block (a side wall run into the back wall)
  assert.deepEqual(pairsOf(boxAt('Back', -5, 5, 0, 3, -0.12, 0), boxAt('Side', 4.88, 5, 0, 3, -0.12, 4)), ['same:Back/Side']);
}

const report = [];
for (const name of setFiles()) {
  const { pairs, tris } = coplanarOverlaps(await loadGlb(name));
  assert.deepEqual(pairs.map((p) => `${p.facing} ${p.a} x ${p.b} at ${p.at}`), [], `${name}: z-fighting faces (node web/overlaps.mjs ${name})`);
  report.push(`${name} ${tris}`);
}
console.log(`overlaps ok: the checker finds flush trims, corners and decals; no z-fighting in ${report.join(', ')} tris`);
