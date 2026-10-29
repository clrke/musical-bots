// Headless checks for the sets stream: set resolution per beat, mark lookup, marks and slots clear
// of the real furniture (the .glb sets), deterministic paths around it, and the blocking itself:
// the beat's cast on set, the rest parked, entrances, moves, no overlaps, the same result every run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }) };
globalThis.Image = class { set src(v) { /* never loads headless */ } };

const { SETS, SET_NAMES, MOODS, resolveSets, setsNeeded, setName, markOf, nearestEntrance, loopLength, loopPoint, loopNearest } =
  await import('./src/scene/environments/sets.js');
const { obstaclesFromGroup, activeBoxes, planPath, pushOut, segmentHitsBox, pathLength } = await import('./src/scene/environments/pathing.js');
const { Blocking, beatCast, studioHome } = await import('./src/blocking.js');
const { Bot } = await import('./src/rig.js');
const { NAMES } = await import('./src/gen/cast.js');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

// 1. set resolution: beats[].set, else the previous beat's set, else the studio; ?set= overrides
{
  const beats = { beats: [{ id: 'a' }, { id: 'b', set: 'diner' }, { id: 'c' }, { id: 'd', set: 'Big House' },
    { id: 'e', set: 'moon' }, { id: 'f', set: 'street' }, { id: 'g', set: 'studio' }, { id: 'h' }] };
  assert.deepEqual([...resolveSets(beats).entries()], [['a', 'studio'], ['b', 'diner'], ['c', 'diner'], ['d', 'big_house'],
    ['e', 'big_house'], ['f', 'street'], ['g', 'studio'], ['h', 'studio']]);
  assert.deepEqual([...resolveSets(beats, 'street').values()], Array(8).fill('street'));
  assert.deepEqual([...resolveSets(beats, 'nowhere').values()][1], 'diner'); // an unknown override is ignored
  assert.deepEqual(setsNeeded(beats).sort(), ['big_house', 'diner', 'street']);
  assert.deepEqual(setsNeeded(null, 'diner'), ['diner']);
  assert.equal(resolveSets(null).size, 0);
  assert.equal(setName('BIG_HOUSE'), 'big_house');
  assert.equal(setName('big-house'), 'big_house');
  assert.equal(setName('the moon'), null);
  for (const n of SET_NAMES) assert.ok(SETS[n], `SETS.${n}`);
}

// 2. mark lookup: names, case, separators, aliases, 'gathering'; unknown -> null
{
  const m = markOf('diner', 'counter');
  assert.deepEqual([m.x, m.z, m.y], SETS.diner.marks.counter);
  assert.equal(markOf('diner', 'The Counter').name, 'counter');
  assert.equal(markOf('diner', 'gate').name, 'door');
  assert.equal(markOf('diner', 'window_right').name, 'window-right');
  assert.equal(markOf('diner', 'booths').name, 'booth');
  assert.equal(markOf('big_house', 'couch').name, 'sofa');
  assert.equal(markOf('big_house', 'Front Door').name, 'porch');
  assert.equal(markOf('big_house', 'staircase').name, 'stairs');
  assert.equal(markOf('street', 'streetlamp').name, 'lamp');
  assert.equal(markOf('street', 'zebra').name, 'crossing');
  assert.equal(markOf('street', 'bus_stop').name, 'bus-stop');
  assert.equal(markOf('street', 'gathering').name, 'gathering');
  assert.equal(markOf('street', 'stage').y, 1.25);
  assert.equal(markOf('diner', 'fireplace'), null); // not in this set
  assert.equal(markOf('diner', ''), null);
  assert.equal(markOf('studio', 'counter'), null);
  // every set has the marks the brief asks for
  for (const [set, names] of Object.entries({ diner: ['counter', 'booth', 'door', 'window', 'kitchen', 'stage', 'gathering'],
    big_house: ['porch', 'garden', 'kitchen', 'stage', 'gathering'], street: ['lamp', 'fence', 'crossing', 'stage', 'gathering'] })) {
    for (const n of names) assert.ok(markOf(set, n), `${set} has ${n}`);
  }
  assert.equal(nearestEntrance('diner', -4, -3).name, 'door');
  assert.equal(nearestEntrance('street', 6, 0).name, 'right');
  assert.ok(Object.keys(MOODS).length === 7);
}

// 3. the parade loop helpers
{
  const sq = [[0, 0], [2, 0], [2, 1], [0, 1]];
  assert.equal(loopLength(sq), 6);
  assert.deepEqual(loopPoint(sq, 3), [2, 1]);
  assert.deepEqual(loopPoint(sq, -1), [0, 1]);
  assert.deepEqual(loopPoint(sq, 7), [1, 0]);
  assert.ok(Math.abs(loopNearest(sq, 1, -0.5) - 1) < 1e-9);
  assert.ok(Math.abs(loopNearest(sq, 2.5, 0.5) - 2.5) < 1e-9);
}

