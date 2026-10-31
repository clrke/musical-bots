// The production's real work, sung (the making-of as the loading bar: owner, Oct 31, "visualize subagents THINKING
// in musical form"). A bundle's activity log (activity.ndjson, scripts/director/activity.js: what the director and
// each crew agent really did, when: a web search, a page read, a look at the git log, the plan sent, a rejection by
// the gate, the crew launched, a long think) becomes short crew lines, each said by the bot doing the work to a
// crewmate, in the room (never to the viewer): the director's work by Gold, the producer. The words come from
// templates by kind with the real detail said as a workmate would: a search by its key words ("the hackathon"), a page
// by its site's plain name ("Meta's hackathon page"), a commit by the fix it is ("the camera fix", COMMIT_PHRASES; a
// subject that names none is not sung), a section by its name; so a line is short (eight syllables where it can be),
// kid-friendly and true.
// A rejection and the advice that answers it are a little exchange ("No! The gate says it's too long" / "Make it
// short, White!"). Deterministic (a hash, no clock): the score sings these lines where the production has no news.
import { syllabify } from './mv/voice/syllables.js';
import { hashString } from './gen/rng.js';
import { AGENT_BOT } from './gen/cast.js';

/** The bot who sings the director's work: Gold, the producer (the deals bot). */
export const PRODUCER = 'Gold';
/** A line sings this many syllables at most where it can (two bars at the premiere's pace). */
export const MAX_SYLLABLES = 8;
/** s: a long think is said again this often while it lasts (a line at its start, then these). */
export const THINK_EVERY = 25;
/** s: a kind of work said once in this window (seven agents reading the plan at once: one line). */
const SAME_KIND_S = 20;

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** Who a crew agent talks to about its work, by turns (the director: by kind). */
const TALKS_TO = {
  lyrics: ['White', 'Pink', 'Gold'], chords: ['Green', 'Gray'], dance: ['White', 'Green'], lighting: ['Green', 'Gray'],
  deals: ['Green', 'Yellow'], hype: ['Green', 'Pink'], comedy: ['Green', 'Yellow'],
  director: {
    search: ['Blue', 'Pink', 'Yellow'], fetch: ['Gray', 'Blue', 'White'], read: ['White', 'Gray'], look: ['White', 'Gray'],
    git: ['White', 'Green'], think: ['Green'], plan: ['Green'], reject: ['Green', 'White'], check: ['Green', 'Yellow'], status: ['Green'],
  },
};

