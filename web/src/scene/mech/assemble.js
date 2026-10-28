// Assembles a mechanical head: shell + eyes + brows + mouth + extras + antenna merged into ONE
// skinned mesh (one draw call), plus the bone table (pivots and rest frames) and the rig data the
// head animates with. Built once per combination of parts and shared by every head wearing it
// (reference counted, a few unused ones are kept warm for quick re-randomizing).
import { ANTENNAS, BROW_SHAPES, EYE_SHAPES, FACE_SHAPES, MOUTH_SHAPES } from '../../model/schema.js';
import { BROW } from '../face-rig.js';
import { BONE, BONE_COUNT, HeadBuilder } from './builder.js';
import { buildBrows } from './brows.js';
import { buildEyes } from './eyes.js';
import { buildAntenna, buildExtras } from './extras.js';
import { buildMouth } from './mouths.js';
import { makeShell } from './shells.js';

const pick = (list, v, d) => (list.includes(v) ? v : d);

/** The geometry-relevant parts of an appearance. */
export function headParts(a = {}) {
  return {
    faceShape: pick(FACE_SHAPES, a.faceShape, FACE_SHAPES[0]),
    eyeShape: pick(EYE_SHAPES, a.eyeShape, EYE_SHAPES[0]),
    browShape: pick(BROW_SHAPES, a.browShape, BROW_SHAPES[0]),
    mouthShape: pick(MOUTH_SHAPES, a.mouthShape, MOUTH_SHAPES[0]),
    antenna: pick(ANTENNAS, a.antenna, ANTENNAS[0]),
  };
}

export function headKey(a) {
  const p = headParts(a);
  return `${p.faceShape}|${p.eyeShape}|${p.browShape}|${p.mouthShape}|${p.antenna}`;
}

/** Builds a head (no caching). */
export function buildHead(appearance) {
  const parts = headParts(appearance);
  const b = new HeadBuilder();
  const shell = makeShell(parts.faceShape);
  shell.build(b);
  const eyes = buildEyes(b, shell, parts.eyeShape);
  const brows = buildBrows(b, shell, parts.browShape, eyes);
  const mouth = buildMouth(b, shell, parts.mouthShape);
  buildExtras(b, shell);
  const L = shell.layout;
  const mount = L.mount;
  const antenna = buildAntenna(b, mount, parts.antenna);
  const triangles = b.triangles;
  const geometry = b.build();

  // ---- bone table: pivot (head space) + rest frame (row-major 3x3, null = identity)
  const bones = Array.from({ length: BONE_COUNT }, () => ({ pivot: new Float64Array(3), Q: null }));
  bones[BONE.JAW].pivot = mouth.jaw?.pivot ?? mouth.center.slice();
  for (const e of eyes.eyes) {
    for (const k of ['eye', 'up', 'low']) bones[e.bones[k]].pivot = e.center.slice();
    bones[e.bones.up].Q = e.lidQ;
    bones[e.bones.low].Q = e.lidQ;
    if (e.bones.tube >= 0) bones[e.bones.tube].pivot = e.center.slice();
  }
  bones[BONE.ANTENNA].pivot = Float64Array.from(mount);
  for (const br of brows) {
    bones[br.main].pivot = br.pivot;
    bones[br.main].Q = br.Q;
    for (const e of br.extra) bones[e].Q = br.Q;
    if (br.segPivots) {
      bones[br.extra[0]].pivot = br.segPivots[0];
      bones[br.main].pivot = br.segPivots[1];
      bones[br.extra[1]].pivot = br.segPivots[2];
    }
    if (br.rodPivots) {
      bones[br.extra[0]].pivot = br.rodPivots[0];
      bones[br.extra[1]].pivot = br.rodPivots[1];
    }
  }
  const zfn = shell.surfaceZ;
  mouth.surfaceZ = zfn;
  // the face around the mouth as a quadratic in (dx, dy) from the mouth centre, so posing the lips
  // needs no calls into the shell's surface function: z = z0 + zx dx + zy dy + zxx dx^2 + zyy dy^2
  {
    const cx = mouth.faceX;
    const cy = mouth.mouthY;
    const hx = 0.035;
    const hy = 0.025;
    const z0 = zfn(cx, cy);
    const zxp = zfn(cx + hx, cy);
    const zxm = zfn(cx - hx, cy);
    const zyp = zfn(cx, cy + hy);
    const zym = zfn(cx, cy - hy);
    mouth.surf = new Float64Array([z0, (zxp - zxm) / (2 * hx), (zyp - zym) / (2 * hy), (zxp - 2 * z0 + zxm) / (2 * hx * hx), (zyp - 2 * z0 + zym) / (2 * hy * hy)]);
  }
  // rest pivots on the same fitted surface the head poses with (so the rest pose moves nothing)
  for (const mb of mouth.bones) {
    if (mb.role === 'iris' || mb.role === 'flap') {
      bones[mb.index].pivot = mouth.center.slice();
      continue;
    }
    const dx = mb.u * mouth.halfWidth;
    const sf = mouth.surf;
    mb.rest = new Float64Array([mouth.faceX + dx, mouth.mouthY, sf[0] + sf[1] * dx + sf[3] * dx * dx + mouth.standoff]);
    bones[mb.index].pivot = mb.rest;
  }

  const box = geometry.boundingBox;
  // brows can rise a full servo travel above their rest position
  const shellTop = Math.max(L.top, ...brows.map((br) => br.top + BROW.raise), ...eyes.eyes.map((e) => e.top));
  const top = Math.max(shellTop, mount[1] + antenna.height, box.max.y);
  const bottom = Math.min(L.bottom - 0.022, box.min.y);
  const halfWidth = Math.max(L.halfWidth, Math.abs(L.earX) + 0.016, box.max.x - L.faceX * 0, -box.min.x);
  return {
    key: headKey(parts),
    parts,
    geometry,
    hull: shell._hull,
    triangles,
    vertices: geometry.getAttribute('position').count,
    rig: {
      layout: L,
      surfaceZ: zfn,
      seams: shell.seams,
      panel: shell.panel,
      eyes,
      brows,
      mouth,
      antenna: { mount: Float64Array.from(mount), height: antenna.height, kind: parts.antenna },
      bones,
    },
    top,
    shellTop,
    bottom,
    captionTop: L.bottom - 0.004,
    halfWidth,
    radius: Math.max(top, -bottom, halfWidth),
    mouthPoint: Array.from(mouth.center),
  };
}

