// The lyric pass (scripts/director/wonder-lyrics.js): Meta's Muse Wonder writes an episode's sung lyrics, against a local
// stub of the Meta Model API's chat completions (no key, no network, no credits). The frozen crew-written Hot Soup bundle
// goes in; the stub answers like Muse Wonder would (lines it wrote for the story's drafts). Checked:
//   - the request: the bearer key, muse-wonder-1.0, a strict JSON schema, the rules in the system prompt, every line the
//     lyricist may write and the ones that stay (the hook, the plot's trouble lines);
//   - the gates: a line in the future tense is sent back with its problem (only that line, in the next round) and the
//     rewrite is used; a line that never passes stays as the crew wrote it, and so does its rhyme partner when they no
//     longer rhyme;
//   - the song form: the hook and the plot's trouble lines stay, chorus 2 repeats chorus 1's new words, the outro calls
//     back the intro's new first line; every other field of every event is untouched; the full gate passes;
//   - cost: tokens and dollars at Muse Wonder's price; failures (no key, a rejected key never echoed, an answer with nothing
//     usable, a gate-breaking answer) leave the bundle exactly as it was.
import assert from 'node:assert/strict';
import http from 'node:http';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wonderLyrics, WONDER_MODEL, WONDER_PRICE, usdOf, slotsOf } from '../scripts/director/wonder-lyrics.js';
import { checkBundle } from '../scripts/director/emit.js';
import { parseNdjson } from './src/player.js';
import { parseLyric } from './src/cues.js';
import { NAMES } from '../scripts/director/vocab.js';
import { directorFiles } from '../server/runner.js';

const FIX = new URL('./test-data/hot-soup-crew/', import.meta.url);
const STUB = JSON.parse(readFileSync(new URL('wonder-stub.json', FIX), 'utf8'));
const KEY = 'sk-wonder-test-0123456789-SECRET';
const USAGE = { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 300 } };
const perCall = ((1000 - 200) * WONDER_PRICE.input + 200 * WONDER_PRICE.cached + 500 * WONDER_PRICE.output) / 1e6;

