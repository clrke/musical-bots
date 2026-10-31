// The Muse Code director without Muse (no model, no network, no cost):
//   1. emit.js validation: lines, summaries, plans, events (names, markup, actions, roles);
//   2. the turnstile in-process: beat order, the queue for later beats (the lead-in first), closed
//      beats, the stanza capacity, the linger, idle agents, the song form, the chords on the lines;
//      the craft checks (craft.js: each check, calibrated on the 13 checked-in bundles), the bypass
//      and its limits, the craft modes, the answers to consultations, the first-person summaries;
//   3. the orchestrator (direct.js) against the stub Muse (scripts/director/stub-muse.js): seven
//      concurrent crew processes through the real emit command; the bundle validates, plays in beat
//      order, t is the real timeline, director.json records the run; a crew that stalls is stopped by
//      the watchdog and a repair run resumes it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.MB_EMIT_LINGER_S = '1';
process.env.MB_EMIT_IDLE_S = '30';
const E = await import('../scripts/director/emit.js');
const { PLAN, LINES, CUES } = await import('../scripts/director/fixture.js');
const { beatId, roleMenu, ROLES, resolveAction } = await import('../scripts/director/vocab.js');
const { direct, crewOverlay, directorPrompt, atLeast } = await import('../scripts/director/direct.js');
const STUB = new URL('../scripts/director/stub-muse.js', import.meta.url).pathname;
const VALIDATE = new URL('../scripts/validate-bundle.js', import.meta.url).pathname;
const tmp = (p) => mkdtempSync(join(tmpdir(), `mb-director-${p}-`));

// 1. validation ---------------------------------------------------------------------------------
const lp = (l, ctx = {}) => E.lineProblems(l, { section: 'verse1', singer: 'Green', roles: PLAN.roles, ...ctx });
assert.deepEqual(lp('{Gold:gasp} counts every cent >> Twice!'), []);
assert.deepEqual(lp('[And] {Purple:preen} rolls up next door >> Uh-oh!'), []);
assert.ok(lp('{Purple:preen} parks his truck >> So shiny!').some((p) => /example song/.test(p)), 'a copied example line is refused');
assert.deepEqual(lp('We sing for the soup'), [], 'the cast sings together: "we" is welcome');
assert.deepEqual(lp('Our soup is hot for us >> Yum!'), [], '"our" and "us" too');
// a colour word is no name: the Capitalised word is the bot, the colour stays a colour
assert.deepEqual(lp('I paint the fence bright gold >> So gold!'), [], 'a colour in a reply names nobody');
assert.deepEqual(lp('A cup >> Gold glow!'), [], 'a colour opening a reply, before a noun, is the colour');
assert.ok(!lp('{Green} and {Blue} sing blue songs').some((p) => /two names/.test(p)), 'two names, the colour aside');
assert.ok(lp('Green, Blue and Gold sing').some((p) => /two names/.test(p)), 'three Capitalised names are three names');
assert.deepEqual(lp('Green and Blue see the blue sky'), [], 'two names and a colour');
assert.ok(lp('Gold will pour the soup').some((p) => /lyric rule/.test(p)), 'future tense');
assert.ok(lp('{Bob} stirs the pot').some((p) => /not a bot/.test(p)), 'unknown name');
assert.ok(lp('{Gold:dance} stirs the pot').some((p) => /not a cue/.test(p)), 'unknown cue act');
assert.ok(lp('Soup in the [Oh] pot').some((p) => /Pickup/.test(p)), 'pickup mid-line');
assert.ok(lp('I see a boy at my sink >> Aww!', { section: 'bridge', singer: 'Gold' }).some((p) => /no " >> replies"/.test(p)), 'no replies in a bridge');
assert.ok(lp('I bring a cup of soup >> Yum!', { singer: 'Navy' }).some((p) => /echo/.test(p)), 'the pal gets no reply');
assert.ok(lp('A cup >> Gold says so!').some((p) => /names nobody/.test(p)), 'a reply names nobody');
assert.ok(lp('Blue opens the box >> Wow!').some((p) => /box/.test(p)), '"box" alone');
assert.deepEqual(lp('I open the toy box lid >> Wow!'), []);
assert.ok(lp('Blue opens the toy box >> Wow!').some((p) => /ends on a \/ks\/ sound/.test(p)), 'a final /ks/ blurs');
assert.ok(lp('I want a bowl of soup and a spoon and a napkin too').some((p) => /syllables/.test(p)), 'too long');
// the generator's own gates (web/src/gen/lyrics.js), reused: 2-7 sung syllables, replies 1-5
assert.ok(lp('I want a bowl of hot soup now').some((p) => /2-7/.test(p)), 'eight syllables');
assert.ok(lp('Hot soup >> Oh my goodness gracious me').some((p) => /1-5/.test(p)), 'a six-syllable reply');
assert.deepEqual(lp('The dragon has the fun'), [], 'the voice engine sings "has" (it used to crash)');
assert.deepEqual(lp('I get the soup'), [], '"get" too');
assert.deepEqual(lp('I sit there, getting cold'), [], '"getting" is fine');
{
  const { lineProblems: gen } = await import('../web/src/gen/lyrics.js');
  for (const st of LINES) for (const l of st.filter((x) => x.lyric)) assert.deepEqual(gen(l.lyric), [], `the fixture passes the generator's gate: ${l.lyric}`);
}
assert.deepEqual(E.summaryProblems('White picks the chords for the hook'), []);
assert.ok(E.summaryProblems('White will pick the chords').length, 'summary future');
assert.ok(E.summaryProblems('').length);

const good = E.validateBeats(PLAN, { seed: 'muse-hot-soup' });
assert.deepEqual(good.errors, []);
assert.equal(good.beats.version, 2);
assert.equal(good.beats.beats.length, 11);
assert.equal(good.beats.beats[3].id, 'beat-4-chorus1');
const bad = E.validateBeats({ ...PLAN, roles: { lead: 'Green', pal: 'Green', grown: 'Bob' }, beats: PLAN.beats.slice(0, 5) }, { seed: 's' });
assert.ok(bad.errors.some((e) => /grown/.test(e)) && bad.errors.some((e) => /four different/.test(e)) && bad.errors.some((e) => /exactly 11/.test(e)));
const noLead = E.validateBeats({ ...PLAN, beats: PLAN.beats.map((b, i) => (i === 1 ? { ...b, cast: ['Navy', 'Gold'] } : b)) }, { seed: 's' });
assert.ok(noLead.errors.some((e) => /must include the lead/.test(e)));

