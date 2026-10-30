// Headless checks for the premiere's staging (staging.js, the stage's follow spots, the card layout, the studio rows):
// every voice its own card (harmonies, the pal's answers, the backing's "Bom, bom" and "Ooh" with the highlight coming
// round each bar), spots on whoever sings (the story's line first, MAX_SPOTS at most, the lighting cue an accent),
// cards kept clear of each other, the camera's core cast, the gestures the words cue, the typed opening's 4 s.
import assert from 'node:assert/strict';
import * as THREE from 'three';

// --- minimal DOM stub (the lyrics panel draws on a 2D canvas; textures never load headless)
function stub2d() {
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return (s) => ({ width: 22 * String(s ?? '').length });
      return () => undefined;
    },
    set() { return true; },
  });
}
globalThis.document = { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub2d() }) };
globalThis.Image = class { set src(v) { /* never loads headless */ } };

const S = await import('./src/staging.js');
const { Bot } = await import('./src/rig.js');
const { Stage, pickSpots, MAX_SPOTS, SPOT_RANK } = await import('./src/scene/environments/stage.js');
const { SHARED_UNIFORMS: U, MAX_LOCAL } = await import('./src/scene/head-material.js');
const { layoutCards, screenCard, cardBounds } = await import('./src/framing.js');
const { studioPlaces, studioHome } = await import('./src/blocking.js');
const { NAMES } = await import('./src/gen/cast.js');

// 1. cards: every sung part has its own card and style; the backing's syllables come round each bar
{
  assert.deepEqual(S.cardFor({ part: 'backing' }, 'Bom, bom, bom, bom'), { text: 'Bom, bom, bom, bom', part: 'backing', cycle: true });
  assert.deepEqual(S.cardFor({ part: 'reply' }, 'So bright!'), { text: 'So bright!', part: 'reply', cycle: false });
  assert.deepEqual(S.cardFor({}, 'Hackathon, hackathon!', { chorus: true }), { text: 'Hackathon, hackathon!', part: 'harmony', cycle: false });
  assert.equal(S.cardFor({}, 'Street lamps paint it gold').part, 'lead');
  assert.equal(S.cardFor({ part: 'backing' }, '  '), null);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8].map((i) => S.cardSyllable(i, 4, true)), [0, 1, 2, 3, 0, 1, 0]);
  assert.deepEqual([0, 3, 4, 9].map((i) => S.cardSyllable(i, 4, false)), [0, 3, 3, 3]);
  assert.equal(S.cardSyllable(-1, 4, true), -1);
  assert.ok(S.CARD_RANK.lead > S.CARD_RANK.harmony && S.CARD_RANK.harmony > S.CARD_RANK.reply && S.CARD_RANK.reply > S.CARD_RANK.backing);

  // a backing bot: "Bom, bom, bom, bom" in two bars (8 syllables timed): the highlight runs 0..3 twice; its card is
  // smaller; a held "Ooh" (one syllable, longer than the card's quiet spell) keeps its card up while it sounds
  const bass = new Bot('Silver', new THREE.Vector3(0, 1, 0), 14);
  const syl = [];
  for (let bar = 0; bar < 2; bar++) for (let k = 0; k < 4; k++) syl.push({ t0: bar * 2.6 + k * 0.65, t1: bar * 2.6 + k * 0.65 + 0.3 });
  bass.sing(2.2, 'Bom, bom, bom, bom', { delay: 0.45, length: 5.5, syllables: syl }, { part: 'backing', cycle: true });
  assert.equal(bass.part, 'backing');
  let t = 0;
  const seen = [];
  for (let f = 0; f < 6.2 * 60; f++) {
    bass.update(1 / 60, (t += 1 / 60));
    const p = bass.head.progress;
    if (p >= 0 && p !== seen.at(-1)) seen.push(p);
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 0, 1, 2, 3], `the highlight comes round each bar: ${seen}`);
  assert.ok(bass.head.card.scale < 0.8, 'the backing card is smaller');

  const pad = new Bot('White', new THREE.Vector3(0, 1, 0), 3);
  pad.sing(2.2, 'Ooh', { delay: 0.45, length: 8, syllables: [{ t0: 0, t1: 2.6 }, { t0: 2.6, t1: 5.2 }, { t0: 5.2, t1: 7.8 }] }, { part: 'backing', cycle: true });
  t = 0;
  let minShown = 1;
  for (let f = 0; f < 8 * 60; f++) {
    pad.update(1 / 60, (t += 1 / 60));
    if (t > 1.2) minShown = Math.min(minShown, pad.head.card.opacity);
  }
  assert.ok(minShown > 0.5, `a held "Ooh" keeps its card up (${minShown.toFixed(2)})`);

  // a harmony singer's card: its own words, a touch smaller than the story's line
  const h = new Bot('Navy', new THREE.Vector3(0, 1, 0), 10);
  h.sing(2.2, 'Hackathon, hackathon!', null, { part: 'harmony' });
  h.update(1 / 60, 0);
  assert.ok(h.head.card.scale < 1 && h.head.card.scale > 0.8 && h.head.progress === 0);
}

