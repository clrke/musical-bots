// The making-of as a musical number: the crew's events become a song on the premiere's engine (song/form.js,
// song/tunes.js, song/mix.js). Every role bot sings its thought (the event's summary: since Oct 31 a line said to a
// crewmate, "White, is G too bright here?", sung as written and to that bot, never to the viewer; older bundles' in
// the team's voice, "we") on a child tune in its own voice; Green sings the lines he proposes on the tune the
// premiere gives them, so the song is heard taking shape; a consultation is a duet: the asker glides over and sings
// its question, the bot it asks sings its answer (the event that answers it), and a hand play seals it (a handshake,
// a high five, a fist bump, a pinky promise, both singing the word). The crew bots who do not sing the phrase sing
// the backing under it ("Ooh" and "Ah" pads, a "Mm" on the root, "Bom, bom" in the livelier sections) and now and
// then answer a line in its gap, in the room ("Yeah!", "Uh-huh!", "Nice!", to a question "Hmm!"; to Green's line its
// last words). A thought that names a crewmate is said to it: the singer turns to that bot, which looks back and nods
// (staged event `to`). While they think, the bots gesture (chin-stroke, scratch-head, count-beats, binoculars ...).
//
// The loading bar (Oct 31, owner: "the bots should sing in accordance to how long it takes to set up the output"):
// the making-of lasts as long as the production did, and each event is sung on the bar grid at or after the moment
// it was written (its `t`: seconds since the Muse run started), never before. The score runs on the production's
// clock: add(events, now) takes what arrived by `now` (live: as the director writes; a recorded making-of: the
// bundle replayed on its own timeline, tick by tick, by the same rules, so the two sound alike), queues it, and lays
// out what is due a few seconds ahead (LOOKAHEAD). What it says first: every consultation (a duet, sung when its
// answer has arrived) and Green's first new line of each beat; then the side remarks (the crew's other thoughts,
// Green's other lines) while they are fresh (at most MAX_LAG after they were said); one that would come later is an
// aside (shown, not sung: staged `kind: 'aside'`). Nothing is sung faster to catch up. Where the production is busy
// and nobody has anything new to say (the director planning, Green writing the lyrics), the groove runs, the crew's
// pads hold the chords, and now and then the crew sings its work song (the refrain: "Bom, bom, build it up!" and a
// line of its own or the episode's hook), the hook of the making-of, returning like a chorus.
//
// The tunes, at the premiere's pace: a tune bar is a bar of the groove (MAKING_OF_TEMPO, four beats, one chord), so
// a line of talk takes two bars (up to eight syllables: about 1.5-2 syllables/s; longer, four), the child tunes of
// tunes.js sung as talk (nothing quicker than an eighth), chord tones on the strong beats, the words' stress fitted,
// a weak first syllable as the pickup, a crewmate's name on a strong beat and held. A question asks (ends open, on
// so), its answer walks home to do: with its seal, a little stanza; a thought asks or answers by the chord it ends on.
//
// The form. Each beat of the episode is a section of the making-of, named as the premiere's, from its first phrase
// to the next beat's; its progression from the section's function set (form.js PROGRESSION_SETS), one chord a bar,
// fitted (a recorded making-of) to the bars its talk takes so it ends as the set does (the intro, the build verses,
// bridge 2 on V; the choruses and the outro V7 -> I, the song on I); the idle bars after it (the groove, the work
// song) go round the progression again; before the first section the warm-up vamp (WARM).
//
// Pure and deterministic (no clock, no Math.random): the browser plays the same score every time, and node tests
// read it. Used by making-of.js (the replay: scoreMakingOf; live: new MakingOfScore({ live: true }).add as events
// arrive and on the player's ticks).
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
import { tuneNotes, holdBars, tuneBars, replyNotes, echoOf, echoShape, pickupPitches, TALK_MIN_IOI } from './song/tunes.js';
import { layerGain, storySpans, syllableSpans } from './song/mix.js';

/** The making-of's groove: four beats a bar, one chord a bar; a tune bar is a bar (the premiere's pace). */
export const MAKING_OF_TEMPO = 96;
/** The tunes' tempo: their beat is the groove's. */
export const TUNE_TEMPO = MAKING_OF_TEMPO;
/** Tune bars a bar of the groove (one chord). */
export const HALVES = 1;
/** s: the score is told on the production's clock, looked at this often (live: the player's ticks; a replay the same). */
export const TICK = 1;
/** s: nothing is placed sooner than this after it arrives (live: the voices render meanwhile; a replay the same). */
export const LEAD = 2;
/** s: the next unit is laid out when the score's head is this near (so a later arrival can still come first). */
export const LOOKAHEAD = 4;
/** s: a side remark is sung at most this long after it was said (about a section), else it is an aside. */
export const MAX_LAG = 20;
/** Bars of the groove between two work songs, and after the talk before one. */
export const REFRAIN_GAP = 6, REFRAIN_BREATH = 2;
/** The crew's work song: its call, and the lines it answers with by turns (every other time: the episode's hook). */
export const REFRAIN_CALL = 'Bom, bom, build it up!';
export const REFRAIN_LINES = ['Step by step, we make the song', 'Note by note, it comes along', 'Beat by beat, we build it strong'];
/** The work song's tune (the same every time: it is the making-of's hook) and who sings it, by turns. */
const REFRAIN_TUNE = 'march';
const REFRAIN_TRIOS = [['Pink', 'Gold', 'Yellow'], ['Blue', 'Gray', 'White'], ['Green', 'Pink', 'Gray'], ['Yellow', 'White', 'Gold']];
/** The warm-up vamp before the first beat arrives (the director planning). */
export const WARM = ['I', 'vi', 'IV', 'V'];
/** The crew: the seven role bots, left to right as the studio camera sees them in the making-of. */
export const CREW = ['Pink', 'Blue', 'White', 'Green', 'Gold', 'Gray', 'Yellow'];
const ROLE_OF = Object.fromEntries(Object.entries(AGENT_BOT).map(([agent, bot]) => [bot, agent]));

