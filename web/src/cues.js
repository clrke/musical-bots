// Lyric markup (protocol v2, the Soothing Bots story-line syntax with names instead of robot indices):
//   "[And] {Lou:gasp} counts every cent >> Twice!"
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
    s = pickup + ' ' + s.slice(p[0].length);
  }
  const text = resolveNames(s, names).replace(/\s+/g, ' ').trim();
  return { text, pickup, reply, cues, sung: text };
}

/** Everything a lyric sings, markup removed (line + reply): for lyric-rule checks. */
export const plainLyric = (lyric) => {
  const { text, reply } = parseLyric(lyric);
  return reply ? `${text} ${reply}` : text;
};