// the templates: (n) the crewmate, (x) the detail's words, (s) the singer; a list for the line with a detail, one without
const T = {
  search: { x: ['{n}, I\'m checking {x}', 'Let me look up {x}, {n}', 'Let me check {x}, {n}'], none: ['{n}, I\'m checking the facts', 'Let me check the facts, {n}'] },
  fetch: { x: ['{n}, here\'s {x}', 'Here\'s {x}, {n}', 'I found {x}, {n}'], none: ['{n}, I found the real page', 'I\'m reading the page, {n}'] },
  read: { lines: ['Let me read our lines, {n}', '{n}, I\'m reading our lines'], x: ['{n}, I\'m reading the {x}'], none: ['{n}, I\'m reading our notes', 'Let me read the notes, {n}'] },
  look: { none: ['{n}, I\'m looking at our files', 'Let me look around, {n}'] },
  git: { x: ['Remember {x}, {n}?', '{n}, I found {x}'] },
  think: {
    plan: ['Hmm, our story, {n}...', '{n}, I\'m planning the beats'], planMore: ['{n}, the plan is coming', 'Still planning, {n}', 'Almost there, {n}!'],
    x: ['{n}, I\'m thinking up the {x}', 'Hmm, the {x}, {n}...'], more: ['Still on the {x}, {n}', '{n}, the {x} is coming'],
    none: ['Let me think, {n}', 'Hmm, {n}, let me think'], noneMore: ['{n}, I\'m still thinking', 'Thinking hard, {n}', '{n}, a good line takes time', 'Almost got it, {n}!'],
  },
  status: { none: ['{n}, I\'ve got the plan', 'I see the plan, {n}', '{n}, the plan is in'], board: ['{n}, let me check the board', 'What\'s on the board, {n}?', 'Let me see the board, {n}'] },
  plan: { n: ['Here\'s our plan, {n}: {k} beats', '{n}, {k} beats: our story!'], none: ['Here\'s our story, {n}!'] },
  launch: { none: ['Crew, let\'s write! Go, go, go!', 'Off you go, crew! Let\'s write!'] },
  check: { ok: ['{n}, the gate says yes!', 'It all checks out, {n}!'], none: ['{n}, the gate wants more'] },
  done: { none: ['That\'s my part done, {n}!', '{n}, I\'m all done!', 'All set here, {n}!'] },
};
/** A rejection, said by the one rejected (by its kind: activity.js REASONS), and the crewmate's advice back. */
export const REJECT = {
  copy: [['No! The gate says it\'s a copy', 'Oh no, the gate says copy!'], ['Say it new, {s}!', 'Your own words, {s}!']],
  nobody: [['No! The gate says talk to us', 'Oops, I talked to nobody'], ['Say it to me, {s}!', 'Talk to me, {s}!']],
  word: [['No! The gate can\'t sing that word', 'Oh no, a word it can\'t sing'], ['Pick a plain word, {s}', 'Try a simple word, {s}']],
  meter: [['No! The gate says the beat bumps', 'Oh no, the beat is bumpy'], ['Smooth the beat, {s}', 'Bounce it softer, {s}']],
  opening: [['No! Same start again, it says', 'Oops, the same start again'], ['Start it fresh, {s}', 'Begin it new, {s}']],
  repeat: [['No! The gate says we said that', 'Oops, we said that twice'], ['Say something new, {s}', 'Once is plenty, {s}!']],
  tense: [['No! The gate wants it now', 'Oops, the gate wants today'], ['Say it now, {s}!', 'Right now, {s}, not then']],
  filler: [['No! The gate says it\'s filler', 'Oops, a filler word'], ['Make each word count, {s}', 'Cut the extra, {s}']],
  question: [['No! The gate wants a question', 'Oh, I need to ask more'], ['Ask me something, {s}!', 'Go on, ask me, {s}!']],
  rhyme: [['No! The gate says it won\'t rhyme', 'Oh no, the rhyme is off'], ['Find a rhyme, {s}', 'Rhyme it up, {s}!']],
  'fourth-wall': [['No! The gate says talk to crew', 'Oops, I talked out there'], ['Say it to me, {s}!', 'Just talk to us, {s}']],
  story: [['No! That\'s the cast, not the crew', 'Oops, I asked the cast'], ['Talk to the crew, {s}!', 'Ask the crew, {s}!']],
  done: [['No! They\'re all done, says the gate', 'Oh, my friend is done'], ['Ask a friend still here, {s}', 'I\'m still here, {s}!']],
  long: [['No! The gate says it\'s too long', 'Oh no, it\'s far too long'], ['Make it short, {s}!', 'Trim it down, {s}!']],
  closed: [['No! That part is closed, it says', 'Oops, that part is done'], ['Try the next part, {s}', 'On to the next, {s}!']],
  plan: [['No! The gate sends back the plan', 'Oh no, the plan bounced back'], ['Fix the plan, {s}!', 'Tweak the plan, {s}!']],
  other: [['No! The gate stamps it no', 'Oh no, the gate says no'], ['Try again, {s}!', 'Fix it up, {s}!']],
};
/** Small words a sung detail never ends on. */
const TRAILING = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are', 'its', 'as', 'we', 'our', 'into']);

const syl = (t) => syllabify(t).length;
const hash = (s) => hashString(String(s));
const pick = (list, h) => list[((h % list.length) + list.length) % list.length];
const fill = (tpl, v) => tpl.replace(/\{([nxsk])\}/g, (_, k) => v[k] ?? '');
/** The section a beat id is ("beat-4-chorus1" -> "chorus"). */
const sectionWord = (beat) => /^beat-\d+-([a-z]+)/.exec(String(beat ?? ''))?.[1]?.replace(/\d+b?$|b$/, '') ?? null;

/**
 * A template filled with the detail's words, as many as fit in MAX_SYLLABLES (the last ones dropped first), or
 * null when even one does not fit.
 */
