// The making-of: the crew at work, as a musical number (making-of-score.js). Each role bot sings its thought (its
// event's summary: what it says to a crewmate, turned to that bot) on the bar grid over a vamp, Green sings the lines he proposes on their
// tune, a consultation is a duet (question, answer, a hand play to seal it), and the bots gesture as they think.
// In `npm run dev` the Live button sends a new prompt to the Muse Code director (POST /api/direct: web/vite.config.js
// -> scripts/director/live.js) and the score grows as the crew's events land; when the director finishes and the
// last phrase is sung, the premiere plays the finished bundle, sung by the story's cast. A curated prompt (and the
// static build, which has no director) replays the recorded making-of of its checked-in bundle, scored in full up
// front (deterministic, frame-exact in a capture). A new prompt in the static build falls back to the offline
// generator's premiere. The crew works in the sets (making-of-score.js CrewSets): in Gold's Diner while the director
// plans, then in the set of the beat it is writing, cut there between phrases.
import { parseNdjson } from './player.js';
import { parseLyric } from './cues.js';
import { NAMES } from './gen/cast.js';
import { modernBundle } from './cast16.js';
import { PLAYS } from './actions.js';
import { curatedSlug } from './curated.js';
import { startPlay } from './plays/index.js';
import { playGesture, endDuets } from './acting.js';
import { MakingOfScore, scoreMakingOf, CREW, crewFormation, CrewSets } from './making-of-score.js';

