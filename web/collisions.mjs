// Headless collision meter: plays a curated episode the way main.js stages it (the blocking, the acting's head
// layer, the hand plays and the bots' own update: heads + hands) at a fixed dt, and measures the bots' head volumes
// (the body's glide position plus the head's offsets, a sphere of the head's half-width) for overlaps that nobody
// directed. Intended contact: a hand play's cast, a consultation's pair and the acting's directed touches (bump /
// poke partners). Also logs every move order (walkTo) and when the bot got there (arrival times).
//
//   node web/collisions.mjs [slug ...] [--json out.json] [--compare base.json]
//
// Deterministic: a fixed dt, no wall clock (the frame-exact capture's virtual clock does the same).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MB_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..'); // MB_ROOT: episodes + environments from another checkout

// --- minimal DOM stub (the lyrics panel draws on a 2D canvas; textures never load headless)
function stub2d() {
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return () => ({ width: 12 });
      return () => undefined;
    },
    set() { return true; },
  });
}
globalThis.document ??= { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }) };
globalThis.Image ??= class { set src(v) { void v; } };

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { Bot } = await import('./src/rig.js');
const { NAMES } = await import('./src/gen/cast.js');
const { Blocking, studioHome } = await import('./src/blocking.js');
const { Acting, playGesture, playAct, accentAction } = await import('./src/acting.js');
const { startPlay, updatePlays, resetPlays, runningPlays } = await import('./src/plays/index.js');
const { resolveAction, PLAYS } = await import('./src/actions.js');
const { parseLyric } = await import('./src/cues.js');
const { arrange } = await import('./src/sing-plan.js');
const { parseNdjson } = await import('./src/player.js');
const { SEEDS } = await import('./src/curated.js');
const { SETS } = await import('./src/scene/environments/sets.js');

export const DT = 1 / 30;
const PLAYS_GROUP = new Set(Object.keys(PLAYS).filter((id) => PLAYS[id] === 'group'));

/** The Blender sets (environments/*.glb) as three groups, once. */
let _groups = null;
export async function loadSets() {
  if (_groups) return _groups;
  _groups = {};
  for (const name of ['diner', 'big_house', 'street']) {
    const bytes = readFileSync(join(root, 'environments', `${name}.glb`));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    _groups[name] = gltf.scene;
  }
  return _groups;
}

/** A curated bundle: { events, beats } (episodes/<slug>/). */
export function loadEpisode(slug) {
  const dir = join(root, 'episodes', slug);
  const events = parseNdjson(readFileSync(join(dir, 'events.ndjson'), 'utf8'));
  const beats = existsSync(join(dir, 'beats.json')) ? JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')) : null;
  return { events, beats };
}

const _ha = new THREE.Vector3(), _hb = new THREE.Vector3();
/** World centre of b's head (its glide position + bob + the social and play offsets) and its radius (half-width). */
export const headOf = (b, out) => b.head.group.getWorldPosition(out);
export const headRadius = (b) => b.unit * b.group.scale.x;

/**
 * Plays one episode. Returns the meter's numbers: frames, overlapFrames (frames with an unintended overlap),
 * worst (deepest unintended penetration, m), overlapSec (pair-seconds of unintended overlap), intended (pair-frames
 * of intended contact), the worst offenders, every move order with its arrival, and a fingerprint of the run.
 * opts: { seconds (cap), each(frame, ctx) }.
 */
