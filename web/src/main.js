import * as THREE from 'three';
import { Player, parseNdjson } from './player.js';
import { Bot } from './rig.js';
import { generate } from './gen/index.js';
import { NAMES } from './gen/cast.js';
import { modernBundle } from './cast16.js';
import { sungSummary } from './team-voice.js';
import { Choir } from './audio.js';
import { keystrokes } from './keys.js';
import { arrange, BEAT, motionClock, CARD_SHOW_LEAD } from './sing-plan.js';
import { MAKING_OF_TEMPO } from './making-of-score.js';
import { BEATS_PER_BAR } from './song/form.js';
import { curatedSlug } from './curated.js';
import { getStudioEnvironment } from './scene/studio-env.js';
import { Stage } from './scene/environments/stage.js';
import { setName } from './scene/environments/sets.js';
import { resolveAction, PLAYS } from './actions.js';
import { parseLyric } from './cues.js';
import { startPlay, updatePlays, resetPlays } from './plays/index.js';
import { playGesture, playAct, reactToCues, consult, address, updateActing, accentAction, partnered } from './acting.js';
import { Blocking, studioHome } from './blocking.js';
import { createMakingOf, API } from './making-of.js';
import { createRunDialog } from './run-dialog.js';
import { screenLayout, pixelRatioFor } from './viewport.js';
import { CameraFollow, SmoothVec, SwingGate } from './camera-follow.js';
import { fitFrame, slotBounds, screenCard, layoutCards, settleCards, frontTwoShot, setCloseShot, towardAudience, faceOcclusion, measure,
  MAX_FACE, SHOT_FACE, EDGE_HEAD, foregroundCap, faceBounds, faceSpan, topCut } from './framing.js';
import { cardFor, CARD_RANK, CARD_GAP, coreNames, groupSubjects, lineGestures, cueOf, pickBySeq, DUO_ENDINGS, GESTURE_REST,
  INTRO_SECONDS, typingPlan } from './staging.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';
// Each beat plays in its set (beats.json beats[].set: sets.js SET_NAMES; an old 'studio' plays in the diner,
// sets.js SET_ALIASES). ?set=<name> (or the older ?env=<name>) puts every beat of the episode in that set (demos, captures).
const setParam = new URLSearchParams(location.search).get('set') ?? new URLSearchParams(location.search).get('env');
const setOverride = setParam && /^[a-z0-9_-]+$/i.test(setParam) ? setName(setParam) ?? setParam : null;

// The screen (viewport.js): a desktop or a capture keeps the designed 16:9 frame; a phone gets the compact overlays, the
// shots framed between them, groups held tighter in portrait, and fewer pixels to draw. Re-read on resize / rotation.
const CINEMA = new URLSearchParams(location.search).has('cinema');
const coarse = () => !CINEMA && matchMedia('(pointer: coarse)').matches;
// (the notch and the home bar: index.html #safe is padded by env(safe-area-inset-*))
const safeInsets = () => {
  const el = document.getElementById('safe');
  if (!el) return {};
  const s = getComputedStyle(el);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
};
let limits = screenLayout({ w: innerWidth, h: innerHeight, coarse: coarse(), cinema: CINEMA, safe: safeInsets() });
function applyLayout() {
  limits = screenLayout({ w: innerWidth, h: innerHeight, coarse: coarse(), cinema: CINEMA, safe: safeInsets() });
  const root = document.documentElement;
  root.classList.toggle('compact', limits.compact);
  root.classList.toggle('portrait', limits.compact && limits.portrait);
  root.style.setProperty('--mb-top', `${limits.top}px`);
  root.style.setProperty('--mb-bottom', `${limits.bottom}px`);
  // what the on-screen keyboard leaves of the page (the run dialog sits in it on a phone)
  const vv = window.visualViewport;
  root.style.setProperty('--vv-h', `${Math.round(vv?.height ?? innerHeight)}px`);
  root.style.setProperty('--vv-top', `${Math.round(vv?.offsetTop ?? 0)}px`);
}
applyLayout();
// (a touch screen: no multisampling, the pixels capped; viewport.js pixelRatioFor. A desktop as before.)
const renderer = new THREE.WebGLRenderer({ antialias: !limits.lowPower || devicePixelRatio < 2 });
const pixelRatio = () => pixelRatioFor({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, mobile: limits.lowPower });
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
// Same curve as the head shader's own tonemap (Khronos Neutral) for the standard-material sets.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.8;
document.body.appendChild(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'The stage: sixteen robot bots sing the episode; the captions below say who sings what');
const studio = getStudioEnvironment(renderer); // reflections for the head + hand shader
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2826);
scene.environment = studio.texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
// no backdrop: every beat, the making-of and the idle screen play in a set (scene/environments/stage.js: its room,
// lights at the sets' exported candela, exposure and reflection environment); the studio environment above only
// lights the heads' reflections until a set builds its own

const bots = new Map();
NAMES.forEach((n, i) => {
  const bot = new Bot(n, studioHome(i), i);
  bot.viewer = camera.position;
  bots.set(n, bot);
  scene.add(bot.group);
});
const nearestBot = (bot) => {
  let best = null, dBest = Infinity;
  bots.forEach((b) => {
    if (b === bot || !blocking.isOn(b)) return; // in a set: only the bots in the scene
    const d = b.group.position.distanceToSquared(bot.group.position);
    if (d < dBest) { dBest = d; best = b; }
  });
  return best;
};
const stageSets = new Stage({ renderer, scene, camera, studio, bots });
const blocking = new Blocking({ bots, scene, stage: stageSets, override: setOverride, contact: partnered });
// the song clock the hands and the hand plays keep time with (beats = time / beatSec while the song plays)
const clock = { time: 0, beatSec: BEAT, beatsPerBar: 4, meter: 4, playing: false, bots, viewer: camera.position };
const MAKING_OF_CLOCK = motionClock(MAKING_OF_TEMPO, BEATS_PER_BAR);
const PLAYS_GROUP = new Set(Object.keys(PLAYS).filter((id) => PLAYS[id] === 'group'));
let episodeBeats = null; // beats.json of the episode playing (null: a v1 bundle without one)
// The bots a beat stages (beats.json cast), the singer first.
function castOf(e, bot) {
  const beat = episodeBeats?.beats?.find((b) => b.id === e.beat);
  return [bot, ...(beat?.cast ?? []).map((n) => bots.get(n)).filter((b) => b && b !== bot)];
}
// A duo's partner: the bot consulted, else the first bot the line names, else the nearest.
function partnerOf(e, bot, cues) {
  for (const n of [...e.consult, ...(e.to ? [e.to] : []), ...cues.map((c) => c.name)]) {
    const b = bots.get(n);
    if (b && b !== bot) return b;
  }
  return nearestBot(bot);
}

const $ = (id) => document.getElementById(id);
const caption = $('caption'), statusEl = $('status');
const choir = new Choir();
let chordText = '';
// Shot list: close-up on the singer, two-shot for duets/consults, a group shot of the core cast for
// choruses and group moves, a short establishing wide (ESTABLISH s) of the core cast at a new set.
// The core cast: the story's roles (beats.json roles) and whoever sings a line. A new singer is a
// cut; within a shot the camera eases and drifts slowly. In a set the shots are framed from the
// set's audience side, kept inside its walls and clear of furniture and heads.
const shot = { kind: 'wide', bot: null, partner: null, age: 0, cut: true, n: 0, next: null, members: [] };
const camPos = new THREE.Vector3(0, 2.4, 8.5), camLook = new THREE.Vector3(0, 1.1, 0); // the follow's camera
const follow = new CameraFollow(), holdPos = new SmoothVec(), holdLook = new SmoothVec();
const _hp = new THREE.Vector3(), _hl = new THREE.Vector3();
const ESTABLISH = 2.2; // s a new set's establishing wide holds before the singer
// next: a shot that follows on its own after `at` seconds (the establishing wide of a new set)
function setShot(kind, bot = null, partner = null, { force = false, next = null } = {}) {
  // (a narrow frame: a two-shot of bots standing far apart is the singer's close-up; the making-of's duets stand side
  // by side: kept. viewport.js twoShotSpan)
  if (kind === 'two' && bot && partner && !blocking.crew && flatDist(bot, partner) > limits.twoSpan) { kind = 'close'; partner = null; }
  const cut = force || kind !== shot.kind || bot !== shot.bot;
  // a two-shot with another partner: reframed; a cut when the new framing is far (render loop), else a glide
  if (!cut && kind === 'two' && partner !== shot.partner) shot.reframe = true;
  // a group holds the core cast and whoever sings now (fixed for the shot: no lurch as voices come and go; a new
  // voice joins it); the establishing wide the singer and the core cast at their places
  const members = kind === 'group' ? groupNow(bot) : kind === 'wide' ? [...new Set([bot, ...coreAll()].filter(Boolean))] : [];
  const grown = !cut && kind === 'group' && members.some((b) => !shot.members.includes(b));
  if (grown) shot.members = members;
  if (grown || shot.reframe) shot.clear = null; // (framed anew: the crew behind it too)
  Object.assign(shot, { kind, bot, partner, cut: shot.cut || cut, next });
  if (cut) { shot.age = 0; shot.n++; shot.side = 0; shot.across = 0; shot.keep = -1; shot.members = members; shot.checked = 0; shot.clear = null; shot.featured = []; shot.crowded = false; swing.reset(0); }
  // (a group that grows keeps its angle: the framing widens; a hidden face swings it later, regroup)
  if (cut && kind === 'group') shot.angle = groupAngle(shot.members.filter(onStage));
}
const _gp = new THREE.Vector3(), _gl = new THREE.Vector3();
/**
 * How a group shot from the set's wide `i` sees its members: { cost (their heads and the card zones under them hiding
 * each other), hidden (the largest share of a singer's face behind a nearer head, any bot's on set), dist }.
 */
function angleCost(i, members) {
  const w = blocking.def.camera.wide[i];
  wideFit(_gp, _gl, w, members, GROUP_MIN);
  const dist = _gp.distanceTo(_gl);
  fitCam.position.copy(_gp);
  fitCam.lookAt(_gl);
  fitCam.updateMatrixWorld();
  // each member as seen: its head and the card zone under it (about 0.75 m by 0.28 m)
  const rects = members.map((b) => screenCard(fitCam, b)).filter(Boolean).map((r) => {
    const half = Math.max(r.face.x1 - r.face.x0, 0.75 / r.mx) / 2, mid = (r.face.x0 + r.face.x1) / 2;
    return { x0: mid - half, x1: mid + half, y0: r.face.y0 - 0.28 / r.my, y1: r.face.y1 };
  });
  let cost = 0;
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const A = rects[a], B = rects[b];
    const o = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)) * Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0));
    cost += o / Math.max(1e-6, Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0)));
  }
  // the faces that sing: none behind another head (QA: Navy behind Gold in a three-voice chorus)
  const singers = members.filter(singsLine);
  let hidden = 0;
  if (singers.length) {
    const occ = faceOcclusion(fitCam, [...new Set([...members, ...blocking.onSet()])].filter((b) => b.group.visible));
    for (const b of singers) hidden = Math.max(hidden, occ.get(b) ?? 0);
  }
  return { cost: cost + 4 * hidden, hidden, dist };
}
/**
 * In a set, the preset angle a group shot takes: of the set's wides, the one where its members (heads and the cards
 * under them) hide each other least, a singing face hidden counting most; among equals the next one in turn (the
 * shots vary).
 */
