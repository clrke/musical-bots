// One floating, singing mechanical robot head (see ARCHITECTURE.md, scene/).
//
// Scene graph:  group (placed by the choir, faces the viewer's seat; a play's social offset moves it)
//                 floatNode  (idle float per floatStyle, singing bounce, scale, a play's lean + nudge wobble)
//                   turnNode (turns toward the viewer + the personality's head pose)
//                     mesh      the whole mechanical head: ONE skinned draw call (mech/assemble.js)
//                     outline   selection / hover outline (only while shown)
//                     glow      soft halo behind the head (only while shown)
//                   hitTarget (invisible sphere for gaze / hand rays, userData.robotIndex)
//                 lyrics panel (stays level, faces the viewer)
// Expression: personality.js composes channel targets (personality + singing + vowel + idle life +
// acts on cue + reactions), springs move the channels, face-rig.js turns them into bone matrices for the shader.
// Particles go to a shared field (createChoir passes it); a head made on its own gets a small one.
import * as THREE from 'three';
import { lightness, normalizeAppearance, normalizeParticles, trimColor } from './appearance.js';
import { drawnLook, soften } from './head-style.js';
import { LID, apertureTwist, browLineAngle, browLineY, browPose, clampLook, composeBone, createAnim, identityBone, lidPoseV, mouthFrameV, mouthPoint, pupilRadius } from './face-rig.js';
import {
  SHARED_UNIFORMS,
  applyFinish,
  createGlowMaterial,
  createHeadMaterial,
  createOutlineMaterial,
  getGlowQuad,
  getHitMaterial,
  getHitSphere,
} from './head-material.js';
import { PANEL_H, createLyricsPanel } from './lyrics-panel.js';
import { BONE, BONE_COUNT } from './mech/builder.js';
import { acquireHead, pumpHeadBuilds, releaseHead, tryAcquireHead, headKey } from './mech/assemble.js';
import { GRILLE_GAP } from './mech/mouths.js';
import { approach, floatOffset, follow, makeRng, springStep } from './motion.js';
import { createParticleField } from './particles/field.js';
import {
  CH,
  CHANNEL_COUNT,
  DEFAULT_ACT,
  GAZE,
  NEUTRAL,
  VOWEL_SHAPES,
  activeAct,
  activeReaction,
  blinkLid,
  createExpression,
  createExpressionInput,
  normalizePersonality,
  onsetClosure,
  playExpressionAct,
  setExpressionPersonality,
  stepExpression,
  triggerReaction,
  vowelOf,
} from './personality.js';

/** Seconds without singing or lyric progress before the lyrics panel fades away. */
export const LYRICS_HIDE_AFTER = 2.5;
/**
 * The card's look per sung part (rig.js sing opts.part): its size, how opaque it is, how long it stays up after its
 * voice (s; the story's line LYRICS_HIDE_AFTER). Every voice has its card; the backing's ("Bom, bom", "Ooh", "la la")
 * are smaller and dimmer, the harmonies a touch smaller than the story's line, and theirs go sooner (the story's line
 * stays: no crowd of finished cards).
 */
export const CARD_STYLES = Object.freeze({
  lead: { scale: 1, opacity: 1, bg: 0.74, hide: LYRICS_HIDE_AFTER },
  harmony: { scale: 0.9, opacity: 0.96, bg: 0.7, hide: 1.2 },
  reply: { scale: 0.92, opacity: 1, bg: 0.74, hide: 1.8 },
  echo: { scale: 0.86, opacity: 0.94, bg: 0.7, hide: 1.2 },
  backing: { scale: 0.74, opacity: 0.86, bg: 0.58, hide: 1.0 },
});
/** How fast a card eases to the place the stage's layout gives it (1/s): clear of the cards beside it. */
const CARD_SHIFT_RATE = 12;

/** A glance turns the head this share of the way (the eyes do the rest); `glanceTo(.., turn)` asks for more. */
export const GLANCE_TURN = 0.5;
// The nudge wobble (Unity RobotHead.Nudge): a light spring on the floating head (rings ~1 s), tipping
// toward the push (rad per unit of offset), the antenna swinging behind (rad/s per unit/s).
const NUDGE_K = 220, NUDGE_C = 9, NUDGE_TIP = 2.5, NUDGE_ANTENNA = 8;

// slots of a head's numeric state (see createRobotHead)
const S_SCALE = 0, S_LEVEL_IN = 1, S_LEVEL = 2, S_SELECT = 3, S_HOVER = 4, S_MUTE = 5, S_POP = 6, S_YAW = 7, S_PITCH = 8, S_ARTIC = 9, S_LAST_ACTIVE = 10, S_PANEL = 11, S_TIME = 12, S_DT = 13, S_SIZE = 14;

const SELECT_COLOR = new THREE.Color('#ffd166');
const HOVER_COLOR = new THREE.Color('#dfe8ff');
const WHITE = new THREE.Color('#ffffff');

