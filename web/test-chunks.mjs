// Words sung together (text/chunks.js): parts of speech, the binds between words, the automatic pickup of a line that
// opens on an article, and the premiere's layouts keeping bound words together (song/tunes.js, sing-plan.js).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { wordChunks, groupsOf, LEAD, LEAN, MOD, DEG, AUX } from './src/mv/voice/text/chunks.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { arrange, autoPickup } from './src/sing-plan.js';
import { parseNdjson } from './src/player.js';

/** "word/pos" with the bind before it: ~ LEAD, - LEAN, _ MOD/DEG/AUX, | free. */
const show = (text) => {
  let o = '', last = -1;
  for (const s of syllabify(text)) {
    if (s.wordIndex === last) continue;
    last = s.wordIndex;
    o += `${o ? (s.bind >= LEAD ? '~' : s.bind >= LEAN ? '-' : s.bind > 0 ? '_' : ' | ') : ''}${s.word}/${s.pos}`;
  }
  return o;
};
const binds = (text) => {
  const out = {};
  let last = -1;
  for (const s of syllabify(text)) {
    if (s.wordIndex !== last && s.bind > 0) out[s.word] = s.bind;
    last = s.wordIndex;
  }
  return out;
};

// articles and determiners lead into their noun phrase; adjectives, numbers and nouns into their head
assert.deepEqual(binds('The giant cake wobbles'), { giant: LEAD, cake: MOD }, show('The giant cake wobbles'));
assert.deepEqual(binds('We want to win the race, my old friend'), { win: LEAN, race: LEAD, old: LEAD, friend: MOD });
assert.equal(binds('Relax by the fire').the, LEAN);
assert.equal(binds('Relax by the fire').fire, LEAD);
assert.equal(binds('Why should Musical Bots win the Meta Global AI Hackathon?').Bots, MOD);
assert.equal(binds('Why should Musical Bots win the Meta Global AI Hackathon?').Hackathon, MOD);
assert.equal(binds('so bright').bright, DEG);
assert.equal(binds("Navy's tiny boat can't stop").stop, AUX);
// a comma frees the words around it; a subject is not its verb's modifier ("Black struts", "Copper dreams")
assert.deepEqual(binds('Birthday cake, birthday cake!'), { cake: MOD });
assert.equal(binds('Black struts up the steps').struts, undefined, show('Black struts up the steps'));
assert.equal(binds('Copper dreams of next year').dreams, undefined, show('Copper dreams of next year'));
assert.equal(syllabify('The giant cake wobbles').at(-1).pos, 'verb');
// (the audit, 2026-11-01: a crew name and its verb, "to" into a noun phrase, contractions, adverb-like words)
assert.equal(binds('Blue hums the night away').hums, undefined, show('Blue hums the night away'));
assert.equal(binds('We sail to the sky').the, LEAN);
assert.equal(binds("That's the way").the, undefined, show("That's the way"));
assert.equal(binds('Gold glows tonight').tonight, undefined, show('Gold glows tonight'));
assert.equal(binds('It bounces past the slide').the, LEAN, show('It bounces past the slide'));
// every syllable of a word after its first is free (the word itself binds them)
syllabify('The camera stares at clouds').forEach((s, i, all) => { if (i > 0 && all[i - 1].wordIndex === s.wordIndex) assert.equal(s.bind, 0, s.text); });
assert.deepEqual(groupsOf(wordChunks('the big dog', [
  { text: 'the', charStart: 0, charEnd: 3, phrase: 0 }, { text: 'big', charStart: 4, charEnd: 7, phrase: 0 }, { text: 'dog', charStart: 8, charEnd: 11, phrase: 0 },
])), [[0, 1, 2]]);

// the automatic pickup: an article (or a preposition and its article) into a stressed syllable, 3 left at least
assert.equal(autoPickup('The camera stares at clouds'), 'The');
assert.equal(autoPickup('In the dark we sing along'), 'In the');
assert.equal(autoPickup('We count the eggs'), null);
assert.equal(autoPickup('The sun'), null);
assert.equal(autoPickup('And the ball rolls on'), null);

// the premiere: no article held a pulse on its own before its word, and few held over a beat (the replies' own
// shapes aside); a pulse starting inside a word only where its line cannot do otherwise
const root = new URL('../episodes/', import.meta.url);
let leads = 0, held = 0, pulseHeld = 0, mods = 0;
for (const dir of readdirSync(root)) {
  if (!existsSync(new URL(`${dir}/beats.json`, root))) continue;
  const events = parseNdjson(readFileSync(new URL(`${dir}/events.ndjson`, root), 'utf8'));
  const song = arrange(events, JSON.parse(readFileSync(new URL(`${dir}/beats.json`, root), 'utf8')));
  for (const l of song.lines) {
    if (l.layer !== 'story') continue;
    const sy = syllabify(l.job.text);
    assert.equal(sy.length, l.job.notes.length, `${dir} ${l.job.text}`);
    for (let i = 1; i < sy.length; i++) {
      if (!(sy[i].bind > 0)) continue;
      const gap = (l.job.notes[i].t - l.job.notes[i - 1].t) / song.beat;
      if (sy[i].bind >= LEAN) {
        leads++;
        if (gap > 1 + 1e-6) held++;
        if (sy[i - 1].pos === 'det' && gap >= 3 - 1e-6) pulseHeld++;
      } else mods++;
    }
  }
}
assert.ok(leads > 300 && mods > 200, `${leads} leads, ${mods} modifiers`);
assert.equal(pulseHeld, 0, `${pulseHeld} articles held a whole pulse`);
assert.ok(held / leads < 0.04, `${held} of ${leads} leads held over a beat`);
console.log(`chunks: ${leads} leads (${held} held over a beat), ${mods} modifiers`);