export async function simulate(slug, { seconds = Infinity, each = null, tolerance = 0.005, episode = null } = {}) {
  const groups = await loadSets();
  const { events: bundle, beats } = episode ?? loadEpisode(slug);
  const song = arrange(bundle, beats);
  const events = song.events;
  const lineOf = new Map(song.lines.map((l) => [l.seq, l]));
  const timingOf = (e) => {
    const l = lineOf.get(e.seq);
    if (!l) return null;
    const notes = l.job.notes;
    return { delay: Math.max(0, l.at - e.t), length: notes.at(-1).t + notes.at(-1).dur, syllables: notes.map((n) => ({ t0: n.t, t1: n.t + n.dur })) };
  };
  resetPlays();
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const viewer = new THREE.Vector3(0, 2.1, 6.6);
  for (const b of bots.values()) b.viewer = viewer;
  const acting = new Acting();
  const blocking = new Blocking({ bots, scene: new THREE.Scene(), contact: (a, b) => acting.partnered?.(a, b) ?? false });
  for (const [n, g] of Object.entries(groups)) blocking.addSet(n, g);
  blocking.load(beats, events);
  const clock = { time: 0, beatSec: 60 / song.tempo, playing: true, bots, viewer };

  // move orders: every walkTo to a new spot, till the bot is there (a cut / place() ends it unreached)
  let now = 0;
  const orders = [];
  const open = new Map();
  for (const b of bots.values()) {
    const walkTo = b.walkTo.bind(b), place = b.place.bind(b);
    b.walkTo = (v, opts) => {
      const cur = open.get(b);
      if (!cur || Math.hypot(cur.x - v.x, cur.z - v.z) > 0.02) {
        if (cur) cur.end = 'replaced';
        const o = { bot: b.name, t: now, x: v.x, z: v.z, from: Math.hypot(b.pos.x - v.x, b.pos.z - v.z), arrived: null, end: null };
        if (o.from > 0.15) { orders.push(o); open.set(b, o); } else open.delete(b);
      }
      return walkTo(v, opts);
    };
    b.place = (v, yaw) => {
      const cur = open.get(b);
      if (cur) {
        // an exit is over once the bot is out of the door (blocking.js parks it near its spot outside)
        if (Math.hypot(b.pos.x - cur.x, b.pos.z - cur.z) < 0.7) cur.arrived = now - cur.t;
        cur.end = 'placed';
        open.delete(b);
      }
      return place(v, yaw);
    };
  }
  blocking.reset();

  const nearestBot = (bot) => {
    let best = null, dBest = Infinity;
    for (const b of bots.values()) {
      if (b === bot || !blocking.isOn(b)) continue;
      const d = b.group.position.distanceToSquared(bot.group.position);
      if (d < dBest) { dBest = d; best = b; }
    }
    return best;
  };
  const castOf = (e, bot) => {
    const beat = beats?.beats?.find((x) => x.id === e.beat);
    return [bot, ...(beat?.cast ?? []).map((n) => bots.get(n)).filter((b) => b && b !== bot)];
  };
  const partnerOf = (e, bot, cues) => {
    for (const n of [...(e.consult ?? []), ...cues.map((c) => c.name)]) {
      const b = bots.get(n);
      if (b && b !== bot) return b;
    }
    return nearestBot(bot);
  };
  let lastStaged = null;
  // main.js stage(), the parts that move bots, heads and hands (no camera, no audio, no captions)
  const stage = (e) => {
    const bot = bots.get(e.singer ?? e.bot);
    const line = parseLyric(e.lyric, NAMES);
    if (bot && e.part === 'backing') { bot.sing(2.2, '', timingOf(e)); return; }
    if (bot && (e.part === 'reply' || e.part === 'echo')) { if (line.text) bot.sing(2.2, line.text, timingOf(e)); return; }
    if (!bot) return;
    const chorus = lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bot;
    if (line.text) bot.sing(2.2, chorus ? '' : line.text, timingOf(e));
    if (!chorus) blocking.onEvent(e, bot);
    if (!chorus && blocking.changed) resetPlays();
    if (e.status === 'consulting') acting.consult(bot, (e.consult ?? []).map((c) => bots.get(c)).filter(Boolean));
    if (!chorus) acting.reactToCues(line.cues, bot, bots);
    const partner = partnerOf(e, bot, line.cues);
    const r = resolveAction(e.action);
    if (r.kind === 'play') startPlay(r.id, bot, PLAYS_GROUP.has(r.id) ? castOf(e, bot).slice(1) : partner ? [partner] : [], { ...clock, playing: true });
    else if (r.kind === 'gesture') playGesture(bot, r.id);
    else if (r.kind === 'act') playAct(bot, r.id);
    else if (r.kind === 'move') blocking.move(r, bot);
    else if (r.kind === 'light') blocking.light(r, bot);
    accentAction(bot, r);
    if (!chorus) lastStaged = { t: e.t, lyric: e.lyric, bot };
  };

  /** Are a and b in contact on purpose now? (a hand play together, a consultation, a bump / poke) */
  const plays = () => runningPlays();
  const intended = (a, b, running) => {
    if (a.handPlay?.other === b || b.handPlay?.other === a) return 'play';
    for (const s of running) if (s.cast.includes(a) && s.cast.includes(b)) return 'play';
    const ma = acting.members.get(a), mb = acting.members.get(b);
    if (ma && mb && acting.partners(ma, mb)) return 'acting';
    return null;
  };

  const end = Math.min(seconds, song.end + 4);
  const list = [...bots.values()];
  const heads = list.map(() => new THREE.Vector3());
  let frames = 0, overlapFrames = 0, worst = 0, overlapSec = 0, intendedFrames = 0, intendedPairs = 0;
  const offenders = new Map();
  const incidents = [], live = new Map();
  const worstAt = { t: 0, a: null, b: null, depth: 0, set: null };
  let k = 0;
  let hash = 2166136261;
  // at the end of each beat (just before the next one is staged): the scene's bots off their marks
  let lastBeat = null, offNow = 0, onNow = 0, beatEnds = 0, offMarks = 0, onMarks = 0, offList = [];
  const offDetails = [];
  // restlessness: bot-seconds a bot near the mark it has had for 3 s still drifts (> 5 cm/s): jitter, circling
  const since = new Map();
  let restless = 0;
  const mix = (x) => { hash = Math.imul(hash ^ (Math.round(x * 1e4) | 0), 16777619); };
  while (now < end) {
    now += DT;
    clock.time = now;
    while (k < events.length && events[k].t <= now) stage(events[k++]);
    if (blocking.beat !== lastBeat) {
      if (lastBeat !== null) { beatEnds++; offMarks += offNow; onMarks += onNow; if (offList.length) offDetails.push(`${now.toFixed(1)} ${lastBeat}: ${offList.join(' ')}`); }
      lastBeat = blocking.beat;
    }
    const def = blocking.def;
    const w = def.camera?.wide?.[0]?.pos;
    if (blocking.inSet && w) viewer.set(w[0], w[1], w[2]); else viewer.set(0, 2.1, 6.6);
    blocking.update(DT);
    acting.update(DT, bots, clock);
    updatePlays(DT, clock);
    for (const b of list) b.update(DT, now, clock);
    frames++;
    // arrivals
    for (const [b, o] of open) {
      if (Math.hypot(b.pos.x - o.x, b.pos.z - o.z) < 0.1) { o.arrived = now - o.t; open.delete(b); }
    }
    // the meter
    const running = plays();
    let bad = false;
    list.forEach((b, i) => headOf(b, heads[i]));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.group.visible) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.group.visible) continue;
        const depth = headRadius(a) + headRadius(b) - heads[i].distanceTo(heads[j]);
        if (depth <= tolerance) continue;
        if (intended(a, b, running)) { intendedPairs++; continue; }
        bad = true;
        overlapSec += DT;
        const key = `${a.name}/${b.name}`;
        offenders.set(key, (offenders.get(key) ?? 0) + 1);
        // an incident: a pair's run of overlapping frames (its context at the start, its deepest)
        let inc = live.get(key);
        if (!inc || inc.last < frames - 1) {
          const who = (x) => {
            const m = acting.members.get(x);
            return { n: x.name, mv: x.moving, mode: blocking.state.get(x).mode, hp: x.handPlay?.id ?? null, soc: +(x.head.socialOffset?.length() ?? 0).toFixed(2),
              play: +x.playOffset.length().toFixed(2), sc: !!m?.scene, ap: m?.play?.kind ?? null, sp: +Math.hypot(x.vel.x, x.vel.z).toFixed(2) };
          };
          inc = { t: +now.toFixed(2), set: blocking.set, act: blocking.activity?.kind ?? null, body: +Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z).toFixed(2), a: who(a), b: who(b), depth: 0, frames: 0 };
          incidents.push(inc);
          live.set(key, inc);
        }
        inc.last = frames;
        inc.frames++;
        inc.depth = Math.max(inc.depth, +depth.toFixed(3));
        if (depth > worst) { worst = depth; Object.assign(worstAt, { t: +now.toFixed(2), a: a.name, b: b.name, depth: +depth.toFixed(3), set: blocking.set, am: a.moving, bm: b.moving }); }
      }
    }
    if (bad) overlapFrames++;
    offNow = 0;
    onNow = 0;
    offList = [];
    for (const b of list) {
      if (!blocking.isOn(b) || blocking.state.get(b).mode !== 'on') continue;
      onNow++;
      const off = Math.hypot(b.pos.x - b.target.x, b.pos.z - b.target.z);
      if (off > 0.15) { offNow++; offList.push(`${b.name}:${off.toFixed(2)}${b.handPlay ? '(hp)' : ''}${blocking.held.has(b) ? '(held)' : ''}`); }
    }
    for (const b of list) {
      if (!b.group.visible) continue;
      const s0 = since.get(b);
      if (!s0 || Math.abs(s0.x - b.target.x) + Math.abs(s0.z - b.target.z) > 1e-3) { since.set(b, { x: b.target.x, z: b.target.z, t: now }); continue; }
      if (now - s0.t > 3 && b.via.length === 0 && Math.hypot(b.pos.x - b.target.x, b.pos.z - b.target.z) < 0.3 && Math.hypot(b.vel.x, b.vel.z) > 0.05) restless += DT;
    }
    if (running.some((s) => s.cast.length > 1)) intendedFrames++;
    each?.({ now, frames, bots, blocking, acting, heads, list });
    if (frames % 15 === 0) for (const b of list) { mix(b.pos.x); mix(b.pos.z); mix(b.head.group.position.x); }
  }
  for (const o of open.values()) o.end ??= 'unreached';
  return {
    slug, frames, seconds: +(frames * DT).toFixed(2), overlapFrames, worst: +worst.toFixed(3), overlapSec: +overlapSec.toFixed(2),
    intendedFrames, intendedPairs, worstAt, offenders: [...offenders].sort((x, y) => y[1] - x[1]).slice(0, 5), orders, incidents, beatEnds, offMarks, onMarks, offDetails, restless: +restless.toFixed(2), fingerprint: hash >>> 0,
  };
}

