// The story song (web/src/song, sing-plan.js arrange): the Soothing Bots form, its child tunes, the
// echo's replies, the sung backing and the mix, on generated protocol v2 bundles and the old v1 ones.
// Since Oct 31 in 6/4 (Soothing Bots random song v6, HANDOFF Part B): the timing math (a bar six beats, beats 1 and
// 4 strong), the split chords (ii/V7 before an authentic ending, V/V7 at a half cadence), the child tunes by pulses
// (two bars a line, done by beat 4 of the second, cadences on beat 4), the pal's replies on beats 4-6, the tempo
// (132-136) and the sung syllable rate (never over 2 a second). The 4/4 engine is checked too (meter: 4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORM, sectionKind, sectionRomans, chooseStyle, tuneOf, styleRomans, chordsOf, PROGRESSION_SETS, TEMPO_RANGE, SIX_FOUR_TEMPO_RANGE, BEATS_PER_BAR,
  blockTiming, barBeatAt, isStrongBeat, sixFourTempo, splitRomans, beatsPerPulse, pulsesPerBar,
  chordName, keyName, romanLabel, harmonize, reharmonize, CADENCE_APPROACH, HALF_CADENCE, PIVOT, LIFT, progressionIdOf, progressionLabel, sectionLabel,
} from './src/song/form.js';
import { songReadout, readoutHtml } from './src/chord-readout.js';
import { tuneNotes, replyNotes, echoOf, pickupPitches, childDo, tuneBars, sixOf, MAX_SYLLABLE_RATE, SIX_LINE_MAX, PICKUP_GAP_BEATS } from './src/song/tunes.js';
import { layerDb, lineDb, liftDb, storySpans, storyAt, layerGain, syllableSpans, syllableDuckAt, SYLLABLE_DUCK_DB, tailLift, TAIL_DIP_DB, TAIL_END_DB, WET, LAYER_EQ, ROLE_EQ, PAN } from './src/song/mix.js';
import { arrange, lineEnd, CARD_LEAD, motionClock } from './src/sing-plan.js';
import { generate } from './src/gen/index.js';
import { parseNdjson } from './src/player.js';
import { chordFromRoman } from './src/mv/music/theory.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { renderLine } from './src/mv/voice/sing.js';
import { liftAt, ducks } from './src/audio.js';
import { romanOf as romanOfName } from './src/sing-plan.js';

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
  assert.ok(s.tempo5 >= TEMPO_RANGE[0] && s.tempo5 <= TEMPO_RANGE[1], 'the draw 88-100');
  assert.ok(s.meter === 6 && s.tempo === sixFourTempo(s.tempo5) && s.tempo >= SIX_FOUR_TEMPO_RANGE[0] && s.tempo <= SIX_FOUR_TEMPO_RANGE[1], 'sung in 6/4 at 132-136');
  assert.deepEqual(chooseStyle(seed, { bridge: 'suspense' }).tunes, s.tunes, 'deterministic');
  assert.equal(tuneOf(s, 'verse1b'), tuneOf(s, 'verse1'), 'A2 sings A1\'s tune');
  assert.equal(tuneOf(s, 'verse2b'), tuneOf(s, 'verse2'), 'B2 sings B1\'s tune');
  assert.notEqual(tuneOf(s, 'verse2'), tuneOf(s, 'verse1'));
  assert.notEqual(tuneOf(s, 'bridge2'), tuneOf(s, 'bridge'));
  assert.ok(PROGRESSION_SETS['bridge2:suspense'].includes(s.progressions.bridge2), 'bridge 2 by its tag');
  assert.equal(styleRomans(s, 'verse1b').at(-1), 'V', 'Verse A2 ends on V');
  assert.deepEqual(styleRomans(s, 'outro').slice(-2), ['V7', 'I']);
}

