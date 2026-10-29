// Sung lines: every lyric of every curated bundle plans onto the bar grid with one note per
// syllable, in the cast member's voice, and renders through the Magna Vocalization engine.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { planEpisode, arrange, engineVoice, romanOf, BAR, CARD_LEAD } from './src/sing-plan.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { renderLine } from './src/mv/voice/sing.js';
import { VOICES } from './src/mv/voice/voice.js';
import { parseNdjson } from './src/player.js';
import { CAST } from './src/gen/cast.js';

assert.equal(romanOf('C'), 'I');
assert.equal(romanOf('Am'), 'vi');
assert.equal(romanOf('G7'), 'V7');
// sharps, flats and qualities (were: F#m -> IV, Bb -> VII, Cmaj7 -> I7)
assert.equal(romanOf('F#m'), '#iv');
assert.equal(romanOf('Bb'), 'bVII');
assert.equal(romanOf('Eb'), 'bIII');
assert.equal(romanOf('Ab7'), 'bVI7');
assert.equal(romanOf('C#dim'), '#idim');
assert.equal(romanOf('Cmaj7'), 'Imaj7');
assert.equal(romanOf('CM7'), 'Imaj7');
assert.equal(romanOf('Am7'), 'vi7');
assert.equal(romanOf('Bm7b5'), 'viim7b5');
assert.equal(romanOf('Gsus4'), 'Vsus4');
assert.equal(romanOf('Dsus2'), 'IIsus2');
assert.equal(romanOf('Eaug'), 'IIIaug');
assert.equal(romanOf('C/E'), 'I');
assert.equal(romanOf('G9'), 'V7');
assert.equal(romanOf('Fadd9'), 'IVadd9');
assert.equal(romanOf('Dm6'), 'ii6');
assert.equal(romanOf('Cmaj'), 'I');
assert.equal(romanOf('nonsense'), 'I');
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
  // the performance: solos never overlap, harmony shares its lead's start, cards lead the voice
  const song = arrange(events);
  assert.equal(song.events.length, events.length, `${dir}: arrange dropped events`);
  const leads = song.lines.filter((l) => l.role === 'lead');
  for (let i = 1; i < leads.length; i++) {
    const p = leads[i - 1], end = p.at + p.job.notes.at(-1).t + p.job.notes.at(-1).dur;
    assert.ok(end <= leads[i].at + 1e-6, `${dir}: solo ${i} starts before solo ${i - 1} ends`);
  }
  for (const h of song.lines.filter((l) => l.role !== 'lead')) {
    assert.ok(leads.some((l) => Math.abs(l.at - h.at) < 0.3), `${dir}: harmony #${h.seq} has no lead`);
  }
  for (const l of song.lines) {
    const e = song.events.find((x) => x.seq === l.seq);
    assert.ok(Math.abs(l.at - e.t - CARD_LEAD) < 1e-6 || e.t === 0, `${dir}: card/voice offset for #${l.seq}`);
  }
  assert.ok(song.events.every((e, i) => i === 0 || e.t >= song.events[i - 1].t), `${dir}: arranged times go back`);
  // render the first line of each bundle (the full set renders in ~1 s per episode)
  const r = renderLine(plans[0].job);
  assert.ok(r.pcm.length > 0 && r.peak > 0.01 && r.peak < 1, `${dir}: peak ${r.peak}`);
  assert.equal(r.syllableTimes.length, plans[0].job.notes.length);
  rendered++;
}
assert.ok(rendered >= 12, `only ${rendered} bundles`);
console.log(`voice ok: ${lines} lines planned across ${rendered} bundles, every cast voice exists`);
