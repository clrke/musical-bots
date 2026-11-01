#!/usr/bin/env node
// Every premiere story line of the curated bundles, as arrange() sets it, rendered alone by the voice
// engine (one wav, 1 s apart), for a listening machine to transcribe (sung_recall.py): how the
// singable craft check was fitted (scripts/director/craft.js SOUND_WEIGHTS).
//
//   node scripts/render/sung-lines.mjs <out.wav> [episode ...]      (default: every bundle but sample)
//     VOICE=woman   every line in this voice instead of its singer's (a second pass)
//     VARIANTS=<json>  [{ ep, seq, lyric }]: each variant swapped into its bundle alone (an A/B of a line)
// Writes <out>.meta.json: per line { ep, seq, section, singer, voice, lyric, text, notes, at, end }.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window ??= {};
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { renderLine, SAMPLE_RATE } = await import(join(REPO, 'web/src/mv/voice/sing.js'));
const { arrange } = await import(join(REPO, 'web/src/sing-plan.js'));
const { parseNdjson } = await import(join(REPO, 'web/src/player.js'));

const [OUT, ...only] = process.argv.slice(2);
if (!OUT) { console.log('usage: sung-lines.mjs <out.wav> [episode ...]'); process.exit(1); }
const EP = join(REPO, 'episodes');
const bundle = (ep) => ({
  events: parseNdjson(readFileSync(join(EP, ep, 'events.ndjson'), 'utf8')),
  beats: JSON.parse(readFileSync(join(EP, ep, 'beats.json'), 'utf8')),
});
const items = [];
const take = (ep, l, lyric) => items.push({ ep, seq: l.seq, section: l.section, singer: l.bot, voice: l.job.voice, lyric, text: l.job.text, notes: l.job.notes, job: l.job });
if (process.env.VARIANTS) {
  for (const v of JSON.parse(readFileSync(process.env.VARIANTS, 'utf8'))) {
    const { events, beats } = bundle(v.ep);
    const song = arrange(events.map((e) => (e.seq === v.seq ? { ...e, lyric: v.lyric } : e)), beats);
    const l = song.lines.find((x) => x.layer === 'story' && x.seq === v.seq);
    if (l) take(v.ep, l, v.lyric); else console.error('no story line', v);
  }
} else {
  const eps = only.length ? only : readdirSync(EP).filter((d) => d !== 'sample' && existsSync(join(EP, d, 'beats.json'))).sort();
  for (const ep of eps) {
    const { events, beats } = bundle(ep);
    const bySeq = new Map(events.map((e) => [e.seq, e]));
    for (const l of arrange(events, beats).lines.filter((x) => x.layer === 'story')) take(ep, l, bySeq.get(l.seq)?.lyric ?? '');
  }
}
const VOICE = process.env.VOICE;
const SR = SAMPLE_RATE;
let total = 0.5;
const rendered = items.map((l) => {
  const job = VOICE ? { ...l.job, voice: VOICE, seed: (l.job.seed ?? 0) + 7 } : l.job;
  const r = renderLine(job);
  const at = total;
  total += r.pcm.length / SR + 1.0;
  return { ...l, voice: job.voice, at, r };
});
const n = Math.ceil(total * SR);
const pcm = new Int16Array(n);
for (const x of rendered) {
  const o = Math.round(x.at * SR), g = 0.3 / Math.max(1e-6, x.r.peak);
  for (let q = 0; q < x.r.pcm.length; q++) pcm[o + q] = Math.max(-32767, Math.min(32767, Math.round(x.r.pcm[q] * g * 32767)));
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + n * 2, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(n * 2, 40);
writeFileSync(OUT, Buffer.concat([hdr, Buffer.from(pcm.buffer)]));
writeFileSync(OUT.replace(/\.wav$/, '.meta.json'), JSON.stringify(rendered.map(({ r, job, ...x }) => ({ ...x, end: x.at + r.pcm.length / SR })), null, 1));
console.log(OUT, rendered.length, 'lines', total.toFixed(1), 's');
