// The action vocabulary (protocol v2): every `action` id an event may carry and what it stages.
// One contract for the stage (web/src/main.js), the generator (web/src/gen), the Muse Code director
// (scripts/director) and the validator. Pure data + a resolver; the handlers live with their owners:
//   plays    -> web/src/plays/ (Soothing Bots hand plays, ported from HandPlays/Plays/*.cs)
//   gestures -> web/src/scene/hands.js (HandGestures modes)
//   acts     -> web/src/scene/personality.js ACTS (face-act timelines, played on cue)
//   moves    -> web/src/blocking.js (bots moving through the sets)
//   lights   -> web/src/blocking.js / the set's lights (the lighting agent's cues)
// An id the stage cannot play yet must degrade to something visible (resolveAction's fallback), never throw.

/** Soothing Bots hand plays by id (HandPlayCatalog.cs). kind: who it needs. */
export const PLAYS = {
  // duo: the event's bot + a partner (consult[0], else the bot its lyric names, else the nearest)
  handshake: 'duo', 'high-five': 'duo', 'fist-bump': 'duo', 'hold-hands-swing': 'duo', 'pinky-promise': 'duo',
  'patty-cake': 'duo', 'heart-together': 'duo', boop: 'duo', 'ball-dance-twirl': 'duo', 'fix-antenna': 'duo',
  'pet-bot': 'duo', 'rock-paper-scissors': 'duo', 'thumb-war': 'duo', tickle: 'duo',
  // group: the event's bot + the bots of the beat (beats.json cast), else its neighbours
  'conga-sway': 'group', 'hand-stack': 'group', 'stadium-wave': 'group', 'chain-swing': 'group',
  'pass-the-clap': 'group', 'maiba-taya': 'group',
  // solo: the event's bot
  conductor: 'solo', 'jazz-hands': 'solo', 'thumbs-up': 'solo', 'chin-stroke': 'solo', 'scratch-head': 'solo',
  'count-beats': 'solo', shh: 'solo', 'peace-sign': 'solo', peekaboo: 'solo', binoculars: 'solo',
  'finger-heart': 'solo', 'hand-heart': 'solo', 'cheek-squish': 'solo', 'twiddle-thumbs': 'solo',
  'wake-stretch': 'solo', 'yawn-cover': 'solo', 'antenna-play': 'solo', 'groom-brows': 'solo', 'itchy-eye': 'solo',
  'polish-visor': 'solo', 'revolve-cw': 'solo', 'revolve-ccw': 'solo',
};
/** Port order (most visible / most useful to a story first). */
export const PLAY_PRIORITY = ['handshake', 'high-five', 'fist-bump', 'hold-hands-swing', 'conductor', 'jazz-hands',
  'thumbs-up', 'conga-sway', 'hand-stack', 'pinky-promise', 'chin-stroke', 'scratch-head', 'count-beats', 'shh',
  'patty-cake', 'stadium-wave', 'peace-sign', 'heart-together', 'peekaboo', 'binoculars'];

/** Single-bot hand gestures (scene/hands.js modes) the stage plays directly. */
export const GESTURES = ['wave', 'clap', 'palm', 'loveyou', 'point', 'spin', 'celebrate', 'cheer', 'shrug', 'beckon'];

/** Face acts (scene/personality.js ACTS). */
export const ACTS = ['giggle', 'harrumph', 'peek', 'sigh', 'yawn', 'doze', 'wink', 'waggle', 'preen', 'gulp', 'dart',
  'sway', 'crazy', 'swap', 'cockleft', 'cockright', 'peer', 'browlift', 'nod', 'nodtwice', 'bounce', 'squeal', 'flutter',
  'swoon', 'stare', 'exhale', 'wobble', 'boing', 'slowblink', 'knowing', 'gasp', 'longing', 'softsigh', 'brighten',
  'lookup', 'kindnod', 'twinkle', 'stir'];

/** Moves through the set (blocking.js). `walk-to-<mark|Bot>` targets a set mark or a bot. */
export const MOVES = ['march', 'huddle', 'gather', 'enter', 'exit', 'walk-to'];

/** Lighting cues (the lighting agent): `lights-<mood>`, `spot-<Bot>` / `spot-hero`. */
export const LIGHT_MOODS = ['gold', 'warm', 'cool', 'dim', 'night', 'party', 'bright'];

/** v1 ids already in checked-in bundles -> v2 ids. */
export const LEGACY = {
  'shake-hands': 'handshake', 'cheer-jump': 'high-five', conduct: 'conductor', 'point-at-gate': 'point',
  'spin-step': 'spin', pratfall: 'wobble', 'huddle-up': 'huddle', 'march-parade': 'march', 'strum-air': 'count-beats',
  'count-coins': 'count-beats', 'dim-lights-gold': 'lights-gold', 'mic-raise': 'celebrate', 'demo-kick-line': 'jazz-hands',
  'sing-solo': '',
};

/**
 * What an action id stages. Returns { kind, id, target } with kind one of
 * 'play' | 'gesture' | 'act' | 'move' | 'light' | 'none'; target: the mark/bot of walk-to-*, the
 * mood of lights-*, the bot of spot-* ('hero' = the episode's lead).
 */
export function resolveAction(action) {
  let id = String(action ?? '').trim();
  if (id in LEGACY) id = LEGACY[id];
  if (!id) return { kind: 'none', id: '', target: null };
  if (id in PLAYS) return { kind: 'play', id, target: null };
  if (GESTURES.includes(id)) return { kind: 'gesture', id, target: null };
  if (ACTS.includes(id)) return { kind: 'act', id, target: null };
  if (id.startsWith('walk-to-')) return { kind: 'move', id: 'walk-to', target: id.slice(8) };
  if (MOVES.includes(id)) return { kind: 'move', id, target: null };
  if (id.startsWith('lights-')) return { kind: 'light', id: 'lights', target: id.slice(7) };
  if (id.startsWith('spot-')) return { kind: 'light', id: 'spot', target: id.slice(5) };
  return { kind: 'none', id, target: null };
}

/** Every id a producer may emit (walk-to-*, lights-*, spot-* as patterns). */
export const ACTION_IDS = [...Object.keys(PLAYS), ...GESTURES, ...ACTS, ...MOVES.filter((m) => m !== 'walk-to'),
  'walk-to-<mark|Bot>', ...LIGHT_MOODS.map((m) => `lights-${m}`), 'spot-<Bot>', 'spot-hero'];
