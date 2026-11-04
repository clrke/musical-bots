// Frame-exact 1080p capture for Musical Bots (CDP over Node 22's WebSocket, no npm deps).
// node scripts/render/capture.mjs --url http://localhost:4180 --prompt "..." --out /tmp/mb-capture-proto/run
//   [--typing] (open on the prompt being typed and Premiere pressed)
//   [--gl swiftshader|metal|headed] [--fps 30] [--frames N | --seconds S] [--tail 4] [--fmt png|jpeg] [--audio-only]
//   [--makingof] (a curated prompt's recorded making-of, sung, as long as its production: meta.json makingOf is its timeline)
//   [--skip S] (start recording S seconds in) [--max-seconds S] (the audio rendered: 320, a making-of 1200)
//   [--look classic] (the heads' classic look; default: the friendly look B)
//   [--seed S] (the making-of's filler facts, drawn at random per playback, drawn with seed S: default 1, so a capture
//   is the same every time; meta.json keeps it)
//   [--skip-fps F] (the skip stepped at F fps: 10 is ~3x faster, the app's dt cap is 0.1 s; the shots near the skip's end
//   may differ a little from a full-rate run) [--probe N] (every N frames, the shot as framed: main.js __mbShotInfo, to
//   probe.json; QA probes of a window: --skip S --frames N --probe 15 --no-audio)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s+--/).map((s) => s.replace(/^--/, '')).filter(Boolean)
  .map((s) => { const i = s.indexOf(' '); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)]; }));
// --url: the site root, with or without a base path or trailing slash (http://host/musical-bots/)
const URL0 = String(A.url || 'http://localhost:4199').replace(/\/+$/, ''), PROMPT = A.prompt || 'Blue brings home the biggest toy box on the street';
const OUT = A.out || '/tmp/mb-render/run', FPS = +(A.fps || 30), W = +(A.w || 1920), H = +(A.h || 1080);
const SEED = A.seed === undefined || A.seed === true ? '1' : String(A.seed); // (the making-of's fillers: making-of.js playbackSeed)
const GL = A.gl || 'metal', FMT = A.fmt || 'png', TAIL = +(A.tail || 3);
// the offline audio's length (s): anything scheduled past it is silently lost, so the capture refuses to run short
const MAXSEC = +(A['max-seconds'] || (A.makingof ? 1200 : 320));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT + '/frames', { recursive: true });

