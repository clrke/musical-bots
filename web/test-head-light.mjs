// Headless checks for the heads' set lighting (stage.js -> head-material.js shared uniforms):
// the studio keeps its look (studio key, no cast, no lamps), a set's mood tints and levels the
// heads, the set's practicals / the party lamps / the follow spot become local lamps, and the
// result is a pure function of the dt sequence (frame-exact capture).
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { Stage } = await import('./src/scene/environments/stage.js');
const { SHARED_UNIFORMS: U, MAX_LOCAL, STUDIO_KEY } = await import('./src/scene/head-material.js');

function fakeSet() {
  const g = new THREE.Group();
  const add = (x, y, z, cd) => { const l = new THREE.PointLight(0xffaa66, cd, 0, 2); l.position.set(x, y, z); g.add(l); };
  add(0, 2.95, -0.4, 10); add(1.5, 2.4, -4.9, 6); add(-1.05, 1.7, -3.35, 9); add(1.05, 1.7, -3.35, 9); add(30, 3, 30, 1);
  return g;
}

function run(steps) {
  const scene = new THREE.Scene();
  const bot = { name: 'Blue', group: new THREE.Group(), unit: 0.1 };
  bot.group.position.set(0.5, 1.2, 0.9);
  const stage = new Stage({ scene, bots: new Map([['Blue', bot]]) });
  stage.adopt('diner', fakeSet());
  const snap = () => ({ key: U.uKeyC.value.toArray(), amb: U.uAmb.value.toArray(), exp: U.uExposure.value, n: U.uLocalN.value,
    pos: U.uLocalPos.value.slice(0, U.uLocalN.value).map((v) => v.toArray()), col: U.uLocalCol.value.slice(0, U.uLocalN.value).map((v) => v.toArray()) });
  const out = {};
  stage.show('studio');
  stage.update(1 / 30);
  out.studio = snap();
  stage.show('diner');
  stage.update(1 / 30);
  out.warm = snap();
  for (const [what, arg, secs] of steps) {
    if (what === 'mood') stage.mood(arg);
    if (what === 'spot') stage.spot(arg ? bot : null);
    for (let i = 0; i < secs * 30; i++) stage.update(1 / 30);
    out[`${what}-${arg}`] = snap();
  }
  return out;
}

const steps = [['mood', 'night', 2], ['mood', 'party', 2], ['spot', 1, 1], ['spot', 0, 1.5], ['mood', 'gold', 2]];
const a = run(steps);

// the studio: exactly the studio key, no cast, exposure 1, no lamps
assert.deepEqual(a.studio.key, [...STUDIO_KEY]);
assert.deepEqual(a.studio.amb, [1, 1, 1]);
assert.equal(a.studio.exp, 1);
assert.equal(a.studio.n, 0);

// warm diner: the set's practicals reach the heads (the strongest at the stage, at most 4); warm key
assert.ok(a.warm.n >= 1 && a.warm.n <= 4, `warm lamps ${a.warm.n}`);
assert.ok(a.warm.pos.slice(0, a.warm.n).every((p) => p[0] < 20), 'the far lamp is not taken');
assert.ok(a.warm.key[0] > a.warm.key[2], 'warm key');
assert.ok(Math.abs(a.warm.amb[0] - 1) < 0.05, 'warm keeps the reflection level');

// night: darker and bluer than warm
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const night = a['mood-night'];
assert.ok(lum(night.key) < 0.5 * lum(a.warm.key), 'night key dims');
assert.ok(night.key[2] > night.key[0] && night.amb[2] > night.amb[0], 'night is blue');
assert.ok(lum(night.amb) < 0.9, 'night reflections dim');

// party: the three party lamps join the set's lamps
const party = a['mood-party'];
assert.ok(party.n >= 3 + 1 && party.n <= MAX_LOCAL, `party lamps ${party.n}`);

// the spot: one more lamp, bright, above the bot; it goes away after the fade out
const spot = a['spot-1'];
assert.equal(spot.n, party.n + 1);
assert.ok(spot.pos[0][1] > 2.5 && spot.col[0][0] > 10, 'the spot lamp sits above, bright');
assert.equal(a['spot-0'].n, party.n);

// gold: warmer than warm
const g = a['mood-gold'];
assert.ok(g.key[2] / g.key[0] < a.warm.key[2] / a.warm.key[0], 'gold is warmer');

// deterministic: the same dt sequence gives the same uniforms
assert.deepEqual(run(steps), a);
console.log('head-light ok');
