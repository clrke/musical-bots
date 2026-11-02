// Role labels below the lyrics texts (lyrics-panel.js, rig.js): every sung line's card shows its
// singer's cast role under the words, dimmed and never karaoke-highlighted. Headless: a recording
// 2D-context stub captures exactly what the panel draws.
import assert from 'node:assert/strict';
import * as THREE from 'three';

const fills = [];
function stub2d() {
  return {
    measureText: (s) => ({ width: 9 * String(s ?? '').length }),
    fillText: (t, x, y, mw) => { fills.push({ t: String(t), x, y, mw }); },
    clearRect: () => {},
    font: '', textBaseline: '', textAlign: '', fillStyle: '',
  };
}
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => stub2d() }) };

const { createLyricsPanel, PANEL_W, PANEL_H } = await import('./src/scene/lyrics-panel.js');
const { Bot } = await import('./src/rig.js');
const { CAST16_BY_NAME } = await import('./src/cast16.js');

const line = (text, role) => ({ text, syllables: text.split(' ').map((w) => ({ text: w })), role });

// 1. the rig attaches the singer's cast role to the line
for (const name of ['Silver', 'Green']) {
  const b = new Bot(name, new THREE.Vector3(0, 1, 0), 0);
  b.sing(2.2, 'Just my luck in the rain', null, { part: 'lead' });
  assert.equal(b._line.role, CAST16_BY_NAME[name].role, `${name}'s line carries its role`);
}
assert.equal(CAST16_BY_NAME.Silver.role, 'Delivery driver');

// 2. the panel draws the role below the words; the strip reads as dimmed, never highlighted
{
  fills.length = 0;
  const p = createLyricsPanel();
  p.setLine(line('Just my luck in the rain', 'Delivery driver'));
  p.update(0.016, 1000);
  assert.equal(fills.length, 2, `one lyric line plus the role (${JSON.stringify(fills.map((f) => f.t))})`);
  assert.equal(fills[0].t, 'Just my luck in the rain');
  assert.equal(fills[1].t, 'Delivery driver');
  assert.ok(fills[1].y > fills[0].y, 'the role sits below the words');
  const u = p.mesh.material.uniforms;
  assert.ok(u.uRoleY.value >= 0, 'the role strip is marked for dimming');
  for (let i = 0; i < 6; i++) {
    p.setProgress(i);
    assert.ok(u.uCur.value.y > u.uRoleY.value, `syllable ${i}'s highlight stays above the role`);
  }
}

// 3. no role: the card as before (words only, no dim strip)
{
  fills.length = 0;
  const p = createLyricsPanel();
  p.setLine(line('Just my luck in the rain'));
  p.update(0.016, 1000);
  assert.deepEqual(fills.map((f) => f.t), ['Just my luck in the rain']);
  assert.equal(p.mesh.material.uniforms.uRoleY.value, -1);
}

// 4. the role is part of the redraw key: a changed role redraws, the same line twice does not
{
  fills.length = 0;
  const p = createLyricsPanel();
  p.setLine(line('Hi there', 'Delivery driver'));
  p.update(0.016, 1000);
  assert.equal(fills.length, 2);
  p.setLine(line('Hi there', 'Delivery driver'));
  p.update(0.016, 1200);
  assert.equal(fills.length, 2, 'the same line and role draws once');
  p.setLine(line('Hi there', 'Food-truck chef'));
  p.update(0.016, 1400);
  assert.equal(fills.length, 4, 'a changed role redraws');
  assert.equal(fills[3].t, 'Food-truck chef');
}

// 5. the card grows with the role but never overflows the panel; a long role squeezes to fit
{
  const plain = createLyricsPanel(), roled = createLyricsPanel();
  plain.setLine(line('Hi there'));
  roled.setLine(line('Hi there', 'Delivery driver'));
  plain.update(0.016, 1000);
  roled.update(0.016, 1000);
  assert.ok(roled.cardSize.h > plain.cardSize.h, 'the role strip adds height');
  assert.ok(roled.cardSize.h <= PANEL_H && roled.cardSize.w <= PANEL_W, `fits the panel (${JSON.stringify(roled.cardSize)})`);
  fills.length = 0;
  const long = createLyricsPanel();
  long.setLine(line('Hi there', 'x'.repeat(60)));
  long.update(0.016, 1000);
  const role = fills.at(-1);
  assert.equal(role.mw, 512 - 2 * Math.round(0.013 * (512 / 0.4)), 'a long role squeezes to the card');
  // the quad keeps an edge margin around the card, so a full-width card reads a hair over PANEL_W
  assert.ok(role.x >= 0 && long.cardSize.w <= PANEL_W * (512 + 2 * 3) / 512 + 1e-9, 'no overflow');
}

// 6. the back row's single-line card: one lyric line plus the role, still inside the panel
{
  fills.length = 0;
  const p = createLyricsPanel({ maxLines: 1 });
  p.setLine(line('A very long line that must shrink onto one row for the back', 'Delivery driver'));
  p.update(0.016, 1000);
  assert.equal(fills.length, 2, `one lyric line plus the role (${JSON.stringify(fills.map((f) => f.t))})`);
  assert.equal(fills[1].t, 'Delivery driver');
  assert.ok(fills[1].y > fills[0].y && p.cardSize.h <= PANEL_H, 'below the words, inside the panel');
}

console.log('role-label ok: every card shows its singer\u2019s cast role below the words, dimmed, fitted, redrawn on change');