assert.deepEqual(good.beats.tags, { bridge: 'tender', outro: 'conclusive' }, 'tags.outro defaults to conclusive');
assert.equal(E.validateBeats({ ...PLAN, prompt: 'something else' }, { prompt: PLAN.prompt, seed: 's' }).beats.prompt, PLAN.prompt, "the run's prompt wins over the model's");
assert.ok(E.validateBeats({ ...PLAN, tags: { bridge: 'tender', outro: 'loud' } }, { seed: 's' }).errors.some((e) => /tags.outro/.test(e)));
// the director's checked facts (web research / fact sheet) ride along in the plan and reach the crew
{
  const withFacts = E.validateBeats({ ...PLAN, facts: ['The finals are on Nov 9 (dev.meta.ai).', '', 7] }, { seed: 's' });
  assert.deepEqual(withFacts.beats.facts, ['The finals are on Nov 9 (dev.meta.ai).']);
  assert.equal('facts' in E.validateBeats(PLAN, { seed: 's' }).beats, false, 'no facts, no key');
  const D = await import('../scripts/director/direct.js');
  assert.match(D.researchText({ web: true }), /web_search/);
  assert.equal(D.researchText({ web: false }), '');
  // the project's repository, read-only (on by default, --no-repo): the director may tell a premise about the project from its git history
  assert.match(D.repoText({ repo: '/r' }), /git -C "\$MB_REPO" log[\s\S]*Read only: never write/);
  assert.equal(D.repoText({}), '');
  assert.match(D.directorPrompt({ prompt: PLAN.prompt, emit: '/x/emit', repo: '/r' }), /The project itself \(read-only/);
  assert.doesNotMatch(D.directorPrompt({ prompt: PLAN.prompt, emit: '/x/emit' }), /The project itself/);
  assert.match(D.crewOverlay({ prompt: PLAN.prompt, emit: '/x/emit', repo: '/r' })['green-lyrics'].prompt, /`\/r` \(`\$MB_REPO`\) is readable, read-only/);
  assert.doesNotMatch(D.crewOverlay({ prompt: PLAN.prompt, emit: '/x/emit' })['green-lyrics'].prompt, /MB_REPO/);
}
{ // a line's chords without White: the song form's own (the arranger's choice for this seed and these tags)
  const { chooseStyle, styleRomans, chordName } = await import('../web/src/gen/form.js');
  const { sectionChords } = await import('../scripts/director/vocab.js');
  assert.deepEqual(sectionChords('bridge2', good.beats.tags, 'muse-hot-soup'), styleRomans(chooseStyle('muse-hot-soup', good.beats.tags), 'bridge2').map(chordName));
}
const beats = good.beats;
const pe = (raw) => E.prepareEvent(raw, { beats }).errors;
assert.deepEqual(pe({ agent: 'chords', beat: 'beat-1-intro', summary: 'White sets the key', chords: ['C', 'G', 'Am', 'F'], action: 'conductor' }), []);
assert.ok(pe({ agent: 'chords', bot: 'Gold', beat: 'beat-1-intro', summary: 'White sets the key' }).some((e) => /embodied by White/.test(e)));
assert.ok(pe({ agent: 'hype', beat: 'beat-1-intro', summary: 'Yellow cheers', action: 'moonwalk' }).some((e) => /not in the vocabulary/.test(e)));
assert.ok(pe({ agent: 'hype', beat: 'beat-1-intro', summary: 'Yellow cheers', action: 'lights-gold' }).some((e) => /Blue/.test(e)));
assert.ok(pe({ agent: 'lighting', beat: 'beat-1-intro', summary: 'Blue glows', action: 'wave' }).some((e) => /lights only/.test(e)));
assert.ok(pe({ agent: 'lighting', beat: 'beat-1-intro', summary: 'Blue glows', action: 'lights-purple' }).some((e) => /mood/.test(e)));
assert.ok(pe({ agent: 'comedy', beat: 'beat-1-intro', summary: 'Pink sings', lyric: 'Soup for me today' }).some((e) => /only Green/.test(e)));
assert.ok(pe({ agent: 'deals', beat: 'beat-1-intro', summary: 'Gold asks', status: 'consulting' }).some((e) => /consult/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Green writes', lyric: 'Soup for {Gold} today', singer: 'Silver' }).some((e) => /not on stage/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Green writes', lyric: '{Green:peer} spies soup steam' }).some((e) => /says "we"/.test(e)), 'the lead sings "we"');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Green writes', lyric: 'Green slips near the door' }).some((e) => /says "we"/.test(e)), 'a plain name too');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Green writes', lyric: "Gold's soup is extra", singer: 'Gold' }).some((e) => /says "we"/.test(e)), 'and its possessive');
assert.deepEqual(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Green writes', lyric: '{Gold} counts every cent >> Twice!' }), [], 'naming another bot is fine');
assert.deepEqual(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Green writes', lyric: 'We paint the soup pot gold', singer: 'Gold' }), [], 'the singer\'s own colour, lower case, is no self-naming');
assert.deepEqual(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Green writes', lyric: 'Gold glow on the frosty street', singer: 'Gold' }), [], 'nor the colour opening a line before a noun');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Green writes', lyric: 'Gold counts every cent', singer: 'Gold' }).some((e) => /says "we"/.test(e)), 'the Capitalised name before its verb is');
// the plain present: the obvious pasts are refused, present uses of participles are not
assert.ok(lp('I held the cake up tall').some((p) => /past tense/.test(p)));
assert.ok(lp('It tipped and dropped').some((p) => /"tipped" is past/.test(p)));
assert.ok(lp('{Gold} counted every cent').some((p) => /past tense/.test(p)));
assert.deepEqual(lp("This one's got potential"), [], '"got" in the present');
assert.deepEqual(lp('I need a bowl of soup'), [], '"need" is not a past');
assert.ok(lp('{Gold} painted the sign').some((p) => /past tense/.test(p)), 'the Capitalised name is a subject');
assert.deepEqual(lp('A gold painted sign >> Wow!'), [], 'the colour word is no subject: "painted" is an adjective here');
{ // the colour names are words the speller sings right: a line ending on one rhymes as it sounds
  const { rhymes, rhymeOf } = await import('../scripts/director/rhyme.js');
  assert.ok(rhymeOf('We wave to Gold') && rhymes('We wave to Gold', 'The soup is cold'), 'Gold / cold');
  assert.ok(rhymes('The sky turns blue', 'A cup for you'), 'blue / you');
  assert.ok(!rhymes('The sky turns blue', 'The cake is warm'), 'a colour word is no free pass');
  assert.ok(!rhymes('We wave to Green', 'The soup is cold'), 'nor a name');
}
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Green writes', lyric: 'Soup today', mood: 'x' }).some((e) => /unknown field/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-99', summary: 'Green writes', lyric: 'Soup today' }).some((e) => /beat must be/.test(e)));
const walk = E.prepareEvent({ agent: 'dance', beat: 'verse1', summary: 'Gray walks Green over', action: 'walk-to-gold' }, { beats });
assert.deepEqual(walk.errors, []);
assert.equal(walk.event.action, 'walk-to-Gold', 'a walk target is canonicalized');
assert.equal(walk.event.beat, 'beat-2-verse1', 'a section name resolves to its beat');
// every role's menu resolves in actions.js (the prompts list them)
for (const r of ROLES) for (const id of roleMenu(r)) assert.notEqual(resolveAction(id.replace('<Bot>', 'Gold')).kind, 'none', `${r} menu: ${id}`);
{ // the menus offer only the choreographed hand plays (actions.js PLAY_PRIORITY), every one of them
  const { PLAY_PRIORITY } = await import('../web/src/actions.js');
  const offered = new Set(ROLES.flatMap((r) => roleMenu(r)).filter((id) => resolveAction(id).kind === 'play'));
  assert.ok([...offered].every((id) => PLAY_PRIORITY.includes(id)), 'a fallback-only play is offered');
  assert.deepEqual(PLAY_PRIORITY.filter((id) => !offered.has(id)), [], 'every choreographed play is offered to a role');
}

assert.deepEqual(['low', 'medium', 'high', 'max'].map((e) => atLeast(e, 'high')), ['high', 'high', 'high', 'max'], 'Green thinks at least hard');

