// The making-of as a musical number (web/src/making-of-score.js, web/src/team-voice.js), headless:
//   1. the crew's summaries in the team's voice, "we" (third-person, "I" and "we" bundles alike);
//   2. consultations paired with their answers (an `answers` field first, else the blackboard's rule);
//   3. the score of a recorded making-of: every thought and every consultation sung (a duet sealed by a hand play),
//      Green's new lines on the bar grid, 2-3.5 minutes, phrases on the bar lines, one note a syllable, sung at about
//      speaking pace (no faster than ~3 syllables/s, no syllable under 0.25 s, the names on a strong beat); the form (each
//      section's progression from its function set, fitted so it ends as the set does: half cadences on V, V7 -> I,
//      the song on I), the tunes (chord tones on the strong beats, questions up to so, answers home to do), the
//      backing (the crew members who do not sing the phrase, on the chord's tones, under it in the mix) and the gap
//      answers;
//   4. deterministic (the same score twice), and LIVE: events arriving in bursts through the player's score hook;
//   5. the timeline for the trailer tools, the crew's formation, the vamp;
//   6. the crew's talk (beats.json summaries: "talk", since Oct 31): sung as written, each said to the crewmate it
//      names (the staged event's `to`), the gap answers in-world reactions, never to the viewers.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { teamVoice, baseForm, isFirstPerson, isTeamVoice, pluralize, sungSummary, TALK } from './src/team-voice.js';
import {
  answerOf, pairConsultations, fallbackAnswer, scoreMakingOf, MakingOfScore, gestureOf, pickupOf, shapeByChord, stanzaStart,
  crewFormation, CREW, SEALS, MAX_SECONDS, MAKING_OF_TEMPO, TUNE_TEMPO, HALVES, addresseeOf, nameSyllable, INTERJECTIONS, QUESTION_REPLIES, remarksToSkip,
} from './src/making-of-score.js';
import { PROGRESSION_SETS, chordsOf, chordName, fitRomans, isCadenceSection, progressionSetOf } from './src/song/form.js';
import { tuneNotes } from './src/song/tunes.js';
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
const checkScore = (slug, s, events) => {
  const why = (m) => `${slug}: ${m}`;
  // 2-3.5 minutes (a judge presses Live: the premiere follows); over MAX_SECONDS only when there is no remark left to
  // leave out (garden: its 16 duets alone)
  assert.ok(s.end >= 110 && s.end <= MAX_SECONDS + 20, why(`${s.end.toFixed(1)} s`));
  assert.ok(s.end <= MAX_SECONDS + 1e-6 || s.skip?.size === remarksToSkip(events).length, why(`${s.end.toFixed(1)} s with remarks left to leave out`));
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
  // (over MAX_SECONDS a talkative crew's remarks give way, as few as it takes: never a question, an answer, a beat's
  // first thought or one the next thought reacts to)
  const talk = events.filter((e) => !e.lyric);
  const left = talk.filter((e) => !sung.has(e.seq));
  const paired = new Set([...pairConsultations(events).values()].map((a) => a.seq));
  for (const e of left) {
    assert.ok(s.skip?.has(e.seq) && e.status !== 'consulting' && e.answers == null && !paired.has(e.seq) && !/\?\s*$/.test(e.summary), why(`#${e.seq} (${e.bot}) sung`));
    assert.notEqual(talk.find((x) => x.beat === e.beat), e, why(`#${e.seq}: a beat keeps its first thought`));
    const next = talk.slice(talk.indexOf(e) + 1).find((x) => x.bot !== e.bot);
    assert.ok(!next || addresseeOf(next.summary, next.bot) !== e.bot, why(`#${e.seq}: ${next?.bot} reacts to it`));
  }
  if (s.skip?.size) {
    const order = remarksToSkip(events).map((e) => e.seq);
    assert.deepEqual([...s.skip], order.slice(0, s.skip.size), why('the remarks in their order'));
    const fewer = new MakingOfScore({ beats: s.beats, only: s.only, skip: new Set(order.slice(0, s.skip.size - 1)), measure: true });
    fewer.add(events, 0);
    fewer.flush(0);
    assert.ok(fewer.end > MAX_SECONDS, why(`one remark fewer left out fits too (${fewer.end.toFixed(1)} s)`));
    assert.ok(s.end <= MAX_SECONDS || s.skip.size === order.length, why('over MAX_SECONDS only when no remark is left to leave out'));
  }
  assert.ok(left.length <= talk.length / 2, why(`${left.length} of ${talk.length} remarks left out`));
  for (const i of items.filter((x) => x.kind === 'thought')) {
    const e = events.find((x) => x.seq === i.seq);
    assert.equal(i.text, sungSummary(e.summary, e.bot, NAMES, s.beats?.summaries), why(`#${i.seq} in the team's voice`));
  }
  // Green's lines: the first new line of every beat, never one the song already has
  const lines = items.filter((i) => i.kind === 'line');
  assert.ok(lines.every((i) => i.bot === 'Green' || events.find((e) => e.seq === i.seq)?.bot === i.bot));
  const texts = lines.map((i) => i.text.toLowerCase().replace(/[^a-z ]/g, ''));
  assert.equal(new Set(texts).size, texts.length, why('no line twice'));
  for (const [beat, seq] of s.firstOfBeat) assert.ok(lines.some((i) => i.seq === seq), why(`${beat}: its first new line`));
  // the staged events: in time order, each sung one's voice CARD_LEAD after its card; a phrase one note a syllable
  assert.ok(s.staged.every((e, i) => i === 0 || e.t >= s.staged[i - 1].t - 1e-9), why('in order'));
  const plan = new Map(s.lines.map((l) => [l.seq, l]));
  for (const e of s.staged) {
    if (!e.lyric) { assert.equal(e.kind, 'gesture'); continue; }
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
    assert.equal(l.layer, e.part ? 'echo' : 'story', why(`#${e.seq} on its layer`));
  }
  // one voice at a time: a phrase starts after the last one ends (its pickup sings in the last one's breath), but
  // the seal's word, which both sing together
  const story = s.lines.filter((l) => l.layer === 'story');
  const solo = story.filter((l) => s.staged.find((e) => e.seq === l.seq)?.kind !== 'seal').sort((a, b) => a.at - b.at);
  const endOf = (l) => l.at + l.job.notes.at(-1).t + l.job.notes.at(-1).dur;
  for (let i = 1; i < solo.length; i++) {
    const p = solo[i - 1];
    assert.ok(solo[i].at >= endOf(p) - 1e-3, why(`"${solo[i].job.text}" starts at ${solo[i].at.toFixed(2)} before "${p.job.text}" ends ${endOf(p).toFixed(2)}`));
  }
  // on the grid: a phrase enters on a bar line (the groove's: HALVES tune bars), its first note there or after its
  // pickup (one weak syllable for a thought, two before a name, up to three for a line on its tune), and lasts two
  // tune bars (a bar of the groove) at least
  const G = HALVES * s.bar;
  const onBar = (t) => Math.abs(t / G - Math.round(t / G)) < 1e-3;
  for (const l of solo) {
    const k = l.job.notes.findIndex((n) => onBar(l.at + n.t));
    assert.ok(k >= 0 && k <= 3, why(`"${l.job.text}" enters on a bar line (note ${k})`));
    assert.ok(l.job.notes.slice(0, k).every((n) => l.at + n.t > l.at + l.job.notes[k].t - s.bar / 2), why('a short pickup'));
    assert.ok(l.bars >= 2, why(`"${l.job.text}": two bars at least`));
  }

  // sung at about speaking pace (Oct 31, owner: "the song should be sung in normal speaking speed"; v15's double
  // time sang ~3.5 syllables/s, up to 4.2, with syllables of 0.07 s): within a phrase no faster than ~3 syllables/s
  // (its pickup aside), no syllable shorter than 0.25 s (onset to onset), the pickup's neither
  for (const l of solo) {
    const nt = l.notesTb, own = nt.filter((x) => !x.pickup);
    const t = (x) => s.sec(x.tb);
    if (own.length >= 3) {
      const rate = (own.length - 1) / (t(own.at(-1)) - t(own[0])); // (onset to onset: a cut last note aside)
      assert.ok(rate <= 3.0, why(`"${l.text}": ${rate.toFixed(2)} syllables/s`));
    }
    nt.slice(0, -1).forEach((x, i) => assert.ok(t(nt[i + 1]) - t(x) >= 0.25 - 1e-3, why(`"${l.text}": syllable ${i} ${(t(nt[i + 1]) - t(x)).toFixed(3)} s`)));
  }
  // the crewmate the talk names is heard: its name on a strong beat (1 or 3 of the groove's bar) held a quarter at
  // least, or (it ends the line) on a beat, held to the line's end
  let named = 0;
  for (const l of solo) {
    const kind = s.staged.find((e) => e.seq === l.seq)?.kind;
    if (!['thought', 'question', 'answer'].includes(kind)) continue;
    const sy = syllabify(l.text), k = nameSyllable(sy, addresseeOf(l.text, l.bot));
    if (k < 0) continue;
    named++;
    const x = l.notesTb[k], next = l.notesTb[k + 1], inBar = x.tb % 4;
    if (next) assert.ok(Math.abs(inBar) < 1e-6 && s.sec(next.tb - x.tb) >= s.beat - 1e-3, why(`"${l.text}": ${sy[k].word} at ${inBar} for ${s.sec(next.tb - x.tb).toFixed(2)} s`));
    else assert.ok(Math.abs(inBar % 2) < 1e-6 && s.sec(x.dur) >= 0.59, why(`"${l.text}": ${sy[k].word} at the end held ${s.sec(x.dur).toFixed(2)} s`));
  }
  assert.ok(named >= 10 || s.beats?.summaries !== 'talk', why(`${named} names sung`));

  // the form: a section a beat, its progression an id of its function set, fitted to its bars, one chord a bar
  const tl = timelineOf(s);
  assert.equal(tl.sections.length, new Set(events.map((e) => e.beat)).size, why('a section a beat'));
  const tags = s.style.tags;
  tl.sections.forEach((x, i) => {
    assert.equal(x.set, progressionSetOf(x.section, tags), why(`${x.section}: its set`));
    assert.ok(PROGRESSION_SETS[x.set].includes(x.progression), why(`${x.section}: ${x.progression} is of ${x.set}`));
    const last = i === tl.sections.length - 1;
    // (a section of one bar: a chord a half bar, so it still ends as its set does)
    assert.deepEqual(x.romans, fitRomans(chordsOf(x.progression), x.section, x.perHalf ? HALVES * x.bars : x.bars, { final: last }), why(`${x.section}: its chords`));
    assert.ok(!x.perHalf || x.bars === 1, why(`${x.section}: a chord a half bar only in a bar alone`));
    assert.ok(x.bars >= 1 && Math.abs(x.t1 - x.t0 - x.bars * tl.bar) < 1e-2, why(`${x.section}: ${x.bars} bars`));
    if (i > 0) assert.ok(Math.abs(x.t0 - tl.sections[i - 1].t1) < 1e-3, why('the sections follow each other'));
    // the cadence rules (HANDOFF Part C 3.3): a chorus, the outro and the song end V7 -> I; the intro, the build
    // verses and bridge 2 end on V (a half cadence into the next section); a narrative verse home on I; a bridge
    // never on I; a conclusive outro has its predominant (ii or IV) before the V7
    const end2 = x.romans.slice(-2).join(' ');
    if (isCadenceSection(x.section) || last) assert.equal(end2, 'V7 I', why(`${x.section} ends V7 -> I`));
    else if (x.set === 'intro:scene' || x.set === 'verse:build' || x.set.startsWith('bridge2:')) assert.equal(x.romans.at(-1), 'V', why(`${x.section}: a half cadence`));
    else if (x.set === 'verse:narrative') assert.equal(x.romans.at(-1), 'I', why(`${x.section} home`));
    else if (x.set.startsWith('bridge:')) assert.notEqual(x.romans.at(-1), 'I', why(`${x.section} leans on`));
    if (x.set === 'outro:conclusive' && x.bars >= 3) assert.ok(['ii', 'IV'].includes(x.romans.at(-3)), why(`${x.section}: the predominant`));
  });
  assert.ok(tl.sections.map((x) => x.section).join(' ').startsWith('intro verse1'), why('the form opens on the intro'));
  // the chords the vamp plays are the form's, a bar each, and the home chord rings at the end
  const h = s.halves;
  // (one chord a bar of the groove: both its halves)
  assert.ok(Math.abs(tl.bar - HALVES * s.bar) < 1e-3 && Math.abs(tl.bar - 4 * 60 / MAKING_OF_TEMPO) < 1e-3, why('a bar is four beats'));
  for (const x of tl.sections) x.romans.forEach((r, k) => {
    const per = x.perHalf ? 1 : HALVES;
    for (let j = 0; j < per; j++) assert.equal(h[Math.round(x.t0 / s.bar) + per * k + j], chordName(r), why('the vamp'));
  });
  assert.ok(h.length * s.bar >= s.end - 1e-6 && h.at(-1) === 'C', why('the vamp rings home'));

  // the tunes: every strong beat (beats 1 and 3 of a bar) of a phrase or a gap answer on a tone of its bar's chord
  const chordAtT = (t) => chordFromRoman(s.romanAt(Math.floor(t / s.bar + 1e-6)), 'C');
  let strong = 0;
  for (const l of s.lines.filter((x) => x.layer !== 'backing')) {
    for (const n of l.job.notes) {
      const t = l.at + n.t, inBar = t / s.bar - Math.floor(t / s.bar + 1e-6);
      if (Math.abs(inBar) > 1e-4 && Math.abs(inBar - 0.5) > 1e-4) continue;
      strong++;
      assert.ok(chordAtT(t).tones.includes(pc(n.midi)), why(`"${l.job.text}" at ${t.toFixed(2)}: ${n.midi} on ${s.romanAt(Math.floor(t / s.bar + 1e-6))}`));
    }
  }
  assert.ok(strong > 150, why(`${strong} strong beats`));
  // a question asks (up to so), its answer and a section's last line go home (to do): the chord tone nearest them,
  // so and do themselves when the chord has them (it mostly has)
  const shaped = story.filter((l) => l.shape === 'ask' || l.shape === 'answer');
  // (a talk bundle's many duets end where the form puts them, often on a chord without so / do: a chord tone then)
  let hits = 0, can = 0;
  for (const l of shaped) {
    const last = l.job.notes.at(-1), ch = chordAtT(l.at + last.t);
    const want = l.shape === 'ask' ? 7 : 0;
    if (ch.tones.includes(want)) { can++; if (pc(last.midi) === want) hits++; }
    assert.ok(ch.tones.includes(pc(last.midi)), why(`"${l.job.text}" ends on a chord tone`));
  }
  assert.ok(can >= 10 && hits >= 0.95 * can, why(`${hits} of ${can} lines end on so / do where the chord has it`));
  const qa = (kind) => s.staged.filter((e) => e.kind === kind).map((e) => plan.get(e.seq));
  assert.ok(qa('question').every((l) => l.shape === 'ask') && qa('answer').every((l) => l.shape === 'answer'), why('questions ask, answers answer'));
  // a chorus's and the outro's last line land on the home chord's root (do)
  for (const l of story.filter((x) => x.home)) assert.equal(pc(l.job.notes.at(-1).midi), 0, why(`"${l.job.text}" lands home`));
  // every chorus and the outro lands: what it sings last (its last line, or a duet's seal word, the asker on the
  // root) ends on do over the home chord
  tl.sections.forEach((x, i) => {
    if (!isCadenceSection(x.section) && i !== tl.sections.length - 1) return;
    const inIt = story.filter((l) => endOf(l) > x.t0 + 1e-3 && endOf(l) <= x.t1 + 1e-3);
    const end = Math.max(...inIt.map(endOf));
    const lastSung = inIt.filter((l) => endOf(l) >= end - 0.05);
    assert.ok(lastSung.some((l) => pc(l.job.notes.at(-1).midi) === 0 && s.romanAt(Math.floor((l.at + l.job.notes.at(-1).t) / s.bar + 1e-6)) === 'I'),
      why(`${x.section} lands home: ${lastSung.map((l) => `"${l.job.text}"`).join(', ')}`));
  });

  // the backing: in most bars, sung by crew members who do not sing the phrase there, on its chord's tones
  const backing = s.lines.filter((l) => l.layer === 'backing');
  const bars = Math.round(s.end / s.bar);
  const parts = new Map();
  for (const l of backing) {
    assert.ok(CREW.includes(l.bot), why('the crew sings the backing'));
    l.segments.forEach((g) => {
      const b = Math.round((g.at - g.job.notes[0].t) / s.bar);
      const t0 = b * s.bar, t1 = t0 + s.bar;
      parts.set(b, [...(parts.get(b) ?? []), l.bot]);
      for (const n of g.job.notes) assert.ok(chordAtT(g.at + n.t).tones.includes(pc(n.midi)), why(`${l.bot}'s ${l.role} on the chord`));
      // never the bot singing a phrase or an answer in that bar
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
  assert.ok(backing.filter((l) => l.lift?.some(([, d]) => d < 0)).length >= 0.8 * backing.length, why('the backing dips under the words'));
  // (a talk bundle's duets leave no gap, and it keeps few of Green's lines: fewer gap answers than the Oct 30 bundles' 25-30;
  // sung at speaking pace, a line fills its bar and a name ends it held: 2-6 since v16, 5-9 before)
  const echoes = s.lines.filter((l) => l.layer === 'echo');
  assert.ok(echoes.length >= 2 && echoes.every((l) => l.db < 0 && l.job.notes.length <= 2), why(`${echoes.length} gap answers`));
  assert.ok(story.every((l) => !l.lift && (l.db ?? 0) >= -3), why('the phrases on top'));
  return s;
};

const hw = loadFixture('hackathon-oct30'); // frozen: the checks below name its events
// every curated episode's making-of (the sample: a few events, no making-of to speak of)
for (const slug of readdirSync(root).filter((d) => d !== 'sample' && existsSync(new URL(`${d}/events.ndjson`, root)) && existsSync(new URL(`${d}/beats.json`, root)))) {
  const b = load(slug);
  checkScore(slug, scoreMakingOf(b.events, b.beats), b.events);
}
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
  // fitted progressions keep their endings at any length
  assert.deepEqual(fitRomans(chordsOf('t-porch'), 'intro', 12), ['I', 'IV', 'I', 'V', 'I', 'IV', 'I', 'V', 'I', 'IV', 'I', 'V']);
  assert.deepEqual(fitRomans(chordsOf('t-cadence-ii'), 'outro', 6), ['I', 'IV', 'I', 'ii', 'V7', 'I']);
  assert.deepEqual(fitRomans(chordsOf('gospel'), 'chorus1', 4), ['I', 'IV', 'V7', 'I']);
  assert.deepEqual(fitRomans(chordsOf('t-build'), 'verse1b', 2), ['ii', 'V']);
  assert.deepEqual(fitRomans(chordsOf('nursery'), 'verse1', 4, { final: true }).slice(-2), ['V7', 'I'], 'the song ends home');
}

// 4. deterministic; LIVE -------------------------------------------------------------------------
{
  const again = scoreMakingOf(hw.events, hw.beats);
  const pick = (s) => JSON.stringify([s.staged, s.lines, s.items, s.halves, s.end, timelineOf(s).sections]);
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
  // a talk bundle: hackathon-win with each crew thought said to the next crewmate (a question to its first consult)
  const { events, beats } = load('hackathon-win');
  const talk = events.map((e, i) => {
    if (e.lyric) return e;
    const to = e.status === 'consulting' && e.consult?.[0] ? e.consult[0] : CREW.filter((n) => n !== e.bot)[i % 6];
    return { ...e, summary: e.status === 'consulting' ? `${to}, is this one right?` : i % 3 ? `${to}, I think it's ready` : 'Ooh, I like that one' };
  });
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

console.log(`making-of ok: the team's voice, pairing, scores of every curated bundle (form, tunes, backing; hackathon-win ${score.end.toFixed(1)} s, ${score.items.length} phrases), deterministic, live`);
