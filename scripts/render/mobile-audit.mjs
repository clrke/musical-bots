// Mobile audit: headless Chrome (GPU, metal) device emulation over CDP (no npm deps): every screen and state of the app on
// an iPhone (portrait, landscape), a small Android, an iPad and a desktop; a JPEG per state and report.json (overflow,
// offscreen elements, text under 12 px, tap targets under 44 px, inputs under 16 px, frame rate and main-thread ms a frame).
//   node scripts/render/mobile-serve.mjs . <dist> 4302                  # the dist + the real API (memory store)
//   node scripts/render/mobile-audit.mjs --url http://127.0.0.1:4302 --out /tmp/mb-mobile/after
//     [--devices iphone,iphone-land,android,ipad,desktop] [--only home,typing,makingof,end,dialog,share,errors,admin]
//     [--throttle 4] (CPU)   A protected Vercel preview: VERCEL_BYPASS=<automation bypass secret> in the environment.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s+--/).map((s) => s.replace(/^--/, '')).filter(Boolean)
  .map((s) => { const i = s.indexOf(' '); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)]; }));
const URL0 = String(A.url || 'http://127.0.0.1:4301').replace(/\/+$/, '');
const OUT = A.out || '/tmp/mb-mobile/before';
const RUN = 'abcdefghijklmnopqrstuvwx';
const HERO = 'Why should Musical Bots win the Meta Global AI Hackathon?';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DEVICES = {
  iphone: { w: 390, h: 844, dpr: 3, mobile: true, ua: IOS_UA },
  'iphone-land': { w: 844, h: 390, dpr: 3, mobile: true, ua: IOS_UA, landscape: true },
  android: { w: 360, h: 800, dpr: 3, mobile: true, ua: ANDROID_UA },
  ipad: { w: 820, h: 1180, dpr: 2, mobile: true, ua: IPAD_UA },
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false, ua: null },
};
const devices = String(A.devices || 'iphone,iphone-land,android,ipad,desktop').split(',');
const only = A.only ? String(A.only).split(',') : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const prof = `${os.tmpdir()}/mb-audit-profile-${process.pid}`;
const chrome = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--mute-audio', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup); process.on('SIGINT', () => process.exit(130));
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = readFileSync(prof + '/DevToolsActivePort', 'utf8').split('\n')[0]; } catch {} }

async function openPage() {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiters = new Map(); const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) { const { res, rej } = waiters.get(d.id); waiters.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' ')); };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  return { cdp, ev, logs, close: async () => { try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } catch {} ws.close(); } };
}

async function emulate(p, d, h = d.h, w = d.w) {
  await p.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d.dpr, mobile: d.mobile,
    screenOrientation: d.mobile ? { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } : undefined });
  await p.cdp('Emulation.setTouchEmulationEnabled', d.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  if (process.env.VERCEL_BYPASS) { await p.cdp('Network.enable'); await p.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } }); }
  if (d.ua) await p.cdp('Emulation.setUserAgentOverride', { userAgent: d.ua, platform: /iPhone|iPad/.test(d.ua) ? 'iPhone' : 'Linux armv8l' });
  await p.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: d.mobile ? 'coarse' : 'fine' }, { name: 'hover', value: d.mobile ? 'none' : 'hover' }] });
}

// layout metrics: overflow, offscreen visible elements, small text, small tap targets
const METRICS = `(() => {
  const W = innerWidth, H = innerHeight, out = { W, H, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, off: [], smallText: [], smallTap: [], inputs: [] };
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const name = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  const all = [...document.querySelectorAll('body *')].filter((el) => !['SCRIPT', 'STYLE', 'CANVAS'].includes(el.tagName) && vis(el));
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1) { if (!el.closest('dialog') || el.tagName === 'DIALOG') out.off.push(name(el) + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',')); }
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (own && fs < 12) out.smallText.push(name(el) + ' ' + fs + 'px');
    if (el.matches('button, a, input, textarea, select, label.rd-mode')) {
      if ((r.height < 44 || r.width < 44) && !el.matches('input[type=radio], input[type=checkbox]')) out.smallTap.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    if (el.matches('input:not([type=radio]):not([type=checkbox]), textarea')) out.inputs.push(name(el) + ' ' + fs + 'px');
  }
  const meta = document.querySelector('meta[name=viewport]')?.content;
  out.viewport = meta;
  const c = document.querySelector('canvas');
  out.canvas = c ? [c.width, c.height, c.clientWidth, c.clientHeight] : null;
  out.dialogOpen = document.getElementById('run-dialog')?.open ?? null;
  const d = document.getElementById('run-dialog');
  if (d?.open) { const r = d.getBoundingClientRect(); out.dialog = [r.left, r.top, r.right, r.bottom].map(Math.round); }
  for (const id of ['making', 'caption', 'play', 'ui', 'status', 'role']) { const el = document.getElementById(id); if (el && vis(el)) { const r = el.getBoundingClientRect(); out[id] = [r.left, r.top, r.right, r.bottom].map(Math.round); } }
  return out;
})()`;