// 2. the spots: on whoever sings, the story's line first, MAX_SPOTS at most; the lighting cue an accent on top
{
  const mk = (bot, rank, serial) => ({ bot, rank, serial });
  assert.deepEqual(pickSpots([mk('bass', 1, 1), mk('lead', 3, 5), mk('harm', 2, 6), mk('pad', 1, 2)], new Set(), 3), ['lead', 'harm', 'bass']);
  assert.deepEqual(pickSpots([mk('a', 2, 1), mk('b', 2, 2)], new Set(['b']), 1), ['b'], 'a lit bot keeps its spot among equals');
  assert.ok(SPOT_RANK.lead > SPOT_RANK.accent && SPOT_RANK.accent > SPOT_RANK.harmony && SPOT_RANK.harmony > SPOT_RANK.backing);

  const run = () => {
    const scene = new THREE.Scene();
    const names = ['Green', 'Navy', 'Gold', 'Silver', 'White', 'Purple'];
    const bots = new Map(names.map((n, i) => {
      const b = new Bot(n, new THREE.Vector3(-3 + i * 1.2, 1.2, 0), NAMES.indexOf(n));
      return [n, b];
    }));
    const stage = new Stage({ scene, bots });
    const g = new THREE.Group();
    const lamp = new THREE.PointLight(0xffaa66, 10, 0, 2);
    lamp.position.set(0, 2.9, -0.5);
    g.add(lamp);
    stage.adopt('diner', g);
    stage.show('diner');
    const B = (n) => bots.get(n);
    let time = 0;
    const step = (sec) => { for (let f = 0; f < Math.round(sec * 30); f++) { time += 1 / 30; for (const b of bots.values()) b.update(1 / 30, time); stage.update(1 / 30); } };
    const lit = () => stage.spots.filter((r) => r.bot && r.level > 0.5).map((r) => r.bot.name).sort();
    const log = {};
    // the backing hums first: it gets a soft spot
    B('Silver').sing(2.2, 'Bom, bom, bom, bom', { delay: 0.45, length: 30, syllables: [{ t0: 0, t1: 30 }] }, { part: 'backing', cycle: true });
    B('White').sing(2.2, 'Ooh', { delay: 0.45, length: 30, syllables: [{ t0: 0, t1: 30 }] }, { part: 'backing', cycle: true });
    step(1);
    log.backing = lit();
    const soft = stage.spots.find((r) => r.bot === B('Silver'));
    assert.ok(soft && soft.gain < 0.8, 'the backing is lit softer');
    // the lead and two harmonies come in: three spots, the backing gives way
    B('Green').sing(2.2, 'Hackathon, hackathon!', { delay: 0.45, length: 3, syllables: [{ t0: 0, t1: 3 }] }, { part: 'lead' });
    B('Navy').sing(2.2, 'Hackathon, hackathon!', { delay: 0.45, length: 3, syllables: [{ t0: 0, t1: 3 }] }, { part: 'harmony' });
    B('Gold').sing(2.2, 'Hackathon, hackathon!', { delay: 0.45, length: 3, syllables: [{ t0: 0, t1: 3 }] }, { part: 'harmony' });
    step(1.2);
    log.chorus = lit();
    log.lamps = U.uLocalN.value;
    assert.equal(stage.spots.length, MAX_SPOTS);
    // the line ends: the spots go to the backing again
    step(4.5);
    log.after = lit();
    // the lighting agent's spot-Purple: an accent on a bot who is not singing, for a few seconds
    stage.spot(B('Purple'));
    step(1);
    log.accent = lit();
    step(5);
    log.accentGone = lit();
    // nobody sings: every spot goes out
    for (const b of bots.values()) b.singing = 0;
    B('Silver').sing(1, '');
    B('White').sing(1, '');
    step(3);
    log.off = stage.spots.filter((r) => r.level > 0).length;
    return log;
  };
  const a = run();
  assert.deepEqual(a.backing, ['Silver', 'White'], `the backing lit: ${a.backing}`);
  assert.deepEqual(a.chorus, ['Gold', 'Green', 'Navy'], `the lead and its harmonies: ${a.chorus}`);
  assert.ok(a.lamps <= MAX_LOCAL && a.lamps >= 3, `head lamps ${a.lamps}`);
  assert.deepEqual(a.after, ['Silver', 'White'], `after the line: ${a.after}`);
  assert.ok(a.accent.includes('Purple'), `the accent: ${a.accent}`);
  assert.ok(!a.accentGone.includes('Purple'), 'the accent ends');
  assert.equal(a.off, 0, 'all out');
  assert.deepEqual(run(), a, 'deterministic');
}

