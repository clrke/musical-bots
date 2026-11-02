// The Muse Code director without Muse (no model, no network, no cost):
//   1. emit.js validation: lines, summaries, plans, events (names, markup, actions, roles);
//   2. the turnstile in-process: beat order, the queue for later beats (the lead-in first), closed
//      beats, the stanza capacity, the linger, idle agents, the song form, the chords on the lines;
//      the craft checks (craft.js: each check, calibrated on the 13 checked-in bundles), the bypass
//      and its limits, the craft modes, the answers to consultations, the first-person summaries;
//   3. the orchestrator (direct.js) against the stub Muse (scripts/director/stub-muse.js): eight
//      concurrent crew processes through the real emit command; the bundle validates, plays in beat
//      order, t is the real timeline, director.json records the run; a crew that stalls is stopped by
//      the watchdog and a repair run resumes it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.MB_EMIT_LINGER_S = '1';
process.env.MB_EMIT_IDLE_S = '30';
const E = await import('../scripts/director/emit.js');
const { PLAN, LINES, CUES, FIXTURE_EVENTS, CONSULTATIONS } = await import('../scripts/director/fixture.js');
const { beatId, roleMenu, ROLES, resolveAction, agentType } = await import('../scripts/director/vocab.js');
const { direct, crewOverlay, directorPrompt, atLeast, rulesFile } = await import('../scripts/director/direct.js');
const { threadProblems: threadProblemsOf } = await import('../web/src/consultation.js');
const STUB = new URL('../scripts/director/stub-muse.js', import.meta.url).pathname;
const VALIDATE = new URL('../scripts/validate-bundle.js', import.meta.url).pathname;
const tmp = (p) => mkdtempSync(join(tmpdir(), `mb-director-${p}-`));
// the curated bundles the craft checks were fitted on (the hero episode, why-musical-bots, came after: directed under them)
const HERO = 'why-musical-bots';
const FITTED = (await import('../web/src/curated.js')).SEEDS.map(([s]) => s).filter((s) => s !== HERO);

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
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock, consultations: null }); // (the beat order; the consultations: 2b)
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
// (the voice and singable checks aside: these lines are about the other checks; their own tests are below)
const checksOf = (l, ctx = {}) => C.lineCraft(l, { section: 'verse1', pos: 0, ...ctx }).filter((f) => f.check !== 'voice' && f.check !== 'singable').map((f) => (f.severity === 'note' ? `${f.check}?` : f.check));
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
  assert.deepEqual(C.lineCraft('We see a ladle >> Rawr!', { allow: new Set(['ladle', 'rawr']) }), [], 'words an earlier bypass accepted');
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
  // calibration: on the 14 checked-in director bundles the checks were fitted on (588 lines) every check rejects at
  // most ~15% of the lines (measured: dictionary 4.6%, meter 2.0%, filler 3.3%, repeat 3.3%, balance 0.7%,
  // inversion 0.2%, rhyme 0%, voice 3.6%), and the weak lines it was tuned on are among them (the hero episode,
  // directed under them since, is checked on its own below)
  const root = new URL('../episodes', import.meta.url).pathname;
  const per = Object.fromEntries(C.CHECKS.map((c) => [c, 0]));
  let total = 0;
  const flagged = new Set();
  for (const slug of FITTED) {
    const b = JSON.parse(readFileSync(join(root, slug, 'beats.json'), 'utf8'));
    const ev = readFileSync(join(root, slug, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const r of C.bundleCraft(b, ev)) {
      total++;
      for (const f of r.findings.filter((x) => x.severity === 'reject')) { per[f.check]++; flagged.add(`${f.check}: ${r.lyric.replace(/ >>.*/, '')}`); }
    }
  }
  assert.equal(total, 588);
  for (const [c, n] of Object.entries(per)) assert.ok(n / total <= 0.15, `${c} rejects ${n} of ${total} lines`);
  {
    // the hero episode, directed under the checks in strict mode: none of its 42 lines is refused when read back
    const b = JSON.parse(readFileSync(join(root, HERO, 'beats.json'), 'utf8'));
    const ev = readFileSync(join(root, HERO, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const rows = C.bundleCraft(b, ev);
    assert.equal(rows.length, 42);
    assert.deepEqual(rows.filter((r) => r.findings.some((f) => f.severity === 'reject')).map((r) => r.lyric), [], `${HERO}: lines the checks refuse`);
  }
  // the weak lines the checks were tuned on (the Oct 29 bundles, re-directed since under these checks), on their own
  for (const [check, line] of [['filler', 'The inbox stays so tight'], ['meter', 'Sun fills big kitchen'], ['inversion', 'He barks at pigeons near'],
    ['dictionary', 'I hold my ladle tight'], ['meter', 'Soft tones suit this old street'], ['filler', 'The lid holds kind of tight']]) {
    assert.ok(checksOf(line).includes(check), `${check}: ${line}`);
  }
  assert.ok(checksOf('Chalk dust, pounding feet', { pos: 2, stanza: ['Fast feet slap the street', 'x'] }).includes('repeat'), 'repeat: Chalk dust, pounding feet');
  // voice: the story sings "we"; "I" only for a catchphrase or a dare, never on the plot's trouble or in a bridge
  const voiceOf = (l, ctx) => C.lineCraft(l, { section: 'verse1', pos: 0, ...ctx }).find((f) => f.check === 'voice');
  assert.equal(voiceOf('I tie the rope up tight', { section: 'bridge2', pos: 2, plot: true }).bypass, null, "red-truck's resolving line: never bent");
  assert.equal(voiceOf('I sing the new lines now', { section: 'bridge2', pos: 2 }).bypass, null, 'a bridge line says "we"');
  assert.ok(voiceOf('I want to lead the way').bypass, 'a verse line may bend (a boast)');
  assert.deepEqual(voiceOf('My toes freeze on the white line').words, ['My']);
  for (const ok of ['We tie the rope up tight', 'Hold my juice! Race round the block!', 'Trust me: he\'s Biscuit now', 'Stay out late, I dare',
    'Warm hands reach you and me', 'We share it all >> For me?', 'The IT crowd waits']) assert.equal(voiceOf(ok), undefined, ok);
  assert.equal(voiceOf('The rope holds tight', { section: 'bridge2', pos: 2, plot: true }), undefined);
  // singable: the words a listener catches as the voice sings them (hackathon-win v21's worst lines, measured 0-1 of 5)
  const HP = 'The bots join the Meta Global AI Hackathon and win!';
  const singOf = (l) => C.lineCraft(l, { section: 'verse1', pos: 0, premise: HP, hook: 'Hackathon win!' }).find((f) => f.check === 'singable');
  for (const [bad, cold] of [['Press Premiere, they sing', 'Press Premiere'], ['Muse hums as songs overlap', 'Muse'], ['Musical Bots own the glow', 'Musical Bots'],
    ['Meta hears our song ring true', 'Meta']]) {
    assert.match(singOf(bad)?.message ?? '', new RegExp(`opens cold on "${cold}"`), bad);
    assert.ok(singOf(bad).bypass, 'a line may bend (a name the fact sheet requires)');
  }
  assert.match(singOf('The laptop glows past midnight').message, /"glows" \(11%: try "shines" or "lights up"\)/, 'the weakest words, with clearer ones');
  assert.match(singOf('The Indie track calls us').message, /hard to catch/);
  for (const ok of ['We press Premiere and play', 'We are the Musical Bots', 'The laptop shines past midnight', 'We sway beneath the light', '{Black} hugs the truck tight',
    'With Muse we type all night']) assert.equal(singOf(ok), undefined, ok);
  assert.match(singOf('[And] Musical Bots wins tonight').message, /opens cold on "Musical Bots"/, 'a pickup does not save a cold open');
  assert.ok(C.heardChance('shine') > C.heardChance('glow') + 0.3 && C.heardChance('tune') > C.heardChance('song'), 'the model: "glow" and a final "ng" blur');
  // the plan's hook: never bypassed; opening cold on the premise's event loses it ("Hackathon win!" was heard "Hager's on me")
  const hookOf = (h) => C.hookCraft(h, { allow: C.premiseWords(HP), things: C.premiseThings(HP) }).map((f) => [f.check, f.bypass]);
  assert.deepEqual(hookOf('Hackathon win!'), [['singable', null]]);
  assert.deepEqual(hookOf('We win the hackathon!'), []);
  assert.deepEqual(hookOf('The hackathon, we win!'), []);
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
  assert.match(tp('You lead the dance line, Pink', 'Gray').join(), /copies an example/, 'another name is still a copy');
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
    E.initState(dir, { prompt: plan.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: 1_000_000, craft, consultations: null });
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
  const v1 = [line(1, 'We want a bowl of soup >> Me too!', 'He wants soup. Too plain, Pink?'), line(1, 'Our hands are so cold >> So cold!', 'Can I shiver here, Blue?', { bypass: { filler: 'the shiver is the point here' } }),
    line(1, '{Gold:harrumph} taps the price >> Uh-oh!', 'Ooh, the price tag, Gold!'), line(1, 'The pot is so old! >> Aw, please?', 'This line is yours, Gold!', { singer: 'Gold', bypass: { filler: 'it is how Gold would say it' } })];
  r = await E.emitEvents(dir, v1, at('lyrics'));
  assert.notEqual(r.status, 'rejected', r.message);
  assert.equal(E.readState(dir).craft.bypasses.lyrics, 3);
  r = await E.emitEvents(dir, [line(2, '{Purple:preen} rolls up next door >> So shiny!', 'Here comes the truck. Big, Yellow?'),
    line(2, 'Ta-da! Free soup for you! >> Free soup!', 'Wow, Purple gives free soup!', { singer: 'Purple' }),
    line(2, 'The crowd hurries over >> Wait up!', 'The diner empties. Too fast?'), line(2, '[And] We sit with {Gold}, so true >> Oh no!', 'Aw, I sit with Gold', { bypass: { filler: 'Green means it truly here' } })], at('lyrics'));
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
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock, consultations: null }); // (the one-line questions of the Oct 30-31 runs)
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
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock, consultations: null });
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
  const BOT_OF = { lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue', deals: 'Gold', hype: 'Yellow', comedy: 'Pink', trouble: 'Black' };
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
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock, consultations: null });
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

