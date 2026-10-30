// The lyrics panel under a robot: the current line on a small dark card, the sung syllable lit up.
// The canvas is drawn only when the line changes (at most 10 times a second, coalesced); the
// karaoke progress (past / current / wipe) is done in the shader from the syllable boxes, so a new
// syllable costs a few uniforms, never a texture upload.
import * as THREE from 'three';
import { alignSyllables, layoutLyrics } from './lyrics-layout.js';

export const PANEL_W = 0.4; // m
export const PANEL_H = 0.1;
const CANVAS_W = 512;
const CANVAS_H = 128;
const PX_PER_M = CANVAS_W / PANEL_W;
// Text size: the em box is 2.6-3.4 cm, so capitals stay above 1.8 cm and the line reads at 1.5 m.
const MIN_PX = Math.ceil(0.026 * PX_PER_M);
const MIN_PX_ONE_LINE = Math.ceil(0.021 * PX_PER_M); // single-line cards (back row) shrink a bit further
const MAX_PX = Math.floor(0.034 * PX_PER_M);
const PAD_X = Math.round(0.013 * PX_PER_M);
const PAD_Y = Math.round(0.006 * PX_PER_M);
const LINE = 1.16; // line height (x font size)
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MIN_GAP_MS = 100; // <= 10 redraws a second
const TOP = 3; // px above the card, and around it in the quad, for its anti-aliased edge
/** Cards draw after everything else in the scene (beams, glows, particles: all below 10), on top of it. */
export const LYRICS_RENDER_ORDER = 100;

const vertexShader = /* glsl */ `
uniform vec4 uQuad;
varying vec2 vUv;
void main() {
  // the quad only covers the card (less blended fill); vUv is in canvas texture space
  vUv = mix(uQuad.xy, uQuad.zw, uv);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec4 uBox;   // card (uv): x0, y0, x1, y1
uniform vec4 uCur;   // current syllable (uv): x0, y0, x1, y1
uniform vec4 uLines; // v of the top of line 0, line height (v), line count, current line (-1: none)
uniform float uWipe; // 0..1 across the current syllable
uniform vec3 uText;
uniform vec3 uPast;
uniform vec3 uHi;
uniform vec3 uBg;
uniform vec3 uEdge;
uniform float uBgAlpha;
uniform vec2 uSize;  // panel size (m)
varying vec2 vUv;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 c = 0.5 * (uBox.xy + uBox.zw);
  vec2 hs = 0.5 * (uBox.zw - uBox.xy) * uSize;
  float d = sdRoundBox((vUv - c) * uSize, hs, min(0.016, hs.y));
  float w = max(fwidth(d), 1e-6);
  float card = clamp(0.5 - d / w, 0.0, 1.0);
  float edge = clamp(1.0 - abs(d + 0.0011) / (w * 1.2), 0.0, 1.0);
  float t = texture2D(uMap, vUv).a;

  float cur = uLines.w;
  float line = floor((uLines.x - vUv.y) / uLines.y);
  float isPast = 0.0;
  float isCur = 0.0;
  float inCurBox = 0.0;
  if (cur >= 0.0) {
    bool sameLine = abs(line - cur) < 0.5;
    isPast = (line < cur - 0.5 || (sameLine && vUv.x < uCur.x)) ? 1.0 : 0.0;
    float wipeX = mix(uCur.x, uCur.z, uWipe);
    isCur = (sameLine && vUv.x >= uCur.x && vUv.x <= wipeX) ? 1.0 : 0.0;
    // a soft pill behind the sung syllable
    vec2 pc = 0.5 * (uCur.xy + uCur.zw);
    vec2 ph = 0.5 * (uCur.zw - uCur.xy) * uSize + vec2(0.004, -0.002);
    float pd = sdRoundBox((vUv - pc) * uSize, ph, ph.y);
    inCurBox = clamp(0.5 - pd / w, 0.0, 1.0);
  }
  vec3 bg = mix(uBg, uHi, inCurBox * 0.2);
  bg = mix(bg, uEdge, edge * 0.55);
  vec3 tc = mix(uText, uPast, isPast);
  tc = mix(tc, uHi, isCur);
  vec3 col = mix(bg, tc, t);
  float a = max(card * mix(uBgAlpha, 0.9, inCurBox * 0.2), t);
  gl_FragColor = vec4(col, a * uOpacity);
  #include <colorspace_fragment>
}
`;

