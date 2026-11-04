// The story song's form (Soothing Bots: Magna.Core StoryForm.cs / StorySong.cs, ported as data and
// rules): eleven sections of eight bars, the chord progressions by what each section does in the
// story, the child tunes each section kind sings and the tempo. Pure and deterministic (seeded),
// shared by the generator (web/src/gen, which writes the chords into the bundle) and the arranger
// (web/src/sing-plan.js, which reads them back and picks the tunes from the same seed).
import { makeRng } from '../gen/rng.js';

/** The eleven sections, in song order (Schema.EXTENDED_SECTIONS). */
export const FORM = ['intro', 'verse1', 'verse1b', 'chorus1', 'verse2', 'verse2b', 'chorus2', 'bridge', 'bridge2', 'chorus3', 'outro'];
export const BARS_PER_SECTION = 8;

// ------------------------------------------------------------------ the meter (Soothing Bots v6: 6/4)

/**
 * The show's meter (Oct 31: the premiere and the making-of are sung in 6/4, Soothing Bots random song v6): six
 * quarter beats a bar, felt in two (two dotted-half pulses: beat 1 strongest, beat 4 strong, 2 3 5 6 weak).
 */
export const BEATS_PER_BAR = 6;
export const SIX_FOUR = 6;
/** Quarter beats a pulse (the dotted half: what bodies move on), pulses a bar (Meter.cs BeatsPerPulse, PulsesPerBar). */
export const beatsPerPulse = (meter = BEATS_PER_BAR) => (meter === SIX_FOUR ? 3 : 1);
export const pulsesPerBar = (meter = BEATS_PER_BAR) => (meter === SIX_FOUR ? 2 : 4);
/** Quarter beats a bar of a meter (Compile.BeatsOf: 6 -> 6, anything else -> 4). */
export const beatsOf = (meter) => (meter === SIX_FOUR ? 6 : 4);
/**
 * A block's timing (Compile.BlockTiming): the beat, the bar and the eight-bar section in seconds. Always pass the
 * meter (the old one-argument form meant 4/4).
 */
export function blockTiming(tempo, meter = BEATS_PER_BAR) {
  const bpm = tempo > 0 ? tempo : 96;
  const beatSec = 60 / bpm;
  const barSec = beatsOf(meter) * beatSec;
  return { tempo: bpm, beatSec, barSec, sectionSec: BARS_PER_SECTION * barSec };
}
/** 0-based { bar, beat } at t seconds of a section (Compile.BarBeatAt): in 6/4 the beat runs 0..5, index 3 is beat 4. */
export function barBeatAt(t, beatSec, meter = BEATS_PER_BAR) {
  const per = beatsOf(meter);
  const beats = Math.max(0, Math.floor(t / beatSec + 1e-9));
  const bar = Math.min(BARS_PER_SECTION - 1, Math.floor(beats / per));
  const beat = bar === BARS_PER_SECTION - 1 && beats >= BARS_PER_SECTION * per ? per - 1 : beats % per;
  return { bar, beat };
}
/** A strong beat (0-based beat in the bar): 6/4 beats 1 and 4 (the pulses), 4/4 beats 1 and 3. */
export const isStrongBeat = (beatInBar, meter = BEATS_PER_BAR) => {
  const b = ((beatInBar % beatsOf(meter)) + beatsOf(meter)) % beatsOf(meter);
  return meter === SIX_FOUR ? Math.abs(b) < 1e-6 || Math.abs(b - 3) < 1e-6 : Math.abs(b) < 1e-6 || Math.abs(b - 2) < 1e-6;
};
/**
 * The v5 tempo draw (88-100, a quarter of 4/4) as the 6/4 quarter (Factory.SixFourTempo): 132-136, so a 6/4 bar
 * lasts about as long as v5's (never longer than its longest, 88 BPM: 2.73 s).
 */
export const sixFourTempo = (tempo5) => 132 + Math.round((Math.max(88, Math.min(100, tempo5)) - 88) / 3);
/** The beat in a 6/4 bar where a split bar's second chord comes in (Melody.SPLIT_BEAT: beat 4). */
export const SPLIT_BEAT = 3;
/** Section kinds: what a section is musically (Schema.SectionKind). */
export const KINDS = ['intro', 'verse', 'chorus', 'bridge', 'outro'];

