import * as THREE from 'three';
import { Player, parseNdjson } from './player.js';
import { Bot } from './rig.js';
import { generate } from './gen/index.js';
import { NAMES } from './gen/cast.js';
import { Choir } from './audio.js';
import { arrange, BEAT } from './sing-plan.js';
import { curatedSlug } from './curated.js';
import { getStudioEnvironment, createStudioBackdrop } from './scene/studio-env.js';
import { Stage } from './scene/environments/stage.js';
import { setName } from './scene/environments/sets.js';
import { resolveAction, PLAYS } from './actions.js';
import { parseLyric } from './cues.js';
import { startPlay, updatePlays, resetPlays } from './plays/index.js';
import { playGesture, playAct, reactToCues, consult, updateActing, accentAction, partnered } from './acting.js';
import { Blocking, studioHome } from './blocking.js';
import { createMakingOf } from './making-of.js';
import { fitFrame, slotBounds } from './framing.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';
// Each beat plays in its set (beats.json beats[].set: studio, diner, big_house, street). ?set=<name>
// (or the older ?env=<name>) puts every beat of the episode in that set (demos, captures).
const setParam = new URLSearchParams(location.search).get('set') ?? new URLSearchParams(location.search).get('env');
const setOverride = setParam && /^[a-z0-9_-]+$/i.test(setParam) ? setName(setParam) ?? setParam : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// Same curve as the head shader's own tonemap (Khronos Neutral) for the standard-material sets.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.8;
document.body.appendChild(renderer.domElement);
const studio = getStudioEnvironment(renderer); // reflections for the head + hand shader
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2826);
scene.environment = studio.texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
// the studio panorama; the sets (scene/environments/stage.js) swap it for their own room, lights
// (the sets' lamps at their exported candela), exposure and reflection environment
const backdrop = createStudioBackdrop(40);
scene.add(backdrop);

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
const stageSets = new Stage({ renderer, scene, camera, studio, backdrop, bots });
const blocking = new Blocking({ bots, scene, stage: stageSets, override: setOverride, contact: partnered });
// the song clock the hands and the hand plays keep time with (beats = time / beatSec while the song plays)
const clock = { time: 0, beatSec: BEAT, playing: false, bots, viewer: camera.position };
const PLAYS_GROUP = new Set(Object.keys(PLAYS).filter((id) => PLAYS[id] === 'group'));
let episodeBeats = null; // beats.json of the episode playing (null: a v1 bundle without one)
// The bots a beat stages (beats.json cast), the singer first.
function castOf(e, bot) {
  const beat = episodeBeats?.beats?.find((b) => b.id === e.beat);
  return [bot, ...(beat?.cast ?? []).map((n) => bots.get(n)).filter((b) => b && b !== bot)];
}
// A duo's partner: the bot consulted, else the first bot the line names, else the nearest.
function partnerOf(e, bot, cues) {
  for (const n of [...e.consult, ...cues.map((c) => c.name)]) {
    const b = bots.get(n);
    if (b && b !== bot) return b;
  }
  return nearestBot(bot);
}