// 3. the card layout: cards that would overlap are moved apart (the higher-ranked one stays), clear of the faces behind
{
  const card = (key, rank, x, y, w = 0.4, h = 0.12, depth = 3) => ({ key, rank, depth, x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
  const area = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const cards = [card(1, 4, 0, 0), card(2, 3, 0.25, 0.02), card(3, 1, -0.2, -0.05, 0.25, 0.08)];
  const moves = layoutCards(cards, []);
  assert.deepEqual(moves.get(1), { dx: 0, dy: 0 }, 'the story line keeps its place');
  const placed = cards.map((c) => { const m = moves.get(c.key); return { x0: c.x0 + m.dx, x1: c.x1 + m.dx, y0: c.y0 + m.dy, y1: c.y1 + m.dy }; });
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.equal(area(placed[i], placed[j]), 0, `cards ${i} and ${j} overlap`);
  for (const m of moves.values()) assert.ok(m.dy <= 0, 'never up over its own head');
  // apart already: nobody moves
  const apart = layoutCards([card(1, 4, -0.5, 0), card(2, 3, 0.5, 0)], []);
  assert.deepEqual([...apart.values()], [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  // another bot's face: a card behind it would be hidden, one in front would cover it: either way it moves off it;
  // its own face (just above it) does not count
  const face = { key: 9, depth: 6, x0: -0.08, x1: 0.08, y0: -0.1, y1: 0.06 };
  const off = layoutCards([card(1, 4, 0.05, 0)], [face]).get(1);
  assert.ok(off.dx !== 0 || off.dy !== 0, 'the card leaves the face behind it');
  const hidden = layoutCards([card(1, 4, 0.05, 0)], [{ ...face, depth: 1 }]).get(1);
  assert.ok(hidden.dx !== 0 || hidden.dy !== 0, 'the card comes out from behind a nearer head');
  assert.deepEqual(layoutCards([card(1, 4, 0.05, 0)], [{ ...face, key: 1 }]).get(1), { dx: 0, dy: 0 });
  // deterministic and stable: the same input, the same moves; the move it has is kept when as good
  assert.deepEqual(layoutCards(cards, []), moves);

  // on a real camera: two bots side by side singing long lines; their cards on screen and the layout's moves
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  cam.position.set(0, 1.6, 3.2);
  cam.lookAt(0, 1.1, 0);
  cam.updateMatrixWorld();
  const a = new Bot('Green', new THREE.Vector3(-0.35, 1.2, 0), 0), b = new Bot('Navy', new THREE.Vector3(0.35, 1.2, 0), 10);
  a.sing(2.2, 'Hands stack high in the glow, so high', null, { part: 'lead' });
  b.sing(2.2, 'Hands stack high in the glow, so high', null, { part: 'harmony' });
  for (let f = 0; f < 30; f++) { a.update(1 / 30, f / 30); b.update(1 / 30, f / 30); }
  const sa = screenCard(cam, a), sb = screenCard(cam, b);
  assert.ok(sa.card && sb.card && area(sa.card, sb.card) > 0, 'the two cards overlap where they hang');
  const mv = layoutCards([{ key: 0, rank: 4, depth: sa.depth, ...sa.card }, { key: 10, rank: 3, depth: sb.depth, ...sb.card }], []);
  const k = b.group.scale.x;
  b.head.setCardShift((mv.get(10).dx * sb.mx) / k, (mv.get(10).dy * sb.my) / k);
  for (let f = 0; f < 60; f++) { a.update(1 / 30, 1 + f / 30); b.update(1 / 30, 1 + f / 30); }
  const shifted = cardBounds(b);
  assert.ok(Math.abs(shifted.dx) > 0.01 || shifted.cardTop < cardBounds(a).cardTop - 0.01, 'the harmony card moved (the framing sees it)');
}

// 4. the camera's core: the story's roles and whoever sings; a group shot stays near the singers
{
  assert.deepEqual(S.coreNames({ lead: 'Green', pal: 'Navy', grown: 'Gold', rival: 'Purple' }), ['Green', 'Navy', 'Gold', 'Purple']);
  assert.deepEqual(S.coreNames({ lead: 'Green', pal: 'Green' }), ['Green']);
  assert.deepEqual(S.coreNames(null), []);
  const at = (name, x, z) => ({ name, group: { position: new THREE.Vector3(x, 1.2, z) } });
  const teddy = at('Green', 0, 0), benny = at('Navy', 1.2, 0.2), lou = at('Gold', -2, 0), sterling = at('Purple', 6, -3), vera = at('Gray', 0.5, 0.5);
  const g = S.groupSubjects({ singers: [teddy, vera], core: [teddy, benny, lou, sterling] });
  assert.deepEqual(g.map((b) => b.name), ['Green', 'Gray', 'Navy', 'Gold'], 'the far rival is left out');
  assert.deepEqual(S.groupSubjects({ singers: [], core: [benny, sterling] }).map((b) => b.name), ['Navy', 'Purple'], 'no singer: the core');
  assert.deepEqual(S.groupSubjects({}), []);
}

// 5. the studio rows: a premiere beat's cast in the middle of the front row, everyone else where they were
{
  const cast = ['Green', 'Navy', 'Gold', 'Purple'];
  const places = studioPlaces(NAMES, cast);
  const homes = NAMES.map((_, i) => studioHome(i));
  const key = (v) => v.toArray().map((x) => x.toFixed(4)).join(',');
  assert.deepEqual(places.map(key).sort(), homes.map(key).sort(), 'the same sixteen places');
  const front = homes.filter((h) => h.y < 1).map((h) => Math.abs(h.x)).sort((a, b) => a - b);
  cast.forEach((n, k) => {
    const p = places[NAMES.indexOf(n)];
    assert.ok(p.y < 1 && Math.abs(Math.abs(p.x) - front[k]) < 1e-6, `${n} in the middle of the front row (${p.x.toFixed(2)})`);
  });
  const moved = NAMES.filter((n, i) => key(places[i]) !== key(homes[i]));
  assert.ok(moved.length <= 2 * cast.length, `only the cast and the ones it stands in for move (${moved})`);
  assert.deepEqual(studioPlaces(NAMES, []).map(key), homes.map(key));

  // a spread verse in a set: the singer at the set's first place, the story's pal at the free place nearest to it
  // (the two-shot of the line and its answer holds them close, not across the street)
  const { Blocking } = await import('./src/blocking.js');
  const { SETS, markOf } = await import('./src/scene/environments/sets.js');
  const bots = new Map(NAMES.map((n, i) => [n, new Bot(n, studioHome(i), i)]));
  const blocking = new Blocking({ bots, scene: new THREE.Scene() });
  blocking.addSet('street', new THREE.Group());
  const beats = { version: 2, roles: { lead: 'Green', pal: 'Navy' }, beats: [{ id: 'v', section: 'verse1', set: 'street', cast: ['Green', 'Gray', 'Gold', 'Navy'] }] };
  blocking.load(beats, [{ seq: 0, t: 0, beat: 'v', bot: 'Green', singer: 'Green', lyric: 'la la', action: '', consult: [], chords: [] }]);
  blocking.reset();
  const at = (n) => blocking.state.get(bots.get(n)).slot;
  const first = markOf(SETS.street, SETS.street.spread[0]);
  assert.ok(Math.hypot(at('Green').x - first.x, at('Green').z - first.z) < 1e-6, 'the singer at the first place');
  const dPal = Math.hypot(at('Navy').x - first.x, at('Navy').z - first.z);
  for (const n of ['Gray', 'Gold']) assert.ok(dPal <= Math.hypot(at(n).x - first.x, at(n).z - first.z), `the pal nearer than ${n}`);
  assert.ok(dPal < 2.5, `the pal ${dPal.toFixed(2)} m from the singer`);
}

// 6. the gestures the words cue (deterministic by seq; not busy: one for the singer, one listener at most)
{
  assert.equal(S.wordCue('I reach for high-five')?.id, 'high-five');
  assert.equal(S.wordCue('Up high!')?.id, 'high-five');
  assert.equal(S.wordCue('Let me think it through')?.id, 'chin-stroke');
  assert.equal(S.wordCue('I wonder why')?.id, 'chin-stroke');
  assert.equal(S.wordCue('Tick tock!')?.id, 'count-beats');
  assert.equal(S.wordCue('Hands stack high in the glow')?.cast, 'group');
  assert.equal(S.wordCue('Shh, a secret')?.id, 'shh');
  assert.equal(S.wordCue('A heart for you')?.id, 'finger-heart');
  assert.equal(S.wordCue('Thumbs up, team')?.id, 'thumbs-up');
  assert.equal(S.wordCue('Peekaboo!')?.id, 'peekaboo');
  assert.equal(S.wordCue('We fist bump')?.id, 'fist-bump');
  assert.equal(S.wordCue('Wave hello')?.kind, 'gesture');
  assert.equal(S.wordCue('Hooray!')?.id, 'cheer');
  assert.equal(S.wordCue('Street lamps paint it gold'), null);
  // the first gesture in the line wins
  assert.equal(S.wordCue('I count to three, then high five')?.id, 'count-beats');
  const singer = { name: 'Green' }, pal = { name: 'Navy' }, lou = { name: 'Gold' };
  const hf = S.lineGestures({ seq: 38, text: 'I reach for high-five', singer, partner: pal, listeners: [] });
  assert.equal(hf.length, 1);
  assert.equal(hf[0].cue.id, 'high-five');
  assert.equal(hf[0].partner, pal);
  assert.equal(S.lineGestures({ seq: 38, text: 'I reach for high-five', singer, partner: null }).length, 0, 'a duo needs a partner');
  assert.equal(S.lineGestures({ seq: 3, text: 'I wonder', part: 'harmony', singer }).length, 0, 'a harmony does not repeat the lead\'s gesture');
  assert.equal(S.lineGestures({ seq: 3, text: 'Ooh', part: 'backing', singer }).length, 0);
  // the listeners: now and then one core member gestures mid-line (about LISTEN_CHANCE of the lines), never the singer
  let n = 0;
  for (let seq = 0; seq < 400; seq++) {
    const g = S.lineGestures({ seq, text: 'Street lamps paint it gold', singer, listeners: [pal, lou], length: 3 });
    assert.ok(g.length <= 1 && g.every((x) => x.bot !== singer && x.at > 0.45));
    n += g.length;
    assert.deepEqual(S.lineGestures({ seq, text: 'Street lamps paint it gold', singer, listeners: [pal, lou], length: 3 }), g, 'deterministic');
  }
  assert.ok(n > 400 * S.LISTEN_CHANCE * 0.7 && n < 400 * S.LISTEN_CHANCE * 1.3, `listener gestures ${n} of 400`);
  assert.ok(S.DUO_ENDINGS.includes(S.pickBySeq(7, 'consult-end', S.DUO_ENDINGS)));
  assert.equal(S.pickBySeq(7, 'consult-end', S.DUO_ENDINGS), S.pickBySeq(7, 'consult-end', S.DUO_ENDINGS));
  assert.equal(new Set(Array.from({ length: 30 }, (_, s) => S.pickBySeq(s, 'consult-end', S.DUO_ENDINGS))).size, 3, 'all three endings come up');
}

// 7. the typed opening: INTRO_SECONDS whatever the prompt's length, on a 30 fps frame-exact clock too
{
  assert.equal(S.INTRO_SECONDS, 4);
  for (const n of [0, 5, 18, 51, 120, 300]) {
    const p = S.typingPlan(n);
    assert.equal(p.total, 4);
    assert.ok(p.start >= 0.39 && p.pressAt < 4 && p.pressAt > 3, `n ${n}`);
    let last = 0;
    for (let f = 0; f <= 120; f++) {
      const t = f / 30, k = p.typed(t);
      assert.ok(k >= last && k <= n, 'monotonic');
      last = k;
    }
    assert.equal(p.typed(p.pressAt - 0.3), n, `all ${n} letters typed before the press`);
    assert.ok(!p.pressed(p.pressAt - 0.01) && p.pressed(p.pressAt + 0.01) && !p.pressed(4));
    // the capture's frames: the opening ends on frame 120 (4.0 s), whatever the prompt
    let frames = 0;
    while (frames / 30 < p.total - 1e-6) frames++;
    assert.equal(frames, 120);
  }
  const p = S.typingPlan(51);
  assert.ok(p.step > 0.04 && p.step < 0.08, `a typist's pace (${p.step.toFixed(3)} s a letter)`);
  assert.ok(S.typingPlan(5).step <= 0.11, 'a short prompt is not typed slower than a typist');
}

console.log('staging ok: a card per voice (the backing\'s highlight comes round each bar), spots on the singers (3 at most, the line first, the cue an accent), cards kept apart, the core cast, the studio rows, word gestures, a 4 s typed opening');
