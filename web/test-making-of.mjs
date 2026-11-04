// The making-of as a musical number (web/src/making-of-score.js, web/src/team-voice.js), headless:
//   1. the crew's summaries in the team's voice, "we" (third-person, "I" and "we" bundles alike);
//   2. consultations paired with their answers (an `answers` field first, else the blackboard's rule);
//   3. the score of a recorded making-of, the loading bar: as long as the production took (longer only by the
//      consultations still to sing when it ended), each event sung at or after the moment it was written, a side
//      remark within MAX_LAG else an aside; every consultation sung (a duet sealed by a hand play), Green's first new
//      line of every beat, the crew's work song (a refrain) in the waits; phrases on the bar lines, one note a syllable,
//      at the premiere's pace (two bars a line, no faster than 2 syllables/s, the names on a strong beat); the form (each
//      section's progression from its function set, fitted so it ends as the set does: half cadences on V, V7 -> I,
//      the song on I), the tunes (chord tones on the strong beats, questions up to so, answers home to do), the
//      backing (the crew members who do not sing the phrase, on the chord's tones, under it in the mix) and the gap
//      answers;
//   4. deterministic (the same score twice), and LIVE: events arriving through the player's score hook and ticks,
//      by the same rules (live and replay alike), its loading bar;
//   5. the timeline for the trailer tools, the crew's formation, the vamp;
//   6. the crew's talk (beats.json summaries: "talk", since Oct 31): sung as written, each said to the crewmate it
//      names (the staged event's `to`), the gap answers in-world reactions, never to the viewers.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { teamVoice, baseForm, isFirstPerson, isTeamVoice, pluralize, sungSummary, TALK } from './src/team-voice.js';
import {
  answerOf, pairConsultations, fallbackAnswer, scoreMakingOf, MakingOfScore, gestureOf, pickupOf, shapeByChord, stanzaStart,
  crewFormation, CREW, SEALS, MAKING_OF_TEMPO, TUNE_TEMPO, HALVES, addresseeOf, INTERJECTIONS, QUESTION_REPLIES,
  MAX_LAG, LEAD, LOOKAHEAD, WARM, REFRAIN_CALL, REFRAIN_LINES, refrainLines, FILLER_FACTS, FILLER_CALLS, fillerLines, CrewSets, crewSetsOf, HOLD, ASKS, RESOLVES, MAX_OPEN, SHORT_LINE,
  WARM_VAMPS, WARM_BARS, warmAt, HOOK_CHANGES, goRound,
} from './src/making-of-score.js';
import { scoreReadout, readoutHtml } from './src/chord-readout.js';
import { PROGRESSION_SETS, chordsOf, chordName, fitRomans, isCadenceSection, progressionSetOf, BEATS_PER_BAR } from './src/song/form.js';
import { threadsOf, blockOf, MOVES, PARTS, partSet, canonicalOrder, OPTIONAL } from './src/consultation.js';
import { tuneNotes, tuneBars } from './src/song/tunes.js';
import { TAIL_DIP_DB, TAIL_END_DB } from './src/song/mix.js';
import { syllabify } from './src/mv/voice/syllables.js';
import { voiceRange, chordFromRoman } from './src/mv/music/theory.js';
import { NAMES, AGENT_BOT } from './src/gen/cast.js';
import { Player, parseNdjson } from './src/player.js';
import { modernBundle } from './src/cast16.js';
import { CARD_LEAD } from './src/sing-plan.js';
import { resolveAction } from './src/actions.js';
import { writtenTimes } from './src/activity-lines.js';