const $ = (id) => document.getElementById(id);
const caption = $('caption'), statusEl = $('status');
const choir = new Choir();
let chordText = '';
// Shot list: close-up on the singer, two-shot for duets/consults, wide for group moves.
// A new singer is a cut; within a shot the camera eases and drifts slowly. In a set the shots are
// framed from the set's audience side, kept inside its walls and clear of furniture and heads.
const shot = { kind: 'wide', bot: null, partner: null, age: 0, cut: true, n: 0, next: null };
const camPos = new THREE.Vector3(0, 2.4, 8.5), camLook = new THREE.Vector3(0, 1.1, 0);
// next: a shot that follows on its own after `at` seconds (the establishing wide of a new set)
function setShot(kind, bot = null, partner = null, { force = false, next = null } = {}) {
  const cut = force || kind !== shot.kind || bot !== shot.bot;
  Object.assign(shot, { kind, bot, partner, cut: shot.cut || cut, next });
  if (cut) { shot.age = 0; shot.n++; shot.side = 0; }
}
const _d = new THREE.Vector3(), _q = new THREE.Vector3(), _c = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const _base = new THREE.Vector3(), _o = new THREE.Vector3();
// Shots inside a set (blocking.def: camera bounds, wide presets, the audience side).
function setShotGoal(pos, look, subjects) {
  const def = blocking.def, cam = def.camera;
  const drift = Math.min(shot.age, 8) * 0.04;
  const aud = def.audience ?? [0, 8];
  const toward = (p, out) => out.set(aud[0] - p.x, 0, aud[1] - p.z).normalize().lerp(_z, 0.35).normalize();
  const marchers = shot.kind === 'wide' ? blocking.marchers : null;
  if (marchers?.length) {
    // a parade: track the line from the set's front angle, as close as holds all of it
    wideFit(pos, look, cam.wide[0], marchers);
    keepCamera(pos, look, [], false);
    fitFrame(fitCam, pos, look, subjects, { move: false });
    return;
  }
  if (shot.kind === 'close' && shot.bot) {
    const p = shot.bot.group.position;
    toward(p, _d);
    if (!shot.side) shot.side = p.x > 0.3 ? -1 : 1; // a little off-axis, toward the room's middle (kept for the shot)
    const side = shot.side;
    const dist = 2.05 - drift * 0.35;
    look.set(p.x, p.y + 0.06, p.z);
    pos.set(p.x + _d.x * dist - _d.z * side * 0.5, p.y + 0.3, p.z + _d.z * dist + _d.x * side * 0.5);
  } else if (shot.kind === 'two' && shot.bot && shot.partner) {
    const a = shot.bot.group.position, b = shot.partner.group.position;
    look.copy(a).add(b).multiplyScalar(0.5);
    // across the line between them, from the audience side
    _q.set(b.z - a.z, 0, a.x - b.x);
    if (_q.lengthSq() < 1e-6) _q.set(0, 0, 1);
    _q.normalize();
    toward(look, _d);
    if (_q.dot(_d) < 0) _q.negate();
    _q.lerp(_d, 0.4).normalize();
    const dist = Math.max(2.5, Math.hypot(a.x - b.x, a.z - b.z) * 1.1 + 1.5) - drift * 0.4;
    pos.set(look.x + _q.x * dist, look.y + 0.42, look.z + _q.z * dist);
    look.y += 0.08;
  } else {
    // wide: from one of the set's preset angles (another one each time), as close as frames the
    // whole cast at their places (bots still walking in from a door do not swing the camera)
    const w = cam.wide[(shot.n >> 1) % cam.wide.length];
    const items = blocking.castSlots().map(([b, slot]) => slotBounds(b, slot, {}));
    if (items.length) {
      wideFit(pos, look, w, items);
      pos.x += Math.sin(shot.age * 0.07) * 0.3; // a slow drift
    } else {
      pos.set(w.pos[0] + Math.sin(shot.age * 0.07) * 0.5, w.pos[1], w.pos[2] - drift * 0.6);
      look.set(w.look[0], w.look[1], w.look[2]);
    }
    keepCamera(pos, look, [], false);
    fitFrame(fitCam, pos, look, subjects, { move: false });
    return;
  }
  // the head and its card in frame (stepping back if needed), then inside the walls and clear of
  // furniture and heads, then a last tilt for the card
  fitFrame(fitCam, pos, look, subjects);
  keepCamera(pos, look, subjects, true);
  fitFrame(fitCam, pos, look, subjects, { move: false });
}
// A wide from preset w's angle (its line of sight) at the middle of `items` (bots or framing bounds),
// stepped back from WIDE_MIN until every head and card is in frame with a margin at the sides.
const WIDE_MIN = 4.2;
function wideFit(pos, look, w, items) {
  _c.set(0, 0, 0);
  for (const it of items) {
    const c = it.group ? it.group.position : _o.set(it.x, (it.top + it.cardBottom) / 2, it.z);
    _c.add(c);
  }
  _c.divideScalar(items.length);
  _d.set(w.pos[0] - w.look[0], w.pos[1] - w.look[1], w.pos[2] - w.look[2]).normalize();
  look.copy(_c);
  pos.copy(look).addScaledVector(_d, WIDE_MIN);
  fitFrame(fitCam, pos, look, items, { side: 0.86 });
}
// Inside the set's walls, never through a cabinet; close shots also clear of other bots' heads.
// When the line of sight is blocked: look over the top, step round the subject, and only then in.
const TRIES = [[0.45, 0, 0], [0, 0.42, 0], [0, -0.42, 0], [0.5, 0.42, 0], [0.5, -0.42, 0], [0.85, 0, 0],
  [0.85, 0.5, 0], [0.85, -0.5, 0], [0.45, 0, 0.2]];
