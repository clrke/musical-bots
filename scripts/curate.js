// Curate the 12 story-seed bundles: generate, gate, write.
// Gates per bundle: lyric rules clean, >=2 consulting events, validator OK.
// Usage: node scripts/curate.js [episodes-dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generate, toNdjson } from '../web/src/gen/index.js';
import { lyricProblems } from '../web/src/gen/rules.js';

const SEEDS = [
  ['toy-box', 'Gigi brings home the biggest toy box on the street'],
  ['dino-book', 'Teddy trades lunch for a dinosaur book'],
  ['streetlamp', 'Nora fixes the streetlamp before dark'],
  ['rooftop-stars', 'Vera counts stars from the rooftop'],
  ['hot-soup', 'Lou sells hot soup on a cold day'],
  ['parade', 'Frankie calls the big parade downtown'],
  ['birthday-cake', 'Pearl bakes a giant birthday cake'],
  ['block-race', 'Hattie races Dan around the block'],
  ['garden', 'Benny plants a garden behind the school'],
  ['red-truck', 'Knox learns to share the red truck'],
  ['yellow-fence', 'Ray paints the fence bright yellow'],
  ['lost-puppy', 'Ivy finds a lost puppy in the park'],
];

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
