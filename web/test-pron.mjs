// Pronunciation: the singer's words come from CMUdict (web/src/mv/voice/text/pronunciation.js, a
// port of Magna.Core Pronunciation.cs) with heteronyms by sense, the letter rules as the fallback.
// Expected values are Magna.Core's own analyses of the same text (its goldens).
import assert from 'node:assert/strict';
import { analyze } from './src/mv/voice/text/analyze.js';
import { syllabify, stressOf } from './src/mv/voice/syllables.js';
import { find, has, lookup, size } from './src/mv/voice/text/cmudict.js';
import { WORDS } from './src/mv/voice/text/cmudictData.js';
import { arpabetPhones, enginePhone, useDictionary } from './src/mv/voice/text/pronunciation.js';
import { guessSense, normalizeSenses, parseSenses, findHeteronym } from './src/mv/voice/text/heteronyms.js';
import { EXCEPTIONS, STRESS_EXCEPTIONS } from './src/mv/voice/text/lexicon.js';
import { spell } from './src/mv/voice/text/spelling.js';
import { CONSONANTS, VOWELS } from './src/mv/voice/phones.js';
import { renderLine } from './src/mv/voice/sing.js';
import { NAMES } from './src/gen/cast.js';

const phones = (text, manual = null, senses = null) => analyze(text, 1 / 13, manual, senses).phones.map((p) => p.sym).join(' ');
const sung = (text, manual = null, senses = null) => syllabify(text, manual, senses).map((s) => s.text);

// the shipped table decodes whole
assert.equal(size(), WORDS);
assert.ok(WORDS > 15000, `only ${WORDS} words`);
assert.deepEqual(find('box'), null, 'box: the rules say it right, so it is not shipped');
assert.deepEqual(lookup('finds'), ['F AY1 N D Z']);
assert.ok(has('FINDS') && has('couldn’t'), 'any case, either apostrophe');

// the ARPAbet mapping
assert.equal(enginePhone('AH0'), 'schwa');
assert.equal(enginePhone('AH1'), 'uh');
assert.equal(enginePhone('AO1', 'R'), 'oh');
assert.equal(enginePhone('AO1'), 'aw');
assert.equal(enginePhone('AY1'), 'ah-ee');
assert.equal(arpabetPhones('W IH1 N D').syms.join(' '), 'w ih n d');
assert.equal(arpabetPhones('W IH N D'), null, 'a vowel without its stress digit');

// the words the letter rules got wrong (audit, toy-box): now as CMUdict says them
const expect = {
  finds: 'f ah-ee n d z', rolls: 'r oh l z', warm: 'w oh r m', comes: 'k uh m z', glowing: 'g l oh ih ng',
  Ivy: 'ah-ee v ee', listens: 'l ih s schwa n z', today: 't schwa d eh-ee', near: 'n ih r',
};
for (const [w, p] of Object.entries(expect)) assert.equal(phones(w), p, w);
// stress on the first syllable: Sterling, Murphy (the rules stressed the second)
for (const w of ['Sterling', 'Murphy', 'Benny', 'Constance', 'Hattie', 'Frankie', 'Teddy', 'Nora', 'Vera', 'Gigi']) {
  assert.deepEqual(stressOf(w), [2, 0], w);
}
// every cast name sings and has its stress
for (const name of NAMES) assert.ok(stressOf(name).includes(2), name);