function groupAngle(members) {
  const wides = blocking.def.camera?.wide ?? [];
  const turn = (shot.n >> 1) % Math.max(1, wides.length);
  if (!blocking.inSet || wides.length < 2 || members.length < 2) return turn;
  let best = turn, bestCost = Infinity, nearest = Infinity;
  const tries = [];
  for (let k = 0; k < wides.length; k++) {
    const i = (turn + k) % wides.length;
    const c = angleCost(i, members);
    nearest = Math.min(nearest, c.dist);
    tries.push({ i, ...c });
  }
  // the least hidden, and the nearer of two that hide about as much (a far angle shows the bots small)
  for (const c of tries) {
    const cost = c.cost + 0.8 * (c.dist / nearest - 1);
    if (cost < bestCost - 0.05) { bestCost = cost; best = c.i; }
  }
  return best;
}
/**
 * A group shot as it holds: its angle was picked where the bots stood at the cut, the singers walk forward to sing
 * after it. Twice a second, when a singer's face has gone behind another head, the camera moves round to the angle
 * that shows it (the follow orbits there: a slow swing, no cut). Hysteresis (camera-follow.js SwingGate): the face
 * hidden on two checks in a row, an angle clearly better, the shot held 4 s since its cut or its last swing, two
 * swings a shot at most (QA v12: the walk-in hid a face from every angle in turn and the camera swung every 0.5 s).
 */
const swing = new SwingGate();
function regroup() {
  if (shot.kind !== 'group' || !blocking.inSet || blocking.marchers || shot.age < (shot.checked ?? 0) + 0.5) return;
  shot.checked = shot.age;
  const members = shot.members.filter(onStage);
  const wides = blocking.def.camera?.wide ?? [];
  if (members.length < 2 || wides.length < 2 || !members.some(singsLine)) return;
  const now = angleCost(shot.angle ?? 0, members);
  if (now.hidden <= swing.hiddenAt) { swing.offer(shot.age, now.hidden, null); return; }
  const next = groupAngle(members);
  const better = next !== shot.angle ? angleCost(next, members).hidden : null;
  if (swing.offer(shot.age, now.hidden, better)) shot.angle = next;
}
/** The core cast: the story's roles (the premiere); the making-of's is its crew (making-of.js core: the seven role bots). */
function coreAll() {
  if (makingOf?.active) return (makingOf.core ?? []).map((n) => bots.get(n)).filter(Boolean);
  return coreNames(episodeBeats?.roles).map((n) => bots.get(n)).filter(Boolean);
}
const coreOnStage = () => coreAll().filter(onStage);
/**
 * Sings a line now, for the camera: the story's line and its harmonies, the pal's answers (an echo doubling the pal's
 * answer and the backing have their cards and spots, the camera does not go to them).
 */