// 2. the turnstile, in-process -----------------------------------------------------------------
{
  const dir = tmp('turnstile');
  let clock = 1_000_000;
  const now = () => clock;
  const opts = (agent) => ({ as: agent, linger: 1, now });
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now }).status, 'ok');
  E.status(dir, 'chords', { now }); E.status(dir, 'lyrics', { now }); // both registered at beat 1
  const stanza = (i) => LINES[i].filter((l) => l.lyric).map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l }));
  clock += 10_000;
  // a later beat queues: valid, kept, nothing appended yet
  let r = await E.emitEvents(dir, stanza(1).slice(0, 1), opts('lyrics'));
  assert.equal(r.status, 'queued', r.message);
  assert.match(r.message, /QUEUED: 1 event for beat-2-verse1/);
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(1), summary: 'Gray, I darken the verse', chords: ['Am', 'F', 'C', 'G'], action: 'conductor' }, opts('chords'));
  assert.equal(r.status, 'queued');
  assert.equal(E.readEvents(dir).length, 0);
  // a resend is a no-op; a queued line is checked now: a fifth verse line is refused at once
  r = await E.emitEvents(dir, stanza(1).slice(0, 1), opts('lyrics'));
  assert.match(r.message, /already sent/);
  r = await E.emitEvents(dir, stanza(1).slice(1), opts('lyrics'));
  assert.equal(r.status, 'queued', r.message);
  r = await E.emitEvents(dir, { agent: 'lyrics', beat: beatId(1), summary: 'White, one more line here', lyric: 'One more cold line' }, opts('lyrics'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /already has its 4 lines/);
  // the open intro: White's chords, then Green's stanza (the lines take White's chords)
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(0), summary: 'Blue, I pick a cold key', chords: ['C', 'G', 'Am', 'F'], action: 'conductor' }, opts('chords'));
  assert.equal(r.status, 'ok', r.message);
  clock += 2_000;
  r = await E.emitEvents(dir, stanza(0), opts('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  // the intro is complete and everyone has moved on: it closes, and verse1's queue lands (the lead-in first)
  let ev = E.readEvents(dir);
  assert.deepEqual(ev.map((e) => `${e.agent}:${e.beat}`), ['chords:beat-1-intro', 'lyrics:beat-1-intro', 'lyrics:beat-1-intro', 'chords:beat-2-verse1',
    'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1']);
  assert.deepEqual(ev[1].chords, ['C', 'G', 'Am', 'F'], "the intro takes White's intro chords");
  assert.deepEqual(ev[4].chords, ['Am', 'F', 'C', 'G'], "the queued verse line takes the verse chords that led it");
  assert.equal(ev[1].singer, 'Green', 'the lead sings by default');
  assert.equal(ev[0].t, 10, 't is real seconds since t0');
  assert.equal(ev[4].t, 12, 'a queued event is timed when it lands');
  assert.equal(E.readState(dir).open, 1);
  // the closed intro refuses late work
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(0), summary: 'Green, I am late', chords: ['C'] }, opts('chords'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /closed/);
  // verse1 landed whole from the queue; Gray is still on it, so the complete beat lingers, then closes
  assert.equal(E.readEvents(dir).filter((e) => e.beat === beatId(1) && e.lyric).length, 4);
  E.status(dir, 'dance', { now });
  assert.equal(E.readState(dir).open, 1, 'Gray is still on verse1');
  assert.match(E.status(dir, 'lyrics', { now }).message, /OPEN BEAT: beat-2-verse1[\s\S]*Lines 4\/4[\s\S]*waiting on: White, Gray/);
  clock += 1_500;
  E.status(dir, null, { now });
  assert.equal(E.readState(dir).open, 2, 'the linger is over');
  // an agent silent longer than IDLE_S is not waited for
  E.status(dir, 'comedy', { now });
  clock += (E.IDLE_S + 1) * 1000;
  r = await E.emitEvents(dir, stanza(2), opts('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  r = await E.emitEvents(dir, stanza(3).slice(0, 1), opts('lyrics'));
  assert.equal(r.status, 'ok', 'verse1b closed at once: Pink and Gray are idle');
  // a play the stage has no choreography for still lands, with a note naming the real ones
  r = await E.emitEvents(dir, { agent: 'deals', beat: beatId(3), summary: 'Green, I bet a cracker on it', action: 'thumb-war', consult: ['Green'] }, opts('deals'));
  assert.match(r.message, /NOTE: thumb-war has no choreography yet[\s\S]*handshake, high-five/);
  // the orchestrator's finalize lands what is queued for the open beat
  r = await E.emitEvents(dir, { agent: 'hype', beat: beatId(4), summary: 'Gray, I call the next round', action: 'cheer' }, opts('hype'));
  assert.equal(r.status, 'queued');
  assert.deepEqual(E.finalize(dir, { now }), { landed: 0, dropped: 1 }, 'beat 5 never opened: its queue is dropped');
}

// the song form: chorus 1 = Hook X Hook Y, chorus 2 the same words, chorus 3 turns the last line
{
  const evs = [];
  const push = (i, lyrics) => lyrics.forEach((l) => evs.push({ seq: evs.length, beat: beatId(i), lyric: l, agent: 'lyrics' }));
  push(0, ['Steam on a frosty street >> Brr!', 'x']);
  assert.match(E.formProblems(beats, evs, 3, 0, 'Cold soup, cold soup!').join(), /the hook/);
  assert.deepEqual(E.formProblems(beats, evs, 3, 0, '[Oh,] Hot soup, hot soup! >> Yum!'), [], 'cues, pickups and replies may change');
  push(3, ['Hot soup, hot soup!', 'A bowl to warm my nose', 'Hot soup, hot soup!', 'Steam on my ten toes']);
  assert.match(E.formProblems(beats, evs, 6, 1, 'A bowl to warm my feet').join(), /chorus 1's words/);
  assert.deepEqual(E.formProblems(beats, evs, 6, 1, 'A bowl to warm my nose >> Achoo!'), []);
  assert.match(E.formProblems(beats, evs, 9, 3, 'Steam on my ten toes').join(), /turned line/);
  assert.deepEqual(E.formProblems(beats, evs, 9, 3, 'Free soup, from me to those'), []);
  assert.match(E.formProblems(beats, evs, 10, 1, 'A warm and sunny street').join(), /callback/);
  // rhymes: a verse's lines 2 and 4, chorus 1's Y and chorus 3's turned line against X
  push(1, ['I want a bowl of soup', 'My hands are icy cold', '{Gold:harrumph} taps the price']);
  assert.match(E.formProblems(beats, evs, 1, 3, 'Two coins for a cup').join(), /"cold" and "cup" do not rhyme/);
  assert.deepEqual(E.formProblems(beats, evs, 1, 3, "That's extra, good as gold!"), []);
  assert.match(E.formProblems(beats, evs, 3, 3, 'Steam on my ten fingers').join(), /do not rhyme/, 'chorus Y rhymes with X');
  push(9, ['Hot soup, hot soup!', 'A bowl to warm my nose', 'Hot soup, hot soup!']);
  assert.match(E.formProblems(beats, evs, 9, 3, 'Free soup for everyone').join(), /turned line rhymes with X/);
}

// 2b. the craft checks (craft.js): each check, bypassable, calibrated on the checked-in bundles ---
const C = await import('../scripts/director/craft.js');
const { has: inTable } = await import('../web/src/mv/voice/text/cmudict.js');
const checksOf = (l, ctx = {}) => C.lineCraft(l, { section: 'verse1', pos: 0, ...ctx }).map((f) => (f.severity === 'note' ? `${f.check}?` : f.check));
{
  // dictionary: the singer's table, the dictionary's other words its rules sing right, the lexicon,
  // the overrides, the regular forms it sings consistently, the cast; nothing else
  assert.ok(C.knownWord('soup') && C.knownWord('Soup'), 'a table word');
  assert.ok(!inTable('curb') && C.knownWord('curb'), 'a dictionary word outside the table that the letter rules sing right (knownWords.js)');
  assert.ok(C.knownWord('hackathon') && !inTable('hackathon'), 'a lexicon exception (sung hack-uh-thon)');
  assert.ok(C.knownWord('Meta') && C.knownWord("Meta's"), 'the override and the lexicon possessive');
  assert.ok(C.knownWord('Gold') && C.knownWord("Blue's") && C.knownWord('Lilac'), 'cast names and their possessives');
  assert.ok(C.knownWord('wobbles') && C.knownWord('munches') && C.knownWord('happier'), 'regular forms of known words, sung as stem + ending');
  assert.ok(!C.knownWord('ladle'), 'in the dictionary, but the singer sings "lad-le"');
  assert.ok(!C.knownWord('strolling'), 'a form the singer bends ("strah-ling")');
  assert.ok(C.knownWord('llama') && C.knownWord('forgiving') && C.knownWord('hackathons'), 'fixed by the cmudict overrides (the check found them)');
  assert.ok(!C.knownWord('rawr') && !C.knownWord('glowy'), 'not in the dictionary at all');
  assert.deepEqual(C.unknownWords('I count to 10').map((x) => x.why), ['digits']);
  assert.deepEqual(C.unknownWords('The AI sings').map((x) => x.why), ['acronym']);
  assert.ok(C.unknownWords('A café song').some((x) => x.why === 'letters'));
  assert.deepEqual(checksOf('I see a ladle >> Rawr!'), ['dictionary'], 'the reply is sung too');
  assert.deepEqual(C.lineCraft('I see a ladle >> Rawr!', { allow: new Set(['ladle', 'rawr']) }), [], 'words an earlier bypass accepted');
  assert.deepEqual(C.lineCraft('I see a ladle >> Rawr!')[0].words, ['ladle', 'rawr']);
  // rhyme quality: the same word is no rhyme; a near rhyme or the same syllable is a note
  const pair = (a, b) => checksOf(b, { pos: 3, stanza: ['x', a, 'y'] });
  assert.deepEqual(pair('I sing all day', 'I hear the day'), ['rhyme'], 'day / day (and no second report as a repeat)');
  assert.deepEqual(pair('I drink a cup', 'I see a cop'), ['rhyme?'], 'cup / cop: a near rhyme');
  assert.deepEqual(pair('I sit inside', 'I play outside'), ['rhyme?'], 'inside / outside: the same last syllable');
  assert.deepEqual(pair('A pup sits near', 'The kids can hear'), [], 'near / hear rhyme (the dictionary splits the vowel before r)');
  assert.deepEqual(pair('I want a bowl of soup', 'I eat with my group'), [], 'a true rhyme');
  // meter: four stressed syllables in a row stomp (the singer's stress, its light words skipped)
  assert.deepEqual(checksOf('Sun fills big kitchen'), ['meter']);
  assert.deepEqual(checksOf('The sun fills the kitchen'), []);
  assert.equal(C.stressRun('Sharp teeth chew through meat').run, 4, '"through" neither counts nor breaks the run');
  assert.equal(C.stressRun('No note comes through the door').run, 2);
  // balance: a rhyme pair sings alike
  assert.deepEqual(pair('It shines', 'I see the moon tonight and sing on high'), ['balance']);
  assert.deepEqual(pair('A bowl to warm my nose', 'Steam on my ten toes'), []);
  // filler: padding, but not a meaning, a catchphrase, a pickup or the pal's reply
  assert.deepEqual(checksOf('The inbox stays so tight'), ['filler']);
  assert.deepEqual(C.fillerWords('The lid holds kind of tight'), ['kind of']);
  assert.deepEqual(C.fillerWords('I do love the cake'), ['do love']);
  assert.deepEqual(C.fillerWords('The red pot holds a lot'), ['a lot']);
  for (const ok of ['I bake it just for you', 'Just my luck, it rains', 'Really? Wow, a cake!', '[So] I sing >> So bright!', 'So I sing a song']) {
    assert.deepEqual(C.fillerWords(ok), [], ok);
  }
  // inversion: word order bent for the rhyme (the owner's example first)
  for (const bad of ['Each miss earns the name strong', 'He barks at pigeons near', 'Cake I eat', 'Down the hill I run', 'Sweet is the cake']) {
    assert.ok(checksOf(bad).includes('inversion'), bad);
  }
  for (const ok of ['I paint the fence gold', 'I hold the rope tight', 'The cake I bake', 'Each day I sing', 'Off I go', 'I watch and I learn', 'Steam rises, thick and hot']) {
    assert.equal(C.inversionOf(ok), null, ok);
  }
  // repeat: a content word in two lines of a stanza, the hook's words and a deliberate parallel aside
  assert.deepEqual(checksOf('The truck goes fast', { pos: 2, stanza: ['I want a red truck', 'It rolls down the hill'] }), ['repeat']);
  assert.deepEqual(checksOf('The truck goes fast', { pos: 2, stanza: ['I want a red truck', 'x'], hook: 'Red truck, red truck!' }), [], 'the hook aside');
  assert.deepEqual(checksOf('I fear the cold', { pos: 2, stanza: ['x', 'I fear the dark'] }), [], 'an anaphora is deliberate');
  // a line the song form fixes is checked where it is first written: here only its reply
  assert.deepEqual(checksOf('Sun fills big kitchen >> Rawr!', { section: 'chorus2', pos: 1 }), ['dictionary']);
  // the plan's hook: never bypassed; the premise's own words are accepted (and reported)
  assert.deepEqual(C.hookCraft('Flurbo, flurbo!', { allow: C.premiseWords('The bots meet a flurbo') }), []);
  assert.deepEqual(C.hookCraft('Flurbo, flurbo!').map((f) => f.check), ['dictionary']);
  assert.deepEqual(C.summaryCraft('I hum with the ladle').map((f) => f.check), ['dictionary']);
  // calibration: on the 13 checked-in director bundles (546 lines) every check rejects at most ~15% of
  // the lines (measured: dictionary 4.6%, meter 2.0%, filler 3.3%, repeat 3.3%, balance 0.7%,
  // inversion 0.2%, rhyme 0%), and the weak lines it was tuned on are among them
  const root = new URL('../episodes', import.meta.url).pathname;
  const per = Object.fromEntries(C.CHECKS.map((c) => [c, 0]));
  let total = 0;
  const flagged = new Set();
  for (const slug of (await import('../web/src/curated.js')).SEEDS.map(([s]) => s)) {
    const b = JSON.parse(readFileSync(join(root, slug, 'beats.json'), 'utf8'));
    const ev = readFileSync(join(root, slug, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const r of C.bundleCraft(b, ev)) {
      total++;
      for (const f of r.findings.filter((x) => x.severity === 'reject')) { per[f.check]++; flagged.add(`${f.check}: ${r.lyric.replace(/ >>.*/, '')}`); }
    }
  }
  assert.equal(total, 546);
  for (const [c, n] of Object.entries(per)) assert.ok(n / total <= 0.15, `${c} rejects ${n} of ${total} lines`);
  // the weak lines the checks were tuned on (the Oct 29 bundles, re-directed since under these checks), on their own
  for (const [check, line] of [['filler', 'The inbox stays so tight'], ['meter', 'Sun fills big kitchen'], ['inversion', 'He barks at pigeons near'],
    ['dictionary', 'I hold my ladle tight'], ['meter', 'Soft tones suit this old street'], ['filler', 'The lid holds kind of tight']]) {
    assert.ok(checksOf(line).includes(check), `${check}: ${line}`);
  }
  assert.ok(checksOf('Chalk dust, pounding feet', { pos: 2, stanza: ['Fast feet slap the street', 'x'] }).includes('repeat'), 'repeat: Chalk dust, pounding feet');
  void flagged;
}

// 2c. the bypass, its limits, the modes, the answers, the sung thoughts (in-process) ----------------
{
  // a summary: the team's sung thought, in "we" (the making-of sings it)
  const sp = (s, bot = 'White') => E.summaryProblems(s, { voice: 'we', bot });
  assert.deepEqual(sp('We ask Green where the hook lands'), []);
  assert.deepEqual(sp('We put a gold spot on Purple', 'Blue'), []);
  assert.deepEqual(sp('Our chords lift the chorus'), []);
  assert.deepEqual(sp('Gold, we count the coins', 'Gold'), [], 'calling the bot by name is fine');
  assert.deepEqual(sp('We stack the gold coins', 'Gold'), [], 'its colour word is no self-naming');
  assert.match(sp('White asks Green where the hook lands').join(), /in "we", never "White/);
  assert.match(sp('I ask Green where the hook lands').join(), /in "we", never "I"/);
  assert.match(sp('We hand Gold my baton').join(), /never "I" or "my"/);
  assert.match(sp('The hook lands on soup').join(), /in "we"/);
  assert.match(sp('We ask Green where the hook lands and which chord fits').join(), /sings 11 syllables: a thought is short/);
  assert.match(sp('We picked the chords').join(), /"picked" is past tense/);
  assert.match(sp('We will pick the chords').join(), /future/);
  assert.equal(E.summaryVoice({ summaries: 'we' }), 'we');
  assert.equal(E.summaryVoice({ summaries: 'first-person' }), 'I');
  assert.equal(E.summaryVoice({}), null);
  // the Oct 29-30 bundles: each bot's own "I" (they pass the gate as they are)
  const spI = (s, bot = 'White') => E.summaryProblems(s, { firstPerson: true, bot });
  assert.deepEqual(spI('I ask Green where the hook lands'), []);
  assert.match(spI('White asks Green where the hook lands').join(), /own "I", never "White/);
  assert.match(spI('I picked the chords').join(), /"picked" is past tense/);
  assert.deepEqual(E.summaryProblems('White picks the chords for the hook'), [], 'a bundle from before the sung thoughts keeps its third person');
  // since Oct 31 ("talk"): the crew talking to each other as they work, in character, never to the viewers
  const tp = (s, bot = 'White', extra = {}) => E.summaryProblems(s, { voice: 'talk', bot, ...extra });
  assert.equal(E.summaryVoice({ summaries: 'talk' }), 'talk');
  for (const [s, bot] of [['Green, is the hook on soup?', 'White'], ['Blue, dim it for the last verse', 'Gray'], ['Gold, can we squeeze in a bar?', 'White'],
    ['Nice one, Pink!', 'Yellow'], ['Ooh, let me try a softer one', 'Blue'], ['Try a soft D minor, Green', 'White'], ["Let's count it in eights, Yellow", 'Gray'],
    ["I think it's too bright, White", 'Blue'], ['We stack the gold coins, Pink', 'Gold'], ['Gray, the beat drops here', 'Yellow']]) assert.deepEqual(tp(s, bot), [], s);
  for (const s of ['Look at us, everyone!', 'Hello, audience!', 'Folks, here comes the hook', 'Green, watch this', 'Pink, the show starts now', 'Blue, the camera loves us',
    'Kids, sing along with Gold', 'Gray, this episode is fun', 'You all love the hook, Pink', 'Gold, the viewers cheer']) {
    assert.match(tp(s).join(), /never break the fourth wall/, s);
  }
  assert.match(tp('White, I set the key').join(), /summary names White, the one saying it: you are White/);
  assert.deepEqual(tp('I set the key, Gold'), [], 'its own "I" is fine in talk');
  assert.match(tp('Gold, oh Gold, one more bar?').join(), /names Gold twice/);
  assert.deepEqual(tp('Green, what is the price, Gray?', 'Gold'), [], 'two crewmates, each once');
  assert.match(tp('Where does the hook land?', 'White', { status: 'consulting', consult: ['Green'] }).join(), /a question names the bot it asks: say it to Green/);
  assert.deepEqual(tp('Green, where does it land?', 'White', { status: 'consulting', consult: ['Green'] }), []);
  assert.match(tp('Blue, I picked the chords').join(), /"picked" is past tense: talk in the present/);
  assert.match(tp('Green, where does the hook land in the big chorus?').join(), /sings 11 syllables: what you say is short/);
  assert.match(tp('White, is G too bright here?', 'Green').join(), /copies an example from the prompt/, 'the prompts\' examples are not copied');
  assert.match(tp('Ooh, frosty blue for the street! Too cold?', 'Blue').join(), /copies an example/, 'an "Ooh" dropped is still a copy');
  assert.match(tp('Pink, how big do we go at the end?', 'Gray').join(), /copies an example/, 'another name is still a copy');
  assert.match(tp('Navy, we join in now', 'Green').join(), /talks to Navy, who is in the story, not on the crew/);
  assert.deepEqual(tp('Gold, Navy joins in now', 'Green'), [], 'talking about the story cast is the work');
  assert.match(tp('').join(), /what you say to a crewmate/);
  // most of an agent's summaries talk to a crewmate: by name, a reaction, an answer (its consult outside a question)
  assert.equal(E.talks({ summary: 'Nice one, Pink!', bot: 'Yellow' }), true);
  assert.equal(E.talks({ summary: 'Gray, the beat drops here', bot: 'Yellow' }), true);
  assert.equal(E.talks({ summary: 'We count the dance in eights', bot: 'Gray' }), false);
  assert.equal(E.talks({ summary: 'Gray counts it, Gray', bot: 'Gray' }), false, 'its own name is nobody');
  assert.equal(E.talks({ summary: 'A gold spot on Purple', bot: 'Blue' }), false, 'the story cast and a colour are no crewmates');
  assert.equal(E.talks({ summary: "Let's go big for the end", bot: 'Yellow', consult: ['Gray'] }), true, 'an answer, a deal');
  const t = (summary) => ({ summary, bot: 'Gray', consult: [] });
  assert.deepEqual(E.talkProblems([], [t('We count the dance in eights')]), [], 'one plain thought of the first two');
  assert.match(E.talkProblems([t('We count the dance in eights')], [t('We spin on the hook')]).map((x) => x.message).join(), /talks to nobody[\s\S]*Ask a crewmate something[\s\S]*one in three/);
  assert.deepEqual(E.talkProblems([t('We count in eights'), t('Yellow, spin with me?')], [t('Pink, a dip here'), t('We bow')]), [], 'two of four');
  assert.deepEqual(E.talkProblems([], [t('We count in eights'), t('We bow'), t('Pink, a dip here?')]).map((x) => x.i), [1]);
  // a back-and-forth, not a formula: "<Name>, we ..." at most one in four, a name first at most half, a third dialogue
  assert.equal(E.isFormula(t('Gold, we list the tests')), true);
  assert.equal(E.isFormula(t('Gold, can we list the tests?')), false);
  assert.equal(E.isFormula(t('A gold glow, we hope')), false);
  assert.equal(E.isFormula(t('Cloudy take, huh, Yellow?')), true, 'the tag question is a formula too');
  assert.equal(E.isFormula(t('Too bright, right?')), true);
  assert.equal(E.isFormula(t('Is that too bright, Blue?')), false);
  assert.match(tp('Mind that step, Navy?', 'Gray').join(), /talks to Navy, who is in the story/);
  for (const [x, want] of [['Too bright? Let\'s try amber', true], ['Ha! That puddle gag kills me, Pink', true], ['What if Pink trips here?', true],
    ['Does this sit on the beat, White?', true], ['Gold, we list the tests', false], ['Blue, the walls glow bright', false]]) assert.equal(E.dialogue(t(x)), want, x);
  const formula = E.talkProblems([], ['Gold, we list the tests', 'Pink, does it sit?', 'Blue, we chant it loud', 'What if we go slow?', 'Yellow, we sing it out'].map(t));
  assert.deepEqual([...new Set(formula.map((x) => x.i))], [2, 4], "one formula in four (a refused one is not said)");
  assert.match(formula[0].message, /is a formula \("<Name>, we \.\.\."[\s\S]*Vary it/);
  const names = E.talkProblems([], ['Pink, is it funny?', 'Blue, too dark?', 'Gold, any cost?', 'Is that too slow, White?'].map(t));
  assert.deepEqual(names.map((x) => x.i), [2]);
  assert.match(names[0].message, /opens on a name again/);
  // no prefix formula either: "Yes! ...", "Ha! ...", "Good! ..." in turn (run 4's Green), and a real share of questions
  const prefixed = E.talkProblems([], ['Does this sit, White?', 'Yes! We chant it stronger', 'Ha! Louder still', 'Is it big, Gold?', 'Yes! They beg for more',
    'Good! We lift it', 'Can we go slow, Pink?', 'Ha! Late nights test us', 'Yes! That bump rings true'].map(t));
  assert.match(prefixed.map((x) => x.message).join('\n'), /opens on a reaction \("Yes!", "Ha!", "Good!"\) again/);
  assert.match(E.talkProblems([t('Yes! Keep it')], [t('Yes! Louder')]).map((x) => x.message).join(), /opens with "yes" again/);
  assert.deepEqual(E.talkProblems([t('Is it too fast, White?')], [t('Is it too slow, Blue?')]), [], 'questions may start alike');
  assert.match(E.talkProblems(['We bow', 'Ooh, a dip here', 'Nice one, Pink!'].map(t), [t('Let\'s spin it round')]).map((x) => x.message).join(), /you ask too little/);
  const flat = E.talkProblems([], ['Pink, the slip lands here', 'Blue, the walls glow bright', 'Gold, the coins stack up'].map(t));
  assert.match(flat.map((x) => x.message).join(), /too few of yours are dialogue/);
  assert.match(E.talkProblems([t('Pink, we press and sing')], [t('Pink, we press and sing!')]).map((x) => x.message).join(), /you said that already/);

  const fresh = (craft = 'strict', plan = PLAN) => {
    const dir = tmp(`craft-${craft}`);
    E.initState(dir, { prompt: plan.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: 1_000_000, craft });
    const w = E.writeBeats(dir, plan, { now: () => 1_000_000 });
    return { dir, w };
  };
  const at = (agent) => ({ as: agent, linger: 1, now: () => 1_010_000 });
  const line = (beat, lyric, summary, extra = {}) => ({ agent: 'lyrics', beat: beatId(beat), lyric, summary, ...extra });
  const { dir, w } = fresh();
  assert.equal(w.status, 'ok', w.message);
  assert.equal(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')).summaries, 'talk', 'the tool marks the summaries as the crew\'s talk');
  // a failed craft check: how to fix it and how to bypass it
  let r = await E.emitEvents(dir, line(0, 'Steam on a frosty street >> Rawr!', 'Is a frosty street okay, White?'), at('lyrics'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /\[dictionary\] the singer does not know "Rawr"[\s\S]*Fix: [\s\S]*"bypass": \{"dictionary": "<why, in at least 4 words>"\}[\s\S]*3 of 3 bypasses left/);
  r = await E.emitEvents(dir, line(0, 'Steam on a frosty street >> Rawr!', 'Is a frosty street okay, White?', { bypass: { dictionary: 'a dino roar' } }), at('lyrics'));
  assert.match(r.message, /bypass.dictionary: say why in at least 4 words/, 'a lazy reason is refused');
  r = await E.emitEvents(dir, line(0, 'Steam on a frosty street >> Rawr!', 'Is a frosty street okay, White?', { bypass: { tense: 'it reads well this way' } }), at('lyrics'));
  assert.match(r.message, /"tense" is not a craft check/, 'the hard rules never bend');
  r = await E.emitEvents(dir, line(0, 'Steam on a frosty street >> Rawr!', 'Is a frosty street okay, White?', { bypass: { dictionary: 'the roar of the toy dinosaur' } }), at('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  assert.match(r.message, /BYPASSED \(recorded on the event\): dictionary/);
  let ev = E.readEvents(dir);
  assert.deepEqual(ev[0].bypassed, [{ check: 'dictionary', reason: 'the roar of the toy dinosaur', words: ['rawr'] }]);
  let st = E.readState(dir);
  assert.equal(st.craft.bypasses.lyrics, 1);
  assert.equal(st.craft.accepted.rawr.agent, 'lyrics');
  // the word is fine for the rest of the episode: no second bypass
  r = await E.emitEvents(dir, line(0, '[And] {Gold} stirs a giant pot >> Rawr!', 'Gold comes in with a pot. Fun?'), at('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  assert.equal(E.readEvents(dir)[1].bypassed, undefined);
  // the limit: at most 3 per agent per episode
  const v1 = [line(1, 'I want a bowl of soup >> Me too!', 'He wants soup. Too plain, Pink?'), line(1, 'My hands are so cold >> So cold!', 'Can I shiver here, Blue?', { bypass: { filler: 'the shiver is the point here' } }),
    line(1, '{Gold:harrumph} taps the price >> Uh-oh!', 'Ooh, the price tag, Gold!'), line(1, 'The pot is so old! >> Aw, please?', 'This line is yours, Gold!', { singer: 'Gold', bypass: { filler: 'it is how Gold would say it' } })];
  r = await E.emitEvents(dir, v1, at('lyrics'));
  assert.notEqual(r.status, 'rejected', r.message);
  assert.equal(E.readState(dir).craft.bypasses.lyrics, 3);
  r = await E.emitEvents(dir, [line(2, '{Purple:preen} rolls up next door >> So shiny!', 'Here comes the truck. Big, Yellow?'),
    line(2, 'Ta-da! Free soup for you! >> Free soup!', 'Wow, Purple gives free soup!', { singer: 'Purple' }),
    line(2, 'The crowd hurries over >> Wait up!', 'The diner empties. Too fast?'), line(2, '[And] I sit with {Gold}, so true >> Oh no!', 'Aw, I sit with Gold', { bypass: { filler: 'Green means it truly here' } })], at('lyrics'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /event 4: \[filler\][\s\S]*You have used your 3 bypasses this episode/);
  assert.equal(E.readState(dir).craft.bypasses.lyrics, 3, 'a refused call spends nothing');
  // the hook is never bypassed
  r = await E.emitEvents(dir, [line(3, 'Hot soup, hot soup! >> Glowy!', 'Can I sing the hook, White?', { bypass: { dictionary: 'a glow word every child knows' } })], at('lyrics'));
  assert.match(r.message, /The hook line is never bypassed/);
  // the gate checks the craft record: the limit, the reason, never the hook
  const raw = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
  const by = (n, reason = 'the reason is good enough') => Array.from({ length: n }, (_, k) => ({ seq: k, beat: beatId(1), agent: 'lyrics', bot: 'Green', lyric: 'x', bypassed: [{ check: 'filler', reason }] }));
  assert.deepEqual(E.craftRecordProblems(raw, by(3)), []);
  assert.match(E.craftRecordProblems(raw, by(4)).join(), /bypassed 4 craft checks: at most 3/);
  assert.match(E.craftRecordProblems(raw, by(1, 'too short')).join(), /at least 4 words/);
  assert.match(E.craftRecordProblems(raw, [{ seq: 0, beat: beatId(3), agent: 'lyrics', lyric: 'Hot soup, hot soup!', bypassed: [{ check: 'meter', reason: 'a chant meant to stomp' }] }]).join(), /hook line is never bypassed/);
}
{
  // the plan's hook: never bypassed; the premise's own unknown word is accepted for the episode
  const plan = (hook, prompt = PLAN.prompt) => ({ ...PLAN, prompt, hook, beats: PLAN.beats });
  const d1 = tmp('hook');
  E.initState(d1, { prompt: PLAN.prompt, slug: 'x', seed: 'muse-x' });
  let w = E.writeBeats(d1, plan('Flurbo, flurbo!'));
  assert.equal(w.status, 'rejected');
  assert.match(w.message, /hook \(dictionary\): the singer does not know "Flurbo"[\s\S]*never bypassed/);
  const d2 = tmp('hook2');
  E.initState(d2, { prompt: 'The bots meet a flurbo', slug: 'x', seed: 'muse-x' });
  w = E.writeBeats(d2, plan('Flurbo, flurbo!', 'The bots meet a flurbo'));
  assert.equal(w.status, 'ok', w.message);
  assert.match(w.message, /"flurbo", the premise's own word: accepted for this episode/);
  assert.ok(E.readState(d2).craft.accepted.flurbo);
  // warn: notes only; off: nothing
  for (const mode of ['warn', 'off']) {
    const d = tmp(`mode-${mode}`);
    E.initState(d, { prompt: PLAN.prompt, slug: 'x', seed: 'muse-x', craft: mode });
    assert.equal(E.writeBeats(d, PLAN).status, 'ok');
    const r = await E.emitEvents(d, { agent: 'lyrics', beat: beatId(0), lyric: 'Sun fills big kitchen >> Rawr!', summary: 'A sunny kitchen? Nice, right?' }, { as: 'lyrics' });
    assert.equal(r.status, 'ok', r.message);
    assert.equal(/CRAFT NOTES \(warn mode: nothing refused\)[\s\S]*dictionary[\s\S]*meter/.test(r.message), mode === 'warn', r.message);
    assert.equal(E.readEvents(d)[0].bypassed, undefined);
  }
  assert.throws(() => E.initState(tmp('bad'), { craft: 'loud' }), /craft mode/);
}
{
  // answers: a consulted bot's first event after the question that names the asker back in `consult`
  const dir = tmp('answers');
  let clock = 2_000_000;
  const opts = (agent) => ({ as: agent, linger: 1, now: () => clock });
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  for (const a of ['lyrics', 'chords', 'deals']) E.status(dir, a, { now: () => clock });
  // Green queues verse1 before anyone asks him anything: that is no answer
  let r = await E.emitEvents(dir, LINES[1].filter((l) => l.lyric).map((l) => ({ agent: 'lyrics', beat: beatId(1), ...l })), opts('lyrics'));
  assert.equal(r.status, 'queued', r.message);
  clock += 1000;
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(0), summary: 'Green, where does the hook land?', chords: ['C', 'G', 'Am', 'F'], action: 'chin-stroke', status: 'consulting', consult: ['Green'] }, opts('chords'));
  assert.equal(r.status, 'ok', r.message);
  r = await E.emitEvents(dir, { agent: 'deals', beat: beatId(0), summary: 'White, what is the price?', action: 'scratch-head', status: 'consulting', consult: ['White', 'Green'] }, opts('deals'));
  assert.equal(r.status, 'ok', r.message);
  let board = E.status(dir, 'lyrics', { now: () => clock }).message;
  assert.match(board, /QUESTION FOR YOU from White \(beat-1-intro, seq 0\): "Green, where does the hook land\?"\n {4}-> Answer it in your next event/);
  assert.match(board, /QUESTION FOR YOU from Gold/);
  clock += 1000;
  r = await E.emitEvents(dir, [{ agent: 'lyrics', beat: beatId(0), summary: 'The hook lands on soup, White', action: 'fist-bump', consult: ['White'] },
    ...LINES[0].filter((l) => l.lyric).map((l) => ({ agent: 'lyrics', beat: beatId(0), ...l }))], opts('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  assert.match(r.message, /ANSWER: seq 2 answers White's question \(seq 0\)/);
  let ev = E.readEvents(dir);
  assert.deepEqual(ev.filter((e) => e.answers !== undefined).map((e) => [e.seq, e.bot, e.answers]), [[2, 'Green', 0]], 'one answer per question');
  assert.equal(ev[3].answers, undefined, 'a line that does not name Gold is no answer to him');
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /QUESTION FOR YOU from Gold[\s\S]*names Gold back in "consult"/, "Gold's question stays open");
  clock += 1000;
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(1), summary: 'Sure, Gold, we play for free', chords: ['Am', 'F', 'C', 'G'], action: 'handshake', consult: ['Gold'] }, opts('chords'));
  ev = E.readEvents(dir);
  assert.equal(ev.find((e) => e.summary === 'Sure, Gold, we play for free').answers, 1, "White answers Gold's question too");
  assert.equal(ev.filter((e) => e.agent === 'lyrics' && e.beat === beatId(1)).every((e) => e.answers === undefined), true, 'the queued verse was written before the questions');
  board = E.status(dir, 'chords', { now: () => clock }).message;
  assert.match(board, /you asked Green \(seq 0, beat-1-intro\): "Green, where does the hook land\?"; Green answers \(seq 2\): "The hook lands on soup, White"/);
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /White asked you \(seq 0\): "Green, where does the hook land\?"; you answered \(seq 2\)/);
  assert.deepEqual(E.answerProblems(ev), []);
  assert.match(E.answerProblems([{ seq: 0, bot: 'White', status: 'working', consult: [] }, { seq: 1, bot: 'Green', answers: 0 }]).join(), /no earlier consultation naming Green/);
  execFileSync(process.execPath, [VALIDATE, dir]); // the bundle's new fields validate
}
{
  // the live runs' misses, fixed: an answer queued as the beat's lead-in (White's chords) lands after
  // the question it answers (a beat's questions land first); an answer sent ahead (Pink's verse2b
  // gag, naming Green) is linked when the question lands; an event sent after a question that does
  // not name the asker (White's next beat) is no answer, the one that names him is
  const dir = tmp('answers-ahead');
  let clock = 3_000_000;
  const opts = (agent) => ({ as: agent, linger: 1, now: () => clock });
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  for (const a of ['lyrics', 'chords', 'deals', 'comedy']) E.status(dir, a, { now: () => clock });
  const send = async (agent, e) => { const r = await E.emitEvents(dir, { agent, ...e }, opts(agent)); assert.notEqual(r.status, 'rejected', r.message); return r; };
  await send('comedy', { beat: beatId(5), summary: 'Green, I slip on the soup for you', action: 'boing', consult: ['Green'] });
  await send('lyrics', { beat: beatId(4), summary: 'Pink, can you do the big gag?', action: 'chin-stroke', status: 'consulting', consult: ['Pink'] });
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /you asked Pink \(queued, beat-5-verse2\)[^\n]*Pink answers \(in beat-6-verse2b, when it opens\): "Green, I slip on the soup for you"/);
  await send('deals', { beat: beatId(2), summary: 'White, can the band play free?', action: 'chin-stroke', status: 'consulting', consult: ['White'] });
  await send('chords', { beat: beatId(2), summary: 'Okay, Gold, this one is free', chords: ['C', 'F', 'G', 'C'], action: 'handshake', consult: ['Gold'] });
  await send('chords', { beat: beatId(3), summary: 'Blue, I keep the hook bright', chords: ['C', 'G', 'Am', 'F'], action: 'conductor' });
  await send('lyrics', { beat: beatId(3), summary: 'White, a gentle key, please?', action: 'chin-stroke', status: 'consulting', consult: ['White'] });
  await send('chords', { beat: beatId(4), summary: 'Gray, the verse stays in C', chords: ['C', 'F', 'C', 'G'], action: 'conductor' });
  await send('chords', { beat: beatId(5), summary: 'I make it gentle for you, Green', chords: ['Am', 'F', 'C', 'G'], action: 'fist-bump', consult: ['Green'] });
  for (let i = 0; i <= 5; i++) {
    clock += 2000;
    const r = await E.emitEvents(dir, LINES[i].filter((l) => l.lyric).map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l })), opts('lyrics'));
    assert.notEqual(r.status, 'rejected', r.message);
  }
  clock += 2000;
  E.status(dir, null, { now: () => clock });
  const ev = E.readEvents(dir);
  const at = (s) => ev.find((e) => e.summary === s);
  assert.ok(at('White, can the band play free?').seq < at('Okay, Gold, this one is free').seq, "the beat's question lands before its lead-in");
  assert.equal(at('Okay, Gold, this one is free').answers, at('White, can the band play free?').seq);
  assert.equal(at('Blue, I keep the hook bright').answers, undefined, 'one answer per question');
  assert.equal(at('Green, I slip on the soup for you').answers, at('Pink, can you do the big gag?').seq, 'an answer sent ahead');
  assert.equal(at('Gray, the verse stays in C').answers, undefined, 'sent after the question, but it does not name Green: no answer');
  assert.equal(at('I make it gentle for you, Green').answers, at('White, a gentle key, please?').seq, 'the event that names him answers him');
  assert.deepEqual(E.answerProblems(ev), []);
}
{
  // every summary the prompts show is talk the tool accepts, said by the bot whose event it is (the crew learns from
  // them, and the tool refuses a copy); each role's own prompt shows several, all different
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../director/prompts', import.meta.url).pathname;
  const BOT_OF = { lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue', deals: 'Gold', hype: 'Yellow', comedy: 'Pink' };
  let n = 0;
  const seen = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md') && !['example.md', 'cast.md', 'README.md'].includes(x))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/"summary": "([^"]+)"/g)) {
      if (m[1].includes('...')) continue;
      n++;
      // its event: the JSON object round it (its agent, status and consult), else the role of the file
      const open = text.lastIndexOf('{', m.index), close = text.indexOf('}', m.index);
      let ev = {};
      try { ev = JSON.parse(text.slice(open, close + 1)); } catch { ev = {}; }
      const bot = BOT_OF[ev.agent ?? f.replace(/\.md$/, '')] ?? null;
      const p = E.summaryProblems(m[1], { voice: 'talk', bot, status: ev.status, consult: ev.consult ?? [] }).filter((x) => !/copies an example/.test(x));
      assert.deepEqual(p, [], `${f}: ${m[1]}`);
      assert.deepEqual(C.summaryCraft(m[1]), [], `${f}: ${m[1]}`);
      assert.ok(E.borrowedSummaries().has(E.copyKey(m[1])) || !E.copyKey(m[1]), `${f}: ${m[1]} is covered by the anti-copy gate`);
      seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    }
    assert.ok(!/in the team's "we"|in "we", the crew as one/.test(text), `${f}: the summaries are talk now, not the team's "we"`);
    // the examples in a role's summary guidance ("- `summary`: ... "Yellow, is this line too long?" ..."), its bot's
    const bullet = /\n- `summary`:([\s\S]*?)(?=\n- |\n\n)/.exec(text)?.[1];
    if (BOT_OF[f.replace(/\.md$/, '')]) {
      assert.ok(bullet, `${f}: a summary bullet`);
      const quoted = [...bullet.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ")).filter((x) => !/^(I|you|we|let's|it's)$/i.test(x));
      assert.ok(quoted.length >= 3, `${f}: ${quoted.length} examples in its summary bullet`);
      for (const x of quoted) {
        n++;
        assert.deepEqual(E.summaryProblems(x, { voice: 'talk', bot: BOT_OF[f.replace(/\.md$/, '')] }).filter((y) => !/copies an example/.test(y)), [], `${f}: ${x}`);
        assert.deepEqual(C.summaryCraft(x), [], `${f}: ${x}`);
      }
    }
  }
  assert.ok(n >= 30, `${n} example summaries`);
  for (const [x, k] of seen) assert.ok(k <= 2, `"${x}" is shown ${k} times`);
  // validate-bundle.js knows the craft checks by name
  assert.match(readFileSync(VALIDATE, 'utf8'), new RegExp(C.CHECKS.map((c) => `"${c}"`).join(', ')));
}

{
  // the emit command refuses talk to nobody (a second plain thought of the first two) and the fourth wall, with how to fix it
  const dir = tmp('talk');
  const clock = 4_000_000;
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  const send = (e) => E.emitEvents(dir, [e].flat().map((x) => ({ agent: 'dance', beat: beatId(0), ...x })), { as: 'dance', linger: 1, now: () => clock });
  let r = await send({ summary: 'We count the dance in eights', action: 'count-beats' });
  assert.equal(r.status, 'ok', r.message);
  r = await send({ summary: 'We spin on the last note', action: 'jazz-hands' });
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /REJECTED[\s\S]*"We spin on the last note" talks to nobody[\s\S]*Ask a crewmate something/);
  r = await send({ summary: 'Hello folks, Yellow spins!', action: 'jazz-hands' });
  assert.match(r.message, /"folks" speaks to the viewers: never break the fourth wall/);
  r = await send({ summary: 'Gray, I spin on the last note', action: 'jazz-hands' });
  assert.match(r.message, /summary names Gray, the one saying it/);
  r = await send([{ summary: 'Yellow, spin on the last note?', action: 'jazz-hands' }, { summary: 'Ooh, a dip for the end', action: 'count-beats' }]);
  assert.equal(r.status, 'ok', r.message);
  assert.deepEqual(E.readEvents(dir).map((e) => e.summary), ['We count the dance in eights', 'Yellow, spin on the last note?', 'Ooh, a dip for the end']);
  // --done reminds a role of its questions once (it asked none); the second --done is accepted
  r = E.markDone(dir, 'dance', { now: () => clock });
  assert.equal(r.status, 'rejected');
  const asked = await E.emitEvents(dir, { agent: 'hype', beat: beatId(0), summary: 'Can we go big here, Gray?', status: 'consulting', consult: ['Gray'], action: 'cheer' }, { as: 'hype', linger: 1, now: () => clock });
  assert.equal(asked.status, 'ok', asked.message);
  assert.match(r.message, /NOT YET: the crew talks as it works\. you asked 0 questions: ask 2 more/);
  assert.equal(E.markDone(dir, 'dance', { now: () => clock }).status, 'ok');
  r = await E.emitEvents(dir, { agent: 'hype', beat: beatId(0), summary: 'Is it a big finish, Gray?', status: 'consulting', consult: ['Gray'], action: 'cheer' }, { as: 'hype', linger: 1, now: () => clock });
  assert.match(r.message, /Gray is done and cannot answer any more: ask a crewmate still at work/);
  // the blackboard shows the recent talk to reply to, and the role's own count
  assert.match(E.status(dir, 'hype', { now: () => clock }).message, /RECENT TALK \(reply to one of these[\s\S]*Gray: "Ooh, a dip for the end"[\s\S]*your talk so far: 1 said, 1 question asked[\s\S]*done \(ask the others\): Gray/);
}

// 3. the orchestrator with the stub Muse --------------------------------------------------------
const quiet = () => {};
{
  const out = join(tmp('direct'), 'hot-soup');
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 20, timeout: 120, log: quiet });
  assert.ok(r.ok, `gate: ${r.gate.problems.join('; ')}`);
  execFileSync(process.execPath, [VALIDATE, out]);
  const ev = readFileSync(join(out, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const order = ev.map((e) => Number(e.beat.split('-')[1]));
  assert.ok(order.every((b, i) => i === 0 || b >= order[i - 1]), 'the stream is in beat order');
  assert.ok(ev.every((e, i) => e.seq === i && (i === 0 || e.t >= ev[i - 1].t)), 'seq contiguous, t non-decreasing');
  assert.equal(ev.filter((e) => e.lyric).length, 42);
  // the hook is sung together: every hook line has `with` (the fixture sets two; the tool fills the rest)
  const hooks = ev.filter((e) => e.lyric && (/chorus/.test(e.beat) || /outro/.test(e.beat)) && /^Hot soup, hot soup!/.test(e.lyric));
  assert.equal(hooks.length, 7);
  assert.ok(hooks.every((e) => e.with?.length >= 1 && e.with.length <= 2 && !e.with.includes(e.singer)), JSON.stringify(hooks.map((e) => e.with)));
  const expected = Object.values(CUES).flat().length + LINES.flat().length;
  assert.equal(ev.length, expected, 'every cue of every role landed');
  const prov = JSON.parse(readFileSync(join(out, 'director.json'), 'utf8'));
  assert.equal(prov.muse.version, '0.0.0-stub (stub)');
  assert.equal(prov.muse.model, 'stub-model');
  assert.equal(prov.muse.repo, true, 'the repository is offered (the stub read its git log through $MB_REPO)');
  assert.equal(prov.gate.ok, true);
  assert.equal(prov.perRole.lyrics.lines, 42);
  assert.ok(ROLES.every((a) => prov.perRole[a].events > 0));
  assert.ok(prov.consultations >= 2);
  assert.ok(!existsSync(join(out, '.director')), 'the scratch is cleaned up');
  const beatsOut = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));
  assert.equal(beatsOut.version, 2);
  assert.equal(beatsOut.seed, 'muse-hot-soup');
  // the sung thoughts, the craft record and the answers, through the real emit command
  assert.equal(beatsOut.summaries, 'talk');
  assert.equal(prov.craft.mode, 'strict');
  assert.deepEqual(prov.craft.bypasses.map((b) => [b.agent, b.check, b.words]), [['lyrics', 'dictionary', ['brr']]], "the fixture's one bypass");
  assert.equal(prov.craft.accepted.brr.agent, 'lyrics');
  assert.deepEqual(E.answerProblems(ev), []);
  assert.equal(prov.answers, ev.filter((e) => e.answers !== undefined).length);
}
await assert.rejects(direct(PLAN.prompt, { craft: 'loud', muse: STUB, log: quiet }), /--craft: one of strict, warn, off/);
// the overlay carries seven agent definitions whose prompts carry the live vocabulary
{
  const ctx = { prompt: PLAN.prompt, emit: '/x/emit', args: { emit: '/x/emit' } };
  const overlay = crewOverlay(ctx);
  assert.deepEqual(Object.keys(overlay).sort(), ['blue-lighting', 'gold-deals', 'gray-dance', 'green-lyrics', 'pink-comedy', 'white-chords', 'yellow-hype']);
  for (const [k, v] of Object.entries(overlay)) assert.ok(!/\{\{[A-Z_]+\}\}/.test(v.prompt), `${k}: unfilled placeholder`);
  assert.match(overlay['blue-lighting'].prompt, /`lights-gold`/);
  assert.match(overlay['pink-comedy'].prompt, /`boing`/);
  assert.match(directorPrompt(ctx), /musical-bots-crew/);
}
// a stalled crew: the watchdog stops Muse, the gate fails, the repair run resumes at the open beat
{
  const out = join(tmp('stall'), 'hot-soup');
  process.env.STUB_MUSE_STALL = '5';
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 3, timeout: 120, repo: false, log: quiet }); // --no-repo: no MB_REPO, no repository section (the stub checks)
  delete process.env.STUB_MUSE_STALL;
  assert.ok(r.ok, `gate after repair: ${r.gate.problems.join('; ')}`);
  assert.equal(r.provenance.runs.length, 2);
  assert.equal(r.provenance.runs[1].kind, 'repair1');
  assert.equal(r.provenance.muse.repo, false);
  execFileSync(process.execPath, [VALIDATE, out]);
}
// a broken bundle fails the gate and keeps the previous good one in place
{
  const out = join(tmp('keep'), 'hot-soup');
  writeFileSync(join(tmp('noop'), 'x'), '');
  const first = await direct(PLAN.prompt, { out, muse: STUB, stall: 20, timeout: 120, log: quiet });
  assert.ok(first.ok);
  const before = readFileSync(join(out, 'events.ndjson'), 'utf8');
  process.env.STUB_MUSE_STALL = '3';
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 2, timeout: 120, repairs: 0, log: quiet });
  delete process.env.STUB_MUSE_STALL;
  assert.equal(r.ok, false);
  assert.ok(r.gate.problems.some((p) => /lines/.test(p)));
  assert.equal(readFileSync(join(out, 'events.ndjson'), 'utf8'), before, 'a failed run never replaces a good bundle');
}
console.log('director ok: validation, turnstile, song form, craft checks + bypass + answers + sung thoughts, orchestrator + stub Muse (7 concurrent agents), watchdog + repair');
