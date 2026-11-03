// The lyricist: Meta's Muse Wonder (muse-wonder-1.0, the Meta Model API) writes an episode's sung lyrics.
//
// The Muse Code crew (Muse Spark 1.3) plans the story and works out every beat, consultation and cue; Green's drafts
// fix what each line says. Then this pass hands the sung lines to Muse Wonder, which writes the words: one request
// for the whole song, the story beat by beat, with the same rules the crew's tool enforces. Every line it writes goes
// through the director's own gates (emit.js lineProblems and formProblems, craft.js lineCraft: the lyric rules, the
// singable-line limits, the rhymes, the dictionary the voice can sing) and a line that fails is sent back with its
// problems (up to four more rounds); a stanza that still fails keeps the crew's own lines. The song form's repeats (chorus 2,
// chorus 3's first three lines, the outro's callback) follow the lines they repeat; the hook and the lines that sing
// the plot's trouble stay as the plan has them. The finished bundle then goes through the full gate; if that finds
// anything new, the original lyrics are restored.
//
//   wonderLyrics(dir, { key, base, model, fetchImpl }) -> a report (the bundle in dir is rewritten in place)
// Env: MB_WONDER_BASE (default https://api.meta.ai/v1; tests point it at a stub), MB_WONDER_MODEL.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineProblems, formProblems, checkBundle } from './emit.js';
import { lineCraft, fixedByForm, rhymePartner } from './craft.js';
import { NAMES, STANZA, NO_REPLY, ARC } from './vocab.js';
import { parseLyric } from '../../web/src/cues.js';
import { MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES } from '../../web/src/gen/lyrics.js';
import { parseNdjson } from '../../web/src/player.js';
import { toNdjson } from '../../web/src/gen/index.js';

export const WONDER_MODEL = 'muse-wonder-1.0';
export const WONDER_BASE = 'https://api.meta.ai/v1';
/** muse-wonder-1.0, standard mode, $ per million tokens (https://dev.meta.ai/docs/pricing-rate-limits, Nov 4 2026). */
export const WONDER_PRICE = Object.freeze({ input: 4.0, cached: 0.2, output: 20.0 });
export const ROUNDS = 5; // the first request and four rounds of repairs

export const usdOf = (u) => (u ? ((u.input_tokens - u.cached_tokens) * WONDER_PRICE.input + u.cached_tokens * WONDER_PRICE.cached + u.output_tokens * WONDER_PRICE.output) / 1e6 : 0);
const zero = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 });

const SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, lyric: { type: 'string' } }, required: ['id', 'lyric'], additionalProperties: false } } },
  required: ['lines'],
  additionalProperties: false,
};

