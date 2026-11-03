// The episode poster (scripts/director/poster.js): Meta's Muse Image draws it from the episode's beats.json and a
// frame of our own bots. Here against a stub of the API (no network, no key): the prompt says the episode, the call
// is the images/edits one with the cast reference, the WebP lands as poster.webp, the key never shows in an error;
// and every curated episode has its poster checked in (a real WebP, small enough for a phone).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posterPrompt, makePoster, POSTER_MODEL, POSTER_FILE } from '../scripts/director/poster.js';
import { SEEDS } from './src/curated.js';
import { directorFiles } from '../server/runner.js';

const EP = new URL('./public/episodes/', import.meta.url).pathname;
const beats = JSON.parse(readFileSync(join(EP, 'hot-soup', 'beats.json'), 'utf8'));
const KEY = 'sk-poster-test-0123456789-SECRET';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 7)]);

// the prompt
const p = posterPrompt(beats);
assert.ok(p.includes(`"${beats.title}"`), 'names the title');
assert.ok(p.includes(beats.prompt), 'tells the story');
assert.match(p, /reference image/);
assert.match(p, /Featured: the \w+, .*the gold/, 'the cast by colour');
assert.match(p, /cozy diner/, 'the opening set');

// a call, against the stub
const dir = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir, 'beats.json'), JSON.stringify(beats));
let seen;
const ok = await makePoster(dir, { key: KEY, base: 'https://stub.test/v1/', fetchImpl: async (url, init) => {
  seen = { url, init };
  return new Response(JSON.stringify({ data: [{ b64_json: WEBP.toString('base64') }], output_format: 'webp' }), { status: 200 });
} });
assert.equal(ok.ok, true, ok.error);
assert.equal(seen.url, 'https://stub.test/v1/images/edits');
assert.equal(seen.init.headers.authorization, `Bearer ${KEY}`);
assert.equal(seen.init.body.get('model'), POSTER_MODEL);
assert.equal(seen.init.body.get('prompt'), p);
assert.equal(seen.init.body.get('image').type, 'image/jpeg', 'the cast reference goes with it');
assert.deepEqual(readFileSync(join(dir, POSTER_FILE)), WEBP);

// failures: no key, a rejected key (never echoed), not a WebP; none throws, none writes
const dir2 = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir2, 'beats.json'), JSON.stringify(beats));
assert.deepEqual(await makePoster(dir2, { key: '' }), { ok: false, error: 'no META_API_KEY' });
const bad = await makePoster(dir2, { key: KEY, fetchImpl: async () => new Response(`invalid key ${KEY}`, { status: 401 }) });
assert.equal(bad.ok, false);
assert.ok(!bad.error.includes(KEY) && bad.error.includes('[redacted]') && bad.error.includes('401'), bad.error);
const png = await makePoster(dir2, { key: KEY, fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('\x89PNG....').toString('base64') }] })) });
assert.deepEqual(png, { ok: false, error: 'Muse Image returned no WebP image' });
const thrown = await makePoster(dir2, { key: KEY, fetchImpl: async () => { throw new Error(`socket closed for ${KEY}`); } });
assert.ok(!thrown.ok && !thrown.error.includes(KEY), thrown.error);
assert.ok(!existsSync(join(dir2, POSTER_FILE)), 'nothing written on a failure');

// every curated episode's poster is checked in: a WebP, under 400 KB
const slugs = readdirSync(EP).filter((d) => existsSync(join(EP, d, 'beats.json')) && d !== 'sample');
assert.equal(slugs.length, SEEDS.length);
for (const s of slugs) {
  const f = join(EP, s, POSTER_FILE);
  assert.ok(existsSync(f), `${s}: no poster`);
  const b = readFileSync(f);
  assert.ok(b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', `${s}: not a WebP`);
  assert.ok(statSync(f).size < 400 * 1024, `${s}: ${statSync(f).size} bytes`);
}
// a hosted run's sandbox gets everything the poster needs (server/runner.js ships the director's files)
const shipped = directorFiles().map((f) => f.path);
for (const f of ['scripts/director/poster.js', 'scripts/director/poster-ref.jpg']) assert.ok(shipped.includes(f), `${f} reaches the sandbox`);
assert.ok(directorFiles().find((f) => f.path === 'scripts/director/poster-ref.jpg').content.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'as a JPEG');
console.log(`poster ok: the Muse Image prompt and call (stub), failures without the key, ${slugs.length} curated posters checked in, shipped to the sandbox`);
