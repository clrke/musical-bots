// The bots acting their part (Soothing Bots: StoryCues.cs, RobotHead.PlayAct, ChoirSocial.cs + ChoirPlay.cs):
//   - gestures and face acts on cue (actions.js GESTURES / ACTS);
//   - a line that names bots: each named bot reacts once as the line starts (its hand cue or a face act,
//     a nod by default) and it and the singer glance at each other;
//   - consultations (status consulting): the head goes over, the two face each other, trade nods and
//     looks, agree (both nod, or shake on it), and come back, within the event's time;
//   - the choir's life between lines: neighbours glance at a bot that starts to sing and answer each
//     other's looks (with small acts of their personality), nod at a line they liked, sway with the
//     song in a row, bump into and poke a neighbour now and then (ChoirSocial.Profiles' odds).
// Heads only (the hands only through their gestures and plays). The bots keep their marks (blocking.js
// places them): a play moves a head off its place on a spring (an approach, a lean, a knock), visual only,
// and puts it back exactly. Deterministic: every bot has its own random stream seeded from its index,
// the choir one from a constant, and the clock is the sum of the frame times (no Math.random, no wall
// clock), so a frame-exact capture plays the same every time.
import * as THREE from 'three';
import { HAND_CUES } from './cues.js';
import { startPlay } from './plays/index.js';
import { HandGestures } from './scene/hands.js';
import { makeRng } from './scene/motion.js';
import { DEFAULT_ACT } from './scene/personality.js';
import { BAR, BEAT, CARD_LEAD } from './sing-plan.js';

// ------------------------------------------------------------------ gestures + acts on cue

/** actions.js GESTURES -> hands.js modes, first one the hands know ('palm' is a wave until an open palm lands). */
const GESTURE_MODES = { palm: ['palm', 'openPalm', 'wave'], loveyou: ['loveYou'] };
const knowsMode = (m) => typeof HandGestures?.modeOf !== 'function' || HandGestures.modeOf(m) > 0;

/** The hands mode a gesture id plays (a wave when the hands know none of its names). */
export function gestureMode(id) {
  const names = GESTURE_MODES[id] ?? [id];
  return names.find(knowsMode) ?? 'wave';
}

/** A single-bot hand gesture (actions.js GESTURES). True: something plays. */
export function playGesture(bot, id) {
  if (!bot?.hands) return false;
  bot.hands.play(gestureMode(id));
  return true;
}

// A face act with a body to it: the floating head hops / sways with the act (head radii per second, head space).
const ACT_PUSH = { boing: [0, 1.7, 0], bounce: [0, 1.1, 0], squeal: [0, 0.9, 0], wobble: [1.3, 0, 0], gasp: [0, 0.5, -0.9], stir: [0, 0.9, 0] };
const _push = new THREE.Vector3();

/**
 * A face act (actions.js ACTS) on the bot's head, now (Unity PlayAct: it takes the place of the idle act
 * and blends with the rest of the face; a nod when none is given). False when the head refuses it (an
 * unknown act, or a reaction playing).
 */
export function playAct(bot, act) {
  const head = bot?.head;
  if (!head?.playAct) return false;
  const name = act || DEFAULT_ACT;
  if (!head.playAct(name)) return false;
  const push = ACT_PUSH[name];
  if (push && head.nudge) {
    const r = bot.unit ?? 0.12;
    head.nudge(_push.set(push[0] * r, push[1] * r, push[2] * r));
  }
  return true;
}

/**
 * The acting under an action the stage dispatched elsewhere (main.js stage()): a light cue shows on the
 * face of the bot who calls it (blocking.js lights the set: lights-* brighten, spot-* look up at the
 * rig); an id nothing can play yet still nods (never nothing). r: actions.js resolveAction(action).
 */
export function accentAction(bot, r) {
  if (!bot || !r) return false;
  if (r.kind === 'light') return playAct(bot, r.id === 'spot' ? 'lookup' : 'brighten');
  if (r.kind === 'none' && r.id) return playAct(bot, DEFAULT_ACT);
  return false;
}

// ------------------------------------------------------------------ personalities (ChoirSocial.Profiles)

const NO_PLAYS = { bump: 0, poke: 0, sway: 0, wave: 0 };
/** Unity's P(...).With(...) (named weights: bump, poke, sway, wave); `approve`: its nod at a line it liked (new here). */
function P(notice, every, act, noticeActs, exchangeActs, returnActs, glanceMin = 1.1, glanceMax = 2) {
  return {
    with: (move, back, startle, giggle, mischief, plays = {}, approve = ['nod']) => Object.freeze({
      notice, every, act, noticeActs, exchangeActs, returnActs, glance: [glanceMin, glanceMax],
      move, back, startle, giggle, mischief, approve, plays: Object.freeze({ ...NO_PLAYS, ...plays }),
    }),
  };
}

/**
 * Per personality (ChoirSocial.Profiles, the plays this stage has): notice (chance to look over when a
 * neighbour starts to sing), every (mean s between the looks it gives a neighbour), act (chance a look
 * comes with an act), the acts of its looks (notice / exchange / answer), glance [min, max] s, move (how
 * much it moves: leans, hops, how far a push sends it), back (chance to answer a bump or poke in kind), its
 * acts when startled / amused / up to something, how keen it is to start each play, and its approval nod.
 */
export const PROFILES = Object.freeze({
  cheerful: P(0.8, 11, 0.55, ['nod', 'browlift'], ['nod', 'giggle'], ['nod', 'giggle'])
    .with(1, 0.35, ['gasp', 'boing'], ['giggle'], ['giggle', 'nod'], { bump: 1, poke: 0.6, wave: 1.6, sway: 1 }, ['nodtwice', 'nod']),
  wistful: P(0.5, 15, 0.5, ['softsigh', 'longing'], ['longing'], ['softsigh'], 1.2, 2.2)
    .with(0.7, 0.1, ['gasp', 'softsigh'], ['slowblink', 'softsigh'], ['longing'], { wave: 0.3, sway: 1.6 }, ['kindnod', 'softsigh']),
  shy: P(0.6, 15, 0.6, ['peek', 'flutter'], ['peek'], ['peek'], 0.6, 1.1)
    .with(0.75, 0.05, ['peek', 'gulp', 'flutter'], ['peek', 'flutter'], ['peek'], { sway: 0.4 }, ['kindnod']),
  dramatic: P(0.85, 11, 0.6, ['gasp'], ['gasp', 'swoon'], ['gasp'])
    .with(1.1, 0.2, ['gasp'], ['swoon', 'gasp'], ['gasp'], { bump: 0.3, poke: 0.3, wave: 0.5, sway: 1.2 }, ['nod', 'gasp']),
  sleepy: P(0.3, 20, 0.5, ['yawn'], ['slowblink'], ['slowblink'], 1.4, 2.4)
    .with(0.6, 0.05, ['yawn', 'slowblink'], ['slowblink'], ['yawn'], { sway: 0.6 }, ['nod', 'slowblink']),
  cheeky: P(0.8, 9, 0.6, ['wink', 'knowing'], ['wink', 'giggle'], ['wink'])
    .with(1.1, 0.6, ['wink', 'giggle'], ['giggle', 'wink'], ['wink', 'waggle', 'knowing'], { bump: 1.2, poke: 2.5, wave: 0.5 }, ['nod', 'knowing']),
  proud: P(0.5, 15, 0.5, ['preen'], ['preen'], ['nod'])
    .with(0.7, 0.15, ['gasp', 'preen'], ['preen', 'nod'], ['preen'], { wave: 0.3, sway: 0.5 }, ['nod']),
  nervous: P(0.8, 12, 0.55, ['gulp', 'dart'], ['dart'], ['gulp'], 0.6, 1.2)
    .with(0.9, 0.05, ['gulp', 'dart'], ['gulp'], ['dart'], {}, ['nod']),
  dreamy: P(0.55, 14, 0.5, ['slowblink', 'twinkle'], ['slowblink'], ['slowblink'], 1.4, 2.4)
    .with(0.8, 0.1, ['slowblink', 'gasp'], ['twinkle', 'slowblink'], ['slowblink'], { wave: 0.3, sway: 2.2 }, ['kindnod', 'slowblink']),
  zany: P(0.8, 9, 0.6, ['boing', 'wobble'], ['crazy', 'boing'], ['wobble'])
    .with(1.25, 0.7, ['boing', 'crazy'], ['crazy', 'wobble'], ['crazy', 'swap'], { bump: 3, poke: 1.5, wave: 1.5, sway: 0.3 }, ['nodtwice']),
  curious: P(0.9, 9, 0.6, ['cockleft', 'cockright', 'peer'], ['peer', 'cockleft', 'cockright'], ['cockleft', 'cockright'])
    .with(1, 0.4, ['gasp', 'cockleft', 'cockright'], ['cockleft', 'cockright'], ['peer', 'cockleft', 'cockright'], { bump: 0.5, poke: 1.5, wave: 0.3 }, ['nod', 'cockleft']),
  gentle: P(0.7, 12, 0.55, ['kindnod', 'slowblink'], ['kindnod'], ['kindnod', 'slowblink'])
    .with(0.8, 0.15, ['gasp', 'kindnod'], ['giggle', 'kindnod'], ['kindnod'], { poke: 0.3, wave: 0.8, sway: 1.2 }, ['kindnod']),
  stoic: P(0.35, 20, 0.4, ['nod'], ['nod'], ['nod'])
    .with(0.35, 0, ['nod'], ['nod'], ['nod'], {}, ['nod']),
  giddy: P(0.9, 8, 0.6, ['bounce', 'squeal'], ['giggle', 'bounce'], ['bounce', 'giggle'])
    .with(1.2, 0.6, ['squeal', 'bounce'], ['giggle', 'squeal'], ['squeal', 'bounce'], { bump: 2, poke: 1, wave: 2.6, sway: 0.8 }, ['nodtwice', 'bounce']),
  hopeful: P(0.85, 10, 0.6, ['brighten', 'lookup'], ['brighten'], ['brighten'])
    .with(1, 0.35, ['gasp', 'brighten'], ['giggle', 'brighten'], ['brighten', 'lookup'], { bump: 0.7, poke: 0.5, wave: 1.8, sway: 0.8 }, ['nod', 'brighten']),
  romantic: P(0.7, 11, 0.6, ['flutter'], ['flutter', 'swoon'], ['flutter'])
    .with(0.9, 0.2, ['flutter', 'gasp'], ['flutter', 'swoon'], ['flutter'], { bump: 0.3, wave: 0.3, sway: 1.6 }, ['kindnod', 'flutter']),
  bored: P(0.25, 18, 0.6, ['sigh', 'exhale'], ['sigh'], ['sigh'], 0.8, 1.4)
    .with(0.6, 0.1, ['sigh', 'exhale'], ['exhale'], ['stare'], { poke: 0.4 }, ['nod']),
  goofy: P(0.75, 10, 0.6, ['wobble', 'waggle'], ['waggle'], ['wobble'])
    .with(1.2, 0.6, ['wobble', 'boing'], ['wobble', 'waggle'], ['waggle', 'wobble'], { bump: 2.5, poke: 1, wave: 1.2, sway: 0.8 }, ['nodtwice']),
  wise: P(0.5, 15, 0.5, ['knowing', 'slowblink', 'nod'], ['nod'], ['nod'])
    .with(0.4, 0.05, ['slowblink', 'nod'], ['knowing'], ['knowing'], { sway: 0.2 }, ['nod', 'knowing']),
  starstruck: P(0.95, 10, 0.6, ['twinkle', 'gasp'], ['twinkle'], ['twinkle'], 1.4, 2.4)
    .with(1, 0.3, ['gasp', 'twinkle'], ['twinkle'], ['twinkle'], { bump: 0.3, wave: 1, sway: 0.6 }, ['nod', 'twinkle']),
});
const DEFAULT_PROFILE = P(0.6, 13, 0.5, ['nod'], ['nod'], ['nod'])
  .with(1, 0.3, ['gasp'], ['giggle'], ['nod'], { bump: 0.5, poke: 0.5, wave: 0.5, sway: 0.5 }, ['nod']);
