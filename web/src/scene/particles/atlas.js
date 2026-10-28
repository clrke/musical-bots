// One single-channel texture atlas for every particle (one draw call for all heads' effects).
// The source PNGs in public/fx are unmodified copies of the author's own procedural textures
// (Squatopia 2: Resources/CombatVFX from tools/make_combat_vfx_textures.py and Resources/ElementVFX
// from tools/make_element_vfx_textures.py). They are white with the shape in alpha, so only alpha
// is kept: a 1024 x 1024 R8 texture (1 MB + mips) of 4 x 4 cells, 256 px each.
import * as THREE from 'three';

export const ATLAS_SIZE = 1024;
export const ATLAS_GRID = 4;
const CELL = ATLAS_SIZE / ATLAS_GRID;

/** Cell index per texture name (row-major from the top-left). flamewisps uses 4 cells (2 x 2 frames). */
export const ATLAS_CELLS = Object.freeze({
  flamewisps: 0,
  burst: 4,
  spark: 5,
  noisyglow: 6,
  capsule: 7,
  beam: 8,
  soft: 9,
  heart: 10,
  note: 11,
});

const SOURCES = [
  { name: 'flamewisps', file: 'flamewisps.png', sheet: [2, 2] },
  { name: 'burst', file: 'burst.png' },
  { name: 'spark', file: 'spark.png' },
  { name: 'noisyglow', file: 'noisyglow.png' },
  { name: 'capsule', file: 'capsule.png' }, // 512 x 256: squeezed into a square cell, it is stretched along ribbons anyway
  { name: 'beam', file: 'beam.png' }, // 64 x 256, repeats along x: one period per cell
];

/** Where the fx PNGs are served: `<page base>/fx/` (Vite copies public/fx there). */
export function defaultFxBase() {
  return typeof document !== 'undefined' ? new URL('fx/', document.baseURI).href : 'fx/';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

function cellXY(index) {
  return [(index % ATLAS_GRID) * CELL, Math.floor(index / ATLAS_GRID) * CELL];
}

/** White heart on transparent, with a soft halo (Unity: tools/make-sparkle-cells.py). */
function drawHeart(ctx, x, y) {
  ctx.save();
  ctx.translate(x + CELL / 2, y + CELL * 0.47);
  ctx.scale(CELL / 128, CELL / 128);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (let k = 0; k <= 180; k++) {
    const t = (2 * Math.PI * k) / 180;
    const px = 16 * Math.sin(t) ** 3;
    const py = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const X = px * 2.37;
    const Y = -py * 2.37;
    if (k === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** White eighth note on transparent: tilted oval head, stem, flag (Unity: make-sparkle-cells.py). */
function drawNote(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(CELL / 128, CELL / 128);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8;
  // head: tilted ellipse
  ctx.beginPath();
  ctx.ellipse(51, 92, 17, 12, -0.35, 0, Math.PI * 2);
  ctx.fill();
  // stem
  ctx.fillRect(63, 22, 7, 66);
  // flag curling down from the top
  ctx.beginPath();
  ctx.moveTo(70, 22);
  ctx.bezierCurveTo(96, 30, 100, 52, 88, 70);
  ctx.bezierCurveTo(96, 52, 90, 40, 70, 36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Loads the PNGs and packs their alpha into an R8 DataTexture (mipmapped).
 * @param {string} [base] URL of the folder holding the PNGs (default `defaultFxBase()`).
 */
export async function loadParticleAtlas(base = defaultFxBase()) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const images = await Promise.all(SOURCES.map((s) => loadImage(new URL(s.file, new URL(root, document.baseURI)).href)));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  SOURCES.forEach((s, i) => {
    const img = images[i];
    const first = ATLAS_CELLS[s.name];
    if (s.sheet) {
      const [cols, rows] = s.sheet;
      const fw = img.width / cols;
      const fh = img.height / rows;
      for (let f = 0; f < cols * rows; f++) {
        const [x, y] = cellXY(first + f);
        ctx.drawImage(img, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, x, y, CELL, CELL);
      }
    } else {
      const [x, y] = cellXY(first);
      ctx.drawImage(img, 0, 0, img.width, img.height, x, y, CELL, CELL);
    }
  });
  // A soft round dot (generic glow).
  {
    const [x, y] = cellXY(ATLAS_CELLS.soft);
    const g = ctx.createRadialGradient(x + CELL / 2, y + CELL / 2, 0, x + CELL / 2, y + CELL / 2, CELL / 2 - 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CELL, CELL);
  }
  // A heart (cell 10) and an eighth note (cell 11), drawn like the Unity atlas cells.
  drawHeart(ctx, ...cellXY(ATLAS_CELLS.heart));
  drawNote(ctx, ...cellXY(ATLAS_CELLS.note));
  const rgba = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const alpha = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = rgba[j];
  const texture = new THREE.DataTexture(alpha, ATLAS_SIZE, ATLAS_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  texture.name = 'magna-fx-atlas';
  return texture;
}
