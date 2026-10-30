// The making-of as a musical number (web/src/making-of-score.js, web/src/first-person.js), headless:
//   1. the crew's summaries in the first person (third-person bundles and first-person ones alike);
//   2. consultations paired with their answers (an `answers` field first, else the blackboard's rule);
//   3. the score of a recorded making-of: every thought and every consultation sung (a duet sealed by a hand play),
//      Teddy's new lines on the bar grid, 2-3 minutes, phrases on the strong beats, one note a syllable;
//   4. deterministic (the same score twice), and LIVE: events arriving in bursts through the player's score hook;
//   5. the timeline for the trailer tools, the crew's formation, the vamp.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { firstPerson, baseForm, isFirstPerson } from './src/first-person.js';
import {
  answerOf, pairConsultations, fallbackAnswer, scoreMakingOf, MakingOfScore, reciteRhythm, reciteSlot, recitePitches, gestureOf,
  crewFormation, CREW, SEALS, MAX_SECONDS, MAKING_OF_TEMPO,
} from './src/making-of-score.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { voiceRange, chordFromRoman } from './src/mv/music/theory.js';
import { NAMES, AGENT_BOT } from './src/gen/cast.js';
import { Player, parseNdjson } from './src/player.js';
import { CARD_LEAD } from './src/sing-plan.js';
import { resolveAction } from './src/actions.js';

globalThis.window ??= {};
const { vampOf, timelineOf } = await import('./src/making-of.js');
const root = new URL('../episodes/', import.meta.url);
const load = (slug) => ({
  events: parseNdjson(readFileSync(new URL(`${slug}/events.ndjson`, root), 'utf8')),
  beats: JSON.parse(readFileSync(new URL(`${slug}/beats.json`, root), 'utf8')),
});

