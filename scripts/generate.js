// Usage: node scripts/generate.js "<prompt>" <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { generate, toNdjson } from '../web/src/gen/index.js';
const [prompt, out = 'episodes/generated'] = process.argv.slice(2);
if (!prompt) { console.error('usage: generate.js "<prompt>" [outdir]'); process.exit(2); }
const { beats, events } = generate(prompt);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/beats.json`, JSON.stringify(beats, null, 2) + '\n');
writeFileSync(`${out}/events.ndjson`, toNdjson(events));
console.log(`wrote ${out}: ${beats.beats.length} beats, ${events.length} events`);
