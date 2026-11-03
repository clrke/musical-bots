#!/usr/bin/env node
// An episode's poster, drawn by Meta's Muse Image (muse-image-1.0, the Meta Model API's image model): the episode's
// title over its opening scene, the cast drawn from a frame of our own 3D bots (poster-ref.jpg, cropped from the
// demo video), so the poster looks like the show. The app shows it as the premiere's title card and as the link
// preview; a hosted run makes its own at the end (sandbox-run.js), on the run's key.
//
//   META_API_KEY=... node scripts/director/poster.js <episode-dir>... [--force] [--dry]
//     writes <episode-dir>/poster.webp (skips one that has it, unless --force); --dry prints the prompt only
// The drawing is then read back by Muse Spark 1.3 (vision, one chat call): the title must be spelled as the episode's;
// a garbled one is drawn once more (image models misspell now and then), and the better of the two is kept.
// Env: META_API_KEY (the Meta Model API key; never logged), MB_POSTER_BASE (tests point it at a stub; default
// https://api.meta.ai/v1). One image a call ($0.01 at list price), ~30 s.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POSTER_MODEL = 'muse-image-1.0';
export const POSTER_FILE = 'poster.webp';
export const VISION_MODEL = 'muse-spark-1.3';
const squash = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const REF = fileURLToPath(new URL('./poster-ref.jpg', import.meta.url));
const SETS = {
  diner: 'a cozy diner with a striped awning', big_house: 'a big friendly house', street: 'a sunny town street',
  village: 'a market village square with bunting', winter: 'a snowy winter town', haunted: 'a not-too-spooky old house at dusk',
  beach: 'a sunny beach', pool: 'a bright swimming pool', pier: 'a seaside pier', ocean: 'the open ocean',
};

/** The prompt for an episode's beats.json: its title, its hook and opening scene, its cast as coloured robots. */
export function posterPrompt(beats) {
  const first = beats.beats?.[0] ?? {};
  const set = SETS[first.set] ?? 'a bright cartoon town';
  // the cast who appear most (the crew's Green, Navy and Gold open every episode: the prompt names the lead)
  const count = new Map();
  for (const n of (beats.beats ?? []).flatMap((b) => b.cast ?? [])) count.set(n, (count.get(n) ?? 0) + 1);
  const cast = [...count].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n.toLowerCase());
  const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s ?? '');
  return [
    `A cheerful poster for an episode of a kids' sing-along musical cartoon, titled "${beats.title}".`,
    'Use exactly the robot characters and the glossy 3D cartoon style of the reference image: round and boxy robot heads',
    'with big friendly eyes, each robot one colour, its name is its colour.',
    beats.prompt ? `The story: ${clip(beats.prompt, 120)}.` : '',
    cast.length ? `Featured: the ${cast.join(', the ')} robot${cast.length > 1 ? 's' : ''}.` : '',
    `The scene: ${clip(first.summary, 220)} Setting: ${set}.`,
    beats.hook ? `The mood of the song's hook (feeling only: never write these words in the picture): "${clip(beats.hook, 60)}".` : '',
    `Bright, warm, friendly, wide 3:2 frame. The only text is the title "${beats.title}" in big rounded letters.`,
  ].filter(Boolean).join(' ');
}

/** One Muse Image call: the WebP bytes, or throws. `extra` is added to the prompt (a redraw's stress on the title). */
async function draw(beats, { key, base, timeoutMs, fetchImpl, extra = '' }) {
  const fd = new FormData();
  fd.append('model', POSTER_MODEL);
  fd.append('prompt', `${posterPrompt(beats)}${extra}`);
  fd.append('image', new Blob([readFileSync(REF)], { type: 'image/jpeg' }), 'cast.jpg');
  fd.append('size', '1536x1024');
  fd.append('output_format', 'webp');
  const r = await fetchImpl(`${base}/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Muse Image ${r.status}: ${text.split(key).join('[redacted]').slice(0, 200)}`);
  const d = JSON.parse(text).data?.[0];
  const img = d?.b64_json ? Buffer.from(d.b64_json, 'base64') : d?.url ? Buffer.from(await (await fetchImpl(d.url)).arrayBuffer()) : null;
  if (!img || img.subarray(0, 4).toString() !== 'RIFF' || img.subarray(8, 12).toString() !== 'WEBP') throw new Error('Muse Image returned no WebP image');
  return img;
}

