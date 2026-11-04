// RMS scan of a capture's audio (scripts/render/capture.mjs audio.f32: 48 kHz stereo f32le) for silence (owner, Nov 5:
// "I don't want any silence during the making-of!"): every window of `--win` s (0.5) whose RMS is below `--db` dBFS
// (-50) is silent; the silent stretches, merged, are listed with the longest and the total. --from / --to (s) bound the
// scan (a making-of capture: meta.json makingOf.end, the making-of's end, is the default --to when there is one).
//   node scripts/render/silence-scan.mjs <run-dir> [--win 0.5] [--hop 0.1] [--db -50] [--from 0] [--to S] [--json]
import { readFileSync, existsSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !/^-?\d/.test(a));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
if (!dir) { console.error('usage: silence-scan.mjs <run-dir> [--win 0.5] [--hop 0.1] [--db -50] [--from S] [--to S] [--json]'); process.exit(1); }
const SR = 48000, WIN = opt('win', 0.5), HOP = opt('hop', 0.1), DB = opt('db', -50);
const meta = existsSync(`${dir}/meta.json`) ? JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8')) : null;
const fd = openSync(`${dir}/audio.f32`, 'r');
const frames = Math.floor(fstatSync(fd).size / 8);
const dur = frames / SR;
const FROM = opt('from', 0), TO = Math.min(dur, opt('to', meta?.makingOf?.end ?? dur));

// the squared mono samples, summed per hop (read in chunks: a making-of's audio is half a gigabyte)
const hopN = Math.round(HOP * SR), nHops = Math.ceil(frames / hopN);
const energy = new Float64Array(nHops);
const CH = 1 << 20;
const buf = Buffer.alloc(CH * 8);
for (let at = 0; at < frames; at += CH) {
  const n = Math.min(CH, frames - at);
  readSync(fd, buf, 0, n * 8, at * 8);
  const f = new Float32Array(buf.buffer, buf.byteOffset, n * 2);
  for (let k = 0; k < n; k++) { const m = 0.5 * (f[2 * k] + f[2 * k + 1]); energy[Math.floor((at + k) / hopN)] += m * m; }
}
closeSync(fd);
const per = Math.round(WIN / HOP);
const dbAt = (h) => { let e = 0, n = 0; for (let j = h; j < Math.min(nHops, h + per); j++) { e += energy[j]; n += hopN; } return 10 * Math.log10(e / Math.max(1, n) + 1e-20); };
const quiet = [];
let first = null;
for (let h = 0; h * HOP + WIN <= dur + 1e-9; h++) {
  const t = h * HOP, d = dbAt(h);
  if (first === null && d >= DB) first = t;
  if (t < FROM - 1e-9 || t + WIN > TO + 1e-9) continue;
  if (d < DB) {
    const last = quiet.at(-1);
    if (last && t <= last[1] + 1e-9) last[1] = t + WIN;
    else quiet.push([t, t + WIN]);
  }
}
const len = quiet.map(([a, b]) => b - a);
const out = {
  dir, seconds: +dur.toFixed(2), scanned: [FROM, +TO.toFixed(2)], win: WIN, db: DB, firstSound: first,
  silent: quiet.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), count: quiet.length,
  longest: len.length ? +Math.max(...len).toFixed(2) : 0, total: +len.reduce((s, x) => s + x, 0).toFixed(2),
};
if (args.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`${dir}: ${out.seconds} s of audio, scanned ${out.scanned[0]}-${out.scanned[1]} s; first sound at ${first?.toFixed(2)} s`);
  console.log(`  silent (${WIN} s windows under ${DB} dBFS): ${out.count} stretches, longest ${out.longest} s, total ${out.total} s`);
  for (const [a, b] of out.silent.slice(0, 40)) console.log(`    ${a.toFixed(1)}-${b.toFixed(1)} (${(b - a).toFixed(1)} s)`);
}
