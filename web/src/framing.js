// Shot framing (the camera of main.js): a singing bot's lyric card hangs under its head, so a shot
// must hold the head AND the card, with the card clear of the cinema lower third (bottom-left,
// 945-1020 px of 1080). Pure maths on a three camera; no DOM, so it is tested headless.
import * as THREE from 'three';
import { PANEL_H, PANEL_W } from './scene/lyrics-panel.js';

/** Lowest NDC y a card may reach: 84% down the frame (907 px of 1080), above the lower third (945 px). */
export const CARD_FLOOR = -0.68;
/** Highest NDC y the head (antenna included) may reach. */
export const HEAD_ROOM = 0.9;
/** Widest NDC |x| a card or head may reach. */
export const SIDE = 0.95;

const _w = new THREE.Vector3(), _p = new THREE.Vector3(), _r = new THREE.Vector3(), _o = new THREE.Vector3();
const _cb = {};

/**
 * Where a bot's head and card are (world): { x, z, top, cardTop, cardBottom, half, dx }. The card (two
 * lines at most, PANEL_H tall, up to PANEL_W wide, at its style's scale: the backing's smaller) hangs from
 * the head's caption line and moves with the head (acting's offsets included), plus the card layout's
 * move (down by its drop, `dx` m sideways across the view); `top` is the head's top, its antenna included.
 */
export function cardBounds(bot, out = {}) {
  const k = bot.group.scale.x || 1;
  const s = bot.headScale ?? 1;
  const mech = bot.head?.mech;
  const top = mech?.top ?? 0.15, captionTop = mech?.captionTop ?? -0.12;
  const g = bot.head?.group;
  if (g) g.getWorldPosition(_w);
  else _w.copy(bot.group.position);
  const card = bot.head?.card;
  const cs = card?.scale ?? 1;
  out.x = _w.x;
  out.z = _w.z;
  out.top = _w.y + k * top * s + 0.03; // + its float
  out.cardTop = _w.y + k * (captionTop * s + Math.min(0, card?.y ?? 0));
  out.cardBottom = out.cardTop - k * PANEL_H * cs;
  out.half = k * PANEL_W * 0.46 * cs;
  out.dx = k * (card?.x ?? 0);
  return out;
}

/** A bot's bounds as if it stood at `slot` (its place, where it is going): for framing a cast that is still moving. */
export function slotBounds(bot, slot, out = {}) {
  cardBounds(bot, out);
  const dy = slot.y - bot.group.position.y;
  out.x = slot.x;
  out.z = slot.z;
  out.top += dy;
  out.cardTop += dy;
  out.cardBottom += dy;
  return out;
}

/**
 * How a camera at pos looking at look sees the subjects (bots, or bounds from cardBounds / slotBounds):
 * { lo, hi, wide } (the lowest card bottom, the highest head top, the widest |x}, in NDC).
 */
export function measure(cam, pos, look, subjects, out = {}) {
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  _r.setFromMatrixColumn(cam.matrixWorld, 0);
  let hi = -Infinity, lo = Infinity, wide = 0;
  for (const b of subjects) {
    const c = b.group ? cardBounds(b, _cb) : b;
    _p.set(c.x, c.top, c.z).project(cam);
    hi = Math.max(hi, _p.y);
    wide = Math.max(wide, Math.abs(_p.x));
    for (let sx = -1; sx <= 1; sx += 2) {
      const across = c.half * sx + (c.dx ?? 0);
      _p.set(c.x + _r.x * across, c.cardBottom, c.z + _r.z * across).project(cam);
      lo = Math.min(lo, _p.y);
      wide = Math.max(wide, Math.abs(_p.x));
    }
  }
  out.lo = lo;
  out.hi = hi;
  out.wide = wide;
  return out;
}

// ------------------------------------------------------------------ every singer's card, readable

const _sc = new THREE.Vector3(), _sf = new THREE.Vector3(), _sv = new THREE.Vector3();
/**
 * A bot's lyric card and face on screen (cam: the rendered camera, its matrices current): { depth (m along the view),
 * card (NDC rect { x0, x1, y0, y1 } where the card hangs before the layout's move; null while it is down), face (NDC
 * rect of the head), mx, my (m per NDC unit across and up at the card's depth), px, py (the layout's move now, NDC) },
 * or null when the head is behind the camera or too near it.
 */
