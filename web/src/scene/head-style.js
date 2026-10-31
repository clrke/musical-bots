// How every head is drawn (Soothing Bots look B, HANDOFF bot-visuals-and-six-four Part A §5.2 / §7; Unity
// HeadStyle.cs). Parents of toddlers found the classic heads "scary", "creepy", their colours clashing; the friendly
// look (the default) draws satin metals in the head's own tints, cartoon eyes (big dark pupils, white catchlights),
// no teeth, bolts, rivets, pistons, shutter posts or grille bars, lips instead of the round iris mouth, gentle brows
// and a resting smile, rosy cheeks and mouths, a softer warmer light, and the friendly colours (cast16.js FRIENDLY).
// The classic look stays behind ?look=classic. Pure (no three.js): the builders, the shader's uniform, the face
// and the tests share it. Set it before any head is built: it is part of the head cache key (headKey).
import { CAST16 } from '../cast16.js';

export const CLASSIC = 0;
export const FRIENDLY = 2;

const fromUrl = () => {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('look');
    return q === 'classic' ? CLASSIC : FRIENDLY;
  } catch {
    return FRIENDLY;
  }
};

let current = fromUrl();

/** The head style now: CLASSIC (0) or FRIENDLY (2). */
export const headStyle = () => current;
/** Sets the style (tests, tools). Heads built before keep their meshes (the cache key tells them apart). */
export function setHeadStyle(s) {
  current = s === CLASSIC || s === 'classic' ? CLASSIC : FRIENDLY;
  return current;
}
export const isFriendly = () => current >= FRIENDLY;
/** Builders: leave out the hardware that reads as menacing up close (bolts, rivets, teeth, pistons, posts, bars). */
export const noHardware = () => current >= FRIENDLY;
/** Appended to a parts key: friendly heads are other meshes. */
export const keySuffix = () => (current >= FRIENDLY ? '|friendly' : '');
/** The mouth a head is built with: no round (iris) mouths in the friendly look, lips instead (owner 2026-10-31). */
export const mouthFor = (shape) => (current >= FRIENDLY && shape === 'iris' ? 'lips' : shape);

/**
 * Paint parameters per finish in the friendly look: the paint keeps its own colour (no silver or dark base mixed
 * in), a satin sheen instead of mirror metal (Unity RobotHead.Finish, Soft path).
 */
export const FRIENDLY_FINISH = Object.freeze({
  painted: { base: null, tint: 1, metal: 0, rough: 0.5, coat: 0.35, brushed: 0 },
  chrome: { base: null, tint: 1, metal: 0.25, rough: 0.24, coat: 0.6, brushed: 0 },
  brushed: { base: null, tint: 1, metal: 0.2, rough: 0.4, coat: 0.35, brushed: 0.4 },
  gunmetal: { base: null, tint: 1, metal: 0.15, rough: 0.42, coat: 0.4, brushed: 0.2 },
  brass: { base: null, tint: 1, metal: 0.35, rough: 0.32, coat: 0.45, brushed: 0.15 },
  enamel: { base: null, tint: 1, metal: 0, rough: 0.3, coat: 0.6, brushed: 0 },
});

/** schema.js PALETTE, index for index: the friendly tone of each (Magna.Core Schema.FRIENDLY_FOR_PALETTE). */
const PALETTE_IDX = ['#e8edf5', '#9aa7bb', '#4f8cff', '#7fb2ff', '#2fa36b', '#7be07b', '#ffd166', '#ff9f43',
  '#ff6b6b', '#e05297', '#8a6bff', '#4fc3ff', '#3a4456', '#1c2230', '#c9a227', '#b87333'];
export const FRIENDLY_FOR_PALETTE = ['#f3eee3', '#c0b6a8', '#98beea', '#96d3e0', '#9fddc8', '#95b49a', '#e3b662', '#efb78d',
  '#ec8878', '#e4abbd', '#c4b4e5', '#96d3e0', '#687686', '#4f76a8', '#e3b662', '#cb9b86'];
const friendlyHex = (c) => {
  const i = typeof c === 'string' ? PALETTE_IDX.indexOf(c.toLowerCase()) : -1;
  return i >= 0 ? FRIENDLY_FOR_PALETTE[i] : c;
};
const SATIN_FOR = { chrome: 'enamel', gunmetal: 'painted' };

/**
 * The look a head is drawn with now (never stored): classic, `look` as it is; friendly, a cast member's (cast16.js:
 * found by its look object, or its colours and shape) `friendly` look, any other robot's palette colours mapped to
 * their friendly tones (off-palette ones kept) and chrome / gunmetal drawn as satin.
 */
