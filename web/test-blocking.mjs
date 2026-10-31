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

// 1. set resolution: beats[].set, else the previous beat's set, else the diner; an old 'studio' (the retired grey
// stage) plays in the diner; ?set= overrides
{
  const beats = { beats: [{ id: 'a' }, { id: 'b', set: 'diner' }, { id: 'c' }, { id: 'd', set: 'Big House' },
    { id: 'e', set: 'moon' }, { id: 'f', set: 'street' }, { id: 'g', set: 'studio' }, { id: 'h' }] };
  assert.deepEqual([...resolveSets(beats).entries()], [['a', 'diner'], ['b', 'diner'], ['c', 'diner'], ['d', 'big_house'],
    ['e', 'big_house'], ['f', 'street'], ['g', 'diner'], ['h', 'diner']]);
  assert.deepEqual(SET_NAMES, ['diner', 'big_house', 'street'], 'three sets, no grey studio among them');
  assert.equal(setName('studio'), 'diner');
  assert.equal(setName('Studio'), 'diner');
  assert.deepEqual(setsNeeded(null), ['diner'], 'no beats (a v1 bundle, the idle screen): the diner');
  assert.deepEqual([...resolveSets(beats, 'studio').values()], Array(8).fill('diner'), '?set=studio: the diner');
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

// 6. the blocking over a whole test episode, twice: deterministic, cast on set, no overlaps (a frozen
//    v1 bundle, web/test-data/toy-box-v1: the actions below are injected by its seq numbers)
const { modernBundle } = await import('./src/cast16.js'); // the frozen bundle says Teddy: read in the colour names
const beatsJson = modernBundle(JSON.parse(readFileSync(join(root, 'web/test-data/toy-box-v1/beats.json'), 'utf8')));
const events = modernBundle(readFileSync(join(root, 'web/test-data/toy-box-v1/events.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const SETS_OF = ['street', 'street', 'diner', 'diner', 'big_house', 'big_house', 'street', 'diner', 'diner', 'big_house', 'street'];
beatsJson.beats.forEach((b, i) => { b.set = SETS_OF[i]; });
beatsJson.roles = { lead: 'Navy' };
const ACT = { 6: 'huddle', 9: 'walk-to-counter', 12: 'lights-party', 13: 'march', 16: 'walk-to-fireplace', 19: 'march',
  26: 'exit', 27: 'lights-night', 30: 'walk-to-Green', 33: 'gather', 37: 'march' };
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
assert.ok(logA.includes('spot:Navy'), 'spot-hero lights the lead');

// 7. walk-to: a mark (beside it when taken), a bot (beside it), a mark this set lacks (the stage); exit
{
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const blocking = new Blocking({ bots, scene: new THREE.Scene() });
  blocking.addSet('diner', groups.diner);
  const beats = { beats: [{ id: 'b1', section: 'verse1', set: 'diner', cast: ['Green', 'Gold', 'Red'] }] };
  const evs = [{ seq: 0, t: 0, beat: 'b1', bot: 'Green', lyric: 'la', action: '', consult: [], chords: [] }];
  blocking.load(beats, evs);
  blocking.reset();
  const [teddy, lou, ivy] = ['Green', 'Gold', 'Red'].map((n) => bots.get(n));
  const settle = () => { for (let f = 0; f < 300; f++) { blocking.update(1 / 30); for (const b of bots.values()) b._move(1 / 30); } };
  const counter = markOf('diner', 'counter');
  assert.ok(Math.hypot(teddy.pos.x - counter.x, teddy.pos.z - counter.z) < 0.05, 'Green starts at the counter (spread)');
  blocking.move(resolveAction('walk-to-counter'), lou);
  settle();
  const dc = Math.hypot(lou.pos.x - counter.x, lou.pos.z - counter.z);
  assert.ok(dc > 0.95 && dc < 2.4, `Gold beside the taken counter mark (${dc.toFixed(2)})`);
  blocking.move(resolveAction('walk-to-Green'), ivy);
  settle();
  const dt = Math.hypot(ivy.pos.x - teddy.pos.x, ivy.pos.z - teddy.pos.z);
  assert.ok(dt > 0.85 && dt < 1.6, `Red beside Green (${dt.toFixed(2)})`);
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
  const bot = new Bot('Green', new THREE.Vector3(0, 1.2, 0), 7);
  bot.walkTo(new THREE.Vector3(3, 1.2, 0));
  let maxWalk = 0;
  for (let f = 0; f < 120; f++) { bot.update(1 / 30, f / 30); maxWalk = Math.max(maxWalk, bot.walk); }
  assert.ok(maxWalk > 0.6, `walk ${maxWalk}`);
  assert.ok(Math.abs(bot.yaw - Math.PI / 2) < 0.5 || bot.pos.x > 2.9, 'faces the way it goes');
  for (let f = 0; f < 240; f++) bot.update(1 / 30, 4 + f / 30);
  assert.ok(bot.pos.distanceTo(new THREE.Vector3(3, 1.2, 0)) < 0.02 && bot.walk < 0.05 && Math.abs(bot.yaw) < 0.05, 'arrives, stops, faces front');
}

// 9. framing: the singer's lyric card stays in frame, above the lower third (studio front row and a set)
{
  const { fitFrame, measure, CARD_FLOOR, HEAD_ROOM, cardBounds } = await import('./src/framing.js');
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  const front = new Bot('Black', studioHome(10), 10); // the front row (y 0.75)
  const back = new Bot('Gold', studioHome(13), 13);
  for (let f = 0; f < 20; f++) { front.update(1 / 30, f / 30); back.update(1 / 30, f / 30); }
  const c = cardBounds(front);
  assert.ok(c.cardBottom < front.group.position.y - 0.3 && c.top > front.group.position.y + 0.2, `card under the head ${JSON.stringify(c)}`);
  // the old studio close-up: 1.7 m in front, 0.3 m above, looking at the head: the card fell off the bottom
  const p = front.group.position;
  const pos = new THREE.Vector3(p.x + 0.45, p.y + 0.3, p.z + 1.7), look = new THREE.Vector3(p.x, p.y + 0.1, p.z);
  assert.ok(measure(cam, pos, look, [front]).lo < CARD_FLOOR, 'the old framing cut the card');
  assert.ok(fitFrame(cam, pos, look, [front]), 'fitted');
  const m = measure(cam, pos, look, [front]);
  assert.ok(m.lo >= CARD_FLOOR - 1e-3 && m.hi <= HEAD_ROOM + 1e-3, `close-up: card ${m.lo.toFixed(3)}, head ${m.hi.toFixed(3)}`);
  // a two-shot of two bots far apart steps back until both cards fit across
  const a = new THREE.Vector3(), b2 = back.group.position;
  a.copy(p).add(b2).multiplyScalar(0.5);
  const pos2 = new THREE.Vector3(a.x, a.y + 0.45, a.z + 2.4), look2 = a.clone();
  assert.ok(fitFrame(cam, pos2, look2, [front, back]), 'two-shot fitted');
  const m2 = measure(cam, pos2, look2, [front, back]);
  assert.ok(m2.lo >= CARD_FLOOR - 1e-3 && m2.hi <= HEAD_ROOM + 1e-3 && m2.wide <= 0.951, `two-shot ${JSON.stringify(m2)}`);
  // tilt only (a wide): no step back, the card still clears the lower third when it can
  const pos3 = new THREE.Vector3(0, 2.1, 6.6), look3 = new THREE.Vector3(0, 1.1, 0);
  fitFrame(cam, pos3, look3, [front], { move: false });
  assert.deepEqual(pos3.toArray(), [0, 2.1, 6.6]);
  assert.ok(measure(cam, pos3, look3, [front]).lo >= CARD_FLOOR - 1e-3, 'wide: the card above the lower third');
}
// 10. a generated v2 episode as arranged (harmony copies, the pal's replies, backing parts): the cast on
// set without the backing singers, backing singers in the seats, parts and wordless events move nobody
{
  const { generate } = await import('./src/gen/index.js');
  const { arrange } = await import('./src/sing-plan.js');
  const { beats: gb, events: ge } = generate('Pink opens a diner on the street');
  const song = arrange(ge, gb);
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const blocking = new Blocking({ bots, scene: new THREE.Scene() });
  for (const [n, g] of Object.entries(groups)) blocking.addSet(n, g);
  blocking.load(gb, song.events);
  blocking.reset();
  assert.equal(blocking.set, 'diner');
  const first = gb.beats[0].id;
  const evs = song.events.filter((e) => e.beat === first);
  const cast = beatCast(gb.beats[0], evs, NAMES);
  const backing = (await import('./src/blocking.js')).backingOf(evs, NAMES);
  assert.ok(backing.length >= 2, `backing ${backing}`);
  for (const n of backing) if (!gb.beats[0].cast.includes(n) && !evs.some((e) => !e.part && (e.singer ?? e.bot) === n)) assert.ok(!cast.includes(n), `${n} (backing) not in the scene`);
  const pal = gb.roles.pal;
  if (evs.some((e) => e.part === 'reply')) assert.ok(cast.includes(pal), 'the pal who replies is on set');
  const seated = [...bots.values()].filter((b) => blocking.state.get(b).mode === 'extra').map((b) => b.name);
  assert.ok(seated.length && seated.every((n) => backing.includes(n)), `the backing singers sit in the background: ${seated} of ${backing}`);
  // parts and events without words: nobody is re-targeted
  const snapshot = () => [...bots.values()].map((b) => b.target.toArray().map((x) => x.toFixed(4)).join(',')).join('|');
  const before = snapshot();
  for (const e of evs.filter((x) => x.part)) blocking.onEvent(e, bots.get(e.singer ?? e.bot));
  blocking.onEvent({ ...evs[0], lyric: '', part: undefined }, bots.get(evs[0].bot));
  assert.equal(snapshot(), before, 'parts and wordless events move nobody');
  // the story's lines walk the whole song once: the scene changes once (diner -> street), cast sizes sane
  let cuts = 0, maxOn = 0;
  for (const e of song.events) {
    if (e.part) continue;
    const singerBot = bots.get(e.singer ?? e.bot);
    blocking.onEvent(e, singerBot);
    if (blocking.changed) cuts++;
    blocking.update(1 / 30);
    maxOn = Math.max(maxOn, blocking.onSet().length);
  }
  assert.equal(cuts, 1, 'one cut: diner to street');
  assert.equal(blocking.set, 'street');
  assert.ok(maxOn <= 10, `at most 10 bots in a scene (${maxOn})`);
}

// 11. no grey studio anywhere: every bundle's premiere (an old 'studio' beat in the diner), a v1 bundle and the idle
// screen (no beats: the diner) are shown in a real set, and the app builds no backdrop
const shown = [];
const fakeStage = { show: (n) => shown.push(n), load: async () => null, spot() {}, mood() {}, reset() {}, update() {} };
{
  const { readdirSync, existsSync } = await import('node:fs');
  const { arrange } = await import('./src/sing-plan.js');
  const { parseNdjson } = await import('./src/player.js');
  const eps = join(root, 'episodes');
  let n = 0;
  for (const slug of readdirSync(eps).filter((d) => existsSync(join(eps, d, 'events.ndjson')))) {
    const events = parseNdjson(readFileSync(join(eps, slug, 'events.ndjson'), 'utf8'));
    const beats = existsSync(join(eps, slug, 'beats.json')) ? modernBundle(JSON.parse(readFileSync(join(eps, slug, 'beats.json'), 'utf8'))) : null;
    const bots = new Map();
    NAMES.forEach((nm, i) => bots.set(nm, new Bot(nm, studioHome(i), i)));
    const blocking = new Blocking({ bots, scene: new THREE.Scene(), stage: fakeStage });
    for (const [name, group] of Object.entries(groups)) blocking.addSet(name, group);
    shown.length = 0;
    const song = arrange(events, beats);
    await blocking.prepare(beats, song.events);
    blocking.reset();
    for (const e of song.events) {
      if (!e.part) blocking.onEvent(e, bots.get(e.singer ?? e.bot));
      assert.ok(blocking.inSet && blocking.set !== 'studio', `${slug}: ${e.beat} plays in a set (${blocking.set})`);
    }
    assert.ok(shown.length && shown.every((s) => SET_NAMES.includes(s)), `${slug}: shown ${[...new Set(shown)]}`);
    if (slug === 'hackathon-win') assert.equal(blocking.setFor('beat-11-outro'), 'diner', 'the old studio outro: the diner');
    if (!beats) assert.deepEqual([...new Set(shown)], ['diner'], `${slug} (no beats): the diner`);
    n++;
  }
  assert.ok(n >= 14, `${n} bundles`);
  const main = readFileSync(join(root, 'web/src/main.js'), 'utf8'), env = readFileSync(join(root, 'web/src/scene/studio-env.js'), 'utf8');
  assert.ok(!/Backdrop/.test(main) && !/export function createStudioBackdrop/.test(env), 'no studio backdrop is built');
}

// 12. the making-of in the sets: the whole cast in each set's crew formation (inside the walls, clear of the
// furniture, no two heads touching), cut from set to set as the hackathon-win crew writes (CrewSets), its duets sung
// side by side in front of the crew; heads never in furniture nor in each other (a duet's pair and a hand play's cast
// excepted: contact on purpose), the shots' camera inside the set's camera bounds, looking into the room
{
  const { crewFormation, CrewSets, scoreMakingOf } = await import('./src/making-of-score.js');
  const { consult, updateActing, endDuets, partnered } = await import('./src/acting.js');
  const { setCloseShot, frontTwoShot, fitFrame, measure, topCut, faceBounds, MAKING_ROOF } = await import('./src/framing.js');
  const mcam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  let heldFaces = 0;
  const { SWARM } = await import('./src/swarm.js');
  const { parseNdjson } = await import('./src/player.js');
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  const viewer = new THREE.Vector3(0, 1.9, 6);
  for (const b of bots.values()) b.viewer = viewer;
  const blocking = new Blocking({ bots, scene: new THREE.Scene(), stage: fakeStage, contact: partnered });
  for (const [name, group] of Object.entries(groups)) blocking.addSet(name, group);
  shown.length = 0;
  const formation = (set) => crewFormation(NAMES, set);
  await blocking.crewStage(formation);
  assert.equal(blocking.set, 'diner', 'the crew starts in Gold\'s Diner');
  const r = (b) => b.unit * b.group.scale.x;
  const checkAt = (set) => {
    const f = formation(set);
    for (const b of bots.values()) {
      assert.ok(b.group.visible, `${set}: ${b.name} on stage`);
      assert.ok(b.pos.distanceTo(new THREE.Vector3(...f.get(b.name))) < 1e-6, `${set}: ${b.name} at its place`);
      assert.deepEqual(clearAt(blocking.obstacles, b.pos.x, b.pos.z, b.pos.y, r(b) + 0.05), [], `${set}: ${b.name} in furniture`);
    }
    const list = [...bots.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      assert.ok(a.pos.distanceTo(c.pos) > r(a) + r(c) + SWARM.margin, `${set}: ${a.name} and ${c.name} too close`);
    }
  };
  checkAt('diner');
  for (const set of ['street', 'big_house', 'diner']) {
    blocking.crewCut(set);
    assert.equal(blocking.set, set);
    assert.equal(shown.at(-1), set, 'a clean cut: the set shown at once');
    checkAt(set);
    // the shots of the crew stay in the set: a close-up of each, a two-shot of each pair of neighbours
    const def = SETS[set], cb = def.camera.bounds, bd = def.bounds;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const clamp = (p) => p.set(Math.min(cb[1], Math.max(cb[0], p.x)), Math.min(cb[3], Math.max(cb[2], p.y)), Math.min(cb[5], Math.max(cb[4], p.z)));
    const into = (what) => {
      clamp(pos);
      const d = look.clone().sub(pos).normalize();
      assert.ok(d.z < -0.3, `${set} ${what}: the camera looks into the set (${d.z.toFixed(2)})`);
      assert.ok(look.x > bd[0] && look.x < bd[1] && look.z > bd[2] && look.z < bd[3], `${set} ${what}: it looks at a point in the set`);
      assert.ok(pos.z > look.z, `${set} ${what}: from the audience side`);
    };
    const crew = ['Pink', 'Blue', 'White', 'Green', 'Gold', 'Gray', 'Yellow'].map((n) => bots.get(n));
    for (const b of bots.values()) for (const side of [-1, 1]) { setCloseShot(b.pos, def.audience, side, 0.3, pos, look); into(`close-up of ${b.name}`); }
    for (let k = 0; k + 1 < crew.length; k++) { frontTwoShot(crew[k].pos, crew[k + 1].pos, 0.2, pos, look); into(`two-shot ${crew[k].name} + ${crew[k + 1].name}`); }
    // the making-of's shots never leave a face of the crew behind cut by the top of the frame or under the banner
    // (main.js clearTop's step back: the faces it cuts held whole under MAKING_ROOF, the subjects' cards in frame)
    for (let k = 0; k + 1 < crew.length; k++) {
      const subjects = [crew[k], crew[k + 1]], others = [...bots.values()].filter((b) => !subjects.includes(b));
      frontTwoShot(crew[k].pos, crew[k + 1].pos, 0.2, pos, look);
      fitFrame(mcam, pos, look, subjects, { roof: MAKING_ROOF });
      const aim = () => { mcam.position.copy(pos); mcam.lookAt(look); mcam.updateMatrixWorld(true); };
      aim();
      const hold = new Set(topCut(mcam, others).map((c) => c.bot));
      const p0 = pos.clone(), l0 = look.clone();
      for (let pass = 0; pass < 3 && hold.size; pass++) {
        pos.copy(p0); look.copy(l0);
        fitFrame(mcam, pos, look, [...subjects, ...[...hold].map((b) => faceBounds(b))], { roof: MAKING_ROOF });
        aim();
        for (const c of topCut(mcam, others)) hold.add(c.bot);
      }
      if (hold.size) fitFrame(mcam, pos, look, subjects, { move: false, roof: MAKING_ROOF }); // (the subjects' cards before all)
      aim();
      heldFaces += hold.size;
      const what = `${set} two-shot ${crew[k].name} + ${crew[k + 1].name}`;
      assert.deepEqual(topCut(mcam, others).map((c) => c.bot.name), [], `${what}: a face cut at the top`);
      const m = measure(mcam, pos, look, subjects);
      assert.ok(m.hi <= MAKING_ROOF + 1e-3 && m.lo >= -0.68 - 1e-3, `${what}: the duet under the banner, its cards in frame (${m.hi.toFixed(2)}, ${m.lo.toFixed(2)})`);
    }
  }
  assert.ok(heldFaces > 0, 'the two-shots hold the crew behind them whole');
  // the hackathon-win making-of, played through: the cuts as CrewSets says, the duets (consult: acting.js), the blocking
  const ep = join(root, 'episodes', 'hackathon-win');
  const score = scoreMakingOf(parseNdjson(readFileSync(join(ep, 'events.ndjson'), 'utf8')), modernBundle(JSON.parse(readFileSync(join(ep, 'beats.json'), 'utf8'))),
    { production: JSON.parse(readFileSync(join(ep, 'director.json'), 'utf8')).wallSeconds, activity: parseNdjson(readFileSync(join(ep, 'activity.ndjson'), 'utf8')) });
  const plan = new CrewSets(score);
  blocking.reset();
  const DT = 1 / 15;
  let t = 0, i = 0, worst = 0, worstWhat = '', duetsSung = 0, inFurniture = '';
  const ctx = { time: 0, beatSec: 0.625, playing: true, bots, viewer };
  const staged = score.staged;
  const contact = (a, b) => partnered(a, b) || (a.handPlay && a.handPlay === b.handPlay);
  while (i < staged.length || t < score.end) {
    while (i < staged.length && staged[i].t <= t) {
      const e = staged[i++];
      const was = plan.set;
      if (plan.next(e) !== was) blocking.crewCut(plan.set);
      if (e.part) continue;
      const bot = bots.get(e.bot);
      blocking.onEvent(e, bot);
      if (e.status === 'consulting' && e.duet) {
        const others = e.consult.map((c) => bots.get(c)).filter((b) => b && b !== bot);
        if (others.length && consult(bot, others, e.duet)) duetsSung++;
      }
    }
    t += DT;
    ctx.time = t;
    blocking.update(DT);
    updateActing(DT, bots, ctx);
    for (const b of bots.values()) b.update(DT, t, ctx);
    if (Math.round(t / DT) % 5) continue;
    const list = [...bots.values()];
    for (let a = 0; a < list.length; a++) {
      const A = list[a];
      if (!inFurniture && clearAt(blocking.obstacles, A.pos.x, A.pos.z, A.pos.y, 0.12).length) inFurniture = `${A.name} at ${t.toFixed(1)} in ${blocking.set}`;
      const bd = blocking.def.bounds;
      assert.ok(A.pos.x > bd[0] && A.pos.x < bd[1] && A.pos.z > bd[2] && A.pos.z < bd[3], `${A.name} out of ${blocking.set} at ${t.toFixed(1)}`);
      for (let c = a + 1; c < list.length; c++) {
        const C = list[c];
        if (contact(A, C)) continue;
        const depth = r(A) + r(C) - A.pos.distanceTo(C.pos);
        if (depth > worst) { worst = depth; worstWhat = `${A.name}/${C.name} at ${t.toFixed(1)} s in ${blocking.set}`; }
      }
    }
  }
  endDuets();
  assert.equal(inFurniture, '', `a head in the furniture: ${inFurniture}`);
  assert.ok(worst <= 0.02, `heads overlap ${worst.toFixed(3)} m (${worstWhat})`);
  assert.ok(duetsSung >= 3, `${duetsSung} duets`);
  assert.deepEqual(plan.cuts.map((c) => c.set), ['street', 'diner']);
  assert.deepEqual([...new Set(shown)].sort(), ['big_house', 'diner', 'street']);
  assert.ok(!shown.includes('studio'), 'the making-of never shows the studio');
  await blocking.crewStage(null);
  assert.equal(blocking.crew, null);
  console.log(`making-of in the sets: 16 at their places in each set, ${plan.cuts.length} cuts (${plan.cuts.map((c) => `${c.set} at ${c.t.toFixed(0)} s`).join(', ')}), ${duetsSung} duets, heads ${worst.toFixed(3)} m apart at worst`);
}

console.log(`blocking ok: sets per beat, ${SET_NAMES.length} sets' marks clear of furniture, deterministic paths, ${cuts.length} scene changes, ${logA.filter((l) => l.includes('@') && !l.startsWith('cut')).length} beats blocked twice identically`);
