// Runs every headless suite (web/test-*.mjs) one after another with this Node (22, see .nvmrc),
// from the repo root, and reports pass/fail and time per suite. Exit code 1 if any suite fails.
//
//   npm test                       # every suite
//   npm test -- voice sing         # only suites whose name contains "voice" or "sing"
//   npm test -- --skip swarm,live  # every suite except those
//
// The suites need web/node_modules (npm ci --prefix web) and no network, keys or browser.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipAt = args.indexOf('--skip');
const skip = skipAt >= 0 ? (args.splice(skipAt, 2)[1] || '').split(',').filter(Boolean) : [];
const only = args.filter((a) => !a.startsWith('--'));

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node ${process.versions.node}: the suites need Node 22 (nvm use).`);
  process.exit(1);
}

const name = (f) => f.replace(/^test-/, '').replace(/\.mjs$/, '');
const suites = readdirSync(join(ROOT, 'web'))
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort()
  .filter((f) => !skip.some((s) => name(f) === s || f === s))
  .filter((f) => !only.length || only.some((s) => name(f).includes(s)));

if (!suites.length) {
  console.error('No suite matches.');
  process.exit(1);
}

const results = [];
const t0 = Date.now();
for (const f of suites) {
  const t = Date.now();
  process.stdout.write(`\n=== ${f}\n`);
  const r = spawnSync(process.execPath, [join('web', f)], { cwd: ROOT, stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ f, ok, s: (Date.now() - t) / 1000, why: ok ? '' : r.signal || `exit ${r.status}` });
}

console.log('\n--- summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.f.padEnd(26)} ${r.s.toFixed(1).padStart(6)} s ${r.why}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed.length ? 1 : 0);
