// Where the bots are: the bots moving through the Blender sets (diner, big house, street) as heads +
// hands, and the making-of's crew formation in them: a set per beat (beats.json beats[].set), the beat's
// cast on set and the rest parked (a few extras in the background, the others off-set), entrances
// and exits through the set's doors, the singer coming forward to sing, the moves of actions.js
// MOVES (march, huddle, gather, enter, exit, walk-to-<mark|Bot>) and the lighting agent's cues
// (lights-<mood>, spot-<Bot>) handed to the stage (scene/environments/stage.js). The making-of (crew mode):
// the whole cast in the set's crew formation (making-of-score.js crewFormation), cut from set to set as the crew
// writes beat after beat (making-of-score.js CrewSets). The bare rows ('studio') are only what is left when no set
// could load (headless tests without a stage): no beat plays there.
// Deterministic for the frame-exact capture: no randomness, no wall clock; time is the sum of dt.
import * as THREE from 'three';
import { ringTargets } from './rig.js';
import { parseLyric } from './cues.js';
import { resolveAction } from './actions.js';
import {
  SETS, SET_NAMES, DEFAULT_SET, resolveSets, setsNeeded, setName, markOf, nearestEntrance, loopLength, loopPoint, loopNearest,
  normalizeName,
} from './scene/environments/sets.js';
import { obstaclesFromGroup, activeBoxes, planPath, pushOut } from './scene/environments/pathing.js';
import { steer, resolve, SWARM } from './swarm.js';
import { faceCover, viewsOf } from './staging.js';

/**
 * Angle along a row's half ellipse (radii rx, rz) for slot u (0..1): between even angles and even arc length (even
 * angles alone crowd the ends of a flat ellipse: the end heads overlapped).
 */
function rowAngle(u, rx, rz) {
  const N = 256;
  let len = 0;
  const acc = [0];
  for (let s = 1; s <= N; s++) {
    const a0 = ((s - 1) / N) * Math.PI, a1 = (s / N) * Math.PI;
    len += Math.hypot(rx * (Math.cos(a1) - Math.cos(a0)), rz * (Math.sin(a1) - Math.sin(a0)));
    acc.push(len);
  }
  let s = 0;
  while (s < N && acc[s + 1] < u * len) s++;
  const f = s < N && acc[s + 1] > acc[s] ? (u * len - acc[s]) / (acc[s + 1] - acc[s]) : 0;
  const even = Math.min(1, (s + f) / N) * Math.PI;
  return 0.4 * u * Math.PI + 0.6 * even - Math.PI;
}

/** Two-tier chorus rows (no set loaded: front low + wide, back high + tight), alternating cast; no two heads touch. */
export function studioHome(i) {
  const back = i % 2 === 1;
  const a = rowAngle(Math.floor(i / 2) / 7, back ? 2.6 : 3.0, 1.2);
  return back
    ? new THREE.Vector3(Math.cos(a) * 2.6, 1.55, Math.sin(a) * 1.2 - 1.2)
    : new THREE.Vector3(Math.cos(a) * 3.0, 0.75, Math.sin(a) * 1.2 + 0.5);
}

/**
 * The studio's rows for a beat (the premiere): its cast (`cast`: names, the singers first) in the middle of the front
 * row, the most central place first; the bots they stand in for take their places (a swap each), everyone else keeps
 * its own (studioHome). Returns the place of every bot, by its index in `names`. Pure.
 */
export function studioPlaces(names, cast) {
  const homes = names.map((_, i) => studioHome(i));
  const front = names.map((_, i) => i).filter((i) => i % 2 === 0)
    .sort((a, b) => Math.abs(homes[a].x) - Math.abs(homes[b].x) || a - b);
  const place = names.map((_, i) => i); // bot i stands at home place[i]
  let k = 0;
  for (const name of cast) {
    const i = names.indexOf(name);
    if (i < 0 || k >= front.length) continue;
    const want = front[k++], j = place.indexOf(want);
    [place[i], place[j]] = [place[j], place[i]];
  }
  return place.map((p) => homes[p].clone());
}

// a featured bot's spot, nearest first (ties: downstage, toward the audience, before upstage): offsets up to 0.9 m
const FEATURE_TRIES = (() => {
  const out = [];
  for (const dz of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.75, -0.75, 0.9, -0.9]) {
    for (const dx of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.75, -0.75, 0.9, -0.9]) out.push([dx, dz]);
  }
  return out.filter(([dx, dz]) => Math.hypot(dx, dz) <= 0.9 + 1e-9).sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
})();
const GATHER_SECTIONS = /^(intro|outro|chorus)/; // the whole cast together; other sections spread out
const ENTER_GAP = 0.35; // seconds between bots coming through a door
const ENTER_SPEED = 1.8; // m/s: a brisk entrance
const MARCH = { speed: 1.35, spacing: 1.15, length: 11, lineUp: 1.2 };
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _off = new THREE.Vector3(), _wish = new THREE.Vector3();
/** A featured spot hides (or is hidden) at most this share of a face from the audience's views (sightHidden). */
const SIGHT_OK = 0.15;
const QUIET_FACE = 0.4, WIDE_OWN = 0.5;

/**
 * How badly a head at p (radius r), a singer stepping forward, stands in the audience's sight among `faces` ([{ x, y, z,
 * r, sings, hums }]: the scene's heads where they rest, the singers' spots given; sings: a line now, hums: the backing).
 * Its own face: the largest share a nearer head hides, from straight in front of it (its close-up, staging.js viewsOf),
 * and WIDE_OWN as much from the set's wide cameras (a wide holds the whole scene: a face partly behind the front row
 * still reads there). The faces it hides: a line's singer from any of those views; the backing and a quiet face from
 * the wides only (an extra on a towel behind it is its close-up's background), the quiet one counting QUIET_FACE as
 * much (it may go partly behind a singer for the line, the rows a choir behind its soloist, not wholly: it may sing the
 * next line). 0: in clear sight. Pure.
 */
export function sightHidden(p, r, faces, def) {
  const [front, ...wides] = viewsOf(p, def.audience ?? [0, 8], def.camera?.wide ?? []);
  let worst = 0;
  for (const f of faces) {
    worst = Math.max(worst, faceCover(front, p, r, f, f.r), f.sings ? faceCover(front, f, f.r, p, r) : 0);
    const k = f.sings || f.hums ? 1 : QUIET_FACE;
    for (const e of wides) worst = Math.max(worst, faceCover(e, p, r, f, f.r) * WIDE_OWN, faceCover(e, f, f.r, p, r) * k);
  }
  return worst;
}

/**
 * How badly a head at rest at p (radius r) stands among the heads `placed` before it ([{ x, y, z, r }]): the largest share
 * of a face hidden, its own or one of theirs, from the set's wide cameras and from straight in front of either (a
 * close-up). 0: every face in clear sight. Pure.
 */
export function restHidden(p, r, placed, def) {
  const aud = def.audience ?? [0, 8], wides = def.camera?.wide ?? [];
  const [front, ...views] = viewsOf(p, aud, wides);
  let worst = 0;
  for (const f of placed) {
    const [theirs] = viewsOf(f, aud);
    worst = Math.max(worst, faceCover(front, p, r, f, f.r), faceCover(theirs, f, f.r, p, r));
    for (const e of views) worst = Math.max(worst, faceCover(e, p, r, f, f.r), faceCover(e, f, f.r, p, r));
  }
  return worst;
}

