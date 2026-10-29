// Singing accuracy: stress-fitted rhythm (web/src/mv/music/stressFit.js, a port of Magna.Core
// StressFit), sub-phrases split for the words (melody.js fitSplit), accents on bar downbeats only,
// stress-aware sung levels (text/sungStress.js).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { generateNotes, rhythmFor } from './src/mv/music/melody.js';
import { accent, applyStressFit, metric, mismatch } from './src/mv/music/stressFit.js';
import { syllabify, stressOf } from './src/mv/voice/syllables.js';
import { sungGainDb, PRIMARY, SECONDARY, UNSTRESSED, WEAK } from './src/mv/voice/text/sungStress.js';
import { arrange, BEAT, romanOf } from './src/sing-plan.js';
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
  for (const l of arrange(events).lines) {
    const sy = syllabify(l.job.text);
    l.job.notes.forEach((n, i) => {
      const beat = (l.at + n.t) / BEAT;
      const inBar = ((beat % 4) + 4) % 4;
      if (n.downbeat) {
        accents++;
        // (StressFit never moves a downbeat note, so the accent sits exactly on beat 1)
        assert.ok(near(inBar, 0, 1e-6) || near(inBar, 4, 1e-6), `${dir} #${l.seq}: accent on beat ${inBar + 1}`);
      }
      const next = l.job.notes[i + 1];
      if (next && (next.t - n.t - n.dur) / BEAT >= 0.4 && sy[i].stress < 0) endsFn++;
      if (next && n.dur / BEAT >= 3 && sy[i + 1].wordIndex === sy[i].wordIndex) longSplits++;
    });
    lines++;
  }
}
assert.ok(accents > 0);
assert.equal(endsFn, 0, 'sub-phrases ending on a function word');
assert.equal(longSplits, 0, 'holds of 3 beats or more inside a word');

console.log(`sing ok: ${GOLD.length} StressFit goldens, phrase splits, ${lines} lines with ${accents} downbeat accents`);
