// Singing accuracy: stress-fitted rhythm (web/src/mv/music/stressFit.js, a port of Magna.Core
// StressFit), sub-phrases split for the words (melody.js fitSplit), accents on bar downbeats only,
// stress-aware sung levels (text/sungStress.js).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { generateNotes, rhythmFor } from './src/mv/music/melody.js';
import { accent, applyStressFit, metric, mismatch } from './src/mv/music/stressFit.js';
import { syllabify, stressOf } from './src/mv/voice/syllables.js';
import { sungGainDb, PRIMARY, SECONDARY, UNSTRESSED, WEAK } from './src/mv/voice/text/sungStress.js';
import { arrange, planEpisode, BEAT, romanOf, breathe, COMMA_BREATH } from './src/sing-plan.js';
import { MakingOfScore } from './src/making-of-score.js';
import { chordNotes } from './src/audio-theory.js';
import { chordFromRoman } from './src/mv/music/theory.js';
import { parseNdjson } from './src/player.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const BPM = 132;
const beats = (notes) => notes.map((n) => [Math.round(n.beat * 1e4) / 1e4, Math.round((n.dur * BPM) / 60 * 1e4) / 1e4, n.midi, n.shift]);
const line = (text, o = {}) => {
  const sy = syllabify(text);
  return generateNotes({ melody: 'steady', syllableCount: sy.length, chords: ['I', 'V', 'vi', 'IV'], role: 'lead', voice: 'woman',
    key: 'C', tempo: BPM, syllables: sy, stress: sy.map((s) => s.stress), ...o });
};

// --- StressFit: Magna.Core goldens (GenerateNotes with Stress and WordIndices, upstream split)
const GOLD = [
  [{ text: 'Listen, cake is near!', melody: 'syncopated', chords: ['IV', 'I', 'IV', 'I'], startBar: 0, role: 'bass' },
    [[0, 2, 53, 0], [2, 0.5, 53, 0.5], [2.5, 1, 53, 0], [3.5, 0.5, 55, 0], [4, 3.5, 60, 0]]],
  [{ text: 'Morning comes to Hattie and Sterling!', melody: 'steady', chords: ['IV', 'I', 'IV', 'I'], startBar: 2, role: 'bass' },
    [[0, 1, 53, 0], [1, 1, 53, 0], [2, 1, 53, 0], [3, 1, 53, 0], [4, 2, 60, 0], [6, 1.5, 60, 0], [8, 1.5, 65, 0], [9.5, 2.5, 65, -0.5], [12, 3.5, 60, 0]]],
  [{ text: 'Morning comes to Hattie and Sterling!', melody: 'syncopated', chords: ['I', 'vi', 'IV', 'V'], startBar: 1, role: 'third' },
    [[0, 2, 60, 0], [2, 0.5, 60, 0.5], [2.5, 1, 60, 0], [3.5, 0.5, 62, 0], [4, 1.5, 57, 0], [5.5, 2, 57, 0], [8, 1.5, 59, 0], [9.5, 2.5, 59, 0], [12, 3.5, 64, 0]]],
];
for (const [o, want] of GOLD) {
  const sy = syllabify(o.text);
  const g = generateNotes({ ...o, syllableCount: sy.length, voice: 'woman', key: 'C', tempo: BPM,
    syllables: sy.map((s) => ({ wordIndex: s.wordIndex })), stress: sy.map((s) => s.stress), phrasing: 'words' });
  assert.deepEqual(beats(g.notes), want, `${o.melody} ${o.text}`);
}
assert.equal(metric(0), 1);
assert.equal(metric(2), 0.8);
assert.equal(metric(1), 0.45);
assert.equal(metric(0.5), 0.2);
assert.ok(near(accent(0, 2), 1.35));
// the fit never scans worse, moves at most half a beat, keeps the span and every strong-beat onset
for (const text of ['Relax by the fire', 'Benny finds the box by the gate.', 'A little help is a big help.', 'Hands up high for the box!']) {
  for (const melody of ['steady', 'syncopated', 'lilting', 'rising', 'falling', 'call', 'arpeggio']) {
    const sy = syllabify(text);
    const stress = sy.map((s) => s.stress);
    const before = rhythmFor(melody, sy.length, sy).notes;
    const after = before.map((n) => ({ ...n }));
    const shift = applyStressFit(after, stress);
    const m0 = mismatch(before.map((n) => n.beat), before.map((n) => n.beat + n.dur), stress);
    const m1 = mismatch(after.map((n) => n.beat), after.map((n) => n.beat + n.dur), stress);
    assert.ok(m1 <= m0 + 1e-9, `${melody} ${text}: ${m0} -> ${m1}`);
    assert.ok(near(after[0].beat, before[0].beat) && near(after.at(-1).beat + after.at(-1).dur, before.at(-1).beat + before.at(-1).dur));
    for (const [i, d] of (shift ?? []).entries()) {
      assert.ok(Math.abs(d) <= 0.5 + 1e-9);
      if (stress[i] < 0) assert.ok(after[i].dur <= before[i].dur + 1e-9, `${text}: a function word got longer`);
    }
  }
}