// ---- launch our own Chrome (killed on exit; never touches other Chromes)
const prof = `${os.tmpdir()}/mb-capture-profile-${process.pid}`;
const glFlags = {
  swiftshader: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  metal: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  headed: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-position=0,0`],
}[GL];
// Native arm64 on Apple silicon: a Chrome started from some shells runs its x86_64 slice under Rosetta,
// where the page stalls for ~2 minutes before the app starts (and the GPU path is slow).
const native = process.platform === 'darwin' && os.arch() === 'arm64' ? ['/usr/bin/arch', ['-arm64', CHROME]] : [CHROME, []];
const chrome = spawn(native[0], [...native[1], ...glFlags, `--user-data-dir=${prof}`, '--remote-debugging-port=0', `--window-size=${W},${H}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup); process.on('SIGINT', () => process.exit(130));
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = readFileSync(prof + '/DevToolsActivePort', 'utf8').split('\n')[0]; } catch {} }
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const waiters = new Map(); const evWaiters = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && waiters.has(d.id)) { const { res, rej } = waiters.get(d.id); waiters.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
  else if (d.method === 'Runtime.consoleAPICalled' && A.verbose) console.log('[page]', d.params.args.map((a) => a.value).join(' '));
  else if (d.method === 'Runtime.exceptionThrown') console.log('[page exc]', d.params.exceptionDetails.exception?.description);
  for (const w of evWaiters.splice(0)) if (!w(d)) evWaiters.push(w); };
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// Virtual clock: performance.now, rAF, setTimeout/setInterval and AudioContext.currentTime all advance
// only when the driver calls __cap.step(). AudioContext becomes an OfflineAudioContext rendered at the end.
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  let vt = 0, seq = 0; const raf = [], timers = new Map();
  const MAXSEC = ${MAXSEC}, SR = 48000; // (a making-of lasts as long as its production: hackathon-win ~14 min since Nov 1)
  performance.now = () => vt;
  Date.now = ((d0) => () => d0 + vt)(Date.now());
  window.requestAnimationFrame = (cb) => (raf.push(cb), raf.length);
  window.cancelAnimationFrame = () => {};
  const add = (fn, ms, rep, args) => { const id = ++seq; timers.set(id, { fn, at: vt + Math.max(0, +ms || 0), ms: Math.max(1, +ms || 0), rep, args }); return id; };
  window.setTimeout = (fn, ms, ...a) => add(fn, ms, false, a);
  window.setInterval = (fn, ms, ...a) => add(fn, ms, true, a);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  const runTimers = (until) => { for (;;) { let best = null;
      for (const [id, t] of timers) if (t.at <= until && (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0]))) best = [id, t];
      if (!best) return; const [id, t] = best;
      if (t.rep) t.at += t.ms; else timers.delete(id);
      try { typeof t.fn === 'function' ? t.fn(...t.args) : 0; } catch (e) { console.error(e); } } };
  let off = null;
  function CapAudioContext() {
    off = new OfflineAudioContext(2, MAXSEC * SR, SR);
    return new Proxy(off, { get(t, k) {
      if (k === 'currentTime') return vt / 1000;
      if (k === 'state') return 'running';
      if (k === 'resume' || k === 'suspend') return async () => {};
      const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
  }
  window.AudioContext = window.webkitAudioContext = CapAudioContext;
  window.__cap = {
    // render the frame for time vt, then advance; frame f therefore shows transport time f/fps
    step(ms) { runTimers(vt); const cbs = raf.splice(0); for (const cb of cbs) cb(vt); vt += ms; return cbs.length; },
    get pendingRaf() { return raf.length; }, get t() { return vt; }, get hasAudio() { return !!off; },
    async renderAudio(seconds) {
      if (!off) return null;
      const buf = await off.startRendering(), n = Math.min(buf.length, Math.ceil(seconds * SR));
      const L = buf.getChannelData(0), R = buf.getChannelData(1), f = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { f[2 * k] = L[k]; f[2 * k + 1] = R[k]; }
      window.__capF32 = new Uint8Array(f.buffer); // fetched in chunks by the driver (a single string can exceed CDP limits)
      return window.__capF32.length;
    },
    chunk(a, b) {
      const x = window.__capF32.subarray(a, b); let bin = '';
      for (let k = 0; k < x.length; k += 0x8000) bin += String.fromCharCode(...x.subarray(k, k + 0x8000));
      return btoa(bin);
    },
  };
})();` });
const t0 = Date.now();
await cdp('Page.navigate', { url: `${URL0}/?cinema=1&prompt=${encodeURIComponent(PROMPT)}${A.env ? '&env=' + A.env : ''}${A.typing ? '&typing=1' : ''}${A.makingof ? '&makingof=1' : ''}${A.speed ? '&speed=' + A.speed : ''}${A.look ? '&look=' + A.look : ''}&seed=${encodeURIComponent(SEED)}` });
// wait for the app to register its animation loop (after env GLB top-level await)
for (let i = 0; ; i++) {
  if (await evalJs(`!!(window.__mbReady && window.__player && window.__cap && window.__cap.pendingRaf > 0)`).catch(() => false)) break;
  if (i > 600) throw new Error('app never started'); await sleep(100);
}
const info = await evalJs(`(() => { document.body.classList.add(${A.makingof ? "'cinema'" : "'premiere'"}); const gl = document.querySelector('canvas').getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info'); return { duration: Math.max(__player.duration, window.__mbEnd || 0), events: __player.events.length,
  renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), song: window.__mbSong || null, makingOf: window.__mbMakingOf || null }; })()`);
console.log(`loaded in ${(Date.now() - t0) / 1000}s`, { ...info, song: info.song ? `${info.song.lines.length} lines` : null, makingOf: info.makingOf ? `${info.makingOf.items.length} phrases, ${info.makingOf.end} s` : null }, 'load avg', os.loadavg().map((x) => x.toFixed(1)).join(' '));
const SKIP = +(A.skip || 0); // seconds of the show run before recording starts
// the making-of's timeline (window.__mbMakingOf) on the capture's clock: frame f shows t = f / fps (less the skip)
const onCapture = (mo) => (mo ? { ...mo, skip: SKIP, end: +(mo.end - SKIP).toFixed(3),
  items: mo.items.map((i) => ({ ...i, t0: +(i.t0 - SKIP).toFixed(3), t1: +(i.t1 - SKIP).toFixed(3) })).filter((i) => i.t1 > 0) } : null);
info.makingOf = onCapture(info.makingOf);


// ---- --skip S: run S seconds of the show first, unrecorded (e.g. into the middle of a making-of)
const SKIP_FPS = +(A['skip-fps'] || FPS);
for (let f = 0, n = Math.round(+(A.skip || 0) * SKIP_FPS); f < n; f++) await evalJs(`__cap.step(${1000 / SKIP_FPS})`);
const PROBE = +(A.probe || 0), probe = [];
// ---- frames: step exactly 1/FPS, render, screenshot
let total = A.frames ? +A.frames : Math.ceil((info.duration - SKIP + TAIL) * FPS);
writeFileSync(OUT + '/meta.json', JSON.stringify({ prompt: PROMPT, fps: FPS, w: W, h: H, frames: total, gl: GL, seed: SEED, ...info }, null, 1));
const audioCap = () => { if (SKIP + total / FPS > MAXSEC) { console.error(`the audio would be cut: ${(SKIP + total / FPS).toFixed(1)} s > --max-seconds ${MAXSEC}`); process.exit(2); } };
audioCap();
const tf = Date.now(); let tShot = 0, tStep = 0;
for (let f = 0; f < total; f++) {
  const a = Date.now();
  await evalJs(`__cap.step(${1000 / FPS})`);
  const b = Date.now();
  if (!A['audio-only']) {
    const { data } = await cdp('Page.captureScreenshot', { format: FMT, ...(FMT === 'jpeg' ? { quality: 95 } : {}), optimizeForSpeed: true });
    writeFileSync(`${OUT}/frames/f${String(f).padStart(6, '0')}.${FMT === 'jpeg' ? 'jpg' : FMT}`, Buffer.from(data, 'base64'));
  }
  tStep += b - a; tShot += Date.now() - b;
  if (PROBE && f % PROBE === 0) probe.push({ f, t: +(SKIP + f / FPS).toFixed(3), ...(await evalJs(`window.__mbShotInfo?.() ?? null`)) });
  if (!A.frames && f % 30 === 29) { // a typed opening settles its real length while it plays
    const end = await evalJs(`window.__mbEnd || 0`);
    total = Math.max(total, Math.ceil((end - SKIP + TAIL) * FPS));
    audioCap();
  }
  if (f % 30 === 29 || f === total - 1) console.log(`frame ${f + 1}/${total}  ${((Date.now() - tf) / (f + 1) / 1000).toFixed(3)} s/frame (step ${(tStep / (f + 1)).toFixed(0)}ms, shot ${(tShot / (f + 1)).toFixed(0)}ms)  load ${os.loadavg()[0].toFixed(1)}`);
}
if (PROBE) writeFileSync(OUT + '/probe.json', JSON.stringify(probe));
info.song = await evalJs(`window.__mbSong || null`);
if (A.makingof) info.makingOf = onCapture(await evalJs(`window.__mbMakingOf || null`));
writeFileSync(OUT + '/meta.json', JSON.stringify({ prompt: PROMPT, fps: FPS, w: W, h: H, frames: total, gl: GL, seed: SEED, ...info }, null, 1));
console.log(`done: ${total} frames in ${(Date.now() - tf) / 1000}s`);
// the camera's path as rendered (main.js window.__mbCam, a row a frame: pos, look, goal pos, goal look, cut, shot n,
// group angle, song time, shot kind (wide, close, two, group), keepCamera detour, parade, the tallest subject face and
// other face in view (NDC, framing.js MAX_FACE); camera-follow.js pathJitter),
// the frames recorded only (the skipped ones dropped)
const cam = await evalJs(`window.__mbCam || null`);
if (cam) writeFileSync(OUT + '/campath.json', JSON.stringify(cam.slice(-total)));
const ta = Date.now();
// (the audio renders from show time 0: the skipped seconds are dropped so it lines up with frame 0)
const nBytes = A['no-audio'] ? 0 : await evalJs(`__cap.renderAudio(${SKIP + total / FPS})`);
if (nBytes) {
  const parts = [];
  for (let a = 0; a < nBytes; a += 8 << 20) parts.push(Buffer.from(await evalJs(`__cap.chunk(${a}, ${Math.min(nBytes, a + (8 << 20))})`), 'base64'));
  writeFileSync(OUT + '/audio.f32', Buffer.concat(parts).subarray(Math.round(SKIP * 48000) * 8));
  console.log(`audio.f32 (48k stereo f32le) rendered in ${(Date.now() - ta) / 1000}s`);
}
else console.log('no AudioContext was created');
process.exit(0);