// ------------------------------------------------------------------ cache

const live = new Map(); // key -> { head, refs }
const spare = []; // unused keys, oldest first
const SPARE_MAX = 6;
const queue = []; // keys waiting to be built (one or two a frame)
const queued = new Map(); // key -> parts
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A shared head for an appearance (built on first use). Pair with releaseHead. */
export function acquireHead(appearance) {
  const key = headKey(appearance);
  let e = live.get(key);
  if (!e) {
    e = { head: buildHead(appearance), refs: 0 };
    live.set(key, e);
  }
  const i = spare.indexOf(key);
  if (i >= 0) spare.splice(i, 1);
  e.refs++;
  e.fresh = false;
  return e.head;
}

/**
 * Non-blocking acquire: the shared head if it is built (acquired, pair with releaseHead), else null
 * and the build is queued for pumpHeadBuilds().
 */
export function tryAcquireHead(appearance) {
  const key = headKey(appearance);
  if (live.has(key)) return acquireHead(appearance);
  if (!queued.has(key)) {
    queued.set(key, headParts(appearance));
    queue.push(key);
  }
  return null;
}

/** Builds queued heads for up to `budgetMs` (at least one). Call once a frame. */
export function pumpHeadBuilds(budgetMs = 6) {
  const t0 = now();
  while (queue.length) {
    const key = queue.shift();
    const parts = queued.get(key);
    queued.delete(key);
    if (!live.has(key)) live.set(key, { head: buildHead(parts), refs: 0, fresh: true });
    if (now() - t0 > budgetMs) break;
  }
  return queue.length;
}

export function releaseHead(head) {
  if (!head) return;
  const e = live.get(head.key);
  if (!e || e.head !== head) return;
  e.refs--;
  if (e.refs > 0) return;
  spare.push(head.key);
  while (spare.length > SPARE_MAX) {
    const k = spare.shift();
    const old = live.get(k);
    if (old && old.refs <= 0 && !old.fresh) {
      old.head.geometry.dispose();
      old.head.hull?.dispose();
      live.delete(k);
    }
  }
}

/** Cache statistics (for the dev page and tests). */
export function headCacheStats() {
  let refs = 0;
  for (const e of live.values()) refs += e.refs;
  return { built: live.size, refs, spare: spare.length, queued: queue.length };
}