/** Two bots held by the same hand play (plays/stage.js bot.handPlay: its cast). */
const samePlay = (a, b) => !!a.handPlay && !!b.handPlay && (a.handPlay.cast ? a.handPlay.cast === b.handPlay.cast : a.handPlay.other === b || b.handPlay.other === a);

/** A small, stable hash (beat ids, names) for deterministic choices. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The bots a beat puts on set, in staging order: the singers of its lines first (the story's lines,
 * their harmony copies and `with`), then the beat's cast, the pal's replies, and the bots its lines
 * name, consult or cue. Backing parts (mouth only) are not the scene: their singers stay in the
 * background (backingOf).
 */
export function beatCast(beat, events, names) {
  const out = [];
  const known = new Set(names);
  const canon = (n) => names.find((k) => k.toLowerCase() === String(n ?? '').toLowerCase()) ?? null;
  const add = (n) => { const c = canon(n); if (c && known.has(c) && !out.includes(c)) out.push(c); };
  const lines = events.filter((e) => !e.part);
  for (const e of lines) {
    if (String(e.lyric ?? '').trim()) add(e.singer ?? e.bot);
    for (const w of e.with ?? []) add(w);
  }
  for (const n of beat?.cast ?? []) add(n);
  for (const e of events) if (e.part === 'reply' || e.part === 'echo') add(e.singer ?? e.bot);
  for (const e of lines) {
    for (const c of e.consult ?? []) add(c);
    for (const c of parseLyric(e.lyric, names).cues) add(c.name);
    const r = resolveAction(e.action);
    if ((r.kind === 'move' && r.id === 'walk-to') || (r.kind === 'light' && r.id === 'spot')) add(r.target);
  }
  // a v1 event without words still stages its bot (the making-of: the role bot at work)
  if (!out.length) for (const e of lines) add(e.singer ?? e.bot);
  return out;
}