export const profileOf = (personality) => PROFILES[personality] ?? DEFAULT_PROFILE;
const PLAY_KINDS = Object.keys(NO_PLAYS);

// ------------------------------------------------------------------ constants (ChoirSocial / ChoirPlay)

const NEIGHBOR_REACH = 4.5; // head radii (centre to centre, the two radii averaged): neighbours
const NOTICE_REACH = 6; //     ... within this they notice what a bot does
const NEIGHBOR_INTERVAL = 0.25; // s between neighbour-list refreshes
const COOLDOWN = 3.5; //        s a bot rests between two looks of its own
const REST_BEFORE_SINGING = 1.5; // s of quiet before a bot's line counts as coming in (its neighbours look over)
const SANG_SCALE = 0.35; //     x its notice: the chance to look over when a neighbour comes in (Unity)
const SANG_NEAR = 0.8; //       ... for its two nearest (the listeners a close-up shows)
const LISTEN_SWAY = 0.45; //    x the nearest free listener's sway odds: its row sways with the line coming in
const LINE_LIKED = 1.2; //      s sung for the listeners to nod at a line ...
const LINE_END = 2.2; //        ... in its last seconds (the next line's card cuts away just before the voice ends)
const APPROVE_SCALE = 0.6; //   x its notice: the chance to nod at a line (at most APPROVERS a line)
const APPROVERS = 2;
const MAX_TRAVEL = 1.5; //      radii a play moves a head off its place (at most)
const TOUCH = 0.96; //          share of the summed radii at which two heads touch
const TOUCH_FLOOR = 0.9; //     partners never closer than this share of their summed radii
const PARTING = 0.5; // s: a consultation's pair stays partners while they part (endScene)
const CLEAR_MARGIN = 1.04; //   a path is clear when it keeps this share of the summed radii from other heads
const MAX_PLAYS = 2;
const PLAY_GAP = [6, 14]; //    s between the starts of two plays (x1.3 with < 6 free bots, x1.8 with < 3)
const PLAY_REST = 10; //        s a bot rests after a play (x0.8..1.2)
const CALM = 4; //              s at the start with nothing physical
const MAX_PLAY_SECONDS = 12, MAX_WIND_DOWN = 4;
const RETURN_OMEGA = 6, RETURN_ZETA = 0.85; // back to its place: about 0.8 s, barely overshooting
const MAX_LEAN = 0.5;
const SETTLED = 0.12; //        world units/s: a bot moving faster (walking its blocking) takes part in no play
// ChoirPlay
const REACH = 1.32, OVERSHOOT = 0.35, STILL_MOVE = 0.6, JAB_PAST = 0.15, LEAN_GAP = 0.4, ANTENNA_REACH = 0.6, DRIFT = 6;
// a consultation: the heads meet this far apart (summed radii: room for a handshake), the visitor goes at
// most CONSULT_TRAVEL radii, the host CONSULT_HOST
const CONSULT_GAP = 1.2, CONSULT_TRAVEL = 3.2, CONSULT_HOST = 2, CONSULT_TURN = 0.85;
const SHAKE_REACH = 2.6; // radii from a head to the point between the bots: its hand gets there for a handshake
const DUET_FRONT = 1; // world units: a sung duet steps this far out of the row, toward the viewer
const DUET_APART = 1.7; // summed head radii between the two of a duet (centre to centre)

