// Look B, the friendly heads (Soothing Bots 0.3.28; HANDOFF bot-visuals-and-six-four Part A §5.2 / §7), headless:
//   1. the style switch: friendly by default, classic on demand, the style in the head cache key;
//   2. no hardware in the friendly meshes (bolts, rivets, teeth, the jaw's pistons, the shutter's posts, the grille's
//      bars), the iris mouth built as lips, the jaw resting closed; the classic meshes as they were;
//   3. satin finishes (no chrome, no gunmetal: no mirror metal), one shader for both looks;
//   4. the friendly colours: all 16 apart, each still its name (Black the darkest, White the lightest, the hues),
//      drawn only (the cast's looks unchanged), other robots' palette colours mapped;
//   5. the softened face (no scowl, a smile at rest), and the triangle budget.
import assert from 'node:assert/strict';
import { CAST16, FRIENDLY } from './src/cast16.js';
import { FACE_SHAPES, EYE_SHAPES, MOUTH_SHAPES, BROW_SHAPES, PALETTE } from './src/model/schema.js';
import { buildHead, headKey } from './src/scene/mech/assemble.js';
import { BONE, MAT, rivet, hexBolt } from './src/scene/mech/builder.js';
import {
  CLASSIC, FRIENDLY as STYLE_FRIENDLY, headStyle, setHeadStyle, drawnLook, soften, mouthFor, FRIENDLY_FOR_PALETTE,
} from './src/scene/head-style.js';
import { FINISH_PARAMS, applyFinish, createHeadMaterial } from './src/scene/head-material.js';
import { CH, CHANNEL_COUNT, poseOf } from './src/scene/personality.js';
import { normalizeAppearance } from './src/scene/appearance.js';
import * as THREE from 'three';

// 1. the switch
assert.equal(headStyle(), STYLE_FRIENDLY, 'friendly by default (no ?look=classic)');
const jaw = { faceShape: 'dome', eyeShape: 'lens', browShape: 'bar', mouthShape: 'jaw', antenna: 'single' };
assert.ok(headKey(jaw).endsWith('|friendly'));
setHeadStyle('classic');
assert.equal(headKey(jaw), 'dome|lens|bar|jaw|single', 'the classic key as it was');
setHeadStyle(STYLE_FRIENDLY);

// per-vertex material and bone
function verts(head) {
  const m = head.geometry.getAttribute('aMat').array, k = head.geometry.getAttribute('aSkin').array;
  return Array.from({ length: m.length / 4 }, (_, i) => ({ mat: m[i * 4], bone: k[i * 4] }));
}
const count = (vs, f) => vs.filter(f).length;
const built = (style, a) => { setHeadStyle(style); const h = buildHead(a); setHeadStyle(STYLE_FRIENDLY); return h; };

// 2. no hardware
assert.equal(rivet(0.002).getAttribute('position').count, 0, 'no rivets');
assert.equal(hexBolt(0.002).getAttribute('position').count, 0, 'no bolts');
setHeadStyle(CLASSIC);
assert.ok(rivet(0.002).getAttribute('position').count > 0 && hexBolt(0.002).getAttribute('position').count > 0, 'classic keeps them');
setHeadStyle(STYLE_FRIENDLY);
const B = BONE.MOUTH;
const chromeOnJaw = (h) => count(verts(h), (v) => v.mat === MAT.CHROME && v.bone === BONE.JAW); // lower teeth, piston rods, chin rivets
const chromeOnLips = (h) => count(verts(h), (v) => v.mat === MAT.CHROME && v.bone >= B && v.bone < B + 10); // upper teeth, plate rivets
for (const [style, has] of [[CLASSIC, true], [STYLE_FRIENDLY, false]]) {
  const j = built(style, jaw);
  assert.equal(chromeOnJaw(j) > 0, has, `jaw: teeth / pistons ${has ? 'built' : 'left out'}`);
  assert.equal(chromeOnLips(j) > 0, has, `jaw: upper teeth ${has ? 'built' : 'left out'}`);
  const shutter = built(style, { ...jaw, mouthShape: 'shutter' });
  assert.equal(count(verts(shutter), (v) => v.bone === B + 12 || v.bone === B + 13) > 0, has, `shutter: end posts ${has ? 'built' : 'left out'}`);
  const grille = built(style, { ...jaw, mouthShape: 'grille' });
  assert.equal(count(verts(grille), (v) => v.bone >= B + 6 && v.bone <= B + 10) > 0, has, `grille: bars ${has ? 'built' : 'left out'}`);
  const iris = built(style, { ...jaw, mouthShape: 'iris' });
  assert.equal(iris.rig.mouth.type, has ? 'iris' : 'lips', 'the iris mouth: lips in the friendly look');
  assert.equal(count(verts(iris), (v) => v.mat === MAT.MOUTH_IRIS) > 0, has);
}
assert.equal(mouthFor('iris'), 'lips');
assert.equal(mouthFor('jaw'), 'jaw');
// bolts and rivets nowhere: the hex shell's big bolts and the box's rivet columns were its CHROME / STEEL studs on the shell
for (const faceShape of FACE_SHAPES) {
  const a = { ...jaw, faceShape, mouthShape: 'lips' };
  const c = built(CLASSIC, a), f = built(STYLE_FRIENDLY, a);
  assert.ok(f.triangles < c.triangles, `${faceShape}: the friendly head is lighter (${f.triangles} < ${c.triangles})`);
}
// the jaw rests closed: its chin plate meets the upper lip (no cavity gap showing at rest)
{
  const gapOf = (h) => {
    const p = h.geometry.getAttribute('position').array, m = h.geometry.getAttribute('aMat').array, k = h.geometry.getAttribute('aSkin').array;
    let top = -Infinity;
    for (let i = 0; i < m.length / 4; i++) if (m[i * 4] === MAT.LID && k[i * 4] === BONE.JAW) top = Math.max(top, p[i * 3 + 1]);
    return h.rig.mouth.mouthY - top;
  };
  const c = gapOf(built(CLASSIC, jaw)), f = gapOf(built(STYLE_FRIENDLY, jaw));
  assert.ok(f < c - 0.004 && f < 0.0025, `the friendly jaw rests closed (gap ${(f * 1000).toFixed(1)} mm, classic ${(c * 1000).toFixed(1)} mm)`);
}