function singsLine(b) {
  if (!(b.singing > 0)) return false;
  if (b.part === 'lead' || b.part === 'harmony') return true;
  const pal = episodeBeats?.roles?.pal;
  return (b.part === 'reply' || b.part === 'echo') && (!pal || makingOf?.active || b.name === pal);
}
/** Who a group shot holds: whoever sings a line now (and `extra`, the line's singer), then the core cast near them. */
function groupNow(extra = null) {
  const singers = [...bots.values()].filter((b) => (b === extra || singsLine(b)) && onStage(b));
  return groupSubjects({ singers, core: coreOnStage() });
}
const _d = new THREE.Vector3(), _q = new THREE.Vector3(), _c = new THREE.Vector3();
const _base = new THREE.Vector3(), _o = new THREE.Vector3();
// Shots inside a set (blocking.def: camera bounds, wide presets, the audience side).
function setShotGoal(pos, look, subjects) {
  const def = blocking.def, cam = def.camera;
  const drift = Math.min(shot.age, 8) * 0.04;
  const aud = def.audience ?? [0, 8];
  const toward = (p, out) => towardAudience(p, aud, out);
  const marchers = shot.kind === 'wide' || shot.kind === 'group' ? blocking.marchers : null;
  if (marchers?.length) {
    // a parade: track the line from the set's front angle, as close as holds all of it
    wideFit(pos, look, cam.wide[0], marchers);
    keepCamera(pos, look, [], false);
    fit(pos, look, subjects, { move: false, roof: roofNow() });
    return;
  }
  if (shot.kind === 'close' && shot.bot) {
    const p = shot.bot.group.position;
    if (!shot.side) shot.side = p.x > 0.3 ? -1 : 1; // a little off-axis, toward the room's middle (kept for the shot)
    setCloseShot(p, aud, shot.side, drift, pos, look);
  } else if (shot.kind === 'two' && shot.bot && shot.partner && blocking.crew) {
    // the making-of's duets stand side by side facing the camera, in front of the crew: from straight in front, a
    // little above (the crew's faces behind them seen over theirs)
    frontTwoShot(shot.bot.group.position, shot.partner.group.position, drift, pos, look, DUET_UP);
  } else if (shot.kind === 'two' && shot.bot && shot.partner) {
    const a = shot.bot.group.position, b = shot.partner.group.position;
    look.copy(a).add(b).multiplyScalar(0.5);
    // across the line between them, from the audience side
    _q.set(b.z - a.z, 0, a.x - b.x);
    if (_q.lengthSq() < 1e-6) _q.set(0, 0, 1);
    _q.normalize();
    toward(look, _d);
    // the side of the line the shot stands on is kept for the shot (the bots shuffling must not flip it frame to
    // frame); it changes only when it would look at them from clearly behind, and then as a cut (a shot under 1.5 s
    // old glides round instead: two cuts that close read as a flicker)
    const across = _q.dot(_d) < 0 ? -1 : 1;
    if (!shot.across) shot.across = across;
    else if (across !== shot.across && Math.abs(_q.dot(_d)) > 0.35) { shot.across = across; shot.cut ||= shot.age > 1.5; } // (young: it glides)
    if (shot.across < 0) _q.negate();
    _q.lerp(_d, 0.4).normalize();
    const dist = Math.max(2.5, Math.hypot(a.x - b.x, a.z - b.z) * 1.1 + 1.5) - drift * 0.4;
    pos.set(look.x + _q.x * dist, look.y + 0.42, look.z + _q.z * dist);
    look.y += 0.08;
  } else {
    // a group shot / the establishing wide: from one of the set's preset angles (another one each time), as close
    // as frames the shot's core cast (the wide: at their places, so bots still walking in from a door do not swing
    // the camera; the group: where they are), never the whole set
    const w = cam.wide[(shot.kind === 'group' ? shot.angle : null) ?? (shot.n >> 1) % cam.wide.length] ?? cam.wide[0];
    const slots = blocking.castSlots(); // (the scene's cast at their places: also the ones still coming in)
    let held = slots.filter(([b]) => shot.members.includes(b));
    if (shot.kind === 'wide' && shot.bot) held = singerWide(w, held.length ? held : slots, shot.bot);
    const items = shot.kind === 'group' && subjects.length ? subjects
      : (held.length ? held : slots).map(([b, slot]) => slotBounds(b, slot, {}));
    if (items.length) {
      wideFit(pos, look, w, items, shot.kind === 'group' ? GROUP_MIN : WIDE_MIN);
      pos.x += Math.sin(shot.age * 0.07) * 0.3; // a slow drift
    } else {
      pos.set(w.pos[0] + Math.sin(shot.age * 0.07) * 0.5, w.pos[1], w.pos[2] - drift * 0.6);
      look.set(w.look[0], w.look[1], w.look[2]);
    }
    // (a group shot also keeps the heads of the bots it does not hold out of the way)
    keepCamera(pos, look, subjects, shot.kind === 'group' && subjects.length > 0);
    fit(pos, look, subjects, { move: false, roof: roofNow(), maxFace: faceCap() });
    if (shot.kind === 'group') clearTop(pos, look, subjects);
    if (shot.kind === 'group') clearSides(pos, look, subjects);
    return;
  }
  // the head and its card in frame (stepping back if needed), then inside the walls and clear of
  // furniture and heads, then a last tilt for the card
  fit(pos, look, subjects, { roof: roofNow(), maxFace: faceCap() });
  keepCamera(pos, look, subjects, true);
  fit(pos, look, subjects, { move: false, roof: roofNow(), maxFace: faceCap() });
  clearTop(pos, look, subjects);
  clearSides(pos, look, subjects);
}
// No head the frame's side slices in the premiere's shots in a set: a bystander's head cut by the left or right edge
// bigger than a sliver (crowd's edge cap: EDGE_HEAD, EDGE_SHARE of the subjects' faces) is panned wholly out of the frame,
// or wholly into it, whichever is the smaller pan that keeps the subjects' heads and cards inside the side limit (QA v24: the
// outro's group opened on a head cut at the left edge). The way chosen for a head is kept for the shot (no flicker as it
// bobs at the edge). The making-of's crew flanks its shots: left as it is.
const _cs = {}, _cr = new THREE.Vector3(), _cl = new THREE.Vector3();
function clearSides(pos, look, held) {
  if (makingOf?.active || !held.length) return;
  // (the shot's singer and whoever sings a line are never a bystander to pan out: one still walking in is no subject yet,
  // QA v25 probe, Gold at the bridge's establishing wide)
  const subjects = [...new Set([...held, ...(shot.bot && shot.bot.group.visible ? [shot.bot] : []), ...[...bots.values()].filter((b) => b.group.visible && singsLine(b))])];
  const pan = (dx) => {
    if (!dx) return;
    fitCam.position.copy(pos); fitCam.lookAt(look); fitCam.updateMatrixWorld(true);
    _cr.setFromMatrixColumn(fitCam.matrixWorld, 0);
    const mx = pos.distanceTo(look) * Math.tan((fitCam.fov * Math.PI) / 360) * (fitCam.aspect || 1);
    look.addScaledVector(_cr, -dx * mx);
  };
  // (decided once per shot and place: a pan that followed every bob swung the group to and fro, QA v25 probes)
  // (again when a head the pan was not decided on comes to the edge: a bot walking to its place)
  const key = `${shot.n}:${keptTry}`;
  const aim = () => { fitCam.position.copy(pos); fitCam.lookAt(look); fitCam.updateMatrixWorld(true); };
  const edgeHead = (cap, skip = null) => {
    let worst = null;
    for (const b of bots.values()) {
      if (!b.group.visible || subjects.includes(b) || skip?.has(b)) continue;
      const r = screenCard(fitCam, b);
      if (!r) continue;
      const f = r.face, h = f.y1 - f.y0;
      if (f.y1 < -1 || f.y0 > 1 || h <= cap) continue;
      const left = f.x0 < -1 && f.x1 > -1, right = f.x1 > 1 && f.x0 < 1;
      if ((left || right) && (!worst || h > worst.h)) worst = { b, f, h, left };
    }
    return worst;
  };
  const capNow = () => Math.min(EDGE_HEAD, EDGE_SHARE * measure(fitCam, pos, look, subjects, _cs).face);
  if (shot.sidesKey === key) {
    _cl.copy(look);
    pan(shot.sidesDx);
    aim();
    if (!edgeHead(capNow(), shot.sides)) return;
    look.copy(_cl);
  } else if (shot.sidesN !== shot.n) { shot.sidesN = shot.n; shot.sides = new Map(); }
  shot.sidesKey = key;
  shot.sidesDx = 0;
  for (let pass = 0; pass < 3; pass++) {
    aim();
    const cap = capNow();
    // the subjects across (their heads and cards, NDC)
    let lo = Infinity, hi = -Infinity;
    for (const b of subjects) {
      const r = screenCard(fitCam, b);
      if (!r) continue;
      lo = Math.min(lo, r.face.x0, r.card ? r.card.x0 + r.px : Infinity);
      hi = Math.max(hi, r.face.x1, r.card ? r.card.x1 + r.px : -Infinity);
    }
    if (!(lo < hi)) return;
    aim();
    const worst = edgeHead(cap);
    if (camLog) shot.sidesWhy = [pass, worst?.b.name ?? null, +(worst?.h ?? 0).toFixed(2), +cap.toFixed(2), +lo.toFixed(2), +hi.toFixed(2)];
    if (!worst) return;
    const { f, left } = worst;
    // a shift of the picture (NDC, + to the right): `in` brings the head wholly in, `out` takes it wholly out
    const m = 0.03, inn = left ? -1 - f.x0 + m : 1 - f.x1 - m, out = left ? -1 - f.x1 - m : 1 - f.x0 + m;
    const ok = (dx) => lo + dx >= -limits.side && hi + dx <= limits.side;
    const kept = shot.sides.get(worst.b);
    const ways = [kept === 'in' ? inn : kept === 'out' ? out : null, ...(Math.abs(inn) < Math.abs(out) ? [inn, out] : [out, inn])].filter((d) => d !== null && ok(d));
    if (camLog) shot.sidesWhy.push(+inn.toFixed(2), +out.toFixed(2), ways.length);
    if (!ways.length) { shot.sides.set(worst.b, 'none'); return; } // (no pan clears it: not tried again this shot)
    const dx = ways[0];
    shot.sides.set(worst.b, dx === inn ? 'in' : 'out');
    // pan: the look point moves against the picture's shift, across the view at its depth
    pan(dx);
    shot.sidesDx += dx;
  }
}
// The making-of's heads stay under its banner (framing.js MAKING_ROOF); the premiere's under HEAD_ROOM.
// The making-of's duet two-shot stands this far above the middle of its two (m; frontTwoShot's own 0.8 looked down on
// them, a bright floor under two small bots, QA v24 c5)
const DUET_UP = 0.45;
const DUET_MIN = 0.42; // (the duet's faces at least this tall: clearTop)
const roofNow = () => (makingOf?.active ? limits.makingRoof : limits.roof);
const _cm = {};
// The making-of's close-ups, two-shots and groups: a face of the crew behind the shot's subjects cut by the top of the
// frame (or the banner) is never left cut. Decided once per shot (no hunting as it drifts): tilted down until those
// faces are out of the frame when the subjects still fit under the banner, else stepped back until they are whole under
// it (with any face that brings in cut at the top).
function clearTop(pos, look, subjects) {
  if (!makingOf?.active || !blocking.crew || !subjects.length) return;
  const others = [...bots.values()].filter((b) => b.group.visible && !subjects.includes(b));
  const aim = () => { fitCam.position.copy(pos); fitCam.lookAt(look); fitCam.updateMatrixWorld(true); };
  const t = Math.tan((fitCam.fov * Math.PI) / 360);
  if (!shot.clear) {
    aim();
    const cut = topCut(fitCam, others, limits.makingRoof);
    shot.clear = { tilt: false, hold: [] };
    if (cut.length) {
      const { hi } = measure(fitCam, pos, look, subjects, _cm);
      const lift = 1.02 - Math.min(...cut.map((c) => c.y0));
      // (tilted, no other face may come up under the banner)
      const y0 = look.y;
      look.y -= lift * pos.distanceTo(look) * t;
      aim();
      const clean = hi + lift <= limits.makingRoof && !topCut(fitCam, others, limits.makingRoof).length;
      look.y = y0;
      if (clean) shot.clear.tilt = true;
      else {
        const hold = new Set(cut.map((c) => c.bot));
        const p0 = pos.clone(), l0 = look.clone();
        for (let pass = 0; pass < 3; pass++) {
          pos.copy(p0); look.copy(l0);
          fit(pos, look, [...subjects, ...[...hold].map((b) => faceBounds(b))], { roof: limits.makingRoof, maxFace: faceCap() });
          aim();
          const more = topCut(fitCam, others, limits.makingRoof).filter((c) => !hold.has(c.bot));
          if (!more.length) break;
          for (const c of more) hold.add(c.bot);
        }
        // (a duet held so far back that its two read small: its framing kept, the crew's faces under the banner let be;
        // QA v24 c5, Green and Black 0.39 tall in a wide of the whole crew)
        const small = shot.kind === 'two' && measure(fitCam, pos, look, subjects, _cm).face < DUET_MIN;
        pos.copy(p0); look.copy(l0);
        shot.clear.hold = small ? [] : [...hold];
      }
    }
  }
  if (shot.clear.tilt) {
    // (the tilt only grows within the shot: a face bobbing in and out of the cut does not nod the camera, QA v19)
    aim();
    const cut = topCut(fitCam, others, limits.makingRoof);
    shot.clear.lift = Math.max(shot.clear.lift ?? 0, cut.length ? 1.02 - Math.min(...cut.map((c) => c.y0)) : 0);
    if (!shot.clear.lift) return;
    const { hi } = measure(fitCam, pos, look, subjects, _cm);
    const lift = Math.min(shot.clear.lift, limits.makingRoof - hi);
    if (lift > 0) look.y -= lift * pos.distanceTo(look) * t;
  } else if (shot.clear.hold.length) {
    const all = [...subjects, ...shot.clear.hold.map((b) => faceBounds(b))];
    fit(pos, look, all, { roof: limits.makingRoof, maxFace: faceCap() });
    keepCamera(pos, look, subjects, shot.kind !== 'group');
    fit(pos, look, all, { move: false, roof: limits.makingRoof, maxFace: faceCap() });
    fit(pos, look, subjects, { move: false, roof: limits.makingRoof, maxFace: faceCap() }); // (the subjects' cards before all)
  }
}
// An establishing wide opens on a line being sung: it is never so wide that the singer and its card read small (QA v21:
// the street's wide at 7.8 m, the singer's face 0.17 of the frame and its "laptop glows" card a smudge). Of `pairs`
// ([bot, slot]: the cast it would hold), the singer, whoever sings with it and those nearest it, as many as a fit from
// preset w still shows the singer's face WIDE_SINGER tall; decided once per shot (no lurch as they walk in).
const WIDE_SINGER = 0.27;
// A group shot's singers a little bigger still: its line's card under a face that small was a smudge (QA v24: the
// outro's "That's why we should win" on Green at 0.28, the shot as wide as the diner)
const GROUP_SINGER = 0.32;
const _wp2 = new THREE.Vector3(), _wl2 = new THREE.Vector3();
function singerWide(w, pairs, singer) {
  if (shot.wideN === shot.n) return pairs.filter(([b]) => shot.wideKeep.has(b));
  const own = pairs.find(([b]) => b === singer);
  let keep = pairs;
  if (own && pairs.length > 1) {
    const at = own[1];
    // (the singer first, then whoever sings with it, then the nearest)
    const rank = (b) => (b === singer ? 0 : singsLine(b) ? 1 : 2);
    const order = pairs.slice().sort((a, b) => rank(a[0]) - rank(b[0]) || Math.hypot(a[1].x - at.x, a[1].z - at.z) - Math.hypot(b[1].x - at.x, b[1].z - at.z));
    const must = Math.max(1, order.filter(([b]) => rank(b) < 2).length);
    for (let n = Math.min(order.length, Math.max(must, limits.groupMax)); n >= must; n--) {
      keep = order.slice(0, n);
      wideFit(_wp2, _wl2, w, keep.map(([b, slot]) => slotBounds(b, slot, {})));
      clampToSet(_wp2); // (as the shot will stand: inside the set's camera bounds)
      if (faceSpan(fitCam, _wp2, _wl2, singer, at) >= WIDE_SINGER) break;
    }
  }
  shot.wideN = shot.n;
  shot.wideKeep = new Set(keep.map(([b]) => b));
  return keep;
}
// A group shot on a sung line in a set is held to the same: of its members (`members`, on stage), the ones that sing a
// line now, then the nearest of the rest to them, as many as a fit from the group's angle still shows every singer's
// face WIDE_SINGER tall (QA v22: the diner finale's group of four pulled back until Green sang 0.21 tall, ~2:35).
// Decided once per shot (again when the group grows or swings round), not as voices come and go.
function singerGroup(members) {
  if (!blocking.inSet || members.length < 2) return members;
  const key = `${shot.n}:${shot.angle}:${members.map((b) => b.index).join(',')}`;
  if (shot.groupKey === key) return shot.groupKeep.filter((b) => members.includes(b));
  const singers = members.filter((b) => singsLine(b) || b === shot.bot);
  let keep = members;
  const w = blocking.def.camera?.wide?.[shot.angle ?? 0];
  if (w && singers.length && singers.length < members.length) {
    const dist = (b) => Math.min(...singers.map((s) => flatDist(b, s)));
    const order = [...singers, ...members.filter((b) => !singers.includes(b)).sort((a, b) => dist(a) - dist(b))];
    for (let n = Math.min(order.length, Math.max(singers.length, limits.groupMax)); n >= singers.length; n--) {
      keep = order.slice(0, n);
      wideFit(_wp2, _wl2, w, keep, GROUP_MIN);
      clampToSet(_wp2);
      if (Math.min(...singers.map((s) => faceSpan(fitCam, _wp2, _wl2, s))) >= GROUP_SINGER) break;
    }
  }
  shot.groupKey = key;
  shot.groupKeep = keep;
  return keep;
}
// A wide from preset w's angle (its line of sight) at the middle of `items` (bots or framing bounds),
// stepped back from `near` (WIDE_MIN; a group shot: GROUP_MIN) until every head and card is in frame
// with a margin at the sides.
const WIDE_MIN = 4.2, GROUP_MIN = 3.0;
function wideFit(pos, look, w, items, near = WIDE_MIN) {
  _c.set(0, 0, 0);
  for (const it of items) {
    const c = it.group ? it.group.position : _o.set(it.x, (it.top + it.cardBottom) / 2, it.z);
    _c.add(c);
  }
  _c.divideScalar(items.length);
  _d.set(w.pos[0] - w.look[0], w.pos[1] - w.look[1], w.pos[2] - w.look[2]).normalize();
  look.copy(_c);
  pos.copy(look).addScaledVector(_d, near);
  fit(pos, look, items, { side: 0.86, roof: roofNow() });
}
// Inside the set's walls, never through a cabinet; close shots also clear of other bots' heads.
// When the line of sight is blocked: look over the top, step round the subject, and only then in.
// [up (m), turn (rad), closer (share of the distance; < 0: back)]. Last, for a near head shown too big (framing.js
// MAX_FACE): back off until it is small enough, or in past it (only while the subjects still fit across). Last of all,
// in a crowd that hides the subject from all of those (QA v22: Blue's head in front of Green's close-up in the diner
// finale, the least crowded of them still a seventh over the cap), high over the heads in front.
const TRIES = [[0.45, 0, 0], [0, 0.42, 0], [0, -0.42, 0], [0.5, 0.42, 0], [0.5, -0.42, 0], [0.85, 0, 0],
  [0.85, 0.5, 0], [0.85, -0.5, 0], [0.45, 0, 0.2], [0, 0, -0.35], [0.35, 0, -0.35], [0, 0, -0.7], [0.4, 0, -0.7],
  [0, 0, 0.4], [0, 0, 0.55], [1.2, 0, 0.15], [1.2, 0.45, 0.15], [1.2, -0.45, 0.15]];
