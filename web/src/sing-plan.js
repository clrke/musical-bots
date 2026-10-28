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

export const TEMPO = 120;
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

/**
 * Plan every sung line of an episode.
 * @returns {Array<{seq:number, bot:string, at:number, bars:number, job:object}>}
 *   at: song seconds the line's first note sounds (the rendered buffer starts PRE earlier).
 */
export function planEpisode(events) {
  const lines = [];
  let chords = ['C', 'G', 'Am', 'F'];
  for (const e of events) {
    if (e.chords?.length) chords = e.chords;
    const text = (e.lyric || '').trim();
    if (!text) continue;
    const sylls = syllabify(text);
    if (!sylls.length) continue;
    const startBar = Math.ceil(e.t / BAR - 1e-9);
    const voice = engineVoice(e.bot);
    const romans = chords.map(romanOf);
    const { notes, bars } = generateNotes({
      melody: MELODY_OF[e.agent] ?? 'steady', syllableCount: sylls.length, chords: romans,
      role: 'lead', voice, key: 'C', tempo: TEMPO, startBar,
    });
    if (notes.length !== sylls.length) continue;
    const firstT = notes[0].t; // generateNotes times notes from the start of startBar
    const vs = VIBRATO_SCALE[voice] ?? { depth: 1, rate: 1 };
    lines.push({
      seq: e.seq, bot: e.bot, bars,
      at: startBar * BAR + firstT,
      job: {
        voice, text, mode: 'human', seed: hashString(`${e.bot}:${e.seq}`) | 0,
        vibrato: { rate: DEFAULT_VIBRATO.rate * vs.rate, depth: DEFAULT_VIBRATO.depth * vs.depth },
        notes: notes.map((n) => ({ t: n.t - firstT, dur: n.dur, midi: n.midi, downbeat: n.strong })),
      },
    });
  }
  return lines;
}
