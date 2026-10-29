// The story song (web/src/song, sing-plan.js arrange): the Soothing Bots form, its child tunes, the
// echo's replies, the sung backing and the mix, on generated protocol v2 bundles and the old v1 ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORM, sectionKind, sectionRomans, chooseStyle, tuneOf, styleRomans, chordsOf, PROGRESSION_SETS, TEMPO_RANGE } from './src/song/form.js';
import { tuneNotes, replyNotes, echoOf, pickupPitches, childDo, tuneBars } from './src/song/tunes.js';
import { layerDb, liftDb, storySpans, storyAt, layerGain, syllableSpans, syllableDuckAt, SYLLABLE_DUCK_DB, WET, LAYER_EQ, ROLE_EQ, PAN } from './src/song/mix.js';
import { arrange, lineEnd, CARD_LEAD } from './src/sing-plan.js';
import { generate } from './src/gen/index.js';
import { parseNdjson } from './src/player.js';
import { chordFromRoman } from './src/mv/music/theory.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { renderLine } from './src/mv/voice/sing.js';
import { liftAt, ducks } from './src/audio.js';

// ---- the form
assert.equal(FORM.length, 11);
assert.deepEqual(['verse1b', 'chorus3', 'bridge2', 'intro', 'nope'].map(sectionKind), ['verse', 'chorus', 'bridge', 'intro', null]);
assert.deepEqual(sectionRomans(['I', 'V', 'vi', 'IV'], 'chorus1'), ['I', 'V', 'vi', 'IV', 'I', 'V', 'V7', 'I'], 'a chorus ends V7 -> I');
assert.deepEqual(sectionRomans(['IV', 'I'], 'outro').slice(-2), ['V7', 'I'], 'the outro resolves home');
assert.deepEqual(sectionRomans(['I', 'V', 'vi', 'IV'], 'verse1'), ['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV'], 'counted from the section\'s first bar');
for (const id of PROGRESSION_SETS['verse:build']) assert.equal(chordsOf(id).at(-1), 'V', `${id} builds to V`);
for (const id of PROGRESSION_SETS['bridge2:suspense']) assert.notEqual(chordsOf(id).at(-1), 'I', `${id} never resolves`);
for (const seed of ['a', 'b', 'c', 'gen-toy-box', 'x1', 'x2', 'x3']) {
  const s = chooseStyle(seed, { bridge: 'suspense' });
  assert.ok(s.tempo >= TEMPO_RANGE[0] && s.tempo <= TEMPO_RANGE[1], 'tempo 88-100');
  assert.deepEqual(chooseStyle(seed, { bridge: 'suspense' }).tunes, s.tunes, 'deterministic');
  assert.equal(tuneOf(s, 'verse1b'), tuneOf(s, 'verse1'), 'A2 sings A1\'s tune');
  assert.equal(tuneOf(s, 'verse2b'), tuneOf(s, 'verse2'), 'B2 sings B1\'s tune');
  assert.notEqual(tuneOf(s, 'verse2'), tuneOf(s, 'verse1'));
  assert.notEqual(tuneOf(s, 'bridge2'), tuneOf(s, 'bridge'));
  assert.ok(PROGRESSION_SETS['bridge2:suspense'].includes(s.progressions.bridge2), 'bridge 2 by its tag');
  assert.equal(styleRomans(s, 'verse1b').at(-1), 'V', 'Verse A2 ends on V');
  assert.deepEqual(styleRomans(s, 'outro').slice(-2), ['V7', 'I']);
}