const _mk = {};
const HIGH_UP = 1.2; // (TRIES: the last resorts, high over the heads in front)
// The camera as rendered (it eases toward its goal, so it lags a singer walking in) holds the heads
// and cards too: stepped back and tilted in place, the ease goes on from there.
function holdFrame(pos, look) {
  if (!shotSubjects.length) return;
  const move = shot.kind !== 'wide' && !(shot.kind === 'group' && blocking.marchers);
  fit(pos, look, shotSubjects, { move, roof: roofNow(), maxFace: faceCap() });
  if (blocking.inSet && move) {
    clampToSet(pos);
    fit(pos, look, shotSubjects, { move: false, roof: roofNow(), maxFace: faceCap() });
  }
}
// Every singer's card readable at once (framing.js layoutCards), on the camera as rendered: the story's line keeps
// its place, then the harmonies, the pal's answers, the backing (a voice singing now before a card still up from its
// line); each of the others moves the least that clears the cards before it by CARD_GAP (sideways, else down) and the
// faces behind it. The heads ease their cards there.
function layoutLyricCards() {
  camera.updateMatrixWorld();
  const cards = [], faces = [], laid = [];
  for (const b of bots.values()) {
    if (!b.group.visible) continue;
    const s = screenCard(camera, b);
    // (a singer whose head is out of the shot: no card at the frame's edge without its face, QA v22; nor one whose head
    // the frame's side cuts, unless the shot is about it: QA v22, Blue half out at the left with its "Right!")
    const out = !s || s.face.x1 < -1.2 || s.face.x0 > 1.2 || s.face.y1 < -1.2 || s.face.y0 > 1.2;
    if (out || ((s.face.x0 < -1 || s.face.x1 > 1) && !shotSubjects.includes(b))) {
      const c = b.head?.card;
      if (c && !(c.merged && c.shown <= 0.02)) b.head.setCardShift(c.x, c.y, true, 'hide');
      if (out) continue;
      faces.push({ key: b.index, depth: s.depth, ...s.face });
      continue;
    }
    faces.push({ key: b.index, depth: s.depth, ...s.face });
    if (!s.card) continue;
    cards.push({ key: b.index, rank: (CARD_RANK[b.part] ?? 1) + (b.singing > 0 ? 0.5 : 0), depth: s.depth, ...s.card, px: s.px, py: s.py });
    laid.push([b, s]);
  }
  if (!cards.length) return;
  const moves = layoutCards(cards, faces, { gap: CARD_GAP });
  // as drawn this frame (and on their way to those moves) no two cards overlap: a card whose way crosses another's
  // jumps, one that would still lie over another goes down at once (framing.js settleCards; QA v22 2:26)
  const now = settleCards(cards.map((c) => {
    const m = moves.get(c.key), gone = m.merged;
    return { key: c.key, rank: c.rank, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, px: c.px, py: c.py, dx: m.dx, dy: Math.min(0, m.dy), gone };
  }).filter((c) => !c.gone || (laid.find(([b]) => b.index === c.key)?.[0].head.card.shown ?? 0) > 0.02));
  for (const [b, s] of laid) {
    const m = moves.get(b.index), k = b.group.scale.x || 1, how = now.get(b.index);
    b.head.setCardShift((m.dx * s.mx) / k, (m.dy * s.my) / k, m.merged, how === 'ease' ? null : how);
  }
}
function clampToSet(pos) {
  const b = blocking.def.camera.bounds;
  pos.x = Math.min(b[1], Math.max(b[0], pos.x));
  pos.y = Math.min(b[3], Math.max(b[2], pos.y));
  pos.z = Math.min(b[5], Math.max(b[4], pos.z));
}
let keptTry = -1;
// The way round a blocked line of sight is kept for the shot while it stays clear (TRIES index, -1: the shot's own
// place): the goal does not flick between two places as a head bobs at the edge of the line (QA v12). Blocked for
// less than KEEP_HOLD s it is kept too (a bot walking past is let past), and a new place mid-shot is a reframe (a far
// one cuts, the render loop; QA v19: the making-of's duets swung round every crewmate who walked by).
const TRY_ORDER = [-1, ...TRIES.keys()];
const KEEP_HOLD = 0.6;
function tryPlace(k, pos, look) {
  if (k < 0) { pos.copy(_base); return; }
  const [up, turn, closer] = TRIES[k];
  _o.copy(_base).sub(look).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).multiplyScalar(1 - closer);
  pos.copy(look).add(_o);
  pos.y = _base.y + up;
  clampToSet(pos);
}
function keepCamera(pos, look, subjects, heads) {
  clampToSet(pos);
  _base.copy(pos);
  const held = shot.keepN === shot.n ? shot.keep : null;
  if (held !== null) {
    tryPlace(held, pos, look);
    // (mid-shot, a head near it moves the camera when one standing there shows bigger than a head may (QA v22: a fifth
    // over it was let stand, Blue looming in the finale's close-up), or one walking past twice as big: a crewmate passing
    // by is let past, one walking into the lens is not; a place taken for want of a clear one, when they show bigger
    // than when it was taken)
    const clear = !blocked(pos, look, subjects, heads, false, true) && !(heads && crowd(pos, look, subjects, 1, 2) > Math.max(1, (shot.keepBad ?? 0) * 1.1));
    if (clear) { shot.blockedAt = null; keptTry = held; return; }
    shot.blockedAt ??= shot.age;
    if (shot.age - shot.blockedAt < KEEP_HOLD) { keptTry = held; return; }
  }
  const take = (k, bad = 0) => {
    if (held !== null && k !== held) shot.reframe = shot.moved = true;
    Object.assign(shot, { keep: k, keepN: shot.n, blockedAt: null, keepBad: bad });
    keptTry = k;
  };
  // the first clear place (a subject's face no taller than a face may be: fitFrame would step back into the way; a
  // singer's face no smaller than WIDE_SINGER from it, unless it was already: QA v22, the beach's two-shot backed off to
  // a wide of small bots)
  // (a group shot: every one of its singers, GROUP_SINGER; QA v24, the outro's group backed off 35% to Green at 0.23)
  const singers = shot.kind === 'group' ? subjects.filter(singsLine) : subjects.filter(singsLine).slice(0, 1);
  const floorFace = shot.kind === 'group' ? GROUP_SINGER : WIDE_SINGER;
  const span0 = singers.map((b) => faceSpan(fitCam, _base, look, b));
  let own = span0.map((f) => Math.min(floorFace, f));
  const fits = (k) => k < 0 || (measure(fitCam, pos, look, subjects, _mk).face <= faceCap() && (TRIES[k][2] <= 0.3 || _mk.wide <= 0.9)
    && singers.every((b, i) => faceSpan(fitCam, pos, look, b) >= own[i] - 1e-3));
  // (QA probes, ?cinema: why each place was passed over at the shot's first choice; main.js __mbShotInfo)
  const why = camLog && held === null ? (shot.why = []) : null;
  // (the places high over the heads are for a close-up or a two-shot hidden by a crowd from every other place, never a
  // group: looked down on from there it showed the diner's floor, QA v24 outro)
  // (a group: first a place where its singers show GROUP_SINGER whatever the preset's own place shows (QA v25 probe: the
  // outro's group re-placed mid-shot onto its preset's place, Green and Pink 0.3 in a wide of the diner), then as before)
  const group = shot.kind === 'group' && singers.length > 0;
  for (const strict of group ? [true, false] : [false]) {
    const rel = own;
    if (strict) own = singers.map(() => GROUP_SINGER);
    for (const k of TRY_ORDER) {
      tryPlace(k, pos, look);
        if (shot.kind === 'group' && k >= 0 && TRIES[k][0] >= HIGH_UP) continue;
      const ok = strict ? singers.every((b, i) => faceSpan(fitCam, pos, look, b) >= own[i] - 1e-3) && fits(Math.max(k, 0) === k ? k : -1) : fits(k);
      if (why) why.push([k, ok ? 1 : 0, blocked(pos, look, subjects, false) ? 1 : 0, blocked(pos, look, subjects, heads, false) ? 1 : 0, heads ? +crowd(pos, look, subjects).toFixed(2) : 0, crowdWho?.name ?? '', crowdWho?.moving ? 1 : 0, strict ? 1 : 0]);
      if (ok && !blocked(pos, look, subjects, heads)) { own = rel; take(k); return; }
    }
    own = rel;
  }
  // else, of the places with a line of sight, the one where the heads near the camera show least
  let best = null, least = Infinity;
  // (a group whose singers' faces hold GROUP_SINGER only where a head looms over the shot: the head out first, the
  // singers still WIDE_SINGER; QA v25 probe, White 0.9 in front of the bridge's Gold + Pink)
  for (let pass = 0; heads && pass < (shot.kind === 'group' ? 2 : 1) && !(least <= 1.5); pass++) {
    if (pass) own = span0.map((f) => 0.8 * Math.min(WIDE_SINGER, f));
    let b2 = null, l2 = Infinity;
    for (const k of TRY_ORDER) {
      if (shot.kind === 'group' && k >= 0 && TRIES[k][0] >= HIGH_UP) continue;
      tryPlace(k, pos, look);
      if (!fits(k) || blocked(pos, look, subjects, heads, false)) continue;
      const c = crowd(pos, look, subjects);
      if (c < l2 - 0.05) { l2 = c; b2 = k; }
    }
    if (b2 !== null && (best === null || l2 < least - 0.3)) { best = b2; least = l2; }
  }
  // (a premiere close-up or two-shot with no clear place at its cut, a head in front still too big from every one:
  // the shot becomes a group shot of the singer instead, the crowd in it; QA v22, Blue and Yellow looming in front of
  // Green in the diner finale, 0.57 to its 0.40)
  if (held === null && least > 1 && (shot.kind === 'close' || shot.kind === 'two') && !makingOf?.active) shot.crowded = true;
  if (best !== null) { take(best, least); tryPlace(best, pos, look); return; }
  take(-1);
  pos.copy(_base);
  pos.y += 0.7;
  clampToSet(pos);
}
// How big the heads of the bots near the camera would show (framing.js faceSpan, NDC), against what they may show: the
// largest share of its limit, where each one stands (a walker: where it is going), or half of it on its way there (a
// walker passing the lens: QA v19, a premiere close-up); above 1, a head too big. The limit (fgCap): beside the shot's
// subjects a little more than their faces (MAX_FACE at most), and for a head FG_NEARER m or more nearer the camera than
// they are, in front of them, no floor and never taller than their faces (QA v22: Gold's head 0.36 m in front of Green's
// close-up showed 0.72 to its 0.66). The set's extras count too.
const _wp = new THREE.Vector3(), _cv = new THREE.Vector3(), _cd = new THREE.Vector3(), _ec = {};
const FG_NEARER = 0.3, EDGE_SHARE = 0.7;
// (`stand`, `pass`: what a head where it stands and on its way are divided by, for a place the shot holds)
let crowdWho = null; // (QA probes: the head crowd() found worst)
function crowd(pos, look, subjects, stand = 1, pass = 1) {
  crowdWho = null;
  const beside = fgCap(pos, look, subjects);
  const front = subjects.length ? Math.min(fgCap(pos, look, subjects, true), Math.max(0.05, _fg.face)) : beside;
  _cv.copy(look).sub(pos).normalize();
  let near = Infinity;
  for (const b of subjects) near = Math.min(near, _cv.dot(_cd.copy(b.group.position).sub(pos)));
  const limit = (p) => (_cv.dot(_cd.copy(p).sub(pos)) < near - FG_NEARER ? front : beside);
  // (a head the frame's side cuts: EDGE_HEAD at most, QA v22, and no bigger than EDGE_SHARE of the subjects' faces: a
  // group's neighbour sliced by the frame as big as its singers is a head cut, not a sliver; QA v24, the outro's opening)
  const edge = makingOf?.active ? EDGE_HEAD : Math.min(EDGE_HEAD, EDGE_SHARE * (subjects.length ? _fg.face : MAX_FACE));
  // (the making-of's duet steps out in front of the crew: a crewmate behind it at the frame's edge is the crowd it sings
  // to, not a head cut in front of it; QA v25 probe, the c5 two-shot swung round to the set's dark edge to leave White whole)
  const behind = makingOf?.active && blocking.crew && shot.kind === 'two' ? (p) => _cv.dot(_cd.copy(p).sub(pos)) > near + FG_NEARER : () => false;
  const at = (o, p = null) => {
    const f = faceSpan(fitCam, pos, look, o, p, _ec), at0 = p ?? o.group.position, lim = limit(at0);
    return f / (_ec.cut && !behind(at0) ? Math.min(lim, edge) : lim);
  };
  let most = 0;
  for (const o of bots.values()) {
    if (subjects.includes(o) || !o.group.visible) continue;
    if (!o.moving) { const v = at(o) / stand; if (v > most) { most = v; crowdWho = o; } continue; }
    const v = at(o, o.target) / stand;
    if (v > most) { most = v; crowdWho = o; }
    let a = o.pos;
    for (const b of [...o.via, o.target]) {
      const n = Math.min(12, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3));
      for (let i = 1; i <= n; i++) {
        _wp.lerpVectors(a, b, i / n);
        // (its head brushing the lens, whatever the frame would catch of it: the nearer, the worse)
        const r = 0.5 + o.unit * o.group.scale.x, d = Math.hypot(_wp.x - pos.x, _wp.z - pos.z);
        const v = (d < r ? 3 * (2 - d / r) : faceSpan(fitCam, pos, look, o, _wp) / limit(_wp) / 2) / pass;
        if (v > most) { most = v; crowdWho = o; }
      }
      a = b;
    }
  }
  return most;
}
// Is the line of sight from pos to look blocked: by furniture, or (heads) by another bot's head on it (or the camera
// inside one, or hiding a subject's face), or (big) by a head nearer the camera that would show taller than it may (crowd: MAX_FACE, or in front of the subjects fgCap)?
// A bot walking is judged where it is going (a walker crossing the shot does not move the camera).
function blocked(pos, look, subjects, heads, big = heads, held = false) {
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const x = pos.x + (look.x - pos.x) * t, y = pos.y + (look.y - pos.y) * t, z = pos.z + (look.z - pos.z) * t;
    for (const o of blocking.obstacles) {
      if (y < o.y1 + 0.05 && y > o.y0 && x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05) return true;
    }
  }
  if (!heads) return false;
  if (big && crowd(pos, look, subjects) > 1) return true;
  // a subject's face more than a third behind a nearer head (QA v20: a two-shot backed off behind the front row)
  if (subjects.length) {
    fitCam.position.copy(pos);
    fitCam.lookAt(look);
    fitCam.updateMatrixWorld(true);
    // (mid-shot, a bot walking across the line hides a face only for a moment: let past)
    const occ = faceOcclusion(fitCam, [...bots.values()].filter((b) => b.group.visible && !(held && b.moving && !subjects.includes(b))));
    if (subjects.some((b) => (occ.get(b) ?? 0) > 0.35)) return true;
    // (a close-up's or a two-shot's: the bots its line names, in the frame, a quarter of their face at most behind a head)
    if (shot.kind === 'close' || shot.kind === 'two') {
      for (const b of shot.featured ?? []) {
        if (subjects.includes(b) || (occ.get(b) ?? 0) <= 0.25) continue;
        const s = screenCard(fitCam, b);
        if (s && Math.abs((s.face.x0 + s.face.x1) / 2) < 0.9 && Math.abs((s.face.y0 + s.face.y1) / 2) < 0.9) return true;
      }
    }
  }
  _q.copy(look).sub(pos);
  const L2 = _q.lengthSq();
  if (L2 < 1e-6) return false;
  for (const o of blocking.onSet()) {
    if (subjects.includes(o)) continue;
    const p = o.moving ? o.target : o.group.position;
    const t = Math.max(0, Math.min(1, _q.dot(_c.copy(p).sub(pos)) / L2));
    if (t > 0.92) continue;
    if (_c.copy(pos).addScaledVector(_q, t).distanceTo(p) < o.unit * 2.4 * 0.95) return true;
  }
  return false;
}
// The tallest a subject's face may show in the shot now (framing.js SHOT_FACE: a close-up's MAX_FACE, a two-shot's or a
// group's a medium shot's, the making-of's duet in front of the crew a little wider), and the tallest a bystander's head
// may show beside the subjects' faces from pos (framing.js foregroundCap; `nearer`: one in front of them).
const faceCap = () => SHOT_FACE[shot.kind === 'two' && blocking.crew ? 'duet' : shot.kind] ?? MAX_FACE;
const _fg = {};
const fgCap = (pos, look, subjects, nearer = false) => (subjects.length ? foregroundCap(Math.min(faceCap(), measure(fitCam, pos, look, subjects, _fg).face), nearer) : MAX_FACE);
// The tallest head of a bot the shot does not hold, from a camera at pos looking at look (framing.js faceSpan, NDC).
const LENS_HEAD = 1.1;
function lensHead(pos, look) {
  let most = 0;
  for (const b of bots.values()) if (b.group.visible && !shotSubjects.includes(b)) most = Math.max(most, faceSpan(fitCam, pos, look, b));
  return most;
}
// Every shot holds its singers' heads and lyric cards (the cards clear of the lower third): close-ups
// and two-shots step back and tilt as needed, wides only tilt (framing.js).
const fitCam = new THREE.PerspectiveCamera();
// fitFrame on the scratch camera, within the screen's limits (viewport.js: on a desktop the designed CARD_FLOOR and
// HEAD_ROOM; on a phone clear of its banner, notch and bottom overlays)
const fit = (pos, look, subjects, opts = {}) => fitFrame(fitCam, pos, look, subjects,
  { floor: limits.floor, roof: limits.roof, ...opts, side: Math.min(opts.side ?? limits.side, limits.side) });
