#!/usr/bin/env node
// Builds web/src/mv/voice/text/cmudictData.js: the singer's trimmed CMU Pronouncing Dictionary.
// New in this copy (not in upstream magna-vocalization).
//
//   node web/src/mv/tools/build-cmudict.mjs --cs <Magna.Core/Voice/Text/CmuDictData.cs> \
//     --freq <unigrams.txt> [--top 20000] [--inflect 10000] [--words <file> ...] [--full] [--out <file>]
//
// The shipped table was built with
//   --cs ~/Projects/unity/magna-core/Magna.Core/Voice/Text/CmuDictData.cs
//   --freq <wordsegment 1.3.1 unigrams.txt (Google Web Trillion Word Corpus counts)>
//   --top 20000 --inflect 10000 --words web/src/mv/tools/vocabulary.txt
//
// Source: the dictionary Magna.Core ships (CmuDictData.cs, decoded here: a zlib blob in ulong hex
// literals, see Magna.Core tools/cmudict/build_cmudict.py), or a cmudict.dict (--dict). The data
// is parsed, never executed.
//
// Vocabulary: the --top most frequent words of a word-frequency list ("word<TAB>count" lines,
// most frequent first) that the dictionary has; every word of the --words files (one word, or a
// line of text, per line: names and lyric vocabulary); the inflections the dictionary has of
// those and of the --inflect most frequent words ("wobble": wobbles, wobbled, wobbling; "stop":
// stops, stopped, stopping; "happy": happier, happiest, happily; the possessive 's); and their
// contractions ("don't", "she's", "they'll").
//
// Trimming: a vocabulary word is kept only if the analysis with the dictionary differs from the
// letter rules' (phones, their letters, syllables, stress or sung stress level) or its variants
// differ in syllables (a manual split picks one by its pieces): a word the rules already say
// right sounds the same without its entry, so the shipped table gives the full dictionary's
// analysis for every vocabulary word, with or without a manual split (Syllable.lexical aside: -1
// for a word left out). --full keeps every dictionary word.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { analyze } from '../voice/text/analyze.js';
import { useTable } from '../voice/text/cmudict.js';
import { useDictionary } from '../voice/text/pronunciation.js';
import { sungSyllables } from '../voice/syllables.js';

// The C# CmuDictData.Symbols order (codes 0..68).
export const SYMBOLS = [
  'AA0', 'AA1', 'AA2', 'AE0', 'AE1', 'AE2', 'AH0', 'AH1', 'AH2', 'AO0', 'AO1', 'AO2', 'AW0', 'AW1', 'AW2',
  'AY0', 'AY1', 'AY2', 'B', 'CH', 'D', 'DH', 'EH0', 'EH1', 'EH2', 'ER0', 'ER1', 'ER2', 'EY0', 'EY1', 'EY2',
  'F', 'G', 'HH', 'IH0', 'IH1', 'IH2', 'IY0', 'IY1', 'IY2', 'JH', 'K', 'L', 'M', 'N', 'NG', 'OW0', 'OW1', 'OW2',
  'OY0', 'OY1', 'OY2', 'P', 'R', 'S', 'SH', 'T', 'TH', 'UH0', 'UH1', 'UH2', 'UW0', 'UW1', 'UW2', 'V', 'W', 'Y',
  'Z', 'ZH',
];
/** Phone code c is the character ALPHABET[c]: printable ASCII without quotes, backslash, backtick or '$'. */
export const ALPHABET = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i))
  .filter((c) => !'"$\'\\`'.includes(c)).slice(0, SYMBOLS.length).join('');
/** Shared-prefix lengths 0..35 of the front coding. */
export const PREFIX = '0123456789abcdefghijklmnopqrstuvwxyz';

function args(argv) {
  const o = { words: [], top: 20000, inflect: 10000, full: false, out: new URL('../voice/text/cmudictData.js', import.meta.url) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cs') o.cs = argv[++i];
    else if (a === '--dict') o.dict = argv[++i];
    else if (a === '--freq') o.freq = argv[++i];
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (a === '--inflect') o.inflect = Number(argv[++i]);
    else if (a === '--words') o.words.push(argv[++i]);
    else if (a === '--full') o.full = true;
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.cs && !o.dict) throw new Error('--cs or --dict is required');
  return o;
}