async function fps(p, ms = 4000) {
  await p.cdp('Performance.enable').catch(() => {});
  const m0 = Object.fromEntries((await p.cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const r = await fps0(p, ms);
  const m1 = Object.fromEntries((await p.cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const frames = Math.max(1, Math.round(r.fps * ms / 1000));
  r.taskMsPerFrame = +(((m1.TaskDuration - m0.TaskDuration) * 1000) / frames).toFixed(2);
  r.scriptMsPerFrame = +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames).toFixed(2);
  r.heapMB = +(m1.JSHeapUsedSize / 1048576).toFixed(0);
  return r;
}
async function fps0(p, ms = 4000) {
  return p.ev(`new Promise((ok) => { const ts = []; const f = (t) => { ts.push(t); if (t - ts[0] < ${ms}) requestAnimationFrame(f); else { const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); ok({ fps: +((ts.length - 1) / ((ts.at(-1) - ts[0]) / 1000)).toFixed(1), p50: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1) }); } }; requestAnimationFrame(f); })`);
}

async function tap(p, sel) {
  const r = await p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!r) throw new Error('no ' + sel);
  const [x, y] = r;
  if (cur.mobile) {
    await p.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await p.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await p.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await p.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  await sleep(250);
}
async function type(p, text) { await p.cdp('Input.insertText', { text }); }
async function until(p, expr, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.ev(expr).catch(() => false)) return true; await sleep(300); } return false; }

const report = {};
let cur = null, devName = '';
async function shot(p, name, extra = {}) {
  const dir = `${OUT}/${devName}`;
  mkdirSync(dir, { recursive: true });
  const r = await p.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  writeFileSync(`${dir}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  const m = await p.ev(METRICS);
  (report[devName] ??= {})[name] = { ...m, ...extra, logs: p.logs.splice(0) };
  console.log(devName, name, JSON.stringify({ scroll: [m.scrollW, m.scrollH], off: m.off.length, smallTap: m.smallTap.length, smallText: m.smallText.length }));
}
async function go(p, path, wait = 0) { await p.cdp('Page.navigate', { url: URL0 + path }); await sleep(800); await until(p, 'document.readyState === "complete"', 20000); if (wait) await sleep(wait); }

const SCENES = {
  async home(p) {
    await go(p, '/', 7000);
    await shot(p, 'home', { perf: await fps(p) });
    await tap(p, '#prompt');
    await shot(p, 'home-focus');
  },
  async typing(p) {
    await go(p, `/?prompt=${encodeURIComponent(HERO)}&makingof&typing`);
    await until(p, 'document.body.classList.contains("typing")', 60000);
    await sleep(1800);
    await shot(p, 'typed-intro');
  },
  async makingof(p) {
    await go(p, '/', 4000);
    await tap(p, '#live');
    await sleep(4000);
    await shot(p, 'makingof-4s');
    await sleep(14000);
    await shot(p, 'makingof-18s', { perf: await fps(p) });
    await until(p, 'document.querySelector("#play.ready")', 90000);
    await sleep(8000);
    await shot(p, 'makingof-play');
    await sleep(12000);
    await shot(p, 'makingof-cards');
    await tap(p, '#play');
    await sleep(9000);
    await shot(p, 'premiere-9s', { perf: await fps(p) });
    await sleep(15000);
    await shot(p, 'premiere-28s');
    await tap(p, 'canvas');
    await sleep(500);
    await shot(p, 'premiere-controls');
  },
  async end(p) {
    await go(p, `/?prompt=${encodeURIComponent(HERO)}`);
    await until(p, 'window.__mbReady && window.__mbEnd > 0', 60000);
    const end = await p.ev('window.__mbEnd');
    await go(p, `/?prompt=${encodeURIComponent(HERO)}&t=${Math.max(0, end - 6)}`);
    await until(p, 'window.__mbReady', 60000);
    await sleep(3000);
    await shot(p, 'premiere-end-near');
    await sleep(9000);
    await shot(p, 'premiere-end');
  },
  async dialog(p) {
    await go(p, '/', 3000);
    await p.ev(`document.getElementById('prompt').value = 'A kite race over the windy pier'`);
    await tap(p, '#live');
    await until(p, 'document.getElementById("run-dialog").open', 15000);
    await sleep(400);
    await shot(p, 'dialog-byok');
    await tap(p, '#rd-key');
    await type(p, 'short');
    await tap(p, '#rd-go-byok');
    await sleep(400);
    await shot(p, 'dialog-byok-error');
    // the on-screen keyboard: the layout viewport keeps its height on iOS (the visual viewport shrinks); Android resizes
    if (cur.mobile) {
      await emulate(p, cur, Math.round(cur.h * (cur.landscape ? 0.45 : 0.58)));
      await sleep(600);
      await tap(p, '#rd-key');
      await shot(p, 'dialog-keyboard');
      await emulate(p, cur);
      await sleep(400);
    }
    await tap(p, 'input[name="rd-mode"][value="credits"]');
    await sleep(300);
    await shot(p, 'dialog-credits');
    await tap(p, '#rd-email');
    await type(p, 'friend@example.com');
    await tap(p, '#rd-signin-go');
    await until(p, '!document.getElementById("rd-code-row").hidden', 8000);
    await sleep(300);
    await shot(p, 'dialog-code');
    await tap(p, '#rd-code');
    await type(p, '000000');
    await tap(p, '#rd-signin-go');
    await sleep(800);
    await shot(p, 'dialog-code-error');
    const mail = await (await fetch(URL0 + '/__mail')).json();
    const code = String(mail.at(-1)?.subject ?? '').match(/(\d{6})/)?.[1];
    if (code) {
      await p.ev(`document.getElementById('rd-code').value = ''`);
      await tap(p, '#rd-code');
      await type(p, code);
      await tap(p, '#rd-signin-go');
      await sleep(1000);
      await shot(p, 'dialog-signed-in');
    }
  },
  async share(p) {
    await go(p, `/?run=${RUN}`, 9000);
    await shot(p, 'share-run');
    await go(p, `/?run=${RUN}&makingof`, 10000);
    await shot(p, 'share-run-makingof');
  },
  async errors(p) {
    await go(p, '/?run=zzzzzzzzzzzzzzzzzzzzzzzz', 7000);
    await shot(p, 'error-run-missing');
  },
  async admin(p) {
    await go(p, '/api/admin', 500);
    await shot(p, 'admin');
    // a request to decide: sign in and ask, from the page
    await p.ev(`fetch('/api/auth/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'judge@example.com' }) }).then((r) => r.json())`);
    const mail = await (await fetch(URL0 + '/__mail')).json();
    const code = String(mail.at(-1)?.subject ?? '').match(/(\d{6})/)?.[1];
    await p.ev(`fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'judge@example.com', code: '${code}' }) }).then((r) => r.json())`);
    await p.ev(`fetch('/api/credits/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'I am judging the hackathon and would love to direct a new episode from my phone' }) }).then((r) => r.json())`);
    await tap(p, '#tok');
    await type(p, 'audit-admin');
    await tap(p, '#f button');
    await sleep(800);
    await shot(p, 'admin-list');
  },
};

for (const dn of devices) {
  devName = dn; cur = DEVICES[dn];
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only && !only.includes(name)) continue;
    const p = await openPage();
    try {
      await emulate(p, cur);
      if (A.throttle) await p.cdp('Emulation.setCPUThrottlingRate', { rate: +A.throttle });
      await fn(p);
    } catch (e) { console.log(dn, name, 'FAILED', e.message); (report[dn] ??= {})[name + '-failed'] = String(e.message); }
    await p.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log('done', OUT);
process.exit(0);
