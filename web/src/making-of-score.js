// The making-of as a musical number: the crew's events become a score on the bar grid over a vamp on the
// episode's chords. Every role bot sings its thought (the event's summary, in the team's voice: "we") as a short
// recitative phrase in its own voice; Green sings the lines he proposes on the tune the arranger gives them
// (double time), so the song is heard taking shape; a consultation is a duet: the asker glides over and sings
// its question, the bot it asks sings its answer (the event that answers it), and a hand play seals it (a
// handshake, a high five, a fist bump, a pinky promise, both singing the word). While they think, the bots
// gesture (chin-stroke, scratch-head, count-beats, binoculars ...), deterministic by the event.
//
// Pacing. A phrase enters on a strong beat (a bar line or the half bar, with "We" as a pickup before it) and
// takes the half bars its words need at about three syllables a second (stressed syllables get the room the
// grid leaves); the next phrase's pickup sings in its breath. Every thought and every consultation is sung;
// within a beat Green's new lines alternate with the crew's thoughts (call and response); a line the song
// already has is not sung again; a recorded making-of keeps to MAX_SECONDS by leaving out Green's later lines
// of a beat (the first new line of every beat always stays); live, the backlog decides. Idle time is gone:
// the score runs bar after bar.
//
// Pure and deterministic (no clock, no Math.random): the browser plays the same score every time, and node tests
// read it. Used by making-of.js (the replay: scoreMakingOf; live: new MakingOfScore().add as events arrive).
import { syllabify } from './mv/voice/syllables.js';
import { voiceRange, chordFromRoman, chordScale, mod12 } from './mv/music/theory.js';
import { VOICES } from './mv/model/schema.js';
import { VIBRATO_SCALE } from './mv/voice/voice.js';
import { CAST, NAMES, AGENT_BOT } from './gen/cast.js';
import { hashString } from './gen/rng.js';
import { parseLyric } from './cues.js';
import { resolveAction } from './actions.js';
import { engineVoice, romanOf, arrange, CARD_LEAD } from './sing-plan.js';
import { teamVoice } from './team-voice.js';
import { wordCue } from './staging.js';

/** The making-of's tempo (a brisk walk: the crew's patter). */
export const MAKING_OF_TEMPO = 104;
/** A recorded making-of is told in at most this many seconds (Green's later lines of a beat give way first). */
export const MAX_SECONDS = 170;
/** The crew: the seven role bots, left to right as the studio camera sees them in the making-of. */
export const CREW = ['Pink', 'Blue', 'White', 'Green', 'Gold', 'Gray', 'Yellow'];
const ROLE_OF = Object.fromEntries(Object.entries(AGENT_BOT).map(([agent, bot]) => [bot, agent]));

// the grid (beats)
const GRID = 2; //       phrases enter on a bar line or the half bar
const TAIL = 0.5; //     a phrase's last note ends this long before its slot (the next phrase's pickup sings there)
const FINAL_MIN = 1; //  the last syllable lasts a beat at least
const EIGHTH = 0.5;
const MAX_PICKUP = 1; // syllables before the bar line ("We | ask White ...")
const SEAL_BEATS = 4; // the hand play that seals a duet: one bar
const LEAD_BARS = 1; //  the vamp alone before the first phrase
const END_BARS = 1; //   and after the last one (the home chord rings)
const STAGED_BASE = 100000; // staged events' seq (the bundle's own seqs stay on `src`)
const LIVE_SLACK = 6; // s: live, Green's other new lines are sung while the score is less than this far ahead
const LIVE_WAIT = 8; //  events: live, a question waits this long for its answer before a stand-in answers

/** Seals by turn (deterministic, varied): the hand play, the word both sing on its contact, the beat it lands on. */
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
/** The melody each role recites on (its contour). */
const CONTOUR = { lyrics: 'steady', chords: 'rising', dance: 'lilting', lighting: 'lilting', deals: 'falling', hype: 'leaping', comedy: 'lilting' };

