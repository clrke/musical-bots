// Headless checks that the audience sees who sings (QA v20, the beach-ball episode: Silver hidden behind Red in their
// duet, Gold behind Jade and Silver, a harmony walking across in front of its lead, singers turned away):
//   1. faceCover: the share of a face a nearer head hides, as an eye sees the two;
//   2. the strafe: a bot stepping to sing glides with its face to the audience (rig.js walkTo strafe);
//   3. a harmony joins its lead on the side it already stands on (never across in front of the lead's face), level
//      with it, and the two stand side by side as the audience sees them (the beach-ball duet at 101.6 s);
//   4. every curated episode, staged as main.js stages it (collisions.mjs simulate): the head centres projected from in
//      front of each singer (its close-up) and from the set's main wide; a singing face (not the backing hum) is hidden
//      when a nearer head covers HIDDEN of it. Hidden time stays a small share of the singing, and no spell is long.
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.document ??= { baseURI: 'http://localhost/', createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 12 }) : () => undefined), set: () => true }) }) };
globalThis.Image ??= class { set src(v) { void v; } };

const { faceCover, viewsOf, HIDDEN, FACE_SHARE } = await import('./src/staging.js');
const { Bot } = await import('./src/rig.js');
const { simulate, headOf, headRadius } = await import('./collisions.mjs');
const { sightlines } = await import('./sightlines.mjs');
const { SEEDS } = await import('./src/curated.js');

// 1. faceCover
{
  const eye = { x: 0, y: 1.5, z: 5 };
  const a = { x: 0, y: 1.5, z: 0 };
  assert.equal(faceCover(eye, a, 0.3, { x: 0, y: 1.5, z: 1 }, 0.3), 1, 'a head straight in front hides the whole face');
  assert.equal(faceCover(eye, a, 0.3, { x: 0, y: 1.5, z: -1 }, 0.3), 0, 'a head behind hides nothing');
  assert.equal(faceCover(eye, a, 0.3, { x: 1.05, y: 1.5, z: 0.2 }, 0.3), 0, 'side by side: nothing hidden');
  const half = faceCover(eye, a, 0.3, { x: 0.3 * FACE_SHARE, y: 1.5, z: 1e-2 }, 0.3 * FACE_SHARE);
  assert.ok(half > 0.3 && half < 0.7, `a head half across the face hides about half of it (${half.toFixed(2)})`);
  const [front, wide] = viewsOf({ x: 2, y: 1.2, z: -1 }, [0, 9.5], [{ pos: [0, 2, 6] }]);
  assert.ok(front.z > -1 + 2 && Math.abs(front.y - 1.55) < 1e-9 && front.x < 2, 'the front view stands toward the audience, a little above');
  assert.deepEqual(wide, { x: 0, y: 2, z: 6 });
}

// 2. the strafe: a sideways step keeps the face to the audience; a plain walk turns to the way it goes
{
  const yawAfter = (strafe) => {
    const b = new Bot('Silver', new THREE.Vector3(0, 1.2, 0), 14);
    b.place(new THREE.Vector3(0, 1.2, 0), 0);
    b.walkTo(new THREE.Vector3(1.2, 1.2, 0), { face: 0, strafe });
    let worst = 0;
    for (let f = 0; f < 45; f++) { b.update(1 / 60, f / 60); worst = Math.max(worst, Math.abs(b.yaw)); }
    return worst;
  };
  assert.ok(yawAfter(true) < 0.05, `a strafing step keeps facing the audience (${yawAfter(true).toFixed(2)} rad)`);
  assert.ok(yawAfter(false) > 0.6, 'a plain walk turns toward the way it goes');
}

// 3. the beach-ball duet: "{Jade} pulls us by the hand" sung by Silver (lead) and Red (harmony) at 101.64 s. Red had
//    sung beside Jade on Silver's right: it stays on that side, level with Silver, and never covers Silver's face
{
  let worst = 0, lat = null, depth = null;
  await simulate('beach-ball', {
    seconds: 105.5,
    each: ({ now, bots }) => {
      if (now < 101.7) return;
      const s = bots.get('Silver'), r = bots.get('Red');
      const ps = headOf(s, new THREE.Vector3()), pr = headOf(r, new THREE.Vector3());
      const [front] = viewsOf(ps, [0, 9.5]);
      worst = Math.max(worst, faceCover(front, ps, headRadius(s), pr, headRadius(r)));
      // across and along the audience's view of Silver (the beach's audience at [0, 9.5])
      const fx = 0 - ps.x, fz = 9.5 - ps.z, n = Math.hypot(fx, fz);
      lat = ((pr.x - ps.x) * fz - (pr.z - ps.z) * fx) / n;
      depth = Math.abs(((pr.x - ps.x) * fx + (pr.z - ps.z) * fz) / n);
    },
  });
  assert.ok(worst <= HIDDEN, `Red never hides Silver's face in their duet (${worst.toFixed(2)})`);
  assert.ok(lat > 0.8 && depth < 0.3, `side by side: Red on Silver's right ${lat.toFixed(2)} m, ${depth.toFixed(2)} m apart in depth`);
}

// 4. every curated episode: the singers' faces in sight
const rows = [];
for (const [slug] of SEEDS) {
  const s = await sightlines(slug);
  const front = s.front / s.singing, wide = s.wide / s.singing;
  const longest = s.runs.filter((x) => x.view === 'front')[0];
  const long = longest ? longest.t1 - longest.t0 : 0;
  assert.ok(front <= 0.04, `${slug}: singing faces hidden from the front ${(100 * front).toFixed(1)}% of the singing (${s.front} of ${s.singing} s)`);
  assert.ok(wide <= 0.06, `${slug}: singing faces hidden from the main wide ${(100 * wide).toFixed(1)}% of the singing (${s.wide} of ${s.singing} s)`);
  assert.ok(long <= 3, `${slug}: a singing face hidden from the front for ${long.toFixed(1)} s (${longest?.who} at ${longest?.t0} s behind ${longest?.by})`);
  rows.push(`${slug} ${(100 * front).toFixed(1)}%/${(100 * wide).toFixed(1)}%`);
}
console.log(`sightlines ok: faceCover, singers strafe facing the audience, a harmony beside its lead on its own side, every episode's singers in sight (front/wide hidden: ${rows.join(', ')})`);