/** A stand-in for the Meta Model API: `answer(requestBody, n)` -> { status, content } for the n-th call. */
async function serve(answer) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      calls.push({ url: req.url, auth: req.headers.authorization, body: b });
      const { status = 200, content, raw } = answer(b, calls.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(raw ?? JSON.stringify({ choices: [{ message: { content } }], usage: USAGE }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { calls, base: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'mb-wonder-')); cpSync(FIX, d, { recursive: true }); return d; };
const drafts = (body) => [...body.messages.at(-1).content.matchAll(/WRITE (L\d+), line \d of \d(?:, sung by \w+)?: crew's draft "(.*)"$/gm)].map((m) => ({ id: m[1], draft: m[2] }));
const reply = (lines) => ({ content: JSON.stringify({ lines }) });
const read = (d) => parseNdjson(readFileSync(join(d, 'events.ndjson'), 'utf8'));
const beats = JSON.parse(readFileSync(new URL('beats.json', FIX), 'utf8'));
const originals = parseNdjson(readFileSync(new URL('events.ndjson', FIX), 'utf8'));
const NEVER = 'We cannot taste the last >> Why not?'; // the stub keeps answering this draft with a line the gates refuse
const SOON = 'We want soup for all >> Yes!'; // answered in the future tense once, then right

// 1. the slots of the song --------------------------------------------------------------------------------------------
{
  const slots = slotsOf(beats, originals);
  assert.equal(slots.length, 42);
  const free = slots.filter((s) => s.free);
  assert.ok(free.length >= 24 && free.length < 42, `${free.length} lines to write`);
  for (const s of slots.filter((x) => x.section === 'chorus2')) assert.ok(!s.free, 'chorus 2 repeats chorus 1');
  for (const s of slots.filter((x) => x.plot)) assert.ok(!s.free, 'the plot\'s trouble lines stay');
  assert.ok(slots.filter((x) => x.section === 'chorus1' && (x.pos === 0 || x.pos === 2)).every((s) => !s.free), 'the hook stays');
  assert.ok(slots.find((x) => x.section === 'outro' && x.pos === 1).source, 'the outro calls back the intro');
}

// 2. a song written: retried line, a line that never passes, the form followed, the full gate -------------------------------
{
  const dir = fresh();
  const api = await serve((body, n) => {
    const out = drafts(body).map(({ id, draft }) => {
      if (draft === NEVER) return { id, lyric: 'I taste the last >> Why not?' }; // "I": the cast sings as one
      if (draft === SOON && n === 1) return { id, lyric: 'We will want soup >> Yes!' }; // future tense
      return { id, lyric: STUB[draft] ?? draft };
    });
    return reply(out);
  });
  const r = await wonderLyrics(dir, { key: KEY, base: api.base });
  api.close();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.model, WONDER_MODEL);
  // the request
  const first = api.calls[0];
  assert.equal(first.url, '/v1/chat/completions');
  assert.equal(first.auth, `Bearer ${KEY}`);
  assert.equal(first.body.model, WONDER_MODEL);
  assert.equal(first.body.response_format.type, 'json_schema');
  assert.equal(first.body.messages[0].role, 'system');
  assert.match(first.body.messages[0].content, /plain present tense/);
  assert.match(first.body.messages[0].content, /never "I" or "my"/);
  assert.match(first.body.messages[1].content, /Hot Soup Day|Hot Soup/);
  assert.match(first.body.messages[1].content, /The hook \(sung in every chorus, already fixed\): "Hot soup, hot soup!"/);
  assert.ok(!first.body.messages[1].content.includes(KEY));
  // the repair round: only the lines sent back, with their problems
  assert.ok(api.calls.length >= 2, `${api.calls.length} calls`);
  const second = api.calls[1].body.messages.at(-1).content;
  assert.match(second, /Rewrite only these lines/);
  assert.match(second, /We will want soup >> Yes!/);
  assert.match(second, /future tense/);
  assert.ok(drafts(api.calls[1].body).length < drafts(first.body).length, 'only the failing lines go again');
  // what was written
  const after = read(dir);
  assert.equal(after.length, originals.length);
  const sung = (list) => list.filter((e) => e.lyric).map((e) => e.lyric);
  assert.ok(r.written >= 10, `${r.written} lines written`);
  assert.equal(sung(after).filter((l, i) => l !== sung(originals)[i]).length, r.written);
  assert.ok(sung(after).includes(STUB[SOON]), 'the retried line is Muse Wonder\'s');
  assert.ok(sung(after).includes(NEVER) || r.kept_lines.includes(NEVER), 'a line that never passes stays the crew\'s');
  for (const [i, e] of after.entries()) { const { lyric, ...rest } = e, { lyric: l0, ...rest0 } = originals[i]; assert.deepEqual(rest, rest0, `event ${i}: only its lyric may change`); }
  // the form: the hook and the trouble lines as they were, chorus 2 repeats chorus 1, the outro calls back the intro
  const slots = slotsOf(beats, after);
  const at = (sec, pos) => parseLyric(slots.find((s) => s.section === sec && s.pos === pos).original, NAMES).text;
  const was = slotsOf(beats, originals);
  for (const s of was.filter((x) => !x.free && !x.source && x.section !== 'chorus2')) assert.equal(slots[s.id.slice(1) - 1].original, s.original, `${s.id} (${s.section} ${s.pos}) stays`);
  for (const pos of [0, 1, 2, 3]) assert.equal(at('chorus2', pos), at('chorus1', pos), `chorus 2 line ${pos + 1}`);
  assert.equal(at('outro', 1), at('intro', 0), 'the callback');
  assert.equal(checkBundle(dir).ok, true, checkBundle(dir).problems.join('; '));
  // the cost
  assert.equal(r.usage.calls, api.calls.length);
  assert.equal(r.usage.input_tokens, 1000 * api.calls.length);
  assert.equal(r.usage.reasoning_tokens, 300 * api.calls.length);
  assert.ok(Math.abs(r.usd - perCall * api.calls.length) < 1e-4, `${r.usd} vs ${perCall * api.calls.length}`);
  assert.ok(Math.abs(usdOf(r.usage) - perCall * api.calls.length) < 1e-9);
}

// 3. failures leave the bundle as it was ---------------------------------------------------------------------------------
{
  const dir = fresh();
  const same = () => assert.equal(readFileSync(join(dir, 'events.ndjson'), 'utf8'), readFileSync(new URL('events.ndjson', FIX), 'utf8'));
  assert.deepEqual((await wonderLyrics(dir, { key: '' })).error, 'no META_API_KEY');
  // a rejected key (the host echoes it): never in the report
  let api = await serve(() => ({ status: 401, raw: `invalid key ${KEY}` }));
  let r = await wonderLyrics(dir, { key: KEY, base: api.base });
  api.close();
  assert.equal(r.ok, false);
  assert.match(r.error, /Muse Wonder 401/);
  assert.ok(!r.error.includes(KEY) && r.error.includes('[redacted]'), r.error);
  same();
  // an answer with nothing usable, then lines that all fail the gates
  api = await serve(() => reply([]));
  r = await wonderLyrics(dir, { key: KEY, base: api.base });
  api.close();
  assert.equal(r.ok, false);
  assert.match(r.error, /no line passed/);
  assert.equal(api.calls.length, 5, 'four repair rounds, then the crew\'s lyrics stand');
  same();
  api = await serve((body) => reply(drafts(body).map(({ id }) => ({ id, lyric: 'We will sing a song for you tonight' }))));
  r = await wonderLyrics(dir, { key: KEY, base: api.base });
  api.close();
  assert.equal(r.ok, false);
  same();
  // a model that answers prose: an error, nothing changed
  api = await serve(() => ({ content: 'Sure! Here are some lyrics.' }));
  r = await wonderLyrics(dir, { key: KEY, base: api.base });
  api.close();
  assert.equal(r.ok, false);
  same();
  // a dry run writes nothing
  api = await serve((body) => reply(drafts(body).map(({ id, draft }) => ({ id, lyric: STUB[draft] ?? draft }))));
  r = await wonderLyrics(dir, { key: KEY, base: api.base, dry: true });
  api.close();
  assert.equal(r.ok, true);
  assert.equal(r.dry, true);
  assert.ok(r.written > 0);
  same();
}
// a hosted run's sandbox gets the lyric pass and everything it imports (server/runner.js ships the director's files)
{
  const shipped = new Set(directorFiles().map((f) => f.path));
  for (const f of ['scripts/director/wonder-lyrics.js', 'scripts/director/emit.js', 'scripts/director/craft.js', 'web/src/gen/index.js', 'web/src/player.js', 'web/src/cues.js']) assert.ok(shipped.has(f), `${f} reaches the sandbox`);
}
console.log('wonder ok: the request (key, model, schema, rules), a future-tense line sent back and rewritten, a line that never passes stays the crew\'s, the form followed (hook and trouble stay, chorus 2 and the callback repeat), the full gate, cost at Muse Wonder\'s price, failures leave the bundle as it was');
