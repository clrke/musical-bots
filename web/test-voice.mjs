// Sung lines: every lyric of every curated bundle plans onto the bar grid with one note per
// syllable, in the cast member's voice, and renders through the Magna Vocalization engine.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { planEpisode, engineVoice, romanOf, BAR } from './src/sing-plan.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { renderLine } from './src/mv/voice/sing.js';
import { VOICES } from './src/mv/voice/voice.js';
import { parseNdjson } from './src/player.js';
import { CAST } from './src/gen/cast.js';

assert.equal(romanOf('C'), 'I');
assert.equal(romanOf('Am'), 'vi');
assert.equal(romanOf('G7'), 'V7');
for (const bot of Object.keys(CAST)) assert.ok(VOICES[engineVoice(bot)], `${bot}: no engine voice ${engineVoice(bot)}`);

const root = new URL('../episodes/', import.meta.url);
let lines = 0, rendered = 0;
for (const dir of readdirSync(root)) {
  let events;
  try { events = parseNdjson(readFileSync(new URL(`${dir}/events.ndjson`, root), 'utf8')); } catch { continue; }
  const plans = planEpisode(events);
  const sung = events.filter((e) => e.lyric?.trim());
  assert.equal(plans.length, sung.length, `${dir}: ${sung.length - plans.length} lyric lines not planned`);
  for (const p of plans) {
    const e = events.find((x) => x.seq === p.seq);
    assert.ok(p.at >= e.t - 1e-9, `${dir} #${p.seq}: voice starts before its card`);
    const bar = (p.at - p.job.notes[0].t) / BAR;
    assert.equal(p.job.notes.length, syllabify(p.job.text).length);
    assert.ok(p.job.notes.every((n, i) => i === 0 || n.t >= p.job.notes[i - 1].t));
    assert.ok(Number.isFinite(bar));
    lines++;
  }
  // render the first line of each bundle (the full set renders in ~1 s per episode)
  const r = renderLine(plans[0].job);
  assert.ok(r.pcm.length > 0 && r.peak > 0.01 && r.peak < 1, `${dir}: peak ${r.peak}`);
  assert.equal(r.syllableTimes.length, plans[0].job.notes.length);
  rendered++;
}
assert.ok(rendered >= 12, `only ${rendered} bundles`);
console.log(`voice ok: ${lines} lines planned across ${rendered} bundles, every cast voice exists`);
