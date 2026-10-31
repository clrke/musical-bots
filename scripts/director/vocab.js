// The director's vocabulary, read at runtime from the shared contract so the Muse prompts, the emit
// tool and the stage never drift apart:
//   web/src/actions.js   the action ids (plays, gestures, face acts, moves, light cues) + resolveAction
//   web/src/cues.js      the lyric markup ({Name:act}, [Pickup], " >> reply"), HAND_CUES
//   web/src/gen/form.js  the 11 story sections and titles (web/src/song/form.js: the chords, the style)
//   web/src/gen/lyrics.js the generator's line gates (lineProblems: at most 7 sung syllables, replies
//                        of 1-5), reused by the emit tool
//   web/src/gen/prompt.js what a prompt names (cast, sets), a hint for the director
//   web/src/gen/cast.js  the 16 bots and the 7 role bots
// Pure data + helpers; no I/O.
import { PLAYS, PLAY_PRIORITY, GESTURES, ACTS, MOVES, LIGHT_MOODS, ACTION_IDS, resolveAction } from '../../web/src/actions.js';
import { HAND_CUES } from '../../web/src/cues.js';
import { SECTIONS, TITLES, chooseStyle, styleRomans, chordName } from '../../web/src/gen/form.js';
import { PROGRESSION_SETS, chordsOf } from '../../web/src/song/form.js';
import { CAST, NAMES, AGENT_BOT } from '../../web/src/gen/cast.js';
import { lineProblems, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, endsKs } from '../../web/src/gen/lyrics.js';
import { parsePrompt } from '../../web/src/gen/prompt.js';

export { PLAYS, PLAY_PRIORITY, GESTURES, ACTS, MOVES, LIGHT_MOODS, ACTION_IDS, resolveAction, HAND_CUES, SECTIONS, TITLES, CAST, NAMES, AGENT_BOT };
export { lineProblems, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, endsKs, parsePrompt };

/** The seven production roles, in PLAN order. */
export const ROLES = Object.keys(AGENT_BOT);
/** The sets a beat can play on (web/src/scene/environments/sets.js: the three Blender sets, blocking.js marks). */
export const SETS = ['diner', 'big_house', 'street'];
/**
 * Set names a finished bundle may still carry from before (read as a real set when it plays: sets.js SET_ALIASES,
 * 'studio' -> the diner): its gate passes, a new plan may not choose them.
 */
export const LEGACY_SETS = ['studio'];
export const STATUSES = ['working', 'proposing', 'done', 'consulting'];
/** The Muse agent-definition id of a role: "green-lyrics", "white-chords"... */
export const agentType = (agent) => `${AGENT_BOT[agent].toLowerCase()}-${agent}`;

/**
 * Sung lines per section (Soothing Bots StoryForm): the intro sets the scene in 2 lines; a verse or a
 * bridge is a 4-line stanza; a chorus sings Hook X Hook Y (chorus 2 the same words, chorus 3
 * Hook X Hook Turn); the outro sings the hook, the intro's first line again, then 2 lines of the
 * world changed.
 */
export const STANZA = {
  intro: 2, verse1: 4, verse1b: 4, chorus1: 4, verse2: 4, verse2b: 4, chorus2: 4, bridge: 4, bridge2: 4, chorus3: 4, outro: 4,
};
/** What each section does in the story (Soothing Bots V5's arc). */
export const ARC = {
  intro: 'the scene: a picture of the place and the thing (its first line comes back in the outro)',
  verse1: 'the setup: who, where, what the lead wants, a flaw showing',
  verse1b: 'the inciting turn: the problem arrives, the stakes',
  chorus1: 'the hook, sung Hook X Hook Y',
  verse2: 'the complication: a first try goes wrong, weaknesses make it worse',
  verse2b: 'the peak: the funniest moment or the low point',
  chorus2: 'the hook again, the same words as chorus 1',
  bridge: "the grown-up's quiet turn, in the grown-up's own \"I\"",
  bridge2: "the grown-up's decision (tender) or cliffhanger (suspense); one line may be the lead's",
  chorus3: "Hook X Hook Turn: the turned line pays off the irony (the grown-up sings it)",
  outro: "the hook, the intro's first line again, then two lines of the world changed",
};
/** Sections whose lines take no echo reply. */
export const NO_REPLY = new Set(['bridge', 'bridge2']);

/** The beat id of section i (0-based): "beat-4-chorus1". */
export const beatId = (i) => `beat-${i + 1}-${SECTIONS[i]}`;