// 1. first person ---------------------------------------------------------------------------------
{
  const fp = (s, bot) => firstPerson(s, bot, NAMES);
  const cases = [
    ['Nora asks Teddy where the hook lands', 'Nora', 'I ask Teddy where the hook lands'],
    ['Nora sets a cozy key for the frosty street', 'Nora', 'I set a cozy key for the frosty street'],
    // -es, -ies, -ys, -e verbs
    ['Gigi hushes the diner to a tender dim', 'Gigi', 'I hush the diner to a tender dim'],
    ['Nora catches the missed high-five in rhythm', 'Nora', 'I catch the missed high-five in rhythm'],
    ['Lou fixes the price', 'Lou', 'I fix the price'],
    ['Frankie buzzes the crowd', 'Frankie', 'I buzz the crowd'],
    ['Nora misses the cue', 'Nora', 'I miss the cue'],
    ['Nora steadies the verse under the strict gate', 'Nora', 'I steady the verse under the strict gate'],
    ['Pearl tries a pratfall', 'Pearl', 'I try a pratfall'],
    ['Lou ties the bow', 'Lou', 'I tie the bow'],
    ['Gigi plays the lights', 'Gigi', 'I play the lights'],
    ['Lou says no', 'Lou', 'I say no'],
    ['Pearl giggles behind glowing laptop light', 'Pearl', 'I giggle behind glowing laptop light'],
    ['Vera uses the count of eight', 'Vera', 'I use the count of eight'],
    ['Teddy closes on the yellow fence', 'Teddy', 'I close on the yellow fence'],
    ['Vera tiptoes past the gate', 'Vera', 'I tiptoe past the gate'],
    // irregulars
    ['Nora has a plan', 'Nora', 'I have a plan'],
    ['Teddy is ready', 'Teddy', 'I am ready'],
    ['Vera does the twist', 'Vera', 'I do the twist'],
    ['Frankie goes big', 'Frankie', 'I go big'],
    ["Nora doesn't rush the bridge", 'Nora', "I don't rush the bridge"],
    // possessive and contractions
    ["Nora's chords lift the chorus", 'Nora', 'My chords lift the chorus'],
    ["Nora's ready for the chorus", 'Nora', "I'm ready for the chorus"],
    ["Lou's counting coins", 'Lou', "I'm counting coins"],
    ["Gigi's got the spotlight", 'Gigi', "I've got the spotlight"],
    // adverbs, modals, the past
    ['Nora gently lifts the bridge', 'Nora', 'I gently lift the bridge'],
    ["Nora can't wait for the hook", 'Nora', "I can't wait for the hook"],
    ['Nora lifted the verse', 'Nora', 'I lifted the verse'],
    ['Now Nora lifts the chorus', 'Nora', 'Now I lift the chorus'],
    // verbs the same subject adds (and not another subject's)
    ['Nora tells Lou yes kindly, asks Teddy about hook', 'Nora', 'I tell Lou yes kindly, ask Teddy about hook'],
    ['Teddy spins and loses his way', 'Teddy', 'I spin and lose my way'],
    ['Nora lifts the verse and nods', 'Nora', 'I lift the verse and nod'],
    ['Frankie tells Vera the finale huddles then erupts', 'Frankie', 'I tell Vera the finale huddles then erupts'],
    ['Frankie tells Vera the crew huddles and cheers', 'Frankie', 'I tell Vera the crew huddles and cheers'],
    ['Lou asks Nora if the band plays for free', 'Lou', 'I ask Nora if the band plays for free'],
    // his: the bot's own while nobody else is named; her stays (an object, or another's)
    ['Lou counts his coins', 'Lou', 'I count my coins'],
    ['Teddy gives Lou his quiet confession', 'Teddy', 'I give Lou his quiet confession'],
    ['Teddy feels her lift for swaying', 'Teddy', 'I feel her lift for swaying'],
    ['Pearl hides herself behind the drum', 'Pearl', 'I hide myself behind the drum'],
    ['Pearl giggles into her soup', 'Pearl', 'I giggle into my soup'],
    ['Gigi gives Nora her cue', 'Gigi', 'I give Nora her cue'],
    ['Gigi gives Lou her cue', 'Gigi', 'I give Lou my cue'],
    ['Nora hands her the baton', 'Nora', 'I hand her the baton'],
    ['Lou hands Pearl his ladle', 'Lou', 'I hand Pearl my ladle'],
    // left alone: already first person, another subject, a group, no verb it can read
    ['I set the key for the street', 'Nora', 'I set the key for the street'],
    ['My chords lift the chorus', 'Nora', 'My chords lift the chorus'],
    ["I'm ready", 'Nora', "I'm ready"],
    ['Benny brings Lou a cup', 'Teddy', 'Benny brings Lou a cup'],
    ['Nora and Lou plan the finale', 'Nora', 'Nora and Lou plan the finale'],
    ['Nora, Lou and Gigi agree', 'Nora', 'Nora, Lou and Gigi agree'],
    ['Nora ready to go', 'Nora', 'Nora ready to go'],
    ['', 'Nora', ''],
  ];
  for (const [s, bot, want] of cases) assert.equal(fp(s, bot), want, `${bot}: "${s}"`);
  assert.equal(baseForm('asks'), 'ask');
  assert.equal(baseForm('watches'), 'watch');
  assert.equal(baseForm('carries'), 'carry');
  assert.equal(baseForm('dies'), 'die');
  assert.equal(baseForm('has'), 'have');
  assert.equal(baseForm('is'), 'am');
  assert.equal(baseForm('focuses'), 'focus');
  assert.equal(baseForm('lifted'), null, 'not a third person form');
  assert.equal(baseForm('plus'), null);
  assert.ok(isFirstPerson('I ask Nora') && !isFirstPerson('Nora asks me'));
  // every crew summary of every curated bundle: the bot's own voice ("I ...", "My ..."), or as written; idempotent
  let n = 0;
  for (const dir of readdirSync(root)) {
    if (!existsSync(new URL(`${dir}/events.ndjson`, root))) continue;
    for (const e of parseNdjson(readFileSync(new URL(`${dir}/events.ndjson`, root), 'utf8'))) {
      const out = fp(e.summary, e.bot);
      assert.ok(isFirstPerson(out) || out === e.summary, `${dir} #${e.seq}: "${out}"`);
      assert.equal(fp(out, e.bot), out, `${dir} #${e.seq}: a first-person summary stays as it is`);
      assert.ok(!/\b(Nora|Teddy|Lou|Gigi|Vera|Frankie|Pearl) (asks|tells|sets)\b/.test(out.split(' ').slice(0, 2).join(' ')) || out === e.summary);
      n++;
    }
  }
  assert.ok(n > 900, `${n} summaries`);
}

