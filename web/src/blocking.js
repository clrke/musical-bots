// Where the bots are: the formation in the studio, and the bots moving through the Blender sets
// (diner, big house, street) as heads + hands: a set per beat (beats.json beats[].set), the beat's
// cast on set and the rest parked (a few extras in the background, the others off-set), entrances
// and exits through the set's doors, the singer coming forward to sing, the moves of actions.js
// MOVES (march, huddle, gather, enter, exit, walk-to-<mark|Bot>) and the lighting agent's cues
// (lights-<mood>, spot-<Bot>) handed to the stage (scene/environments/stage.js).
// Deterministic for the frame-exact capture: no randomness, no wall clock; time is the sum of dt.
import * as THREE from 'three';
import { ringTargets } from './rig.js';
import { parseLyric } from './cues.js';
import { resolveAction } from './actions.js';
import {
  SETS, resolveSets, setsNeeded, setName, markOf, nearestEntrance, loopLength, loopPoint, loopNearest, normalizeName,
} from './scene/environments/sets.js';
import { obstaclesFromGroup, activeBoxes, planPath, pushOut } from './scene/environments/pathing.js';

/** Two-tier chorus rows in the studio (front low + wide, back high + tight), alternating cast. */
export function studioHome(i) {
  const back = i % 2 === 1;
  const a = (Math.floor(i / 2) / 7) * Math.PI - Math.PI;
  return back
    ? new THREE.Vector3(Math.cos(a) * 2.6, 1.55, Math.sin(a) * 1.2 - 1.2)
    : new THREE.Vector3(Math.cos(a) * 3.0, 0.75, Math.sin(a) * 1.2 + 0.5);
}

const GATHER_SECTIONS = /^(intro|outro|chorus)/; // the whole cast together; other sections spread out
const ENTER_GAP = 0.35; // seconds between bots coming through a door
const ENTER_SPEED = 1.8; // m/s: a brisk entrance
const MARCH = { speed: 1.35, spacing: 1.15, length: 11, lineUp: 1.2 };
const SEP_GAIN = 2.6; // separation push, m/s per metre of overlap
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** A small, stable hash (beat ids, names) for deterministic choices. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The bots a beat puts on set, in staging order: performers first, then the beat's cast. */
export function beatCast(beat, events, names) {
  const out = [];
  const known = new Set(names);
  const canon = (n) => names.find((k) => k.toLowerCase() === String(n ?? '').toLowerCase()) ?? null;
  const add = (n) => { const c = canon(n); if (c && known.has(c) && !out.includes(c)) out.push(c); };
  for (const e of events) {
    add(e.singer ?? e.bot);
    for (const w of e.with ?? []) add(w);
  }
  for (const n of beat?.cast ?? []) add(n);
  for (const e of events) {
    for (const c of e.consult ?? []) add(c);
    for (const c of parseLyric(e.lyric, names).cues) add(c.name);
    const r = resolveAction(e.action);
    if ((r.kind === 'move' && r.id === 'walk-to') || (r.kind === 'light' && r.id === 'spot')) add(r.target);
  }
  return out;
}