// ---- the child tunes: two bars a line, the second done by beat 3, a child's range, chord tones on the strong beats
const romans = ['I', 'IV', 'V', 'I', 'vi', 'IV', 'V7', 'I'];
for (const melody of ['nursery', 'bouncy', 'rocking', 'march', 'risefall', 'arch', 'chant', 'pentatonic', 'anthem', 'callback']) {
  for (const n of [3, 5, 6, 7]) {
    for (const startBar of [0, 2, 4]) {
      const { notes, bars } = tuneNotes({ melody, syllableCount: n, chords: romans, voice: 'soprano', tempo: 92, startBar, minBars: 2 });
      assert.equal(bars, 2);
      assert.equal(notes.length, n);
      const doM = childDo('C', 0, 57, 81);
      for (const x of notes) {
        assert.ok(x.midi >= doM - 1 && x.midi <= doM + 9, `${melody}: ${x.midi} in the child window`);
        if (x.strong) assert.ok(chordFromRoman(romans[startBar + x.bar]).tones.includes(x.midi % 12), `${melody}: strong note on the chord`);
        if (x.bar === 1) assert.ok(x.beat + x.dur * 92 / 60 <= 6 + 1e-6, `${melody}: the second bar is done by beat 3`);
      }
    }
  }
}
assert.equal(tuneBars('nursery', 9), 4, 'a long line takes four bars');
const cad = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: romans, voice: 'woman', tempo: 92, startBar: 6, cadenceBar: 7 });
assert.equal(cad.notes.at(-1).midi % 12, 0, 'the cadence lands on do');
assert.equal(cad.notes.at(-1).beat, 6, 'on beat 3 of the home bar');
const gap = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: romans, voice: 'woman', tempo: 92, startBar: 6, cadenceBar: 7, cadenceGap: true });
assert.ok(gap.notes.at(-1).beat * 60 / 92 + gap.notes.at(-1).dur <= 6 * 60 / 92 + 1e-6, 'a reply after the cadence: the line lands by the bar\'s middle');
assert.equal(childDo('C', 0, 36, 60), 48, 'the basso sings the tune an octave down');
// the backing cells: one bar each, on the chord
for (const [melody, text, role] of [['staccato', 'Bom, bom, bom, bom', 'bass'], ['offbeat', 'Doo, dee, doo, dee', 'root'], ['sustain', 'Ooh', 'fifth'], ['arpeggio', 'La, la, la, la', 'root']]) {
  const r = tuneNotes({ melody, syllableCount: syllabify(text).length, chords: ['IV'], role, voice: 'woman' });
  assert.equal(r.bars, 1, melody);
  assert.ok(r.notes.every((x) => chordFromRoman('IV').tones.includes(x.midi % 12)), `${melody} sings the chord`);
}
// the echo's replies: in the gap (beat 3 of the bar to the next line), on the chord where it is strong
for (const shape of ['repeat', 'third', 'fragment', 'invert', 'sigh', 'stepup', 'sixth', 'answer', 'neighbor', 'augment', 'stepdown', 'rise']) {
  for (const n of [1, 2, 3, 4, 5]) {
    const r = replyNotes({ shape, syllableCount: n, chord: 'V', voice: 'soprano', tempo: 92, answering: [{ beat: 0, midi: 67 }, { beat: 1, midi: 65 }], answerEnd: 3.5 });
    assert.equal(r.notes.length, n);
    assert.ok(r.notes[0].beat >= 2.5 - 1e-6, `${shape}: after the line and a breath`);
    const last = r.notes.at(-1);
    assert.ok(last.beat + last.dur * 92 / 60 <= 3.5 - 0.15 + 1e-6, `${shape}: before the next line's pickup`);
    for (const x of r.notes) if (x.strong) assert.ok([7, 11, 2].includes(x.midi % 12), `${shape}: on the chord`);
  }
}
assert.equal(echoOf('Flip, flip, pancake!'), 'Pancake');
assert.equal(echoOf('Stars above the fence'), 'The fence');
assert.equal(echoOf('Knock, knock, Grandma, hi!'), 'Grandma, hi');
assert.deepEqual(pickupPitches(64, 2, 'C', 57, 81), [60, 62], 'a pickup steps up into the line');
assert.equal(syllabify('She has it, get it').length, 5, '"has" and "get" are sung as written');