// ---- 6/4: the timing math (Compile.BlockTiming / BarBeatAt, Meter.cs), the tempo map, the split chords
assert.equal(BEATS_PER_BAR, 6, 'the show is in 6/4');
{
  const t = blockTiming(134, 6);
  assert.ok(Math.abs(t.beatSec - 60 / 134) < 1e-12 && Math.abs(t.barSec - 6 * 60 / 134) < 1e-12 && Math.abs(t.sectionSec - 48 * 60 / 134) < 1e-12, 'a bar: six beats');
  assert.ok(Math.abs(blockTiming(134, 4).barSec - 4 * 60 / 134) < 1e-12, '4/4 still four');
  assert.ok(blockTiming(132, 6).barSec <= blockTiming(88, 4).barSec + 1e-9, 'a 6/4 bar never longer than the longest 4/4 one');
  assert.deepEqual(barBeatAt(2.5, 0.5, 6), { bar: 0, beat: 5 });
  assert.deepEqual(barBeatAt(4.5, 0.5, 6), { bar: 1, beat: 3 }, 'index 3 is beat 4');
  assert.deepEqual(barBeatAt(30, 0.5, 6), { bar: 7, beat: 5 }, 'clamped past the end');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((b) => isStrongBeat(b, 6)), [true, false, false, true, false, false], 'beats 1 and 4 strong');
  assert.deepEqual([0, 1, 2, 3].map((b) => isStrongBeat(b, 4)), [true, false, true, false]);
  assert.deepEqual([88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100].map(sixFourTempo), [132, 132, 133, 133, 133, 134, 134, 134, 135, 135, 135, 136, 136], 'SixFourTempo');
  assert.deepEqual([beatsPerPulse(6), pulsesPerBar(6), beatsPerPulse(4), pulsesPerBar(4)], [3, 2, 1, 4], 'bodies move on the pulse');
  const mc = motionClock(134, 6);
  assert.ok(Math.abs(mc.beatSec - 3 * 60 / 134) < 1e-12 && mc.beatsPerBar === 2, 'the hands sway on the dotted half, two a bar');
  assert.deepEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6].map(sixOf), [0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 9], 'SixOf: long-short over each pulse');
  // the split chords: ii/V7 in bar 7 before an authentic ending, V/V7 in a half cadence's last bar, none else
  const auth = splitRomans(['I', 'IV', 'I', 'V', 'I', 'IV', 'V7', 'I'], 6);
  assert.deepEqual([auth.romans[6], auth.splits[6], auth.splits.filter(Boolean).length], ['ii', 'V7', 1], 'bar 7 = ii then V7');
  assert.deepEqual(splitRomans(chordsOf('t-walk'), 6).splits[6], 'V7', 'a verse that comes home too');
  const half = splitRomans(chordsOf('t-ramp'), 6);
  assert.deepEqual([half.romans[7], half.splits[7], half.splits.filter(Boolean).length], ['V', 'V7', 1], 'bar 8 = V then V7');
  assert.equal(splitRomans(chordsOf('t-deceptive'), 6).splits.filter(Boolean).length, 0, 'ending on vi: no split');
  assert.equal(splitRomans(chordsOf('t-walk'), 4).splits.filter(Boolean).length, 0, '4/4: one chord a bar');
  assert.deepEqual(chordsOf('t-walk'), ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I'], 'the written progression is never changed');
}

// ---- the variation (owner, Nov 5: "the chord progressions need to be varied throughout the song"): chord names in a key,
// each section's own cadence / half cadence, the second time re-harmonized, the pivot before the lifted chorus
{
  assert.deepEqual(['I', 'ii', 'V7', 'vii', 'bVII', 'iv'].map((r) => chordName(r)), ['C', 'Dm', 'G7', 'Bdim', 'Bb', 'Fm'], 'C as ever');
  assert.deepEqual(['I', 'ii', 'iii', 'V7', 'vi', 'bVI', 'bVII', 'iv', 'II7', 'Vsus4'].map((r) => chordName(r, 'D')), ['D', 'Em', 'F#m', 'A7', 'Bm', 'Bb', 'C', 'Gm', 'E7', 'Asus4'], 'in D');
  assert.deepEqual(['I7', 'VI7', 'III7', 'II7', 'bVI', 'Vsus4'].map((r) => chordName(r)), ['C7', 'A7', 'E7', 'D7', 'Ab', 'Gsus4']);
  assert.equal(keyName(LIFT), 'D', 'the lift: a whole step');
  assert.deepEqual(['II7', 'VI7', 'bVII', 'vi', 'Vsus4'].map(romanLabel), ['V7/V', 'V7/ii', '♭VII', 'vi', 'Vsus4']);
  assert.equal(progressionIdOf(chordsOf('gospel')), 'gospel');
  assert.equal(progressionIdOf(['I', 'I', 'I', 'I']), null, 'a progression of the director\'s own');
  assert.deepEqual(['t-lift-vi', 'doowop', null].map(progressionLabel), ['lift vi', 'doo-wop', 'own changes']);
  assert.deepEqual(['verse1b', 'chorus3', 'outro'].map(sectionLabel), ['verse 1, build', 'chorus 3', 'outro']);
  // each section its own ending: chorus 1 on IV, chorus 2 on the borrowed iv, chorus 3 on V7/V, then V7 -> I; the outro ♭VI ♭VII -> I
  const gospel = sectionRomans(chordsOf('gospel'), 'chorus1');
  const ends = (section, o = {}) => { const h = harmonize(sectionRomans(chordsOf('gospel'), section), { section, ...o }); return [h.romans.at(-2), h.splits.at(-2), h.romans.at(-1)]; };
  assert.deepEqual(ends('chorus1'), ['IV', 'V7', 'I']);
  assert.deepEqual(ends('chorus2'), ['iv', 'V7', 'I']);
  assert.deepEqual(ends('chorus3'), ['II7', 'V7', 'I']);
  assert.deepEqual(ends('outro'), ['bVI', 'bVII', 'I'], 'the conclusive outro: the ♭VI ♭VII ending');
  assert.deepEqual(ends('outro', { tags: { outro: 'soft' } }), ['IV', 'iv', 'I'], 'a soft one: the minor plagal');
  assert.equal(harmonize(sectionRomans(chordsOf('t-cadence-ii'), 'outro'), { section: 'outro' }).romans[5], 'IV', 'its lead-in: IV, not ii, before ♭VI');
  assert.deepEqual(harmonize(sectionRomans(chordsOf('nursery'), 'verse1'), { section: 'verse1' }).romans.slice(-2), ['ii', 'I'], 'a verse: ii then V7 -> I');
  // the half cadences: V / V7 (the intro), Vsus4 / V7 (Verse A2), V7/V / V7 (Verse B2), the pivot Vsus4 / V
  const halfOf = (section, o = {}) => { const h = harmonize(chordsOf('t-ramp'), { section, ...o }); return [h.romans.at(-1), h.splits.at(-1)]; };
  assert.deepEqual(halfOf('intro'), ['V', 'V7']);
  assert.deepEqual(halfOf('verse1b'), HALF_CADENCE.verse1b);
  assert.deepEqual(halfOf('verse2b'), HALF_CADENCE.verse2b);
  assert.deepEqual(halfOf('bridge2', { pivot: true }), PIVOT, 'the bar before the lift: V, its old key\'s, is the new key\'s IV');
  assert.equal(harmonize(chordsOf('t-deceptive'), { section: 'bridge' }).splits.filter(Boolean).length, 0, 'ending on vi: no split');
  // the second time: at most two bars changed, never the first nor the ending; the same progression heard again differs
  for (const id of Object.keys(CADENCE_APPROACH).length ? [...new Set(Object.values(PROGRESSION_SETS).flat())] : []) {
    const w = sectionRomans(chordsOf(id), 'chorus2');
    const once = harmonize(w, { section: 'chorus2' }), twice = harmonize(w, { section: 'chorus2', again: true });
    assert.ok(twice.changed.length <= 2 && twice.changed.every((i) => i >= 1 && i < w.length - 1), `${id}: ${twice.changed}`);
    assert.equal(twice.romans[0], w[0], `${id}: it opens on its progression`);
    assert.deepEqual(twice.romans.slice(-1), once.romans.slice(-1), `${id}: its ending kept`);
    twice.changed.forEach((i) => assert.notEqual(twice.romans[i], once.romans[i]));
  }
  assert.deepEqual(harmonize(gospel, { section: 'chorus2', again: true }).romans, ['I', 'IV', 'I', 'V', 'I7', 'IV', 'iv', 'I'], 'chorus 2: C7 into F, the minor iv');
  assert.deepEqual(reharmonize(['I', 'I', 'IV', 'I', 'V', 'V', 'V', 'I']).romans, ['I', 'vi', 'IV', 'II7', 'V', 'V', 'V', 'I'], 'the relative minor, the push into V');
  assert.deepEqual(harmonize(['I', 'IV'], { section: 'chorus1', meter: 4 }).splits, [null, null], '4/4: one chord a bar');
}

