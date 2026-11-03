#!/usr/bin/env node
// Muse Wonder writes the sung lyrics of the episodes in a directory (scripts/director/wonder-lyrics.js): the crew's
// drafts go in, Muse Wonder's lines come out through the director's own gates, and each bundle's director.json records
// the model, the tokens and the cost.
//
//   META_API_KEY=... node scripts/lyrics.js [episodes-dir] [--only slug,slug] [--skip slug,slug] [--dry] [--force] [--parallel n]
//   npm run lyrics -- --only hot-soup
// A bundle whose director.json already has `lyrics` (Muse Wonder wrote it) is left alone unless --force.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { wonderLyrics } from './director/wonder-lyrics.js';

const args = process.argv.slice(2);
const val = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const root = args.find((a, i) => !a.startsWith('--') && !['--only', '--skip', '--parallel'].includes(args[i - 1])) ?? 'episodes';
const only = val('--only')?.split(',') ?? null;
const skip = new Set(val('--skip')?.split(',') ?? []);
const dry = args.includes('--dry');
const force = args.includes('--force');
const par = Number(val('--parallel') ?? 3);
const key = process.env.META_API_KEY;
if (!key) { console.error('Set META_API_KEY (a Meta Model API key; it is never printed or stored). Nothing sent.'); process.exit(2); }

const dirs = readdirSync(root).filter((d) => d !== 'sample' && d !== 'live' && (!only || only.includes(d)) && !skip.has(d) && existsSync(`${root}/${d}/events.ndjson`));
let failed = 0, usd = 0;
async function one(d) {
  const dir = `${root}/${d}`;
  const dj = existsSync(`${dir}/director.json`) ? JSON.parse(readFileSync(`${dir}/director.json`, 'utf8')) : null;
  if (dj?.lyrics && !force && !dry) { console.log(`${d}: already written by ${dj.lyrics.model} (--force to redo)`); return; }
  const r = await wonderLyrics(dir, { key, dry, log: (m) => console.log(`  ${d}: ${m}`) });
  usd += r.usd ?? 0;
  if (!r.ok) { failed++; console.log(`${d}: FAILED ${r.error} (${r.usd ? `$${r.usd}` : 'no cost'})`); return; }
  console.log(`${d}: ${r.written} of ${r.lines} lines written by ${r.model} (${r.kept} kept from the crew), ${r.rounds} round(s), ${r.seconds} s, ${r.usage.input_tokens + r.usage.output_tokens} tokens, $${r.usd}${dry ? ' [dry run]' : ''}`);
  if (dry) { for (const c of r.changes) console.log(`    ${c.from}  =>  ${c.to}`); return; }
  if (dj) {
    const { changes, kept_lines: kept, ok, ...rest } = r;
    dj.lyrics = { ...rest, note: 'Muse Wonder wrote the sung lines; the crew (Muse Spark 1.3) planned the story and wrote the drafts' };
    writeFileSync(`${dir}/director.json`, JSON.stringify(dj, null, 2) + '\n');
    writeFileSync(`${dir}/lyrics.json`, JSON.stringify({ model: r.model, at: r.at, changes, kept }, null, 2) + '\n');
  }
}
for (let i = 0; i < dirs.length; i += par) await Promise.all(dirs.slice(i, i + par).map(one));
console.log(`${dirs.length} episode(s), ${failed} failed, $${Math.round(usd * 10000) / 10000} of Muse Wonder${dry ? ' (dry run, nothing written)' : ''}`);
process.exit(failed ? 1 : 0);