const SYSTEM = `You are the lyricist of a kids' sing-along cartoon musical, performed by a choir of friendly robots. A crew of AI agents has planned one episode; you write the words the robots sing, line by line, in the order of the song. Your lines must be fun to sing, vivid, kind and clear to a small child.

The format of a line (every line is checked by a strict tool; a line that breaks a rule is sent back to you):
- One line of plain words, at most 80 characters with its markup. The main line sings 2 to ${MAX_LINE_SYLLABLES} syllables (names count). Short, concrete, singable words; a picture, not a summary.
- The plain present tense only: "we hold the cake", "it tips over". Never past tense, never "will", "going to" or "'ll". No brand names, nothing scary.
- Optional echo reply after " >> ", 1 to ${MAX_REPLY_SYLLABLES} syllables of plain words (no names, no markup): "Steam crowns the bowls >> Smell it!". Keep a reply where the draft has one. No replies at all in the bridge sections, and none on a line the pal sings.
- Optional cues the stage acts out: {Gold} makes Gold look at the word, {Gold:gasp} acts it. Keep the draft's cues when the line still names that bot or moment. At most two names in a line. The singer says "we" or "I", never their own name. Names: ${NAMES.join(', ')}.
- Optional [Pickup] of 1 to 3 words at the very start ("[And] Gold counts every cent").
- The voice blurs a final /ks/ sound: never end a line on box, cakes, snacks, Black, and the like. "box" alone sings badly: say "toy box". Use everyday words the singer knows.
- Rhyme: in a verse or a bridge line 4 rhymes with line 2 (day / away, door / floor), and so does a chorus's last line with its line 2: the last WORDS must truly rhyme. A line does not repeat its partner's last word. Do not start every line the same way.
- The cast sings the story as one: say "we", "us", "our", never "I" or "my" (the bridge too). Names of the cast may appear, in at most two places a line.
- Meter: alternate strong and weak syllables (da-DUM da-DUM). Never pile up four stressed words in a row ("hold one warm bowl" stomps): put little words between them ("we hold a warm bowl", "the", "a", "our", "to", "and").
- A stanza says each thing once: do not reuse a content word (cold, free, glass) inside one stanza; show something new in every line. No filler words that only pad the beat ("so quick", "very").
- Write for the ear. The voice sings words with clear consonants best (s, sh, ch, f, r, t, p, d, k, m, n) and blurs a final "ng" (going, singing), "l" (bowl, ladle), "g" and "z" (peas), and the "oh" in "glow". Choose common everyday words a small child knows and the singer can say (steam, soup, spoon, snow, drum, door, street); avoid rare words ("ladle").
Write fresh words for what the draft says: keep its facts (the same people, things and action of that story beat; do not invent new objects or events) and say them with a vivid picture and a good sound. Reply with JSON only: {"lines":[{"id":"L3","lyric":"..."}]}, one entry for every line you were asked to write.`;

/** The slots of a bundle: Green's sung lines in order, each with its place in the song and what may change. */
export function slotsOf(beats, events) {
  const slots = [];
  const perBeat = new Map();
  for (const e of events) {
    if (!e.lyric) continue;
    const i = beats.beats.findIndex((b) => b.id === e.beat);
    if (i < 0) continue;
    const pos = perBeat.get(i) ?? 0;
    perBeat.set(i, pos + 1);
    const section = beats.beats[i].section;
    const plot = Boolean(e.trouble || e.resolves);
    const fixed = fixedByForm(section, pos);
    slots.push({ id: `L${slots.length + 1}`, seq: e.seq, i, pos, section, original: e.lyric, plot,
      singer: e.singer ?? (section.startsWith('bridge') ? beats.roles?.grown : beats.roles?.lead), withMarks: { trouble: e.trouble, resolves: e.resolves },
      // free: Wonder writes it. The hook lines and the plot's trouble lines stay; the form's repeats follow their source.
      free: !fixed && !plot, source: null });
  }
  const at = (section, pos) => slots.find((s) => s.section === section && s.pos === pos);
  for (const s of slots) {
    if (s.section === 'chorus2' && (s.pos === 1 || s.pos === 3)) s.source = at('chorus1', s.pos);
    else if (s.section === 'chorus3' && s.pos === 1) s.source = at('chorus1', 1);
    else if (s.section === 'outro' && s.pos === 1) s.source = at('intro', 0);
    if (s.source && s.source.plot) s.source = null; // (a source that stays: nothing to follow)
  }
  return slots;
}

/** The rhyme partner of a stanza position: line 4 and line 2 answer each other. */
const partnerOfIn = (slots, s) => slots.find((x) => x.i === s.i && x !== s && (rhymePartner(s.section, s.pos) === x.pos || rhymePartner(s.section, x.pos) === s.pos));
/** A line as the cards show it: one space between words, the first letter capital (a model sometimes starts one in lower case). */
export const tidy = (t) => t.trim().replace(/\s+/g, ' ').replace(/^([a-z])/, (c) => c.toUpperCase());
const stanzaOf = (slots, cur, s) => slots.filter((x) => x.i === s.i && x.pos < s.pos).map((x) => cur.get(x.id));

