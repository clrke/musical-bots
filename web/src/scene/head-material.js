// Materials of the mechanical heads. ONE shader program draws every head (per-head colours,
// finish, bones and expression values are uniforms, so a new look never compiles a shader):
//  - rigid skinning: each vertex follows one or two of 32 bones (3 vec4 rows per bone)
//  - per-vertex material id: paint (faceColor x finish, with panel seams), accent, steel,
//    chrome, rubber, brass, glowing LEDs, cheek lamps, the mouth cavity, the eye glass and the
//    iris-diaphragm mouth
//  - image-based lighting from one shared PMREM studio environment (studio-env.js) plus a key
//    light, GGX specular, clear coat for paint and enamel, baked ambient occlusion
//  - on a set (environments/stage.js): the set's reflection map, the mood's key colour and
//    exposure, and up to MAX_LOCAL local lamps (follow spot, party lamps, the set's practicals)
//  - the eyes' iris apertures (blades that open and close) are drawn behind the glass with
//    parallax, so they sit inside the eyeball
import * as THREE from 'three';
import { EYE_CAP, IRIS_DEPTH } from './mech/eyes.js';
import { BONE_COUNT, UV_SCALE } from './mech/builder.js';
import { envDefines, peekStudioEnvironment } from './studio-env.js';

/** Local lamps the head shader takes (the follow spot, three party lamps, the set's practicals). */
export const MAX_LOCAL = 8;
/** The studio's key light radiance on the heads (linear rgb); a set's mood scales and tints it. */
export const STUDIO_KEY = Object.freeze([1.25, 1.2, 1.12]);

const K_SPHERE = 1 / Math.sin(EYE_CAP); // eyeball radius / iris radius
const W_IRIS = (Math.cos(EYE_CAP) - IRIS_DEPTH) / Math.sin(EYE_CAP); // iris plane (iris radii)

