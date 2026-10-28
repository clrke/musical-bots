// Rig maths of the mechanical faces (pure: no three.js). Turns expression channels into the poses
// of the mechanisms (lid angles, iris aperture, brow slides and tilts, the mouth's lip curves) and
// composes the per-bone affine matrices the head shader skins with. Everything writes into
// caller-owned objects / typed arrays, so a frame allocates nothing.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ eyes

/**
 * Shutter lids. Each lid is a spherical shell around the eye centre that rotates about the eye's
 * horizontal axis; its edge elevation (rad, + = up, 0 = level with the pupil). The lower lid goes
 * from `lowOpen` (lidLow = 0) up to `lowClosed` (= 1); the upper lid sweeps from `upOpen`
 * (lidUp = 0) all the way down to meet the lower lid (lidUp = 1, overlapping by `meet`), so a
 * blink always shuts the eye. The lid shells are modelled with their edges at `upModel` /
 * `lowModel`; a bone turns them by (model - edge). `tilt` slants the lid line (angry / sad), the
 * lower lid follows by `lowTilt`.
 */
export const LID = Object.freeze({ upOpen: 0.98, lowOpen: -0.92, lowClosed: 0.1, meet: 0.07, upModel: -0.1, lowModel: 0.07, tilt: 0.5, lowTilt: 0.4 });

/** Writes { upper, lower } edge elevations (rad) and { tiltUp, tiltLow } (rad, eye-local: + = CCW, the inner side down). */
export function lidPose(up, low, tilt, out) {
  out.lower = LID.lowOpen + (LID.lowClosed - LID.lowOpen) * clamp(low, 0, 1);
  out.upper = LID.upOpen + (out.lower - LID.meet - LID.upOpen) * clamp(up, 0, 1);
  // local frame: +x points away from the nose, so CCW lowers the inner (nose) side = angry
  out.tiltUp = -clamp(tilt, -1.2, 1.2) * LID.tilt;
  out.tiltLow = out.tiltUp * LID.lowTilt;
  return out;
}

/** lidPose with its inputs in a typed array v = [up, low, tilt] (hot path: no number arguments). */
export function lidPoseV(v, out) {
  return lidPose(v[0], v[1], v[2], out);
}

/** Angular gap (rad) between the lids at the eye's centre line (0 = shut). */
export function eyeOpening(up, low) {
  const p = lidPose(up, low, 0, {});
  return Math.max(0, p.upper - p.lower);
}

/** Iris aperture (pupil) radius as a fraction of the iris radius, from dilation 0..1. */
export function pupilRadius(dilation) {
  return clamp(0.18 + 0.6 * dilation, 0.1, 0.86);
}

/** Aperture blade rotation (rad): the blades turn as they close, like a camera diaphragm. */
export function apertureTwist(dilation) {
  return 0.9 * (1 - clamp(dilation, 0, 1));
}

/** Eye look limits (rad): the eyeballs rotate in their sockets. */
export const LOOK = Object.freeze({ yaw: 0.5, pitch: 0.36 });

export function clampLook(yaw, pitch, out) {
  out.yaw = clamp(yaw, -LOOK.yaw, LOOK.yaw);
  out.pitch = clamp(pitch, -LOOK.pitch, LOOK.pitch);
  return out;
}

// ------------------------------------------------------------------ brows

/**
 * Brow servos, in the brow's own frame (x = away from the nose, y = up, z = out of the face):
 * raise slides it up the rail, tilt turns it (worried = inner end up, angry = inner end down),
 * squeeze pulls it toward the nose and furrows (adds an angry tilt).
 */
export const BROW = Object.freeze({ raise: 0.016, tilt: 0.56, squeeze: 0.008, furrow: 0.5, arch: 0.007 });

export function browPose(raise, tilt, squeeze, out) {
  const sq = clamp(squeeze, 0, 1);
  out.x = -sq * BROW.squeeze;
  out.y = clamp(raise, -1.4, 1.4) * BROW.raise - sq * 0.003;
  // + rot = CCW in the brow frame = outer end up = inner end down (angry)
  out.rot = -clamp(tilt - sq * BROW.furrow, -1.4, 1.4) * BROW.tilt;
  return out;
}

/**
 * Brow line height at x (brow frame) for a pose and an arch (segmented brows, pistons):
 * the straight brow line through the pose plus a bow.
 */
export function browLineY(pose, arch, halfLen, x) {
  const f = x / halfLen;
  return pose.y + Math.tan(pose.rot) * x + arch * BROW.arch * (1 - f * f);
}

