// Environment slot: named .glb sets from the Blender pipeline (environments/*.blend
// -> environments/*.glb, served via web/public/environments). Loader-shaped interface
// so later sets (diner, big house, street) drop in behind the same call.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

/** Load a named set; resolves { group, name }. Rejects when the asset is missing. */
export async function loadEnvironment(name, { base = import.meta.env?.BASE_URL ?? '/' } = {}) {
  const gltf = await loader.loadAsync(`${base}environments/${name}.glb`);
  return { group: gltf.scene, name };
}
