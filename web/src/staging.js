// The premiere's staging rules (pure: no three.js, no DOM; tested headless by web/test-staging.mjs). Generic, by
// "whoever is singing", so the making-of gets them too:
//   - cards: every voice its own lyric card (the story's line, its harmonies, the pal's answers, the backing's
//     "Bom, bom", "Ooh", "la la"): which words, which style, whether the syllables repeat bar after bar;
//   - the camera's core: the story's roles (beats.json roles) and whoever sings a line; a group shot holds those;
//   - hand gestures the words cue (a line that sings "high-five" plays one), the endings of a consultation and the
//     listeners' small gestures, chosen by the event's seq (deterministic: the frame-exact capture plays the same);
//   - the typed opening: the prompt typed and Premiere pressed in INTRO_SECONDS, whatever the prompt's length.

/** A small, stable hash (FNV-1a) of the parts' text: the seeded choices below. */
export function hashOf(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A choice from `list` by an event's seq (and a salt per kind of choice): the same every run. */
export const pickBySeq = (seq, salt, list) => (list.length ? list[hashOf(salt, seq) % list.length] : undefined);

/** A yes with probability p by an event's seq (and a salt). */
export const chanceBySeq = (seq, salt, p) => (hashOf(salt, seq, 'p') % 10000) / 10000 < p;

// ------------------------------------------------------------------ cards

/**
 * The lyric card of a sung event (e: the arranged event, text: its words as sung, chorus: it is a harmony singer's
 * copy of a line already staged). Returns { text, part, cycle }: part 'lead' (the story's line), 'harmony', 'reply' /
 * 'echo' (the pal's answers), or null when nothing is sung, and for the backing (bass, pads, groove, sparkle, hum,
 * counter-melody: "Bom, bom", "Ooh", "la la"): a hum under the line, not words to follow, so no card (QA v20: its
 * karaoke card sat under the lead's face and beside the lead's card); its mouth and its soft spot show who hums.
 */
export function cardFor(e, text, { chorus = false } = {}) {
  const words = String(text ?? '').trim();
  if (!words || e?.part === 'backing') return null;
  if (e?.part === 'reply' || e?.part === 'echo') return { text: words, part: e.part, cycle: false };
  return { text: words, part: chorus ? 'harmony' : 'lead', cycle: false };
}

/** The highlighted syllable of a card (-1: none) when the voice sings syllable `idx` of `count` on the card. */
export const cardSyllable = (idx, count, cycle) => (idx < 0 || count <= 0 ? -1 : cycle ? idx % count : Math.min(count - 1, idx));

/**
 * The clear space kept between two cards (NDC, both ways: ~27 px of 1080 up and down, ~48 px of 1920 across; framing.js
 * layoutCards' own 0.02 left two stacked cards edge to edge, QA v20 at 124 s).
 */
export const CARD_GAP = 0.05;

/** How cards rank when they would overlap (the higher keeps its place): the story's line first, the backing last. */
export const CARD_RANK = Object.freeze({ lead: 4, harmony: 3, reply: 2, echo: 2, backing: 1 });

// ------------------------------------------------------------------ the camera's core

/** The story's core members (beats.json roles: lead, pal, grown, rival), once each, in that order. */
export function coreNames(roles) {
  const out = [];
  for (const k of ['lead', 'pal', 'grown', 'rival']) if (roles?.[k] && !out.includes(roles[k])) out.push(roles[k]);
  return out;
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const posOf = (b) => b.group?.position ?? b.pos ?? b;

/**
 * Who a group shot holds: whoever sings a line now (`singers`, the backing not counted), then the core members (`core`),
 * once each; with singers, a core member farther than `reach` m from every singer is left out (the shot stays close,
 * not a wide of the whole street). Without singers, the core alone; without either, nobody (the caller's wide).
 */
export function groupSubjects({ singers = [], core = [], reach = 3.4 } = {}) {
  const out = [];
  for (const b of singers) if (b && !out.includes(b)) out.push(b);
  for (const b of core) {
    if (!b || out.includes(b)) continue;
    if (singers.length && !singers.some((s) => flat(posOf(s), posOf(b)) <= reach)) continue;
    out.push(b);
  }
  return out;
}

// ------------------------------------------------------------------ sight lines: no face hidden behind a nearer head

/** A face is this share of its head's half-width round its centre (the eyes and mouth: the shell's rim does not count). */
export const FACE_SHARE = 0.85;

/**
 * How much of head a's face a nearer head b hides from an eye at e: the share (0..1) of a's face disc (radius ra *
 * FACE_SHARE round its centre) that b's disc (rb) covers, both as the eye sees them (angular discs); 0 when b is not
 * nearer the eye than a. a, b, e: { x, y, z } (m). Pure.
 */
export function faceCover(e, a, ra, b, rb) {
  const ax = a.x - e.x, ay = a.y - e.y, az = a.z - e.z, bx = b.x - e.x, by = b.y - e.y, bz = b.z - e.z;
  const da = Math.hypot(ax, ay, az), db = Math.hypot(bx, by, bz);
  if (!(db < da - 1e-3) || db < 1e-3) return 0;
  const ar = Math.asin(Math.min(1, (ra * FACE_SHARE) / da)), br = Math.asin(Math.min(1, rb / db));
  const sep = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (da * db))));
  if (sep >= ar + br) return 0;
  if (sep <= Math.abs(br - ar)) return br >= ar ? 1 : (br * br) / (ar * ar);
  // two discs' lens (the small angles read as a plane)
  const a1 = ar * ar * Math.acos((sep * sep + ar * ar - br * br) / (2 * sep * ar));
  const a2 = br * br * Math.acos((sep * sep + br * br - ar * ar) / (2 * sep * br));
  const a3 = 0.5 * Math.sqrt(Math.max(0, (-sep + ar + br) * (sep + ar - br) * (sep - ar + br) * (sep + ar + br)));
  return Math.min(1, (a1 + a2 - a3) / (Math.PI * ar * ar));
}