const hash = (s) => hashString(String(s));
const ceilTo = (x, g) => Math.ceil(x / g - 1e-9) * g;
const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const roleOf = (e) => e.agent ?? ROLE_OF[e.bot] ?? 'lyrics';

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

/** A stand-in answer when nobody answered (the bot's own catchphrase: "Let me take a look", "Of course, darling"). */
export const fallbackAnswer = (bot, asker) => {
  const says = CAST[bot]?.says;
  return says ? `${says}${/[!?.]$/.test(says) ? '' : '!'}` : `Sure thing, ${asker}!`;
};

// ------------------------------------------------------------------ the sung phrases

const f0Midi = (voice) => 69 + 12 * Math.log2((VOICES[voice]?.f0 ?? 180) / 440);
const vibratoOf = (voice) => {
  const vs = VIBRATO_SCALE[voice] ?? { depth: 1, rate: 1 };
  return { rate: 5.5 * vs.rate, depth: 16 * vs.depth }; // a light vibrato: sung speech
};

/** The pickup syllables of a phrase (its first weak ones, sung before the bar line): how many. */
function pickupOf(sylls) {
  let p = 0;
  while (p < Math.min(MAX_PICKUP, sylls.length - 2) && sylls[p].stress <= 0) p++;
  return p;
}

/** The half bars a recitative of `sylls` needs (its slot, beats from its downbeat to the next phrase's). */
export function reciteSlot(sylls) {
  const pre = Math.max(0, sylls.length - pickupOf(sylls) - 1);
  return Math.max(GRID, ceilTo(pre * EIGHTH + FINAL_MIN + TAIL, GRID));
}

/**
 * A recitative's rhythm in `slot` beats: the pickup in eighths before the downbeat, then an eighth a syllable, the
 * stressed ones a quarter while the slot has room (most stressed first, left to right), the last one held to the
 * slot's end less TAIL. Returns [{ beat, dur, stress }] (beats from the downbeat).
 */
export function reciteRhythm(sylls, slot) {
  const p = pickupOf(sylls);
  const out = [];
  for (let i = 0; i < p; i++) out.push({ beat: -(p - i) * EIGHTH, dur: EIGHTH, stress: sylls[i].stress });
  const body = sylls.slice(p);
  const pre = body.length - 1;
  const len = new Array(Math.max(0, pre)).fill(1); // eighths
  let extra = Math.max(0, Math.floor((slot - TAIL - FINAL_MIN) / EIGHTH + 1e-9) - pre);
  for (const level of [2, 1]) {
    for (let i = 0; i < pre && extra > 0; i++) if (body[i].stress === level) { len[i]++; extra--; }
  }
  let at = 0;
  for (let i = 0; i < pre; i++) { out.push({ beat: at, dur: len[i] * EIGHTH, stress: body[i].stress }); at += len[i] * EIGHTH; }
  if (body.length) out.push({ beat: at, dur: Math.max(FINAL_MIN, slot - TAIL - at), stress: body.at(-1).stress, final: true });
  return out;
}

/**
 * The pitches of a recitative: a reciting tone near the voice's speaking pitch (a tone of the chord under the
 * phrase), the stressed syllables on chord tones along the role's contour, the weak ones on the tone or a step
 * from it, a statement landing on its chord's root and a question rising at its end. chordAt(beat) -> a chord.
 */
