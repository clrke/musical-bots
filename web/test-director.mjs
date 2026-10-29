// The Muse Code director without Muse (no model, no network, no cost):
//   1. emit.js validation: lines, summaries, plans, events (names, markup, actions, roles);
//   2. the turnstile in-process: beat order, the queue for later beats (the lead-in first), closed
//      beats, the stanza capacity, the linger, idle agents, the song form, the chords on the lines;
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
const lp = (l, ctx = {}) => E.lineProblems(l, { section: 'verse1', singer: 'Teddy', roles: PLAN.roles, ...ctx });
assert.deepEqual(lp('{Lou:gasp} counts every cent >> Twice!'), []);
assert.deepEqual(lp('[And] {Sterling:preen} rolls up next door >> Uh-oh!'), []);
assert.ok(lp('{Sterling:preen} parks his truck >> So shiny!').some((p) => /example song/.test(p)), 'a copied example line is refused');
assert.ok(lp('We sing for the soup').some((p) => /lyric rule/.test(p)), 'we is banned');
assert.ok(lp('Lou will pour the soup').some((p) => /lyric rule/.test(p)), 'future tense');
assert.ok(lp('{Bob} stirs the pot').some((p) => /not a bot/.test(p)), 'unknown name');
assert.ok(lp('{Lou:dance} stirs the pot').some((p) => /not a cue/.test(p)), 'unknown cue act');
assert.ok(lp('Soup in the [Oh] pot').some((p) => /Pickup/.test(p)), 'pickup mid-line');
assert.ok(lp('I see a boy at my sink >> Aww!', { section: 'bridge', singer: 'Lou' }).some((p) => /no " >> replies"/.test(p)), 'no replies in a bridge');
assert.ok(lp('I bring a cup of soup >> Yum!', { singer: 'Benny' }).some((p) => /echo/.test(p)), 'the pal gets no reply');
assert.ok(lp('A cup >> Lou says so!').some((p) => /names nobody/.test(p)), 'a reply names nobody');
assert.ok(lp('Gigi opens the box >> Wow!').some((p) => /box/.test(p)), '"box" alone');
assert.deepEqual(lp('I open the toy box lid >> Wow!'), []);
assert.ok(lp('Gigi opens the toy box >> Wow!').some((p) => /ends on a \/ks\/ sound/.test(p)), 'a final /ks/ blurs');
assert.ok(lp('I want a bowl of soup and a spoon and a napkin too').some((p) => /syllables/.test(p)), 'too long');
// the generator's own gates (web/src/gen/lyrics.js), reused: 2-7 sung syllables, replies 1-5
assert.ok(lp('I want a bowl of hot soup now').some((p) => /2-7/.test(p)), 'eight syllables');
assert.ok(lp('Hot soup >> Oh my goodness gracious me').some((p) => /1-5/.test(p)), 'a six-syllable reply');
assert.deepEqual(lp('The dragon has the fun'), [], 'the voice engine sings "has" (it used to crash)');
assert.deepEqual(lp('I get the soup'), [], '"get" too');
assert.deepEqual(lp('I sit there, getting cold'), [], '"getting" is fine');
{
  const { lineProblems: gen } = await import('../web/src/gen/lyrics.js');
  for (const st of LINES) for (const l of st) assert.deepEqual(gen(l.lyric), [], `the fixture passes the generator's gate: ${l.lyric}`);
}
assert.deepEqual(E.summaryProblems('Nora picks the chords for the hook'), []);
assert.ok(E.summaryProblems('Nora will pick the chords').length, 'summary future');
assert.ok(E.summaryProblems('').length);

