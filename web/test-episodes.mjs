// Every checked-in bundle validates and plays to the end. Sample is the hand-written Phase-0 fixture
// and only owes the structural gates. The 13 curated episodes (web/src/curated.js) are the Muse Code
// director's v2 story songs, and owe it all:
//   - their prompt is the curated one (the app finds them) and director.json records a passed gate,
//     the Muse version and model, the time and the seven role subagents' work;
//   - the director's own gate passes again here (scripts/director/emit.js checkBundle: every stanza
//     complete, the song form and its rhymes, the lyric rules and line limits, the plain present, no
//     self-naming, >=2 consultations, all seven roles);
//   - the arranger turns each into a song of the 11 sections that ends, every story line sung.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Player, parseNdjson } from './src/player.js';
import { SEEDS } from './src/curated.js';
import { arrange } from './src/sing-plan.js';
import { checkBundle } from '../scripts/director/emit.js';
import { SECTIONS, ROLES } from '../scripts/director/vocab.js';

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
  checked++;
}
assert.ok(checked >= 14, `expected sample + 13 curated, found ${checked}`);

let songs = 0;
for (const [slug, prompt] of SEEDS) {
  const path = `${root}/${slug}`;
  const beats = JSON.parse(readFileSync(`${path}/beats.json`, 'utf8'));
  const events = parseNdjson(readFileSync(`${path}/events.ndjson`, 'utf8'));
  assert.equal(beats.version, 2, `${slug}: a v2 story song`);
  assert.equal(beats.prompt, prompt, `${slug}: the curated prompt`);
  assert.deepEqual(beats.beats.map((b) => b.section), SECTIONS, `${slug}: the 11 sections in order`);
  assert.ok(existsSync(`${path}/director.json`), `${slug}: director.json`);
  const dj = JSON.parse(readFileSync(`${path}/director.json`, 'utf8'));
  assert.equal(dj.gate.ok, true, `${slug}: the director's gate passed`);
  assert.ok(dj.muse.version && dj.muse.model, `${slug}: the Muse version and model are recorded`);
  assert.ok(dj.wallSeconds > 0 && dj.usage.total.input_tokens > 0, `${slug}: time and tokens are recorded`);
  for (const r of ROLES) assert.ok(dj.perRole[r].events > 0, `${slug}: ${r} worked`);
  const gate = checkBundle(path);
  assert.ok(gate.ok, `${slug}: ${gate.problems.join('; ')}`);
  // the stream is the song's order and the making-of's real timeline
  const order = events.map((e) => beats.beats.findIndex((b) => b.id === e.beat));
  assert.ok(order.every((k, i) => k >= 0 && (i === 0 || k >= order[i - 1])), `${slug}: beat order`);
  // the premiere: the arranger sings every story line, section by section, to an end
  const song = arrange(events, beats);
  assert.ok(song.end > 60, `${slug}: the song lasts (${song.end.toFixed(1)} s)`);
  assert.deepEqual(song.sections.map((s) => s.beat), beats.beats.map((b) => b.id), `${slug}: every section is arranged`);
  const sung = new Set(song.lines.filter((l) => l.layer === 'story').map((l) => l.seq));
  const lines = events.filter((e) => e.lyric);
  assert.equal(lines.length, 42, `${slug}: 42 story lines`);
  assert.ok(lines.every((e) => sung.has(e.seq)), `${slug}: every story line is sung`);
  songs++;
}
console.log(`episodes ok: ${checked} bundles play end to end; ${songs} curated director songs pass the gate and arrange`);