// ---- the mix (StoryMix.cs)
assert.deepEqual(['story', 'reply', 'echo', 'words', 'backing'].map((l) => layerDb(l, 'verse1')), [0, 0, -4, -9, -14]);
assert.equal(layerDb('backing', 'bridge2'), -17, 'the bridges: 3 dB more under the grown-up');
assert.equal(layerDb('story', 'bridge'), 0);
assert.deepEqual(['story', 'echo', 'words', 'backing'].map((l) => liftDb(l, 'verse1')), [0, 0, 5, 10]);
const spans = storySpans([{ layer: 'story', at: 10, job: { notes: [{ t: 0, dur: 1 }, { t: 2, dur: 1 }] } }, { layer: 'story', at: 14, job: { notes: [{ t: 0, dur: 1 }] } }], 2.6);
assert.equal(spans.length, 1, 'a short rest keeps the backing under the story');
assert.equal(storyAt(spans, 12), 1);
assert.equal(storyAt(spans, 30), 0);
assert.ok(storyAt(spans, spans[0][0] - 0.3) > 0 && storyAt(spans, spans[0][0] - 0.3) < 1, 'ramps');
const pad = layerGain({ layer: 'backing', section: 'intro', at: 0, job: { notes: [{ t: 0, dur: 20 }] } }, spans);
assert.equal(pad.db, -14);
assert.equal(liftAt(pad.lift, 0), 10, 'nobody tells the story: the backing comes up');
assert.equal(liftAt(pad.lift, 11), 0, 'under the story: down');
assert.equal(layerGain({ layer: 'reply', section: 'verse1', at: 0, job: { notes: [{ t: 0, dur: 1 }] } }, spans).lift, null, 'the echo is never lifted');
assert.ok(!ducks(10, 14, 10), 'lines that start together are never ducked');
// the dip under the story's syllables, the room, the EQ carve and the stereo place
const notesAt = (at, ts) => ({ layer: 'story', at, job: { notes: ts.map(([t, dur]) => ({ t, dur })) } });
const storyLines = [notesAt(10, [[0, 0.5], [0.55, 0.5]]), notesAt(20, [[0, 1]])];
const syl = syllableSpans(storyLines);
assert.deepEqual(syl, [[10, 11.05], [20, 21]], 'legato notes are one dip');
assert.equal(syllableDuckAt(syl, 10.5, -4), -4);
assert.equal(syllableDuckAt(syl, 15, -4), 0);
assert.ok(syllableDuckAt(syl, 21.1, -4) < 0 && syllableDuckAt(syl, 21.1, -4) > -4, 'and comes back up');
const under = layerGain({ layer: 'backing', section: 'verse1', at: 9, job: { notes: [{ t: 0, dur: 14 }] } }, storySpans(storyLines, 2.6), syl);
assert.equal(liftAt(under.lift, 10.5), SYLLABLE_DUCK_DB.backing, 'the backing dips under a sung syllable');
assert.equal(liftAt(under.lift, 15), 10, 'and comes up where nobody sings');
assert.ok(SYLLABLE_DUCK_DB.backing < 0 && SYLLABLE_DUCK_DB.backing >= -6 && SYLLABLE_DUCK_DB.words <= 0 && !SYLLABLE_DUCK_DB.story);
assert.ok(WET.backing < WET.story, 'the choir behind is drier than the story');
assert.ok(LAYER_EQ.backing.some((f) => f.type === 'peaking' && f.gain < 0 && f.f >= 1000 && f.f <= 4000), 'the backing is carved out of the consonants\' band');
assert.deepEqual(LAYER_EQ.story, [], 'the story untouched');
assert.ok(ROLE_EQ.pad.some((f) => f.type === 'lowpass'));
assert.ok(!PAN.lead && Math.abs(PAN.pad) > 0.2, 'the story in the centre, the choir spread');
assert.ok(ducks(8, 14, 10));

