// The making-of (LIVE): the crew at work. In `npm run dev` the Live button sends a new prompt to the
// Muse Code director (POST /api/direct: web/vite.config.js -> scripts/director/live.js) and stages
// the crew's events as they land: each role bot sings the line it writes, or acts its summary (and
// sings it while the stage is free). When the director finishes, the premiere plays the finished
// bundle, sung by the story's cast. A curated prompt (and the static build, which has no director)
// replays the recorded making-of of its checked-in bundle instead: the events' `t` is when the crew
// wrote them. A new prompt in the static build falls back to the offline generator's premiere.
import { parseNdjson } from './player.js';
import { parseLyric } from './cues.js';
import { NAMES } from './gen/cast.js';
import { curatedSlug } from './curated.js';

export const API = `${import.meta.env?.BASE_URL ?? '/'}api/direct`;
const ROLE = { lyrics: 'Lyricist', chords: 'Arranger', dance: 'Choreographer', lighting: 'Lighting', deals: 'Producer', hype: 'Hype', comedy: 'Comedy' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * An event as the making-of stages it: the role bot (e.bot) performs its own work, so the story's
 * singer and harmony go; it sings its line (plain words: the choir sings what it is given; the
 * markup stays in e.line for the cues), else its summary while the stage is free (backlog <= 1).
 */
export function makingOfEvent(e, player) {
  const { singer, with: harmony, part, ...rest } = e;
  void harmony; void part;
  const line = e.lyric ? parseLyric(e.lyric, NAMES) : null;
  const sung = line ? line.text : (player?.backlog ?? 0) <= 1 ? e.summary : '';
  return { ...rest, lyric: sung, line: e.lyric || '', singsFor: singer && singer !== e.bot ? singer : null };
}
/** Seconds an event holds the making-of stage: its sung words, else a beat for the action. */
export const gapOf = (e) => (e.lyric ? Math.max(2.6, words(e.lyric) * 0.45 + 1.4) : 1.4);

/** The dev server's director, or null (a static build). */
export async function directorApi(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(API, { cache: 'no-store' });
    if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) return null;
    const j = await r.json();
    return j?.available ? j : null;
  } catch { return null; }
}

/**
 * deps: { player, choir, el (the banner), captionEl, onBeats(beats|null), onPremiere(events, beats),
 *   onFallback(), episodeFor(prompt), react(e) (the cues of e.line), speed (replay) }
 */