let shotSubjects = [];
// a bot the camera may frame: in a set, one that is in the scene (not entering, parked or hidden)
// (a bot still coming in through a door at the set's edge is not framed close: the shot would look out
// past the set; one walking to its place within the set is, so the camera keeps a singer who moves)
const onStage = (b) => !!b && b.group.visible && (!blocking.inSet || (blocking.isOn(b) && !blocking.entering(b)));
function shotGoal(pos, look) {
  // a two-shot whose partner is not in the scene (still entering, parked): hold the one who is
  if (shot.kind === 'two' && !(onStage(shot.bot) && onStage(shot.partner))) {
    const keep = onStage(shot.bot) ? shot.bot : onStage(shot.partner) ? shot.partner : null;
    setShot(keep ? 'close' : 'group', keep, null, { force: true }); // (another shot: a cut)
  }
  if (shot.kind === 'close' && !onStage(shot.bot)) setShot('group', null, null, { force: true });
  fitCam.fov = camera.fov;
  fitCam.aspect = camera.aspect;
  fitCam.updateProjectionMatrix();
  // a group holds its core cast on stage (where they are); the wide only tilts for the singer it opens on
  const members = shot.kind === 'group' ? singerGroup(shot.members.filter(onStage)) : [];
  const subjects = shot.kind === 'close' && shot.bot ? [shot.bot]
    : shot.kind === 'two' && shot.bot && shot.partner ? [shot.bot, shot.partner]
      : members.length ? members
        : lastStaged?.bot && lastStaged.bot.group.visible && lastStaged.bot.singing > 0 ? [lastStaged.bot] : [];
  shotSubjects = subjects;
  if (blocking.inSet) {
    setShotGoal(pos, look, subjects);
    return;
  }
  studioShotGoal(pos, look, subjects);
  fit(pos, look, subjects, { move: shot.kind !== 'wide', maxFace: faceCap() });
}
const STUDIO_GROUP = new THREE.Vector3(0, 0.62, 1).normalize(); // the studio's group shots: from the front, a little above
function studioShotGoal(pos, look, subjects) {
  const drift = Math.min(shot.age, 6) * 0.06; // slow push-in
  if (shot.kind === 'close' && shot.bot) {
    const p = shot.bot.group.position;
    const side = shot.side || (p.x > 0 ? -1 : 1); // look across the choir, toward its middle (or the side chosen)
    const back = shot.bot.home.y > 1.2; // back row: shoot over the front row's heads
    look.set(p.x, p.y + 0.1, p.z);
    pos.set(p.x + side * 0.45, p.y + (back ? 0.75 : 0.3), p.z + (back ? 2.3 : 1.7) - drift * 0.5);
  } else if (shot.kind === 'two' && shot.bot && shot.partner) {
    frontTwoShot(shot.bot.group.position, shot.partner.group.position, drift, pos, look);
  } else {
    // the core cast (the beat's cast stands in the middle of the front row: blocking.js studioPlaces) and whoever
    // sings, from the front, as close as holds them all, pushing in slowly; nobody to hold: the whole choir
    const hold = shot.kind === 'group' && subjects.length ? subjects : shot.members.filter((b) => b.group.visible);
    if (hold.length) {
      look.set(0, 0, 0);
      for (const b of hold) look.add(b.group.position);
      look.divideScalar(hold.length);
      look.y += 0.05;
      pos.copy(look).addScaledVector(STUDIO_GROUP, (shot.kind === 'wide' ? 4.4 : 3.1) - drift * 0.5);
      pos.x += Math.sin(shot.age * 0.07) * 0.25;
      fit(pos, look, hold, { side: 0.86 });
    } else {
      look.set(0, 1.1, 0);
      pos.set(Math.sin(shot.age * 0.05) * 1.0, 2.1, 6.6 - drift);
    }
  }
}
const _pos = new THREE.Vector3(), _look = new THREE.Vector3();

// The production role on screen (cinema lower third): who is singing, which of the eight jobs they
// embody and what they are doing. A line sung together reads "Green + White · chorus". Switched
// instantly (no CSS transitions: a frame-exact capture cannot step those).
const ROLE_LABEL = { lyrics: 'Lyricist', chords: 'Arranger', dance: 'Choreographer', lighting: 'Lighting',
  deals: 'Producer', hype: 'Hype', comedy: 'Comedy', trouble: 'Plot trouble' };