/** Spring (stiffness, damping) per channel: lids snap, brows overshoot a little, heads sway. */
const SPRING_K = new Float32Array(CHANNEL_COUNT);
const SPRING_C = new Float32Array(CHANNEL_COUNT);
{
  const set = (names, k, c) => {
    for (const n of names) {
      SPRING_K[CH[n]] = k;
      SPRING_C[CH[n]] = c;
    }
  };
  set(['browRaiseL', 'browRaiseR', 'browTiltL', 'browTiltR', 'browSqueeze', 'browArch'], 260, 21);
  set(['lidUpL', 'lidUpR', 'lidLowL', 'lidLowR'], 1100, 62);
  set(['lidTiltL', 'lidTiltR'], 300, 30);
  set(['pupilL', 'pupilR'], 160, 17);
  set(['lookYaw', 'lookPitch'], 520, 42);
  set(['mouthOpen'], 900, 52);
  set(['mouthSmile', 'mouthWidth', 'mouthRound', 'mouthSmirk'], 420, 36);
  set(['headRoll', 'headPitch', 'headYaw'], 70, 12);
  set(['blush'], 30, 11);
  set(['irisGlow'], 60, 14);
  set(['eyeZoom'], 240, 15);
  set(['antenna'], 90, 9);
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpQ3 = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpPose = { x: 0, y: 0, rot: 0 };
const tmpLid = { upper: 0, lower: 0, tiltUp: 0, tiltLow: 0 };
const tmpLook = { yaw: 0, pitch: 0 };
const tmpPt = { x: 0, y: 0, z: 0, angle: 0 };
const tmpPt2 = { x: 0, y: 0, z: 0, angle: 0 };
const tmpFrame = { halfWidth: 0, cornerL: 0, cornerR: 0, gap: 0, round: 0 };
// one bone's animation (tx, ty, tz, rx, ry, rz, sx, sy, sz), written in place before each
// composeBone call: no numbers cross a call boundary, so posing allocates nothing
const anim = createAnim();
const lidIn = new Float64Array(3); // up, low, tilt
const mouthIn = new Float64Array(5); // open, smile, width, round, smirk
const mouthSpec = { halfWidth: 0.04, height: 0.042 };

function sameFields(a, b) {
  for (const k in a) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * @param {{ index?: number, fx?: ReturnType<typeof createParticleField> | null, captionLines?: 1 | 2 }} opts
 *   `fx`: shared particle field (its mesh must sit in the same parent as `group`); when omitted
 *   the head makes a private one inside its group. `captionLines`: 1 keeps the lyrics card one
 *   line tall (the back row).
 */
export function createRobotHead({ index = 0, fx = null, captionLines = 2 } = {}) {
  const rng = makeRng(index * 7919 + 101);
  const phase = rng() * Math.PI * 2;

  const group = new THREE.Group();
  group.name = `robot-head-${index}`;
  const floatNode = new THREE.Group();
  const turnNode = new THREE.Group();
  turnNode.rotation.order = 'YXZ';
  group.add(floatNode);
  floatNode.add(turnNode);

  const material = createHeadMaterial();
  const u = material.uniforms;
  const bonesArr = u.uBones.value;
  for (let i = 0; i < BONE_COUNT; i++) identityBone(bonesArr, i * 12);
  const outlineMat = createOutlineMaterial();
  const glowMat = createGlowMaterial();

  const mesh = new THREE.Mesh(undefined, material);
  mesh.name = 'head';
  const outline = new THREE.Mesh(undefined, outlineMat);
  outline.name = 'outline';
  outline.visible = false;
  const glow = new THREE.Mesh(getGlowQuad(), glowMat);
  glow.name = 'glow';
  glow.renderOrder = 4;
  glow.visible = false;
  glow.frustumCulled = false;
  const mouthAnchor = new THREE.Object3D();
  turnNode.add(mesh, outline, glow, mouthAnchor);

  const hitTarget = new THREE.Mesh(getHitSphere(), getHitMaterial());
  hitTarget.name = `robot-hit-${index}`;
  hitTarget.userData.robotIndex = index;
  floatNode.add(hitTarget);

  const panel = createLyricsPanel({ maxLines: captionLines });
  group.add(panel.object);

  let field = fx;
  if (!field) {
    field = createParticleField({ maxEmitters: 1, perEmitter: 128, seed: index + 1 });
    group.add(field.mesh);
  }
  const ownField = field !== fx;
  let atlasRequested = !ownField;
  const emitter = field.createEmitter();

  // ---- state
  let appearance = normalizeAppearance();
  let particles = normalizeParticles();
  let appearanceRef = null;
  let particlesRef = null;
  let head = null; // shared mechanical head (geometry + rig)
  let pendingKey = '';
  let pendingAppearance = null;
  let personality = normalizePersonality();
  const expr = createExpression(personality, index * 31 + 7);
  const input = createExpressionInput();
  const target = new Float32Array(CHANNEL_COUNT);
  const ch = Float32Array.from(NEUTRAL); // current (sprung) channel values
  const chV = new Float32Array(CHANNEL_COUNT);
  // numeric state lives in a typed array (numbers in closure variables would be boxed on every store)
  const S = new Float64Array(16);
  S[S_SCALE] = 1;
  S[S_POP] = 1;
  S[S_ARTIC] = 1;
  S[S_LAST_ACTIVE] = -Infinity;
  let selected = false;
  let hovered = false;
  let muted = false;
  let vowel = null;
  let newSyllable = false;
  let lyrics = null;
  let progress = -1;
  // the card: its style (CARD_STYLES) and the layout's move off its place (head-group units: x along the card,
  // y up; eased toward the goal, back to 0 once the card is down)
  let cardStyle = CARD_STYLES.lead;
  const cardShift = { x: 0, y: 0, gx: 0, gy: 0 };
  // merged into a card that shows the same words (the layout found no free place for it): faded out, 0..1 shown
  let cardMerged = false;
  let cardShown = 1;
  let firstUpdate = true;
  let neighbors = [];
  let glanceAt = null;
  // the choir's plays (acting.js): the head off its place (group = parent space), its lean (radians
  // toward a horizontal direction, group space) and the nudge wobble of the floating head
  const social = new THREE.Vector3();
  const lean = new THREE.Vector3();
  const nudgeX = new THREE.Vector3();
  const nudgeV = new THREE.Vector3();
  const bounce = { x: 0, v: 0 };
  const antX = { x: 0, v: 0 };
  const antZ = { x: 0, v: 0 };
  let playFace = null; // hand-play face hooks (A1): fn(targets) a hand play applies to the channel targets
  const fl = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const eyeColor = new THREE.Color();
  const viewerLocal = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const eyelids = new Float32Array(2); // effective upper-lid closure (blink included), L / R

  function headRadius() {
    return (head ? head.radius : 0.13) * appearance.scale;
  }

  // ---- geometry + rig

  function useHead(h) {
    if (h === head) return;
    const prev = head;
    head = h;
    mesh.geometry = h.geometry;
    outline.geometry = h.hull;
    const rig = h.rig;
    // seams + panel for the paint
    const seams = u.uSeams.value;
    rig.seams.forEach((s, i) => {
      seams[i * 2].set(s[0], s[1], s[2], s[3]);
      seams[i * 2 + 1].set(s[4], s[5], s[6], s[7]);
    });
    if (rig.panel) {
      u.uPanel.value.set(rig.panel[0], rig.panel[1], rig.panel[2], rig.panel[3]);
      u.uPanel2.value.set(rig.layout.faceX, 0.04, 1, 0);
    } else u.uPanel2.value.set(0, 0, 0, 0);
    const iris = rig.eyes.iris;
    u.uIris.value.set(iris.blades, iris.ring, iris.style, 0);
    rig.eyes.eyes.forEach((e, i) => u.uEyePos.value[i].set(e.center[0], e.center[1], e.center[2], 0));
    u.uCheek.value.set(rig.layout.faceX, rig.layout.cheekX, rig.layout.cheekY, 0.03);
    mouthAnchor.position.fromArray(h.mouthPoint);
    // the hit sphere covers the shell (not the thin antenna), so neighbours at full scale never overlap
    const hitR = Math.max(h.halfWidth * 0.92, h.shellTop, -h.bottom * 0.9);
    hitTarget.scale.setScalar(hitR / 0.15);
    hitTarget.position.set(0, (h.shellTop + h.bottom) * 0.5, 0);
    const g = h.radius * 3.0;
    glow.scale.set(g, g, 1);
    glow.position.set(0, (h.top + h.bottom) * 0.25, -0.06);
    for (let i = 0; i < BONE_COUNT; i++) identityBone(bonesArr, i * 12);
    if (prev) releaseHead(prev);
    configureParticles();
  }

  function applyColors() {
    // the colours drawn (head-style.js: the friendly look's, else the look's own)
    const d = drawnLook(appearance);
    applyFinish(d.faceColor, d.finish, u.uPaint.value, u.uFinish.value);
    u.uAccent.value.set(trimColor(d.faceColor, d.accentColor));
    eyeColor.set(d.eyeColor);
    u.uEye.value.copy(eyeColor);
    // the karaoke highlight: the eye colour, lifted when it is too dark to read
    const l = lightness(d.eyeColor);
    const hi = tmpColor.set(d.eyeColor);
    if (l < 0.55) hi.lerp(WHITE, Math.min(0.7, (0.55 - l) * 1.6));
    panel.setColors({ highlight: `#${hi.getHexString()}`, edge: d.eyeColor });
  }

  function configureParticles() {
    emitter.configure(particles, headRadius());
    if (!atlasRequested && particles.preset !== 'none') {
      // a head on its own loads the particle textures when it first needs them
      atlasRequested = true;
      import('./particles/atlas.js')
        .then(({ loadParticleAtlas }) => loadParticleAtlas())
        .then((tex) => field.setAtlas(tex))
        .catch((err) => console.warn('[scene] particle textures:', err.message));
    }
  }

  // ---- API

  /** @param {import('../model/schema.js').Appearance} a  (cheap to call every frame: unchanged = no-op) */
  function setAppearance(a) {
    if (a === appearanceRef && head) return;
    appearanceRef = a;
    const next = normalizeAppearance(a);
    if (head && sameFields(next, appearance)) return;
    const prev = appearance;
    appearance = next;
    const key = headKey(next);
    if (!head) useHead(acquireHead(next));
    else if (key !== head.key) {
      const h = tryAcquireHead(next);
      if (h) {
        useHead(h);
        S[S_POP] = 0;
      } else {
        pendingKey = key;
        pendingAppearance = next;
      }
    } else pendingKey = '';
    applyColors();
    configureParticles();
    if (prev.eyeColor !== next.eyeColor || prev.faceColor !== next.faceColor || prev.finish !== next.finish) S[S_POP] = Math.min(S[S_POP], 0.35);
  }

  /** @param {import('../model/schema.js').Particles} p  (unchanged = no-op) */
  function setParticles(p) {
    if (p === particlesRef) return;
    particlesRef = p;
    const next = normalizeParticles(p);
    if (sameFields(next, particles)) return;
    particles = next;
    configureParticles();
  }

  /** Personality id (PERSONALITIES); unknown ids fall back to the default. Cheap when unchanged. */
  function setPersonality(id) {
    const next = normalizePersonality(id);
    if (next === personality) return;
    personality = next;
    setExpressionPersonality(expr, next);
  }

  /** A reaction: 'select' (picked), 'wake' (just given bars), 'randomize' (new look). */
  function react(kind) {
    if (kind === 'randomize') S[S_POP] = Math.min(S[S_POP], 0.15);
    if (kind === 'wake') bounce.v += 0.35;
    if (kind === 'select') bounce.v += 0.2;
    return triggerReaction(expr, kind);
  }

  /**
   * Plays a face act (personality.js ACTS: 'nod', 'wink', 'gasp', 'boing'...) now, on cue (Unity
   * RobotHead.PlayAct): it takes the place of the idle act running and blends with the rest of the
   * face's life (while singing the mouth keeps to the words). A nod when no act is given. False (and
   * nothing changes) for an unknown act or while a reaction plays.
   */
  function playAct(name = DEFAULT_ACT) {
    return playExpressionAct(expr, name ?? DEFAULT_ACT);
  }

  /**
   * The choir's plays move the head off its place by `offset` and lean it by `tilt` (radians toward a
   * horizontal direction, its length the angle), both in the group's parent space; zeros put it back
   * exactly. The whole head moves (its lyrics card, sparkles and hit sphere too); the bot stays on its mark.
   */
  function setSocialOffset(offset, tilt = null) {
    if (offset) social.set(offset.x || 0, offset.y || 0, offset.z || 0);
    else social.set(0, 0, 0);
    group.position.copy(social);
    if (tilt) {
      lean.set(tilt.x || 0, 0, tilt.z || 0);
      if (lean.x || lean.z) lean.applyQuaternion(tmpQ.copy(group.quaternion).invert()).setY(0);
    } else lean.set(0, 0, 0);
  }

  /**
   * A push on the head (a bump, a poke, a landing): `velocity` (parent space, units/s) knocks the
   * floating head off on a light spring; it wobbles, tipping toward the push with the antenna swinging
   * behind, and settles by itself within about a second (Unity RobotHead.Nudge).
   */
  function nudge(velocity) {
    if (!velocity) return;
    const v = tmpV3.set(velocity.x || 0, velocity.y || 0, velocity.z || 0).applyQuaternion(tmpQ.copy(group.quaternion).invert());
    if (!(v.lengthSq() < 1e4)) return; // NaN or absurd: ignored
    nudgeV.add(v);
    antZ.v += NUDGE_ANTENNA * v.x;
    antX.v += NUDGE_ANTENNA * (0.5 * v.y - v.z);
  }

  // the vowel shape and lip closure of every syllable of the current line (worked out once per line)
  let sylVowels = [];
  let sylOnsets = [];

  /** @param {{ text: string, syllables?: Array<{text:string}> } | null} line */
  function setLyrics(line) {
    if (line === lyrics) return;
    if (line && lyrics && line.text === lyrics.text && line.syllables === lyrics.syllables) return;
    lyrics = line || null;
    panel.setLine(lyrics);
    const syl = Array.isArray(lyrics?.syllables) ? lyrics.syllables : [];
    sylVowels = syl.map((x) => VOWEL_SHAPES[vowelOf(x?.text)]);
    sylOnsets = syl.map((x) => onsetClosure(x?.text));
  }

  function setLyricProgress(i) {
    const next = Number.isInteger(i) && i >= 0 ? i : -1;
    if (next === progress) return;
    if (next >= 0) {
      S[S_LAST_ACTIVE] = S[S_TIME];
      vowel = sylVowels[next] ?? VOWEL_SHAPES.a;
      if (!muted) {
        bounce.v += 0.05 + 0.07 * S[S_LEVEL]; // a little hop on every syllable
        S[S_ARTIC] = sylOnsets[next] ?? 0.55;
        newSyllable = true;
      }
    }
    progress = next;
    panel.setProgress(next);
  }

  function setSinging(v) {
    S[S_LEVEL_IN] = v > 0 ? Math.min(1, v) : 0;
  }

  /** The lyric card stays up now (a new line before its voice, a long held note): its quiet spell starts again. */
  function keepLyrics() {
    S[S_LAST_ACTIVE] = S[S_TIME];
  }

  /** The card's look by the part sung (CARD_STYLES key; unknown: the story's line). */
  function setCardStyle(part) {
    cardStyle = CARD_STYLES[part] ?? CARD_STYLES.lead;
    panel.setBackground(cardStyle.bg);
  }

  /**
   * Where the stage's card layout wants the card: x along the card, y up, off its place (head-group units). `now`
   * (framing.js settleCards): 'snap', the card goes there at once (easing, it would cross another card); 'hide', it is
   * taken down at once (it would lie over another card); else it eases there.
   */
  function setCardShift(x, y, merged = false, now = null) {
    cardShift.gx = Number.isFinite(x) ? x : 0;
    cardShift.gy = Number.isFinite(y) ? Math.min(0, y) : 0;
    cardMerged = !!merged || now === 'hide';
    if (now === 'hide' && cardShown > 0) {
      cardShown = 0;
      panel.setOpacity(0);
    } else if (now === 'snap') {
      cardShift.x = cardShift.gx;
      cardShift.y = cardShift.gy;
      if (panel.mesh.visible) placePanel();
    }
  }

  function setSelected(v) {
    selected = !!v;
  }

  function setHovered(v) {
    hovered = !!v;
  }

  function setMuted(v) {
    muted = !!v;
  }

  /** Neighbour heads to glance at (Vector3s in the group's parent space; kept by reference). */
  function setNeighbors(list) {
    neighbors = Array.isArray(list) ? list.filter(Boolean) : [];
  }

  /**
   * Look at a point (parent space, kept by reference: move it to follow a head) for `seconds` (e.g. a
   * neighbour that was just picked). `turn`: how much of the way the head turns with the eyes (0.5, a
   * glance; up to 1, facing it: two bots consulting).
   */
  function glanceTo(point, seconds = 1.5, turn = GLANCE_TURN) {
    const k = Number.isFinite(turn) ? Math.min(1, Math.max(0, turn)) : GLANCE_TURN;
    glanceAt = point ? { point, until: S[S_TIME] + seconds, turn: k } : null;
  }

  /** The audio source point (the mouth) in world space. */
  function getVoiceWorldPosition(out = new THREE.Vector3()) {
    mouthAnchor.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(mouthAnchor.matrixWorld);
  }

  /**
   * Highest point of the head incl. antenna (plus its float and bounce margin), world space. Stable
   * (does not bob), for placing a panel above the head.
   */
  function getTopWorldPosition(out = new THREE.Vector3()) {
    const top = ((head ? head.top : 0.17) + 0.016) * appearance.scale;
    group.updateWorldMatrix(true, false);
    return group.localToWorld(out.set(0, top, 0));
  }

  // ---- per frame

  function poseBones() {
    const dt = S[S_DT];
    const rig = head.rig;
    const B = bonesArr;
    const zoomCh = ch[CH.eyeZoom];
    // eyes: aim at the look target (head space), plus the personality's look offsets
    const eyes = rig.eyes.eyes;
    for (let i = 0; i < eyes.length; i++) {
      const e = eyes[i];
      const left = e.side < 0;
      const s = floatNode.scale.x || 1;
      const dx = lookTarget.x - e.center[0] * s;
      const dy = lookTarget.y - e.center[1] * s;
      const dz = lookTarget.z - e.center[2] * s;
      const dzc = Math.max(0.05, dz);
      let ly = Math.atan2(dx, dzc);
      let lp = Math.atan2(dy, Math.sqrt(dx * dx + dzc * dzc));
      ly += ch[CH.lookYaw] + (left ? 1 : -1) * expr.cross * 0.22;
      lp += ch[CH.lookPitch];
      clampLook(ly, lp, tmpLook);
      const z = zoomCh * e.zoom;
      anim[0] = 0; anim[1] = 0; anim[2] = z;
      anim[3] = -tmpLook.pitch; anim[4] = tmpLook.yaw; anim[5] = 0;
      anim[6] = 1; anim[7] = 1; anim[8] = 1;
      composeBone(B, e.bones.eye * 12, e.center, null, anim);
      // lids: from the channels plus the blink stroke, following the eye's pitch a little
      const lidUp = blinkLid(ch[left ? CH.lidUpL : CH.lidUpR], expr.blink);
      eyelids[i] = lidUp;
      lidIn[0] = lidUp;
      lidIn[1] = ch[left ? CH.lidLowL : CH.lidLowR];
      lidIn[2] = ch[left ? CH.lidTiltL : CH.lidTiltR];
      lidPoseV(lidIn, tmpLid);
      const lidFollow = tmpLook.pitch * 0.45 * (1 - lidUp);
      const up = Math.max(tmpLid.upper + lidFollow, tmpLid.lower - 0.08);
      const lo = Math.min(tmpLid.lower + lidFollow * (1 - ch[left ? CH.lidLowL : CH.lidLowR]), up + 0.14);
      anim[0] = 0; anim[1] = 0; anim[2] = z;
      anim[3] = LID.upModel - up; anim[4] = 0; anim[5] = tmpLid.tiltUp;
      anim[6] = 1; anim[7] = 1; anim[8] = 1;
      composeBone(B, e.bones.up * 12, e.center, e.lidQ, anim);
      anim[0] = 0; anim[1] = 0; anim[2] = z;
      anim[3] = LID.lowModel - lo; anim[4] = 0; anim[5] = tmpLid.tiltLow;
      anim[6] = 1; anim[7] = 1; anim[8] = 1;
      composeBone(B, e.bones.low * 12, e.center, e.lidQ, anim);
      if (e.bones.tube >= 0) {
        anim[0] = 0; anim[1] = 0; anim[2] = z;
        anim[3] = 0; anim[4] = 0; anim[5] = 0;
        anim[6] = 1; anim[7] = 1; anim[8] = 1;
        composeBone(B, e.bones.tube * 12, e.center, null, anim);
      }
    }
    // brows
    const brows = rig.brows;
    for (let bi = 0; bi < brows.length; bi++) {
      const br = brows[bi];
      const left = br.side < 0;
      browPose(ch[left ? CH.browRaiseL : CH.browRaiseR], ch[left ? CH.browTiltL : CH.browTiltR], ch[CH.browSqueeze], tmpPose);
      const arch = ch[CH.browArch];
      if (br.kind === 'segmented') {
        const piv = br.segPivots;
        const bones = br.segBones;
        for (let j = 0; j < 3; j++) {
          const x = br.segX[j];
          anim[0] = tmpPose.x; anim[1] = browLineY(tmpPose, arch, br.halfLen, x); anim[2] = 0;
          anim[3] = 0; anim[4] = 0; anim[5] = browLineAngle(tmpPose, arch, br.halfLen, x);
          anim[6] = 1; anim[7] = 1; anim[8] = 1;
          composeBone(B, bones[j] * 12, piv[j], br.Q, anim);
        }
      } else {
        anim[0] = tmpPose.x; anim[1] = tmpPose.y; anim[2] = 0;
        anim[3] = 0; anim[4] = 0; anim[5] = tmpPose.rot;
        anim[6] = 1; anim[7] = 1; anim[8] = 1;
        composeBone(B, br.main * 12, br.pivot, br.Q, anim);
        if (br.kind === 'piston') {
          const c = Math.cos(tmpPose.rot);
          const sn = Math.sin(tmpPose.rot);
          for (let j = 0; j < 2; j++) {
            const x = br.rodX[j];
            anim[0] = tmpPose.x + x * (c - 1); anim[1] = tmpPose.y + x * sn; anim[2] = 0;
            anim[3] = 0; anim[4] = 0; anim[5] = 0;
            anim[6] = 1; anim[7] = 1; anim[8] = 1;
            composeBone(B, br.extra[j] * 12, br.rodPivots[j], br.Q, anim);
          }
        }
      }
    }
    // mouth
    const m = rig.mouth;
    mouthSpec.halfWidth = m.halfWidth;
    mouthSpec.height = m.height;
    const open = ch[CH.mouthOpen];
    const smile = ch[CH.mouthSmile];
    const width = ch[CH.mouthWidth];
    const round = ch[CH.mouthRound];
    const smirk = ch[CH.mouthSmirk];
    mouthIn[0] = m.type === 'jaw' ? open * 0.35 : open;
    mouthIn[1] = smile;
    mouthIn[2] = width;
    mouthIn[3] = round;
    mouthIn[4] = smirk;
    const f = mouthFrameV(mouthIn, mouthSpec, tmpFrame);
    const sf = m.surf; // the face near the mouth: z0 + zx dx + zy dy + zxx dx^2 + zyy dy^2
    for (let i = 0; i < m.bones.length; i++) {
      const mb = m.bones[i];
      const o = mb.index * 12;
      if (mb.role === 'lip' || mb.role === 'corner') {
        const lip = mb.role === 'corner' ? 0 : mb.lip;
        const uu = mb.role === 'corner' ? Math.sign(mb.u) : mb.u;
        let rot = 0;
        if (mb.role === 'corner') {
          mouthPoint(f, uu * 0.94, 0, tmpPt);
          rot = tmpPt.angle * 0.7;
        }
        mouthPoint(f, uu, lip, tmpPt);
        if (mb.role !== 'corner') rot = tmpPt.angle;
        const dx = tmpPt.x * (mb.role === 'corner' ? Math.abs(mb.u) : 1);
        const x = m.faceX + dx;
        const y = m.mouthY + tmpPt.y;
        const z = sf[0] + sf[1] * dx + sf[2] * tmpPt.y + sf[3] * dx * dx + sf[4] * tmpPt.y * tmpPt.y + m.standoff + tmpPt.z;
        anim[0] = x - mb.rest[0]; anim[1] = y - mb.rest[1]; anim[2] = z - mb.rest[2];
        anim[3] = 0; anim[4] = 0; anim[5] = rot;
        anim[6] = 1; anim[7] = 1; anim[8] = 1;
        composeBone(B, o, mb.rest, null, anim);
      } else if (mb.role === 'bar') {
        mouthPoint(f, mb.u, 1, tmpPt);
        mouthPoint(f, mb.u, -1, tmpPt2);
        const dx = tmpPt.x;
        const x = m.faceX + dx;
        const mid = (tmpPt.y + tmpPt2.y) / 2;
        const z = sf[0] + sf[1] * dx + sf[2] * mid + sf[3] * dx * dx + sf[4] * mid * mid + m.standoff;
        const sy = (tmpPt.y - tmpPt2.y + GRILLE_GAP) / GRILLE_GAP;
        anim[0] = x - mb.rest[0]; anim[1] = mid; anim[2] = z - mb.rest[2];
        anim[3] = 0; anim[4] = 0; anim[5] = 0;
        anim[6] = 1; anim[7] = sy; anim[8] = 1;
        composeBone(B, o, mb.rest, null, anim);
      } else if (mb.role === 'iris') {
        anim[0] = 0; anim[1] = 0.005 * smile; anim[2] = 0.006 * round;
        anim[3] = 0; anim[4] = 0; anim[5] = 0.32 * smirk;
        anim[6] = 1 + 0.26 * width - 0.16 * round; anim[7] = 1 + 0.1 * open + 0.08 * round; anim[8] = 1;
        composeBone(B, o, mb.rest ?? m.center, null, anim);
      } else if (mb.role === 'flap') {
        const side = Math.sign(mb.u);
        anim[0] = 0; anim[1] = 0; anim[2] = 0;
        anim[3] = 0; anim[4] = 0; anim[5] = side * 0.55 * smile + 0.4 * smirk;
        anim[6] = 1; anim[7] = 1; anim[8] = 1;
        composeBone(B, o, m.center, null, anim);
      }
    }
    if (m.jaw) {
      anim[0] = 0; anim[1] = -0.003 * open; anim[2] = 0.002 * open;
      anim[3] = open * 0.6; anim[4] = 0; anim[5] = 0.06 * smirk;
      anim[6] = 1; anim[7] = 1; anim[8] = 1;
      composeBone(B, BONE.JAW * 12, m.jaw.pivot, null, anim);
    }
    if (m.iris) {
      u.uMouthIris.value.set(0.07 + 0.9 * Math.min(1, open * 1.1), apertureTwist(open), 1 + 0.25 * width - 0.15 * round, 0);
    }
    // antenna: a damped spring driven by the float sway, the hops, and the perk channel
    const perk = ch[CH.antenna];
    {
      // two damped springs (stiffness 85, damping 6.5), sub-stepped like springStep, written inline
      const tz = -fl.rz * 1.3 - fl.x * 6 - ch[CH.headRoll] * 0.6;
      const tx = fl.rx * 0.9 + bounce.v * 2.2 + S[S_LEVEL] * 0.05 + Math.max(0, -perk) * 0.5 - Math.max(0, perk) * 0.06;
      const n = Math.min(8, Math.max(1, Math.ceil(dt / 0.016)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        antZ.v += (-85 * (antZ.x - tz) - 6.5 * antZ.v) * h;
        antZ.x += antZ.v * h;
        antX.v += (-85 * (antX.x - tx) - 6.5 * antX.v) * h;
        antX.x += antX.v * h;
      }
    }
    anim[0] = 0; anim[1] = 0; anim[2] = 0;
    anim[3] = antX.x; anim[4] = 0; anim[5] = antZ.x;
    anim[6] = 1; anim[7] = 1 + 0.06 * Math.max(0, perk); anim[8] = 1;
    composeBone(B, BONE.ANTENNA * 12, rig.antenna.mount, null, anim);
  }

  // The frame is split into small steps (each gets its own JIT inlining budget, and dt / t travel
  // in S rather than as arguments), so no numbers get boxed on the way: nothing is allocated.

  function stepLife() {
    const dt = S[S_DT];
    const t = S[S_TIME];
    S[S_LEVEL] = follow(S[S_LEVEL], muted ? 0 : S[S_LEVEL_IN], 30, 6, dt);
    S[S_SELECT] = approach(S[S_SELECT], selected ? 1 : 0, 10, dt);
    S[S_HOVER] = approach(S[S_HOVER], hovered ? 1 : 0, 12, dt);
    S[S_MUTE] = approach(S[S_MUTE], muted ? 1 : 0, 5, dt);
    S[S_SCALE] = approach(S[S_SCALE], appearance.scale, 7, dt);
    if (S[S_POP] < 1) S[S_POP] = Math.min(1, S[S_POP] + dt / 0.5);
    S[S_ARTIC] = approach(S[S_ARTIC], 1, 13, dt);
    if (S[S_LEVEL] > 0.05) S[S_LAST_ACTIVE] = t;
    // expression: targets from the personality, springs toward them
    input.level = S[S_LEVEL];
    input.vowel = S[S_LEVEL] > 0.02 ? vowel : null;
    input.artic = S[S_ARTIC];
    input.syllable = newSyllable;
    input.selected = S[S_SELECT];
    input.hovered = S[S_HOVER];
    input.muted = S[S_MUTE];
    input.neighbors = neighbors.length > 0;
    newSyllable = false;
    stepExpression(expr, dt, input, target);
    if (playFace) playFace(target); // hand-play face hooks (A1)
    soften(target); // the friendly look only: no scowls, eyes open, a smile at rest (head-style.js)
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / steps;
    for (let k = 0; k < steps; k++) {
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        const a = -SPRING_K[i] * (ch[i] - target[i]) - SPRING_C[i] * chV[i];
        chV[i] += a * h;
        ch[i] += chV[i] * h;
      }
    }
  }

  /** Float, hop, droop when muted. */
  function stepFloat() {
    const mute = S[S_MUTE];
    floatOffset(appearance.floatStyle, S[S_TIME], phase, 1 - 0.65 * mute, fl);
    springStep(bounce, 0, 260, 13, S[S_DT]);
    floatNode.position.set(fl.x, fl.y + bounce.x - 0.02 * mute, fl.z);
    floatNode.rotation.set(fl.rx, fl.ry, fl.rz);
    const pop = S[S_POP];
    const swell = pop < 1 ? 1 + 0.14 * Math.sin(pop * Math.PI) * (1 - pop) : 1;
    const s = S[S_SCALE] * (1 + 0.03 * S[S_LEVEL]) * swell;
    S[S_SIZE] = s;
    const stretch = Math.max(-0.06, Math.min(0.06, bounce.v * 0.45));
    floatNode.scale.set(s * (1 - stretch * 0.5), s * (1 + stretch), s * (1 - stretch * 0.5));
  }

  /** After the float: the nudge wobble and the lean of the choir's plays on top of it (Unity StepNudge). */
  function stepNudge() {
    let tip = 0;
    if (nudgeX.x !== 0 || nudgeX.y !== 0 || nudgeX.z !== 0 || nudgeV.x !== 0 || nudgeV.y !== 0 || nudgeV.z !== 0) {
      const dt = S[S_DT];
      const n = Math.min(8, Math.max(1, Math.ceil(dt / 0.008)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        nudgeV.x += (-NUDGE_K * nudgeX.x - NUDGE_C * nudgeV.x) * h;
        nudgeV.y += (-NUDGE_K * nudgeX.y - NUDGE_C * nudgeV.y) * h;
        nudgeV.z += (-NUDGE_K * nudgeX.z - NUDGE_C * nudgeV.z) * h;
        nudgeX.x += nudgeV.x * h;
        nudgeX.y += nudgeV.y * h;
        nudgeX.z += nudgeV.z * h;
      }
      if (nudgeX.lengthSq() < 1e-10 && nudgeV.lengthSq() < 1e-8) {
        nudgeX.set(0, 0, 0);
        nudgeV.set(0, 0, 0);
      }
      floatNode.position.add(nudgeX);
      tip = Math.sqrt(nudgeX.x * nudgeX.x + nudgeX.z * nudgeX.z);
    }
    const leanA = Math.sqrt(lean.x * lean.x + lean.z * lean.z);
    if (tip < 1e-6 && leanA < 1e-6) return;
    // tipping the top toward d turns about up x d = (d.z, 0, -d.x)
    tmpQ2.identity();
    if (leanA >= 1e-6) tmpQ2.setFromAxisAngle(tmpV3.set(lean.z / leanA, 0, -lean.x / leanA), leanA);
    if (tip >= 1e-6) tmpQ2.multiply(tmpQ3.setFromAxisAngle(tmpV3.set(nudgeX.z / tip, 0, -nudgeX.x / tip), NUDGE_TIP * tip));
    floatNode.quaternion.premultiply(tmpQ2);
  }

  /** Where to look (the viewer, a neighbour, a free glance) and the head turn that goes with it. */
  function stepGaze(viewer) {
    if (viewer) {
      tmpV.copy(viewer);
      group.worldToLocal(tmpV).sub(floatNode.position);
      viewerLocal.copy(tmpV);
    } else viewerLocal.set(0, 0, 1.5);
    const ty = Math.atan2(viewerLocal.x, viewerLocal.z);
    const tp = Math.atan2(viewerLocal.y, Math.sqrt(viewerLocal.x * viewerLocal.x + viewerLocal.z * viewerLocal.z));
    let gazePoint = null;
    let turn = GLANCE_TURN;
    if (glanceAt && S[S_TIME] < glanceAt.until) {
      gazePoint = glanceAt.point;
      turn = glanceAt.turn;
    } else if (expr.gaze === GAZE.LEFT || expr.gaze === GAZE.RIGHT) gazePoint = neighbors[expr.gaze === GAZE.LEFT ? 0 : neighbors.length - 1] ?? null;
    if (gazePoint) {
      // parent space -> group space -> float space
      tmpV2.copy(gazePoint).sub(group.position).applyQuaternion(tmpQ.copy(group.quaternion).invert()).sub(floatNode.position);
      tmpV2.y += 0.02;
    } else tmpV2.copy(viewerLocal);
    const gy = Math.atan2(tmpV2.x, tmpV2.z);
    const gp = Math.atan2(tmpV2.y, Math.sqrt(tmpV2.x * tmpV2.x + tmpV2.z * tmpV2.z));
    const level = S[S_LEVEL];
    const headFollow = 0.55 + 0.25 * Math.min(1, level * 2);
    // a glance turns the head only partly (the eyes do the rest), toward the viewer most of the way;
    // a stronger `turn` (two bots consulting) faces the point more and the viewer less
    const lim = 0.5 + Math.max(0, turn - GLANCE_TURN) * 1.6;
    const gyHead = Math.max(-lim, Math.min(lim, gy)) * turn + ty * 0.7 * (1 - turn);
    const wantYaw = Math.max(-0.75, Math.min(0.75, (gazePoint ? gyHead : ty * (0.75 + 0.15 * S[S_SELECT])) + ch[CH.headYaw] + ch[CH.lookYaw] * 0.35));
    const wantPitch = Math.max(-0.45, Math.min(0.45, (gazePoint ? gp * 0.5 : tp * headFollow) + ch[CH.headPitch] + ch[CH.lookPitch] * 0.25 + 0.05 * level));
    const k = 1 - Math.exp(-4 * S[S_DT]);
    S[S_YAW] += (wantYaw - S[S_YAW]) * k;
    S[S_PITCH] += (wantPitch - S[S_PITCH]) * k;
    const roll = ch[CH.headRoll] - fl.rz * 0.3;
    turnNode.rotation.set(-S[S_PITCH], S[S_YAW], roll);
    // look target in head space (undo the head turn)
    tmpE.set(-S[S_PITCH], S[S_YAW], roll, 'YXZ');
    tmpQ.setFromEuler(tmpE).invert();
    lookTarget.copy(tmpV2).applyQuaternion(tmpQ);
  }

  /** Shader values: pupils, glows, voice, blush, hover / select / mute feedback. */
  function stepShader() {
    const t = S[S_TIME];
    const level = S[S_LEVEL];
    const mute = S[S_MUTE];
    const sel = S[S_SELECT];
    const hov = S[S_HOVER];
    const awake = 1 - 0.7 * mute;
    const pl = ch[CH.pupilL];
    const pr = ch[CH.pupilR];
    u.uPupil.value.set(pupilRadius(pl), pupilRadius(pr), apertureTwist(pl) + phase, apertureTwist(pr) + phase * 1.3);
    const ig = awake * (0.75 + 0.35 * level) * Math.max(0, ch[CH.irisGlow]);
    u.uGlow.value.set(ig, ig, awake * (0.35 + 0.9 * level + 0.12 * Math.sin(t * 2.4 + phase)), muted ? 0 : level);
    u.uState.value.set(Math.max(0, ch[CH.blush]), 1 - 0.45 * mute, 0.65 * mute, 0.4 * hov + 0.7 * sel);
    u.uRimColor.value.copy(HOVER_COLOR).lerp(SELECT_COLOR, sel);
    // outline + halo
    outline.visible = Math.max(sel, hov) > 0.02;
    if (outline.visible) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 5);
      outlineMat.uniforms.uWidth.value = (0.0032 * hov + 0.0062 * sel * pulse) / Math.max(0.5, S[S_SIZE]);
      outlineMat.uniforms.uColor.value.copy(HOVER_COLOR).lerp(SELECT_COLOR, sel);
    }
    const halo = 0.2 * hov + (0.45 + 0.12 * Math.sin(t * 4)) * sel + 0.14 * level * (1 - mute);
    glow.visible = halo > 0.01;
    if (glow.visible) {
      glowMat.uniforms.uIntensity.value = halo;
      glowMat.uniforms.uColor.value.copy(eyeColor).lerp(HOVER_COLOR, hov * (1 - sel) * 0.6).lerp(SELECT_COLOR, sel * 0.75);
    }
  }

  /** The card where its move (cardShift) puts it: under the shell, facing the viewer (or as it last faced). */
  function placePanel(viewer = null) {
    // hangs right under the shell, in front of the hover unit (a smaller card from the same top edge)
    const cs = cardStyle.scale;
    panel.object.scale.setScalar(cs);
    panel.object.position.set(0, head.captionTop * S[S_SCALE] - (cs * PANEL_H) / 2 + cardShift.y, 0.055 * S[S_SCALE]);
    let yaw = panel.object.rotation.y;
    if (viewer) {
      tmpV.copy(viewer);
      group.worldToLocal(tmpV);
      yaw = Math.atan2(tmpV.x, tmpV.z - 0.02);
      panel.object.rotation.set(0, yaw, 0);
    }
    // sideways along the card as it faces the viewer
    panel.object.position.x += Math.cos(yaw) * cardShift.x;
    panel.object.position.z -= Math.sin(yaw) * cardShift.x;
  }

  /** Lyrics: under the head, level, facing the viewer; fades out after a quiet spell. */
  function stepPanel(viewer) {
    const t = S[S_TIME];
    const showPanel = !!lyrics && panel.hasLine && t - S[S_LAST_ACTIVE] < cardStyle.hide;
    S[S_PANEL] = approach(S[S_PANEL], showPanel ? 1 - 0.55 * S[S_MUTE] : 0, showPanel ? 9 : 2.5, S[S_DT]);
    // a merged card goes quickly (it would cover the other), comes back gently
    cardShown = approach(cardShown, cardMerged ? 0 : 1, cardMerged ? 14 : 5, S[S_DT]);
    panel.setOpacity(S[S_PANEL] * cardStyle.opacity * cardShown);
    panel.update(S[S_DT], t * 1000);
    if (panel.mesh.visible) {
      // the layout's move (eased; a card still fading in jumps straight there: it never slides across another)
      const k = S[S_PANEL] * cardShown < 0.4 ? 1 : 1 - Math.exp(-CARD_SHIFT_RATE * S[S_DT]);
      cardShift.x += (cardShift.gx - cardShift.x) * k;
      cardShift.y += (cardShift.gy - cardShift.y) * k;
      placePanel(viewer);
    } else if (S[S_PANEL] <= 0.01) {
      cardShift.x = cardShift.y = cardShift.gx = cardShift.gy = 0;
      cardMerged = false;
      cardShown = 1;
    }
  }

  /** Particles: emitted while singing, at the head's centre (field space = the group's parent). */
  function stepParticles() {
    const p = floatNode.position;
    const facing = S[S_YAW] + (ownField ? 0 : group.rotation.y);
    emitter.setFacing(Math.sin(facing), Math.cos(facing));
    if (ownField) emitter.setPosition(p.x, p.y, p.z);
    else {
      tmpV.copy(p).applyQuaternion(group.quaternion).add(group.position);
      emitter.setPosition(tmpV.x, tmpV.y, tmpV.z);
    }
    emitter.setLevel(muted || S[S_LEVEL] < 0.03 ? 0 : Math.min(1, S[S_LEVEL] * 1.4));
    if (ownField) {
      SHARED_UNIFORMS.uTime.value = S[S_TIME];
      field.update(S[S_DT], S[S_TIME]);
    }
  }

  function update(dt, t, viewer) {
    S[S_DT] = Math.min(Math.max(dt || 0, 0), 0.1);
    S[S_TIME] = t;
    if (firstUpdate) {
      group.updateWorldMatrix(true, false);
      firstUpdate = false;
    }
    if (ownField) pumpHeadBuilds(8);
    if (pendingKey) {
      const h = tryAcquireHead(pendingAppearance);
      if (h) {
        pendingKey = '';
        pendingAppearance = null;
        useHead(h);
        S[S_POP] = 0;
      }
    }
    if (!head) return;
    stepLife();
    stepFloat();
    stepNudge();
    stepGaze(viewer);
    poseBones();
    stepShader();
    stepPanel(viewer);
    stepParticles();
  }

  setAppearance(appearance);
  configureParticles();

  return {
    index,
    group,
    hitTarget,
    mesh,
    getVoiceWorldPosition,
    getTopWorldPosition,
    setAppearance,
    setParticles,
    setPersonality,
    react,
    playAct,
    setLyrics,
    setLyricProgress,
    keepLyrics,
    setCardStyle,
    setCardShift,
    /**
     * The lyric card as drawn (the stage's card layout and the camera's framing read it): its size (head-group units,
     * its style's scale applied), the style's scale, its opacity now (0: down), the layout's move (x, y), its words
     * (text) and whether the layout merged it into another card of the same words (merged; faded out, not drawn).
     */
    get card() {
      const size = panel.cardSize;
      return { w: size.w * cardStyle.scale, h: size.h * cardStyle.scale, scale: cardStyle.scale, opacity: S[S_PANEL], x: cardShift.x, y: cardShift.y,
        text: lyrics?.text ?? '', merged: cardMerged, shown: cardShown };
    },
    setSinging,
    setSelected,
    setHovered,
    setMuted,
    setNeighbors,
    glanceTo,
    setSocialOffset,
    nudge,
    update,
    get appearance() {
      return appearance;
    },
    get particles() {
      return particles;
    },
    get personality() {
      return personality;
    },
    get level() {
      return S[S_LEVEL];
    },
    get progress() {
      return progress;
    },
    get selected() {
      return selected;
    },
    get reaction() {
      return activeReaction(expr);
    },
    /** The face act playing ('' when none): an idle fidget or one played on cue (playAct). */
    get act() {
      return activeAct(expr);
    },
    /** The point the head is glancing at now (parent space), or null. */
    get glance() {
      return glanceAt && S[S_TIME] < glanceAt.until ? glanceAt.point : null;
    },
    /** The neighbour heads its idle glances visit (setNeighbors). */
    get neighbors() {
      return neighbors;
    },
    /** How far a play has moved the head off its place (parent space; zero at its place). */
    get socialOffset() {
      return social;
    },
    /** The lean a play gave the head (radians toward a horizontal direction, group space). */
    get lean() {
      return lean;
    },
    /** The nudge wobble's offset of the floating head now (group space; zero at rest). */
    get nudgeOffset() {
      return nudgeX;
    },
    /** Current expression channel values (read-only view, for previews and tests). */
    get expression() {
      return ch;
    },
    /** Upper-lid closure 0..1 as drawn (blinks included), [left, right]. */
    get eyelids() {
      return eyelids;
    },
    get mech() {
      return head;
    },
    // --- hand-play face hooks (A1) ---
    /** A hand play's face: fn(targets) adds its channel offsets to the expression's targets each frame (null: none). */
    setPlayFace(fn) {
      playFace = typeof fn === 'function' ? fn : null;
    },
    /** The antenna swings as if the head were pushed at (x, y, z) m/s in its frame (x its +x side): a one-shot. */
    flickAntenna(x, y, z) {
      antZ.v += 8 * x;
      antX.v += 8 * (0.5 * y - z);
    },
  };
}