export function recitePitches(rhythm, { voice, chordAt, contour = 'steady', question = false }) {
  const { low, high } = voiceRange(voice);
  const speak = Math.max(low + 3, Math.min(high - 7, Math.round(f0Midi(voice) + 4)));
  const first = chordAt(Math.max(0, rhythm.find((n) => n.beat >= 0)?.beat ?? 0));
  const nearest = (pcs, target, lo = low, hi = high) => {
    let best = null;
    for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m)) && (best === null || Math.abs(m - target) < Math.abs(best - target) - 1e-9)) best = m;
    return best ?? Math.round(target);
  };
  const tone = nearest([first.tones[2] ?? first.tones[0], first.tones[1] ?? first.tones[0]], speak);
  const n = rhythm.length;
  const stressed = rhythm.map((r, i) => (r.stress >= 1 && !r.final ? i : -1)).filter((i) => i >= 0);
  const shape = (i) => {
    const u = n > 1 ? i / (n - 1) : 0;
    const k = stressed.indexOf(i);
    switch (contour) {
      case 'rising': return -3 + 5 * u;
      case 'falling': return 3 - 5 * u;
      case 'lilting': return k >= 0 ? (k % 2 === 0 ? 2 : -1) : 0;
      case 'leaping': return k >= 0 ? (k % 2 === 1 ? 5 : 1) : 0;
      default: return k >= 0 ? (k === 1 ? 2 : 0) : 0;
    }
  };
  const out = [];
  let prev = tone;
  rhythm.forEach((r, i) => {
    const chord = chordAt(Math.max(0, r.beat));
    const scale = chordScale(chord, 'C');
    let m;
    if (r.final) {
      if (question) m = nearest([chord.tones[2], chord.tones[1]], prev + 3, prev + 1, prev + 7);
      else m = nearest([chord.tones[0]], prev - 1, prev - 7, prev + 3);
    } else if (i === n - 2 && !question && r.beat >= 0) {
      m = nearest(scale, prev + 1, prev - 2, prev + 3); // the approach: a step above where it lands
    } else if (r.stress >= 1) {
      m = nearest(chord.tones, tone + shape(i), tone - 5, tone + 7);
    } else {
      const target = tone + shape(i) * 0.5;
      m = nearest(scale, (prev + target) / 2, prev - 2, prev + 2);
    }
    if (m < low) m += 12 * Math.ceil((low - m) / 12);
    if (m > high) m -= 12 * Math.ceil((m - high) / 12);
    out.push(m);
    prev = m;
  });
  return out;
}

/** The phrase a thought (a summary, a question, an answer) sings: { text, sylls, slot, pk }. */
function recitePhrase(text) {
  const sylls = syllabify(text);
  if (!sylls.length) return null;
  const slot = reciteSlot(sylls);
  return { text, sylls, slot, pk: pickupOf(sylls) * EIGHTH };
}

// ------------------------------------------------------------------ Green's lines on the arranger's tune

/**
 * The arranged song's lead lines, keyed by event seq: { text, notes: [{ beat, dur, midi }] (making-of beats from the
 * line's downbeat: the arranger's rhythm in double time), halves: chord names (one a making-of half bar), slot, pk }.
 */
export function arrangedLines(events, beats) {
  const out = new Map();
  if (!beats) return out;
  let song;
  try { song = arrange(events, beats); } catch { return out; }
  const beatSec = 60 / song.tempo, barSec = 4 * beatSec;
  for (const l of song.lines) {
    if (l.layer !== 'story' || l.role !== 'lead') continue;
    const s = song.sections.find((x) => x.beat === l.beat);
    if (!s) continue;
    const own = l.job.notes[l.pickup ?? 0] ?? l.job.notes[0];
    const firstT = l.at + own.t;
    const barIdx = Math.max(0, Math.round((firstT - s.t) / barSec));
    const barLine = s.t + barIdx * barSec;
    const notes = l.job.notes.map((nt) => ({ beat: (l.at + nt.t - barLine) / beatSec / 2, dur: nt.dur / beatSec / 2, midi: nt.midi }));
    const end = Math.max(...notes.map((nt) => nt.beat + nt.dur));
    const halves = Array.from({ length: Math.max(1, l.bars) }, (_, k) => s.chords[Math.min(s.chords.length - 1, barIdx + k)] ?? 'C');
    out.set(l.seq, { text: l.job.text, notes, halves, slot: Math.max(GRID, ceilTo(end + TAIL, GRID)), pk: Math.max(0, -notes[0].beat), voice: l.job.voice });
  }
  return out;
}

