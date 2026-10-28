// Fireworks lyric enrichment for the curated bundles (author-time only; the shipped app stays
// static with zero keys). For each bundle, the distinct sung lines go to a Fireworks-hosted open
// model in one structured-output request; a candidate replaces its line only if it passes every
// gate, otherwise the generator's line stands:
//   - the lyric rules (no we/us/our/all, no future tense, no brands, nothing menacing),
//   - within +-2 sung syllables of the original (the song arrangement keeps its shape),
//   - at most 60 characters, plain text, no line breaks,
//   - the bundle validator still passes.
// Lines sung by several bots (harmony) stay identical: each distinct line is enriched once.
//
//   FIREWORKS_API_KEY=... node scripts/enrich.js [episodes-dir] [--only slug] [--dry]
//   npm run enrich          (loads a local, git-ignored .env if present)
// Env: FIREWORKS_API_KEY (required), FIREWORKS_MODEL, FIREWORKS_BASE_URL (tests point it at a stub).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { lyricProblems } from '../web/src/gen/rules.js';
import { syllabify } from '../web/src/mv/voice/syllables.js';
import { parseNdjson } from '../web/src/player.js';
import { toNdjson } from '../web/src/gen/index.js';

export const DEFAULT_MODEL = 'accounts/fireworks/models/llama-v3p3-70b-instruct';
const BASE = process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1';
const MAX_CHARS = 60, SYLL_SLACK = 2;

export const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, lyric: { type: 'string' } },
        required: ['id', 'lyric'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

const SYSTEM = `You punch up lyrics for a cartoon musical sung by a choir of friendly robots.
Rewrite each line to be catchier and more vivid while keeping its meaning, its singer's role and
about the same number of syllables. Rules, no exceptions: never use the words we, us, our or all;
present tense only (no "will", "going to" or "'ll"); no brand names; nothing scary or violent.
Keep character names as they are. One line each, plain text, at most ${MAX_CHARS} characters.
Answer with JSON only: {"lines":[{"id":<id>,"lyric":"<new line>"}]}.`;

/** The gate for one candidate: [] when it may replace `original`. */
export function candidateProblems(original, candidate) {
  const p = [];
  if (typeof candidate !== 'string' || !candidate.trim()) return ['empty'];
  const c = candidate.trim();
  if (c.length > MAX_CHARS) p.push(`longer than ${MAX_CHARS} chars`);
  if (/[\n\r<>{}]/.test(c)) p.push('not plain text');
  p.push(...lyricProblems(c));
  const d = Math.abs(syllabify(c).length - syllabify(original).length);
  if (d > SYLL_SLACK) p.push(`syllables off by ${d}`);
  return p;
}

/** The distinct sung lines of a bundle, with the context the model needs. */
export function distinctLines(events, beats) {
  const byText = new Map();
  for (const e of events) {
    const text = (e.lyric || '').trim();
    if (!text || byText.has(text)) continue;
    const beat = beats.beats?.find((b) => b.id === e.beat);
    byText.set(text, { id: byText.size, lyric: text, bot: e.bot, role: e.agent, section: beat?.section, beat: beat?.title });
  }
  return [...byText.values()];
}

export async function requestLines({ prompt, lines, key, model = process.env.FIREWORKS_MODEL || DEFAULT_MODEL, fetchImpl = fetch }) {
  const res = await fetchImpl(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 2000,
      response_format: { type: 'json_schema', json_schema: { name: 'lyrics', schema: SCHEMA, strict: true } },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify({ episode: prompt, lines }) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`fireworks ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(content);
  return { model, lines: Array.isArray(parsed.lines) ? parsed.lines : [], usage: body.usage ?? null };
}

/** Enrich one bundle dir in place; returns a report. */
export async function enrichBundle(dir, { key, dry = false, fetchImpl } = {}) {
  const events = parseNdjson(readFileSync(`${dir}/events.ndjson`, 'utf8'));
  const beats = JSON.parse(readFileSync(`${dir}/beats.json`, 'utf8'));
  const lines = distinctLines(events, beats);
  const { model, lines: out, usage } = await requestLines({ prompt: beats.prompt, lines, key, fetchImpl });
  const replace = new Map(), rejected = [];
  for (const c of out) {
    const src = lines.find((l) => l.id === c.id);
    if (!src) continue;
    const problems = candidateProblems(src.lyric, c.lyric);
    if (problems.length) rejected.push({ original: src.lyric, candidate: c.lyric, problems });
    else if (c.lyric.trim() !== src.lyric) replace.set(src.lyric, c.lyric.trim());
  }
  const enriched = events.map((e) => (replace.has((e.lyric || '').trim()) ? { ...e, lyric: replace.get(e.lyric.trim()) } : e));
  const report = { bundle: dir, model, at: new Date().toISOString(), lines: lines.length, accepted: replace.size,
    rejected, usage, changes: [...replace].map(([from, to]) => ({ from, to })) };
  if (!dry && replace.size) {
    const before = readFileSync(`${dir}/events.ndjson`, 'utf8');
    writeFileSync(`${dir}/events.ndjson`, toNdjson(enriched));
    try {
      execFileSync('node', ['scripts/validate-bundle.js', dir], { stdio: 'pipe' });
    } catch (err) {
      writeFileSync(`${dir}/events.ndjson`, before); // the validator has the last word
      throw new Error(`${dir}: enriched bundle fails validation, kept the original: ${err.stdout || err.message}`);
    }
    writeFileSync(`${dir}/enrich.json`, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only') ?? 'episodes';
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const dry = args.includes('--dry');
  const key = process.env.FIREWORKS_API_KEY;
  if (!key) {
    console.error('FIREWORKS_API_KEY is not set (export it in your shell, or put it in a git-ignored .env). Nothing sent.');
    process.exit(2);
  }
  const dirs = readdirSync(root).filter((d) => d !== 'sample' && (!only || d === only) && existsSync(`${root}/${d}/events.ndjson`));
  for (const d of dirs) {
    const r = await enrichBundle(`${root}/${d}`, { key, dry });
    console.log(`${d}: ${r.accepted}/${r.lines} lines enriched, ${r.rejected.length} rejected (${r.model})${dry ? ' [dry run]' : ''}`);
    for (const x of r.rejected) console.log(`  rejected "${x.candidate}": ${x.problems.join(', ')}`);
  }
}
