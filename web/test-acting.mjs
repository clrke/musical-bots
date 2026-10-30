// Headless checks for the acting (web/src/acting.js): every face act plays on cue (and shows on the
// face), every gesture and every v1 action id of the checked-in episodes shows something, the bots a
// line names react and glance with the singer, a consultation goes over, trades nods, agrees and
// comes back within its time, and the choir's social life is deterministic (same story twice, no
// Math.random) and never moves a bot off its mark.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

// --- minimal DOM stub (the lyrics panel draws on a 2D canvas; particle textures never load headless)
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
globalThis.document = {
  baseURI: 'http://localhost/',
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }),
};
globalThis.Image = class { set src(v) { /* never loads headless */ } };

const { Bot } = await import('./src/rig.js');
const { NAMES } = await import('./src/gen/cast.js');
const { studioHome } = await import('./src/blocking.js');
const { ACTS, GESTURES, PLAYS, resolveAction } = await import('./src/actions.js');
const { Acting, PROFILES, accentAction, gestureMode, playAct, playGesture } = await import('./src/acting.js');
const { HandGestures } = await import('./src/scene/hands.js');
const { ACT_NAMES, CHANNEL_COUNT } = await import('./src/scene/personality.js');
const { PERSONALITY_IDS } = await import('./src/model/schema.js');
const { CARD_LEAD } = await import('./src/sing-plan.js');
const { startPlay } = await import('./src/plays/index.js');

const FPS = 30, DT = 1 / FPS;
const choir = () => {
  const bots = new Map();
  NAMES.forEach((n, i) => bots.set(n, new Bot(n, studioHome(i), i)));
  return bots;
};
/** Steps acting + bots for `seconds` from song time t; returns the new t. each(t) runs after every frame. */
function run(acting, bots, seconds, t, each = null) {
  for (let f = 0; f < Math.round(seconds * FPS); f++) {
    t += DT;
    acting?.update(DT, bots, { time: t });
    for (const b of bots.values()) b.update(DT, t);
    each?.(t);
  }
  return t;
}
const headAt = (b, out = new THREE.Vector3()) => out.copy(b.head.group.position).multiplyScalar(b.group.scale.x).add(b.group.position);

// 1. every face act of the stage plays on cue and shows on the face (vs a twin head without it)
{
  assert.deepEqual([...ACTS].sort(), [...ACT_NAMES].sort(), 'actions.js ACTS and the face timelines differ');
  for (const id of ACTS) {
    const a = new Bot('Green', new THREE.Vector3(0, 1, 0), 7), twin = new Bot('Green', new THREE.Vector3(0, 1, 0), 7);
    let t = run(null, new Map([['a', a], ['b', twin]]), 0.5, 0);
    assert.equal(playAct(a, id), true, `playAct ${id}`);
    assert.equal(a.head.act, id, `${id} is not the act playing`);
    let most = 0;
    for (let f = 0; f < 45; f++) {
      t += DT;
      a.update(DT, t);
      twin.update(DT, t);
      for (let i = 0; i < CHANNEL_COUNT; i++) most = Math.max(most, Math.abs(a.head.expression[i] - twin.head.expression[i]));
    }
    assert.ok(most > 0.02, `act ${id} barely shows (${most.toFixed(4)})`);
  }
  // a nod when no act is given; an unknown act or one during a reaction does not play (Unity PlayAct)
  const b = new Bot('Gold', new THREE.Vector3(0, 1, 0), 4);
  assert.equal(playAct(b), true);
  assert.equal(b.head.act, 'nod');
  assert.equal(b.head.playAct(), true);
  assert.equal(b.head.act, 'nod');
  assert.equal(playAct(b, 'wink'), true);
  assert.equal(playAct(b, 'moonwalk'), false);
  assert.equal(b.head.act, 'wink', 'an unknown act must not stop the one playing');
  b.head.react('select');
  assert.equal(playAct(b, 'gasp'), false, 'no act while a reaction plays');
}

