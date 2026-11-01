// Headless checks for phones (viewport.js, and the framing on a narrow frame):
//   1. a desktop, a 16:9 capture (?cinema) and an iPad keep the designed frame (framing.js constants, untouched);
//   2. a phone's compact layout: the heads under its banner and notch, the cards above its bottom overlays, the safe
//      areas counted, landscape too, never looser than the designed frame;
//   3. the canvas's pixels: a desktop's as before, a phone's capped;
//   4. the portrait caps: groups of three at most, a two-shot only of bots standing near;
//   5. on a real 9:16 camera: three singers side by side in a group shot fit between the phone's limits, and their
//      cards (layoutCards) stay inside the frame, clear of each other, stacked down rather than off the sides.
import assert from 'node:assert/strict';
import * as THREE from 'three';

// --- minimal DOM stub (the lyrics panel draws on a 2D canvas; textures never load headless), as test-staging.mjs
function stub2d() {
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return (s) => ({ width: 22 * String(s ?? '').length });
      return () => undefined;
    },
    set() { return true; },
  });
}
globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }) };
globalThis.Image = class { set src(v) { /* never loads headless */ } };

const V = await import('./src/viewport.js');
const F = await import('./src/framing.js');
const { Bot } = await import('./src/rig.js');
const { NAMES } = await import('./src/gen/cast.js');

const designed = { roof: F.HEAD_ROOM, makingRoof: F.MAKING_ROOF, floor: F.CARD_FLOOR, side: F.SIDE };
const pick = (l) => ({ roof: l.roof, makingRoof: l.makingRoof, floor: l.floor, side: l.side });

// 1. the designed frame where it was designed for
{
  for (const [w, h] of [[1920, 1080], [1440, 900], [2560, 1440], [1280, 720], [1180, 820]]) {
    const l = V.screenLayout({ w, h });
    assert.equal(l.compact, false, `${w}x${h} is not compact`);
    assert.deepEqual(pick(l), designed, `${w}x${h}: the designed limits`);
    assert.equal(l.groupMax, Infinity);
    assert.equal(l.twoSpan, Infinity);
    assert.equal(l.lowPower, false);
  }
  // the frame-exact capture: always the designed frame, whatever the window
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390]]) {
    const l = V.screenLayout({ w, h, cinema: true, coarse: true, safe: { top: 47, bottom: 34 } });
    assert.deepEqual(pick(l), designed, `cinema ${w}x${h}`);
    assert.equal(l.compact, false);
    assert.equal(l.lowPower, false);
    assert.equal(l.groupMax, Infinity);
  }
  // an iPad: its touch screen draws lighter, the layout is the designed one
  const ipad = V.screenLayout({ w: 820, h: 1180, coarse: true });
  assert.equal(ipad.compact, false);
  assert.deepEqual(pick(ipad), designed);
  assert.equal(ipad.lowPower, true);
}

// 2. a phone: the overlays' room kept, in NDC, as the CSS lays them out (index.html html.compact)
{
  const ndc = (px, h) => 1 - (2 * px) / h;
  const p = V.screenLayout({ w: 390, h: 844, coarse: true });
  assert.ok(p.compact && p.portrait);
  assert.equal(p.top, 6 + V.BANNER_H.portrait + 6);
  assert.ok(Math.abs(p.makingRoof - ndc(p.top, 844)) < 1e-9, 'the making-of heads under the banner');
  assert.ok(p.makingRoof < F.MAKING_ROOF);
  assert.ok(Math.abs(p.floor - -ndc(p.bottom, 844)) < 1e-9, 'the cards above the bottom band');
  assert.ok(p.floor >= F.CARD_FLOOR && p.roof <= F.HEAD_ROOM, 'never looser than the designed frame');
  assert.ok(p.bottom >= V.BOTTOM_PX[0] && p.bottom <= V.BOTTOM_PX[1]);
  // the notch and the home bar push both bands in
  const notch = V.screenLayout({ w: 393, h: 852, coarse: true, safe: { top: 59, bottom: 34 } });
  assert.equal(notch.top, 59 + V.BANNER_H.portrait + 6);
  assert.ok(notch.makingRoof < p.makingRoof && notch.floor > p.floor && notch.roof < p.roof);
  // landscape: a short banner, a taller share of the height for the bottom band, still a usable middle
  const l = V.screenLayout({ w: 844, h: 390, coarse: true });
  assert.ok(l.compact && !l.portrait);
  assert.equal(l.top, 6 + V.BANNER_H.landscape + 6);
  assert.ok(l.makingRoof - l.floor > 0.9, `landscape keeps ${(l.makingRoof - l.floor).toFixed(2)} of the frame's 2 for the shot`);
  // a small Android, a narrow desktop window
  assert.ok(V.screenLayout({ w: 360, h: 800, coarse: true }).compact);
  assert.ok(V.screenLayout({ w: 600, h: 900 }).compact);
}