globalThis.window ??= {};
const { vampOf, timelineOf, progressHtml } = await import('./src/making-of.js');
const root = new URL('../episodes/', import.meta.url);
// the parade bundle as the director wrote it on Oct 29 (third-person summaries, no answers fields): the older form
const loadFixture = (name) => ({
  events: parseNdjson(readFileSync(new URL(`./fixtures/${name}-events.ndjson`, import.meta.url), 'utf8')),
  beats: modernBundle(JSON.parse(readFileSync(new URL(`./fixtures/${name}-beats.json`, import.meta.url), 'utf8'))),
});
const loadOld = () => ({
  events: parseNdjson(readFileSync(new URL('./fixtures/parade-oct29-events.ndjson', import.meta.url), 'utf8')),
  beats: modernBundle(JSON.parse(readFileSync(new URL('./fixtures/parade-oct29-beats.json', import.meta.url), 'utf8'))),
});
const load = (slug) => ({
  events: parseNdjson(readFileSync(new URL(`${slug}/events.ndjson`, root), 'utf8')),
  beats: modernBundle(JSON.parse(readFileSync(new URL(`${slug}/beats.json`, root), 'utf8'))),
  // the production's activity log, when it was recorded (scripts/director/activity.js; test-activity.mjs)
  activity: existsSync(new URL(`${slug}/activity.ndjson`, root)) ? readFileSync(new URL(`${slug}/activity.ndjson`, root), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : null,
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
  // a bundle whose consultations are move threads (every curated bundle since Oct 31): an answer move's `answers` names
  // its own thread's question (or follow-up), and the threads sing them (making-of-score threadMove), never the pairing
  {
    const { events, beats } = load('hackathon-win');
    assert.equal(beats.consultations, 'moves');
    const threads = threadsOf(events);
    assert.ok(threads.size >= 8, `${threads.size} consultations`);
    const bySeq = new Map(events.map((e) => [e.seq, e]));
    const flagged = events.filter((e) => e.move && Number.isInteger(e.answers));
    assert.ok(flagged.length >= 8, `${flagged.length} answer moves say what they answer`);
    for (const a of flagged) {
      const q = bySeq.get(a.answers);
      assert.ok(q && q.seq < a.seq && q.thread === a.thread && ['question', 'followup'].includes(q.move), `#${a.seq} answers #${a.answers}, a question of its thread ${a.thread}`);
    }
    assert.equal(pairConsultations(events).size, events.filter((e) => !e.move && e.status === 'consulting' && e.consult?.length).length, 'only the plain consultations are paired one by one');
  }
  // a bundle with `answers` on plain events (the director's Oct 30-31, before the move threads; hackathon-oct30, frozen):
  // each consultation's answer says so, however late
  const { events } = loadFixture('hackathon-oct30');
  const pairs = pairConsultations(events);
  // every answers field pairs its consultation; a question nobody flagged an answer to may take the asked bot's next event
  for (const a of events.filter((e) => Number.isInteger(e.answers))) assert.equal(pairs.get(a.answers)?.seq, a.seq, `#${a.seq} answers #${a.answers}`);
  for (const [q, a] of pairs) if (!Number.isInteger(a.answers)) assert.ok(!events.some((e) => e.answers === q), `#${q} has a flagged answer`);
  assert.ok(pairs.size >= 4 && [...pairs.values()].filter((a) => a.answers !== undefined).length >= pairs.size - 1);
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
const pc = (m) => ((m % 12) + 12) % 12;
const wallOf = (slug) => { try { return JSON.parse(readFileSync(new URL(`${slug}/director.json`, root), 'utf8')).wallSeconds; } catch { return null; } };
const firstLines = (events) => { const out = new Set(), seen = new Set(), texts = new Set();
  for (const e of events) { if (!e.lyric) continue; const k = e.lyric.toLowerCase().replace(/>>.*$/, '').replace(/[^a-z ]/g, '').trim(); if (texts.has(k)) continue; texts.add(k); if (!seen.has(e.beat)) { seen.add(e.beat); out.add(e.seq); } }
  return out; };
const checkScore = (slug, s, events, activity = null) => {
  const why = (m) => `${slug}: ${m}`;
  // when each event was written (a queued one: when it was sent, from the activity log; else when it landed)
  const written = activity ? writtenTimes(activity, events) : new Map();
  const wrote = (e) => Math.min(e.t, written.get(e.seq) ?? Infinity);
  // (and when the score took it in: a beat's first event when it landed, to open its section)
  const heard = (e) => Math.min(e.t, s.written?.get(e.seq) ?? Infinity);
  const byseq = new Map(events.map((e) => [e.seq, e]));
  const items = s.items;
  const G = s.bar; // a bar of the groove (one chord, four beats)
  const prod = s.production ?? Math.max(...events.map((e) => e.t));
  const kinds = new Set(['thought', 'line', 'question', 'answer', 'gesture', 'refrain', 'filler', 'activity']);
  assert.ok(items.every((i) => kinds.has(i.kind) && i.t1 > i.t0 && i.t0 >= 0 && i.text && i.bot), why('items'));
  assert.ok(Math.abs(G - BEATS_PER_BAR * 60 / MAKING_OF_TEMPO) < 1e-9 && BEATS_PER_BAR === 6 && HALVES === 1 && TUNE_TEMPO === MAKING_OF_TEMPO, why('a tune bar is a bar of the groove'));

  // the loading bar: as long as the production took, never shorter; longer only by the consultations and first lines
  // still to sing when it ended (a busy last minute), never padded: it ends within RING + a bar of the last of them
  assert.ok(s.end >= prod - 1e-6, why(`${s.end.toFixed(1)} s, shorter than the production's ${prod} s`));
  const firsts = firstLines(events);
  const essential = (i) => i.essential || i.kind === 'gesture';
  assert.ok(items.filter((i) => i.kind === 'line' && firsts.has(i.seq)).every((i) => i.essential) && items.filter((i) => ['question', 'answer'].includes(i.kind)).every((i) => i.essential), why('the duets and first lines always sung'));
  const after = items.filter((i) => i.t0 > prod + G);
  assert.ok(after.every(essential), why(`after the production ended only what had to be sung: ${after.filter((i) => !essential(i)).map((i) => `${i.kind} "${i.text}"`).slice(0, 3)}`));
  const lastEssential = Math.max(prod, ...items.filter((i) => i.t1 > prod).map((i) => i.t1)); // (what was still being sung when it ended)
  assert.ok(s.end <= lastEssential + 3 * G + 1e-6, why(`${s.end.toFixed(1)} s, padded past ${lastEssential.toFixed(1)}`));

  // never before its time: each sung event's voice (and its card) after the event was written; a question when its
  // answer is there (the duet), a side remark (a thought, Green's other lines) within MAX_LAG (+ a bar of grid) of it
  for (const i of items) {
    if (!['thought', 'line', 'answer', 'question'].includes(i.kind)) continue;
    const e = byseq.get(i.kind === 'question' && !i.move ? i.consultSeq : i.seq);
    if (!e) continue;
    assert.ok(i.t0 >= wrote(e) - 1e-6, why(`#${e.seq} "${i.text}" sung at ${i.t0} before it was written (${wrote(e)})`));
    if (!i.essential) assert.ok(i.t0 - heard(e) <= MAX_LAG + G + 1e-6, why(`#${e.seq} "${i.text}" sung ${(i.t0 - heard(e)).toFixed(1)} s late`));
  }
  for (const ev of s.staged) {
    const e = byseq.get(ev.src);
    if (e && ['thought', 'line', 'answer', 'aside'].includes(ev.kind)) assert.ok(ev.t >= wrote(e) - 1e-6, why(`#${e.seq} staged at ${ev.t} before ${wrote(e)}`));
  }
  // an aside: a remark there was no time for, shown (not sung) when it arrives, one at a time
  for (const a of s.asides) {
    const e = byseq.get(a.seq);
    assert.ok(e && a.t >= wrote(e) - 1e-6 && !items.some((i) => i.seq === a.seq && ['thought', 'line'].includes(i.kind)), why(`aside #${a.seq}`));
  }
  // (a consultation's lines on the banner in their place in its conversation, 1.5 s apart at least; the side remarks 3 s)
  const shownAt = [...s.asides].sort((a, b) => a.t - b.t);
  const cards = shownAt.filter((a) => byseq.get(a.seq)?.move), sides = shownAt.filter((a) => !byseq.get(a.seq)?.move);
  assert.ok(cards.every((a, i) => i === 0 || a.t - cards[i - 1].t >= 1.5 - 1e-6), why('a consultation\'s lines one at a time'));
  assert.ok(sides.every((a, i) => i === 0 || a.t - sides[i - 1].t >= 3 - 1e-6), why('side remarks one at a time'));
  // ... and each consultation's in the order of its moves, with its sung lines
  // (a line on the banner shows after the sung line before it starts and before the sung line after it ends, or a
  // couple of cards' steps after when the banner is busy (never a minute on, as in the side remarks' queue): those
  // before a block's first sung line, with it)
  for (const [id] of threadsOf(events)) {
    // (in the order the conversation is sung: canonicalOrder, the host's ok right after the ask)
    const seqs = canonicalOrder(events.filter((e) => e.thread === id)).map((e) => e.seq);
    const sungOf = (q) => items.find((i) => i.seq === q && i.thread === id);
    seqs.forEach((q, k) => {
      const card = shownAt.find((a) => a.seq === q);
      if (!card) return;
      const before = seqs.slice(0, k).map(sungOf).filter(Boolean).at(-1), after = seqs.slice(k + 1).map(sungOf).find(Boolean);
      // (the block's: a sung line of a later block is minutes on)
      const near = (i) => i && Math.abs(i.t0 - card.t) < 30;
      assert.ok((!near(before) || card.t >= before.t0 - 0.5) && (!near(after) || card.t <= after.t1 + 3), why(`${id} #${q} on the banner at ${card.t.toFixed(1)}, between its neighbours (${before?.t0?.toFixed(1)}, ${after?.t1?.toFixed(1)})`));
    });
  }

  // every consultation is a duet: its question, its answer, the hand play that seals it (on the answer's end or
  // after it), one consultSeq
  const consults = events.filter((e) => !e.move && e.status === 'consulting' && e.consult?.length);
  for (const q of consults) {
    const of = items.filter((i) => i.consultSeq === q.seq);
    assert.ok(of.some((i) => i.kind === 'question' && i.bot === q.bot), why(`#${q.seq} asked`));
    const a = of.find((i) => i.kind === 'answer');
    assert.ok(a && a.bot !== q.bot, why(`#${q.seq} answered`));
    const g = of.find((i) => i.kind === 'gesture');
    assert.ok(g && SEALS.some((x) => x.play === g.text) && g.t1 >= a.t1 - 0.05 && g.t0 >= a.t0, why(`#${q.seq} sealed with the answer`));
  }
  // a consultation (consultation.js threads) is a little song of its parts: every move sung once by its bot, in its
  // order (the blocks as they came: the opening and the reply, the follow-up, the closing; the moves in canonical
  // order in each), each part's progression one of its function set's, a question ending open (V, up to so), an
  // answer resolving (V7 -> I, home to do), the thanks sealed by a hand play after it
  const threads = threadsOf(events);
  const lineOf = new Map(s.lines.filter((l) => l.item).map((l) => [l.item, l]));
  let soDo = 0, soDoCan = 0;
  for (const th of threads.values()) {
    const its = items.filter((i) => i.thread === th.id && i.move).sort((x, y) => x.t0 - y.t0);
    // (sung once, or, a block sung late, an optional line shown on the card: the making-of keeps up with the production)
    // (or, the host's yes written only with its reply, after the conversation had gone on: let go, `dropped`)
    const shownMoves = new Set([...s.asides, ...(s.dropped ?? [])].filter((a) => th.events.some((e) => e.seq === a.seq)).map((a) => a.seq));
    assert.deepEqual([...its.map((i) => i.seq), ...shownMoves].sort((x, y) => x - y), th.events.map((e) => e.seq), why(`${th.id}: every move sung once or shown`));
    assert.ok([...shownMoves].every((q) => OPTIONAL.has(byseq.get(q).move)), why(`${th.id}: every ask, question, answer, follow-up, agree and thanks sung`));
    assert.ok((s.dropped ?? []).filter((d) => th.events.some((e) => e.seq === d.seq)).every((d) => d.move === 'ok'), why(`${th.id}: only a late ok let go`));
    assert.ok(its.every((i) => i.bot === byseq.get(i.seq).bot && i.move === byseq.get(i.seq).move), why(`${th.id}: each by its bot`));
    // (in the conversation's order: ask, ok, context, question, ack, reasoning, answer, follow-up, agree, thanks)
    const rank = (i) => MOVES.indexOf(i.move);
    assert.ok(its.every((i, k) => k === 0 || rank(i) >= rank(its[k - 1])), why(`${th.id}: in order: ${its.map((i) => i.move)}`));
    // the host takes every question right after it is asked (Nov 1, the owner: "it's rude that the bots don't
    // acknowledge the question right after it's asked"): the next phrase after the asker's last question (and after
    // a follow-up) is the host's, sung: its own ack, its answer, or a hold line ("Let me think on the glow, Blue")
    const all = items.filter((i) => i.kind !== 'gesture').sort((x, y) => x.t0 - y.t0);
    const mine = all.filter((i) => i.thread === th.id);
    for (const q of mine.filter((i, k) => ['question', 'followup'].includes(i.move) && mine[k + 1]?.move !== i.move)) {
      const nx = all[all.indexOf(q) + 1];
      assert.ok(nx && nx.thread === th.id && nx.bot === th.host && (nx.cue === 'hold' || nx.cue === 'keep' || ['ack', 'reasoning', 'answer', 'followup-answer'].includes(nx.move)),
        why(`${th.id} "${q.text}": acknowledged right after (${nx?.thread} ${nx?.bot} ${nx?.move ?? nx?.cue} "${nx?.text}")`));
      // (on the next bar line: a long question's last bar may be a rest)
      assert.ok(nx.t0 - q.t1 < s.bar + 1.5, why(`${th.id}: the acknowledgement ${(nx.t0 - q.t1).toFixed(1)} s after the question`));
      if (q.move === 'question' && nx.cue !== 'hold' && nx.cue !== 'keep') assert.equal(nx.move, 'ack', why(`${th.id}: its own ack, sung`));
    }
    // a hold never dangles (Nov 1: hackathon-win's c10 ended on "Hmm, let me think on that, Yellow"): every thread ends
    // on its thanks (or, its answer never written, the production over: the host keeps what there is, the asker thanks
    // it), sealed by a hand play
    const said = mine.filter((i) => i.kind !== 'gesture');
    const endLine = said.at(-1);
    assert.ok(endLine && endLine.cue !== 'hold' && (endLine.move === 'thanks' || endLine.cue === 'close'), why(`${th.id} ends on its thanks, not "${endLine?.text}" (${endLine?.move ?? endLine?.cue})`));
    for (const h of said.filter((i) => i.cue === 'hold')) {
      assert.ok(said.some((i) => i.t0 > h.t0 && i.bot === th.host && (i.cue === 'recall' || i.cue === 'keep' || ['ack', 'reasoning', 'answer', 'followup-answer'].includes(i.move))), why(`${th.id}: the host comes back after "${h.text}"`));
    }
    assert.ok(items.some((i) => i.kind === 'gesture' && i.consultSeq === th.events[0].seq && i.t0 >= endLine.t0 - 0.05), why(`${th.id}: sealed by a hand play`));
    // a hold line says it comes back to it; the answer to a held question comes back to it: a recall first when
    // other talk came between (it names the asker, and carries the question for the caption), never a bare answer
    for (const h of mine.filter((i) => i.cue === 'hold')) {
      assert.ok(/think|back to you/i.test(h.text) && h.text.includes(th.asker), why(`${th.id} hold "${h.text}"`));
      const back = mine.find((i) => i.t0 > h.t0 && i.bot === th.host);
      if (!back) continue;
      const between = all.filter((i) => i.t0 > h.t1 && i.t0 < back.t0 && i.thread !== th.id);
      if (between.length) {
        assert.equal(back.cue, 'recall', why(`${th.id}: back to the held question after ${between.length} other phrases with a recall ("${back.text}")`));
        assert.ok(new RegExp(`\\b${th.asker}\\b`).test(back.text), why(`${th.id} recall "${back.text}" names ${th.asker}`));
        const ev = s.staged.find((e) => e.seq === s.lines.find((l) => l.item === back)?.seq);
        assert.ok(ev?.about?.text && ev.about.bot === th.asker, why(`${th.id}: the recall carries the question for the caption`));
      }
    }
    for (const r of mine.filter((i) => i.cue === 'recall' || i.cue === 'resume')) {
      const prev = mine.filter((i) => i.t0 < r.t0).at(-1);
      assert.ok(prev, why(`${th.id}: a recall comes back to something`));
      assert.ok(all.some((i) => i.t0 > prev.t1 - 0.05 && i.t0 < r.t0 && i.thread !== th.id) || r.t0 - prev.t1 >= 12 - 1e-6, why(`${th.id}: "${r.text}" after other talk`));
    }
    const parts = s.consultParts.filter((p) => p.thread === th.id);
    const prank = (p) => p.block * 100 + PARTS.findIndex((x) => x.part === p.part);
    assert.ok(parts.length && parts.every((p, k) => k === 0 || prank(p) > prank(parts[k - 1])), why(`${th.id}: its parts in order: ${parts.map((p) => p.part)}`));
    for (const p of parts) {
      const def = PARTS.find((x) => x.part === p.part);
      assert.ok(p.set === partSet(def, s.beats?.tags ?? {}) && PROGRESSION_SETS[p.set].includes(p.prog), why(`${th.id} ${p.part}: ${p.prog} of ${p.set}`));
      assert.equal(p.romans.length, p.to - p.from);
      if (p.cadence && p.romans.length >= 2) assert.deepEqual(p.romans.slice(-2), ['V7', 'I'], why(`${th.id} ${p.part} ends V7 -> I`));
    }
    for (const i of its) {
      const l = lineOf.get(i);
      const last = l.notesTb.at(-1), lb = Math.floor(last.tb / BEATS_PER_BAR + 1e-6);
      if (ASKS.has(i.move)) { assert.equal(s.romanAt(lb), 'V', why(`${th.id} "${i.text}" ends open on V`)); soDoCan++; if (pc(last.midi) === 7) soDo++; }
      if (RESOLVES.has(i.move)) {
        assert.equal(s.romanAt(lb), 'I', why(`${th.id} "${i.text}" resolves to I`));
        if (l.bars >= 2) assert.equal(s.romanAt(lb - 1), 'V7', why(`${th.id} "${i.text}": V7 -> I`));
        soDoCan++; if (pc(last.midi) === 0) soDo++;
      }
    }
    const thanks = its.find((i) => i.move === 'thanks');
    if (thanks) assert.ok(items.some((g) => g.kind === 'gesture' && g.consultSeq === th.events[0].seq && SEALS.some((x) => x.play === g.text) && g.t0 >= thanks.t0 - 1e-6), why(`${th.id} sealed after the thanks`));
    // the staging: the asker goes over to the host for each block, the scene lasts until the block's end
    const st = s.staged.filter((e) => e.thread === th.id && (e.move || e.cue) && e.kind !== 'aside');
    assert.ok(st.every((e) => e.duet && e.duet.until > 0 && e.status === 'consulting'), why(`${th.id} staged as a duet`));
  }
  if (soDoCan) assert.ok(soDo >= 0.9 * soDoCan, why(`${soDo} of ${soDoCan} questions end on so, answers on do`));
  const seals = items.filter((i) => i.kind === 'gesture').map((i) => i.text);
  assert.ok(seals.every((x, i) => i === 0 || x !== seals[i - 1]), why(`the seals vary: ${seals}`));
  // every event is sung, a remark shown, or (an answer) sung in its duet
  const sung = new Set(items.map((i) => i.seq));
  const paired = new Set([...pairConsultations(events).values()].map((a) => a.seq));
  // (or let go: a side remark with no room on the banner between the consultations, a late ok)
  const shown = new Set([...s.asides, ...(s.dropped ?? [])].map((a) => a.seq));
  for (const e of events.filter((x) => !x.lyric)) assert.ok(sung.has(e.seq) || paired.has(e.seq) || shown.has(e.seq), why(`#${e.seq} (${e.bot}) neither sung nor shown`));
  for (const i of items.filter((x) => x.kind === 'thought')) {
    const e = byseq.get(i.seq);
    assert.equal(i.text, sungSummary(e.summary, e.bot, NAMES, s.beats?.summaries), why(`#${i.seq} in the team's voice`));
  }
  // Green's lines: the first new line of every beat, never one the song already has
  const lines = items.filter((i) => i.kind === 'line');
  const texts = lines.map((i) => i.text.toLowerCase().replace(/[^a-z ]/g, ''));
  assert.equal(new Set(texts).size, texts.length, why('no line twice'));
  // (in the crunch at the end, more to sing than time, a late first line is shown instead: its section is opened anyway)
  for (const [beat, seq] of s.firstOfBeat) assert.ok(lines.some((i) => i.seq === seq) || s.asides.some((a) => a.seq === seq && a.t >= prod - 120 && s.sections.some((x) => x.beat === beat)), why(`${beat}: its first new line`));

  // the work song: a hook that returns (the same call on the same rhythm), sung together by three of the crew in
  // the time the production works on with no news (never over the talk)
  const refrains = items.filter((i) => i.kind === 'refrain');
  const calls = refrains.filter((i) => i.text === REFRAIN_CALL);
  // (with the production's real work to sing, the work song is for the real lulls: one at least, 20 s apart)
  assert.ok(calls.length >= (activity ? 1 : 2), why(`${calls.length} work songs`));
  assert.ok(calls.every((c, k) => k === 0 || c.t0 - calls[k - 1].t0 >= 20 - 1e-6), why('the work songs 20 s apart'));
  // the loading bar sung from real work: within 30 s of the production's end
  if (activity && !threads.size) assert.ok(s.end - prod <= 30 + 1e-6, why(`${s.end.toFixed(1)} s for ${prod} s: ${(s.end - prod).toFixed(1)} s over`));
  const shape = (i) => { const l = s.lines.find((x) => x.item === i); return l.job.notes.map((n) => +(n.t - l.job.notes[0].t).toFixed(3)).join(' '); };
  assert.ok(calls.every((i) => shape(i) === shape(calls[0])), why('the call on the same rhythm every time'));
  const choir = s.lines.filter((l) => l.layer === 'words');
  for (const i of refrains) assert.equal(choir.filter((l) => Math.abs(l.at - i.t0) < 1e-6 && l.text === i.text).length, 3, why('three sing it'));

  // the staged events: in time order, each sung one's voice CARD_LEAD after its card; a phrase one note a syllable
  assert.ok(s.staged.every((e, i) => i === 0 || e.t >= s.staged[i - 1].t - 1e-9), why('in order'));
  const plan = new Map(s.lines.map((l) => [l.seq, l]));
  for (const e of s.staged) {
    if (!e.lyric) { assert.ok(['gesture', 'aside'].includes(e.kind), why(e.kind)); continue; }
    const l = plan.get(e.seq);
    assert.ok(l, why(`#${e.seq} has a voice`));
    assert.ok(Math.abs(l.at - e.t - CARD_LEAD) < 1e-3 || e.t === 0, why(`#${e.seq} card lead`));
    assert.equal(l.job.text, e.lyric);
    const { low, high } = voiceRange(l.job.voice);
    assert.ok(l.job.notes.every((n) => n.midi >= low && n.midi <= high && n.dur > 0), why(`"${l.job.text}" in ${l.job.voice}'s range`));
    if (e.part === 'backing') {
      assert.equal(l.layer, 'backing');
      assert.equal(e.singer, e.bot);
      for (const g of l.segments) assert.equal(g.job.notes.length, syllabify(g.job.text).length, why(`"${g.job.text}": a cell a bar`));
      continue;
    }
    assert.equal(l.job.notes.length, syllabify(l.job.text).length, why(`"${l.job.text}": a note a syllable`));
    assert.ok(l.job.notes.every((n, i) => i === 0 || n.t >= l.job.notes[i - 1].t + l.job.notes[i - 1].dur - 1e-6), why('notes one after another'));
    assert.equal(l.layer, e.part ? 'echo' : e.kind === 'refrain' || e.kind === 'filler' ? 'words' : 'story', why(`#${e.seq} on its layer`));
  }
  // one voice at a time: a phrase starts after the last one ends (its pickup sings in the last one's breath), but
  // the seal's word, which both sing together; the work song never over them
  const story = s.lines.filter((l) => l.layer === 'story');
  const solo = story.filter((l) => s.staged.find((e) => e.seq === l.seq)?.kind !== 'seal').sort((a, b) => a.at - b.at);
  const endOf = (l) => l.at + l.job.notes.at(-1).t + l.job.notes.at(-1).dur;
  for (let i = 1; i < solo.length; i++) {
    const p = solo[i - 1];
    assert.ok(solo[i].at >= endOf(p) - 1e-3, why(`"${solo[i].job.text}" starts at ${solo[i].at.toFixed(2)} before "${p.job.text}" ends ${endOf(p).toFixed(2)}`));
  }
  for (const c of choir) assert.ok(!story.some((l) => l.at < endOf(c) - 0.05 && endOf(l) > c.at + 0.05), why(`the work song over a phrase at ${c.at.toFixed(1)}`));
  // on the grid: a phrase enters on a bar line, its first note there or after its pickup (an eighth a syllable), and
  // lasts two bars at least (a consultation's short line may have one, making-of-score SHORT_LINE, only when it keeps
  // the pace below: none of the curated ones does at 144 bpm in 6/4)
  const onBar = (t) => Math.abs(t / G - Math.round(t / G)) < 1e-3;
  for (const l of [...solo, ...choir]) {
    const k = l.job.notes.findIndex((n) => onBar(l.at + n.t));
    assert.ok(k >= 0 && k <= 3, why(`"${l.job.text}" enters on a bar line (note ${k})`));
    assert.ok(l.job.notes.slice(0, k).every((n) => n.t >= l.job.notes[k].t - 2 * s.beat), why('a short pickup'));
    // (since Nov 1 one does: "Where does Black pop in?", Black a crewmate now, "Where does" its name's pickup; the pace
    // below still holds)
    const short = (t) => syllabify(t).length <= SHORT_LINE && l.kind !== 'line';
    assert.ok(l.bars >= 2 || (l.bars === 1 && short(l.job.text)), why(`"${l.job.text}": two bars at least`));
  }

  // sung at the premiere's pace (Oct 31, owner: "squishing too many ideas into one stanza"; v16 sang 2.4-2.9
  // syllables/s): within a phrase no faster than 2 syllables/s (its pickup aside), no syllable shorter than 0.25 s
  const rates = [];
  for (const l of [...solo, ...choir]) {
    const nt = l.notesTb, own = nt.filter((x) => !x.pickup);
    const t = (x) => s.sec(x.tb);
    if (own.length >= 3) {
      const rate = (own.length - 1) / (t(own.at(-1)) - t(own[0])); // (onset to onset: a cut last note aside)
      rates.push(rate);
      assert.ok(rate <= 2.0, why(`"${l.text}": ${rate.toFixed(2)} syllables/s`));
    }
    nt.slice(0, -1).forEach((x, i) => assert.ok(t(nt[i + 1]) - t(x) >= 0.25 - 1e-3, why(`"${l.text}": syllable ${i} ${(t(nt[i + 1]) - t(x)).toFixed(3)} s`)));
  }
  rates.sort((a, b) => a - b);
  assert.ok(rates[rates.length >> 1] <= 1.7, why(`median ${rates[rates.length >> 1].toFixed(2)} syllables/s`));
  // a line of talk is one idea in two bars (eight syllables at most; a longer one four)
  for (const l of solo) assert.ok(l.bars === 2 || (l.bars === 4 && syllabify(l.text).length > 7) || (l.bars === 1 && syllabify(l.text).length <= SHORT_LINE), why(`"${l.text}": ${l.bars} bars`));
  // the crewmate the talk names is heard: when its name is held, on a strong beat (1 or 3) for a beat at least, or
  // (it ends the line) on a beat, held to the line's end
  let named = 0;
  for (const l of solo) {
    if (l.nameAt == null) continue;
    named++;
    // (6/4: a strong beat is beat 1 or 4)
    const x = l.notesTb[l.nameAt], next = l.notesTb[l.nameAt + 1], inBar = x.tb % BEATS_PER_BAR;
    if (next) assert.ok((Math.abs(inBar) < 1e-6 || Math.abs(inBar - BEATS_PER_BAR / 2) < 1e-6) && s.sec(next.tb - x.tb) >= s.beat - 1e-3, why(`"${l.text}": the name at ${inBar} for ${s.sec(next.tb - x.tb).toFixed(2)} s`));
    else assert.ok(Math.abs(inBar % 1) < 1e-6 && s.sec(x.dur) >= 0.59, why(`"${l.text}": the name at the end held ${s.sec(x.dur).toFixed(2)} s`));
  }
  assert.ok(named >= 5 || s.beats?.summaries !== 'talk', why(`${named} names held`));

  // the form: a section a beat, its progression an id of its function set, fitted to the bars its talk took, one
  // chord a bar, the idle bars after it round the progression again (the last: home on I)
  const tl = timelineOf(s);
  assert.equal(tl.sections.length, new Set(events.map((e) => e.beat)).size, why('a section a beat'));
  const tags = s.style.tags;
  tl.sections.forEach((x, i) => {
    assert.equal(x.set, progressionSetOf(x.section, tags), why(`${x.section}: its set`));
    assert.ok(PROGRESSION_SETS[x.set].includes(x.progression), why(`${x.section}: ${x.progression} is of ${x.set}`));
    const last = i === tl.sections.length - 1;
    const fit = x.romans.slice(0, x.fit);
    // (a consultation's part plays its own progression in the bars it takes: checked with its thread above)
    const mine = (k) => !s.over?.has(s.sections[i].start + k);
    const want = fitRomans(chordsOf(x.progression), x.section, x.fit, { final: last });
    fit.forEach((r, k) => { if (mine(k)) assert.equal(r, want[k], why(`${x.section}: its chords (bar ${k})`)); });
    // (the idle bars go round again, each time another way: as written, re-harmonized, its set's next)
    x.romans.slice(x.fit).forEach((r, k) => { if (mine(x.fit + k)) assert.equal(r, last ? 'I' : goRound(x.progression, x.set, Math.floor(k / 8))[k % 8], why(`${x.section}: the idle bars`)); });
    assert.ok(x.bars >= 1 && x.fit >= 2 && Math.abs(x.t1 - x.t0 - x.bars * tl.bar) < 1e-2, why(`${x.section}: ${x.bars} bars`));
    if (i > 0) assert.ok(Math.abs(x.t0 - tl.sections[i - 1].t1) < 1e-3, why('the sections follow each other'));
    // the cadence rules (HANDOFF Part C 3.3), where the section's talk ends (its own bars)
    if (!mine(x.fit - 1) || !mine(x.fit - 2)) return;
    const end2 = fit.slice(-2).join(' ');
    if (isCadenceSection(x.section) || last) assert.equal(end2, 'V7 I', why(`${x.section} ends V7 -> I`));
    else if (x.set === 'intro:scene' || x.set === 'verse:build' || x.set.startsWith('bridge2:')) assert.equal(fit.at(-1), 'V', why(`${x.section}: a half cadence`));
    else if (x.set === 'verse:narrative') assert.equal(fit.at(-1), 'I', why(`${x.section} home`));
    else if (x.set.startsWith('bridge:')) assert.notEqual(fit.at(-1), 'I', why(`${x.section} leans on`));
    if (x.set === 'outro:conclusive' && x.fit >= 3) assert.ok(['ii', 'IV'].includes(fit.at(-3)), why(`${x.section}: the predominant`));
  });
  assert.ok(tl.sections.map((x) => x.section).join(' ').startsWith('intro verse1'), why('the form opens on the intro'));
  assert.ok(tl.sections[0].t0 >= events[0].t, why('the intro begins when its first event is there (before it, the warm-up)'));
  // the chords the vamp plays are the form's, a bar each (the warm-up before), and the home chord rings at the end
  const h = s.halves;
  for (const x of tl.sections) x.romans.forEach((r, k) => assert.equal(h[Math.round(x.t0 / G) + k], chordName(r), why('the vamp')));
  // (the warm-up: its vamps by turns, WARM_BARS each; a work song or a filler sung in it on its own changes)
  for (let b = 0; b < Math.round(tl.sections[0].t0 / G); b++) if (!s.over.has(b)) assert.equal(h[b], chordName(warmAt(b).roman), why('the warm-up'));
  {
    const warm = Math.round(tl.sections[0].t0 / G);
    const vamps = new Set(Array.from({ length: warm }, (_, b) => warmAt(b).name));
    assert.ok(vamps.size >= Math.min(WARM_VAMPS.length, Math.ceil(warm / WARM_BARS)), why(`the warm-up: ${vamps.size} vamps in ${warm} bars`));
  }
  // the work song and the filler: their own changes (HOOK_CHANGES, by turns), the asking line on its first two, the
  // answering line home on I; the readout says what plays (chord-readout.js)
  for (const it of s.items.filter((x) => x.kind === 'refrain' || x.kind === 'filler')) {
    const b0 = Math.floor(it.t0 / G + 1e-6);
    const info = s.chordInfo(b0);
    assert.ok(s.over.has(b0) && info.label.startsWith(it.kind === 'refrain' ? 'work song · ' : 'filler · '), why(`${it.kind} "${it.text}": its own changes (${info.label})`));
    const [, romans] = HOOK_CHANGES[it.kind].find(([name]) => info.label.endsWith(name));
    assert.ok(romans.includes(info.roman), why(`${it.kind}: ${info.roman} of ${romans}`));
  }
  {
    const mid = Math.floor(s.end / 2);
    const r = scoreReadout(s, mid);
    assert.ok(r && r.now.name === s.chordAtBar(Math.floor(mid / G + 1e-6)) && r.label.length > 3 && /<b>/.test(readoutHtml(r)), why(`the readout: ${JSON.stringify(r)}`));
    assert.ok(scoreReadout(s, 0).label.startsWith('warm-up · ') || s.over.has(0), why('the readout: the warm-up'));
  }
  assert.ok(h.length * G >= s.end - 1e-6 && h.at(-1) === 'C', why('the vamp rings home'));
  const v = vampOf(s);
  assert.ok(v.startHalf() === 0 && v.chordAtHalf(2 * 7 + 1) === s.chordAtBar(7) && v.endHalf() === Math.round(s.end / (G / 2)) - 2 && v.halfBeats === 3, why('the vamp: two halves a bar (6/4: two pulses of three beats)'));

  // the tunes: every strong beat (6/4: beats 1 and 4 of a bar, its halves) of a phrase, a work song or a gap answer on a tone of its chord
  const chordAtT = (t) => chordFromRoman(s.romanAt(Math.floor(t / G + 1e-6)), 'C');
  let strong = 0;
  for (const l of s.lines.filter((x) => x.layer !== 'backing')) {
    for (const n of l.job.notes) {
      const t = l.at + n.t, inBar = t / G - Math.floor(t / G + 1e-6);
      if (Math.abs(inBar) > 1e-4 && Math.abs(inBar - 0.5) > 1e-4) continue;
      strong++;
      assert.ok(chordAtT(t).tones.includes(pc(n.midi)), why(`"${l.job.text}" at ${t.toFixed(2)}: ${n.midi} on ${s.romanAt(Math.floor(t / G + 1e-6))}`));
    }
  }
  assert.ok(strong > 150, why(`${strong} strong beats`));
  // a question asks (up to so), its answer and a section's last line go home (to do): so and do themselves when the
  // chord has them, else a chord tone
  const shaped = story.filter((l) => l.shape === 'ask' || l.shape === 'answer');
  let hits = 0, can = 0;
  for (const l of shaped) {
    const last = l.job.notes.at(-1), ch = chordAtT(l.at + last.t);
    const want = l.shape === 'ask' ? 7 : 0;
    if (ch.tones.includes(want)) { can++; if (pc(last.midi) === want) hits++; }
    assert.ok(ch.tones.includes(pc(last.midi)), why(`"${l.job.text}" ends on a chord tone`));
  }
  assert.ok(can >= 8 && hits >= 0.95 * can, why(`${hits} of ${can} lines end on so / do where the chord has it`));
  // (the old one-event duets; a consultation's own lines, hold and recall included, by their moves above)
  const qa = (kind) => s.staged.filter((e) => e.kind === kind && !e.move && !e.cue).map((e) => plan.get(e.seq));
  assert.ok(qa('question').every((l) => l.shape === 'ask') && qa('answer').every((l) => l.shape === 'answer'), why('questions ask, answers answer'));
  // a chorus's and the outro's last line land on the home chord's root (do)
  for (const l of story.filter((x) => x.home)) assert.equal(pc(l.job.notes.at(-1).midi), 0, why(`"${l.job.text}" lands home`));
  assert.ok(story.some((x) => x.home), why('a line lands home'));

  // the backing: in most bars, sung by crew members who do not sing the phrase there, on its chord's tones
  const backing = s.lines.filter((l) => l.layer === 'backing');
  const bars = Math.round(s.end / G);
  const parts = new Map();
  for (const l of backing) {
    assert.ok(CREW.includes(l.bot), why('the crew sings the backing'));
    l.segments.forEach((g) => {
      const b = Math.round((g.at - g.job.notes[0].t) / G);
      const t0 = b * G, t1 = t0 + G;
      parts.set(b, [...(parts.get(b) ?? []), l.bot]);
      for (const n of g.job.notes) assert.ok(chordAtT(g.at + n.t).tones.includes(pc(n.midi)), why(`${l.bot}'s ${l.role} on the chord`));
      for (const o of s.lines.filter((x) => x.layer !== 'backing' && x.bot === l.bot)) {
        assert.ok(o.at >= t1 || endOf(o) <= t0, why(`${l.bot} sings ${l.role} under its own "${o.job.text}"`));
      }
    });
  }
  const withBacking = [...parts.keys()].filter((b) => parts.get(b).length >= 2).length;
  assert.ok(withBacking >= 0.85 * bars, why(`backing in ${withBacking} of ${bars} bars`));
  for (const [, who] of parts) assert.equal(new Set(who).size, who.length, why('one part a singer'));
  // the mix: the backing well under the words, dipping under them; the gap answers under the phrases too
  assert.ok(backing.every((l) => l.db <= -15), why('the backing under the words'));
  assert.ok(backing.filter((l) => l.lift?.some(([, d]) => d < 0)).length >= 0.5 * backing.length, why('the backing dips under the words'));
  const echoes = s.lines.filter((l) => l.layer === 'echo');
  assert.ok(echoes.length >= 1 && echoes.every((l) => l.db < 0 && l.job.notes.length <= 2), why(`${echoes.length} gap answers`));
  // the last syllable of a phrase rings on under the gap answer (owner, Nov 4: "extend the last syllable of each line; it's fine for
  // them to overlap with the Echo"): not cut at beat 3 as it was, so most answers start while it still sounds
  {
    const asked = (e) => solo.filter((l) => l.at < e.at).at(-1);
    const under = echoes.filter((e) => { const p = asked(e); return p && endOf(p) > e.at + 0.05; }).length;
    assert.ok(under >= 0.8 * echoes.length, why(`${under} of ${echoes.length} gap answers sung under the last syllable of their phrase`));
    const dipped = story.filter((l) => l.lift).length;
    assert.ok(dipped >= 0.8 * under && dipped <= echoes.length, why(`${dipped} phrases sink under their gap answer (${under} overlap)`));
  }
  // (a phrase's last syllable sinks under the gap answer that sings over it, TAIL_DIP_DB, dying away to TAIL_END_DB, and is otherwise untouched)
  assert.ok(story.every((l) => (!l.lift || (l.lift.length === 3 && l.lift[0][1] === 0 && l.lift[1][1] === TAIL_DIP_DB && l.lift[2][1] === TAIL_END_DB)) && (l.db ?? 0) >= -3), why('the phrases on top'));

  // the loading bar: monotone, the beats in the order they arrived, full when the production ends
  let last = { k: 0, frac: 0 };
  for (let t = 0; t <= s.end; t += 0.5) {
    const p = s.progressAt(t);
    assert.ok(p.k >= last.k && p.frac >= last.frac - 1e-9 && p.frac >= 0 && p.frac <= 1, why(`progress at ${t}`));
    last = p;
  }
  assert.equal(s.progressAt(prod).frac, 1, why('full at the end'));
  assert.ok(s.progressAt(0).planning && s.progressAt(prod).k === tl.sections.length, why('from planning to the last beat'));
  return s;
};
// the stats the report quotes: syllables/s within phrases, how long it lasts against the production
const statsOf = (s) => {
  const rs = s.lines.filter((l) => l.layer === 'story' && l.job).map((l) => { const own = l.notesTb.filter((x) => !x.pickup); return own.length >= 3 ? (own.length - 1) / s.sec(own.at(-1).tb - own[0].tb) : null; }).filter(Boolean).sort((a, b) => a - b);
  return `${s.end.toFixed(0)} s for ${s.production?.toFixed(0)} s, ${rs[rs.length >> 1].toFixed(2)} syll/s`;
};

const hw = loadFixture('hackathon-oct30'); // frozen: the checks below name its events
// every curated episode's making-of (the sample: a few events, no making-of to speak of)
const lengths = [];
for (const slug of readdirSync(root).filter((d) => d !== 'sample' && existsSync(new URL(`${d}/events.ndjson`, root)) && existsSync(new URL(`${d}/beats.json`, root)))) {
  const b = load(slug);
  const s = checkScore(slug, scoreMakingOf(b.events, b.beats, { production: wallOf(slug), activity: b.activity }), b.events, b.activity);
  lengths.push(`${slug} ${statsOf(s)}${b.activity ? ` (+${(s.end - s.production).toFixed(0)} s, ${s.items.filter((i) => i.kind === 'activity').length} lines of real work)` : ''}`);
}
// a real production with its consultations as conversations (Muse Code, Oct 31: fourteen consultations, ask to thanks, six with a follow-up):
// the checks above (the loading bar, the real-time rule, every move sung once in its order, the parts' function sets
// and cadences, the seals), and the stats the report quotes
const CONSULT_WALL = { 'hackathon-consult-oct31': 589.8 };
for (const [name, wall] of Object.entries(CONSULT_WALL)) {
  const b = loadFixture(name);
  const activity = readFileSync(new URL(`./fixtures/${name}-activity.ndjson`, import.meta.url), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const s = checkScore(name, scoreMakingOf(b.events, b.beats, { production: wall, activity }), b.events, activity);
  const ths = [...threadsOf(b.events).values()];
  assert.ok(ths.length >= 8 && ths.every((t) => t.complete), `${name}: ${ths.length} consultations, all complete`);
  // each consultation spans its parts (at least the pickup, the context, the question, the reasoning, the answer and
  // the outro), several progressions: more than one stanza
  for (const t of ths) {
    const parts = new Set(s.consultParts.filter((p) => p.thread === t.id).map((p) => p.part));
    for (const p of ['pickup', 'question', 'answer', 'outro']) assert.ok(parts.has(p), `${name} ${t.id}: its ${p}`);
  }
  // (the context and the reasoning are sung while the making-of keeps up, shown on the card when it runs behind)
  for (const p of ['context', 'reasoning']) assert.ok(s.consultParts.some((x) => x.part === p), `${name}: some ${p} sung`);
  // the loading bar: it runs longer than the production (Nov 1: each consultation whole, its first context, the
  // host's acknowledgement and its first reasoning sung: v19 ended 68 s after it, with every acknowledgement only on
  // the card and the answers minutes after their questions), within about four minutes
  assert.ok(s.end - wall <= 260, `${name}: ${s.end.toFixed(0)} s for ${wall} s`);
  // the consultations one at a time (the owner: "barrages of different questions that get answered waaaay after it
  // was asked"): at most MAX_OPEN questions on hold at once, each answer sung within half a minute of its question
  // or after a recall of it
  const its = s.items.filter((i) => i.thread).sort((x, y) => x.t0 - y.t0);
  let open = 0, most = 0;
  for (const t of ths) {
    const q = its.filter((i) => i.thread === t.id && i.move === 'question').at(-1), a = its.find((i) => i.thread === t.id && i.move === 'answer');
    assert.ok(q && a, `${name} ${t.id}: asked and answered`);
    const recalled = its.some((i) => i.thread === t.id && i.cue === 'recall' && i.t0 > q.t0 && i.t0 < a.t0);
    assert.ok(a.t0 - q.t0 <= 30 || recalled, `${name} ${t.id}: answered ${(a.t0 - q.t0).toFixed(0)} s after its question, no recall`);
  }
  for (const i of its) {
    if (i.cue === 'hold') open++;
    if (i.cue === 'recall') open--;
    most = Math.max(most, open);
  }
  assert.ok(most <= MAX_OPEN, `${name}: ${most} questions on hold at once`);
  // the old one-line pairing leaves the moves alone (they are sung by their threads)
  assert.equal([...pairConsultations(b.events).keys()].length, 0, `${name}: no move paired as a one-line question`);
  lengths.push(`${name} ${statsOf(s)} (+${(s.end - s.production).toFixed(0)} s: ${ths.length} consultations, ${s.items.filter((i) => i.thread).length} lines of them)`);
}
const score = checkScore('hackathon-win', scoreMakingOf(hw.events, hw.beats), hw.events);
{
  const it = score.items;
  // a late answer (White answers Gold 27 events on) is sung in the duet when it comes, right after the question,
  // not again later
  const late = it.filter((i) => i.consultSeq === 28);
  assert.deepEqual(late.map((i) => [i.kind, i.bot]), [['question', 'Gold'], ['answer', 'White'], ['gesture', 'Gold']]);
  assert.equal(late[1].text, teamVoice(hw.events.find((e) => e.seq === 55).summary, 'White', NAMES), 'an "I" summary is sung in the team voice, "we"');
  assert.equal(it.filter((i) => i.seq === 55).length, 1, 'the answer is sung once');
  assert.ok(late[0].t0 >= hw.events.find((e) => e.seq === 55).t, 'asked when its answer is there');
  // the warm-up: the crew's work song while the director plans (nothing of theirs is there yet), then the first
  // thought on the grid after it was written
  const thoughts = it.filter((i) => i.kind === 'thought');
  assert.equal(thoughts[0].text, 'We set a cozy key for the street');
  const e0 = hw.events.find((e) => e.seq === thoughts[0].seq);
  assert.ok(thoughts[0].t0 >= e0.t && thoughts[0].t0 < e0.t + LEAD + 2 * score.bar, `the first thought at ${thoughts[0].t0} (written ${e0.t})`);
  assert.ok(it.filter((i) => i.kind === 'refrain' && i.t1 <= e0.t).length >= 4, 'the work song while the director plans');
  // the gestures: thinking (by role) where the event's action is no hand play, never the same bot twice in a row too soon
  const gest = score.staged.filter((e) => e.gesture);
  assert.ok(gest.length >= 10, `${gest.length} gestures`);
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
  // both sing the seal word, unless the duet came late (the production went on): then the hand play alone, in the
  // answer's last bar
  const words = score.staged.filter((e) => e.kind === 'seal');
  const plays = score.items.filter((i) => i.kind === 'gesture');
  assert.ok(words.length % 2 === 0 && words.length >= plays.length, `${words.length / 2} of ${plays.length} seals sung`);
  // the timeline for the trailer
  const tl = timelineOf(score);
  assert.equal(tl.items.length, score.items.length);
  assert.ok(tl.end === +score.end.toFixed(3) && tl.tempo === MAKING_OF_TEMPO);
  assert.ok(tl.progress.beats.length === tl.sections.length && tl.asides.length === score.asides.length);
  // the banner's loading bar: the beat the crew is on, a bar filling with the production's time
  const ph = progressHtml(score.progressAt(score.production / 2), hw.beats.beats);
  assert.match(ph, /width:50%/);
  assert.match(ph, /beat \d+\/11 \w+/);
  assert.match(progressHtml(score.progressAt(0)), /planning/);
  assert.match(progressHtml(score.progressAt(score.production + 1)), /width:100%.*last lines/);
  // the vamp: open while live, its home chord at the end once closed
  const v = vampOf(score);
  assert.equal(v.endHalf(), Math.round(score.end / (score.bar / 2)) - 2); // (a half bar: a pulse)
  assert.equal(vampOf(new MakingOfScore({ live: true })).endHalf(), null);
  // the work song's lines: its call, then its own line or (every other time) the episode's hook
  assert.deepEqual(refrainLines(0, 'Big hackathon win!'), [REFRAIN_CALL, REFRAIN_LINES[0]]);
  assert.deepEqual(refrainLines(1, 'Big hackathon win!'), [REFRAIN_CALL, 'Big hackathon win!']);
  assert.deepEqual(refrainLines(1, 'A hook far too long to be sung in two short bars'), [REFRAIN_CALL, REFRAIN_LINES[0]]);
  for (const t of [REFRAIN_CALL, ...REFRAIN_LINES]) assert.ok(!/everyone|folks|you all|watch|audience/i.test(t) && syllabify(t).length <= 8, t);
}

// two more bundles: toy-box as re-directed (first person, answers), the Oct 29 parade (third person, no answers)
for (const slug of ['toy-box', 'parade']) {
  const b = slug === 'parade' ? loadOld() : load(slug);
  const s = checkScore(slug, scoreMakingOf(b.events, b.beats, { production: slug === 'parade' ? null : wallOf(slug), activity: b.activity }), b.events, b.activity);
  if (slug !== 'parade') continue;
  // the chain: Gray answers Yellow and asks him back (one phrase, both), Yellow answers; she comes over (visit in)
  const fr = s.items.filter((i) => i.seq === 65 && i.kind !== 'gesture');
  assert.deepEqual(fr.map((i) => i.kind).sort(), ['answer', 'question']);
  assert.equal(fr[0].t0, fr[1].t0, 'the answer that asks is one phrase');
  const a67 = s.staged.find((e) => e.kind === 'answer' && e.src === 67);
  assert.equal(s.items.find((i) => i.kind === 'answer' && i.consultSeq === 65).bot, a67.bot);
  assert.equal(a67.duet.visit, 'in');
}

// a production with time to spare (the events spread out): everything is sung, nothing aside, and the making-of
// ends within two bars of the production's end
{
  const E = (seq, t, bot, beat, summary, extra = {}) => ({ seq, t, agent: 'x', bot, status: 'working', beat, summary, lyric: '', chords: [], action: '', consult: [], ...extra });
  const evs = [
    E(0, 20, 'White', 'beat-1-intro', 'Green, I set a cozy key'), E(1, 40, 'Gray', 'beat-1-intro', 'Stepping in soft, mind that glow'),
    E(2, 60, 'Gold', 'beat-2-verse1', 'White, is our song over budget?', { status: 'consulting', consult: ['White'] }),
    E(3, 61, 'White', 'beat-2-verse1', 'Soup and smiles pay our way, Gold', { answers: 2 }),
    E(4, 62, 'Green', 'beat-2-verse1', 'A line', { status: 'proposing', lyric: 'We sing it all night >> Yeah!' }),
    E(5, 100, 'Blue', 'beat-3-chorus1', 'Cold night glows soft blue'),
    E(6, 120, 'Green', 'beat-3-chorus1', 'A line', { status: 'proposing', lyric: 'Big win tonight >> Hooray!' }),
  ];
  const s = scoreMakingOf(evs, null, { production: 150 });
  assert.equal(s.asides.length, 0, 'time to spare: nothing aside');
  assert.ok(s.end >= 150 && s.end <= 150 + 2 * s.bar + 1e-6, `as long as the production: ${s.end} s for 150`);
  for (const e of evs) {
    const i = s.items.find((x) => x.seq === e.seq || (x.kind === 'question' && x.consultSeq === e.seq));
    assert.ok(i && i.t0 >= e.t && i.t0 - e.t <= MAX_LAG, `#${e.seq} at ${i?.t0} for ${e.t}`);
  }
  assert.ok(s.items.filter((i) => i.kind === 'refrain').length >= 4, 'the work song fills the waits');
}

// the tunes themselves: "We" before the bar line; a line's last stanza unit asks or answers by where it starts; the
// chord a line ends on decides how a thought ends (open on V, home on IV / vi); fitted progressions
{
  assert.equal(pickupOf(syllabify('We ask White if the band plays for free')), 1);
  assert.equal(pickupOf(syllabify('Hackathon, hackathon!')), 0, 'a stressed first syllable is no pickup');
  assert.equal(pickupOf(syllabify('We go')), 0, 'three syllables stay after it');
  assert.deepEqual([shapeByChord('V'), shapeByChord('V7'), shapeByChord('IV'), shapeByChord('vi'), shapeByChord('I'), shapeByChord('ii')], ['ask', 'ask', 'answer', 'answer', null, null]);
  for (const [shape, want] of [['ask', 7], ['answer', 0]]) {
    for (const bars of [2, 4]) {
      const n = bars === 2 ? 6 : 12;
      const st = stanzaStart(shape, bars);
      const r = tuneNotes({ melody: 'nursery', syllableCount: n, chords: [...Array(st).fill('I'), ...Array(bars + 1).fill('I')], role: 'lead', voice: 'woman', tempo: TUNE_TEMPO, startBar: st, minBars: 2 });
      assert.equal(r.bars, bars);
      assert.equal(pc(r.notes.at(-1).midi), want, `a ${bars}-bar line that ${shape}s ends on ${want ? 'so' : 'do'}`);
    }
  }
  // talk: eight syllables in two bars (the closing bar holds four), nine in four
  assert.equal(tuneBars('nursery', 8, 2, { talk: true }), 2);
  assert.equal(tuneBars('nursery', 8, 2, { meter: 4 }), 4, '4/4 kept its seven'); // (the premiere in 6/4: eight by pulses, test-song.mjs)
  assert.equal(tuneBars('nursery', 9, 2), 4, 'the premiere in 6/4: eight a two-bar line');
  assert.equal(tuneBars('nursery', 9, 2, { talk: true }), 4);
  // fitted progressions keep their endings at any length
  assert.deepEqual(fitRomans(chordsOf('t-porch'), 'intro', 12), ['I', 'IV', 'I', 'V', 'I', 'IV', 'I', 'V', 'I', 'IV', 'I', 'V']);
  assert.deepEqual(fitRomans(chordsOf('t-cadence-ii'), 'outro', 6), ['I', 'IV', 'I', 'ii', 'V7', 'I']);
  assert.deepEqual(fitRomans(chordsOf('gospel'), 'chorus1', 4), ['I', 'IV', 'V7', 'I']);
  assert.deepEqual(fitRomans(chordsOf('t-build'), 'verse1b', 2), ['ii', 'V']);
  assert.deepEqual(fitRomans(chordsOf('nursery'), 'verse1', 4, { final: true }).slice(-2), ['V7', 'I'], 'the song ends home');
}

// a consultation arriving over time (consultation.js): Pink's opening at 20 s, Blue's reply at 60 s, Pink's closing at
// 90 s. The making-of is the loading bar: each block is sung as soon as it is written (the opening at once: the
// pickup, the context, the question; the reply when it comes: the ok, the acknowledgement, the reasoning, the answer,
// one stretch; the closing, sealed), never before its time; on time, nothing is shown instead of sung; live and
// replay alike
{
  const AG = { Pink: 'comedy', Blue: 'lighting', Yellow: 'hype' };
  const M = (seq, t, bot, move, summary, extra = {}) => ({ seq, t, agent: AG[bot], bot, status: bot === 'Pink' ? 'consulting' : 'working', beat: 'beat-2-verse1', summary, lyric: '', chords: [], action: '', consult: [bot === 'Pink' ? 'Blue' : 'Pink'], move, thread: 'c1', ...extra });
  const evs = [
    { seq: 0, t: 5, agent: 'hype', bot: 'Yellow', status: 'working', beat: 'beat-1-intro', summary: 'What a start, Gray!', lyric: '', chords: [], action: 'cheer', consult: [] },
    M(1, 20, 'Pink', 'ask', 'Hey Blue, got a minute?'), M(2, 20, 'Pink', 'context', 'Green plans a slip on the ice'),
    M(3, 20, 'Pink', 'question', 'Can a light follow me?'),
    { seq: 4, t: 30, agent: 'hype', bot: 'Yellow', status: 'working', beat: 'beat-2-verse1', summary: 'Here comes the slip, Pink!', lyric: '', chords: [], action: 'binoculars', consult: [] },
    M(5, 60, 'Blue', 'ok', 'Sure, what is up?'), M(6, 60, 'Blue', 'ack', 'Ooh, a fun one'), M(7, 60, 'Blue', 'reasoning', 'A spot on the ice is bright'),
    M(8, 60, 'Blue', 'reasoning', 'But it blinds the crowd'), M(9, 60, 'Blue', 'answer', 'So we dim it to amber', { action: 'lights-warm', answers: 3 }),
    M(10, 90, 'Pink', 'agree', 'Amber it is, then'), M(11, 90, 'Pink', 'thanks', 'Thanks, Blue, you are a star!'),
  ];
  // (Nov 1, the owner: "it's rude that the bots don't acknowledge the question right after it's asked. If the bots
  // need time to think, then they should say they'll get back to them with it. Once they have the answer, they should
  // remind the bot of their question."): Blue's reply comes 40 s after Pink's question, so Blue takes the question at
  // once with a hold line, thinks it over meanwhile (a thinking pose, a hummed "Hmm"), and comes back with a recall of
  // it before its reasoning; its own ack (written with the reply) on the card then, its late ok let go
  const step = (i) => i.move ?? i.cue;
  const order = ['ask', 'context', 'question', 'hold', 'recall', 'reasoning', 'reasoning', 'answer', 'resume', 'agree', 'thanks'];
  const check = (s, how) => {
    const its = s.items.filter((i) => i.thread === 'c1').sort((a, b) => a.t0 - b.t0);
    assert.deepEqual(its.map(step), order, `${how}: sung in the parts' order`);
    for (const i of its.filter((x) => x.move)) assert.ok(i.t0 >= evs.find((e) => e.seq === i.seq).t - 1e-6, `${how}: "${i.text}" at ${i.t0}, before its time`);
    assert.ok(its[0].t0 < 30, `${how}: the opening sung when it is written (${its[0].t0})`);
    // the host takes the question right after it is asked, by name, and says it comes back to it
    const [q, hold, recall] = [its[2], its[3], its[4]];
    assert.ok(hold.bot === 'Blue' && hold.t0 - q.t1 <= s.bar + 1e-6 && /Pink/.test(hold.text) && /think|back to you/i.test(hold.text), `${how}: "${hold.text}" right after "${q.text}"`);
    assert.ok(hold.t0 < 60, `${how}: the hold before the answer is written`);
    // ... thinks it over meanwhile (its thinking poses, its "Hmm"), nobody else's words in its mouth ...
    const ponders = s.staged.filter((e) => e.think && e.bot === 'Blue' && e.t > hold.t1 && e.t < recall.t0);
    assert.ok(ponders.length >= 1 && ponders.every((e) => ['chin-stroke', 'scratch-head'].includes(e.gesture) && e.kind === 'aside' && !e.aside), `${how}: Blue ponders (${ponders.length})`);
    const hums = s.lines.filter((l) => l.role === 'think' && l.bot === 'Blue');
    assert.ok(hums.length >= 1 && hums.every((l) => l.job.text === 'Hmm' && l.at > hold.t1 - 1e-6 && l.at < recall.t0), `${how}: Blue hums it over`);
    assert.ok(!s.lines.some((l) => l.bot === 'Blue' && l.layer !== 'backing' && l.at > hold.t1 && l.at < recall.t0 - 1), `${how}: Blue sings nothing else meanwhile`);
    // ... and comes back to it with a recall naming Pink and saying the question again (the caption shows it)
    assert.ok(recall.bot === 'Blue' && recall.t0 >= 60 - 1e-6 && recall.t0 < 70 && /Pink/.test(recall.text) && /light/.test(recall.text), `${how}: the recall "${recall.text}" when the answer comes`);
    const rev = s.staged.find((e) => e.cue === 'recall' && e.thread === 'c1');
    assert.deepEqual(rev.about, { bot: 'Pink', text: 'Can a light follow me?' }, `${how}: the caption's reminder`);
    // (each stretch one: each line right after the one before, a bar at most between them)
    for (const k of [1, 2, 3, 5, 6, 7, 9, 10]) assert.ok(its[k].t0 - its[k - 1].t1 <= s.bar + 1e-6, `${how}: "${its[k].text}" follows on`);
    assert.ok(its[8].t0 >= 90 - 1e-6, `${how}: the closing when it comes`);
    assert.ok(s.items.some((g) => g.kind === 'gesture' && g.consultSeq === 1 && g.t0 >= its[10].t0), `${how}: sealed after the thanks`);
    assert.deepEqual([...new Set(s.consultParts.map((p) => p.part))], ['pickup', 'context', 'question', 'reasoning', 'answer', 'outro'], `${how}: its parts`);
    assert.deepEqual(s.asides.filter((a) => a.thread === 'c1').map((a) => a.move), ['ack'], `${how}: Blue's own ack on the card with the recall`);
    assert.deepEqual(s.dropped.map((d) => d.move), ['ok'], `${how}: its late ok let go`);
    // two voices by turns: Pink asks, Blue answers, each line by the bot that said it
    assert.deepEqual(its.map((i) => i.bot), ['Pink', 'Pink', 'Pink', 'Blue', 'Blue', 'Blue', 'Blue', 'Blue', 'Pink', 'Pink', 'Pink']);
    const st = s.staged.filter((e) => e.thread === 'c1' && e.duet);
    assert.deepEqual([st[0].bot, st[0].duet.visit, st[1].duet.visit], ['Pink', 'out', 'stay'], `${how}: Pink goes over to Blue`);
    return its;
  };
  const rec = check(scoreMakingOf(evs, null, { production: 150 }), 'replay');
  const live = new MakingOfScore({ live: true });
  for (let t = 0; t <= 150; t++) live.add(evs.filter((e) => e.t > t - 1 && e.t <= t), t);
  live.flush(150);
  const lv = check(live, 'live');
  assert.deepEqual(lv.map((i) => i.text), rec.map((i) => i.text), 'live and replay sing the same consultation');
  // the reply written in time (4 s after the question): one stretch, the host's own yes after the ask and its own ack
  // sung right after the question (never only on the card), then its reasoning and its answer
  const quick = evs.map((e) => (e.seq >= 5 && e.seq <= 9 ? { ...e, t: 24 } : e));
  const sq = scoreMakingOf(quick, null, { production: 150 });
  const qi = sq.items.filter((i) => i.thread === 'c1').sort((a, b) => a.t0 - b.t0);
  assert.deepEqual(qi.map(step).slice(0, 8), ['ask', 'ok', 'context', 'question', 'ack', 'reasoning', 'reasoning', 'answer'], 'in time: one stretch');
  assert.ok(qi.slice(1, 8).every((i, k) => i.t0 - qi[k].t1 <= sq.bar + 1e-6), 'in time: each line right after the one before');
  assert.ok(!qi.some((i) => i.cue === 'hold' || i.cue === 'recall'), 'in time: no hold, no recall');
  // an unfinished one (no reply ever): the opening is sung all the same, the question taken (a hold); at the end the
  // host comes back to it and keeps what there is, the asker thanks it, sealed (a hold never dangles)
  const s3 = scoreMakingOf(evs.slice(0, 5), null, { production: 100 });
  assert.deepEqual(s3.items.filter((i) => i.thread === 'c1' && i.kind !== 'gesture').map(step), ['ask', 'context', 'question', 'hold', 'recall', 'keep', 'close']);
}

// the consultations one at a time (Nov 1, the owner: "barrages of different questions that get answered waaaay after
// it was asked and it doesn't remind the user which question it was"): two opened together, the second's answer
// written first. The making-of sings the one whose answer is there first, whole, then the other (a question asked is
// answered in its own stretch); a third whose answer is late is put on hold, and at most MAX_OPEN are on hold at once
{
  const AG = { Pink: 'comedy', Blue: 'lighting', Gold: 'deals', White: 'chords' };
  let seq = 0;
  const M = (t, th, bot, other, move, summary) => ({ seq: seq++, t, agent: AG[bot], bot, status: ['ask', 'context', 'question', 'followup', 'agree', 'thanks'].includes(move) ? 'consulting' : 'working', beat: 'beat-2-verse1', summary, lyric: '', chords: [], action: '', consult: [other], move, thread: th });
  const open = (t, th, a, h, q) => [M(t, th, a, h, 'ask', `${h}, can I ask you something?`), M(t, th, a, h, 'context', 'Green plans a slip on the ice'), M(t, th, a, h, 'question', q)];
  const reply = (t, th, a, h, ans) => [M(t, th, h, a, 'ok', 'Sure, go on'), M(t, th, h, a, 'ack', 'Ooh, good question'), M(t, th, h, a, 'reasoning', 'A spot is bright but harsh'), M(t, th, h, a, 'answer', ans)];
  const close = (t, th, a, h) => [M(t, th, a, h, 'agree', 'Deal, that works'), M(t, th, a, h, 'thanks', `Thanks, ${h}, that helps`)];
  const evs = [
    { seq: seq++, t: 5, agent: 'hype', bot: 'Yellow', status: 'working', beat: 'beat-1-intro', summary: 'What a start, Gray!', lyric: '', chords: [], action: 'cheer', consult: [] },
    ...open(20, 'c1', 'Pink', 'Blue', 'Can a light follow me?'), ...open(20, 'c2', 'Gold', 'White', 'What does the band cost us?'),
    ...open(21, 'c3', 'White', 'Gold', 'Can we pay the band in soup?'),
    ...reply(25, 'c2', 'Gold', 'White', 'So we play all eight bars'), ...close(30, 'c2', 'Gold', 'White'),
    ...reply(70, 'c1', 'Pink', 'Blue', 'So we dim it to amber'), ...close(75, 'c1', 'Pink', 'Blue'),
    ...reply(140, 'c3', 'White', 'Gold', 'Yes, soup is our coin'), ...close(145, 'c3', 'White', 'Gold'),
  ];
  const s = scoreMakingOf(evs, null, { production: 200 });
  const its = s.items.filter((i) => i.thread).sort((a, b) => a.t0 - b.t0);
  const seqOf = its.map((i) => i.thread).filter((x, i, a) => x !== a[i - 1]);
  assert.equal(seqOf[0], 'c2', `the consultation whose answer is there first goes first (${seqOf})`);
  for (const th of ['c1', 'c2', 'c3']) {
    const q = its.find((i) => i.thread === th && i.move === 'question'), a = its.find((i) => i.thread === th && i.move === 'answer');
    const between = its.filter((i) => i.t0 > q.t0 && i.t0 < a.t0 && i.thread !== th);
    const recalled = its.some((i) => i.thread === th && i.cue === 'recall' && i.t0 > q.t0 && i.t0 < a.t0);
    assert.ok(!between.length || recalled, `${th}: answered in its own stretch, or after a recall (${between.length} other lines between)`);
    const next = its[its.indexOf(q) + 1];
    assert.ok(next.thread === th && (next.move === 'ack' || next.cue === 'hold'), `${th}: the question taken at once (${next.move ?? next.cue})`);
  }
  let held = 0, most = 0;
  for (const i of its) { if (i.cue === 'hold') held++; if (i.cue === 'recall') held--; most = Math.max(most, held); }
  assert.ok(most <= MAX_OPEN, `${most} on hold at once`);
  // (the stock ask said three times: sung the second and third time in other words)
  const asks = its.filter((i) => i.move === 'ask').map((i) => i.text.replace(/Blue|White|Gold/g, 'X'));
  assert.equal(new Set(asks).size, asks.length, `the asks vary: ${asks}`);
}

// 4. deterministic; LIVE -------------------------------------------------------------------------
{
  const again = scoreMakingOf(hw.events, hw.beats);
  const pick = (s) => JSON.stringify([s.staged, s.lines, s.items, s.halves, s.end, timelineOf(s).sections]);
  assert.equal(pick(again), pick(score), 'the same score every time');
  // live: the crew's events as they arrive (on their own clock: the player's array replay starts at the first one),
  // through the player's score hook and its ticks; the same rules as the replay, so it sounds alike
  const t0 = hw.events[0].t;
  const live = new MakingOfScore({ live: true, beats: hw.beats });
  const p = new Player({ onEvent: () => {} });
  const adds = [];
  await p.live(hw.events, { speed: 1, score: { add: (r, now) => { const x = live.add(r, now); adds.push([now, x]); return x; }, flush: (now) => live.flush(now) } });
  for (let i = 0; i < 40000 && !(p.liveDone && p.time >= live.end); i++) p.tick(0.05);
  assert.ok(p.liveDone && live.closed, 'the stream ends, the score closes');
  assert.ok(p.events.every((e, i) => i === 0 || e.t >= p.events[i - 1].t - 1e-9), 'live: in order');
  const planOf = new Map(live.lines.map((l) => [l.seq, l]));
  for (const [now, added] of adds) for (const e of added) { const l = planOf.get(e.seq); assert.ok(e.t >= now - 1e-6 && (!l || l.at >= now + 1 - 1e-6), `live: #${e.seq} ${e.kind} "${e.lyric}" laid out at ${now.toFixed(2)} for ${l?.at.toFixed(2)}`); }
  const lq = live.items.filter((i) => i.kind === 'question'), la = live.items.filter((i) => i.kind === 'answer');
  const nq = hw.events.filter((e) => e.status === 'consulting').length;
  assert.ok(lq.length >= nq - 1 && la.length >= nq, `live: the duets (${lq.length} questions, ${la.length} answers of ${nq})`);
  for (const q of hw.events.filter((e) => e.status === 'consulting')) assert.ok(live.items.some((i) => i.consultSeq === q.seq && i.kind === 'answer'), `live: #${q.seq} answered`);
  for (const i of live.items) {
    const e = hw.events.find((x) => x.seq === (i.kind === 'question' ? i.consultSeq : i.seq));
    if (e && ['thought', 'line', 'answer', 'question'].includes(i.kind)) assert.ok(i.t0 >= e.t - t0 - 1e-6, `live: #${e.seq} before its time`);
  }
  assert.ok(live.items.some((i) => i.kind === 'refrain'), 'live: the work song');
  // alike: the same lines sung (and shown aside) as the replay of the same stream on the same clock
  const shifted = hw.events.map((e) => ({ ...e, t: +(e.t - t0).toFixed(3) }));
  const rep = scoreMakingOf(shifted, hw.beats);
  const key = (s) => new Set(s.items.filter((i) => ['thought', 'line', 'question', 'answer'].includes(i.kind)).map((i) => `${i.kind}:${i.seq ?? i.consultSeq}`));
  const a = key(live), b = key(rep);
  const both = [...a].filter((x) => b.has(x)).length;
  assert.ok(both >= 0.85 * Math.max(a.size, b.size), `live and replay alike: ${both} of ${a.size} / ${b.size}`);
  assert.ok(Math.abs(live.end - rep.end) <= 8 * live.bar, `live ${live.end.toFixed(1)} s, replay ${rep.end.toFixed(1)} s`);
  // live's loading bar: by the beats arrived, never back, full once the director is done
  let lastFrac = 0;
  for (let t = 0; t <= live.end; t += 1) { const f = live.progressAt(t).frac; assert.ok(f >= lastFrac - 1e-9); lastFrac = f; }
  assert.equal(lastFrac, 1);
  // a question nobody answers still gets its duet (a stand-in answer) when the stream ends
  const lone = new MakingOfScore({ live: true });
  lone.add([{ seq: 0, t: 0, agent: 'deals', bot: 'Gold', status: 'consulting', beat: 'b', summary: 'Gold asks Pink for a joke', lyric: '', chords: [], action: '', consult: ['Pink'] }], 0);
  // (the groove's own lines meanwhile: since Nov 5 the work song from the first bar on)
  const talk = () => lone.items.filter((i) => i.kind !== 'refrain' && i.kind !== 'filler');
  assert.equal(talk().length, 0, 'it waits for its answer');
  lone.flush(1);
  assert.deepEqual(talk().map((i) => i.kind), ['question', 'answer', 'gesture']);
  assert.match(talk()[1].text, /Of course, darling/);
}

// 5. the crew's formation ---------------------------------------------------------------------------
{
  assert.deepEqual(new Set(CREW), new Set(Object.values(AGENT_BOT)), 'the crew is the seven role bots');
  const { SETS, SET_NAMES } = await import('./src/scene/environments/sets.js');
  // in each set (and the bare rows, with no set loaded): the crew in an arc in front, the rest of the cast behind and
  // higher, inside the set's walkable bounds, a metre of open floor in front of the arc for a duet (furniture and the
  // heads' sizes: test-blocking.mjs)
  for (const set of [null, ...SET_NAMES]) {
    const f = crewFormation(NAMES, set);
    assert.equal(f.size, NAMES.length);
    const front = CREW.map((n) => f.get(n)), back = NAMES.filter((n) => !CREW.includes(n)).map((n) => f.get(n));
    assert.ok(Math.min(...front.map((p) => p[2])) > Math.max(...back.map((p) => p[2])) + 0.5, `${set}: the crew in front of the choir`);
    assert.ok(Math.min(...back.map((p) => p[1])) - Math.max(...front.map((p) => p[1])) >= 0.6, `${set}: the choir's faces over the crew's`);
    assert.deepEqual(front.map((p) => p[0]), [...front.map((p) => p[0])].sort((a, b) => a - b), `${set}: the crew left to right in CREW order`);
    const all = [...f.values()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(Math.hypot(all[i][0] - all[j][0], all[i][2] - all[j][2]) > 0.7 || Math.abs(all[i][1] - all[j][1]) > 0.5, 'room between heads');
    }
    if (!set) continue;
    const bd = SETS[set].bounds;
    for (const p of all) assert.ok(p[0] > bd[0] + 0.3 && p[0] < bd[1] - 0.3 && p[2] > bd[2] + 0.3 && p[2] < bd[3] - 0.3, `${set}: ${p} inside the set`);
    for (const p of front) assert.ok(p[2] + 1.2 < bd[3], `${set}: a duet's room in front of ${p}`);
  }
}
// 6. the crew's talk ----------------------------------------------------------------------------------
{
  assert.equal(sungSummary("I think it's too bright, White", 'Blue', NAMES, TALK), "I think it's too bright, White", 'talk: as written');
  assert.equal(sungSummary('I set the key', 'White', NAMES, 'first-person'), 'We set the key', 'an Oct 29-30 bundle: the team\'s voice');
  assert.equal(sungSummary('White sets the key', 'White', NAMES, null), 'We set the key', 'a third-person bundle too');
  assert.equal(addresseeOf('White, is G too bright here?', 'Green'), 'White');
  assert.equal(addresseeOf('Nice one, Pink!', 'Yellow'), 'Pink');
  assert.equal(addresseeOf('A gold spot on Purple', 'Blue'), null, 'a colour and the story cast are nobody to talk to');
  assert.equal(addresseeOf('Gray, I count it in', 'Gray'), null, 'never the singer itself');
  // the gap answers are reactions in the room: no word to the viewers in them
  for (const r of [...INTERJECTIONS, ...QUESTION_REPLIES]) assert.ok(!/everyone|folks|you all|watch|audience|look at us/i.test(r), r);
  // a talk bundle: hackathon-win as of Oct 30 (plain consultations, frozen; the curated one's are move threads now)
  // with each crew thought said to the next crewmate (a question to its first consult)
  const { events, beats } = loadFixture('hackathon-oct30');
  const talk = events.map((e, i) => {
    if (e.lyric) return { ...e, t: 0 };
    const to = e.status === 'consulting' && e.consult?.[0] ? e.consult[0] : CREW.filter((n) => n !== e.bot)[i % 6];
    return { ...e, t: 0, summary: e.status === 'consulting' ? `${to}, is this one right?` : i % 3 ? `${to}, I think it's ready` : 'Ooh, I like that one' };
  }); // (without its clock: every event at 0, nothing too late, every thought sung)
  const sc = scoreMakingOf(talk, { ...beats, summaries: TALK });
  const thoughts = sc.staged.filter((e) => e.kind === 'thought');
  assert.ok(thoughts.length >= 10, `${thoughts.length} thoughts`);
  for (const e of thoughts) {
    const src = talk.find((x) => x.seq === e.src);
    assert.equal(e.lyric, src.summary, `#${e.src}: sung as written ("I" stays "I")`);
    assert.equal(e.to ?? null, addresseeOf(src.summary, e.bot), `#${e.src}: said to the crewmate it names`);
  }
  assert.ok(thoughts.some((e) => e.to) && thoughts.some((e) => !e.to), 'said to a crewmate, or a reaction to the room');
  const questions = sc.staged.filter((e) => e.kind === 'question');
  assert.ok(questions.length >= 2 && questions.every((e) => /is this one right\?$/.test(e.lyric)), 'the questions as written');
  // the gap answers: a reaction to a thought (to a question: a question's reply), the last words of Green's line
  const replies = sc.staged.filter((e) => e.part === 'reply' || e.part === 'echo');
  assert.ok(replies.length >= 4, `${replies.length} gap answers`);
  for (const r of replies) {
    const answered = sc.staged.filter((x) => x.bot === r.doing.replace('answers ', '') && x.t <= r.t && x.kind !== 'backing' && !x.part).at(-1);
    if (answered?.kind === 'thought') assert.ok([...INTERJECTIONS, ...QUESTION_REPLIES, 'Yeah!'].includes(r.lyric), `a thought gets a reaction, not "${r.lyric}"`);
  }
  assert.deepEqual(scoreMakingOf(talk, { ...beats, summaries: TALK }).staged, sc.staged, 'deterministic');
}

// 7. where the crew works: Gold's Diner while the director plans, then the set of the beat the loading bar is on
// (the beat being written), cut there only between phrases (an opening phrase, no duet on, nothing else still sung);
// never the old grey studio (hackathon-win's 'studio' outro plays in the diner); every curated making-of
{
  const { SET_NAMES } = await import('./src/scene/environments/sets.js');
  const { resolveSets } = await import('./src/scene/environments/sets.js');
  const OPEN = new Set(['thought', 'line', 'question', 'activity', 'refrain', 'filler']);
  const report = [];
  let visited = new Set();
  const held = [];
  for (const slug of readdirSync(root).filter((d) => d !== 'sample' && existsSync(new URL(`${d}/events.ndjson`, root)) && existsSync(new URL(`${d}/beats.json`, root)))) {
    const b = load(slug);
    const s = scoreMakingOf(b.events, b.beats, { production: wallOf(slug), activity: b.activity });
    const sets = crewSetsOf(s);
    const of = resolveSets(b.beats);
    const why = (m) => `${slug}: ${m}`;
    const first = s.arrivals[0]?.t ?? Infinity;
    // the duets, as spans of the transport (question to seal)
    const duets = s.staged.filter((e) => e.kind === 'question' && e.duet).map((e) => [e.t, e.t + e.duet.until]);
    let prev = 'diner';
    for (const e of s.staged) {
      const at = sets.get(e.seq);
      assert.ok(SET_NAMES.includes(at), why(`${e.seq} in ${at}`));
      if (e.t < first - 1e-6) assert.equal(at, 'diner', why(`planning (t ${e.t}): the crew in Gold's Diner`));
      if (at !== prev) {
        // a cut: before a phrase that opens a stretch of talk, outside every duet, when nothing else is still sung
        assert.ok(OPEN.has(e.kind) && !e.part && e.lyric, why(`a cut before a ${e.kind} (seq ${e.seq})`));
        // (outside every duet: the cut's phrase begins its bars when the duet's are over, its card and pickup in the
        // duet's last bar like after any phrase)
        const pl = s.lines.find((l) => l.seq === e.seq);
        const down = Math.max(e.t, s.sec((pl.notesTb.find((n) => !n.pickup) ?? pl.notesTb[0]).tb));
        assert.ok(!duets.some(([a, z]) => e.t > a + 2e-3 && down < z - 2e-3), why(`a cut in a duet at ${e.t}`));
        const voice = pl.at;
        const over = s.lines.filter((l) => l.layer !== 'backing' && l.seq !== e.seq && l.at < voice && l.notesTb)
          .filter((l) => { const n = l.notesTb.at(-1); return s.sec(n.tb + n.dur) > voice + 0.05; });
        assert.deepEqual(over.map((l) => l.text), [], why(`a cut at ${e.t} over a phrase still sung`));
        // to the set of the beat being written
        assert.equal(at, of.get(s.progressAt(e.t).beat), why(`the cut at ${e.t} goes to the beat's set`));
        prev = at;
      }
    }
    // no brief stay: each set visited (but the last) at least HOLD s
    const cuts = sets.cuts;
    for (const [k, c] of cuts.entries()) {
      if (k + 1 < cuts.length) assert.ok(cuts[k + 1].t - c.t >= HOLD - 1e-6, why(`${c.set} for ${(cuts[k + 1].t - c.t).toFixed(1)} s at ${c.t.toFixed(0)}`));
    }
    // it keeps up: each beat that arrives in another set is reached before the next beat arrives, or within 30 s;
    // only a beat whose set the bar leaves again within HOLD s is held (the crew stays, then goes to the later set)
    for (const [k, a] of s.arrivals.entries()) {
      const want = of.get(a.beat), next = s.arrivals[k + 1]?.t ?? s.end;
      const setAt = (t) => [...cuts].reverse().find((c) => c.t <= t + 1e-6)?.set ?? 'diner';
      if (setAt(next) === want || next - a.t < 2) continue;
      // (a beat the loading bar leaves for another set within HOLD s of its arrival, as CrewSets judges it: held)
      if (setAt(a.t) !== want && new CrewSets(s).brief(want, a.t) && !cuts.some((c) => c.t >= a.t - 1e-6 && c.t < next && c.set === want)) {
        held.push(`${slug} ${a.beat} (${want}, the bar leaves it within ${HOLD} s)`);
        continue;
      }
      // (held: without the hold the crew would have cut there and left again within HOLD s)
      const loose = crewSetsOf(s, { hold: 0 }).cuts;
      const k0 = loose.findIndex((c) => c.t >= a.t - 1e-6 && c.set === want);
      const stay = k0 >= 0 ? (loose[k0 + 1]?.t ?? s.end) - loose[k0].t : Infinity;
      // (brief as CrewSets judges it: the loading bar calls for another set within HOLD s of the cut, though the crew,
      // which cuts only between phrases, would have stayed a little longer)
      const brief = k0 >= 0 && new CrewSets(s).brief(want, loose[k0].t);
      // (its first natural moment may come later than 30 s: a consultation is one stretch, ask to thanks, since Nov 1)
      if (k0 >= 0 && (stay < HOLD || brief) && !cuts.some((c) => Math.abs(c.t - loose[k0].t) < 1e-6)) {
        held.push(`${slug} ${a.beat} (${want} for ${stay.toFixed(0)} s)`);
        continue;
      }
      // (no natural moment to cut there at all before the bar moves on: the crew stays)
      if (k0 < 0 && !cuts.some((c) => c.t >= a.t - 1e-6 && c.t < next && c.set === want)) { held.push(`${slug} ${a.beat} (${want}: no moment to cut)`); continue; }
      const reached = cuts.find((c) => c.t >= a.t - 1e-6 && c.set === want);
      // (or at the first natural moment, when that is later: Nov 1, a consultation is one stretch, ask to thanks, and
      // the crew cuts only before a phrase that opens a stretch of talk)
      const chance = k0 >= 0 ? loose[k0].t : Infinity;
      assert.ok(reached && (reached.t - a.t <= 30 || reached.t <= chance + 1e-6), why(`${a.beat} (${want}) reached ${reached ? (reached.t - a.t).toFixed(1) + ' s' : 'never'} after it arrived`));
    }
    for (const c of cuts) visited.add(c.set);
    report.push(`${slug} ${cuts.map((c) => `${c.set}@${c.t.toFixed(0)}`).join(' ') || 'diner'}`);
    if (slug === 'hackathon-win') {
      // its beats (re-directed Nov 1 (later), with the singable check): the diner from the intro to chorus 1, the big
      // house for verse 2's bugs, the street for verse 2b's late night (coding with Muse past midnight) to bridge 2,
      // the diner for chorus 3 and the outro
      assert.deepEqual(cuts.map((c) => c.set), ['big_house', 'street', 'diner'], why('diner -> big_house -> street -> diner'));
      assert.equal(of.get('beat-11-outro'), 'diner');
      assert.equal(cuts.at(-1).set, of.get(cuts.at(-1).beat));
    }
    assert.deepEqual(crewSetsOf(s).cuts, cuts, why('deterministic'));
  }
  // the curated making-ofs visit the three first sets, and only sets their beats play in
  const used = new Set(readdirSync(root).filter((d) => d !== 'sample' && existsSync(new URL(`${d}/beats.json`, root))).flatMap((d) => [...resolveSets(load(d).beats).values()]));
  for (const x of ['big_house', 'diner', 'street']) assert.ok(visited.has(x), `the curated making-ofs visit ${x}`);
  assert.ok([...visited].every((x) => used.has(x) || x === 'diner'), `visited ${[...visited]}, used ${[...used]}`);
  // live: the same plan as the score grows (beats arriving later: the diner until they are known)
  const live = new MakingOfScore({ live: true });
  const plan = new CrewSets(live);
  const { events, beats } = load('hackathon-win');
  const streetBeat = beats.beats.find((x) => x.set === 'street').id;
  const added = live.add(events.filter((e) => e.beat === beats.beats[0].id).map((e) => ({ ...e, t: 0 })), 0);
  assert.ok(added.filter((e) => e.lyric).every((e) => plan.next(e) === 'diner'), 'no beats known yet: the diner');
  live.beats = beats;
  const more = live.add(events.filter((e) => e.beat === streetBeat).map((e) => ({ ...e, t: 30 })), 30);
  more.forEach((e) => plan.next(e));
  assert.equal(plan.set, 'street', `the street once its beat arrives (${plan.cuts.map((c) => c.set)})`);
  // (a beat written in seconds between two of another set's is held: re-directed Nov 1 it is birthday-cake's verse 2,
  // hackathon-win's diner choruses now last long enough to visit)
  assert.ok(held.length >= 1 && held.every((h) => / \(\w+(?:: | for \d)/.test(h)), `a short stay is held (${held})`);
  console.log(`making-of sets: ${report.join('; ')}; held: ${held.join(', ')}`);
}

console.log(`making-of ok: the team's voice, pairing, scores of every curated bundle (the loading bar, form, tunes, backing, work song; hackathon-oct30 ${score.end.toFixed(1)} s, ${score.items.length} phrases), deterministic, live\n  ${lengths.join('\n  ')}`);
{
  // filler songs (owner, Nov 2: "There should never be a point when the bots do not sing anything", clearly filler;
  // Nov 5: "I want more filler lines please. Not just dino facts and not just from the dino kid. For example, restaurant
  // facts from the diner owner. Randomize them. Let's aim for 50 filler lines that get randomly selected!"):
  // 1. fifty facts, none twice, spread across the crew, each from its bot's own world, short and singable: a line of two
  //    bars on the work song's tune, every word one the singer knows (the director's dictionary check, craft.js);
  //    each bot a call of its own that says first that it is filler
  const C = await import('../scripts/director/craft.js');
  assert.equal(FILLER_FACTS.length, 50, 'fifty filler facts');
  assert.equal(new Set(FILLER_FACTS.map(([, f]) => f.toLowerCase().replace(/[^a-z ]/g, ''))).size, 50, 'no fact twice');
  const per = Object.fromEntries(CREW.map((b) => [b, FILLER_FACTS.filter(([x]) => x === b).length]));
  for (const b of CREW) assert.ok(per[b] >= 5 && per[b] <= 8, `${b} has ${per[b]} facts (5-8 each)`);
  assert.deepEqual(Object.keys(FILLER_CALLS).sort(), [...CREW].sort(), 'a call for every crew bot');
  for (const [b, call] of Object.entries(FILLER_CALLS)) assert.match(call, /^Filler time\b/, `${b}'s call says it is filler`);
  for (const t of [...FILLER_FACTS.map(([, f]) => f), ...Object.values(FILLER_CALLS)]) {
    const n = syllabify(t).length;
    assert.ok(n >= 4 && n <= 8 && tuneBars('march', n, 2, { talk: true }) === 2, `"${t}": ${n} syllables, two bars`);
    assert.deepEqual(C.unknownWords(t), [], `"${t}": every word one the singer knows`);
    assert.ok(!/\b(you all|everyone|folks|audience|watch)\b/i.test(t), `"${t}" is said in the room, not to the viewers`);
  }
  // (the old dino kid keeps his; the diner's grandpa has diner facts; a fact is sung with its own bot's call)
  assert.ok(FILLER_FACTS.some(([b, f]) => b === 'Gold' && /diner/i.test(f)) && FILLER_FACTS.some(([b, f]) => b === 'Green' && /dino/i.test(f)));
  assert.deepEqual(fillerLines(FILLER_FACTS.findIndex(([b]) => b === 'Gold')), [FILLER_CALLS.Gold, FILLER_FACTS.find(([b]) => b === 'Gold')[1]]);
  // 2. drawn at random: a seed's deck is all fifty, each once; the same seed the same order, another seed another
  const { fillerDeck, FILLER_SEED } = await import('./src/making-of-score.js');
  const d1 = fillerDeck(7), d2 = fillerDeck(7), d3 = fillerDeck(8), r2 = fillerDeck(7, 1);
  assert.deepEqual([...d1].sort((a, z) => a - z), FILLER_FACTS.map((_, i) => i), 'a deck: every fact once');
  assert.deepEqual(d1, d2, 'the same seed, the same order');
  assert.notDeepEqual(d1, d3, 'another seed, another order');
  assert.notDeepEqual(d1, r2, 'the next round, shuffled anew');
  assert.ok(new Set([0, 1, 2, 3, 4, 5].map((s) => fillerDeck(s)[0])).size >= 3, 'the first filler varies with the seed');
  // (the page: ?seed= keeps one, a capture's and a test's; else a new one each playback)
  const { playbackSeed } = await import('./src/making-of.js');
  assert.equal(playbackSeed('?seed=42'), '42');
  assert.equal(playbackSeed('?cinema=1&prompt=x&seed=qa'), 'qa');
  assert.equal(playbackSeed('?cinema=1', () => 0.5), String(2 ** 30));
  assert.notEqual(playbackSeed(''), playbackSeed(''), 'a new seed each playback');
  // 3. the score draws them so: a fact right after its own bot's call, never one twice before all fifty are sung, the
  //    singer free (a host thinking over a question it holds never sings one); the same seed the same fillers (a
  //    capture, a test), another seed others; the score's own seed is FILLER_SEED unless one is given
  const fillersOf = (s) => s.items.filter((i) => i.kind === 'filler').sort((a, z) => a.t0 - z.t0);
  const factOf = new Map(FILLER_FACTS.map(([b, f]) => [f, b]));
  let n = 0;
  const seen = new Map();
  for (const slug of ['why-musical-bots', 'hackathon-win', 'toy-box', 'red-truck']) {
    const b = load(slug);
    const s = scoreMakingOf(b.events, b.beats, { production: wallOf(slug), activity: b.activity, seed: 'qa' });
    assert.equal(s.seed, 'qa');
    assert.equal(timelineOf(s).seed, 'qa', 'the timeline keeps it (capture.mjs meta.json)');
    const f = fillersOf(s);
    n += f.length;
    const facts = [];
    f.forEach((i, k) => {
      if (/^Filler time/.test(i.text)) { assert.equal(i.text, FILLER_CALLS[i.bot], `${slug}: ${i.bot} sings its own call`); return; }
      assert.equal(factOf.get(i.text), i.bot, `${slug}: "${i.text}" sung by its own bot (${i.bot})`);
      const call = f[k - 1];
      assert.ok(call && call.text === FILLER_CALLS[i.bot] && call.bot === i.bot && i.t0 - call.t1 < 0.6, `${slug}: "${i.text}" straight after its call`);
      facts.push(i.text);
      const busy = s.thinking.filter((r) => i.t0 >= s.bar * r.from - 1e-6 && i.t0 < s.bar * r.to).map((r) => r.bot);
      assert.ok(!busy.includes(i.bot), `${slug}: ${i.bot} sings a filler while it thinks over a question`);
    });
    for (let k = 0; k < facts.length; k++) assert.ok(k % 50 === 0 || !facts.slice(50 * Math.floor(k / 50), k).includes(facts[k]), `${slug}: "${facts[k]}" twice in a round`);
    seen.set(slug, facts);
    const again = scoreMakingOf(b.events, b.beats, { production: wallOf(slug), activity: b.activity, seed: 'qa' });
    assert.deepEqual(fillersOf(again).map((i) => [i.t0, i.bot, i.text]), f.map((i) => [i.t0, i.bot, i.text]), `${slug}: the same seed, the same fillers`);
  }
  const hero = load('why-musical-bots');
  const other = fillersOf(scoreMakingOf(hero.events, hero.beats, { production: wallOf('why-musical-bots'), activity: hero.activity, seed: 'another' })).filter((i) => !/^Filler time/.test(i.text)).map((i) => i.text);
  assert.notDeepEqual(other, seen.get('why-musical-bots'), 'another seed, other fillers');
  assert.equal(scoreMakingOf(hero.events, hero.beats, { production: wallOf('why-musical-bots'), activity: hero.activity }).seed, FILLER_SEED);
  const bots = new Set([...seen.values()].flat().map((t) => factOf.get(t)));
  assert.ok(n >= 20 && bots.size >= 6, `${n} filler lines in four curated making-ofs, from ${bots.size} crew bots`);
  console.log(`filler ok: ${FILLER_FACTS.length} facts (${CREW.map((b) => `${b} ${per[b]}`).join(', ')}); ${n} filler lines in four making-ofs from ${bots.size} bots`);
}
{
  // the lyric gate's first rejection is essential (Nov 2, v28: the crew talked without a gap from ~124 s on, all 53
  // rejections were passed by and what the gate is was never sung): the hero's making-of sings it, its reply and the
  // explanation (activity-lines.js GATE_EXPLAINED), in that order, outside every consultation's stretch and duet
  const { GATE_EXPLAINED } = await import('./src/activity-lines.js');
  const b = load('why-musical-bots');
  const s = scoreMakingOf(b.events, b.beats, { production: wallOf('why-musical-bots'), activity: b.activity });
  const acts = s.items.filter((i) => i.kind === 'activity').sort((x, z) => x.t0 - z.t0);
  const rej = acts.find((i) => i.work === 'reject');
  assert.ok(rej, 'why-musical-bots: a lyric-gate rejection is sung');
  const k = acts.indexOf(rej);
  const [r, then] = [acts[k + 1], acts[k + 2]];
  const firstReject = b.activity.find((a) => a.kind === 'reject');
  assert.ok(rej.t0 >= firstReject.t, `sung after it happened (${rej.t0} for ${firstReject.t})`);
  const explained = (tpl, text) => new RegExp(`^${tpl.replace('{s}', '\\w+')}$`).test(text);
  assert.ok(r?.work === 'explain' && explained(GATE_EXPLAINED[0], r.text), `the reply explains the gate (${r?.text})`);
  assert.ok(then?.work === 'advice' && explained(GATE_EXPLAINED[1], then.text) && then.bot === r.bot, `then what it checks (${then?.text})`);
  assert.ok(rej.essential && r.essential && then.essential, 'the first rejection is essential');
  const quiet = s.staged.filter((e) => (e.kind === 'question' || e.kind === 'answer') && e.duet).map((e) => [e.t, e.t + e.duet.until]);
  for (const i of [rej, r, then]) assert.ok(!quiet.some(([a, z]) => i.t0 > a + 1e-3 && i.t0 < z - 1e-3), `"${i.text}" at ${i.t0} inside a consultation`);
  console.log(`lyric gate ok: "${rej.text}" at ${rej.t0.toFixed(1)} s, explained by ${r.bot}${firstReject ? ` (it happened at ${firstReject.t} s)` : ''}`);
}