export function fitDetail(tpl, words, v) {
  return fitBest([tpl], words, v, 0);
}
/**
 * Of the templates, the one that fits the most of the detail's words, filled; the words a run of the detail as
 * written (the most telling run of that many: the longest words, "hackathon" before "meta"), never starting or
 * ending on a small word; by turns among equals. Null when none fits.
 */
function fitBest(tpls, words, v, h) {
  const ws = String(words ?? '').split(/\s+/).filter(Boolean);
  let best = null;
  tpls.forEach((tpl, i) => {
    const rank = (i - h % tpls.length + tpls.length) % tpls.length;
    for (let k = ws.length; k >= 1; k--) {
      let found = null;
      for (let a = 0; a + k <= ws.length; a++) {
        const use = ws.slice(a, a + k);
        if (TRAILING.has(use[0].toLowerCase()) || TRAILING.has(use.at(-1).toLowerCase())) continue;
        const text = fill(tpl, { ...v, x: use.join(' ') });
        if (syl(text) > MAX_SYLLABLES) continue;
        const weight = use.join('').length;
        if (!found || weight > found.weight) found = { text, weight };
      }
      if (!found) continue;
      if (!best || k > best.n || (k === best.n && rank < best.rank)) best = { text: found.text, n: k, rank };
      break;
    }
  });
  return best?.text ?? null;
}

// ---------------------------------------------------------------------------------------------
// The details in plain words (a crewmate says what the work is about, never a raw commit subject or host)

/**
 * A commit subject as the fix or feature it is, in a short noun phrase a workmate would say ("the camera fix"),
 * by its keywords; null when it is none of these (the line is skipped: a raw subject never sung).
 */
export const COMMIT_PHRASES = [
  [/\bcamera|\bframing\b|close-?ups?\b|\bshots?\b/i, 'the camera fix'],
  [/high[- ]?fives?|\bhands?\b/i, 'the high five fix'],
  [/spot ?lights?|\bspots?\b|\blight(?:s|ing)?\b/i, 'the spotlight fix'],
  [/\bswarm|overlap|collid|\bcrowd/i, 'the crowd rule'],
  [/pronunc|\bvoices?\b|\bsingers?\b/i, 'the voice fix'],
  [/\bmix(?:es|ing)?\b|\bvolume\b|loudness/i, 'the sound mix'],
  [/lyric|catchphrase|\bbridges?\b|\bchorus|\bverses?\b|\brhymes?\b/i, 'the lyrics rule'],
  [/\bgate\b/i, 'the gate rule'],
];
export function commitPhrase(subject) {
  const s = String(subject ?? '');
  return COMMIT_PHRASES.find(([re]) => re.test(s))?.[1] ?? null;
}

// words of a search that name the site or fill, not what it is about
const SEARCH_SKIP = new Set(['meta', 'global', 'ai', 'dev', 'google', 'official', 'site', 'page', 'pages', 'news', 'events', 'event', 'info',
  'www', 'com', 'org', 'net', 'docs', 'the', 'a', 'an', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are',
  'how', 'what', 'when', 'where', 'who', 'why', 'rules', 'rule', 'judging', 'judges', 'criteria', 'requirements', 'prize', 'prizes', 'awards',
  'deadline', 'dates', 'date', 'schedule', 'winners', 'winner', 'results', 'theme', 'themes']);
/** What a search asks about it besides its topic, in one word. */
const SEARCH_ASPECT = [
  [/\brules?\b|requirements|eligib/i, 'rules'], [/judg|criteria/i, 'judging'], [/prizes?\b|awards?\b/i, 'prizes'],
  [/deadline|dates?\b|schedule|timeline/i, 'dates'], [/winners?\b|results\b/i, 'winners'], [/themes?\b/i, 'theme'],
];
/**
 * A search query as what it looks up, its key words ("the hackathon rules"): its topic (the longest word that is
 * not the site's name or filler; of `known`, when given, the words the singer knows) and what about it; null when none.
 */
