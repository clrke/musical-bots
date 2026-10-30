import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Player, parseNdjson } from './src/player.js';
import { CAST16, LEGACY_NAMES, legacyNames, isLegacyBundle, modernBundle } from './src/cast16.js';
import { NAMES } from './src/gen/cast.js';
import { namesIn } from './src/cues.js';

const events = parseNdjson(readFileSync(new URL('../episodes/sample/events.ndjson', import.meta.url), 'utf8'));
const seen = [];
const p = new Player({ onEvent: (e) => seen.push(e.seq) });
p.load(events); p.play();
p.tick(0.5); assert.deepEqual(seen, [0]);
p.tick(4); assert.deepEqual(seen, [0, 1, 2]);
p.tick(100); assert.equal(seen.length, events.length); assert.ok(p.finished);
seen.length = 0; p.seek(5); assert.deepEqual(seen, [0, 1, 2]);

// the cast's colour names: one per face, all different, the same sixteen as the voices (gen/cast.js)
assert.deepEqual(CAST16.map((m) => m.name).sort(), [...NAMES].sort());
assert.equal(new Set(CAST16.map((m) => m.look.faceColor.toLowerCase())).size, 16, 'every face its own colour');
assert.deepEqual(Object.values(LEGACY_NAMES).sort(), [...NAMES].sort(), 'every old name maps to a colour');
for (const m of CAST16) assert.equal(LEGACY_NAMES[m.id.charAt(0).toUpperCase() + m.id.slice(1)], m.name, `${m.id} keeps its id`);

// a bundle directed before the rename plays in the colour names
const old = [
  { seq: 0, bot: 'Nora', agent: 'chords', summary: "I hand Teddy Lou's ladle", lyric: '', action: 'spot-Gigi', consult: ['Teddy'] },
  { seq: 1, bot: 'Teddy', singer: 'Lou', summary: 'I write it', lyric: '[And] {Lou:gasp} counts gold coins >> Ivy?', consult: [] },
];
assert.ok(isLegacyBundle(old) && isLegacyBundle({ roles: { lead: 'Teddy' } }) && isLegacyBundle({ beats: [{ cast: ['Benny', 'Lou'] }] }));
const now = modernBundle(old);
assert.deepEqual(now[0], { seq: 0, bot: 'White', agent: 'chords', summary: "I hand Green Gold's ladle", lyric: '', action: 'spot-Blue', consult: ['Green'] });
assert.equal(now[1].lyric, '[And] {Gold:gasp} counts gold coins >> Red?');
assert.equal(now[1].singer, 'Gold');
assert.deepEqual(parseNdjson(old.map((e) => JSON.stringify(e)).join('\n') + '\n'), now, 'parseNdjson reads an old bundle in the new names');
assert.equal(legacyNames('teddy-lyrics, a ray of light'), 'teddy-lyrics, a ray of light', 'ids and lower-case words stay');
// a bundle in the new names is left alone, even a word that was a name ("Ray" of light, the "Ivy" on the wall)
const fresh = [{ seq: 0, bot: 'Green', lyric: 'Ivy climbs the wall >> Ray of sun!' }];
assert.ok(!isLegacyBundle(fresh));
assert.equal(modernBundle(fresh), fresh);

// a name in text is the Capitalised word only; a colour opening a sentence is a name when it reads as one
assert.deepEqual(namesIn('We put a gold spot on Purple', NAMES), ['Purple']);
assert.deepEqual(namesIn('Paint the street blue, Blue!', NAMES), ['Blue']);
assert.deepEqual(namesIn('Gold counts every cent', NAMES), ['Gold']);
assert.deepEqual(namesIn("Gold's diner is warm", NAMES), ['Gold']);
assert.deepEqual(namesIn('Gold!', NAMES), ['Gold']);
assert.deepEqual(namesIn('Green, look at the green hill', NAMES), ['Green']);
assert.deepEqual(namesIn('Gold glow!', NAMES), [], 'the colour before its noun');
assert.deepEqual(namesIn('So bright. Gold and bright!', NAMES), [], 'the colour after a full stop');
assert.deepEqual(namesIn('the sky turns blue and gold', NAMES), []);
console.log('player ok: replay, seek, the colour names (16 faces, legacy bundles in the new names, names in text)');