/** Arrival stats of a run, optionally against a baseline run's orders (same bot, same order time, same spot). */
export function arrivalStats(run, base = null) {
  const done = run.orders.filter((o) => o.arrived !== null);
  const out = { orders: run.orders.length, arrived: done.length, maxArrive: Math.max(0, ...done.map((o) => o.arrived)) };
  out.unreached = run.orders.filter((o) => o.arrived === null && o.end === 'unreached').length;
  if (base) {
    const key = (o) => `${o.bot}|${o.t.toFixed(2)}|${o.x.toFixed(2)}|${o.z.toFixed(2)}`;
    const was = new Map(base.orders.map((o) => [key(o), o]));
    let matched = 0, both = 0, maxExtra = 0, sumExtra = 0, lost = 0, worstExtra = null;
    for (const o of run.orders) {
      const b = was.get(key(o));
      if (!b) continue;
      matched++;
      if (b.arrived !== null && o.arrived === null) lost++; // got there before, not now (re-directed first, or never)
      if (b.arrived === null || o.arrived === null) continue;
      both++;
      const extra = o.arrived - b.arrived;
      sumExtra += extra;
      if (extra > maxExtra) { maxExtra = extra; worstExtra = { ...o, base: b.arrived }; }
    }
    Object.assign(out, { matched, maxExtra: +maxExtra.toFixed(2), meanExtra: +(sumExtra / Math.max(1, both)).toFixed(3), lost, worstExtra });
  }
  return out;
}

