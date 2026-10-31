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
// The consultations (Oct 31, owner: "make making-of lyrics more comprehensive and structured"; consultation.js): a
// consultation is a conversation of typed moves, and the making-of sings it as a little song of its own, the asker
// and the host by turns, the asker gone over to the host: the permission a pickup couplet, the context a verse, the
// question and its acknowledgement a pre-chorus, the host's reasoning its own verse, the answer the chorus, a follow-up
// the bridge, the agreement and the thanks the outro tag, sealed by a hand play; each part on a progression of its
// function set (song/form.js), laid over the bars it takes, a question ending open on V, an answer resolving V7 -> I.
// The opening and the reply are one stretch, sung when the reply is there; the follow-up and the closing when they
// come; never before a line's own time. They are essential (always sung, however late: the making-of runs longer),
// a beat's first line goes before a stretch that waits, and the backing sings under each part in its kind.
//
// The tunes, at the premiere's pace: a tune bar is a bar of the groove (MAKING_OF_TEMPO, six beats in 6/4, one chord), so
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
  FORM, sectionKind, isCadenceSection, chooseStyle, tuneOf, progressionOf, chordsOf, chordName, progressionSetOf, progressionIdIn, fitRomans, PROGRESSION_SETS, BEATS_PER_BAR,
} from './song/form.js';
import {
  PART_OF, partSet, canonicalOrder, blockOf, threadsOf, sideOf, MOVE_SAYS, OPTIONAL, holdLine, recallLine, resumeLine, unaddressed, ASK_POOL, STOCK_ASK, askKey,
} from './consultation.js';
import { tuneNotes, holdBars, tuneBars, replyNotes, echoOf, echoShape, pickupPitches, TALK_MIN_IOI } from './song/tunes.js';
import { layerGain, storySpans, syllableSpans } from './song/mix.js';
import { activityLines, writtenTimes } from './activity-lines.js';
import { SETS, DEFAULT_SET, resolveSets } from './scene/environments/sets.js';

/**
 * The making-of's groove: one chord a bar; a tune bar is a bar (the premiere's pace). 6/4 since Oct 31 (the show's
 * meter, form.js BEATS_PER_BAR: six beats felt in two, as the premiere): 144, its bar the 2.5 s of the old 4/4 at 96.
 */
export const MAKING_OF_TEMPO = 144;
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
/** s: a consultation's block sung this late shows its optional lines past the first (consultation.js OPTIONAL) on the
 * card; this late, all of them (the making-of is the loading bar: it keeps up with the production). */
export const TRIM_LAG = 6, CUT_LAG = 15;
/** A consultation's line of at most this many syllables is sung in one bar ("Sure, go ahead", "Thanks, Blue!"). */
export const SHORT_LINE = 6;
/** The premiere's pace a phrase keeps: at most this many syllables/s (onset to onset), no syllable shorter than this (s). */
export const MAX_TALK_RATE = 2.0, MIN_SYLLABLE_SEC = 0.25;
/** s: with consultations, a side remark is sung at most this long after it was said, else an aside. */
export const SIDE_LAG = 10;
/**
 * The consultations kept contiguous (Nov 1, the owner: "barrages of different questions that get answered waaaay after
 * it was asked"): at most this many questions on hold at once (asked, acknowledged with "let me think on it", the
 * answer still to come); another opening waits while one is, unless its answer is there by the time it is asked.
 */
export const MAX_OPEN = 1;
/** s: a consultation taken up again after other talk, or after this long, opens with a recall of the question. */
export const RECALL_GAP = 12;
/** s: a side remark shown on the banner later than this after it was said (past the consultations) is let go. */
export const SIDE_SHOW_LAG = 45;
/** s: a line is sung only this long after it was written at least (its pickup and its card come before the bar line). */
const SLOT_LEAD = 1.0;
/** Bars a host hums its "Hmm" while it thinks over a question it holds: the first HUM_BARS, then one every THINK_EVERY. */
const HUM_BARS = 2, THINK_EVERY = 4;
/** The thinking host's hum (a backing part of its own: [role, syllables, template, chord tone]). */
const THINK_PART = ['think', 'Hmm', 'sustain', 'root'];
/** A thinking pose (the host's reasoning, its hold, its wait). */
const THINKING = ['chin-stroke', 'scratch-head'];
/** s: an aside is on the banner at least this long before a consultation's line clears it (making-of.js). */
const ASIDE_CLEAR = 2;
/** Bars of the groove between two work songs (20 s: the real work is sung first), and after the talk before one. */
export const REFRAIN_GAP = 8, REFRAIN_BREATH = 2;
/** s: a line of the production's real work (activity-lines.js) is sung at most this long after it happened, else dropped. */
export const ACT_LAG = 12;
/** The crew's work song: its call, and the lines it answers with by turns (every other time: the episode's hook). */
export const REFRAIN_CALL = 'Bom, bom, build it up!';
export const REFRAIN_LINES = ['Step by step, we make the song', 'Note by note, it comes along', 'Beat by beat, we build it strong'];
/** The work song's tune (the same every time: it is the making-of's hook) and who sings it, by turns. */
const REFRAIN_TUNE = 'march';
const REFRAIN_TRIOS = [['Pink', 'Gold', 'Yellow'], ['Blue', 'Gray', 'White'], ['Green', 'Pink', 'Gray'], ['Yellow', 'White', 'Gold']];
/** The warm-up vamp before the first beat arrives (the director planning). */
export const WARM = ['I', 'vi', 'IV', 'V'];
/** The crew: the seven role bots, left to right as the camera sees them in the making-of (crewFormation). */
export const CREW = ['Pink', 'Blue', 'White', 'Green', 'Gold', 'Gray', 'Yellow'];
const ROLE_OF = Object.fromEntries(Object.entries(AGENT_BOT).map(([agent, bot]) => [bot, agent]));

// the grid (tune beats: the groove's quarters; a tune bar of four is a bar of the groove, one chord)
const BAR = BEATS_PER_BAR; // (6/4: the beat lengths below are the old 4/4 ones in the same seconds)
const COUNT_IN = 2; //    bars of the groove before anything is sung
const RING = 2; //        bars the home chord rings after the last phrase
const SEAL_BARS = 1; //   the hand play that seals a duet
const MIN_BARS = 2; //    a line takes two bars at least (Arrangement.MinLineBars)
const PICKUP_ONE = 1; //    a pickup syllable: a quarter before the bar line (6/4 at 144: the old eighth at 96, 0.42 s)
const PICKUP_EACH = 1;
const MAX_NAME_PICKUP = 2; // the words before a name that opens a line ("Yes, | Gold ...") sung as its pickup
const PICKUP_GAP = 0.15, PICKUP_MIN_LAST = 0.375; // the phrase before a pickup ends this long before it, its last note this long at least
const NAME_MIN_LAST = 2.625; // a line that ends on a crewmate's name holds it this long at least (no pickup cuts it)
const MAX_PICKUP = 1; //  weak syllables a thought sings before the bar line ("We | ask White ...")
const STAGED_BASE = 100000; // staged events' seq (the bundle's own seqs stay on `src`)
const ASIDE_EVERY = 3; // s: the asides follow each other this far apart at least
const CARD_STEP = 1.5; // s: a consultation's lines on the banner follow each other this far apart at least
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
const ECHO_FROM = 3; //   the echo starts on beat 4 of the line's last bar (the line's last note cut before it)
const ECHO_END = 5.85; // and ends by the bar's end (before the next pickup)
const LEAD_CUT = 2.75; // the line's last note before an echo ends here (it starts by beat 3)
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
  { play: 'high-five', word: 'Yes!', at: 3 },
  { play: 'handshake', word: 'Deal!', at: 3 },
  { play: 'fist-bump', word: 'Boom!', at: 4 },
  { play: 'pinky-promise', word: 'Promise!', at: 4 },
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
/** The making-of cannot stage a set's moves (the crew's formation holds): a gesture says it instead. */
const MOVE_GESTURE = { enter: 'wave', exit: 'wave', march: 'count-beats', huddle: 'beckon', gather: 'beckon', 'walk-to': 'point' };
/** The production's real work (activity-lines.js): what the caption says the bot does, and its hands. */
const WORK_DOING = {
  search: 'looks it up', fetch: 'reads a page', read: 'reads', look: 'looks around', git: 'reads the git log', think: 'thinks',
  status: 'checks the board', plan: 'sends the plan', launch: 'starts the crew', check: 'runs the gate', done: 'signs off', reject: 'hears from the gate',
};
const WORK_GESTURE = {
  search: 'binoculars', fetch: 'binoculars', read: 'chin-stroke', look: 'binoculars', git: 'scratch-head', think: 'chin-stroke', status: 'point',
  plan: 'jazz-hands', launch: 'cheer', check: 'count-beats', done: 'thumbs-up', reject: 'scratch-head',
};