// 1b. on a singing bot the act plays in full on the head, brows and lids (the mouth keeps to the words)
{
  const a = new Bot('Red', new THREE.Vector3(0, 1, 0), 15), twin = new Bot('Red', new THREE.Vector3(0, 1, 0), 15);
  for (const b of [a, twin]) b.sing(3, 'la la la la la la la', null);
  let t = run(null, new Map([['a', a], ['b', twin]]), 0.6, 0);
  assert.ok(a.head.level > 0.3, `singing level ${a.head.level}`);
  playAct(a, 'wink');
  let lid = 0;
  for (let f = 0; f < 12; f++) {
    t += DT;
    a.update(DT, t);
    twin.update(DT, t);
    lid = Math.max(lid, a.head.expression[6] - twin.head.expression[6]); // lidUpL
  }
  assert.ok(lid > 0.4, `a wink while singing shuts the eye (${lid.toFixed(3)})`);
}

// 1c. the head's play moves (visual only): an offset carries the whole head, a lean tips it, a nudge wobbles and settles
{
  const b = new Bot('Pink', new THREE.Vector3(0, 1, 0), 5);
  let t = run(null, new Map([['b', b]]), 0.3, 0);
  b.head.setSocialOffset({ x: 0.05, y: 0, z: 0.02 }, { x: 0.2, y: 0, z: 0 });
  assert.deepEqual(b.head.group.position.toArray(), [0.05, 0, 0.02]);
  t = run(null, new Map([['b', b]]), 0.1, t);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.head.group.children[0].quaternion);
  assert.ok(up.x > 0.1, `a lean toward +x tips the head's top that way (${up.x.toFixed(3)})`);
  b.head.setSocialOffset(null);
  assert.equal(b.head.group.position.length(), 0);
  assert.equal(b.head.lean.length(), 0);
  b.head.nudge({ x: 0.4, y: 0.2, z: 0 });
  let most = 0;
  t = run(null, new Map([['b', b]]), 0.3, t, () => { most = Math.max(most, b.head.nudgeOffset.length()); });
  assert.ok(most > 0.01, `a nudge wobbles the head (${most})`);
  t = run(null, new Map([['b', b]]), 3, t);
  assert.equal(b.head.nudgeOffset.length(), 0, 'the wobble settles exactly');
  assert.ok(b.group.position.equals(new THREE.Vector3(0, 1, 0)), 'the bot itself never moves');
}

// 2. every gesture shows on the hands (palm is a wave until the hands get an open palm)
{
  for (const id of GESTURES) {
    const b = new Bot('Blue', new THREE.Vector3(0, 1, 0), 8);
    assert.ok(HandGestures.modeOf(gestureMode(id)) > 0, `gesture ${id} -> unknown hands mode ${gestureMode(id)}`);
    assert.equal(playGesture(b, id), true);
    assert.ok(b.hands.playing > 0, `gesture ${id} plays nothing`);
  }
  assert.equal(gestureMode('loveyou'), 'loveYou');
  assert.ok(['wave', 'palm', 'openPalm'].includes(gestureMode('palm')));
}

// 3. every v1 action id of the checked-in episodes shows something (sing-solo: the singing itself)
{
  const ids = new Set();
  for (const id of readdirSync('episodes')) {
    const f = `episodes/${id}/events.ndjson`;
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) if (line.trim()) ids.add(JSON.parse(line).action);
  }
  assert.ok(ids.size > 10, `only ${ids.size} action ids found`);
  const shows = [];
  for (const action of ids) {
    const r = resolveAction(action);
    const bots = new Map([['White', new Bot('White', new THREE.Vector3(-1, 1, 0), 3)], ['Green', new Bot('Green', new THREE.Vector3(1, 1, 0), 0)]]);
    const bot = bots.get('White'), other = bots.get('Green');
    let ok = false;
    if (r.kind === 'none') ok = action === 'sing-solo' || action === '';
    else if (r.kind === 'act') ok = playAct(bot, r.id) && bot.head.act === r.id;
    else if (r.kind === 'gesture') ok = playGesture(bot, r.id) && bot.hands.playing > 0;
    else if (r.kind === 'play') {
      assert.ok(PLAYS[r.id], `${action}: play ${r.id}`);
      startPlay(r.id, bot, [other], { time: 0 });
      ok = bot.hands.playing > 0 || !!bot._hand;
    } else if (r.kind === 'move') ok = true; // blocking.js moves the bots
    else if (r.kind === 'light') ok = accentAction(bot, r) && bot.head.act !== '';
    assert.ok(ok, `v1 action ${action} (${r.kind} ${r.id}) shows nothing`);
    shows.push(`${action}->${r.kind}:${r.id}`);
  }
  assert.equal(accentAction(new Bot('Gold', new THREE.Vector3(), 4), resolveAction('no-such-move')), true, 'an unknown id nods');
}