export class Blocking {
  /**
   * bots: Map name -> Bot. stage (optional): the set visuals (scene/environments/stage.js: load,
   * show, mood, spot, update). override: the ?set= URL driver (one set for every beat).
   */
  constructor({ bots, scene, stage = null, override = null }) {
    this.bots = bots;
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
    this.time = 0;
    this.changed = false; // the last onEvent changed the scene (the camera cuts to a wide)
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
    const need = setsNeeded(beats, this.override);
    if (this.override && this.override !== 'studio') need.push(this.override);
    await Promise.all([...new Set(need)].map((n) => this.ensureSet(n)));
    this.stage?.warm?.();
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

  /** The set a beat plays in (loaded), else the studio. */
  setFor(beatId) {
    const s = this.setOf.get(beatId) ?? (this.beats ? 'studio' : this.override ?? 'studio');
    return s === 'studio' || this.sets.has(s) ? s : 'studio';
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
    this.activity = null;
    this.featured = [];
    this.changed = true;
    this.stage?.reset?.();
    const first = this.beats?.beats?.[0] ?? null;
    const id = first?.id ?? '__live';
    this.beat = first ? id : null;
    const set = first ? this.setFor(id) : this.setFor(null);
    this.set = null;
    this._changeSet(set, this._castOf(id), null, { enter: false });
  }

  /** Before each event is staged: a new beat may change the scene; the singer comes forward. */
  onEvent(e, bot) {
    this.changed = false;
    const beatId = this.beats ? e.beat : '__live';
    if (beatId !== this.beat) this._enterBeat(beatId, bot);
    if (!this.inSet) {
      // the studio formation: every bot back to its row (moves below re-target the movers)
      this.activity = null;
      this.bots.forEach((b) => b.walkTo(b.home, { face: 0 }));
      return;
    }
    if (!bot) return;
    if (this.state.get(bot)?.mode !== 'on') this._bringOn(bot);
    // a line sung together: the harmony singers step forward beside the lead
    const joiners = this._joinersOf(e).filter((b) => b !== bot);
    this._feature([bot, ...joiners]);
  }

  /** A move (actions.js resolveAction kind 'move'). */
  move(r, bot) {
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
    if (this.activity?.kind === 'march') this._stepMarch(dt);
    if (this.inSet) {
      for (const [b, st] of this.state) {
        if (st.mode === 'leaving' && !b.moving) { st.mode = 'off'; b.group.visible = false; }
      }
      this._separate();
    } else {
      for (const b of this.bots.values()) b.push.set(0, 0, 0);
    }
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
    }
  }