// 2. who answers whom -----------------------------------------------------------------------------
{
  // a bundle with `answers` (the director's since 2026-10-30): each consultation's answer says so, however late
  const { events } = load('hackathon-win');
  const pairs = pairConsultations(events);
  assert.deepEqual([...pairs].map(([q, a]) => [q, a.seq]), events.filter((e) => Number.isInteger(e.answers)).map((a) => [a.answers, a.seq])
    .sort((x, y) => x[0] - y[0]), 'every answers field pairs its consultation');
  assert.ok(pairs.size >= 4 && [...pairs.values()].every((a) => a.answers !== undefined));
  // an older bundle (no answers fields): the blackboard's rule, the one naming the asker first, and a chain (Vera's
  // answer to Frankie asks him something back)
  const old = load('parade').events;
  const op = pairConsultations(old);
  assert.equal(op.size, old.filter((e) => e.status === 'consulting').length);
  assert.equal(op.get(45).seq, 65);
  assert.equal(op.get(65).seq, 67);
  const E = (seq, bot, summary, extra = {}) => ({ seq, t: seq, agent: 'x', bot, status: 'working', beat: 'b1', summary, lyric: '', chords: [], action: '', consult: [], ...extra });
  const q = E(1, 'Lou', 'Lou asks Nora about the budget', { status: 'consulting', consult: ['Nora'] });
  // the blackboard's rule: the first later event of a bot it asks...
  assert.equal(answerOf(q, [q, E(2, 'Gigi', 'Gigi dims'), E(3, 'Nora', 'Nora sets the key'), E(4, 'Nora', 'Nora lifts')]).seq, 3);
  // ... the one of the next two that names the asker ...
  assert.equal(answerOf(q, [q, E(3, 'Nora', 'Nora sets the key'), E(4, 'Nora', 'Nora tells Lou yes')]).seq, 4);
  assert.equal(answerOf(q, [q, E(3, 'Nora', 'Nora sets'), E(4, 'Nora', 'Nora hums'), E(5, 'Nora', 'Nora tells Lou yes')]).seq, 3, 'two at most');
  // ... and an explicit answers field before anything (a number or a list)
  assert.equal(answerOf(q, [q, E(3, 'Nora', 'Nora tells Lou yes'), E(5, 'Nora', 'Nora says the band is free', { answers: 1 })]).seq, 5);
  assert.equal(answerOf(q, [q, E(3, 'Nora', 'Nora hums'), E(6, 'Gigi', 'Gigi chimes in', { answers: [1] })]).seq, 6);
  assert.equal(answerOf(q, [q, E(2, 'Gigi', 'Gigi dims')]), null, 'no answer');
  assert.equal(answerOf(E(9, 'Lou', 'Lou counts'), [q]), null, 'not a consultation');
  // an answer answers one question
  const q2 = E(2, 'Vera', 'Vera asks Nora too', { status: 'consulting', consult: ['Nora'] });
  const both = pairConsultations([q, q2, E(3, 'Nora', 'Nora tells Lou yes'), E(4, 'Nora', 'Nora tells Vera yes')]);
  assert.equal(both.get(1).seq, 3);
  assert.equal(both.get(2).seq, 4);
  assert.match(fallbackAnswer('Nora', 'Lou'), /Let me take a look/);
  assert.match(fallbackAnswer('Pearl', 'Lou'), /Of course, darling/);
}

