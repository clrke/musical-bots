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
 * Where a bot's head and card are (world): { x, z, top, cardTop, cardBottom, half }. The card (two
 * lines at most, PANEL_H tall, up to PANEL_W wide) hangs from the head's caption line and moves with
 * the head (acting's offsets included); `top` is the head's top, its antenna included.
 */
export function cardBounds(bot, out = {}) {
  const k = bot.group.scale.x || 1;
  const s = bot.headScale ?? 1;
  const mech = bot.head?.mech;
  const top = mech?.top ?? 0.15, captionTop = mech?.captionTop ?? -0.12;
  const g = bot.head?.group;
  if (g) g.getWorldPosition(_w);
  else _w.copy(bot.group.position);
  out.x = _w.x;
  out.z = _w.z;
  out.top = _w.y + k * top * s + 0.03; // + its float
  out.cardTop = _w.y + k * captionTop * s;
  out.cardBottom = out.cardTop - k * PANEL_H;
  out.half = k * PANEL_W * 0.46;
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
      _p.set(c.x + _r.x * c.half * sx, c.cardBottom, c.z + _r.z * c.half * sx).project(cam);
      lo = Math.min(lo, _p.y);
      wide = Math.max(wide, Math.abs(_p.x));
    }
  }
  out.lo = lo;
  out.hi = hi;
  out.wide = wide;
  return out;
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
