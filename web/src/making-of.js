// The making-of: the crew at work, as a musical number (making-of-score.js). Each role bot sings its thought (its
// event's summary, in the first person) on the bar grid over a vamp, Green sings the lines he proposes on their
// tune, a consultation is a duet (question, answer, a hand play to seal it), and the bots gesture as they think.
// In `npm run dev` the Live button sends a new prompt to the Muse Code director (POST /api/direct: web/vite.config.js
// -> scripts/director/live.js) and the score grows as the crew's events land; when the director finishes and the
// last phrase is sung, the premiere plays the finished bundle, sung by the story's cast. A curated prompt (and the
// static build, which has no director) replays the recorded making-of of its checked-in bundle, scored in full up
// front (deterministic, frame-exact in a capture). A new prompt in the static build falls back to the offline
// generator's premiere.
import { parseNdjson } from './player.js';
import { parseLyric } from './cues.js';
import { NAMES } from './gen/cast.js';
import { modernBundle } from './cast16.js';
import { PLAYS } from './actions.js';
import { curatedSlug } from './curated.js';
import { startPlay } from './plays/index.js';
import { playGesture, endDuets } from './acting.js';
import { MakingOfScore, scoreMakingOf, CREW, crewFormation } from './making-of-score.js';

export { CREW };
export const API = `${import.meta.env?.BASE_URL ?? '/'}api/direct`;
const ROLE = { lyrics: 'Lyricist', chords: 'Arranger', dance: 'Choreographer', lighting: 'Lighting', deals: 'Producer', hype: 'Hype', comedy: 'Comedy' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// "muse-spark-1.3-contributor" -> "Muse Spark 1.3" (the billing tier is not the model's name)
export const modelName = (id) => {
  const m = /^muse-spark-([\d.]+)/i.exec(String(id ?? ''));
  return m ? `Muse Spark ${m[1]}` : id || 'a Meta model';
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The choir's vamp for a score: its chord per half bar, from a bar before the first phrase (live: nothing while the
 * director plans), to the end once the score knows it (live: after the flush), where the home chord rings.
 */
export function vampOf(score) {
  return {
    beatSec: score.beat,
    chordAtHalf: (h) => score.chordAtHalf(h),
    startHalf: () => (score.firstDown === undefined ? Infinity : Math.max(0, Math.floor(score.firstDown / 2 + 1e-9) - 2)),
    endHalf: () => (score.closed ? Math.round(score.end / (2 * score.beat)) - 2 : null),
  };
}

/**
 * The timeline of a scored making-of for the trailer tools (window.__mbMakingOf, scripts/render/capture.mjs ->
 * meta.json makingOf): every sung phrase { t0, t1, bot, agent, kind: thought | line | question | answer | gesture,
 * beat, seq, consultSeq?, text } in seconds of the capture (the making-of's transport: 0 when recording starts).
 * A duet is its question + answer + gesture (the hand play that seals it, both singing its word), one consultSeq.
 */
export function timelineOf(score, offset = 0) {
  const at = (t) => +(t + offset).toFixed(3);
  return { tempo: score.tempo, bar: +score.bar.toFixed(4), offset, end: at(score.end),
    items: score.items.map((i) => ({ ...i, t0: at(i.t0), t1: at(i.t1) })) };
}

/** The dev server's director, or null (a static build). */
export async function directorApi(fetchImpl = fetch, { prod = import.meta.env?.PROD } = {}) {
  // the director only serves in `vite dev`: a built site skips the probe (a 404 in every judge's console)
  if (prod) return null;
  try {
    const r = await fetchImpl(API, { cache: 'no-store' });
    if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) return null;
    const j = await r.json();
    return j?.available ? j : null;
  } catch { return null; }
}

/**
 * deps: { player, choir, bots (Map name -> Bot), el (the banner), captionEl, onBeats(beats|null),
 *   onPremiere(events, beats), onFallback(), episodeFor(prompt), react(e) (the cues of e.line),
 *   prepareStage(homes) (the studio for the making-of: every bot on stage, the crew in front at `homes`),
 *   endStage() (the studio's own formation again), gesture(name, id) (a gesture on a bot's free hands) }
 */