// 3. the score of a recorded making-of ------------------------------------------------------------
const checkScore = (slug, s, events) => {
  const why = (m) => `${slug}: ${m}`;
  // 2-3 minutes (a judge presses Live: the premiere follows)
  assert.ok(s.end >= 110 && s.end <= MAX_SECONDS + 10, why(`${s.end.toFixed(1)} s`));
  const items = s.items;
  const kinds = new Set(['thought', 'line', 'question', 'answer', 'gesture']);
  assert.ok(items.every((i) => kinds.has(i.kind) && i.t1 > i.t0 && i.t0 >= 0 && i.text && i.bot), why('items'));
  // every consultation is a duet: its question, its answer, the hand play that seals it, one consultSeq
  const consults = events.filter((e) => e.status === 'consulting' && e.consult?.length);
  for (const q of consults) {
    const of = items.filter((i) => i.consultSeq === q.seq);
    assert.ok(of.some((i) => i.kind === 'question' && i.bot === q.bot), why(`#${q.seq} asked`));
    const a = of.find((i) => i.kind === 'answer');
    assert.ok(a && a.bot !== q.bot, why(`#${q.seq} answered`));
    const g = of.find((i) => i.kind === 'gesture');
    assert.ok(g && SEALS.some((x) => x.play === g.text) && g.t0 >= a.t1 - 0.05, why(`#${q.seq} sealed after the answer`));
  }
  const seals = items.filter((i) => i.kind === 'gesture').map((i) => i.text);
  assert.ok(seals.every((x, i) => i === 0 || x !== seals[i - 1]), why(`the seals vary: ${seals}`));
  // every thought is sung: each event without a line, as a thought or in a duet
  const sung = new Set(items.map((i) => i.seq));
  for (const e of events) if (!e.lyric) assert.ok(sung.has(e.seq), why(`#${e.seq} (${e.bot}) sung`));
  for (const i of items.filter((x) => x.kind === 'thought')) {
    const e = events.find((x) => x.seq === i.seq);
    assert.equal(i.text, firstPerson(e.summary, e.bot, NAMES), why(`#${i.seq} in the first person`));
  }
  // Teddy's lines: the first new line of every beat, never one the song already has
  const lines = items.filter((i) => i.kind === 'line');
  assert.ok(lines.every((i) => i.bot === 'Teddy' || events.find((e) => e.seq === i.seq)?.bot === i.bot));
  const texts = lines.map((i) => i.text.toLowerCase().replace(/[^a-z ]/g, ''));
  assert.equal(new Set(texts).size, texts.length, why('no line twice'));
  for (const [beat, seq] of s.firstOfBeat) assert.ok(lines.some((i) => i.seq === seq), why(`${beat}: its first new line`));
  // the staged events: in time order, each sung one's voice CARD_LEAD after its card, one note a syllable
  assert.ok(s.staged.every((e, i) => i === 0 || e.t >= s.staged[i - 1].t - 1e-9), why('in order'));
  const plan = new Map(s.lines.map((l) => [l.seq, l]));
  for (const e of s.staged) {
    if (!e.lyric) { assert.equal(e.kind, 'gesture'); continue; }
    const l = plan.get(e.seq);
    assert.ok(l, why(`#${e.seq} has a voice`));
    assert.ok(Math.abs(l.at - e.t - CARD_LEAD) < 1e-3 || e.t === 0, why(`#${e.seq} card lead`));
    assert.equal(l.job.notes.length, syllabify(l.job.text).length, why(`"${l.job.text}": a note a syllable`));
    assert.equal(l.job.text, e.lyric);
    const { low, high } = voiceRange(l.job.voice);
    assert.ok(l.job.notes.every((n) => n.midi >= low && n.midi <= high && n.dur > 0), why(`"${l.job.text}" in ${l.job.voice}'s range`));
    assert.ok(l.job.notes.every((n, i) => i === 0 || n.t >= l.job.notes[i - 1].t + l.job.notes[i - 1].dur - 1e-6), why('notes one after another'));
  }
  // one voice at a time: a phrase starts after the last one ends (its pickup sings in the last one's breath), but
  // the seal's word, which both sing together
  const solo = s.lines.filter((l) => s.staged.find((e) => e.seq === l.seq)?.kind !== 'seal').sort((a, b) => a.at - b.at);
  for (let i = 1; i < solo.length; i++) {
    const p = solo[i - 1], end = p.at + p.job.notes.at(-1).t + p.job.notes.at(-1).dur;
    assert.ok(solo[i].at >= end - 1e-3, why(`"${solo[i].job.text}" starts at ${solo[i].at.toFixed(2)} before "${p.job.text}" ends ${end.toFixed(2)}`));
  }
  // on the grid: a phrase enters on a strong beat (a bar line or the half bar): its first note there, or after its
  // pickup (one syllable for a thought, up to three for a line on its tune)
  const strong = (b) => Math.abs(b - Math.round(b)) < 1e-3 && Math.round(b) % 2 === 0;
  for (const l of solo) {
    const k = l.job.notes.findIndex((n) => strong((l.at + n.t) / s.beat));
    assert.ok(k >= 0 && k <= 3, why(`"${l.job.text}" enters on a strong beat (note ${k})`));
    assert.ok(l.job.notes.slice(0, k).every((n) => (l.at + n.t) / s.beat > (l.at + l.job.notes[k].t) / s.beat - 2), why('a short pickup'));
  }
  // the vamp covers the whole making-of
  assert.ok(s.halves.length * 2 * s.beat >= s.end - 2 * s.bar - 1e-6, why('the vamp'));
  assert.ok(s.halves.every((c) => typeof c === 'string' && c.length), why('the vamp: a chord a half bar'));
  return s;
};