/** A singer's face hidden this much (faceCover) by a nearer head counts as hidden (the test's and the blocking's bar). */
export const HIDDEN = 0.35;

/**
 * Where the audience sees a head at p from: the set's wide cameras (`wides`: [{ pos: [x, y, z] }]) and straight in
 * front of it (`dist` m toward the audience `aud` [x, z], turned a third of the way to +z as the close-ups stand, framing.js
 * towardAudience; `up` m above it). Returns [{ x, y, z }]. Pure.
 */
export function viewsOf(p, aud = [0, 9.5], wides = [], { dist = 2.6, up = 0.35 } = {}) {
  let dx = aud[0] - p.x, dz = aud[1] - p.z;
  const n = Math.hypot(dx, dz) || 1;
  dx = dx / n * 0.65;
  dz = dz / n * 0.65 + 0.35;
  const m = Math.hypot(dx, dz) || 1;
  return [{ x: p.x + (dx / m) * dist, y: p.y + up, z: p.z + (dz / m) * dist }, ...wides.map((w) => ({ x: w.pos[0], y: w.pos[1], z: w.pos[2] }))];
}

// ------------------------------------------------------------------ hand gestures the words cue

// The first of these a line's words name (by where it stands in the line) plays on its singer. kind: 'play' (plays/,
// actions.js PLAYS: solo, duo with a partner, group with the scene's cast), 'gesture' (scene/hands.js), 'act' (a face act).
const WORD_CUES = [
  [/\bhigh[- ]?fives?\b|\bup high\b/, 'high-five'],
  [/\bfist[- ]?bumps?\b|\bbump it\b/, 'fist-bump'],
  [/\bhand ?shakes?\b|\bshake (?:on it|hands)\b|\bit'?s a deal\b|\bdeal!/, 'handshake'],
  [/\bpinky\b|\bpromise/, 'pinky-promise'],
  [/\bhold(?:ing)? hands\b|\bhand in hand\b/, 'hold-hands-swing'],
  [/\bstack(?:s|ed|ing)?\b/, 'hand-stack'],
  [/\bstadium wave\b|\bdo the wave\b/, 'stadium-wave'],
  [/\bthumbs? up\b|\bokay\b|\bok\b|\bnice one\b|\bgood job\b|\bwell done\b|\bso smart\b/, 'thumbs-up'],
  [/\bthink(?:s|ing)?\b|\bthought\b|\bwonder(?:s|ing)?\b|\bhmm+\b|\bponder|\bidea\b|\bplans?\b/, 'chin-stroke'],
  [/\bcount(?:s|ing)?\b|\bone,? two\b|\btick,? tock\b|\bticks?\b/, 'count-beats'],
  [/\bshh+\b|\bhush\b|\bquiet\b|\bwhisper|\bsecret/, 'shh'],
  [/\bpeek-?a-?boo\b|\bpeek(?:s|ing)?\b|\bhid(?:e|es|ing)\b/, 'peekaboo'],
  [/\bhearts?\b|\blove\b/, 'finger-heart'],
  [/\bpeace\b/, 'peace-sign'],
  [/\buh-?oh\b|\bwhoops\b|\boops\b|\bscratch|\bconfus|\bpuzzl|\bforg[eo]t/, 'scratch-head'],
  [/\bbinoculars?\b|\bspy(?:ing)?\b|\blook(?:s|ing)? out\b|\bfar away\b/, 'binoculars'],
  [/\bjazz\b|\bta-?da\b|\bshowtime\b|\bsteal the show\b/, 'jazz-hands'],
  [/\bconduct|\borchestra\b|\bthe band\b/, 'conductor'],
  [/\bwav(?:e|es|ing)\b|\bhello\b|\bgoodbye\b|\bbye\b/, 'wave'],
  [/\bclap(?:s|ping)?\b|\bapplause\b/, 'clap'],
  [/\bhooray\b|\byay\b|\bhurrah\b|\bcheer(?:s|ing)?\b|\bwe win\b|\bwe won\b|\bvictory\b/, 'cheer'],
  [/\bno luck\b|\bwho knows\b|\bi don'?t know\b|\bshrug/, 'shrug'],
  [/\bjoin in\b|\bcome on\b|\bcome here\b|\bcome along\b/, 'beckon'],
  [/\bpoint(?:s|ing)?\b|\bover there\b/, 'point'],
];
const PLAY_CAST = {
  'high-five': 'duo', 'fist-bump': 'duo', handshake: 'duo', 'pinky-promise': 'duo', 'hold-hands-swing': 'duo',
  'hand-stack': 'group', 'stadium-wave': 'group',
  'thumbs-up': 'solo', 'chin-stroke': 'solo', 'count-beats': 'solo', shh: 'solo', peekaboo: 'solo', 'finger-heart': 'solo',
  'peace-sign': 'solo', 'scratch-head': 'solo', binoculars: 'solo', 'jazz-hands': 'solo', conductor: 'solo',
};
const GESTURE_IDS = new Set(['wave', 'clap', 'cheer', 'shrug', 'beckon', 'point', 'celebrate']);

/** What an id plays: { id, kind: 'play' | 'gesture' | 'act', cast: 'solo' | 'duo' | 'group' }. */
export function cueOf(id) {
  if (PLAY_CAST[id]) return { id, kind: 'play', cast: PLAY_CAST[id] };
  if (GESTURE_IDS.has(id)) return { id, kind: 'gesture', cast: 'solo' };
  return { id, kind: 'act', cast: 'solo' };
}

/** The gesture a line's words name (the first one in the line), else null. */
export function wordCue(text) {
  const s = String(text ?? '').toLowerCase().replace(/[’‘]/g, "'");
  let best = null, at = Infinity;
  for (const [re, id] of WORD_CUES) {
    const m = re.exec(s);
    if (m && m.index < at) { at = m.index; best = id; }
  }
  return best ? cueOf(best) : null;
}

/** A consultation (or a duo moment) ends with one of these, by the event's seq. */
export const DUO_ENDINGS = Object.freeze(['handshake', 'high-five', 'fist-bump']);
/** A listening core member's small gestures between its lines. */
export const LISTEN_GESTURES = Object.freeze(['chin-stroke', 'thumbs-up', 'nod', 'chin-stroke', 'thumbs-up']);
/** The share of story lines a listening core member gestures to. */
export const LISTEN_CHANCE = 0.4;
/** Seconds a bot rests between two gestures the stage gives it (a long line does not juggle three). */
export const GESTURE_REST = 6;

/**
 * The gestures a sung part cues on its own (the director gave it no action): its words on its singer (a harmony
 * copy does not repeat the lead's), and on a story line one listening core member now and then (chin stroke, thumbs
 * up or a nod, a little into the voice). ctx: { seq, text, part, singer, partner (a duo's other bot, or null), listeners
 * (the core members on stage who do not sing now, in a stable order), delay (s to the voice), length (s of voice) }.
 * Returns [{ at (s after the event), bot, cue: { id, kind, cast }, partner?, listen? (a listener's: not if it sings by then) }].
 */
export function lineGestures({ seq, text, part = 'lead', singer = null, partner = null, listeners = [], delay = 0.45, length = 3 }) {
  const out = [];
  if (!singer || part === 'backing') return out;
  const cue = part === 'harmony' ? null : wordCue(text);
  if (cue && !(cue.cast === 'duo' && !partner)) {
    // with the word: the hands come up as the voice starts (a reply is short: at once)
    out.push({ at: part === 'reply' || part === 'echo' ? Math.max(0, delay - 0.2) : delay, bot: singer, cue, partner: cue.cast === 'duo' ? partner : null });
  }
  if (part === 'lead' && listeners.length && length >= 1.6 && chanceBySeq(seq, 'listen', LISTEN_CHANCE)) {
    const who = pickBySeq(seq, 'listener', listeners);
    if (who && who !== singer && who !== out[0]?.partner) {
      out.push({ at: delay + Math.min(1.4, length * 0.35), bot: who, cue: cueOf(pickBySeq(seq, 'listen-gesture', LISTEN_GESTURES)), listen: true });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the typed opening

/** The typed opening (?typing): the prompt typed, a beat to read it, Premiere pressed: this long, whatever the prompt. */
export const INTRO_SECONDS = 4;

/**
 * The typed opening's timeline for a prompt of n characters, in seconds from its start: a short pause, the letters at an
 * even pace (no slower than a typist), a beat to read the prompt, then Premiere held down until `total`. Driven by the
 * time elapsed (not by timers), so a frame-exact capture records it in exactly `total` seconds at any frame rate.
 * Returns { total, start, step, pressAt, typed(t) (characters shown at t), pressed(t) }.
 */
export function typingPlan(n, total = INTRO_SECONDS) {
  const PRESS = 0.45, READ = 0.35, PAUSE = 0.4, SLOWEST = 0.11;
  const pressAt = total - PRESS;
  const end = pressAt - READ; // the last letter is in by then
  const step = n > 0 ? Math.min(SLOWEST, (end - PAUSE) / n) : 0;
  const start = end - n * step;
  return {
    total, start, step, pressAt,
    typed: (t) => (n <= 0 || t < start ? 0 : Math.min(n, Math.floor((t - start) / step + 1e-9) + 1)),
    pressed: (t) => t >= pressAt && t < total,
  };
}