/** Slope angle of the brow line at x. */
export function browLineAngle(pose, arch, halfLen, x) {
  return Math.atan(Math.tan(pose.rot) - (2 * arch * BROW.arch * x) / (halfLen * halfLen));
}

// ------------------------------------------------------------------ mouth

/**
 * The mouth is two lip lines between two corners. Smile lifts both corners, smirk one of them,
 * width / round stretch or pucker it, open parts the lips (the lower lip travels further, like a
 * jaw). u runs from -1 (left corner) to 1 (right corner).
 */
export const MOUTH = Object.freeze({ corner: 0.56, smirk: 0.46, upperShare: 0.34, widthGain: 0.24, roundNarrow: 0.36, smileWiden: 0.08, pucker: 0.01 });

/** Writes { halfWidth, cornerL, cornerR, gap, round } for mouth channels m and spec { halfWidth, height }. */
export function mouthFrame(open, smile, width, round, smirk, spec, out) {
  const hw = spec.halfWidth;
  out.halfWidth = hw * (1 + MOUTH.widthGain * clamp(width, -1, 1) - MOUTH.roundNarrow * clamp(round, 0, 1) + MOUTH.smileWiden * Math.abs(smile));
  out.cornerL = hw * (MOUTH.corner * smile - MOUTH.smirk * smirk);
  out.cornerR = hw * (MOUTH.corner * smile + MOUTH.smirk * smirk);
  out.gap = spec.height * clamp(open, 0, 1);
  out.round = clamp(round, 0, 1);
  return out;
}

/** mouthFrame with its channels in a typed array v = [open, smile, width, round, smirk]. */
export function mouthFrameV(v, spec, out) {
  return mouthFrame(v[0], v[1], v[2], v[3], v[4], spec, out);
}

/**
 * Lip line point at u: lip = 1 upper lip edge, -1 lower lip edge, 0 the closed line. Writes
 * { x, y, z, angle } (angle = the line's slope, rad, from the analytic derivative).
 */
export function mouthPoint(f, u, lip, out) {
  const au = Math.min(1, Math.abs(u));
  const sg = u < 0 ? -1 : 1;
  const corner = u < 0 ? f.cornerL : f.cornerR;
  const y0 = corner * Math.pow(au, 2.2);
  const dy0 = corner * 2.2 * Math.pow(au, 1.2) * sg;
  const p = 0.5 + 0.45 * f.round;
  const q = Math.max(1 - au * au, 0.02);
  const h = Math.pow(Math.max(0, 1 - au * au), p);
  const dh = -2 * au * sg * p * Math.pow(q, p - 1);
  let y = y0;
  let dy = dy0;
  if (lip > 0) {
    y += f.gap * MOUTH.upperShare * h;
    dy += f.gap * MOUTH.upperShare * dh;
  } else if (lip < 0) {
    y -= f.gap * (1 - MOUTH.upperShare) * h;
    dy -= f.gap * (1 - MOUTH.upperShare) * dh;
  }
  out.x = u * f.halfWidth;
  out.y = y;
  out.z = MOUTH.pucker * f.round * (1 - au * au);
  out.angle = Math.atan2(dy, f.halfWidth);
  return out;
}

const tmpS = { x: 0, y: 0, z: 0, angle: 0 };

/** Slope angle (rad) of a lip line at u. */
export function mouthSlope(f, u, lip) {
  return mouthPoint(f, u, lip, tmpS).angle;
}

// ------------------------------------------------------------------ bone matrices

/** Animation of one bone, in its rest frame: Float64Array [tx, ty, tz, rx, ry, rz, sx, sy, sz]. */
export function createAnim() {
  const a = new Float64Array(9);
  a[6] = a[7] = a[8] = 1;
  return a;
}

/** Fills an animation array (small enough to be inlined by the JIT, so no number boxing). */
export function setAnim(A, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
  A[0] = tx;
  A[1] = ty;
  A[2] = tz;
  A[3] = rx;
  A[4] = ry;
  A[5] = rz;
  A[6] = sx;
  A[7] = sy;
  A[8] = sz;
  return A;
}

/**
 * Bone matrix for a mechanism part: B = T(a) Q [T(t) R S] Qt T(-a), with a = pivot (head space),
 * Q = the part's rest frame (row-major 3x3, may include a mirror; null = identity), and the
 * animation A (see createAnim) in that frame (R = Rz * Ry * Rx). Written as 3 rows of
 * (m0, m1, m2, translation) at out[o .. o + 11]. The animation comes in a typed array and every
 * temporary is a local constant, so composing 32 bones a frame allocates nothing.
 */