// ---- 6/4: the child tunes by pulses (MelodySix.ChildSixLayout): two bars a line, the words done by beat 4 of the
// second (beat 9), every note an eighth at least, the strong notes (beats 1 and 4, long, last) on their chord (from
// beat 4 of a split bar the second one), no faster than two syllables a second, a child's range
const romans = ['I', 'IV', 'V', 'I', 'vi', 'IV', 'V7', 'I'];
{
  const six = splitRomans(['I', 'IV', 'V', 'I', 'vi', 'IV', 'V7', 'I'], 6);
  let checked = 0;
  for (const melody of ['nursery', 'bouncy', 'rocking', 'march', 'risefall', 'arch', 'chant', 'pentatonic', 'anthem', 'callback']) {
    for (const n of [2, 3, 5, 6, 7, 8]) {
      for (const startBar of [0, 2, 4, 6]) {
        for (const tempo of [132, 136]) {
          const sylls = syllabify(['Hot soup for all', 'The bowl is warm and red', 'Gold sells hot soup on a cold day', 'We share the warm soup with the town',
            'Hi', 'A cup', 'Big pot of soup', 'Stir it up and pour'].find((x) => syllabify(x).length === n) ?? 'la '.repeat(n).trim());
          const st = sylls.length === n ? sylls.map((x) => x.stress) : null;
          const { notes, bars } = tuneNotes({ melody, syllableCount: n, chords: six.romans, splits: six.splits, voice: 'soprano', tempo, startBar, minBars: 2,
            syllables: sylls.length === n ? sylls : null, stress: st, meter: 6 });
          assert.equal(bars, 2, `${melody} ${n}: two bars`);
          assert.equal(notes.length, n);
          const beatSec = 60 / tempo, doM = childDo('C', 0, 57, 81);
          for (const [i, x] of notes.entries()) {
            assert.ok(x.midi >= doM - 1 && x.midi <= doM + 9, `${melody}: ${x.midi} in the child window`);
            // (the words are done by beat 4 of bar 2, the reply's place; the last syllable rings on to the bar's end less its
            // release, under the reply: owner, Nov 4, "extend the last syllable of each line; it's fine for them to overlap with the Echo")
            const end = x.beat + x.dur / beatSec;
            if (i < n - 1) assert.ok(end <= 9 + 1e-6, `${melody} ${n}: the words done by beat 4 of bar 2 (${x.beat})`);
            else {
              assert.ok(x.beat <= 9 - 0.5 + 1e-6, `${melody} ${n}: the last syllable starts before beat 4 of bar 2 (${x.beat})`);
              assert.ok(Math.abs(end - 11.5) < 1e-6, `${melody} ${n}: the last syllable rings to the bar's end less its release (${end})`);
            }
            if (i > 0) assert.ok(x.beat - notes[i - 1].beat >= 0.5 - 1e-6, `${melody} ${n}: an eighth at least`);
            const bar = startBar + x.bar, inBar = x.beat - 6 * x.bar;
            const chord = inBar >= 3 - 1e-6 && six.splits[bar] ? six.splits[bar] : six.romans[bar];
            if (x.strong) assert.ok(chordFromRoman(chord).tones.includes(x.midi % 12), `${melody} ${n} at ${x.beat}: strong note on ${chord}`);
          }
          assert.ok(notes.some((x) => x.beat === 0), 'the line opens on its downbeat');
          if (n >= 2) {
            const rate = (n - 1) / (notes.at(-1).t - notes[0].t);
            assert.ok(rate <= MAX_SYLLABLE_RATE + 1e-9, `${melody} ${n} at ${tempo}: ${rate.toFixed(2)} syllables/s`);
          }
          checked++;
        }
      }
    }
  }
  assert.equal(tuneBars('nursery', SIX_LINE_MAX, 2, { meter: 6 }), 2, 'eight syllables in two 6/4 bars');
  assert.equal(tuneBars('nursery', SIX_LINE_MAX + 1, 2, { meter: 6 }), 4, 'nine in four');
  // the cadence lands on beat 4 of the home bar, on do; with a reply after it the words are done by then
  const cad = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: six.romans, splits: six.splits, voice: 'woman', tempo: 134, startBar: 6, cadenceBar: 7, meter: 6 });
  assert.equal(cad.notes.at(-1).midi % 12, 0, '6/4: the cadence lands on do');
  // (MelodySix CadenceRhythmSix: the landing on beat 4 when other words share the home bar, alone on its downbeat; held to the bar's end)
  for (const n of [6, 7, 8]) {
    const c = tuneNotes({ melody: 'anthem', syllableCount: n, chords: six.romans, splits: six.splits, voice: 'woman', tempo: 134, startBar: 6, cadenceBar: 7, meter: 6 });
    const home = c.notes.filter((x) => x.bar === 1), land = c.notes.at(-1);
    assert.ok(home.length >= 2 && land.beat === 9, `6/4 ${n}: the landing on beat 4 of the home bar, a word before it there`);
    assert.ok(Math.abs(land.beat + (land.dur * 134) / 60 - 11.5) < 1e-6, '6/4: held to the bar\'s end');
    assert.equal(land.midi % 12, 0);
  }
  assert.ok([6, 7, 8].some((n) => tuneNotes({ melody: 'anthem', syllableCount: n, chords: six.romans, splits: six.splits, voice: 'woman', tempo: 134, startBar: 6, cadenceBar: 7, meter: 6 }).notes.at(-1).beat === 9), 'a cadence on beat 4');
  assert.ok(cad.notes.filter((x) => x.bar === 0 && x.beat >= 3).every((x) => chordFromRoman('V7').tones.includes(x.midi % 12) || !x.strong), 'bar 7 from beat 4: V7');
  const gap6 = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: six.romans, splits: six.splits, voice: 'woman', tempo: 134, startBar: 6, cadenceBar: 7, cadenceGap: true, meter: 6 });
  // (a reply after the cadence: the last note starts before the reply's beat 4 and rings under it, to the bar's end less its release)
  assert.ok(gap6.notes.at(-1).beat <= 9 - 0.5 + 1e-6, '6/4: a reply after the cadence: the last note starts a breath before beat 4');
  assert.ok(Math.abs(gap6.notes.at(-1).beat + gap6.notes.at(-1).dur * 134 / 60 - 11.5) < 1e-6, '6/4: ... and rings to the bar\'s end under the reply');
  assert.ok(checked >= 400, `${checked} lines`);
}