// the grid (tune beats: the groove's quarters; a tune bar of four is a bar of the groove, one chord)
const BAR = 4;
const COUNT_IN = 2; //    bars of the groove before anything is sung
const RING = 2; //        bars the home chord rings after the last phrase
const SEAL_BARS = 1; //   the hand play that seals a duet
const MIN_BARS = 2; //    a line takes two bars at least (Arrangement.MinLineBars)
const PICKUP_ONE = 0.5; //  a pickup syllable: an eighth before the bar line (the premiere's PICKUP_NOTE_BEATS)
const PICKUP_EACH = 0.5;
const MAX_NAME_PICKUP = 2; // the words before a name that opens a line ("Yes, | Gold ...") sung as its pickup
const PICKUP_GAP = 0.1, PICKUP_MIN_LAST = 0.25; // the phrase before a pickup ends this long before it, its last note this long at least
const NAME_MIN_LAST = 1.75; // a line that ends on a crewmate's name holds it this long at least (no pickup cuts it)
const MAX_PICKUP = 1; //  weak syllables a thought sings before the bar line ("We | ask White ...")
const STAGED_BASE = 100000; // staged events' seq (the bundle's own seqs stay on `src`)
const ASIDE_EVERY = 3; // s: the asides follow each other this far apart at least
const LIVE_WAIT = 8; //  events: a question waits this long for its answer before a stand-in answers
/** The tunes the crew's talk is not sung on (their quick syncopations blur the words): their stand-ins. */
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