// 3. satin finishes, one shader
const col = new THREE.Color(), fin = new THREE.Vector4();
for (const finish of Object.keys(FINISH_PARAMS)) {
  applyFinish('#9b9da2', finish, col, fin);
  assert.ok(fin.x <= 0.35 + 1e-9 && fin.y >= 0.24 - 1e-9, `${finish}: satin in the friendly look (metal ${fin.x}, rough ${fin.y})`);
  assert.equal(col.getHexString(), '9b9da2', `${finish}: the paint keeps its own colour (no silver or dark base mixed in)`);
}
setHeadStyle(CLASSIC);
applyFinish('#9b9da2', 'chrome', col, fin);
assert.equal(fin.x, 1, 'classic chrome is mirror metal');
setHeadStyle(STYLE_FRIENDLY);
const mat = createHeadMaterial();
assert.ok(mat.fragmentShader.includes('uStyle') && mat.uniforms.uStyle.value === STYLE_FRIENDLY, 'one program: the style is a shared uniform');
assert.equal(createHeadMaterial().uniforms.uStyle, mat.uniforms.uStyle, 'shared by every head');

// 4. the friendly colours
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, a: A, b: Bb, C: Math.hypot(A, Bb), h: ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360 };
}
const names = CAST16.map((m) => m.name);
assert.deepEqual(Object.keys(FRIENDLY).sort(), [...names].sort(), 'a friendly look for each of the 16');
const lab = Object.fromEntries(names.map((n) => [n, oklab(FRIENDLY[n].faceColor)]));
let minDe = Infinity, pair = null;
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const x = lab[names[i]], y = lab[names[j]];
  const d = Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
  if (d < minDe) { minDe = d; pair = [names[i], names[j]]; }
}
assert.ok(minDe >= 0.06, `all 16 faces apart: the closest pair ${pair} at ΔE ${minDe.toFixed(3)}`);
const Ls = names.map((n) => lab[n].L);
assert.equal(lab.Black.L, Math.min(...Ls), 'Black is the darkest');
assert.ok(lab.Black.L > 0.3 && lab.Black.L < 0.45, 'a soft charcoal, not near-black');
assert.equal(lab.White.L, Math.max(...Ls), 'White is the lightest');
for (const n of ['White', 'Silver', 'Gray', 'Black']) assert.ok(lab[n].C < 0.03, `${n} is a neutral`);
assert.ok(lab.Silver.L > lab.Gray.L + 0.08 && lab.Gray.L > lab.Black.L + 0.2, 'Silver lighter than Gray, Gray than Black');
assert.ok(lab.Navy.L < lab.Blue.L - 0.15, 'Navy darker than Blue');
assert.ok(lab.Copper.L < lab.Orange.L, 'Copper deeper than Orange');
const hue = { Red: [10, 40], Orange: [40, 65], Copper: [35, 65], Gold: [70, 92], Yellow: [88, 112], Green: [115, 150], Jade: [150, 185],
  Blue: [225, 258], Navy: [250, 280], Purple: [285, 312], Lilac: [290, 318] };
