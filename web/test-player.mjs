import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Player, parseNdjson } from './src/player.js';

const events = parseNdjson(readFileSync(new URL('../episodes/sample/events.ndjson', import.meta.url), 'utf8'));
const seen = [];
const p = new Player({ onEvent: (e) => seen.push(e.seq) });
p.load(events); p.play();
p.tick(0.5); assert.deepEqual(seen, [0]);
p.tick(4); assert.deepEqual(seen, [0, 1, 2]);
p.tick(100); assert.equal(seen.length, events.length); assert.ok(p.finished);
seen.length = 0; p.seek(5); assert.deepEqual(seen, [0, 1, 2]);
console.log('player ok');