const ROLE_COLOR = { lyrics: '#7aa2ff', chords: '#ffb35c', dance: '#ff6fb1', lighting: '#ffe066',
  deals: '#5fd39b', hype: '#ff7a59', comedy: '#c78bff', trouble: '#9aa0b4' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const roleEl = document.getElementById('role');
let roleKey = null;
function showRole(e, sung = true) {
  if (!roleEl) return;
  // the premiere: only a line sung shows who sings it; its crew's work (a consultation, a lighting cue: the making-of's
  // statuses, "consulting Gold", "at work") stays the making-of's (QA v24: "Black · at work" over the outro's chorus)
  if (!makingOf?.active && (!sung || !e.singer)) return;
  const joins = lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bots.get(e.singer ?? e.bot);
  if (joins && roleKey) {
    const who = roleEl.querySelector('.who'), name = e.singer ?? e.bot;
    if (!who.textContent.split(' + ').includes(name)) who.textContent += ` + ${name}`;
    const writer = roleEl.dataset.writer;
    roleEl.querySelector('.what').textContent = writer ? `sing ${writer}'s line` : 'singing it together';
    return;
  }
  const doing = e.doing ? e.doing : e.status === 'consulting' && e.consult.length ? `consulting ${e.consult.join(', ')}`
    : e.status === 'proposing' ? 'proposing a line' : 'at work';
  const job = esc(ROLE_LABEL[e.agent] ?? e.agent);
  // the premiere: a story-cast singer sings a line a role bot wrote ("Gold · sings Green's line (Lyricist)"), or its own
  // ("Green · Lyricist · sings its own line": never the making-of's "proposing a line", QA v24)
  const writer = e.singer && e.singer !== e.bot ? e.bot : '';
  const own = !makingOf?.active && !writer;
  roleKey = e.seq;
  roleEl.dataset.writer = writer;
  roleEl.style.setProperty('--c', ROLE_COLOR[e.agent] ?? '#fff');
  roleEl.innerHTML = writer
    ? `<span class="dot"></span><b class="who">${esc(e.singer)}</b><span class="what">sings ${esc(writer)}'s line</span><span class="job">(${job})</span>`
    : `<span class="dot"></span><b class="who">${esc(e.bot)}</b><span class="job">${job}</span><span class="what">${esc(own ? 'sings its own line' : doing)}</span>`;
}
let lastStaged = null;
let recentClose = []; // the last close-ups: the same singer twice in a row gets a two-shot or a group
let replyShots = 0, repeatShots = 0;
let cutT = -1; // song time of the last cut to a new set

// The hand gestures the stage adds (staging.js): a line's words ("I reach for a high-five"), a listening core
// member's chin stroke or thumbs up, the end of a consultation (a handshake, high five or fist bump), and a crew
// member's action played by a free bot of the scene when its own bot is off stage. Deferred on the song clock and
// played only on a free bot (on stage, its hands its own, not walking, rested since the last one): never busy.
let cueQueue = [], cueN = 0;
let lastLead = null; // the singer of the last story line (the pal's answer goes to it)
let standIn = { t: -1, seq: -1 }; // the one off-stage action of a burst (events of one moment) that is played
const gestured = new Map(); // bot -> song time of the last gesture the stage gave it
const later = (dt, fn) => cueQueue.push({ at: player.time + dt, n: cueN++, fn });
function runCues() {
  if (!cueQueue.length || !cueQueue.some((c) => c.at <= player.time)) return;
  const due = cueQueue.filter((c) => c.at <= player.time).sort((a, b) => a.at - b.at || a.n - b.n);
  cueQueue = cueQueue.filter((c) => c.at > player.time);
  for (const c of due) c.fn();
}
const cueLog = (window.__mbCues = []); // the gestures the stage gave (tests and capture tools)
const flatDist = (a, b) => Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
const DUO_REACH = 2.6; // m: two bots this near can meet hands (plays/kit.js DUO_TRAVEL)
const handsFree = (b) => onStage(b) && !b._hand && !b.moving && player.time - (gestured.get(b) ?? -Infinity) >= GESTURE_REST;
/** Plays cue ({ id, kind, cast }: staging.js cueOf) on bot b (a duo with `partner`), if both are free. */
function perform(b, cue, partner = null, e = null) {
  if (!b || !cue || !handsFree(b)) return false;
  const ctx = { ...clock, time: player.time, playing: true };
  let played = true, other = null;
  if (cue.kind === 'play' && cue.cast === 'duo') {
    const ok = partner && partner !== b && handsFree(partner) && flatDist(b, partner) <= DUO_REACH;
    if (!ok) {
      if (cue.id !== 'high-five') return false;
      b.hands.play('highFive'); // reaching for one on its own
    } else {
      played = startPlay(cue.id, b, [partner], ctx);
      other = partner;
      gestured.set(partner, player.time);
    }
  } else if (cue.kind === 'play') played = startPlay(cue.id, b, cue.cast === 'group' && e ? castOf(e, b).slice(1).filter(onStage) : [], ctx);
  else if (cue.kind === 'gesture') playGesture(b, cue.id);
  else playAct(b, cue.id);
  gestured.set(b, player.time);
  if (cueLog.length < 400) cueLog.push({ t: +player.time.toFixed(2), bot: b.name, id: cue.id, with: other?.name ?? null, played });
  return true;
}
/** A bot near b to meet hands with: the pal, else a core member, else whoever stands nearest (on stage, in reach). */
function duoPartner(b, e) {
  const near = (x) => x && x !== b && onStage(x) && flatDist(b, x) <= DUO_REACH;
  return [bots.get(episodeBeats?.roles?.pal), ...coreOnStage(), partnerOf(e, b, [])].find(near) ?? null;
}
const ACTION_RANK = { play: 2, gesture: 1, act: 0 };
/**
 * In a set, a crew member's action (its bot off stage: the making-of's role bots are not the story's cast) is played
 * by a free bot of the scene (a core member first): the best one of its moment (a group play, then a duo, ...), once.
 */
function standInFor(e) {
  if (standIn.t !== e.t) {
    let best = null;
    for (const x of player.events) {
      if (x.t !== e.t || x.beat !== e.beat || parseLyric(x.lyric, NAMES).text || onStage(bots.get(x.singer ?? x.bot))) continue;
      const r = resolveAction(x.action);
      if (!(r.kind in ACTION_RANK)) continue;
      const rank = ACTION_RANK[r.kind] + (PLAYS_GROUP.has(r.id) ? 2 : PLAYS[r.id] === 'duo' ? 1 : 0);
      if (!best || rank > best.rank) best = { rank, seq: x.seq };
    }
    standIn = { t: e.t, seq: best?.seq ?? -1 };
  }
  if (e.seq !== standIn.seq) return null;
  const pool = [...coreOnStage(), ...castOf(e, null).slice(1).filter(onStage)].filter((b, i, a) => a.indexOf(b) === i && !(b.singing > 0) && handsFree(b));
  return pickBySeq(e.seq, 'stand-in', pool) ?? null;
}

function stage(e) {
  // a making-of aside (a remark there was no time to sing): the banner shows it (making-of.js), no card, no cut
  if (e.kind === 'aside') return;
  // the premiere is sung by the story cast (e.singer); the making-of by the role bots (e.bot)
  const bot = bots.get(e.singer ?? e.bot);
  const line = parseLyric(e.lyric, NAMES); // v2 markup: {Name:act} cues, [Pickup], >> reply
  if (bot && e.part === 'backing') { // a backing part (bass, pads, groove, "la la", a hum): its mouth and a soft spot, no card (cardFor), no cut
    const card = cardFor(e, line.text);
    bot.sing(2.2, card?.text ?? '', choir.lineFor(e), { part: 'backing', cycle: true });
    choir.sing(e);
    return;
  }
  if (bot && (e.part === 'reply' || e.part === 'echo')) { // the pal answers the line: card + mouth, no cut, no lower third
    const timing = choir.lineFor(e);
    if (line.text) bot.sing(2.2, line.text, timing, { part: e.part });
    choir.sing(e);
    // its words may cue a gesture ("Up high!": a high five with the singer it answers; an echo doubling the pal's
    // answer does not repeat it)
    const doubles = episodeBeats?.roles?.pal && bot.name !== episodeBeats.roles.pal && !makingOf?.active;
    for (const g of lineGestures({ seq: e.seq, text: line.text, part: doubles ? 'harmony' : e.part, singer: bot, partner: onStage(lastLead) ? lastLead : null, delay: timing?.delay ?? 0.45 })) {
      later(g.at, () => perform(g.bot, g.cue, g.partner, e));
    }
    return;
  }
  // a harmony singer's copy of the line just staged (its own card); a wordless event never counts as one
  const chorus = !!line.text && bot && lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bot;
  if (bot) {
    const timing = line.text ? choir.lineFor(e) : null;
    // (a making-of duet's question, answer and seal: its two singers' spots a little softer than a lead's)
    if (line.text) bot.sing(2.2, line.text, timing, { part: chorus ? 'harmony' : 'lead', spot: e.duet && !chorus ? 'duet' : null });
    if (!chorus) blocking.onEvent(e, bot);
    if (!chorus && blocking.changed) { resetPlays(); cueQueue = []; } // a cut to another set: the last scene's hand plays end
    // in a set, a consultation needs both bots in the scene (the crew's role bots are often off stage)
    const inScene = (b) => !blocking.inSet || onStage(b);
    if (e.status === 'consulting' && inScene(bot)) {
      const others = e.consult.map((c) => bots.get(c)).filter((b) => b && b !== bot && inScene(b));
      // (e.duet: the making-of's sung consultation, a duet that a hand play of its own seals)
      const s = others.length ? consult(bot, others, e.duet) : null;
      // ... and ends with a handshake, a high five or a fist bump (unless they already shook on it)
      if (s && !e.duet) later((s.dur ?? 4) + 0.1, () => perform(bot, cueOf(pickBySeq(e.seq, 'consult-end', DUO_ENDINGS)), others[0], e));
    }
    if (!chorus) reactToCues(line.cues, bot, bots);
    // the making-of: a thought said to a crewmate (making-of-score.js addresseeOf): the singer turns to it, it nods back
    if (!chorus && makingOf?.active && e.to && bots.get(e.to)) address(bot, bots.get(e.to), timing?.length ?? 2);
    const partner = partnerOf(e, bot, line.cues);
    const r = resolveAction(e.action);
    // who acts it: the event's bot, else (a crew member off stage in a set) a free bot of the scene, else nobody
    const actor = line.text || !blocking.inSet || onStage(bot) || !(r.kind in ACTION_RANK) ? bot : standInFor(e);
    if (actor) {
      if (r.kind === 'play') {
        const others = PLAYS_GROUP.has(r.id) ? castOf(e, actor).slice(1) : actor === bot ? (partner ? [partner] : []) : [duoPartner(actor, e)].filter(Boolean);
        startPlay(r.id, actor, others, { ...clock, time: player.time, playing: true });
        gestured.set(actor, player.time);
      } else if (r.kind === 'gesture') { playGesture(actor, r.id); gestured.set(actor, player.time); }
      else if (r.kind === 'act') playAct(actor, r.id);
      if (actor !== bot && cueLog.length < 400) cueLog.push({ t: +player.time.toFixed(2), bot: actor.name, id: r.id, for: bot.name });
    }
    if (r.kind === 'move') blocking.move(r, bot);
    else if (r.kind === 'light') blocking.light(r, bot);
    accentAction(bot, r); // a light cue shows on its caller's face; an id nothing plays yet still nods
    choir.sing(e);
    // a story line the director gave no action: its words' gesture, and now and then a listening core member's
    if (line.text && !chorus && r.kind === 'none' && !r.id) {
      const listeners = coreOnStage().filter((b) => b !== bot && !(b.singing > 0));
      for (const g of lineGestures({ seq: e.seq, text: line.text, part: 'lead', singer: bot, partner: duoPartner(bot, e), listeners,
        delay: timing?.delay ?? 0.45, length: timing?.length ?? 2 })) later(g.at, () => !(g.listen && g.bot.singing > 0) && perform(g.bot, g.cue, g.partner, e));
    }
    if (line.text && !chorus) lastLead = bot;
    const duo = r.kind === 'play' && !PLAYS_GROUP.has(r.id) && r.id !== 'conductor';
    const named = !!partner && (line.cues.some((c) => c.name === partner.name) || e.to === partner.name); // the bot the line names (or talks to) reacts: in shot
    // a line the pal answers (" >> reply"): every other one is framed with the pal, so the answer is seen without a cut
    const pal = line.reply ? bots.get(episodeBeats?.roles?.pal) : null;
    const withPal = pal && pal !== bot && blocking.isOn(pal) && (replyShots++ % 2 === 0);
    const groupish = (r.kind === 'move' && r.id !== 'walk-to') || PLAYS_GROUP.has(r.id);
    // the cut to the line's shot comes with its card, CARD_SHOW_LEAD before the first note (a new set cuts at once: its
    // bots are already there)
    const staged = lastStaged, newSet = !chorus && blocking.changed;
    const cutIn = line.text && timing && !newSet ? Math.max(0, (timing.delay ?? 0) - CARD_SHOW_LEAD) : 0;
    const frame = () => {
      let framed = true;
      if (newSet) {
        // a new set: a short wide of the core cast at their places, then in on the singer; the last section's cards stay
        // behind (QA v24: chorus 2's "A dime buys tunes we play" over the bridge's first 0.4 s), its own line's comes up
        // (the singer's own old card too: its new one is still due, CARD_SHOW_LEAD before its first note)
        for (const b of bots.values()) b.dropCard(b === bot);
        cutT = e.t;
        setShot('wide', bot, null, { force: true, next: { kind: 'close', bot, at: ESTABLISH } });
      } else if (e.t === cutT) { framed = false; /* the lines that start with the cut keep the establishing wide */ }
      else if (chorus) { // a line sung together: the lead and its harmony; three or more voices, the group
        staged.joined = (staged.joined ?? 0) + 1;
        if (staged.joined >= 2) setShot('group', staged.bot);
        else setShot('two', staged.bot, bot);
      }
      else if (groupish && (line.text || onStage(actor ?? bot))) setShot('group', line.text ? bot : null);
      // a wordless event (the crew at work) in the premiere: the shot holds on whoever sings (the making-of shows the crew)
      else if (!line.text && !makingOf?.active) framed = false;
      else if (partner && (e.status === 'consulting' || duo || named)) setShot('two', bot, partner);
      else if (withPal) setShot('two', bot, pal);
      else if (recentClose.includes(bot)) {
        // the same singer again (a story's lead sings most lines): a two-shot with the pal (else the nearest
        // bot), then the singer from the other side, a group of the core cast every fourth time
        const k = repeatShots++ % 4;
        const other = [bots.get(episodeBeats?.roles?.pal), nearestBot(bot)].find((b) => b && b !== bot && onStage(b));
        if (k === 3 || (k === 0 && !other)) setShot('group', bot);
        else if (k === 0 || k === 2) setShot('two', bot, other ?? nearestBot(bot));
        else { const side = shot.side || 1; setShot('close', bot, null, { force: true }); shot.side = -side; }
      } else setShot('close', bot);
      if (framed) {
        // the bots the line names, on stage (they react: "Till White rings out"): no head in front of theirs either
        shot.featured = line.cues.map((c) => bots.get(c.name)).filter((b) => b && b !== bot && onStage(b));
        if (shot.kind === 'close') recentClose = [bot, ...recentClose].slice(0, 2);
        else recentClose = recentClose.slice(0, 1);
      }
    };
    if (cutIn > 0) later(cutIn, frame);
    else frame();
    if (!chorus) lastStaged = { t: e.t, lyric: e.lyric, bot };
  }
  showRole(e, !!line.text);
  caption.innerHTML = `<small>${esc(e.bot)} · ${esc(e.agent)} · ${esc(e.status)}${e.dye ? ' · DYE' : ''}</small>${esc(line.text || sungSummary(e.summary, e.bot, NAMES, episodeBeats?.summaries))}`;
  if (e.chords.length) { choir.setChords(e.chords); chordText = e.chords.join(' '); }
}

let makingOf = null; // LIVE: the crew at work (making-of.js)
const player = new Player({ onAppend: (events) => choir.prepare(events, { append: true }), onEvent: (e) => { makingOf?.cue(e); stage(e); makingOf?.staged(e); }, onReset: () => { caption.textContent = ''; if (roleEl) roleEl.innerHTML = ''; roleKey = null; replyShots = 0; repeatShots = 0; cutT = -1; cueQueue = []; gestured.clear(); lastLead = null; standIn = { t: -1, seq: -1 }; blocking.reset(); setShot('wide', null, null, { force: true, next: { kind: 'group', at: ESTABLISH } }); } });
window.__player = player;
// Play an episode: render its sung lines first (a second or two), then start the song clock and
// the transport together. window.__mbReady tells the frame-exact capture when to start.
let songEnd = 0;
// The latest Premiere / Live wins: a second press while one is still loading or warming up makes the
// first one stand down (else whichever finished rendering last would play, its voices mixed in).
let playGen = 0;
// ?typing: the opening of a demo video, the prompt typed into the bar and Premiere pressed in INTRO_SECONDS
// whatever its length (staging.js typingPlan). Driven by the time elapsed, a frame at a time (a frame-exact
// capture steps the page's clock a frame at a time: timers would round every keystroke up to whole frames).
// Resolves with the seconds it took (INTRO_SECONDS, to the frame). Each letter clacks on a mechanical keyboard, the
// space bar hollower, the press a heavier Enter (keys.js), scheduled up front on the audio clock (so a frame-exact
// capture's offline audio has every stroke where its letter lands), through the choir's master (Mute mutes them).
function typePrompt(text, button = 'go') {
  const input = $('prompt'), go = $(button);
  const plan = typingPlan(text.length);
  document.body.classList.add('typing');
  document.body.classList.toggle('press-live', button === 'live');
  input.value = '';
  const t0 = performance.now();
  if (choir.ctx) choir.typeKeys(keystrokes(text, plan), choir.ctx.currentTime);
  return new Promise((resolve) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const n = plan.typed(t);
      if (input.value.length !== n) input.value = text.slice(0, n);
      go.classList.toggle('pressed', plan.pressed(t));
      if (t < plan.total - 1e-6) { requestAnimationFrame(frame); return; }
      go.classList.remove('pressed');
      document.body.classList.remove('typing', 'press-live');
      resolve(t);
    };
    frame();
  });
}