let sharedGeometry = null;

/**
 * @param {{ maxLines?: 1 | 2 }} [opts] maxLines 1: the card never grows taller than one line (the back
 *   row, whose cards sit just above the front row's heads); long lines shrink, then squeeze.
 */
export function createLyricsPanel({ maxLines = 2 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  if (!sharedGeometry) sharedGeometry = new THREE.PlaneGeometry(PANEL_W, PANEL_H);

  const uniforms = {
    uMap: { value: texture },
    uOpacity: { value: 0 },
    uBox: { value: new THREE.Vector4(0.3, 0.6, 0.7, 1) },
    uQuad: { value: new THREE.Vector4(0, 0, 1, 1) },
    uCur: { value: new THREE.Vector4(0, 0, 0, 0) },
    uLines: { value: new THREE.Vector4(1, 0.4, 1, -1) },
    uWipe: { value: 1 },
    uText: { value: new THREE.Color('#eef2f8') },
    uPast: { value: new THREE.Color('#8792a8') },
    uHi: { value: new THREE.Color('#ffd166') },
    uBg: { value: new THREE.Color('#0b0f17') },
    uEdge: { value: new THREE.Color('#4fc3ff') },
    uBgAlpha: { value: 0.74 },
    uSize: { value: new THREE.Vector2(PANEL_W, PANEL_H) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'magna-lyrics',
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    // never hidden: a hand floating in front of it, its own head tipping, a neighbour's arm all pass behind the
    // words (the stage's card layout, main.js layoutLyricCards, keeps the cards clear of each other and of faces)
    depthTest: false,
  });
  const mesh = new THREE.Mesh(sharedGeometry, material);
  mesh.name = 'lyrics';
  mesh.renderOrder = LYRICS_RENDER_ORDER;
  mesh.visible = false;
  // `object` is placed by the head (its origin = the panel's centre); the mesh inside is cropped
  // to the card and hangs from the top edge.
  const object = new THREE.Group();
  object.name = 'lyrics-panel';
  object.add(mesh);

  let layout = null; // { lines, boxes, fontPx, lineXs, top0 }
  let key = '';
  let pending = null;
  let lastDraw = -Infinity;
  let progress = -1;
  let wipe = 1;

  const font = (px) => `700 ${px}px ${FONT_FAMILY}`;
  const measure = (text, px) => {
    ctx.font = font(px);
    return ctx.measureText(text).width;
  };

  function oneLine(display, ranges, maxWidth) {
    let px = MAX_PX;
    while (px > MIN_PX_ONE_LINE && measure(display, px) > maxWidth) px--;
    const width = measure(display, px);
    const squeeze = width > maxWidth ? maxWidth / width : 1;
    const boxes = ranges.map(([a, b]) => ({ line: 0, x0: measure(display.slice(0, a), px) * squeeze, x1: measure(display.slice(0, b), px) * squeeze }));
    return { fontPx: px, lines: [{ start: 0, end: display.length, width: width * squeeze }], boxes };
  }

  function draw({ display, ranges }) {
    const maxWidth = CANVAS_W - 2 * PAD_X;
    let result;
    if (maxLines === 1) result = oneLine(display, ranges, maxWidth);
    else {
      result = layoutLyrics(display, ranges, measure, { maxWidth, minPx: MIN_PX, maxPx: MAX_PX, maxLines: 1 });
      if (result.lines.length > 1 || result.lines[0].width > maxWidth) {
        result = layoutLyrics(display, ranges, measure, { maxWidth, minPx: MIN_PX, maxPx: MAX_PX, maxLines: 2 });
      }
    }
    const { fontPx, lines, boxes } = result;
    const lineH = Math.round(fontPx * LINE);
    const visibleLines = Math.max(1, Math.min(lines.length, Math.floor((CANVAS_H - 2 * PAD_Y - 2 * TOP) / lineH)));
    const widest = Math.min(maxWidth, Math.max(...lines.slice(0, visibleLines).map((l) => l.width)));
    const cardW = Math.max(widest + 2 * PAD_X, CANVAS_W * 0.18);
    const cardH = visibleLines * lineH + 2 * PAD_Y;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = font(fontPx);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const lineXs = [];
    for (let i = 0; i < visibleLines; i++) {
      const l = lines[i];
      const x = Math.round((CANVAS_W - Math.min(l.width, maxWidth)) / 2);
      lineXs.push(x);
      const y = TOP + PAD_Y + i * lineH + lineH / 2 + fontPx * 0.04;
      ctx.fillText(display.slice(l.start, l.end), x, y, maxWidth);
    }
    texture.needsUpdate = true;
    // card anchored to the top edge, so it hangs right under the head; the quad is cropped to it
    const x0 = (CANVAS_W - cardW) / 2 / CANVAS_W;
    const yTop = 1 - TOP / CANVAS_H;
    const yBot = 1 - (TOP + cardH) / CANVAS_H;
    uniforms.uBox.value.set(x0, yBot, 1 - x0, yTop);
    const q = uniforms.uQuad.value.set(x0 - TOP / CANVAS_W, yBot - TOP / CANVAS_H, 1 - x0 + TOP / CANVAS_W, 1);
    mesh.scale.set(q.z - q.x, q.w - q.y, 1);
    mesh.position.set(0, ((q.y + q.w) / 2 - 0.5) * PANEL_H, 0);
    uniforms.uLines.value.set(1 - (TOP + PAD_Y) / CANVAS_H, lineH / CANVAS_H, visibleLines, -1);
    layout = { lines, boxes, fontPx, lineH, lineXs, visibleLines };
    applyProgress();
  }

  function applyProgress() {
    const lines = uniforms.uLines.value;
    if (!layout || progress < 0 || progress >= layout.boxes.length) {
      lines.w = -1;
      return;
    }
    const b = layout.boxes[progress];
    if (b.line >= layout.visibleLines) {
      lines.w = -1;
      return;
    }
    const x = layout.lineXs[b.line];
    const top = TOP + PAD_Y + b.line * layout.lineH;
    uniforms.uCur.value.set(
      (x + b.x0 - 2) / CANVAS_W,
      1 - (top + layout.lineH) / CANVAS_H,
      (x + b.x1 + 2) / CANVAS_W,
      1 - top / CANVAS_H,
    );
    lines.w = b.line;
  }

  return {
    object,
    mesh,
    /** New line ({ text, syllables } or null). Drawn now or at the next allowed tick. */
    setLine(line) {
      if (!line) {
        pending = null;
        key = '';
        layout = null;
        uniforms.uLines.value.w = -1;
        return false;
      }
      const syl = Array.isArray(line.syllables) ? line.syllables : [];
      let k = String(line.text ?? '');
      for (const s of syl) k += '\u0001' + (s?.text ?? '');
      if (k === key) return true;
      key = k;
      pending = alignSyllables(line.text, syl);
      return true;
    },
    setProgress(index) {
      const i = Number.isInteger(index) ? index : -1;
      if (i === progress) return false;
      progress = i;
      wipe = 0;
      applyProgress();
      return true;
    },
    setColors({ highlight, edge }) {
      if (highlight) uniforms.uHi.value.set(highlight);
      if (edge) uniforms.uEdge.value.set(edge);
    },
    /** The card's fill opacity (the text keeps its own): a backing part's card is lighter. */
    setBackground(alpha) {
      if (Number.isFinite(alpha)) uniforms.uBgAlpha.value = Math.min(1, Math.max(0, alpha));
    },
    /** The drawn card's size in the panel's units (m at scale 1): the quad is cropped to it. */
    get cardSize() {
      return { w: mesh.scale.x * PANEL_W, h: mesh.scale.y * PANEL_H };
    },
    setOpacity(a) {
      uniforms.uOpacity.value = a;
      mesh.visible = a > 0.01 && !!layout;
    },
    /** Call once a frame: flushes a pending redraw (rate-limited) and runs the wipe. */
    update(dt, nowMs = performance.now()) {
      if (pending && nowMs - lastDraw >= MIN_GAP_MS) {
        draw(pending);
        pending = null;
        lastDraw = nowMs;
      }
      if (wipe < 1) {
        wipe = Math.min(1, wipe + dt / 0.12);
        uniforms.uWipe.value = wipe;
      }
    },
    get hasLine() {
      return !!layout || !!pending;
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
