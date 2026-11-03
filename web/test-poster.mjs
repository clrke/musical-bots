// The episode poster (scripts/director/poster.js): Meta's Muse Image draws it from the episode's beats.json and a
// frame of our own bots. Here against a stub of the API (no network, no key): the prompt says the episode, the call
// is the images/edits one with the cast reference, the WebP lands as poster.webp, the key never shows in an error;
// and every curated episode has its poster checked in (a real WebP, small enough for a phone).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posterPrompt, makePoster, POSTER_MODEL, POSTER_FILE, VISION_MODEL } from '../scripts/director/poster.js';
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
let seen, chats = 0;
const WEBP2 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 8)]);
// a stand-in for the API: images/edits draws (the n-th call's bytes), chat/completions is Muse Spark reading the title back
const api = ({ reads, draws = [WEBP, WEBP2] }) => { const log = { draws: 0, chats: 0, last: null, bodies: [] };
  const fetchImpl = async (url, init) => {
    log.last = { url, init };
    if (url.endsWith('/images/edits')) { log.bodies.push(init.body); return new Response(JSON.stringify({ data: [{ b64_json: draws[log.draws++ % draws.length].toString('base64') }], output_format: 'webp' }), { status: 200 }); }
    if (url.endsWith('/chat/completions')) {
      const r = reads[log.chats++ % reads.length];
      if (r === 'fail') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, log }; };
// a title read back right: one draw, one Muse Spark vision call
let t = api({ reads: [{ title: 'HOT soup, day!', garbled: false }] });
const ok = await makePoster(dir, { key: KEY, base: 'https://stub.test/v1/', fetchImpl: t.fetchImpl });
assert.equal(ok.ok, true, ok.error);
assert.equal(ok.checked, true);
assert.equal(ok.redrawn, false);
assert.equal(t.log.draws, 1);
assert.equal(t.log.chats, 1);
const first = t.log.bodies[0];
assert.equal(first.get('model'), POSTER_MODEL);
assert.equal(first.get('prompt'), p);
assert.equal(first.get('image').type, 'image/jpeg', 'the cast reference goes with it');
assert.deepEqual(readFileSync(join(dir, POSTER_FILE)), WEBP);
// (the vision call: Muse Spark 1.3, the poster as an image_url part, the key as the bearer)
{ const seenChat = []; await makePoster(dir, { key: KEY, base: 'https://stub.test/v1', fetchImpl: async (url, init) => { if (url.endsWith('/chat/completions')) seenChat.push({ url, init }); return t.fetchImpl(url, init); } });
  const body = JSON.parse(seenChat[0].init.body);
  assert.equal(seenChat[0].url, 'https://stub.test/v1/chat/completions');
  assert.equal(seenChat[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(body.model, VISION_MODEL);
  assert.equal(body.messages[0].content[1].type, 'image_url');
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/webp;base64,/); }
// a misspelled title: drawn once more with the title stressed; the redraw stands when it reads right
t = api({ reads: [{ title: 'Hot Soop Dai', garbled: false }, { title: 'Hot Soup Day', garbled: false }] });
const dir3 = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir3, 'beats.json'), JSON.stringify(beats));
const again = await makePoster(dir3, { key: KEY, fetchImpl: t.fetchImpl });
assert.deepEqual([again.ok, again.checked, again.redrawn, t.log.draws, t.log.chats], [true, true, true, 2, 2]);
assert.ok(t.log.bodies[1].get('prompt').endsWith(`Spell the title exactly, letter for letter: "${beats.title}".`));
assert.deepEqual(readFileSync(join(dir3, POSTER_FILE)), WEBP2, 'the redraw');
// still wrong (or the vision says garbled) after the redraw: the first drawing stands, said so; never a loop
t = api({ reads: [{ title: 'Hot Soup Day', garbled: true }] });
const dir4 = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir4, 'beats.json'), JSON.stringify(beats));
const stuck = await makePoster(dir4, { key: KEY, fetchImpl: t.fetchImpl });
assert.deepEqual([stuck.ok, stuck.checked, stuck.redrawn, t.log.draws, t.log.chats], [true, false, true, 2, 2]);
assert.deepEqual(readFileSync(join(dir4, POSTER_FILE)), WEBP, 'the first drawing stands');
// the vision call fails: the poster stands, unchecked, no redraw
t = api({ reads: ['fail'] });
const dir5 = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir5, 'beats.json'), JSON.stringify(beats));
const blind = await makePoster(dir5, { key: KEY, fetchImpl: t.fetchImpl });
assert.deepEqual([blind.ok, blind.checked, blind.redrawn, t.log.draws], [true, null, false, 1]);
// --no check: no chat call at all
t = api({ reads: [{ title: 'x', garbled: false }] });
const dir6 = mkdtempSync(join(tmpdir(), 'mb-poster-'));
writeFileSync(join(dir6, 'beats.json'), JSON.stringify(beats));
assert.equal((await makePoster(dir6, { key: KEY, fetchImpl: t.fetchImpl, check: false })).checked, null);
assert.equal(t.log.chats, 0);

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
console.log(`poster ok: the Muse Image prompt and call and Muse Spark's title read-back with one redraw (stub), failures without the key, ${slugs.length} curated posters checked in, shipped to the sandbox`);