async function playEpisode(bundleEvents, { seekTo = null, typing = null, beats = null, gen = ++playGen } = {}) {
  if (gen !== playGen) return;
  window.__mbReady = false;
  player.stopLive();
  player.pause();
  statusEl.textContent = 'warming up the choir…';
  episodeBeats = beats;
  const song = arrange(bundleEvents, beats); // the episode as a song
  // the sets the episode plays in load while the choir warms up; the blocking reads the song's own
  // events (its harmony copies, the pal's replies, the backing parts), as the stage plays them
  const sets = blocking.prepare(beats, song.events);
  // the hands and the hand plays keep this song's pulse (song time 0 = beat 0; 6/4: the dotted half, two a bar)
  Object.assign(clock, song.clock ?? motionClock(song.tempo || 60 / BEAT, 4));
  const events = song.events;
  const intro = typing ? INTRO_SECONDS : 0;
  window.__mbEnd = intro + (songEnd = song.end);
  // the song's shape for the trailer tools (scripts/render/trailer.py): sections and sung lines
  const firstOf = new Map();
  for (const e of events) if (!firstOf.has(e.beat)) firstOf.set(e.beat, e.t);
  window.__mbSong = {
    offset: intro, // capture time of song time 0 (the typed opening)
    end: song.end,
    sections: [...firstOf].map(([beat, t]) => ({ beat, t })),
    lines: song.lines.map((l) => ({ seq: l.seq, bot: l.bot, role: l.role, beat: events.find((e) => e.seq === l.seq)?.beat,
      at: l.at, end: l.at + l.job.notes.at(-1).t + l.job.notes.at(-1).dur })),
  };
  await Promise.all([choir.prepare(events, { lines: song.lines }), sets]);
  if (gen !== playGen) return; // a newer Premiere took over
  if (typing) {
    // the opening is typed over the first beat's set, the cast at their places (the load below places them again)
    blocking.reset();
    setShot('wide', null, null, { force: true, next: { kind: 'group', at: ESTABLISH } });
    window.__mbReady = true;
    // its real length (to the frame), for the capture and the trailer: song time 0 is then
    window.__mbSong.offset = await typePrompt(typing);
    window.__mbEnd = window.__mbSong.offset + song.end;
  }
  choir.begin();
  player.load(events);
  if (seekTo !== null) player.seek(seekTo);
  else player.play();
  window.__mbReady = true;
}
// A curated prompt plays its checked-in bundle (with enriched lyrics when present); any other
// prompt is generated on the spot.
// Returns { events, beats }.
async function episodeFor(prompt) {
  const slug = curatedSlug(prompt);
  if (slug) {
    try {
      const base = `${import.meta.env.BASE_URL}episodes/${slug}`;
      const [ev, bt] = await Promise.all([fetch(`${base}/events.ndjson`), fetch(`${base}/beats.json`)]);
      if (ev.ok) return { events: parseNdjson(await ev.text()), beats: bt.ok ? modernBundle(await bt.json()) : null };
    } catch { /* fall back to the generator */ }
  }
  return generate(prompt);
}
/** A hosted run's kept bundle (its share link, ?run=<id>), or null. Returns { events, beats }. */
async function episodeForRun(id) {
  try {
    const base = `${API}/${id}`;
    const [ev, bt] = await Promise.all([fetch(`${base}/events.ndjson`), fetch(`${base}/beats.json`)]);
    if (!ev.ok || !bt.ok) return null;
    return { events: parseNdjson(await ev.text()), beats: modernBundle(await bt.json()) };
  } catch { return null; }
}
async function premiere(cinema = false, opts = {}) {
  const gen = ++playGen;
  document.body.classList.toggle('premiere', cinema);
  const { events, beats } = (opts.run && await episodeForRun(opts.run)) || await episodeFor($('prompt').value);
  return playEpisode(events, { ...opts, beats, gen });
}
$('go').onclick = () => { makingOf.cancel(); premiere(true); };
// Mute: the prompt bar's, and the run bar's (index.html #runbar: the prompt bar is hidden while a run plays)
const toggleMute = () => {
  choir.setMuted(!choir.muted);
  for (const id of ['mute', 'mute2']) { $(id).textContent = choir.muted ? 'Unmute' : 'Mute'; $(id).setAttribute('aria-pressed', String(choir.muted)); }
};
$('mute').onclick = $('mute2').onclick = toggleMute;
// the premiere hides the controls: Escape, or a click / tap on the stage, brings them back (the song
// plays on), and so does the song's end (not in a frame-exact capture, ?cinema)
const showControls = () => document.body.classList.remove('premiere');
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || qs.has('cinema')) return;
  if (document.body.classList.contains('playing')) stopAll(); else showControls();
});
renderer.domElement.addEventListener('pointerdown', () => {
  if (document.body.classList.contains('playing') || makingOf.active) return; // a run plays: Stop is the way out
  showControls();
});
// what went wrong, said where it is seen (the status line is the chord readout, rewritten every frame)
let noticeTimer = 0;
function notice(text, ms = 9000) {
  const el = $('notice');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, ms);
}
// the touch hint (index.html #hint: sound on, the silent switch) goes once the visitor has chosen
for (const id of ['live', 'go']) $(id).addEventListener('click', () => document.body.classList.add('chosen'));
// the audio starts (or resumes) inside a user gesture: a touch's pointerdown does not count as one (a
// phone), the click / touchend / key that follows does; start() is idempotent
for (const type of ['pointerdown', 'click', 'touchend', 'keydown']) addEventListener(type, () => choir.start(), { capture: true });
// The hosted director's door (web/src/run-dialog.js): a new prompt's run needs the user's key or credits. The owner's
// rehearsal link (the admin page: ?rehearsal, its token in this tab) runs the stub Muse in a real sandbox instead.
const adminToken = (() => { try { return new URLSearchParams(location.search).has('rehearsal') ? sessionStorage.getItem('mb.admin') : null; } catch { return null; } })();
const runDialog = createRunDialog({ api: API, base: import.meta.env.BASE_URL, rehearsal: adminToken ? { token: adminToken } : null });
// LIVE: the Muse Code director's making-of (npm run dev, or the hosted director), or a recorded one; then the premiere.
// The crew works in the sets (every bot on stage, in the set of the beat it is writing); the premiere plays them too.
makingOf = createMakingOf({
  player, choir, bots, el: $('making'), captionEl: caption, episodeFor,
  typePrompt: (text) => typePrompt(text, 'live'), introSeconds: INTRO_SECONDS, // ?makingof&typing: the trailer's opening
  // the sets, every bot on stage: the crew in front (making-of-score.js crewFormation), the rest of the cast behind them
  prepareStage: (formation) => blocking.crewStage(formation),
  crewCut: (set) => blocking.crewCut(set),
  endStage: () => blocking.crewStage(null),
  // a crew member's thinking gesture (making-of-score.js gestureOf): played like the stage's own, when its hands are free
  gesture: (name, id) => perform(bots.get(name), cueOf(id)),
  onBeats: (beats) => { episodeBeats = beats; },
  react: (e) => { const b = bots.get(e.bot); if (b && e.line) reactToCues(parseLyric(e.line, NAMES).cues, b, bots); },
  onPremiere: (events, beats) => { document.body.classList.add('premiere'); playEpisode(events, { beats }); },
  onFallback: () => premiere(true),
  // the hosted director (Vercel): a new prompt's run starts from the run dialog (the user's key, or credits)
  startHosted: (prompt, api) => runDialog.open(prompt, api),
  episodeForRun,
  // Play (the episode is ready): skip the rest of the making-of
  playEl: $('play'),
  stopStage: () => { resetPlays(); cueQueue = []; bots.forEach((b) => b.sing(0, '')); caption.textContent = ''; },
});
$('play').onclick = () => makingOf.skip();
// Stop (index.html #runbar): the making-of (and its director's polling) or the episode, stopped; back to the landing
// screen, the prompt bar as it was. (A hosted run already started keeps going in its sandbox; its link replays it.)
function stopAll() {
  ++playGen;
  makingOf.cancel();
  player.stopLive();
  player.pause();
  choir.hush();
  resetPlays(); cueQueue = []; bots.forEach((b) => b.sing(0, ''));
  caption.textContent = '';
  if (roleEl) roleEl.innerHTML = '';
  roleKey = null;
  document.body.classList.remove('premiere', 'show-ui', 'playing', 'chosen');
  setShot('wide', null, null, { force: true });
  $('prompt').focus({ preventScroll: true });
}
$('stop').onclick = stopAll;
$('live').onclick = (ev) => (++playGen, makingOf.start($('prompt').value, { fresh: ev.shiftKey })); // shift: direct a curated prompt anew
const qs = new URLSearchParams(location.search);
const qp = qs.get('prompt'), qt = qs.get('t');
// a hosted run's share link: ?run=<id> premieres its kept bundle, &makingof replays its making-of first
const qrun = /^[a-z0-9]{20,40}$/.test(qs.get('run') ?? '') ? qs.get('run') : null;
if (qrun) {
  episodeForRun(qrun).then((b) => {
    if (!b) { notice("That run isn't available: the link may be mistyped, or the run was never kept. Here is the hero episode instead."); return premiere(false); }
    $('prompt').value = b.beats?.prompt ?? '';
    if (qs.has('makingof')) makingOf.start(b.beats?.prompt ?? '', { run: qrun });
    else premiere(qs.has('cinema'), { run: qrun });
  });
} else if (qp && qs.has('makingof')) {
  $('prompt').value = qp;
  makingOf.start(qp, { typing: qs.has('typing') }); // ?typing: the prompt typed and Make it pressed first (4 s)
} else if (qp) {
  $('prompt').value = qp;
  premiere(qs.has('cinema'), { seekTo: qt !== null ? Number(qt) : null, typing: qs.has('typing') ? qp : null });
} else {
  // the home screen: the sample with its beats (its cast in place in the diner from the first frame)
  const beatsOf = fetch(BUNDLE.replace(/events\.ndjson$/, 'beats.json')).then((r) => (r.ok ? r.json() : null)).then((b) => (b ? modernBundle(b) : null)).catch(() => null);
  Promise.all([fetch(BUNDLE).then((r) => r.text()), beatsOf]).then(([text, beats]) => playEpisode(parseNdjson(text), { beats }))
    .catch((err) => { notice(`The episode couldn't load (${err?.message ?? err}). Check your connection and reload.`); });
}