// 4. a line names bots: each (not the singer) reacts once as the voice comes in, and glances with the singer
{
  const bots = choir();
  const acting = new Acting();
  let t = run(acting, bots, 1, 0);
  const singer = bots.get('Green');
  singer.sing(3, 'Gold gasps, Red waves, White nods', null);
  acting.reactToCues([{ name: 'Gold', act: 'gasp' }, { name: 'Red', act: 'wave' }, { name: 'Green', act: 'wink' },
    { name: 'White', act: null }, { name: 'Pink', act: 'bogus' }, { name: 'Nobody', act: 'nod' }], singer, bots);
  const lou = bots.get('Gold'), ivy = bots.get('Red'), nora = bots.get('White'), pearl = bots.get('Pink');
  t = run(acting, bots, CARD_LEAD - 0.1, t);
  assert.notEqual(lou.head.act, 'gasp', 'a cue waits for the voice to come in');
  let louGlance = null, singerGlance = null;
  t = run(acting, bots, 0.8, t, () => {
    louGlance ??= lou.head.glance?.clone() ?? null;
    singerGlance ??= singer.head.glance?.clone() ?? null;
  });
  assert.equal(lou.head.act, 'gasp');
  assert.equal(HandGestures.modeOf('wave'), ivy.hands.playing, 'Red waves');
  assert.equal(nora.head.act, 'nod', '{White} alone nods');
  assert.equal(pearl.head.act, 'nod', 'an act the head lacks becomes a nod');
  assert.notEqual(singer.head.act, 'wink', 'the singer does not react to its own name');
  assert.ok(louGlance && singerGlance, 'the named bot and the singer glance at each other');
  // Gold's glance point is Green's head (in Gold's group space)
  const want = headAt(singer).sub(lou.group.position).divideScalar(lou.group.scale.x);
  assert.ok(louGlance.distanceTo(want) < 0.05, `Gold looks at ${louGlance.toArray()} not Green ${want.toArray()}`);
  const cues = acting.notes.filter((n) => n.what === 'cue');
  assert.deepEqual(cues.map((n) => n.who), ['Gold', 'Red', 'White', 'Pink']);
  assert.deepEqual(cues.map((n) => n.act), ['gasp', 'hands:wave', 'nod', 'nod']);
}

// 5. a consultation: over, face to face, an exchange, agreement (a nod or a handshake), back; the bots keep their marks
for (const agree of ['nod', 'shake']) {
  const bots = choir();
  const acting = new Acting();
  let t = run(acting, bots, 0.5, 0);
  const a = bots.get('White'), b = bots.get('Pink');
  const markA = a.group.position.clone(), markB = b.group.position.clone();
  a.sing(3.4, 'Purple peeks and hums a little tune.', null);
  const s = acting.consult(a, [b]);
  assert.ok(s && s.dur >= 3 && s.dur <= 4.5, `consult length ${s?.dur}`);
  s.agree = agree;
  const d0 = headAt(a).distanceTo(headAt(b));
  let closest = d0, faced = 0, shook = false;
  t = run(acting, bots, s.dur + 0.1, t, () => {
    closest = Math.min(closest, headAt(a).distanceTo(headAt(b)));
    if (a.head.glance && b.head.glance) faced++;
    shook ||= !!a._hand && a._hand.other === b;
    assert.ok(a.group.position.equals(markA) && b.group.position.equals(markB), 'a consultation must not move the bots');
  });
  assert.ok(closest < d0 - 0.3 * (d0 - 1.2 * (a.unit + b.unit) * 2.4), `the heads hardly met: ${d0.toFixed(2)} -> ${closest.toFixed(2)}`);
  assert.ok(faced > FPS * 1.5, `they faced each other only ${faced} frames`);
  const steps = acting.notes.filter((n) => n.who === 'White' || n.who === 'Pink').map((n) => n.what);
  for (const want of ['consult', 'idea', 'answer', 'agree', 'consulted']) assert.ok(steps.includes(want), `no ${want} in ${steps}`);
  assert.equal(steps.filter((w) => w === 'agree').length, 2, 'both agree');
  if (agree === 'shake') assert.ok(shook && steps.includes('handshake'), 'they shake on it');
  assert.ok(!acting.scenes.length, 'the scene is over within its time');
  t = run(acting, bots, 2, t);
  for (const m of [a, b]) {
    assert.equal(m.head.socialOffset.length(), 0, `${m.name} is back exactly`);
    assert.equal(m.head.lean.length(), 0, `${m.name} upright`);
  }
}