export { CREW };
export const API = `${import.meta.env?.BASE_URL ?? '/'}api/direct`;
const ROLE = { lyrics: 'Lyricist', chords: 'Arranger', dance: 'Choreographer', lighting: 'Lighting', deals: 'Producer', hype: 'Hype', comedy: 'Comedy' };
/** A consultation's parts, said in the caption (consultation.js PARTS). */
const CONSULT_PART = { pickup: 'may I ask?', context: 'the context', question: 'the question', reasoning: 'thinking it through', answer: 'the answer', followup: 'a follow-up', outro: 'agreed' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// "muse-spark-1.3-contributor" -> "Muse Spark 1.3" (the billing tier is not the model's name)
export const modelName = (id) => {
  const m = /^muse-spark-([\d.]+)/i.exec(String(id ?? ''));
  return m ? `Muse Spark ${m[1]}` : id || 'a Meta model';
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The choir's vamp for a score (audio.js: half bar by half bar of its groove, two beats; the score's chords a bar
 * each): from transport 0 (the warm-up while the director plans) to the end once the score knows it (live: after
 * the flush), where the home chord rings.
 */
export function vampOf(score) {
  return {
    beatSec: score.beat,
    chordAtHalf: (h) => score.chordAtBar(Math.floor(h / 2)),
    startHalf: () => 2 * score.startBar,
    endHalf: () => (score.closed ? Math.round(score.end / (2 * score.beat)) - 2 : null),
  };
}

/**
 * The timeline of a scored making-of for the trailer tools (window.__mbMakingOf, scripts/render/capture.mjs ->
 * meta.json makingOf): every sung phrase { t0, t1, bot, agent, kind: thought | line | question | answer | gesture |
 * refrain, beat, seq, consultSeq?, text } in seconds of the capture (the making-of's transport: 0 when recording
 * starts). A duet is its question + answer + gesture (the hand play that seals it, both singing its word), one
 * consultSeq; a refrain is the crew's work song (`with`: the others singing it). asides: the remarks shown, not sung;
 * progress: the production's length (s) and when each beat arrived (the loading bar).
 */
export function timelineOf(score, offset = 0) {
  const at = (t) => +(t + offset).toFixed(3);
  const bars = (s) => s.bars ?? Math.max(0, score.head - s.start);
  return { tempo: score.tempo, bar: +score.bar.toFixed(4), offset, end: at(score.end),
    items: score.items.map((i) => ({ ...i, t0: at(i.t0), t1: at(i.t1) })),
    asides: score.asides.map((a) => ({ ...a, t: at(a.t) })),
    progress: { seconds: score.production, beats: score.arrivals.map((a) => ({ beat: a.beat, t: at(a.t) })) },
    // the consultations' parts (each a part of the song: its function set, its progression, a chord a bar)
    consultParts: (score.consultParts ?? []).map((p) => ({ ...p, t0: at(score.sec(4 * p.from)), t1: at(score.sec(4 * p.to)) })),
    // the form: each beat's section, its progression (an id of its function set) and its chords, a bar each; cadence:
    // where its fitted progression ends (as its set does: V7 -> I, a half cadence on V), the idle bars after it
    sections: score.sections.map((s) => {
      const fit = s.fitted ? Math.min(s.fitted.length, bars(s)) : bars(s);
      return { beat: s.beat, section: s.section, set: s.set, progression: s.prog, t0: at(score.sec(4 * s.start)),
        t1: at(score.sec(4 * (s.start + bars(s)))), bars: bars(s), fit, cadence: at(score.sec(4 * (s.start + fit))),
        romans: Array.from({ length: bars(s) }, (_, k) => score.romanAt(s.start + k)) };
    }) };
}

/**
 * The loading bar's markup: which beat of the episode the crew is on and a thin bar filling with the production's
 * time (the score's progressAt), in the banner's own style.
 */
export function progressHtml(p, beats = null) {
  const name = p.beat ? (beats?.find((x) => x.id === p.beat)?.section ?? String(p.beat).replace(/^beat-\d+-/, '')) : null;
  const label = p.planning ? 'the director is planning: the crew warms up' : `beat ${p.k}/${p.of}${name ? ` ${esc(name)}` : ''}${p.frac >= 1 ? ' · written: the crew sings its last lines' : ''}`;
  const pct = Math.round(1000 * Math.min(1, Math.max(0, p.frac))) / 10;
  return `<span class="progress" data-frac="${p.frac.toFixed(4)}"><span class="fill" style="width:${pct}%"></span></span><span class="where">${label}</span>`;
}

/** A curated bundle's activity log (activity.ndjson: scripts/director/activity.js), or null (none recorded). */
export async function fetchActivity(slug, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}episodes/${slug}/activity.ndjson`);
    if (!r.ok || /html/.test(r.headers.get('content-type') ?? '')) return null; // (a dev server's fallback page)
    const list = parseNdjson(await r.text());
    return list.length ? list : null;
  } catch { return null; }
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
 *   prepareStage(formation) (the sets for the making-of: every bot on stage, in `formation(set)`: Map name -> [x, y, z],
 *   the crew in front), crewCut(set) (a clean cut to another set, the cast at its formation there), endStage() (the
 *   premiere's blocking again), gesture(name, id) (a gesture on a bot's free hands) }
 */
export function createMakingOf(deps) {
  const { player, choir, el, captionEl } = deps;
  let active = null, timer = null, shown = 0;
  let epoch = 0; // a newer start() or a cancel() (a Premiere pressed meanwhile) makes a loading one stand down
  const formation = (set) => crewFormation(NAMES, set); // the cast's places in each set

  const banner = (html) => { if (el) el.innerHTML = html; };
  function render() {
    if (!active || !el) return;
    const b = active.beats;
    // the loading bar: the beat the production is on and how far it is (never back), the latest aside under it
    const p = active.score ? active.score.progressAt(player.time) : { k: 0, of: b?.beats?.length || 11, beat: null, frac: 0, planning: true };
    if (active.progress && p.frac < active.progress.frac) p.frac = active.progress.frac;
    active.progress = p;
    const aside = active.aside && player.time - active.aside.t < 5 ? `<span class="aside">${esc(active.aside.bot)}: “${esc(active.aside.text)}”</span>` : '';
    const title = b?.title ? `“${esc(b.title)}”` : b?.prompt ? `“${esc(b.prompt)}”` : 'a new episode';
    const head = active.kind === 'live'
      ? `<b>MAKING-OF</b> live: Muse Code is directing ${title} · ${player.events.length} sung · ${clock((performance.now() - active.started) / 1000)}`
      : `<b>MAKING-OF</b> as it happened: ${title}${active.director ? ` · directed by Muse Code (${esc(modelName(active.director.muse?.model))}) in ${clock(active.director.wallSeconds ?? 0)}` : ''}`;
    // (a replay: two short rows, the head and the loading bar, so the crew's back row shows under it; live: the state too)
    const state = active.kind === 'live'
      ? active.state === 'planning' ? 'the director is planning the story…'
        : active.state === 'failed' ? `the director stopped: ${esc(active.final?.director?.gate?.problems?.[0] ?? active.final?.log?.at(-1) ?? 'see the dev server log')}`
          : active.state === 'done' ? 'the gate passed: the premiere is next' : 'the crew sings its thinking as it writes'
      : '';
    banner(`<span class="head">${head}</span>${state ? `<small>${state}</small>` : ''}<span class="bar">${progressHtml(p, b?.beats)}</span>${aside}`);
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
   * Before stage(e): the set the crew works in for it (the beat being written, cut only between phrases: CrewSets);
   * another set than before is a clean cut there (deps.crewCut).
   */
  function cue(e) {
    if (!active?.sets) return;
    const was = active.sets.set;
    const set = active.sets.next(e);
    if (set !== was) deps.crewCut?.(set);
  }

  /**
   * After stage(e): the line's cues, the gesture, and the caption: who sings, their job and what they do (asks White,
   * answers Gold ...), then the words sung (a subtitle: the card under the head shows them too), and for a line who
   * it is for and the pal's reply.
   */
  function staged(e) {
    if (!active) return;
    if (e.part) return; // the backing and the gap answers: their own cards and mouths (main.js stage); the caption stays the phrase's
    // an aside (a remark there was no time to sing): under the loading bar a few seconds, the bot's gesture
    if (e.kind === 'aside') { active.aside = { t: e.t, bot: e.bot, text: e.aside }; hands(e); shown = 0; return; }
    deps.react?.(e);
    hands(e);
    // one card at a time: the cards of the phrases before go as the next one comes up (each would linger 2.5 s)
    const bot = e.lyric ? deps.bots?.get(e.bot) : null;
    if (bot) {
      active.cards ??= new Set();
      // (the seal's word and the work song's other voices: sung together, every card stays)
      const together = e.kind === 'refrain' && active.refrainT === e.t;
      if (e.kind === 'refrain') active.refrainT = e.t;
      if (e.kind !== 'seal' && !together) {
        // (a bot that sings the backing now keeps its card)
        for (const b of active.cards) if (b !== bot && b.part !== 'backing' && b.part !== 'echo' && b.part !== 'reply') b.head?.setLyrics?.(null);
        active.cards.clear();
      }
      active.cards.add(bot);
    }
    if (!captionEl) return;
    // the seal (its hand play, both singing its word): the duet's caption stays (main.js wrote its own over it)
    if (e.kind === 'seal' || e.kind === 'gesture') { if (active.caption) captionEl.innerHTML = active.caption; return; }
    if (e.kind === 'refrain') {
      captionEl.innerHTML = active.caption = `<small>the crew · their work song, while the production runs</small><span class="thinking">${esc(e.lyric)}</span>`;
      return;
    }
    const what = e.line ? parseLyric(e.line, NAMES) : null;
    const head = `${esc(e.bot)} · ${esc(ROLE[e.agent] ?? e.agent)} · ${esc(e.doing || e.status)}`;
    const extra = [what?.reply ? `the pal answers “${esc(what.reply)}”` : '', e.singsFor ? `for ${esc(e.singsFor)} to sing` : '',
      e.consultPart ? `consulting ${esc(e.consult?.[0] ?? '')}: ${CONSULT_PART[e.consultPart] ?? e.consultPart}` : ''].filter(Boolean).join(' · ');
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
    let director = null, activity = null;
    // the production's activity log (what the director and the crew really did, when: sung in the waits), when recorded
    if (slug) activity = await fetchActivity(slug);
    if (slug) try { const r = await fetch(`${import.meta.env?.BASE_URL ?? '/'}episodes/${slug}/director.json`); if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) director = await r.json(); } catch { /* none */ }
    if (mine !== epoch) return;
    begin('replay', { bundle, beats: bundle.beats, director, state: 'replay' });
    const ours = epoch;
    await deps.prepareStage?.(formation);
    if (ours !== epoch) return;
    // the loading bar: as long as the production took (director.json), each event sung at or after its time
    const score = scoreMakingOf(bundle.events, bundle.beats, { production: director?.wallSeconds ?? director?.makingOfSeconds ?? null, activity });
    active.score = score;
    active.sets = new CrewSets(score);
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
    await deps.prepareStage?.(formation);
    if (ours !== epoch) return;
    const score = new MakingOfScore({ live: true });
    active.score = score;
    active.sets = new CrewSets(score);
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

  /** The stage back to the premiere's blocking, the vamp off, the duets over. */
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
    start, replay, cue, staged, update, cancel,
    get active() { return active; },
    /** The bots the making-of's shots frame (the crew; main.js: the wide holds them, not the whole choir), else null. */
    get core() { return active ? CREW : null; },
  };
}