// 4. the real sets: furniture as obstacles; marks, slots and entrances clear of it
const groups = {};
for (const name of ['diner', 'big_house', 'street']) {
  const bytes = readFileSync(join(root, 'environments', `${name}.glb`));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  groups[name] = gltf.scene;
}
const clearAt = (obstacles, x, z, y, r = 0.3) => {
  const boxes = activeBoxes(obstacles, { radius: r, yLo: y - 0.28, yHi: y + 0.3 });
  return boxes.filter((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1).map((b) => b.name);
};
for (const [name, group] of Object.entries(groups)) {
  const def = SETS[name];
  const obstacles = obstaclesFromGroup(group, THREE.Box3);
  assert.ok(obstacles.length > 10, `${name}: ${obstacles.length} obstacles`);
  assert.ok(!obstacles.some((o) => /^(Floor|Road|Rug|Ceiling)/.test(o.name)), `${name}: floor/ceiling are not obstacles`);
  for (const [mark, m] of Object.entries(def.marks)) {
    assert.deepEqual(clearAt(obstacles, m[0], m[1], m[2] ?? def.headY), [], `${name} mark ${mark} inside furniture`);
  }
  def.gather.forEach((g, i) => {
    assert.deepEqual(clearAt(obstacles, g[0], g[1], g[2]), [], `${name} gather ${i} inside furniture`);
    def.gather.forEach((h, j) => {
      if (j > i) assert.ok(Math.hypot(g[0] - h[0], g[1] - h[1]) > 1.0, `${name} gather ${i}/${j} too close`);
    });
    const st = markOf(def, 'stage');
    assert.ok(Math.hypot(g[0] - st.x, g[1] - st.z) > 1.0, `${name} gather ${i} on the stage mark`);
  });
  for (const [en, e] of Object.entries(def.entrances)) {
    assert.deepEqual(clearAt(obstacles, e.inside[0], e.inside[1], def.headY), [], `${name} entrance ${en} inside`);
    // the way in from outside is open (through the doorway, between the jambs)
    const boxes = activeBoxes(obstacles, { radius: 0.22, yLo: def.headY - 0.28, yHi: def.headY + 0.3 })
      .filter((b) => !(e.outside[0] > b.x0 && e.outside[0] < b.x1 && e.outside[1] > b.z0 && e.outside[1] < b.z1));
    assert.ok(!boxes.some((b) => segmentHitsBox(e.outside[0], e.outside[1], e.inside[0], e.inside[1], b)), `${name} ${en} doorway blocked`);
  }
  // the parade loop runs in the open
  const loop = def.parade.loop;
  for (let s = 0; s < loopLength(loop); s += 0.25) {
    const p = loopPoint(loop, s);
    assert.deepEqual(clearAt(obstacles, p[0], p[1], def.parade.y, 0.28), [], `${name} parade at ${s}`);
  }
  // wide shots stand inside the camera bounds
  const cb = def.camera.bounds;
  for (const w of def.camera.wide) {
    assert.ok(w.pos[0] >= cb[0] && w.pos[0] <= cb[1] && w.pos[1] >= cb[2] && w.pos[1] <= cb[3] && w.pos[2] >= cb[4] && w.pos[2] <= cb[5], `${name} wide ${w.pos}`);
  }
}

// 5. paths: around the counter, never through a box, the same every time
{
  const obstacles = obstaclesFromGroup(groups.diner, THREE.Box3);
  const boxes = activeBoxes(obstacles, { radius: 0.34, yLo: 0.9, yHi: 1.52 });
  const from = [-2.85, -3.25], to = [2.85, -3.25]; // window to window: the counter is in between
  const p1 = planPath(from, to, boxes, { bounds: SETS.diner.bounds });
  const p2 = planPath(from, to, boxes, { bounds: SETS.diner.bounds });
  assert.deepEqual(p1, p2, 'deterministic');
  assert.ok(p1.length >= 2, `a detour: ${JSON.stringify(p1)}`);
  assert.deepEqual(p1.at(-1), to);
  let a = from;
  for (const p of p1) {
    for (const b of boxes) assert.ok(!segmentHitsBox(a[0], a[1], p[0], p[1], b), `segment ${a} -> ${p} hits ${b.name}`);
    a = p;
  }
  assert.ok(pathLength(from, p1) > 5.7 && pathLength(from, p1) < 8, `detour length ${pathLength(from, p1)}`);
  // a clear line stays straight; a goal inside furniture is pushed out
  assert.deepEqual(planPath([0, 1], [1, 0.5], boxes), [[1, 0.5]]);
  const [gx, gz] = planPath([0, 0], [0, -3.3], boxes).at(-1); // inside the counter
  assert.ok(!boxes.some((b) => gx > b.x0 && gx < b.x1 && gz > b.z0 && gz < b.z1), `pushed out ${gx},${gz}`);
  assert.deepEqual(pushOut(5, 5, [{ x0: 4, x1: 6, z0: 4, z1: 5.5 }]), [5, 5.5 + 0.02]);
}

// 6. the blocking over a whole test episode, twice: deterministic, cast on set, no overlaps
const beatsJson = JSON.parse(readFileSync(join(root, 'episodes/toy-box/beats.json'), 'utf8'));
const events = readFileSync(join(root, 'episodes/toy-box/events.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const SETS_OF = ['street', 'street', 'diner', 'diner', 'big_house', 'big_house', 'street', 'diner', 'diner', 'big_house', 'street'];
beatsJson.beats.forEach((b, i) => { b.set = SETS_OF[i]; });
beatsJson.roles = { lead: 'Benny' };
const ACT = { 6: 'huddle', 9: 'walk-to-counter', 12: 'lights-party', 13: 'march', 16: 'walk-to-fireplace', 19: 'march',
  26: 'exit', 27: 'lights-night', 30: 'walk-to-Teddy', 33: 'gather', 37: 'march' };
for (const e of events) if (ACT[e.seq]) e.action = ACT[e.seq];
const { resolveAction } = await import('./src/actions.js');

function run(log) {
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const cues = [];
  const stage = { mood: (m) => cues.push(`mood:${m}`), spot: (b) => cues.push(`spot:${b?.name ?? '-'}`), show: (n) => cues.push(`show:${n}`) };
  const blocking = new Blocking({ bots, scene: new THREE.Scene(), stage });
  for (const [n, g] of Object.entries(groups)) blocking.addSet(n, g);
  blocking.load(beatsJson, events);
  blocking.reset();
  const dt = 1 / 30;
  let t = 0, k = 0;
  const exited = new Set();
  const checkBeat = (beatId) => {
    // settled: the beat's cast is on set and visible, the rest hidden or seated, nobody overlaps
    const def = blocking.def;
    const cast = beatCast(beatsJson.beats.find((b) => b.id === beatId), events.filter((e) => e.beat === beatId), NAMES);
    const on = blocking.onSet().map((b) => b.name);
    for (const n of cast) if (!exited.has(n)) assert.ok(on.includes(n), `${beatId}: ${n} on set`);
    for (const n of exited) assert.ok(['leaving', 'off'].includes(blocking.state.get(bots.get(n)).mode), `${beatId}: ${n} exited`);
    exited.clear();
    const extras = [...bots.values()].filter((b) => blocking.state.get(b).mode === 'extra');
    assert.ok(extras.length <= (def.extras ?? []).length, `${beatId}: ${extras.length} extras`);
    for (const b of bots.values()) {
      const st = blocking.state.get(b);
      if (st.mode === 'off') assert.equal(b.group.visible, false, `${beatId}: ${b.name} off but visible`);
    }
    const vis = [...bots.values()].filter((b) => b.group.visible && blocking.state.get(b).mode === 'on' && !b.moving);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i].pos, c = vis[j].pos;
      if (Math.abs(a.y - c.y) > 0.55) continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z), min = (vis[i].unit + vis[j].unit) * 2.4 * 0.85;
      assert.ok(d > min, `${beatId}: ${vis[i].name} and ${vis[j].name} overlap (${d.toFixed(2)} < ${min.toFixed(2)})`);
    }
    if (blocking.inSet) {
      for (const b of vis) assert.deepEqual(clearAt(blocking.obstacles, b.pos.x, b.pos.z, b.pos.y, 0.12), [], `${beatId}: ${b.name} in furniture at ${b.pos.x.toFixed(2)},${b.pos.z.toFixed(2)}`);
    }
    log.push(`${beatId}@${blocking.set}: ${on.join(',')}`);
  };
  let beat = beatsJson.beats[0].id;
  const end = events.at(-1).t + 12;
  for (let f = 0; t < end; f++) {
    while (k < events.length && events[k].t <= t) {
      const e = events[k++];
      const bot = bots.get(e.singer ?? e.bot);
      if (e.beat !== beat) { checkBeat(beat); beat = e.beat; }
      blocking.onEvent(e, bot);
      if (blocking.changed) log.push(`cut:${blocking.set}@${t.toFixed(2)}`);
      const r = resolveAction(e.action);
      if (r.kind === 'move') blocking.move(r, bot);
      if (r.kind === 'move' && r.id === 'exit') exited.add(bot.name);
      else if (r.kind === 'light') blocking.light(r, bot);
    }
    blocking.update(dt);
    for (const b of bots.values()) b._move(dt);
    t += dt;
  }
  checkBeat(beat);
  log.push(...cues);
  return [...bots.values()].map((b) => `${b.name}:${b.pos.toArray().map((x) => x.toFixed(4)).join(',')}:${b.group.visible}`);
}
const logA = [], logB = [];
const a = run(logA), b = run(logB);
assert.deepEqual(a, b, 'the same positions every run');
assert.deepEqual(logA, logB);
const cuts = logA.filter((l) => l.startsWith('cut:'));
assert.deepEqual(cuts.map((c) => c.split('@')[0]), ['cut:diner', 'cut:big_house', 'cut:street', 'cut:diner', 'cut:big_house', 'cut:street']);
assert.ok(logA.includes('mood:party') && logA.includes('mood:night') && logA.includes('mood:gold'), 'light cues reach the stage');
assert.ok(logA.includes('spot:Benny'), 'spot-hero lights the lead');

