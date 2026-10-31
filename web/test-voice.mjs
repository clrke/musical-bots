// Sung lines: every lyric of every curated bundle plans onto the bar grid with one note per
// syllable, in the cast member's voice, and renders through the Magna Vocalization engine.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { planEpisode, arrange, engineVoice, romanOf, BAR, CARD_LEAD } from './src/sing-plan.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { renderLine, planLine } from './src/mv/voice/sing.js';
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
  // the performance: solos never overlap, harmony starts with its lead (after the lead's pickup), cards lead the voice
  const song = arrange(events);
  assert.ok(events.every((e) => song.events.some((x) => x.seq === e.seq)), `${dir}: arrange dropped events`);
  const leads = song.lines.filter((l) => l.role === 'lead');
  for (let i = 1; i < leads.length; i++) {
    const p = leads[i - 1], end = p.at + p.job.notes.at(-1).t + p.job.notes.at(-1).dur;
    assert.ok(end <= leads[i].at + 1e-6, `${dir}: solo ${i} starts before solo ${i - 1} ends`);
  }
  for (const h of song.lines.filter((l) => ['third', 'fifth', 'root', 'unison'].includes(l.role))) {
    assert.ok(leads.some((l) => h.at >= l.at - 1e-6 && h.at - l.at < 1.5), `${dir}: harmony #${h.seq} has no lead`);
  }
  for (const l of song.lines) {
    const e = song.events.find((x) => x.seq === l.seq);
    assert.ok(l.at - e.t >= CARD_LEAD - 1e-6 || e.t === 0, `${dir}: card/voice offset for #${l.seq}`);
  }
  assert.ok(song.events.every((e, i) => i === 0 || e.t >= song.events[i - 1].t), `${dir}: arranged times go back`);
  // render the first line of each bundle (the full set renders in ~1 s per episode)
  const r = renderLine(plans[0].job);
  assert.ok(r.pcm.length > 0 && r.peak > 0.01 && r.peak < 1, `${dir}: peak ${r.peak}`);
  assert.equal(r.syllableTimes.length, plans[0].job.notes.length);
  rendered++;
}
assert.ok(rendered >= 12, `only ${rendered} bundles`);

// a held name's final consonant (QA v19: "White" held two beats was heard as "Why"): the vowel rings through the
// hold, the stop closes at its end and is released as clearly as an onset's, its breath after it; a short note's
// final stop keeps the speech-like soft release
{
  const notesFor = (durs) => { let t = 0; return durs.map((dur, i) => { const n = { t, dur, midi: 62 + (i % 3) }; t += dur; return n; }); };
  for (const [text, held, stop] of [['Hey White, can we talk shop?', 1, 't'], ['Thank you, Black', 2, 'k'], ['Gold, what do you think?', 0, 'd']]) {
    const sy = syllabify(text);
    const durs = sy.map((_, i) => (i === held ? 1.36 : 0.34));
    const plan = (ds) => planLine({ voice: 'woman', text, notes: notesFor(ds) });
    const { an, pl, sylNote } = plan(durs);
    const si = [...sylNote.keys()].sort((a, b) => a - b)[held];
    const { T, E } = sylNote.get(si);
    const k = an.syllables[si].coda.find((q) => an.phones[q].sym === stop);
    assert.ok(k !== undefined, `${text}: the held syllable ends in ${stop}`);
    // the stop closes at the end of the hold (not across it), the vowel sung up to it
    assert.ok(an.phones[k].t > E - 0.25 && an.phones[k].t < E, `${text}: ${stop} at ${an.phones[k].t.toFixed(3)} (note ${T.toFixed(2)}..${E.toFixed(2)})`);
    const vowel = pl.units.find((u) => u.syllable === si && u.kind === 'vowel');
    assert.ok(vowel.off > E - 0.3, `${text}: the vowel holds to ${vowel.off.toFixed(3)} of ${E.toFixed(2)}`);
    // released at an onset's level, near the note's end
    const burst = pl.noises.find((e) => e.phone === k && /burst/.test(e.kind));
    const onsetDb = Math.max(...pl.noises.filter((e) => e.kind === 'burst').map((e) => e.gainDb), -Infinity);
    assert.ok(burst && burst.on > E - 0.2 && burst.on < E + 0.1, `${text}: ${stop} released at the end of the hold`);
    const short = plan(sy.map(() => 0.34));
    const shortBurst = short.pl.noises.find((e) => e.phone === k && /burst/.test(e.kind));
    assert.ok(shortBurst && burst.gainDb > shortBurst.gainDb + 6, `${text}: the held ${stop} released louder than a short note's (${burst.gainDb.toFixed(1)} vs ${shortBurst.gainDb.toFixed(1)} dB)`);
    if (Number.isFinite(onsetDb)) assert.ok(burst.gainDb >= onsetDb - 4.5, `${text}: the held ${stop} near an onset's level`);
    // a voiceless one breathes out after it; a voiced one does not
    const puff = pl.noises.find((e) => e.phone === k && e.kind === 'fricative');
    assert.equal(!!puff, stop !== 'd', `${text}: the breath after ${stop}`);
    if (puff) assert.ok(puff.on >= burst.on && puff.off < E + 0.2, `${text}: the breath right after the release`);
    assert.ok(!short.pl.noises.some((e) => e.phone === k && e.kind === 'fricative'), `${text}: no breath after a short note's ${stop}`);
  }
}
console.log(`voice ok: ${lines} lines planned across ${rendered} bundles, every cast voice exists, held names keep their final stops`);