/** The work song's two lines, the k-th time: its call, and by turns a line of its own or (every other time) the hook. */
export function refrainLines(k, hook = null) {
  const h = String(hook ?? '').trim();
  const n = syllabify(h).length;
  const own = REFRAIN_LINES[Math.floor(k / 2) % REFRAIN_LINES.length];
  return [REFRAIN_CALL, k % 2 === 1 && n >= 3 && n <= 8 ? h : own];
}

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
 * The making-of, laid out bar by bar on the production's clock. add(events, now) takes what arrived by `now`
 * (seconds since the run started; an empty list: a tick) and returns the staged events it adds (timed, in order);
 * flush(now) at the end (the director finished). lines (the sung plans for audio.js: the phrases on the story layer,
 * the gap answers on the echo layer, the work song on the words layer, the backing), items (the timeline for the
 * trailer tools), asides, arrivals (when each beat came in: the loading bar), sections (the form) and end grow
 * with it.
 *
 * opts: beats (beats.json: the form's sections, the seed, the hook, the premiere's tunes for Green's lines), tempo,
 * live (the sections' lengths are not known: their progressions go round; the jobs are made at every add), pairs (a
 * recorded making-of: every consultation's answer, pairConsultations; live: the first answer that arrives),
 * production (s: how long the production took, when known: the loading bar's length), lengths (a scoring before:
 * Map beat -> { bars, fit }, lastBeat, lastOf: the sections' progressions fitted to their talk, the last lines
 * landing home), arranged (arrangedLines, computed once), measure (only the timing: no backing, no jobs).
 */
export class MakingOfScore {
  constructor({ beats = null, tempo = MAKING_OF_TEMPO, live = false, pairs = null, production = null, lengths = null, arranged = null, measure = false } = {}) {
    this.beats = beats;
    this.tempo = tempo;
    this.beat = 60 / tempo; //  the groove's beat (s)
    this.q = this.beat; //      a tune beat (s): the groove's
    this.bar = BAR * this.q; // a bar (s): one chord
    this.live = live;
    this.pairs = pairs;
    this.production = Number(production) > 0 ? Number(production) : null;
    // (a bundle with no clock, every event at 0: nothing is too late)
    this.maxLag = live || this.production ? MAX_LAG : Infinity;
    this.lengths = lengths;
    this.lastOf = lengths?.lastOf ?? null;
    this.measure = measure;
    this.raw = []; // every event so far
    this.known = new Set();
    this.staged = [];
    this.lines = [];
    this.items = [];
    this.asides = [];
    this.arrivals = []; // { t, beat }: when each beat's first event arrived
    this.sections = []; // { beat, section, kind, set, prog, tune, start, bars, fitted, talkEnd, lastTalk }
    this.style = null;
    this.head = COUNT_IN; // bars: the next phrase's downbeat (its pickup sings in the bar before)
    this.queue = []; // { u, side, ready }: what arrived and waits to be sung
    this.sung = new Set(); // line texts the song has
    this.firstOfBeat = new Map(); // beat id -> seq of its first new line
    this.used = new Set(); // events sung as an answer
    this.pending = []; // questions waiting for their answer { q, waited, chained }
    this.duets = 0;
    this.sealFrom = null;
    this.lastGesture = new Map(); // bot -> tune beat of its last gesture ("not busy")
    this.arranged = arranged; // Map seq -> the premiere's line (lazy)
    this.arrangedFor = arranged ? Infinity : -1;
    this.seq = STAGED_BASE;
    this.now = 0;
    this.closed = false;
    this.closedAt = null;
    this.busy = new Map(); // bar -> the bots singing a phrase, a gap answer or a duet there (no backing)
    this.tail = []; // the notes the last phrase ends on (a pickup after it shortens them)
    this.echoing = null; // the phrase before, when a gap answer may follow it
    this.lastShape = null;
    this.echoed = new Map(); // bot -> gap answers sung
    this.backed = 0; // bars with their backing laid out
    this.runs = new Map(); // role -> the backing run going on { bot, from, to, sec }
    this.lastTalk = 0; // bar the crew's talk last ended
    this.placedEnd = 0; // bar the last thing sung ends
    this.lastRefrain = -Infinity; // bar the work song last ended
    this.refrains = 0;
    this.lastAside = -Infinity;
    this.ready = 0; // when the unit being laid out arrived
    this.essential = false; // and whether it is one the making-of always sings (a duet, a beat's first line)
    this.fresh = []; //  the lines and events of this add
    this.freshEvents = [];
  }

  /** Transport seconds of a count of tune beats. */
  sec(tb) { return tb * this.q; }

  /** Seconds the head (the next phrase's downbeat) is at. */
  get headSec() { return this.sec(BAR * this.head); }

  /** Transport seconds the making-of ends: after the last phrase the home chord rings RING bars. */
  get end() { return this.sec(BAR * (this.head + RING)); }

  /** The first bar of the song: the groove plays from the start (the warm-up while the director plans). */
  get startBar() { return 0; }

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
   * The roman a bar plays: before the first section the warm-up (WARM); in a section its progression, fitted to
   * the section's talk when that is known (a recorded making-of), the idle bars after it round the progression again
   * (the last section: on I), else round and round (live); I in the ring after the last phrase.
   */
  romanAt(bar) {
    const s = this.sectionAt(bar);
    if (!s) return WARM[((bar % WARM.length) + WARM.length) % WARM.length];
    const k = bar - s.start;
    const p = chordsOf(s.prog);
    if (s.fitted) {
      if (k < s.fitted.length) return s.fitted[k];
      return s.final ? 'I' : p[(k - s.fitted.length) % p.length];
    }
    if (this.closed && s === this.sections.at(-1) && bar >= this.head) return 'I';
    return p[k % p.length];
  }

  /** The chord name a bar plays. */
  chordAtBar(b) { return chordName(this.romanAt(b)); }
  /** (the old name: a bar was half a bar of the groove) */
  chordAtHalf(h) { return this.chordAtBar(h); }

  /** The chord names of every bar to the end. */
  get halves() { return Array.from({ length: this.head + RING }, (_, h) => this.chordAtBar(h)); }

  /** The chord at a bar (theory.js). */
  chordAt(bar) { return chordFromRoman(this.romanAt(bar), 'C'); }

  /** A beat's place in the episode (beats.json's order, else the order the beats arrived in). */
  beatRank(id) {
    const k = this.beats?.beats?.findIndex((b) => b.id === id) ?? -1;
    if (k >= 0) return k;
    const a = this.arrivals.findIndex((x) => x.beat === id);
    return a >= 0 ? a : Infinity;
  }

  /** The section a phrase of beat `id` is sung in: its own, unless the song has moved on (then the one it is in). */
  beatOf(id) {
    const cur = this.sections.at(-1);
    if (!cur || cur.beat === id) return id;
    if (this.sections.some((s) => s.beat === id) || this.beatRank(id) < this.beatRank(cur.beat)) return cur.beat;
    return id;
  }

  /**
   * A beat of the bundle begins at `bar`: its section, named as the premiere's, its progression from the section's
   * function set (the arranger's chords for the beat when they are one of the set, else the seed's), its tune.
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
    const final = this.lengths?.lastBeat === beatId;
    const s = {
      beat: beatId, section, kind: sectionKind(section) ?? 'verse', set, prog, tune: TOO_QUICK[tune0] ?? tune0,
      start: bar, bars: null, index: k, echoes: 0, firstShape: null, talkEnd: bar, lastTalk: null, final,
      fitted: L && L.fit >= 1 ? fitRomans(chordsOf(prog), section, L.fit, { final }) : null,
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

  /**
   * Takes the events arrived by `now` (transport seconds: the production's clock; none: a tick), queues them and lays
   * out what is due; returns the staged events it adds (timed, in order).
   */
  add(events, now = 0) {
    const fresh = (events ?? []).filter((e) => e && !this.known.has(e.seq));
    for (const e of fresh) this.known.add(e.seq);
    this.raw.push(...fresh);
    this.now = Math.max(this.now, now);
    for (const e of fresh) if (!this.arrivals.some((a) => a.beat === e.beat)) this.arrivals.push({ t: +this.now.toFixed(3), beat: e.beat });
    if (!this.closed) {
      this.catchUp(this.now);
      this.enqueue(fresh);
      this.drain(this.now);
      // live: the backing of the bars laid out (a recorded making-of: all of it at the end)
      if (this.live) this.back(this.head);
    }
    return this.finish();
  }

  /** Nothing is placed in the past, nor sooner than LEAD after now (the voices render meanwhile). */
  catchUp(now) {
    const at = Math.ceil((now + LEAD) / this.bar - EPS);
    if (this.head < at) {
      // the gap answer the last phrase was waiting for, while its bar is still ahead
      const p = this.echoing;
      this.echoing = null;
      if (p && this.sec(BAR * p.lastBar + ECHO_FROM) >= now + LEAD - EPS) this.echo(p, BAR * at, null);
      this.head = at;
      this.tail = [];
    }
  }

  /** At the end (live: the director finished): what still waits is sung (the questions with a stand-in answer); the ring. */
  flush(now = 0) {
    this.now = Math.max(this.now, now);
    if (this.closed) return this.finish();
    for (const p of this.pending.splice(0)) if (!p.chained) this.push(this.duetUnit(p.q, null), false);
    if (this.queue.length) this.catchUp(this.now);
    this.drain(this.now, true);
    if (this.echoing) this.echo(this.echoing, Infinity, null);
    this.echoing = null;
    // the making-of lasts as long as the production did (it ends on the bar the production ended in, or after it)
    const until = Math.max(this.now, this.production ?? 0);
    // (the head the clock pushed on is no end: what was sung last is)
    this.head = Math.max(this.placedEnd, Math.ceil(until / this.bar - EPS) - RING);
    const last = this.sections.at(-1);
    if (last) last.bars = this.head - last.start;
    this.closed = true; // the end is known (the home chord rings there)
    this.closedAt = this.now;
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
    if (!events.length) return events;
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

  // ---------------------------------------------------------------- what arrives, what is said first

  /** The answer to question q that has arrived (a recorded making-of: the one pairConsultations gives it). */
  answerFor(q) {
    if (!this.pairs) return this.firstAnswer(q);
    const a = this.pairs.get(q.seq);
    return a && this.known.has(a.seq) && !this.used.has(a.seq) ? a : null;
  }

  /** Live: the answer to q among the events so far (its `answers` event, else the first later one of a bot it asks). */
  firstAnswer(q) {
    const said = this.raw.find((e) => e.seq > q.seq && e.answers === q.seq && !this.used.has(e.seq));
    if (said) return said;
    return this.raw.find((e) => e.seq > q.seq && q.consult.includes(e.bot) && e.bot !== q.bot && !this.used.has(e.seq)
      && !Number.isInteger(e.answers)) ?? null;
  }

  /** A recorded making-of: an event that answers a question (its duet sings it). */
  answers(e) {
    if (!this.pairs) return false;
    for (const a of this.pairs.values()) if (a.seq === e.seq) return true;
    return false;
  }

  /**
   * A duet unit: the question, its answer, and (when the answer asks someone in turn and that answer has arrived)
   * the chained duet; every answer it sings is marked used, so it is not sung again as a thought.
   */
  duetUnit(q, a) {
    const u = { kind: 'duet', q, a, chain: null };
    if (a) this.used.add(a.seq);
    if (a && a.status === 'consulting' && a.consult?.length) {
      const a2 = this.answerFor(a);
      if (a2 && !this.used.has(a2.seq)) { this.used.add(a2.seq); u.chain = { q: a, a: a2 }; }
      else this.pending.push({ q: a, waited: 0, chained: true });
    }
    return u;
  }

  /** Whether Green's line is new (the song does not have it yet); the first new line of its beat is noted. */
  wantLine(e, parsed) {
    const key = norm(parsed.text);
    if (!key || this.sung.has(key)) return false;
    this.sung.add(key);
    if (!this.firstOfBeat.has(e.beat)) this.firstOfBeat.set(e.beat, e.seq);
    return true;
  }

  /** Seconds a unit will take (a guess from its syllables: two bars a line of eight, four a longer one). */
  estOf(u) {
    const bars = (t) => (syllabify(t).length <= 8 ? 2 : 4);
    if (u.kind === 'thought') return bars(this.voiced(u.e)) * this.bar;
    if (u.kind === 'line') return bars(u.parsed.text) * this.bar;
    let b = bars(this.voiced(u.q)) + (u.a ? bars(this.voiced(u.a)) : 2) + SEAL_BARS;
    if (u.chain) b += bars(this.voiced(u.chain.a)) + SEAL_BARS;
    return b * this.bar;
  }

  /** Queues a unit: an essential one (a duet, a beat's first line) or a side remark (said now, or an aside). */
  push(u, side) {
    const x = { u, side, ready: this.now };
    if (side) {
      // a side remark that would come too late is an aside at once
      const wait = this.queue.reduce((s, y) => s + this.estOf(y.u), Math.max(this.headSec, this.now + LEAD));
      if (wait - this.now > this.maxLag) { this.aside(u); return; }
    }
    this.queue.push(x);
  }

  /**
   * The units of newly arrived events, queued: the questions they answer (and the ones that waited long enough: a
   * stand-in answers), then by beat its consultations, its first new line, and its side remarks (the crew's other
   * thoughts and Green's other lines by turns, the beat's chord event first).
   */
  enqueue(fresh) {
    for (const p of this.pending.slice()) {
      const a = this.answerFor(p.q);
      p.waited += fresh.length;
      // (a recorded making-of waits for the answer it knows comes; live, a stand-in answers after LIVE_WAIT events)
      if (!a && (this.pairs?.has(p.q.seq) || p.waited < LIVE_WAIT)) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      if (p.chained) {
        if (a) { this.used.add(a.seq); this.push({ kind: 'duet', q: p.q, a, asked: false }, false); }
      } else this.push(this.duetUnit(p.q, a), false);
    }
    const byBeat = new Map();
    for (const e of fresh) {
      if (!byBeat.has(e.beat)) byBeat.set(e.beat, []);
      byBeat.get(e.beat).push(e);
    }
    for (const [, evs] of byBeat) {
      const duets = [], first = [], talk = [], lines = [];
      for (const e of evs) {
        const parsed = e.lyric ? parseLyric(e.lyric, NAMES) : null;
        if (parsed?.text && this.wantLine(e, parsed)) (this.firstOfBeat.get(e.beat) === e.seq ? first : lines).push({ kind: 'line', e, parsed });
        if (this.used.has(e.seq) || this.answers(e)) continue; // sung in a duet
        if (e.status === 'consulting' && e.consult?.length) {
          const a = this.answerFor(e);
          if (a) duets.push(this.duetUnit(e, a));
          else this.pending.push({ q: e, waited: 0 });
        } else if (!parsed?.text) talk.push({ kind: 'thought', e });
      }
      const lead = talk.findIndex((u) => u.e.chords?.length);
      if (lead > 0) talk.unshift(...talk.splice(lead, 1));
      // (a beat with no new line of Green's, a chorus sung again: its first thought says it, so it has its section)
      if (!first.length && !duets.length && talk.length && !this.arrivals.some((a) => a.beat === evs[0].beat && a.t < this.now - EPS)) first.push(talk.shift());
      for (const u of [...duets, ...first]) this.push(u, false);
      for (let i = 0; i < Math.max(talk.length, lines.length); i++) {
        if (talk[i]) this.push(talk[i], true);
        if (lines[i]) this.push(lines[i], true);
      }
    }
  }

  /**
   * Lays out what is due: while the head is within LOOKAHEAD of now (force: all of it), the next essential unit,
   * else the next side remark (an aside when it is too late now); nothing waiting: the groove, now and then the work
   * song.
   */
  drain(now, force = false) {
    for (;;) {
      if (!force && this.headSec - now > LOOKAHEAD + EPS) return;
      let k = this.queue.findIndex((x) => !x.side);
      if (k < 0 && this.queue.length) k = 0;
      if (k < 0) { if (!force) this.idle(); return; }
      const [x] = this.queue.splice(k, 1);
      if (x.side && Math.max(this.headSec, now + LEAD) - x.ready > this.maxLag + EPS) { this.aside(x.u); continue; }
      this.ready = x.ready;
      this.essential = !x.side;
      if (this.layout(x.u)) this.lastTalk = this.head;
      this.essential = false;
      this.placedEnd = Math.max(this.placedEnd, this.head);
    }
  }

  /** Nobody has anything new to say: after a breath, the crew's work song (every REFRAIN_GAP bars at most). */
  idle() {
    if (this.closed || this.head - this.lastTalk < REFRAIN_BREATH || this.head - this.lastRefrain < REFRAIN_GAP) return;
    // (a recorded making-of: never past the production's end; it ends with the groove's last bars)
    if (this.production && this.sec(BAR * (this.head + 2 * MIN_BARS + RING)) > this.production + EPS) return;
    this.refrain();
    this.placedEnd = Math.max(this.placedEnd, this.head);
  }

  /** A remark there is no time to sing: shown (the banner's crew chatter), its gesture made, not sung. */
  aside(u) {
    const e = u.e;
    if (!e) return null;
    const text = u.kind === 'line' ? u.parsed.text : this.voiced(e);
    // (one at a time: the banner shows each for ASIDE_EVERY s)
    const t = +Math.max(this.now + 0.05, this.lastAside + ASIDE_EVERY).toFixed(4);
    this.lastAside = t;
    const beat = this.beatOf(e.beat);
    const g = u.kind === 'line' ? '' : this.calm(e.bot, gestureOf(e, 'thought', text).gesture, BAR * Math.floor(t / this.bar));
    const ev = {
      seq: this.seq++, src: e.seq, t, agent: roleOf(e), bot: e.bot, status: e.status ?? 'working', beat, summary: e.summary, lyric: '', line: '',
      chords: [], action: '', consult: [], kind: 'aside', gesture: g, duet: null, doing: u.kind === 'line' ? 'jots a line' : 'says', aside: text, at: e.t,
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
    this.asides.push({ t, bot: e.bot, agent: roleOf(e), kind: u.kind === 'line' ? 'line' : 'thought', beat, seq: e.seq, text });
    return ev;
  }

  layout(u) {
    if (!u) return null;
    if (u.kind === 'thought') return this.thought(u.e);
    if (u.kind === 'line') return this.line(u.e, u.parsed);
    if (u.kind === 'duet') {
      // (a chained question that waited for its answer: the answer phrase that asked it was sung already)
      const asking = u.asked === false ? this.items.find((i) => i.kind === 'answer' && i.seq === u.q.seq) : null;
      const first = this.duet(u.q, u.a, u.asked === false ? (asking ? { item: asking } : null) : true);
      if (u.chain && first) this.duet(u.chain.q, u.chain.a, first);
      return first;
    }
    return null;
  }

  /** Whether a thought or a line is the last talk of its section (the scoring before says so): it lands home. */
  lastIn(seq, beatId) {
    return { last: Boolean(this.lastOf && this.lastOf.get(beatId) === seq), final: Boolean(this.lastOf && this.lastOf.final === seq) };
  }

  // ---------------------------------------------------------------- the sung phrases

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

  /** The section's talk reaches bar `end` (its progression is fitted to it); what it sang last. */
  talked(beatId, end, last) {
    const s = this.sections.find((x) => x.beat === beatId);
    if (!s) return;
    s.talkEnd = Math.max(s.talkEnd, end);
    s.lastTalk = last;
  }

  /**
   * Puts a sung part on the score: its staged event (card CARD_LEAD before the voice), its plan for the voice pool
   * (notes in tune beats from transport 0; the job is made when the add is done), its timeline item (item: false,
   * none). Returns { ev, item, line, bar, bars, notes }.
   */
  place({ bot, text, notes, bar, bars, voice = engineVoice(bot), beatId, layer = 'story', role = 'lead', db = 0, part, item: withItem = true, src = null, kind,
    agent, status = 'working', action = '', consult = [], gesture = '', duet = null, doing = '', consultSeq = null, line = '', singsFor = null, summary = text, at = null, to = null, extra = null }) {
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
      item = { t0: +t0.toFixed(3), t1: +this.sec(last.tb + last.dur).toFixed(3), bot, agent, kind, beat: beatId, seq: src, ...(consultSeq !== null ? { consultSeq } : {}), text, ...(extra ?? {}), ...(this.essential && kind !== 'refrain' ? { essential: true } : {}) };
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
   * last talk of its section (a chorus's or the outro's lands on the home chord; final: the song's last); echo: a
   * crew member may answer it in its gap.
   */
  phrase(bot, text, { beatId, last = false, final = false, shape = 'auto', start = null, melody = null, pickup = null, echo = false, ...rest }) {
    const sylls = syllabify(text);
    if (!sylls.length) return null;
    const voice = engineVoice(bot);
    // the crewmate the talk names (not Green's lines: they are the song's): its name on a strong beat, held
    // (held only when that takes no more bars than the line needs anyway: the premiere's pace before the name)
    const b = this.head;
    const sec = this.enter(beatId, b);
    const tune = melody ?? sec.tune;
    let nk = rest.kind === 'line' ? -1 : nameSyllable(sylls, addresseeOf(text, bot));
    const pickupFor = (k) => {
      let x = Math.max(0, Math.min(pickup ?? pickupOf(sylls), sylls.length - 1));
      if (k >= 0) x = k >= 1 && k <= MAX_NAME_PICKUP && k <= sylls.length - 3 ? k : Math.min(x, k);
      while (x > 0 && !this.roomFor(x)) x--;
      return x;
    };
    let m = pickupFor(nk);
    if (nk >= 0 && holdBars(tune, sylls.length - m, MIN_BARS, nk >= m ? [nk - m] : [], sylls.slice(m)) > holdBars(tune, sylls.length - m, MIN_BARS, [], sylls.slice(m))) {
      nk = -1;
      m = pickupFor(-1);
    }
    const holdOf = (x) => (nk >= x ? [nk - x] : []);
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
      role: 'lead', voice, key: 'C', tempo: this.tempo, startBar: s, cadenceBar: home ? s + bars - 1 : null, minBars: MIN_BARS, closeLast: true,
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
    placed.line.nameAt = nk >= 0 ? nk : null; // (the syllable of the crewmate's name held, when it is)
    this.tail = [{ note: notes.at(-1), min: nk >= 0 && nk === sylls.length - 1 ? NAME_MIN_LAST : PICKUP_MIN_LAST }];
    this.head = b + bars;
    this.talked(sec.beat, this.head, ['thought', 'line'].includes(rest.kind) ? { kind: rest.kind, src: rest.src } : { kind: rest.kind });
    const lastBar = b + bars - 1;
    const lastIn = notes.at(-1).tb - BAR * lastBar;
    const k = sec.phrases ?? 0;
    sec.phrases = k + 1;
    if (echo && !home && !(nk >= 0 && nk === sylls.length - 1) && ['intro', 'verse', 'chorus', 'outro'].includes(sec.kind) && lastIn <= 2 + EPS
      && (rest.kind === 'line' || sec.kind !== 'verse' || k % 2 === 1)) this.echoing = { ...placed, sec, lastBar, text, bot, kind: rest.kind, reply: rest.reply ?? null };
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
    // (after the line's last note: from beat 3, or (it falls on beat 3) beat 4, then a one-word reaction)
    const lastIn = p.notes.at(-1).tb - b0;
    const s = b0 + Math.max(ECHO_FROM, lastIn + 1), e = Math.min(b0 + ECHO_END, endTb - 0.15);
    const words = echoOf(p.text);
    const n0 = syllabify(words).length;
    const h = hash(`${p.ev.seq}:${p.text}`);
    // (a crewmate's thought is talk: a reaction answers it; its last words echoed back would sound like a parrot)
    const asks = /\?\s*$/.test(p.text);
    const replies = asks ? QUESTION_REPLIES : INTERJECTIONS;
    // (Green's line as the premiere will sing it: with its pal's reply, " >> Ooh!", when it has one)
    const reply = p.reply && syllabify(p.reply).length <= ECHO_MAX_SYLLABLES ? p.reply : null;
    let text = reply ?? (p.kind === 'line' && n0 >= 1 && n0 <= ECHO_MAX_SYLLABLES ? words : replies[h % replies.length]);
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
    const cut = Math.max(LEAD_CUT, s - b0 - 0.25);
    if (ln.tb + ln.dur > b0 + cut) ln.dur = Math.max(PICKUP_MIN_LAST, b0 + cut - ln.tb);
    const sec = p.sec;
    if (sec.firstShape === null) sec.firstShape = h % 12;
    const voice = engineVoice(bot);
    const { low, high } = voiceRange(voice);
    const roman = this.romanAt(p.lastBar), chord = chordFromRoman(roman, 'C');
    const r = replyNotes({
      shape: echoShape(sec.firstShape, sec.echoes), syllableCount: n, chord: roman, voice, tempo: this.tempo, answerIndex: sec.echoes,
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

  thought(e) {
    const text = this.voiced(e);
    const { action, gesture } = gestureOf(e, 'thought', text);
    const to = addresseeOf(text, e.bot);
    const beatId = this.beatOf(e.beat);
    return this.phrase(e.bot, text, {
      beatId, ...this.lastIn(e.seq, beatId), echo: true, src: e.seq, kind: 'thought', agent: roleOf(e), status: e.status ?? 'working',
      action, gesture, consult: e.consult ?? [], summary: e.summary, at: e.t, ...(to ? { to } : {}),
      doing: e.status === 'proposing' ? 'has an idea' : e.status === 'done' ? 'signs off' : 'thinks it through',
    });
  }

  /** Green's line: on the tune the premiere gives it, asking or answering as it does there (the song taking shape). */
  line(e, parsed) {
    const bot = e.bot;
    const first = this.firstOfBeat.get(e.beat) === e.seq;
    const tune = this.arrangedLine(e);
    const text = tune && syllabify(tune.text).length ? tune.text : parsed.text;
    const beatId = this.beatOf(e.beat);
    return this.phrase(bot, text, {
      beatId, ...this.lastIn(e.seq, beatId), echo: true, melody: tune?.tune && !TOO_QUICK[tune.tune] ? tune.tune : null, start: tune ? tune.start : null,
      pickup: tune ? Math.min(tune.pickup, 3) : 0,
      src: e.seq, kind: 'line', agent: roleOf(e), status: 'proposing', doing: 'proposes a line', line: e.lyric ?? '',
      singsFor: e.singer && e.singer !== bot ? e.singer : null, summary: e.summary, at: e.t, reply: parsed.reply || null,
      gesture: first && !wordCue(parsed.text) ? WRITE[hash(`${e.seq}:${norm(parsed.text)}`) % WRITE.length] : '',
    });
  }

  /**
   * A consultation, sung: the asker glides over singing its question (it asks: up to so), the bot asked sings its
   * answer (home to do), a hand play seals it (both sing its word on the contact), the asker goes home: a little
   * stanza. asked: true, or (a chained duet: the answer that asked this question was already sung) the placed
   * answer phrase that asked it. Sung in the section of the later of the two (a question from beats ago is asked
   * when its answer comes).
   */
  duet(q, a, asked = true) {
    const asker = q.bot;
    const host = a?.bot && a.bot !== asker ? a.bot : q.consult.find((n) => n !== asker) ?? q.consult[0];
    if (!host) return null;
    // the seals by turn, from a place the episode picks (its first question): varied, the same every time
    this.sealFrom ??= hash(`${q.seq}:${q.summary ?? ''}`) % SEALS.length;
    const seal = SEALS[(this.sealFrom + this.duets++) % SEALS.length];
    const beatId = this.beatOf(a && this.beatRank(a.beat) > this.beatRank(q.beat) ? a.beat : q.beat);
    let question = null;
    if (asked === true) {
      question = this.phrase(asker, this.voiced(q, asker), {
        shape: 'ask', beatId, src: q.seq, kind: 'question', agent: roleOf(q),
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
      shape: 'answer', beatId: this.sections.at(-1)?.beat ?? beatId, src: a?.seq ?? null, kind: 'answer',
      agent: a ? roleOf(a) : ROLE_OF[host] ?? 'cast', status: 'consulting', consult: [asker], doing: `answers ${asker}`, consultSeq: q.seq,
      action, gesture, summary: a?.summary ?? '', at: a?.t ?? q.t,
      duet: { visit: asked === true ? 'stay' : 'in', with: asker, until: 0 },
    });
    if (!answer) return null;
    // the seal: the hand play on the bar line, the word both sing on its contact: in the answer's last bar when the
    // answer is done by then (its last note cut before the word), else on the next bar; a duet sung late (more than
    // MAX_LAG after it was said: the production went on meanwhile) seals it without a word, in the answer's last bar
    let sb = this.head, silent = false;
    const ln = answer.notes.at(-1), inLast = BAR * (sb - 1) + seal.at;
    if (ln.tb <= inLast - 0.75 + EPS && ln.tb >= BAR * (sb - 1) - EPS) {
      sb -= 1;
      ln.dur = Math.max(PICKUP_MIN_LAST, Math.min(ln.dur, inLast - 0.1 - ln.tb));
    } else if (this.sec(BAR * sb) - this.ready > this.maxLag) {
      sb -= 1;
      silent = true;
    }
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
    const wordAt = BAR * sb + seal.at;
    const sylls = syllabify(seal.word);
    const chord = this.chordAt(Math.floor(wordAt / BAR));
    const tail = [];
    for (const [bot, top] of silent ? [] : [[asker, false], [host, true]]) {
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
      const notes = sylls.map((_, i) => ({ tb: wordAt + 0.5 * i, dur: i === sylls.length - 1 ? 0.75 : 0.5, midi: m, strong: i === 0 }));
      const other = bot === asker ? host : asker;
      this.place({
        bot, text: seal.word, notes, bar: sb, bars: SEAL_BARS, voice, beatId: answer.ev.beat, src: q.seq, kind: 'seal', item: false,
        agent: bot === asker ? roleOf(q) : answer.ev.agent, status: 'consulting', consult: [other], doing: `seals it with ${other}`,
        duet: { visit: 'stay', with: other, until: +(this.sec(sealEnd) - this.sec(wordAt) + CARD_LEAD).toFixed(3) }, db: -3,
        summary: q.summary, at: q.t,
      });
      tail.push({ note: notes.at(-1) });
    }
    if (!silent) this.tail = tail;
    this.head = sb + SEAL_BARS;
    this.talked(answer.ev.beat, this.head, { kind: 'duet' });
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
   * The crew's work song at the head (the making-of's hook, while the production works on and nobody has news):
   * its call and its answer (refrainLines), two bars each on the same tune every time, sung together by three of the
   * crew (by turns), each in its own octave; the others keep the pads.
   */
  refrain() {
    // (the gap answer the last phrase waits for comes first, in its last bar)
    if (this.echoing) this.echo(this.echoing, BAR * this.head, null);
    this.echoing = null;
    const k = this.refrains++;
    const lines = refrainLines(k, this.beats?.hook);
    const trio = REFRAIN_TRIOS[k % REFRAIN_TRIOS.length];
    const lead = engineVoice(trio[0]);
    const beatId = this.sections.at(-1)?.beat ?? null;
    let b = this.head;
    const tail = [];
    lines.forEach((text, j) => {
      const sylls = syllabify(text);
      if (!sylls.length) return;
      const bars = tuneBars(REFRAIN_TUNE, sylls.length, MIN_BARS, { talk: true }) || MIN_BARS;
      const romans = Array.from({ length: bars + 1 }, (_, i) => this.romanAt(b + i));
      const s = stanzaStart(j % 2 === 0 ? 'ask' : 'answer', bars);
      const r = tuneNotes({
        melody: REFRAIN_TUNE, syllableCount: sylls.length, syllables: sylls, stress: sylls.map((x) => x.stress), chords: [...Array(s).fill('I'), ...romans],
        role: 'lead', voice: lead, key: 'C', tempo: this.tempo, startBar: s, minBars: MIN_BARS, closeLast: true, talk: true,
      });
      if (r.notes.length !== sylls.length) return;
      const base = r.notes.map((n) => ({ tb: BAR * b + n.t / this.q, dur: n.dur / this.q, midi: n.midi, strong: n.strong }));
      for (const { note } of this.tail) note.dur = Math.max(PICKUP_MIN_LAST, Math.min(note.dur, base[0].tb - PICKUP_GAP - note.tb));
      this.tail = [];
      tail.length = 0;
      trio.forEach((bot, i) => {
        const voice = engineVoice(bot);
        const { low, high } = voiceRange(voice);
        const notes = base.map((n) => {
          let midi = n.midi;
          while (midi > high) midi -= 12;
          while (midi < low) midi += 12;
          return { ...n, midi };
        });
        this.place({
          bot, text, notes, bar: b, bars, voice, beatId, layer: 'words', role: 'refrain', kind: 'refrain', item: i === 0, agent: roleOf({ bot }),
          status: 'working', doing: 'sings the work song', summary: text, extra: { with: trio.slice(1) },
        });
        tail.push({ note: notes.at(-1) });
      });
      b += bars;
      this.tail = [...tail];
    });
    this.head = b;
    this.lastRefrain = b;
    this.lastShape = 'answer';
  }

  /**
   * The backing to bar `to` (StorySong.cs's sung backing, the making-of's): in each bar the crew members who sing
   * no phrase, gap answer, work song or duet there hold its chord, each a part of its section's kind (BACKING: an
   * "Ooh" / "Ah" pad on the third or the fifth, a "Mm" on the root, "Bom, bom" or a held "Ooh" in the bass), each on
   * its RoleTone placed by the Pick cost (tunes.js), one cell a bar; a part keeps its singer while it is free, else
   * the free member whose voice fits it best takes it. Each run of bars one singer sings a part is one event.
   */
  back(to) {
    if (this.measure) return;
    // (live: never in the past)
    const from = Math.max(this.backed, this.startBar, this.live ? Math.ceil((this.now + LEAD) / this.bar - EPS) : 0);
    const style = this.styleOf();
    const pitchOf = { pad: style.backing.padPitch, pad2: style.backing.padPitch === 'third' ? 'fifth' : 'third', root: 'root', bass: 'bass' };
    const warm = { beat: null, section: 'intro', kind: 'intro' }; // (the warm-up, before the first beat)
    for (let bar = from; bar < to; bar++) {
      const sec = this.sectionAt(bar) ?? warm;
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
      const r = tuneNotes({ melody, syllableCount: n, chords: [this.romanAt(bar)], role: pitchOf[pitch] ?? pitch, voice, tempo: this.tempo, octave: role === 'bass' && voice === 'basso' ? 1 : 0 });
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

  /**
   * The loading bar at transport time t: the beats that have arrived (k of `of`, the one the crew is on), and how
   * far the production is (frac 0-1: a recorded making-of by its clock, the production's length known; live by the
   * beats arrived, full when the director is done). Never goes back.
   */
  progressAt(t) {
    const arrived = this.arrivals.filter((a) => a.t <= t + EPS);
    const of = this.beats?.beats?.length || FORM.length;
    const k = arrived.length;
    let frac;
    if (this.production) frac = Math.min(1, Math.max(0, t / this.production));
    else if (this.closedAt !== null && t >= this.closedAt - EPS) frac = 1;
    else frac = Math.min(1, k / (of + 1));
    return { k, of, beat: arrived.at(-1)?.beat ?? null, frac, planning: k === 0 };
  }
}

/** How a scoring laid out its sections: Map beat -> { bars, fit (bars its talk took) }, lastBeat, lastOf (its last lines). */
function lengthsOf(s) {
  const out = new Map(s.sections.map((x) => [x.beat, { bars: x.bars, fit: Math.max(0, x.talkEnd - x.start) }]));
  out.lastBeat = s.sections.at(-1)?.beat;
  out.lastOf = new Map();
  for (const x of s.sections) if (x.lastTalk?.src != null && ['thought', 'line'].includes(x.lastTalk.kind)) out.lastOf.set(x.beat, x.lastTalk.src);
  out.lastOf.final = out.lastOf.get(out.lastBeat) ?? null;
  return out;
}
const sameLengths = (a, b) => a && b && JSON.stringify([[...a], a.lastBeat, [...a.lastOf], a.lastOf.final]) === JSON.stringify([[...b], b.lastBeat, [...b.lastOf], b.lastOf.final]);

/**
 * A recorded making-of, scored on its own clock: the bundle replayed by the rules the live one plays by (TICK by
 * TICK, each event arriving at its `t`), so it lasts as long as the production did (`production`: director.json's
 * wallSeconds, else the last event's t) and sings each event at or after the moment it was written. Scored until
 * the sections' lengths are stable (their progressions fitted to them, each section's last line landing home: the
 * timing does not depend on the chords), then once more in full. Returns the MakingOfScore.
 */
export function scoreMakingOf(events, beats = null, { tempo = MAKING_OF_TEMPO, production = null } = {}) {
  const evs = [...(events ?? [])].sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0) || a.seq - b.seq);
  const lastT = evs.reduce((m, e) => Math.max(m, Number(e.t) || 0), 0);
  const prod = Math.max(lastT, Number(production) || 0);
  const arranged = arrangedLines(events, beats);
  const pairs = pairConsultations(events);
  const run = (lengths, measure) => {
    const s = new MakingOfScore({ beats, tempo, arranged, lengths, measure, pairs, production: prod });
    let i = 0;
    for (let k = 0; k * TICK <= prod + EPS; k++) {
      const now = k * TICK, due = [];
      while (i < evs.length && (Number(evs[i].t) || 0) <= now + EPS) due.push(evs[i++]);
      s.add(due, now);
    }
    if (i < evs.length) s.add(evs.slice(i), prod);
    s.flush(prod);
    return s;
  };
  let lengths = lengthsOf(run(null, true));
  for (let pass = 0; pass < 4; pass++) {
    const next = lengthsOf(run(lengths, true));
    if (sameLengths(next, lengths)) break;
    lengths = next;
  }
  return run(lengths, false);
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