// 2b. consultations as conversations (web/src/consultation.js): typed moves, one event a line ---------------
{
  const K = await import('../web/src/consultation.js');
  // the order: ask; context 1-3; question 1-3 (the host's ok any time after the ask); ack; reasoning 1-3; answer 1-3;
  // followup 0-3 with followup-answer 1-3; agree; thanks
  assert.deepEqual(K.nextMoves([]), ['ask']);
  assert.deepEqual(K.nextMoves(['ask']), ['context', 'ok']);
  assert.deepEqual(K.nextMoves(['ask', 'context']), ['context', 'question', 'ok']);
  assert.deepEqual(K.nextMoves(['ask', 'ok', 'context', 'context', 'context']), ['question']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question']), ['question', 'ok']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok']), ['question', 'ack']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack']), ['reasoning']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'reasoning', 'reasoning']), ['answer']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer']), ['answer', 'followup', 'agree']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer', 'followup']), ['followup', 'followup-answer']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer', 'followup', 'followup-answer']), ['followup-answer', 'agree']);
  assert.deepEqual(K.nextMoves(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer', 'agree']), ['thanks']);
  const full = ['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer', 'agree', 'thanks'];
  assert.deepEqual(K.nextMoves(full), []);
  assert.equal(K.isComplete(full), true);
  assert.equal(K.isComplete(full.slice(0, -1)), false);
  assert.deepEqual(K.nextMoves(['context']), [], 'a consultation opens with its ask');
  // whose turn: after the question the host's ok (another question is no turn); after the answer the asker's
  const th = (moves) => ({ asker: 'Pink', host: 'Blue', moves });
  assert.deepEqual(K.turnOf(th(['ask', 'context', 'question']), 'Blue'), ['ok']);
  assert.deepEqual(K.turnOf(th(['ask', 'context', 'question']), 'Pink'), []);
  assert.deepEqual(K.turnOf(th(['ask', 'context']), 'Blue'), [], 'the host replies once the question is there');
  assert.deepEqual(K.turnOf(th(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer']), 'Pink'), ['followup', 'agree']);
  assert.deepEqual(K.turnOf(th(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer']), 'Blue'), []);
  assert.deepEqual(K.turnOf(th(['ask', 'context', 'question', 'ok', 'ack', 'reasoning', 'answer', 'followup']), 'Pink'), []);
  // a stream's threads, checked: good and bad orders, the wrong side, the other bot not named
  const mv = (seq, bot, move, other, thread = 'c1') => ({ seq, bot, move, thread, consult: [other], beat: beatId(0) });
  const good = [mv(0, 'Pink', 'ask', 'Blue'), mv(1, 'Pink', 'context', 'Blue'), mv(2, 'Pink', 'question', 'Blue'), mv(3, 'Blue', 'ok', 'Pink'), mv(4, 'Blue', 'ack', 'Pink'),
    mv(5, 'Blue', 'reasoning', 'Pink'), mv(6, 'Blue', 'answer', 'Pink'), mv(7, 'Pink', 'followup', 'Blue'), mv(8, 'Blue', 'followup-answer', 'Pink'), mv(9, 'Pink', 'agree', 'Blue'), mv(10, 'Pink', 'thanks', 'Blue')];
  assert.deepEqual(K.threadProblems(good), []);
  assert.equal(K.threadsOf(good).get('c1').complete, true);
  assert.match(K.threadProblems([good[0], good[2]]).join(), /c1 "question" out of order \(after ask, the next is context or ok\)/);
  assert.match(K.threadProblems([...good.slice(0, 3), good[4]]).join(), /"ack" out of order/, 'no ack before the ok');
  assert.match(K.threadProblems([...good.slice(0, 7), mv(7, 'Blue', 'agree', 'Pink')]).join(), /"agree" is said by Pink, not Blue/);
  assert.match(K.threadProblems([good[0], { ...good[1], consult: ['Gold'] }]).join(), /names Blue in consult/);
  assert.match(K.threadProblems([good[1]]).join(), /c1 "context" out of order \(after nothing, the next is ask\)/, 'a consultation opens with its ask');
  assert.match(K.threadProblems([{ ...good[0], move: 'shrug' }]).join(), /move "shrug" is none of/);
  // the canonical order the making-of sings: the host's ok right after the ask, whenever it was sent
  assert.deepEqual(K.canonicalOrder([good[0], good[1], good[2], good[3]]).map((e) => e.move), ['ask', 'ok', 'context', 'question']);

  // through the emit tool: a consultation, sent and replied to
  const dir = tmp('consult');
  let clock = 5_000_000;
  const opts = (agent) => ({ as: agent, linger: 1, now: () => clock });
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  assert.equal(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')).consultations, 'moves', 'the tool marks the bundle\'s consultations as move threads');
  for (const a of ['lyrics', 'chords', 'lighting', 'comedy']) E.status(dir, a, { now: () => clock });
  const M = (agent, move, other, summary, extra = {}) => ({ agent, beat: beatId(0), move, consult: [other], summary, ...extra });
  const send = (agent, list) => E.emitEvents(dir, list, opts(agent));
  // the one-line question of before is refused, with how to open a consultation
  let r = await send('comedy', { agent: 'comedy', beat: beatId(0), status: 'consulting', consult: ['Blue'], summary: 'Can I get a spot, Blue?', action: 'chin-stroke' });
  assert.match(r.message, /a consultation is a conversation now, one event per line, each a "move": open it with \{"move": "ask"/);
  // each line's own rules
  r = await send('comedy', [M('comedy', 'ask', 'Blue', 'Hey Blue, got a minute?'), M('comedy', 'context', 'Blue', 'The slip sits by the truck'), M('comedy', 'question', 'Blue', 'A spot finds me there')]);
  assert.match(r.message, /"question" asks the crewmate to decide something that is theirs to decide[^\n]*\("Should we keep the slip, or cut it\?"\): end it with "\?"/);
  r = await send('comedy', [M('comedy', 'ask', 'Blue', 'Hey Blue, got a minute?'), M('comedy', 'context', 'Blue', 'Is the slip by the truck?')]);
  assert.match(r.message, /"context" says one thing you know[^\n]*a statement, no "\?"/);
  r = await send('comedy', M('comedy', 'ask', 'Blue', 'Hey there, got a minute for me?'));
  assert.match(r.message, /a question names the bot it asks: say it to Blue/, 'the ask names the bot it asks');
  r = await send('comedy', M('comedy', 'ask', 'Gold', 'Hey Blue, got a minute?', { consult: ['Blue', 'Gold'] }));
  assert.match(r.message, /"consult" names the one crewmate this consultation is with/);
  r = await send('comedy', [M('comedy', 'ask', 'Blue', 'Hey Blue, got a minute?'), M('comedy', 'context', 'Blue', 'Green wants a slip right at the peak of the verse')]);
  assert.match(r.message, /sings 1[1-9] syllables[^\n]*at most 10[^\n]*split a longer thought into two lines/);
  r = await send('comedy', [M('comedy', 'context', 'Blue', 'Green plans a slip on the ice')]);
  assert.match(r.message, /"context": you have no open consultation with Blue\. Open one first: \{"move": "ask"/);
  // the opening: ask, context, question in one call (with the beat's own work)
  r = await send('comedy', [M('comedy', 'ask', 'Blue', 'Hey Blue, got a minute?'), M('comedy', 'context', 'Blue', 'Green plans a slip on the ice'),
    M('comedy', 'context', 'Blue', 'The ice is near the truck'), M('comedy', 'question', 'Blue', 'Can a light follow me?'),
    { agent: 'comedy', beat: beatId(0), summary: 'Ooh, a slippery street, Gold!', action: 'giggle' }]);
  assert.equal(r.status, 'ok', r.message);
  assert.match(r.message, /CONSULTATION c1 \(Pink asks Blue, from beat-1-intro\):\n {6}Pink \[ask\]: "Hey Blue, got a minute\?"[\s\S]*-> waiting for Blue \(question or ok\)/);
  let ev = E.readEvents(dir);
  assert.deepEqual(ev.filter((e) => e.move).map((e) => [e.move, e.thread, e.status]), [['ask', 'c1', 'consulting'], ['context', 'c1', 'consulting'], ['context', 'c1', 'consulting'], ['question', 'c1', 'consulting']]);
  // one open consultation a pair and direction
  r = await send('comedy', [M('comedy', 'ask', 'Blue', 'Blue, one more thing?')]);
  assert.match(r.message, /your consultation with Blue \(c1\) is still open \(next: question \(Pink\) or ok \(Blue\)\)/);
  // the asker cannot close before the answer; the host sees its turn
  r = await send('comedy', [M('comedy', 'agree', 'Blue', 'Amber it is, then')]);
  assert.match(r.message, /c1 \(Pink asks Blue\): "agree" is out of order after "question"[\s\S]*Wait: it is Blue's turn \(question or ok\)/);
  let board = E.status(dir, 'lighting', { now: () => clock }).message;
  assert.match(board, /CONSULTATION c1 \(Pink asks Blue[\s\S]*Pink \[question\]: "Can a light follow me\?"\n {4}-> YOUR TURN, in your next call \(for beat-1-intro or a later beat, before your other events\): reply to Pink, one event a line, in this order: "ok" \(yes, go ahead\), "ack"/);
  assert.match(board, /your consultations: 0 opened \(0 complete; open at least 2 this episode/);
  // the host's reply: out of order, the wrong side, then right; its answer carries the cue it decides
  r = await send('lighting', [M('lighting', 'ack', 'Pink', 'Ooh, that is a fun one')]);
  assert.match(r.message, /"ack" is out of order after "question"[\s\S]*Yours next: ok/);
  r = await send('lighting', [M('lighting', 'followup', 'Pink', 'Can it blink, Pink?')]);
  assert.match(r.message, /"followup" is Pink's move \(the asker\), not yours: Pink asked you, so you say ok, ack, reasoning, answer, followup-answer/);
  clock += 2000;
  r = await send('lighting', [M('lighting', 'ok', 'Pink', 'Sure, what is up?'), M('lighting', 'ack', 'Pink', 'Ooh, that is a fun one'),
    M('lighting', 'reasoning', 'Pink', 'A spot on the ice is bright'), M('lighting', 'reasoning', 'Pink', 'But it blinds the crowd'),
    M('lighting', 'answer', 'Pink', 'So we dim it to amber', { action: 'lights-warm' })]);
  assert.equal(r.status, 'ok', r.message);
  ev = E.readEvents(dir);
  const q = ev.find((e) => e.move === 'question'), a = ev.find((e) => e.move === 'answer');
  assert.equal(a.answers, q.seq, "the first answer answers the first question (answers, as before)");
  assert.equal(a.status, 'working');
  assert.match(E.status(dir, 'comedy', { now: () => clock }).message, /Blue \[answer\]: "So we dim it to amber"\n {4}-> YOUR TURN[^\n]*Blue answered\. Close it: "agree"[^\n]*"thanks"[^\n]*"followup"/);
  // --done waits for the consultations: the asker's closing is due
  r = E.markDone(dir, 'comedy', { now: () => clock });
  assert.match(r.message, /NOT YET: [\s\S]*c1 \(Pink asks Blue\) waits on you: send "followup" or "agree"/);
  // a follow-up, its answer, the closing; a move for an earlier beat than the thread's is refused
  r = await send('comedy', [M('comedy', 'followup', 'Blue', 'Can it flash when I fall?')]);
  assert.equal(r.status, 'ok', r.message);
  r = await send('lighting', [M('lighting', 'followup-answer', 'Pink', 'One flash, right on the fall')]);
  assert.equal(r.status, 'ok', r.message);
  r = await send('comedy', [M('comedy', 'agree', 'Blue', 'Great, one flash it is'), M('comedy', 'thanks', 'Blue', 'Thanks, Blue, you are a star!')]);
  assert.equal(r.status, 'ok', r.message);
  ev = E.readEvents(dir);
  assert.deepEqual(K.threadProblems(ev), []);
  assert.equal(K.threadsOf(ev).get('c1').complete, true);
  assert.match(E.status(dir, 'comedy', { now: () => clock }).message, /your consultations: 1 opened \(1 complete[\s\S]*done: c1 \(Pink asked Blue\): Blue decided "So we dim it to amber \/ One flash, right on the fall": your work follows it/);
  const cs = E.consultStats(ev);
  assert.deepEqual([cs.threads, cs.complete, cs.followups, cs.applied, cs.opened.Pink], [1, 1, 1, 1, 1], JSON.stringify(cs));
  // a thanks must thank; a reply nobody asked for is refused
  r = await send('chords', [M('chords', 'ask', 'Green', 'Hey Green, a quick one?'), M('chords', 'context', 'Green', 'The hook sings hot soup twice'), M('chords', 'question', 'Green', 'Which word gets the big chord?')]);
  assert.equal(r.status, 'ok', r.message);
  r = await send('lyrics', [M('lyrics', 'ok', 'Gold', 'Sure, Gold, go on')]);
  assert.match(r.message, /"ok": Gold has no open consultation with you/);
  r = await send('lyrics', [M('lyrics', 'ok', 'White', 'Yes, go on'), M('lyrics', 'ack', 'White', 'Ooh, a fun question'), M('lyrics', 'reasoning', 'White', 'Soup is long and warm'),
    M('lyrics', 'answer', 'White', 'Land the big chord on soup')]);
  assert.equal(r.status, 'ok', r.message);
  r = await send('chords', [M('chords', 'agree', 'Green', 'Soup it is, then'), M('chords', 'thanks', 'Green', 'Lovely, Green, see you')]);
  assert.match(r.message, /"thanks" thanks the crewmate[^\n]*say thanks in it/);
  // the gate: at least 8 complete consultations, the open ones listed with their next move
  const gate = E.checkBundle(dir);
  assert.match(gate.problems.join('\n'), /1 complete consultation\(s\) \(ask to thanks\); an episode needs at least 8; open: c2 White asks Green, next answer \(Green\) or followup \(White\) or agree \(White\)/);
  assert.equal(gate.stats.consult.threads, 2);
  // validate-bundle checks the threads too: a bundle with a move out of order is invalid
  execFileSync(process.execPath, [VALIDATE, dir]);
  const bad = tmp('consult-bad');
  writeFileSync(join(bad, 'beats.json'), readFileSync(join(dir, 'beats.json')));
  const lines = readFileSync(join(dir, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const swapped = lines.map((e) => (e.move === 'ok' && e.thread === 'c1' ? { ...e, move: 'answer' } : e));
  writeFileSync(join(bad, 'events.ndjson'), swapped.map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.throws(() => execFileSync(process.execPath, [VALIDATE, bad], { stdio: 'pipe' }), (err) => /c1 "answer" out of order/.test(String(err.stderr)));
  // spoken English: no stock "tick", no telegram
  assert.match(E.moveProblems({ move: 'ask', summary: 'Gold, spare me half a tick?', bot: 'Pink', consult: ['Gold'] }).join(), /"tick" is a stock phrase/);
  assert.match(E.moveProblems({ move: 'reasoning', summary: 'Small keeps each mended break clear', bot: 'Gold', consult: ['Pink'] }).join(), /reads like a telegram/);
  assert.deepEqual(E.moveProblems({ move: 'reasoning', summary: 'If he comes in late, the line stays clear', bot: 'Gold', consult: ['Pink'] }), []);
  // a role opens its first consultation early: from its third call on, a call without an ask is refused (with how)
  const d2 = tmp('consult-early');
  E.initState(d2, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(d2, PLAN, { now: () => clock }).status, 'ok');
  const cue = (k, summary) => ({ agent: 'hype', beat: beatId(k), summary, action: 'cheer' });
  for (const [k, x] of [[0, 'What a start, Gray!'], [1, 'Can you hear that, Pink?'], [2, 'Here it comes, Blue!']]) assert.notEqual((await E.emitEvents(d2, cue(k, x), { as: 'hype', now: () => clock })).status, 'rejected');
  r = await E.emitEvents(d2, cue(3, 'Big chorus, White!'), { as: 'hype', now: () => clock });
  assert.match(r.message, /you have sent 3 calls and opened no consultation yet: open your first in this call[\s\S]*"move": "ask", "consult": \["Green"\]/);
  r = await E.emitEvents(d2, [M('hype', 'ask', 'Gold', 'Hey Gold, can I ask you?', { beat: beatId(3) }), M('hype', 'context', 'Gold', 'The bridge is the quiet part', { beat: beatId(3) }),
    M('hype', 'question', 'Gold', 'How big can I go there?', { beat: beatId(3) }), cue(3, 'Big chorus, White!')], { as: 'hype', now: () => clock });
  assert.notEqual(r.status, 'rejected', r.message);
  // Nov 1 (the owner: "barrages of different questions that get answered waaaay after", "it's rude that the bots
  // don't acknowledge the question right after it's asked", "many say 'got a sec'"): one question at a time; the bot
  // asked takes it in its very next call (its ok and its ack: "let me think" when it needs time); an ask the episode
  // had already, or a third stock one, is refused
  const d3 = tmp('consult-ack');
  E.initState(d3, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(d3, PLAN, { now: () => clock }).status, 'ok');
  for (const a of ['lyrics', 'chords', 'lighting', 'comedy', 'hype', 'deals']) E.status(d3, a, { now: () => clock });
  const send3 = (agent, list) => E.emitEvents(d3, list, { as: agent, linger: 1, now: () => clock });
  const open3 = (agent, other, ask, q, c = 'Green plans a slip on the ice') => [M(agent, 'ask', other, ask), M(agent, 'context', other, c), M(agent, 'question', other, q)];
  r = await send3('comedy', open3('comedy', 'Blue', 'Hey Blue, got a minute?', 'Can a light follow me?'));
  assert.equal(r.status, 'ok', r.message);
  r = await send3('comedy', open3('comedy', 'Gold', 'Gold, can we talk money?', 'Should the slip be free for us?', 'The diner pays for every gag'));
  assert.match(r.message, /your question to Blue \(c1\) still waits for its answer: one question at a time/);
  assert.match(E.status(d3, 'comedy', { now: () => clock }).message, /-> waiting for Blue[^\n]*open no other consultation until it is answered: one question at a time/);
  // Blue's next call, its own work without taking the question: refused, with how
  assert.match(E.status(d3, 'lighting', { now: () => clock }).message, /-> YOUR TURN[^\n]*Take the question in this very call/);
  r = await send3('lighting', { agent: 'lighting', beat: beatId(0), summary: 'Ooh, a frosty street, Gold!', action: 'lights-cool' });
  assert.match(r.message, /Pink asked you a question \(c1\): "Can a light follow me\?"\. Take it now, in this call, before your other events: "ok" \(yes, go ahead\), then "ack"/);
  // its ok and its ack (it needs time to think) with its work: fine; the reasoning and the answer in a later call
  r = await send3('lighting', [M('lighting', 'ok', 'Pink', 'Sure, what is up?'), M('lighting', 'ack', 'Pink', 'Good one, Pink. Let me think on it'),
    { agent: 'lighting', beat: beatId(0), summary: 'Ooh, a frosty street, Gold!', action: 'lights-cool' }]);
  assert.equal(r.status, 'ok', r.message);
  r = await send3('comedy', open3('comedy', 'Gold', 'Gold, can we talk money?', 'Should the slip be free for us?', 'The diner pays for every gag'));
  assert.match(r.message, /still waits for its answer/, 'acknowledged is not answered');
  r = await send3('lighting', [M('lighting', 'reasoning', 'Pink', 'A spot on the ice is bright'), M('lighting', 'answer', 'Pink', 'So we dim it to amber', { action: 'lights-warm' })]);
  assert.equal(r.status, 'ok', r.message);
  // answered: Pink opens the next, in its own words (the same ask again is refused)
  r = await send3('comedy', open3('comedy', 'Gold', 'Hey Gold, got a minute?', 'Should the slip be free for us?', 'The diner pays for every gag'));
  assert.match(r.message, /Pink already asked that way \("Hey Blue, got a minute\?"\)[^\n]*in your own words/);
  r = await send3('comedy', open3('comedy', 'Gold', 'Gold, can we talk money?', 'Should the slip be free for us?', 'The diner pays for every gag'));
  assert.equal(r.status, 'ok', r.message);
  // a second stock ask is fine, a third is not
  r = await send3('chords', open3('chords', 'Green', 'Green, have you a sec?', 'Which word gets the big chord?', 'The hook sings hot soup twice'));
  assert.equal(r.status, 'ok', r.message);
  r = await send3('hype', open3('hype', 'Gold', 'Gold, spare me a moment?', 'How big can I go there?', 'The bridge is the quiet part'));
  assert.match(r.message, /the episode already has 2 asks like it/);
}

// 2c. the plot's trouble (Nov 1, the owner: "One of the rival bots should have the responsibility of making the plot
// interesting by introducing problems"): Black pitches a problem to Green or Gold on his question (`problem`), the
// host's first answer carries the verdict, Green sings an accepted one in his next verse (`trouble`) and solves it in a
// later beat (`resolves`); the gate wants two, in acts 1 and 2, every one solved; the count bends with Black's reason
{
  const T = await import('../web/src/plot-trouble.js');
  const dir = tmp('trouble');
  let clock = 6_000_000;
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')).crew, ROLES, 'the plan records the run\'s eight roles');
  for (const a of ['lyrics', 'deals', 'trouble', 'chords']) E.status(dir, a, { now: () => clock });
  const M = (agent, move, other, summary, extra = {}) => ({ agent, beat: beatId(1), move, consult: [other], summary, ...extra });
  const send = (agent, list) => E.emitEvents(dir, list, { as: agent, linger: 1, now: () => clock });
  const pitch = (other, problem, beat = 1, ask = `${other}, can I share a scheme?`, ctx = 'The pot lid sticks in the cold', q = 'Should the stuck lid go in verse one?') => [M('trouble', 'ask', other, ask, { beat: beatId(beat) }),
    M('trouble', 'context', other, ctx, { beat: beatId(beat) }), M('trouble', 'question', other, q, { beat: beatId(beat), problem })];
  // a problem goes to Green or Gold, on Black's question, kind, one plain sentence; never pitched from the bridge on
  let r = await send('trouble', pitch('White', 'The lid of the soup pot sticks'));
  assert.match(r.message, /pitch your problem to Green or Gold/);
  r = await send('trouble', [M('trouble', 'ask', 'Green', 'Green, can I share a scheme?', { problem: 'The lid sticks' })]);
  assert.match(r.message, /problem goes on Black's "question" move/);
  r = await send('trouble', pitch('Green', 'Sticks'));
  assert.match(r.message, /one plain sentence of 3-20 words/);
  r = await send('trouble', pitch('Green', 'The pot lid sticks', 7));
  assert.match(r.message, /a new problem is pitched by beat-6-verse2b at the latest/);
  r = await send('trouble', pitch('Green', 'The lid of the soup pot sticks'));
  assert.notEqual(r.status, 'rejected', r.message);
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /This pitches Black's problem \(c1: "The lid of the soup pot sticks"\)[^\n]*"verdict": "accept"/);
  // the host's first answer carries the verdict
  const reply = [M('lyrics', 'ok', 'Black', 'Sure, Black, go on'), M('lyrics', 'ack', 'Black', 'Ooh, sneaky. Let me think on it'),
    M('lyrics', 'reasoning', 'Black', 'A stuck lid slows the soup down')];
  r = await send('lyrics', [...reply, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks in this verse')]);
  assert.match(r.message, /your first answer says if the story takes it, "verdict": "accept" or "decline"/);
  r = await send('lyrics', [...reply, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks in this verse', { verdict: 'maybe' })]);
  assert.match(r.message, /verdict is "accept" or "decline"/);
  r = await send('lyrics', [...reply, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks in this verse', { verdict: 'accept' })]);
  assert.notEqual(r.status, 'rejected', r.message);
  // Green's next verse sings it ("trouble"), and not on a line that solves it in the same beat
  const stanza = (i, marks = {}) => LINES[i].map((l, k) => ({ agent: 'lyrics', beat: beatId(i), ...l, ...(marks[k] ?? {}) }));
  assert.notEqual((await send('lyrics', stanza(0))).status, 'rejected');
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /PLOT TROUBLE c1 "The lid of the soup pot sticks" \(Black to Green, accepted\): the story takes it\. Sing it in your next verse/);
  r = await send('lyrics', stanza(1));
  assert.match(r.message, /Black's problem c1 \("The lid of the soup pot sticks"\) is accepted and waits to be sung: bring it into this verse[^\n]*"trouble": "c1"/);
  r = await send('lyrics', stanza(1, { 0: { trouble: 'c2' } }));
  assert.match(r.message, /"trouble": "c2" is no problem of Black's accepted yet/);
  r = await send('lyrics', stanza(1, { 0: { trouble: 'c1' }, 2: { resolves: 'c1' } }));
  assert.match(r.message, /c1 is sung in beat-2-verse1: solve it in a later beat/);
  r = await send('lyrics', stanza(1, { 0: { trouble: 'c1' } }));
  assert.notEqual(r.status, 'rejected', r.message);
  assert.match(E.status(dir, 'lyrics', { now: () => clock }).message, /PLOT TROUBLE c1 [^\n]*: sung in beat-2-verse1\. Solve it in a later beat/);
  // not solved yet: the gate says so (the solving never bends), and wants a second problem in act 2
  const sentOf = () => [...E.readEvents(dir), ...E.readState(dir).queue.map((q) => q.e)]; // (landed, then queued)
  const ev = sentOf();
  assert.ok(T.troubleProblems(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')), ev).some((p) => /never solved: every problem is solved by the friends by the finale/.test(p)));
  const beats = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8'));
  const g = T.troubleGate(beats, ev);
  assert.deepEqual([g.stats.pitched, g.stats.accepted, g.stats.sung, g.stats.resolved], [1, 1, 1, 0]);
  assert.ok(g.problems.some((p) => /0 problem\(s\) of Black's accepted, sung and solved; an episode needs at least 2/.test(p)));
  assert.ok(g.problems.some((p) => /no accepted problem of Black's is sung in act 2/.test(p)));
  // solved in a later beat, on one of the song's own lines (not a copy of the hook)
  const solved = [...ev, { seq: 999, agent: 'lyrics', bot: 'Green', beat: beatId(4), lyric: 'The lid pops off at last', resolves: 'c1' }];
  assert.ok(!T.troubleProblems(beats, solved).some((p) => /never solved/.test(p)));
  assert.equal(T.troubleGate(beats, solved).stats.resolved, 1);
  assert.ok(T.troubleProblems(beats, [...ev, { seq: 999, agent: 'lyrics', bot: 'Green', beat: beatId(6), lyric: 'Hot soup, hot soup!', resolves: 'c1' }]).some((p) => /not a copy of the hook/.test(p)));
  assert.equal(T.canResolve('chorus3', 3), true);
  assert.equal(T.canResolve('outro', 1), false);
  assert.deepEqual([T.actOf('verse1b'), T.actOf('verse2b'), T.actOf('outro')], [1, 2, 3]);
  // a decline closes it kindly, nothing to sing; the count bends with Black's reason (recorded, counted)
  r = await send('trouble', [M('trouble', 'agree', 'Green', 'A stuck lid it is!', { beat: beatId(2) }), M('trouble', 'thanks', 'Green', 'Thanks, Green! You rock', { beat: beatId(2) })]);
  assert.notEqual(r.status, 'rejected', r.message);
  // (one accepted, none waiting, verses left: a call of Black's own work wants a new pitch first)
  r = await send('trouble', { agent: 'trouble', beat: beatId(2), summary: 'Ha! I bet nobody opens it, Gray', action: 'chin-stroke' });
  assert.match(r.message, /pitch your next problem in this call/);
  r = await send('trouble', pitch('Gold', 'The price of soup doubles today', 2, 'Gold, can I run a scheme by you?', 'The whole street wants a bowl', 'Should the soup price double here?'));
  assert.notEqual(r.status, 'rejected', r.message);
  r = await send('deals', [M('deals', 'ok', 'Black', 'Go on, Black', { beat: beatId(2) }), M('deals', 'ack', 'Black', 'Hmm. Doubles, you say', { beat: beatId(2) }),
    M('deals', 'reasoning', 'Black', 'A double price is too mean here', { beat: beatId(2) }), M('deals', 'answer', 'Black', 'No, the price stays put', { beat: beatId(2), verdict: 'decline' })]);
  assert.notEqual(r.status, 'rejected', r.message);
  r = await send('chords', { agent: 'chords', beat: beatId(2), summary: 'A bold chord for the twist, Gold?', chords: ['C', 'G'], bypass: { trouble: 'the soup story is gentle and quiet' } });
  assert.match(r.message, /bypass\.trouble is Black's \(the plot's trouble\): leave it out/);
  r = await send('trouble', { agent: 'trouble', beat: beatId(2), summary: 'Aw. One snag is plenty, Gold', action: 'shrug', bypass: { trouble: 'the soup story is gentle and quiet' } });
  assert.notEqual(r.status, 'rejected', r.message);
  const after = sentOf();
  assert.deepEqual(after.at(-1).bypassed, [{ check: 'trouble', reason: 'the soup story is gentle and quiet' }]);
  const bent = T.troubleGate(beats, [...after, solved.at(-1)]);
  assert.deepEqual([bent.problems, bent.stats.declined, bent.stats.bypassed.length], [[], 1, 1], 'the count bends with a reason');
  assert.deepEqual(E.craftRecordProblems(beats, after), [], 'a trouble bypass is a valid craft record');
  // two problems in one consultation (Black's one open question carries both acts'): ids c<n> and c<n>.2, the
  // host's answers in order, both in one call, each with its verdict
  {
    const d = tmp('trouble-two');
    E.initState(d, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
    assert.equal(E.writeBeats(d, PLAN, { now: () => clock }).status, 'ok');
    for (const a of ['lyrics', 'trouble']) E.status(d, a, { now: () => clock });
    const sd = (agent, list) => E.emitEvents(d, list, { as: agent, linger: 1, now: () => clock });
    r = await sd('trouble', [...pitch('Green', 'The lid of the soup pot sticks'),
      M('trouble', 'question', 'Green', 'And can we drop the spoon in verse two?', { problem: 'Gold drops his spoon in the soup' })]);
    assert.notEqual(r.status, 'rejected', r.message);
    const q = [M('lyrics', 'ok', 'Black', 'Sure, Black, go on'), M('lyrics', 'ack', 'Black', 'Two snags! Let me think'), M('lyrics', 'reasoning', 'Black', 'A stuck lid slows the soup down')];
    r = await sd('lyrics', [...q, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks first', { verdict: 'accept' })]);
    assert.match(r.message, /pitches two problems: answer both in this call/);
    r = await sd('lyrics', [...q, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks first', { verdict: 'accept' }), M('lyrics', 'answer', 'Black', 'And the spoon falls in later')]);
    assert.match(r.message, /your second answer says if the story takes it/);
    r = await sd('lyrics', [...q, M('lyrics', 'answer', 'Black', 'Yes, the lid sticks first', { verdict: 'accept' }), M('lyrics', 'answer', 'Black', 'And the spoon falls in later', { verdict: 'accept' })]);
    assert.notEqual(r.status, 'rejected', r.message);
    const all = [...E.readEvents(d), ...E.readState(d).queue.map((x) => x.e)];
    assert.deepEqual([...T.troublesOf(all).values()].map((t) => [t.id, t.verdict]), [['c1', 'accept'], ['c1.2', 'accept']]);
    // one problem an act: verse1 sings c1; verse1b is not asked to sing c1.2 (it waits for verse2)
    assert.notEqual((await sd('lyrics', stanza(0))).status, 'rejected');
    assert.notEqual((await sd('lyrics', stanza(1, { 0: { trouble: 'c1' } }))).status, 'rejected');
    r = await sd('lyrics', stanza(2));
    assert.doesNotMatch(r.message, /waits to be sung/, 'the second problem waits for act 2');
  }
  // an older plan (no crew): the seven roles, no trouble wanted
  assert.deepEqual(E.crewOf({}), ['lyrics', 'chords', 'dance', 'lighting', 'deals', 'hype', 'comedy']);
}

// 2d. the genuine question (Nov 1, the owner: "It keeps asking questions that it knows the answer to such as Black (Plot
// trouble) asking Green (Lyricist) if White rings out as Why and if the sung words come out mush"): a consultation's
// question puts a decision to the bot asked, never a quiz; Black's pitch asks whether and where the story takes it
{
  const Q = (t, ctx = {}) => C.questionCraft(t, { host: 'Green', ...ctx }).map((f) => f.check);
  // written fresh, not from the bundles: 62 decisions the bot asked owns (a choice, a proposal, an open question; the
  // owner's good ones first; Black's pitches with his problem said in the context) and 30 quizzes
  const LID = { problem: 'The pot lid sticks tight', context: ['The pot lid sticks tight'] };
  const SWAY = { context: ['It needs eight counts to sway'] };
  const DIM = { move: 'followup', answers: ['So we dim it to amber'] };
  const FRESH = [
    ['Green, should we put our doubt about the other teams into the second verse?', { problem: 'We doubt we beat the other teams', context: ['We doubt we beat the other teams'] }],
    ['Gold, can we spend the gold light on the last chorus, or save it?'], ['Green, does the hook land better on the four or the one?'],
    ['Where does the stuck lid go, Green?', LID], ['Which verse takes the stuck lid?', LID], ['Should the lid stick in verse one?', { ...LID, context: ['The cold makes metal tight'] }],
    ['Can we sing the stuck lid in verse two?', LID], ['Would a stuck lid help the first verse?', LID], ['Do we want that in verse one?', LID],
    ['How should we bring it in, Green?', LID], ['What verse gets the stuck lid?', LID], ['When should the lid stick, Green?', LID],
    ['Is there room for it in verse one?', LID], ['What if we put it in verse one?', LID], ['How about the stuck lid in verse two?', LID],
    ['Would it be good to sing that in verse one?', LID],
    ['Which tempo carries an eight-count sway?', SWAY], ['Should we slow it down for the sway, or keep it brisk?', SWAY], ['White, how fast should the sway go?', SWAY],
    ['Spot or glow for my slip, Blue?'], ['Where should Purple come in, Yellow?'], ['How big can the bridge get, Gold?', { context: ['The bridge is the quiet part'] }],
    ['What does a big band cost us?'], ['Can we fit one more bar in the bridge?'], ['Can I wink twice at the end?'], ['Do we march or sway in chorus two?'],
    ['Is it better to dim it or to keep it gold?'], ['Would it help if the spot blinks?'], ['Should the band drop out for the hush?'],
    ['Which word should the big chord hit?', { context: ['The hook sings hot soup twice'] }], ['Who carries the pot out, Green?'], ['When does the gold light come in?'],
    ['How should the win sound, Yellow?'], ['Can a spot follow me across the street?'], ['Could the lights dim when Gold sighs?'], ['May I take the last bow?'],
    ['Shall we end on a big stack of hands?'], ['Bet you cannot fix the lid by supper?'],
    ['If the steam hides the gag, should we move it?', { move: 'followup', answers: ['So the gag goes by the steam'] }],
    ['But if we dim it, how does Green see the gag?', DIM], ['Then which price starts the trouble?'], ['Okay, where does the hush go?'],
    ['Do I take the high part or the low part?'], ['Do you want the gag before the chorus?'], ['Is it okay if I wink at the end?'],
    ['Can we save the gold spot for the finish?', { context: ['I used gold in chorus one'] }], ['What should the big finish glow like?'], ['How long can the bow last?'],
    ['Why not end on a whisper?'], ["Let's dim it here, okay?"], ['What step fits a tired crew at midnight?'], ['Which light helps Green read the sign?'],
    ['Should Navy sing the last reply, or Gold?'], ['Could we trade the drums for claps?'], ['How many bars can the band spare?'],
    ['Where do the friends stand for the last chorus?'], ['Which one lands better, the slip or the wobble?'], ['Would a slower chord fit the sad part?'],
    ['What would make the dare funnier, Pink?'], ['Do we keep the slip, or cut it?'], ['Can the spot stay on Green, then?', DIM], ['How much soup does the band want?'],
  ];
  const MUSH = { problem: 'Some sung words come out as mush', context: ['The gate stamps no on lines', 'The street hums past midnight'] };
  const QUIZ = [
    // the owner's two (hackathon-win c2, Black to Green), and pitches that ask whether the problem happens
    ['What if sung words come out mush?', MUSH], ['And does White ring out as Why?', { ...MUSH, problem: 'White rings out as Why' }],
    ['Should we put it in verse one?', MUSH], // (nobody hears the problem)
    ['And later, the wheel wobbles loose?', { problem: 'The toy box wheel wobbles loose', context: ['The whole street joins in too'] }],
    ['Can the spoon fall in the soup?', { problem: 'Gold drops his spoon in the soup', context: ['Gold is proud of his big spoon'] }],
    ['Can Silver slip on the ice?', { problem: 'Silver slips on the ice', context: ['The street is icy'] }],
    ['What happens if the lid sticks?', LID], ['Who opens the stuck lid?', LID],
    // a yes or no about a fact, a hypothetical, a plain sentence with a "?"; what the asker's own lines just said
    ['Does the tempo carry that sway?', SWAY], ['Is the box glow too bright?'], ['Is this the sad bit?', { context: ['The bridge is the memory part'] }],
    ['Does the band cost us extra?'], ['Are we too loud for the bridge?'], ['Does the lid stick on the pot?', { context: ['The lid sticks on the pot'] }],
    ['Can the lid stick on the pot?', { context: ['The lid sticks on the pot'] }], ['So the gold light it is?'], ['Still soft for White?'],
    ['Has the hook got seven chants?'], ['Is Purple the rival here?'], ['Do the friends fix the lid in the end?'], ['Does Gold pay for the soup?'],
    ['Is it raining in verse two?'], ['What if the pot boils over?'], ['Do eight bars leave room to mend?'],
    ['Does the huddle hide the glow?', { move: 'followup', answers: ['So we gather round and catch you'] }],
    ['So the big chord lands on soup?', { move: 'followup', answers: ['Land the big chord on soup'] }],
    ['Can the chord land on soup?', { move: 'followup', answers: ['Land the big chord on soup'] }],
    ['Is the hook sung seven times?', { context: ['The hook comes back seven times'] }], ['Gold, is that extra?'], ["Isn't the bridge the quiet part?"],
  ];
  assert.deepEqual([FRESH.length, QUIZ.length], [62, 30]);
  for (const [t, ctx] of FRESH) assert.deepEqual(Q(t, ctx), [], t);
  for (const [t, ctx] of QUIZ) assert.deepEqual(Q(t, ctx), ['genuine'], t);
  // (two sentences: the one that asks the most decides)
  assert.deepEqual([Q('Too bright? Should we dim it?'), Q('So, the lid. Where does it go?', LID), Q('The lid sticks. Can it stick?', { context: ['The lid sticks on the pot'] }),
    Q('Ooh. Is it too bright?')], [[], [], ['genuine'], ['genuine']]);
  // (and from the bundles: a leading condition asks its main clause; a yes or no that weighs a step is a decision)
  for (const [t, ctx] of [['If we lose the bet, who pays?', { move: 'followup', answers: ['So take the bet, we fix it'] }],
    ['But if it runs short, can I still roar?', { move: 'followup', answers: ['So keep each bridge at four lines'] }], ['Does the bridge need a spot?']]) assert.deepEqual(Q(t, ctx), [], t);
  const msg = (t, ctx) => C.questionCraft(t, ctx)[0].message;
  assert.match(msg('And does White ring out as Why?', { host: 'Green', ...MUSH, problem: 'White rings out as Why' }), /asks Green whether your own problem happens: you made it up, so you know/);
  assert.match(msg('Should we put it in verse one?', { host: 'Green', ...MUSH }), /nobody hears the problem: neither your context nor your question says "Some sung words come out as mush"/);
  assert.match(msg('Does the tempo carry that sway?', { host: 'White' }), /a yes or no about a fact, not a decision \(White can only say "yes" or "no"\)/);
  assert.match(msg('Can the lid stick on the pot?', { host: 'Green', context: ['The lid sticks on the pot'] }), /says again what your own context just said \("lid", "stick", "pot"\)/);
  assert.match(msg('Can the chord land on soup?', { host: 'Green', move: 'followup', answers: ['Land the big chord on soup'] }), /says again what Green just answered/);
  assert.equal(C.bareQuestion('But if it runs short, Gold, can I still roar?'), 'can I still roar?');
  assert.deepEqual(['Spot or glow, Blue?', 'Hey Blue, should we dim it?', 'Where does he come in?', 'Can a spot find me?', 'Does it glow?', 'What if it sticks?', 'So amber?']
    .map((t) => C.questionForm(t)), ['choice', 'proposal', 'open', 'request', 'fact', 'whatif', 'statement']);

  // through the emit tool: refused with how to fix it and how to bypass it, the decision accepted, a bypass recorded
  const dir = tmp('genuine');
  const clock = 7_000_000;
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now: () => clock }).status, 'ok');
  for (const a of ['lyrics', 'chords', 'dance', 'trouble']) E.status(dir, a, { now: () => clock });
  const M = (agent, move, other, summary, extra = {}) => ({ agent, beat: beatId(0), move, consult: [other], summary, ...extra });
  const send = (agent, list) => E.emitEvents(dir, list, { as: agent, linger: 1, now: () => clock });
  const opening = (agent, other, ask, context, question, extra = {}) => [M(agent, 'ask', other, ask), M(agent, 'context', other, context), M(agent, 'question', other, question, extra)];
  let r = await send('dance', opening('dance', 'White', 'White, can I check the tempo?', 'Three bots stamp in eights', 'Does the tempo hold our stamp?'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /\[genuine\] "Does the tempo hold our stamp\?" asks a yes or no about a fact, not a decision \(White can only say "yes" or "no"\)\. Fix: your context gives the facts; the question asks White to decide[^\n]*Bypass it only if White really decides it as you put it/);
  r = await send('dance', opening('dance', 'White', 'White, can I check the tempo?', 'Three bots stamp in eights', 'Should we slow it down for the stamp?'));
  assert.notEqual(r.status, 'rejected', r.message);
  // Black's pitch: whether it happens is refused; the problem in his context and the proposal in his question pass
  r = await send('trouble', opening('trouble', 'Green', 'Green, I have a sneaky one', 'The street is cold tonight', 'What if the pot lid gets stuck?', { problem: 'The lid of the soup pot gets stuck' }));
  assert.match(r.message, /\[genuine\] "What if the pot lid gets stuck\?" asks Green whether your own problem happens[^\n]*Fix: say the problem plainly in a context line/);
  r = await send('trouble', opening('trouble', 'Green', 'Green, I have a sneaky one', 'The soup lid gets stuck tonight', 'Can we put that in verse one?', { problem: 'The lid of the soup pot gets stuck' }));
  assert.notEqual(r.status, 'rejected', r.message);
  // a yes or no the asker keeps, with its reason: recorded on the event, a valid craft record, the bundle validates
  r = await send('chords', opening('chords', 'Green', 'Green, a word on the hook?', 'The hook sings hot soup twice', 'Is soup the big word?', { bypass: { genuine: 'Green alone picks the hook words' } }));
  assert.notEqual(r.status, 'rejected', r.message);
  assert.match(r.message, /BYPASSED \(recorded on the event\): genuine \("Green alone picks the hook words"\)/);
  const ev = E.readEvents(dir);
  assert.deepEqual(ev.find((e) => e.summary === 'Is soup the big word?').bypassed, [{ check: 'genuine', reason: 'Green alone picks the hook words' }]);
  assert.deepEqual(E.craftRecordProblems(JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')), ev), []);
  assert.deepEqual(E.readState(dir).craft.counts.genuine, { rejected: 2, bypassed: 1, noted: 0 });
  execFileSync(process.execPath, [VALIDATE, dir]);
  // warn mode: a note, nothing refused
  const dw = tmp('genuine-warn');
  E.initState(dw, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock, craft: 'warn' });
  assert.equal(E.writeBeats(dw, PLAN, { now: () => clock }).status, 'ok');
  r = await E.emitEvents(dw, opening('dance', 'White', 'White, can I check the tempo?', 'Three bots stamp in eights', 'Does the tempo hold our stamp?'), { as: 'dance', linger: 1, now: () => clock });
  assert.equal(r.status, 'ok', r.message);
  assert.match(r.message, /CRAFT NOTE \(warn mode: nothing refused\):\n {2}- event 3: genuine: "Does the tempo hold our stamp\?" asks a yes or no/);

  // calibrated on the checked-in bundles: every pitch of Black's (two an episode) is refused as he asked it, the owner's
  // two among them; against the hand labels (eval/questions.ndjson: the 351 questions and follow-ups of the 14 bundles
  // and the Oct 31 fixture) it flags none of the 213 genuine decisions (measured: 0), 38 of the 49 quizzes, 51 of the 89
  // yes or no checks of a fact. The recorded bundles keep validating: it is a send-time check, never the gate's.
  const root = new URL('../episodes', import.meta.url).pathname;
  let pitches = 0, refused = 0;
  for (const slug of FITTED) {
    const evs = readFileSync(join(root, slug, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const q of C.bundleQuestions(evs).filter((x) => x.problem)) { pitches++; if (q.findings.length) refused++; }
    if (slug === 'hackathon-win') {
      assert.deepEqual(C.bundleQuestions(evs).filter((q) => q.thread === 'c2' && q.problem).map((q) => [q.text, q.findings.length]),
        [['What if sung words come out mush?', 1], ['And does White ring out as Why?', 1]]);
    }
  }
  assert.deepEqual([pitches, refused], [28, 28]);
  {
    // the hero episode, directed under the check: every question and follow-up a decision, Black's two pitches proposals
    const qs = C.bundleQuestions(readFileSync(join(root, HERO, 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
    assert.deepEqual(qs.filter((q) => q.findings.length).map((q) => q.text), [], `${HERO}: questions the check refuses`);
    assert.deepEqual(qs.filter((q) => q.problem).map((q) => q.text), ['Should we sing our doubt in verse one?', 'Where does the who uses it question go?']);
  }
  const rows = readFileSync(new URL('../eval/questions.ndjson', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const by = {};
  for (const x of rows) {
    const f = C.questionCraft(x.text, { move: x.move, problem: x.problem ?? null, host: x.host, context: x.context, answers: x.answers ?? [] });
    (by[x.label] ??= { n: 0, flagged: 0 }).n++;
    if (f.length) by[x.label].flagged++;
  }
  assert.deepEqual([rows.length, by.decision.n, by.quiz.n, by['yes-no'].n], [351, 213, 49, 89]);
  assert.ok(by.decision.flagged <= 4, `${by.decision.flagged} of ${by.decision.n} genuine decisions flagged (at most 2%)`);
  assert.ok(by.quiz.flagged >= 0.7 * by.quiz.n && by['yes-no'].flagged >= 0.5 * by['yes-no'].n, JSON.stringify(by));

  // every question the prompts show passes (the crew learns from them): the JSON openings with their context, the model
  // consultation; and each "<good>?", not "<bad>?" pair of the guidance says what the tool does
  const pdir = new URL('../director/prompts', import.meta.url).pathname;
  let shown = 0, pairs = 0;
  for (const f of readdirSync(pdir).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(join(pdir, f), 'utf8');
    let context = [];
    for (const m of text.matchAll(/\{"agent": "[a-z]+"[^{}]*\}/g)) {
      let e;
      try { e = JSON.parse(m[0]); } catch { continue; }
      if (e.move === 'ask') context = [];
      if (e.move === 'context') context.push(e.summary);
      if (e.move !== 'question' && e.move !== 'followup') continue;
      shown++;
      assert.deepEqual(C.questionCraft(e.summary, { move: e.move, problem: e.problem ?? null, host: e.consult?.[0], context }), [], `${f}: ${e.summary}`);
    }
    let ctx = [], ans = [];
    for (const m of text.matchAll(/^([A-Z][a-z]+) \[([a-z-]+)\]:\s+(.+)$/gm)) {
      if (m[2] === 'ask') { ctx = []; ans = []; }
      if (m[2] === 'context') ctx.push(m[3]);
      if (m[2] === 'answer' || m[2] === 'followup-answer') ans.push(m[3]);
      if (m[2] !== 'question' && m[2] !== 'followup') continue;
      shown++;
      assert.deepEqual(C.questionCraft(m[3], { move: m[2], context: ctx, answers: ans }), [], `${f}: ${m[3]}`);
    }
    for (const m of text.replace(/\s+/g, ' ').matchAll(/"([^"]+\?)", not "([^"]+\?)"/g)) {
      pairs++;
      assert.deepEqual([Q(m[1]), Q(m[2])], [[], ['genuine']], `${f}: "${m[1]}", not "${m[2]}"`);
    }
  }
  assert.ok(shown >= 5 && pairs >= 5, `${shown} example questions, ${pairs} good / bad pairs`);
}

// 3. the orchestrator with the stub Muse --------------------------------------------------------
const quiet = () => {};
/** Why a run failed: its gate problems, each Muse run's exit, and the stub's stderr (kept in the failed run's scratch). */
const why = (r) => [r.gate?.problems?.slice(0, 8).join('; '), ...(r.provenance?.runs ?? []).map((m) => `${m.kind}: exit ${m.exit} after ${m.wallSeconds}s`),
  ...(r.work && existsSync(join(r.work, '.director')) ? readdirSync(join(r.work, '.director')).filter((f) => f.endsWith('-muse.err')).map((f) => `${f}: ${readFileSync(join(r.work, '.director', f), 'utf8').split('\n').filter((l) => l.trim() && !/skill/i.test(l)).slice(-15).join('\n')}`) : [])].join('\n');
{
  const out = join(tmp('direct'), 'hot-soup');
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 20, timeout: 120, log: quiet });
  assert.ok(r.ok, `gate: ${why(r)}`);
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
  const expected = FIXTURE_EVENTS;
  assert.equal(ev.length, expected, 'every cue of every role landed');
  const prov = JSON.parse(readFileSync(join(out, 'director.json'), 'utf8'));
  assert.equal(prov.muse.version, '0.0.0-stub (stub)');
  assert.equal(prov.muse.model, 'stub-model');
  assert.equal(prov.muse.repo, true, 'the repository is offered (the stub read its git log through $MB_REPO)');
  assert.equal(prov.gate.ok, true);
  assert.equal(prov.perRole.lyrics.lines, 42);
  assert.ok(ROLES.every((a) => prov.perRole[a].events > 0));
  assert.ok(prov.consultations >= 2);
  assert.deepEqual([prov.consult.threads, prov.consult.complete, prov.consult.followups], [CONSULTATIONS, CONSULTATIONS, 1], 'every consultation of the fixture, ask to thanks, through eight concurrent agents');
  // the plot's trouble (plot-trouble.js): Black's two problems pitched to Green, accepted, sung in a verse of acts 1
  // and 2, each solved in a later beat; the plan records the eight roles
  assert.deepEqual(prov.trouble && [prov.trouble.pitched, prov.trouble.accepted, prov.trouble.sung, prov.trouble.resolved, prov.trouble.acts], [2, 2, 2, 2, [1, 2]]);
  const sung = ev.filter((e) => e.trouble), solved = ev.filter((e) => e.resolves);
  assert.deepEqual(sung.map((e) => e.beat), ['beat-2-verse1', 'beat-6-verse2b']);
  assert.deepEqual(solved.map((e) => [e.beat, e.resolves]), [['beat-5-verse2', sung[0].trouble], ['beat-11-outro', sung[1].trouble]]);
  assert.ok(ev.filter((e) => e.verdict).every((e) => e.verdict === 'accept' && e.bot === 'Green' && e.move === 'answer'));
  assert.ok(ev.filter((e) => e.problem).every((e) => e.bot === 'Black' && e.move === 'question'));
  assert.deepEqual(threadProblemsOf(ev), [], 'each in its order');
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
  // the activity log: every gate call of the run (emit.js logs them; the stub has no session logs), in the bundle,
  // in time order, the crew's writes resolved to the bundle's seqs, nothing local in it (validate-bundle checks it)
  const act = readFileSync(join(out, 'activity.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(act.length >= ev.length / 6 && act.every((a, i) => i === 0 || a.t >= act[i - 1].t), `${act.length} activity entries in order`);
  assert.ok(act.some((a) => a.who === 'director' && a.kind === 'plan' && a.n === 11), 'the plan sent');
  assert.ok(ROLES.every((r) => act.some((a) => a.who === r && a.kind === 'status')), 'every agent read the plan');
  assert.ok(ROLES.every((r) => act.some((a) => a.who === r && ['write', 'queue'].includes(a.kind) && a.seqs?.length)), 'every agent wrote');
  const sent = act.flatMap((a) => a.seqs ?? []);
  assert.equal(new Set(sent).size, sent.length, 'an event sent once');
  assert.ok(sent.length >= 0.9 * ev.length, `${sent.length} of ${ev.length} events traced to their call`);
  assert.ok(!/\/Users\/|\/var\/folders|\/private\/|\/tmp\//.test(JSON.stringify(act)), 'no local paths');
  assert.equal(prov.activity.entries, act.length);
}
await assert.rejects(direct(PLAN.prompt, { craft: 'loud', muse: STUB, log: quiet }), /--craft: one of strict, warn, off/);
// the overlay carries eight agent definitions whose prompts carry the live vocabulary
{
  const ctx = { prompt: PLAN.prompt, emit: '/x/emit', args: { emit: '/x/emit' } };
  const overlay = crewOverlay(ctx);
  assert.deepEqual(Object.keys(overlay).sort(), ['black-trouble', 'blue-lighting', 'gold-deals', 'gray-dance', 'green-lyrics', 'pink-comedy', 'white-chords', 'yellow-hype']);
  assert.match(overlay['black-trouble'].prompt, /"problem"/);
  assert.match(overlay['black-trouble'].prompt, /at least 2 of yours accepted/);
  for (const [k, v] of Object.entries(overlay)) assert.ok(!/\{\{[A-Z_]+\}\}/.test(v.prompt), `${k}: unfilled placeholder`);
  assert.match(overlay['blue-lighting'].prompt, /`lights-gold`/);
  assert.match(overlay['pink-comedy'].prompt, /`boing`/);
  assert.match(directorPrompt(ctx), /musical-bots-crew/);
  // the slim overlay (a kernel that caps one argument, Linux's 128 KiB MAX_ARG_STRLEN; the full one is ~220 KB):
  // each role keeps its own prompt and reads the crew's rules from its file, the same text the full overlay carries
  const dir = tmp('slim');
  const slim = crewOverlay(ctx, { rulesDir: dir });
  assert.ok(Buffer.byteLength(JSON.stringify(overlay)) > 128 * 1024, 'the full overlay is over Linux\'s cap (else the slim one is moot)');
  assert.ok(Buffer.byteLength(JSON.stringify(slim)) < 64 * 1024, `slim overlay ${Buffer.byteLength(JSON.stringify(slim))} bytes`);
  for (const a of ROLES) {
    const t = agentType(a), file = rulesFile(dir, a), rules = readFileSync(file, 'utf8');
    assert.ok(slim[t].prompt.includes(`\`${file}\``) && /read the whole file with read_file/.test(slim[t].prompt), `${t}: names its rules file`);
    assert.match(rules, /^# The crew's rules/);
    const [, role] = slim[t].prompt.split(/binds you exactly as this text does\.\n\n/);
    assert.equal(`${slim[t].prompt.split('\n')[0]}\n\n${role.trimEnd()}\n\n${rules}`, overlay[t].prompt, `${t}: the slim definition is the full one`);
  }
}
// a stalled crew: the watchdog stops Muse, the gate fails, the repair run resumes at the open beat
{
  const out = join(tmp('stall'), 'hot-soup');
  process.env.STUB_MUSE_STALL = '5';
  process.env.MB_MAX_ARG_BYTES = String(128 * 1024); // as on Linux: the slim overlay (the stub refuses a longer argument, as the kernel does)
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 15, timeout: 300, repo: false, log: quiet }); // --no-repo: no MB_REPO, no repository section (the stub checks); stall/timeout have headroom for a loaded CI runner (production stall is 240)
  delete process.env.STUB_MUSE_STALL;
  delete process.env.MB_MAX_ARG_BYTES;
  assert.ok(r.ok, `gate after repair: ${why(r)}`);
  assert.equal(r.provenance.runs.length, 2);
  assert.equal(r.provenance.runs[1].kind, 'repair1');
  assert.equal(r.provenance.muse.repo, false);
  execFileSync(process.execPath, [VALIDATE, out]);
}
// a host that can't run Muse's shell sandbox (a Vercel Sandbox, Nov 2: no usable bubblewrap, every bash call fails and
// the director ends its turn, exit 0, with no plan): not asked again, the why kept; --no-muse-sandbox runs the shell bare
{
  const { reasonOf } = await import('../scripts/director/sandbox-run.js');
  process.env.STUB_MUSE_NO_SHELL = '1';
  const r = await direct(PLAN.prompt, { out: join(tmp('noshell'), 'hot-soup'), muse: STUB, stall: 20, timeout: 120, repo: false, log: quiet });
  assert.equal(r.ok, false);
  assert.deepEqual(r.gate.problems, ['no beats.json']);
  assert.equal(r.provenance.runs.length, 1, 'a shell that cannot run is not asked to plan again');
  assert.match(r.provenance.runs[0].shell, /^Bubblewrap is unavailable for linux/);
  assert.match(r.provenance.runs[0].said, /bash cannot run here/, "the director's last words are kept");
  assert.ok(r.provenance.runs[0].stderr.some((l) => /Bubblewrap/.test(l)) && !r.provenance.runs[0].stderr.some((l) => /workspace root/.test(l)), "Muse's stderr tail, without its noise");
  assert.equal(r.provenance.muse.shellSandbox, true);
  assert.equal(reasonOf(r.provenance), "Muse Code's shell could not run in the sandbox, so no plan was written");
  const bare = await direct(PLAN.prompt, { out: join(tmp('noshell-bare'), 'hot-soup'), muse: STUB, stall: 20, timeout: 120, repo: false, museSandbox: false, log: quiet });
  delete process.env.STUB_MUSE_NO_SHELL;
  assert.ok(bare.ok, `with --no-muse-sandbox: ${why(bare)}`);
  assert.equal(bare.provenance.muse.shellSandbox, false);
  assert.ok(!bare.provenance.runs.some((x) => x.shell || x.said), 'a run that planned keeps no failure notes');
  // a director that just ended its turn: the page says what it said last (shortened), else that no plan was written
  const said = 'Plan ready, but I cannot send it: the emit step needs bash. What I learned: kittens meow to mom when hungry, cold or hurt; adult cats rarely meow at each other, mostly to humans';
  assert.match(reasonOf({ gate: { ok: false, problems: ['no beats.json'] }, runs: [{ exit: 0 }, { exit: 0, said }] }), /^no plan was written; the director said: "Plan ready, but I cannot send it: .{20,}\.\.\."$/);
  assert.equal(reasonOf({ gate: { ok: false, problems: ['no beats.json'] }, runs: [{ exit: 0 }] }), 'no plan was written');
}
// a broken bundle fails the gate and keeps the previous good one in place
{
  const out = join(tmp('keep'), 'hot-soup');
  writeFileSync(join(tmp('noop'), 'x'), '');
  const first = await direct(PLAN.prompt, { out, muse: STUB, stall: 60, timeout: 240, log: quiet }); // (headroom: a loaded machine)
  assert.ok(first.ok, `the first run: ${why(first)}`);
  const before = readFileSync(join(out, 'events.ndjson'), 'utf8');
  process.env.STUB_MUSE_STALL = '3';
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 2, timeout: 120, repairs: 0, log: quiet });
  delete process.env.STUB_MUSE_STALL;
  assert.equal(r.ok, false);
  assert.ok(r.gate.problems.some((p) => /lines/.test(p)));
  assert.equal(readFileSync(join(out, 'events.ndjson'), 'utf8'), before, 'a failed run never replaces a good bundle');
}
console.log('director ok: validation, turnstile, song form, craft checks + bypass + answers + sung thoughts, orchestrator + stub Muse (8 concurrent agents), plot trouble, genuine questions, watchdog + repair, a host without Muse\'s shell sandbox');