// --- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const jsonOut = opt('--json'), compare = opt('--compare'), tol = opt('--tol');
  const slugs = args.length ? args : SEEDS.map(([s]) => s);
  const base = compare ? JSON.parse(readFileSync(compare, 'utf8')) : null;
  const runs = {};
  const rows = [];
  for (const slug of slugs) {
    const t0 = Date.now();
    const r = await simulate(slug, tol !== null ? { tolerance: Number(tol) } : {});
    runs[slug] = r;
    const a = arrivalStats(r, base?.[slug]);
    const b = base?.[slug];
    rows.push({
      episode: slug, sec: r.seconds,
      ...(b ? { 'before frames': b.overlapFrames, 'before worst': b.worst, 'before pair-s': b.overlapSec } : {}),
      frames: r.overlapFrames, worst: r.worst, 'pair-s': r.overlapSec, intended: r.intendedPairs,
      'off marks': `${r.offMarks}/${r.onMarks}${b ? ` (was ${b.offMarks})` : ''}`, restless: `${r.restless}${b ? ` (was ${b.restless})` : ''}`, arrived: `${a.arrived}/${a.orders}`, maxArrive: +a.maxArrive.toFixed(2), ...(b ? { maxExtra: a.maxExtra, meanExtra: a.meanExtra, lost: a.lost } : {}),
      ms: Date.now() - t0,
    });
    console.error(slug, JSON.stringify(r.worstAt), JSON.stringify(r.offenders));
  }
  console.table(rows);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(runs));
}