export function createMakingOf(deps) {
  const { player, choir, el, captionEl } = deps;
  let active = null, timer = null, shown = 0;

  const banner = (html) => { if (el) el.innerHTML = html; };
  function render() {
    if (!active || !el) return;
    const b = active.beats;
    const cur = player.events[player.cursor - 1];
    const k = b && cur ? b.beats.findIndex((x) => x.id === cur.beat) : -1;
    const where = k >= 0 ? ` · beat ${k + 1}/${b.beats.length} ${esc(b.beats[k].section)}` : '';
    const title = b?.title ? `“${esc(b.title)}”` : 'a new episode';
    const head = active.kind === 'live'
      ? `<b>MAKING-OF</b> live: Muse Code is directing ${title}${where} · ${player.events.length} events · ${clock((performance.now() - active.started) / 1000)}`
      : `<b>MAKING-OF</b> as it happened: ${title}${where}${active.director ? ` · directed by Muse Code (${esc(active.director.muse?.model ?? 'Meta')}) in ${clock(active.director.wallSeconds ?? 0)}` : ''}`;
    const state = active.kind === 'live'
      ? active.state === 'planning' ? 'the director is planning the story…'
        : active.state === 'failed' ? `the director stopped: ${esc(active.final?.director?.gate?.problems?.[0] ?? active.final?.log?.at(-1) ?? 'see the dev server log')}`
          : active.state === 'done' ? 'the gate passed: the premiere is next' : 'the crew is writing, beat by beat'
      : 'the crew wrote it beat by beat; the premiere follows';
    banner(`${head}<small>${state}</small>`);
  }

  /** After stage(e): the making-of caption (the line and the thinking) and the line's cues. */
  function staged(e) {
    if (!active) return;
    deps.react?.(e);
    if (!captionEl) return;
    const what = e.line ? parseLyric(e.line, NAMES) : null;
    const text = what ? `♪ ${esc(what.text)}${what.reply ? ` <i>(${esc(what.reply)})</i>` : ''}` : esc(e.summary);
    const thinking = what ? `<span class="thinking">${esc(e.summary)}${e.singsFor ? ` · for ${esc(e.singsFor)} to sing` : ''}</span>` : '';
    captionEl.innerHTML = `<small>${esc(e.bot)} · ${esc(ROLE[e.agent] ?? e.agent)} · ${esc(e.status)}${e.consult?.length && e.status === 'consulting' ? ` ${esc(e.consult.join(', '))}` : ''}</small>${text}${thinking}`;
  }

  function begin(kind, extra = {}) {
    cancel();
    active = { kind, started: performance.now(), state: 'planning', beats: null, ...extra };
    document.body.classList.add('making-of');
    deps.onBeats?.(active.beats);
    choir.begin();
    render();
  }

  /** Replay a finished bundle's making-of on its own timeline, then its premiere. */
  async function replay(prompt) {
    const bundle = await deps.episodeFor(prompt);
    const slug = curatedSlug(prompt);
    let director = null;
    if (slug) try { const r = await fetch(`${import.meta.env?.BASE_URL ?? '/'}episodes/${slug}/director.json`); if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) director = await r.json(); } catch { /* none */ }
    begin('replay', { bundle, beats: bundle.beats, director, state: 'replay' });
    player.live(bundle.events, { lead: 1.2, gapOf, transform: makingOfEvent, speed: deps.speed ?? 2 });
  }

  /** opts.fresh: direct a curated prompt anew instead of replaying its recorded making-of. */
  async function start(prompt, opts = {}) {
    prompt = String(prompt ?? '').trim();
    await choir.start();
    if (curatedSlug(prompt) && !opts.fresh) return replay(prompt);
    const api = await directorApi();
    if (!api) { cancel(); return deps.onFallback?.(); } // the static build: the offline generator
    let res, run;
    try {
      res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      run = await res.json();
    } catch (err) { banner(`<b>MAKING-OF</b> the director is unreachable: ${esc(err.message)}`); return; }
    if (res.status === 409) run = { slug: run.slug, events: `${API}/${run.slug}/events.ndjson`, beats: `${API}/${run.slug}/beats.json` }; // join the run going
    else if (!res.ok) { banner(`<b>MAKING-OF</b> ${esc(run.error ?? res.status)}`); return; }
    begin('live', { slug: run.slug, urls: run });
    player.live(run.events, { interval: 1000, lead: 1.5, gapOf, transform: makingOfEvent });
    timer = setInterval(poll, 2000);
  }

  async function poll() {
    const a = active;
    if (!a || a.kind !== 'live') return;
    const s = await fetch(`${API}/${a.slug}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!s || active !== a) return;
    a.state = s.state;
    if (s.title && !a.beats) {
      const b = await fetch(a.urls.beats, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (b && active === a) { a.beats = b; deps.onBeats?.(b); }
    }
    if (s.state === 'done' || s.state === 'failed') {
      clearInterval(timer); timer = null;
      a.final = s;
      await player.endLive();
    }
    render();
  }

  async function finish() {
    const a = active;
    active = null;
    document.body.classList.remove('making-of');
    banner('');
    let events, beats;
    if (a.kind === 'live') {
      events = parseNdjson(await fetch(a.urls.events, { cache: 'no-store' }).then((r) => r.text()));
      beats = a.beats ?? await fetch(a.urls.beats, { cache: 'no-store' }).then((r) => r.json());
    } else ({ events, beats } = a.bundle);
    deps.onPremiere?.(events, beats);
  }

  /** Per frame: the banner, and the premiere once the making-of has staged everything. */
  function update() {
    if (!active) return;
    if (performance.now() - shown > 500) { shown = performance.now(); render(); }
    if (!player.liveDone || active.finishing) return;
    if (active.kind === 'replay' || active.state === 'done') { active.finishing = true; finish(); }
  }

  function cancel() {
    if (timer) clearInterval(timer);
    timer = null;
    active = null;
    document.body.classList.remove('making-of');
    banner('');
  }

  return { start, replay, staged, update, cancel, get active() { return active; } };
}