/** The singers of a beat's backing parts (the arranger's bass, pads, sparkle...), in order. */
export function backingOf(events, names) {
  const out = [];
  for (const e of events) {
    if (e.part !== 'backing') continue;
    const n = names.find((k) => k === (e.singer ?? e.bot));
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export class Blocking {
  /**
   * bots: Map name -> Bot. stage (optional): the set visuals (scene/environments/stage.js: load,
   * show, mood, spot, update). override: the ?set= URL driver (one set for every beat).
   */
  constructor({ bots, scene, stage = null, override = null, contact = null }) {
    this.bots = bots;
    // pairs that may touch (no steering between them): a hand play's cast, plus the caller's (main.js: the acting's partners)
    // (not two on their way out: partners leaving the set together walk out one by one, never through each other)
    this.contact = (a, b) => samePlay(a, b) || (!!contact?.(a, b) && !(this.state.get(a)?.mode === 'leaving' && this.state.get(b)?.mode === 'leaving'));
    this.scene = scene;
    this.stage = stage;
    this.override = override ? setName(override) : null;
    this.names = [...bots.keys()];
    this.beats = null;
    this.events = [];
    this.byBeat = new Map();
    this.setOf = new Map();
    this.sets = new Map(); // name -> { def, obstacles }
    this.set = 'studio';
    this.beat = null;
    this.mode = 'gather';
    this.cast = [];
    this.state = new Map(); // bot -> { mode: 'on' | 'extra' | 'off' | 'leaving', slot, face, seat }
    for (const b of bots.values()) this.state.set(b, { mode: 'on', slot: b.home.clone(), face: 0, seat: -1, studio: b.home.clone() });
    this.featured = [];
    this.activity = null;
    this.timers = [];
    this.held = new Map(); // bot -> the move it makes once its hand play lets go
    this.time = 0;
    this.changed = false; // the last onEvent changed the scene (the camera cuts to a wide)
    this.crew = null; // the making-of: { formation(set) -> Map name -> [x, y, z], first } (crewStage)
    this._cut = false; // a crew cut since the last onEvent (it reports it as changed)
    this._seq = 0;
  }

  // ------------------------------------------------------------------ episode + sets

  /** A new episode (beats.json or null; events: the bundle's events, for the cast of each beat). */
  load(beats, events = []) {
    this.beats = beats;
    this.events = events ?? [];
    this.byBeat = new Map();
    for (const e of this.events) {
      if (!this.byBeat.has(e.beat)) this.byBeat.set(e.beat, []);
      this.byBeat.get(e.beat).push(e);
    }
    this.setOf = resolveSets(beats, this.override);
  }

  /** load() + every set the episode needs, loaded before playback (a short warm-up). */
  async prepare(beats, events = []) {
    this.load(beats, events);
    await Promise.all(setsNeeded(beats, this.override).map((n) => this.ensureSet(n)));
    this.stage?.warm?.();
  }

  /**
   * The making-of's stage: every set loaded, the whole cast in the first one's crew formation (`formation(set)`:
   * Map name -> [x, y, z], making-of-score.js crewFormation), placed now (the typed opening shows them there).
   * null: the crew mode off (the premiere's blocking again, from its next reset).
   */
  async crewStage(formation = null, { first = DEFAULT_SET } = {}) {
    if (!formation) { this.crew = null; return; }
    this.crew = { formation, first };
    this.load(null, []);
    await Promise.all(SET_NAMES.map((n) => this.ensureSet(n)));
    if (this.crew?.formation !== formation) return; // (another making-of, or the premiere, took over)
    this.stage?.warm?.();
    this.reset();
  }

  /** The making-of: a clean cut to set `name`, the whole cast at its crew formation there (between phrases: CrewSets). */
  crewCut(name) {
    if (!this.crew || name === this.set) return;
    this._crewCut(name);
  }

  _crewCut(name) {
    if (!this.sets.has(name)) name = this.sets.has(DEFAULT_SET) ? DEFAULT_SET : [...this.sets.keys()][0] ?? 'studio';
    this.set = name;
    this.stage?.show?.(name);
    this.cast = [...this.bots.values()];
    this.held.clear();
    this.timers = [];
    this.activity = null;
    this.featured = [];
    this.mode = 'gather';
    const homes = this.crew.formation(name === 'studio' ? null : name);
    for (const b of this.bots.values()) {
      const st = this.state.get(b);
      const p = homes.get(b.name);
      if (p) b.home.set(p[0], p[1], p[2]);
      b.group.visible = true;
      Object.assign(st, { mode: 'on', slot: b.home.clone(), face: 0, seat: -1 });
      b.place(b.home, 0);
    }
    this._cut = true;
  }

  /** Loads a set through the stage (once); resolves its entry or null when it cannot load. */
  async ensureSet(name) {
    if (name === 'studio' || this.sets.has(name)) return this.sets.get(name) ?? null;
    if (!this.stage) return null;
    const group = await this.stage.load(name);
    if (group) this.addSet(name, group);
    return this.sets.get(name) ?? null;
  }

  /** Registers a loaded set group: its obstacles (furniture, walls) for the paths. */
  addSet(name, group) {
    const def = SETS[name] ?? genericSet(name, group);
    this.sets.set(name, { def, obstacles: obstaclesFromGroup(group, THREE.Box3) });
  }

  /** The set a beat plays in (no beats: the forced one, else the diner); the bare rows only when it is not loaded. */
  setFor(beatId) {
    const s = this.setOf.get(beatId) ?? this.override ?? DEFAULT_SET;
    return this.sets.has(s) ? s : 'studio';
  }

  get def() { return this.sets.get(this.set)?.def ?? SETS.studio; }
  get obstacles() { return this.sets.get(this.set)?.obstacles ?? []; }
  get inSet() { return this.set !== 'studio'; }

  /** Is bot b part of the scene now (on set and visible, not an extra)? */
  isOn(b) {
    const st = this.state.get(b);
    return !!st && (st.mode === 'on' || st.mode === 'leaving') && b.group.visible;
  }

  /** The bots visible on set (the camera frames these). */
  onSet() { return [...this.bots.values()].filter((b) => this.isOn(b)); }

  // ------------------------------------------------------------------ player hooks

  /** Player reset (load / seek): the first beat's scene, every bot placed (no entrances). */
  reset() {
    this.time = 0;
    this.timers = [];
    this.held.clear();
    this.activity = null;
    this.featured = [];
    this.changed = true;
    this.stage?.reset?.();
    if (this.crew) { this.set = null; this._crewCut(this.crew.first); this._cut = false; return; }
    const first = this.beats?.beats?.[0] ?? null;
    const id = first?.id ?? '__live';
    this.beat = first ? id : null;
    const set = first ? this.setFor(id) : this.setFor(null);
    this.set = null;
    this._changeSet(set, this._castOf(id), null, { enter: false });
  }

  /** Before each event is staged: a new beat may change the scene; the singer comes forward. */
  onEvent(e, bot) {
    this.changed = this._cut; // (the making-of cut to another set just before this phrase)
    this._cut = false;
    if (e.part) return; // backing / reply / echo parts: mouths and cards only, nobody moves
    if (this.crew) {
      // the making-of: the formation holds, every bot back to its place (a duet's pair to where it sings: acting.js)
      this.activity = null;
      for (const b of this.bots.values()) {
        if (b.target.distanceToSquared(b.home) > 1e-8 || b.via.length) this._go(b, b.home, 0);
      }
      return;
    }
    const beatId = this.beats ? e.beat : '__live';
    const sung = !!String(e.lyric ?? '').trim();
    // a beat starts with its first sung line (events without words ride along with the next line)
    if (beatId !== this.beat && (sung || !this.beats)) this._enterBeat(beatId, bot);
    if (!this.inSet) {
      // the studio formation: every bot back to its row (moves below re-target the movers; a bot in a hand play
      // goes once the play lets go of it, as in the sets: the swarm leaves a play's cast be, so they never walk through
      // each other)
      this.activity = null;
      this.bots.forEach((b) => this._go(b, b.home, 0));
      return;
    }
    if (!bot || !sung || beatId !== this.beat) return; // no words: the scene holds
    if (this.state.get(bot)?.mode !== 'on') this._bringOn(bot);
    // a line sung together: the harmony singers step forward beside the lead
    const joiners = this._joinersOf(e).filter((b) => b !== bot);
    this._feature([bot, ...joiners]);
  }

  /** A move (actions.js resolveAction kind 'move'). */
  move(r, bot) {
    if (this.crew) return; // the making-of's formation holds (its moves are gestures: making-of-score.js gestureOf)
    if (!this.inSet) return this._studioMove(r, bot);
    if (!bot) return;
    const members = this.cast.filter((b) => this.state.get(b)?.mode === 'on');
    if (r.id === 'march') this._startMarch(bot, members);
    else if (r.id === 'huddle') this._huddle(bot, members);
    else if (r.id === 'gather') this._gather(bot);
    else if (r.id === 'enter') this._enter(bot, { force: true });
    else if (r.id === 'exit') this._exit(bot);
    else if (r.id === 'walk-to') this._walkTo(bot, r.target);
  }

  /** A lighting cue (kind 'light'): lights-<mood> fades the set's mood; spot-<Bot>/spot-hero. */
  light(r, bot) {
    if (r.id === 'lights') this.stage?.mood?.(normalizeName(r.target));
    else if (r.id === 'spot') {
      const want = String(r.target ?? '').toLowerCase();
      let target = null;
      if (want === 'hero') target = this.bots.get(this.beats?.roles?.lead) ?? bot;
      else target = [...this.bots.values()].find((b) => b.name.toLowerCase() === want) ?? null;
      if (!target || (this.inSet && !this.isOn(target))) target = bot;
      if (target) this.stage?.spot?.(target);
    }
  }

  /** Per-frame update (before the bots' own update). */
  update(dt) {
    this.time += dt;
    // timers in time order (ties in the order they were set): staggered entrances, march phases
    if (this.timers.length) {
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (this.timers.length && this.timers[0].at <= this.time) this.timers.shift().fn();
    }
    // moves that waited for a hand play to let go of its bots
    if (this.held.size) {
      for (const [b, m] of [...this.held]) if (!b.handPlay) this._go(b, m.pos, m.face, m.speed, { strafe: m.strafe });
    }
    if (this.activity?.kind === 'march') this._stepMarch(dt);
    if (this.inSet) {
      for (const [b, st] of this.state) {
        // out of the door: off-set (once at its spot outside, or near it: the next one out need not wait to get there)
        if (st.mode === 'leaving' && (!b.moving || (st.exit && Math.hypot(b.pos.x - st.exit.x, b.pos.z - st.exit.z) < 0.6))) this._park(b);
      }
    }
    this._steer(dt);
    this.stage?.update?.(dt, this);
  }

  // ------------------------------------------------------------------ beats and scenes

  _castOf(beatId) {
    if (beatId === '__live') {
      // no beats.json (LIVE, the sample): whoever has performed so far
      const seen = [];
      for (const [b, st] of this.state) if (st.mode === 'on' && this.cast.includes(b)) seen.push(b.name);
      return seen.map((n) => this.bots.get(n));
    }
    const beat = this.beats?.beats?.find((b) => b.id === beatId) ?? null;
    return beatCast(beat, this.byBeat.get(beatId) ?? [], this.names).map((n) => this.bots.get(n)).filter(Boolean);
  }

  _sectionMode(beatId) {
    const beat = this.beats?.beats?.find((b) => b.id === beatId);
    const section = String(beat?.section ?? beatId ?? '').replace(/^beat-\d+-/, '');
    return GATHER_SECTIONS.test(section) || !this.beats ? 'gather' : 'spread';
  }

  _enterBeat(beatId, singer) {
    const prevSet = this.set;
    this.beat = beatId;
    const set = this.beats ? this.setFor(beatId) : this.setFor(null);
    let cast = this._castOf(beatId);
    if (singer && !cast.includes(singer)) cast = [singer, ...cast];
    this.activity = null;
    this.featured = [];
    this.timers = [];
    this.stage?.spot?.(null);
    if (set !== prevSet) {
      this._changeSet(set, cast, singer, { enter: true });
      this.changed = true;
    } else if (set !== 'studio') {
      this._reblock(cast);
    } else {
      // the studio again, another cast: they glide to the middle of the front row (onEvent walks everyone home)
      this.cast = cast;
      const places = this._studioPlaces(cast);
      if (places) for (const [b, p] of places) { b.home.copy(p); this.state.get(b).slot.copy(p); }
    }
  }

  /** The studio's places for a premiere beat's cast (studioPlaces), bot -> place; null without one (LIVE, the making-of). */
  _studioPlaces(cast) {
    if (!this.beats || !cast?.length) return null;
    const at = studioPlaces(this.names, cast.map((b) => b.name));
    return new Map(this.names.map((n, i) => [this.bots.get(n), at[i]]));
  }

  /** A cut to another set: the singer and half the cast are found in place, the rest come in through the doors. */
  _changeSet(name, cast, singer, { enter }) {
    this.set = name;
    this.stage?.show?.(name);
    this.cast = cast;
    this.held.clear(); // a cut: everybody is placed anew (main.js calls the running hand plays off)
    if (name === 'studio') {
      // the premiere's beat: its cast in the middle of the front row (the camera's core); else everyone's own place
      const places = this._studioPlaces(cast);
      for (const b of this.bots.values()) {
        const st = this.state.get(b);
        b.home.copy(places?.get(b) ?? st.studio);
        b.group.visible = true;
        Object.assign(st, { mode: 'on', slot: b.home.clone(), face: 0, seat: -1 });
        b.place(b.home, 0);
      }
      return;
    }
    this.mode = this._sectionMode(this.beat);
    const slots = this._slots(cast, this.mode);
    // extras: a few bots not in the beat sit in the background; everyone else is off-set
    const extras = this._pickExtras(cast);
    // the scene opens on the singer and the first half of the cast in place; the rest come in
    const inPlace = new Set([singer, ...cast.slice(0, Math.ceil(cast.length / 2))]);
    let k = 0;
    for (const b of this.bots.values()) {
      const st = this.state.get(b);
      st.seat = -1;
      if (slots.has(b)) {
        const s = slots.get(b);
        Object.assign(st, { mode: 'on', slot: s.pos, face: s.face });
        b.home.copy(s.pos);
        b.group.visible = true;
        if (!enter || inPlace.has(b)) b.place(s.pos, s.face);
        else {
          this._enterFrom(b, k * ENTER_GAP, s.pos);
          k++;
        }
      } else if (extras.has(b)) {
        this._seat(b, extras.get(b));
      } else {
        this._park(b);
      }
    }
  }

  /** A new beat in the same set: leavers exit, newcomers enter, the rest move to their new places. */
  _reblock(cast) {
    this.cast = cast;
    this.mode = this._sectionMode(this.beat);
    const slots = this._slots(cast, this.mode);
    let k = 0;
    for (const b of this.bots.values()) {
      const st = this.state.get(b);
      if (slots.has(b)) {
        const s = slots.get(b);
        const was = st.mode;
        Object.assign(st, { mode: 'on', slot: s.pos, face: s.face, seat: -1 });
        b.home.copy(s.pos);
        if (was === 'off' || was === 'leaving') { this._enterFrom(b, k * ENTER_GAP, s.pos); k++; }
        else this._go(b, s.pos, s.face);
      } else if (st.mode === 'on') {
        this._exit(b);
      }
    }
    // an extra who left its seat for the scene frees it; nobody new sits down mid-set
  }

  /** Slots of the beat's cast: { pos, face } per bot. gather: the rows around the stage; spread: the set's places. */
  _slots(cast, mode) {
    const def = this.def;
    const out = new Map();
    const gather = def.gather ?? [];
    let marks = mode === 'spread' ? (def.spread ?? []).map((n) => markOf(def, n)).filter(Boolean) : [];
    if (marks.length > 1) {
      // the beat's first (its singer) takes the set's first place, the story's pal comes next, and each of them the
      // free place nearest to it: the pair a two-shot holds stands close (not across the street)
      const pal = this.bots.get(this.beats?.roles?.pal);
      if (pal && cast.indexOf(pal) > 1) cast = [cast[0], pal, ...cast.slice(1).filter((b) => b !== pal)];
      const [first, ...rest] = marks;
      rest.sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z));
      marks = [first, ...rest];
    }
    // the rest on the gathering's places, in their order, each the first one from where the audience sees its face and
    // it hides none of the faces placed before it (restHidden: a place right in front of a mark hid the pal's answers,
    // QA v20); none in clear sight: the one hiding least. More bots than places: an outer ring behind the gathering.
    const spots = gather.map((g) => v3(g[0], g[2], g[1]));
    for (let i = 0; spots.length < cast.length + 2; i++) {
      const a = (i % 2 ? 1 : -1) * (0.6 + 0.35 * Math.floor(i / 2));
      spots.push(v3(Math.sin(a) * 3.6, def.headY + 0.3, -1.2 - Math.cos(a) * 1.6));
    }
    const placed = [];
    let mi = 0;
    for (const b of cast) {
      const r = b.unit * b.group.scale.x;
      let p;
      if (mi < marks.length) { const m = marks[mi++]; p = v3(m.x, m.y, m.z); }
      else {
        let best = -1, bestHid = Infinity;
        for (let k = 0; k < spots.length; k++) {
          if (!spots[k]) continue;
          const hid = restHidden(spots[k], r, placed, def);
          if (hid < bestHid - 1e-9) { best = k; bestHid = hid; }
          if (hid <= SIGHT_OK) break;
        }
        p = spots[best];
        spots[best] = null;
      }
      placed.push({ x: p.x, y: p.y, z: p.z, r });
      out.set(b, { pos: p, face: this._faceAudience(p) });
    }
    return out;
  }

  _faceAudience(p) {
    const a = this.def.audience ?? [0, 8];
    return Math.atan2(a[0] - p.x, a[1] - p.z);
  }

  /** Who sits in the background seats: the beat's backing singers first (their mouths move), then others. */
  _pickExtras(cast) {
    const seats = this.def.extras ?? [];
    const out = new Map();
    if (!seats.length) return out;
    const backing = backingOf(this.byBeat.get(this.beat) ?? [], this.names).map((n) => this.bots.get(n));
    const rank = (b) => (backing.includes(b) ? backing.indexOf(b) : 100 + (hash(`${this.beat}:${b.name}`) % 1000));
    const free = [...this.bots.values()].filter((b) => !cast.includes(b));
    free.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
    free.slice(0, seats.length).forEach((b, i) => out.set(b, i));
    return out;
  }

  _seat(b, i) {
    const s = this.def.extras[i];
    const pos = v3(s[0], s[2], s[1]);
    const st = this.state.get(b);
    Object.assign(st, { mode: 'extra', slot: pos, face: this._faceAudience(pos), seat: i });
    b.home.copy(pos);
    b.group.visible = true;
    b.place(pos, st.face);
  }

  /** Off-set: hidden, far from everyone (nobody's neighbour); an entrance places it at a door again. */
  _park(b) {
    const st = this.state.get(b);
    const pos = v3(60 + b.index * 3, this.def.headY, 60);
    Object.assign(st, { mode: 'off', slot: pos, face: 0, seat: -1 });
    b.place(pos, 0);
    b.group.visible = false;
  }

  /** Path for bot b to (x, z) at its height: Vector3 waypoints (around the furniture). */
  _path(b, to) {
    const y = to.y;
    const boxes = activeBoxes(this.obstacles, { radius: 0.34, yLo: y - 0.3, yHi: y + 0.32 });
    const pts = planPath([b.pos.x, b.pos.z], [to.x, to.z], boxes, { bounds: this.def.bounds });
    return pts.map(([x, z]) => v3(x, y, z));
  }

  /** Glide b to pos (a path through the set), facing `face` when there. */
  _go(b, pos, face = this._faceAudience(pos), speed, { strafe = false } = {}) {
    // a hand play holds its bots for its length (plays/): the move waits until it lets go
    if (b.handPlay) {
      this.held.set(b, { pos: pos.clone(), face, speed, strafe });
      return;
    }
    this.held.delete(b);
    const pts = this._path(b, pos);
    const end = pts.pop();
    b.walkTo(end ?? pos, { via: pts, face, strafe, ...(speed ? { speed } : {}) });
  }

  /** b comes in through the entrance nearest to its place, after `delay` seconds (hidden till then). */
  _enterFrom(b, delay, pos) {
    const e = nearestEntrance(this.def, pos.x, pos.z);
    if (!e) { b.place(pos, this._faceAudience(pos)); b.group.visible = true; return; }
    const out = v3(e.outside[0], pos.y, e.outside[1]);
    const inn = v3(e.inside[0], pos.y, e.inside[1]);
    // waiting for its turn far off (nobody's neighbour), then out of the door
    b.place(v3(60 + b.index * 3, pos.y, 60), 0);
    b.group.visible = false;
    const go = () => {
      const st = this.state.get(b);
      if (st?.mode !== 'on') return;
      // the doorway is taken (the one before it is still coming through): it waits its turn
      if (this._doorTaken(b, out)) { this._after(0.1, go); return; }
      b.place(out, Math.atan2(inn.x - out.x, inn.z - out.z));
      b.group.visible = true;
      const boxes = activeBoxes(this.obstacles, { radius: 0.34, yLo: st.slot.y - 0.3, yHi: st.slot.y + 0.32 });
      const rest = planPath([inn.x, inn.z], [st.slot.x, st.slot.z], boxes, { bounds: this.def.bounds })
        .map(([x, z]) => v3(x, st.slot.y, z));
      const end = rest.pop() ?? st.slot;
      b.walkTo(end, { via: [inn, ...rest], face: st.face, speed: ENTER_SPEED });
    };
    if (delay <= 0) go();
    else this._after(delay, go);
  }

  /** Is a visible bot (other than b) standing within a head's room of the point `at` (a door's outside)? */
  _doorTaken(b, at) {
    // (the heads as drawn: one leant or held out by the acting or a hand play takes more room, b's own too)
    const reach = (x) => {
      const s = x.head?.socialOffset, p = x.playOffset;
      return ((s ? Math.hypot(s.x, s.z) : 0) + (p ? Math.hypot(p.x, p.z) : 0)) * x.group.scale.x;
    };
    const room = 2 * b.unit * b.group.scale.x + 0.25 + reach(b);
    for (const [x, st] of this.state) {
      if (x === b || !x.group.visible || st.mode === 'off') continue;
      if (Math.hypot(x.pos.x - at.x, x.pos.z - at.z) < room + reach(x)) return true;
    }
    return false;
  }

  _after(delay, fn) { this.timers.push({ at: this.time + delay, seq: this._seq++, fn }); }

  // ------------------------------------------------------------------ the singer

  _joinersOf(e) {
    const out = [];
    for (const w of e.with ?? []) { const b = this.bots.get(w); if (b) out.push(b); }
    const i = this.events.findIndex((x) => x.seq === e.seq && x.beat === e.beat);
    if (i >= 0 && e.lyric) {
      for (let j = i + 1; j < this.events.length; j++) {
        const x = this.events[j];
        if (x.beat !== e.beat || x.lyric !== e.lyric) break;
        const b = this.bots.get(x.singer ?? x.bot);
        if (b && !out.includes(b)) out.push(b);
      }
    }
    return out.filter((b) => this.state.get(b)?.mode === 'on');
  }

  /**
   * The singer (and its harmony) come forward; the previous ones step back to their places. They step facing the
   * audience (a strafe: a singer never turns its face away to walk a step, QA v20).
   */
  _feature(list) {
    if (this.activity?.kind === 'huddle') return this._huddleFace(list);
    if (this.activity && this.activity.kind !== 'gather') return; // a march holds everyone
    for (const b of this.featured) {
      if (list.includes(b)) continue;
      const st = this.state.get(b);
      if (st?.mode === 'on') this._go(b, st.slot, st.face, undefined, { strafe: true });
    }
    this.featured = list.slice();
    const def = this.def;
    const stage = markOf(def, 'stage');
    const lead = this.state.get(list[0]);
    if (lead?.mode !== 'on') return;
    // the lead: on the stage mark when the cast is gathered, else a step downstage from its place
    const a = def.audience ?? [0, 8];
    let at;
    if (this.mode === 'gather' && stage) at = v3(stage.x, stage.y, stage.z);
    else {
      const d = Math.hypot(a[0] - lead.slot.x, a[1] - lead.slot.z) || 1;
      at = v3(lead.slot.x + ((a[0] - lead.slot.x) / d) * 0.8, lead.slot.y, lead.slot.z + ((a[1] - lead.slot.z) / d) * 0.8);
    }
    // the ones singing it with the lead come beside it, level with it (side by side as the audience sees them: across
    // its view), each on the side it already stands on (nearest first outward): a joiner never walks across in front of
    // the lead's face to the other side (QA v20: Red, a harmony going from one lead to the next, passed in front of
    // Silver's face); each spot clear of the marks the rest of the scene stands on, of the spots taken before it, and of
    // the sight lines from the audience (_featureSpot)
    const fx = a[0] - at.x, fz = a[1] - at.z, fn = Math.hypot(fx, fz) || 1;
    const rx = fz / fn, rz = -fx / fn; // the audience's right, across its view
    const on = list.filter((b) => this.state.get(b)?.mode === 'on');
    const lat = (b) => (b.pos.x - at.x) * rx + (b.pos.z - at.z) * rz;
    const sideOf = new Map();
    const joiners = on.filter((b) => b !== list[0]);
    joiners.filter((b) => lat(b) < 0).sort((p, q) => lat(q) - lat(p) || p.index - q.index).forEach((b, k) => sideOf.set(b, -(k + 1)));
    joiners.filter((b) => lat(b) >= 0).sort((p, q) => lat(p) - lat(q) || p.index - q.index).forEach((b, k) => sideOf.set(b, k + 1));
    const spots = [];
    for (const b of on) {
      const st = this.state.get(b);
      const side = b === list[0] ? 0 : sideOf.get(b);
      const to = v3(at.x + side * 1.05 * rx, side ? Math.max(at.y, st.slot.y) : at.y, at.z + side * 1.05 * rz);
      const [x, z] = this._featureSpot(b, to, list, spots);
      to.set(x, to.y, z);
      spots.push([to, b.unit * b.group.scale.x]);
      this._go(b, to, this._faceAudience(to), undefined, { strafe: true });
    }
  }

  /**
   * Where a featured bot b stands near `to`: the nearest point (pushed out of the furniture) whose head clears the
   * places of the scene's other bots (their marks, where they rest) and the featured spots already given (`spots`:
   * [point, half-width]), and from where the audience sees it whole and hides nobody (sightHidden: SIGHT_OK at most).
   * Candidates in a fixed order: deterministic. None in sight: the clear one hiding least; none clear: `to` as it was.
   */
  _featureSpot(b, to, featured, spots) {
    const def = this.def;
    const boxes = activeBoxes(this.obstacles, { radius: 0.36, yLo: to.y - 0.3, yHi: to.y + 0.32 });
    const r = b.unit * b.group.scale.x;
    const taken = spots.slice();
    const faces = spots.map(([t, rt]) => ({ x: t.x, y: t.y, z: t.z, r: rt, sings: true }));
    const humming = new Set(backingOf(this.byBeat.get(this.beat) ?? [], this.names));
    for (const [x, st] of this.state) {
      if (x === b || featured.includes(x) || (st.mode !== 'on' && st.mode !== 'extra')) continue;
      const rx = x.unit * x.group.scale.x;
      taken.push([st.slot, rx]);
      const hums = humming.has(x.name) || (x.singing > 0 && x.part === 'backing');
      faces.push({ x: st.slot.x, y: st.slot.y, z: st.slot.z, r: rx, sings: x.singing > 0 && !hums, hums });
    }
    const free = (px, pz) => taken.every(([t, rt]) => Math.hypot(t.x - px, t.z - pz) > r + rt + SWARM.margin);
    let best = null;
    for (const [dx, dz] of FEATURE_TRIES) {
      const [px, pz] = pushOut(to.x + dx, to.z + dz, boxes, { bounds: def.bounds });
      if (!free(px, pz)) continue;
      const hid = sightHidden({ x: px, y: to.y, z: pz }, r, faces, def);
      if (hid <= SIGHT_OK) return [px, pz];
      if (!best || hid < best[2] - 1e-9) best = [px, pz, hid];
    }
    return best ? [best[0], best[1]] : pushOut(to.x, to.z, boxes, { bounds: def.bounds });
  }

  _bringOn(b) {
    // a performer the beat did not list (LIVE, a stray singer): it joins the scene
    const pos = this._freeSlot();
    const st = this.state.get(b);
    const was = st.mode;
    Object.assign(st, { mode: 'on', slot: pos, face: this._faceAudience(pos), seat: -1 });
    if (!this.cast.includes(b)) this.cast.push(b);
    b.home.copy(pos);
    if (was === 'off' || was === 'leaving') this._enterFrom(b, 0, pos);
    else this._go(b, pos, st.face);
  }

  _freeSlot() {
    const def = this.def;
    const taken = [...this.state.values()].filter((s) => s.mode === 'on').map((s) => s.slot);
    for (const g of def.gather ?? []) {
      const p = v3(g[0], g[2], g[1]);
      if (taken.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > 0.9)) return p;
    }
    return v3(0, def.headY + 0.3, -1.5);
  }

  // ------------------------------------------------------------------ moves in a set

  _startMarch(leader, members) {
    const def = this.def;
    const loop = def.parade?.loop;
    // the bots in the scene march; any still coming in through a door go on to their places
    const ready = members.filter((b) => b.group.visible && !this._entering(b));
    if (!loop || !ready.length) return;
    const line = [leader, ...ready.filter((b) => b !== leader)];
    const L = loopLength(loop);
    const s0 = loopNearest(loop, leader.pos.x, leader.pos.z);
    // everyone lines up behind the leader on the loop, then the line marches round
    const march = { kind: 'march', line, loop, L, y: def.parade.y ?? def.headY, s0, s: s0, t: 0, end: Math.min(MARCH.length, L) };
    this.activity = march;
    this.featured = [];
    line.forEach((b, i) => {
      const p = loopPoint(loop, s0 - i * MARCH.spacing);
      const to = v3(p[0], march.y, p[1]);
      this._go(b, to, Math.atan2(to.x - b.pos.x, to.z - b.pos.z));
    });
  }

  /** Is b still on its way in (waiting for its turn, or walking in from an entrance)? (The camera does not frame it yet.) */
  entering(b) {
    return this._entering(b);
  }

  _entering(b) {
    if (!b.group.visible) return true;
    if (this.crew) return false; // the crew is placed, nobody comes in through a door
    if (!b.via.length && b.pos.distanceToSquared(b.target) < 0.25) return false;
    for (const e of Object.values(this.def.entrances ?? {})) {
      const inside = (e.outside[0] - e.inside[0]) * (b.pos.x - e.inside[0]) + (e.outside[1] - e.inside[1]) * (b.pos.z - e.inside[1]) <= 0;
      if (!inside || Math.hypot(b.pos.x - e.inside[0], b.pos.z - e.inside[1]) < 1.0) return true;
    }
    return false;
  }

  /** The marchers of a running parade (the camera tracks them), else null. */
  get marchers() {
    return this.activity?.kind === 'march' ? this.activity.line.filter((b) => b.group.visible) : null;
  }

  /** The scene's cast and their places ([bot, slot]: where they stand or are going): wide shots frame these. */
  castSlots() {
    const out = [];
    for (const [b, st] of this.state) if (st.mode === 'on' && this.cast.includes(b)) out.push([b, st.slot]);
    return out;
  }

  /** Where the scene's cast stands (their places, not where they are now): wide shots aim here. */
  castCenter(out = new THREE.Vector3()) {
    let n = 0;
    out.set(0, 0, 0);
    for (const [b, st] of this.state) {
      if (st.mode !== 'on' || !this.cast.includes(b)) continue;
      out.add(st.slot);
      n++;
    }
    if (n) out.divideScalar(n);
    else {
      const m = markOf(this.def, 'stage');
      if (m) out.set(m.x, m.y, m.z);
    }
    return out;
  }

  _stepMarch(dt) {
    const m = this.activity;
    m.t += dt;
    if (m.t < MARCH.lineUp) return;
    m.s = Math.min(m.s0 + m.end, m.s + MARCH.speed * dt);
    const p = [0, 0], q = [0, 0];
    m.line.forEach((b, i) => {
      if (this.state.get(b)?.mode !== 'on' || b.handPlay) return; // a bot in a hand play joins when it is done
      const s = m.s - i * MARCH.spacing;
      loopPoint(m.loop, s, p);
      loopPoint(m.loop, s + 0.4, q);
      b.target.set(p[0], m.y, p[1]);
      b.via = [];
      b.speed = MARCH.speed * 1.6;
      // a marcher singing a line glides on facing the audience (a chorus line), the others face the way they go
      b.strafe = b.singing > 0 && b.part !== 'backing';
      b.faceYaw = b.strafe ? this._faceAudience(b.target) : Math.atan2(q[0] - p[0], q[1] - p[1]);
    });
    if (m.s >= m.s0 + m.end - 1e-6) {
      // the parade is done: everyone back to their places
      this.activity = null;
      for (const b of m.line) {
        const st = this.state.get(b);
        if (st?.mode === 'on') this._go(b, st.slot, st.face);
      }
    }
  }

  /** A huddle holds its places: the ones singing now turn to the audience where they stand, the ones done turn back in. */
  _huddleFace(list) {
    for (const b of this.featured) {
      const st = this.state.get(b);
      if (!list.includes(b) && st?.mode === 'on') b.walkTo(b.target, { via: b.via, face: st.face, speed: b.speed });
    }
    this.featured = list.filter((b) => this.state.get(b)?.mode === 'on');
    for (const b of this.featured) b.walkTo(b.target, { via: b.via, face: this._faceAudience(b.target), speed: b.speed });
  }

  _huddle(mover, members) {
    const def = this.def;
    const stage = markOf(def, 'stage');
    const c = stage ? v3(stage.x, stage.y, stage.z - 0.6) : mover.pos.clone();
    // the mover and the bots singing now in the middle, side by side; the rest round them
    const middle = [mover, ...this.featured.filter((b) => b !== mover && members.includes(b))].slice(0, 3);
    const ring = members.filter((b) => !middle.includes(b));
    // an arc round the back and the sides, open to the camera (200 degrees: its ends about level with the middle, not
    // well in front of it as at 220, where a singer hid the middle's faces, QA v20); radius by the crowd
    const span = (200 * Math.PI) / 180;
    const r = Math.max(1.35 + 0.4 * (middle.length - 1), (ring.length * 0.95) / span);
    this.activity = { kind: 'huddle' };
    const boxes = activeBoxes(this.obstacles, { radius: 0.34, yLo: c.y - 0.3, yHi: c.y + 0.32 });
    const rOf = (b) => b.unit * b.group.scale.x;
    const placed = [];
    middle.forEach((b, i) => {
      const st = this.state.get(b);
      if (!st) return;
      const side = i === 0 ? 0 : i % 2 ? -1 : 1;
      const pos = v3(c.x + side * 0.95, c.y, c.z + 0.15 - (i ? 0.2 : 0));
      st.slot = pos;
      st.face = this._faceAudience(pos);
      b.home.copy(pos);
      this._go(b, pos, st.face);
      placed.push({ x: pos.x, y: pos.y, z: pos.z, r: rOf(b) });
    });
    // the ring in order round the arc, each near its even share of it, where no middle head (nor a ring head placed
    // before it) hides its face from the audience or is hidden by it (restHidden: SIGHT_OK at most; Nov 1, toy-box:
    // Lilac, on the ring straight behind Blue, sang a harmony hidden for 4.4 s); none clear: the one hiding least
    const spotAt = (a) => {
      let x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
      [x, z] = pushOut(x, z, boxes, { bounds: def.bounds });
      return v3(x, c.y + 0.1 * Math.abs(Math.cos(a)), z);
    };
    const step = span / Math.max(4 * ring.length, 24);
    const gap = Math.min(span / Math.max(ring.length - 1, 1), 0.9 / r); // (neighbours a head and a margin apart)
    let prev = -Infinity;
    ring.forEach((b, i) => {
      const u = ring.length > 1 ? i / (ring.length - 1) : 0.5;
      const want = Math.PI + (u - 0.5) * span; // measured from +z: pi is straight behind
      // (within half its share of the arc: the ring stays spread round the middle, never bunched to one side)
      const share = ring.length > 1 ? span / (ring.length - 1) / 2 : span / 2;
      const lo = Math.max(Math.PI - span / 2, prev + gap * 0.999, want - share), hi = Math.min(Math.PI + span / 2 - (ring.length - 1 - i) * gap * 0.999, want + share);
      // (clear of every head placed, as the swarm keeps them, first; then in sight; none clear: the most room)
      let best = null;
      for (let k = 0; k <= 2 * Math.ceil(span / step); k++) {
        const a = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
        if (a < lo - 1e-9 || a > hi + 1e-9) continue;
        const pos = spotAt(a);
        const room = Math.min(Infinity, ...placed.map((f) => Math.hypot(f.x - pos.x, f.z - pos.z) - f.r - rOf(b) - SWARM.margin));
        const clear = room >= 0.1;
        const hid = clear ? restHidden(pos, rOf(b), placed, def) : Infinity;
        if (!best || (clear && (!best.clear || hid < best.hid - 1e-9)) || (!clear && !best.clear && room > best.room + 1e-9)) best = { a, pos, hid, room, clear };
        if (clear && hid <= SIGHT_OK) break;
      }
      best ??= { a: want, pos: spotAt(want) };
      prev = best.a;
      const pos = best.pos;
      const st = this.state.get(b);
      st.slot = pos;
      st.face = Math.atan2(c.x - pos.x, c.z - pos.z);
      b.home.copy(pos);
      this._go(b, pos, st.face);
      placed.push({ x: pos.x, y: pos.y, z: pos.z, r: rOf(b) });
    });
    this.featured = [];
  }

  _gather(bot) {
    this.mode = 'gather';
    const slots = this._slots(this.cast.filter((b) => this.state.get(b)?.mode === 'on'), 'gather');
    this.activity = { kind: 'gather' };
    for (const [b, s] of slots) {
      Object.assign(this.state.get(b), { slot: s.pos, face: s.face });
      b.home.copy(s.pos);
      this._go(b, s.pos, s.face);
    }
    this.featured = [];
    this._feature([bot]);
  }

  _enter(b, { force = false } = {}) {
    const st = this.state.get(b);
    if (st.mode === 'on' && !force) return;
    const pos = st.mode === 'on' ? st.slot : this._freeSlot();
    Object.assign(st, { mode: 'on', slot: pos, face: this._faceAudience(pos), seat: -1 });
    if (!this.cast.includes(b)) this.cast.push(b);
    b.home.copy(pos);
    this._enterFrom(b, 0, pos);
  }

  _exit(b) {
    const st = this.state.get(b);
    if (!st || st.mode === 'off') return;
    const e = nearestEntrance(this.def, b.pos.x, b.pos.z);
    if (!e) return;
    const y = b.pos.y;
    const inn = v3(e.inside[0], y, e.inside[1]);
    const out = v3(e.outside[0], y, e.outside[1]);
    const pts = this._path(b, inn);
    b.walkTo(out, { via: [...pts, inn] });
    st.mode = 'leaving';
    st.exit = out;
    this.featured = this.featured.filter((x) => x !== b);
  }

  _walkTo(b, target) {
    const def = this.def;
    const want = String(target ?? '').toLowerCase();
    const other = [...this.bots.values()].find((x) => x.name.toLowerCase() === want && x !== b);
    let to;
    if (other) {
      // beside the other bot, on the side the walker comes from
      const side = b.pos.x <= other.pos.x ? -1 : 1;
      to = v3(other.pos.x + side * 1.0, other.pos.y, other.pos.z + 0.15);
    } else {
      // a mark this set does not have: the bot still goes somewhere visible, to the stage
      const m = markOf(def, want) ?? markOf(def, 'stage');
      if (!m) return;
      to = v3(m.x, m.y, m.z);
    }
    const [x, z] = this._freeNear(b, to, other);
    to.set(x, to.y, z);
    const st = this.state.get(b);
    if (st.mode !== 'on') this._bringOn(b);
    st.slot = to.clone();
    st.face = other ? Math.atan2(other.pos.x - x, other.pos.z - z) : this._faceAudience(to);
    b.home.copy(to);
    this.featured = this.featured.filter((x2) => x2 !== b);
    this._go(b, to, st.face);
  }

  /**
   * A free spot for b at `to` (or beside it when another bot already stands there): clear of the
   * furniture and of the other bots' places. Candidates in a fixed order: deterministic.
   */
  _freeNear(b, to, other = null) {
    const def = this.def;
    const boxes = activeBoxes(this.obstacles, { radius: 0.36, yLo: to.y - 0.3, yHi: to.y + 0.32 });
    const taken = []; // [point, clearance]: the bot walked up to may be a little nearer than the rest
    for (const [x, st] of this.state) {
      if (x === b || (st.mode !== 'on' && st.mode !== 'extra')) continue;
      const near = x === other ? 0.9 : 1.05;
      taken.push([st.slot, near], [x.target, near], [x.pos, near]);
    }
    const free = (px, pz) => taken.every(([t, r]) => Math.hypot(t.x - px, t.z - pz) > r);
    // beside a bot: its near side, its far side, in front of it, then further round; else round the spot
    const s = other ? Math.sign(to.x - other.pos.x) || 1 : 0;
    const tries = other ? [[0, 0], [-2 * s, 0], [-s, 0.95], [0, 0.95], [-2 * s, 0.9], [-s, -0.95], [1.1 * s, 0], [-3.1 * s, 0]]
      : [[0, 0], [1.1, 0], [-1.1, 0], [0, 1.1], [1.1, 0.9], [-1.1, 0.9], [0, -1.1], [2.2, 0], [-2.2, 0]];
    for (const [dx, dz] of tries) {
      const [px, pz] = pushOut(to.x + dx, to.z + dz, boxes, { bounds: def.bounds });
      if (free(px, pz)) return [px, pz];
    }
    return pushOut(to.x, to.z, boxes, { bounds: def.bounds });
  }

  /**
   * The swarm (swarm.js): every visible bot's glide steers round the others' heads (predictive avoidance +
   * separation). Seated extras and bots held by a hand play hold still (the others go round them); pairs in contact
   * on purpose (contact(): a hand play's cast, the acting's partners) are left alone. In bot order: deterministic.
   */
  _steer(dt = 0) {
    const agents = this._agents ??= [];
    let n = 0;
    for (const b of this.bots.values()) {
      const st = this.state.get(b);
      if (!b.group.visible || st.mode === 'off') { b.push.set(0, 0, 0); continue; }
      const a = agents[n] ??= { bot: null, x: 0, y: 0, z: 0, bx: 0, by: 0, bz: 0, gx: 0, gz: 0, vx: 0, vz: 0, wx: 0, wz: 0, r: 0, mobile: true, moving: false, left: 0, px: 0, pz: 0 };
      n++;
      // the head's centre: the glide position plus its offsets (the acting's and a hand play's, in the bot's frame),
      // and without them (where the head comes back to)
      const o = _off.copy(b.head.group.position).multiplyScalar(b.group.scale.x).applyQuaternion(b.group.quaternion);
      a.bot = b;
      a.x = b.pos.x + o.x;
      a.y = b.pos.y + o.y;
      a.z = b.pos.z + o.z;
      a.bx = b.pos.x;
      a.by = b.pos.y;
      a.bz = b.pos.z;
      a.gx = b.target.x;
      a.gz = b.target.z;
      a.vx = b.vel.x;
      a.vz = b.vel.z;
      b.glideVelocity(_wish);
      a.wx = _wish.x;
      a.wz = _wish.z;
      a.r = b.unit * b.group.scale.x;
      // a bot held by a hand play holds still for it (unless its glide still takes it somewhere: then it steers too)
      a.moving = st.mode !== 'extra' && b.moving;
      a.mobile = st.mode !== 'extra' && (!b.handPlay || a.moving);
      a.left = a.mobile ? b.glideLeft : 0;
    }
    agents.length = n;
    steer(agents, this.contact);
    if (dt > 0) resolve(agents, dt, this.contact);
  }

  // ------------------------------------------------------------------ the bare rows (no set loaded)

  _studioMove(r, bot) {
    if (!bot) return;
    if (r.id === 'march') {
      const targets = ringTargets(new THREE.Vector3(0, 1, 0), 2.2, this.bots.size);
      [...this.bots.values()].forEach((b, i) => this._go(b, targets[i], b.faceYaw));
    } else if (r.id === 'huddle' || r.id === 'gather') {
      const others = [...this.bots.values()].filter((b) => b !== bot);
      // drawn in round the bot until the heads (nearly) touch: the ring as tight as the crowd lets it be
      const width = others.reduce((s, b) => s + 2 * b.unit * b.group.scale.x, 0) + 0.12 * others.length;
      const targets = ringTargets(bot.home, Math.max(0.9, width / (2 * Math.PI)), others.length);
      others.forEach((b, i) => this._go(b, targets[i], b.faceYaw));
    } else if (r.id === 'walk-to') {
      const other = [...this.bots.values()].find((b) => b.name.toLowerCase() === String(r.target).toLowerCase());
      if (other) this._go(bot, other.home.clone().lerp(bot.home, 0.4), bot.faceYaw);
    }
  }
}