const V3 = THREE.Vector3;
const ZERO = new V3();
const UP = new V3(0, 1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
// scratch: _a.._d for the steps and casting; every helper below has its own (no helper clobbers its arguments)
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
const _cl = [new V3(), new V3(), new V3(), new V3(), new V3()]; // clear()
const _cg = Array.from({ length: 7 }, () => new V3()); // openAt(), openGoal()
const _sp = [new V3(), new V3(), new V3(), new V3(), new V3(), new V3()]; // separate(), integrate(), played()
const _ap = [new V3(), new V3()]; // apply()
const _pt = [new V3(), new V3()]; // partners()
const _tc = [new V3(), new V3()]; // look(), neighbours, glances
const _to = [new V3(), new V3()]; // touching()
const _jo = new V3(), _le = new V3();
const _q = new THREE.Quaternion();

// ------------------------------------------------------------------ the cast as the choir sees it

class Member {
  constructor(bot) {
    this.bot = bot;
    this.index = bot.index ?? 0;
    this.name = bot.name ?? String(this.index);
    this.rand = makeRng((this.index + 1) * 7919 + 2027); // its own stream: its odds, its picks
    this.prof = profileOf(bot.cast?.personality ?? bot.head?.personality);
    this.antenna = (bot.cast?.look?.antenna ?? 'single') !== 'none';
    this.place = new V3(); // its head's place (the bot's position, world) this frame
    this.last = new V3();
    this.seen = false;
    this.speed = 0;
    this.scale = 1;
    this.r = 0.3; // head radius (half-width), world
    // its line
    this.singing = false; // a line on (from its card to the end of its voice)
    this.voiced = false; //  sounding now
    this.quietFor = 99;
    this.sungFor = 0;
    this.liked = false; // its listeners have nodded at its line
    // looks: one pending (at, toward whom, how long, the act, why); a rest after each
    this.busyUntil = 0;
    this.nextExchange = -1;
    this.pendingTo = null;
    this.pendingAt = 0;
    this.pendingFor = 0;
    this.pendingAct = null;
    this.pendingWhy = '';
    this.lookTo = null;
    this.lookUntil = 0;
    this.lookPoint = new V3(); // what its head glances at (its group's space), following the head it looks at
    this.nbr = []; // neighbour members, left to right as the viewer sees them
    this.nbrPoints = [new V3(), new V3()];
    this.nbrCount = -1;
    // the moves (world, off its place): a spring to a goal, a lean (radians toward a horizontal direction)
    this.x = new V3();
    this.v = new V3();
    this.goal = new V3();
    this.omega = RETURN_OMEGA;
    this.zeta = RETURN_ZETA;
    this.lean = new V3();
    this.leanV = new V3();
    this.leanGoal = new V3();
    this.leanOmega = RETURN_OMEGA;
    this.moving = false;
    this.travel = MAX_TRAVEL;
    this.applied = false;
    // plays and scenes
    this.play = null;
    this.scene = null;
    this.restUntil = 0;
  }

  between(a, b) {
    return a + this.rand() * (b - a);
  }

  pick(list) {
    return list?.length ? list[Math.floor(this.rand() * list.length) % list.length] : null;
  }

  refresh(dt) {
    const g = this.bot.group;
    this.scale = g.scale.x || 1;
    this.r = Math.max(1e-3, (this.bot.unit ?? 0.12) * this.scale);
    if (this.seen && dt > 0) this.speed = this.last.distanceTo(g.position) / dt;
    this.last.copy(g.position);
    this.place.copy(g.position);
    this.seen = true;
  }
}

/** One play between neighbours (ChoirPlay): its cast by role (cast[0] starts it) and its timed steps. */
class Play {
  constructor(kind, cast) {
    this.kind = kind;
    this.cast = cast;
    this.phase = 0;
    this.phaseAt = 0;
    this.start = 0;
    this.down = false;
    this.downAt = 0;
    this.over = false;
    this.stage = cast.map(() => 0);
    this.due = cast.map(() => 0);
    this.reactions = cast.map(() => null); // per member: { at, acts, step, to, look }
    this.goal = [];
    this.dir = new V3();
    this.aim = new V3();
    this.aimBack = new V3();
    this.mutual = false;
    this.answer = false;
    this.antenna = false;
    this.jabs = 1;
    this.right = new V3(1, 0, 0);
    this.rank = [];
    this.order = [];
    this.size = [];
    this.tip = [];
    this.period = BAR;
    this.cycles = 2;
    this.t0 = 0;
    this.focus = null; // a sway to a line: the singer its row looks at
  }

  /** The play has these two heads touch (the others keep apart). */
  touches(i, j) {
    if (this.kind !== 'bump' && this.kind !== 'poke') return false;
    const [a, b] = this.cast;
    return (i === a && j === b) || (i === b && j === a);
  }

  get reacting() {
    return this.reactions.some((r) => r !== null);
  }
}

// ------------------------------------------------------------------ the stage's acting

export class Acting {
  constructor({ seed = 1 } = {}) {
    this.rand = makeRng(seed * 104729 + 31); // the choir's stream: who starts the next play, which one
    this.now = 0; // the acting clock: the sum of the frame times
    this.song = 0; // the song's clock (updateActing ctx.time), for swaying in time
    this.members = new Map(); // bot -> Member
    this.list = []; // by bot index
    this.timers = [];
    this.timerSeq = 0;
    this.plays = [];
    this.scenes = [];
    this.nextPlayAt = CALM + 2;
    this.nextNeighbors = 0;
    this.right = new V3(1, 0, 0); // the viewer's right (the studio camera looks down -z)
    this.notes = [];
    this.onNote = null;
  }

  between(a, b) {
    return a + this.rand() * (b - a);
  }

  member(bot) {
    let m = this.members.get(bot);
    if (!m) {
      m = new Member(bot);
      this.members.set(bot, m);
      this.list.push(m);
      this.list.sort((x, y) => x.index - y.index);
      m.refresh(0);
    }
    return m;
  }

  /** Something happened (tests, debugging): { t, what, who, other, act }. */
  note(what, who, other = null, act = null) {
    const n = { t: Math.round(this.now * 1000) / 1000, what, who: who?.name ?? null, other: other?.name ?? null, act };
    this.notes.push(n);
    if (this.notes.length > 4000) this.notes.splice(0, 1000);
    this.onNote?.(n);
  }

  /** Runs `fn` `seconds` from now (in order; on the acting clock). */
  after(seconds, fn) {
    this.timers.push({ at: this.now + Math.max(0, seconds), seq: this.timerSeq++, fn });
  }

  runTimers() {
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.now + 1e-9);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > this.now + 1e-9);
    due.sort((x, y) => x.at - y.at || x.seq - y.seq);
    for (const t of due) t.fn();
  }

  // ---------------------------------------------------------------- the frame

  update(dt, bots, ctx = {}) {
    dt = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    this.now += dt;
    this.song = Number.isFinite(ctx?.time) ? ctx.time : this.song + dt;
    if (bots) for (const b of bots.values ? bots.values() : bots) if (b) this.member(b);
    for (const m of this.list) m.refresh(dt);
    // 1. lines: a neighbour coming in draws looks, a line sung through a nod or two
    for (const m of this.list) this.stepSinging(m, dt);
    // 2. what is due: cue reactions, the beats of a consultation
    this.runTimers();
    // 3. neighbours, a few times a second
    if (this.now >= this.nextNeighbors) {
      this.nextNeighbors = this.now + NEIGHBOR_INTERVAL;
      this.updateNeighbors();
    }
    // 4. looks: now and then a bot looks at a neighbour, which answers with a look and an act of its own
    this.stepExchanges();
    this.stepDueLooks();
    // 5. consultations, plays
    for (const s of this.scenes.slice()) this.stepScene(s, dt);
    this.stepPlays();
    // 6. the heads move; the glances follow the heads they look at
    this.integrate(dt);
    this.followGlances();
  }

  stepSinging(m, dt) {
    const b = m.bot;
    const singing = b.singing > 0;
    const voiced = singing && b.level > 0.12;
    const was = m.singing, wasVoiced = m.voiced, quiet = m.quietFor, sung = m.sungFor + (voiced ? dt : 0);
    m.singing = singing;
    m.voiced = voiced;
    m.quietFor = voiced ? 0 : !singing || b.level < 0.03 ? quiet + dt : quiet;
    m.sungFor = was && !singing ? 0 : sung;
    if (singing && !was) {
      // its line: it drops the look it was about to give and faces its audience
      this.cancelLook(m);
      if (m.lookTo) this.unlook(m);
      m.liked = false;
    }
    if (voiced && !wasVoiced && quiet >= REST_BEFORE_SINGING) this.notice(m);
    // the line's last second (while the camera is still on it): the listeners nod at a line sung through
    if (singing && !m.liked && b.singing <= LINE_END && sung >= LINE_LIKED) {
      m.liked = true;
      this.approve(m);
    }
  }

  // ---------------------------------------------------------------- looks

  /** Free to glance at someone: not on its line, in no play or consultation. */
  canGlance(m) {
    return !m.singing && !m.play && !m.scene;
  }

  /** Can be given a look to do: free to glance, nothing pending, rested. */
  canLook(m) {
    return this.canGlance(m) && !m.pendingTo && this.now >= m.busyUntil;
  }

  /** m looks at member `to`'s head for `seconds` (its head turning `turn` of the way). */
  look(m, to, seconds, turn = 0.5) {
    if (!to || to === m || !(seconds > 0)) return;
    m.lookTo = to;
    m.lookUntil = this.now + seconds;
    this.toLocal(m, this.pos(to, _tc[0]), m.lookPoint);
    m.bot.head?.glanceTo?.(m.lookPoint, seconds, turn);
  }

  /** m looks back at the viewer (ends its look). */
  unlook(m) {
    m.lookTo = null;
    m.bot.head?.glanceTo?.(null);
  }

  act(m, name) {
    return name ? playAct(m.bot, name) : false;
  }

  schedule(m, to, at, seconds, act, why) {
    m.pendingTo = to;
    m.pendingAt = at;
    m.pendingFor = seconds;
    m.pendingAct = act;
    m.pendingWhy = why;
  }

  clearLook(m) {
    m.pendingTo = null;
    m.pendingAct = null;
    m.pendingWhy = '';
  }

  /** Drops the look m was about to give (and the answer it would have drawn). */
  cancelLook(m) {
    const to = m.pendingTo, why = m.pendingWhy;
    this.clearLook(m);
    if (why === 'exchange' && to && to.pendingTo === m && to.pendingWhy === 'look back') this.clearLook(to);
  }

  /**
   * The free bots near m may look over as it comes in (the nearest first, one after another): its two
   * nearest listeners (the ones a close-up shows) likelier than the rest.
   */
  notice(src) {
    let delay = this.between(0.1, 0.3), q = 0;
    const near = this.gather(src, NOTICE_REACH);
    // now and then the listeners next to the singer sway with its song (as keen as the nearest one is on swaying)
    const host = near.slice(0, 2).find((m) => this.canPlay(m)); // one of the two a close-up shows
    if (host && this.now >= CALM && this.plays.length < MAX_PLAYS && !this.scenes.length && this.rand() < LISTEN_SWAY * Math.min(1, host.prof.plays.sway)) {
      const p = this.cast_sway(host);
      if (p) {
        p.focus = src; // they sway looking at the singer
        this.begin(p);
      }
    }
    for (const m of near) {
      const scale = q++ < 2 ? SANG_NEAR : SANG_SCALE;
      if (!this.canLook(m) || m.voiced) continue;
      if (m.rand() >= m.prof.notice * scale) continue;
      this.schedule(m, src, this.now + delay, m.between(m.prof.glance[0], m.prof.glance[1]), null, 'sang');
      delay += this.between(0.12, 0.35);
    }
  }

  /** A line sung through: a listener or two nods at the singer (its approval act); the singer looks back at the first after. */
  approve(src) {
    let delay = this.between(0.05, 0.2), first = null, n = 0;
    for (const m of this.gather(src, NOTICE_REACH)) {
      if (n >= APPROVERS) break;
      if (!this.canLook(m)) continue;
      if (m.rand() >= m.prof.notice * APPROVE_SCALE) continue;
      this.schedule(m, src, this.now + delay, m.between(m.prof.glance[0], m.prof.glance[1]) + 0.3, m.pick(m.prof.approve), 'approve');
      first ??= m;
      n++;
      delay += this.between(0.2, 0.4);
    }
    if (first && !src.pendingTo) this.schedule(src, first, this.now + Math.max(0, src.bot.singing) + 0.25, 1.1, null, 'thanks');
  }

  stepExchanges() {
    for (const m of this.list) {
      if (this.now < m.nextExchange) continue;
      if (m.nextExchange < 0) {
        m.nextExchange = this.now + m.between(0.5, 1.5) * m.prof.every;
        continue;
      }
      m.nextExchange = this.now + m.between(0.6, 1.4) * m.prof.every;
      if (!this.canLook(m)) continue;
      const j = this.gather(m, NEIGHBOR_REACH).find((k) => this.canLook(k));
      if (!j) continue;
      const act = m.rand() < m.prof.act ? m.pick(m.prof.exchangeActs) : null;
      const at = this.now + m.between(0, 0.2);
      this.schedule(m, j, at, m.between(m.prof.glance[0], m.prof.glance[1]), act, 'exchange');
      this.schedule(j, m, at + j.between(0.35, 0.8), j.between(j.prof.glance[0], j.prof.glance[1]) * 0.8, j.pick(j.prof.returnActs), 'look back');
    }
  }

  stepDueLooks() {
    for (const m of this.list) {
      const to = m.pendingTo;
      if (!to || this.now < m.pendingAt) continue;
      const act = m.pendingAct, why = m.pendingWhy, seconds = m.pendingFor;
      this.clearLook(m);
      if (!this.canGlance(m)) {
        if (why === 'exchange' && to.pendingTo === m && to.pendingWhy === 'look back') this.clearLook(to);
        continue;
      }
      this.look(m, to, seconds);
      const acted = this.act(m, act);
      m.busyUntil = this.now + seconds + COOLDOWN;
      this.note(why, m, to, acted ? act : null);
    }
  }

  /** Members within `reach` head radii of m's place (the two radii averaged), nearest first. */
  gather(m, reach) {
    const out = [];
    for (const k of this.list) {
      if (k === m) continue;
      const d = m.place.distanceTo(k.place);
      if (d > reach * 0.5 * (m.r + k.r)) continue;
      out.push({ k, d });
    }
    out.sort((x, y) => x.d - y.d || x.k.index - y.k.index);
    return out.map((x) => x.k);
  }

  updateNeighbors() {
    for (const m of this.list) {
      m.nbr.length = 0;
      // a bot on its line faces its audience, two consulting face each other: no idle glances to neighbours
      if (!m.singing && !m.scene) {
        const near = this.gather(m, NEIGHBOR_REACH);
        for (let q = 0; q < near.length && q < 2; q++) m.nbr.push(near[q]);
        if (m.nbr.length === 2 && _tc[0].copy(m.nbr[0].place).sub(m.nbr[1].place).dot(this.right) > 0) m.nbr.reverse();
      }
      for (let q = 0; q < m.nbr.length; q++) this.toLocal(m, this.pos(m.nbr[q], _tc[0]), m.nbrPoints[q]);
      if (m.nbr.length !== m.nbrCount) {
        m.nbrCount = m.nbr.length;
        m.bot.head?.setNeighbors?.(m.nbrPoints.slice(0, m.nbrCount));
      }
    }
  }

  /** The heads' glance points follow the heads they look at (kept by reference by each head). */
  followGlances() {
    for (const m of this.list) {
      if (m.lookTo && this.now < m.lookUntil) this.toLocal(m, this.pos(m.lookTo, _tc[0]), m.lookPoint);
      else m.lookTo = null;
      for (let q = 0; q < m.nbr.length; q++) this.toLocal(m, this.pos(m.nbr[q], _tc[0]), m.nbrPoints[q]);
    }
  }

  /** Where member m's head is now (world): its place plus its offset. */
  pos(m, out) {
    return out.copy(m.place).add(m.x);
  }

  /** `out` (a point of m's head, world) plus a hand play's move of the head (bot.playOffset, its group's space). */
  played(m, out) {
    const p = m.bot.playOffset;
    if (!p || (!p.x && !p.y && !p.z)) return out;
    const g = m.bot.group;
    return out.add(_sp[5].copy(p).multiplyScalar(m.scale).applyQuaternion(g.quaternion));
  }

  /** A world point in member m's group space (the space its head's glance points are in). */
  toLocal(m, world, out) {
    const g = m.bot.group;
    out.copy(world).sub(g.position);
    if (g.quaternion.x || g.quaternion.y || g.quaternion.z) out.applyQuaternion(_q.copy(g.quaternion).invert());
    return out.divideScalar(m.scale);
  }

  // ---------------------------------------------------------------- lyric cues (StoryCues)

  /**
   * A line starts (main.js stage()): every bot it names but the singer reacts once as the voice comes in
   * (CARD_LEAD after the card), one after another: its hand cue (wave, clap, palm, loveyou) or its face
   * act (a nod by default, a nod too when its act will not play), and it and the singer glance at each other.
   */
  reactToCues(cues, singer, bots) {
    let k = 0;
    for (const { name, act } of cues ?? []) {
      const b = bots?.get?.(name);
      if (!b || b === singer) continue;
      const m = this.member(b);
      const s = singer ? this.member(singer) : null;
      this.after(CARD_LEAD + 0.15 * k++, () => {
        if (m.play && !m.play.down) this.windDown(m.play, 'cue');
        const hands = act && HAND_CUES.has(act);
        let shown = hands ? `hands:${act}` : act ?? DEFAULT_ACT;
        let played = hands ? playGesture(b, act) : playAct(b, act ?? DEFAULT_ACT);
        if (!played && act) {
          played = playAct(b, DEFAULT_ACT);
          shown = DEFAULT_ACT;
        }
        this.cancelLook(m);
        if (s) {
          this.look(m, s, 1.4, 0.6);
          m.busyUntil = Math.max(m.busyUntil, this.now + 1.4 + 1);
          this.look(s, m, 0.9);
        }
        this.note('cue', m, s, played ? shown : null);
      });
    }
  }

  // ---------------------------------------------------------------- consultations

  /**
   * A consultation (status consulting): `bot` goes over to the first bot it consults. The scene, timed to
   * fit the event (its line, about 4 s): the visitor's head goes over and the host leans in, the two face
   * each other; an exchange (the visitor's idea, the host's answer, a raised brow); agreement (both nod,
   * or they shake on it: plays/index.js startPlay('handshake')); back to their places. The other bots
   * consulted look over and nod along.
   */
  consult(bot, others) {
    const list = (others ?? []).filter((o) => o && o !== bot);
    if (!bot || !list.length) return null;
    const a = this.member(bot), b = this.member(list[0]);
    const extra = list.slice(1).map((o) => this.member(o));
    for (const m of [a, b, ...extra]) {
      if (m.scene) this.endScene(m.scene);
      if (m.play && !m.play.down) this.windDown(m.play, 'consult');
      this.cancelLook(m);
    }
    const left = bot.singing > 0 ? bot.singing : 4;
    const dur = Math.min(4.5, Math.max(3, left + 0.2));
    bot.consult?.(list[0], dur);
    const handsFree = !bot._hand && !list[0]._hand;
    const s = { a, b, extra, t: 0, dur, k: dur / 4, beat: 0, home: false, met: false, agree: handsFree && a.rand() < 0.5 ? 'shake' : 'nod',
      dir: new V3(), goalA: new V3(), goalB: new V3(), placeA: new V3(), placeB: new V3() };
    a.scene = b.scene = s;
    a.travel = CONSULT_TRAVEL;
    b.travel = CONSULT_HOST;
    this.scenes.push(s);
    this.note('consult', a, b, s.agree);
    return s;
  }

  /**
   * A sung consultation (the making-of's duet, making-of-score.js): the visitor glides over to the host (its
   * place, bot.home, moves beside the host's, toward the viewer, for the scene: the blocking walks it there), the
   * two face each other while the question and the answer are sung (the seal, a hand play, is staged by its own
   * event), and `until` seconds from now the visitor goes back to its place. A duet of the same two that is on
   * already just lasts longer (the answer, a chained question).
   */
  duet(visitor, host, until = 8) {
    if (!visitor || !host || visitor === host) return null;
    const a = this.member(visitor), b = this.member(host);
    const same = a.scene && a.scene === b.scene && a.scene.kind === 'duet' ? a.scene : null;
    if (same) {
      same.until = Math.max(same.until, same.t + until);
      return same;
    }
    for (const m of [a, b]) {
      if (m.scene) this.endScene(m.scene);
      if (m.play && !m.play.down) this.windDown(m.play, 'consult');
      this.cancelLook(m);
    }
    // the meeting place: in front of the row (the duet steps out to sing): the host a step toward the viewer, the
    // visitor beside it on its own side (nobody in the row behind them is hidden, nobody is walked into)
    const hp = host.home, vp = visitor.home;
    const side = _a.set(vp.x - hp.x, 0, vp.z - hp.z);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const fwd = _b.copy(visitor.viewer ?? _c.set(0, 1.6, 7)).sub(hp).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();
    const gap = a.r + b.r;
    const front = hp.clone().addScaledVector(fwd, DUET_FRONT);
    const meet = front.clone().addScaledVector(side, gap * DUET_APART); // (room between them for each one's card)
    const s = { kind: 'duet', a, b, extra: [], t: 0, until, home0: vp.clone(), meet, hostHome0: hp.clone(), front, looked: -1, back: false, dir: new V3(), agree: 'sing' };
    visitor.home.copy(meet);
    visitor.walkTo(meet, { face: 0 });
    host.home.copy(front);
    host.walkTo(front, { face: 0 });
    a.scene = b.scene = s;
    this.scenes.push(s);
    this.note('duet', a, b);
    return s;
  }

  /** The duet of these two goes on at least `until` more seconds (the answer, the seal); none on: nothing. */
  duetHold(bot, other, until = 0) {
    const a = this.members.get(bot), b = this.members.get(other);
    const s = a?.scene && a.scene === b?.scene && a.scene.kind === 'duet' ? a.scene : null;
    if (s) s.until = Math.max(s.until, s.t + until);
    return s;
  }

  stepDuet(s, dt) {
    void dt;
    const { a, b } = s;
    // the two face each other (the looks renewed while the scene lasts), leaning in a little
    if (s.t - s.looked >= 1.5) {
      s.looked = s.t;
      this.look(a, b, 1.9, CONSULT_TURN);
      this.look(b, a, 1.9, CONSULT_TURN);
    }
    s.dir.copy(b.place).sub(a.place).setY(0);
    if (s.dir.lengthSq() > 1e-8) {
      this.lean(a, s.dir, 0.08, 6);
      this.lean(b, _c.copy(s.dir).negate(), 0.06, 6);
    }
    if (s.t >= s.until) this.endScene(s);
  }

  /** The two of a duet go back to their places (unless a place was set anew meanwhile: a cut, the premiere). */
  duetHome(s) {
    if (s.back) return;
    s.back = true;
    for (const [bot, at, home] of [[s.a.bot, s.meet, s.home0], [s.b.bot, s.front, s.hostHome0]]) {
      if (bot.home.distanceToSquared(at) > 1e-6) continue;
      bot.home.copy(home);
      bot.walkTo(home, { face: 0 });
    }
  }

  /**
   * Where the two heads of a consultation meet (offsets off their places): the visitor goes most of the
   * way, the host comes to meet it; each to an open spot (no third head there), else as near as it gets.
   */
  meeting(s) {
    const { a, b } = s;
    const d = _a.copy(b.place).sub(a.place);
    const dist = d.length();
    s.goalA.set(0, 0, 0);
    s.goalB.set(0, 0, 0);
    if (dist < 1e-5) return;
    const n = s.dir.copy(d.divideScalar(dist));
    const close = Math.max(0, dist - CONSULT_GAP * (a.r + b.r));
    // toward the viewer (level): a way round the heads in between, and the side the camera sees
    const fwd = _b.copy(a.bot.viewer ?? _c.set(0, 1.6, 7)).sub(_c.copy(a.place).add(b.place).multiplyScalar(0.5)).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();
    this.openGoal(a, s.goalA.copy(n).multiplyScalar(Math.min(CONSULT_TRAVEL * a.r, close * 0.6)), b, fwd);
    // the host only steps out toward the viewer to meet it (else it stays, leaning and turning to it)
    this.openGoal(b, s.goalB.copy(n).multiplyScalar(-Math.min(CONSULT_HOST * b.r, close * 0.4)), a, fwd, true);
    s.placeA.copy(a.place);
    s.placeB.copy(b.place);
  }

  stepScene(s, dt) {
    s.t += dt;
    if (s.kind === 'duet') return this.stepDuet(s, dt);
    const { a, b } = s;
    const t = s.t / s.k; // the script's time (as for a 4 s scene)
    if (!s.home) {
      // the visitor goes over, the host comes to meet it (again when either place has moved)
      if (!s.met || s.placeA.distanceToSquared(a.place) > 0.0025 || s.placeB.distanceToSquared(b.place) > 0.0025) {
        this.meeting(s);
        s.met = true;
      }
      this.go(a, s.goalA, 5.5, 0.9);
      this.lean(a, s.dir, 0.1, 6);
      if (t >= 0.2) {
        this.go(b, s.goalB, 5, 0.9);
        this.lean(b, _c.copy(s.dir).negate(), 0.07, 6);
      }
    }
    const beats = [
      [0, () => {
        this.look(a, b, s.dur - 0.4, CONSULT_TURN);
        for (const m of s.extra) if (!m.singing) this.look(m, a, 1.6);
      }],
      [0.2, () => this.look(b, a, s.dur - 0.8, CONSULT_TURN)],
      [0.6, () => this.sceneAct(s, a, a.pick([...a.prof.exchangeActs, 'browlift']), 'idea')],
      [1.1, () => this.sceneAct(s, b, b.pick(b.prof.returnActs), 'answer')],
      [1.6, () => this.sceneAct(s, a, 'browlift', 'agreed?')],
      [2.0, () => {
        if (s.agree === 'shake' && this.canShake(s)) {
          startPlay('handshake', a.bot, [b.bot], { time: this.song, beatSec: BEAT });
          this.note('handshake', a, b);
        } else s.agree = 'nod';
        this.sceneAct(s, b, 'nod', 'agree');
        for (const m of s.extra) if (!m.singing && !m.play) this.act(m, 'nod');
      }],
      [2.15, () => this.sceneAct(s, a, 'nod', 'agree')],
      [3.25, () => {
        s.home = true;
        this.home(a, 5, 0.9);
        this.home(b, 5, 0.9);
      }],
      [4, () => this.endScene(s)],
    ];
    while (s.beat < beats.length && t >= beats[s.beat][0] && this.scenes.includes(s)) beats[s.beat++][1]();
  }

  /**
   * They can shake on it: both heads within a hand's reach of the point between the two bots (where a
   * handshake's hands meet), none of them busy with another meeting of hands. Else they agree with a nod.
   */
  canShake(s) {
    const { a, b } = s;
    if (a.bot._hand || b.bot._hand) return false;
    const mid = _a.copy(a.place).add(b.place).multiplyScalar(0.5);
    return this.pos(a, _b).distanceTo(mid) <= SHAKE_REACH * a.r && this.pos(b, _c).distanceTo(mid) <= SHAKE_REACH * b.r;
  }

  sceneAct(s, m, name, step) {
    const ok = this.act(m, name);
    this.note(step, m, m === s.a ? s.b : s.a, ok ? name : null);
  }

  endScene(s) {
    const i = this.scenes.indexOf(s);
    if (i < 0) return;
    this.scenes.splice(i, 1);
    if (s.kind === 'duet') this.duetHome(s);
    for (const m of [s.a, s.b]) {
      if (m.scene === s) m.scene = null;
      // the pair touched on purpose: they stay partners while they part (half a second), so the swarm does not
      // shove two heads that are still in contact from the scene
      m.parting = { with: m === s.a ? s.b : s.a, until: this.now + PARTING };
      this.home(m, 5, 0.9); // (its reach stays the scene's until it is back: integrate())
      m.restUntil = Math.max(m.restUntil, this.now + 2);
      m.busyUntil = Math.max(m.busyUntil, this.now + 1);
      if (m.lookTo === (m === s.a ? s.b : s.a)) this.unlook(m);
    }
    s.a.bot.consultWith = null;
    this.note('consulted', s.a, s.b);
  }

  /** m's head at offset `off` keeps clear of every head but `partner`'s (as clear as at its place, at least). */
  openAt(m, off, partner) {
    const p = _cg[0].copy(m.place).add(off);
    for (const k of this.list) {
      if (k === m || k === partner) continue;
      const need = (m.r + k.r) * CLEAR_MARGIN;
      if (p.distanceTo(this.pos(k, _cg[1])) < Math.min(need, m.place.distanceTo(k.place))) return false;
    }
    return true;
  }

  /**
   * An open spot for m's head near `goal` (an offset off its place, changed in place): the goal itself,
   * else the nearest of a few ways round the heads in the way (toward the viewer, aside, then up; only
   * toward the viewer when `forwardOnly`), else a share of the way, else none. Within its reach (m.travel radii).
   */
  openGoal(m, goal, partner, fwd, forwardOnly = false) {
    const cap = m.travel * m.r;
    const fit = (v) => (v.lengthSq() > cap * cap ? v.setLength(cap) : v);
    if (this.openAt(m, fit(goal), partner)) return goal;
    const side = _cg[2].copy(goal).cross(UP);
    if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
    side.normalize();
    const want = _cg[3].copy(goal);
    const dirs = forwardOnly ? [fwd] : [fwd, side, _cg[5].copy(side).negate(), _cg[4].copy(fwd).add(UP).normalize(), UP];
    for (const k of [0.7, 1.4, 2.1]) {
      for (const dir of dirs) {
        const c = fit(_cg[6].copy(want).addScaledVector(dir, k * m.r));
        if (this.openAt(m, c, partner)) return goal.copy(c);
      }
    }
    for (const f of [0.75, 0.5, 0.25]) if (this.openAt(m, _cg[6].copy(want).multiplyScalar(f), partner)) return goal.copy(_cg[6]);
    return goal.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- plays (ChoirPlay)

  /** Free to join a play: in no play or consultation, not on its line, nothing pending, rested, at its place. */
  canPlay(m) {
    return !m.play && !m.scene && !m.singing && !m.pendingTo && this.now >= m.restUntil && !m.moving && m.speed < SETTLED
      && !m.bot._hand && m.quietFor >= 1;
  }

  stepPlays() {
    for (const p of this.plays) {
      if (!p.down && !this.intact(p)) this.windDown(p, 'cancel');
      this.fireReactions(p);
      if (!p.down) {
        this[`step_${p.kind}`](p, this.now - p.phaseAt);
        if (!p.down && this.now - p.start > MAX_PLAY_SECONDS) this.windDown(p, 'timeout');
      }
      if (p.down && ((p.cast.every((m) => !m.moving) && !p.reacting) || this.now - p.downAt > MAX_WIND_DOWN)) this.finish(p);
    }
    if (this.plays.some((p) => p.over)) this.plays = this.plays.filter((p) => !p.over);
    if (this.now < this.nextPlayAt || this.now < CALM || this.plays.length >= MAX_PLAYS || this.scenes.length) return;
    const free = this.list.filter((m) => this.canPlay(m)).length;
    if (free > 1 && this.tryStart()) this.nextPlayAt = this.now + this.between(PLAY_GAP[0], PLAY_GAP[1]) * (free < 3 ? 1.8 : free < 6 ? 1.3 : 1);
    else this.nextPlayAt = this.now + this.between(0.8, 1.6);
  }

  /** Everyone in it is still free of its line, a consultation and its blocking (not walking). */
  intact(p) {
    return p.cast.every((m) => !m.singing && !m.scene && m.speed < SETTLED);
  }

  /** A starter (as keen as its personality), then a play it likes that it can cast with its neighbours. */
  tryStart() {
    const zest = (m) => (this.canPlay(m) ? PLAY_KINDS.reduce((s, k) => s + m.prof.plays[k], 0) : 0);
    const total = this.list.reduce((s, m) => s + zest(m), 0);
    if (total <= 0) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let r = this.rand() * total, starter = null;
      for (const m of this.list) {
        const z = zest(m);
        if (z <= 0) continue;
        starter = m;
        r -= z;
        if (r <= 0) break;
      }
      if (!starter) return false;
      const w = { ...starter.prof.plays };
      for (let tries = 0; tries < PLAY_KINDS.length; tries++) {
        let sum = 0;
        for (const k of PLAY_KINDS) sum += w[k];
        if (sum <= 0) break;
        let x = this.rand() * sum, kind = null;
        for (const k of PLAY_KINDS) {
          if (w[k] <= 0) continue;
          kind = k;
          x -= w[k];
          if (x <= 0) break;
        }
        const p = this[`cast_${kind}`](starter);
        if (p) {
          this.begin(p);
          return true;
        }
        w[kind] = 0;
      }
    }
    return false;
  }

  begin(p) {
    p.start = p.phaseAt = this.now;
    for (const m of p.cast) m.play = p;
    this.plays.push(p);
    this.note(`${p.kind}:start`, p.cast[0], p.cast[1] ?? null);
  }

  next(p, phase) {
    p.phase = phase;
    p.phaseAt = this.now;
  }

  /** Member k (of the cast) looks at `to` for `look` s and plays one of `acts` at `at` (an earlier one due stays). */
  react(p, k, at, acts, step, to = null, look = 0) {
    const cur = p.reactions[k];
    if (k < 0 || k >= p.cast.length || (cur && cur.at <= at)) return;
    p.reactions[k] = { at, acts, step, to, look };
  }

  fireReactions(p) {
    p.cast.forEach((m, k) => {
      const r = p.reactions[k];
      if (!r || this.now < r.at) return;
      p.reactions[k] = null;
      if (r.to && r.look > 0) this.look(m, r.to, r.look);
      this.actFrom(p, m, r.acts, r.step, r.to);
    });
  }

  actFrom(p, m, acts, step, other = null) {
    const name = m.pick(acts);
    const ok = this.act(m, name);
    this.note(`${p.kind}:${step}`, m, other, ok ? name : null);
  }

  windDown(p, why) {
    if (p.down) return;
    p.down = true;
    p.downAt = this.now;
    if (why) {
      p.reactions.fill(null);
      this.note(`${p.kind}:${why}`, p.cast[0]);
    }
    for (const m of p.cast) if (m.goal.lengthSq() > 0 || m.leanGoal.lengthSq() > 0) this.home(m);
  }

  done(p) {
    this.windDown(p, null);
  }

  finish(p) {
    p.over = true;
    for (const m of p.cast) {
      if (m.play === p) m.play = null;
      m.restUntil = this.now + PLAY_REST * m.between(0.8, 1.2);
    }
    this.note(`${p.kind}:end`, p.cast[0]);
  }

  giveUp(p) {
    this.note(`${p.kind}:miss`, p.cast[0], p.cast[1] ?? null);
    for (const m of p.cast) this.home(m);
    this.done(p);
  }

  touching(a, b) {
    return this.pos(a, _to[0]).distanceTo(this.pos(b, _to[1])) <= TOUCH * (a.r + b.r);
  }

  /** Head m can go straight from `from` to `to` (offsets) without nearing a head but the skipped ones. */
  clear(m, from, to, skipA = null, skipB = null, skipCast = null) {
    const A = _cl[0].copy(m.place).add(from), B = _cl[1].copy(m.place).add(to);
    const ab = _cl[2].copy(B).sub(A), len2 = ab.lengthSq();
    for (const k of this.list) {
      if (k === m || k === skipA || k === skipB || skipCast?.includes(k)) continue;
      const c = this.pos(k, _cl[3]);
      let need = (m.r + k.r) * CLEAR_MARGIN;
      const start = A.distanceTo(c);
      if (start < need) need = start;
      const t = len2 > 1e-12 ? clamp01(_cl[4].copy(c).sub(A).dot(ab) / len2) : 0;
      if (_cl[4].copy(A).addScaledVector(ab, t).distanceTo(c) < need - 1e-6) return false;
    }
    return true;
  }

  /** A bump: it drifts into its nearest neighbour (or both into each other); they touch, recoil and react. */
  cast_bump(a) {
    const ra = a.r;
    for (const b of this.gather(a, NEIGHBOR_REACH)) {
      if (!this.canPlay(b)) continue;
      const rb = b.r;
      const d = _a.copy(b.place).sub(a.place), dist = d.length();
      const need = dist - TOUCH * (ra + rb);
      if (dist < 1e-5 || need < 0.1 * ra) continue;
      const n = d.divideScalar(dist).clone();
      const alone = need <= REACH * ra, both = b.prof.move >= STILL_MOVE && need * 0.5 <= REACH * Math.min(ra, rb);
      if (!alone && !both) continue;
      const p = new Play('bump', [a, b]);
      p.dir.copy(n);
      p.mutual = both && (!alone || (b.prof.back >= 0.3 && this.rand() < 0.5));
      if (p.mutual) {
        p.goal = [n.clone().multiplyScalar(Math.min(need * 0.5 + OVERSHOOT * ra, MAX_TRAVEL * ra)), n.clone().multiplyScalar(-Math.min(need * 0.5 + OVERSHOOT * rb, MAX_TRAVEL * rb))];
        if (!this.clear(a, ZERO, p.goal[0], b) || !this.clear(b, ZERO, p.goal[1], a)) continue;
      } else {
        p.goal = [n.clone().multiplyScalar(Math.min(need + OVERSHOOT * ra, MAX_TRAVEL * ra)), new V3()];
        if (!this.clear(a, ZERO, p.goal[0], b)) continue;
      }
      p.aimBack.copy(n).multiplyScalar(-Math.min(need + OVERSHOOT * rb, MAX_TRAVEL * rb));
      p.answer = need <= REACH * rb && b.prof.move >= STILL_MOVE && b.rand() < b.prof.back && this.clear(b, ZERO, p.aimBack, a);
      return p;
    }
    return null;
  }

  step_bump(p, t) {
    const [a, b] = p.cast;
    switch (p.phase) {
      case 0: // it eyes its neighbour, up to something
        this.look(a, b, 2.4);
        this.actFrom(p, a, a.prof.mischief, 'mischief', b);
        this.next(p, 1);
        break;
      case 1: // the neighbour sees it coming; off they drift
        if (t < 0.4) break;
        this.look(b, a, 1.8);
        this.go(a, p.goal[0], DRIFT);
        if (p.mutual) this.go(b, p.goal[1], DRIFT);
        this.next(p, 2);
        break;
      case 2: // they touch: both recoil and react, the bumper amused, the bumped one startled
        if (this.touching(a, b)) {
          this.collide(p, a, b);
          this.react(p, 0, this.now + 0.08, a.prof.giggle, 'giggle', b, 1.4);
          this.react(p, 1, this.now + 0.2, b.prof.startle, 'startle', a, 1.6);
          this.next(p, 3);
        } else if (t > 1.6) this.giveUp(p);
        break;
      case 3: // the bumped one answers: a bump back, or a giggle
        if (t < 1) break;
        if (p.answer) {
          this.look(b, a, 1.8);
          this.go(b, p.aimBack, DRIFT);
          this.next(p, 4);
        } else {
          this.react(p, 1, this.now, b.prof.giggle, 'answer', a, 1.2);
          this.done(p);
        }
        break;
      case 4: // the bump back
        if (this.touching(a, b)) {
          this.collide(p, b, a);
          this.react(p, 1, this.now + 0.08, b.prof.giggle, 'answer', a, 1.2);
          this.react(p, 0, this.now + 0.2, a.prof.startle, 'startle', b, 1.4);
          this.done(p);
        } else if (t > 1.6) this.giveUp(p);
        break;
    }
  }

  /** A poke: it leans in and jabs its neighbour once or twice (its head, or a tap of its antenna). */
  cast_poke(a) {
    const ra = a.r, cap = MAX_TRAVEL * ra;
    for (const b of this.gather(a, NEIGHBOR_REACH)) {
      if (!this.canPlay(b)) continue;
      const rb = b.r;
      const d = _a.copy(b.place).sub(a.place), dist = d.length();
      if (dist < 1e-5) continue;
      const n = d.divideScalar(dist).clone();
      const touch = dist - TOUCH * (ra + rb); // the head's travel to the touch
      if (touch < 0.15 * ra) continue;
      const head = touch + JAB_PAST * ra <= cap;
      const lean = Math.min(Math.max(0, touch - LEAN_GAP * ra), 1.2 * ra);
      const antenna = a.antenna && dist - (ra + rb) - lean - 0.15 * ra <= ANTENNA_REACH * ra;
      if (!head && !antenna) continue;
      const p = new Play('poke', [a, b]);
      p.dir.copy(n);
      p.antenna = !head || (antenna && this.rand() < 0.4);
      p.goal = [n.clone().multiplyScalar(lean), n.clone().multiplyScalar(-Math.min(Math.max(0, touch - LEAN_GAP * rb), 1.2 * rb))];
      if (p.antenna) p.aim.copy(p.goal[0]).addScaledVector(n, 0.15 * ra);
      else p.aim.copy(n).multiplyScalar(touch + JAB_PAST * ra);
      if (!this.clear(a, ZERO, p.aim, b)) continue;
      p.jabs = 1 + (a.rand() < 0.5 ? 1 : 0) + (a.prof.move > 1.15 && a.rand() < 0.35 ? 1 : 0);
      // the poked one may poke back (with its head)
      p.aimBack.copy(n).multiplyScalar(-(touch + JAB_PAST * rb));
      p.answer = touch + JAB_PAST * rb <= MAX_TRAVEL * rb && b.prof.move >= STILL_MOVE && b.rand() < b.prof.back && this.clear(b, ZERO, p.aimBack, a);
      return p;
    }
    return null;
  }

  step_poke(p, t) {
    const [a, b] = p.cast;
    const n = p.dir;
    switch (p.phase) {
      case 0: // it eyes its neighbour, up to something
        this.look(a, b, 3);
        this.actFrom(p, a, a.prof.mischief, 'mischief', b);
        this.next(p, 1);
        break;
      case 1: // it leans in
        if (t < 0.3) break;
        this.go(a, p.goal[0], 7);
        this.lean(a, n, 0.12, 8);
        this.next(p, 2);
        break;
      case 2: // a jab: the head to the touch, or the antenna tipped over
        if (t < (p.stage[0] === 0 ? 0.45 : 0.12)) break;
        if (p.antenna) {
          this.go(a, p.aim, 14);
          this.lean(a, n, 0.45, 22);
        } else this.go(a, p.aim, 20, 0.9);
        this.next(p, 3);
        break;
      case 3: // it lands: the poked one jolts (and, the first time, startles)
        if (p.antenna ? t < 0.14 : t < 0.3 && !this.touching(a, b)) break;
        this.knocked(p, b, n, a, p.antenna ? 'tap' : 'jab', p.stage[0] === 0);
        this.go(a, p.goal[0], 12);
        this.lean(a, n, 0.12, 12);
        p.stage[0]++;
        this.next(p, p.stage[0] < p.jabs ? 2 : 4);
        break;
      case 4: // it sits back, pleased with itself
        if (t < 0.3) break;
        this.home(a, 6, 0.9);
        this.react(p, 0, this.now + 0.15, a.prof.giggle, 'giggle', b, 1.2);
        this.next(p, 5);
        break;
      case 5: // the poked one answers: it pokes back, or giggles
        if (t < 0.45) break;
        if (p.answer) {
          this.look(b, a, 2.5);
          this.go(b, p.goal[1], 7);
          this.lean(b, _a.copy(n).negate(), 0.12, 8);
          this.next(p, 7);
        } else {
          this.react(p, 1, this.now, b.prof.giggle, 'answer', a, 1.4);
          this.done(p);
        }
        break;
      case 7: // the poke back
        if (t < 0.45) break;
        this.go(b, p.aimBack, 20, 0.9);
        this.next(p, 8);
        break;
      case 8:
        if (t < 0.3 && !this.touching(a, b)) break;
        this.knocked(p, a, _a.copy(n).negate(), b, 'jab', true);
        this.home(b, 6, 0.9);
        this.react(p, 1, this.now + 0.3, b.prof.giggle, 'giggle', a, 1.2);
        this.done(p);
        break;
    }
  }

  /** A row of three to five neighbours (each next to one already in), ranked left to right as the viewer sees them. */
  castRow(first, kind) {
    const cast = [first], refused = new Set();
    while (cast.length < 5) {
      let best = null, bestD = Infinity;
      for (const c of cast) {
        for (const m of this.gather(c, NEIGHBOR_REACH)) {
          const d = c.place.distanceTo(m.place);
          if (d >= bestD) break;
          if (cast.includes(m) || refused.has(m) || !this.canPlay(m)) continue;
          best = m;
          bestD = d;
          break;
        }
      }
      if (!best) break;
      if (!(best.rand() < clamp01(best.prof.move * 1.1))) refused.add(best); // the stiller, the less likely to join
      else cast.push(best);
    }
    if (cast.length < 3) return null;
    const p = new Play(kind, cast);
    p.right.copy(this.right);
    const x = cast.map((m, c) => ({ c, x: m.place.dot(p.right) })).sort((u, v) => u.x - v.x || u.c - v.c);
    x.forEach(({ c }, rank) => {
      p.rank[c] = rank;
      p.order[rank] = c;
    });
    for (let c = 0; c < cast.length; c++) {
      const m = cast[c], move = Math.min(1, m.prof.move);
      if (kind === 'wave') {
        p.size[c] = 0.45 * m.r * Math.min(1.1, m.prof.move);
        if (!this.clear(m, ZERO, _a.copy(UP).multiplyScalar(p.size[c]))) return null;
      } else {
        // they sway together: only the heads outside the row can be in the way
        p.size[c] = 0.28 * m.r * move;
        p.tip[c] = 0.1 * move;
        if (!this.clear(m, _a.copy(p.right).multiplyScalar(-p.size[c]), _b.copy(p.right).multiplyScalar(p.size[c]), null, null, cast)) return null;
      }
    }
    if (kind === 'sway') {
      p.period = Math.min(2.2, Math.max(1.1, BAR)); // left and back in a bar of the song
      p.cycles = this.rand() < 0.5 ? 2 : 3;
    }
    return p;
  }

  cast_sway(a) {
    return this.castRow(a, 'sway');
  }

  cast_wave(a) {
    return this.castRow(a, 'wave');
  }

  /** Seconds from now to the song's next bar line (or beat) at least `lead` s away. */
  untilGrid(grid, lead) {
    return Math.ceil((this.song + lead) / grid - 1e-9) * grid - this.song;
  }

  step_sway(p) {
    const c0 = p.cast[0];
    switch (p.phase) {
      case 0:
        if (p.focus) p.cast.forEach((m, c) => this.react(p, c, this.now + 0.15 + 0.2 * c, null, 'listen', p.focus, 2.2)); // the song's listeners
        else {
          this.actFrom(p, c0, c0.prof.mischief, 'mischief');
          this.look(c0, p.cast[1], 1.2);
        }
        p.t0 = this.now + this.untilGrid(BAR, 0.45); // together, on the next bar line
        this.next(p, 1);
        break;
      case 1:
        if (this.now < p.t0) break;
        p.cast.forEach((m, c) => {
          this.note('sway:sway', m, c > 0 ? c0 : null);
          if (c === 0 || m.rand() < 0.5) this.react(p, c, this.now + p.period * 0.6 + 0.25 * c, m.prof.giggle, 'giggle');
        });
        this.next(p, 2);
        break;
      case 2: { // to the right on the bar's downbeat, to the left on its third beat, easing in and out
        const u = this.now - p.t0, total = p.cycles * p.period;
        const env = smooth(Math.min(u / 0.6, (total - u) / 0.6));
        const w = Math.cos((2 * Math.PI * u) / p.period) * env;
        p.cast.forEach((m, c) => {
          this.go(m, _a.copy(p.right).multiplyScalar(p.size[c] * w), 14);
          this.leanBy(m, _b.copy(p.right).multiplyScalar(p.tip[c] * w), 14);
        });
        if (u >= total) {
          for (const m of p.cast) this.home(m, 7, 1);
          this.done(p);
        }
        break;
      }
    }
  }

  step_wave(p) {
    const c0 = p.cast[0];
    if (p.phase === 0) {
      this.actFrom(p, c0, c0.prof.mischief, 'mischief');
      // a hop ripples out from the one that starts it, an eighth note apart, from the next beat
      const t0 = this.now + this.untilGrid(BEAT, 0.35);
      p.cast.forEach((m, c) => {
        p.due[c] = t0 + (BEAT / 2) * Math.abs(p.rank[c] - p.rank[0]);
      });
      this.next(p, 1);
      return;
    }
    let all = true;
    p.cast.forEach((m, c) => {
      if (p.stage[c] === 0 && this.now >= p.due[c]) {
        this.go(m, _a.copy(UP).multiplyScalar(p.size[c]), 13);
        const before = this.before(p, c);
        if (before >= 0) this.look(m, p.cast[before], 0.9);
        this.note('wave:hop', m, before >= 0 ? p.cast[before] : null);
        p.stage[c] = 1;
        p.due[c] = this.now + 0.2;
      } else if (p.stage[c] === 1 && this.now >= p.due[c]) {
        this.home(m, 9, 0.5); // a springy landing
        p.stage[c] = 2;
        p.due[c] = this.now + 0.22;
      } else if (p.stage[c] === 2 && this.now >= p.due[c]) {
        this.jolt(m, _a.copy(UP).multiplyScalar(-1.2 * m.r));
        if (m.rand() < 0.6) this.actFrom(p, m, m.prof.giggle, 'giggle');
        p.stage[c] = 3;
      }
      if (p.stage[c] < 3) all = false;
    });
    if (all) this.done(p);
  }

  /** The member next to member c on the side of the one that started the wave (-1 for the starter). */
  before(p, c) {
    const r = p.rank[c], r0 = p.rank[0];
    return r === r0 ? -1 : p.order[r > r0 ? r - 1 : r + 1];
  }

  /** Two heads touch: the mover bounces back, the other is knocked away; both wobble and spring back. */
  collide(p, mover, other) {
    const d = this.pos(other, _a).sub(this.pos(mover, _b));
    const dist = d.length();
    const n = dist > 1e-6 ? d.divideScalar(dist) : d.copy(p.dir);
    const rm = mover.r, ro = other.r;
    const closing = Math.max(0, _c.copy(mover.v).sub(other.v).dot(n));
    this.knock(mover, _d.copy(n).multiplyScalar(-Math.max(0.45 * closing, 0.8 * rm)), 6, 0.55);
    this.knock(other, _d.copy(n).multiplyScalar(Math.max(0.8 * closing, 1.2 * ro)), 6.5, 0.55);
    this.jolt(mover, _d.copy(n).multiplyScalar(-2.5 * rm));
    this.jolt(other, _d.copy(n).multiplyScalar(3.5 * ro));
    this.note(`${p.kind}:touch`, mover, other);
  }

  /** `who` is poked along n by `by`: it jolts, is knocked a little off its place, and (react) startles and turns to it. */
  knocked(p, who, n, by, step, react) {
    const r = who.r;
    this.jolt(who, _d.copy(n).multiplyScalar(3 * r));
    this.knock(who, _d.copy(n).multiplyScalar(1.1 * r), 8, 0.6);
    if (react) this.react(p, p.cast.indexOf(who), this.now + 0.12, who.prof.startle, 'startle', by, 2);
    this.note(`${p.kind}:${step}`, by, who);
  }

  // ---------------------------------------------------------------- the moves (springs, world units)

  go(m, goal, omega, zeta = 1) {
    const cap = m.travel * m.r;
    m.goal.copy(goal);
    if (m.goal.lengthSq() > cap * cap) m.goal.setLength(cap);
    m.omega = omega;
    m.zeta = zeta;
    m.moving = true;
  }

  home(m, omega = RETURN_OMEGA, zeta = RETURN_ZETA) {
    m.goal.set(0, 0, 0);
    m.leanGoal.set(0, 0, 0);
    if (!m.moving) return;
    m.omega = omega;
    m.zeta = zeta;
    m.leanOmega = Math.max(RETURN_OMEGA, omega);
  }

  lean(m, toward, angle, omega) {
    const t = _le.copy(toward).setY(0);
    const len = t.length();
    this.leanBy(m, len > 1e-6 ? t.multiplyScalar(angle / len) : t.set(0, 0, 0), omega);
  }

  leanBy(m, lean, omega) {
    m.leanGoal.copy(lean).setY(0);
    const a = m.leanGoal.length();
    if (a > MAX_LEAN) m.leanGoal.multiplyScalar(MAX_LEAN / a);
    m.leanOmega = omega;
    m.moving = true;
  }

  /** Knocked off at `velocity` (x its Move; in place of how it moved): it springs back to its place. */
  knock(m, velocity, omega, zeta) {
    m.v.copy(velocity).multiplyScalar(m.prof.move);
    m.goal.set(0, 0, 0);
    m.omega = omega;
    m.zeta = zeta;
    m.moving = true;
  }

  /** The head wobbles (a nudge on its float, x its Move). */
  jolt(m, velocity) {
    const v = _jo.copy(velocity).multiplyScalar(m.prof.move);
    const q = m.bot.group.quaternion;
    if (q.x || q.y || q.z) v.applyQuaternion(_q.copy(q).invert());
    m.bot.head?.nudge?.(v.divideScalar(m.scale));
  }

  /** Bots a and b are partners now (a consultation, a bump / poke between them): their heads may touch. */
  partnered(a, b) {
    const i = this.members.get(a), j = this.members.get(b);
    return !!i && !!j && this.partners(i, j);
  }

  partners(i, j) {
    if (i.scene && i.scene === j.scene) return true;
    // just after their scene: partners while their heads still touch (at most PARTING s), then the usual rules
    const part = i.parting?.with === j ? i.parting : j.parting?.with === i ? j.parting : null;
    if (part && this.now < part.until && this.pos(i, _pt[0]).distanceTo(this.pos(j, _pt[1])) < (i.r + j.r) * 1.02) return true;
    return !!i.play && i.play === j.play && i.play.touches(i, j);
  }

  integrate(dt) {
    const steps = dt > 0 ? Math.min(8, Math.ceil(dt / (1 / 90))) : 0;
    const h = steps > 0 ? dt / steps : 0;
    for (const m of this.list) {
      if (!m.moving) continue;
      const w2 = m.omega * m.omega, c = 2 * m.zeta * m.omega;
      const lw2 = m.leanOmega * m.leanOmega, lc = 1.8 * m.leanOmega;
      for (let k = 0; k < steps; k++) {
        m.v.x += ((m.goal.x - m.x.x) * w2 - m.v.x * c) * h;
        m.v.y += ((m.goal.y - m.x.y) * w2 - m.v.y * c) * h;
        m.v.z += ((m.goal.z - m.x.z) * w2 - m.v.z * c) * h;
        m.x.addScaledVector(m.v, h);
        m.leanV.x += ((m.leanGoal.x - m.lean.x) * lw2 - m.leanV.x * lc) * h;
        m.leanV.z += ((m.leanGoal.z - m.lean.z) * lw2 - m.leanV.z * lc) * h;
        m.lean.addScaledVector(m.leanV, h);
      }
    }
    // no head through another (only partners touch), none beyond its reach
    for (const m of this.list) {
      if (!m.moving) continue;
      this.separate(m, dt);
      const cap = m.travel * m.r, len = m.x.length();
      if (len > cap) {
        const dir = _sp[0].copy(m.x).divideScalar(len);
        m.x.copy(dir).multiplyScalar(cap);
        const out = m.v.dot(dir);
        if (out > 0) m.v.addScaledVector(dir, -out);
      }
    }
    for (const m of this.list) {
      if (!m.moving) {
        if (m.applied) this.apply(m);
        continue;
      }
      const r2 = m.r * m.r;
      if (m.goal.lengthSq() === 0 && m.leanGoal.lengthSq() === 0 && m.x.lengthSq() < 4e-6 * r2 && m.v.lengthSq() < 1e-4 * r2
        && m.lean.lengthSq() < 4e-6 && m.leanV.lengthSq() < 4e-4) {
        // back at its place: exactly
        m.x.set(0, 0, 0);
        m.v.set(0, 0, 0);
        m.lean.set(0, 0, 0);
        m.leanV.set(0, 0, 0);
        m.moving = false;
        if (!m.scene) m.travel = MAX_TRAVEL;
      }
      this.apply(m);
    }
  }

  /**
   * Keeps m's head out of the others' (as drawn, a hand play's move included): partners down to TOUCH_FLOOR, the rest
   * their radii apart, a little more (or as near as at their places).
   */
  separate(m, dt = 0) {
    for (const k of this.list) {
      if (k === m) continue;
      // the heads as drawn: a hand play's move of either head counts too (plays/: bot.playOffset)
      // ... where they are about to be (the bots glide on this frame after the acting: blocking.js, rig.js)
      const d = this.played(m, this.pos(m, _sp[0])).sub(this.played(k, this.pos(k, _sp[1])));
      const va = m.bot.vel, vb = k.bot.vel;
      if (dt > 0 && va && vb) d.x += (va.x - vb.x) * dt, d.z += (va.z - vb.z) * dt;
      const dist = d.length();
      let min = (m.r + k.r) * (this.partners(m, k) ? TOUCH_FLOOR : CLEAR_MARGIN);
      const apart = this.played(m, _sp[3].copy(m.place)).distanceTo(this.played(k, _sp[4].copy(k.place)));
      if (apart < min) min = apart; // placed closer than that: never closer than at their places
      if (dist >= min) continue;
      const away = dist > 1e-6 ? d.divideScalar(dist) : apart > 1e-6 ? d.copy(m.place).sub(k.place).normalize() : d.copy(UP);
      m.x.addScaledVector(away, min - dist);
      const closing = _sp[2].copy(m.v).sub(k.v).dot(away);
      if (closing < 0) m.v.addScaledVector(away, -closing);
    }
  }

  /** Hands m's offset and lean to its head (in its group's space: the bot itself never moves). */
  apply(m) {
    const head = m.bot.head;
    if (!head?.setSocialOffset) return;
    const q = m.bot.group.quaternion;
    const rotated = q.x || q.y || q.z;
    const off = _ap[0].copy(m.x);
    const tilt = _ap[1].copy(m.lean);
    if (rotated) {
      _q.copy(q).invert();
      off.applyQuaternion(_q);
      tilt.applyQuaternion(_q);
    }
    head.setSocialOffset(off.divideScalar(m.scale), tilt);
    m.applied = m.moving;
  }
}


