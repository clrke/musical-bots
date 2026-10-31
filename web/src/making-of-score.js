// The making-of as a musical number: the crew's events become a song on the premiere's engine (song/form.js,
// song/tunes.js, song/mix.js). Every role bot sings its thought (the event's summary: since Oct 31 a line said to a
// crewmate, "White, is G too bright here?", sung as written and to that bot, never to the viewer; older bundles' in
// the team's voice, "we") on a child tune in its own voice; Green sings the lines he proposes on the tune the
// premiere gives them, so the song
// is heard taking shape; a consultation is a duet: the asker glides over and sings its question, the bot it asks
// sings its answer (the event that answers it), and a hand play seals it (a handshake, a high five, a fist bump, a
// pinky promise, both singing the word). The crew bots who do not sing the phrase sing the backing under it ("Ooh"
// and "Ah" pads, a "Mm" on the root, "Bom, bom" in the livelier sections) and now and then answer a line in its
// gap, in the room ("Yeah!", "Uh-huh!", "Nice!", to a question "Hmm!"; to Green's line its last words). A thought
// that names a crewmate is said to it: the singer turns to that bot, which looks back and nods (staged event `to`).
// While they think, the bots gesture (chin-stroke, scratch-head,
// count-beats, binoculars ...), deterministic by the event.
//
// The form. Each beat of the episode is a section of the making-of, named as the premiere's (intro, verse1 ...
// outro), its progression from the section's function set (form.js PROGRESSION_SETS: the episode's own when the
// arranger wrote one of the set, else one drawn from the episode's seed), one chord a bar, fitted to the section's
// length so it ends as the set does: the intro, the build verses and the bridges on V (a half cadence into the next
// section), the choruses and the outro V7 -> I (the outro's predominant before), the song on I.
//
// The tunes. The groove runs at MAKING_OF_TEMPO, four beats a bar, one chord a bar (Oct 31, owner: "the song should
// be sung in normal speaking speed"; before, the tunes ran in double time over a two-beat bar, ~3.5 syllables/s).
// The tunes' beat is the groove's eighth (a tune bar is half a bar of the groove, beats 1-2 or 3-4), so a line of
// the crew's talk, up to seven syllables, takes a bar: the child tunes of tunes.js sung as talk (tuneNotes talk:
// nothing quicker than an eighth of the groove, 0.34 s, so at most ~2.9 syllables/s), chord tones on the strong
// beats, the words' stress fitted (StressFit, by a 32nd at most), a weak first syllable ("We") as the pickup into
// the bar line, a crewmate's name on a strong beat and held a quarter (tuneNotes hold; at the line's end, its last
// note held). A question asks (ends open, on so), its answer and a section's last line walk home to do; a thought
// asks or answers by the chord its line ends on (open on V, home on IV / vi, by turns on I).
//
// Pacing. Every thought and every consultation is sung; within a beat Green's new lines alternate with the crew's
// thoughts (call and response); a line the song already has is not sung again; a recorded making-of keeps to
// MAX_SECONDS by leaving out Green's later lines of a beat (the first new line of every beat always stays), then (a
// talkative crew) as few remarks as it takes (remarksToSkip: never a question, an answer, a beat's first thought or
// one the next thought reacts to); live, the backlog decides. Idle time is gone: the score runs bar after bar.
//
// Pure and deterministic (no clock, no Math.random): the browser plays the same score every time, and node tests
// read it. Used by making-of.js (the replay: scoreMakingOf; live: new MakingOfScore().add as events arrive).
import { syllabify } from './mv/voice/syllables.js';
import { voiceRange, chordFromRoman, mod12 } from './mv/music/theory.js';
import { VOICES } from './mv/model/schema.js';
import { VIBRATO_SCALE } from './mv/voice/voice.js';
import { DEFAULT_VIBRATO } from './mv/voice/sing.js';
import { CAST, NAMES, AGENT_BOT } from './gen/cast.js';
import { hashString } from './gen/rng.js';
import { parseLyric, namesIn } from './cues.js';
import { resolveAction } from './actions.js';
import { engineVoice, romanOf, arrange, CARD_LEAD } from './sing-plan.js';
import { sungSummary, TALK } from './team-voice.js';
import { wordCue } from './staging.js';
import {
  FORM, sectionKind, isCadenceSection, chooseStyle, tuneOf, progressionOf, chordsOf, chordName, progressionSetOf, progressionIdIn, fitRomans,
} from './song/form.js';
import { tuneNotes, holdBars, replyNotes, echoOf, echoShape, pickupPitches, TALK_MIN_IOI } from './song/tunes.js';
import { layerGain, storySpans, syllableSpans } from './song/mix.js';

/** The making-of's groove: four beats a bar, one chord a bar (the vamp's half bar, two beats, is a tune bar). */
export const MAKING_OF_TEMPO = 88;
/** The tunes' tempo: their beat is the groove's eighth (a tune bar is half a bar of the groove). */
export const TUNE_TEMPO = 2 * MAKING_OF_TEMPO;
/** Tune bars a bar of the groove (one chord). */
export const HALVES = 2;
/** A recorded making-of is told in at most this many seconds (Green's later lines of a beat give way first). */
export const MAX_SECONDS = 210;
/** The crew: the seven role bots, left to right as the studio camera sees them in the making-of. */
export const CREW = ['Pink', 'Blue', 'White', 'Green', 'Gold', 'Gray', 'Yellow'];
const ROLE_OF = Object.fromEntries(Object.entries(AGENT_BOT).map(([agent, bot]) => [bot, agent]));

// the grid (tune beats; a tune bar is four, half a bar of the groove: everything below is a whole number of the
// groove's bars, an even number of tune bars, so the phrases start on its bar lines)
const BAR = 4;
const COUNT_IN = 2; //    tune bars of the intro's backing before the first phrase
const RING = 2; //        tune bars the home chord rings after the last phrase
const SEAL_BARS = 2; //   the hand play that seals a duet
const MIN_BARS = 2; //    a line takes two tune bars (a bar of the groove) at least (Arrangement.MinLineBars)
const PICKUP_ONE = 1; //  a one-syllable pickup: a tune beat before the bar line (an eighth of the groove)
const PICKUP_EACH = TALK_MIN_IOI; // more: this long each (no syllable shorter than 0.25 s)
const MAX_NAME_PICKUP = 2; // the words before a name that opens a line ("Yes, | Gold ...") sung as its pickup
const PICKUP_GAP = 0.1, PICKUP_MIN_LAST = 0.25; // the phrase before a pickup ends this long before it, its last note this long at least
const NAME_MIN_LAST = 1.75; // a line that ends on a crewmate's name holds it this long at least (no pickup cuts it)
const MAX_PICKUP = 1; //  weak syllables a thought sings before the bar line ("We | ask White ...")
const STAGED_BASE = 100000; // staged events' seq (the bundle's own seqs stay on `src`)
const LIVE_SLACK = 6; // s: live, Green's other new lines are sung while the score is less than this far ahead
const LIVE_WAIT = 8; //  events: live, a question waits this long for its answer before a stand-in answers
/** The tunes the crew's talk is not sung on (their eighths would be sixteenths of the groove, under 0.25 s): their stand-ins. */
const TOO_QUICK = { chant: 'march', callback: 'bouncy' };
/** A gap answer's syllables are this long at least (tune beats). */
const ECHO_MIN_NOTE = TALK_MIN_IOI;
/**
 * A gap answer (the echo layer): a crewmate's reaction to what was just said, in the room (never to the viewer):
 * to a thought one of these (to a question: QUESTION_REPLIES), to Green's line or a chorus its last words when short.
 */
