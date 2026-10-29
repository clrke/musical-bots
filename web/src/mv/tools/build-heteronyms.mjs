#!/usr/bin/env node
// Embeds the heteronym table (Magna.Core tools/heteronyms/heteronyms.json, the canonical,
// hand-edited source) as web/src/mv/voice/text/heteronymData.js. New in this copy (not in
// upstream magna-vocalization).
//
//   node web/src/mv/tools/build-heteronyms.mjs [path/to/heteronyms.json]
//
// Checks what Heteronyms.cs relies on (ARPAbet with a stress digit on every vowel, unique sense
// ids, a default that exists, annotations of known words) and writes the module.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] ?? `${process.env.HOME}/Projects/unity/magna-core/tools/heteronyms/heteronyms.json`;
const OUT = new URL('../voice/text/heteronymData.js', import.meta.url);
const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
const CONSONANTS = new Set(['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH']);

const table = JSON.parse(readFileSync(SRC, 'utf8'));
const errors = [];
for (const [word, e] of Object.entries(table.words ?? {})) {
  if (!/^[a-z]+$/.test(word)) errors.push(`${word}: lower-case letters only`);
  const ids = (e.senses ?? []).map((s) => s.id);
  if (ids.length < 2) errors.push(`${word}: needs two senses or more`);
  if (new Set(ids).size !== ids.length) errors.push(`${word}: duplicate sense ids`);
  if (!ids.includes(e.default)) errors.push(`${word}: default ${e.default} is not a sense id`);
  for (const s of e.senses ?? []) {
    for (const ph of String(s.arpabet ?? '').split(/\s+/).filter(Boolean)) {
      const m = /^([A-Z]+)([012]?)$/.exec(ph);
      if (!m || (m[2] ? !VOWELS.has(m[1]) : !CONSONANTS.has(m[1]))) errors.push(`${word}/${s.id}: bad ARPAbet phone ${ph}`);
    }
  }
}
for (const [line, senses] of Object.entries(table.lines ?? {})) {
  for (const item of String(senses).split(/[\s,;]+/).filter(Boolean)) {
    const [w] = item.split('=');
    if (!table.words[w.split('#')[0]]) errors.push(`line "${line}": unknown word ${w}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const body = JSON.stringify({ format: table.format, words: table.words, lines: table.lines ?? {} }, null, 1);
writeFileSync(OUT, [
  '// Generated from Magna.Core tools/heteronyms/heteronyms.json (canonical, hand-edited) by',
  '// web/src/mv/tools/build-heteronyms.mjs: do not edit, rebuild. New in this copy (not in upstream',
  '// magna-vocalization). See heteronyms.js.',
  `export const HETERONYM_DATA = ${body};`,
  '',
].join('\n'));
console.log(`heteronymData.js: ${Object.keys(table.words).length} words, ${Object.keys(table.lines ?? {}).length} annotated lines`);