// The camera as rendered (it eases toward its goal, so it lags a singer walking in) holds the heads
// and cards too: stepped back and tilted in place, the ease goes on from there.
function holdFrame(pos, look) {
  if (!shotSubjects.length) return;
  const move = shot.kind !== 'wide';
  fitFrame(fitCam, pos, look, shotSubjects, { move });
  if (blocking.inSet && move) {
    clampToSet(pos);
    fitFrame(fitCam, pos, look, shotSubjects, { move: false });
  }
}
function clampToSet(pos) {
  const b = blocking.def.camera.bounds;
  pos.x = Math.min(b[1], Math.max(b[0], pos.x));
  pos.y = Math.min(b[3], Math.max(b[2], pos.y));
  pos.z = Math.min(b[5], Math.max(b[4], pos.z));
}
function keepCamera(pos, look, subjects, heads) {
  const clampIn = () => clampToSet(pos);
  clampIn();
  if (!blocked(pos, look, subjects, heads)) return;
  _base.copy(pos);
  for (const [up, turn, closer] of TRIES) {
    _o.copy(_base).sub(look).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).multiplyScalar(1 - closer);
    pos.copy(look).add(_o);
    pos.y = _base.y + up;
    clampIn();
    if (!blocked(pos, look, subjects, heads)) return;
  }
  // a crowd all round: look over the heads from where the shot wanted to stand
  pos.copy(_base);
  pos.y += 0.7;
  clampIn();
}
function blocked(pos, look, subjects, heads) {
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const x = pos.x + (look.x - pos.x) * t, y = pos.y + (look.y - pos.y) * t, z = pos.z + (look.z - pos.z) * t;
    for (const o of blocking.obstacles) {
      if (y < o.y1 + 0.05 && y > o.y0 && x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05) return true;
    }
  }
  if (!heads) return false;
  // another head between the camera and the subject (or the camera inside one)
  _q.copy(look).sub(pos);
  const L2 = _q.lengthSq();
  if (L2 < 1e-6) return false;
  for (const o of blocking.onSet()) {
    if (subjects.includes(o)) continue;
    const p = o.group.position;
    const t = Math.max(0, Math.min(1, _q.dot(_c.copy(p).sub(pos)) / L2));
    if (t > 0.92) continue;
    if (_c.copy(pos).addScaledVector(_q, t).distanceTo(p) < o.unit * 2.4 * 0.95) return true;
  }
  return false;
}
// Every shot holds its singers' heads and lyric cards (the cards clear of the lower third): close-ups
// and two-shots step back and tilt as needed, wides only tilt (framing.js).
const fitCam = new THREE.PerspectiveCamera();
let shotSubjects = [];
// a bot the camera may frame: in a set, one that is in the scene (not entering, parked or hidden)
// (a bot still gliding in from far off, e.g. through a door at the set's edge, is not framed close: the
// shot would look out past the set)
const _cc = new THREE.Vector3();
const onStage = (b) => !!b && b.group.visible && (!blocking.inSet
  || (blocking.isOn(b) && !(b.moving && b.group.position.distanceTo(blocking.castCenter(_cc)) > 2.5)));
