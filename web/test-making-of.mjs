// The making-of as a musical number (web/src/making-of-score.js, web/src/team-voice.js), headless:
//   1. the crew's summaries in the team's voice, "we" (third-person, "I" and "we" bundles alike);
//   2. consultations paired with their answers (an `answers` field first, else the blackboard's rule);
//   3. the score of a recorded making-of: every thought and every consultation sung (a duet sealed by a hand play),
//      Green's new lines on the bar grid, 2-3 minutes, phrases on the strong beats, one note a syllable;
//   4. deterministic (the same score twice), and LIVE: events arriving in bursts through the player's score hook;
//   5. the timeline for the trailer tools, the crew's formation, the vamp.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { teamVoice, baseForm, isFirstPerson, isTeamVoice, pluralize } from './src/team-voice.js';
import {
  answerOf, pairConsultations, fallbackAnswer, scoreMakingOf, MakingOfScore, reciteRhythm, reciteSlot, recitePitches, gestureOf,
  crewFormation, CREW, SEALS, MAX_SECONDS, MAKING_OF_TEMPO,
} from './src/making-of-score.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { voiceRange, chordFromRoman } from './src/mv/music/theory.js';
import { NAMES, AGENT_BOT } from './src/gen/cast.js';
import { Player, parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { CARD_LEAD } from './src/sing-plan.js';
import { resolveAction } from './src/actions.js';

globalThis.window ??= {};
const { vampOf, timelineOf } = await import('./src/making-of.js');
const root = new URL('../episodes/', import.meta.url);
// the parade bundle as the director wrote it on Oct 29 (third-person summaries, no answers fields): the older form
const loadOld = () => ({
  events: parseNdjson(readFileSync(new URL('./fixtures/parade-oct29-events.ndjson', import.meta.url), 'utf8')),
  beats: modernBundle(JSON.parse(readFileSync(new URL('./fixtures/parade-oct29-beats.json', import.meta.url), 'utf8'))),
});
const load = (slug) => ({
  events: parseNdjson(readFileSync(new URL(`${slug}/events.ndjson`, root), 'utf8')),
  beats: modernBundle(JSON.parse(readFileSync(new URL(`${slug}/beats.json`, root), 'utf8'))),
});

// 1. the team's voice -----------------------------------------------------------------------------
{
  const fp = (s, bot) => teamVoice(s, bot, NAMES);
  const cases = [
    ['White asks Green where the hook lands', 'White', 'We ask Green where the hook lands'],
    ['White sets a cozy key for the frosty street', 'White', 'We set a cozy key for the frosty street'],
    // -es, -ies, -ys, -e verbs
    ['Blue hushes the diner to a tender dim', 'Blue', 'We hush the diner to a tender dim'],
    ['White catches the missed high-five in rhythm', 'White', 'We catch the missed high-five in rhythm'],
    ['Gold fixes the price', 'Gold', 'We fix the price'],
    ['Yellow buzzes the crowd', 'Yellow', 'We buzz the crowd'],
    ['White misses the cue', 'White', 'We miss the cue'],
    ['White steadies the verse under the strict gate', 'White', 'We steady the verse under the strict gate'],
    ['Pink tries a pratfall', 'Pink', 'We try a pratfall'],
    ['Gold ties the bow', 'Gold', 'We tie the bow'],
    ['Blue plays the lights', 'Blue', 'We play the lights'],
    ['Gold says no', 'Gold', 'We say no'],
    ['Pink giggles behind glowing laptop light', 'Pink', 'We giggle behind glowing laptop light'],
    ['Gray uses the count of eight', 'Gray', 'We use the count of eight'],
    ['Green closes on the yellow fence', 'Green', 'We close on the yellow fence'],
    ['Gray tiptoes past the gate', 'Gray', 'We tiptoe past the gate'],
    // irregulars
    ['White has a plan', 'White', 'We have a plan'],
    ['Green is ready', 'Green', 'We are ready'],
    ['Gray does the twist', 'Gray', 'We do the twist'],
    ['Yellow goes big', 'Yellow', 'We go big'],
    ["White doesn't rush the bridge", 'White', "We don't rush the bridge"],
    // possessive and contractions
    ["White's chords lift the chorus", 'White', 'Our chords lift the chorus'],
    ["White's ready for the chorus", 'White', "We're ready for the chorus"],
    ["Gold's counting coins", 'Gold', "We're counting coins"],
    ["Blue's got the spotlight", 'Blue', "We've got the spotlight"],
    // adverbs, modals, the past
    ['White gently lifts the bridge', 'White', 'We gently lift the bridge'],
    ["White can't wait for the hook", 'White', "We can't wait for the hook"],
    ['White lifted the verse', 'White', 'We lifted the verse'],
    ['Now White lifts the chorus', 'White', 'Now we lift the chorus'],
    // verbs the same subject adds (and not another subject's)
    ['White tells Gold yes kindly, asks Green about hook', 'White', 'We tell Gold yes kindly, ask Green about hook'],
    ['Green spins and loses his way', 'Green', 'We spin and lose our way'],
    ['White lifts the verse and nods', 'White', 'We lift the verse and nod'],
    ['Yellow tells Gray the finale huddles then erupts', 'Yellow', 'We tell Gray the finale huddles then erupts'],
    ['Yellow tells Gray the crew huddles and cheers', 'Yellow', 'We tell Gray the crew huddles and cheers'],
    ['Gold asks White if the band plays for free', 'Gold', 'We ask White if the band plays for free'],
    // his: the bot's own while nobody else is named; her stays (an object, or another's)
    ['Gold counts his coins', 'Gold', 'We count our coins'],
    ['Green gives Gold his quiet confession', 'Green', 'We give Gold his quiet confession'],
    ['Green feels her lift for swaying', 'Green', 'We feel her lift for swaying'],
    ['Pink hides herself behind the drum', 'Pink', 'We hide ourselves behind the drum'],
    ['Pink giggles into her soup', 'Pink', 'We giggle into our soup'],
    ['Blue gives White her cue', 'Blue', 'We give White her cue'],
    ['Blue gives Gold her cue', 'Blue', 'We give Gold our cue'],
    ['White hands her the baton', 'White', 'We hand her the baton'],
    ['Gold hands Pink his ladle', 'Gold', 'We hand Pink our ladle'],
    // a colour word is no name: only the Capitalised one is the bot
    ['Gold paints the gold sign', 'Gold', 'We paint the gold sign'],
    ['Blue puts a blue spot on Gold', 'Blue', 'We put a blue spot on Gold'],
    ['Gold paints the street blue and counts his coins', 'Gold', 'We paint the street blue and count our coins'],
    ['gold coins shine', 'Gold', 'gold coins shine'],
    ['Green leaves sway', 'Gold', 'Green leaves sway'],
    // the Oct 29-30 bundles' own "I": the team's "we"
    ['I set the key for the street', 'White', 'We set the key for the street'],
    ['My chords lift the chorus', 'White', 'Our chords lift the chorus'],
    ["I'm ready", 'White', "We're ready"],
    ['I hand Gold my ladle, and I am proud', 'Gold', 'We hand Gold our ladle, and we are proud'],
    ['I ask Green: give me a hook', 'White', 'We ask Green: give us a hook'],
    ["I've got the spotlight on Blue", 'Blue', "We've got the spotlight on Blue"],
    // left alone: already the team's voice, another subject, a group, no verb it can read
    ['We set the key for the street', 'White', 'We set the key for the street'],
    ['Our chords lift the chorus', 'White', 'Our chords lift the chorus'],
    ['Now we lift the chorus', 'White', 'Now we lift the chorus'],
    ['Navy brings Gold a cup', 'Green', 'Navy brings Gold a cup'],
    ['White and Gold plan the finale', 'White', 'White and Gold plan the finale'],
    ['White, Gold and Blue agree', 'White', 'White, Gold and Blue agree'],
    ['White ready to go', 'White', 'White ready to go'],
    ['', 'White', ''],
  ];
  for (const [s, bot, want] of cases) assert.equal(fp(s, bot), want, `${bot}: "${s}"`);
  assert.equal(baseForm('asks'), 'ask');
  assert.equal(baseForm('watches'), 'watch');
  assert.equal(baseForm('carries'), 'carry');
  assert.equal(baseForm('dies'), 'die');
  assert.equal(baseForm('has'), 'have');
  assert.equal(baseForm('is'), 'are');
  assert.equal(baseForm('was'), 'were');
  assert.equal(baseForm('focuses'), 'focus');
  assert.equal(baseForm('lifted'), null, 'not a third person form');
  assert.equal(baseForm('plus'), null);
  assert.ok(isFirstPerson('I ask White') && !isFirstPerson('White asks me'));
  assert.ok(isTeamVoice('We ask White') && isTeamVoice('Our chords') && isTeamVoice('Now we lift it') && !isTeamVoice('I ask White') && !isTeamVoice('White asks us'));
  assert.equal(pluralize('I give Gold my cue, I am sure'), 'We give Gold our cue, we are sure');
  assert.equal(pluralize('Wait for me. I nod'), 'Wait for us. We nod');
  // every crew summary of every curated bundle: the team's voice ("We ...", "Our ..."), or as written; idempotent
  let n = 0;
  for (const dir of readdirSync(root)) {
    if (!existsSync(new URL(`${dir}/events.ndjson`, root))) continue;
    for (const e of parseNdjson(readFileSync(new URL(`${dir}/events.ndjson`, root), 'utf8'))) {
      const out = fp(e.summary, e.bot);
      assert.ok(isTeamVoice(out) || out === e.summary, `${dir} #${e.seq}: "${out}"`);
      assert.equal(fp(out, e.bot), out, `${dir} #${e.seq}: a summary in the team's voice stays as it is`);
      assert.ok(!/\b(White|Green|Gold|Blue|Gray|Yellow|Pink) (asks|tells|sets)\b/.test(out.split(' ').slice(0, 2).join(' ')) || out === e.summary);
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
  // an older bundle (no answers fields): the blackboard's rule, the one naming the asker first, and a chain (Gray's
  // answer to Yellow asks him something back)
  const old = loadOld().events;
  const op = pairConsultations(old);
  assert.equal(op.size, old.filter((e) => e.status === 'consulting').length);
  assert.equal(op.get(45).seq, 65);
  assert.equal(op.get(65).seq, 67);
  const E = (seq, bot, summary, extra = {}) => ({ seq, t: seq, agent: 'x', bot, status: 'working', beat: 'b1', summary, lyric: '', chords: [], action: '', consult: [], ...extra });
  const q = E(1, 'Gold', 'Gold asks White about the budget', { status: 'consulting', consult: ['White'] });
  // the blackboard's rule: the first later event of a bot it asks...
  assert.equal(answerOf(q, [q, E(2, 'Blue', 'Blue dims'), E(3, 'White', 'White sets the key'), E(4, 'White', 'White lifts')]).seq, 3);
  // ... the one of the next two that names the asker ...
  assert.equal(answerOf(q, [q, E(3, 'White', 'White sets the key'), E(4, 'White', 'White tells Gold yes')]).seq, 4);
  assert.equal(answerOf(q, [q, E(3, 'White', 'White sets'), E(4, 'White', 'White hums'), E(5, 'White', 'White tells Gold yes')]).seq, 3, 'two at most');
  // ... and an explicit answers field before anything (a number or a list)
  assert.equal(answerOf(q, [q, E(3, 'White', 'White tells Gold yes'), E(5, 'White', 'White says the band is free', { answers: 1 })]).seq, 5);
  assert.equal(answerOf(q, [q, E(3, 'White', 'White hums'), E(6, 'Blue', 'Blue chimes in', { answers: [1] })]).seq, 6);
  assert.equal(answerOf(q, [q, E(2, 'Blue', 'Blue dims')]), null, 'no answer');
  assert.equal(answerOf(E(9, 'Gold', 'Gold counts'), [q]), null, 'not a consultation');
  // an answer answers one question
  const q2 = E(2, 'Gray', 'Gray asks White too', { status: 'consulting', consult: ['White'] });
  const both = pairConsultations([q, q2, E(3, 'White', 'White tells Gold yes'), E(4, 'White', 'White tells Gray yes')]);
  assert.equal(both.get(1).seq, 3);
  assert.equal(both.get(2).seq, 4);
  assert.match(fallbackAnswer('White', 'Gold'), /Let me take a look/);
  assert.match(fallbackAnswer('Pink', 'Gold'), /Of course, darling/);
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
    assert.equal(i.text, teamVoice(e.summary, e.bot, NAMES), why(`#${i.seq} in the team's voice`));
  }
  // Green's lines: the first new line of every beat, never one the song already has
  const lines = items.filter((i) => i.kind === 'line');
  assert.ok(lines.every((i) => i.bot === 'Green' || events.find((e) => e.seq === i.seq)?.bot === i.bot));
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
  // a late answer (White answers Gold 27 events on) is sung in the duet, right after the question, not again later
  const late = it.filter((i) => i.consultSeq === 28);
  assert.deepEqual(late.map((i) => [i.kind, i.bot]), [['question', 'Gold'], ['answer', 'White'], ['gesture', 'Gold']]);
  assert.equal(late[1].text, teamVoice(hw.events.find((e) => e.seq === 55).summary, 'White', NAMES), 'an "I" summary is sung in the team voice, "we"');
  assert.equal(it.filter((i) => i.seq === 55).length, 1, 'the answer is sung once');
  // the thoughts sound like the crew's own: the first one on the grid after the count-in
  assert.equal(it[0].text, 'We set a cozy key for the street');
  assert.ok(it[0].t0 < 2 * score.bar);
  // the gestures: thinking (by role) where the event's action is no hand play, never the same bot twice in a row too soon
  const gest = score.staged.filter((e) => e.gesture);
  assert.ok(gest.length >= 10, `${gest.length} gestures`);
  assert.ok(gest.some((e) => e.agent === 'lighting' && ['binoculars', 'point'].includes(e.gesture)), 'Blue looks for the light');
  for (const e of score.staged) {
    if (e.kind !== 'thought') continue;
    const r = resolveAction(e.action);
    assert.ok(r.kind !== 'move', 'the studio formation holds: a move becomes a gesture');
  }
  assert.equal(gestureOf({ seq: 1, bot: 'Blue', agent: 'lighting', status: 'working', action: 'lights-gold' }).action, 'lights-gold');
  assert.ok(['binoculars', 'point'].includes(gestureOf({ seq: 1, bot: 'Blue', agent: 'lighting', status: 'working', action: 'lights-gold' }).gesture));
  assert.deepEqual(gestureOf({ seq: 1, bot: 'White', agent: 'chords', status: 'working', action: 'conductor' }), { action: 'conductor', gesture: '' });
  assert.deepEqual(gestureOf({ seq: 2, bot: 'Gray', agent: 'dance', status: 'working', action: 'huddle' }), { action: '', gesture: 'beckon' });
  assert.equal(gestureOf({ seq: 3, bot: 'Gold', agent: 'deals', status: 'done', action: '' }).gesture, 'thumbs-up');
  // the duet staging: the asker goes over (visit out) until the seal ends, the answer keeps it
  const q20 = score.staged.find((e) => e.kind === 'question' && e.src === 20);
  assert.deepEqual([q20.bot, q20.consult, q20.duet.visit, q20.status], ['White', ['Green'], 'out', 'consulting']);
  const seal20 = score.items.find((i) => i.kind === 'gesture' && i.consultSeq === 20);
  assert.ok(Math.abs(q20.t + q20.duet.until - seal20.t1) < 1e-2, 'the asker goes home when the seal ends');
  const a23 = score.staged.find((e) => e.kind === 'answer' && e.src === 23);
  assert.deepEqual([a23.bot, a23.consult, a23.duet.visit], ['Green', ['White'], 'stay']);
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

// two more bundles: toy-box as re-directed (first person, answers), the Oct 29 parade (third person, no answers)
for (const slug of ['toy-box', 'parade']) {
  const b = slug === 'parade' ? loadOld() : load(slug);
  const s = checkScore(slug, scoreMakingOf(b.events, b.beats), b.events);
  if (slug !== 'parade') continue;
  // the chain: Gray answers Yellow and asks him back (one phrase, both), Yellow answers; she comes over (visit in)
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
  const sylls = syllabify('We ask White if the band plays for free');
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
  lone.add([{ seq: 0, t: 0, agent: 'deals', bot: 'Gold', status: 'consulting', beat: 'b', summary: 'Gold asks Pink for a joke', lyric: '', chords: [], action: '', consult: ['Pink'] }], 0);
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
console.log(`making-of ok: the team's voice, pairing, scores of 3 bundles (hackathon-win ${score.end.toFixed(1)} s, ${score.items.length} phrases), deterministic, live`);