/** The gate for one line, with the lines before it as they stand: [] when the director's tool would accept it. */
export function slotProblems(slot, lyric, { beats, events, cur, slots }) {
  const out = [];
  const roles = beats.roles ?? {};
  out.push(...lineProblems(lyric, { section: slot.section, singer: slot.singer, roles }));
  if (slot.singer && NAMES.some((n) => n === slot.singer) && new RegExp(`(^|[^A-Za-z])${slot.singer}([^A-Za-z]|$)`).test(parseLyric(lyric, NAMES).text.replace(/\{[^}]*\}/g, ' ')))
    out.push(`${slot.singer} sings this line, so it says "we" (or "I"), never "${slot.singer}"`);
  // the song form and the craft checks see the stream as it stands: earlier lines as they are now
  const before = events.filter((e) => e.seq < slot.seq).map((e) => { const s = slots.find((x) => x.seq === e.seq); return s ? { ...e, lyric: cur.get(s.id) } : e; });
  out.push(...formProblems(beats, before, slot.i, slot.pos, lyric));
  const findings = lineCraft(lyric, { section: slot.section, pos: slot.pos, stanza: stanzaOf(slots, cur, slot), hook: beats.hook, frame: frameOf(slots, cur, slot),
    plot: slot.plot, premise: beats.prompt });
  for (const f of findings) if (f.severity === 'reject') out.push(`${f.check}: ${f.message}${f.fix ? ` (${f.fix})` : ''}`);
  return out;
}
/** Chorus 3's turned line keeps chorus 1's last line as its frame. */
const frameOf = (slots, cur, s) => (s.section === 'chorus3' && s.pos === 3 ? cur.get(slots.find((x) => x.section === 'chorus1' && x.pos === 3)?.id) ?? null : null);

function promptFor(beats, slots, cur, ask, problems = null) {
  const lines = [`Episode: "${beats.title}" (the story: ${beats.prompt})`, `The hook (sung in every chorus, already fixed): "${beats.hook}"`, beats.irony ? `The irony the last chorus pays off: ${beats.irony}` : '',
    `The cast: lead ${beats.roles?.lead}, pal ${beats.roles?.pal} (echoes the lead), the grown-up ${beats.roles?.grown}${beats.roles?.rival ? `, the rival ${beats.roles.rival}` : ''}.`, ''].filter((l) => l !== '');
  for (let i = 0; i < beats.beats.length; i++) {
    const b = beats.beats[i];
    const mine = slots.filter((s) => s.i === i);
    if (!mine.length) continue;
    lines.push('', `${b.id} (${b.section}, ${b.set}; ${ARC[b.section] ?? ''}; on stage: ${b.cast.join(', ')}): ${b.summary}`);
    for (const s of mine) {
      const now = cur.get(s.id);
      const role = ask.has(s.id) ? `WRITE ${s.id}` : s.free ? `${s.id} (done)` : s.source ? `${s.id} (repeats ${s.source.id})` : `${s.id} (fixed)`;
      const why = problems?.get(s.id);
      const mate = partnerOfIn(slots, s);
      lines.push(`  ${role}, line ${s.pos + 1} of ${STANZA[s.section]}${s.singer ? `, sung by ${s.singer}` : ''}: ${ask.has(s.id) ? `crew's draft "${s.original}"` : `"${now}"`}${ask.has(s.id) && mate && s.pos > mate.pos ? `; its last word must rhyme with ${mate.id}'s` : ''}`);
      if (why) lines.push(`    your last try was "${why.candidate}" and it breaks: ${why.problems.join('; ')}`);
    }
  }
  const first = problems ? 'Rewrite only these lines (the others stand as they are, shown above), fixing what each breaks.' : 'Write the lines marked WRITE, all of them, in order.';
  return `${lines.join('\n')}\n\n${first} Reply with the JSON.`;
}