function shotGoal(pos, look) {
  // a two-shot whose partner is not in the scene (still entering, parked): hold the one who is
  if (shot.kind === 'two' && !(onStage(shot.bot) && onStage(shot.partner))) {
    const keep = onStage(shot.bot) ? shot.bot : onStage(shot.partner) ? shot.partner : null;
    Object.assign(shot, keep ? { kind: 'close', bot: keep, partner: null } : { kind: 'wide', bot: null, partner: null });
  }
  if (shot.kind === 'close' && !onStage(shot.bot)) Object.assign(shot, { kind: 'wide', bot: null, partner: null });
  fitCam.fov = camera.fov;
  fitCam.aspect = camera.aspect;
  fitCam.updateProjectionMatrix();
  const subjects = shot.kind === 'close' && shot.bot ? [shot.bot]
    : shot.kind === 'two' && shot.bot && shot.partner ? [shot.bot, shot.partner]
      : lastStaged?.bot && lastStaged.bot.group.visible && lastStaged.bot.singing > 0 ? [lastStaged.bot] : [];
  shotSubjects = subjects;
  if (blocking.inSet) {
    setShotGoal(pos, look, subjects);
    return;
  }
  studioShotGoal(pos, look);
  fitFrame(fitCam, pos, look, subjects, { move: shot.kind !== 'wide' });
}
function studioShotGoal(pos, look) {
  const drift = Math.min(shot.age, 6) * 0.06; // slow push-in
  if (shot.kind === 'close' && shot.bot) {
    const p = shot.bot.group.position;
    const side = shot.side || (p.x > 0 ? -1 : 1); // look across the choir, toward its middle (or the side chosen)
    const back = shot.bot.home.y > 1.2; // back row: shoot over the front row's heads
    look.set(p.x, p.y + 0.1, p.z);
    pos.set(p.x + side * 0.45, p.y + (back ? 0.75 : 0.3), p.z + (back ? 2.3 : 1.7) - drift * 0.5);
  } else if (shot.kind === 'two' && shot.bot && shot.partner) {
    const a = shot.bot.group.position, b = shot.partner.group.position;
    look.copy(a).add(b).multiplyScalar(0.5);
    const d = Math.max(2.4, a.distanceTo(b) * 1.1 + 1.4) - drift * 0.5;
    pos.set(look.x * 0.9, look.y + 0.45, look.z + d);
    look.y += 0.1;
  } else {
    look.set(0, 1.1, 0);
    pos.set(Math.sin(shot.age * 0.05) * 1.0, 2.1, 6.6 - drift);
  }
}
const _pos = new THREE.Vector3(), _look = new THREE.Vector3();

// The production role on screen (cinema lower third): who is singing, which of the seven jobs they
// embody and what they are doing. A line sung together reads "Teddy + Nora · chorus". Switched
// instantly (no CSS transitions: a frame-exact capture cannot step those).
const ROLE_LABEL = { lyrics: 'Lyricist', chords: 'Arranger', dance: 'Choreographer', lighting: 'Lighting',
  deals: 'Producer', hype: 'Hype', comedy: 'Comedy' };