const good = E.validateBeats(PLAN, { seed: 'muse-hot-soup' });
assert.deepEqual(good.errors, []);
assert.equal(good.beats.version, 2);
assert.equal(good.beats.beats.length, 11);
assert.equal(good.beats.beats[3].id, 'beat-4-chorus1');
const bad = E.validateBeats({ ...PLAN, roles: { lead: 'Teddy', pal: 'Teddy', grown: 'Bob' }, beats: PLAN.beats.slice(0, 5) }, { seed: 's' });
assert.ok(bad.errors.some((e) => /grown/.test(e)) && bad.errors.some((e) => /four different/.test(e)) && bad.errors.some((e) => /exactly 11/.test(e)));
const noLead = E.validateBeats({ ...PLAN, beats: PLAN.beats.map((b, i) => (i === 1 ? { ...b, cast: ['Benny', 'Lou'] } : b)) }, { seed: 's' });
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
}
{ // a line's chords without Nora: the song form's own (the arranger's choice for this seed and these tags)
  const { chooseStyle, styleRomans, chordName } = await import('../web/src/gen/form.js');
  const { sectionChords } = await import('../scripts/director/vocab.js');
  assert.deepEqual(sectionChords('bridge2', good.beats.tags, 'muse-hot-soup'), styleRomans(chooseStyle('muse-hot-soup', good.beats.tags), 'bridge2').map(chordName));
}
const beats = good.beats;
const pe = (raw) => E.prepareEvent(raw, { beats }).errors;
assert.deepEqual(pe({ agent: 'chords', beat: 'beat-1-intro', summary: 'Nora sets the key', chords: ['C', 'G', 'Am', 'F'], action: 'conductor' }), []);
assert.ok(pe({ agent: 'chords', bot: 'Lou', beat: 'beat-1-intro', summary: 'Nora sets the key' }).some((e) => /embodied by Nora/.test(e)));
assert.ok(pe({ agent: 'hype', beat: 'beat-1-intro', summary: 'Frankie cheers', action: 'moonwalk' }).some((e) => /not in the vocabulary/.test(e)));
assert.ok(pe({ agent: 'hype', beat: 'beat-1-intro', summary: 'Frankie cheers', action: 'lights-gold' }).some((e) => /Gigi/.test(e)));
assert.ok(pe({ agent: 'lighting', beat: 'beat-1-intro', summary: 'Gigi glows', action: 'wave' }).some((e) => /lights only/.test(e)));
assert.ok(pe({ agent: 'lighting', beat: 'beat-1-intro', summary: 'Gigi glows', action: 'lights-purple' }).some((e) => /mood/.test(e)));
assert.ok(pe({ agent: 'comedy', beat: 'beat-1-intro', summary: 'Pearl sings', lyric: 'Soup for me today' }).some((e) => /only Teddy/.test(e)));
assert.ok(pe({ agent: 'deals', beat: 'beat-1-intro', summary: 'Lou asks', status: 'consulting' }).some((e) => /consult/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Teddy writes', lyric: 'Soup for {Lou} today', singer: 'Murphy' }).some((e) => /not on stage/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Teddy writes', lyric: '{Teddy:peer} spies soup steam' }).some((e) => /says "I"/.test(e)), 'the lead is I');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Teddy writes', lyric: 'Teddy slips near the door' }).some((e) => /says "I"/.test(e)), 'a plain name too');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Teddy writes', lyric: "Lou's soup is extra", singer: 'Lou' }).some((e) => /says "I"/.test(e)), 'and its possessive');
assert.deepEqual(pe({ agent: 'lyrics', beat: 'beat-2-verse1', summary: 'Teddy writes', lyric: '{Lou} counts every cent >> Twice!' }), [], 'naming another bot is fine');
// the plain present: the obvious pasts are refused, present uses of participles are not
assert.ok(lp('I held the cake up tall').some((p) => /past tense/.test(p)));
assert.ok(lp('It tipped and dropped').some((p) => /"tipped" is past/.test(p)));
assert.ok(lp('{Lou} counted every cent').some((p) => /past tense/.test(p)));
assert.deepEqual(lp("This one's got potential"), [], '"got" in the present');
assert.deepEqual(lp('I need a bowl of soup'), [], '"need" is not a past');
assert.ok(pe({ agent: 'lyrics', beat: 'beat-1-intro', summary: 'Teddy writes', lyric: 'Soup today', mood: 'x' }).some((e) => /unknown field/.test(e)));
assert.ok(pe({ agent: 'lyrics', beat: 'beat-99', summary: 'Teddy writes', lyric: 'Soup today' }).some((e) => /beat must be/.test(e)));
const walk = E.prepareEvent({ agent: 'dance', beat: 'verse1', summary: 'Vera walks Teddy over', action: 'walk-to-lou' }, { beats });
assert.deepEqual(walk.errors, []);
assert.equal(walk.event.action, 'walk-to-Lou', 'a walk target is canonicalized');
assert.equal(walk.event.beat, 'beat-2-verse1', 'a section name resolves to its beat');
// every role's menu resolves in actions.js (the prompts list them)
for (const r of ROLES) for (const id of roleMenu(r)) assert.notEqual(resolveAction(id.replace('<Bot>', 'Lou')).kind, 'none', `${r} menu: ${id}`);
{ // the menus offer only the choreographed hand plays (actions.js PLAY_PRIORITY), every one of them
  const { PLAY_PRIORITY } = await import('../web/src/actions.js');
  const offered = new Set(ROLES.flatMap((r) => roleMenu(r)).filter((id) => resolveAction(id).kind === 'play'));
  assert.ok([...offered].every((id) => PLAY_PRIORITY.includes(id)), 'a fallback-only play is offered');
  assert.deepEqual(PLAY_PRIORITY.filter((id) => !offered.has(id)), [], 'every choreographed play is offered to a role');
}