// The roles' menus: the ids each role reaches for, derived from actions.js at run time. Hand plays
// come only from PLAY_PRIORITY (the plays the stage choreographs, ported from the Unity HandStage;
// any other PLAYS id only falls back to a gesture), each role its own; a choreographed play no role
// lists yet joins by kind (group -> dance, duo -> deals, solo -> lyrics), so a new one is offered.
// Every role thinks with its hands (chin-stroke, scratch-head) and seals an agreement or a
// consultation's answer with a duo play (high-five, fist-bump, handshake, pinky-promise); the
// band counts beats; the lighting designer scouts the stage through binoculars.
export const REAL_PLAYS = new Set(PLAY_PRIORITY);
const real = (ids) => ids.filter((id) => REAL_PLAYS.has(id));
const ROLE_PLAYS = {
  lyrics: ['chin-stroke', 'scratch-head', 'thumbs-up', 'fist-bump', 'high-five', 'pinky-promise', 'peace-sign', 'shh', 'binoculars', 'peekaboo', 'jazz-hands', 'heart-together'],
  chords: ['conductor', 'count-beats', 'chin-stroke', 'thumbs-up', 'fist-bump', 'handshake', 'high-five'],
  dance: ['conga-sway', 'stadium-wave', 'hand-stack', 'hold-hands-swing', 'patty-cake', 'jazz-hands', 'chin-stroke', 'high-five'],
  lighting: ['binoculars', 'chin-stroke', 'thumbs-up', 'fist-bump'],
  deals: ['handshake', 'pinky-promise', 'fist-bump', 'thumbs-up', 'count-beats', 'chin-stroke', 'scratch-head'],
  hype: ['high-five', 'fist-bump', 'stadium-wave', 'hand-stack', 'jazz-hands', 'thumbs-up', 'peace-sign', 'binoculars', 'chin-stroke'],
  comedy: ['peekaboo', 'scratch-head', 'shh', 'patty-cake', 'heart-together', 'chin-stroke', 'high-five'],
};
const listed = new Set(Object.values(ROLE_PLAYS).flat());
const KIND_ROLE = { group: 'dance', duo: 'deals', solo: 'lyrics' };
/** The choreographed plays of a role (the role's own, plus any new ones of its kind). */
export function rolePlays(agent) {
  const extra = PLAY_PRIORITY.filter((id) => !listed.has(id) && KIND_ROLE[PLAYS[id]] === agent);
  return real([...(ROLE_PLAYS[agent] ?? []), ...extra]);
}
const pick = (ids, pool) => ids.filter((id) => pool.includes(id));
export function roleMenu(agent) {
  const plays = rolePlays(agent);
  switch (agent) {
    case 'lyrics': return [...GESTURES, ...plays, ...ACTS];
    case 'chords': return [...plays, 'clap', 'point', ...pick(['nod', 'kindnod', 'knowing'], ACTS)];
    case 'dance': return [...MOVES.filter((m) => m !== 'walk-to'), 'walk-to-<Bot>', ...plays, 'spin'];
    case 'lighting': return [...LIGHT_MOODS.map((m) => `lights-${m}`), 'spot-<Bot>', 'spot-hero', ...plays];
    case 'deals': return [...plays, ...pick(['harrumph', 'sigh', 'knowing', 'slowblink'], ACTS)];
    case 'hype': return [...plays, 'celebrate', 'cheer', 'clap', 'huddle'];
    case 'comedy': return [...ACTS, ...plays, 'shrug'];
    default: return [];
  }
}

/** Chord names the band knows (C major plus the borrowed ones the song form uses: G7, Fm, Bb...). */
export const CHORD_RE = /^[A-G][#b]?(m|maj7|m7|7|sus2|sus4|dim|aug)?$/;

/**
 * A section's chords when White sets none: the song's own (web/src/song/form.js chooseStyle on the
 * episode's seed and tags, as the generator writes them and the arranger would pick them anyway).
 */
export function sectionChords(section, tags = {}, seed = '') {
  return styleRomans(chooseStyle(seed, typeof tags === 'string' ? { bridge: tags } : tags ?? {}), section).map(chordName);
}

/** The progressions the song form knows per section job (White's menu), as chord names in C. */
export function progressionMenu() {
  return Object.entries(PROGRESSION_SETS).map(([job, ids]) => [job, ids.map((id) => chordsOf(id).map(chordName).join(' '))]);
}

/** One line per bot for the prompts: name, kind, voice, catchphrase (cast.js). */
export const castLines = () => NAMES.map((n) => `${n} (${CAST[n].kind}, ${CAST[n].voice}, says "${CAST[n].says}")`);