/** One chat call to Muse Wonder: { lines, usage } (usage as the Meta Model API reports it). */
export async function askWonder({ messages, key, base = WONDER_BASE, model = WONDER_MODEL, fetchImpl = fetch, timeoutMs = 240000 }) {
  const body = (strict) => JSON.stringify({ model, max_tokens: 24000, reasoning_effort: 'low', ...(strict ? { response_format: { type: 'json_schema', json_schema: { name: 'lyrics', schema: SCHEMA, strict: true } } } : {}), messages });
  const call = async (strict) => fetchImpl(`${base.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body(strict), signal: AbortSignal.timeout(timeoutMs) });
  let res = await call(true);
  if (res.status === 400) res = await call(false); // (a host that takes no strict schema: the same ask without it)
  const text = await res.text();
  if (!res.ok) throw new Error(`Muse Wonder ${res.status}: ${text.split(key).join('[redacted]').slice(0, 300)}`);
  const j = JSON.parse(text);
  const content = j.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(/\{[\s\S]*\}/.exec(content)?.[0] ?? 'null');
  const u = j.usage ?? {};
  return { lines: Array.isArray(parsed?.lines) ? parsed.lines : [], usage: { input_tokens: u.prompt_tokens ?? 0, cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0, output_tokens: u.completion_tokens ?? 0,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0, calls: 1 } };
}

/** A copy of the source's line for a slot that repeats it: the source's words (a reply only where the slot may have one). */
function follow(slot, cur, ctx) {
  const src = cur.get(slot.source.id);
  for (const l of [src, src.split('>>')[0].trimEnd()]) if (!slotProblems(slot, l, ctx).length) return l;
  return null;
}

/**
 * Rewrite the lyrics of the bundle in `dir` with Muse Wonder. Returns the report { ok, ... }; the bundle is changed only
 * when ok (accepted lines > 0 and the full gate finds nothing new).
 */
export async function wonderLyrics(dir, { key = process.env.META_API_KEY, base = process.env.MB_WONDER_BASE || WONDER_BASE, model = process.env.MB_WONDER_MODEL || WONDER_MODEL,
  fetchImpl = fetch, dry = false, log = () => {} } = {}) {
  const t0 = Date.now();
  const report = { ok: false, model, at: new Date().toISOString(), lines: 0, written: 0, kept: 0, rounds: 0, usage: zero(), usd: 0, changes: [], kept_lines: [] };
  if (!key) return { ...report, error: 'no META_API_KEY' };
  try {
    const beats = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
    const events = parseNdjson(readFileSync(join(dir, 'events.ndjson'), 'utf8'));
    const slots = slotsOf(beats, events);
    report.lines = slots.length;
    const cur = new Map(slots.map((s) => [s.id, s.original]));
    const ctx = { beats, events, cur, slots };
    const free = slots.filter((s) => s.free);
    if (!free.length) return { ...report, error: 'no lines to write' };
    const next = new Map(); // the lines Wonder has written and the gates accepted
    let ask = new Set(free.map((s) => s.id)), problems = null;
    const messages = [{ role: 'system', content: SYSTEM }];
    for (let round = 1; round <= ROUNDS && ask.size; round++) {
      report.rounds = round;
      messages.push({ role: 'user', content: promptFor(beats, slots, cur, ask, problems) });
      const { lines, usage } = await askWonder({ messages, key, base, model, fetchImpl });
      for (const k of Object.keys(report.usage)) report.usage[k] += usage[k] ?? 0;
      messages.push({ role: 'assistant', content: JSON.stringify({ lines }) });
      problems = new Map();
      const got = new Map(lines.map((l) => [String(l.id), typeof l.lyric === 'string' ? tidy(l.lyric) : '']));
      for (const s of free.filter((x) => ask.has(x.id))) {
        const c = got.get(s.id);
        const p = c ? slotProblems(s, c, ctx) : ['no line was written'];
        if (p.length) problems.set(s.id, { candidate: c ?? '', problems: p });
        else {
          cur.set(s.id, c); next.set(s.id, c);
          for (const f of slots.filter((x) => x.source === s)) cur.set(f.id, follow(f, cur, ctx) ?? f.original); // (a repeat follows at once: its rhyme partner is judged against it)
        }
      }
      ask = new Set(problems.keys());
      if (process.env.MB_WONDER_VERBOSE) for (const [id, w] of problems) log(`  ${id} "${w.candidate}": ${w.problems.join(' | ').slice(0, 300)}`);
      log(`Muse Wonder round ${round}: ${free.length - ask.size} of ${free.length} lines pass the gates${ask.size ? `, ${ask.size} sent back` : ''}`);
    }
    // a stanza with a line that still fails keeps the crew's own lines; then the repeats follow; the whole is checked again
    const revert = (s) => { cur.set(s.id, s.original); next.delete(s.id); };
    for (const s of free.filter((x) => ask.has(x.id))) revert(s);
    // the rhyme partner of a stanza position: line 4 and line 2 answer each other
    const partnerOf = (s) => partnerOfIn(slots, s);
    const settle = () => {
      for (let again = true, n = 0; again && n < 10; n++) {
        again = false;
        for (const s of slots) {
          // (a repeat follows its source only once the source is Wonder's)
          if (s.source) { cur.set(s.id, cur.get(s.source.id) === s.source.original ? s.original : follow(s, cur, ctx) ?? s.original); continue; }
          if (!s.free || !slotProblems(s, cur.get(s.id), ctx).length) continue;
          // a line that no longer fits the lines around it goes back to the crew's: itself if it is Wonder's, else its rhyme partner
          const mate = partnerOf(s), root = mate?.source ?? mate; // (a partner that repeats an earlier line: that line goes back)
          const back = next.has(s.id) ? s : root && next.has(root.id) ? root : null;
          if (back) { revert(back); again = true; }
        }
      }
    };
    settle();
    for (const s of slots) {
      const was = s.original, now = cur.get(s.id);
      if (now !== was) report.changes.push({ id: s.id, beat: beats.beats[s.i].id, from: was, to: now });
    }
    report.written = report.changes.length;
    report.kept = slots.length - report.written;
    report.kept_lines = slots.filter((s) => cur.get(s.id) === s.original && s.free).map((s) => s.original);
    report.usd = Math.round(usdOf(report.usage) * 10000) / 10000;
    report.seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (!report.written) return { ...report, error: 'no line passed the gates' };
    if (dry) return { ...report, ok: true, dry: true };
    // write it, and let the full gate have the last word: a beat it finds fault with goes back to the crew's lines
    // (once), anything still new restores the crew's lyrics
    const before = readFileSync(join(dir, 'events.ndjson'), 'utf8');
    const baseline = new Set(checkBundle(dir).problems);
    const write = () => {
      const bySeq = new Map(slots.map((x) => [x.seq, cur.get(x.id)]));
      writeFileSync(join(dir, 'events.ndjson'), toNdjson(events.map((e) => (bySeq.has(e.seq) ? { ...e, lyric: bySeq.get(e.seq) } : e))));
      return checkBundle(dir).problems.filter((p) => !baseline.has(p));
    };
    let fresh = write();
    if (fresh.length) {
      const beatsNamed = new Set(fresh.map((p) => /^(beat-\d+-[a-z0-9]+)\b/.exec(p)?.[1]).filter(Boolean));
      for (const x of slots.filter((y) => beatsNamed.has(beats.beats[y.i].id) && next.has(y.id))) revert(x);
      settle();
      fresh = write();
    }
    if (fresh.length) {
      writeFileSync(join(dir, 'events.ndjson'), before);
      return { ...report, ok: false, written: 0, error: `the full gate found ${fresh.length} new problem(s), the crew's lyrics stand: ${fresh.slice(0, 3).join('; ')}` };
    }
    report.changes = slots.filter((x) => cur.get(x.id) !== x.original).map((x) => ({ id: x.id, beat: beats.beats[x.i].id, from: x.original, to: cur.get(x.id) }));
    report.written = report.changes.length;
    report.kept = slots.length - report.written;
    report.kept_lines = slots.filter((x) => cur.get(x.id) === x.original && x.free).map((x) => x.original);
    if (!report.written) return { ...report, ok: false, error: 'no line passed the full gate' };
    return { ...report, ok: true };
  } catch (err) {
    return { ...report, ok: false, error: String(err?.message ?? err).split(key).join('[redacted]') };
  }
}
