// Where the bots are: the formation in the studio and (owner: the sets stream) the bots moving
// through the Blender sets (diner, big house, street) as heads + hands, marks per set, a set per
// beat (beats.json beats[].set), the moves of actions.js MOVES and the lighting agent's cues.
import * as THREE from 'three';
import { ringTargets } from './rig.js';

/** Two-tier chorus rows in the studio (front low + wide, back high + tight), alternating cast. */
export function studioHome(i) {
  const back = i % 2 === 1;
  const a = (Math.floor(i / 2) / 7) * Math.PI - Math.PI;
  return back
    ? new THREE.Vector3(Math.cos(a) * 2.6, 1.55, Math.sin(a) * 1.2 - 1.2)
    : new THREE.Vector3(Math.cos(a) * 3.0, 0.75, Math.sin(a) * 1.2 + 0.5);
}

export class Blocking {
  /** bots: Map name -> Bot. */
  constructor({ bots, scene }) {
    this.bots = bots;
    this.scene = scene;
    this.beats = null;
  }

  /** A new episode (beats.json or null). */
  load(beats) { this.beats = beats; }

  /** Before each event is staged: reset the formation (moves below re-target the movers). */
  onEvent(e, bot) {
    void e; void bot;
    this.bots.forEach((b) => b.walkTo(b.home));
  }

  /** A move (actions.js resolveAction kind 'move'). */
  move(r, bot) {
    if (r.id === 'march') {
      const targets = ringTargets(new THREE.Vector3(0, 1, 0), 2.2, this.bots.size);
      [...this.bots.values()].forEach((b, i) => b.walkTo(targets[i]));
    } else if (r.id === 'huddle' || r.id === 'gather') {
      const others = [...this.bots.values()].filter((b) => b !== bot);
      const targets = ringTargets(bot.home, 0.9, others.length);
      others.forEach((b, i) => b.walkTo(targets[i]));
    } else if (r.id === 'walk-to') {
      const other = [...this.bots.values()].find((b) => b.name.toLowerCase() === String(r.target).toLowerCase());
      if (other) bot.walkTo(other.home.clone().lerp(bot.home, 0.4));
    }
  }

  /** A lighting cue (kind 'light'): no-op in the studio. */
  light(r, bot) { void r; void bot; }

  /** Per-frame update. */
  update(dt) { void dt; }
}
