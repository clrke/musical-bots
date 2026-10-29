// The director's vocabulary, read at runtime from the shared contract so the Muse prompts, the emit
// tool and the stage never drift apart:
//   web/src/actions.js   the action ids (plays, gestures, face acts, moves, light cues) + resolveAction
//   web/src/cues.js      the lyric markup ({Name:act}, [Pickup], " >> reply"), HAND_CUES
//   web/src/gen/form.js  the 11 story sections, their titles and chord sets
//   web/src/gen/cast.js  the 16 bots and the 7 role bots
// Pure data + helpers; no I/O.
import { PLAYS, GESTURES, ACTS, MOVES, LIGHT_MOODS, ACTION_IDS, resolveAction } from '../../web/src/actions.js';
import { HAND_CUES } from '../../web/src/cues.js';
import { SECTIONS, TITLES, FORM_CHORDS, BASE_SETS, toChord } from '../../web/src/gen/form.js';
import { CAST, NAMES, AGENT_BOT } from '../../web/src/gen/cast.js';

export { PLAYS, GESTURES, ACTS, MOVES, LIGHT_MOODS, ACTION_IDS, resolveAction, HAND_CUES, SECTIONS, TITLES, CAST, NAMES, AGENT_BOT };

/** The seven production roles, in PLAN order. */
export const ROLES = Object.keys(AGENT_BOT);
/** The sets a beat can play on (blocking.js marks). */
export const SETS = ['studio', 'diner', 'big_house', 'street'];
export const STATUSES = ['working', 'proposing', 'done', 'consulting'];
/** The Muse agent-definition id of a role: "teddy-lyrics", "nora-chords"... */
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

// The roles' menus: the ids each role reaches for. Derived from actions.js at runtime (ids another
// stream adds land in the menus by kind; ids it never removes stay valid).
const pick = (ids, pool) => ids.filter((id) => pool.includes(id));
const PLAY_IDS = Object.keys(PLAYS);
export function roleMenu(agent) {
  const solo = PLAY_IDS.filter((id) => PLAYS[id] === 'solo');
  const duo = PLAY_IDS.filter((id) => PLAYS[id] === 'duo');
  const group = PLAY_IDS.filter((id) => PLAYS[id] === 'group');
  switch (agent) {
    case 'lyrics': return [...GESTURES, ...pick(['thumbs-up', 'peace-sign', 'finger-heart', 'hand-heart', 'chin-stroke', 'scratch-head', 'shh', 'binoculars', 'peekaboo', 'jazz-hands'], solo), ...ACTS];
    case 'chords': return [...pick(['conductor', 'count-beats', 'chin-stroke', 'thumbs-up'], solo), 'clap', 'point', ...pick(['nod', 'kindnod', 'knowing'], ACTS), ...pick(['fist-bump', 'handshake'], duo)];
    case 'dance': return [...MOVES.filter((m) => m !== 'walk-to'), 'walk-to-<Bot>', ...group, ...pick(['ball-dance-twirl', 'hold-hands-swing', 'patty-cake'], duo), 'spin', ...pick(['jazz-hands', 'revolve-cw', 'revolve-ccw'], solo)];
    case 'lighting': return [...LIGHT_MOODS.map((m) => `lights-${m}`), 'spot-<Bot>', 'spot-hero'];
    case 'deals': return [...pick(['handshake', 'pinky-promise', 'fist-bump', 'rock-paper-scissors', 'thumb-war'], duo), ...pick(['count-beats', 'thumbs-up', 'chin-stroke', 'twiddle-thumbs'], solo), ...pick(['harrumph', 'sigh', 'knowing', 'slowblink'], ACTS)];
    case 'hype': return [...pick(['high-five', 'fist-bump'], duo), ...pick(['stadium-wave', 'pass-the-clap', 'hand-stack'], group), 'celebrate', 'cheer', 'clap', ...pick(['jazz-hands', 'thumbs-up', 'peace-sign', 'binoculars'], solo), 'huddle'];
    case 'comedy': return [...ACTS, ...pick(['peekaboo', 'cheek-squish', 'itchy-eye', 'groom-brows', 'polish-visor', 'yawn-cover', 'wake-stretch', 'antenna-play'], solo), ...pick(['tickle', 'boop', 'fix-antenna', 'pet-bot'], duo), 'shrug'];
    default: return [];
  }
}

/** Chord names the band knows (C major plus the borrowed ones form.js uses). */
export const CHORD_RE = /^[A-G][#b]?(m|maj7|m7|7|sus2|sus4|dim|aug)?$/;

/** The section's default chords in C (form.js), picked by a stable hash: the band's fallback. */
export function sectionChords(section, tag = 'tender', seed = '') {
  let h = 2166136261;
  for (const c of `${seed}:${section}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const from = (sets) => { const ks = Object.keys(sets); return sets[ks[h % ks.length]]; };
  let romans;
  if (section === 'verse1b' || section === 'verse2b') romans = from(FORM_CHORDS['verse:build']);
  else if (section === 'bridge2') romans = from(FORM_CHORDS[`bridge2:${tag === 'suspense' ? 'suspense' : 'tender'}`]);
  else romans = BASE_SETS[section.startsWith('chorus') ? 'chorus' : section] ?? BASE_SETS.verse1;
  return romans.map(toChord);
}

/** One line per bot for the prompts: name, kind, voice, catchphrase (cast.js). */
export const castLines = () => NAMES.map((n) => `${n} (${CAST[n].kind}, ${CAST[n].voice}, says "${CAST[n].says}")`);