const byLook = new Map();
export function drawnLook(look, cast = null) {
  if (current < FRIENDLY || !look) return look;
  if (cast?.friendly) return cast.friendly;
  const hit = byLook.get(look);
  if (hit) return hit;
  const k = `${look.faceShape}|${String(look.faceColor).toLowerCase()}|${String(look.eyeColor).toLowerCase()}|${String(look.accentColor).toLowerCase()}`;
  const member = castLooks?.get(k);
  const out = member ? { ...look, ...member } : {
    ...look, faceColor: friendlyHex(look.faceColor), eyeColor: friendlyHex(look.eyeColor), accentColor: friendlyHex(look.accentColor),
    finish: SATIN_FOR[look.finish] ?? look.finish,
  };
  if (byLook.size > 256) byLook.clear();
  byLook.set(look, out);
  return out;
}
let castLooks = null;
/** Registers the cast (cast16.js CAST16) so drawnLook finds a member by its look's colours. */
export function registerCast(members) {
  castLooks = new Map();
  for (const m of members) {
    if (!m?.look || !m.friendly) continue;
    const l = m.look;
    castLooks.set(`${l.faceShape}|${l.faceColor.toLowerCase()}|${l.eyeColor.toLowerCase()}|${l.accentColor.toLowerCase()}`,
      { finish: m.friendly.finish, faceColor: m.friendly.faceColor, eyeColor: m.friendly.eyeColor, accentColor: m.friendly.accentColor });
  }
}

registerCast(CAST16);

// expression channels (personality.js CH order)
const BROW_RAISE_L = 0, BROW_RAISE_R = 1, BROW_TILT_L = 2, BROW_TILT_R = 3, BROW_SQUEEZE = 4, BROW_ARCH = 5;
const LID_UP_L = 6, LID_UP_R = 7, LID_LOW_L = 8, LID_LOW_R = 9, LID_TILT_L = 10, LID_TILT_R = 11, PUPIL_L = 12, PUPIL_R = 13;
const MOUTH_OPEN = 16, MOUTH_SMILE = 17, MOUTH_SMIRK = 20;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The face a toddler should see (friendly only; in place on the 28 expression channels, the rest face and every
 * frame's targets before the springs): no frown, no scowl or one-brow glare, eyes open and round, big pupils, a
 * little smile at rest, a lighter smirk. Blinks, reactions and singing stay readable (Unity HeadStyle.Soften).
 */
export function soften(ch) {
  if (current < FRIENDLY) return ch;
  const tilt = clamp(0.5 * (ch[BROW_TILT_L] + ch[BROW_TILT_R]), 0.05, 0.35);
  ch[BROW_TILT_L] = clamp(lerp(ch[BROW_TILT_L], tilt, 0.75), 0, 0.4);
  ch[BROW_TILT_R] = clamp(lerp(ch[BROW_TILT_R], tilt, 0.75), 0, 0.4);
  const raise = 0.5 * (ch[BROW_RAISE_L] + ch[BROW_RAISE_R]);
  ch[BROW_RAISE_L] = lerp(ch[BROW_RAISE_L], raise, 0.6);
  ch[BROW_RAISE_R] = lerp(ch[BROW_RAISE_R], raise, 0.6);
  ch[BROW_SQUEEZE] *= 0.2;
  ch[BROW_ARCH] = Math.max(ch[BROW_ARCH], 0.3);
  for (const i of [LID_UP_L, LID_UP_R]) ch[i] = ch[i] < 0.5 ? ch[i] * 0.3 : lerp(0.15, 1, (ch[i] - 0.5) / 0.5);
  ch[LID_LOW_L] = Math.min(ch[LID_LOW_L], 0.22);
  ch[LID_LOW_R] = Math.min(ch[LID_LOW_R], 0.22);
  ch[LID_TILT_L] *= 0.3;
  ch[LID_TILT_R] *= 0.3;
  ch[PUPIL_L] = Math.max(ch[PUPIL_L], 0.62);
  ch[PUPIL_R] = Math.max(ch[PUPIL_R], 0.62);
  ch[MOUTH_SMILE] = Math.max(ch[MOUTH_SMILE], 0.45);
  ch[MOUTH_OPEN] = Math.max(ch[MOUTH_OPEN], 0.1);
  ch[MOUTH_SMIRK] *= 0.35;
  return ch;
}