const hw = load('hackathon-win');
const score = checkScore('hackathon-win', scoreMakingOf(hw.events, hw.beats), hw.events);
{
  const it = score.items;
  // a late answer (Nora answers Lou 27 events on) is sung in the duet, right after the question, not again later
  const late = it.filter((i) => i.consultSeq === 28);
  assert.deepEqual(late.map((i) => [i.kind, i.bot]), [['question', 'Lou'], ['answer', 'Nora'], ['gesture', 'Lou']]);
  assert.equal(late[1].text, hw.events.find((e) => e.seq === 55).summary, 'a first-person summary is sung as written');
  assert.equal(it.filter((i) => i.seq === 55).length, 1, 'the answer is sung once');
  // the thoughts sound like the crew's own: the first one on the grid after the count-in
  assert.equal(it[0].text, 'I set a cozy key for the street');
  assert.ok(it[0].t0 < 2 * score.bar);
  // the gestures: thinking (by role) where the event's action is no hand play, never the same bot twice in a row too soon
  const gest = score.staged.filter((e) => e.gesture);
  assert.ok(gest.length >= 10, `${gest.length} gestures`);
  assert.ok(gest.some((e) => e.agent === 'lighting' && ['binoculars', 'point'].includes(e.gesture)), 'Gigi looks for the light');
  for (const e of score.staged) {
    if (e.kind !== 'thought') continue;
    const r = resolveAction(e.action);
    assert.ok(r.kind !== 'move', 'the studio formation holds: a move becomes a gesture');
  }
  assert.equal(gestureOf({ seq: 1, bot: 'Gigi', agent: 'lighting', status: 'working', action: 'lights-gold' }).action, 'lights-gold');
  assert.ok(['binoculars', 'point'].includes(gestureOf({ seq: 1, bot: 'Gigi', agent: 'lighting', status: 'working', action: 'lights-gold' }).gesture));
  assert.deepEqual(gestureOf({ seq: 1, bot: 'Nora', agent: 'chords', status: 'working', action: 'conductor' }), { action: 'conductor', gesture: '' });
  assert.deepEqual(gestureOf({ seq: 2, bot: 'Vera', agent: 'dance', status: 'working', action: 'huddle' }), { action: '', gesture: 'beckon' });
  assert.equal(gestureOf({ seq: 3, bot: 'Lou', agent: 'deals', status: 'done', action: '' }).gesture, 'thumbs-up');
  // the duet staging: the asker goes over (visit out) until the seal ends, the answer keeps it
  const q20 = score.staged.find((e) => e.kind === 'question' && e.src === 20);
  assert.deepEqual([q20.bot, q20.consult, q20.duet.visit, q20.status], ['Nora', ['Teddy'], 'out', 'consulting']);
  const seal20 = score.items.find((i) => i.kind === 'gesture' && i.consultSeq === 20);
  assert.ok(Math.abs(q20.t + q20.duet.until - seal20.t1) < 1e-2, 'the asker goes home when the seal ends');
  const a23 = score.staged.find((e) => e.kind === 'answer' && e.src === 23);
  assert.deepEqual([a23.bot, a23.consult, a23.duet.visit], ['Teddy', ['Nora'], 'stay']);
  const words = score.staged.filter((e) => e.kind === 'seal');
  assert.equal(words.length, 2 * 4, 'both sing the seal word');
  // the timeline for the trailer
  const tl = timelineOf(score);
  assert.equal(tl.items.length, score.items.length);
  assert.ok(tl.end === +score.end.toFixed(3) && tl.tempo === MAKING_OF_TEMPO);
  // the vamp: open while live, its home chord at the end once closed
  const v = vampOf(score);
  assert.equal(v.endHalf(), Math.round(score.end / (2 * score.beat)) - 2);
  assert.equal(vampOf(new MakingOfScore({ live: true })).endHalf(), null);
}

