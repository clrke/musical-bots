// Every checked-in bundle validates and plays to the end. Sample is the hand-written Phase-0 fixture
// and only owes the structural gates. The 14 curated episodes (web/src/curated.js) are the Muse Code
// director's v2 story songs, and owe it all:
//   - their prompt is the curated one (the app finds them) and director.json records a passed gate,
//     the Muse version and model, the time and the seven role subagents' work;
//   - the director's own gate passes again here (scripts/director/emit.js checkBundle: every stanza
//     complete, the song form and its rhymes, the lyric rules and line limits, the plain present, no
//     self-naming, >=2 consultations, all seven roles); a bundle with the later fields keeps them
//     right (first-person summaries, `answers`, `bypassed`, director.json's craft record);
//   - the arranger turns each into a song of the 11 sections that ends, every story line sung.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Player, parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { SEEDS } from './src/curated.js';
import { arrange } from './src/sing-plan.js';
import { checkBundle, summaryProblems, talkProblems, answerProblems, craftRecordProblems, crewOf } from '../scripts/director/emit.js';
import { troublesOf, MIN_TROUBLES } from './src/plot-trouble.js';
import { MODES } from '../scripts/director/craft.js';
import { SECTIONS, ROLES } from '../scripts/director/vocab.js';
import { CONSULT_MOVES, MOVES, MAX_MOVE_SYLLABLES } from './src/consultation.js';
import { writtenTimes } from './src/activity-lines.js';

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
assert.ok(checked >= 15, `expected sample + 14 curated, found ${checked}`);

let songs = 0;
for (const [slug, prompt] of SEEDS) {
  const path = `${root}/${slug}`;
  const beats = modernBundle(JSON.parse(readFileSync(`${path}/beats.json`, 'utf8'))); // old names read in the colour ones
  const events = parseNdjson(readFileSync(`${path}/events.ndjson`, 'utf8'));
  assert.equal(beats.version, 2, `${slug}: a v2 story song`);
  assert.equal(beats.prompt, prompt, `${slug}: the curated prompt`);
  assert.deepEqual(beats.beats.map((b) => b.section), SECTIONS, `${slug}: the 11 sections in order`);
  assert.ok(existsSync(`${path}/director.json`), `${slug}: director.json`);
  const dj = JSON.parse(readFileSync(`${path}/director.json`, 'utf8'));
  assert.equal(dj.gate.ok, true, `${slug}: the director's gate passed`);
  assert.ok(dj.muse.version && dj.muse.model, `${slug}: the Muse version and model are recorded`);
  assert.ok(dj.wallSeconds > 0 && dj.usage.total.input_tokens > 0, `${slug}: time and tokens are recorded`);
  for (const r of crewOf(beats)) assert.ok(dj.perRole[r].events > 0, `${slug}: ${r} worked`); // (the run's roles: beats.json crew)
  const gate = checkBundle(path);
  assert.ok(gate.ok, `${slug}: ${gate.problems.join('; ')}`);
  // since Nov 1: Black's plot trouble on the crew: his problems accepted change the story (Green sings each in a verse
  // and solves it later), at least MIN_TROUBLES of them unless he bypassed the count with a reason
  if (crewOf(beats).includes('trouble')) {
    const t = gate.stats.trouble;
    assert.ok(t.resolved >= MIN_TROUBLES || t.bypassed.length, `${slug}: ${t.resolved} plot troubles sung and solved`);
    for (const x of troublesOf(events, beats).values()) if (x.accepted && x.sung) assert.ok(x.resolved && x.resolved.seq > x.sung.seq, `${slug}: ${x.id} solved after it is sung`);
  }
  // the director's later additions, when a bundle has them: the sung thoughts (first person), the
  // answers to consultations, the craft checks bypassed (reasoned, at most 3 per agent, never the hook)
  if (beats.summaries === 'first-person') {
    for (const e of events) assert.deepEqual(summaryProblems(e.summary, { firstPerson: true, bot: e.bot }), [], `${slug} event ${e.seq}: a sung thought`);
  }
  // since Oct 31: the crew talking to each other (never to the viewers), most of each agent's lines said to a crewmate
  if (beats.summaries === 'talk') {
    // (as emit.js prepareEvent checks them: a consultation's move only its ask "consulting", at most MAX_MOVE_SYLLABLES)
    const threads = beats.consultations === CONSULT_MOVES;
    for (const e of events) {
      const isMove = threads && MOVES.includes(e.move);
      const consult = (e.consult ?? []).filter((n) => n !== e.bot);
      const opts = isMove
        ? { voice: 'talk', bot: e.bot, status: e.move === 'ask' ? 'consulting' : null, consult, max: MAX_MOVE_SYLLABLES, move: true }
        : { voice: 'talk', bot: e.bot, status: e.status, consult };
      assert.deepEqual(summaryProblems(e.summary, opts).filter((x) => !/copies an example/.test(x)), [], `${slug} event ${e.seq}: talk`);
    }
    // (as the gate saw them: each line against what the agent had sent before it, a queued line was written before it
    // landed in the stream, activity.ndjson's queue records. emit.js orders that history as its `sent`: the lines
    // already in the stream in the stream's order, then the ones still queued in the order sent, then the call's own
    // earlier lines)
    const act = existsSync(`${path}/activity.ndjson`) ? readFileSync(`${path}/activity.ndjson`, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
    const written = writtenTimes(act, events);
    const sentAt = (e) => written.get(e.seq) ?? Number(e.t) ?? 0;
    const bySent = (x, y) => sentAt(x) - sentAt(y) || x.seq - y.seq;
    for (const a of ROLES) {
      const mine = events.filter((e) => e.agent === a).sort(bySent);
      const problems = mine.flatMap((e) => {
        const s = sentAt(e);
        const before = mine.filter((x) => sentAt(x) < s);
        const landed = before.filter((x) => Number(x.t) < s).sort((x, y) => x.seq - y.seq);
        const queued = before.filter((x) => !(Number(x.t) < s)).sort(bySent);
        const call = mine.filter((x) => sentAt(x) === s && x.seq < e.seq);
        return talkProblems([...landed, ...queued, ...call], [e]).map((p) => `#${e.seq}: ${p.message}`);
      });
      assert.deepEqual(problems, [], `${slug}: ${a} talks to the crew`);
    }
  }
  assert.deepEqual(answerProblems(events), [], `${slug}: answers`);
  assert.deepEqual(craftRecordProblems(beats, events), [], `${slug}: the craft record`);
  if (dj.craft) {
    assert.ok(MODES.includes(dj.craft.mode), `${slug}: the craft mode`);
    assert.equal(dj.craft.bypasses.length, events.flatMap((e) => e.bypassed ?? []).length, `${slug}: director.json lists every bypass`);
  }
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
// the page's default prompt is the first curated seed (the hero episode): Premiere and Make it play it
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.equal(page.match(/<input id="prompt"[^>]*\bvalue="([^"]*)"/)?.[1], SEEDS[0][1], 'the default prompt is the first curated seed');
console.log(`episodes ok: ${checked} bundles play end to end; ${songs} curated director songs pass the gate and arrange`);