/** CmuDictData.cs -> Map(word -> variants, each an array of ARPAbet phones). */
export function decodeCs(src) {
  const syms = /Symbols\s*=[^{]*\{([^}]*)\}/.exec(src)[1].match(/"[A-Z]+[0-2]?"/g).map((x) => x.slice(1, -1));
  if (syms.join() !== SYMBOLS.join()) throw new Error('CmuDictData.cs: unexpected symbol table');
  const num = (name) => Number(new RegExp(`public const (?:int|uint) ${name} = (\\d+);`).exec(src)[1]);
  const packed = num('PackedBytes');
  const lits = src.slice(src.indexOf('Packed()')).match(/0x[0-9A-Fa-f]+/g);
  const raw = Buffer.alloc(lits.length * 8);
  lits.forEach((x, i) => raw.writeBigUInt64LE(BigInt(x), i * 8));
  const blob = inflateSync(raw.subarray(0, packed));
  if (blob.length !== num('Bytes')) throw new Error('CmuDictData.cs: bad size');
  const words = new Map();
  let p = 0;
  let prev = '';
  while (p < blob.length) {
    const n = blob[p++];
    const s = p;
    while (blob[p] < 0x80) p++;
    const w = prev.slice(0, n) + blob.subarray(s, p).toString('ascii');
    prev = w;
    const variants = [[]];
    for (; blob[p] !== 0xff; p++) {
      if (blob[p] === 0xfe) variants.push([]);
      else variants[variants.length - 1].push(SYMBOLS[blob[p] - 0x80]);
    }
    p++;
    words.set(w, variants);
  }
  if (words.size !== num('Words')) throw new Error('CmuDictData.cs: word count');
  return words;
}