// two more bundles (third-person summaries, no answers fields)
for (const slug of ['toy-box', 'parade']) {
  const b = load(slug);
  const s = checkScore(slug, scoreMakingOf(b.events, b.beats), b.events);
  if (slug !== 'parade') continue;
  // the chain: Vera answers Frankie and asks him back (one phrase, both), Frankie answers; she comes over (visit in)
  const fr = s.items.filter((i) => i.seq === 65 && i.kind !== 'gesture');
  assert.deepEqual(fr.map((i) => i.kind).sort(), ['answer', 'question']);
  assert.equal(fr[0].t0, fr[1].t0, 'the answer that asks is one phrase');
  const a67 = s.staged.find((e) => e.kind === 'answer' && e.src === 67);
  assert.equal(s.items.find((i) => i.kind === 'answer' && i.consultSeq === 65).bot, a67.bot);
  assert.equal(a67.duet.visit, 'in');
}

// the recitative itself: "I" before the bar line, an eighth a syllable, the stressed ones longer when there is room,
// the last held; a question rises at its end, a statement lands on its chord's root
{
  const sylls = syllabify('I ask Nora if the band plays for free');
  const slot = reciteSlot(sylls);
  assert.equal(slot % 2, 0);
  const r = reciteRhythm(sylls, slot);
  assert.equal(r.length, sylls.length);
  assert.equal(r[0].beat, -0.5, 'the pickup');
  assert.equal(r[1].beat, 0, 'the downbeat');
  assert.ok(r.every((n, i) => i === 0 || Math.abs(n.beat - (r[i - 1].beat + r[i - 1].dur)) < 1e-9), 'legato');
  assert.ok(r.at(-1).dur >= 1 && r.at(-1).beat + r.at(-1).dur <= slot - 0.5 + 1e-9);
  const C = chordFromRoman('I', 'C'), at = () => C;
  const q = recitePitches(r, { voice: 'old', chordAt: at, question: true });
  const st = recitePitches(r, { voice: 'old', chordAt: at });
  assert.ok(q.at(-1) > q.at(-2), 'a question rises');
  assert.equal(((st.at(-1) % 12) + 12) % 12, 0, 'a statement lands on the root');
}

