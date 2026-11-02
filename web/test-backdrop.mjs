// The backdrops use the bots' colour theory (cast16.js FRIENDLY, scene/color-theory.js): one soft
// OKLCH band (L 0.40-0.95: pastel, nothing neon), each set still its own mood, night as a soft navy
// and charcoal instead of near-black, party pinks as the cast's own pink/red. Headless:
// every colour in SETS (lights + env), MOODS, the painted skies, the party lamps, the scene
// backgrounds and the follow spots sits in the friendly band.
import assert from 'node:assert/strict';
import { SETS, MOODS } from './src/scene/environments/sets.js';
import { SKIES, PARTY_COLORS, BACKDROP_BACKGROUNDS, SPOT_COLORS } from './src/scene/environments/stage.js';

// Independent oracle (same maths as test-look.mjs, not imported from the source under test).
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, Bb) };
}

const L_MIN = 0.4, L_MAX = 0.95, C_MAX = 0.16;
function check(hex, where) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${where}: a hex colour`);
  const { L, C } = oklab(hex.toLowerCase());
  assert.ok(L >= L_MIN && L <= L_MAX, `${where} ${hex}: L ${L.toFixed(3)} in ${L_MIN}..${L_MAX}`);
  assert.ok(C <= C_MAX, `${where} ${hex}: C ${C.toFixed(3)} <= ${C_MAX} (nothing neon)`);
}

let n = 0;
for (const [name, def] of Object.entries(SETS)) {
  const lights = def.lights;
  if (!lights) continue;
  check(lights.hemi.sky, `${name} hemi sky`); n++;
  check(lights.hemi.ground, `${name} hemi ground`); n++;
  check(lights.key.color, `${name} key`); n++;
  for (const [k, v] of Object.entries(lights.env)) {
    if (k === 'key') continue;
    check(v, `${name} env ${k}`); n++;
  }
}
for (const [mood, def] of Object.entries(MOODS)) {
  check(def.tint, `mood ${mood}`); n++;
}
for (const [sky, def] of Object.entries(SKIES)) {
  check(def.zenith, `sky ${sky} zenith`); n++;
  check(def.horizon, `sky ${sky} horizon`); n++;
  check(def.glow, `sky ${sky} glow`); n++;
}
for (const c of PARTY_COLORS) { check(c, 'party lamp'); n++; }
for (const [k, v] of Object.entries(BACKDROP_BACKGROUNDS)) { check(v, `background ${k}`); n++; }
for (const [k, v] of Object.entries(SPOT_COLORS)) { check(v, `spot ${k}`); n++; }

// night still reads as night: its zenith the darkest sky, day the lightest; moods keep their order.
const L = (hex) => oklab(hex.toLowerCase()).L;
assert.ok(L(SKIES.night.zenith) < L(SKIES.dusk.zenith), 'night darker than dusk');
assert.ok(L(SKIES.dusk.zenith) < L(SKIES.day.zenith), 'dusk darker than day');
assert.ok(L(MOODS.night.tint) < L(MOODS.bright.tint), 'night tint darker than bright');

console.log(`backdrop ok: ${n} backdrop colours in the friendly band (L ${L_MIN}..${L_MAX}, C <= ${C_MAX})`);