// 6. the choir's life between lines: deterministic, every personality has odds, nobody leaves its mark
{
  for (const id of PERSONALITY_IDS) assert.ok(PROFILES[id], `no social profile for ${id}`);
  const LINES = ['Green', 'White', 'Gray', 'Blue', 'Gold', 'Yellow', 'Pink'];
  const show = (seed) => {
    const bots = choir();
    const marks = [...bots.values()].map((b) => b.group.position.clone());
    const acting = new Acting({ seed });
    const trace = [];
    let line = 0, nextLine = 1, most = 0;
    const real = Math.random;
    Math.random = () => { throw new Error('Math.random in the acting'); };
    try {
      run(acting, bots, 75, 0, (t) => {
        if (t >= nextLine) { // a song: a line every 3.2 s, the singers taking turns
          bots.get(LINES[line++ % LINES.length]).sing(2.6, 'la la la la la la la la', null);
          nextLine += 3.2;
        }
        for (const b of bots.values()) most = Math.max(most, b.head.socialOffset.length() * b.group.scale.x / (b.unit * b.group.scale.x));
        if (Math.round(t * FPS) % 15 === 0) trace.push([...bots.values()].map((b) => b.head.socialOffset.toArray().map((x) => x.toFixed(5)).join(',')).join(';'));
      });
    } finally {
      Math.random = real;
    }
    [...bots.values()].forEach((b, i) => assert.ok(b.group.position.equals(marks[i]), `${b.name} left its mark`));
    return { notes: acting.notes, trace, most };
  };
  const one = show(1), two = show(1);
  assert.deepEqual(one.notes, two.notes, 'the same show twice tells the same story');
  assert.deepEqual(one.trace, two.trace, 'the same show twice moves the same heads');
  const what = (w) => one.notes.filter((n) => n.what === w || n.what.endsWith(`:${w}`)).length;
  assert.ok(what('sang') >= 5, `few looks at a bot coming in (${what('sang')})`);
  assert.ok(what('approve') >= 3, `few nods after a line (${what('approve')})`);
  assert.ok(what('exchange') >= 10 && what('look back') >= 5, `few exchanges (${what('exchange')} / ${what('look back')})`);
  assert.ok(what('start') >= 2, `few plays (${what('start')}): ${one.notes.filter((n) => n.what.includes(':')).map((n) => n.what)}`);
  assert.ok(one.notes.some((n) => /^(bump|poke):touch$|^poke:(jab|tap)$/.test(n.what)), 'no bump or poke landed');
  assert.ok(one.most <= 1.5 + 1e-6, `a head went ${one.most.toFixed(2)} radii off its place`);
  const looksAtSingers = one.notes.filter((n) => n.what === 'sang' && LINES.includes(n.other)).length;
  assert.ok(looksAtSingers === what('sang'), 'looks over go to the bot that comes in');
  console.log(`acting ok: ${ACTS.length} acts, ${GESTURES.length} gestures, cue reactions, consultations (nod + handshake), `
    + `social life (${what('sang')} looks over, ${what('approve')} nods, ${what('exchange')} exchanges, ${what('start')} plays) deterministic`);
}
