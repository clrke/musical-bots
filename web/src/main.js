import * as THREE from 'three';
import { Player, parseNdjson } from './player.js';
import { Bot, ringTargets } from './rig.js';
import { generate } from './gen/index.js';
import { NAMES } from './gen/cast.js';
import { Choir } from './audio.js';
import { arrange } from './sing-plan.js';
import { getStudioEnvironment, createStudioBackdrop } from './scene/studio-env.js';
import { loadEnvironment } from './scene/environments/index.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';
const envParam = new URLSearchParams(location.search).get('env');
// Default set is the studio the heads reflect (Soothing Bots' hype look); .glb sets are opt-in.
const envName = envParam && /^[a-z0-9_-]+$/i.test(envParam) && envParam !== 'studio' ? envParam : null;

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
scene.add(new THREE.HemisphereLight(0xffffff, 0x333355, 0.35));
let env = null;
if (envName) {
  try {
    env = await loadEnvironment(envName);
    // Blender exports watts that three reads as candela: tame them to studio levels.
    env.group.traverse((o) => { if (o.isLight) o.intensity *= 0.03; });
    scene.add(env.group);
  } catch (err) {
    console.warn(`[scene] environment ${envName}:`, err.message);
  }
}
const backdrop = env ? null : createStudioBackdrop(40);
if (backdrop) scene.add(backdrop);

const bots = new Map();
// two-tier chorus rows (front low + wide, back high + tight), alternating cast
NAMES.forEach((n, i) => {
  const back = i % 2 === 1;
  const a = (Math.floor(i / 2) / 7) * Math.PI - Math.PI;
  const home = back
    ? new THREE.Vector3(Math.cos(a) * 2.6, 1.55, Math.sin(a) * 1.2 - 1.2)
    : new THREE.Vector3(Math.cos(a) * 3.0, 0.75, Math.sin(a) * 1.2 + 0.5);
  const bot = new Bot(n, home, i);
  bot.viewer = camera.position;
  bots.set(n, bot);
  scene.add(bot.group);
});
const nearestBot = (bot) => {
  let best = null, dBest = Infinity;
  bots.forEach((b) => {
    if (b === bot) return;
    const d = b.group.position.distanceToSquared(bot.group.position);
    if (d < dBest) { dBest = d; best = b; }
  });
  return best;
};
function groupWalk() {
  const targets = ringTargets(new THREE.Vector3(0, 1, 0), 2.2, bots.size);
  [...bots.values()].forEach((b, i) => b.walkTo(targets[i]));
}
function huddle(bot) {
  const others = [...bots.values()].filter((b) => b !== bot);
  const targets = ringTargets(bot.home, 0.9, others.length);
  others.forEach((b, i) => b.walkTo(targets[i]));
}