const vertexShader = /* glsl */ `
#define NB ${BONE_COUNT}
uniform vec4 uBones[NB * 3];
attribute vec4 aSkin;
attribute vec4 aMat;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec4 vMat;
varying float vAo;
varying float vBone;
varying vec3 vEyeView;

mat4 boneMatrix(float fi) {
  int i = int(fi + 0.5) * 3;
  vec4 a = uBones[i];
  vec4 b = uBones[i + 1];
  vec4 c = uBones[i + 2];
  return mat4(a.x, b.x, c.x, 0.0, a.y, b.y, c.y, 0.0, a.z, b.z, c.z, 0.0, a.w, b.w, c.w, 1.0);
}

void main() {
  // aSkin: bone A, bone B, weight x 255, AO x 255 (bytes); aMat: id, uv x UV_SCALE, extra (shorts)
  mat4 B = boneMatrix(aSkin.x);
  float w = aSkin.z * (1.0 / 255.0);
  if (w > 0.001) B = B * (1.0 - w) + boneMatrix(aSkin.y) * w;
  vec4 lp = B * vec4(position, 1.0);
  vec3 ln = mat3(B) * normal;
  vec4 wp = modelMatrix * lp;
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * ln);
  vLocal = position;
  vMat = vec4(aMat.x, aMat.yz * ${(1 / UV_SCALE).toExponential(8)}, aMat.w);
  vAo = aSkin.w * (1.0 / 255.0);
  vBone = aSkin.x;
  vEyeView = vec3(0.0);
  if (abs(aMat.x - 5.0) < 0.5) vEyeView = transpose(mat3(modelMatrix) * mat3(B)) * (cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
#define PI 3.141592653589793
#define K_SPHERE ${K_SPHERE.toFixed(6)}
#define W_IRIS ${W_IRIS.toFixed(6)}
#define MAX_LOCAL ${MAX_LOCAL}
uniform sampler2D uEnvMap;
uniform mat3 uEnvRot;
uniform vec3 uPaint;
uniform vec3 uAccent;
uniform vec3 uEye;
uniform vec4 uFinish;      // metalness, roughness, clear coat, brushed
uniform vec4 uSeams[8];    // 4 seams: plane (xyz, d), gate (xyz, d)
uniform vec4 uPanel;       // face panel seam: half width, half height, corner radius, centre y
uniform vec4 uPanel2;      // centre x, front gate z, on (0/1), -
uniform vec4 uIris;        // blades, LED ring width, style, -
uniform vec4 uPupil;       // aperture radius L, R (iris radii), blade twist L, R
uniform vec4 uGlow;        // iris glow L, R, LED glow, voice (singing level)
uniform vec4 uMouthIris;   // opening (0..1 of the disc), twist, aspect, -
uniform vec4 uEyePos[2];   // eye centres (head space, rest) for the socket glow
uniform vec4 uCheek;       // face centre x, cheek offset x, cheek y, blush radius
uniform vec4 uState;       // blush, dim, desaturate (muted), rim (hover / select)
uniform vec3 uRimColor;
uniform float uTime;
// the set's light (stage.js feeds these; the studio keeps the defaults): key radiance, exposure,
// and up to MAX_LOCAL local lamps (the follow spot, the party lamps, the set's practicals)
uniform vec3 uKeyC;
uniform vec3 uAmb;         // the mood's level and cast on the reflections (studio: 1)
uniform float uExposure;
uniform float uLocalN;
uniform vec4 uLocalPos[MAX_LOCAL]; // world position, lamp radius (widens the highlight)
uniform vec4 uLocalCol[MAX_LOCAL]; // radiant intensity (linear rgb x candela), cos inner cone
uniform vec4 uLocalDir[MAX_LOCAL]; // spot axis (0 for a point lamp), cos outer cone
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec4 vMat;
varying float vAo;
varying float vBone;
varying vec3 vEyeView;

#include <cube_uv_reflection_fragment>

vec3 envAt(vec3 dir, float rough) {
#ifdef USE_ENV
  return textureCubeUV(uEnvMap, dir, rough).rgb * uAmb;
#else
  vec3 d = dir;
  vec3 c = d.y < 0.0 ? mix(vec3(0.16, 0.155, 0.15), vec3(0.03), smoothstep(0.0, 0.35, -d.y)) : mix(vec3(0.3, 0.29, 0.28), vec3(0.62, 0.66, 0.72), smoothstep(0.05, 0.85, d.y));
  float k = mix(160.0, 3.0, rough);
  c += vec3(6.0) * pow(max(dot(d, normalize(vec3(0.45, 0.62, 0.65))), 0.0), k) * (1.0 - 0.85 * rough);
  return c;
#endif
}

vec2 dfgApprox(float NoV, float r) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 q = r * c0 + c1;
  float a004 = min(q.x * q.x, exp2(-9.28 * NoV)) * q.x + q.y;
  return vec2(-1.04, 1.04) * a004 + q.zw;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// a thin line along d = 0 (fw = its screen-space derivative), faded out below a pixel
float seamLine(float d, float w, float fw) {
  fw = max(fw, 1e-6);
  float l = 1.0 - smoothstep(w, w + fw * 1.2, abs(d));
  return l * clamp(w / fw * 1.6, 0.0, 1.0);
}

float hash1(float n) { return fract(sin(n) * 43758.5453123); }

vec3 neutralTone(vec3 c) {
  const float start = 0.76;
  const float desat = 0.15;
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < start) return c;
  float d = 1.0 - start;
  float np = 1.0 - d * d / (peak + d - start);
  c *= np / peak;
  float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}

// A camera diaphragm seen from the front: q in iris radii (1 = the LED ring's outer edge),
// px = the size of a pixel in those units.
vec3 aperture(vec2 q, float open, float twist, float blades, vec3 tint, float glow, float px, out float pupilMask) {
  float r = length(q);
  float a = atan(q.y, q.x) + twist;
  float sector = 2.0 * PI / blades;
  float f = fract(a / sector);
  float fa = (f - 0.5) * sector;
  float poly = open * cos(0.5 * sector) / cos(fa);
  float edgeR = mix(poly, open * 0.97, 0.35);
  float aa = max(px, 1e-4) * 1.3;
  float inPupil = 1.0 - smoothstep(edgeR - aa, edgeR + aa, r);
  // overlapping blades: a spiral coordinate across each blade, a dark seam at each blade edge
  float sp = fract((a - (r - open) * 1.9) / sector);
  float seam = smoothstep(0.0, 0.05 + aa * 2.0, sp) * smoothstep(1.0, 0.9, sp);
  float shade = 0.28 + 0.72 * sp;
  vec3 blade = mix(vec3(0.05, 0.055, 0.06), tint * 0.42, 0.55) * shade * (0.45 + 0.55 * seam);
  blade += tint * 0.06 * glow;
  // the opening: deep and dark, a faint hot core, a bright rim where light spills past the blades
  vec3 hole = tint * (0.02 + 0.35 * glow * exp(-r * r / max(open * open * 0.18, 1e-4)));
  float rim = exp(-abs(r - edgeR) / max(0.025, aa)) * (1.0 - inPupil * 0.4);
  vec3 col = mix(blade, hole, inPupil) + tint * rim * 0.55 * glow;
  pupilMask = inPupil;
  return col;
}

void main() {
  float id = floor(vMat.x + 0.5);
  // derivatives up front (uniform control flow)
  vec3 fwL = fwidth(vLocal);
  float pxUv = length(fwidth(vMat.yz));
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndv = dot(N, V);
  if (ndv < 0.02) N = normalize(N + V * (0.02 - ndv));
  vec3 n = uEnvRot * N;
  vec3 v = uEnvRot * V;
  float NoV = clamp(dot(n, v), 1e-3, 1.0);
  vec3 L = normalize(vec3(0.45, 0.62, 0.65));
  vec3 keyC = uKeyC;
  float ao = vAo;

  vec3 albedo = vec3(0.5);
  float metal = 0.0;
  float rough = 0.5;
  float coat = 0.0;
  vec3 emit = vec3(0.0);
  vec3 direct = vec3(0.0); // colour that bypasses lighting (glass, cavity)
  bool lit = true;

  if (id < 0.5 || abs(id - 11.0) < 0.5) {
    // ---- paint (shell) and lids
    albedo = uPaint;
    metal = uFinish.x;
    rough = uFinish.y;
    coat = uFinish.z;
    if (uFinish.w > 0.0) {
      // brushed metal: fine grain around the head
      float g = hash1(floor(vLocal.y * 2200.0 + sin(vLocal.x * 31.0 + vLocal.z * 17.0) * 3.0));
      albedo *= 1.0 + (g - 0.5) * 0.16 * uFinish.w;
      rough = clamp(rough + (g - 0.5) * 0.12 * uFinish.w, 0.04, 1.0);
    }
    if (id < 0.5) {
      float seam = 0.0;
      for (int i = 0; i < 4; i++) {
        vec4 s = uSeams[i * 2];
        vec4 g = uSeams[i * 2 + 1];
        if (dot(vLocal, g.xyz) > g.w) seam = max(seam, seamLine(dot(vLocal, s.xyz) - s.w, 0.0006, dot(abs(s.xyz), fwL)));
      }
      if (uPanel2.z > 0.5 && vLocal.z > uPanel2.y) {
        float dp = sdRoundBox(vLocal.xy - vec2(uPanel2.x, uPanel.w), uPanel.xy, uPanel.z);
        seam = max(seam, seamLine(dp, 0.0006, length(fwL.xy)));
      }
      albedo *= 1.0 - 0.72 * seam;
      rough = mix(rough, 0.85, seam);
      coat *= 1.0 - seam;
      ao *= 1.0 - 0.35 * seam;
      // blush: the painted cheeks warm up around the cheek lamps
      if (uState.x > 0.001 && vLocal.z > 0.0) {
        vec2 cq = vec2(abs(vLocal.x - uCheek.x) - uCheek.y, vLocal.y - uCheek.z);
        float cb = max(0.0, 1.0 - dot(cq, cq) / (uCheek.w * uCheek.w));
        cb *= cb * uState.x;
        albedo = mix(albedo, vec3(0.95, 0.28, 0.42), cb * 0.55);
        emit += vec3(1.0, 0.2, 0.38) * cb * 0.55;
      }
    } else {
      rough = max(rough, 0.18);
    }
  } else if (abs(id - 1.0) < 0.5) {
    albedo = uAccent;
    metal = 0.35;
    rough = 0.28;
    coat = 0.55;
  } else if (abs(id - 2.0) < 0.5) {
    albedo = vec3(0.2, 0.205, 0.215);
    metal = 1.0;
    rough = 0.36;
  } else if (abs(id - 3.0) < 0.5) {
    albedo = vec3(0.93, 0.94, 0.96);
    metal = 1.0;
    rough = 0.08;
  } else if (abs(id - 4.0) < 0.5) {
    albedo = vec3(0.028, 0.028, 0.03);
    rough = 0.6;
  } else if (abs(id - 9.0) < 0.5) {
    albedo = vec3(0.95, 0.73, 0.38);
    metal = 1.0;
    rough = 0.22;
  } else if (abs(id - 6.0) < 0.5) {
    // ---- glowing LEDs (eye colour)
    albedo = vec3(0.04);
    rough = 0.15;
    float fres = pow(1.0 - NoV, 2.0);
    emit = uEye * (1.4 + 1.6 * uGlow.z) + vec3(0.35) * (1.0 - fres) * uGlow.z;
  } else if (abs(id - 8.0) < 0.5) {
    // ---- cheek lamps: dark ruby glass that glows pink when blushing
    albedo = vec3(0.09, 0.02, 0.035);
    rough = 0.12;
    float r = length(vMat.yz);
    vec3 pink = vec3(1.0, 0.24, 0.42);
    emit = pink * uState.x * (2.2 - 1.2 * r) + vec3(1.0, 0.7, 0.75) * uState.x * uState.x * exp(-r * r * 4.0);
  } else if (abs(id - 7.0) < 0.5) {
    // ---- mouth cavity: dark throat, lit by the voice
    lit = false;
    float u = vMat.y;
    float w = vMat.z;
    float edge = smoothstep(0.0, 0.3, w) * smoothstep(1.0, 0.7, w) * (1.0 - u * u * 0.6);
    vec3 base = vec3(0.012, 0.008, 0.01) + vec3(0.03, 0.015, 0.02) * edge;
    float glow = uGlow.w * exp(-u * u * 2.2) * edge;
    // speaker dots at the back of the throat
    vec2 g = vec2(u * 9.0, w * 3.0);
    float dots = smoothstep(0.32, 0.18, length(fract(g) - 0.5));
    direct = base + uEye * glow * (0.55 + 0.45 * dots) * 1.6;
  } else if (abs(id - 10.0) < 0.5) {
    // ---- iris-diaphragm mouth: blades over a glowing throat
    lit = false;
    vec2 q = vMat.yz;
    q.x /= max(uMouthIris.z, 0.3);
    float m;
    vec3 c = aperture(q, uMouthIris.x * 0.98, uMouthIris.y, 8.0, mix(uAccent, vec3(0.7), 0.25) * 1.6, 0.6 + 1.4 * uGlow.w, pxUv, m);
    // blades are metal: add a bit of the environment
    vec3 R = reflect(-v, n);
    c += envAt(R, 0.3) * 0.06 * (1.0 - m);
    c += uEye * uGlow.w * m * 0.9 * exp(-dot(q, q) * 2.0);
    direct = c * ao;
  } else if (abs(id - 5.0) < 0.5) {
    // ---- eye: iris aperture behind a glass lens, seen with parallax
    lit = false;
    float side = step(2.5, vBone);
    float open = mix(uPupil.x, uPupil.y, side);
    float twist = mix(uPupil.z, uPupil.w, side);
    float glow = mix(uGlow.x, uGlow.y, side);
    vec2 uv = vMat.yz;
    vec3 p = vec3(uv, sqrt(max(K_SPHERE * K_SPHERE - dot(uv, uv), 0.0)));
    vec3 d = normalize(-vEyeView);
    d = refract(d, normalize(p), 0.8);
    float t = (W_IRIS - p.z) / min(d.z, -0.05);
    vec2 q = p.xy + d.xy * t;
    float rq = length(q);
    float ringW = uIris.y;
    float m;
    // iris: the blades fill r < 1 - ringW, the LED ring sits outside them
    vec3 c = aperture(q / (1.0 - ringW), open, twist, uIris.x, uEye, glow, pxUv / (1.0 - ringW), m);
    float aa = max(pxUv, 1e-4) * 1.5;
    float ring = smoothstep(1.0 - ringW + aa * 0.5, 1.0 - ringW + aa * 2.0, rq) * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, rq));
    float ang = atan(q.y, q.x);
    float ticks = 0.75 + 0.25 * smoothstep(0.2, 0.0, abs(fract(ang * 18.0 / (2.0 * PI)) - 0.5) - 0.3);
    vec3 ringCol = uEye * (1.25 + 1.1 * glow) * ticks;
    if (uIris.z > 4.5) ringCol *= 0.8 + 0.4 * smoothstep(0.3, 0.0, abs(fract(q.y * 3.0 - uTime * 0.7) - 0.5)); // visor scan
    c = mix(c, ringCol, ring);
    // beyond the iris: the dark inner wall of the lens barrel, lit by the ring
    float wall = smoothstep(1.0, 1.0 + aa * 2.0, rq);
    c = mix(c, uEye * 0.12 * glow + vec3(0.015), wall);
    if (uIris.z > 2.5 && uIris.z < 3.5) {
      // telescope: a faint reticle on the glass
      float cross = max(seamLine(p.x, 0.012, pxUv), seamLine(p.y, 0.012, pxUv)) * step(length(p.xy), 0.85) * step(0.18, length(p.xy));
      c += uEye * cross * 0.35;
    }
    // glass: environment reflection and a sharp key-light glint
    vec3 R = reflect(-v, n);
    float F = 0.06 + 0.94 * pow(1.0 - NoV, 5.0);
    vec3 refl = envAt(R, 0.04) * F;
    vec3 H = normalize(L + v);
    float glint = pow(max(dot(n, H), 0.0), 900.0) * 6.0;
    direct = c * (1.0 - F * 0.6) + refl + keyC * glint;
    direct *= mix(1.0, ao, 0.5);
  }

  vec3 col;
  if (lit) {
    vec3 F0 = mix(vec3(0.04), albedo, metal);
    vec3 diffC = albedo * (1.0 - metal);
    float r = clamp(rough, 0.04, 1.0);
    vec3 R = reflect(-v, n);
    vec3 Rr = normalize(mix(R, n, r * r));
    vec2 ab = dfgApprox(NoV, r);
    vec3 spec = envAt(Rr, r) * (F0 * ab.x + ab.y);
    vec3 irr = envAt(n, 1.0);
    vec3 diff = diffC * irr;
    // key light
    float NoL = max(dot(n, L), 0.0);
    vec3 H = normalize(L + v);
    float NoH = max(dot(n, H), 0.0);
    float VoH = max(dot(v, H), 0.0);
    float a = r * r;
    float a2 = a * a;
    float dd = NoH * NoH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float k = a * 0.5 + 0.0001;
    float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
    vec3 Fk = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
    vec3 specK = min(D * G / max(4.0 * NoL * NoV, 1e-3), 40.0) * Fk * NoL * keyC;
    diff += diffC * NoL * keyC * 0.55;
    col = (diff + spec * mix(1.0, ao, 0.6)) * ao + specK * ao;
    if (coat > 0.0) {
      float Fc = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
      vec3 coatSpec = envAt(R, 0.05) * Fc * coat;
      float cd = NoH * NoH * (0.0025 * 0.0025 - 1.0) + 1.0;
      coatSpec += keyC * min(0.0025 * 0.0025 / (PI * cd * cd) * 0.25, 30.0) * Fc * NoL * coat;
      col = col * (1.0 - Fc * coat) + coatSpec * ao;
    }
    // local lamps: inverse-square, a spot's cone; the lamp's size widens the highlight (Karis)
    for (int i = 0; i < MAX_LOCAL; i++) {
      if (float(i) >= uLocalN) break;
      vec4 lp = uLocalPos[i];
      vec4 lc = uLocalCol[i];
      vec4 ld = uLocalDir[i];
      vec3 Lw = lp.xyz - vPosW;
      float d2 = max(dot(Lw, Lw), 0.01);
      float dl = sqrt(d2);
      vec3 Ld = Lw / dl;
      float cone = smoothstep(ld.w, lc.w, dot(-Ld, ld.xyz));
      vec3 l = uEnvRot * Ld;
      float NoLl = max(dot(n, l), 0.0);
      if (NoLl * cone <= 0.0) continue;
      vec3 E = lc.rgb * (cone * NoLl / d2);
      vec3 Hl = normalize(l + v);
      float NoHl = max(dot(n, Hl), 0.0);
      float ap = min(1.0, a + lp.w / (2.0 * dl));
      float ap2 = ap * ap;
      float dl2 = NoHl * NoHl * (ap2 - 1.0) + 1.0;
      float Dl = ap2 / (PI * dl2 * dl2); // GGX at the widened roughness: the lamp's disc on chrome
      float kl = ap * 0.5 + 0.0001;
      float Gl = (NoLl / (NoLl * (1.0 - kl) + kl)) * (NoV / (NoV * (1.0 - kl) + kl));
      vec3 Fl = F0 + (1.0 - F0) * pow(1.0 - max(dot(v, Hl), 0.0), 5.0);
      vec3 specL = min(Dl * Gl / max(4.0 * NoLl * NoV, 1e-3), 40.0) * Fl;
      col += (diffC * (1.0 / PI) + specL) * E * ao;
    }
    // eye-colour light spilling out of the sockets
    vec3 e0 = vLocal - uEyePos[0].xyz;
    vec3 e1 = vLocal - uEyePos[1].xyz;
    float spill = uGlow.x * exp(-dot(e0, e0) * 2200.0) + uGlow.y * exp(-dot(e1, e1) * 2200.0);
    col += uEye * spill * 0.18 * (1.0 - 0.6 * metal) * (0.4 + albedo);
    col += emit;
  } else {
    col = direct;
  }

  col = neutralTone(col * uExposure);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l), uState.z) * uState.y;
  col += uRimColor * pow(1.0 - max(dot(N, V), 0.0), 2.2) * uState.w;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Uniforms every head shares (one object each, updated once). */
export const SHARED_UNIFORMS = {
  uEnvMap: { value: null },
  uEnvRot: { value: new THREE.Matrix3() },
  uTime: { value: 0 },
  uKeyC: { value: new THREE.Vector3(...STUDIO_KEY) },
  uAmb: { value: new THREE.Vector3(1, 1, 1) },
  uExposure: { value: 1 },
  uLocalN: { value: 0 },
  uLocalPos: { value: Array.from({ length: MAX_LOCAL }, () => new THREE.Vector4()) },
  uLocalCol: { value: Array.from({ length: MAX_LOCAL }, () => new THREE.Vector4()) },
  uLocalDir: { value: Array.from({ length: MAX_LOCAL }, () => new THREE.Vector4()) },
};

/** Per-head material. The caller owns the uniform values (see robot-head.js). */
export function createHeadMaterial() {
  const env = peekStudioEnvironment();
  if (env) SHARED_UNIFORMS.uEnvMap.value = env.texture;
  const defines = env ? { ...env.defines, USE_ENV: '' } : { ...envDefines() };
  const v4 = () => new THREE.Vector4();
  return new THREE.ShaderMaterial({
    name: 'magna-mech-head',
    vertexShader,
    fragmentShader,
    defines,
    uniforms: {
      ...SHARED_UNIFORMS,
      uBones: { value: new Float32Array(BONE_COUNT * 12) },
      uPaint: { value: new THREE.Color('#e8edf5') },
      uAccent: { value: new THREE.Color('#8a6bff') },
      uEye: { value: new THREE.Color('#4fc3ff') },
      uFinish: { value: new THREE.Vector4(0, 0.4, 0.6, 0) },
      uSeams: { value: Array.from({ length: 8 }, v4) },
      uPanel: { value: v4() },
      uPanel2: { value: v4() },
      uIris: { value: new THREE.Vector4(7, 0.17, 0, 0) },
      uPupil: { value: new THREE.Vector4(0.5, 0.5, 0, 0) },
      uGlow: { value: new THREE.Vector4(1, 1, 0.5, 0) },
      uMouthIris: { value: new THREE.Vector4(0.1, 0, 1, 0) },
      uEyePos: { value: [v4(), v4()] },
      uCheek: { value: new THREE.Vector4(0, 0.075, -0.03, 0.03) },
      uState: { value: new THREE.Vector4(0, 1, 0, 0) },
      uRimColor: { value: new THREE.Color(0, 0, 0) },
    },
  });
}

/** Paint parameters per finish: albedo mix toward a base metal, metalness, roughness, coat, brushed. */
export const FINISH_PARAMS = Object.freeze({
  painted: { base: null, tint: 1, metal: 0.0, rough: 0.42, coat: 0.65, brushed: 0 },
  chrome: { base: [0.96, 0.965, 0.97], tint: 0.38, metal: 1.0, rough: 0.07, coat: 0, brushed: 0 },
  brushed: { base: [0.78, 0.79, 0.8], tint: 0.42, metal: 1.0, rough: 0.3, coat: 0, brushed: 1 },
  gunmetal: { base: [0.22, 0.225, 0.235], tint: 0.32, metal: 0.9, rough: 0.34, coat: 0.15, brushed: 0.35 },
  brass: { base: [0.93, 0.7, 0.36], tint: 0.22, metal: 1.0, rough: 0.2, coat: 0, brushed: 0.25 },
  enamel: { base: null, tint: 1, metal: 0.0, rough: 0.16, coat: 1.0, brushed: 0 },
});

const tmpC = new THREE.Color();

/** Writes the paint colour (linear) and the finish vector for a face colour + finish. */
export function applyFinish(faceColor, finish, outColor, outFinish) {
  const f = FINISH_PARAMS[finish] ?? FINISH_PARAMS.painted;
  outColor.set(faceColor);
  if (f.base) {
    tmpC.setRGB(f.base[0], f.base[1], f.base[2], THREE.LinearSRGBColorSpace);
    outColor.lerp(tmpC, 1 - f.tint);
  }
  outFinish.set(f.metal, f.rough, f.coat, f.brushed);
}

// ------------------------------------------------------------------ outline, halo, hit target

const outlineVertex = /* glsl */ `
uniform float uWidth;
void main() {
  vec3 p = position + normal * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const outlineFragment = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}
