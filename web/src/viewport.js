// The screen the page plays on: a desktop or a TV-shaped frame (the shots and overlays as designed for 16:9, and the
// frame-exact capture), or a phone (compact: the overlays stacked small and kept out of the notch and the home bar, the
// shots framed between them; portrait: groups held tighter). Pure: no DOM, so it is tested headless (test-mobile.mjs).
import { CARD_FLOOR, HEAD_ROOM, MAKING_ROOF, SIDE } from './framing.js';

/** A phone-sized layout: the short side at most this (CSS px), or a narrow window. */
export const COMPACT_SHORT = 560, COMPACT_WIDTH = 700;
/** The making-of's banner on a phone (index.html: its fixed height, CSS px, by layout). */
export const BANNER_H = Object.freeze({ portrait: 92, landscape: 58 });
/** The bottom overlays on a phone (the caption, Play, the lower third): the share of the height kept for them, and px bounds. */
export const BOTTOM_SHARE = Object.freeze({ portrait: 0.17, landscape: 0.3 }), BOTTOM_PX = Object.freeze([96, 168]);
/** The most bots a group shot or an establishing wide holds in a narrow frame (aspect w/h): fewer, bigger faces. */
export function groupMax(aspect) {
  if (!(aspect > 0)) return Infinity;
  return aspect < 0.8 ? 3 : aspect < 1.25 ? 5 : Infinity;
}
/**
 * The widest apart (m, across the floor) a two-shot's bots may stand in a narrow frame (aspect w/h): farther apart, both
 * faces and cards would be a sliver of a phone's width, so the shot is the singer's close-up instead.
 */
export function twoShotSpan(aspect) {
  if (!(aspect > 0)) return Infinity;
  return aspect < 0.8 ? 1.25 : aspect < 1.25 ? 2.2 : Infinity;
}
/**
 * The widest |x| (NDC) a head or card may reach in a portrait frame: the framing's card estimate (framing.js cardBounds,
 * 0.92 of a card's widest) is the card itself there (a close-up is as wide as its card), so the widest card is kept in.
 */
export const PORTRAIT_SIDE = 0.86;
/** The pixels the canvas draws (CSS px x ratio): a desktop's as ever (2x at most); a phone's at most MOBILE_PIXELS. */
export const MOBILE_PIXELS = 1.7e6;
export function pixelRatioFor({ dpr = 1, w, h, mobile = false }) {
  const r = Math.min(dpr || 1, 2);
  if (!mobile || !(w * h > 0)) return r;
  return Math.max(1, Math.min(r, Math.sqrt(MOBILE_PIXELS / (w * h))));
}

/**
 * The layout for a w x h CSS px viewport. coarse: a touch screen; cinema: a frame-exact capture (always the designed
 * layout); safe: the safe-area insets ({ top, right, bottom, left } px: the notch, the home bar). Returns { compact,
 * portrait, aspect, roof, makingRoof, floor, side (the widest |x|, NDC) (NDC: the heads' top edge in the premiere and in the making-of, the cards'
 * lowest), top, bottom (px kept for the overlays: the CSS reads them), groupMax, twoSpan, lowPower }. Not compact: the designed
 * constants (framing.js), unchanged.
 */
export function screenLayout({ w, h, coarse = false, cinema = false, safe = {} }) {
  const aspect = w > 0 && h > 0 ? w / h : 16 / 9;
  const portrait = aspect < 1;
  const compact = !cinema && w > 0 && h > 0 && (Math.min(w, h) <= COMPACT_SHORT || w <= COMPACT_WIDTH);
  // (a touch screen: a phone or a tablet; a desktop keeps its full quality whatever its memory)
  const lowPower = !cinema && coarse;
  const base = { compact, portrait, aspect, roof: HEAD_ROOM, makingRoof: MAKING_ROOF, floor: CARD_FLOOR, side: SIDE, top: 0, bottom: 0,
    groupMax: cinema ? Infinity : groupMax(aspect), twoSpan: cinema ? Infinity : twoShotSpan(aspect), lowPower };
  if (!compact) return base;
  const st = Math.max(0, safe.top ?? 0), sb = Math.max(0, safe.bottom ?? 0);
  const shape = portrait ? 'portrait' : 'landscape';
  const top = Math.max(6, st) + BANNER_H[shape] + 6;
  const bottom = Math.round(Math.min(BOTTOM_PX[1], Math.max(BOTTOM_PX[0], h * BOTTOM_SHARE[shape])) + sb);
  const ndc = (px) => 1 - (2 * px) / h;
  return {
    ...base, top, bottom,
    // the premiere's heads under the notch (its controls are hidden), the making-of's under its banner, every card above
    // the bottom overlays; never looser than the designed frame
    roof: Math.min(HEAD_ROOM, ndc(Math.max(6, st) + 6)),
    makingRoof: Math.min(MAKING_ROOF, ndc(top)),
    floor: Math.max(CARD_FLOOR, -ndc(bottom)),
    side: portrait ? PORTRAIT_SIDE : SIDE,
  };
}
