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
    this.phase = Math.random() * 6;
  }

  walkTo(p) { this.target.copy(p); }
  sing(seconds = 1.5) { this.singing = seconds; }

  update(dt, t) {
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
  }
}
