// Curate the 13 story-seed bundles: generate (protocol v2 story songs), gate, write.
// Gates per bundle: lyric rules clean (the plain lyric: markup removed), every line sings well (at most
// 7 syllables, a pickup aside; replies 1-5), >=2 consulting events, the story-song form (11 sections),
// every action resolves, validator OK.
// Usage: node scripts/curate.js [episodes-dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generate, toNdjson } from '../web/src/gen/index.js';
import { lyricProblems } from '../web/src/gen/rules.js';
import { lineProblems } from '../web/src/gen/lyrics.js';
import { plainLyric } from '../web/src/cues.js';
import { resolveAction } from '../web/src/actions.js';
import { SEEDS } from '../web/src/curated.js';

// Note: re-curating resets any Fireworks enrichment; run `npm run enrich` again afterwards.

const out = process.argv[2] ?? 'episodes';
for (const [slug, prompt] of SEEDS) {
  const { beats, events } = generate(prompt);
  for (const e of events) {
    for (const f of ['summary', 'lyric']) {
      const probs = lyricProblems(f === 'lyric' ? plainLyric(e[f]) : e[f]);
      if (probs.length) throw new Error(`${slug}: ${f} breaks rules: ${probs.join('; ')}`);
    }
    const sing = lineProblems(e.lyric);
    if (sing.length) throw new Error(`${slug}: "${e.lyric}" sings badly: ${sing.join('; ')}`);
    if (e.action && resolveAction(e.action).kind === 'none') throw new Error(`${slug}: unknown action ${e.action}`);
  }
  if (beats.version !== 2 || beats.beats.length !== 11) throw new Error(`${slug}: not an 11-section v2 story song`);
  const consulting = events.filter((e) => e.status === 'consulting' && e.consult.length);
  if (consulting.length < 2) throw new Error(`${slug}: only ${consulting.length} consultations`);
  const dir = `${out}/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/beats.json`, JSON.stringify(beats, null, 2) + '\n');
  writeFileSync(`${dir}/events.ndjson`, toNdjson(events));
  execFileSync('node', ['scripts/validate-bundle.js', dir], { stdio: 'inherit' });
}
console.log(`curated ${SEEDS.length} bundles into ${out}/`);