/** Notes moved by octaves into a voice's range (the arranger planned the line for its story singer). */
function intoRange(midis, voice) {
  const { low, high } = voiceRange(voice);
  const mean = midis.reduce((a, b) => a + b, 0) / Math.max(1, midis.length);
  const shift = 12 * Math.round(((low + high) / 2 - mean) / 12);
  return midis.map((m) => {
    let x = m + shift;
    while (x > high) x -= 12;
    while (x < low) x += 12;
    return x;
  });
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
 * recorded making-of) and returns the staged events it adds (timed, in order); lines (the sung plans for audio.js),
 * items (the timeline for the trailer tools), halves (the vamp's chord per half bar) and end grow with it.
 *
 * opts: beats (beats.json: the arranger's tunes for Green's lines), tempo, live (events arrive in real time: a
 * question waits for its answer, the backlog decides Green's extra lines), only (a recorded making-of: the Set of
 * line seqs to sing; null: every new line).
 */
export class MakingOfScore {
  constructor({ beats = null, tempo = MAKING_OF_TEMPO, live = false, only = null } = {}) {
    this.beats = beats;
    this.tempo = tempo;
    this.beat = 60 / tempo;
    this.bar = 4 * this.beat;
    this.live = live;
    this.only = only;
    this.raw = []; // every event so far
    this.staged = [];
    this.lines = [];
    this.items = [];
    this.halves = []; // the vamp: a chord name per half bar from transport 0
    this.head = LEAD_BARS * 4 - TAIL; // beats: the next phrase's voice (its pickup) may begin here
    this.sectionBeat = null; // the bundle beat the vamp plays
    this.prog = ['C', 'F', 'G', 'C'];
    this.progAt = 0; // half bar its progression started on
    this.sung = new Set(); // line texts the song has
    this.firstOfBeat = new Map(); // beat id -> seq of its first new line
    this.used = new Set(); // events sung as an answer
    this.pairs = null; // replay: question seq -> answer event
    this.pending = []; // live: questions waiting for their answer { q, waited }
    this.duets = 0;
    this.sealFrom = null;
    this.lastGesture = new Map(); // bot -> downbeat of its last gesture ("not busy")
    this.arranged = null; // Map seq -> arranged line (lazy)
    this.arrangedFor = -1;
    this.seq = STAGED_BASE;
    this.now = 0;
    this.closed = false;
    this.firstDown = undefined; // beats: the first phrase's downbeat
  }

  /** Transport seconds of a beat count. */
  sec(beats) { return beats * this.beat; }

  /** Transport seconds the making-of ends: the bar after the last phrase, and one more for the home chord. */
  get end() { return this.sec(ceilTo(this.head + TAIL, 4) + END_BARS * 4); }

  /** The chord name at half bar h (past the last phrase the beat's progression goes on: the vamp keeps time). */
  chordAtHalf(h) {
    if (h < this.halves.length && this.halves[h]) return this.halves[h];
    return this.prog[Math.floor(Math.max(0, h - this.progAt) / 2) % this.prog.length];
  }

  /** The chord at a beat from transport 0. */
  chordAt(beat) { return chordFromRoman(romanOf(this.chordAtHalf(Math.floor(beat / GRID + 1e-9))), 'C'); }

  /** The vamp's half bars up to (not including) h, in the progression in force. */
  fill(h) {
    while (this.halves.length < h) this.halves.push(this.chordAtHalf(this.halves.length));
  }

  /** A beat of the bundle begins at half bar h: its chords (the beat's chord event) from there. */
  enterBeat(beatId, h) {
    if (!beatId || beatId === this.sectionBeat) return;
    this.fill(h);
    this.sectionBeat = beatId;
    const given = this.raw.find((e) => e.beat === beatId && e.chords?.length)?.chords;
    if (given?.length) this.prog = given.slice();
    this.progAt = h;
  }

  /** The arranged line of a lyric event (Green's tune), arranging the stream so far again when it grew. */
  arrangedLine(e) {
    if (!this.beats) return null;
    if (this.arrangedFor !== this.raw.length) {
      this.arranged = arrangedLines(this.raw, this.beats);
      this.arrangedFor = this.raw.length;
    }
    return this.arranged.get(e.seq) ?? null;
  }

  /** Takes newly arrived events; returns the staged events it adds (timed, in order). now: transport seconds. */
  add(events, now = 0) {
    const before = this.staged.length;
    const known = new Set(this.raw.map((r) => r.seq));
    const fresh = (events ?? []).filter((e) => e && !known.has(e.seq));
    this.raw.push(...fresh);
    this.now = now;
    this.catchUp(now);
    if (!this.live) this.pairs = pairConsultations(this.raw);
    for (const unit of this.units(fresh)) this.layout(unit);
    return this.staged.slice(before);
  }

  /** Live: nothing is placed in the past (the voices need a moment to render). */
  catchUp(now) {
    if (!this.live) return;
    const at = (now + 1.5) / this.beat;
    if (this.head < at) this.head = at;
  }

  /** At the end (live: the director finished): the questions still waiting get a stand-in answer. */
  flush(now = 0) {
    const before = this.staged.length;
    this.now = now;
    this.catchUp(now);
    for (const p of this.pending.splice(0)) this.layout(p.chained ? null : this.duetUnit(p.q, null));
    this.closed = true; // the end is known (the vamp rings its home chord there)
    this.fill(Math.ceil(this.end / this.beat / GRID));
    return this.staged.slice(before);
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

  /** The units of newly arrived events, in the order they are sung. */
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
        if (parsed?.text) lines.push({ kind: 'line', e, parsed });
        if (this.used.has(e.seq) || this.answers(e)) continue; // sung in a duet
        if (e.status === 'consulting' && e.consult?.length) {
          if (this.live) {
            const a = this.firstAnswer(e);
            if (a) talk.push(this.duetUnit(e, a));
            else this.pending.push({ q: e, waited: 0 });
          } else talk.push(this.duetUnit(e, this.pairs.get(e.seq) ?? null));
        } else if (!parsed?.text) talk.push({ kind: 'thought', e });
      }
      const lead = talk.findIndex((u) => u.kind === 'thought' && u.e.chords?.length);
      if (lead > 0) talk.unshift(...talk.splice(lead, 1));
      for (let i = 0; i < Math.max(talk.length, lines.length); i++) {
        if (talk[i]) out.push(talk[i]);
        if (lines[i]) out.push(lines[i]);
      }
    }
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
    if (u.kind === 'thought') return this.thought(u.e);
    if (u.kind === 'line') return this.line(u.e, u.parsed);
    if (u.kind === 'duet') {
      const first = this.duet(u.q, u.a, u.asked === false ? null : true);
      if (u.chain && first) this.duet(u.chain.q, u.chain.a, first);
      return first;
    }
    return null;
  }

  /** The downbeat (beats) a phrase with a pickup of pk beats enters on: the first grid point its pickup fits before. */
  downFor(pk) { return ceilTo(this.head + pk, GRID); }

  /**
   * Puts a sung phrase on the score: its staged event (card CARD_LEAD before the voice), its plan for the voice
   * pool, its timeline item; moves the head (unless it joins another voice). Returns { ev, item, down, slot }.
   */
  place({ bot, text, notes, down, slot, src, kind, voice = engineVoice(bot), beatId, agent, status = 'working', action = '', consult = [],
    gesture = '', duet = null, doing = '', consultSeq = null, db = 0, join = false, line = '', singsFor = null, summary = text, at = null }) {
    const seq = this.seq++;
    const t0 = this.sec(notes[0].beat);
    const last = notes.at(-1);
    const t1 = this.sec(last.beat + last.dur);
    const job = {
      voice, text, mode: 'human', seed: hash(`${bot}:${seq}`) | 0, vibrato: vibratoOf(voice),
      notes: notes.map((n) => ({ t: this.sec(n.beat) - t0, dur: this.sec(n.dur), midi: n.midi, downbeat: Math.abs(((n.beat % 4) + 4) % 4) < 1e-6 })),
    };
    this.lines.push({ seq, bot, at: t0, bars: Math.max(1, Math.round(slot / 4)), role: 'lead', db, job });
    const ev = {
      seq, src, t: +Math.max(0, t0 - CARD_LEAD).toFixed(4), agent, bot, status, beat: beatId, summary, lyric: text, line, chords: [],
      action, consult, kind, gesture, duet, doing, singsFor, at,
    };
    this.staged.push(ev);
    this.firstDown ??= down; // (the vamp comes in a bar before the first phrase)
    const item = { t0: +t0.toFixed(3), t1: +t1.toFixed(3), bot, agent, kind, beat: beatId, seq: src, ...(consultSeq !== null ? { consultSeq } : {}), text };
    this.items.push(item);
    if (!join) this.head = Math.max(this.head, down + slot - TAIL);
    if (gesture) this.lastGesture.set(bot, down);
    this.fill(Math.ceil((down + slot) / GRID - 1e-9));
    return { ev, item, down, slot };
  }

  /** A recitative of `text` by `bot` at the head (its downbeat on the grid). */
  recite(bot, text, { contour = 'steady', question = false, beatId, ...rest }) {
    const ph = recitePhrase(text);
    if (!ph) return null;
    const down = this.downFor(ph.pk);
    this.enterBeat(beatId, Math.floor(down / GRID + 1e-9));
    const rhythm = reciteRhythm(ph.sylls, ph.slot);
    const voice = engineVoice(bot);
    const midis = recitePitches(rhythm, { voice, chordAt: (b) => this.chordAt(down + b), contour, question });
    const notes = rhythm.map((r, i) => ({ beat: down + r.beat, dur: r.dur, midi: midis[i] }));
    return this.place({ ...rest, bot, text, notes, down, slot: ph.slot, voice, beatId, gesture: this.calm(bot, rest.gesture, down) });
  }

  /** "Not busy": a bot that gestured in the last bar and a half keeps its hands still. */
  calm(bot, gesture, down) {
    if (!gesture) return '';
    const last = this.lastGesture.get(bot);
    return last !== undefined && down - last < 6 ? '' : gesture;
  }

  thought(e) {
    const text = teamVoice(e.summary, e.bot, NAMES);
    const { action, gesture } = gestureOf(e, 'thought', text);
    return this.recite(e.bot, text, {
      contour: CONTOUR[roleOf(e)] ?? 'steady', beatId: e.beat, src: e.seq, kind: 'thought', agent: roleOf(e), status: e.status ?? 'working',
      action, gesture, consult: e.consult ?? [], summary: e.summary, at: e.t,
      doing: e.status === 'proposing' ? 'has an idea' : e.status === 'done' ? 'signs off' : 'thinks it through',
    });
  }

  /** Green's line: sung when the song does not have it yet (and it is chosen), on the arranger's tune in double time. */
  line(e, parsed) {
    const key = norm(parsed.text);
    if (!key || this.sung.has(key)) return null;
    this.sung.add(key);
    if (!this.firstOfBeat.has(e.beat)) this.firstOfBeat.set(e.beat, e.seq);
    const first = this.firstOfBeat.get(e.beat) === e.seq;
    if (this.only && !this.only.has(e.seq)) return null;
    if (this.live && !first && this.sec(this.head) - this.now > LIVE_SLACK) return null;
    const bot = e.bot;
    const voice = engineVoice(bot);
    const common = {
      beatId: e.beat, src: e.seq, kind: 'line', agent: roleOf(e), status: 'proposing', doing: 'proposes a line', line: e.lyric ?? '',
      singsFor: e.singer && e.singer !== bot ? e.singer : null, summary: e.summary, at: e.t,
      gesture: first && !wordCue(parsed.text) ? WRITE[hash(`${e.seq}:${key}`) % WRITE.length] : '',
    };
    const tune = this.arrangedLine(e);
    if (tune && tune.notes.length === syllabify(tune.text).length) {
      const down = this.downFor(tune.pk);
      const h0 = Math.floor(down / GRID + 1e-9);
      this.enterBeat(e.beat, h0);
      this.fill(h0);
      tune.halves.forEach((c, k) => { this.halves[h0 + k] = c; }); // the tune's chords under it: an arranger bar a half bar
      const midis = intoRange(tune.notes.map((n) => n.midi), voice);
      const notes = tune.notes.map((n, i) => ({ beat: down + n.beat, dur: n.dur, midi: midis[i] }));
      return this.place({ bot, text: tune.text, notes, down, slot: tune.slot, voice, ...common, gesture: this.calm(bot, common.gesture, down) });
    }
    return this.recite(bot, parsed.text, { contour: 'steady', ...common });
  }

  /**
   * A consultation, sung: the asker glides over singing its question, the bot asked sings its answer, a hand play
   * seals it (both sing its word on the contact), the asker goes home. asked: true, or (a chained duet: the answer
   * that asked this question was already sung) the placed answer phrase that asked it.
   */
  duet(q, a, asked = true) {
    const asker = q.bot;
    const host = a?.bot && a.bot !== asker ? a.bot : q.consult.find((n) => n !== asker) ?? q.consult[0];
    if (!host) return null;
    // the seals by turn, from a place the episode picks (its first question): varied, the same every time
    this.sealFrom ??= hash(`${q.seq}:${q.summary ?? ''}`) % SEALS.length;
    const seal = SEALS[(this.sealFrom + this.duets++) % SEALS.length];
    const beatId = this.sectionBeat ?? q.beat;
    let question = null;
    if (asked === true) {
      question = this.recite(asker, teamVoice(q.summary, asker, NAMES), {
        contour: CONTOUR[roleOf(q)] ?? 'steady', question: true, beatId: q.beat, src: q.seq, kind: 'question', agent: roleOf(q),
        status: 'consulting', consult: [host], doing: `asks ${host}`, consultSeq: q.seq, summary: q.summary, at: q.t,
        duet: { visit: 'out', with: host, until: 0 },
      });
    } else if (asked) {
      // the chained question is the answer just sung ("We tell Gold yes, ask Green about the hook")
      this.items.push({ ...asked.item, kind: 'question', consultSeq: q.seq, seq: q.seq });
    }
    const aText = a ? teamVoice(a.summary, a.bot, NAMES) : fallbackAnswer(host, asker);
    const { action, gesture } = a ? gestureOf(a, 'answer', aText) : { action: '', gesture: 'thumbs-up' };
    const answer = this.recite(host, aText, {
      contour: CONTOUR[a ? roleOf(a) : ROLE_OF[host]] ?? 'steady', beatId: question ? q.beat : beatId, src: a?.seq ?? null, kind: 'answer',
      agent: a ? roleOf(a) : ROLE_OF[host] ?? 'cast', status: 'consulting', consult: [asker], doing: `answers ${asker}`, consultSeq: q.seq,
      action, gesture, summary: a?.summary ?? '', at: a?.t ?? q.t,
      duet: { visit: asked === true ? 'stay' : 'in', with: asker, until: 0 },
    });
    if (!answer) return null;
    // the seal: the hand play on the next bar line... (a half bar later at most), the word both sing on its contact
    const sealDown = ceilTo(answer.down + answer.slot - TAIL + 0.01, GRID);
    const sealEnd = sealDown + SEAL_BEATS;
    const playT = this.sec(sealDown);
    this.staged.push({
      seq: this.seq++, src: q.seq, t: +playT.toFixed(4), agent: roleOf(q), bot: asker, status: 'working', beat: answer.ev.beat, summary: q.summary,
      lyric: '', line: '', chords: [], action: seal.play, consult: [host], kind: 'gesture', gesture: '', duet: null, doing: `seals it with ${host}`, at: q.t,
    });
    this.items.push({ t0: +playT.toFixed(3), t1: +this.sec(sealEnd).toFixed(3), bot: asker, with: host, agent: roleOf(q), kind: 'gesture', beat: answer.ev.beat,
      seq: q.seq, consultSeq: q.seq, text: seal.play });
    const wordAt = sealDown + seal.at;
    const sylls = syllabify(seal.word);
    for (const [bot, top] of [[asker, false], [host, true]]) {
      const voice = engineVoice(bot);
      const chord = this.chordAt(wordAt);
      const { low, high } = voiceRange(voice);
      const pcs = top ? [chord.tones[1], chord.tones[2]] : [chord.tones[0]];
      const speak = Math.round(f0Midi(voice) + 5);
      let m = speak;
      for (let d = 0; d < 12; d++) {
        if (pcs.includes(mod12(speak + d))) { m = speak + d; break; }
        if (pcs.includes(mod12(speak - d))) { m = speak - d; break; }
      }
      m = Math.max(low, Math.min(high, m));
      const notes = sylls.map((_, i) => ({ beat: wordAt + i * EIGHTH, dur: i === sylls.length - 1 ? 1 : EIGHTH, midi: m }));
      const other = bot === asker ? host : asker;
      const placed = this.place({
        bot, text: seal.word, notes, down: wordAt, slot: SEAL_BEATS - seal.at, voice, beatId: answer.ev.beat, src: q.seq, kind: 'seal',
        agent: bot === asker ? roleOf(q) : answer.ev.agent, status: 'consulting', consult: [other], doing: `seals it with ${other}`,
        duet: { visit: 'stay', with: other, until: +(this.sec(sealEnd) - this.sec(wordAt) + CARD_LEAD).toFixed(3) }, db: -3, join: true,
        summary: q.summary, at: q.t,
      });
      this.items.splice(this.items.indexOf(placed.item), 1); // the word is part of the seal's item
    }
    this.head = Math.max(this.head, sealEnd - TAIL);
    this.fill(Math.ceil(sealEnd / GRID - 1e-9));
    // how long each scene lasts: from its card to the end of the seal (the visitor goes home then)
    if (question) question.ev.duet.until = +(this.sec(sealEnd) - question.ev.t).toFixed(3);
    answer.ev.duet.until = +(this.sec(sealEnd) - answer.ev.t).toFixed(3);
    return answer;
  }
}

