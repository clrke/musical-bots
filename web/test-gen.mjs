// The offline generator: deterministic protocol v2 story bundles that validate, follow the story-song
// form (11 sections, 4-line stanzas, Hook X Hook Y choruses), keep the prompt's subject and named cast,
// sing well (short lines, short replies, no /ks/ endings where avoidable) and keep the lyric rules.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { generate, toNdjson } from './src/gen/index.js';
import { parsePrompt } from './src/gen/prompt.js';
import { lyricProblems } from './src/gen/rules.js';
import { lineProblems, endsKs, catchphrase } from './src/gen/lyrics.js';
import { CAST, NAMES } from './src/gen/cast.js';
import { FORM } from './src/song/form.js';
import { parseLyric, plainLyric } from './src/cues.js';
import { resolveAction } from './src/actions.js';
import { SEEDS } from './src/curated.js';
import { hashString } from './src/gen/rng.js';

const PROMPTS = [
  'Blue brings home the biggest toy box on the street',
  'Black swaps Navy a truck for magic beans',
  'all of us will go to a gun fight at Disney', // adversarial
  '',
  'Silver delivers the cake in the rain',
  'A dragon learns to dance',
  ...SEEDS.map(([, p]) => p),
];
const SETS = new Set(['studio', 'diner', 'big_house', 'street', 'village', 'winter', 'haunted', 'beach', 'pool', 'pier', 'ocean']);
for (const p of PROMPTS) {
  const a = toNdjson(generate(p).events), b = toNdjson(generate(p).events);
  assert.equal(a, b, `determinism: ${JSON.stringify(p)}`);
  const { beats, events } = generate(p);
  // beats.json v2
  assert.equal(beats.version, 2);
  assert.ok(beats.title && typeof beats.title === 'string');
  for (const k of ['lead', 'pal', 'grown', 'rival']) assert.ok(NAMES.includes(beats.roles[k]), `${p}: roles.${k}`);
  assert.equal(new Set(Object.values(beats.roles)).size, 4, `${p}: four different roles`);
  assert.ok(['suspense', 'tender'].includes(beats.tags.bridge));
  assert.deepEqual(beats.beats.map((x) => x.section), FORM);
  for (const x of beats.beats) assert.ok(SETS.has(x.set), `${p}: set ${x.set}`);
  // the stanzas: 2 intro lines, 4 a section; the choruses Hook X Hook Y (chorus 3: Hook X Hook Turn)
  const by = (s) => events.filter((e) => e.beat.endsWith(`-${s}`));
  assert.equal(by('intro').length, 2);
  for (const s of FORM.slice(1)) assert.equal(by(s).length, 4, `${p}: ${s} stanza`);
  for (const s of ['chorus1', 'chorus2', 'chorus3']) {
    const c = by(s);
    assert.equal(c[0].lyric, c[2].lyric, `${p}: ${s} sings its hook twice`);
    assert.ok(c[0].with?.length, `${p}: ${s} is sung together`);
  }
  assert.equal(by('chorus3')[3].singer, beats.roles.grown, `${p}: the grown-up sings the turn`);
  assert.equal(by('outro')[0].lyric, by('chorus1')[0].lyric, `${p}: the outro opens with the hook`);
  for (const s of ['bridge', 'bridge2']) assert.ok(by(s).filter((e) => e.singer === beats.roles.grown).length >= 3, `${p}: ${s} is the grown-up's`);
  assert.ok(events.filter((e) => e.status === 'consulting' && e.consult.length).length >= 2, 'needs >=2 consultations');
  for (const e of events) {
    for (const f of ['summary', 'lyric']) assert.deepEqual(lyricProblems(f === 'lyric' ? plainLyric(e[f]) : e[f]), [], `${f} "${e[f]}" for ${JSON.stringify(p)}`);
    assert.deepEqual(lineProblems(e.lyric), [], `${p}: "${e.lyric}" sings badly`);
    assert.ok(NAMES.includes(e.singer), `${p}: singer ${e.singer}`);
    assert.ok(!e.with || e.with.every((n) => NAMES.includes(n) && n !== e.singer));
    assert.ok(!e.action || resolveAction(e.action).kind !== 'none', `${p}: action ${e.action}`);
    assert.ok(Object.values({ lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue', deals: 'Gold', hype: 'Yellow', comedy: 'Pink' }).includes(e.bot), 'bot is a role bot');
    for (const c of parseLyric(e.lyric, NAMES).cues) assert.ok(NAMES.includes(c.name));
  }
  const dir = mkdtempSync(`${tmpdir()}/gen-`);
  writeFileSync(`${dir}/beats.json`, JSON.stringify(beats)); writeFileSync(`${dir}/events.ndjson`, a);
  execFileSync('node', [new URL('../scripts/validate-bundle.js', import.meta.url).pathname, dir]);
}
assert.notEqual(toNdjson(generate(PROMPTS[0]).events), toNdjson(generate(PROMPTS[1]).events));

// the prompt's subject and named cast (plot coherence)
assert.equal(parsePrompt('Gold sells hot soup on a cold day').subject, 'hot soup');
assert.equal(parsePrompt('Gold sells hot soup on a cold day').when, 'a cold day');
assert.equal(parsePrompt('Blue brings home the biggest toy box on the street').subject, 'toy box');
assert.equal(parsePrompt('Green trades lunch for a dinosaur book').subject, 'dinosaur book');
assert.equal(parsePrompt('Copper paints the fence bright yellow').subject, 'fence');
assert.equal(parsePrompt('Jade races Orange around the block').object, 'Orange');
// a colour word is no name: only the Capitalised one is the bot
assert.deepEqual(parsePrompt('Copper paints the fence bright yellow').names, ['Copper']);
assert.equal(parsePrompt('Copper paints the fence bright yellow').colour, 'bright yellow');
assert.deepEqual(parsePrompt('A robot paints the street blue').names, []);
assert.deepEqual(parsePrompt('Green finds a gold coin at Gold\'s diner').names, ['Green']);
assert.equal(parsePrompt('Green finds a gold coin at Gold\'s diner').subject, 'gold coin');
const soup = generate('Gold sells hot soup on a cold day');
assert.equal(soup.beats.roles.grown, 'Gold', 'Gold is in his song');
assert.ok(soup.events.filter((e) => /hot soup/i.test(e.lyric)).length >= 6, 'the song is about hot soup');
assert.ok(!soup.events.some((e) => /\bcold\b/.test(e.lyric) && !/cold day/.test(e.lyric)), 'not about "cold"');
assert.ok(soup.beats.beats.every((b) => b.set === 'diner'));
const box = generate('Blue brings home the biggest toy box on the street');
assert.equal(box.beats.roles.grown, 'Blue');
assert.ok(box.events.every((e) => !/(^|[^y] )box\b/i.test(plainLyric(e.lyric)) || /toy box/i.test(plainLyric(e.lyric))), 'the full noun phrase: "toy box", never a bare "box"');
assert.deepEqual([...new Set(box.beats.beats.map((b) => b.set))], ['big_house', 'street'], 'the story moves from the house to the street');
assert.equal(generate('Jade races Orange around the block').beats.roles.lead, 'Jade');
assert.equal(generate('Jade races Orange around the block').beats.roles.grown, 'Orange');
assert.equal(generate('Black learns to share the red truck').beats.roles.lead, 'Black');
assert.equal(generate('Yellow calls the big parade downtown').beats.beats[0].set, 'street');
// /ks/ endings only where the line has no other way (the toy box sings "The toy box! Blue brings it")
assert.ok(endsKs('toy box') && endsKs('snacks') && !endsKs('Black') && !endsKs('toy box home'));
for (const p of SEEDS.map(([, x]) => x)) {
  const ks = generate(p).events.filter((e) => endsKs(parseLyric(e.lyric).text)).length;
  assert.ok(ks <= 4, `${p}: ${ks} lines end on /ks/`);
}
assert.equal(CAST.Yellow.says, "And they're off!");
assert.equal(catchphrase('Yellow'), "And they're off!");
assert.equal(catchphrase('Blue'), 'Who wants a surprise?');

// golden: pinned hash of the first prompt's bundle
assert.equal(hashString(toNdjson(generate(PROMPTS[0]).events)), 1093043589, 'golden bundle hash changed');
console.log('gen ok');
