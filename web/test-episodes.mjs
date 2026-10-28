// Every checked-in bundle validates, plays to the end, and (curated ones)
// stages >=2 consultations. Sample is the hand-written Phase-0 fixture and
// only owes the structural gates.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Player, parseNdjson } from './src/player.js';

const root = new URL('../episodes', import.meta.url).pathname;
const dirs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() || d.isSymbolicLink())
  .map((d) => d.name);
let checked = 0;
for (const dir of dirs) {
  const path = `${root}/${dir}`;
  let events;
  try {
    events = parseNdjson(readFileSync(`${path}/events.ndjson`, 'utf8'));
  } catch {
    continue; // not a bundle dir
  }
  execFileSync('node', [new URL('../scripts/validate-bundle.js', import.meta.url).pathname, path]);
  const seen = [];
  const p = new Player({ onEvent: (e) => seen.push(e.seq) });
  p.load(events);
  p.play();
  p.tick(100000);
  assert.ok(p.finished, `${dir} stalls`);
  assert.equal(seen.length, events.length, `${dir} drops events`);
  if (dir !== 'sample') {
    const consulting = events.filter((e) => e.status === 'consulting' && e.consult.length);
    assert.ok(consulting.length >= 2, `${dir} has ${consulting.length} consultations`);
  }
  checked++;
}
assert.ok(checked >= 13, `expected sample + 12 curated, found ${checked}`);
console.log(`episodes ok: ${checked} bundles play end to end`);
