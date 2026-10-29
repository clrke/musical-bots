// Fireworks enrichment against a local stub of the chat-completions endpoint (no key, no network,
// no credits): the request carries the bearer key, the model and a strict JSON schema; good
// candidates replace their line everywhere it is sung (harmony stays identical); candidates that
// break a lyric rule, the syllable budget or the length cap are rejected and the original stands.
import assert from 'node:assert/strict';
import http from 'node:http';
import { cpSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let seen = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
    const { lines } = JSON.parse(seen.body.messages[1].content);
    const out = lines.map((l, i) => ({
      id: l.id,
      lyric: i === 0 ? 'Boxes stack up high on the street!' // good (6 -> 8 syllables)
        : i === 1 ? 'Listen, we hear it near!' // banned pronoun
        : i === 2 ? 'Benny finds the box beside the big old garden gate, then dances off and sings' // too long
        : l.lyric, // unchanged
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: out }) } }], usage: { total_tokens: 1 } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.FIREWORKS_BASE_URL = `http://127.0.0.1:${server.address().port}/inference/v1`;
const { enrichBundle, candidateProblems, SCHEMA } = await import('../scripts/enrich.js');

assert.deepEqual(candidateProblems('box on the street today!', 'Boxes stack up high on the street!'), []);
assert.ok(candidateProblems('Listen, box is near!', 'Listen, we hear it near!').includes('banned pronoun/all'));
assert.ok(candidateProblems('a b c', 'one two three four five six seven').some((p) => p.startsWith('syllables')));

const dir = mkdtempSync(join(tmpdir(), 'mb-enrich-'));
cpSync(new URL('./test-data/toy-box-v1', import.meta.url), dir, { recursive: true }); // a frozen v1 bundle (the curated ones are the director's now)
const before = readFileSync(join(dir, 'events.ndjson'), 'utf8');
const r = await enrichBundle(dir, { key: 'test-key' });
server.close();

assert.equal(seen.url, '/inference/v1/chat/completions');
assert.equal(seen.auth, 'Bearer test-key');
assert.equal(seen.body.response_format.type, 'json_schema');
assert.deepEqual(seen.body.response_format.json_schema.schema, SCHEMA);
assert.equal(r.accepted, 1);
assert.equal(r.rejected.length, 2);
const after = readFileSync(join(dir, 'events.ndjson'), 'utf8');
assert.notEqual(after, before);
const orig = before.split('\n').filter((l) => l.includes('"box on the street today!"')).length;
assert.ok(orig >= 2, 'the test line is sung more than once');
assert.equal(after.split('\n').filter((l) => l.includes('"Boxes stack up high on the street!"')).length, orig); // every copy
assert.ok(!after.includes('we hear it'));
assert.ok(existsSync(join(dir, 'enrich.json')));
console.log(`enrich ok: request shape, ${r.accepted} accepted (all ${orig} copies), ${r.rejected.length} rejected by the gates`);
