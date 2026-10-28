// Unity ParticleSystem emission shapes (the subset the ported effects use). Pure: no three.js.
// Each sampler writes a start offset (relative to the emitter) into p[0..2] and a unit start
// direction into d[0..2]. Shapes are axis-symmetric about Y after the presets' +/-90 deg X tilt,
// so `dir` = +1 points the cone / dome up, -1 down.

/** Uniform random unit vector. */
export function randomUnit(rng, d) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  d[0] = r * Math.cos(a);
  d[1] = z;
  d[2] = r * Math.sin(a);
  return d;
}

/**
 * Cone (Unity: base disc of `radius` with radiusThickness 1; a particle at normalised radius rho
 * leaves at rho * angle from the axis, tilted outward).
 */
export function sampleCone(rng, radius, angleDeg, dir, p, d) {
  const rho = Math.sqrt(rng());
  const a = rng() * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  p[0] = radius * rho * ca;
  p[1] = 0;
  p[2] = radius * rho * sa;
  const tilt = (rho * angleDeg * Math.PI) / 180;
  const st = Math.sin(tilt);
  d[0] = st * ca;
  d[1] = Math.cos(tilt) * dir;
  d[2] = st * sa;
  return p;
}

/** Radius uniform in volume between (1 - thickness) * radius and radius (Unity radiusThickness). */
function shellRadius(rng, radius, thickness) {
  const r0 = Math.max(0, 1 - thickness);
  return radius * Math.cbrt(r0 * r0 * r0 + rng() * (1 - r0 * r0 * r0));
}

/** Hemisphere (Unity: anywhere inside, moving outward from the centre), dome toward `dir`. */
export function sampleHemisphere(rng, radius, dir, p, d, thickness = 1) {
  randomUnit(rng, d);
  if (d[1] * dir < 0) d[1] = -d[1];
  const r = shellRadius(rng, radius, thickness);
  p[0] = d[0] * r;
  p[1] = d[1] * r;
  p[2] = d[2] * r;
  return p;
}

/** Sphere (Unity: anywhere inside, moving outward from the centre). */
export function sampleSphere(rng, radius, p, d, thickness = 1) {
  randomUnit(rng, d);
  const r = shellRadius(rng, radius, thickness);
  p[0] = d[0] * r;
  p[1] = d[1] * r;
  p[2] = d[2] * r;
  return p;
}

/** Dispatch on a shape { type, angle, dir, thickness? } with its radius already scaled to the head. */
export function sampleShape(rng, shape, radius, p, d) {
  switch (shape.type) {
    case 'cone':
      return sampleCone(rng, radius, shape.angle, shape.dir, p, d);
    case 'hemisphere':
      return sampleHemisphere(rng, radius, shape.dir, p, d, shape.thickness ?? 1);
    default:
      return sampleSphere(rng, radius, p, d, shape.thickness ?? 1);
  }
}

/**
 * Smooth pseudo-noise velocity (stand-in for Unity's Noise module, quality Low): sums of sines over
 * position and time, components in -1..1. Writes into out[0..2].
 */
export function noiseField(x, y, z, t, out) {
  out[0] = 0.5 * (Math.sin(1.7 * y + 1.3 * t + 0.5) + Math.sin(2.9 * z - 0.9 * t + 1.2));
  out[1] = 0.5 * (Math.sin(1.9 * z + 1.1 * t + 2.1) + Math.sin(2.3 * x - 1.4 * t + 0.7));
  out[2] = 0.5 * (Math.sin(1.5 * x + 1.7 * t + 4.2) + Math.sin(2.7 * y - 1.2 * t + 3.1));
  return out;
}