const hash = (s) => hashString(String(s));
/** A consultation's lines that ask (they end open, on V and so) and those that answer (V7 -> I, home to do). */
export const ASKS = new Set(['ask', 'question', 'followup']);
export const RESOLVES = new Set(['answer', 'followup-answer']);
/** The asker or the host of a consultation, from one of its moves (the asker says ask, context ... thanks). */
const sideBot = (e, side) => (sideOf(e.move) === side ? e.bot : e.consult?.[0] ?? null);
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
  // (a consultation's moves are a conversation of their own: sung by its thread, never paired one by one)
  if (!q || q.move || q.status !== 'consulting' || !q.consult?.length) return null;
  const said = events.find((e) => !e.move && e.seq > q.seq && (e.answers === q.seq || (Array.isArray(e.answers) && e.answers.includes(q.seq))) && !used.has(e.seq));
  if (said) return said;
  const cands = events.filter((e) => !e.move && e.seq > q.seq && q.consult.includes(e.bot) && e.bot !== q.bot && !used.has(e.seq)
    && !(Number.isInteger(e.answers) || Array.isArray(e.answers))).slice(0, lookahead);
  const names = new RegExp(`\\b${q.bot}\\b`, 'i');
  return cands.find((e) => names.test(e.summary ?? '')) ?? cands[0] ?? null;
}

