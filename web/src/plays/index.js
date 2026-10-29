// Soothing Bots hand plays (HandPlays/Plays/*.cs) on the stage. STUB until the HandStage port lands
// (owner: the hand-plays stream): handshake and high-five use the old tweens; every other play falls
// back to a visible gesture so episodes that name it still read.
import { PLAYS } from '../actions.js';

const FALLBACK = { conductor: 'point', 'count-beats': 'clap', 'jazz-hands': 'celebrate', 'thumbs-up': 'cheer' };

/**
 * Start hand play `id` (an id of actions.js PLAYS) led by `bot`. others: the partner(s) the stage
 * picked (duo: [partner]; group: the beat's cast near the bot). ctx: { beatSec, time }.
 * Returns true when the real play runs, false when a fallback gesture stood in.
 */
export function startPlay(id, bot, others = [], ctx = {}) {
  void ctx;
  const partner = others[0] ?? null;
  if (id === 'handshake' && partner) { bot.handshake(partner); return true; }
  if (id === 'high-five' && partner) { bot.hands.play('celebrate'); bot.highFive(partner); return true; }
  const kind = PLAYS[id];
  if (kind === 'group') for (const b of [bot, ...others]) b.hands.play('celebrate');
  else bot.hands.play(kind === 'duo' ? 'wave' : FALLBACK[id] ?? 'sway');
  return false;
}

/** Per-frame update of the running plays (after the bots' own update). */
export function updatePlays(dt, ctx = {}) { void dt; void ctx; }