`;

/** Inverted-hull outline (back faces of the smooth shell pushed out along its normals). */
export function createOutlineMaterial() {
  return new THREE.ShaderMaterial({
    name: 'magna-head-outline',
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    uniforms: { uWidth: { value: 0.006 }, uColor: { value: new THREE.Color('#ffd166') } },
    side: THREE.BackSide,
  });
}

const glowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv - 0.5;
  // camera-facing quad at the object's origin
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 s = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}
`;

const glowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv) * 2.0;
  float a = exp(-r * r * 4.5) * (1.0 - smoothstep(0.82, 1.0, r));
  gl_FragColor = vec4(uColor * (a * uIntensity), 0.0);
  #include <colorspace_fragment>
}
`;

/** Soft additive halo behind a head (hover, selection, singing). Alpha untouched (passthrough). */
export function createGlowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'magna-head-glow',
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uIntensity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

let hitMaterial = null;
/** Never drawn, still hit by raycasts (Raycaster ignores material.visible). */
export function getHitMaterial() {
  if (!hitMaterial) hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  return hitMaterial;
}

let glowQuad = null;
export function getGlowQuad() {
  if (!glowQuad) glowQuad = new THREE.PlaneGeometry(1, 1);
  return glowQuad;
}

let hitSphere = null;
export function getHitSphere() {
  if (!hitSphere) hitSphere = new THREE.SphereGeometry(0.15, 12, 8);
  return hitSphere;
}