/** 'verse1b' -> 'verse', 'chorus3' -> 'chorus', 'bridge2' -> 'bridge'; anything else -> null. */
export function sectionKind(section) {
  const s = String(section ?? '').toLowerCase();
  if (s === 'verse1b' || s === 'verse2b') return 'verse';
  const kind = s.replace(/\d+[a-z]?$/, '');
  return KINDS.includes(kind) ? kind : null;
}

/** Choruses and the outro end on a cadence (bar 7 dominant, bar 8 home: Theory.IsCadenceSection). */
export const isCadenceSection = (section) => ['chorus', 'outro'].includes(sectionKind(section));

// ------------------------------------------------------------------ chords

/** Schema.PROGRESSIONS presets the story songs use (8 bars). */
const PRESET_CHORDS = {
  pop: ['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV'],
  doowop: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'IV', 'V'],
  ballad: ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'I', 'V'],
  lullaby: ['I', 'IV', 'V', 'I', 'I', 'IV', 'V', 'I'],
  gospel: ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I'],
};
/** StorySong.cs STORY_CHORDS. */
const STORY_CHORDS = {
  nursery: ['I', 'I', 'IV', 'I', 'IV', 'I', 'V', 'I'],
  march: ['I', 'I', 'V', 'I', 'I', 'I', 'V', 'I'],
  sway: ['I', 'V', 'I', 'V', 'I', 'IV', 'V', 'I'],
  plagal: ['IV', 'IV', 'I', 'I', 'IV', 'IV', 'V', 'V'],
  homeward: ['IV', 'I', 'IV', 'V', 'IV', 'I', 'ii', 'V'],
  wistful: ['IV', 'iv', 'I', 'vi', 'IV', 'iv', 'V', 'V'],
};
/** Version 3's own progressions (StorySong.cs TEMPLATE_CHORDS). */
const TEMPLATE_CHORDS = {
  't-porch': ['I', 'IV', 'I', 'V', 'I', 'IV', 'I', 'V'],
  't-open': ['I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'V'],
  't-sway': ['I', 'V', 'I', 'V', 'IV', 'I', 'IV', 'V'],
  't-walk': ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I'],
  't-lift': ['IV', 'V', 'I', 'vi', 'IV', 'V', 'V7', 'I'],
  't-lift-vi': ['vi', 'IV', 'I', 'V', 'IV', 'V', 'V7', 'I'],
  't-lift-iv': ['IV', 'I', 'V', 'vi', 'IV', 'I', 'V7', 'I'],
  't-pedal': ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'V', 'V'],
  't-secondary': ['vi', 'IV', 'ii', 'V', 'vi', 'IV', 'II', 'V'],
  't-borrowed': ['IV', 'iv', 'I', 'vi', 'ii', 'IV', 'V', 'V'],
  't-deceptive': ['IV', 'V', 'iii', 'vi', 'ii', 'IV', 'V', 'vi'],
  't-warm': ['IV', 'I', 'vi', 'V', 'IV', 'I', 'ii', 'V'],
  't-home': ['I', 'vi', 'IV', 'V', 'IV', 'I', 'IV', 'V'],
  't-cadence-ii': ['I', 'IV', 'I', 'V', 'I', 'ii', 'V7', 'I'],
  't-cadence-iv': ['I', 'vi', 'IV', 'V', 'I', 'IV', 'V7', 'I'],
  't-soft': ['I', 'IV', 'I', 'IV', 'I', 'vi', 'V7', 'I'],
  't-soft-iv': ['IV', 'I', 'IV', 'I', 'vi', 'I', 'V7', 'I'],
};
/** Version 4's progressions for its new sections (StoryForm.cs FORM_CHORDS). */
const FORM_CHORDS = {
  // building into the chorus: away from home, ending on V (a half cadence)
  't-build': ['IV', 'I', 'IV', 'V', 'vi', 'IV', 'ii', 'V'],
  't-ramp': ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'V', 'V'],
  't-turnaround': ['I', 'vi', 'ii', 'V', 'I', 'vi', 'ii', 'V'],
  't-climb': ['I', 'ii', 'iii', 'IV', 'I', 'IV', 'ii', 'V'],
  // bridge 2, suspense: climbing, the dominant held off, never home
  't-mount': ['ii', 'iii', 'IV', 'V', 'vi', 'IV', 'II', 'V'],
  't-hold': ['V', 'IV', 'V', 'vi', 'V', 'IV', 'II', 'V'],
  't-edge': ['IV', 'iv', 'ii', 'V', 'IV', 'iv', 'V', 'V'],
  't-false': ['IV', 'V', 'vi', 'IV', 'ii', 'V', 'vi', 'V'],
  // bridge 2, tender: warm, leaning on V into chorus 3
  't-glow': ['IV', 'V', 'iii', 'vi', 'ii', 'IV', 'I', 'V'],
  't-embrace': ['I', 'iii', 'IV', 'I', 'vi', 'IV', 'ii', 'V'],
  't-cradle': ['IV', 'I', 'IV', 'vi', 'IV', 'I', 'ii', 'V'],
  't-lean': ['vi', 'ii', 'IV', 'I', 'vi', 'ii', 'IV', 'V'],
};
const CHORDS = { ...PRESET_CHORDS, ...STORY_CHORDS, ...TEMPLATE_CHORDS, ...FORM_CHORDS };
/** The 8 romans of a progression id (as written; sectionRomans adds a chorus's / the outro's cadence). */
export const chordsOf = (id) => CHORDS[id] ?? PRESET_CHORDS.pop;