/** cmudict.dict ("word PH PH ...", "word(2) ..." variants, "# comments") -> Map. */
export function parseDict(text) {
  const words = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [head, ...phones] = line.split(/\s+/);
    const w = /^(\S+?)(?:\((\d+)\))?$/.exec(head)[1];
    if (!/^[a-z]+(?:'[a-z]+)*$/.test(w)) continue; // the tokenizer never yields "a.", "'bout", "able-bodied"
    for (const p of phones) if (!SYMBOLS.includes(p)) throw new Error(`${w}: unknown phone ${p}`);
    if (!words.has(w)) words.set(w, []);
    words.get(w).push(phones);
  }
  return words;
}

/** The analysis of one word that the singer hears (phones, letters, syllables, stress, sung levels). */
function signature(word) {
  const an = analyze(word);
  const ph = an.phones.map((p) => `${p.sym}@${p.charStart}-${p.charEnd}:${p.syllable}${p.role[0] ?? ''}${p.syllabic ? 's' : ''}`).join(' ');
  const sy = an.syllables.map((s) => `${s.onset.join(',')}|${s.nucleus}|${s.coda.join(',')}|${s.stress}`).join(' ');
  const sung = sungSyllables(an).map((s) => `${s.text}:${s.stress}`).join(' ');
  return `${ph} / ${sy} / ${sung}`;
}

const VOWEL = /[aeiou]/;
/** Inflected and derived forms of a word that the dictionary may have. */
function inflections(w) {
  const out = [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}er`, `${w}ers`, `${w}est`, `${w}ly`, `${w}y`, `${w}'s`, `${w}s'`];
  const last = w[w.length - 1];
  if (last === 'e') out.push(`${w.slice(0, -1)}ing`, `${w.slice(0, -1)}y`);
  if (last === 'y') out.push(`${w.slice(0, -1)}ies`, `${w.slice(0, -1)}ied`, `${w.slice(0, -1)}ier`, `${w.slice(0, -1)}iest`, `${w.slice(0, -1)}ily`);
  if (/[bdgklmnprtz]$/.test(w) && VOWEL.test(w[w.length - 2] ?? '') && !VOWEL.test(w[w.length - 3] ?? 'a')) {
    out.push(`${w}${last}ed`, `${w}${last}ing`, `${w}${last}er`, `${w}${last}est`, `${w}${last}y`); // stopped, running, bigger
  }
  return out;
}

function vocabulary(dict, o) {
  const vocab = new Set();
  const ranked = [];
  if (o.freq) {
    const seen = new Set();
    for (const line of readFileSync(o.freq, 'utf8').split('\n')) {
      if (ranked.length >= Math.max(o.top, o.inflect)) break;
      const w = line.split('\t')[0].trim().toLowerCase();
      if (/^[a-z]+$/.test(w) && dict.has(w) && !seen.has(w)) {
        seen.add(w);
        ranked.push(w);
      }
    }
  }
  for (const w of ranked.slice(0, o.top)) vocab.add(w);
  const listed = new Set();
  for (const f of o.words) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      for (const m of line.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
        const w = m[0].toLowerCase().replaceAll('’', "'");
        if (dict.has(w)) listed.add(w);
      }
    }
  }
  for (const w of listed) vocab.add(w);
  for (const w of [...ranked.slice(0, o.inflect), ...listed]) for (const x of inflections(w)) if (dict.has(x)) vocab.add(x);
  // contractions: "don't" (letters "dont" in the vocabulary), "she's" / "they'll" / "couldn't" (stem in it)
  for (const w of dict.keys()) {
    if (!w.includes("'")) continue;
    const stem = w.slice(0, w.indexOf("'"));
    const nt = /n't$/.test(w) ? w.slice(0, -3) : null;
    if (vocab.has(w.replaceAll("'", '')) || (vocab.has(stem) && /'(s|ll|re|ve|d|m)$/.test(w)) || (nt && vocab.has(nt))) vocab.add(w);
  }
  return vocab;
}

/** Sung syllables of a dictionary variant (as pronunciation.js counts them). */
const nuclei = (v) => {
  const vowels = v.filter((a) => /[012]$/.test(a)).length;
  return vowels > 0 ? vowels : v.some((a) => ['M', 'N', 'NG', 'L', 'R'].includes(a)) ? 1 : 0;
};

/** The front-coded DATA string (see cmudict.js). */
function encode(words) {
  const keys = [...words.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const char = (p) => ALPHABET[SYMBOLS.indexOf(p)];
  let prev = '';
  return keys.map((w) => {
    let n = 0;
    while (n < Math.min(w.length, prev.length, PREFIX.length - 1) && w[n] === prev[n]) n++;
    prev = w;
    return `${PREFIX[n]}${w.slice(n)} ${words.get(w).map((v) => v.map(char).join('')).join(' ')}`;
  }).join('\n');
}

function main() {
  const o = args(process.argv.slice(2));
  const dict = o.cs ? decodeCs(readFileSync(o.cs, 'utf8')) : parseDict(readFileSync(o.dict, 'utf8'));
  let keep;
  let note;
  if (o.full) {
    keep = dict;
    note = `all ${dict.size} words`;
  } else {
    const vocab = vocabulary(dict, o);
    useTable(dict);
    const withDict = new Map([...vocab].map((w) => [w, signature(w)]));
    useDictionary(false);
    keep = new Map();
    for (const w of vocab) {
      // (a word whose variants differ in syllables is kept too: a manual split picks its variant)
      const counts = new Set(dict.get(w).map(nuclei));
      if (counts.size > 1 || signature(w) !== withDict.get(w)) keep.set(w, dict.get(w));
    }
    useDictionary(true);
    useTable(null);
    note = `${keep.size} words of a ${vocab.size}-word vocabulary (the ${o.top} most frequent, ${o.words.length} word list(s), `
      + `inflections, contractions) whose sung analysis differs from the letter rules`;
  }
  const data = encode(keep);
  const js = [
    '// Generated by web/src/mv/tools/build-cmudict.mjs from the CMU Pronouncing Dictionary as Magna.Core',
    '// ships it (cmusphinx/cmudict@74790861f652b15e4ac49015a90074ad62a27690): do not edit, rebuild.',
    `// ${note}.`,
    '// New in this copy (not in upstream magna-vocalization). Format: see cmudict.js.',
    '//',
    '// The Carnegie Mellon Pronouncing Dictionary (CMUdict), Copyright (C) 1993-2015 Carnegie Mellon',
    '// University. All rights reserved. Redistribution and use in source and binary forms, with or',
    '// without modification, are permitted provided that the following conditions are met:',
    '// 1. Redistributions of source code must retain the above copyright notice, this list of',
    '//    conditions and the following disclaimer. The contents of this file are deemed to be source code.',
    '// 2. Redistributions in binary form must reproduce the above copyright notice, this list of',
    '//    conditions and the following disclaimer in the documentation and/or other materials provided',
    '//    with the distribution.',
    '// This work was supported in part by funding from the Defense Advanced Research Projects Agency, the',
    '// Office of Naval Research and the National Science Foundation of the United States of America, and',
    '// by member companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge the',
    '// contributions of many volunteers to the expansion and improvement of this dictionary.',
    '// THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS\'\' AND ANY EXPRESSED OR IMPLIED',
    '// WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS',
    '// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY NOR ITS',
    '// EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL',
    '// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,',
    '// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER',
    '// IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT',
    '// OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
    `export const SYMBOLS = ${JSON.stringify(SYMBOLS)};`,
    `export const ALPHABET = ${JSON.stringify(ALPHABET)};`,
    `export const WORDS = ${keep.size};`,
    `export const DATA = \`${data}\`;`,
    '',
  ].join('\n');
  writeFileSync(o.out, js);
  console.log(`${String(o.out)}: ${keep.size} words, ${js.length} bytes (${note})`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
