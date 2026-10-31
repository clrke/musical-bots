// The heads' reflection environment: a procedural photo studio (soft gradient room, a big key
// softbox above the audience, a fill, an overhead strip and two rim strips behind the choir)
// pre-filtered ONCE into a PMREM (cube-UV) texture. The heads look it up in "choir space"
// (the choir's own frame: the audience at +Z), so the highlights stay put when the choir is
// turned toward the viewer. No third-party textures. Never shown as a backdrop: the bots always
// stand in a set (scene/environments/stage.js), which builds its own reflections once loaded.
import * as THREE from 'three';

/** Cube face size of the PMREM (the texture is 3 * 128 x 4 * 128). */
export const ENV_SIZE = 128;

let cached = null;

/** Cube-UV defines for a PMREM of ENV_SIZE (same maths as three's generateCubeUVSize). */
export function envDefines(size = ENV_SIZE) {
  const height = 4 * size;
  const maxMip = Math.log2(height) - 2;
  return {
    ENVMAP_TYPE_CUBE_UV: '',
    CUBEUV_TEXEL_WIDTH: (1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))).toFixed(10),
    CUBEUV_TEXEL_HEIGHT: (1 / height).toFixed(10),
    CUBEUV_MAX_MIP: `${maxMip.toFixed(1)}`,
  };
}

const roomVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const roomFragment = /* glsl */ `
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // floor dark and warm, walls a soft neutral grey, ceiling brighter and a touch cool
  vec3 floorC = vec3(0.03, 0.027, 0.025);
  vec3 wallC = vec3(0.44, 0.43, 0.42);
  vec3 ceilC = vec3(0.95, 0.98, 1.05);
  float y = d.y;
  vec3 c = y < 0.0 ? mix(wallC * 0.55, floorC, smoothstep(0.0, 0.35, -y)) : mix(wallC, ceilC, smoothstep(0.05, 0.85, y));
  // the far wall behind the choir (-Z) a little darker, the audience side (+Z) a little brighter
  c *= 0.85 + 0.25 * smoothstep(-0.6, 0.6, d.z);
  // a soft horizon glow band
  c += vec3(0.10, 0.09, 0.08) * exp(-y * y * 60.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

function softbox(scene, dir, w, h, color, dist = 6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const d = new THREE.Vector3(...dir).normalize();
  m.position.copy(d).multiplyScalar(dist);
  m.lookAt(0, 0, 0);
  scene.add(m);
  return m;
}

/** Builds the studio scene (choir space: the audience at +Z, the choir around the origin). */
export function createStudioScene() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: roomVertex, fragmentShader: roomFragment, side: THREE.BackSide, depthWrite: false }),
  );
  scene.add(room);
  const c = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  // key: a large softbox above and to the right of the audience
  softbox(scene, [0.45, 0.62, 0.65], 3.6, 2.6, c(8.5, 8.1, 7.6));
  // fill: a tall soft panel left of the audience
  softbox(scene, [-0.9, 0.18, 0.42], 2.4, 3.6, c(2.8, 2.95, 3.2));
  // overhead strip
  softbox(scene, [0.05, 1, 0.12], 5.0, 0.9, c(3.4, 3.4, 3.5));
  // rim strips behind the choir, left and right (crisp edges on chrome)
  softbox(scene, [0.75, 0.28, -0.6], 0.7, 3.6, c(4.2, 4.4, 4.8));
  softbox(scene, [-0.75, 0.28, -0.6], 0.7, 3.6, c(4.6, 4.3, 4.0));
  // a low bounce card in front (lifts chins and the undersides of brows)
  softbox(scene, [0, -0.3, 1], 3.4, 1.2, c(0.9, 0.85, 0.8));
  return scene;
}

/**
 * The shared PMREM environment, built once per renderer: { texture, defines } (null without a
 * renderer, e.g. in tests).
 */
export function getStudioEnvironment(renderer) {
  if (cached) return cached;
  if (!renderer) return null;
  const scene = createStudioScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.012, 0.1, 50, { size: ENV_SIZE });
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  cached = { texture: rt.texture, target: rt, defines: envDefines(ENV_SIZE) };
  return cached;
}

export function peekStudioEnvironment() {
  return cached;
}
