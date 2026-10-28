// Headless checks for the ported heads: personalities compile + step finite,
// every cast look builds geometry, every particle preset simulates.
import assert from 'node:assert/strict';
import { CAST16 } from './src/cast16.js';
import { PERSONALITIES, PERSONALITY_IDS, PARTICLE_PRESETS } from './src/model/schema.js';
import {
  CHANNEL_COUNT, PERSONALITY_STYLES, RETIRED_PERSONALITIES, VOWEL_SHAPES,
  createExpression, createExpressionInput, normalizePersonality, poseOf, stepExpression,
} from './src/scene/personality.js';
import { normalizeAppearance, normalizeParticles } from './src/scene/appearance.js';
import { acquireHead, releaseHead } from './src/scene/mech/assemble.js';
import { PRESET_DEFS } from './src/scene/particles/presets.js';
import { createParticleField } from './src/scene/particles/field.js';

const finite = (arr, what) => {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${what}[${i}] not finite`);
};

// 1. all 20 personalities compile; retired ids map
assert.equal(PERSONALITY_IDS.length, 20);
assert.deepEqual(Object.keys(PERSONALITY_STYLES).sort(), [...PERSONALITY_IDS].sort());
assert.equal(normalizePersonality('grumpy'), 'wistful');
assert.equal(normalizePersonality('sassy'), 'gentle');
assert.equal(normalizePersonality('bogus'), 'cheerful');
for (const [k, v] of Object.entries(RETIRED_PERSONALITIES)) assert.ok(PERSONALITY_STYLES[v], `retired ${k} -> missing ${v}`);

// 2. every cast member: pose + 5 s of expression steps stay finite
const out = new Float32Array(CHANNEL_COUNT);
for (const m of CAST16) {
  assert.ok(PERSONALITIES[m.personality], `${m.name}: unknown personality ${m.personality}`);
  finite(poseOf(m.personality), `${m.name} rest`);
  finite(poseOf(m.personality, { level: 0.8, vowel: 'o' }), `${m.name} sing`);
  finite(poseOf(m.personality, { reaction: 'select', at: 0.4 }), `${m.name} select`);
  const s = createExpression(m.personality, 7);
  const input = createExpressionInput();
  for (let f = 0; f < 300; f++) {
    input.level = 0.5 + 0.5 * Math.sin(f * 0.05);
    input.vowel = VOWEL_SHAPES.a;
    input.syllable = f % 30 === 0;
    stepExpression(s, 1 / 60, input, out);
    if (f % 60 === 0) finite(out, `${m.name} step@${f}`);
  }
  finite(out, `${m.name} final`);
}

// 3. every cast look builds head geometry with skin + material attributes
for (const m of CAST16) {
  const h = acquireHead(normalizeAppearance(m.look));
  const g = h.geometry;
  assert.ok(g.getAttribute('position').count > 100, `${m.name}: too few verts`);
  assert.ok(g.getAttribute('aSkin'), `${m.name}: missing aSkin`);
  assert.ok(g.getAttribute('aMat'), `${m.name}: missing aMat`);
  assert.ok(g.index.count / 3 < 15000, `${m.name}: too many tris`);
  releaseHead(h);
}

// 4. every particle preset simulates without NaN and emits (level 1, 4 s)
const field = createParticleField({ maxEmitters: 1, perEmitter: 256, seed: 3 });
const emitter = field.createEmitter();
for (const id of PARTICLE_PRESETS) {
  if (id === 'none') continue;
  assert.ok(PRESET_DEFS[id], `missing def ${id}`);
  emitter.configure(normalizeParticles({ preset: id }), 0.13);
  emitter.setLevel(1);
  for (let f = 0; f < 240; f++) field.update(1 / 60, f / 60);
  const stats = field.stats();
  assert.ok(stats.particles + stats.segments > 0, `${id}: emitted nothing`);
  emitter.setLevel(0);
  for (let f = 0; f < 120; f++) field.update(1 / 60, 10 + f / 60);
}
console.log('heads ok: 20 personalities, 16 looks, 23 presets');
