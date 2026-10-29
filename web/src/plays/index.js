// Soothing Bots hand plays (Unity Scripts/App/HandPlays) on the stage. A play is a small choreography for one bot
// (solo), two (duo) or a row / group (3..5): plays/<id>.js, run by plays/stage.js (HandStage) with the kits of
// plays/kit.js. startPlay casts and begins one when an event names it; updatePlays steps every running play, the
// heads' moves and the faces, before the bots update (they read bot.aims and bot.playOffset). Ids not ported yet fall
// back to a visible gesture, so episodes that name them still read.
import * as THREE from 'three';
import { PLAYS } from '../actions.js';
import { PlayBot, Stage } from './stage.js';
import conductor from './conductor.js';
import congaSway from './conga-sway.js';
import fistBump from './fist-bump.js';
import handStack from './hand-stack.js';
import handshake from './handshake.js';
import highFive from './high-five.js';
import holdHandsSwing from './hold-hands-swing.js';
import jazzHands from './jazz-hands.js';
import pinkyPromise from './pinky-promise.js';
import thumbsUp from './thumbs-up.js';

/** Every ported play by id. */
export const CATALOG = Object.freeze(Object.fromEntries([
  conductor, congaSway, fistBump, handStack, handshake, highFive, holdHandsSwing, jazzHands, pinkyPromise, thumbsUp,
].map((p) => [p.id, p])));

/** A visible stand-in gesture (scene/hands.js) for the plays not ported yet (or a cast that cannot play). */
const FALLBACK = {
  'finger-heart': 'loveYou', 'hand-heart': 'celebrate', 'cheek-squish': 'clap', 'twiddle-thumbs': 'wring', 'wake-stretch': 'cheer',
  'yawn-cover': 'wring', 'antenna-play': 'point', 'groom-brows': 'point', 'itchy-eye': 'wring', 'polish-visor': 'spin',
  'revolve-cw': 'spin', 'revolve-ccw': 'spin', conductor: 'point', 'count-beats': 'clap', 'jazz-hands': 'celebrate', 'thumbs-up': 'cheer',
};

/** A group play takes the bot's neighbours within this many of its head half-widths (at least its fewest). */
const GROUP_REACH = 7;
const _s = new THREE.Vector3();
const holds = new Map(); // Bot -> PlayBot
const stages = [];
const history = [];
let lastCtx = {};
let lastTime = -Infinity;

/** The plays' hold on a bot (made on first use). */
export function holdOf(bot) {
  let h = holds.get(bot);
  if (!h) {
    h = new PlayBot(bot);
    holds.set(bot, h);
  }
  return h;
}

function hashSeed(id, index, time) {
  let h = 2166136261;
  for (const c of `${id}|${index}|${Math.round((time ?? 0) * 100)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The bots near `bot` (nearest first; the beat's cast `prefer` counts as nearer, another row as farther). */
function nearest(bot, all, prefer = []) {
  const p = bot.group.position;
  return all.filter((b) => b !== bot).map((b) => {
    const q = b.group.position;
    const d = Math.hypot(q.x - p.x, q.z - p.z) + 3 * Math.abs(q.y - p.y);
    return { b, d: prefer.includes(b) ? d * 0.75 : d };
  }).sort((a, b) => a.d - b.d);
}

/** The cast for a play: solo the bot; duo the bot and its partner; a group the bot and its nearest neighbours (3..5). */
function castFor(def, bot, others, ctx) {
  if (def.cast === 'solo') return [bot];
  const all = ctx.bots ? [...(ctx.bots.values?.() ?? ctx.bots)] : [bot, ...others];
  if (def.cast === 'duo') {
    const partner = others.find((b) => b && b !== bot) ?? nearest(bot, all)[0]?.b;
    return partner ? [bot, partner] : null;
  }
  const max = def.maxCast ?? 5, min = def.minCast ?? 3;
  const near = nearest(bot, all, others);
  const cast = [bot];
  const reach = GROUP_REACH * bot.unit * (bot.group.getWorldScale(_s).x || 1); // world metres
  for (const { b, d } of near) {
    if (cast.length >= max) break;
    if (cast.length >= min && d > reach) break;
    cast.push(b);
  }
  return cast.length >= min ? cast : null;
}

/** The bots of `stage` become its own: a play they were in is called off. */
function claim(stage) {
  for (const bot of stage.cast) {
    const h = holdOf(bot);
    const old = h.stage;
    if (old && old !== stage) {
      old.release(old.memberOf(bot));
      old.endByChoir(true);
    }
    h.stage = stage;
  }
}

function fallback(id, bot, others) {
  const kind = PLAYS[id];
  if (kind === 'group') for (const b of [bot, ...others]) b.hands.play('celebrate');
  else if (kind === 'duo') {
    bot.hands.play('wave');
    others[0]?.hands.play('wave');
  } else bot.hands.play(FALLBACK[id] ?? 'wave');
}

/**
 * Start hand play `id` (an id of actions.js PLAYS) led by `bot`. others: the partner(s) the stage picked (duo:
 * [partner]; group: the beat's cast near the bot). ctx: { time, beatSec, playing, bots (Map), viewer }.
 * Returns true when the real play runs, false when a fallback gesture stood in.
 */
export function startPlay(id, bot, others = [], ctx = {}) {
  const c = { ...lastCtx, ...ctx };
  const def = CATALOG[id];
  others = others.filter(Boolean);
  if (def && bot) {
    const cast = castFor(def, bot, others, c);
    if (cast) {
      const s = new Stage(def, cast, c, hashSeed(id, bot.index ?? 0, c.time), holdOf);
      if (s.tryCast()) {
        claim(s);
        s.begin();
        stages.push(s);
        history.push(s);
        if (history.length > 200) history.shift();
        return true;
      }
      // a failed cast leaves nothing changed (its drifts were never applied)
      for (const b of s.cast) holdOf(b).cap = Infinity;
    }
  }
  fallback(id, bot, others);
  return false;
}

/** Per-frame update of the running plays, the heads' moves and the faces (call before the bots update). */
export function updatePlays(dt, ctx = {}) {
  lastCtx = ctx;
  // a seek back in time: every play is called off
  if (Number.isFinite(ctx.time) && ctx.time < lastTime - 0.5) for (const s of stages) s.endByChoir(true);
  if (Number.isFinite(ctx.time)) lastTime = ctx.time;
  for (let i = stages.length - 1; i >= 0; i--) if (!stages[i].update(dt, ctx)) stages.splice(i, 1);
  for (const h of holds.values()) h.step(dt);
}

/** The plays running now (tests, tools). */
export const runningPlays = () => stages.slice();
/** The last plays started, with their notes ({ t, step, who, other, act }) as they run (tests, tools). */
export const playHistory = () => history.slice();

/** Calls every play off and forgets them (tests; a new episode). */
export function resetPlays() {
  for (const s of stages) s.finish();
  stages.length = 0;
  history.length = 0;
  for (const h of holds.values()) {
    h.stage = null;
    h.x.set(0, 0, 0);
    h.v.set(0, 0, 0);
    h.goal.set(0, 0, 0);
    h.lean.set(0, 0, 0);
    h.leanV.set(0, 0, 0);
    h.leanGoal.set(0, 0, 0);
    h.moving = false;
    h.face.clear();
    h.face.acts.length = 0;
    h.step(0);
    h.bot.aims.left = h.bot.aims.right = null;
  }
  lastTime = -Infinity;
}