export const INTERJECTIONS = ['Yeah!', 'Uh-huh!', 'Oh yes!', 'Nice!', 'Ooh, nice!', 'Right!'];
export const QUESTION_REPLIES = ['Hmm!', 'Ooh!', 'Good one!'];
const ECHO_MAX_SYLLABLES = 2;
const ECHO_FROM = 2; //   the echo starts on beat 3 of the line's last bar (the line's last note cut before it)
const ECHO_END = 3.85; // and ends by the bar's end (before the next pickup)
const LEAD_CUT = 1.75; // the line's last note before an echo ends here (it starts by beat 2)
/** The backing parts by section kind: [role, syllables, template, chord tone] (StorySong.cs, the making-of's own). */
const BACKING = {
  intro: [['pad', 'Ooh', 'sustain', 'pad'], ['lowpad', 'Mm', 'sustain', 'root'], ['bass', 'Ooh', 'sustain', 'bass']],
  verse: [['bass', 'Bom, bom', 'staccato', 'bass'], ['pad', 'Ooh', 'sustain', 'pad'], ['lowpad', 'Mm', 'sustain', 'root']],
  build: [['bass', 'Bom, bom', 'staccato', 'bass'], ['pad', 'Ooh', 'sustain', 'pad'], ['pad2', 'Ah', 'sustain', 'pad2'], ['lowpad', 'Mm', 'sustain', 'root']],
  chorus: [['bass', 'Bom, bom', 'staccato', 'bass'], ['pad', 'Ah', 'sustain', 'pad'], ['pad2', 'Ooh', 'sustain', 'pad2'], ['lowpad', 'Mm', 'sustain', 'root']],
  bridge: [['bass', 'Ooh', 'sustain', 'bass'], ['pad', 'Ooh', 'sustain', 'pad'], ['lowpad', 'Mm', 'sustain', 'root'], ['hum', 'Mm', 'sustain', 'pad2']],
  outro: [['bass', 'Ooh', 'sustain', 'bass'], ['pad', 'Ah', 'sustain', 'pad'], ['pad2', 'Ooh', 'sustain', 'pad2'], ['lowpad', 'Mm', 'sustain', 'root']],
};
/** The backing's voices, best first (sing-plan.js HOME_VOICES). */
const ROLE_VOICES = {
  bass: ['basso', 'old', 'coach', 'crooner', 'robo'], lowpad: ['old', 'coach', 'crooner', 'robo', 'tenor', 'woman'],
  pad: ['woman', 'tenor', 'soprano'], pad2: ['soprano', 'woman'], hum: ['woman', 'tenor', 'soprano'], echo: ['soprano', 'woman', 'tenor'],
};
/** The backing's ranks (the first roles are filled first when few are free). */
const ROLE_ORDER = ['pad', 'bass', 'lowpad', 'pad2', 'hum'];

/** Seals by turn (deterministic, varied): the hand play, the word both sing on its contact, the groove beat it lands on. */
export const SEALS = [
  { play: 'high-five', word: 'Yes!', at: 2 },
  { play: 'handshake', word: 'Deal!', at: 2 },
  { play: 'fist-bump', word: 'Boom!', at: 2.5 },
  { play: 'pinky-promise', word: 'Promise!', at: 2.5 },
];
/** Gestures while a bot thinks (by role), has an idea, agrees. */
const THINK = {
  lyrics: ['chin-stroke', 'scratch-head'], chords: ['count-beats', 'conductor'], dance: ['count-beats', 'jazz-hands'],
  lighting: ['binoculars', 'point'], deals: ['chin-stroke', 'count-beats'], hype: ['jazz-hands', 'cheer'], comedy: ['peekaboo', 'jazz-hands'],
};
const IDEA = ['point', 'jazz-hands'];
/** Green as he writes a line: thinking it through, then presenting it. */
const WRITE = ['point', 'jazz-hands', 'chin-stroke', 'scratch-head', 'conductor'];
const AGREE = ['thumbs-up'];
/** The studio cannot stage a set's moves during the making-of (the formation holds): a gesture says it instead. */
const MOVE_GESTURE = { enter: 'wave', exit: 'wave', march: 'count-beats', huddle: 'beckon', gather: 'beckon', 'walk-to': 'point' };

const hash = (s) => hashString(String(s));
const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const roleOf = (e) => e.agent ?? ROLE_OF[e.bot] ?? 'lyrics';
const EPS = 1e-6;

// ------------------------------------------------------------------ consultations: who answers whom

/**
 * The answer to consultation `q` among `events` (the stream, in order): an event that says so (`answers: q.seq`),
 * else among the next two events of a bot it consults the one that names the asker, else the first of them (the
 * director's blackboard tells a consulted bot to answer in its next event; an event written in the same burst may
 * not have seen the question yet). `used`: events already answering another question. Null: no answer (yet).
 */
export function answerOf(q, events, used = new Set(), { lookahead = 2 } = {}) {
  if (!q || q.status !== 'consulting' || !q.consult?.length) return null;
  const said = events.find((e) => e.seq > q.seq && (e.answers === q.seq || (Array.isArray(e.answers) && e.answers.includes(q.seq))) && !used.has(e.seq));
  if (said) return said;
  const cands = events.filter((e) => e.seq > q.seq && q.consult.includes(e.bot) && e.bot !== q.bot && !used.has(e.seq)
    && !(Number.isInteger(e.answers) || Array.isArray(e.answers))).slice(0, lookahead);
  const names = new RegExp(`\\b${q.bot}\\b`, 'i');
  return cands.find((e) => names.test(e.summary ?? '')) ?? cands[0] ?? null;
}

/** Every consultation's answer: Map question seq -> answer event (in stream order; an answer answers one question). */
export function pairConsultations(events) {
  const pairs = new Map(), used = new Set();
  for (const q of events) {
    if (q.status !== 'consulting' || !q.consult?.length) continue;
    const a = answerOf(q, events, used);
    if (a) { pairs.set(q.seq, a); used.add(a.seq); }
  }
  return pairs;
}

/**
 * The crewmate a thought is said to: the first of the CREW its words name (the Capitalised name: "White, is G too
 * bright here?", "Nice one, Pink!"; "a gold spot" names nobody), not the singer itself; null when it names none.
 * The making-of turns the singer to that bot for the line (main.js: acting.js address), and it nods back.
 */
export function addresseeOf(text, bot) {
  return namesIn(text, CREW).find((n) => n !== bot) ?? null;
}

/**
 * The syllable (index in `sylls`, syllabify's) a crewmate's name starts on in a line (its first time), or -1: the
 * making-of sings it on a strong beat, held (Whisper heard the crew's names 27% of the time in v15's double time).
 */