/** Every consultation's answer: Map question seq -> answer event (in stream order; an answer answers one question). */
export function pairConsultations(events) {
  const pairs = new Map(), used = new Set();
  for (const q of events) {
    if (q.move || q.status !== 'consulting' || !q.consult?.length) continue;
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
 * gesture (the crew's formation holds). Returns { action, gesture }: action for the stage, gesture for the hands.
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
  constructor({ beats = null, tempo = MAKING_OF_TEMPO, live = false, pairs = null, production = null, lengths = null, arranged = null, measure = false, activity = null, written = null, threads = null } = {}) {
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
    this.lastCard = -Infinity; // (a consultation's last line shown on the banner)
    this.ready = 0; // when the unit being laid out arrived
    this.essential = false; // and whether it is one the making-of always sings (a duet, a beat's first line)
    this.fresh = []; //  the lines and events of this add
    this.freshEvents = [];
    // the production's real work (activity-lines.js lines: the director's research and plan, the crew's thinking and
    // the gate's rejections), sung where nobody has news; and when the queued events were really written
    this.acts = activity ?? [];
    this.actAt = 0;
    this.written = written;
    this.warmSec = null;
    // the consultations (consultation.js threads): each sung as a little song of its parts, as its moves arrive.
    // threads: a recorded making-of's whole threads (threadsOf the bundle: it knows which moves are still to come);
    // live: none (a block is sung when its last kind of move arrives)
    this.allThreads = threads;
    this.th = new Map(); // thread id -> its state as it is sung (threadMove)
    this.over = new Map(); // bar -> the roman a consultation's part plays there (its own progression)
    this.overKind = new Map(); // bar -> the part's backing kind
    this.consultParts = []; // { thread, block (the thread's stretch), part, set, prog, from, to (bars), romans, cadence }
    this.arrivedAt = new Map(); // seq -> when it arrived (s)
    this.thinking = []; // { bot, thread, from, to (bars) }: a host thinking over a question it holds (it hums, it ponders)
    this.quiet = []; // [t0, t1] (s): a consultation's stretch (the banner shows no side remark then)
    this.dropped = []; // side remarks there was no room for on the banner, between the consultations
    this.asideOf = new Map(); // staged aside seq -> its timeline entry
    this.phrases = 0; // phrases placed so far (a consultation taken up after others: a recall)
    this.askKeys = new Set(); // the asks sung so far, as askKey (a stock one again: said another way)
    this.askTurn = 0;
    this.stockAsked = false;
    this.flushing = false;
  }

  /** s: when an event arrived (a recorded making-of knows it ahead: its t, or when it was written, the sooner). */
  arrivalOf(e) {
    const a = this.arrivedAt.get(e.seq);
    if (a !== undefined) return a;
    return this.live ? Infinity : Math.min(Number(e.t) || 0, this.written?.get(e.seq) ?? Infinity);
  }

  /** Whether e may be sung at `sec` (written by then; live: arrived). */
  avail(e, sec) { return this.live ? this.known.has(e.seq) : this.arrivalOf(e) <= sec + EPS; }

  /** s: how late a side remark may be sung (with consultations, whose stretches come first: SIDE_LAG, sooner an aside). */
  get sideLag() { return this.th.size ? Math.min(this.maxLag, SIDE_LAG) : this.maxLag; }

  /** Whether an event has landed in the stream by now (a queued one is sung from when it was written, before). */
  landed(e) { return this.live || !this.written || this.now >= (Number(e.t) || 0) - EPS; }

  /**
   * The beat a phrase of e belongs to: its own once it has landed; before (a thought written ahead, queued for a
   * later beat) the section the song is in, or the warm-up (null) before the first.
   */
  beatFor(e) { return this.landed(e) ? e.beat : this.sections.at(-1)?.beat ?? null; }

  /** The warm-up's section (before the first beat: its chords are WARM; nothing of it is in the form). */
  warm() {
    if (!this.warmSec) {
      const t = tuneOf(this.styleOf(), 'intro');
      this.warmSec = { beat: null, section: 'intro', kind: 'intro', set: null, prog: null, tune: TOO_QUICK[t] ?? t, start: 0, bars: null, index: -1, echoes: 0, firstShape: null, talkEnd: 0, lastTalk: null, final: false, fitted: null };
    }
    return this.warmSec;
  }

  /** A beat arrives (the loading bar): at t, or earlier when one of its events landed sooner. */
  arrive(beat, t) {
    const a = this.arrivals.find((x) => x.beat === beat);
    if (a) a.t = Math.min(a.t, t);
    else this.arrivals.push({ t, beat });
    this.arrivals.sort((x, y) => x.t - y.t);
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
    if (this.over.has(bar)) return this.over.get(bar); // (a consultation's part: its own progression)
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
    for (const e of fresh) this.arrive(e.beat, +(this.live || !this.written ? this.now : Math.max(this.now, Number(e.t) || 0)).toFixed(3));
    for (const e of fresh) if (!this.arrivedAt.has(e.seq)) this.arrivedAt.set(e.seq, this.live ? this.now : Math.min(this.now, Number(e.t) || 0, this.written?.get(e.seq) ?? Infinity));
    if (!this.closed) {
      this.catchUp(this.now);
      this.enqueue(fresh);
      this.drain(this.now);
      // (the hosts thinking over a question they hold: their thinking poses in the bars laid out)
      for (const r of this.thinking) if (r.to === Infinity) this.ponder(r, this.head);
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
    this.flushing = true; // (nothing more comes: no question is put on hold now)
    this.threadsDue(true); // (what a consultation still has: sung as it is)
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
    if (!this.live) this.clearSides();
    return this.finish();
  }

  /**
   * A recorded making-of, at its end: the side remarks on the banner moved out of the consultations' stretches (the
   * banner shows a consultation's own lines then: v19 showed crew chatter between a reply's lines), each up ASIDE_CLEAR
   * s at least before the next stretch, ASIDE_EVERY s apart; one that would show more than SIDE_SHOW_LAG s after it was
   * said, or after the end, is let go (`dropped`).
   */
  clearSides() {
    const spans = this.quiet.slice().sort((a, b) => a[0] - b[0]);
    const sides = this.staged.filter((e) => e.kind === 'aside' && !e.think && !e.move).sort((a, b) => a.t - b.t);
    let last = -Infinity;
    const gone = new Set();
    if (!spans.length) return;
    for (const ev of sides) {
      let t = Math.max(ev.t, last + ASIDE_EVERY);
      for (const [a, b] of spans) if (t + ASIDE_CLEAR > a && t < b) t = b + 0.05;
      const entry = this.asideOf.get(ev.seq);
      if (t > ev.t + EPS && (t - ev.t > SIDE_SHOW_LAG || t > this.end - ASIDE_CLEAR)) {
        gone.add(ev.seq);
        if (entry) { this.asides.splice(this.asides.indexOf(entry), 1); this.dropped.push({ ...entry, kind: entry.kind }); }
        continue;
      }
      ev.t = +t.toFixed(4);
      if (entry) entry.t = ev.t;
      last = t;
    }
    if (gone.size) this.staged = this.staged.filter((e) => !gone.has(e.seq));
    this.asides.sort((a, b) => a.t - b.t);
    const order = this.staged.map((e, i) => [e, i]).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]);
    this.staged = order.map(([e]) => e);
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
    const said = this.raw.find((e) => !e.move && e.seq > q.seq && e.answers === q.seq && !this.used.has(e.seq));
    if (said) return said;
    return this.raw.find((e) => !e.move && e.seq > q.seq && q.consult.includes(e.bot) && e.bot !== q.bot && !this.used.has(e.seq)
      && !Number.isInteger(e.answers)) ?? null;
  }

  /** A recorded making-of: an event that answers a question (its duet sings it). */
  answers(e) {
    if (!this.pairs) return false;
    for (const a of this.pairs.values()) if (a.seq === e.seq) return true;
    return false;
  }

  /** A consultation's move arrives: it joins its thread. */
  threadMove(e) {
    const id = String(e.thread);
    let th = this.th.get(id);
    if (!th) {
      const all = this.allThreads?.get(id) ?? null;
      th = {
        id, asker: all?.asker ?? (e.move === 'ask' ? e.bot : null), host: all?.host ?? (e.move === 'ask' ? e.consult?.[0] : null), first: all?.events[0]?.seq ?? e.seq, all,
        arrived: [], sung: new Set(), carded: new Set(), late: [], seen: new Set(), units: 0, queued: false, state: 'new', owed: false, responded: false,
        firstQ: null, lastQ: null, lastPhrases: 0, lastEnd: 0, thinking: null, k: this.th.size,
      };
      this.th.set(id, th);
    }
    th.asker ??= e.move === 'ask' ? e.bot : sideBot(e, 'asker');
    th.host ??= e.move === 'ask' ? e.consult?.[0] : sideBot(e, 'host');
    th.arrived.push(e);
  }

  /** A consultation's moves still to sing or show, in the order it is sung (a recorded making-of: all of them, known ahead). */
  nextOf(th) {
    return canonicalOrder(th.all ? th.all.events : th.arrived).filter((e) => !th.sung.has(e.seq) && !th.carded.has(e.seq) && !th.late.includes(e));
  }

  /**
   * The consultations that have something to sing, queued (essential: always sung), each as soon as it is written
   * (the making-of is the loading bar): an opening when its question is there (a recorded making-of: all of its
   * opening), else the next of its moves; consult() sings on from there as far as the conversation has been written
   * by the time each line is sung. force (the end): what is left.
   */
  threadsDue(force) {
    for (const th of this.th.values()) {
      if (th.queued || th.state === 'done') continue;
      const next = this.nextOf(th);
      if (!next.length && !(force && th.late.length)) continue;
      const ready = force || (th.units === 0
        ? (th.all ? th.all.events.filter((e) => blockOf(e.move) === 0).every((e) => this.known.has(e.seq)) : th.arrived.some((e) => e.move === 'question'))
        : this.known.has(next[0].seq));
      if (!ready) continue;
      th.queued = true;
      this.push({ kind: 'consult', th }, false);
    }
  }

  /**
   * Whether a consultation's opening flows straight into its reply: the host's acknowledgement, reasoning and answer
   * written by the time the question is sung (a recorded making-of knows; live: they are there).
   */
  flows(th) {
    const list = th.all ? th.all.events : th.arrived;
    const reply = list.filter((e) => blockOf(e.move) === 1 && e.move !== 'ok');
    if (!reply.some((e) => e.move === 'answer')) return false;
    const opening = this.nextOf(th).filter((e) => blockOf(e.move) === 0).length;
    const end = Math.max(this.headSec, this.now + LEAD) + 2 * opening * this.bar;
    return reply.every((e) => this.avail(e, end));
  }

  /**
   * The consultation to sing next (an index in the queue), or -1: one taken up again first (its answer, its follow-up,
   * its closing: the oldest), then an opening that flows into its answer, then (no question on hold: MAX_OPEN) the
   * oldest opening, which the host will put on hold. force: any.
   */
  pickConsult(force) {
    const cs = this.queue.map((x, i) => [x, i]).filter(([x]) => !x.side && x.u.kind === 'consult');
    if (!cs.length) return -1;
    const again = cs.find(([x]) => x.u.th.units > 0);
    if (again) return again[1];
    if (force) return cs[0][1];
    const smooth = cs.find(([x]) => this.flows(x.u.th));
    if (smooth) return smooth[1];
    const held = [...this.th.values()].filter((t) => t.state === 'held').length;
    return held < MAX_OPEN ? cs[0][1] : -1;
  }

  /** A deferred opening (it waits while a question is on hold): no time in the queue's estimate. */
  deferred(u) { return u.kind === 'consult' && u.th.units === 0 && [...this.th.values()].some((t) => t.state === 'held') && !this.flows(u.th); }

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
    if (u.kind === 'consult') return (this.nextOf(u.th).filter((e) => this.known.has(e.seq)).reduce((n, e) => n + bars(this.voiced(e)), 0) + 2 + SEAL_BARS) * this.bar;
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
      const wait = this.queue.reduce((s, y) => s + (this.deferred(y.u) ? 0 : this.estOf(y.u)), Math.max(this.headSec, this.now + LEAD));
      if (wait - this.now > this.sideLag) { this.aside(u); return; }
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
      // a consultation's move: to its thread (sung by its parts, as its blocks are there)
      if (e.move && e.thread != null) { this.threadMove(e); continue; }
      if (!byBeat.has(e.beat)) byBeat.set(e.beat, []);
      byBeat.get(e.beat).push(e);
    }
    this.threadsDue(false);
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
      if (!first.length && !duets.length && talk.length && this.landed(talk[0].e) && !this.arrivals.some((a) => a.beat === evs[0].beat && a.t < Math.min(...evs.map((e) => Number(e.t) || 0)) - EPS)) first.push(talk.shift());
      // (the beat's first line first: it opens its section, before a duet whose answer is in a later beat)
      for (const u of [...first, ...duets]) this.push(u, false);
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
      // (a beat's first line, one phrase, before a consultation's long stretch that waits: the song keeps taking shape
      // and every beat opens its section while the crew's conversations go on)
      let k = this.queue.findIndex((x) => !x.side && x.u.kind !== 'consult');
      // (the consultations one at a time: one taken up again first; a new one waits while a question is on hold)
      if (k < 0) k = this.pickConsult(force);
      if (k < 0) k = this.queue.findIndex((x) => x.side);
      if (k < 0) { if (!force) this.idle(); return; }
      const late = (y) => Math.max(this.headSec, now + LEAD) - y.ready > (y.side ? this.sideLag : this.maxLag) + EPS;
      // the crunch (a burst at the end, more to sing than time: the essential talk is late): every question and its
      // answer is sung, and a late first line of Green's (or the thought opening its beat) is shown, not sung, when its
      // section is opened already (by a thought of its beat)
      const need = () => this.queue.filter((y) => !y.side).reduce((s, y) => s + this.estOf(y.u), Math.max(this.headSec, now + LEAD));
      // (not with consultations: their long stretches are the making-of's own songs, it runs past the production's end
      // anyway, and every beat's first line is sung)
      if (!this.th.size && !this.queue[k].side && this.queue[k].u.kind !== 'duet' && late(this.queue[k]) && this.production && need() > this.production + RING * this.bar) {
        const x = this.queue[k], beat = x.u.e?.beat;
        const opened = this.sections.some((s) => s.beat === beat);
        if (opened) { this.queue.splice(k, 1); this.aside(x.u); continue; }
      }
      const [x] = this.queue.splice(k, 1);
      // (a side remark: an aside when it would come too late, or once the production is over)
      if (x.side && (late(x) || (this.production && Math.max(this.headSec, now + LEAD) >= this.production - EPS))) { this.aside(x.u); continue; }
      this.ready = x.ready;
      this.essential = !x.side;
      if (this.layout(x.u)) this.lastTalk = this.head;
      this.essential = false;
      this.placedEnd = Math.max(this.placedEnd, this.head);
    }
  }

  /** Nobody has anything new to say: after a breath, the crew's work song (every REFRAIN_GAP bars at most). */
  idle() {
    if (this.closed) return;
    if (this.work()) return;
    if (this.head - this.lastTalk < REFRAIN_BREATH || this.head - this.lastRefrain < REFRAIN_GAP) return;
    // (a recorded making-of: never past the production's end; it ends with the groove's last bars)
    if (this.production && this.sec(BAR * (this.head + 2 * MIN_BARS + RING)) > this.production + EPS) return;
    this.refrain();
    this.placedEnd = Math.max(this.placedEnd, this.head);
  }

  /**
   * Nobody has news: the next line of the production's real work (the activity log's, activity-lines.js) that has
   * happened by now and is at most ACT_LAG old (older ones are passed by: there was news then), sung by the bot that
   * did it to a crewmate; a rejection with the crewmate's advice back (an exchange). Never past the production's end.
   * Returns whether it sang.
   */
  work() {
    const acts = this.acts;
    while (this.actAt < acts.length && acts[this.actAt].t < this.now - ACT_LAG - EPS) this.actAt++;
    const u = acts[this.actAt];
    if (!u || u.t > this.now + EPS) return false;
    if (this.production && this.sec(BAR * (this.head + (u.reply ? 2 : 1) * MIN_BARS + RING)) > this.production + EPS) return false;
    const key = `a${this.actAt++}`; // (its id for the scoring after: the last talk of a section lands home)
    const beatId = this.sections.at(-1)?.beat ?? null;
    const role = (bot) => ROLE_OF[bot] ?? 'deals';
    const first = this.phrase(u.bot, u.text, {
      beatId, ...(u.reply ? {} : this.lastIn(key, beatId)), key, kind: 'activity', shape: u.reply ? 'ask' : 'auto', echo: !u.reply, agent: role(u.bot), status: 'working', summary: u.text, at: u.t,
      doing: WORK_DOING[u.kind] ?? 'works', gesture: WORK_GESTURE[u.kind] ?? '', ...(u.to ? { to: u.to } : {}), extra: { work: u.kind },
    });
    if (!first) return false;
    if (u.reply) {
      this.phrase(u.reply.bot, u.reply.text, {
        beatId, ...this.lastIn(`${key}r`, beatId), key: `${key}r`, kind: 'activity', shape: 'answer', agent: role(u.reply.bot), status: 'working', summary: u.reply.text, at: u.t,
        doing: `cheers ${u.bot} on`, gesture: 'thumbs-up', to: u.reply.to, extra: { work: 'advice' },
      });
    }
    this.lastTalk = this.head;
    this.placedEnd = Math.max(this.placedEnd, this.head);
    return true;
  }

  /** A remark there is no time to sing: shown (the banner's crew chatter), its gesture made, not sung. */
  aside(u, at = null) {
    const e = u.e;
    if (!e) return null;
    const text = u.kind === 'line' ? u.parsed.text : this.voiced(e);
    // (one at a time: the banner shows each for ASIDE_EVERY s; `at`: a consultation's line, in its place)
    let t0 = at !== null ? at : Math.max(this.now + 0.05, this.lastAside + ASIDE_EVERY);
    // (a side remark: not over a consultation's stretch, which has the banner; a recorded making-of moves them all at
    // its end, clearSides, as the stretches laid out later are known then)
    if (at === null) for (const [a, b] of this.quiet) if (t0 + ASIDE_CLEAR > a && t0 < b) t0 = b + 0.05;
    const t = +t0.toFixed(4);
    if (at === null) this.lastAside = Math.max(this.lastAside, t);
    const beat = this.beatOf(this.beatFor(e));
    const g = u.kind === 'line' ? '' : this.calm(e.bot, gestureOf(e, 'thought', text).gesture, BAR * Math.floor(t / this.bar));
    const ev = {
      seq: this.seq++, src: e.seq, t, agent: roleOf(e), bot: e.bot, status: e.status ?? 'working', beat, summary: e.summary, lyric: '', line: '',
      chords: [], action: '', consult: [], kind: 'aside', gesture: g, duet: null, doing: u.kind === 'line' ? 'jots a line' : 'says', aside: text, at: e.t,
      ...(e.move ? { move: e.move, thread: String(e.thread) } : {}),
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
    const entry = { t, bot: e.bot, agent: roleOf(e), kind: u.kind === 'line' ? 'line' : 'thought', beat, seq: e.seq, text, ...(e.move ? { move: e.move, thread: e.thread } : {}) };
    this.asides.push(entry);
    this.asideOf.set(ev.seq, entry);
    return ev;
  }

  /**
   * The host thinking over a question it holds (rec: this.thinking's), in the bars laid out so far (to `upTo`): now
   * and then a thinking pose, no words (making-of.js: its hands only), where it sings nothing else.
   */
  ponder(rec, upTo) {
    const th = rec.th;
    for (rec.next ??= rec.from + 1; rec.next < Math.min(upTo, rec.to); rec.next += THINK_EVERY) {
      const b = rec.next;
      if (this.busy.get(b)?.has(rec.bot)) continue;
      const t = +(this.sec(BAR * b) + 0.3).toFixed(4);
      if (t < this.now + 0.05) continue;
      const ev = {
        seq: this.seq++, src: th.lastQ?.seq ?? th.first, t, agent: ROLE_OF[rec.bot] ?? 'cast', bot: rec.bot, status: 'working', beat: this.sectionAt(b)?.beat ?? null, summary: '',
        lyric: '', line: '', chords: [], action: '', consult: [th.asker], kind: 'aside', think: true, thread: th.id, gesture: THINKING[(b + th.k) % THINKING.length],
        duet: null, doing: `thinks over ${th.asker}'s question`, aside: '', at: null,
      };
      this.staged.push(ev);
      this.freshEvents.push(ev);
    }
  }

  /** The way an ask is sung: its own words, unless the episode has asked that way already (a stock ask again: ASK_POOL's next). */
  askText(e, th) {
    const text = this.voiced(e);
    const key = askKey(text, [th.host, th.asker]);
    const stock = STOCK_ASK.test(text);
    if (!this.askKeys.has(key) && !(stock && this.stockAsked)) {
      this.askKeys.add(key);
      if (stock) this.stockAsked = true;
      return text;
    }
    for (let i = 0; i < ASK_POOL.length; i++) {
      const c = ASK_POOL[(this.askTurn + i) % ASK_POOL.length](th.host);
      const k = askKey(c, [th.host]);
      if (this.askKeys.has(k)) continue;
      this.askTurn += i + 1;
      this.askKeys.add(k);
      return c;
    }
    return text;
  }

  layout(u) {
    if (!u) return null;
    if (u.kind === 'consult') return this.consult(u);
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
      this.phrases++;
    }
    this.markBusy(bot, notes[0].tb, notes.at(-1).tb + notes.at(-1).dur);
    if (gesture) this.lastGesture.set(bot, BAR * bar);
    return { ev, item, line: plan, bar, bars, notes };
  }

  /** Whether `body` on `tune` in `minBars` bars (a dry run: no chords laid) sings faster than the premiere's pace. */
  tooQuick(tune, body, minBars, hold, b, shape, start, voice) {
    const bars = holdBars(tune, body.length, minBars, hold, body);
    if (!bars || bars >= MIN_BARS || body.length < 2) return false;
    const romans = Array.from({ length: bars + 1 }, (_, k) => this.romanAt(b + k));
    const want = shape === 'auto' ? 'ask' : shape;
    const s = start !== null ? ((start % 4) + 4) % 4 : stanzaStart(want, bars);
    const r = tuneNotes({
      melody: tune, syllableCount: body.length, syllables: body, stress: body.map((x) => x.stress), chords: [...Array(s).fill('I'), ...romans],
      role: 'lead', voice, key: 'C', tempo: this.tempo, startBar: s, cadenceBar: null, minBars, closeLast: true, talk: true, hold,
    });
    const ts = r.notes.map((n) => n.t); // (seconds)
    if (ts.length !== body.length) return true;
    if (ts.slice(1).some((t, i) => t - ts[i] < MIN_SYLLABLE_SEC - 1e-3)) return true;
    return ts.length >= 3 && (ts.length - 1) / (ts.at(-1) - ts[0]) > MAX_TALK_RATE;
  }

  /**
   * A phrase of `text` by `bot` at the head: its first weak syllable a pickup before the bar line (when the phrase
   * before makes room), the rest on a child tune (`melody`, else its section's) over the section's chords, the words'
   * stress fitted. shape: 'ask' (it ends open, on so), 'answer' (home on do) or 'auto' (by the chord it ends on);
   * start: a stanza bar (Green's line: its bar in the premiere, so it asks or answers as it does there); last: the
   * last talk of its section (a chorus's or the outro's lands on the home chord; final: the song's last); echo: a
   * crew member may answer it in its gap.
   */
  phrase(bot, text, { beatId, last = false, final = false, shape = 'auto', start = null, melody = null, pickup = null, echo = false, chordsFor = null, endOn = null, cadence = false, minBars = MIN_BARS, ...rest }) {
    const sylls = syllabify(text);
    if (!sylls.length) return null;
    const voice = engineVoice(bot);
    // the crewmate the talk names (not Green's lines: they are the song's): its name on a strong beat, held
    // (held only when that takes no more bars than the line needs anyway: the premiere's pace before the name)
    const b = this.head;
    const sec = beatId == null ? this.warm() : this.enter(beatId, b);
    const tune = melody ?? sec.tune;
    let nk = rest.kind === 'line' ? -1 : nameSyllable(sylls, addresseeOf(text, bot));
    const pickupFor = (k) => {
      let x = Math.max(0, Math.min(pickup ?? pickupOf(sylls), sylls.length - 1));
      if (k >= 0) x = k >= 1 && k <= MAX_NAME_PICKUP && k <= sylls.length - 3 ? k : Math.min(x, k);
      while (x > 0 && !this.roomFor(x)) x--;
      return x;
    };
    let m = pickupFor(nk);
    if (nk >= 0 && holdBars(tune, sylls.length - m, minBars, nk >= m ? [nk - m] : [], sylls.slice(m)) > holdBars(tune, sylls.length - m, minBars, [], sylls.slice(m))) {
      nk = -1;
      m = pickupFor(-1);
    }
    const holdOf = (x) => (nk >= x ? [nk - x] : []);
    // (a line allowed one bar, a consultation's short one, takes two when one would sing it faster than the
    // premiere's pace, MAX_TALK_RATE syllables/s or a syllable under MIN_SYLLABLE_SEC: "Hey Gold, got a sec?")
    if (minBars < MIN_BARS && this.tooQuick(tune, sylls.slice(pickupFor(nk)), minBars, holdOf(pickupFor(nk)), b, shape, start, voice)) minBars = MIN_BARS;
    const tuneBarsOf = (x) => holdBars(tune, sylls.length - x, minBars, holdOf(x), sylls.slice(x));
    const bars0 = tuneBarsOf(m);
    // the gap answer to the phrase before (its last bar): this pickup gives way to it when the bars stay as they are
    const before = this.echoing;
    this.echoing = null;
    if (before && m > 0 && tuneBarsOf(0) === bars0) m = 0;
    if (before && m === 0) this.echo(before, BAR * b, bot);
    const bars = tuneBarsOf(m);
    if (!bars) return null;
    // (a consultation's part lays its own progression over the bars the line takes)
    if (chordsFor) chordsFor(b, bars);
    const romans = Array.from({ length: bars + 1 }, (_, k) => this.romanAt(b + k));
    let want = shape;
    if (want === 'auto') want = shapeByChord(romans[bars - 1]) ?? (last || this.lastShape === 'ask' ? 'answer' : 'ask');
    const s = start !== null ? ((start % 4) + 4) % 4 : stanzaStart(want, bars);
    const home = cadence || (last && !this.live && (isCadenceSection(sec.section) || final));
    const body = sylls.slice(m);
    const notesOver = (rs) => tuneNotes({
      melody: tune, syllableCount: body.length, syllables: body, stress: body.map((x) => x.stress), chords: [...Array(s).fill('I'), ...rs],
      role: 'lead', voice, key: 'C', tempo: this.tempo, startBar: s, cadenceBar: home ? s + bars - 1 : null, minBars, closeLast: true,
      talk: true, hold: holdOf(m),
    });
    let r = notesOver(romans);
    if (r.notes.length !== body.length) return null;
    // (a consultation's question or answer whose last syllable comes before the line's last bar, a long line's lone
    // last word: the chord under that word is the one that asks (V) or resolves (V7 -> I), not the empty bar's)
    const endBar = r.notes.length ? Math.floor(r.notes.at(-1).t / this.q / BAR + 1e-6) : bars - 1;
    if (endOn && chordsFor && endBar >= 0 && endBar < bars - 1) {
      if (endOn === 'ask') this.over.set(b + endBar, 'V');
      else {
        if (endBar >= 1) this.over.set(b + endBar - 1, 'V7');
        for (let k = endBar; k < bars; k++) this.over.set(b + k, 'I');
      }
      const again = notesOver(Array.from({ length: bars + 1 }, (_, k) => this.romanAt(b + k)));
      if (again.notes.length === body.length) r = again;
    }
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
    this.talked(sec.beat, this.head, ['thought', 'line', 'activity'].includes(rest.kind) ? { kind: rest.kind, src: rest.kind === 'activity' ? rest.key : rest.src } : { kind: rest.kind });
    const lastBar = b + bars - 1;
    const lastIn = notes.at(-1).tb - BAR * lastBar;
    const k = sec.phrases ?? 0;
    sec.phrases = k + 1;
    if (echo && !home && !(nk >= 0 && nk === sylls.length - 1) && ['intro', 'verse', 'chorus', 'outro'].includes(sec.kind) && lastIn <= ECHO_FROM + EPS
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
    const s = b0 + Math.max(ECHO_FROM, lastIn + 1.5), e = Math.min(b0 + ECHO_END, endTb - 0.15);
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
    // (nor a host thinking over a question it holds)
    const not = new Set([p.bot, next, ...this.thinking.filter((r) => p.lastBar >= r.from && p.lastBar < r.to).map((r) => r.bot)].filter(Boolean));
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
      if (Math.abs(inBar - ECHO_FROM) < EPS || i === n - 1 || !r) {
        let best = null;
        for (let x = low; x <= high; x++) if (chord.tones.includes(mod12(x)) && (best === null || Math.abs(x - midi) + (prev !== null ? 0.2 * Math.abs(x - prev) : 0) < Math.abs(best - midi) + (prev !== null ? 0.2 * Math.abs(best - prev) : 0) - EPS)) best = x;
        midi = best ?? midi;
      }
      while (midi > high) midi -= 12;
      while (midi < low) midi += 12;
      prev = midi;
      return { tb, dur: d, midi, strong: Math.abs(inBar - ECHO_FROM) < EPS };
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
    const b0 = this.beatFor(e);
    const beatId = b0 == null ? null : this.beatOf(b0);
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
   * A consultation's stretch, sung (consultation.js): its moves in order from where it is, the two voices by turns,
   * each line on the bar grid as a thought is, part by part (consultation.js PARTS): the permission a pickup couplet
   * (intro:scene, ends on V), the context a verse (verse:narrative, home), the question and its acknowledgement a
   * pre-chorus (verse:build: up to V, the question asks: up to so), the reasoning the host's own verse (bridge:<tag>),
   * the answer the chorus (chorus:bright, V7 -> I: it lands home on do), the follow-up a bridge (bridge2:<tag>), the
   * agreement and the thanks the outro tag (outro:<tag>, V7 -> I), sealed by a hand play. Each part's progression is
   * one of its function set's (by the thread), laid over the bars its lines take: a line takes the next chords of it,
   * the part's last line its ending (fitRomans: the set's cadence). The asker goes over to the host for the stretch
   * (duet staging) and home after it.
   *
   * It sings on as far as the conversation has been written by the time each line comes (Nov 1, the owner: "Does the
   * asked bot take time to think? ... it's rude that the bots don't acknowledge the question right after it's asked"):
   * the host always takes the question right after it is asked, its own ack when it is there by then (never only on
   * the card), else a hold line ("Let me think on the glow, Blue": consultation.js holdLine) and it thinks it over
   * meanwhile (a thinking pose, a hummed "Hmm": this.thinking); taken up again after other talk, the stretch opens
   * with a recall (the host: "Blue, back to the last name", recallLine; the asker: "Gold, back to the glow",
   * resumeLine), and every line of it carries the question (`about`: the caption shows it). The loading bar: a line
   * sung late shows on the card instead when it is one the making-of can spare (the ok, the context and the reasoning
   * past their first), never a question, the host's acknowledgement, an answer, a follow-up, an agreement or a thanks.
   * Returns the last phrase placed.
   */
  consult(u) {
    const { th } = u;
    th.queued = false;
    const asker = th.asker, host = th.host;
    if (!asker || !host) {
      for (const e of this.nextOf(th)) { th.carded.add(e.seq); this.aside({ kind: 'thought', e }); }
      th.state = 'done';
      return null;
    }
    const style = this.styleOf();
    const block = th.units++;
    const count = (t) => syllabify(t).length;
    const barsOf = (t) => (count(t) <= 8 ? 2 : 4);
    // (where each line will be sung, estimated: two bars a line, four a longer one; a line comes once it is written)
    let est = Math.max(this.headSec, this.now + LEAD);
    const start = est;
    const opener = th.all?.events[0] ?? th.arrived[0];
    const slot = () => est - SLOT_LEAD;
    const over = this.production && this.headSec >= this.production - EPS;
    const lines = []; // { e | cue, bot, text, part, about }
    const cards = []; // { e, after: the index of the sung line before it (-1: with the first) }
    const sing = (x) => { lines.push(x); est += barsOf(x.text) * this.bar; };
    const card = (e) => { cards.push({ e, after: lines.length - 1 }); th.carded.add(e.seq); };
    // the host's yes, written after the conversation had gone on (with its reply): stale, so it is let go (`dropped`)
    const letGo = (e) => { th.carded.add(e.seq); this.dropped.push({ t: this.now, bot: e.bot, agent: roleOf(e), kind: 'thought', beat: e.beat, seq: e.seq, text: this.voiced(e), move: e.move, thread: e.thread }); };
    for (const e of th.late.splice(0)) letGo(e);
    // the host's thinking over the question it held ends here
    if (th.thinking) {
      this.ponder(th.thinking, this.head);
      th.thinking.to = this.head;
      th.thinking = null;
    }
    const next = this.nextOf(th);
    // taken up again after other talk (or a pause): who speaks first reminds the other of the question
    const resumed = block > 0 && (this.phrases > th.lastPhrases || this.headSec - th.lastEnd > RECALL_GAP);
    let about = null;
    if (resumed && th.lastQ) {
      const e0 = next.find((e) => !(e.move === 'ok') && !(e.move === 'ack' && th.responded));
      if (e0 && sideOf(e0.move) === 'host') {
        about = th.lastQ;
        sing({ cue: 'recall', bot: host, text: recallLine(asker, host, th.lastQ.text, { count, k: th.k + block }), part: PART_OF[e0.move === 'followup-answer' ? 'followup-answer' : 'reasoning'], about });
      } else if (e0) {
        about = th.firstQ;
        sing({ cue: 'resume', bot: asker, text: resumeLine(host, th.firstQ.text, { count, k: th.k + block, closing: e0.move === 'agree' || e0.move === 'thanks' }), part: PART_OF[e0.move], about });
      }
    }
    for (const e of next) {
      // (the host's ok after the question: let go; its own ack after a hold line: the card shows it with the recall)
      if (e.move === 'ok' && th.seen.has('question')) {
        if (this.avail(e, slot())) letGo(e);
        else th.late.push(e);
        continue;
      }
      if (e.move === 'ack' && th.responded) {
        if (this.avail(e, slot())) card(e);
        else break;
        continue;
      }
      if (!this.avail(e, slot())) {
        if (e.move === 'ok') { th.late.push(e); continue; } // (its yes comes later: on the card then)
        break;
      }
      const first = !th.seen.has(e.move);
      th.seen.add(e.move);
      // (how late the stretch comes to it: from when it was written, the host's ok from the ask's time, its place)
      const lag = start - this.arrivalOf(e.move === 'ok' ? opener : e);
      const some = lag > TRIM_LAG, all = lag > CUT_LAG;
      // (the first context and the first reasoning line are always sung: what the question needs, and the why of every
      // decision; the rest while the making-of keeps up)
      const spare = (e.move === 'ok' && (over || some)) || (['context', 'reasoning'].includes(e.move) && !first && (over || some || all));
      if (spare) { card(e); continue; }
      sing({ e, bot: e.bot, text: e.move === 'ask' ? this.askText(e, th) : this.voiced(e), part: PART_OF[e.move], about });
      if (e.move === 'ack') th.responded = true;
      if (e.move === 'question' || e.move === 'followup') {
        th.lastQ = { bot: asker, text: this.voiced(e), seq: e.seq };
        th.firstQ ??= th.lastQ;
        th.responded = false;
        th.owed = true;
      }
      if (RESOLVES.has(e.move)) th.owed = false;
    }
    // (a yes written after the question was sung: let go now)
    if (th.seen.has('question')) for (const e of th.late.splice(0)) letGo(e);
    // the question asked, its answer not written yet (or never: the production ended first): the host takes it now,
    // and says it comes back to it
    const lastMove = lines.at(-1)?.e?.move;
    if (lastMove === 'question' || lastMove === 'followup') {
      sing({ cue: 'hold', bot: host, text: holdLine(asker, unaddressed(th.lastQ.text, host), { count, k: th.k + block }), part: PART_OF[lastMove === 'followup' ? 'followup-answer' : 'ack'], about: th.lastQ });
      th.responded = true;
    }
    if (!lines.length) {
      // (nothing to sing yet: what is owed shows on the banner)
      for (const { e } of cards) this.aside({ kind: 'thought', e }, Math.max(this.now + 0.05, this.arrivalOf(e) + 0.05, this.lastCard + CARD_STEP));
      if (cards.length) this.lastCard = Math.max(this.lastCard, this.now + 0.05);
      th.state = this.nextOf(th).length || th.late.length ? th.state : 'done';
      return null;
    }
    // (sung in the section of the beat it was opened in, or the one the song is in by then: a consultation about a
    // later beat never moves the song on before that beat's own lines)
    const b0 = this.beatFor(opener);
    const beatId = b0 == null ? null : this.beatOf(b0);
    // the parts, in order
    const parts = [];
    lines.forEach((x, i) => {
      if (!parts.length || parts.at(-1).p !== x.part) parts.push({ p: x.part, lines: [] });
      parts.at(-1).lines.push({ ...x, i });
    });
    const placed = [], at = [];
    for (const { p, lines: ls } of parts) {
      const set = partSet(p, style.tags);
      const ids = PROGRESSION_SETS[set] ?? PROGRESSION_SETS['verse:narrative'];
      const prog = ids[hash(`${th.id}:${p.part}:${this.beats?.seed ?? ''}`) % ids.length];
      const P = chordsOf(prog);
      const tune0 = tuneOf(style, p.section);
      const tune = TOO_QUICK[tune0] ?? tune0;
      const from = this.head;
      let cursor = 0;
      const head = Math.max(1, P.length - 3); // (the part's ending is its last line's)
      ls.forEach((x, j) => {
        const { e, cue } = x;
        const move = e?.move ?? null;
        const lastLine = j === ls.length - 1;
        // (never before it was written: a recorded making-of sings on as the conversation was, its lines may wait a bar)
        if (e && !this.live) {
          const need = Math.ceil((this.arrivalOf(e) + SLOT_LEAD) / this.bar - EPS);
          if (this.head < need) { this.head = need; this.tail = []; }
        }
        const chordsFor = (bar, bars) => {
          const romans = lastLine ? fitRomans(P, p.cadence ? p.section : 'verse1', bars) : Array.from({ length: bars }, (_, k) => P[(cursor + k) % head]);
          // (a question ends open, on V: it asks up to so; an answer resolves, V7 -> I: it walks home to do)
          if (ASKS.has(move)) romans[bars - 1] = 'V';
          if (RESOLVES.has(move) && bars >= 2) { romans[bars - 2] = 'V7'; romans[bars - 1] = 'I'; }
          cursor += bars;
          romans.forEach((r, k) => { this.over.set(bar + k, r); this.overKind.set(bar + k, p.kind); });
        };
        const isAsker = x.bot === asker;
        const other = isAsker ? host : asker;
        const text = x.text;
        let { action, gesture } = e ? gestureOf(e, ['answer', 'followup-answer', 'agree', 'thanks'].includes(move) ? 'answer' : 'thought', text) : { action: '', gesture: '' };
        // (the host thinks it over: a thinking pose with its reasoning and its hold line; a recall points back)
        if (move === 'reasoning' && !action) gesture = THINKING[(x.i + th.k) % THINKING.length];
        if (cue === 'hold') gesture = THINKING[th.k % THINKING.length];
        if (cue === 'recall') gesture = 'point';
        const shape = ASKS.has(move) || cue === 'hold' || cue === 'recall' ? 'ask' : RESOLVES.has(move) || ['ok', 'agree', 'thanks'].includes(move) ? 'answer' : 'auto';
        const doing = cue === 'hold' ? `takes ${asker}'s question: thinks it over` : cue === 'recall' ? `comes back to ${asker}'s question`
          : cue === 'resume' ? `comes back to it with ${host}` : `${MOVE_SAYS[move] ?? 'talks'}${['ask', 'question', 'followup', 'thanks'].includes(move) ? ` ${other}` : ''}`;
        const ph = this.phrase(x.bot, text, {
          beatId, shape, melody: tune, chordsFor, endOn: ASKS.has(move) ? 'ask' : RESOLVES.has(move) ? 'resolve' : null,
          minBars: count(text) <= SHORT_LINE && !RESOLVES.has(move) && !(p.cadence && lastLine) ? 1 : MIN_BARS, cadence: Boolean(p.cadence && lastLine) || RESOLVES.has(move),
          src: e?.seq ?? null, kind: isAsker ? 'question' : 'answer',
          agent: e ? roleOf(e) : ROLE_OF[x.bot] ?? 'cast', status: 'consulting', consult: [other], consultSeq: th.first, summary: e?.summary ?? text, at: e?.t ?? null, action, gesture,
          doing, duet: { visit: placed.length ? 'stay' : isAsker ? 'out' : 'in', with: other, until: 0 },
          extra: { ...(move ? { move } : { cue }), consultPart: p.part, thread: th.id },
        });
        if (!ph) return;
        Object.assign(ph.ev, { ...(move ? { move } : { cue }), consultPart: p.part, thread: th.id, ...(x.about ? { about: { bot: x.about.bot, text: x.about.text } } : {}) });
        if (e) th.sung.add(e.seq);
        placed.push(ph);
        at[x.i] = ph;
      });
      if (this.head > from) {
        this.consultParts.push({
          thread: th.id, block, part: p.part, set, prog, from, to: this.head, cadence: Boolean(p.cadence),
          romans: Array.from({ length: this.head - from }, (_, k) => this.romanAt(from + k)),
        });
      }
    }
    // (a line that found no tune: shown, so nothing of the conversation is lost)
    lines.forEach((x, i) => { if (!at[i] && x.e) cards.push({ e: x.e, after: i - 1 }); });
    // the lines on the banner, in their place in the conversation: each once the sung line before it is sung (those
    // before the first, with the first), in order, CARD_STEP s apart at least (never in the side remarks' queue, which
    // can run a minute behind; never before the stretch: v19 flashed the next consultation's ok over the last seal)
    let prevT = -Infinity;
    for (const { e, after } of cards) {
      let k = after;
      while (k >= 0 && !at[k]) k--;
      const anchor = k >= 0 ? at[k] : null;
      if (!placed.length) { this.aside({ kind: 'thought', e }); continue; }
      // (a second into the line before it, sung: never in the bar line's breath, where the stretch before still seals)
      const from = this.sec((anchor ?? placed[0]).notes.find((n) => !n.pickup)?.tb ?? (anchor ?? placed[0]).notes[0].tb) + 1.0;
      const t = Math.max(this.now + 0.05, from, prevT + CARD_STEP, this.lastCard + CARD_STEP, this.live ? 0 : this.arrivalOf(e) + 0.05);
      this.lastCard = t;
      this.aside({ kind: 'thought', e }, t);
      prevT = t;
    }
    if (!placed.length) return null;
    // the outro tag's seal (the thanks said): a hand play, both singing its word, never silent (the consultation is
    // the making-of's own song, however late it comes)
    const thanked = lines.some((x) => x.e?.move === 'thanks' && at[lines.indexOf(x)]);
    const rest = this.nextOf(th);
    let end = BAR * this.head;
    if (thanked || (this.flushing && !rest.length)) {
      const last = lines.at(-1).e ?? th.all?.events.at(-1) ?? th.arrived.at(-1);
      const seal = this.nextSeal(`${th.first}:${th.id}`);
      end = this.sealDuet({ asker, host, answer: placed.at(-1), seal, consultSeq: th.first, summary: last?.summary ?? '', at: last?.t ?? null, agent: roleOf(th.all?.events[0] ?? th.arrived[0]), silentIfLate: false }).sealEnd;
      th.state = 'done';
    } else th.state = th.owed ? 'held' : 'answered';
    this.talked(placed.at(-1).ev.beat, this.head, { kind: 'duet' });
    const from = placed[0].notes[0].tb;
    this.markBusy(asker, from, end);
    this.markBusy(host, from, end);
    for (const ph of placed) ph.ev.duet.until = +(this.sec(end) - ph.ev.t).toFixed(3);
    this.quiet.push([placed[0].ev.t, this.sec(end)]);
    th.lastPhrases = this.phrases;
    th.lastEnd = this.sec(end);
    // the host thinks the question over until it comes back with its answer (it hums, it ponders: this.thinking)
    if (th.state === 'held') {
      th.thinking = { bot: host, thread: th.id, th, from: Math.ceil(end / BAR - EPS), to: Infinity };
      this.thinking.push(th.thinking);
    }
    return placed.at(-1);
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
    const seal = this.nextSeal(`${q.seq}:${q.summary ?? ''}`);
    const bq = this.beatFor(q), ba = a ? this.beatFor(a) : null;
    const bb = ba != null && (bq == null || this.beatRank(ba) > this.beatRank(bq)) ? ba : bq;
    const beatId = bb == null ? null : this.beatOf(bb);
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
    const { sealEnd } = this.sealDuet({ asker, host, answer, seal, consultSeq: q.seq, summary: q.summary, at: q.t, agent: roleOf(q), silentIfLate: true });
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

  /** The seal of the next duet, by turns (from a place the episode picks: varied, the same every time). */
  nextSeal(key) {
    this.sealFrom ??= hash(key) % SEALS.length;
    return SEALS[(this.sealFrom + this.duets++) % SEALS.length];
  }

  /**
   * The seal of a sung consultation: the hand play on the bar line, the word both sing on its contact: in the last
   * phrase's last bar when it is done by then (its last note cut before the word), else on the next bar; a duet sung
   * late (silentIfLate: more than MAX_LAG after it was said, the production went on meanwhile) seals it without a
   * word, in the last phrase's last bar. Moves the head past it; returns { sealEnd } (tune beats).
   */
  sealDuet({ asker, host, answer, seal, consultSeq, summary, at, agent, silentIfLate = true }) {
    let sb = this.head, silent = false;
    const ln = answer.notes.at(-1), inLast = BAR * (sb - 1) + seal.at;
    if (ln.tb <= inLast - 1.125 + EPS && ln.tb >= BAR * (sb - 1) - EPS) {
      sb -= 1;
      ln.dur = Math.max(PICKUP_MIN_LAST, Math.min(ln.dur, inLast - 0.15 - ln.tb));
    } else if (silentIfLate && this.sec(BAR * sb) - this.ready > this.maxLag) {
      sb -= 1;
      silent = true;
    }
    const sealEnd = BAR * (sb + SEAL_BARS);
    const playT = this.sec(BAR * sb);
    const ev = {
      seq: this.seq++, src: consultSeq, t: +playT.toFixed(4), agent, bot: asker, status: 'working', beat: answer.ev.beat, summary,
      lyric: '', line: '', chords: [], action: seal.play, consult: [host], kind: 'gesture', gesture: '', duet: null, doing: `seals it with ${host}`, at,
    };
    this.staged.push(ev);
    this.freshEvents.push(ev);
    this.items.push({ t0: +playT.toFixed(3), t1: +this.sec(sealEnd).toFixed(3), bot: asker, with: host, agent, kind: 'gesture', beat: answer.ev.beat,
      seq: consultSeq, consultSeq, text: seal.play });
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
      const notes = sylls.map((_, i) => ({ tb: wordAt + 0.75 * i, dur: i === sylls.length - 1 ? 1.125 : 0.75, midi: m, strong: i === 0 }));
      const other = bot === asker ? host : asker;
      this.place({
        bot, text: seal.word, notes, bar: sb, bars: SEAL_BARS, voice, beatId: answer.ev.beat, src: consultSeq, kind: 'seal', item: false,
        agent: bot === asker ? agent : answer.ev.agent, status: 'consulting', consult: [other], doing: `seals it with ${other}`,
        duet: { visit: 'stay', with: other, until: +(this.sec(sealEnd) - this.sec(wordAt) + CARD_LEAD).toFixed(3) }, db: -3,
        summary, at,
      });
      tail.push({ note: notes.at(-1) });
    }
    if (!silent) this.tail = tail;
    this.head = sb + SEAL_BARS;
    return { sealEnd };
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
    // (a host thinking over a question it holds keeps thinking: a crewmate sings in its place)
    const thinking = new Set(this.thinking.filter((r) => this.head >= r.from && this.head < r.to).map((r) => r.bot));
    const trio = [];
    for (const b of REFRAIN_TRIOS[k % REFRAIN_TRIOS.length]) trio.push(thinking.has(b) ? CREW.find((x) => !thinking.has(x) && !trio.includes(x) && !REFRAIN_TRIOS[k % REFRAIN_TRIOS.length].includes(x)) ?? b : b);
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
      // (under a consultation's part, the backing of its kind: a bridge's hum under the reasoning, a chorus's under the answer)
      const kind = this.overKind.get(bar) ?? (sec.section === 'verse1b' || sec.section === 'verse2b' ? 'build' : sec.kind);
      const parts = BACKING[kind] ?? BACKING.verse;
      const busy = this.busy.get(bar) ?? new Set();
      const free = CREW.filter((b) => !busy.has(b));
      const taken = new Set();
      const now = new Map();
      // (a host thinking over a question it holds hums its "Hmm" while it is free: the first bars, then now and then)
      for (const r of this.thinking) {
        const k = bar - r.from;
        if (k < 0 || bar >= r.to || !(k < HUM_BARS || k % THINK_EVERY === 0) || !free.includes(r.bot) || taken.has(r.bot)) continue;
        taken.add(r.bot);
        now.set(`think:${r.bot}`, { bot: r.bot, part: THINK_PART });
      }
      for (const role of ROLE_ORDER) {
        const part = parts.find((p) => p[0] === role);
        if (!part) continue;
        const run = this.runs.get(role);
        let bot = run && run.sec === sec && run.part === part && run.to === bar && free.includes(run.bot) && !taken.has(run.bot) ? run.bot : null;
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
        if (!n || n.bot !== run.bot || run.sec !== sec || run.part !== n.part || run.to !== bar) { this.emitRun(role, run, pitchOf); this.runs.delete(role); }
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
  emitRun(key, run, pitchOf) {
    const role = key.startsWith('think:') ? 'think' : key; // (a thinking host's hum: its own part)
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
      status: 'working', beat: run.sec.beat, summary: role === 'think' ? `${run.bot} hums, thinking it over` : `${run.bot} sings the ${role}`, lyric: text, line: '', chords: [], action: '', consult: [],
      kind: 'backing', gesture: '', duet: null, doing: role === 'think' ? 'thinks it over' : `sings the ${role}`, singsFor: null, at: null,
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
  for (const x of s.sections) if (x.lastTalk?.src != null && ['thought', 'line', 'activity'].includes(x.lastTalk.kind)) out.lastOf.set(x.beat, x.lastTalk.src);
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
export function scoreMakingOf(events, beats = null, { tempo = MAKING_OF_TEMPO, production = null, activity = null } = {}) {
  // (the activity log: the production's real work, sung in the waits, and when each queued event was written: it
  // arrives then, though it landed in the stream when its beat opened)
  // (a beat where Green has no new line, a chorus sung again: its first event arrives when it landed all the same,
  // to open its section)
  const written = activity?.length ? writtenTimes(activity, events) : null;
  if (written) {
    const texts = new Set(), fresh = new Set(), first = new Map();
    for (const e of [...(events ?? [])].sort((a, b) => a.seq - b.seq)) {
      // (its first plain event: a consultation's moves are sung by their thread, never open a section)
      if (!first.has(e.beat) && !e.move) first.set(e.beat, e.seq);
      const k = e.lyric ? norm(parseLyric(e.lyric, NAMES).text) : '';
      if (k && !texts.has(k)) { texts.add(k); fresh.add(e.beat); }
    }
    for (const [beat, seq] of first) if (!fresh.has(beat)) written.delete(seq);
  }
  const acts = activity?.length ? activityLines(activity) : null;
  const at = (e) => Math.min(Number(e.t) || 0, written?.get(e.seq) ?? Infinity);
  const evs = [...(events ?? [])].sort((a, b) => at(a) - at(b) || a.seq - b.seq);
  const lastT = evs.reduce((m, e) => Math.max(m, Number(e.t) || 0), 0);
  const prod = Math.max(lastT, Number(production) || 0);
  const arranged = arrangedLines(events, beats);
  const pairs = pairConsultations(events);
  const threads = threadsOf(events);
  const run = (lengths, measure) => {
    const s = new MakingOfScore({ beats, tempo, arranged, lengths, measure, pairs, production: prod, activity: acts, written, threads: threads.size ? threads : null });
    let i = 0;
    for (let k = 0; k * TICK <= prod + EPS; k++) {
      const now = k * TICK, due = [];
      while (i < evs.length && at(evs[i]) <= now + EPS) due.push(evs[i++]);
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

/** The bare formation's rows (no set loaded: headless tests), as the making-of stood before it moved into the sets. */
const BARE_CREW = { front: { z: -0.2, ends: 0.8, half: 2.7, y: 0.8 }, back: { z: -2.5, ends: 0.9, half: 3.2, y: 1.6 } };

/**
 * The cast's places in a set for the making-of (sets.js SETS[set].crew): the seven role bots in an arc in front (CREW
 * order, left to right as the camera sees them), the rest of the cast in a row behind them, higher. Returns Map
 * name -> [x, y, z].
 */
export function crewFormation(names = NAMES, set = null) {
  const out = new Map();
  const f = (set && SETS[set]?.crew) || BARE_CREW;
  const row = (list, r) => list.forEach((n, k) => {
    const u = list.length > 1 ? -1 + (2 * k) / (list.length - 1) : 0;
    out.set(n, [+(u * r.half).toFixed(4), r.y, +(r.z + r.ends * u * u).toFixed(4)]);
  });
  row(CREW, f.front);
  row(names.filter((n) => !CREW.includes(n)), f.back);
  return out;
}

/** A set is visited at least this long (s): a shorter stay is held in the set before (CrewSets.brief). */
export const HOLD = 20;

/** The phrases a cut to another set may come before: each opens a stretch of the crew's talk (never an answer or a seal). */
const CUT_BEFORE = new Set(['thought', 'line', 'question', 'activity', 'refrain']);

/**
 * Where the crew works during the making-of: in the set of the beat the loading bar is on (the beat it is writing:
 * sets.js resolveSets, an old 'studio' read as the diner), in Gold's Diner while the director plans (before the first
 * beat). The set changes only at a natural moment: at a phrase that opens a stretch of talk (CUT_BEFORE), no duet on
 * (its question, answer and seal are one scene), nothing else still sung when its voice comes in. A clean cut, as the
 * premiere's. A stay shorter than HOLD is skipped: the crew stays, then cuts to the later beat's set. Fed the staged
 * events in the order they play (live: as they are staged); deterministic.
 * score: the MakingOfScore (its beats, loading bar and sung lines, read as they grow).
 */
export class CrewSets {
  constructor(score, { first = DEFAULT_SET, hold = HOLD } = {}) {
    this.score = score;
    this.set = first;
    this.hold = hold; // (s) the shortest stay
    this.until = -Infinity; // a duet is on until then (s)
    this.sounding = -Infinity; // the latest end of a phrase sung so far (s)
    this.cuts = []; // { t, seq, set, beat }
    this._lines = new Map();
    this._seen = 0;
    this._beats = undefined;
    this._sets = null;
  }

  /** The set beat `id` plays in (the diner for none). */
  setOf(id) {
    const beats = this.score.beats ?? null;
    if (beats !== this._beats) { this._beats = beats; this._sets = resolveSets(beats); }
    return (id && this._sets.get(id)) || DEFAULT_SET;
  }

  /** The set the loading bar calls for at time t. */
  wanted(t) { return this.setOf(this.score.progressAt(t).beat); }

  /**
   * A visit to set `want` from t would be brief: the loading bar calls for another set within `hold` seconds (a beat
   * written in a few seconds). The crew stays where it is, then cuts to the later beat's set. Only the beats already
   * known count (live: none ahead yet, so it cuts).
   */
  brief(want, t) {
    const next = this.score.arrivals.find((a) => a.t > t + EPS && this.setOf(a.beat) !== want);
    return !!next && next.t - t < this.hold;
  }

  /** The sung plan of staged event `seq` (the score's lines, indexed as they grow). */
  line(seq) {
    const lines = this.score.lines;
    for (; this._seen < lines.length; this._seen++) this._lines.set(lines[this._seen].seq, lines[this._seen]);
    return this._lines.get(seq) ?? null;
  }

  /** The event `e` about to play: returns the set the crew is in for it (another one than before: a cut, now). */
  next(e) {
    if (e.kind === 'aside' || e.part === 'backing' || !e.lyric) return this.set;
    const plan = this.line(e.seq);
    const voice = plan?.at ?? e.t + CARD_LEAD;
    const last = plan?.notesTb?.at(-1);
    const end = last ? this.score.sec(last.tb + last.dur) : voice;
    // (a duet is over when this phrase's bars begin: its card and its pickup come in the duet's last bar, as after
    // any phrase; back-to-back consultations leave no other gap to cut in)
    const downbeat = plan?.notesTb ? this.score.sec(plan.notesTb.find((n) => !n.pickup)?.tb ?? plan.notesTb[0].tb) : e.t;
    if (!e.part && CUT_BEFORE.has(e.kind) && Math.max(e.t, downbeat) >= this.until - 2e-3 && this.sounding <= voice + 0.05) {
      const want = this.wanted(e.t);
      if (want !== this.set && !this.brief(want, e.t)) {
        this.set = want;
        this.cuts.push({ t: e.t, seq: e.seq, set: want, beat: this.score.progressAt(e.t).beat });
      }
    }
    if (e.duet) this.until = Math.max(this.until, e.t + (e.duet.until ?? 0));
    this.sounding = Math.max(this.sounding, end);
    return this.set;
  }
}

/** A scored making-of's sets, event by event (its staged events in play order): Map seq -> set, and its cuts. */
export function crewSetsOf(score, opts) {
  const plan = new CrewSets(score, opts);
  const out = new Map();
  for (const e of score.staged) out.set(e.seq, plan.next(e)); // (in the order the player plays them)
  out.cuts = plan.cuts;
  return out;
}
