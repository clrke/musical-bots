import * as THREE from 'three';

// Placeholder procedural bot: body + head + eyes. Idle bob, walk-to target.
export class Bot {
  constructor(name, color, home) {
    this.name = name;
    this.home = home.clone();
    this.target = home.clone();
    this.group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 6, 16), mat);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 24), mat);
    head.position.y = 1.2;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const x of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
      eye.position.set(x, 1.25, 0.27);
      this.group.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
    this.mouth.position.set(0, 1.12, 0.28);
    this.group.add(body, head, this.mouth);
    this.group.position.copy(home);
    this.singing = 0;
    this.walking = false;
    this.phase = 3;
    this.queue = []; // [{ at, fn }] seconds from now
    this.nod = 0;
  }

  // approach, exchange (nod), then resume the home spot.
  consult(partner) {
    this.walkTo(partner.group.position.clone().add(new THREE.Vector3(0.7, 0, 0.3)));
    this.queue.push({ at: 1.2, fn: () => { this.nod = 1.4; } }, { at: 3.0, fn: () => this.walkTo(this.home) });
  }

  walkTo(p) { this.target.copy(p); }
  sing(seconds = 1.5) { this.singing = seconds; }

  update(dt, t) {
    for (const q of this.queue) q.at -= dt;
    const due = this.queue.filter((q) => q.at <= 0);
    this.queue = this.queue.filter((q) => q.at > 0);
    due.forEach((q) => q.fn());
    this.nod = Math.max(0, this.nod - dt);
    const to = this.target.clone().sub(this.group.position);
    to.y = 0;
    this.walking = to.length() > 0.05;
    if (this.walking) {
      const step = Math.min(to.length(), 1.8 * dt);
      this.group.position.addScaledVector(to.normalize(), step);
      this.group.rotation.y = Math.atan2(to.x, to.z);
    }
    const bob = this.walking ? Math.abs(Math.sin((t + this.phase) * 9)) * 0.12 : Math.sin((t + this.phase) * 2) * 0.03;
    this.group.position.y = bob;
    this.singing = Math.max(0, this.singing - dt);
    const open = this.singing > 0 ? 1 + Math.abs(Math.sin(t * 14)) * 1.2 : 1;
    this.mouth.scale.set(1, open, 1);
    this.group.rotation.x = this.nod > 0 ? Math.sin(t * 12) * 0.12 : 0;
  }
}
