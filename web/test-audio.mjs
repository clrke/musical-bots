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

// a hidden tab: a line scheduled ahead (singAhead) is not sung again when the stage gets to its event, and starts on time
{
  const { Choir } = await import('./src/audio.js');
  const starts = [];
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), connect(n) { return n; } });
  const ctx = { currentTime: 10, state: 'running', createGain: node,
    createBufferSource: () => ({ connect() {}, start(at, skip) { starts.push([at, skip]); }, stop() {} }) };
  const c = new Choir();
  Object.assign(c, { ctx, dry: node(), wet: node(), buses: {} });
  c.songStart = 10;
  const buffer = { duration: 2 };
  const line = (seq, at) => c.lines.set(seq, { plan: { seq, at, job: { notes: [{}] } }, segments: [{ at, buffer, offset: -0.1 }], syllables: [], length: 2 });
  line(1, 1.5); line(2, 3);
  const e1 = { seq: 1, t: 1.5 }, e2 = { seq: 2, t: 3 }, e3 = { seq: 3, t: 3 };
  assert.equal(c.singAhead([e1, e2, e3]), 2, 'the lines due soon scheduled (a line not rendered yet waits)');
  assert.deepEqual(starts, [[11.4, 0], [12.9, 0]], 'each on the song clock, from its pre-roll');
  assert.equal(c.singAhead([e1, e2]), 0, 'not twice');
  ctx.currentTime = 11.6;
  assert.equal(c.sing(e1), false, 'the stage staging it: already sung');
  assert.equal(starts.length, 2);
  assert.equal(c.sing(e1), true, 'staged again (a seek back): sung');
  c.hush(); // (a skip: what was scheduled ahead stops, and nothing is held back)
  c.songStart = 10;
  assert.equal(c.sing(e2), true, 'hushed: nothing held');
}
console.log('audio ok (and a hidden tab\'s lines sung ahead once)');
