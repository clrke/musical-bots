import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { generate, toNdjson } from './src/gen/index.js';
import { lyricProblems } from './src/gen/rules.js';

const PROMPTS = [
  'Gigi brings home the biggest toy box on the street',
  'Knox swaps Benny a truck for magic beans',
  'all of us will go to a gun fight at Disney', // adversarial
  '',
  'Murphy delivers the cake in the rain',
];
for (const p of PROMPTS) {
  const a = toNdjson(generate(p).events), b = toNdjson(generate(p).events);
  assert.equal(a, b, `determinism: ${JSON.stringify(p)}`);
  const { beats, events } = generate(p);
  assert.equal(beats.beats.length, 11);
  assert.ok(events.filter((e) => e.status === 'consulting' && e.consult.length).length >= 2, 'needs >=2 consultations');
  for (const e of events) for (const f of ['summary', 'lyric']) {
    assert.deepEqual(lyricProblems(e[f]), [], `${f} "${e[f]}" for ${JSON.stringify(p)}`);
  }
  const dir = mkdtempSync(`${tmpdir()}/gen-`);
  writeFileSync(`${dir}/beats.json`, JSON.stringify(beats)); writeFileSync(`${dir}/events.ndjson`, a);
  execFileSync('node', [new URL('../scripts/validate-bundle.js', import.meta.url).pathname, dir]);
}
assert.notEqual(toNdjson(generate(PROMPTS[0]).events), toNdjson(generate(PROMPTS[1]).events));
// golden: pinned hash of the first prompt's bundle
import { hashString } from './src/gen/rng.js';
assert.equal(hashString(toNdjson(generate(PROMPTS[0]).events)), 3354911623, 'golden bundle hash changed');
console.log('gen ok');