/**
 * The progression sets, by what a section does in the story (StorySong.cs TEMPLATE_PROGRESSIONS and
 * StoryForm.cs FORM_PROGRESSIONS): the intro sets the scene and ends on V; the verses narrate, home
 * on I; Verse A2 / B2 build to a half cadence (end on V into the chorus); the choruses are bright
 * (V7 -> I); chorus 3 lifts (starts away from home); bridge 1 by the episode's tag (suspense never
 * resolves, tender leans on V); bridge 2 the same tag from sets of its own; the outro is conclusive
 * (a predominant -> V7 -> I) or soft.
 */
export const PROGRESSION_SETS = {
  'intro:scene': ['t-porch', 'doowop', 't-open', 't-sway'],
  'verse:narrative': ['nursery', 'march', 'lullaby', 't-walk'],
  'verse:build': ['t-build', 't-ramp', 't-turnaround', 't-climb'],
  'chorus:bright': ['gospel', 'lullaby', 'pop', 'doowop'],
  'chorus3:lift': ['t-lift', 't-lift-vi', 't-lift-iv'],
  'bridge:suspense': ['t-pedal', 't-secondary', 't-borrowed', 't-deceptive'],
  'bridge:tender': ['ballad', 't-warm', 't-home'],
  'bridge2:suspense': ['t-mount', 't-hold', 't-edge', 't-false'],
  'bridge2:tender': ['t-glow', 't-embrace', 't-cradle', 't-lean'],
  'outro:conclusive': ['t-cadence-ii', 't-cadence-iv', 'lullaby', 'gospel'],
  'outro:soft': ['t-soft', 't-soft-iv'],
};

/**
 * The function set a section draws its progression from (StorySong.cs / StoryForm.cs ProgressionForSection, the
 * same choice progressionOf makes): Verse A2 / B2 build, chorus 3 lifts, the bridges and the outro by the tags.
 */
export function progressionSetOf(section, tags = {}) {
  const bridge = tags.bridge === 'suspense' ? 'suspense' : 'tender';
  const outro = tags.outro === 'soft' ? 'soft' : 'conclusive';
  switch (section) {
    case 'verse1b': case 'verse2b': return 'verse:build';
    case 'chorus3': return 'chorus3:lift';
    case 'bridge2': return `bridge2:${bridge}`;
    default: {
      const kind = sectionKind(section) ?? 'verse';
      return kind === 'intro' ? 'intro:scene' : kind === 'chorus' ? 'chorus:bright' : kind === 'bridge' ? `bridge:${bridge}`
        : kind === 'outro' ? `outro:${outro}` : 'verse:narrative';
    }
  }
}