// ------------------------------------------------------------------ the stage's one instance

/** The acting of the show (main.js): one per page. */
export const acting = new Acting();
if (typeof window !== 'undefined') window.__mbActing = acting; // for the frame-exact capture tools

/** When a line starts: every bot it names (but the singer) reacts; cues from cues.js parseLyric. */
export function reactToCues(cues, singer, bots) {
  acting.reactToCues(cues, singer, bots);
}

/**
 * A consultation (status: consulting): bot goes over to the bots it consults, they agree, it comes back. duet (the
 * making-of's sung consultation, making-of-score.js): { visit: 'out' (bot goes over to others[0]) | 'in' (others[0]
 * comes over) | 'stay' (the duet on already goes on), until (s from now: the visitor goes home) }.
 */
export function consult(bot, others, duet = null) {
  if (duet) {
    const other = others?.find((o) => o && o !== bot);
    if (!other) return null;
    return duet.visit === 'in' ? acting.duet(other, bot, duet.until) : duet.visit === 'out' ? acting.duet(bot, other, duet.until)
      : acting.duetHold(bot, other, duet.until);
  }
  return acting.consult(bot, others);
}

/** Calls every duet off (its visitor goes home): the making-of ended (or was cancelled). */
export function endDuets() {
  for (const s of acting.scenes.slice()) if (s.kind === 'duet') acting.endScene(s);
}

/** Are bots a and b partners in the acting now (their heads may touch; the blocking's swarm leaves them be)? */
export function partnered(a, b) {
  return acting.partnered(a, b);
}

/** Per-frame update (before the bots' own): the choir's social life, the cue and consultation beats. ctx: { time } (the song's clock). */
export function updateActing(dt, bots, ctx = {}) {
  acting.update(dt, bots, ctx);
}
