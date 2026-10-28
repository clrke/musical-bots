import * as THREE from 'three';
import { Player } from './player.js';
import { Bot } from './rig.js';
import { generate } from './gen/index.js';
import { NAMES } from './gen/cast.js';
import { Choir } from './audio.js';
import { getStudioEnvironment } from './scene/studio-env.js';
import { loadEnvironment } from './scene/environments/index.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
getStudioEnvironment(renderer); // reflections for the head + hand shader
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333355, 1.4));
// environment set (.glb); placeholder floor when the asset is missing
let env = null;
try {
  env = await loadEnvironment('smoke');
  scene.add(env.group);
} catch (err) {
  console.warn('[scene] environment:', err.message);
}
if (!env) {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ color: 0x2b2b4a }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

const bots = new Map();
NAMES.forEach((n, i) => {
  const a = (i / NAMES.length) * Math.PI - Math.PI;
  const bot = new Bot(n, new THREE.Vector3(Math.cos(a) * 3.2, 1.0, Math.sin(a) * 1.5 - 1), i);
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
    bot.walkTo(bot.home);
    if (e.status === 'consulting') {
      for (const c of e.consult) {
        const other = bots.get(c);
        if (other) bot.consult(other);
      }
    }
    const partner = (e.consult[0] && bots.get(e.consult[0])) || nearestBot(bot);
    const action = e.action || '';
    if (action.includes('shake')) bot.handshake(partner);
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
