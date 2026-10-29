// Frame-exact 1080p capture for Musical Bots (CDP over Node 22's WebSocket, no npm deps).
// node scripts/render/capture.mjs --url http://localhost:4180 --prompt "..." --out /tmp/mb-capture-proto/run
//   [--typing] (open on the prompt being typed and Premiere pressed)
//   [--gl swiftshader|metal|headed] [--fps 30] [--frames N | --seconds S] [--tail 4] [--fmt png|jpeg] [--audio-only]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s+--/).map((s) => s.replace(/^--/, '')).filter(Boolean)
  .map((s) => { const i = s.indexOf(' '); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)]; }));
const URL0 = A.url || 'http://localhost:4199', PROMPT = A.prompt || 'Gigi brings home the biggest toy box on the street';
const OUT = A.out || '/tmp/mb-render/run', FPS = +(A.fps || 30), W = +(A.w || 1920), H = +(A.h || 1080);
const GL = A.gl || 'metal', FMT = A.fmt || 'png', TAIL = +(A.tail || 3);
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
  const MAXSEC = ${+(A['max-seconds'] || 320)}, SR = 48000;
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
      const b = new Uint8Array(f.buffer); let bin = '';
      for (let k = 0; k < b.length; k += 0x8000) bin += String.fromCharCode(...b.subarray(k, k + 0x8000));
      return btoa(bin);
    },
  };
})();` });
const t0 = Date.now();
await cdp('Page.navigate', { url: `${URL0}/?cinema=1&prompt=${encodeURIComponent(PROMPT)}${A.env ? '&env=' + A.env : ''}${A.typing ? '&typing=1' : ''}` });
// wait for the app to register its animation loop (after env GLB top-level await)
for (let i = 0; ; i++) {
  if (await evalJs(`!!(window.__mbReady && window.__player && window.__cap && window.__cap.pendingRaf > 0)`).catch(() => false)) break;
  if (i > 600) throw new Error('app never started'); await sleep(100);
}
const info = await evalJs(`(() => { document.body.classList.add('premiere'); const gl = document.querySelector('canvas').getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info'); return { duration: Math.max(__player.duration, window.__mbEnd || 0), events: __player.events.length,
  renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), song: window.__mbSong || null }; })()`);
console.log(`loaded in ${(Date.now() - t0) / 1000}s`, { ...info, song: info.song ? `${info.song.lines.length} lines` : null }, 'load avg', os.loadavg().map((x) => x.toFixed(1)).join(' '));


// ---- frames: step exactly 1/FPS, render, screenshot
let total = A.frames ? +A.frames : Math.ceil((info.duration + TAIL) * FPS);
writeFileSync(OUT + '/meta.json', JSON.stringify({ prompt: PROMPT, fps: FPS, w: W, h: H, frames: total, gl: GL, ...info }, null, 1));
const tf = Date.now(); let tShot = 0, tStep = 0;
for (let f = 0; f < total; f++) {
  const a = Date.now();
  await evalJs(`__cap.step(${1000 / FPS})`);
  const b = Date.now();
  const { data } = await cdp('Page.captureScreenshot', { format: FMT, ...(FMT === 'jpeg' ? { quality: 95 } : {}), optimizeForSpeed: true });
  writeFileSync(`${OUT}/frames/f${String(f).padStart(6, '0')}.${FMT === 'jpeg' ? 'jpg' : FMT}`, Buffer.from(data, 'base64'));
  tStep += b - a; tShot += Date.now() - b;
  if (!A.frames && f % 30 === 29) { // a typed opening settles its real length while it plays
    const end = await evalJs(`window.__mbEnd || 0`);
    total = Math.max(total, Math.ceil((end + TAIL) * FPS));
  }
  if (f % 30 === 29 || f === total - 1) console.log(`frame ${f + 1}/${total}  ${((Date.now() - tf) / (f + 1) / 1000).toFixed(3)} s/frame (step ${(tStep / (f + 1)).toFixed(0)}ms, shot ${(tShot / (f + 1)).toFixed(0)}ms)  load ${os.loadavg()[0].toFixed(1)}`);
}
info.song = await evalJs(`window.__mbSong || null`);
writeFileSync(OUT + '/meta.json', JSON.stringify({ prompt: PROMPT, fps: FPS, w: W, h: H, frames: total, gl: GL, ...info }, null, 1));
console.log(`done: ${total} frames in ${(Date.now() - tf) / 1000}s`);
const ta = Date.now();
const b64 = await evalJs(`__cap.renderAudio(${total / FPS})`);
if (b64) { writeFileSync(OUT + '/audio.f32', Buffer.from(b64, 'base64')); console.log(`audio.f32 (48k stereo f32le) rendered in ${(Date.now() - ta) / 1000}s`); }
else console.log('no AudioContext was created');
process.exit(0);