// Magna.Core goldens: phones, the lyric split and the sung stress levels
const GOLD = [
  ['Sterling peeks and hums a little tune.', null, null, 's t er l ih ng p ee k s ae n d h uh m z schwa l ih t schwa l t oo n',
    ['Ster', 'ling', 'peeks', 'and', 'hums', 'a', 'lit', 'tle', 'tune'], [2, 0, 2, -1, 2, -1, 2, 0, 2]],
  ['Benny finds the box by the gate.', null, null, 'b eh n ee f ah-ee n d z dh uh b ah k s b ah-ee dh uh g eh-ee t',
    ['Ben', 'ny', 'finds', 'the', 'box', 'by', 'the', 'gate'], [2, 0, 2, -1, 2, -1, -1, 2]],
  ['Wind the clock, the wind is cold', null, 'wind=verb wind#2=noun', 'w ah-ee n d dh uh k l ah k dh uh w ih n d ih z k oh l d',
    ['Wind', 'the', 'clock', 'the', 'wind', 'is', 'cold'], [2, -1, 2, -1, 2, -1, 2]],
  ['Close the door and stay close', null, null, 'k l oh z dh uh d oh r ae n d s t eh-ee k l oh s',
    ['Close', 'the', 'door', 'and', 'stay', 'close'], [2, -1, 2, -1, 2, 2]],
  ['Every evening', 'ev-er-y eve-ning', null, 'eh v er ee ee v n ih ng', ['Ev', 'er', 'y', 'eve', 'ning'], [2, 0, 0, 2, 0]],
  ['Ivy finds the glowing box', null, null, 'ah-ee v ee f ah-ee n d z dh uh g l oh ih ng b ah k s',
    ['I', 'vy', 'finds', 'the', 'glow', 'ing', 'box'], [2, 0, 2, -1, 2, 0, 2]],
  ['Murphy comes and listens', null, null, 'm er f ee k uh m z ae n d l ih s schwa n z',
    ['Mur', 'phy', 'comes', 'and', 'li', 'stens'], [2, 0, 2, -1, 2, 0]],
];
for (const [text, manual, senses, ph, pieces, levels] of GOLD) {
  assert.equal(phones(text, manual, senses), ph, text);
  assert.deepEqual(sung(text, manual, senses), pieces, text);
  assert.deepEqual(stressOf(text, manual, senses), levels, text);
}

// heteronyms: the sense by context, or as the senses string says
assert.equal(phones('Wind it up'), 'w ah-ee n d ih t uh p');
assert.equal(phones('The wind is cold'), 'dh uh w ih n d ih z k oh l d');
assert.equal(phones('The wind is cold', null, 'wind=verb'), 'dh uh w ah-ee n d ih z k oh l d');
assert.equal(guessSense(['I', 'read', 'it'], 1, false), 'present');
assert.equal(guessSense(['I', 'have', 'read', 'it'], 2, false), 'past');
assert.equal(findHeteronym('Tears')?.word, 'tears');
assert.deepEqual(parseSenses('wind=noun, close#2=adj bad=='), [
  { word: 'wind', occurrence: 0, sense: 'noun' }, { word: 'close', occurrence: 2, sense: 'adj' }]);
assert.equal(normalizeSenses('Wind=Noun,close#2=adj'), 'wind=noun close#2=adj');

// contractions: "n't" is its own syllable after the consonant ("could" + "n't")
assert.deepEqual(sung("I couldn't go"), ['I', 'could', "n't", 'go']);
// "has" and "get" used to throw (the lexicon tables had their own get / has helpers as keys); no
// word that is also an object property name is a table key, and every one of them sings
assert.equal(phones('He has it, get it'), 'h ee h ae z ih t g eh t ih t');
const PROPS = ['has', 'get', 'constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString', 'set'];
for (const k of PROPS) {
  for (const [name, table] of Object.entries({ EXCEPTIONS, STRESS_EXCEPTIONS, VOWELS, CONSONANTS })) {
    assert.ok(!Object.hasOwn(table, k) && !table.has(k) && table.get(k) === undefined, `${name} has a "${k}" key`);
  }
  const letters = k.replace(/[^A-Za-z]/g, '').toLowerCase();
  assert.ok(spell(letters).length > 0, k);
  assert.ok(syllabify(`It ${k} the box`).length >= 4, k);
}
const props = renderLine({ voice: 'woman', text: PROPS.join(' '), notes: syllabify(PROPS.join(' ')).map((_, i) => ({ t: i * 0.4, dur: 0.35, midi: 64 })) });
assert.ok(props.peak > 0.01 && props.syllableTimes.length === syllabify(PROPS.join(' ')).length, 'the property words sing');

// the dictionary off: upstream's letter rules
useDictionary(false);
assert.equal(phones('finds'), 'f ih n d z');
assert.deepEqual(stressOf('Sterling'), [0, 2]);
useDictionary(true);
assert.equal(phones('finds'), 'f ah-ee n d z');
// a number counts a noun: "One minute takes thousands" is the time (MIN-it), not "my-NOOT" (owner, Nov 2)
assert.equal(guessSense(['One', 'minute', 'takes', 'thousands'], 1, false), 'noun');
assert.equal(guessSense(['a', 'minute', 'speck'], 1, false), 'adj');

console.log(`pron ok: ${WORDS} dictionary words, ${GOLD.length} Magna.Core goldens, heteronyms, contractions`);