// ---- the arrangement of v2 bundles
for (const prompt of ['Gigi brings home the biggest toy box on the street', 'Lou sells hot soup on a cold day', 'Hattie races Dan around the block']) {
  const { beats, events } = generate(prompt);
  const song = arrange(events, beats);
  const B = song.bar;
  assert.ok(song.tempo >= 88 && song.tempo <= 100);
  assert.equal(song.sections.length, 11);
  song.sections.forEach((s, i) => {
    assert.ok(Math.abs(s.t - i * 8 * B) < 1e-6, `${prompt}: ${s.section} starts on its bar`);
    // listen-proxy: the chord at each section's first bar is the written progression's first
    const written = events.find((e) => e.beat === s.beat).chords;
    assert.equal(s.chords[0], written[0], `${prompt}: ${s.section} opens on its progression`);
    if (['chorus', 'outro'].includes(s.kind)) assert.deepEqual(s.chords.slice(-2), ['G7', 'C'], `${prompt}: ${s.section} cadence`);
  });
  assert.equal(song.sections[0].chords[0], 'C', 'the intro opens on the tonic');
  // every bundle event is staged; the output in time order; cards lead the voices
  assert.ok(events.every((e) => song.events.some((x) => x.seq === e.seq)));
  assert.ok(song.events.every((e, i) => i === 0 || e.t >= song.events[i - 1].t));
  const evOf = new Map(song.events.map((e) => [e.seq, e]));
  assert.equal(evOf.size, song.events.length, 'one seq per event');
  for (const l of song.lines) {
    assert.ok(evOf.has(l.seq), 'every line has its event');
    assert.ok(l.at - evOf.get(l.seq).t >= CARD_LEAD - 1e-6 || evOf.get(l.seq).t === 0);
    for (const j of l.segments ? l.segments.map((g) => g.job) : [l.job]) assert.equal(syllabify(j.text).length, j.notes.length, `${l.role}: one note a syllable`);
  }
  // the story: one line at a time, by its singer, a pickup before its bar line
  const story = song.lines.filter((l) => l.layer === 'story');
  assert.equal(story.length, events.filter((e) => e.lyric).length);
  for (let i = 1; i < story.length; i++) assert.ok(lineEnd(story[i - 1]) <= story[i].at + 1e-6, 'one story line at a time');
  for (const l of story) {
    const e = evOf.get(l.seq);
    assert.equal(l.bot, e.singer, 'sung by its singer');
    const barT = Math.round(l.at / B) * B;
    if (l.pickup) assert.ok(l.at < barT - 1e-6 || l.at < Math.ceil(l.at / B) * B, 'the pickup comes before the bar line');
  }
  // the pal's replies and echoes: their own events, sung by roles.pal, in the gaps
  const replies = song.events.filter((e) => e.part === 'reply' || e.part === 'echo');
  assert.ok(replies.length >= 20, `${prompt}: ${replies.length} replies`);
  for (const e of replies) {
    assert.ok([beats.roles.pal, ...song.lines.filter((l) => l.role === 'reply').map((l) => l.bot)].includes(e.singer));
    const l = song.lines.find((x) => x.seq === e.seq);
    const next = story.find((s) => s.at > l.at);
    if (next && l.layer !== 'words') assert.ok(lineEnd(l) <= next.at + 1e-6, `${prompt}: a reply "${e.lyric}" runs into the next line`);
  }
  assert.ok(!song.events.some((e) => e.part === 'reply' && e.beat.includes('bridge')), 'no replies in the bridges');
  // harmonies sung together: the same t and lyric as their line, staged right after it
  const staged = song.events.filter((e) => e.part !== 'backing');
  for (const e of events.filter((x) => x.with)) {
    const i = staged.findIndex((x) => x.seq === e.seq);
    e.with.forEach((n, k) => {
      const h = staged[i + 1 + k];
      assert.ok(h && h.singer === n && h.t === staged[i].t && h.lyric === e.lyric, `${prompt}: ${n} sings "${e.lyric}" with ${e.singer}`);
    });
  }
  // the sung backing: mouth-only events and their cells
  const backing = song.events.filter((e) => e.part === 'backing');
  assert.ok(backing.length >= 40);
  for (const role of ['bass', 'pad', 'rhythm', 'sparkle', 'hum', 'counter']) assert.ok(song.lines.some((l) => l.role === role), `a ${role}`);
  assert.ok(song.lines.filter((l) => l.role === 'counter').every((l) => l.section === 'chorus3'), 'the counter-melody is chorus 3\'s');
  assert.ok(song.lines.filter((l) => l.role === 'sparkle').every((l) => sectionKind(l.section) === 'chorus'), '"la la" only in the choruses');
  // accents on a bar's downbeat only (the replies sing after it: none)
  for (const l of song.lines.filter((x) => x.layer === 'reply' || x.layer === 'echo')) assert.ok(l.job.notes.every((x) => !x.downbeat), 'a reply has no downbeat');
  for (const l of song.lines.filter((x) => x.segments)) {
    const t0 = song.sections.find((z) => z.section === l.section).t;
    for (const g of l.segments) {
      for (const x of g.job.notes) {
        const inBar = (((g.at + x.t - t0) % B) + B) % B;
        if (x.downbeat) assert.ok(inBar < 0.02 || B - inBar < 0.02, `${l.role}: an accent off the bar line`);
      }
    }
  }
  assert.ok(song.lines.filter((l) => l.role === 'hum').every((l) => sectionKind(l.section) === 'bridge'), 'a hum in the bridges');
  // the mix levels ride on the lines
  for (const l of song.lines) assert.equal(l.db, layerDb(l.layer, l.section));
  // the song resolves home: the last sounding bar is the tonic
  const last = song.lines.filter((l) => l.segments).flatMap((l) => l.segments).reduce((a, g) => (g.at > a.at ? g : a));
  assert.ok([0, 4, 7].includes(last.job.notes[0].midi % 12), 'the last chord is C');
  assert.ok(song.end > 200 && song.end < 260, `${prompt}: ${song.end.toFixed(0)} s`);
}

// v1 bundles still arrange (the sample's two beats; a curated bundle)
const sample = parseNdjson(readFileSync(new URL('../episodes/sample/events.ndjson', import.meta.url), 'utf8'));
const s1 = arrange(sample);
assert.ok(sample.every((e) => s1.events.some((x) => x.seq === e.seq)));
assert.ok(s1.lines.filter((l) => l.layer === 'story').length === sample.filter((e) => e.lyric).length);

// a reply and a backing cell render through the voice engine
const song = arrange(...Object.values(generate('Ivy finds a lost puppy in the park')).reverse());
for (const role of ['reply', 'bass', 'counter']) {
  const l = song.lines.find((x) => x.role === role);
  const j = l.segments ? l.segments[0].job : l.job;
  const r = renderLine(j);
  assert.ok(r.pcm.length > 0 && r.syllableTimes.length === j.notes.length, role);
}
console.log(`song ok: 11 sections at ${song.tempo} bpm, ${song.lines.length} lines (${song.end.toFixed(0)} s), replies in the gaps, sung backing, mix by layer`);