assert.deepEqual(['low', 'medium', 'high', 'max'].map((e) => atLeast(e, 'high')), ['high', 'high', 'high', 'max'], 'Teddy thinks at least hard');

// 2. the turnstile, in-process -----------------------------------------------------------------
{
  const dir = tmp('turnstile');
  let clock = 1_000_000;
  const now = () => clock;
  const opts = (agent) => ({ as: agent, linger: 1, now });
  E.initState(dir, { prompt: PLAN.prompt, slug: 'hot-soup', seed: 'muse-hot-soup', t0: clock });
  assert.equal(E.writeBeats(dir, PLAN, { now }).status, 'ok');
  E.status(dir, 'chords', { now }); E.status(dir, 'lyrics', { now }); // both registered at beat 1
  const stanza = (i) => LINES[i].map((l) => ({ agent: 'lyrics', beat: beatId(i), ...l }));
  clock += 10_000;
  // a later beat queues: valid, kept, nothing appended yet
  let r = await E.emitEvents(dir, stanza(1).slice(0, 1), opts('lyrics'));
  assert.equal(r.status, 'queued', r.message);
  assert.match(r.message, /QUEUED: 1 event for beat-2-verse1/);
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(1), summary: 'Nora darkens the verse', chords: ['Am', 'F', 'C', 'G'], action: 'conductor' }, opts('chords'));
  assert.equal(r.status, 'queued');
  assert.equal(E.readEvents(dir).length, 0);
  // a resend is a no-op; a queued line is checked now: a fifth verse line is refused at once
  r = await E.emitEvents(dir, stanza(1).slice(0, 1), opts('lyrics'));
  assert.match(r.message, /already sent/);
  r = await E.emitEvents(dir, stanza(1).slice(1), opts('lyrics'));
  assert.equal(r.status, 'queued', r.message);
  r = await E.emitEvents(dir, { agent: 'lyrics', beat: beatId(1), summary: 'Teddy adds one more', lyric: 'One more cold line' }, opts('lyrics'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /already has its 4 lines/);
  // the open intro: Nora's chords, then Teddy's stanza (the lines take Nora's chords)
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(0), summary: 'Nora picks a cold key', chords: ['C', 'G', 'Am', 'F'], action: 'conductor' }, opts('chords'));
  assert.equal(r.status, 'ok', r.message);
  clock += 2_000;
  r = await E.emitEvents(dir, stanza(0), opts('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  // the intro is complete and everyone has moved on: it closes, and verse1's queue lands (the lead-in first)
  let ev = E.readEvents(dir);
  assert.deepEqual(ev.map((e) => `${e.agent}:${e.beat}`), ['chords:beat-1-intro', 'lyrics:beat-1-intro', 'lyrics:beat-1-intro', 'chords:beat-2-verse1',
    'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1', 'lyrics:beat-2-verse1']);
  assert.deepEqual(ev[1].chords, ['C', 'G', 'Am', 'F'], "the intro takes Nora's intro chords");
  assert.deepEqual(ev[4].chords, ['Am', 'F', 'C', 'G'], "the queued verse line takes the verse chords that led it");
  assert.equal(ev[1].singer, 'Teddy', 'the lead sings by default');
  assert.equal(ev[0].t, 10, 't is real seconds since t0');
  assert.equal(ev[4].t, 12, 'a queued event is timed when it lands');
  assert.equal(E.readState(dir).open, 1);
  // the closed intro refuses late work
  r = await E.emitEvents(dir, { agent: 'chords', beat: beatId(0), summary: 'Nora is late', chords: ['C'] }, opts('chords'));
  assert.equal(r.status, 'rejected');
  assert.match(r.message, /closed/);
  // verse1 landed whole from the queue; Vera is still on it, so the complete beat lingers, then closes
  assert.equal(E.readEvents(dir).filter((e) => e.beat === beatId(1) && e.lyric).length, 4);
  E.status(dir, 'dance', { now });
  assert.equal(E.readState(dir).open, 1, 'Vera is still on verse1');
  assert.match(E.status(dir, 'lyrics', { now }).message, /OPEN BEAT: beat-2-verse1[\s\S]*Lines 4\/4[\s\S]*waiting on: Nora, Vera/);
  clock += 1_500;
  E.status(dir, null, { now });
  assert.equal(E.readState(dir).open, 2, 'the linger is over');
  // an agent silent longer than IDLE_S is not waited for
  E.status(dir, 'comedy', { now });
  clock += (E.IDLE_S + 1) * 1000;
  r = await E.emitEvents(dir, stanza(2), opts('lyrics'));
  assert.equal(r.status, 'ok', r.message);
  r = await E.emitEvents(dir, stanza(3).slice(0, 1), opts('lyrics'));
  assert.equal(r.status, 'ok', 'verse1b closed at once: Pearl and Vera are idle');
  // a play the stage has no choreography for still lands, with a note naming the real ones
  r = await E.emitEvents(dir, { agent: 'deals', beat: beatId(3), summary: 'Lou bets a cracker on it', action: 'thumb-war', consult: ['Teddy'] }, opts('deals'));
  assert.match(r.message, /NOTE: thumb-war has no choreography yet[\s\S]*handshake, high-five/);
  // the orchestrator's finalize lands what is queued for the open beat
  r = await E.emitEvents(dir, { agent: 'hype', beat: beatId(4), summary: 'Frankie calls the next round', action: 'cheer' }, opts('hype'));
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
  push(1, ['I want a bowl of soup', 'My hands are icy cold', '{Lou:harrumph} taps the price']);
  assert.match(E.formProblems(beats, evs, 1, 3, 'Two coins for a cup').join(), /"cold" and "cup" do not rhyme/);
  assert.deepEqual(E.formProblems(beats, evs, 1, 3, "That's extra, good as gold!"), []);
  assert.match(E.formProblems(beats, evs, 3, 3, 'Steam on my ten fingers').join(), /do not rhyme/, 'chorus Y rhymes with X');
  push(9, ['Hot soup, hot soup!', 'A bowl to warm my nose', 'Hot soup, hot soup!']);
  assert.match(E.formProblems(beats, evs, 9, 3, 'Free soup for everyone').join(), /turned line rhymes with X/);
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
  const expected = Object.values(CUES).flat().length + 42;
  assert.equal(ev.length, expected, 'every cue of every role landed');
  const prov = JSON.parse(readFileSync(join(out, 'director.json'), 'utf8'));
  assert.equal(prov.muse.version, '0.0.0-stub (stub)');
  assert.equal(prov.muse.model, 'stub-model');
  assert.equal(prov.gate.ok, true);
  assert.equal(prov.perRole.lyrics.lines, 42);
  assert.ok(ROLES.every((a) => prov.perRole[a].events > 0));
  assert.ok(prov.consultations >= 2);
  assert.ok(!existsSync(join(out, '.director')), 'the scratch is cleaned up');
  const beatsOut = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));
  assert.equal(beatsOut.version, 2);
  assert.equal(beatsOut.seed, 'muse-hot-soup');
}
// the overlay carries seven agent definitions whose prompts carry the live vocabulary
{
  const ctx = { prompt: PLAN.prompt, emit: '/x/emit', args: { emit: '/x/emit' } };
  const overlay = crewOverlay(ctx);
  assert.deepEqual(Object.keys(overlay).sort(), ['frankie-hype', 'gigi-lighting', 'lou-deals', 'nora-chords', 'pearl-comedy', 'teddy-lyrics', 'vera-dance']);
  for (const [k, v] of Object.entries(overlay)) assert.ok(!/\{\{[A-Z_]+\}\}/.test(v.prompt), `${k}: unfilled placeholder`);
  assert.match(overlay['gigi-lighting'].prompt, /`lights-gold`/);
  assert.match(overlay['pearl-comedy'].prompt, /`boing`/);
  assert.match(directorPrompt(ctx), /musical-bots-crew/);
}
// a stalled crew: the watchdog stops Muse, the gate fails, the repair run resumes at the open beat
{
  const out = join(tmp('stall'), 'hot-soup');
  process.env.STUB_MUSE_STALL = '5';
  const r = await direct(PLAN.prompt, { out, muse: STUB, stall: 3, timeout: 120, log: quiet });
  delete process.env.STUB_MUSE_STALL;
  assert.ok(r.ok, `gate after repair: ${r.gate.problems.join('; ')}`);
  assert.equal(r.provenance.runs.length, 2);
  assert.equal(r.provenance.runs[1].kind, 'repair1');
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
console.log('director ok: validation, turnstile, song form, orchestrator + stub Muse (7 concurrent agents), watchdog + repair');