export function searchPhrase(query, known = null) {
  const q = String(query ?? '');
  const ok = known ? new Set(String(known).toLowerCase().split(/\s+/).filter(Boolean)) : null;
  const words = q.split(/[^A-Za-z']+/).map((w) => w.toLowerCase()).filter((w) => w.length > 2 && !SEARCH_SKIP.has(w) && (!ok || ok.has(w)));
  const topic = words.sort((a, b) => b.length - a.length)[0] ?? null;
  const aspect = SEARCH_ASPECT.find(([re]) => re.test(q))?.[1] ?? null;
  if (!topic) return aspect ? `the ${aspect}` : null;
  return `the ${topic}${aspect ? ` ${aspect}` : ''}`;
}
/** A site by its plain name ("dev.meta.ai" sung as "meta": "Meta"); null when it has none. */
export const siteName = (word) => {
  const w = String(word ?? '').trim().split(/\s+/)[0];
  return w ? w[0].toUpperCase() + w.slice(1) : null;
};
/** The page a fetch read, said as a workmate would: "Meta's hackathon page", "the hackathon page", "Meta's page". */
export function pagePhrases(site, topic = null) {
  const name = siteName(site);
  const own = name && !/s$/i.test(name) ? `${name}'s` : null; // ("Meta's"; a name in s: not said so)
  const what = topic ? String(topic).replace(/^the\s+/, '').split(/\s+/)[0] : null;
  const out = [];
  if (own && what) out.push(`${own} ${what} page`);
  if (what) out.push(`the ${what} page`);
  if (own) out.push(`${own} page`);
  return out;
}
/** The first of the phrases that fits a template (by turns) in MAX_SYLLABLES, filled; null when none fits. */
function fitPhrase(tpls, phrases, v, h) {
  for (const x of phrases) {
    for (let i = 0; i < tpls.length; i++) {
      const text = fill(pick(tpls, h + i), { ...v, x });
      if (syl(text) <= MAX_SYLLABLES) return text;
    }
  }
  return null;
}

/** The bot an activity entry's `who` is (the director: the producer). */
export const singerOf = (who) => (who === 'director' ? PRODUCER : AGENT_BOT[who] ?? null);

/** The crewmate an entry's line is said to (by turns, never the singer). */
export function addresseeFor(e, singer, k = 0) {
  const by = TALKS_TO[e.who];
  const list = (Array.isArray(by) ? by : by?.[e.kind] ?? ['Green', 'White']).filter((n) => n !== singer);
  return list.length ? pick(list, hash(`${e.t}:${e.who}:${e.kind}`) + k) : 'Green';
}

/**
 * One entry's line (null: nothing to say: a write, a queue, a retry: the events themselves are sung; a look at the
 * git log that found no fix or feature to name). topic: what the last search looked up (a fetch reads its page).
 */
export function lineOf(e, k = 0, more = false, { again = false, topic = null } = {}) {
  const s = singerOf(e.who);
  if (!s) return null;
  const n = addresseeFor(e, s, k);
  const h = hash(`${e.t}:${e.who}:${e.kind}:${k}`);
  const v = { n, s };
  const t = T[e.kind];
  if (e.kind === 'reject') return null; // an exchange (exchangeOf)
  if (!t) return null;
  let text = null;
  if (e.kind === 'think') {
    if (e.who === 'director' && (e.sing === 'plan' || !e.sing)) text = fill(pick(more ? t.planMore : t.plan, h), v);
    else {
      const x = e.sing ?? sectionWord(e.beat);
      text = x ? fitBest(more ? t.more : t.x, x, v, h) : null;
      text ??= fill(pick(more ? t.noneMore : t.none, h), v);
    }
  } else if (e.kind === 'plan') {
    text = e.n && NUMBERS[e.n] ? fill(pick(t.n, h), { ...v, k: NUMBERS[e.n] }) : fill(pick(t.none, h), v);
  } else if (e.kind === 'check') {
    text = fill(pick(e.detail === 'gate ok' ? t.ok : t.none, h), v);
  } else if (e.kind === 'git') {
    const x = commitPhrase(e.detail);
    if (!x) return null;
    text = fitPhrase(t.x, [x], v, h);
  } else if (e.kind === 'search') {
    const x = searchPhrase(e.detail, e.sing);
    text = x ? fitPhrase(t.x, [x], v, h) : null;
    text ??= fill(pick(t.none, h), v);
  } else if (e.kind === 'fetch') {
    text = fitPhrase(t.x, pagePhrases(e.sing, topic), v, h) ?? fill(pick(t.none, h), v);
  } else if (e.kind === 'read' && e.sing === 'lines') {
    text = fill(pick(t.lines, h), v);
  } else if (e.kind === 'status' && again) {
    text = fill(pick(t.board, h), v);
  } else {
    if (e.sing && t.x) text = fitBest(t.x, e.sing, v, h);
    text ??= fill(pick(t.none ?? t.x, h), v);
  }
  if (!text || syl(text) > MAX_SYLLABLES + 1) return null;
  return { bot: s, to: n === 'Crew' || /^Crew\b/.test(text) ? null : n, text };
}

/** A rejection as a little exchange: the one rejected says what the gate said, a crewmate advises back. */
export function exchangeOf(e) {
  const s = singerOf(e.who);
  if (!s) return null;
  const [said, advice] = REJECT[e.reason] ?? REJECT.other;
  const n = addresseeFor(e, s);
  const h = hash(`${e.t}:${e.who}:${e.reason}`);
  return { bot: s, to: n, text: pick(said, h), reply: { bot: n, to: s, text: fill(pick(advice, h >> 3), { s }) } };
}

/**
 * The sung lines of an activity log, in time order: [{ t, bot, to, text, kind: the entry's, reply? (an exchange:
 * { bot, to, text }), entry (its index) }]. The writes, queues and retries say nothing (their events are sung); a
 * kind of work said by several agents within SAME_KIND_S is said once; a long think is said at its start and again
 * every THINK_EVERY s while it lasts.
 */
export function activityLines(activity) {
  const out = [];
  const lastOfKind = new Map();
  const looked = new Set(); // agents that have read the plan (a later status: the board)
  let topic = null; // what the last search looked up (a fetch reads its page)
  (activity ?? []).forEach((e, i) => {
    if (!e || typeof e.t !== 'number') return;
    if (e.kind === 'search') topic = searchPhrase(e.detail, e.sing) ?? topic;
    if (['write', 'queue', 'retry'].includes(e.kind)) return;
    const again = e.kind === 'status' && looked.has(e.who);
    if (e.kind === 'status') looked.add(e.who);
    if (e.kind === 'reject') {
      const x = exchangeOf(e);
      if (x) out.push({ t: e.t, kind: e.kind, entry: i, ...x });
      return;
    }
    const first = lineOf(e, 0, false, { again, topic });
    // (a kind of work said once in SAME_KIND_S: counted from a line said, not from a look that found nothing to say)
    if (e.kind !== 'think') {
      const key = (e.kind === 'status' && !again) || e.kind === 'done' ? e.kind : `${e.who}:${e.kind}`;
      if (!first || e.t - (lastOfKind.get(key) ?? -Infinity) < SAME_KIND_S) return;
      lastOfKind.set(key, e.t);
    }
    if (first) out.push({ t: e.t, kind: e.kind, entry: i, ...first });
    if (e.kind === 'think' && e.seconds > THINK_EVERY + 5) {
      for (let k = 1; k * THINK_EVERY < e.seconds - 5; k++) {
        const l = lineOf(e, k, true);
        if (l) out.push({ t: +(e.t + k * THINK_EVERY).toFixed(1), kind: e.kind, entry: i, more: k, ...l });
      }
    }
  });
  return out.sort((a, b) => a.t - b.t || a.entry - b.entry);
}

/**
 * When each event was really written, from the activity log (a queued event: when the agent sent it, though it
 * landed when its beat opened): Map seq -> seconds, for the events written before they landed.
 */
export function writtenTimes(activity, events) {
  const out = new Map();
  const byseq = new Map((events ?? []).map((e) => [e.seq, e]));
  for (const a of activity ?? []) {
    if (a?.kind !== 'queue' || !Array.isArray(a.seqs)) continue;
    for (const s of a.seqs) {
      const e = byseq.get(s);
      if (!e || e.lyric || !(a.t < (Number(e.t) || 0))) continue;
      out.set(s, Math.min(out.get(s) ?? Infinity, a.t));
    }
  }
  return out;
}