export function composeBone(out, o, pivot, Q, A) {
  const tx = A[0], ty = A[1], tz = A[2];
  const cx = Math.cos(A[3]), snx = Math.sin(A[3]);
  const cy = Math.cos(A[4]), sny = Math.sin(A[4]);
  const cz = Math.cos(A[5]), snz = Math.sin(A[5]);
  const sx = A[6], sy = A[7], sz = A[8];
  // A = (Rz * Ry * Rx) * S
  const a00 = cz * cy * sx, a01 = (cz * sny * snx - snz * cx) * sy, a02 = (cz * sny * cx + snz * snx) * sz;
  const a10 = snz * cy * sx, a11 = (snz * sny * snx + cz * cx) * sy, a12 = (snz * sny * cx - cz * snx) * sz;
  const a20 = -sny * sx, a21 = cy * snx * sy, a22 = cy * cx * sz;
  const ax = pivot[0], ay = pivot[1], az = pivot[2];
  if (Q === null) {
    out[o] = a00; out[o + 1] = a01; out[o + 2] = a02; out[o + 3] = ax + tx - (a00 * ax + a01 * ay + a02 * az);
    out[o + 4] = a10; out[o + 5] = a11; out[o + 6] = a12; out[o + 7] = ay + ty - (a10 * ax + a11 * ay + a12 * az);
    out[o + 8] = a20; out[o + 9] = a21; out[o + 10] = a22; out[o + 11] = az + tz - (a20 * ax + a21 * ay + a22 * az);
    return out;
  }
  const q00 = Q[0], q01 = Q[1], q02 = Q[2], q10 = Q[3], q11 = Q[4], q12 = Q[5], q20 = Q[6], q21 = Q[7], q22 = Q[8];
  // M = Q * A, L = M * Qt
  const m00 = q00 * a00 + q01 * a10 + q02 * a20, m01 = q00 * a01 + q01 * a11 + q02 * a21, m02 = q00 * a02 + q01 * a12 + q02 * a22;
  const m10 = q10 * a00 + q11 * a10 + q12 * a20, m11 = q10 * a01 + q11 * a11 + q12 * a21, m12 = q10 * a02 + q11 * a12 + q12 * a22;
  const m20 = q20 * a00 + q21 * a10 + q22 * a20, m21 = q20 * a01 + q21 * a11 + q22 * a21, m22 = q20 * a02 + q21 * a12 + q22 * a22;
  const l00 = m00 * q00 + m01 * q01 + m02 * q02, l01 = m00 * q10 + m01 * q11 + m02 * q12, l02 = m00 * q20 + m01 * q21 + m02 * q22;
  const l10 = m10 * q00 + m11 * q01 + m12 * q02, l11 = m10 * q10 + m11 * q11 + m12 * q12, l12 = m10 * q20 + m11 * q21 + m12 * q22;
  const l20 = m20 * q00 + m21 * q01 + m22 * q02, l21 = m20 * q10 + m21 * q11 + m22 * q12, l22 = m20 * q20 + m21 * q21 + m22 * q22;
  const qtx = q00 * tx + q01 * ty + q02 * tz, qty = q10 * tx + q11 * ty + q12 * tz, qtz = q20 * tx + q21 * ty + q22 * tz;
  out[o] = l00; out[o + 1] = l01; out[o + 2] = l02; out[o + 3] = ax + qtx - (l00 * ax + l01 * ay + l02 * az);
  out[o + 4] = l10; out[o + 5] = l11; out[o + 6] = l12; out[o + 7] = ay + qty - (l10 * ax + l11 * ay + l12 * az);
  out[o + 8] = l20; out[o + 9] = l21; out[o + 10] = l22; out[o + 11] = az + qtz - (l20 * ax + l21 * ay + l22 * az);
  return out;
}

/** Identity bone at slot o. */
export function identityBone(out, o) {
  out[o] = 1; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = 1; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = 0; out[o + 9] = 0; out[o + 10] = 1; out[o + 11] = 0;
  return out;
}

/** Applies bone o of `m` to point p ([x, y, z]) -> out ([x, y, z]). For tests and anchors. */
export function applyBone(m, o, p, out = [0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[o] * x + m[o + 1] * y + m[o + 2] * z + m[o + 3];
  out[1] = m[o + 4] * x + m[o + 5] * y + m[o + 6] * z + m[o + 7];
  out[2] = m[o + 8] * x + m[o + 9] * y + m[o + 10] * z + m[o + 11];
  return out;
}