export function createMakingOf(deps) {
  const { player, choir, el, captionEl } = deps;
  let active = null, timer = null, shown = 0;
  let epoch = 0; // a newer start() or a cancel() (a Premiere pressed meanwhile) makes a loading one stand down

  const banner = (html) => { if (el) el.innerHTML = html; };
  function render() {
    if (!active || !el) return;
    const b = active.beats;
    const cur = player.events[player.cursor - 1];
    const k = b && cur ? b.beats.findIndex((x) => x.id === cur.beat) : -1;
    const where = k >= 0 ? ` · beat ${k + 1}/${b.beats.length} ${esc(b.beats[k].section)}` : '';
    const title = b?.title ? `“${esc(b.title)}”` : b?.prompt ? `“${esc(b.prompt)}”` : 'a new episode';
    const head = active.kind === 'live'
      ? `<b>MAKING-OF</b> live: Muse Code is directing ${title}${where} · ${player.events.length} sung · ${clock((performance.now() - active.started) / 1000)}`
      : `<b>MAKING-OF</b> as it happened: ${title}${where}${active.director ? ` · directed by Muse Code (${esc(modelName(active.director.muse?.model))}) in ${clock(active.director.wallSeconds ?? 0)}` : ''}`;
    const state = active.kind === 'live'
      ? active.state === 'planning' ? 'the director is planning the story…'
        : active.state === 'failed' ? `the director stopped: ${esc(active.final?.director?.gate?.problems?.[0] ?? active.final?.log?.at(-1) ?? 'see the dev server log')}`
          : active.state === 'done' ? 'the gate passed: the premiere is next' : 'the crew sings its thinking, beat by beat'
      : 'the crew sings its thinking as it writes; the premiere follows';
    banner(`${head}<small>${state}</small>`);
  }

  /**
   * A thought's gesture (making-of-score.js gestureOf: chin-stroke, binoculars, thumbs-up ...), on the bot's hands:
   * through the stage (deps.gesture: never on busy hands), else played here.
   */
  function hands(e) {
    if (!e.gesture) return;
    if (deps.gesture) return deps.gesture(e.bot, e.gesture);
    const bot = deps.bots?.get(e.bot);
    if (!bot) return;
    if (PLAYS[e.gesture]) startPlay(e.gesture, bot, [], {});
    else playGesture(bot, e.gesture);
  }

  /**
   * After stage(e): the line's cues, the gesture, and the caption: who sings, their job and what they do (asks White,
   * answers Gold ...), then the words sung (a subtitle: the card under the head shows them too), and for a line who
   * it is for and the pal's reply.
   */
  function staged(e) {
    if (!active) return;
    deps.react?.(e);
    hands(e);
    // one card at a time: the cards of the phrases before go as the next one comes up (each would linger 2.5 s)
    const bot = e.lyric ? deps.bots?.get(e.bot) : null;
    if (bot) {
      active.cards ??= new Set();
      if (e.kind !== 'seal') {
        for (const b of active.cards) if (b !== bot) b.head?.setLyrics?.(null);
        active.cards.clear();
      }
      active.cards.add(bot);
    }
    if (!captionEl) return;
    // the seal (its hand play, both singing its word): the duet's caption stays (main.js wrote its own over it)
    if (e.kind === 'seal' || e.kind === 'gesture') { if (active.caption) captionEl.innerHTML = active.caption; return; }
    const what = e.line ? parseLyric(e.line, NAMES) : null;
    const head = `${esc(e.bot)} · ${esc(ROLE[e.agent] ?? e.agent)} · ${esc(e.doing || e.status)}`;
    const extra = [what?.reply ? `the pal answers “${esc(what.reply)}”` : '', e.singsFor ? `for ${esc(e.singsFor)} to sing` : ''].filter(Boolean).join(' · ');
    const words = e.lyric || e.summary;
    captionEl.innerHTML = active.caption = `<small>${head}</small>${words ? `<span class="thinking">${esc(words)}</span>` : ''}${extra ? `<small>${extra}</small>` : ''}`;
  }

  function begin(kind, extra = {}) {
    cancel();
    active = { kind, started: performance.now(), state: 'planning', beats: null, ...extra };
    document.body.classList.add('making-of');
    deps.onBeats?.(active.beats);
    choir.begin();
    render();
  }

  /**
   * Replay a finished bundle's making-of, scored in full, then its premiere. typing: the prompt is typed and
   * Make it pressed first (the demo video's opening; recording starts with it, after the voices have rendered).
   */
  async function replay(prompt, { typing = false } = {}) {
    const mine = ++epoch;
    const bundle = await deps.episodeFor(prompt);
    const slug = curatedSlug(prompt);
    let director = null;
    if (slug) try { const r = await fetch(`${import.meta.env?.BASE_URL ?? '/'}episodes/${slug}/director.json`); if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) director = await r.json(); } catch { /* none */ }
    if (mine !== epoch) return;
    begin('replay', { bundle, beats: bundle.beats, director, state: 'replay' });
    const ours = epoch;
    await deps.prepareStage?.(crewFormation());
    if (ours !== epoch) return;
    const score = scoreMakingOf(bundle.events, bundle.beats);
    active.score = score;
    await choir.prepare(score.staged, { lines: score.lines }); // the crew's voices render first (a second or two)
    if (ours !== epoch) return;
    let intro = 0;
    if (typing && deps.typePrompt) {
      window.__mbEnd = (deps.introSeconds ?? 4) + score.end + 1.5;
      window.__mbReady = true; // the capture records the typing
      intro = await deps.typePrompt(prompt);
      if (ours !== epoch) return;
    }
    choir.setVamp(vampOf(score));
    choir.begin();
    player.stopLive();
    player.load(score.staged);
    player.play();
    // the frame-exact capture (scripts/render/capture.mjs --makingof): recording starts now (after the typed
    // opening, when there is one); the timeline is its clock
    window.__mbMakingOf = timelineOf(score, intro);
    window.__mbEnd = intro + score.end + 1.5;
    window.__mbReady = true;
  }

  /** opts.fresh: direct a curated prompt anew instead of replaying its recorded making-of. */
  async function start(prompt, opts = {}) {
    prompt = String(prompt ?? '').trim();
    const mine = ++epoch;
    await choir.start();
    if (mine !== epoch) return;
    if (curatedSlug(prompt) && !opts.fresh) return replay(prompt, opts);
    const api = await directorApi();
    if (mine !== epoch) return;
    if (!api) { cancel(); return deps.onFallback?.(); } // the static build: the offline generator
    let res, run;
    try {
      res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      run = await res.json();
    } catch (err) { banner(`<b>MAKING-OF</b> the director is unreachable: ${esc(err.message)}`); return; }
    if (res.status === 409) run = { slug: run.slug, events: `${API}/${run.slug}/events.ndjson`, beats: `${API}/${run.slug}/beats.json` }; // join the run going
    else if (!res.ok) { banner(`<b>MAKING-OF</b> ${esc(run.error ?? res.status)}`); return; }
    begin('live', { slug: run.slug, urls: run });
    const ours = epoch;
    await deps.prepareStage?.(crewFormation());
    if (ours !== epoch) return;
    const score = new MakingOfScore({ live: true });
    active.score = score;
    // each batch the score lays out: its voices render while the lead runs (the score places nothing sooner)
    const sing = (added) => {
      if (!added.length) return added;
      const seqs = new Set(added.map((e) => e.seq));
      choir.prepare(added, { append: true, lines: score.lines.filter((l) => seqs.has(l.seq)) });
      window.__mbMakingOf = timelineOf(score);
      return added;
    };
    choir.setVamp(vampOf(score));
    choir.begin();
    player.live(run.events, { interval: 1000, score: { add: (raw, now) => sing(score.add(raw, now)), flush: (now) => sing(score.flush(now)) } });
    timer = setInterval(poll, 2000);
  }

  async function poll() {
    const a = active;
    if (!a || a.kind !== 'live') return;
    const s = await fetch(`${API}/${a.slug}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!s || active !== a) return;
    a.state = s.state;
    if (s.title && !a.beats) {
      const b = await fetch(a.urls.beats, { cache: 'no-store' }).then((r) => (r.ok ? r.json().then(modernBundle) : null)).catch(() => null);
      if (b && active === a) {
        a.beats = b;
        if (a.score) a.score.beats = b; // Green's lines on the arranger's tunes from here
        deps.onBeats?.(b);
      }
    }
    if (s.state === 'done' || s.state === 'failed') {
      clearInterval(timer); timer = null;
      a.final = s;
      await player.endLive();
    }
    render();
  }

  /** The stage back to the studio's own formation, the vamp off, the duets over. */
  function wrapUp() {
    choir.setVamp(null);
    endDuets();
    deps.endStage?.();
  }

  async function finish() {
    const a = active;
    active = null;
    document.body.classList.remove('making-of');
    banner('');
    wrapUp();
    let events, beats;
    if (a.kind === 'live') {
      events = parseNdjson(await fetch(a.urls.events, { cache: 'no-store' }).then((r) => r.text()));
      beats = a.beats ?? await fetch(a.urls.beats, { cache: 'no-store' }).then((r) => r.json()).then(modernBundle);
    } else ({ events, beats } = a.bundle);
    const end = window.__mbEnd;
    deps.onPremiere?.(events, beats);
    // a making-of capture (capture.mjs --makingof) ends with the making-of: the premiere sets its own song's end
    // (playEpisode, synchronously before it warms up), which is not on this capture's clock
    if (a.kind === 'replay' && end !== undefined) window.__mbEnd = end;
  }

  /** Per frame: the banner, and the premiere once the last phrase is sung (live: and the director is done). */
  function update() {
    if (!active) return;
    if (performance.now() - shown > 500) { shown = performance.now(); render(); }
    const sc = active.score;
    if (!sc || active.finishing) return;
    const over = active.kind === 'replay' ? player.finished && player.time >= sc.end
      : player.liveDone && active.state === 'done' && player.time >= sc.end;
    if (over) { active.finishing = true; finish(); }
  }

  function cancel() {
    epoch++;
    if (timer) clearInterval(timer);
    timer = null;
    if (active) wrapUp();
    active = null;
    document.body.classList.remove('making-of');
    banner('');
  }

  return {
    start, replay, staged, update, cancel,
    get active() { return active; },
    /** The bots the making-of's shots frame (the crew; main.js: the wide holds them, not the whole choir), else null. */
    get core() { return active ? CREW : null; },
  };
}
