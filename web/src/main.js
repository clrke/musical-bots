import * as THREE from 'three';
import { Player } from './player.js';
import { Bot, ringTargets } from './rig.js';
import { generate } from './gen/index.js';
import { NAMES } from './gen/cast.js';
import { Choir } from './audio.js';
import { getStudioEnvironment } from './scene/studio-env.js';
import { loadEnvironment } from './scene/environments/index.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';
const envParam = new URLSearchParams(location.search).get('env');
const envNames = envParam && /^[a-z0-9_-]+$/i.test(envParam) ? [envParam, 'diner', 'smoke'] : ['diner', 'smoke'];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
getStudioEnvironment(renderer); // reflections for the head + hand shader
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333355, 0.7));
// environment set (.glb): ?env= pick, then diner, smoke, placeholder floor
let env = null;
for (const name of envNames) {
  try {
    env = await loadEnvironment(name);
    scene.add(env.group);
    break;
  } catch (err) {
    console.warn(`[scene] environment ${name}:`, err.message);
  }
}
if (!env) {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ color: 0x2b2b4a }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

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
window.__choir = choir;
let chordText = '';
let camTarget = new THREE.Vector3(0, 1, 0);
const camGoal = new THREE.Vector3(0, 1, 0);

function stage(e) {
  const bot = bots.get(e.bot);
  if (bot) {
    if (e.lyric) bot.sing(2.2, e.lyric);
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
    choir.sing(e.bot, e.lyric);
    camGoal.copy(bot.group.position).setY(1);
  }
  caption.innerHTML = `<small>${e.bot} · ${e.agent} · ${e.status}${e.dye ? ' · DYE' : ''}</small>${e.lyric || e.summary}`;
  if (e.chords.length) { choir.setChords(e.chords); chordText = e.chords.join(' '); }
}

const player = new Player({ onEvent: stage, onReset: () => { caption.textContent = ''; bots.forEach((b) => b.walkTo(b.home)); } });
window.__player = player;
function premiere(cinema = false) {
  choir.start();
  document.body.classList.toggle('premiere', cinema);
  player.stopLive();
  const { events } = generate($('prompt').value);
  player.load(events);
  player.play();
}
$('go').onclick = () => premiere(true);
$('mute').onclick = () => { choir.setMuted(!choir.muted); $('mute').textContent = choir.muted ? 'Unmute' : 'Mute'; };
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('premiere'); });
addEventListener('pointerdown', () => choir.start(), { once: true });
$('live').onclick = () => player.live(BUNDLE);
const qp = new URLSearchParams(location.search).get('prompt');
const qt = new URLSearchParams(location.search).get('t');
if (qp) {
  $('prompt').value = qp; premiere(false);
  if (qt !== null) { player.pause(); player.seek(Number(qt)); }
}
else player.replay(BUNDLE).catch((err) => { statusEl.textContent = String(err); });

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
  if (player.finished && !wasFinished) bots.forEach((b) => b.hands.play('celebrate'));
  wasFinished = player.finished;
  statusEl.textContent = `${chordText ? 'chords: ' + chordText + '  ' : ''}♪ ${choir.notes} notes${player.finished ? '  · end' : ''}`;
  bots.forEach((b) => b.update(dt, now / 1000));
  camTarget.lerp(camGoal, 0.04);
  camera.position.set(camTarget.x * 0.4, 2.2, 7);
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
});