const $ = (id) => document.getElementById(id);
const caption = $('caption'), statusEl = $('status');
const choir = new Choir();
let chordText = '';
// Shot list: close-up on the singer, two-shot for duets/consults, wide for group moves.
// A new singer is a cut; within a shot the camera eases and drifts slowly.
const shot = { kind: 'wide', bot: null, partner: null, age: 0, cut: true };
const camPos = new THREE.Vector3(0, 2.4, 8.5), camLook = new THREE.Vector3(0, 1.1, 0);
function setShot(kind, bot = null, partner = null) {
  const cut = kind !== shot.kind || bot !== shot.bot;
  Object.assign(shot, { kind, bot, partner, cut: shot.cut || cut });
  if (cut) shot.age = 0;
}
function shotGoal(pos, look) {
  const drift = Math.min(shot.age, 6) * 0.06; // slow push-in
  if (shot.kind === 'close' && shot.bot) {
    const p = shot.bot.group.position;
    const side = p.x > 0 ? -1 : 1; // look across the choir, toward its middle
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

let lastStaged = null;
let recentClose = []; // the last close-ups: the same singer twice in a row gets a two-shot or a wide
function stage(e) {
  const bot = bots.get(e.bot);
  if (bot) {
    if (e.lyric) bot.sing(2.2, e.lyric, choir.lineFor(e));
    bots.forEach((b) => b.walkTo(b.home)); // reset formation; mappings below re-target movers
    if (e.status === 'consulting') {
      for (const c of e.consult) {
        const other = bots.get(c);
        if (other) bot.consult(other);
      }
    }
    const partner = (e.consult[0] && bots.get(e.consult[0])) || nearestBot(bot);
    const action = e.action || '';
    if (action.includes('march')) groupWalk();
    else if (action.includes('huddle')) huddle(bot);
    else if (action.includes('shake')) bot.handshake(partner);
    else if (action.includes('cheer') || action.includes('celebrate')) { bot.hands.play('celebrate'); if (partner) bot.highFive(partner); }
    else if (action.includes('wave')) bot.hands.play('wave');
    else if (action.includes('point') || action.includes('conduct')) bot.hands.play('point');
    else if (action.includes('pratfall') || action.includes('spin')) bot.hands.play('spin');
    else if (action.includes('clap')) bot.hands.play('clap');
    choir.sing(e);
    const chorus = lastStaged && lastStaged.t === e.t && lastStaged.lyric === e.lyric && lastStaged.bot !== bot;
    if (chorus) setShot('two', lastStaged.bot, bot); // a line sung together: frame the lead and harmony
    else if (action.includes('march') || action.includes('huddle')) setShot('wide');
    else if (partner && (e.status === 'consulting' || /shake|cheer|celebrate/.test(action))) setShot('two', bot, partner);
    else if (recentClose.includes(bot)) setShot(recentClose.length % 2 ? 'two' : 'wide', bot, nearestBot(bot)); // vary repeats
    else setShot('close', bot);
    if (shot.kind === 'close') recentClose = [bot, ...recentClose].slice(0, 2);
    else recentClose = recentClose.slice(0, 1);
    if (!chorus) lastStaged = { t: e.t, lyric: e.lyric, bot };
  }
  caption.innerHTML = `<small>${e.bot} · ${e.agent} · ${e.status}${e.dye ? ' · DYE' : ''}</small>${e.lyric || e.summary}`;
  if (e.chords.length) { choir.setChords(e.chords); chordText = e.chords.join(' '); }
}

const player = new Player({ onAppend: (events) => choir.prepare(events, { append: true }), onEvent: stage, onReset: () => { caption.textContent = ''; setShot('wide'); bots.forEach((b) => b.walkTo(b.home)); } });
window.__player = player;
// Play an episode: render its sung lines first (a second or two), then start the song clock and
// the transport together. window.__mbReady tells the frame-exact capture when to start.
let songEnd = 0;
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

async function playEpisode(bundleEvents, { seekTo = null, typing = null } = {}) {
  window.__mbReady = false;
  player.stopLive();
  player.pause();
  statusEl.textContent = 'warming up the choir…';
  const song = arrange(bundleEvents); // the episode as a song: one line after another
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
  await choir.prepare(events, { lines: song.lines });
  if (typing) {
    window.__mbReady = true;
    await typePrompt(typing);
  }
  choir.begin();
  player.load(events);
  if (seekTo !== null) player.seek(seekTo);
  else player.play();
  window.__mbReady = true;
}
function premiere(cinema = false, opts = {}) {
  document.body.classList.toggle('premiere', cinema);
  return playEpisode(generate($('prompt').value).events, opts);
}
$('go').onclick = () => premiere(true);
$('mute').onclick = () => { choir.setMuted(!choir.muted); $('mute').textContent = choir.muted ? 'Unmute' : 'Mute'; };
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('premiere'); });
addEventListener('pointerdown', () => choir.start(), { once: true });
$('live').onclick = async () => { await choir.start(); choir.begin(); player.live(BUNDLE); };
const qs = new URLSearchParams(location.search);
const qp = qs.get('prompt'), qt = qs.get('t');
if (qp) {
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
let wasFinished = false;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.tick(dt);
  if (player.playing) choir.follow(player.time);
  const done = player.finished && player.time >= songEnd;
  if (done && !wasFinished) bots.forEach((b) => b.hands.play('celebrate'));
  wasFinished = done;
  statusEl.textContent = `${chordText ? 'chords: ' + chordText + '  ' : ''}♪ ${choir.notes} notes${player.finished ? '  · end' : ''}`;
  bots.forEach((b) => b.update(dt, now / 1000));
  if (done) setShot('wide');
  shot.age += dt;
  shotGoal(_pos, _look);
  if (shot.cut) { camPos.copy(_pos); camLook.copy(_look); shot.cut = false; }
  else { const k = 1 - Math.exp(-dt * 2.5); camPos.lerp(_pos, k); camLook.lerp(_look, k); }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (backdrop) backdrop.position.copy(camera.position); // a panorama: horizon stays at eye level
  renderer.render(scene, camera);
});