// 3. the pixels drawn
{
  for (const [w, h, dpr] of [[1920, 1080, 1], [1440, 900, 2], [2560, 1440, 2], [1280, 720, 3]]) {
    assert.equal(V.pixelRatioFor({ dpr, w, h }), Math.min(dpr, 2), `desktop ${w}x${h}@${dpr}`);
  }
  for (const [w, h, dpr] of [[390, 844, 3], [360, 800, 3], [844, 390, 3], [820, 1180, 2], [1024, 1366, 2]]) {
    const r = V.pixelRatioFor({ dpr, w, h, mobile: true });
    assert.ok(r >= 1 && r <= 2, `${w}x${h}: ratio ${r}`);
    assert.ok(w * h * r * r <= V.MOBILE_PIXELS + 1 || r === 1, `${w}x${h}: ${Math.round(w * h * r * r)} px`);
  }
  assert.equal(V.pixelRatioFor({ dpr: 1, w: 390, h: 844, mobile: true }), 1, 'never more than the screen has');
}

// 4. the portrait caps
{
  assert.equal(V.groupMax(9 / 16), 3);
  assert.equal(V.groupMax(390 / 844), 3);
  assert.equal(V.groupMax(1), 5);
  assert.equal(V.groupMax(16 / 9), Infinity);
  assert.equal(V.twoShotSpan(16 / 9), Infinity);
  assert.ok(V.twoShotSpan(9 / 16) < V.twoShotSpan(1));
}

// 5. a real 9:16 camera: three singers side by side (a chorus) framed as main.js frames a group shot, within the phone's
//    limits; their cards laid out (layoutCards) inside the frame, clear of each other
{
  const lim = V.screenLayout({ w: 390, h: 844, coarse: true });
  const cam = new THREE.PerspectiveCamera(40, 390 / 844, 0.1, 100);
  const names = ['Green', 'Navy', 'Gold'];
  const bots = names.map((n, i) => new Bot(n, new THREE.Vector3(-0.75 + i * 0.75, 1.2, 0), NAMES.indexOf(n)));
  const words = ['Hands stack high in the glow, so high', 'Hands stack high in the glow, so high', 'Up high!'];
  bots.forEach((b, i) => b.sing(2.2, words[i], null, { part: i ? 'harmony' : 'lead' }));
  for (let f = 0; f < 30; f++) for (const b of bots) b.update(1 / 30, f / 30);
  const pos = new THREE.Vector3(0, 1.6, 3), look = new THREE.Vector3(0, 1.1, 0);
  assert.equal(lim.side, V.PORTRAIT_SIDE);
  assert.ok(F.fitFrame(cam, pos, look, bots, { floor: lim.floor, roof: lim.roof, side: lim.side, maxFace: F.SHOT_FACE.group }), 'the group fits a portrait frame');
  const m = F.measure(cam, pos, look, bots);
  assert.ok(m.hi <= lim.roof + 1e-3 && m.lo >= lim.floor - 1e-3 && m.wide <= lim.side + 1e-3, JSON.stringify(m));
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  const seen = bots.map((b) => [b, F.screenCard(cam, b)]);
  const cards = seen.filter(([, s]) => s.card).map(([b, s], i) => ({ key: b.index, rank: i ? 3 : 4, depth: s.depth, ...s.card }));
  const faces = seen.map(([b, s]) => ({ key: b.index, depth: s.depth, ...s.face }));
  assert.equal(cards.length, 3);
  const moves = F.layoutCards(cards, faces, { gap: 0.02 });
  const shown = cards.filter((c) => !moves.get(c.key).merged).map((c) => {
    const mv = moves.get(c.key);
    return { x0: c.x0 + mv.dx, x1: c.x1 + mv.dx, y0: c.y0 + mv.dy, y1: c.y1 + mv.dy, key: c.key };
  });
  assert.ok(shown.length >= 2, `${shown.length} cards shown (the twin line may merge into its lead's)`);
  assert.ok(!moves.get(cards[0].key).merged, "the lead's card always shows");
  const area = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    assert.ok(r.x0 >= F.CARD_FRAME.x0 - 1e-6 && r.x1 <= F.CARD_FRAME.x1 + 1e-6 && r.y0 >= F.CARD_FRAME.y0 - 1e-6 && r.y1 <= F.CARD_FRAME.y1 + 1e-6, `card ${r.key} inside the frame`);
    for (let j = i + 1; j < shown.length; j++) assert.ok(area(r, shown[j]) <= 1e-9, `cards ${r.key} and ${shown[j].key} clear of each other`);
  }
  // each card shown is readable on an 844 px tall phone: 16 px tall at least (a one-line card's text ~11 px, on a 3x screen)
  for (const r of shown) assert.ok(((r.y1 - r.y0) / 2) * 844 >= 16, `card ${r.key}: ${(((r.y1 - r.y0) / 2) * 844).toFixed(1)} px tall`);
}

console.log('mobile ok: the designed frame on desktops, iPads and captures; a phone\'s limits from its banner, notch and bottom band (portrait and landscape); the pixels capped on touch screens; groups of three and near two-shots in portrait; three singers and their cards fit a 9:16 frame');