const ROLE_COLOR = { lyrics: '#7aa2ff', chords: '#ffb35c', dance: '#ff6fb1', lighting: '#ffe066',
  deals: '#5fd39b', hype: '#ff7a59', comedy: '#c78bff' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const roleEl = document.getElementById('role');
let roleKey = null;
function showRole(e) {
  if (!roleEl) return;
  const joins = lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bots.get(e.singer ?? e.bot);
  if (joins && roleKey) {
    const who = roleEl.querySelector('.who'), name = e.singer ?? e.bot;
    if (!who.textContent.split(' + ').includes(name)) who.textContent += ` + ${name}`;
    const writer = roleEl.dataset.writer;
    roleEl.querySelector('.what').textContent = writer ? `sing ${writer}'s line` : 'singing it together';
    return;
  }
  const doing = e.status === 'consulting' && e.consult.length ? `consulting ${e.consult.join(', ')}`
    : e.status === 'proposing' ? 'proposing a line' : 'at work';
  const job = esc(ROLE_LABEL[e.agent] ?? e.agent);
  // the premiere: a story-cast singer sings a line a role bot wrote ("Lou · sings Teddy's line (Lyricist)")
  const writer = e.singer && e.singer !== e.bot ? e.bot : '';
  roleKey = e.seq;
  roleEl.dataset.writer = writer;
  roleEl.style.setProperty('--c', ROLE_COLOR[e.agent] ?? '#fff');
  roleEl.innerHTML = writer
    ? `<span class="dot"></span><b class="who">${esc(e.singer)}</b><span class="what">sings ${esc(writer)}'s line</span><span class="job">(${job})</span>`
    : `<span class="dot"></span><b class="who">${esc(e.bot)}</b><span class="job">${job}</span><span class="what">${esc(doing)}</span>`;
}
let lastStaged = null;
let recentClose = []; // the last close-ups: the same singer twice in a row gets a two-shot or a wide
let replyShots = 0, repeatShots = 0;
let cutT = -1; // song time of the last cut to a new set
function stage(e) {
  // the premiere is sung by the story cast (e.singer); the making-of by the role bots (e.bot)
  const bot = bots.get(e.singer ?? e.bot);
  const line = parseLyric(e.lyric, NAMES); // v2 markup: {Name:act} cues, [Pickup], >> reply
  if (bot && e.part === 'backing') { // a backing part (bass, pads): the mouth only, no cut, no card
    bot.sing(2.2, '', choir.lineFor(e));
    choir.sing(e);
    return;
  }
  if (bot && (e.part === 'reply' || e.part === 'echo')) { // the pal answers the line: card + mouth, no cut, no lower third
    if (line.text) bot.sing(2.2, line.text, choir.lineFor(e));
    choir.sing(e);
    return;
  }
  const chorus = bot && lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bot;
  if (bot) {
    // a harmony singer mouths the line under the lead's card (one card per line, not one per voice)
    if (line.text) bot.sing(2.2, chorus ? '' : line.text, choir.lineFor(e));
    if (!chorus) blocking.onEvent(e, bot);
    if (!chorus && blocking.changed) resetPlays(); // a cut to another set: the hand plays of the last scene end
    if (e.status === 'consulting') consult(bot, e.consult.map((c) => bots.get(c)).filter(Boolean));
    if (!chorus) reactToCues(line.cues, bot, bots);
    const partner = partnerOf(e, bot, line.cues);
    const r = resolveAction(e.action);
    if (r.kind === 'play') startPlay(r.id, bot, PLAYS_GROUP.has(r.id) ? castOf(e, bot).slice(1) : partner ? [partner] : [], { ...clock, time: player.time, playing: true });
    else if (r.kind === 'gesture') playGesture(bot, r.id);
    else if (r.kind === 'act') playAct(bot, r.id);
    else if (r.kind === 'move') blocking.move(r, bot);
    else if (r.kind === 'light') blocking.light(r, bot);
    accentAction(bot, r); // a light cue shows on its caller's face; an id nothing plays yet still nods
    choir.sing(e);
    const duo = r.kind === 'play' && !PLAYS_GROUP.has(r.id) && r.id !== 'conductor';
    const named = !!partner && line.cues.some((c) => c.name === partner.name); // the bot the line names reacts: in shot
    // a line the pal answers (" >> reply"): every other one is framed with the pal, so the answer is seen without a cut
    const pal = line.reply ? bots.get(episodeBeats?.roles?.pal) : null;
    const withPal = pal && pal !== bot && blocking.isOn(pal) && (replyShots++ % 2 === 0);
    if (!chorus && blocking.changed) {
      // a new set: establish it with a wide, then go in on the singer
      cutT = e.t;
      setShot('wide', null, null, { force: true, next: { kind: 'close', bot, at: 2.6 } });
    } else if (e.t === cutT) { /* the lines that start with the cut keep the establishing wide */ }
    else if (chorus) { // a line sung together: the lead and its harmony; three or more voices, the wide
      lastStaged.joined = (lastStaged.joined ?? 0) + 1;
      if (lastStaged.joined >= 2) setShot('wide');
      else setShot('two', lastStaged.bot, bot);
    }
    else if (r.kind === 'move' && r.id !== 'walk-to' || PLAYS_GROUP.has(r.id)) setShot('wide');
    else if (partner && (e.status === 'consulting' || duo || named)) setShot('two', bot, partner);
    else if (withPal) setShot('two', bot, pal);
    else if (recentClose.includes(bot)) {
      // the same singer again (a story's lead sings most lines): a two-shot with the pal (else the nearest
      // bot), then the singer from the other side, a wide only every fourth time
      const k = repeatShots++ % 4;
      const other = [bots.get(episodeBeats?.roles?.pal), nearestBot(bot)].find((b) => b && b !== bot && onStage(b));
      if (k === 3 || (k === 0 && !other)) setShot('wide');
      else if (k === 0 || k === 2) setShot('two', bot, other ?? nearestBot(bot));
      else { const side = shot.side || 1; setShot('close', bot, null, { force: true }); shot.side = -side; }
    } else setShot('close', bot);
    if (shot.kind === 'close') recentClose = [bot, ...recentClose].slice(0, 2);
    else recentClose = recentClose.slice(0, 1);
    if (!chorus) lastStaged = { t: e.t, lyric: e.lyric, bot };
  }
  showRole(e);
  caption.innerHTML = `<small>${e.bot} · ${e.agent} · ${e.status}${e.dye ? ' · DYE' : ''}</small>${esc(line.text || e.summary)}`;
  if (e.chords.length) { choir.setChords(e.chords); chordText = e.chords.join(' '); }
}

let makingOf = null; // LIVE: the crew at work (making-of.js)
const player = new Player({ onAppend: (events) => choir.prepare(events, { append: true }), onEvent: (e) => { stage(e); makingOf?.staged(e); }, onReset: () => { caption.textContent = ''; if (roleEl) roleEl.innerHTML = ''; roleKey = null; replyShots = 0; repeatShots = 0; cutT = -1; blocking.reset(); setShot('wide', null, null, { force: true }); } });
window.__player = player;
// Play an episode: render its sung lines first (a second or two), then start the song clock and
// the transport together. window.__mbReady tells the frame-exact capture when to start.
let songEnd = 0;
// The latest Premiere / Live wins: a second press while one is still loading or warming up makes the
// first one stand down (else whichever finished rendering last would play, its voices mixed in).
let playGen = 0;
// ?typing: the opening of a demo video, the prompt typed into the bar and Premiere pressed (on the page's
// own timers, so a frame-exact capture records it too). Returns the seconds it takes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPE_MS = 55;
const typingSeconds = (text) => (700 + text.length * TYPE_MS + 500 + 450) / 1000;
async function typePrompt(text) {
  const input = $('prompt'), go = $('go');
  document.body.classList.add('typing');
  input.value = '';
  await sleep(700);
  for (const ch of text) { input.value += ch; await sleep(TYPE_MS); }
  await sleep(500);
  go.classList.add('pressed');
  await sleep(450);
  go.classList.remove('pressed');
  document.body.classList.remove('typing');
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
  clock.beatSec = 60 / (song.tempo || 60 / BEAT); // the hands and the hand plays keep this song's beat (song time 0 = beat 0)
  const events = song.events;
  const intro = typing ? typingSeconds(typing) : 0;
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
    window.__mbReady = true;
    const t0 = performance.now();
    await typePrompt(typing);
    // the real length (timers fire on frame boundaries in a capture), for capture + trailer
    window.__mbSong.offset = (performance.now() - t0) / 1000;
    window.__mbEnd = window.__mbSong.offset + song.end;
  }
  choir.begin();
  player.load(events);
  if (seekTo !== null) player.seek(seekTo);
  else player.play();
  window.__mbReady = true;
}
// A curated prompt plays its checked-in bundle (Fireworks-enriched lyrics when present); any other
// prompt is generated on the spot.
// Returns { events, beats }.
async function episodeFor(prompt) {
  const slug = curatedSlug(prompt);
  if (slug) {
    try {
      const base = `${import.meta.env.BASE_URL}episodes/${slug}`;
      const [ev, bt] = await Promise.all([fetch(`${base}/events.ndjson`), fetch(`${base}/beats.json`)]);
      if (ev.ok) return { events: parseNdjson(await ev.text()), beats: bt.ok ? await bt.json() : null };
    } catch { /* fall back to the generator */ }
  }
  return generate(prompt);
}
async function premiere(cinema = false, opts = {}) {
  const gen = ++playGen;
  document.body.classList.toggle('premiere', cinema);
  const { events, beats } = await episodeFor($('prompt').value);
  return playEpisode(events, { ...opts, beats, gen });
}
$('go').onclick = () => { makingOf.cancel(); premiere(true); };
$('mute').onclick = () => { choir.setMuted(!choir.muted); $('mute').textContent = choir.muted ? 'Unmute' : 'Mute'; };
// the premiere hides the controls: Escape, or a click / tap on the stage, brings them back (the song
// plays on), and so does the song's end (not in a frame-exact capture, ?cinema)
const showControls = () => document.body.classList.remove('premiere');
addEventListener('keydown', (e) => { if (e.key === 'Escape') showControls(); });
renderer.domElement.addEventListener('pointerdown', showControls);
// the audio starts (or resumes) inside a user gesture: a touch's pointerdown does not count as one (a
// phone), the click / touchend / key that follows does; start() is idempotent
for (const type of ['pointerdown', 'click', 'touchend', 'keydown']) addEventListener(type, () => choir.start(), { capture: true });
// LIVE: the Muse Code director's making-of (npm run dev), or a recorded one; then the premiere.
// The crew works in the studio (no sets: every role bot stays on stage); the premiere plays the sets.
makingOf = createMakingOf({
  player, choir, el: $('making'), captionEl: caption, episodeFor,
  speed: Number(new URLSearchParams(location.search).get('speed')) || 2,
  prepareStage: () => blocking.prepare(null, []),
  onBeats: (beats) => { episodeBeats = beats; },
  react: (e) => { const b = bots.get(e.bot); if (b && e.line) reactToCues(parseLyric(e.line, NAMES).cues, b, bots); },
  onPremiere: (events, beats) => { document.body.classList.add('premiere'); playEpisode(events, { beats }); },
  onFallback: () => premiere(true),
});
$('live').onclick = (ev) => (++playGen, makingOf.start($('prompt').value, { fresh: ev.shiftKey })); // shift: direct a curated prompt anew
const qs = new URLSearchParams(location.search);
const qp = qs.get('prompt'), qt = qs.get('t');
if (qp && qs.has('makingof')) {
  $('prompt').value = qp;
  makingOf.start(qp);
} else if (qp) {
  $('prompt').value = qp;
  premiere(qs.has('cinema'), { seekTo: qt !== null ? Number(qt) : null, typing: qs.has('typing') ? qp : null });
} else {
  fetch(BUNDLE).then((r) => r.text()).then((text) => playEpisode(parseNdjson(text)))
    .catch((err) => { statusEl.textContent = String(err); });
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

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
  statusEl.textContent = `${chordText ? 'chords: ' + chordText + '  ' : ''}♪ ${choir.notes} notes${player.finished ? '  · end' : ''}`;
  blocking.update(dt);
  clock.time = player.time;
  clock.playing = player.playing;
  updateActing(dt, bots, clock); // the song's clock: rows sway in time
  updatePlays(dt, clock); // before the bots: they read the plays' aims and head moves
  bots.forEach((b) => b.update(dt, now / 1000, clock));
  if (done) setShot('wide');
  shot.age += dt;
  if (shot.next && shot.age >= shot.next.at) { const n = shot.next; setShot(n.kind, n.bot); }
  shotGoal(_pos, _look);
  if (shot.cut) { camPos.copy(_pos); camLook.copy(_look); shot.cut = false; }
  else { const k = 1 - Math.exp(-dt * 2.5); camPos.lerp(_pos, k); camLook.lerp(_look, k); }
  holdFrame(camPos, camLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (backdrop) backdrop.position.copy(camera.position); // a panorama: horizon stays at eye level
  renderer.render(scene, camera);
});