export function nameSyllable(sylls, name) {
  if (!name) return -1;
  const lc = name.toLowerCase();
  return sylls.findIndex((x) => String(x.word ?? '').toLowerCase().replace(/'s$/, '') === lc);
}

/** A stand-in answer when nobody answered (the bot's own catchphrase: "Let me take a look", "Of course, darling"). */
export const fallbackAnswer = (bot, asker) => {
  const says = CAST[bot]?.says;
  return says ? `${says}${/[!?.]$/.test(says) ? '' : '!'}` : `Sure thing, ${asker}!`;
};

// ------------------------------------------------------------------ the sung phrases

const f0Midi = (voice) => 69 + 12 * Math.log2((VOICES[voice]?.f0 ?? 180) / 440);
const vibratoOf = (voice, light = true) => {
  const vs = VIBRATO_SCALE[voice] ?? { depth: 1, rate: 1 };
  return light ? { rate: 5.5 * vs.rate, depth: 16 * vs.depth } // a light vibrato on the patter: sung speech
    : { rate: DEFAULT_VIBRATO.rate * vs.rate, depth: DEFAULT_VIBRATO.depth * vs.depth };
};

/** The pickup of a thought: how many of its first syllables, weak ones, it sings before the bar line (three stay after it). */
export function pickupOf(sylls, max = MAX_PICKUP) {
  let p = 0;
  while (p < Math.min(max, sylls.length - 3) && sylls[p].stress <= 0) p++;
  return p;
}

/**
 * How a line ending on `roman` ends: 'ask' (open, on so: its chord has so and not do, V or iii), 'answer' (home on
 * do: its chord has do and not so, IV or vi), else null (I has both, ii neither: by turns).
 */
export function shapeByChord(roman) {
  const t = chordFromRoman(roman, 'C').tones;
  const so = t.includes(7), home = t.includes(0);
  return so && !home ? 'ask' : home && !so ? 'answer' : null;
}

/**
 * The stanza bar (0 or 2) a child tune's line of `bars` bars is sung from so that its last unit asks (lines 1 and 3
 * of a stanza: up to so) or answers (2 and 4: home to do): tunes.js pitchChild.
 */
export const stanzaStart = (shape, bars) => [0, 2].find((s) => (Math.floor((s + bars - 2) / 2) % 2 === 0) === (shape === 'ask'));

/**
 * The premiere's lead lines, keyed by event seq: { text (as the premiere sings it), tune (its section's child tune),
 * start (its bar in the premiere's section: whether it asks or answers there), pickup (its syllables before the bar
 * line) }. Green sings his lines on them.
 */
export function arrangedLines(events, beats) {
  const out = new Map();
  if (!beats) return out;
  let song;
  try { song = arrange(events, beats); } catch { return out; }
  for (const l of song.lines) {
    if (l.layer !== 'story' || l.role !== 'lead') continue;
    const s = song.sections.find((x) => x.beat === l.beat);
    if (!s) continue;
    const own = l.job.notes[l.pickup ?? 0] ?? l.job.notes[0];
    const start = Math.max(0, Math.round((l.at + own.t - s.t) / song.bar));
    out.set(l.seq, { text: l.job.text, tune: s.tune, start, pickup: l.pickup ?? 0, section: s.section });
  }
  return out;
}

/** A backing cell's job: its seed by singer and part, so the same bar on the same chord is one render (sing-plan.js cellJob). */
function cellJob(bot, role, text, notes, q) {
  const voice = engineVoice(bot);
  return {
    voice, text, mode: 'human', seed: hash(`${bot}:${role}`) | 0, vibrato: vibratoOf(voice, false),
    notes: notes.map((n) => ({ t: n.t - notes[0].t, dur: n.dur, midi: n.midi, downbeat: Math.abs(n.t / q / BAR - Math.round(n.t / q / BAR)) < EPS })),
  };
}

// ------------------------------------------------------------------ gestures

const isHands = (r) => r.kind === 'play' || r.kind === 'gesture';
/**
 * What a thought does with its hands: the event's own action when it is a hand play or a gesture (staged by the
 * stage), else (a light cue, a face act, no action) a gesture of its role and status, by its seq; a move becomes a
 * gesture (the studio's formation holds). Returns { action, gesture }: action for the stage, gesture for the hands.
 */
export function gestureOf(e, kind = 'thought', text = '') {
  const r = resolveAction(e.action);
  if (r.kind === 'move') return { action: '', gesture: MOVE_GESTURE[r.id] ?? 'point' };
  if (isHands(r)) return { action: e.action, gesture: '' };
  if (r.kind === 'act') return { action: e.action, gesture: '' }; // the face act is the gesture
  if (r.kind === 'none' && !r.id && wordCue(text)) return { action: '', gesture: '' }; // its words cue one (main.js: lineGestures)
  const h = hash(`${e.seq}:${e.bot}`);
  const list = kind === 'answer' ? AGREE : e.status === 'done' ? AGREE : e.status === 'proposing' ? IDEA : THINK[roleOf(e)] ?? THINK.lyrics;
  return { action: e.action ?? '', gesture: list[h % list.length] };
}


// ------------------------------------------------------------------ the score

/**
 * The making-of, laid out bar by bar. add(events, now) takes the stream as it arrives (all of it at once for a
 * recorded making-of) and returns the staged events it adds (timed, in order); lines (the sung plans for audio.js:
 * the phrases on the story layer, the gap answers on the echo layer, the backing), items (the timeline for the
 * trailer tools), sections (the form) and end grow with it.
 *
 * opts: beats (beats.json: the form's sections, the seed, the premiere's tunes for Green's lines), tempo (the
 * groove), live (events arrive in real time: a question waits for its answer, the backlog decides Green's extra
 * lines, the sections' progressions cycle as they grow), only (a recorded making-of: the Set of line seqs to sing;
 * null: every new line), lengths (Map beat -> bars, lastBeat: a first scoring's sections; their progressions fitted
 * to them), arranged (arrangedLines, computed once), measure (only the timing: no backing, no jobs).
 */
export class MakingOfScore {
  constructor({ beats = null, tempo = MAKING_OF_TEMPO, live = false, only = null, skip = null, lengths = null, arranged = null, measure = false } = {}) {
    this.beats = beats;
    this.tempo = tempo;
    this.beat = 60 / tempo; //  the groove's beat (s)
    this.q = this.beat / 2; //  a tune beat (s): the groove's eighth
    this.bar = BAR * this.q; // a bar (s): one chord
    this.live = live;
    this.only = only;
    this.skip = skip; // a recorded making-of over time: remarks (thoughts that ask and answer nothing) left out
    this.lengths = lengths;
    this.measure = measure;
    this.raw = []; // every event so far
    this.staged = [];
    this.lines = [];
    this.items = [];
    this.sections = []; // { beat, section, kind, set, prog, tune, start, bars, fitted }
    this.style = null;
    this.head = COUNT_IN; // bars: the next phrase's downbeat (its pickup sings in the bar before)
    this.sung = new Set(); // line texts the song has
    this.firstOfBeat = new Map(); // beat id -> seq of its first new line
    this.used = new Set(); // events sung as an answer
    this.pairs = null; // replay: question seq -> answer event
    this.pending = []; // live: questions waiting for their answer { q, waited }
    this.duets = 0;
    this.sealFrom = null;
    this.lastGesture = new Map(); // bot -> tune beat of its last gesture ("not busy")
    this.arranged = arranged; // Map seq -> the premiere's line (lazy)
    this.arrangedFor = arranged ? Infinity : -1;
    this.seq = STAGED_BASE;
    this.now = 0;
    this.closed = false;
    this.busy = new Map(); // bar -> the bots singing a phrase, a gap answer or a duet there (no backing)
    this.tail = []; // the notes the last phrase ends on (a pickup after it shortens them)
    this.echoing = null; // the phrase before, when a gap answer may follow it
    this.lastShape = null;
    this.echoed = new Map(); // bot -> gap answers sung
    this.backed = 0; // bars with their backing laid out
    this.runs = new Map(); // role -> the backing run going on { bot, from, to, sec }
    this.fresh = []; //  the lines and events of this add
    this.freshEvents = [];
  }

  /** Transport seconds of a count of tune beats. */
  sec(tb) { return tb * this.q; }

  /** Transport seconds the making-of ends: after the last phrase the home chord rings RING bars. */
  get end() { return this.sec(BAR * (this.head + RING)); }

  /** The first bar of the song (the vamp and the backing come in there), or Infinity before anything is sung. */
  get startBar() { return this.sections.length ? this.sections[0].start : Infinity; }

  /** The style the form draws from: the episode's seed (beats.json), else its words. */
  styleOf() {
    if (!this.style) {
      const seed = this.beats?.seed ?? `events-${hash(this.raw.map((e) => e.summary ?? '').join('|'))}`;
      this.style = chooseStyle(`making-of ${seed}`, this.beats?.tags ?? {});
    }
    return this.style;
  }

  /** The section bar `bar` is in (the ring after the last: the last), or null before the first. */
  sectionAt(bar) {
    for (let i = this.sections.length - 1; i >= 0; i--) if (bar >= this.sections[i].start) return this.sections[i];
    return null;
  }

  /**
   * The roman a bar plays: its section's progression, fitted to the section when its length is known (the recorded
   * making-of), else cycled (live); I after the last section (the home chord rings) and before the first.
   */
  romanAt(bar) {
    const s = this.sectionAt(bar);
    if (!s) return 'I';
    // (one chord a bar of the groove, two tune bars; a section of one bar, a chord a half bar: it still cadences)
    const k = s.perHalf ? bar - s.start : Math.floor((bar - s.start) / HALVES);
    if (s.fitted) return k < s.fitted.length ? s.fitted[k] : 'I';
    if (s.bars !== null && k >= (s.perHalf ? s.bars : Math.ceil(s.bars / HALVES))) return 'I';
    const p = chordsOf(s.prog);
    return p[k % p.length];
  }

  /** The chord name a bar plays (the vamp: a chord a bar from transport 0). */
  chordAtHalf(h) { return chordName(this.romanAt(h)); }

  /** The chord names of every bar to the end. */
  get halves() { return Array.from({ length: this.head + RING }, (_, h) => this.chordAtHalf(h)); }

  /** The chord at a bar (theory.js). */
  chordAt(bar) { return chordFromRoman(this.romanAt(bar), 'C'); }

  /**
   * A beat of the bundle begins at `bar` (the first: COUNT_IN bars before it, the intro's backing alone): its section,
   * named as the premiere's, its progression from the section's function set (the arranger's chords for the beat
   * when they are one of the set, else the seed's), its tune.
   */
  enter(beatId, bar) {
    const cur = this.sections.at(-1);
    if (cur && cur.beat === beatId) return cur;
    if (cur) cur.bars = bar - cur.start;
    const k = this.sections.length;
    const info = this.beats?.beats?.find((b) => b.id === beatId);
    const fromId = /^beat-\d+-([a-z0-9]+)/.exec(String(beatId ?? ''))?.[1];
    const section = info?.section ?? (sectionKind(fromId) ? fromId : FORM[Math.min(k, FORM.length - 1)]);
    const style = this.styleOf();
    const set = progressionSetOf(section, style.tags);
    const given = this.raw.find((e) => e.beat === beatId && e.chords?.length)?.chords?.map(romanOf);
    const prog = progressionIdIn(set, given) ?? progressionOf(style, section);
    const tune0 = tuneOf(style, section);
    const L = this.lengths?.get(beatId);
    const perHalf = Number.isInteger(L) && L >= 2 && Math.ceil(L / HALVES) < 2;
    const s = {
      beat: beatId, section, kind: sectionKind(section) ?? 'verse', set, prog, tune: TOO_QUICK[tune0] ?? tune0,
      start: k === 0 ? Math.max(0, bar - COUNT_IN) : bar, bars: null, index: k, echoes: 0, firstShape: null,
      fitted: Number.isInteger(L) ? fitRomans(chordsOf(prog), section, perHalf ? L : Math.ceil(L / HALVES), { final: this.lengths.lastBeat === beatId }) : null,
      perHalf,
    };
    this.sections.push(s);
    return s;
  }

  /** The premiere's line of a lyric event (Green's tune), arranging the stream so far again when it grew. */
  arrangedLine(e) {
    if (!this.beats) return null;
    if (this.arrangedFor !== Infinity && this.arrangedFor !== this.raw.length) {
      this.arranged = arrangedLines(this.raw, this.beats);
      this.arrangedFor = this.raw.length;
    }
    return this.arranged?.get(e.seq) ?? null;
  }

  /** Takes newly arrived events; returns the staged events it adds (timed, in order). now: transport seconds. */
  add(events, now = 0) {
    const known = new Set(this.raw.map((r) => r.seq));
    const fresh = (events ?? []).filter((e) => e && !known.has(e.seq));
    this.raw.push(...fresh);
    this.now = now;
    this.catchUp(now);
    if (!this.live) this.pairs = pairConsultations(this.raw);
    for (const unit of this.units(fresh)) this.layout(unit);
    // live: the backing of the bars laid out (a recorded making-of: all of it at the end)
    if (this.live) this.back(this.head);
    return this.finish();
  }

  /** Live: nothing is placed in the past (the voices need a moment to render; the first phrase after its count-in). */
  catchUp(now) {
    if (!this.live) return;
    let at = Math.ceil((now + 1.5) / this.bar - EPS) + (this.sections.length ? 0 : COUNT_IN);
    at += at % HALVES; // (on a bar line of the groove)
    if (this.head < at) {
      this.head = at;
      this.tail = [];
      this.echoing = null;
    }
  }

  /** At the end (live: the director finished): the questions still waiting get a stand-in answer; the ring. */
  flush(now = 0) {
    this.now = now;
    this.catchUp(now);
    for (const p of this.pending.splice(0)) this.layout(p.chained ? null : this.duetUnit(p.q, null));
    if (this.echoing) this.echo(this.echoing, Infinity, null);
    this.echoing = null;
    const last = this.sections.at(-1);
    if (last) last.bars = this.head - last.start;
    this.closed = true; // the end is known (the home chord rings there)
    this.back(this.head + RING);
    return this.finish();
  }

  /** The jobs, the mix and the timeline's ends of what this add laid out; returns its staged events in time order. */
  finish() {
    const events = this.freshEvents.splice(0);
    // (a recorded making-of: at its end, when the last notes are cut to make room for what follows them)
    if ((this.live || this.closed) && !this.measure) {
      const fresh = this.fresh.splice(0);
      for (const l of fresh) if (!l.job) l.job = this.jobOf(l);
      // the mix (song/mix.js): the phrases on top, the gap answers and the backing under them, dipping under the words
      const sung = this.lines.filter((l) => l.job);
      const spans = storySpans(sung, this.bar), syl = syllableSpans(sung);
      for (const l of this.live ? fresh : sung) Object.assign(l, layerGain(l, spans, syl));
    }
    for (const l of this.lines) if (l.item && l.notesTb) l.item.t1 = +this.sec(l.notesTb.at(-1).tb + l.notesTb.at(-1).dur).toFixed(3);
    const order = (list) => list.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e);
    this.staged = order(this.staged);
    return order(events);
  }

  /** A phrase's job for the voice pool (notes in seconds from its first note). */
  jobOf(l) {
    const t0 = l.notesTb[0].tb;
    return {
      voice: l.voice, text: l.text, mode: 'human', seed: hash(`${l.bot}:${l.seq}`) | 0, vibrato: vibratoOf(l.voice),
      notes: l.notesTb.map((n) => ({ t: this.sec(n.tb - t0), dur: this.sec(n.dur), midi: n.midi, downbeat: Math.abs(n.tb / BAR - Math.round(n.tb / BAR)) < EPS })),
    };
  }

  /**
   * A duet unit: the question, its answer, and (when the answer asks someone in turn and that answer is known) the
   * chained duet; every answer it sings is marked used, so it is not sung again as a thought.
   */
  duetUnit(q, a) {
    const u = { kind: 'duet', q, a, chain: null };
    if (a) this.used.add(a.seq);
    if (a && a.status === 'consulting' && a.consult?.length) {
      const a2 = this.live ? this.firstAnswer(a) : this.pairs?.get(a.seq) ?? null;
      if (a2 && !this.used.has(a2.seq)) { this.used.add(a2.seq); u.chain = { q: a, a: a2 }; }
      else if (this.live) this.pending.push({ q: a, waited: 0, chained: true });
    }
    return u;
  }

  /** Live: the answer to q among the events so far (its `answers` event, else the first later one of a bot it asks). */
  firstAnswer(q) {
    const said = this.raw.find((e) => e.seq > q.seq && e.answers === q.seq && !this.used.has(e.seq));
    if (said) return said;
    return this.raw.find((e) => e.seq > q.seq && q.consult.includes(e.bot) && e.bot !== q.bot && !this.used.has(e.seq)
      && !Number.isInteger(e.answers)) ?? null;
  }

  /**
   * Whether Green's line is sung: not when the song has it already, nor (a recorded making-of) when it is not chosen,
   * nor (live) when the score is far ahead and it is not the first new line of its beat.
   */
  wantLine(e, parsed) {
    const key = norm(parsed.text);
    if (!key || this.sung.has(key)) return false;
    this.sung.add(key);
    if (!this.firstOfBeat.has(e.beat)) this.firstOfBeat.set(e.beat, e.seq);
    const first = this.firstOfBeat.get(e.beat) === e.seq;
    if (this.only && !this.only.has(e.seq)) return false;
    if (this.live && !first && this.sec(BAR * this.head) - this.now > LIVE_SLACK) return false;
    return true;
  }

  /** The units of newly arrived events, in the order they are sung (a recorded making-of: each beat's last marked). */
  units(fresh) {
    const out = [];
    if (this.live) {
      // waiting questions an arrival answers (or that waited long enough: a stand-in answers)
      for (const p of this.pending.slice()) {
        const a = this.firstAnswer(p.q);
        p.waited += fresh.length;
        if (!a && p.waited < LIVE_WAIT) continue;
        this.pending.splice(this.pending.indexOf(p), 1);
        if (p.chained) {
          if (a) { this.used.add(a.seq); out.push({ kind: 'duet', q: p.q, a, asked: false }); }
        } else out.push(this.duetUnit(p.q, a));
      }
    }
    // by beat: the crew's thoughts and Green's lines alternate (call and response), the beat's chord event first
    const byBeat = new Map();
    for (const e of fresh) {
      if (!byBeat.has(e.beat)) byBeat.set(e.beat, []);
      byBeat.get(e.beat).push(e);
    }
    for (const [, evs] of byBeat) {
      const talk = [], lines = [];
      for (const e of evs) {
        const parsed = e.lyric ? parseLyric(e.lyric, NAMES) : null;
        if (parsed?.text && this.wantLine(e, parsed)) lines.push({ kind: 'line', e, parsed });
        if (this.used.has(e.seq) || this.answers(e)) continue; // sung in a duet
        if (e.status === 'consulting' && e.consult?.length) {
          if (this.live) {
            const a = this.firstAnswer(e);
            if (a) talk.push(this.duetUnit(e, a));
            else this.pending.push({ q: e, waited: 0 });
          } else talk.push(this.duetUnit(e, this.pairs.get(e.seq) ?? null));
        } else if (!parsed?.text && !this.skip?.has(e.seq)) talk.push({ kind: 'thought', e });
      }
      const lead = talk.findIndex((u) => u.kind === 'thought' && u.e.chords?.length);
      if (lead > 0) talk.unshift(...talk.splice(lead, 1));
      const list = [];
      for (let i = 0; i < Math.max(talk.length, lines.length); i++) {
        if (talk[i]) list.push(talk[i]);
        if (lines[i]) list.push(lines[i]);
      }
      if (!this.live && list.length) list.at(-1).last = true;
      out.push(...list);
    }
    if (!this.live && out.length) out.at(-1).final = true;
    return out;
  }

  /** Replay: an event that answers a question (its duet sings it). */
  answers(e) {
    if (this.live || !this.pairs) return false;
    for (const a of this.pairs.values()) if (a.seq === e.seq) return true;
    return false;
  }

  layout(u) {
    if (!u) return null;
    const last = Boolean(u.last), final = Boolean(u.final);
    if (u.kind === 'thought') return this.thought(u.e, last, final);
    if (u.kind === 'line') return this.line(u.e, u.parsed, last, final);
    if (u.kind === 'duet') {
      const first = this.duet(u.q, u.a, u.asked === false ? null : true);
      if (u.chain && first) this.duet(u.chain.q, u.chain.a, first);
      return first;
    }
    return null;
  }

  /** Whether the phrase before can make room for a pickup of m syllables before bar `bar` (its last note shortened). */
  roomFor(m, bar = this.head) {
    const start = BAR * bar - (m === 1 ? PICKUP_ONE : PICKUP_EACH * m);
    return this.tail.every(({ note, min = PICKUP_MIN_LAST }) => start - PICKUP_GAP - note.tb >= min - EPS);
  }

  /** The bars a bot sings in (with the card's lead before and its linger after: no backing there). */
  markBusy(bot, from, to) {
    const m = (CARD_LEAD + 0.1) / this.q;
    for (let b = Math.floor((from - m) / BAR); b <= Math.floor((to + m - EPS) / BAR); b++) {
      if (!this.busy.has(b)) this.busy.set(b, new Set());
      this.busy.get(b).add(bot);
    }
  }

  /**
   * Puts a sung part on the score: its staged event (card CARD_LEAD before the voice), its plan for the voice pool
   * (notes in tune beats from transport 0; the job is made when the add is done), its timeline item (item: false,
   * none). Returns { ev, item, line, bar, bars, notes }.
   */
  place({ bot, text, notes, bar, bars, voice = engineVoice(bot), beatId, layer = 'story', role = 'lead', db = 0, part, item: withItem = true, src = null, kind,
    agent, status = 'working', action = '', consult = [], gesture = '', duet = null, doing = '', consultSeq = null, line = '', singsFor = null, summary = text, at = null, to = null }) {
    const seq = this.seq++;
    const t0 = this.sec(notes[0].tb);
    const sec = this.sectionAt(bar);
    const plan = { seq, bot, at: t0, bars, role, layer, section: sec?.section ?? 'verse', beat: beatId, db, voice, text, notesTb: notes, item: null };
    this.lines.push(plan);
    this.fresh.push(plan);
    const ev = {
      seq, src, t: +Math.max(0, t0 - CARD_LEAD).toFixed(4), agent, bot, status, beat: beatId, summary, lyric: text, line, chords: [],
      action, consult, kind, gesture, duet, doing, singsFor, at, ...(part ? { part, singer: bot } : {}), ...(to ? { to } : {}),
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
    let item = null;
    if (withItem) {
      const last = notes.at(-1);
      item = { t0: +t0.toFixed(3), t1: +this.sec(last.tb + last.dur).toFixed(3), bot, agent, kind, beat: beatId, seq: src, ...(consultSeq !== null ? { consultSeq } : {}), text };
      this.items.push(item);
      plan.item = item;
    }
    this.markBusy(bot, notes[0].tb, notes.at(-1).tb + notes.at(-1).dur);
    if (gesture) this.lastGesture.set(bot, BAR * bar);
    return { ev, item, line: plan, bar, bars, notes };
  }

  /**
   * A phrase of `text` by `bot` at the head: its first weak syllable a pickup before the bar line (when the phrase
   * before makes room), the rest on a child tune (`melody`, else its section's) over the section's chords, the words'
   * stress fitted. shape: 'ask' (it ends open, on so), 'answer' (home on do) or 'auto' (by the chord it ends on);
   * start: a stanza bar (Green's line: its bar in the premiere, so it asks or answers as it does there); last: the
   * last phrase of its section (a chorus's or the outro's lands on the home chord; final: the song's last); echo: a
   * crew member may answer it in its gap.
   */
  phrase(bot, text, { beatId, last = false, final = false, shape = 'auto', start = null, melody = null, pickup = null, echo = false, ...rest }) {
    const sylls = syllabify(text);
    if (!sylls.length) return null;
    const voice = engineVoice(bot);
    // the crewmate the talk names (not Green's lines: they are the song's): its name on a strong beat, held
    const nk = rest.kind === 'line' ? -1 : nameSyllable(sylls, addresseeOf(text, bot));
    let m = Math.max(0, Math.min(pickup ?? pickupOf(sylls), sylls.length - 1));
    if (nk >= 0) m = nk >= 1 && nk <= MAX_NAME_PICKUP && nk <= sylls.length - 3 ? nk : Math.min(m, nk);
    while (m > 0 && !this.roomFor(m)) m--;
    const holdOf = (x) => (nk >= x ? [nk - x] : []);
    const b = this.head;
    const sec = this.enter(beatId, b);
    const tune = melody ?? sec.tune;
    const tuneBarsOf = (x) => holdBars(tune, sylls.length - x, MIN_BARS, holdOf(x), sylls.slice(x));
    const bars0 = tuneBarsOf(m);
    // the gap answer to the phrase before (its last bar): this pickup gives way to it when the bars stay as they are
    const before = this.echoing;
    this.echoing = null;
    if (before && m > 0 && tuneBarsOf(0) === bars0) m = 0;
    if (before && m === 0) this.echo(before, BAR * b, bot);
    const bars = tuneBarsOf(m);
    if (!bars) return null;
    const romans = Array.from({ length: bars + 1 }, (_, k) => this.romanAt(b + k));
    let want = shape;
    if (want === 'auto') want = shapeByChord(romans[bars - 1]) ?? (last || this.lastShape === 'ask' ? 'answer' : 'ask');
    const s = start !== null ? ((start % 4) + 4) % 4 : stanzaStart(want, bars);
    const home = last && !this.live && (isCadenceSection(sec.section) || final);
    const body = sylls.slice(m);
    const r = tuneNotes({
      melody: tune, syllableCount: body.length, syllables: body, stress: body.map((x) => x.stress), chords: [...Array(s).fill('I'), ...romans],
      role: 'lead', voice, key: 'C', tempo: 2 * this.tempo, startBar: s, cadenceBar: home ? s + bars - 1 : null, minBars: MIN_BARS, closeLast: true,
      talk: true, hold: holdOf(m),
    });
    if (r.notes.length !== body.length) return null;
    const { low, high } = voiceRange(voice);
    const notes = r.notes.map((n) => ({ tb: BAR * b + n.t / this.q, dur: n.dur / this.q, midi: n.midi, strong: n.strong }));
    if (m) {
      const pk = m === 1 ? PICKUP_ONE : PICKUP_EACH;
      const pitches = pickupPitches(notes[0].midi, m, 'C', low, high, this.chordAt(b - 1).tones);
      notes.unshift(...pitches.map((midi, i) => ({ tb: BAR * b - (m - i) * pk, dur: pk, midi, strong: false, pickup: true })));
    }
    // the phrase before makes room for this one (its last note shortened)
    for (const { note } of this.tail) note.dur = Math.max(PICKUP_MIN_LAST, Math.min(note.dur, notes[0].tb - PICKUP_GAP - note.tb));
    this.lastShape = want;
    const placed = this.place({ ...rest, bot, text, notes, bar: b, bars, voice, beatId, gesture: this.calm(bot, rest.gesture ?? '', BAR * b) });
    placed.shape = start !== null ? 'premiere' : want;
    placed.line.shape = placed.shape;
    placed.line.home = home;
    this.tail = [{ note: notes.at(-1), min: nk >= 0 && nk === sylls.length - 1 ? NAME_MIN_LAST : PICKUP_MIN_LAST }];
    this.head = b + bars;
    const lastBar = b + bars - 1;
    const lastIn = notes.at(-1).tb - BAR * lastBar;
    const k = sec.phrases ?? 0;
    sec.phrases = k + 1;
    if (echo && !home && ['verse', 'chorus', 'outro'].includes(sec.kind) && lastIn <= LEAD_CUT - 0.5 + EPS
      && (rest.kind === 'line' || sec.kind !== 'verse' || k % 2 === 1)) this.echoing = { ...placed, sec, lastBar, text, bot, kind: rest.kind };
    return placed;
  }

  /**
   * The gap answer to phrase p (StoryForm.cs's echo, the making-of's): in its last bar, after its last note (cut at
   * LEAD_CUT), before `endTb` (the next phrase): its last words when they are short (a line of Green's, a chorus), else
   * an interjection ("Yeah!", "Uh-huh!"), sung by a crew member who sings neither phrase, on the section's next echo
   * shape (tunes.js replyNotes).
   */
  echo(p, endTb, next) {
    const b0 = BAR * p.lastBar;
    const s = b0 + ECHO_FROM, e = Math.min(b0 + ECHO_END, endTb - 0.15);
    const words = echoOf(p.text);
    const n0 = syllabify(words).length;
    const h = hash(`${p.ev.seq}:${p.text}`);
    // (a crewmate's thought is talk: a reaction answers it; its last words echoed back would sound like a parrot)
    const asks = /\?\s*$/.test(p.text);
    const replies = asks ? QUESTION_REPLIES : INTERJECTIONS;
    let text = p.kind === 'line' && n0 >= 1 && n0 <= ECHO_MAX_SYLLABLES ? words : replies[h % replies.length];
    if (e - s < ECHO_MIN_NOTE * syllabify(text).length - EPS) text = 'Yeah!';
    const n = syllabify(text).length;
    if (e - s < ECHO_MIN_NOTE * n - EPS) return null;
    const not = new Set([p.bot, next].filter(Boolean));
    const busy = this.busy.get(p.lastBar) ?? new Set();
    const free = CREW.filter((x) => !not.has(x) && !busy.has(x));
    const fit = (x) => { const i = ROLE_VOICES.echo.indexOf(engineVoice(x)); return i < 0 ? 9 : i; };
    // (the voice that fits, by turns: the one who answered least so far)
    const said = (x) => this.echoed.get(x) ?? 0;
    const bot = free.sort((x, y) => (fit(y) < 9) - (fit(x) < 9) || said(x) - said(y) || hash(`${b0}:${x}`) - hash(`${b0}:${y}`))[0];
    if (!bot) return null;
    this.echoed.set(bot, said(bot) + 1);
    // the line's last note makes room
    const ln = p.notes.at(-1);
    if (ln.tb + ln.dur > b0 + LEAD_CUT) ln.dur = Math.max(PICKUP_MIN_LAST, b0 + LEAD_CUT - ln.tb);
    const sec = p.sec;
    if (sec.firstShape === null) sec.firstShape = h % 12;
    const voice = engineVoice(bot);
    const { low, high } = voiceRange(voice);
    const roman = this.romanAt(p.lastBar), chord = chordFromRoman(roman, 'C');
    const r = replyNotes({
      shape: echoShape(sec.firstShape, sec.echoes), syllableCount: n, chord: roman, voice, tempo: 2 * this.tempo, answerIndex: sec.echoes,
      answering: p.notes.filter((x) => !x.pickup && x.tb >= b0 - EPS).map((x) => ({ beat: x.tb - b0, midi: x.midi })), answerEnd: Number.isFinite(endTb) ? endTb - b0 : null,
    });
    sec.echoes++;
    const d = (e - s) / n;
    let prev = null;
    const notes = Array.from({ length: n }, (_, i) => {
      let midi = r?.notes[i]?.midi ?? chord.tones[0] + 60;
      const tb = s + i * d, inBar = tb - b0;
      // on the bar's strong beats (and the last): a chord tone, in the voice
      if (Math.abs(inBar - 2) < EPS || i === n - 1 || !r) {
        let best = null;
        for (let x = low; x <= high; x++) if (chord.tones.includes(mod12(x)) && (best === null || Math.abs(x - midi) + (prev !== null ? 0.2 * Math.abs(x - prev) : 0) < Math.abs(best - midi) + (prev !== null ? 0.2 * Math.abs(best - prev) : 0) - EPS)) best = x;
        midi = best ?? midi;
      }
      while (midi > high) midi -= 12;
      while (midi < low) midi += 12;
      prev = midi;
      return { tb, dur: d, midi, strong: Math.abs(inBar - 2) < EPS };
    });
    const interjection = INTERJECTIONS.includes(text) || QUESTION_REPLIES.includes(text) || text === 'Yeah!';
    return this.place({
      bot, text, notes, bar: p.lastBar, bars: 1, voice, beatId: p.ev.beat, layer: 'echo', role: interjection ? 'reply' : 'echo', part: interjection ? 'reply' : 'echo',
      item: false, kind: 'echo', agent: roleOf({ bot }), status: 'working', doing: `answers ${p.bot}`, summary: `${bot} answers ${p.bot}`,
    });
  }

  /** "Not busy": a bot that gestured in the last three bars keeps its hands still. */
  calm(bot, gesture, at) {
    if (!gesture) return '';
    const last = this.lastGesture.get(bot);
    return last !== undefined && at - last < 3 * BAR ? '' : gesture;
  }

  /** An event's summary as sung: a "talk" bundle's (and a live run's before its plan arrives) as written, an older one's in the team's voice. */
  voiced(e, bot = e.bot) {
    return sungSummary(e.summary, bot, NAMES, this.beats?.summaries ?? (this.live ? TALK : null));
  }

  thought(e, last = false, final = false) {
    const text = this.voiced(e);
    const { action, gesture } = gestureOf(e, 'thought', text);
    const to = addresseeOf(text, e.bot);
    return this.phrase(e.bot, text, {
      beatId: e.beat, last, final, echo: true, src: e.seq, kind: 'thought', agent: roleOf(e), status: e.status ?? 'working',
      action, gesture, consult: e.consult ?? [], summary: e.summary, at: e.t, ...(to ? { to } : {}),
      doing: e.status === 'proposing' ? 'has an idea' : e.status === 'done' ? 'signs off' : 'thinks it through',
    });
  }

  /** Green's line (wantLine chose it): on the tune the premiere gives it, asking or answering as it does there. */
  line(e, parsed, last = false, final = false) {
    const bot = e.bot;
    const first = this.firstOfBeat.get(e.beat) === e.seq;
    const tune = this.arrangedLine(e);
    const text = tune && syllabify(tune.text).length ? tune.text : parsed.text;
    return this.phrase(bot, text, {
      beatId: e.beat, last, final, echo: true, melody: tune?.tune && !TOO_QUICK[tune.tune] ? tune.tune : null, start: tune ? tune.start : null,
      pickup: tune ? Math.min(tune.pickup, 3) : 0,
      src: e.seq, kind: 'line', agent: roleOf(e), status: 'proposing', doing: 'proposes a line', line: e.lyric ?? '',
      singsFor: e.singer && e.singer !== bot ? e.singer : null, summary: e.summary, at: e.t,
      gesture: first && !wordCue(parsed.text) ? WRITE[hash(`${e.seq}:${norm(parsed.text)}`) % WRITE.length] : '',
    });
  }

  /**
   * A consultation, sung: the asker glides over singing its question (it asks: up to so), the bot asked sings its
   * answer (home to do), a hand play seals it (both sing its word on the contact), the asker goes home. asked: true,
   * or (a chained duet: the answer that asked this question was already sung) the placed answer phrase that asked it.
   */
  duet(q, a, asked = true) {
    const asker = q.bot;
    const host = a?.bot && a.bot !== asker ? a.bot : q.consult.find((n) => n !== asker) ?? q.consult[0];
    if (!host) return null;
    // the seals by turn, from a place the episode picks (its first question): varied, the same every time
    this.sealFrom ??= hash(`${q.seq}:${q.summary ?? ''}`) % SEALS.length;
    const seal = SEALS[(this.sealFrom + this.duets++) % SEALS.length];
    const beatId = this.sections.at(-1)?.beat ?? q.beat;
    let question = null;
    if (asked === true) {
      question = this.phrase(asker, this.voiced(q, asker), {
        shape: 'ask', beatId: q.beat, src: q.seq, kind: 'question', agent: roleOf(q),
        status: 'consulting', consult: [host], doing: `asks ${host}`, consultSeq: q.seq, summary: q.summary, at: q.t,
        duet: { visit: 'out', with: host, until: 0 },
      });
    } else if (asked) {
      // the chained question is the answer just sung ("We tell Gold yes, ask Green about the hook")
      this.items.push({ ...asked.item, kind: 'question', consultSeq: q.seq, seq: q.seq });
    }
    const aText = a ? this.voiced(a) : fallbackAnswer(host, asker);
    const { action, gesture } = a ? gestureOf(a, 'answer', aText) : { action: '', gesture: 'thumbs-up' };
    const answer = this.phrase(host, aText, {
      shape: 'answer', beatId: question ? q.beat : beatId, src: a?.seq ?? null, kind: 'answer',
      agent: a ? roleOf(a) : ROLE_OF[host] ?? 'cast', status: 'consulting', consult: [asker], doing: `answers ${asker}`, consultSeq: q.seq,
      action, gesture, summary: a?.summary ?? '', at: a?.t ?? q.t,
      duet: { visit: asked === true ? 'stay' : 'in', with: asker, until: 0 },
    });
    if (!answer) return null;
    // the seal: the hand play on the next bar line, the word both sing on its contact
    const sb = this.head;
    const sealEnd = BAR * (sb + SEAL_BARS);
    const playT = this.sec(BAR * sb);
    const ev = {
      seq: this.seq++, src: q.seq, t: +playT.toFixed(4), agent: roleOf(q), bot: asker, status: 'working', beat: answer.ev.beat, summary: q.summary,
      lyric: '', line: '', chords: [], action: seal.play, consult: [host], kind: 'gesture', gesture: '', duet: null, doing: `seals it with ${host}`, at: q.t,
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
    this.items.push({ t0: +playT.toFixed(3), t1: +this.sec(sealEnd).toFixed(3), bot: asker, with: host, agent: roleOf(q), kind: 'gesture', beat: answer.ev.beat,
      seq: q.seq, consultSeq: q.seq, text: seal.play });
    const wordAt = BAR * sb + 2 * seal.at;
    const sylls = syllabify(seal.word);
    const chord = this.chordAt(Math.floor(wordAt / BAR));
    const tail = [];
    for (const [bot, top] of [[asker, false], [host, true]]) {
      const voice = engineVoice(bot);
      const { low, high } = voiceRange(voice);
      const pcs = top ? [chord.tones[1], chord.tones[2]] : [chord.tones[0]];
      const speak = Math.round(f0Midi(voice) + 5);
      let m = speak;
      for (let d = 0; d < 12; d++) {
        if (pcs.includes(mod12(speak + d))) { m = speak + d; break; }
        if (pcs.includes(mod12(speak - d))) { m = speak - d; break; }
      }
      m = Math.max(low, Math.min(high, m));
      const notes = sylls.map((_, i) => ({ tb: wordAt + i, dur: i === sylls.length - 1 ? 1.5 : 1, midi: m, strong: i === 0 }));
      const other = bot === asker ? host : asker;
      this.place({
        bot, text: seal.word, notes, bar: sb, bars: SEAL_BARS, voice, beatId: answer.ev.beat, src: q.seq, kind: 'seal', item: false,
        agent: bot === asker ? roleOf(q) : answer.ev.agent, status: 'consulting', consult: [other], doing: `seals it with ${other}`,
        duet: { visit: 'stay', with: other, until: +(this.sec(sealEnd) - this.sec(wordAt) + CARD_LEAD).toFixed(3) }, db: -3,
        summary: q.summary, at: q.t,
      });
      tail.push({ note: notes.at(-1) });
    }
    this.tail = tail;
    this.head = sb + SEAL_BARS;
    // the two are busy with each other from the question to the seal (no backing, no gap answers)
    const from = (question ?? answer).notes[0].tb;
    this.markBusy(asker, from, sealEnd);
    this.markBusy(host, from, sealEnd);
    // how long each scene lasts: from its card to the end of the seal (the visitor goes home then)
    if (question) question.ev.duet.until = +(this.sec(sealEnd) - question.ev.t).toFixed(3);
    answer.ev.duet.until = +(this.sec(sealEnd) - answer.ev.t).toFixed(3);
    return answer;
  }

  /**
   * The backing to bar `to` (StorySong.cs's sung backing, the making-of's): in each bar the crew members who sing
   * no phrase, gap answer or duet there hold its chord, each a part of its section's kind (BACKING: an "Ooh" / "Ah" pad
   * on the third or the fifth, a "Mm" on the root, "Bom, bom" or a held "Ooh" in the bass), each on its RoleTone
   * placed by the Pick cost (tunes.js), one cell a bar; a part keeps its singer while it is free, else the free member
   * whose voice fits it best takes it. Each run of bars one singer sings a part is one event (its card, its mouth).
   */
  back(to) {
    if (this.measure) return;
    // (live: never in the past)
    const from = Math.max(this.backed, this.startBar, this.live ? Math.ceil((this.now + 1.5) / this.bar - EPS) : 0);
    if (!Number.isFinite(from)) return;
    const style = this.styleOf();
    const pitchOf = { pad: style.backing.padPitch, pad2: style.backing.padPitch === 'third' ? 'fifth' : 'third', root: 'root', bass: 'bass' };
    for (let bar = from; bar < to; bar++) {
      const sec = this.sectionAt(bar);
      if (!sec) continue;
      const kind = sec.section === 'verse1b' || sec.section === 'verse2b' ? 'build' : sec.kind;
      const parts = BACKING[kind] ?? BACKING.verse;
      const busy = this.busy.get(bar) ?? new Set();
      const free = CREW.filter((b) => !busy.has(b));
      const taken = new Set();
      const now = new Map();
      for (const role of ROLE_ORDER) {
        const part = parts.find((p) => p[0] === role);
        if (!part) continue;
        const run = this.runs.get(role);
        let bot = run && run.sec === sec && run.to === bar && free.includes(run.bot) && !taken.has(run.bot) ? run.bot : null;
        if (!bot) {
          const voices = ROLE_VOICES[role] ?? ROLE_VOICES.pad;
          const fit = (x) => { const i = voices.indexOf(engineVoice(x)); return i < 0 ? 9 : i; };
          bot = free.filter((x) => !taken.has(x)).sort((x, y) => fit(x) - fit(y) || hash(`${sec.beat}:${role}:${x}`) - hash(`${sec.beat}:${role}:${y}`))[0] ?? null;
        }
        if (!bot) continue;
        taken.add(bot);
        now.set(role, { bot, part });
      }
      for (const [role, run] of this.runs) {
        const n = now.get(role);
        if (!n || n.bot !== run.bot || run.sec !== sec || run.to !== bar) { this.emitRun(role, run, pitchOf); this.runs.delete(role); }
      }
      for (const [role, { bot, part }] of now) {
        const run = this.runs.get(role);
        if (run) run.to = bar + 1;
        else this.runs.set(role, { bot, part, sec, from: bar, to: bar + 1 });
      }
    }
    this.backed = Math.max(this.backed, to);
    // live: what is laid out now is sung as it is (the next add starts new runs); a recorded making-of: at its end
    if (this.live || this.closed) {
      for (const [role, run] of this.runs) this.emitRun(role, run, pitchOf);
      this.runs.clear();
    }
  }

  /** A backing run as a sung part: a cell a bar on its chord (its segments), one event (mouth only, its small card). */
  emitRun(role, run, pitchOf) {
    const [, text, melody, pitch] = run.part;
    const n = syllabify(text).length;
    const voice = engineVoice(run.bot);
    const segs = [];
    for (let bar = run.from; bar < run.to; bar++) {
      const r = tuneNotes({ melody, syllableCount: n, chords: [this.romanAt(bar)], role: pitchOf[pitch] ?? pitch, voice, tempo: 2 * this.tempo, octave: role === 'bass' && voice === 'basso' ? 1 : 0 });
      if (!r.notes.length || r.bars !== 1) continue;
      segs.push({ at: this.sec(BAR * bar) + r.notes[0].t, job: cellJob(run.bot, role, text, r.notes, this.q), bar, notes: r.notes });
    }
    if (!segs.length) return;
    const seq = this.seq++;
    const at = segs[0].at;
    const notes = segs.flatMap((g) => g.job.notes.map((x) => ({ ...x, t: x.t + g.at - at })));
    const line = {
      seq, bot: run.bot, role, at, bars: run.to - run.from, layer: 'backing', section: run.sec.section, beat: run.sec.beat, db: 0,
      segments: segs.map(({ at: a, job }) => ({ at: a, job })), job: { ...segs[0].job, notes }, cells: segs.map((g) => ({ bar: g.bar, notes: g.notes })),
    };
    this.lines.push(line);
    this.fresh.push(line);
    const ev = {
      seq, src: null, t: +Math.max(0, at - CARD_LEAD).toFixed(4), agent: roleOf({ bot: run.bot }), bot: run.bot, singer: run.bot, part: 'backing',
      status: 'working', beat: run.sec.beat, summary: `${run.bot} sings the ${role}`, lyric: text, line: '', chords: [], action: '', consult: [],
      kind: 'backing', gesture: '', duet: null, doing: `sings the ${role}`, singsFor: null, at: null,
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
  }
}

/**
 * A recorded making-of, scored: every thought and consultation; Green's new lines as the time allows (the first new
 * line of each beat always, then the rest of the chorus stanzas, then the others, in order) so it lasts maxSeconds at
 * most. Each is scored twice: once for the sections' lengths, then with every section's progression fitted to its
 * length (the timing is the same: the chords only change the pitches). Returns the MakingOfScore.
 */
export function scoreMakingOf(events, beats = null, { tempo = MAKING_OF_TEMPO, maxSeconds = MAX_SECONDS } = {}) {
  const arranged = arrangedLines(events, beats);
  const measure = (only, skip = null) => {
    const s = new MakingOfScore({ beats, tempo, only, skip, arranged, measure: true });
    s.add(events, 0);
    s.flush(0);
    return s;
  };
  const score = (only, m, skip = null) => {
    const lengths = new Map(m.sections.map((x) => [x.beat, x.bars]));
    lengths.lastBeat = m.sections.at(-1)?.beat;
    const s = new MakingOfScore({ beats, tempo, only, skip, arranged, lengths });
    s.add(events, 0);
    s.flush(0);
    return s;
  };
  const full = measure(null);
  if (full.end <= maxSeconds) return score(null, full);
  const sungLines = full.staged.filter((e) => e.kind === 'line').map((e) => events.find((x) => x.seq === e.src)).filter(Boolean);
  const firsts = new Set(full.firstOfBeat.values());
  const section = (e) => beats?.beats?.find((b) => b.id === e.beat)?.section ?? String(e.beat ?? '');
  const rank = (e) => (firsts.has(e.seq) ? 0 : /chorus/.test(section(e)) ? 1 : 2);
  const order = sungLines.slice().sort((x, y) => rank(x) - rank(y) || x.seq - y.seq);
  let best = full, only = null;
  for (let keep = order.length - 1; keep >= 0 && rank(order[keep]) > 0; keep--) {
    only = new Set(order.slice(0, keep).map((e) => e.seq));
    best = measure(only);
    if (best.end <= maxSeconds) break;
  }
  if (best.end <= maxSeconds) return score(only, best);
  // still too long (a talkative crew): leave out remarks until it fits
  const skip = new Set();
  for (const e of remarksToSkip(events)) {
    skip.add(e.seq);
    best = measure(only, skip);
    if (best.end <= maxSeconds) break;
  }
  return score(only, best, skip);
}

/**
 * The remarks a recorded making-of may leave out, in the order it leaves them out: a crew thought that asks nothing
 * (no consultation, no "?"), answers nothing (no answers field, no consultation's answer by the blackboard's rule),
 * is not its beat's first thought, and that the next crew thought does not react to (said to its bot: "Nice one,
 * Pink!" after Pink's); the ones addressed to nobody first, then from the beat that keeps the most thoughts, the
 * latest there first (every beat keeps its talk as long as it can).
 */
export function remarksToSkip(events) {
  const answered = new Set([...events.filter((e) => e.answers != null).map((e) => e.seq), ...[...pairConsultations(events).values()].map((a) => a.seq)]);
  const talk = events.filter((e) => !e.lyric && e.summary);
  const firstThought = new Set();
  const seen = new Set();
  for (const e of talk) if (!seen.has(e.beat)) { seen.add(e.beat); firstThought.add(e.seq); }
  const reactedTo = (e, i) => {
    const next = talk.slice(i + 1).find((x) => x.bot !== e.bot);
    return Boolean(next && addresseeOf(next.summary, next.bot) === e.bot);
  };
  const pool = talk.filter((e, i) => e.status !== 'consulting' && !answered.has(e.seq) && !/\?\s*$/.test(e.summary)
    && !firstThought.has(e.seq) && !reactedTo(e, i));
  const kept = new Map();
  for (const e of talk) kept.set(e.beat, (kept.get(e.beat) ?? 0) + 1);
  const named = (e) => Number(addresseeOf(e.summary, e.bot) !== null);
  const out = [];
  while (pool.length) {
    pool.sort((x, y) => named(x) - named(y) || kept.get(y.beat) - kept.get(x.beat) || y.seq - x.seq);
    const e = pool.shift();
    kept.set(e.beat, kept.get(e.beat) - 1);
    out.push(e);
  }
  return out;
}

/**
 * The cast's places in the studio for the making-of: the seven role bots in an arc in front (CREW order, left to
 * right as the camera sees them), the rest of the cast in a row behind them. Returns Map name -> [x, y, z].
 */
export function crewFormation(names = NAMES) {
  const out = new Map();
  CREW.forEach((n, k) => {
    const x = -2.7 + (5.4 * k) / (CREW.length - 1);
    out.set(n, [x, 0.8, 0.6 - 0.8 * (1 - (x / 2.7) ** 2)]);
  });
  const rest = names.filter((n) => !CREW.includes(n));
  rest.forEach((n, k) => {
    const x = rest.length > 1 ? -3.2 + (6.4 * k) / (rest.length - 1) : 0;
    out.set(n, [x, 1.6, -1.6 - 0.9 * (1 - (x / 3.2) ** 2)]);
  });
  return out;
}
