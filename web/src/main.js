import * as THREE from 'three';
import { Player } from './player.js';
import { Bot } from './rig.js';

const BUNDLE = import.meta.env.BASE_URL + 'episodes/sample/events.ndjson';
const CAST = { Teddy: 0x8d6e63, Nora: 0x7e57c2, Vera: 0xef5350, Gigi: 0xffca28, Frankie: 0x26a69a, Benny: 0x42a5f5, Lou: 0x66bb6a, Pearl: 0xec407a };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333355, 1.4));
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ color: 0x2b2b4a }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const names = Object.keys(CAST);
const bots = new Map();
names.forEach((n, i) => {
  const a = (i / names.length) * Math.PI - Math.PI;
  const bot = new Bot(n, CAST[n], new THREE.Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 1.5 - 1));
  bots.set(n, bot);
  scene.add(bot.group);
});

const $ = (id) => document.getElementById(id);
const caption = $('caption'), statusEl = $('status');
let camTarget = new THREE.Vector3(0, 1, 0);
const camGoal = new THREE.Vector3(0, 1, 0);

function stage(e) {
  const bot = bots.get(e.bot);
  if (bot) {
    if (e.lyric) bot.sing(2);
    bot.walkTo(bot.home);
    if (e.status === 'consulting') {
      for (const c of e.consult) {
        const other = bots.get(c);
        if (other) bot.walkTo(other.group.position.clone().add(new THREE.Vector3(0.7, 0, 0.3)));
      }
    }
    camGoal.copy(bot.group.position).setY(1);
  }
  caption.innerHTML = `<small>${e.bot} · ${e.agent} · ${e.status}${e.dye ? ' · DYE' : ''}</small>${e.lyric || e.summary}`;
  if (e.chords.length) statusEl.textContent = `chords: ${e.chords.join(' ')}`;
}

const player = new Player({ onEvent: stage, onReset: () => { caption.textContent = ''; bots.forEach((b) => b.walkTo(b.home)); } });
window.__player = player;
$('go').onclick = () => player.replay(BUNDLE);
$('live').onclick = () => player.live(BUNDLE);
player.replay(BUNDLE).catch((err) => { statusEl.textContent = String(err); });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.tick(dt);
  bots.forEach((b) => b.update(dt, now / 1000));
  camTarget.lerp(camGoal, 0.04);
  camera.position.set(camTarget.x * 0.4, 2.2, 7);
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
});