// 4. deterministic; LIVE -------------------------------------------------------------------------
{
  const again = scoreMakingOf(hw.events, hw.beats);
  const pick = (s) => JSON.stringify([s.staged, s.lines, s.items, s.halves, s.end]);
  assert.equal(pick(again), pick(score), 'the same score every time');
  // live: the crew's bursts by their authoring time (sped up), through the player's score hook
  const live = new MakingOfScore({ live: true, beats: hw.beats });
  const p = new Player({ onEvent: () => {} });
  const adds = [];
  await p.live(hw.events, { speed: 4, score: { add: (r, now) => { const x = live.add(r, now); adds.push([now, x]); return x; }, flush: (now) => live.flush(now) } });
  for (let i = 0; i < 20000 && !(p.liveDone && p.time >= live.end); i++) p.tick(0.05);
  assert.ok(p.liveDone && live.closed, 'the stream ends, the score closes');
  assert.ok(p.events.every((e, i) => i === 0 || e.t >= p.events[i - 1].t - 1e-9), 'live: in order');
  for (const [now, added] of adds) for (const e of added) assert.ok(e.t >= now + 1 - 1e-6, `live: #${e.seq} staged ahead of ${now.toFixed(2)} (at ${e.t.toFixed(2)})`);
  const lq = live.items.filter((i) => i.kind === 'question'), la = live.items.filter((i) => i.kind === 'answer');
  const nq = hw.events.filter((e) => e.status === 'consulting').length;
  assert.ok(lq.length >= nq - 1 && la.length >= nq, `live: the duets (${lq.length} questions, ${la.length} answers of ${nq})`);
  for (const q of hw.events.filter((e) => e.status === 'consulting')) assert.ok(live.items.some((i) => i.consultSeq === q.seq && i.kind === 'answer'), `live: #${q.seq} answered`);
  assert.ok(live.end > 60 && live.end < 400, `live: ${live.end.toFixed(1)} s`);
  // a question nobody answers still gets its duet (a stand-in answer) when the stream ends
  const lone = new MakingOfScore({ live: true });
  lone.add([{ seq: 0, t: 0, agent: 'deals', bot: 'Lou', status: 'consulting', beat: 'b', summary: 'Lou asks Pearl for a joke', lyric: '', chords: [], action: '', consult: ['Pearl'] }], 0);
  assert.equal(lone.items.length, 0, 'it waits for its answer');
  lone.flush(1);
  assert.deepEqual(lone.items.map((i) => i.kind), ['question', 'answer', 'gesture']);
  assert.match(lone.items[1].text, /Of course, darling/);
}

// 5. the crew's formation ---------------------------------------------------------------------------
{
  const f = crewFormation();
  assert.equal(f.size, NAMES.length);
  assert.deepEqual(new Set(CREW), new Set(Object.values(AGENT_BOT)), 'the crew is the seven role bots');
  const front = CREW.map((n) => f.get(n)), back = NAMES.filter((n) => !CREW.includes(n)).map((n) => f.get(n));
  assert.ok(Math.min(...front.map((p) => p[2])) > Math.max(...back.map((p) => p[2])), 'the crew in front of the choir');
  const all = [...f.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert.ok(Math.hypot(all[i][0] - all[j][0], all[i][2] - all[j][2]) > 0.7 || Math.abs(all[i][1] - all[j][1]) > 0.5, 'room between heads');
  }
}
console.log(`making-of ok: first person, pairing, scores of 3 bundles (hackathon-win ${score.end.toFixed(1)} s, ${score.items.length} phrases), deterministic, live`);