/** A set without staging data (e.g. the smoke room): marks from its bounds. */
function genericSet(name, group) {
  const box = new THREE.Box3().setFromObject(group);
  const x0 = box.min.x + 0.8, x1 = box.max.x - 0.8, z0 = box.min.z + 0.8, z1 = box.max.z - 0.8;
  const cz = (z0 + z1) / 2;
  return {
    name, glb: name, headY: 1.2, floor: 0, audience: [0, box.max.z + 4],
    bounds: [x0, x1, z0, z1 + 3],
    marks: { stage: [0, Math.min(z1, cz + 1), 1.2] },
    gather: ringTargets(new THREE.Vector3(0, 1.3, cz - 0.5), 1.8, 10).map((v) => [v.x, v.z, v.y]),
    extras: [],
    entrances: { left: { inside: [x0, cz], outside: [x0 - 3, cz] }, right: { inside: [x1, cz], outside: [x1 + 3, cz] } },
    parade: { loop: [[x0 + 0.6, z1], [x1 - 0.6, z1], [x1 - 0.6, z0 + 0.6], [x0 + 0.6, z0 + 0.6]], y: 1.2 },
    camera: { bounds: [x0, x1, 0.8, 3, z0, z1 + 6], wide: [{ pos: [0, 2, box.max.z + 3], look: [0, 1.1, cz] }] },
    lights: SETS.diner.lights,
  };
}