export function screenCard(cam, bot) {
  const k = bot.group.scale.x || 1;
  const s = bot.headScale ?? 1;
  const mech = bot.head?.mech;
  const top = mech?.top ?? 0.15, captionTop = mech?.captionTop ?? -0.12;
  const g = bot.head?.group;
  if (g) g.getWorldPosition(_sc);
  else _sc.copy(bot.group.position);
  cam.getWorldDirection(_sv);
  const depth = _sf.copy(_sc).sub(cam.position).dot(_sv);
  if (!(depth > 0.3)) return null;
  const t = Math.tan((cam.fov * Math.PI) / 360);
  const my = depth * t, mx = my * (cam.aspect || 1);
  const r = (bot.unit ?? 0.12) * k; // the head's half-width (m)
  _sf.set(_sc.x, _sc.y + k * captionTop * s, _sc.z).project(cam); // the caption line: the card's top edge
  const cx = _sf.x, cy = _sf.y;
  const headTop = cy + (k * (top - captionTop) * s) / my;
  const face = { x0: cx - (r * 0.9) / mx, x1: cx + (r * 0.9) / mx, y0: cy, y1: headTop };
  const c = bot.head?.card;
  let card = null;
  if (c && c.opacity > 0.02 && c.w > 0 && c.h > 0) {
    const hw = (k * c.w) / 2 / mx, hh = (k * c.h) / my;
    card = { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy, text: c.text ?? '', merged: !!c.merged };
  }
  return { depth, card, face, mx, my, px: c ? (k * (c.x ?? 0)) / mx : 0, py: c ? (k * (c.y ?? 0)) / my : 0 };
}

/**
 * The studio's two-shot (main.js): from the front, a little above, at the middle of the two (positions a, b), as close
 * as holds them; `drift` the shot's slow push-in (m). Writes pos and look (before fitFrame). Pure.
 */
export function studioTwoShot(a, b, drift, pos, look) {
  look.copy(a).add(b).multiplyScalar(0.5);
  const d = Math.max(2.4, a.distanceTo(b) * 1.1 + 1.4) - drift * 0.5;
  pos.set(look.x * 0.9, look.y + 0.8, look.z + d);
  look.y += 0.1;
}

/**
 * How much of each face the heads in front of it hide (cam: its matrices current; bots: the heads to check): Map bot ->
 * the largest share (0..1) of its face rect (screenCard) covered by one nearer head. Pure (reads the bots).
 */
