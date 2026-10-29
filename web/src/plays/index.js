// Soothing Bots hand plays (Unity Scripts/App/HandPlays) on the stage. A play is a small choreography for one bot
// (solo), two (duo) or a row / group (3..5): plays/<id>.js, run by plays/stage.js (HandStage) with the kits of
// plays/kit.js. startPlay casts and begins one when an event names it; updatePlays steps every running play, the
// heads' moves and the faces, before the bots update (they read bot.aims and bot.playOffset). Ids not ported yet fall
// back to a visible gesture, so episodes that name them still read.
import * as THREE from 'three';
import { PLAYS } from '../actions.js';
import { PlayBot, Stage } from './stage.js';
import binoculars from './binoculars.js';
import chinStroke from './chin-stroke.js';
import conductor from './conductor.js';
import congaSway from './conga-sway.js';
import countBeats from './count-beats.js';
import fistBump from './fist-bump.js';
import handStack from './hand-stack.js';
import handshake from './handshake.js';
import heartTogether from './heart-together.js';
import highFive from './high-five.js';
import holdHandsSwing from './hold-hands-swing.js';
import jazzHands from './jazz-hands.js';
import pattyCake from './patty-cake.js';
import peaceSign from './peace-sign.js';
import peekaboo from './peekaboo.js';
import pinkyPromise from './pinky-promise.js';
import scratchHead from './scratch-head.js';
import shh from './shh.js';
import stadiumWave from './stadium-wave.js';
import thumbsUp from './thumbs-up.js';

/** Every ported play by id (Unity HandPlayCatalog order: alphabetical). */
export const CATALOG = Object.freeze(Object.fromEntries([
  binoculars, chinStroke, conductor, congaSway, countBeats, fistBump, handStack, handshake, heartTogether, highFive,
  holdHandsSwing, jazzHands, pattyCake, peaceSign, peekaboo, pinkyPromise, scratchHead, shh, stadiumWave, thumbsUp,
].map((p) => [p.id, p])));

/** A visible stand-in gesture (scene/hands.js) for the plays not ported yet (or a cast that cannot play). */
const FALLBACK = {
  'finger-heart': 'loveYou', 'hand-heart': 'celebrate', 'cheek-squish': 'clap', 'twiddle-thumbs': 'wring', 'wake-stretch': 'cheer',
  'yawn-cover': 'wring', 'antenna-play': 'point', 'groom-brows': 'point', 'itchy-eye': 'wring', 'polish-visor': 'spin',
  'revolve-cw': 'spin', 'revolve-ccw': 'spin', conductor: 'point', 'count-beats': 'clap', 'jazz-hands': 'celebrate', 'thumbs-up': 'cheer',
};

/** A group play takes the bot's neighbours within this many of its head half-widths (at least its fewest). */
const GROUP_REACH = 7;
const _s = new THREE.Vector3(), _t = new THREE.Vector3();
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

/** Two bots stand side by side as the viewer sees them (more across than front to back; Unity HandStage.SideBySide). */
function sideBySide(a, b, viewer, share) {
  const d = _s.copy(b.group.position).sub(a.group.position);
  d.y = 0;
  const m = d.length();
  if (m < 1e-6) return false;
  const to = _t.copy(viewer ?? a.viewer).sub(a.group.position);
  to.y = 0;
  if (to.lengthSq() < 1e-8) to.set(0, 0, 1);
  to.normalize();
  return Math.abs(d.x * to.z - d.z * to.x) / m >= share; // |across the line of sight| / |d|
}

/**
 * The casts to try for a play, best first: solo the bot; duo the bot and its partner; a group the bot and its nearest
 * neighbours (the beat's cast counting as nearer), 5 down to 3. A row play (conga, stadium wave) takes neighbours side by
 * side with the bot (Unity Row.Cast).
 */
function castsFor(def, bot, others, ctx) {
  if (def.cast === 'solo') return [[bot]];
  const all = ctx.bots ? [...(ctx.bots.values?.() ?? ctx.bots)] : [bot, ...others];
  if (def.cast === 'duo') {
    const partner = others.find((b) => b && b !== bot) ?? nearest(bot, all)[0]?.b;
    return partner ? [[bot, partner]] : [];
  }
  const max = def.maxCast ?? 5, min = def.minCast ?? 3;
  const reach = GROUP_REACH * bot.unit * (bot.group.getWorldScale(_s).x || 1); // world metres
  const cast = [bot];
  for (const { b, d } of nearest(bot, all, others)) {
    if (cast.length >= max) break;
    if (cast.length >= min && d > reach) break;
    if (def.row && !cast.every((c) => sideBySide(c, b, ctx.viewer, 0.6))) continue;
    cast.push(b);
  }
  const out = [];
  for (let n = cast.length; n >= min; n--) out.push(cast.slice(0, n));
  return out;
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
    for (const cast of castsFor(def, bot, others, c)) {
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
      for (const b of s.cast) if (!holdOf(b).stage) holdOf(b).cap = Infinity;
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
  if (ctx.bots) keepClear(ctx.bots);
}

const _ha = new THREE.Vector3(), _hb = new THREE.Vector3(), _hd = new THREE.Vector3();
/** Bot b's head centre in the world now: its place, the choir's social move and a play's move. */
function headWorld(b, out) {
  const g = b.group, s = g.scale.x || 1;
  out.copy(b.head?.socialOffset ?? _hd.set(0, 0, 0)).multiplyScalar(s).applyQuaternion(g.quaternion).add(g.position);
  const h = holds.get(b);
  return h ? out.add(h.x) : out;
}

/**
 * A play moves its cast's heads into each other on purpose, never into a head outside its cast: a moved head is
 * kept its summed half-widths (+4%) from every other visible head (or as near as it was without the play's move).
 */
function keepClear(bots) {
  const all = [];
  for (const b of bots.values?.() ?? bots) if (b?.group?.visible) all.push(b);
  for (const h of holds.values()) {
    const me = h.bot;
    if (!h.moving || !me.group.visible || h.x.lengthSq() < 1e-10) continue;
    const cast = h.stage?.cast ?? null;
    const r = me.unit * (me.group.scale.x || 1);
    let moved = false;
    for (const k of all) {
      if (k === me || cast?.includes(k)) continue;
      const a = headWorld(me, _ha), b = headWorld(k, _hb);
      let min = (r + k.unit * (k.group.scale.x || 1)) * 1.04;
      const before = _hd.copy(a).sub(h.x).distanceTo(b); // without the play's move
      if (before < min) min = before;
      const d = _hd.copy(a).sub(b), dist = d.length();
      if (dist >= min) continue;
      if (dist > 1e-6) d.divideScalar(dist);
      else d.copy(h.x).negate().normalize();
      h.x.addScaledVector(d, min - dist);
      const closing = h.v.dot(d);
      if (closing < 0) h.v.addScaledVector(d, -closing);
      moved = true;
    }
    if (moved) h._apply();
  }
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
    h.drives = false;
    h.face.clear();
    h.face.acts.length = 0;
    h.step(0);
    h.bot.aims.left = h.bot.aims.right = null;
  }
  lastTime = -Infinity;
}