/**
 * Muse Spark 1.3 reads the poster's title back (chat completions with an image): { read, ok } where ok is whether it is
 * the episode's title, spelled right; null when the check itself could not run (the poster then stands as drawn).
 */
export async function readTitle(img, title, { key, base, timeoutMs = 60000, fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: VISION_MODEL, max_tokens: 1500, reasoning_effort: 'low', messages: [{ role: 'user', content: [
        { type: 'text', text: 'Read the large title text on this poster exactly as drawn, letter by letter. Reply with only JSON: {"title": "<the words>", "garbled": <true if any letter is wrong, malformed or missing>}' },
        { type: 'image_url', image_url: { url: `data:image/webp;base64,${img.toString('base64')}` } }] }] }) });
    if (!r.ok) return null;
    const content = (await r.json()).choices?.[0]?.message?.content;
    const got = JSON.parse(/\{[\s\S]*\}/.exec(content ?? '')?.[0] ?? 'null');
    if (!got || typeof got.title !== 'string') return null;
    return { read: got.title, ok: squash(got.title) === squash(title) && got.garbled !== true };
  } catch { return null; }
}

/**
 * Draws the poster for an episode directory (its beats.json) and writes <dir>/poster.webp, after reading its title back
 * with Muse Spark vision (one redraw when the title is misspelled). Returns { ok, file?, bytes?, seconds?, checked?,
 * redrawn?, error? }; never throws, never logs the key.
 */
export async function makePoster(dir, { key = process.env.META_API_KEY, base = process.env.MB_POSTER_BASE || 'https://api.meta.ai/v1', timeoutMs = 120000, fetchImpl = fetch, check = true } = {}) {
  const t0 = Date.now();
  try {
    if (!key) return { ok: false, error: 'no META_API_KEY' };
    const beats = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
    if (!beats.title) return { ok: false, error: 'beats.json has no title' };
    base = base.replace(/\/+$/, '');
    const o = { key, base, timeoutMs, fetchImpl };
    let img = await draw(beats, o);
    let checked = null, redrawn = false;
    if (check) {
      checked = await readTitle(img, beats.title, o);
      if (checked && !checked.ok) {
        // (misspelled: once more, the title stressed; the redraw stands only if it reads right, else the first one does)
        redrawn = true;
        const again = await draw(beats, { ...o, extra: ` Spell the title exactly, letter for letter: "${beats.title}".` }).catch(() => null);
        const second = again ? await readTitle(again, beats.title, o) : null;
        if (again && second?.ok) { img = again; checked = second; }
      }
    }
    const file = join(dir, POSTER_FILE);
    writeFileSync(file, img);
    return { ok: true, file, bytes: img.length, seconds: Math.round((Date.now() - t0) / 100) / 10, checked: checked ? checked.ok : null, ...(checked && !checked.ok ? { read: checked.read } : {}), redrawn };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).split(key || '\0').join('[redacted]') };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith('--'));
  if (!dirs.length) { console.error('usage: poster.js <episode-dir>... [--force] [--dry]'); process.exit(2); }
  let failed = 0;
  for (const dir of dirs) {
    if (args.includes('--dry')) { console.log(`${dir}: ${posterPrompt(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')))}`); continue; }
    if (existsSync(join(dir, POSTER_FILE)) && !args.includes('--force')) { console.log(`${dir}: has a poster (--force to redraw)`); continue; }
    const r = await makePoster(dir);
    console.log(r.ok ? `${dir}: ${POSTER_FILE} (${Math.round(r.bytes / 1024)} KB, ${r.seconds} s, title ${r.checked === null ? 'unchecked' : r.checked ? 'read back ok' : `misread as "${r.read}"`}${r.redrawn ? ', redrawn' : ''})` : `${dir}: FAILED ${r.error}`);
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}
