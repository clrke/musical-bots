// Episode events -> sung lines for the Magna Vocalization voice engine (web/src/mv, a verbatim
// copy of ~/Projects/web/magna-vocalization's voice + melody code plus the Unity app's five extra
// voices). Pure and deterministic, so the browser (worker pool) and node tests plan identically.
//
// Two plans:
// - LIVE (planEpisode, the making-of): every line starts on the first bar line at or after its event
//   as it arrives, sung by the bot that wrote it, on the TEMPO bar grid.
// - The premiere (arrange): the episode as a Soothing Bots story song (Magna.Core StorySong.cs /
//   StoryForm.cs): its sections of eight bars on a child tune at 88-100 BPM, each section's chords
//   counted from its first bar (choruses and the outro end V7 -> I), the story's lines sung by the
//   cast (protocol v2 `singer`), the pal's replies and echoes in the gaps, harmonies on the words,
//   and a sung backing (a "Bom" bass, held "ooh" pads, a "doo" groove, "la la" on top, a hum in the
//   bridges, a counter-melody in chorus 3).
import { syllabify } from './mv/voice/syllables.js';
import { VIBRATO_SCALE } from './mv/voice/voice.js';
import { DEFAULT_VIBRATO } from './mv/voice/sing.js';
import { voiceRange, chordFromRoman } from './mv/music/theory.js';
import { CAST, NAMES } from './gen/cast.js';
import { hashString } from './gen/rng.js';
import { parseLyric } from './cues.js';
import { FORM, BARS_PER_SECTION, sectionKind, isCadenceSection, chooseStyle, tuneOf, styleRomans, sectionRomans, chordName } from './song/form.js';
import { notesFor, tuneNotes, tuneBars, replyNotes, echoOf, echoShape, pickupPitches, PICKUP_NOTE_BEATS, PICKUP_GAP_BEATS, PICKUP_MIN_LAST_BEATS, MAX_PICKUP_SYLLABLES } from './song/tunes.js';
import { layerGain, storySpans, syllableSpans } from './song/mix.js';

/** The LIVE (making-of) tempo; the premiere draws its own from the episode's seed (88-100 BPM). */
export const TEMPO = 96;
export const BEAT = 60 / TEMPO;
export const BAR = 4 * BEAT;

// Musical Bots voice classes -> engine voices (the Unity cast uses 'woman' for its altos).
const VOICE_OF = { alto: 'woman' };
export const engineVoice = (bot) => {
  const v = CAST[bot]?.voice ?? 'alto';
  return VOICE_OF[v] ?? v;
};