/** The id of `romans` (as written) among a function set's progressions, else null. */
export function progressionIdIn(set, romans) {
  const key = (romans ?? []).join(' ');
  return (PROGRESSION_SETS[set] ?? []).find((id) => chordsOf(id).join(' ') === key) ?? null;
}

/**
 * An 8-bar progression fitted to a section of `bars` bars (one chord a bar), keeping how it ends: 8 bars or more
 * play its opening bars and then the whole progression; fewer play its opening and its last three bars (the
 * predominant, the dominant, the landing); two bars its last two. Then the cadence: a chorus or the outro ends
 * V7 -> I (sectionRomans), and so does the song's last section (`final`) whatever it is.
 */
export function fitRomans(romans, section, bars, { final = false } = {}) {
  const p = romans?.length ? romans : ['I'];
  const at = (i) => p[((i % p.length) + p.length) % p.length];
  const n = p.length;
  let o;
  if (bars >= n) o = [...Array.from({ length: bars - n }, (_, i) => at(i)), ...p];
  else if (bars >= 4) o = [...Array.from({ length: bars - 3 }, (_, i) => at(i)), at(n - 3), at(n - 2), at(n - 1)];
  else o = Array.from({ length: bars }, (_, i) => at(n - bars + i));
  if ((isCadenceSection(section) || final) && bars >= 2) { o[bars - 2] = CADENCE[0]; o[bars - 1] = CADENCE[1]; }
  return o;
}

/** The [bar 7, bar 8] a cadence section ends on. */
export const CADENCE = ['V7', 'I'];

/**
 * A section's bars of romans: its progression, counted from the section's first bar, and for a
 * chorus or the outro the cadence: V7 -> I in its last two bars (Compile.BlockRomans; the
 * progressions written for those sections already end that way). `romans`: the progression as
 * given (any length: cycled over the bars).
 */
export function sectionRomans(romans, section, bars = BARS_PER_SECTION) {
  const list = romans?.length ? romans : ['I'];
  const o = Array.from({ length: bars }, (_, b) => list[b % list.length]);
  if (isCadenceSection(section) && bars >= 2) { o[bars - 2] = CADENCE[0]; o[bars - 1] = CADENCE[1]; }
  return o;
}

// ------------------------------------------------------------------ chord names (key of C, or a lifted key)

const NAME_OF = {
  I: 'C', ii: 'Dm', iii: 'Em', IV: 'F', V: 'G', vi: 'Am', vii: 'Bdim', II: 'D', III: 'E', iv: 'Fm', V7: 'G7', III7: 'E7', bVII: 'Bb',
};
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** The keys a section may be sung in, by semitones above C (a lifted chorus: 'D'). */
export const keyName = (lift = 0) => FLATS[(((Math.round(lift) || 0) % 12) + 12) % 12];
const SHARP_KEY = new Set(['G', 'D', 'A', 'E', 'B']);
const STEP = [0, 2, 4, 5, 7, 9, 11];
const DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const SUFFIX_NAME = { '': '', 7: '7', maj7: 'maj7', sus4: 'sus4', sus2: 'sus2', dim: 'dim', 6: '6', add9: 'add9' };
/**
 * A roman as a chord name ('ii' -> 'Dm', 'V7' -> 'G7'; in D: 'Em', 'A7'; '♭VI' spelled flat: 'Bb' in D); unknown -> the
 * key's tonic. In C the names are as they always were.
 */
