// Episode events -> sung lines for the Magna Vocalization voice engine (web/src/mv, a verbatim
// copy of ~/Projects/web/magna-vocalization's voice + melody code plus the Unity app's five extra
// voices). Pure and deterministic, so the browser (worker pool) and node tests plan identically.
//
// Timing: one shared song clock at TEMPO with one chord per bar. A line starts on the first bar
// line at or after its event (the voice never leads its lyric card), so its melody follows the
// chords of the bars it actually lands on, the same chords the pad plays.
import { syllabify } from './mv/voice/syllables.js';
import { generateNotes } from './mv/music/melody.js';
import { VIBRATO_SCALE } from './mv/voice/voice.js';
import { DEFAULT_VIBRATO } from './mv/voice/sing.js';
import { CAST } from './gen/cast.js';
import { hashString } from './gen/rng.js';

export const TEMPO = 132;
export const BEAT = 60 / TEMPO;
export const BAR = 4 * BEAT;

// Musical Bots voice classes -> engine voices (the Unity cast uses 'woman' for its altos).
const VOICE_OF = { alto: 'woman' };
export const engineVoice = (bot) => {
  const v = CAST[bot]?.voice ?? 'alto';
  return VOICE_OF[v] ?? v;
};

// Chord names (C, Am, Dm, G7 ...) -> roman numerals in C, the engine's chord language.
const DEGREE = { C: 'I', D: 'II', E: 'III', F: 'IV', G: 'V', A: 'VI', B: 'VII' };
export function romanOf(name) {
  const m = /^([A-G])(m(?!aj))?(.*)$/.exec(String(name).trim());
  if (!m) return 'I';
  const r = DEGREE[m[1]];
  return (m[2] ? r.toLowerCase() : r) + (m[3].includes('7') ? '7' : '');
}

// Melody per production role: the lyricist states the tune plainly, hype pushes, comedy swings.
const MELODY_OF = {
  lyrics: 'steady', chords: 'rising', dance: 'syncopated', hype: 'syncopated',
  comedy: 'lilting', deals: 'falling', lighting: 'lilting',
};

/** Chord name at song bar `bar` given the chord list in force (the pad uses the same rule). */
export const chordAtBar = (chords, bar) => (chords.length ? chords[((bar % chords.length) + chords.length) % chords.length] : 'C');

/** One sung line of event e starting at song bar startBar (null when it cannot be sung). */
function planLine(e, chords, startBar, role = 'lead', melody = null) {
  const text = (e.lyric || '').trim();
  if (!text) return null;
  const sylls = syllabify(text);
  if (!sylls.length) return null;
  const voice = engineVoice(e.bot);
  // the words' stress shapes the rhythm (sub-phrases split for the words, onsets fitted: melody.js)
  const { notes, bars } = generateNotes({
    melody: melody ?? MELODY_OF[e.agent] ?? 'steady', syllableCount: sylls.length, chords: chords.map(romanOf),
    role, voice, key: 'C', tempo: TEMPO, startBar, syllables: sylls, stress: sylls.map((s) => s.stress),
  });
  if (notes.length !== sylls.length) return null;
  const firstT = notes[0].t; // generateNotes times notes from the start of startBar
  const vs = VIBRATO_SCALE[voice] ?? { depth: 1, rate: 1 };
  // the accent is the bar's downbeat only (as Magna.Core Compile): a note the stress fit moved off
  // a downbeat (an anticipation held over it) still carries it
  const onDownbeat = (beat) => Math.abs(((beat % 4) + 4) % 4) < 1e-6 || Math.abs((((beat % 4) + 4) % 4) - 4) < 1e-6;
  return {
    seq: e.seq, bot: e.bot, bars, role,
    at: startBar * BAR + firstT,
    job: {
      voice, text, mode: 'human', seed: hashString(`${e.bot}:${e.seq}`) | 0,
      vibrato: { rate: DEFAULT_VIBRATO.rate * vs.rate, depth: DEFAULT_VIBRATO.depth * vs.depth },
      notes: notes.map((n) => ({
        t: n.t - firstT, dur: n.dur, midi: n.midi,
        downbeat: onDownbeat(n.beat) || (n.shift !== 0 && onDownbeat(n.beat - n.shift)),
      })),
    },
  };
}

/**
 * LIVE planning: every line starts on the first bar line at or after its event as it arrives
 * (lines may overlap; the choir ducks the earlier ones).
 * @returns {Array<{seq:number, bot:string, at:number, bars:number, job:object}>}
 *   at: song seconds the line's first note sounds (the rendered buffer starts PRE earlier).
 */
export function planEpisode(events) {
  const lines = [];
  let chords = ['C', 'G', 'Am', 'F'];
  for (const e of events) {
    if (e.chords?.length) chords = e.chords;
    const line = planLine(e, chords, Math.ceil(e.t / BAR - 1e-9));
    if (line) lines.push(line);
  }
  return lines;
}

/** Harmony roles for the 2nd, 3rd ... bot singing the same line. */
const HARMONY = ['third', 'fifth', 'bass', 'octave'];
export const CARD_LEAD = 0.45; // the lyric card (and the bot's turn) comes up this long before the voice
export const SECTION_GAP = 1; // bars of pad between sections

/**
 * The performance: the episode arranged as a song. Lines are sung one after another on the bar
 * grid (no two solos at once); consecutive events of one beat with the same lyric become one
 * line sung together in harmony (lead + third + fifth ...); a bar of pad between sections. The
 * returned events are the bundle's own, re-timed to the song (t = card time), so captions,
 * moves and camera follow the singing. The bundle's authoring times are left untouched.
 * @returns {{events: object[], lines: object[], end: number}} end: song seconds the last voice ends
 */
export function arrange(events) {
  const out = [], lines = [];
  let chords = ['C', 'G', 'Am', 'F'];
  let bar = 1; // one bar of pad first
  let section = null;
  for (let i = 0; i < events.length; ) {
    const e = events[i];
    // the group: this event plus the following ones of the same beat with the same lyric
    let j = i + 1;
    while (j < events.length && events[j].beat === e.beat && e.lyric && events[j].lyric === e.lyric) j++;
    const group = events.slice(i, j);
    if (e.chords?.length) chords = e.chords;
    if (section !== null && e.beat !== section) bar += SECTION_GAP;
    section = e.beat;
    const lead = planLine(e, chords, bar);
    if (!lead) {
      for (const g of group) out.push({ ...g, t: Math.max(0, bar * BAR - CARD_LEAD) });
      i = j;
      continue;
    }
    const melody = MELODY_OF[e.agent] ?? 'steady';
    lines.push(lead);
    group.forEach((g, k) => {
      if (k > 0) {
        const h = planLine({ ...g, lyric: e.lyric }, chords, bar, HARMONY[(k - 1) % HARMONY.length], melody);
        if (h) lines.push(h);
      }
      out.push({ ...g, t: Math.max(0, lead.at - CARD_LEAD) });
    });
    bar += lead.bars;
    i = j;
  }
  const end = lines.reduce((m, l) => Math.max(m, l.at + l.job.notes.at(-1).t + l.job.notes.at(-1).dur), 0);
  return { events: out, lines, end };
}