// ---- 4/4 (the engine still sings it): two bars a line, the second done by beat 3, a child's range, chord tones on the strong beats
for (const melody of ['nursery', 'bouncy', 'rocking', 'march', 'risefall', 'arch', 'chant', 'pentatonic', 'anthem', 'callback']) {
  for (const n of [3, 5, 6, 7]) {
    for (const startBar of [0, 2, 4]) {
      const { notes, bars } = tuneNotes({ melody, syllableCount: n, chords: romans, voice: 'soprano', tempo: 92, startBar, minBars: 2, meter: 4 });
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
assert.equal(tuneBars('nursery', 9, 0, { meter: 4 }), 4, 'a long line takes four bars');
const cad = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: romans, voice: 'woman', tempo: 92, startBar: 6, cadenceBar: 7, meter: 4 });
assert.equal(cad.notes.at(-1).midi % 12, 0, 'the cadence lands on do');
assert.equal(cad.notes.at(-1).beat, 6, 'on beat 3 of the home bar');
const gap = tuneNotes({ melody: 'anthem', syllableCount: 6, chords: romans, voice: 'woman', tempo: 92, startBar: 6, cadenceBar: 7, cadenceGap: true, meter: 4 });
assert.ok(gap.notes.at(-1).beat <= 6 + 1e-6, 'a reply after the cadence: the line lands by the bar\'s middle');
assert.ok(Math.abs(gap.notes.at(-1).beat + gap.notes.at(-1).dur * 92 / 60 - 7.75) < 1e-6, '4/4: and rings to the bar\'s end less its release, under the reply');
assert.equal(childDo('C', 0, 36, 60), 48, 'the basso sings the tune an octave down');
// the backing cells: one bar each, on the chord
for (const [melody, text, role] of [['staccato', 'Bom, bom, bom, bom', 'bass'], ['offbeat', 'Doo, dee, doo, dee', 'root'], ['sustain', 'Ooh', 'fifth'], ['arpeggio', 'La, la, la, la', 'root']]) {
  for (const meter of [4, 6]) {
    const r = tuneNotes({ melody, syllableCount: syllabify(text).length, chords: ['IV'], role, voice: 'woman', meter });
    assert.equal(r.bars, 1, melody);
    assert.ok(r.notes.every((x) => chordFromRoman('IV').tones.includes(x.midi % 12)), `${melody} sings the chord`);
    assert.ok(r.notes.every((x) => x.beat >= 0 && x.beat < meter), `${melody}: one bar of ${meter}`);
  }
}
// 6/4's groove: "Bom" oom-pa on 1 3 4 6 (the pulses strong), "doo" between them on 2 3 5 6; a split bar's cells on both chords
assert.deepEqual(tuneNotes({ melody: 'staccato', syllableCount: 4, chords: ['I'], role: 'bass', voice: 'basso', meter: 6 }).notes.map((x) => x.beat), [0, 2, 3, 5]);
assert.deepEqual(tuneNotes({ melody: 'offbeat', syllableCount: 4, chords: ['I'], role: 'root', voice: 'robo', meter: 6 }).notes.map((x) => x.beat), [1, 2, 4, 5]);
{
  const r = tuneNotes({ melody: 'staccato', syllableCount: 4, chords: ['ii'], splits: ['V7'], role: 'bass', voice: 'basso', meter: 6 });
  assert.ok(r.notes.every((x) => chordFromRoman(x.beat >= 3 ? 'V7' : 'ii').tones.includes(x.midi % 12)), 'the bass changes chord on beat 4');
}
// the echo's replies: in the gap (beat 3 of the bar to the next line), on the chord where it is strong
for (const shape of ['repeat', 'third', 'fragment', 'invert', 'sigh', 'stepup', 'sixth', 'answer', 'neighbor', 'augment', 'stepdown', 'rise']) {
  for (const n of [1, 2, 3, 4, 5]) {
    const r = replyNotes({ shape, syllableCount: n, chord: 'V', voice: 'soprano', tempo: 92, answering: [{ beat: 0, midi: 67 }, { beat: 1, midi: 65 }], answerEnd: 3.5, meter: 4 });
    assert.equal(r.notes.length, n);
    assert.ok(r.notes[0].beat >= 2.5 - 1e-6, `${shape}: after the line and a breath`);
    const last = r.notes.at(-1);
    assert.ok(last.beat + last.dur * 92 / 60 <= 3.5 - 0.15 + 1e-6, `${shape}: before the next line's pickup`);
    for (const x of r.notes) if (x.strong) assert.ok([7, 11, 2].includes(x.midi % 12), `${shape}: on the chord`);
    // 6/4: beats 4-6 (3 .. 5.85, or before the next line's pickup), the shortest note an eighth's worth
    for (const answerEnd of [null, 5.0]) {
      const q = replyNotes({ shape, syllableCount: n, chord: 'V7', voice: 'soprano', tempo: 134, answering: [{ beat: 0, midi: 67 }, { beat: 1.5, midi: 65 }, { beat: 2, midi: 64 }], answerEnd, meter: 6 });
      assert.equal(q.notes.length, n);
      assert.ok(q.notes[0].beat >= 3 - 1e-6, `${shape}: 6/4: from beat 4`);
      const z = q.notes.at(-1);
      assert.ok(z.beat + z.dur * 134 / 60 <= Math.min(5.85, (answerEnd ?? 6) - 0.15) + 1e-6, `${shape} ${n}: 6/4: by beat 6 (${answerEnd})`);
      for (const x of q.notes) if (x.strong) assert.ok([7, 11, 2, 5].includes(x.midi % 12), `${shape}: 6/4: on the chord`);
    }
  }
}
assert.equal(echoOf('Flip, flip, pancake!'), 'Pancake');
assert.equal(echoOf('Stars above the fence'), 'The fence');
assert.equal(echoOf('Knock, knock, Grandma, hi!'), 'Grandma, hi');
assert.deepEqual(pickupPitches(64, 2, 'C', 57, 81), [60, 62], 'a pickup steps up into the line');
assert.equal(syllabify('She has it, get it').length, 5, '"has" and "get" are sung as written');

// ---- the mix (StoryMix.cs)
assert.deepEqual(['story', 'reply', 'echo', 'words', 'backing'].map((l) => layerDb(l, 'verse1')), [0, 0, -4, -9, -17]);
assert.equal(layerDb('backing', 'bridge2'), -20, 'the bridges: 3 dB more under the grown-up');
assert.equal(layerDb('story', 'bridge'), 0);
assert.deepEqual(['story', 'echo', 'words', 'backing'].map((l) => liftDb(l, 'verse1')), [0, 0, 5, 13]);
const spans = storySpans([{ layer: 'story', at: 10, job: { notes: [{ t: 0, dur: 1 }, { t: 2, dur: 1 }] } }, { layer: 'story', at: 14, job: { notes: [{ t: 0, dur: 1 }] } }], 2.6);
assert.equal(spans.length, 1, 'a short rest keeps the backing under the story');
assert.equal(storyAt(spans, 12), 1);
assert.equal(storyAt(spans, 30), 0);
assert.ok(storyAt(spans, spans[0][0] - 0.3) > 0 && storyAt(spans, spans[0][0] - 0.3) < 1, 'ramps');
const pad = layerGain({ layer: 'backing', section: 'intro', at: 0, job: { notes: [{ t: 0, dur: 20 }] } }, spans);
assert.equal(pad.db, -17);
assert.equal(liftAt(pad.lift, 0), 13, 'nobody tells the story: the backing comes up');
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
assert.equal(liftAt(under.lift, 15), 13, 'and comes up where nobody sings');
assert.ok(SYLLABLE_DUCK_DB.backing < 0 && SYLLABLE_DUCK_DB.backing >= -6 && SYLLABLE_DUCK_DB.words <= 0 && !SYLLABLE_DUCK_DB.story);
assert.ok(WET.backing < WET.story, 'the choir behind is drier than the story');
assert.ok(LAYER_EQ.backing.some((f) => f.type === 'peaking' && f.gain < 0 && f.f >= 1000 && f.f <= 4000), 'the backing is carved out of the consonants\' band');
assert.deepEqual(LAYER_EQ.story, [], 'the story untouched');
assert.ok(ROLE_EQ.pad.some((f) => f.type === 'lowpass'));
assert.ok(!PAN.lead && Math.abs(PAN.pad) > 0.2, 'the story in the centre, the choir spread');
assert.ok(ducks(8, 14, 10));

// a story line's last syllable sinks under the answer that sings over it (TAIL_DIP_DB), not before it
{
  const line = { at: 10, job: { notes: [{ t: 0, dur: 1 }, { t: 1, dur: 2.5 }] } }; // (the last note sounds 11 .. 13.5)
  assert.equal(tailLift(line, []), null);
  assert.equal(tailLift(line, [{ at: 10.5 }]), null, 'an answer before the last note');
  assert.equal(tailLift(line, [{ at: 13.4 }]), null, 'one that starts as it ends');
  const lift = tailLift(line, [{ at: 12.9 }, { at: 12.4 }]);
  assert.deepEqual(lift.map(([t, d]) => [+t.toFixed(2), d]), [[12.35, 0], [12.6, TAIL_DIP_DB], [13.45, TAIL_END_DB]], 'under the first answer, dying away to the note\'s end');
}

// ---- the arrangement of v2 bundles
for (const prompt of ['Blue brings home the biggest toy box on the street', 'Gold sells hot soup on a cold day', 'Jade races Orange around the block']) {
  const { beats, events } = generate(prompt);
  const song = arrange(events, beats);
  const B = song.bar, beatSec = 60 / song.tempo;
  assert.ok(song.tempo >= 132 && song.tempo <= 136 && song.meter === 6 && Math.abs(B - 6 * beatSec) < 1e-12, '6/4 at 132-136');
  assert.equal(song.sections.length, 11);
  song.sections.forEach((s, i) => {
    assert.ok(Math.abs(s.t - i * 8 * B) < 1e-6, `${prompt}: ${s.section} starts on its bar`);
    // listen-proxy: the chord at each section's first bar is the written progression's first (named in its key)
    const written = events.find((e) => e.beat === s.beat).chords;
    assert.equal(s.romans[0], romanOfName(written[0]), `${prompt}: ${s.section} opens on its progression`);
    assert.equal(s.chords[0], chordName(romanOfName(written[0]), s.key), `${prompt}: ${s.section} opens on its progression, in ${s.key}`);
    // the cadence (6/4): bar 7 the section's own approach (CADENCE_APPROACH) then its dominant on beat 4, bar 8 home
    if (['chorus', 'outro'].includes(s.kind)) {
      const key = s.kind === 'outro' ? `outro:${beats.tags?.outro === 'soft' ? 'soft' : 'conclusive'}` : s.section;
      assert.ok((CADENCE_APPROACH[key] ?? [['ii', 'V7']]).some(([p, d]) => s.romans.at(-2) === p && s.splits.at(-2) === d), `${prompt}: ${s.section} cadence ${s.romans.at(-2)}/${s.splits.at(-2)}`);
      assert.deepEqual([s.romans.at(-1), s.chords.at(-1)], ['I', chordName('I', s.key)], `${prompt}: ${s.section} lands home`);
    }
    // a half cadence: its last bar two chords (V then V7, the section's own, or the pivot before the lift)
    if (s.splits.at(-1)) assert.ok([['V', 'V7'], HALF_CADENCE[s.section], PIVOT].some((x) => x && s.romans.at(-1) === x[0] && s.splits.at(-1) === x[1]), `${prompt}: ${s.section}: a half cadence ${s.romans.at(-1)}/${s.splits.at(-1)}`);
    assert.ok(s.thens.filter(Boolean).length <= 1, 'two chords a bar at the cadence only');
  });
  assert.equal(song.sections[0].chords[0], 'C', 'the intro opens on the tonic');
  // the variation: no two sections sung on the same chords; the second time re-harmonized; the last chorus and the outro a
  // whole step up (D), the bar before it the pivot; many more chords than the old seven
  const strings = song.sections.map((s) => s.romans.map((r, k) => `${r}/${s.splits[k] ?? ''}`).join(' ') + s.key);
  assert.equal(new Set(strings).size, strings.length, `${prompt}: every section its own chords`);
  for (const name of ['verse2', 'chorus2']) assert.ok(song.sections.find((s) => s.section === name).changed.length >= 1, `${prompt}: ${name} re-harmonized`);
  assert.deepEqual(song.sections.map((s) => s.key).join(' '), 'C C C C C C C C C D D', `${prompt}: chorus 3 and the outro up a step`);
  assert.equal(song.sections.find((s) => s.section === 'bridge2').pivot, 'D');
  assert.ok(new Set(song.sections.flatMap((s) => [...s.chords, ...s.thens.filter(Boolean)])).size >= 12, `${prompt}: a dozen chords at least`);
  // the readout follows the song (chord-readout.js): its chord at a bar is the section's, the split's from beat 4
  {
    const c3 = song.sections.find((s) => s.section === 'chorus3'), b2 = song.sections.find((s) => s.section === 'bridge2');
    const r0 = songReadout(song, c3.t + 0.01);
    assert.ok(r0.now.name === c3.chords[0] && r0.now.roman === c3.romans[0] && /up a step, in D/.test(r0.label), `${prompt}: ${JSON.stringify(r0)}`);
    const last = b2.t + (b2.bars - 1) * B;
    assert.ok(songReadout(song, last + 0.1).now.name === b2.chords.at(-1) && songReadout(song, last + 3.1 * beatSec).now.name === b2.thens.at(-1), 'the split from beat 4');
    assert.ok(/pivot to D/.test(songReadout(song, last + 0.1).label) && songReadout(song, last + 3.1 * beatSec).next.key === 'D', 'the pivot, the next chord in D');
    assert.match(readoutHtml(r0), /<b>G<\/b><i>IV<\/i>/);
    assert.equal(songReadout(song, -1), null);
  }
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
  // the sung rate (owner, Oct 31: normal speaking speed, never squeezed): a story line no faster than two syllables a
  // second onset to onset (its pickup aside), no syllable shorter than an eighth (0.22 s at 136)
  const rates = [];
  for (const l of story) {
    const own = l.job.notes.slice(l.pickup);
    if (own.length >= 2) rates.push((own.length - 1) / (own.at(-1).t - own[0].t));
    own.slice(1).forEach((x, i) => assert.ok(x.t - own[i].t >= 0.5 * beatSec - 1e-6, `${prompt}: "${l.job.text}" syllable ${i} ${(x.t - own[i].t).toFixed(3)} s`));
  }
  assert.ok(Math.max(...rates) <= MAX_SYLLABLE_RATE + 1e-9, `${prompt}: ${Math.max(...rates).toFixed(2)} syllables/s at most`);
  // the strong beats (1 and 4) of the story's lines on a tone of their chord (the split chord from beat 4)
  {
    let on = 0, all = 0;
    for (const l of story) {
      const sec = song.sections.find((x) => x.section === l.section);
      for (const x of l.job.notes.slice(l.pickup)) {
        const beats = (l.at + x.t - sec.t) / beatSec, bar = Math.floor(beats / 6 + 1e-6), inBar = beats - 6 * bar;
        if (Math.abs(inBar) > 1e-6 && Math.abs(inBar - 3) > 1e-6) continue;
        const name = inBar >= 3 - 1e-6 && sec.thens[bar] ? sec.thens[bar] : sec.chords[bar] ?? 'C';
        all++;
        if (chordFromRoman(romanOfName(name)).tones.includes(x.midi % 12)) on++;
      }
    }
    assert.ok(all > 60 && on >= 0.95 * all, `${prompt}: ${on} of ${all} lead notes on beats 1 and 4 are chord tones`);
  }
  // the words of a line are done by beat 4 of its second bar (the gap on beats 4-6), a cadence lands on beat 4
  for (const l of story) {
    const sec = song.sections.find((x) => x.section === l.section);
    const last = l.job.notes.at(-1), b = (l.at + last.t - sec.t) / beatSec, bar = Math.floor(b / 6 + 1e-6), inBar = b - 6 * bar;
    assert.ok(inBar <= 3 + 1e-6, `${prompt}: "${l.job.text}" done by beat 4 (${inBar.toFixed(2)})`);
    // (a reply after it in the home bar: the words done by beat 4, CadenceGapRhythm)
    const replied = song.lines.some((r) => (r.role === 'reply' || r.role === 'echo') && r.section === l.section && r.at > l.at && Math.floor((r.at - sec.t) / B + 1e-6) === bar);
    if (['chorus', 'outro'].includes(sec.kind) && bar === sec.bars - 1 && !replied) assert.ok(Math.abs(inBar - 3) < 1e-6, `${prompt}: "${l.job.text}": the cadence on beat 4 (${inBar})`);
  }
  // the last syllable of each line rings on (owner, Nov 4: "extend the last syllable of each line; it's fine for them to overlap with
  // the Echo"): to its bar's end less a half beat, or to the next line's pickup; a harmony the same, a bot never sings two parts at once
  story.forEach((l, i) => {
    if (l.job.notes.length < 2) return;
    const last = l.job.notes.at(-1), end = l.at + last.t + last.dur, barEnd = (Math.floor((l.at + last.t) / B + 1e-6) + 1) * B;
    const limit = Math.min(barEnd - 0.5 * beatSec, story[i + 1] ? story[i + 1].at - PICKUP_GAP_BEATS * beatSec : Infinity);
    assert.ok(end >= limit - 1e-4, `${prompt}: "${l.job.text}" ends ${(limit - end).toFixed(2)} s before its bar's end`);
  });
  {
    const sung = song.lines.filter((l) => l.layer !== 'backing');
    for (let a = 0; a < sung.length; a++) for (let b = a + 1; b < sung.length; b++) {
      if (sung[a].bot !== sung[b].bot) continue;
      assert.ok(lineEnd(sung[a]) <= sung[b].at + 0.02 || lineEnd(sung[b]) <= sung[a].at + 0.02, `${prompt}: ${sung[a].bot} sings "${sung[a].job.text}" and "${sung[b].job.text}" at once`);
    }
    const under = song.lines.filter((r) => r.layer === 'reply' || r.layer === 'echo').filter((r) => story.some((l) => l.section === r.section && l.at < r.at && lineEnd(l) > r.at + 0.05)).length;
    assert.ok(under >= 20, `${prompt}: ${under} replies sung under a ringing last syllable`);
    // (the line they sing over sinks under them, TAIL_DIP_DB, dying away to TAIL_END_DB, and only that line)
    const answers = song.lines.filter((r) => r.layer === 'reply' || r.layer === 'echo');
    const over = story.filter((l) => { const z = l.job.notes.at(-1); return answers.some((r) => r.at > l.at + z.t + 1e-6 && r.at < l.at + z.t + z.dur - 0.2); });
    assert.ok(over.length >= 20 && over.every((l) => l.lift?.at(-1)[1] === TAIL_END_DB && l.lift.at(-2)[1] === TAIL_DIP_DB), `${prompt}: ${over.length} lines sink under their reply`);
    assert.deepEqual(story.filter((l) => l.lift).map((l) => l.seq), over.map((l) => l.seq), `${prompt}: no other story line is lifted or dipped`);
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
  // 6/4: the pal answers on beats 4-6 of the line's last bar
  for (const l of song.lines.filter((x) => x.role === 'reply' || x.role === 'echo')) {
    const sec = song.sections.find((x) => x.section === l.section);
    const b0 = (l.at - sec.t) / beatSec, bar = Math.floor(b0 / 6 + 1e-6);
    const z = l.job.notes.at(-1), end = (l.at + z.t + z.dur - sec.t) / beatSec - 6 * bar;
    assert.ok(b0 - 6 * bar >= 3 - 1e-6 && end <= 5.85 + 1e-6, `${prompt}: "${l.job.text}" on beats 4-6 (${(b0 - 6 * bar).toFixed(2)}..${end.toFixed(2)})`);
  }
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
  // the backing sings its chord's tones, in a split bar from beat 4 the second chord's (a held pad: once on each)
  let splitCells = 0;
  for (const l of song.lines.filter((x) => x.segments && x.layer === 'backing' && x.role !== 'counter')) {
    const sec = song.sections.find((z) => z.section === l.section);
    for (const g of l.segments) {
      for (const x of g.job.notes) {
        const beats = (g.at + x.t - sec.t) / beatSec, bar = Math.floor(beats / 6 + 1e-6), inBar = beats - 6 * bar;
        if (bar >= sec.bars) continue; // (the last chord ringing)
        const second = inBar >= 3 - 1e-6 && sec.thens[bar];
        if (second) splitCells++;
        const name = second ? sec.thens[bar] : sec.chords[bar];
        assert.ok(chordFromRoman(romanOfName(name)).tones.includes(x.midi % 12), `${prompt}: ${l.role} at bar ${bar} beat ${inBar.toFixed(2)} on ${name}`);
      }
    }
  }
  assert.ok(splitCells >= 20, `${splitCells} backing notes on a bar's second chord`);
  // the mix levels ride on the lines
  for (const l of song.lines) assert.equal(l.db, lineDb(l));
  // the song resolves home: the last sounding bar is the tonic (of the lifted key: D)
  const last = song.lines.filter((l) => l.segments).flatMap((l) => l.segments).reduce((a, g) => (g.at > a.at ? g : a));
  assert.ok(chordFromRoman('I', song.sections.at(-1).key).tones.includes(last.job.notes[0].midi % 12), `the last chord is ${song.sections.at(-1).key}`);
  assert.ok(song.end > 220 && song.end < 270, `${prompt}: ${song.end.toFixed(0)} s (about four minutes)`);
}

// v1 bundles still arrange (the sample's two beats; a curated bundle)
const sample = parseNdjson(readFileSync(new URL('../episodes/sample/events.ndjson', import.meta.url), 'utf8'));
const s1 = arrange(sample);
assert.ok(sample.every((e) => s1.events.some((x) => x.seq === e.seq)));
assert.ok(s1.lines.filter((l) => l.layer === 'story').length === sample.filter((e) => e.lyric).length);

// a reply and a backing cell render through the voice engine
const song = arrange(...Object.values(generate('Red finds a lost puppy in the park')).reverse());
for (const role of ['reply', 'bass', 'counter']) {
  const l = song.lines.find((x) => x.role === role);
  const j = l.segments ? l.segments[0].job : l.job;
  const r = renderLine(j);
  assert.ok(r.pcm.length > 0 && r.syllableTimes.length === j.notes.length, role);
}
console.log(`song ok: 11 sections at ${song.tempo} bpm, ${song.lines.length} lines (${song.end.toFixed(0)} s), replies in the gaps, sung backing, mix by layer`);