// --- the sub-phrase split: never on a function word, at punctuation when it can
const subPhrases = (text, o = {}) => {
  const sy = syllabify(text);
  const g = line(text, o);
  const parts = [[]];
  g.notes.forEach((n, i) => {
    parts[parts.length - 1].push(sy[i].text);
    const next = g.notes[i + 1];
    if (next && next.beat - (n.beat + (n.dur * BPM) / 60) >= 0.4) parts.push([]);
  });
  return parts.map((p) => p.join(' '));
};
assert.deepEqual(subPhrases('Benny finds the box by the gate.'), ['Ben ny finds', 'the box by the gate']);
assert.deepEqual(subPhrases('Sterling claps the beat, the box bounces high.'), ['Ster ling claps the beat', 'the box boun ces high']);
assert.deepEqual(subPhrases('Benny finds the box by the gate.', { phrasing: 'words' }), ['Ben ny finds the', 'box by the gate'], 'upstream split');
// without stress the rhythm is upstream's, note for note (and every note has shift 0)
const plain = generateNotes({ melody: 'steady', syllableCount: 8, chords: ['I', 'V', 'vi', 'IV'], voice: 'woman', tempo: BPM });
assert.deepEqual(plain.notes.map((n) => n.beat), [0, 1, 2, 4, 8, 9, 10, 12]);
assert.ok(plain.notes.every((n) => n.shift === 0));

// --- sung stress
assert.deepEqual(stressOf('Relax by the fire'), [UNSTRESSED, PRIMARY, WEAK, WEAK, PRIMARY]);
assert.equal(sungGainDb(PRIMARY, false, true), 1.5);
assert.equal(sungGainDb(WEAK, true, false), -2);
assert.equal(sungGainDb(SECONDARY, false, false), 0);

// --- chord symbols: the pad (chordNotes) and the melody engine (romanOf -> chordFromRoman) agree
const SYMS = ['C', 'Am', 'F#m', 'Bb', 'Eb', 'Ab', 'Db', 'G7', 'Cmaj7', 'CM7', 'Am7', 'Bm7b5', 'Bdim', 'C#dim', 'Gsus4', 'Dsus2',
  'Eaug', 'C/E', 'Fadd9', 'Dm6', 'C6', 'F#', 'Gb', 'Em', 'Fm', 'Dm7', 'Bbmaj7', 'G#m', 'Cm(maj7)', 'Bdim7'];
for (const s of SYMS) {
  const pad = new Set(chordNotes(s).notes.map((m) => ((m % 12) + 12) % 12));
  const engine = new Set(chordFromRoman(romanOf(s), 'C').tones);
  assert.deepEqual([...pad].sort((a, b) => a - b), [...engine].sort((a, b) => a - b), `${s} (${romanOf(s)})`);
}
assert.deepEqual(chordNotes('Cmaj7').notes, [48, 52, 55, 59], 'Cmaj7 is major (was read as minor)');
assert.deepEqual(chordNotes('F#m').notes, [54, 57, 61]);
assert.deepEqual(chordNotes('Bb').notes, [58, 62, 65]);
assert.deepEqual(chordNotes('Dm').notes, [50, 53, 57]);

