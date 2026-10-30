// Lyric markup (protocol v2, the Soothing Bots story-line syntax with names instead of robot indices):
//   "[And] {Gold:gasp} counts every cent >> Twice!"
//   - {Name} / {Name:act}: the named bot (sung and shown as its name) reacts when the line starts:
//     a hand gesture (HAND_CUES) or a face act; {Name} alone is a nod.
//   - [Pickup] at the start: words sung before the bar line, into the line's first downbeat.
//   - " >> reply": a short answer the episode's pal (echo) sings right after the line.
// Pure; shared by the arranger, the stage, the generator, the director and the validator.

/** Cues the bots' hands play; any other cue is a face act. */
export const HAND_CUES = new Set(['wave', 'clap', 'palm', 'loveyou']);

const NAME_TOKEN = /\{([A-Za-z][A-Za-z-]*)(?::([a-z][a-z0-9-]*))?\}/g;
const PICKUP = /^\s*\[([^\]]+)\]\s*/;

const canon = (name, names) => {
  if (!names) return name.charAt(0).toUpperCase() + name.slice(1);
  return names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? null;
};

/** Replace {Name}/{Name:act} tokens by the name (unknown names stay as written, braces dropped). */
export function resolveNames(text, names = null) {
  return String(text ?? '').replace(NAME_TOKEN, (_, n) => canon(n, names) ?? n);
}

/** The bots a text names and their cues, in order, once each: [{ name, act }] (act null = nod). */
export function cuesOf(text, names = null) {
  const out = [], seen = new Set();
  for (const m of String(text ?? '').matchAll(NAME_TOKEN)) {
    const name = canon(m[1], names);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, act: m[2] ?? null });
  }
  return out;
}

/**
 * Split a v2 lyric. Returns { text, pickup, reply, cues, sung }:
 *   text   the line as shown on the lyric card (names resolved, no markup, pickup included)
 *   pickup the pickup words ('' when none), sung before the first downbeat
 *   reply  the echo's answer ('' when none), names resolved
 *   cues   [{ name, act }] from the line (not the reply)
 *   sung   the words the lead sings (= text)
 * Plain v1 lyrics come back unchanged as text.
 */
export function parseLyric(lyric, names = null) {
  let s = String(lyric ?? '');
  let reply = '';
  const r = s.indexOf('>>');
  if (r >= 0) {
    reply = resolveNames(s.slice(r + 2), names).trim();
    s = s.slice(0, r);
  }
  const cues = cuesOf(s, names);
  let pickup = '';
  const p = PICKUP.exec(s);
  if (p) {
    pickup = resolveNames(p[1], names).trim();
    let rest = s.slice(p[0].length);
    // "[And] Everyone runs" reads "And everyone runs": the line's capital moves to the pickup
    // (names, "I" and {Name} tokens keep theirs; without a names list nothing is changed)
    const w = /^([A-Z][a-z']*)\b/.exec(rest);
    if (names && w && w[1] !== 'I' && !w[1].startsWith("I'") && !names.some((n) => w[1].replace(/'s$/, '') === n)) {
      rest = rest.charAt(0).toLowerCase() + rest.slice(1);
    }
    s = pickup + ' ' + rest;
  }
  const text = resolveNames(s, names).replace(/\s+/g, ' ').trim();
  return { text, pickup, reply, cues, sung: text };
}

/**
 * The cast names a plain text says, in order (repeats kept). The cast is called by colours (Green, Gold,
 * Blue...), so a name is the Capitalised word only ("a gold spot", "paint it blue" name nobody), and a
 * colour opening a sentence is a name only when it reads as one: alone or before punctuation ("Gold!",
 * "Green, look"), before a verb in -s ("Gold counts"), or possessive ("Gold's pot"); "Gold glow!" and
 * "Gold and bright!" are the colour.
 */
export function namesIn(text, names) {
  const s = String(text ?? '');
  const out = [];
  if (!names?.length) return out;
  const re = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  for (const m of s.matchAll(re)) {
    const before = s.slice(0, m.index);
    const opens = !/\S/.test(before) || /[.!?:;"]\s*$/.test(before);
    if (opens) {
      const after = s.slice(m.index + m[0].length);
      const next = /^\s+([A-Za-z]+)/.exec(after)?.[1];
      const reads = /^['’]s\b/.test(after) || !next || /^\s*[,!?.;:]/.test(after) || /^[a-z]{2,}s$/.test(next) && !/(ss|us|is)$/.test(next);
      if (!reads) continue;
    }
    out.push(m[1]);
  }
  return out;
}

/** Everything a lyric sings, markup removed (line + reply): for lyric-rule checks. */
export const plainLyric = (lyric) => {
  const { text, reply } = parseLyric(lyric);
  return reply ? `${text} ${reply}` : text;
};
