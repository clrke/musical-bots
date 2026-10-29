// The bots acting their part: gestures, face acts on cue, reactions to the bots a line names
// (Soothing Bots StoryCues.cs), consultations. STUB (owner: the acting stream): gestures play,
// face acts and nods are no-ops until the head exposes playAct.
import { HAND_CUES } from './cues.js';

const GESTURE_MODE = { palm: 'wave', loveyou: 'loveYou' };

/** A single-bot hand gesture (actions.js GESTURES). */
export function playGesture(bot, id) {
  bot.hands.play(GESTURE_MODE[id] ?? id);
}

/** A face act (actions.js ACTS) on bot's head. */
export function playAct(bot, act) {
  void bot; void act;
}

/** When a line starts: every bot it names (but the singer) reacts; cues from cues.js parseLyric. */
export function reactToCues(cues, singer, bots) {
  for (const { name, act } of cues) {
    const b = bots.get(name);
    if (!b || b === singer) continue;
    if (act && HAND_CUES.has(act)) playGesture(b, act);
    else playAct(b, act ?? 'nod');
  }
}

/** A consultation (status: consulting): bot goes over to the bots it consults. */
export function consult(bot, others) {
  for (const o of others) bot.consult(o);
}

/** Per-frame update (social idle: glances, sways...). */
export function updateActing(dt, bots) { void dt; void bots; }