export function faceOcclusion(cam, bots) {
  const seen = bots.map((b) => [b, screenCard(cam, b)]).filter(([, s]) => s);
  const out = new Map();
  for (const [b, s] of seen) {
    const f = s.face, area = Math.max(1e-9, (f.x1 - f.x0) * (f.y1 - f.y0));
    let worst = 0;
    for (const [o, t] of seen) if (o !== b && t.depth < s.depth) worst = Math.max(worst, overlapArea(f, t.face) / area);
    out.set(b, worst);
  }
  return out;
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Every singer's card readable at once: `cards` [{ key, rank, depth, x0, x1, y0, y1, px?, py?, text?, merged? }] are the
 * cards' NDC rects where they hang (px, py: the move they have now; merged: the layout merged it last time), `faces`
 * [{ key, depth, x0, x1, y0, y1 }] the heads on screen. In rank order (higher first, then key), each card takes the
 * smallest move that keeps it clear of the cards placed before it and of the other faces (one behind it would be
 * covered, one in front would hide its words; its own is above): sideways (at most `side` of its width), else down (at
 * most `drop` of its height; never up over its own face), else both; it stays near the move it has (no flicker as the
 * shot drifts). Cards never overlap (they draw over everything, lyrics-panel.js): one that cannot clear the cards
 * before it within that reach is merged when a card placed before it shows the same words (a line sung together: one
 * card, the first singer's, its highlight), else it looks further (`far`: [side, drop]), and failing that it is merged
 * too (the higher ranked card stays readable). A later card left lying over a nearer bot's face (30% of it) stays
 * down as well (merged: not drawn). Every card shown stays inside `frame` ({ x0, x1, y0, y1 }, NDC: a backing card at the
 * edge of the shot is pulled in, QA v14), its moves to the frame's edges tried first, a move out of it costed, and the
 * card clamped to it at the end. Returns Map key -> { dx, dy, merged } (NDC). Pure.
 */
export const CARD_FRAME = Object.freeze({ x0: -0.97, x1: 0.97, y0: -0.95, y1: 0.95 });
export function layoutCards(cards, faces = [], { gap = 0.02, side = 0.6, drop = 2.2, far = [1.6, 4], frame = CARD_FRAME } = {}) {
  const order = cards.slice().sort((a, b) => b.rank - a.rank || a.key - b.key);
  const placed = [];
  const out = new Map();
  for (const c of order) {
    const w = Math.max(1e-6, c.x1 - c.x0), h = Math.max(1e-6, c.y1 - c.y0);
    const words = cardWords(c.text);
    // a card merged last time comes back only with room to spare (no blinking as the shot drifts)
    const g = c.merged ? gap * 2.5 : gap;
    let best = placeCard(c, w, h, placed, faces, g, side, drop, frame);
    if (best.hit) {
      const twin = !!words && placed.some((o) => o.words === words);
      if (!twin) best = placeCard(c, w, h, placed, faces, g, far[0], far[1], frame);
      if (twin || best.hit) {
        out.set(c.key, { dx: c.px ?? 0, dy: c.py ?? 0, merged: true });
        continue;
      }
    }
    if (frame) {
      // inside the frame, whatever the cost (a card wider than it: centred); clamped onto a card shown before it: merged
      best.dx = w >= frame.x1 - frame.x0 ? (frame.x0 + frame.x1) / 2 - (c.x0 + c.x1) / 2 : Math.min(frame.x1 - c.x1, Math.max(frame.x0 - c.x0, best.dx));
      best.dy = h >= frame.y1 - frame.y0 ? best.dy : Math.min(frame.y1 - c.y1, Math.max(frame.y0 - c.y0, best.dy));
      const r = { x0: c.x0 + best.dx, x1: c.x1 + best.dx, y0: c.y0 + best.dy, y1: c.y1 + best.dy };
      if (placed.some((o) => overlapArea(r, o) > 1e-9)) {
        out.set(c.key, { dx: c.px ?? 0, dy: c.py ?? 0, merged: true });
        continue;
      }
    }
    // the card of a bot behind another that still lies over that nearer face (no room to move off it): drawn on top it
    // would cover the face, so it stays down (as the nearer head hid it before); the first card always shows
    if (placed.length) {
      const r = { x0: c.x0 + best.dx, x1: c.x1 + best.dx, y0: c.y0 + best.dy, y1: c.y1 + best.dy };
      let over = 0;
      for (const f of faces) if (f.key !== c.key && f.depth < c.depth - 0.05) over += overlapArea(r, f);
      if (over > (c.merged ? 0.15 : 0.3) * w * h) {
        out.set(c.key, { dx: c.px ?? 0, dy: c.py ?? 0, merged: true });
        continue;
      }
    }
    out.set(c.key, { dx: best.dx, dy: best.dy, merged: false });
    placed.push({ x0: c.x0 + best.dx, x1: c.x1 + best.dx, y0: c.y0 + best.dy, y1: c.y1 + best.dy, words });
  }
  return out;
}

const cardWords = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();

// The cheapest move of card c (w by h) within (side, drop), clear of the cards placed (hit: it could not clear them),
// inside the frame (its moves to the frame's edges are tried too, beyond the reach; a move out of it costs).
function placeCard(c, w, h, placed, faces, gap, side, drop, frame = null) {
  const reachX = w * (1 + side) + gap, reachY = h * (drop + 1) + gap;
  const near = (o) => o.x1 > c.x0 - reachX && o.x0 < c.x1 + reachX && o.y1 > c.y0 - reachY && o.y0 < c.y1 + gap;
  const grow = (o, weight) => ({ x0: o.x0 - gap, x1: o.x1 + gap, y0: o.y0 - gap, y1: o.y1 + gap, weight, area: Math.max(1e-9, (o.x1 - o.x0) * (o.y1 - o.y0)) });
  const block = [
    ...placed.filter(near).map((o) => grow(o, 0)),
    ...faces.filter((f) => f.key !== c.key && near(f)).map((f) => grow(f, 1)),
  ];
  const xs = [0], ys = [0];
  for (const o of block) {
    xs.push(o.x1 - c.x0, o.x0 - c.x1);
    if (o.y0 < c.y1) ys.push(o.y0 - c.y1);
  }
  const inX = new Set(), inY = new Set();
  if (frame) {
    // the moves that bring a card hanging over the frame's edge back in (beyond the reach: the frame comes first)
    if (c.x0 < frame.x0) inX.add(frame.x0 - c.x0);
    if (c.x1 > frame.x1) inX.add(frame.x1 - c.x1);
    if (c.y0 < frame.y0) inY.add(frame.y0 - c.y0);
    if (c.y1 > frame.y1) inY.add(frame.y1 - c.y1);
    xs.push(...inX);
    ys.push(...inY);
  }
  const px = c.px ?? 0, py = c.py ?? 0;
  let best = null;
  for (const dx of xs) {
    if (Math.abs(dx) > side * w + 1e-9 && !inX.has(dx)) continue;
    for (const dy of ys) {
      if ((dy > 1e-9 || -dy > drop * h + 1e-9) && !inY.has(dy)) continue;
      const r = { x0: c.x0 + dx, x1: c.x1 + dx, y0: c.y0 + dy, y1: c.y1 + dy };
      let cost = Math.abs(dx) / w + (1.4 * Math.abs(dy)) / h + 0.3 * (Math.abs(dx - px) / w + Math.abs(dy - py) / h);
      if (frame) {
        const inside = overlapArea(r, frame);
        if (inside < w * h - 1e-9) cost += 50 + (100 * (w * h - inside)) / (w * h);
      }
      let hit = false;
      for (const o of block) {
        const a = overlapArea(r, o);
        if (a <= 0) continue;
        // another card: never (any overlap costs more than every move); a face: as little of it as a fair move buys
        if (o.weight) cost += (6 * a) / Math.min(o.area, w * h);
        else {
          cost += 100 + (100 * a) / (w * h);
          hit = true;
        }
      }
      if (!best || cost < best.cost - 1e-9) best = { dx, dy, cost, hit };
    }
  }
  return best;
}

const _m = {};
/**
 * Fits a shot (pos, look: changed in place) so every subject's head and card are in frame: card
 * bottoms above `floor`, head tops below `roof`, all within ±`side`. When they cannot fit, the camera
 * first steps back along its line of sight (unless `move` is false); then it tilts. cam: a scratch
 * PerspectiveCamera with the real camera's fov and aspect. Returns true when the shot fits.
 */
export function fitFrame(cam, pos, look, subjects, { floor = CARD_FLOOR, roof = HEAD_ROOM, side = SIDE, move = true } = {}) {
  if (!subjects.length) return true;
  const t = Math.tan((cam.fov * Math.PI) / 360);
  for (let it = 0; it < 8; it++) {
    const { lo, hi, wide } = measure(cam, pos, look, subjects, _m);
    if (lo >= floor - 1e-3 && hi <= roof + 1e-3 && wide <= side + 1e-3) return true;
    const need = Math.max((hi - lo) / (roof - floor), wide / side);
    if (move && need > 1.002) {
      _o.copy(pos).sub(look).multiplyScalar(Math.min(1.5, need * 1.03));
      pos.copy(look).add(_o);
      continue;
    }
    // tilt: a positive shift moves the subjects up the frame (the look point goes down)
    const shift = lo < floor ? floor - lo + 0.01 : hi > roof ? roof - hi - 0.01 : 0;
    if (!shift) return false;
    look.y -= shift * pos.distanceTo(look) * t;
  }
  const { lo, hi, wide } = measure(cam, pos, look, subjects, _m);
  return lo >= floor - 1e-3 && hi <= roof + 1e-3 && wide <= side + 1e-3;
}