// --- the episodes: accents only on bar downbeats (or a note fitted off one), no sub-phrase ends
// on a function word, no long hold inside a word
const root = new URL('../episodes/', import.meta.url);
let lines = 0, accents = 0, endsFn = 0, longSplits = 0;
for (const dir of readdirSync(root)) {
  let events;
  try { events = parseNdjson(readFileSync(new URL(`${dir}/events.ndjson`, root), 'utf8')); } catch { continue; }
  const song = arrange(events);
  // the LIVE plans (the engine's templates) and the premiere's story lines and harmonies on the words
  // (planLine; the echoes, replies and backing are the arranger's own)
  const planned = (x) => (x.layer === 'story' || x.layer === 'words') && x.role !== 'echo' && x.role !== 'reply';
  for (const [live, beatSec, list] of [[true, BEAT, planEpisode(events)], [false, 60 / song.tempo, song.lines.filter(planned)]]) {
    for (const l of list) {
      const sy = syllabify(l.job.text);
      const m = l.pickup ?? 0; // (a pickup's eighth notes come before the line's first downbeat)
      l.job.notes.forEach((n, i) => {
        if (i < m) { assert.ok(!n.downbeat); return; }
        const beat = (l.at + n.t) / beatSec;
        const B = live ? 4 : song.meter === 6 ? 6 : 4; // (the premiere in 6/4: six beats a bar)
        const inBar = ((beat % B) + B) % B;
        if (n.downbeat) {
          accents++;
          // (StressFit never moves a downbeat note, so the accent sits exactly on beat 1)
          assert.ok(near(inBar, 0, 1e-6) || near(inBar, B, 1e-6), `${dir} #${l.seq}: accent on beat ${inBar + 1}`);
        }
        const next = l.job.notes[i + 1];
        if (!live || !next) return;
        // (a comma's breath, sing-plan.js breathe, is the words' own phrase end: "Thank you, Gold")
        if ((next.t - n.t - n.dur) / beatSec >= 0.4 && sy[i].stress < 0 && sy[i + 1].phrase === sy[i].phrase) endsFn++;
        if (n.dur / beatSec >= 3 && sy[i + 1].wordIndex === sy[i].wordIndex) longSplits++;
      });
      lines++;
    }
  }
}
assert.ok(accents > 0);
assert.equal(endsFn, 0, 'sub-phrases ending on a function word');
assert.equal(longSplits, 0, 'holds of 3 beats or more inside a word');

// --- a breath after a comma ("Hey White, can we talk shop?": the name ends before the next word), on the grid
{
  const notes = [{ t: 0, dur: 0.42 }, { t: 0.42, dur: 1.25 }, { t: 1.67, dur: 0.42 }, { t: 2.08, dur: 0.42 }, { t: 2.5, dur: 0.42 }, { t: 2.92, dur: 1.25 }];
  const b = breathe('Hey White, can we talk shop?', notes);
  assert.deepEqual(b.map((n) => n.t), notes.map((n) => n.t), 'every onset stays: the pace and the bar lines');
  assert.ok(near(b[2].t - (b[1].t + b[1].dur), COMMA_BREATH, 1e-3), `White ends ${COMMA_BREATH} s before "can"`);
  assert.deepEqual([0, 2, 3, 4, 5].map((i) => b[i].dur), [0, 2, 3, 4, 5].map((i) => notes[i].dur), 'only the note before the comma');
  // a short note before a comma keeps most of it, and a rest still comes; a rest already there stays; no comma: as is
  const s2 = breathe('Sure, go', [{ t: 0, dur: 0.42 }, { t: 0.42, dur: 0.42 }]);
  assert.ok(s2[0].dur >= 0.25 - 1e-9 && s2[1].t - s2[0].dur >= 0.06 - 1e-9, `"Sure," ${s2[0].dur}`);
  const rest = [{ t: 0, dur: 0.5 }, { t: 1.5, dur: 0.4 }];
  assert.equal(breathe('Sure, go', rest)[0], rest[0]);
  const four = notes.slice(0, 4);
  assert.equal(breathe('Hey White can we', four), four, 'no comma: as is');
  // the making-of's sung job: the name held, then the breath, then the next word on its beat
  const sc = new MakingOfScore({ live: true });
  sc.add([{ seq: 0, t: 0, agent: 'dance', bot: 'Gray', status: 'working', beat: 'beat-1-intro', summary: 'Hey White, can we talk shop?', lyric: '', chords: [], action: '', consult: [] }], 0);
  sc.flush(30);
  const l = sc.lines.find((x) => x.job?.text === 'Hey White, can we talk shop?');
  const [, white, can] = l.job.notes;
  assert.ok(white.dur >= 0.4 && near(can.t - (white.t + white.dur), COMMA_BREATH, 1e-3), `the making-of: White ${white.dur.toFixed(2)} s, then ${(can.t - white.t - white.dur).toFixed(2)} s of breath`);
  // (its onsets are the tune's: the same grid and pace as without the breath)
  assert.deepEqual(l.job.notes.map((n) => +n.t.toFixed(4)), l.notesTb.map((n) => +sc.sec(n.tb - l.notesTb[0].tb).toFixed(4)), 'the onsets of the tune');
}

console.log(`sing ok: ${GOLD.length} StressFit goldens, phrase splits, ${lines} lines with ${accents} downbeat accents`);
