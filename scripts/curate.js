// Curate the 12 story-seed bundles: generate, gate, write.
// Gates per bundle: lyric rules clean, >=2 consulting events, validator OK.
// Usage: node scripts/curate.js [episodes-dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generate, toNdjson } from '../web/src/gen/index.js';
import { lyricProblems } from '../web/src/gen/rules.js';
import { SEEDS } from '../web/src/curated.js';

// Note: re-curating resets any Fireworks enrichment; run `npm run enrich` again afterwards.


const out = process.argv[2] ?? 'episodes';
for (const [slug, prompt] of SEEDS) {
  const { beats, events } = generate(prompt);
  for (const e of events) {
    for (const f of ['summary', 'lyric']) {
      const probs = lyricProblems(e[f]);
      if (probs.length) throw new Error(`${slug}: ${f} breaks rules: ${probs.join('; ')}`);
    }
  }
  const consulting = events.filter((e) => e.status === 'consulting' && e.consult.length);
  if (consulting.length < 2) throw new Error(`${slug}: only ${consulting.length} consultations`);
  const dir = `${out}/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/beats.json`, JSON.stringify(beats, null, 2) + '\n');
  writeFileSync(`${dir}/events.ndjson`, toNdjson(events));
  execFileSync('node', ['scripts/validate-bundle.js', dir], { stdio: 'inherit' });
}
console.log(`curated ${SEEDS.length} bundles into ${out}/`);