export function chordName(roman, key0 = 'C') {
  // (a key is a name: `.map(chordName)` hands the index here, still C)
  const key = typeof key0 === 'string' && (FLATS.includes(key0) || SHARPS.includes(key0)) ? key0 : 'C';
  if (key === 'C' && NAME_OF[roman]) return NAME_OF[roman];
  const m = /^([b#]?)([ivIV]+)(.*)$/.exec(String(roman ?? ''));
  const d = m ? DEGREES.indexOf(m[2].toUpperCase()) : -1;
  const tonic = FLATS.indexOf(key) >= 0 ? FLATS.indexOf(key) : SHARPS.indexOf(key) >= 0 ? SHARPS.indexOf(key) : 0;
  if (!m || d < 0 || !(m[3] in SUFFIX_NAME)) return FLATS[tonic];
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const pc = (((tonic + STEP[d] + acc) % 12) + 12) % 12;
  const names = acc < 0 ? FLATS : acc > 0 || SHARP_KEY.has(key) ? SHARPS : FLATS;
  const minor = m[2] !== m[2].toUpperCase() && m[3] !== 'dim';
  return names[pc] + (minor ? 'm' : '') + SUFFIX_NAME[m[3]];
}

/** A roman as the readout writes it: flats and sharps as signs, a secondary dominant by what it leads to ('II7' -> 'V7/V'). */
const SECONDARY_LABEL = { I7: 'V7/IV', II7: 'V7/V', III7: 'V7/vi', VI7: 'V7/ii', II: 'V/V' };
export const romanLabel = (roman) => SECONDARY_LABEL[roman] ?? String(roman ?? '').replace(/^b/, '♭').replace(/^#/, '♯');

/** The progression a section's written romans are (an id of any set), else null (the director's own). */
export function progressionIdOf(romans, set = null) {
  if (set) { const id = progressionIdIn(set, romans); if (id) return id; }
  const key = (romans ?? []).join(' ');
  return Object.keys(CHORDS).find((id) => CHORDS[id].join(' ') === key) ?? null;
}
/** A section as the readout names it ('verse1b' -> 'verse 1, build', 'chorus3' -> 'chorus 3'). */
export const sectionLabel = (section) => {
  const m = /^([a-z]+?)(\d*)(b?)$/.exec(String(section ?? ''));
  return m ? `${m[1]}${m[2] ? ` ${m[2]}` : ''}${m[3] ? ', build' : ''}` : String(section ?? '');
};
/** A progression id as the readout names it ('t-lift-vi' -> 'lift vi', 'doowop' -> 'doo-wop'). */
export const progressionLabel = (id) => (id ? ({ doowop: 'doo-wop' }[id] ?? String(id).replace(/^t-/, '').replace(/-/g, ' ')) : 'own changes');

// ------------------------------------------------------------------ variation (the arranger's: no section sung the same way twice)

/**
 * How each section's authentic cadence is approached (6/4's split bar 7: [its first chord, its beat-4 chord] before the
 * home bar): the verses on ii, chorus 1 on IV (held from bar 6 when it is there: the gospel ending), chorus 2 on the
 * borrowed minor iv, the lifted chorus 3 on the double dominant (V7/V), each then V7 -> I; the outro's ending its own:
 * conclusive ♭VI ♭VII -> I (bar 6 the IV before it, unless it is I, IV or vi), soft IV iv -> I. The first choice that is
 * not the bar before's own chord (no chord held into the cadence) unless it is the only one.
 */
export const CADENCE_APPROACH = {
  verse1: [['ii', 'V7'], ['IV', 'V7']], verse2: [['ii', 'V7'], ['IV', 'V7']],
  chorus1: [['IV', 'V7']], chorus2: [['iv', 'V7'], ['ii', 'V7']], chorus3: [['II7', 'V7'], ['IV', 'V7']],
  'outro:conclusive': [['bVI', 'bVII', 'IV']], 'outro:soft': [['IV', 'iv']],
};
/**
 * How each section's half cadence is held (its last bar, written V: [downbeat, beat 4]): the intro V then V7, Verse A2
 * Vsus4 resolving to V7 into chorus 1, Verse B2 V7/V then V7 into chorus 2; a bridge V then V7.
 */
export const HALF_CADENCE = { verse1b: ['Vsus4', 'V7'], verse2b: ['II7', 'V7'] };
/** Before a lifted chorus (a key change up LIFT semitones): the bar pivots, Vsus4 then V (the old V is the new key's IV). */
export const PIVOT = ['Vsus4', 'V'];
/** Semitones the song's last chorus (and what follows it) is lifted: up a whole step. */
export const LIFT = 2;
/** The sections sung a second time: re-harmonized (reharmonize) so they are heard again, not the same. */
export const SECOND_TIME = new Set(['verse2', 'verse2b', 'chorus2']);

const SECONDARY = { IV: 'I7', ii: 'VI7', vi: 'III7', V: 'II7', V7: 'II7' };
/**
 * The tone that makes a coloured chord heard, which a pad sings in its bars (else a C7 would be sung as plain C, and the
 * readout would name a chord nobody sings): a secondary dominant on I its seventh (C7's Bb), the borrowed and altered
 * chords their third (Fm's Ab, D7's F#, Bb's D), a sus4 its fourth (which the dominant's third resolves on beat 4).
 */
export const COLOR_TONE = { I7: 'seventh', II7: 'third', III7: 'third', VI7: 'third', iv: 'third', bVI: 'third', bVII: 'third', Vsus4: 'third', II: 'third', III: 'third' };
/**
 * A progression heard a second time, re-harmonized (a pure function of the romans): a bar of I after I becomes vi (the
 * relative minor), one chord before IV / ii / vi / V becomes its secondary dominant (I7, VI7, III7, II7: the push into
 * it, the one nearest the end), and if there is room a IV before I becomes the borrowed iv (the minor plagal). At most
 * `max` bars change, never before `from` (the section opens on its progression) nor in the last `locked` (its ending).
 * Returns { romans, changed (the bars changed) }.
 */
export function reharmonize(romans, { max = 2, from = 1, locked = 2, avoid = [] } = {}) {
  const r = [...(romans ?? [])];
  const n = r.length, changed = [];
  // (avoid: chords the section's ending sings already, e.g. the V7/V of a half cadence: never twice)
  const free = (i) => i >= from && i < n - locked && !changed.includes(i);
  for (let i = from; i < n && changed.length < max; i++) if (free(i) && r[i] === 'I' && r[i - 1] === 'I' && !changed.includes(i - 1)) { r[i] = 'vi'; changed.push(i); }
  for (let i = n - locked - 1; i >= from && changed.length < max; i--) {
    const to = r[i + 1], sec = SECONDARY[to];
    if (!free(i) || !sec || avoid.includes(sec) || changed.includes(i + 1) || r[i] === to || !['I', 'iii', 'vi', 'IV', 'ii'].includes(r[i])) continue;
    r[i] = sec;
    changed.push(i);
    break;
  }
  if (!avoid.includes('iv')) for (let i = from; i < n - 1 && changed.length < max; i++) if (free(i) && r[i] === 'IV' && r[i + 1] === 'I') { r[i] = 'iv'; changed.push(i); break; }
  return { romans: r, changed: changed.sort((a, b) => a - b) };
}

/**
 * A section's bars as the arranger sings them (6/4): its written romans (sectionRomans: the cadence a chorus or the outro
 * ends on), the second time round re-harmonized, then the bars that split (two chords: the ending's approach,
 * CADENCE_APPROACH; a half cadence's last bar, HALF_CADENCE; `pivot`: the bar before a lifted chorus, PIVOT). 4/4 and
 * anything not named: splitRomans as ever. Returns { romans, splits, changed (bars re-harmonized), pivoted (its last bar
 * the pivot: a section that comes home on I does not pivot) }.
 */
export function harmonize(written, { section, meter = BEATS_PER_BAR, again = false, pivot = false, tags = {} } = {}) {
  const r = [...(written ?? [])];
  const n = r.length;
  if (meter !== SIX_FOUR || n < 2) return { ...splitRomans(r, meter), changed: [] };
  const splits = r.map(() => null);
  const dominant = (x) => x === 'V' || x === 'V7';
  let locked = 1, pivoted = false;
  if (r[n - 1] === 'I' && dominant(r[n - 2])) {
    const key = sectionKind(section) === 'outro' ? `outro:${tags.outro === 'soft' ? 'soft' : 'conclusive'}` : section;
    const options = CADENCE_APPROACH[key] ?? [['ii', 'V7']];
    const [pre, dom, lead] = options.find(([p]) => p !== r[n - 3]) ?? options[0];
    r[n - 2] = pre;
    splits[n - 2] = dom;
    locked = 2;
    // (an ending that needs its lead-in: the outro's ♭VI ♭VII after a IV, not after ii or V)
    if (lead && n >= 3 && !['I', 'IV', 'vi', lead].includes(r[n - 3])) { r[n - 3] = lead; locked = 3; }
  } else if (pivot) {
    if (r[n - 1] === 'V') [r[n - 1], splits[n - 1]] = PIVOT;
    else splits[n - 1] = PIVOT[1];
    pivoted = true;
  } else if (r[n - 1] === 'V') [r[n - 1], splits[n - 1]] = HALF_CADENCE[section] ?? ['V', 'V7'];
  let changed = [];
  if (again) {
    const ending = [...r.slice(n - locked), ...splits.filter(Boolean)];
    const v = reharmonize(r, { locked, avoid: [...ending, ...(r.includes('iv') ? ['iv'] : [])] });
    for (const i of v.changed) r[i] = v.romans[i];
    changed = v.changed;
  }
  return { romans: r, splits, changed, pivoted };
}

// ------------------------------------------------------------------ tunes

/** The child melodies (Melody.CHILD_TUNES, MelodyChild.cs). */
export const CHILD_TUNES = ['nursery', 'bouncy', 'rocking', 'march', 'risefall', 'arch', 'chant', 'pentatonic', 'anthem', 'callback'];
/** The tunes each section kind draws its lead melody from (StorySong.cs STORY_TUNES). */
export const STORY_TUNES = {
  verse: ['nursery', 'bouncy', 'march', 'chant', 'callback', 'risefall'],
  chorus: ['anthem', 'bouncy', 'nursery', 'march', 'pentatonic', 'chant'],
  bridge: ['rocking', 'arch', 'risefall', 'pentatonic'],
  intro: ['rocking', 'arch', 'pentatonic', 'nursery'],
  outro: ['rocking', 'arch', 'pentatonic', 'nursery'],
};
/** Bridge 2's tunes by the bridge tag (StoryForm.cs BRIDGE2_TUNES): suspense rises, tender stays gentle. */
export const BRIDGE2_TUNES = { suspense: ['risefall', 'anthem', 'arch'], tender: ['arch', 'rocking', 'pentatonic', 'risefall'] };

/** The story echo's shapes, in the order a part's answers go through them (Schema.ECHO_SHAPES). */
export const ECHO_SHAPES = ['repeat', 'third', 'fragment', 'invert', 'sigh', 'stepup', 'sixth', 'answer', 'neighbor', 'augment', 'stepdown', 'rise'];

/** The tempo range of a story song's draw (StorySong.cs ChooseTempo: 88-100 BPM, a 4/4 quarter). */
export const TEMPO_RANGE = [88, 100];
/** The range it is sung at in 6/4 (sixFourTempo). */
export const SIX_FOUR_TEMPO_RANGE = [132, 136];

const pickFrom = (rng, list, not = []) => {
  const ok = list.filter((x) => !not.includes(x));
  return rng.pick(ok.length ? ok : list);
};

/**
 * Everything a story song draws from its seed (StorySong.cs ChooseStyle + StoryForm.cs
 * ChooseFormStyle): the tempo, each section's tune, each section's progression id and the backing's
 * syllables and chord tones. tags: { bridge: 'suspense'|'tender', outro: 'conclusive'|'soft' }.
 */
export function chooseStyle(seed, tags = {}) {
  const rng = makeRng(`story song ${seed ?? ''}`);
  const bridgeTag = tags.bridge === 'suspense' ? 'suspense' : 'tender';
  const outroTag = tags.outro === 'soft' ? 'soft' : 'conclusive';
  // the v5 draw (88-100), sung in 6/4 at its quarter (132-136: StorySong.ChooseTempo + SixFourTempo)
  const tempo5 = TEMPO_RANGE[0] + Math.floor(rng() * (TEMPO_RANGE[1] - TEMPO_RANGE[0] + 1));
  const meter = BEATS_PER_BAR;
  const tempo = meter === SIX_FOUR ? sixFourTempo(tempo5) : tempo5;
  // the tunes: a chorus shape, verse shapes for A and B (two others), a bridge shape unlike them all,
  // intro and outro on gentle ones (different from each other), bridge 2 by the tag
  const t = {};
  t.chorus = pickFrom(rng, STORY_TUNES.chorus);
  t.verse = pickFrom(rng, STORY_TUNES.verse, [t.chorus]);
  t.verse2 = pickFrom(rng, STORY_TUNES.verse, [t.chorus, t.verse]);
  t.bridge = pickFrom(rng, STORY_TUNES.bridge, [t.chorus, t.verse, t.verse2]);
  t.intro = pickFrom(rng, STORY_TUNES.intro);
  t.outro = pickFrom(rng, STORY_TUNES.outro, [t.intro]);
  t.bridge2 = pickFrom(rng, BRIDGE2_TUNES[bridgeTag], [t.bridge, t.chorus]);
  // the progressions
  const P = (set, ...not) => pickFrom(rng, PROGRESSION_SETS[set], not);
  const p = {};
  p.chorus = P('chorus:bright');
  p.verse = P('verse:narrative', p.chorus);
  p.chorus3 = P('chorus3:lift');
  p.bridge = P(`bridge:${bridgeTag}`);
  p.intro = P('intro:scene', p.verse, p.chorus);
  p.outro = P(`outro:${outroTag}`, p.chorus);
  p.build = P('verse:build', p.chorus, p.verse);
  p.bridge2 = P(`bridge2:${bridgeTag}`, p.bridge);
  // the backing (StorySong.cs ChooseStyle): a soft "doo" / "boop" groove, "Bom" bass, held vowels
  const backing = {
    rhythmText: rng.pick(['Doo, dee, doo, dee', 'Boop, boop, boop, boop', 'Dum dum dee dum']),
    rhythmMelody: rng.pick(['offbeat', 'staccato']),
    rhythmPitch: rng.pick(['root', 'fifth']),
    bassVowel: rng.pick(['Ooh', 'Mm']),
    lowHarmonyPitch: rng.pick(['fifth', 'root']),
    padVowel: rng.pick(['Ooh', 'Mm']),
    padPitch: rng.pick(['fifth', 'third']),
    echoShape: Math.floor(rng() * ECHO_SHAPES.length),
  };
  return { seed, tempo, tempo5, meter, tags: { bridge: bridgeTag, outro: outroTag }, tunes: t, progressions: p, backing, rng };
}

/** The tune a section's lead sings (A2 and B2 reuse A1's and B1's: StoryForm.cs). */
export function tuneOf(style, section) {
  const t = style.tunes;
  switch (section) {
    case 'intro': return t.intro;
    case 'verse1': case 'verse1b': return t.verse;
    case 'verse2': case 'verse2b': return t.verse2;
    case 'bridge': return t.bridge;
    case 'bridge2': return t.bridge2;
    case 'outro': return t.outro;
    default: return sectionKind(section) === 'chorus' ? t.chorus : sectionKind(section) === 'bridge' ? t.bridge : t.verse;
  }
}

/** The progression id a section plays (FormProgression / ProgressionForSection). */
export function progressionOf(style, section) {
  const p = style.progressions;
  switch (section) {
    case 'verse1b': case 'verse2b': return p.build;
    case 'bridge2': return p.bridge2;
    case 'chorus3': return p.chorus3;
    default: {
      const kind = sectionKind(section) ?? 'verse';
      return p[kind] ?? p.verse;
    }
  }
}

/** A section's 8 romans from the style (its progression with the chorus / outro cadence). */
export const styleRomans = (style, section) => sectionRomans(chordsOf(progressionOf(style, section)), section);

/**
 * 6/4's two chords a bar, at cadences and turnarounds only (Compile.BlockRomans(block, 6) / BlockSplitRomans): a
 * section that ends V|V7 -> I (an authentic cadence: the choruses, the outro, a verse that comes home) plays bar 7 as
 * ii then V7 on beat 4; one that ends on V (a half cadence: the intro, the build verses, a bridge on V) plays its last
 * bar V then V7. Anything else: one chord a bar. The written romans are never changed (the splits are derived).
 * @returns {{ romans: string[], splits: Array<string|null> }} the first chord of each bar and the beat-4 chord (or null)
 */
export function splitRomans(romans, meter = BEATS_PER_BAR) {
  const r = [...(romans ?? [])];
  const splits = r.map(() => null);
  const n = r.length;
  if (meter !== SIX_FOUR || n < 2) return { romans: r, splits };
  const dominant = (x) => x === 'V' || x === 'V7';
  if (r[n - 1] === 'I' && dominant(r[n - 2])) { r[n - 2] = 'ii'; splits[n - 2] = 'V7'; }
  else if (r[n - 1] === 'V') splits[n - 1] = 'V7';
  return { romans: r, splits };
}