  /** A cut to another set: the singer and half the cast are found in place, the rest come in through the doors. */
  _changeSet(name, cast, singer, { enter }) {
    this.set = name;
    this.stage?.show?.(name);
    this.cast = cast;
    if (name === 'studio') {
      for (const b of this.bots.values()) {
        const st = this.state.get(b);
        b.home.copy(st.studio);
        b.group.visible = true;
        Object.assign(st, { mode: 'on', slot: st.studio.clone(), face: 0, seat: -1 });
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
    const marks = mode === 'spread' ? (def.spread ?? []).map((n) => markOf(def, n)).filter(Boolean) : [];
    let gi = 0, mi = 0;
    for (const b of cast) {
      let p;
      if (mi < marks.length) { const m = marks[mi++]; p = v3(m.x, m.y, m.z); }
      else if (gi < gather.length) { const g = gather[gi++]; p = v3(g[0], g[2], g[1]); }
      else {
        // more bots than places: an outer ring behind the gathering
        const i = gi++ - gather.length;
        const a = (i % 2 ? 1 : -1) * (0.6 + 0.35 * Math.floor(i / 2));
        p = v3(Math.sin(a) * 3.6, def.headY + 0.3, -1.2 - Math.cos(a) * 1.6);
      }
      out.set(b, { pos: p, face: this._faceAudience(p) });
    }
    return out;
  }

  _faceAudience(p) {
    const a = this.def.audience ?? [0, 8];
    return Math.atan2(a[0] - p.x, a[1] - p.z);
  }

  _pickExtras(cast) {
    const seats = this.def.extras ?? [];
    const out = new Map();
    if (!seats.length) return out;
    const free = [...this.bots.values()].filter((b) => !cast.includes(b));
    free.sort((a, b) => hash(`${this.beat}:${a.name}`) - hash(`${this.beat}:${b.name}`) || a.index - b.index);
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

  _park(b) {
    const st = this.state.get(b);
    const entrances = Object.values(this.def.entrances ?? {});
    const e = entrances[b.index % Math.max(1, entrances.length)];
    const pos = e ? v3(e.outside[0], this.def.headY, e.outside[1]) : v3(0, -20, 0);
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
  _go(b, pos, face = this._faceAudience(pos), speed) {
    const pts = this._path(b, pos);
    const end = pts.pop();
    b.walkTo(end ?? pos, { via: pts, face, ...(speed ? { speed } : {}) });
  }

  /** b comes in through the entrance nearest to its place, after `delay` seconds (hidden till then). */
  _enterFrom(b, delay, pos) {
    const e = nearestEntrance(this.def, pos.x, pos.z);
    if (!e) { b.place(pos, this._faceAudience(pos)); b.group.visible = true; return; }
    const out = v3(e.outside[0], pos.y, e.outside[1]);
    const inn = v3(e.inside[0], pos.y, e.inside[1]);
    b.place(out, Math.atan2(inn.x - out.x, inn.z - out.z));
    b.group.visible = false;
    const go = () => {
      const st = this.state.get(b);
      if (st?.mode !== 'on') return;
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

  /** The singer (and its harmony) come forward; the previous ones step back to their places. */
  _feature(list) {
    if (this.activity && this.activity.kind !== 'gather') return; // a huddle / march holds everyone
    for (const b of this.featured) {
      if (list.includes(b)) continue;
      const st = this.state.get(b);
      if (st?.mode === 'on') this._go(b, st.slot, st.face);
    }
    this.featured = list.slice();
    const def = this.def;
    const stage = markOf(def, 'stage');
    list.forEach((b, i) => {
      const st = this.state.get(b);
      if (st?.mode !== 'on') return;
      let to;
      if (this.mode === 'gather' && stage) {
        // the lead on the stage mark, the harmony beside it (alternating sides)
        const side = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
        to = v3(stage.x + side * 1.05, stage.y, stage.z - (i ? 0.25 : 0));
      } else {
        // a step downstage from its own place, toward the audience
        const a = def.audience ?? [0, 8];
        const d = Math.hypot(a[0] - st.slot.x, a[1] - st.slot.z) || 1;
        to = v3(st.slot.x + ((a[0] - st.slot.x) / d) * 0.8, st.slot.y, st.slot.z + ((a[1] - st.slot.z) / d) * 0.8);
      }
      const boxes = activeBoxes(this.obstacles, { radius: 0.36, yLo: to.y - 0.3, yHi: to.y + 0.32 });
      const [x, z] = pushOut(to.x, to.z, boxes, { bounds: def.bounds });
      to.set(x, to.y, z);
      this._go(b, to, this._faceAudience(to));
    });
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

  /** Is b still on its way in (waiting for its turn, or walking in from an entrance)? */
  _entering(b) {
    if (!b.group.visible) return true;
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
      if (this.state.get(b)?.mode !== 'on') return;
      const s = m.s - i * MARCH.spacing;
      loopPoint(m.loop, s, p);
      loopPoint(m.loop, s + 0.4, q);
      b.target.set(p[0], m.y, p[1]);
      b.via = [];
      b.speed = MARCH.speed * 1.6;
      b.faceYaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
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

  _huddle(mover, members) {
    const def = this.def;
    const stage = markOf(def, 'stage');
    const c = stage ? v3(stage.x, stage.y, stage.z - 0.6) : mover.pos.clone();
    // the mover and the bots singing now in the middle, side by side; the rest round them
    const middle = [mover, ...this.featured.filter((b) => b !== mover && members.includes(b))].slice(0, 3);
    const ring = members.filter((b) => !middle.includes(b));
    // an arc round the back and the sides, open to the camera; radius by the crowd
    const span = (220 * Math.PI) / 180;
    const r = Math.max(1.35 + 0.4 * (middle.length - 1), (ring.length * 0.95) / span);
    this.activity = { kind: 'huddle' };
    const boxes = activeBoxes(this.obstacles, { radius: 0.34, yLo: c.y - 0.3, yHi: c.y + 0.32 });
    ring.forEach((b, i) => {
      const u = ring.length > 1 ? i / (ring.length - 1) : 0.5;
      const a = Math.PI + (u - 0.5) * span; // measured from +z: pi is straight behind
      let x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
      [x, z] = pushOut(x, z, boxes, { bounds: def.bounds });
      const pos = v3(x, c.y + 0.1 * Math.abs(Math.cos(a)), z);
      const st = this.state.get(b);
      st.slot = pos;
      st.face = Math.atan2(c.x - x, c.z - z);
      b.home.copy(pos);
      this._go(b, pos, st.face);
    });
    middle.forEach((b, i) => {
      const st = this.state.get(b);
      if (!st) return;
      const side = i === 0 ? 0 : i % 2 ? -1 : 1;
      const pos = v3(c.x + side * 0.95, c.y, c.z + 0.15 - (i ? 0.2 : 0));
      st.slot = pos;
      st.face = this._faceAudience(pos);
      b.home.copy(pos);
      this._go(b, pos, st.face);
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
      const m = markOf(def, want);
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
    const taken = [];
    for (const [x, st] of this.state) {
      if (x === b || x === other || (st.mode !== 'on' && st.mode !== 'extra')) continue;
      taken.push(st.slot, x.target);
    }
    const free = (px, pz) => taken.every((t) => Math.hypot(t.x - px, t.z - pz) > 1.05);
    for (const [dx, dz] of [[0, 0], [1.1, 0], [-1.1, 0], [0, 1.1], [1.1, 0.9], [-1.1, 0.9], [0, -1.1], [2.2, 0], [-2.2, 0]]) {
      const [px, pz] = pushOut(to.x + dx, to.z + dz, boxes, { bounds: def.bounds });
      if (free(px, pz)) return [px, pz];
    }
    return pushOut(to.x, to.z, boxes, { bounds: def.bounds });
  }

  /** Bots never overlap: a push apart (seated extras hold their seats). */
  _separate() {
    const list = [...this.bots.values()].filter((b) => b.group.visible && this.state.get(b).mode !== 'off');
    for (const b of list) b.push.set(0, 0, 0);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ra = a.unit * 2.4 * 1.12;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (Math.abs(a.pos.y - b.pos.y) > 0.55) continue;
        const rb = b.unit * 2.4 * 1.12;
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        const min = ra + rb + 0.06;
        if (d >= min) continue;
        if (d < 1e-4) { dx = a.index < b.index ? 1 : -1; dz = 0; d = 1; }
        const f = (min - Math.min(d, min)) * SEP_GAIN;
        const ux = dx / d, uz = dz / d;
        const ma = this.state.get(a).mode === 'extra' ? 0 : 1, mb = this.state.get(b).mode === 'extra' ? 0 : 1;
        const sum = ma + mb || 1;
        a.push.x -= ux * f * (ma / sum) * 2;
        a.push.z -= uz * f * (ma / sum) * 2;
        b.push.x += ux * f * (mb / sum) * 2;
        b.push.z += uz * f * (mb / sum) * 2;
      }
    }
    for (const b of list) {
      const l = Math.hypot(b.push.x, b.push.z);
      if (l > 1.4) b.push.multiplyScalar(1.4 / l);
    }
  }

  // ------------------------------------------------------------------ the studio (as before)

  _studioMove(r, bot) {
    if (!bot) return;
    if (r.id === 'march') {
      const targets = ringTargets(new THREE.Vector3(0, 1, 0), 2.2, this.bots.size);
      [...this.bots.values()].forEach((b, i) => b.walkTo(targets[i]));
    } else if (r.id === 'huddle' || r.id === 'gather') {
      const others = [...this.bots.values()].filter((b) => b !== bot);
      const targets = ringTargets(bot.home, 0.9, others.length);
      others.forEach((b, i) => b.walkTo(targets[i]));
    } else if (r.id === 'walk-to') {
      const other = [...this.bots.values()].find((b) => b.name.toLowerCase() === String(r.target).toLowerCase());
      if (other) bot.walkTo(other.home.clone().lerp(bot.home, 0.4));
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