// Chord names -> roman numerals in C, the engine's chord language (mv/music/theory.js parseRoman):
// the letter gives the degree and # / b its accidental ('F#m' -> '#iv', 'Bb' -> 'bVII'), the
// quality the numeral's case and suffix ('Cmaj7' -> 'Imaj7', 'Am7' -> 'vi7', 'Bdim' -> 'viidim',
// 'Bm7b5' -> 'viim7b5', 'Gsus4' -> 'Vsus4', 'Eaug' -> 'IIIaug', 'G9' -> 'V7'); a slash bass is
// left out ('C/E' -> 'I'). Unknown names are the tonic.
const DEGREE = { C: 'I', D: 'II', E: 'III', F: 'IV', G: 'V', A: 'VI', B: 'VII' };
const CHORD_QUALITY = [ // [quality after the root, minor, roman suffix]
  [/^(?:maj|ma|M)(?:7|9|11|13)$|^Δ(?:7|9)?$/, false, 'maj7'], [/^(?:m|mi|min|-)(?:maj|M|Δ)(?:7|9)?$/, true, 'maj7'],
  [/^(?:m7b5|m7♭5|mi7b5|min7b5|ø7?)$/, true, 'm7b5'], [/^(?:dim7|°7|o7)$/, true, 'dim7'], [/^(?:dim|°|o)$/, true, 'dim'],
  [/^(?:aug|\+|\+5|#5|♯5)$/, false, 'aug'], [/^(?:7?sus2)$/, false, 'sus2'], [/^(?:7?sus4?)$/, false, 'sus4'],
  [/^(?:m|mi|min|-)(?:7|9|11|13)$/, true, '7'], [/^(?:7|9|11|13)$/, false, '7'],
  [/^(?:m|mi|min|-)6(?:\/9)?$/, true, '6'], [/^6(?:\/9)?$/, false, '6'],
  [/^(?:m|mi|min|-)(?:add9|add2)$/, true, 'add9'], [/^(?:add9|add2|2)$/, false, 'add9'],
  [/^(?:m|mi|min|-)$/, true, ''], [/^(?:5|maj|M)?$/, false, ''],
];
export function romanOf(name) {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)([^/\s]*)(?:\/\S*)?\s*$/.exec(String(name));
  if (!m) return 'I';
  const r = DEGREE[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? '#' : m[2] ? 'b' : '';
  const quality = m[3].replace(/[()]/g, '');
  const q = CHORD_QUALITY.find(([re]) => re.test(quality));
  // (an unknown quality: minor if it starts with "m" but not "maj", a seventh if it has a 7)
  const minor = q ? q[1] : /^m(?!aj)/.test(quality);
  const suffix = q ? q[2] : quality.includes('7') ? '7' : '';
  return acc + (minor ? r.toLowerCase() : r) + suffix;
}

// Melody per production role (LIVE): the lyricist states the tune plainly, hype pushes, comedy swings.
const MELODY_OF = {
  lyrics: 'steady', chords: 'rising', dance: 'syncopated', hype: 'syncopated',
  comedy: 'lilting', deals: 'falling', lighting: 'lilting',
};

/** Chord name at song bar `bar` given the chord list in force (the LIVE pad uses the same rule). */
export const chordAtBar = (chords, bar) => (chords.length ? chords[((bar % chords.length) + chords.length) % chords.length] : 'C');

const jobVibrato = (voice) => {
  const vs = VIBRATO_SCALE[voice] ?? { depth: 1, rate: 1 };
  return { rate: DEFAULT_VIBRATO.rate * vs.rate, depth: DEFAULT_VIBRATO.depth * vs.depth };
};

/**
 * One sung line of event e (e.bot sings e.lyric, plain text) starting at bar `startBar` of a chord
 * list `chords` (names; a section's chords counted from its first bar). Returns null when it cannot
 * be sung. Options (the premiere's): tempo, origin (song seconds of bar 0 of `chords`), cadenceBar /
 * cadenceGap (a chorus's or the outro's home bar), octave, minBars (a story line lasts two bars at
 * least), pickup (how many of the line's first syllables are its pickup: sung in eighth notes before
 * the first downbeat, over pickupChord). The notes come from song/tunes.js notesFor: the child tunes
 * there, every other melody id from the engine's generateNotes, its options passed through.
 */
function planLine(e, chords, startBar, role = 'lead', melody = null, o = {}) {
  const text = (e.lyric || '').trim();
  if (!text) return null;
  const sylls = syllabify(text);
  if (!sylls.length) return null;
  const voice = engineVoice(e.bot);
  const tempo = o.tempo ?? TEMPO, beatSec = 60 / tempo;
  const m = o.pickup > 0 && o.pickup < sylls.length ? o.pickup : 0; // the pickup's syllables
  // the words' stress shapes the rhythm (sub-phrases split for the words, onsets fitted: melody.js)
  const own = sylls.slice(m);
  const { notes, bars } = notesFor({
    melody: melody ?? MELODY_OF[e.agent] ?? 'steady', syllableCount: sylls.length - m, chords: chords.map(romanOf),
    role, voice, key: 'C', tempo, startBar, cadenceBar: o.cadenceBar ?? null, cadenceGap: Boolean(o.cadenceGap), octave: o.octave ?? 0, minBars: o.minBars ?? 0,
    syllables: own, stress: own.map((s) => s.stress),
  });
  if (notes.length !== sylls.length - m) return null;
  const firstT = notes[0].t; // notes are timed from the start of startBar
  const lead = [];
  if (m) {
    const { low, high } = voiceRange(voice);
    const under = romanOf(o.pickupChord ?? chords[(((startBar - 1) % chords.length) + chords.length) % chords.length] ?? 'C');
    pickupPitches(notes[0].midi, m, 'C', low, high, chordTonesOf(under)).forEach((midi, i) => lead.push({
      t: -(m - i) * PICKUP_NOTE_BEATS * beatSec, dur: PICKUP_NOTE_BEATS * beatSec, midi, downbeat: false,
    }));
  }
  // the accent is the bar's downbeat only (as Magna.Core Compile): a note the stress fit moved off
  // a downbeat still carries it
  const all = [...lead, ...notes.map((n) => ({
    t: n.t - firstT, dur: n.dur, midi: n.midi, downbeat: onDownbeat(n.beat) || (Boolean(n.shift) && onDownbeat(n.beat - n.shift)),
  }))];
  const t0 = all[0].t;
  return {
    seq: e.seq, bot: e.bot, bars, role, pickup: m,
    at: (o.origin ?? 0) + startBar * 4 * beatSec + firstT + t0,
    job: {
      voice, text, mode: 'human', seed: hashString(`${e.bot}:${e.seq}`) | 0, vibrato: jobVibrato(voice),
      notes: all.map((n) => ({ t: n.t - t0, dur: n.dur, midi: n.midi, downbeat: n.downbeat })),
    },
  };
}

/** A note on a bar's downbeat (beats from a bar line): the only notes that take the +1 dB accent (Magna.Core Compile). */
const onDownbeat = (beat) => Math.abs(((beat % 4) + 4) % 4) < 1e-6 || Math.abs((((beat % 4) + 4) % 4) - 4) < 1e-6;

/** Pitch classes of a roman's chord in C (the pickup's rub check). */
const chordTonesOf = (roman) => chordFromRoman(roman, 'C').tones;

/**
 * LIVE planning: every line starts on the first bar line at or after its event as it arrives
 * (lines may overlap; the choir ducks the earlier ones). v2 markup is sung as plain text.
 * @returns {Array<{seq:number, bot:string, at:number, bars:number, job:object}>}
 *   at: song seconds the line's first note sounds (the rendered buffer starts PRE earlier).
 */
export function planEpisode(events) {
  const lines = [];
  let chords = ['C', 'G', 'Am', 'F'];
  for (const e of events) {
    if (e.chords?.length) chords = e.chords;
    const line = planLine({ ...e, lyric: parseLyric(e.lyric, NAMES).text }, chords, Math.ceil(e.t / BAR - 1e-9));
    if (line) lines.push(line);
  }
  return lines;
}

export const CARD_LEAD = 0.45; // the lyric card (and the bot's turn) comes up this long before the voice
export const SECTION_GAP = 0; // bars between sections (the story song runs on: its intro opens on pads)

// ------------------------------------------------------------------ the premiere: the story song

/** Who sings what (beats.json roles, v2); v1 bundles get a pal for the echo. */
function rolesOf(beats) {
  const r = beats?.roles ?? {};
  const ok = (n) => (NAMES.includes(n) ? n : null);
  return { lead: ok(r.lead), pal: ok(r.pal) ?? (beats?.version === 2 ? null : 'Navy'), grown: ok(r.grown), rival: ok(r.rival) };
}

// home voices of the backing (StorySong.cs STORY_VOICES / RandomSong.cs ROLE_VOICES), best first
const HOME_VOICES = {
  harmony: ['woman', 'tenor', 'soprano'], bass: ['basso', 'old', 'coach', 'crooner', 'robo'], rhythm: ['robo', 'crooner', 'coach', 'old'],
  pad: ['woman', 'tenor', 'soprano'], lowpad: ['old', 'coach', 'crooner', 'robo', 'tenor'], sparkle: ['soprano', 'woman'],
  echo2: ['soprano', 'woman', 'tenor'], counter: ['soprano', 'woman'],
};
const HOMES = ['harmony', 'bass', 'rhythm', 'pad', 'lowpad', 'sparkle', 'echo2', 'counter'];

/** The backing's singers: every home a free cast member whose voice fits it best (the rng among equals). */
function castHomes(roles, rng) {
  const taken = new Set(Object.values(roles).filter(Boolean));
  const homes = {};
  for (const home of HOMES) {
    const voices = HOME_VOICES[home];
    const fit = (n) => { const i = voices.indexOf(engineVoice(n)); return i < 0 ? 10 : i; };
    const free = NAMES.filter((n) => !taken.has(n));
    if (!free.length) break;
    const best = Math.min(...free.map(fit));
    const pickd = rng.pick(free.filter((n) => fit(n) === best));
    homes[home] = pickd;
    taken.add(pickd);
  }
  return homes;
}

/** Section bars ([from, to)) the harmony on the words sings, by section (StorySong.cs / StoryForm.cs arrangements). */
const HARMONY_BARS = { verse1: [4, 8], verse1b: [2, 8], verse2: [2, 8], verse2b: [0, 8], bridge: [2, 8], bridge2: [0, 8], outro: [0, 4] };
const harmonyFrom = (section, kind) => HARMONY_BARS[section] ?? (kind === 'chorus' ? [0, 8] : kind === 'verse' ? [4, 8] : kind === 'bridge' ? [2, 8] : null);

const bars01 = (s) => [...s].map((c) => c === '1');

/** Pickup syllables of a parsed line, when they can be sung on their own notes (Compile.SourceOf), else 0. */
function pickupCount(parsed) {
  if (!parsed.pickup || !parsed.text.toLowerCase().startsWith(parsed.pickup.toLowerCase())) return { m: 0, rest: parsed.text };
  const rest = parsed.text.slice(parsed.pickup.length).trim();
  const m = syllabify(parsed.pickup).length, n = syllabify(rest).length;
  if (!rest || m < 1 || m > MAX_PICKUP_SYLLABLES || m + n !== syllabify(parsed.text).length) return { m: 0, rest: parsed.text };
  return { m, rest };
}

/** The sections of an episode: its beats in order, each with its story lines and its other events. */
function sectionsOf(events, beats, v2) {
  const info = new Map((beats?.beats ?? []).map((b) => [b.id, b]));
  const order = [], byBeat = new Map();
  for (const e of events) {
    if (!byBeat.has(e.beat)) { byBeat.set(e.beat, []); order.push(e.beat); }
    byBeat.get(e.beat).push(e);
  }
  return order.map((beat, i) => {
    const evs = byBeat.get(beat);
    const fromId = /^beat-\d+-([a-z0-9]+)/.exec(beat)?.[1];
    const section = info.get(beat)?.section ?? (sectionKind(fromId) ? fromId : FORM[Math.min(i, FORM.length - 1)]);
    const kind = sectionKind(section) ?? 'verse';
    const lines = [], silent = [];
    for (let k = 0; k < evs.length;) {
      const e = evs[k];
      const parsed = parseLyric(e.lyric, NAMES);
      if (!parsed.text || !syllabify(parsed.text).length) { silent.push(e); k++; continue; }
      // the group: this event plus the following ones of the beat with the same lyric (v1 harmony)
      let j = k + 1;
      while (j < evs.length && evs[j].lyric === e.lyric) j++;
      const group = evs.slice(k, j);
      const singer = NAMES.includes(e.singer) ? e.singer : NAMES.includes(e.bot) ? e.bot : 'Green';
      const withs = [...new Set([...(v2 && Array.isArray(e.with) ? e.with : []), ...group.slice(1).map((g) => g.singer ?? g.bot)])]
        .filter((n) => NAMES.includes(n) && n !== singer);
      const { m, rest } = pickupCount(parsed);
      lines.push({ e, group, parsed, singer, withs, pickup: m, rest, n: syllabify(rest).length });
      k = j;
    }
    return { beat, section, kind, events: evs, lines, silent };
  });
}

/**
 * The performance: the episode arranged as a story song. Each beat is a section of eight bars (more
 * when its lines need them); its lines are sung one after another on the section's child tune, two
 * bars a line (the intro's come in halfway), each by its singer (v2 `singer`, else `bot`), a line's
 * `[pickup]` before the bar line; the pal (beats.json roles.pal) answers in the gap after a line (its
 * ` >> reply`, else the old repeat of the line's end); harmonies sing the words (v2 `with`, the v1
 * groups of one lyric, and the arranger's own harmony); the sung backing holds the chords.
 *
 * The returned events are the bundle's own, re-timed to the song (t = card time, CARD_LEAD before the
 * voice), plus the parts the arrangement adds, each its own event: a harmony singer's copy of its line
 * (same t and lyric: the stage frames it as a line sung together), the pal's reply / echo (`singer` the
 * pal, `lyric` its words, `part: 'reply' | 'echo'`) and each backing part of a section (`part:
 * 'backing'`, mouth only). The bundle's authoring times are left untouched.
 * @returns {{events: object[], lines: object[], end: number, tempo: number, bar: number, sections: object[]}}
 *   lines: { seq, bot, role, at, bars, job, layer, section, segments? }; end: song seconds the last voice ends.
 */
export function arrange(events, beats = null) {
  const v2 = beats?.version === 2;
  const seed = beats?.seed ?? `events-${hashString(events.map((e) => e.lyric ?? '').join('|'))}`;
  const style = chooseStyle(seed, beats?.tags ?? {});
  const { tempo, rng } = style;
  const beatSec = 60 / tempo, barSec = 4 * beatSec;
  const roles = rolesOf(beats);
  const homes = castHomes(roles, rng);
  const pal = roles.pal;
  const sections = sectionsOf(events, beats, v2);
  let nextSeq = events.reduce((m, e) => Math.max(m, Number.isInteger(e.seq) ? e.seq : -1), -1) + 1;
  const out = [], lines = [];
  const emit = (e, at, extra = {}) => { const o = { ...e, ...extra, t: Math.max(0, at - CARD_LEAD) }; out.push(o); return o; };

  // ---- layout: every section's bars, chords and line bars
  let songBar = 0;
  for (const [i, s] of sections.entries()) {
    s.tune = tuneOf(style, s.section);
    let b = s.kind === 'intro' && s.lines.length <= 3 ? BARS_PER_SECTION - 2 * Math.max(1, s.lines.length) : 0;
    for (const L of s.lines) {
      L.bar = b;
      L.bars = tuneBars(s.tune, L.n, 2) || 2; // a line of the story lasts two bars at least (Arrangement.MinLineBars)
      b += L.bars;
    }
    s.bars = Math.max(BARS_PER_SECTION, Math.ceil(b / 2) * 2);
    const given = s.events.find((e) => e.chords?.length)?.chords;
    const romans = given ? sectionRomans(given.map(romanOf), s.section, s.bars) : sectionRomans(styleRomans(style, s.section), s.section, s.bars);
    s.romans = romans;
    s.chords = romans.map(chordName);
    s.cadenceBar = isCadenceSection(s.section) ? s.bars - 1 : null;
    s.start = songBar;
    s.last = i === sections.length - 1;
    songBar += s.bars + SECTION_GAP;
  }

  // ---- the echo's bars (StoryForm.cs FormEchoBars): the bar after a line with a reply; the old repeat
  // (verses: after the rhyming lines) but not in a cadence's last bar; never after the pal's own line;
  // none in a bridge
  for (const s of sections) {
    s.lines.forEach((L, k) => {
      L.echo = null;
      if (!pal || s.kind === 'bridge' || L.singer === pal) return;
      const bar = L.bar + L.bars - 1;
      if (bar >= s.bars) return;
      const last = bar === s.bars - 1;
      if (L.parsed.reply) L.echo = { bar, text: L.parsed.reply, reply: true };
      else if ((s.kind !== 'verse' || k % 2 === 1) && !(s.cadenceBar !== null && last)) L.echo = { bar, text: echoOf(L.rest), reply: false };
      if (L.echo && !syllabify(L.echo.text).length) L.echo = null;
    });
  }
  // section boundaries: a reply in a section's last bar keeps it (the next line's pickup is not sung);
  // an old repeat there gives way to the next section's pickup
  sections.forEach((s, i) => {
    const next = sections[i + 1], first = next?.lines[0];
    const L = s.lines.at(-1);
    if (!first || !first.pickup || first.bar !== 0 || !L?.echo || L.echo.bar !== s.bars - 1) return;
    if (L.echo.reply) {
      // the pickup's words join the line on its downbeat only if the line still fits its bars (the
      // layout above is done); else they are not sung (StoryForm.cs: "the pickup is not sung")
      const folded = syllabify(first.parsed.text).length;
      if ((tuneBars(next.tune, folded, 2) || 2) <= first.bars) { first.rest = first.parsed.text; first.n = folded; }
      first.pickup = 0;
    }
    else L.echo = null;
  });

  // ---- the story: each line on its section's tune, by its singer (the storyteller of the line)
  const story = [];
  for (const s of sections) {
    const origin = s.start * barSec;
    for (const L of s.lines) {
      const gap = L.bar + L.bars - 1 === s.cadenceBar && L.echo?.reply;
      const plan = (pickup) => planLine({ seq: L.e.seq, bot: L.singer, agent: L.e.agent, lyric: pickup ? L.parsed.text : L.rest }, s.chords, L.bar, 'lead', s.tune, {
        tempo, origin, cadenceBar: s.cadenceBar, cadenceGap: gap, pickup: pickup ? L.pickup : 0, minBars: 2,
        pickupChord: L.bar > 0 ? s.chords[L.bar - 1] : sectionsPrevChord(sections, s),
      });
      let line = plan(L.pickup > 0);
      // the line before makes room for the pickup (its last note shortened), else no pickup
      const prev = story.at(-1);
      if (line && L.pickup && prev) {
        const last = prev.job.notes.at(-1), limit = line.at - PICKUP_GAP_BEATS * beatSec;
        if (prev.at + last.t + last.dur > limit + 1e-6) {
          const cut = limit - (prev.at + last.t);
          if (cut >= PICKUP_MIN_LAST_BEATS * beatSec - 1e-6) last.dur = cut;
          else line = plan(false);
        }
      }
      if (!line) line = plan(false);
      if (!line) continue;
      Object.assign(line, { layer: 'story', section: s.section, beat: s.beat });
      L.plan = line;
      story.push(line);
      lines.push(line);
    }
  }

  // ---- the events of the story's lines, the harmonies on the words
  const hFrom = (s) => harmonyFrom(s.section, s.kind);
  for (const s of sections) {
    const origin = s.start * barSec;
    for (const L of s.lines) {
      if (!L.plan) {
        for (const g of L.group) emit(g, s.start * barSec);
        continue;
      }
      emit(L.e, L.plan.at);
      // who sings the words with it: its `with` (and the v1 group), else the arranger's harmony
      let singers = L.withs.map((n, k) => ({ bot: n, role: k === 0 ? 'third' : k === 1 ? style.backing.lowHarmonyPitch : 'lead' }));
      if (!singers.length) {
        const h = hFrom(s);
        if (h && L.bar >= h[0] && L.bar < h[1] && homes.harmony) singers.push({ bot: homes.harmony, role: 'third' });
        if (s.kind === 'chorus' && L.bar >= 4 && roles.grown) singers.push({ bot: roles.grown, role: style.backing.lowHarmonyPitch });
      }
      singers = singers.filter((x, k) => x.bot !== L.singer && singers.findIndex((y) => y.bot === x.bot) === k);
      const voiced = new Set();
      for (const x of singers) {
        const g = L.group.slice(1).find((ge) => (ge.singer ?? ge.bot) === x.bot); // a v1 group's own event, else a copy
        const seq = g ? g.seq : nextSeq++;
        const h = planLine({ seq, bot: x.bot, agent: L.e.agent, lyric: L.rest }, s.chords, L.bar, x.role, s.tune, {
          tempo, origin, cadenceBar: s.cadenceBar, cadenceGap: L.bar + L.bars - 1 === s.cadenceBar && L.echo?.reply, minBars: 2,
        });
        if (!h) continue;
        Object.assign(h, { layer: 'words', section: s.section, beat: s.beat, role: x.role === 'lead' ? 'unison' : x.role });
        lines.push(h);
        voiced.add(seq);
        const base = g ?? { ...L.e, seq, action: '', consult: [], status: L.e.status === 'consulting' ? 'working' : L.e.status };
        emit(base, L.plan.at, { singer: x.bot, with: undefined });
      }
      for (const g of L.group.slice(1)) if (!voiced.has(g.seq)) emit(g, L.plan.at); // a v1 group member without a part
    }
    // events without words: with the section's next sung line (else its first bar)
    for (const e of s.silent) {
      const after = s.lines.find((L) => L.plan && L.e.seq > e.seq) ?? s.lines.find((L) => L.plan);
      emit(e, after ? after.plan.at : origin + CARD_LEAD);
    }
  }

  // ---- the echo: the pal's replies and repeats in the gaps (MelodyReply.cs), on the section's shapes
  let prevLastShape = -1;
  const usedFirst = new Set();
  for (const s of sections) {
    const echoes = s.lines.filter((L) => L.echo && L.plan);
    if (!echoes.length) continue;
    const ok = [...Array(12).keys()].filter((c) => c !== prevLastShape);
    const fresh = ok.filter((c) => !usedFirst.has(c));
    const first = rng.pick(fresh.length ? fresh : ok);
    usedFirst.add(first);
    echoes.forEach((L, k) => {
      const shape = echoShape(first, k);
      const barT = (s.start + L.echo.bar) * barSec;
      const answering = L.plan.job.notes.slice(L.plan.pickup).map((n) => ({ beat: (L.plan.at + n.t - barT) / beatSec, midi: n.midi }))
        .filter((n) => n.beat >= -1e-6 && n.beat < 4);
      const nextStory = story.find((p) => p.at > barT + 2 * beatSec + 1e-6);
      const endBeats = nextStory ? (nextStory.at - barT) / beatSec : null;
      const answerEnd = endBeats !== null && endBeats < 8 ? endBeats : null;
      const singers = [pal, ...(s.kind === 'chorus' && homes.echo2 ? [homes.echo2] : [])];
      singers.forEach((bot, j) => {
        const r = replyNotes({ shape, syllableCount: syllabify(L.echo.text).length, chord: s.romans[L.echo.bar], voice: engineVoice(bot), tempo, answering, answerEnd, answerIndex: k });
        if (!r) return;
        const seq = nextSeq++;
        const at = barT + r.notes[0].t;
        const line = {
          seq, bot, bars: 1, role: L.echo.reply ? 'reply' : 'echo', at, layer: L.echo.reply ? 'reply' : 'echo', section: s.section, beat: s.beat,
          job: {
            voice: engineVoice(bot), text: L.echo.text, mode: 'human', seed: hashString(`${bot}:${seq}`) | 0, vibrato: jobVibrato(engineVoice(bot)),
            notes: r.notes.map((n) => ({ t: n.t - r.notes[0].t, dur: n.dur, midi: n.midi, downbeat: onDownbeat(n.beat) })),
          },
        };
        if (j > 0) line.layer = 'words'; // the second echo doubles it, under it
        lines.push(line);
        emit({ ...L.e, seq, action: '', consult: [], status: 'working', with: undefined }, at, { singer: bot, lyric: L.echo.text, part: L.echo.reply ? 'reply' : 'echo' });
      });
    });
    prevLastShape = (first + echoes.length - 1) % 12;
  }

  // ---- the backing (StorySong.cs Intro / Verse / Chorus / Bridge / Outro): sung cells, one bar each,
  // every part of a section one event (mouth only) and one line of segments
  const B = style.backing;
  const pickBars = (...xs) => rng.pick(xs);
  for (const s of sections) {
    const parts = [];
    const n = s.bars, all = '1'.repeat(n);
    const half = '0'.repeat(n - 4) + '1111';
    const ring = s.last && s.kind === 'outro' ? 1 : 0; // the song's last chord rings a bar after the outro
    const at = (pat) => bars01(pat.padEnd(n, pat.at(-1)));
    if (s.kind === 'intro') {
      parts.push(['pad', homes.pad, B.padVowel, 'sustain', B.padPitch, at(all)]);
      parts.push(['lowpad', homes.lowpad, 'Mm', 'sustain', 'root', at(pickBars(all, '00111111'))]);
      parts.push(['bass', homes.bass, B.bassVowel, 'sustain', 'bass', at(pickBars('00111111', '00001111'))]);
    } else if (s.kind === 'verse' || s.kind === 'chorus') {
      parts.push(['bass', homes.bass, 'Bom, bom, bom, bom', 'staccato', 'bass', at(all)]);
      parts.push(['rhythm', homes.rhythm, B.rhythmText, B.rhythmMelody, B.rhythmPitch, at(all)]);
      parts.push(['pad', homes.pad, B.padVowel, 'sustain', B.padPitch, at(all)]);
      if (s.kind === 'chorus') parts.push(['lowpad', homes.lowpad, 'Mm', 'sustain', 'root', at(all)]);
      else parts.push(['lowpad', homes.lowpad, 'Mm', 'sustain', 'root', at(pickBars(all, '11110000', '00111111'))]);
      // "la la" on top in the choruses only (over a verse it masks the story's words)
      if (s.kind === 'chorus') parts.push(['sparkle', homes.sparkle, 'La, la, la, la', 'arpeggio', 'root', at(s.section === 'chorus2' ? all : half)]);
    } else if (s.kind === 'bridge') {
      parts.push(['bass', homes.bass, B.bassVowel, 'sustain', 'bass', at(all)]);
      parts.push(['pad', homes.pad, B.padVowel, 'sustain', B.padPitch, at(all)]);
      parts.push(['lowpad', homes.lowpad, 'Mm', 'sustain', 'root', at(all)]);
      if (pal) parts.push(['hum', pal, 'Mm', 'sustain', B.padPitch === 'third' ? 'fifth' : 'third', at('00111111')]);
    } else { // outro
      parts.push(['bass', homes.bass, B.bassVowel, 'sustain', 'bass', at(all)]);
      parts.push(['pad', homes.pad, B.padVowel, 'sustain', B.padPitch, at(all)]);
      parts.push(['lowpad', homes.lowpad, 'Mm', 'sustain', 'root', at(all)]);
      pickBars('00001111', '11110000'); // (the outro's sparkle, left out: its draw kept so the rest stays as it was)
    }
    for (const [role, bot, text, melody, pitch, on] of parts) {
      if (!bot) continue;
      const bars = [...on, ...Array(role === 'sparkle' || role === 'hum' ? 0 : ring).fill(true)];
      const line = backingLine({ role, bot, text, melody, pitch, bars, s, barSec, tempo, seq: nextSeq });
      if (!line) continue;
      nextSeq++;
      lines.push(line);
      emit({ seq: line.seq, t: 0, agent: 'chords', bot: 'White', status: 'working', beat: s.beat, summary: `${bot} sings the ${role}`, lyric: text, chords: [], action: '', consult: [] },
        line.at, { singer: bot, part: 'backing' });
    }
    // chorus 3: the hook in long notes floating above (a counter-melody: StorySong.cs Chorus3)
    if (s.section === 'chorus3' && homes.counter && s.lines[0]) {
      const hook = s.lines[0].rest;
      const segs = [];
      const hb = tuneBars('descant', syllabify(hook).length) || 2;
      for (let b = 0; b + hb <= s.bars; b += hb) {
        const r = tuneNotes({ melody: 'descant', syllableCount: syllabify(hook).length, chords: s.romans, role: 'third', voice: engineVoice(homes.counter), tempo, startBar: b, cadenceBar: s.cadenceBar });
        if (!r.notes.length) break;
        segs.push({ at: (s.start + b) * barSec + r.notes[0].t, job: cellJob(homes.counter, 'counter', hook, r.notes) });
      }
      if (segs.length) {
        const line = segmentsLine({ seq: nextSeq++, bot: homes.counter, role: 'counter', segs, s });
        lines.push(line);
        emit({ seq: line.seq, t: 0, agent: 'chords', bot: 'White', status: 'working', beat: s.beat, summary: `${homes.counter} floats the hook above`, lyric: hook, chords: [], action: '', consult: [] },
          line.at, { singer: homes.counter, part: 'backing' });
      }
    }
  }

  // ---- the mix: each line's level by its layer, the lift where nobody tells the story and the dip
  // under the story's syllables (song/mix.js)
  const spans = storySpans(lines, barSec), syl = syllableSpans(lines);
  for (const l of lines) Object.assign(l, layerGain(l, spans, syl));

  // in song order (stable: a line's harmony copies right after it)
  const order = out.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e);
  for (const e of order) if (e.with === undefined) delete e.with;
  const end = lines.reduce((m, l) => Math.max(m, lineEnd(l)), 0);
  return {
    events: order, lines, end, tempo, bar: barSec,
    sections: sections.map((s) => ({ beat: s.beat, section: s.section, kind: s.kind, t: s.start * barSec, bars: s.bars, chords: s.chords, tune: s.tune })),
  };
}

/** The song seconds a line's last note ends. */
export const lineEnd = (l) => (l.segments?.length
  ? Math.max(...l.segments.map((g) => g.at + g.job.notes.at(-1).t + g.job.notes.at(-1).dur))
  : l.at + l.job.notes.at(-1).t + l.job.notes.at(-1).dur);

/** The chord under a section's first pickup: the previous section's last bar's. */
function sectionsPrevChord(sections, s) {
  const i = sections.indexOf(s);
  return i > 0 ? sections[i - 1].chords.at(-1) : s.chords.at(-1);
}

/** A backing cell's job: its seed by singer and part, so the same bar on the same chord is one render. */
function cellJob(bot, role, text, notes) {
  const voice = engineVoice(bot);
  return {
    voice, text, mode: 'human', seed: hashString(`${bot}:${role}`) | 0, vibrato: jobVibrato(voice),
    notes: notes.map((n) => ({ t: n.t - notes[0].t, dur: n.dur, midi: n.midi, downbeat: onDownbeat(n.beat) })),
  };
}

/** A line made of segments (the backing): one job per bar; its own job holds all the notes (end, counts). */
function segmentsLine({ seq, bot, role, segs, s }) {
  const at = segs[0].at;
  const notes = segs.flatMap((g) => g.job.notes.map((n) => ({ ...n, t: n.t + g.at - at })));
  return { seq, bot, role, at, bars: s.bars, layer: 'backing', section: s.section, beat: s.beat, segments: segs, job: { ...segs[0].job, notes } };
}

/** A backing part of section `s`: a cell in every bar that is on (bar `s.bars` and after: the home chord, ringing out). */
function backingLine({ role, bot, text, melody, pitch, bars, s, barSec, tempo, seq }) {
  const n = syllabify(text).length;
  const voice = engineVoice(bot);
  const octave = role === 'bass' && voice === 'basso' ? 1 : 0; // the basso an octave up (RandomSong.cs Bass)
  const segs = [];
  bars.forEach((on, b) => {
    if (!on) return;
    const roman = b < s.bars ? s.romans[b] : 'I';
    const r = tuneNotes({ melody, syllableCount: n, chords: [roman], role: pitch, voice, tempo, octave });
    if (!r.notes.length || r.bars !== 1) return;
    segs.push({ at: (s.start + b) * barSec + r.notes[0].t, job: cellJob(bot, role, text, r.notes) });
  });
  return segs.length ? segmentsLine({ seq, bot, role, segs, s }) : null;
}