for (const [n, [a, b]] of Object.entries(hue)) assert.ok(lab[n].h >= a && lab[n].h <= b, `${n}: hue ${lab[n].h.toFixed(0)} in ${a}..${b}`);
assert.ok(lab.Pink.h >= 340 || lab.Pink.h <= 10, 'Pink is pink');
for (const n of names) {
  const f = FRIENDLY[n];
  assert.ok(!['chrome', 'gunmetal'].includes(f.finish), `${n}: no chrome or gunmetal`);
  if (f.finish === 'brass') assert.equal(n, 'Gold', 'brass only for Gold');
  if (n !== 'Black' && n !== 'Navy') assert.ok(oklab(f.accentColor).L < lab[n].L, `${n}: the trim a deeper shade of the paint`);
  if (n !== 'Black' && n !== 'Navy') assert.ok(lab[n].L >= 0.6, `${n}: pastel`);
}
// drawing only: the cast's looks are their data, the friendly colours come at draw time
for (const m of CAST16) {
  const d = drawnLook(normalizeAppearance(m.look));
  assert.equal(d.faceColor, FRIENDLY[m.name].faceColor, `${m.name} is drawn friendly`);
  assert.equal(d.faceShape, m.look.faceShape, `${m.name}: its parts stay`);
  assert.notEqual(m.look.faceColor, FRIENDLY[m.name].faceColor, `${m.name}: its look is unchanged`);
}
const stranger = normalizeAppearance({ faceShape: 'egg', faceColor: PALETTE[2], eyeColor: PALETTE[6], accentColor: '#123456', finish: 'chrome' });
const ds = drawnLook(stranger);
assert.deepEqual([ds.faceColor, ds.eyeColor, ds.accentColor, ds.finish], [FRIENDLY_FOR_PALETTE[2], FRIENDLY_FOR_PALETTE[6], '#123456', 'enamel'], 'another robot: palette mapped, off-palette kept, chrome as satin');
setHeadStyle(CLASSIC);
assert.equal(drawnLook(stranger), stranger, 'classic draws the look as it is');
setHeadStyle(STYLE_FRIENDLY);

// 5. the softened face
{
  const scowl = new Float32Array(CHANNEL_COUNT);
  scowl[CH.browTiltL] = -0.8; scowl[CH.browTiltR] = 0.2; scowl[CH.browSqueeze] = 1; scowl[CH.lidUpL] = 0.4; scowl[CH.mouthSmile] = -0.5; scowl[CH.pupilL] = 0.2;
  soften(scowl);
  assert.ok(scowl[CH.browTiltL] >= 0 && Math.abs(scowl[CH.browTiltL] - scowl[CH.browTiltR]) < 0.2, 'no scowl, no one-brow glare');
  assert.ok(scowl[CH.browSqueeze] <= 0.2 + 1e-6 && scowl[CH.lidUpL] < 0.15 && scowl[CH.mouthSmile] >= 0.45 - 1e-6 && scowl[CH.pupilL] >= 0.62 - 1e-6);
  const blink = new Float32Array(CHANNEL_COUNT); blink[CH.lidUpL] = 1;
  assert.equal(soften(blink)[CH.lidUpL], 1, 'a blink still closes');
  for (const m of CAST16) {
    const rest = soften(Float32Array.from(poseOf(m.personality)));
    assert.ok(rest[CH.mouthSmile] >= 0.45 - 1e-6 && rest[CH.browTiltL] >= 0, `${m.name}: a kind face at rest`);
  }
}

// triangle budget: every cast head under 12k, every parts combination no heavier than in the classic look
let castMax = 0;
for (const m of CAST16) castMax = Math.max(castMax, buildHead(m.look).triangles);
assert.ok(castMax <= 12000, `cast heads ${castMax} triangles`);
let fMax = 0, cMax = 0;
for (const faceShape of FACE_SHAPES) for (const eyeShape of EYE_SHAPES) for (const mouthShape of MOUTH_SHAPES) {
  const a = { faceShape, eyeShape, mouthShape, browShape: BROW_SHAPES[4], antenna: 'coil' };
  fMax = Math.max(fMax, built(STYLE_FRIENDLY, a).triangles);
  cMax = Math.max(cMax, built(CLASSIC, a).triangles);
}
assert.ok(fMax <= cMax, `the friendly heads are no heavier (max ${fMax} vs ${cMax})`);
console.log(`look ok: friendly by default, no hardware, iris as lips, the jaw closed, satin finishes, 16 faces apart (min ΔE ${minDe.toFixed(3)} ${pair.join('/')}), softened faces, cast max ${castMax} triangles (combos ${fMax} vs classic ${cMax})`);