/**
 * A recorded making-of, scored: every thought and consultation; Green's new lines as the time allows (the first new
 * line of each beat always, then the rest of the chorus stanzas, then the others, in order) so it lasts maxSeconds at
 * most. Returns the MakingOfScore (staged, lines, items, halves, end ...).
 */
export function scoreMakingOf(events, beats = null, { tempo = MAKING_OF_TEMPO, maxSeconds = MAX_SECONDS } = {}) {
  const run = (only) => {
    const s = new MakingOfScore({ beats, tempo, only });
    s.add(events, 0);
    s.flush(0);
    return s;
  };
  const full = run(null);
  if (full.end <= maxSeconds) return full;
  const sungLines = full.staged.filter((e) => e.kind === 'line').map((e) => events.find((x) => x.seq === e.src)).filter(Boolean);
  const firsts = new Set(full.firstOfBeat.values());
  const section = (e) => beats?.beats?.find((b) => b.id === e.beat)?.section ?? String(e.beat ?? '');
  const rank = (e) => (firsts.has(e.seq) ? 0 : /chorus/.test(section(e)) ? 1 : 2);
  const order = sungLines.slice().sort((x, y) => rank(x) - rank(y) || x.seq - y.seq);
  let best = full;
  for (let keep = order.length - 1; keep >= 0 && rank(order[keep]) > 0; keep--) {
    best = run(new Set(order.slice(0, keep).map((e) => e.seq)));
    if (best.end <= maxSeconds) break;
  }
  return best;
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