// a resize, a phone turned round, or its toolbars / keyboard coming and going: the layout, the canvas and the camera
// anew (the shot reframes itself on its next frame; a rotation cuts to it, no glide across)
let lastShape = innerWidth > innerHeight;
function onResize() {
  applyLayout();
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const shape = innerWidth > innerHeight;
  if (shape !== lastShape) { lastShape = shape; shot.cut = true; shot.clear = null; shot.wideN = -1; shot.groupKey = null; }
}
addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', applyLayout);
window.visualViewport?.addEventListener('scroll', applyLayout);
addEventListener('orientationchange', () => setTimeout(onResize, 120)); // (iOS reports the new size a moment late)

// the camera's path, one row a frame (?cinema: the frame-exact capture saves it as campath.json; QA of its smoothness)
const camLog = qs.has('cinema') ? (window.__mbCam = []) : null;
// (its last two columns: the tallest face of the shot's subjects and of the other bots in view, NDC: framing.js MAX_FACE)
const faceSpans = (pos, look) => {
  let sub = 0, other = 0;
  for (const b of bots.values()) {
    if (!b.group.visible) continue;
    const f = faceSpan(fitCam, pos, look, b);
    if (shotSubjects.includes(b)) sub = Math.max(sub, f); else other = Math.max(other, f);
  }
  return [sub, other];
};
if (camLog) window.__mbBots = bots; // (QA probes: where the heads are, who sings, on the frame-exact clock)
// (QA probes: the shot as framed now, and every head and card on screen, NDC rects)
if (camLog) window.__mbShotInfo = () => {
  camera.updateMatrixWorld();
  const r4 = (o) => o && { x0: +o.x0.toFixed(3), x1: +o.x1.toFixed(3), y0: +o.y0.toFixed(3), y1: +o.y1.toFixed(3) };
  const heads = [];
  for (const b of bots.values()) {
    if (!b.group.visible) continue;
    const s = screenCard(camera, b);
    if (!s || s.face.x1 < -1 || s.face.x0 > 1 || s.face.y1 < -1 || s.face.y0 > 1) continue;
    const c = b.head?.card, k = b.group.scale.x || 1;
    const card = s.card && !s.card.merged && !(c?.merged) ? { x0: s.card.x0 + s.px, x1: s.card.x1 + s.px, y0: s.card.y0 + s.py, y1: s.card.y1 + s.py } : null;
    heads.push({ name: b.name, depth: +s.depth.toFixed(2), face: r4(s.face), card: r4(card), singing: b.singing > 0, k });
  }
  return { kind: shot.kind, bot: shot.bot?.name ?? null, partner: shot.partner?.name ?? null, n: shot.n, subjects: shotSubjects.map((b) => b.name), wide: shot.wideN === shot.n ? [...shot.wideKeep].map((b) => b.name) : null, heads,
    keep: keptTry, why: shot.why ?? null, sides: shot.sidesWhy ?? null, clear: shot.clear ? { tilt: shot.clear.tilt, lift: shot.clear.lift ?? 0, hold: shot.clear.hold.map((b) => b.name) } : null,
    cam: [...camera.position.toArray(), ...camLook.toArray()].map((v) => +v.toFixed(2)) };
};
let last = performance.now();
let wasFinished = false, endedAt = 0, endedGen = -1;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.tick(dt);
  if (player.playing) choir.follow(player.time);
  makingOf.update();
  const done = !makingOf.active && player.finished && player.time >= songEnd;
  if (done && !wasFinished) { bots.forEach((b) => b.hands.play('celebrate')); endedAt = now; endedGen = playGen; }
  if (done && now - endedAt > 4000 && endedGen === playGen && !qs.has('cinema')) showControls(); // (not while the next one loads)
  wasFinished = done;
  // a run plays (Make it's making-of, or a premiere until its end; not the landing screen's own song behind the prompt
  // bar): the prompt bar hidden, Stop shown (index.html #runbar)
  document.body.classList.toggle('playing', Boolean(makingOf.active) || (document.body.classList.contains('premiere') && !done));
  statusEl.textContent = `${chordText ? 'chords: ' + chordText + '  ' : ''}♪ ${choir.notes} notes${player.finished ? '  · end' : ''}`;
  blocking.update(dt);
  clock.time = player.time;
  clock.playing = player.playing;
  if (makingOf.active) Object.assign(clock, MAKING_OF_CLOCK); // (the making-of's groove: its own tempo, the same meter)
  updateActing(dt, bots, clock); // the song's clock: rows sway in time
  updatePlays(dt, clock); // before the bots: they read the plays' aims and head moves
  runCues(); // the gestures the stage gave (staging.js), on the song clock
  bots.forEach((b) => b.update(dt, now / 1000, clock));
  if (done) setShot('group');
  shot.age += dt;
  if (shot.next && shot.age >= shot.next.at) { const n = shot.next; setShot(n.kind, n.bot); }
  regroup();
  shotGoal(_pos, _look);
  // (a close-up or two-shot that found no clear place at its cut: a group shot of its singer, keepCamera)
  if (shot.crowded) { setShot('group', shot.bot, null, { force: true }); shotGoal(_pos, _look); }
  // a reframed shot whose goal is far from the camera (another side of the set) cuts there instead of crossing it
  // (not within 1.5 s of its own cut: two cuts that close read as a flicker; it glides there)
  // (a place kept clear of the heads near the camera, moved mid-shot: a cut after 0.8 s, it was held 0.6 s first)
  if (shot.reframe && !shot.cut && shot.age > (shot.moved ? 0.8 : 1.5) && (_pos.distanceTo(camPos) > 1.6 || _look.distanceTo(camLook) > 0.8)) shot.cut = true;
  shot.reframe = shot.moved = false;
  let cutNow = shot.cut;
  // the camera follows the goal smoothly (camera-follow.js: limited springs, orbiting the look point; a cut jumps),
  // then the hold keeps the heads and cards in frame on the camera as rendered, its correction eased in as well
  if (cutNow) { follow.cut(_pos, _look); shot.cut = false; }
  follow.update(cutNow ? 0 : dt, _pos, _look, camPos, camLook);
  // a glide whose path runs into a head (one filling the frame, LENS_HEAD; not at its goal) cuts to the goal instead
  // (QA v21: a young two-shot's orbit swung through Navy's head in the diner finale, 2.4 of the frame)
  if (!cutNow && lensHead(camPos, camLook) > LENS_HEAD && lensHead(_pos, _look) <= MAX_FACE) {
    follow.cut(_pos, _look);
    follow.update(0, _pos, _look, camPos, camLook);
    cutNow = true;
  }
  _hp.copy(camPos); _hl.copy(camLook);
  holdFrame(_hp, _hl);
  _hp.sub(camPos); _hl.sub(camLook);
  if (cutNow) { holdPos.snap(_hp); holdLook.snap(_hl); }
  holdPos.update(cutNow ? 0 : dt, _hp, _hp);
  holdLook.update(cutNow ? 0 : dt, _hl, _hl);
  _hp.add(camPos); _hl.add(camLook);
  if (blocking.inSet) clampToSet(_hp);
  camera.position.copy(_hp);
  camera.lookAt(_hl);
  if (camLog) camLog.push([_hp.x, _hp.y, _hp.z, _hl.x, _hl.y, _hl.z, _pos.x, _pos.y, _pos.z, _look.x, _look.y, _look.z, cutNow ? 1 : 0, shot.n, shot.angle ?? -1, player.time, ['wide', 'close', 'two', 'group'].indexOf(shot.kind), keptTry, blocking.marchers ? 1 : 0, ...faceSpans(_hp, _hl)].map((v) => +v.toFixed(4)));
  layoutLyricCards();
  renderer.render(scene, camera);
});
