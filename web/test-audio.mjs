import assert from 'node:assert/strict';
import { chordNotes, chordsInWindow, melodyFor, midiToHz, vowelOf } from './src/audio-theory.js';

assert.deepEqual(chordNotes('C').notes, [48, 52, 55]);
assert.deepEqual(chordNotes('Am').notes, [57, 60, 64]);
assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
assert.equal(vowelOf('box'), 'o');
const m1 = melodyFor('Box at the gate today!', 'soprano'), m2 = melodyFor('Box at the gate today!', 'soprano');
assert.deepEqual(m1, m2); assert.equal(m1.length, 5);
assert.ok(m1.every((n) => n.midi >= 60 && n.midi <= 96));
assert.ok(melodyFor('Box', 'basso')[0].midi < melodyFor('Box', 'soprano')[0].midi);
const w = chordsInWindow(['C', 'G'], 0, 2, 0, 3);
assert.deepEqual(w, [{ time: 0, chord: 'C' }, { time: 1, chord: 'G' }, { time: 2, chord: 'C' }]);
assert.deepEqual(chordsInWindow([], 0, 2, 0, 3), []);
console.log('audio ok');