// 7. walk-to: a mark (beside it when taken), a bot (beside it), a mark this set lacks (the stage); exit
{
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const blocking = new Blocking({ bots, scene: new THREE.Scene() });
  blocking.addSet('diner', groups.diner);
  const beats = { beats: [{ id: 'b1', section: 'verse1', set: 'diner', cast: ['Teddy', 'Lou', 'Ivy'] }] };
  const evs = [{ seq: 0, t: 0, beat: 'b1', bot: 'Teddy', lyric: 'la', action: '', consult: [], chords: [] }];
  blocking.load(beats, evs);
  blocking.reset();
  const [teddy, lou, ivy] = ['Teddy', 'Lou', 'Ivy'].map((n) => bots.get(n));
  const settle = () => { for (let f = 0; f < 300; f++) { blocking.update(1 / 30); for (const b of bots.values()) b._move(1 / 30); } };
  const counter = markOf('diner', 'counter');
  assert.ok(Math.hypot(teddy.pos.x - counter.x, teddy.pos.z - counter.z) < 0.05, 'Teddy starts at the counter (spread)');
  blocking.move(resolveAction('walk-to-counter'), lou);
  settle();
  const dc = Math.hypot(lou.pos.x - counter.x, lou.pos.z - counter.z);
  assert.ok(dc > 0.95 && dc < 2.4, `Lou beside the taken counter mark (${dc.toFixed(2)})`);
  blocking.move(resolveAction('walk-to-Teddy'), ivy);
  settle();
  const dt = Math.hypot(ivy.pos.x - teddy.pos.x, ivy.pos.z - teddy.pos.z);
  assert.ok(dt > 0.85 && dt < 1.6, `Ivy beside Teddy (${dt.toFixed(2)})`);
  const stage = markOf('diner', 'stage');
  blocking.move(resolveAction('walk-to-fireplace'), ivy); // no fireplace in the diner
  settle();
  assert.ok(Math.hypot(ivy.pos.x - stage.x, ivy.pos.z - stage.z) < 1.3, 'an unknown mark falls back to the stage');
  blocking.move(resolveAction('exit'), lou);
  settle();
  assert.equal(blocking.state.get(lou).mode, 'off');
  assert.equal(lou.group.visible, false);
  assert.ok(!blocking.onSet().includes(lou), 'an exited bot is out of the scene');
}

// 8. a short real update (heads + hands) after the blocking moved the bots: finite, walking resets
{
  const bot = new Bot('Teddy', new THREE.Vector3(0, 1.2, 0), 7);
  bot.walkTo(new THREE.Vector3(3, 1.2, 0));
  let maxWalk = 0;
  for (let f = 0; f < 120; f++) { bot.update(1 / 30, f / 30); maxWalk = Math.max(maxWalk, bot.walk); }
  assert.ok(maxWalk > 0.6, `walk ${maxWalk}`);
  assert.ok(Math.abs(bot.yaw - Math.PI / 2) < 0.5 || bot.pos.x > 2.9, 'faces the way it goes');
  for (let f = 0; f < 240; f++) bot.update(1 / 30, 4 + f / 30);
  assert.ok(bot.pos.distanceTo(new THREE.Vector3(3, 1.2, 0)) < 0.02 && bot.walk < 0.05 && Math.abs(bot.yaw) < 0.05, 'arrives, stops, faces front');
}
console.log(`blocking ok: sets per beat, ${Object.keys(SETS).length} sets' marks clear of furniture, deterministic paths, ${cuts.length} scene changes, ${logA.filter((l) => l.includes('@') && !l.startsWith('cut')).length} beats blocked twice identically`);
