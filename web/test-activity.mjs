// The making-of as the loading bar, sung from the production's real work:
//   1. the activity log, read from a real run's Muse session logs (web/fixtures/muse-hackathon-oct31: the director
//      and its seven crew subagents, Oct 31, trimmed and sanitized) and from the emit tool's own log: what each did,
//      when, the queued events traced to their seqs; sanitized (no local path, no key, no token);
//   2. the lines it sings (web/src/activity-lines.js): short, words the singer knows, said to a crewmate, never to
//      the viewer, deterministic; a rejection and its advice an exchange;
//   3. the score with it: the waits filled with real work in time order, each line at or after its time, the queued
//      thoughts sung from when they were written, the work song in real lulls only (20 s apart at least), and the
//      making-of ending within 30 s of the production;
//   4. validate-bundle.js reads the log (optional; a local path in it is refused).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const A = await import('../scripts/director/activity.js');
const E = await import('../scripts/director/emit.js');
const { knownWord } = await import('../scripts/director/craft.js');
const L = await import('./src/activity-lines.js');
const { scoreMakingOf, CREW, REFRAIN_GAP, ACT_LAG, LEAD, MAKING_OF_TEMPO } = await import('./src/making-of-score.js');
const { BEATS_PER_BAR } = await import('./src/song/form.js');
const { syllabify } = await import('./src/mv/voice/syllables.js');
const { namesIn } = await import('./src/cues.js');
const { modernBundle } = await import('./src/cast16.js');
const { NAMES } = await import('./src/gen/cast.js');

const FIX = new URL('./fixtures/muse-hackathon-oct31/', import.meta.url).pathname;
const VALIDATE = new URL('../scripts/validate-bundle.js', import.meta.url).pathname;
const ndjson = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const events = ndjson(join(FIX, 'events.ndjson')).map(modernBundle);
const beats = modernBundle(JSON.parse(readFileSync(join(FIX, 'beats.json'), 'utf8')));
const director = JSON.parse(readFileSync(join(FIX, 'director.json'), 'utf8'));
const t0 = Date.parse(director.startedAt);
const sessions = readdirSync(FIX).filter((f) => f.endsWith('.session.jsonl')).sort()
  .map((f) => ({ text: readFileSync(join(FIX, f), 'utf8'), who: f === 'director.session.jsonl' ? 'director' : undefined }));

// 1. the activity log -------------------------------------------------------------------------------------------
const act = A.activityOf({ sessions, events, t0 });
{
  assert.deepEqual(A.activityProblems(act, { events }), [], 'a valid log');
  assert.ok(act.every((e, i) => i === 0 || e.t >= act[i - 1].t), 'in time order');
  const of = (who, kind) => act.filter((e) => e.who === who && e.kind === kind);
  // the director: its homework (a look, a web search, a page, the git log), its long think, the plan, the launch, the gate
  assert.ok(of('director', 'search').length >= 1 && of('director', 'fetch').length >= 1 && of('director', 'git').length >= 1, 'the homework');
  assert.equal(of('director', 'search')[0].detail, 'Meta Global AI Hackathon dev.meta.ai events');
  assert.equal(of('director', 'fetch')[0].detail, 'dev.meta.ai');
  assert.ok(of('director', 'git').every((g) => !g.sing || L.COMMIT_PHRASES.some(([, x]) => x === g.sing)), 'a commit subject sung as the fix it is, or not at all');
  assert.ok(of('director', 'git').some((g) => g.sing && L.commitPhrase(g.detail) === g.sing), 'the subject that names a fix, picked');
  const plan = of('director', 'plan')[0], launch = of('director', 'launch')[0], think = of('director', 'think')[0];
  assert.ok(plan && plan.n === 11 && plan.detail === 'Big Hackathon Win', `the plan: ${JSON.stringify(plan)}`);
  assert.ok(think && think.t < plan.t && think.sing === 'plan' && think.seconds >= 40, 'the director thinks the plan through first');
  assert.ok(launch && launch.t > plan.t && launch.t < 80, 'then launches the crew');
  assert.ok(!of('director', 'think').some((e) => e.t > launch.t), 'waiting on the crew is not thinking');
  assert.ok(of('director', 'check').at(-1)?.detail === 'gate ok', 'the gate at the end');
  // the crew: each reads the plan, writes (or queues ahead), is turned down by the gate now and then, and is done
  for (const r of E.crewOf(beats)) { // (the fixture's run: the seven roles of Oct 31; Black's plot trouble joined Nov 1)
    assert.ok(of(r, 'status').length >= 1, `${r} reads the plan`);
    assert.ok(of(r, 'write').length + of(r, 'queue').length >= 1, `${r} writes`);
    assert.ok(of(r, 'done').length >= 1, `${r} signs off`);
  }
  const rejects = act.filter((e) => e.kind === 'reject');
  assert.ok(rejects.length >= 20 && rejects.every((e) => A.REASONS.includes(e.reason)), `${rejects.length} rejections`);
  assert.ok(new Set(rejects.map((e) => e.reason)).size >= 6, 'for varied reasons');
  assert.ok(act.filter((e) => e.retry).length >= 15, 'a rejection, then the retry');
  // Green thinks the intro through for minutes before his first stanza (his first call: the plan)
  const g = of('lyrics', 'think')[0];
  assert.ok(g && g.detail === 'intro' && g.seconds > 120 && g.t < 90, `Green's long think: ${JSON.stringify(g)}`);
  // the queued events: traced to their seqs, written minutes before they landed
  const queued = act.filter((e) => e.kind === 'queue');
  const seqs = queued.flatMap((e) => e.seqs ?? []);
  assert.ok(seqs.length >= 30 && new Set(seqs).size === seqs.length, `${seqs.length} queued events traced`);
  const lead = seqs.map((s) => events[s].t - queued.find((e) => e.seqs?.includes(s)).t);
  assert.ok(lead.every((x) => x > 0) && lead.reduce((a, b) => a + b, 0) / lead.length > 100, 'written well before they landed');
  // the crew's first real work before its first event
  for (const r of ['lyrics', 'deals', 'hype']) {
    const first = act.find((e) => e.who === r).t, ev = events.find((e) => e.agent === r).t;
    assert.ok(first < ev - 60, `${r} at work at ${first}, its first event at ${ev}`);
  }
  // sanitized: no local path, no home, no secret, details short
  const text = JSON.stringify(act);
  assert.ok(!/\/Users\/|\/home\/|\/var\/folders|\/private\/|someone|MB_REPO|\$[A-Z]/.test(text), 'no local paths or env');
  assert.ok(act.every((e) => (e.detail ?? '').length <= 60 && (e.sing ?? '').split(' ').length <= 5));
}
// the parts, on their own
{
  assert.equal(A.sanitize('cat /Users/someone/Projects/musical-bots/README.md'), 'cat README.md');
  assert.equal(A.sanitize('ls "/var/folders/zz/x/T/mb-direct-a-1/.director/"'), 'ls .director');
  assert.equal(A.sanitize('https://dev.meta.ai/events/global-hackathon?ref=x'), 'dev.meta.ai');
  assert.equal(A.sanitize('curl -H "Authorization: Bearer abc" token=s3cr3t sk-ABCDEFGHIJKLMNOP x'), 'curl -H x');
  assert.equal(A.sanitize('echo $HOME ${MB_REPO} ~/.config/muse'), 'echo muse');
  assert.ok(!/[A-Za-z0-9]{24}/.test(A.sanitize('id 0123456789abcdef0123456789abcdef done')));
  assert.equal(A.singable('Meta Global AI Hackathon dev.meta.ai events', 3).split(' ').includes('ai'), false, 'an acronym is not sung');
  assert.equal(A.singable('how to kill weeds in a garden', 3), 'weeds garden', 'kid-friendly, no small words');
  assert.equal(A.singable('xqzzt blorf'), '');
  assert.equal(A.singablePhrase('Real singing: Magna Vocalization voice engine with mouth-synced lyrics').text, 'real singing');
  assert.equal(A.singablePhrase('Bridges sing in we too; I only for a catchphrase or a dare').text, 'bridges sing in we too');
  assert.deepEqual(A.pickSubject(['Port Soothing Bots heads: mech builders, 20', 'Camera: close-ups follow the singer']), { subject: 'Camera: close-ups follow the singer', sing: 'the camera fix' });
  assert.deepEqual(A.pickSubject(['Port Soothing Bots heads: mech builders, 20']), { subject: 'Port Soothing Bots heads: mech builders, 20', sing: '' }, 'no fix to name: not sung');
  // the details in plain words: a fix by its keywords, a search by its key words, a page by its site's name
  assert.equal(L.commitPhrase('High-fives land on the hands, not the heads'), 'the high five fix');
  assert.equal(L.commitPhrase('Swarm: no two bots overlap'), 'the crowd rule');
  assert.equal(L.commitPhrase('Spot follows the singer'), 'the spotlight fix');
  assert.equal(L.commitPhrase('Port Soothing Bots heads: mech builders, 20'), null);
  assert.equal(L.searchPhrase('Meta Global AI Hackathon dev.meta.ai events', 'meta global hackathon'), 'the hackathon');
  assert.equal(L.searchPhrase('Meta hackathon judging rules 2026'), 'the hackathon rules');
  assert.deepEqual(L.pagePhrases('meta', 'the hackathon'), ["Meta's hackathon page", 'the hackathon page', "Meta's page"]);
  assert.equal(A.reasonOf('  - [meter] its stresses pile up'), 'meter');
  assert.equal(A.reasonOf('REJECTED: beat-2-verse1 is closed (the band moved on).'), 'closed');
  assert.equal(A.reasonOf('summary "x" talks to nobody: the crew talks'), 'nobody');
  assert.equal(A.reasonOf('summary: "x" speaks to the viewers (being watched)'), 'fourth-wall');
  assert.equal(A.reasonOf('something new'), 'other');
  assert.deepEqual(A.sentEvents(`/x/.director/emit <<'EOF'\n[{"agent":"dance","beat":"beat-1-intro","summary":"Hi, Green"}]\nEOF`), [{ agent: 'dance', beat: 'beat-1-intro', summary: 'Hi, Green' }]);
  assert.equal(A.emitStatus('(node:1) Warning\nQUEUED: 1 event for beat-3'), 'queued');
  assert.equal(A.emitStatus('REJECTED (nothing was appended):\n  - x'), 'rejected');
  assert.deepEqual(A.commitSubjects('2026-10-28 Scaffold the web client\nabc1234 Fix the bots\n'), ['Scaffold the web client', 'Fix the bots']);
  // a tool call that says nothing is left out
  assert.equal(A.classify({ name: 'bash', args: { command: 'sleep 5' }, result: '' }), null);
}
// the emit tool's own log: every gate call, as activity (it replaces the emit calls of the session logs)
{
  const dir = mkdtempSync(join(tmpdir(), 'mb-activity-'));
  E.initState(dir, { prompt: 'p', slug: 's', t0: Date.now() - 12000 });
  E.logAttempt(dir, { op: 'status', agent: 'chords', status: 'ok' });
  E.logAttempt(dir, { op: 'emit', agent: 'chords', status: 'rejected', beat: 'beat-1-intro', sent: ['Hi'], problem: '[meter] its stresses pile up' });
  E.logAttempt(dir, { op: 'emit', agent: 'chords', status: 'queued', beat: 'beat-1-intro', sent: [events[0].summary] });
  const att = A.readAttempts(dir);
  assert.equal(att.length, 3);
  assert.ok(att.every((a) => a.t >= 11.9 && a.t < 20), 'seconds since the production started');
  const log = A.activityOf({ sessions, attempts: att, events, t0 }); // (the gate's log is in the production's seconds already)
  const mine = log.filter((e) => e.who === 'chords' && e.t >= 11.9 && e.t < 20);
  assert.deepEqual(mine.map((e) => e.kind), ['status', 'reject', 'queue']);
  assert.equal(mine[1].reason, 'meter');
  assert.ok(mine[2].retry && mine[2].seqs?.[0] === 0, 'the retry, traced to its event');
  assert.ok(!log.some((e) => e.who === 'chords' && ['write', 'queue', 'status'].includes(e.kind) && e.t > 20), 'the session logs\' emit calls give way to the gate\'s own log');
  assert.ok(log.some((e) => e.who === 'director' && e.kind === 'search'), 'the rest of the session logs stays');
}

// 2. the lines -----------------------------------------------------------------------------------------------
const lines = L.activityLines(act);
{
  const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'we', 'to', 'and', 'for', 'on', 'i', "i'm", "i've", "it's", "let's", "here's", "what's", "that's", "can't", "won't", "they're", 'is', 'it']);
  const check = (bot, to, text, why) => {
    const n = syllabify(text).length;
    assert.ok(n >= 3 && n <= L.MAX_SYLLABLES + 1, `${why}: "${text}" ${n} syllables`);
    for (const w of text.match(/[A-Za-z']+/g)) assert.ok(SMALL.has(w.toLowerCase()) || knownWord(w) || NAMES.includes(w) || w === 'Crew', `${why}: "${w}" in "${text}" is a word the singer knows`);
    assert.deepEqual(E.fourthWall(text), [], `${why}: "${text}" never to the viewer`);
    const named = namesIn(text, CREW);
    assert.ok(!named.includes(bot), `${why}: "${text}" names its singer`);
    assert.ok(named.length >= 1 || /^Crew\b|\bcrew!/.test(text) || /^No!|^Oh|^Oops/.test(text), `${why}: "${text}" said to a crewmate`);
    if (to) assert.ok(CREW.includes(to) && to !== bot, `${why}: to ${to}`);
  };
  // every template of every kind, filled with a detail and without, by every singer
  const kinds = ['search', 'fetch', 'read', 'look', 'git', 'think', 'status', 'plan', 'launch', 'check', 'done'];
  for (const who of A.WHO) {
    for (const kind of kinds) {
      for (const [sing, extra] of [[undefined, {}], ['garden', {}], ['bridges sing in we too', {}], ['lines', {}], ['plan', { n: 11 }], [undefined, { detail: 'gate ok', beat: 'beat-4-chorus1' }]]) {
        for (let k = 0; k < 6; k++) {
          const e = { t: 10 + k * 7.3, who, kind, ...(sing ? { sing } : {}), ...extra };
          const l = L.lineOf(e, k, k % 2 === 1, { again: k % 3 === 0 });
          if (!l) continue;
          check(l.bot, l.to, l.text, `${who} ${kind}`);
        }
      }
    }
    for (const reason of A.REASONS) {
      for (let k = 0; k < 4; k++) {
        const x = L.exchangeOf({ t: k * 3.1, who, kind: 'reject', reason });
        check(x.bot, x.to, x.text, `${who} ${reason}`);
        check(x.reply.bot, x.reply.to, x.reply.text, `${who} ${reason} advice`);
        assert.ok(x.reply.bot === x.to && x.reply.to === x.bot && namesIn(x.reply.text, CREW).includes(x.bot), 'the advice goes back to the one rejected');
      }
    }
  }
  assert.equal(L.singerOf('director'), 'Gold', 'the producer sings the director\'s work');
  assert.equal(L.singerOf('lyrics'), 'Green');
  // the log's lines: in time order, varied, nothing for the writes (the events themselves are sung)
  assert.ok(lines.length >= 30 && lines.every((l, i) => i === 0 || l.t >= lines[i - 1].t), `${lines.length} lines`);
  for (const l of lines) check(l.bot, l.to, l.text, `t ${l.t}`);
  assert.ok(!lines.some((l) => ['write', 'queue'].includes(l.kind)));
  assert.ok(lines.filter((l) => l.reply).length >= 15, 'the rejections, exchanges');
  assert.ok(new Set(lines.map((l) => l.text)).size >= 0.6 * lines.length, 'varied');
  assert.equal(lines.filter((l) => l.kind === 'status' && l.t < 85).length, 1, 'seven agents reading the plan at once: one line');
  assert.match(lines.find((l) => l.kind === 'search').text, /\bthe hackathon\b/, 'the real query, its key words');
  assert.match(lines.find((l) => l.kind === 'fetch').text, /Meta's hackathon page/, 'the page by its site\'s plain name');
  assert.ok(lines.filter((l) => l.kind === 'git').every((l) => L.COMMIT_PHRASES.some(([, x]) => l.text.includes(x))), 'the log: a fix by name, never a raw subject');
  assert.match(lines.find((l) => l.kind === 'plan').text, /eleven|story/);
  assert.match(lines.find((l) => l.kind === 'launch').text, /crew/i);
  assert.deepEqual(L.activityLines(act), lines, 'deterministic');
  // the written times: a queued event was written when it was sent
  const w = L.writtenTimes(act, events);
  assert.ok(w.size >= 30 && [...w].every(([s, t]) => t < events[s].t && !events[s].lyric));
}

// 3. the score with it ---------------------------------------------------------------------------------------
{
  const prod = director.wallSeconds;
  const plain = scoreMakingOf(events, beats, { production: prod });
  const s = scoreMakingOf(events, beats, { production: prod, activity: act });
  const bar = BEATS_PER_BAR * 60 / MAKING_OF_TEMPO; // (6/4: six beats a bar)
  const w = L.writtenTimes(act, events);
  const byseq = new Map(events.map((e) => [e.seq, e]));
  const sung = s.items.filter((i) => i.kind !== 'gesture');
  // the real work fills the waits: lines of it, each at or after its time, and soon after (else passed by)
  const work = s.items.filter((i) => i.kind === 'activity');
  assert.ok(work.length >= 10, `${work.length} lines of real work sung`);
  const firsts = work.filter((i) => i.work !== 'advice');
  for (const i of firsts) {
    const l = lines.find((x) => x.text === i.text && x.t <= i.t0 + 1e-6 && i.t0 - x.t <= ACT_LAG + LEAD + 3 * bar);
    assert.ok(l, `"${i.text}" at ${i.t0}: a line of the log, sung at or after its time`);
  }
  assert.ok(firsts.every((x, k) => k === 0 || lines.findIndex((l) => l.text === x.text) >= 0), 'from the log');
  // the advice follows its rejection, sung by the crewmate named
  for (const i of work.filter((x) => x.work === 'advice')) {
    const prev = s.items[s.items.indexOf(i) - 1];
    assert.ok(prev.kind === 'activity' && prev.work === 'reject' && prev.bot !== i.bot && i.text.includes(prev.bot), `the advice "${i.text}" answers "${prev.text}"`);
  }
  // never before its time: an event at or after it was written (a queued one: when it was sent)
  for (const i of s.items) {
    const e = byseq.get(i.kind === 'question' ? i.consultSeq : i.seq);
    if (!e || !['thought', 'line', 'question', 'answer'].includes(i.kind)) continue;
    const at = Math.min(e.t, w.get(e.seq) ?? Infinity);
    assert.ok(i.t0 >= at - 1e-6, `#${e.seq} "${i.text}" at ${i.t0}, written at ${at}`);
  }
  // the director's two minutes are filled: real work sung before the first event lands, and the work song less
  const before = (x, t) => x.items.filter((i) => i.t0 < t);
  const first = events[0].t;
  assert.ok(before(s, first).filter((i) => i.kind === 'activity').length >= 5, 'the director\'s homework and plan, sung');
  assert.ok(before(s, first).filter((i) => i.kind === 'refrain').length <= before(plain, first).filter((i) => i.kind === 'refrain').length, 'no more work songs while the director works');
  // the crew's queued thoughts are sung from when they were written: the minutes before Green's first stanza are talk
  const g0 = events.find((e) => e.lyric).t;
  assert.ok(sung.filter((i) => i.t0 > first && i.t0 < g0 && ['thought', 'question', 'answer'].includes(i.kind)).length >= 12, 'the crew\'s talk while Green writes');
  // the work song: in real lulls only, 20 s apart at least
  const calls = s.items.filter((i) => i.kind === 'refrain' && /Bom, bom/.test(i.text));
  assert.ok(REFRAIN_GAP * bar >= 20 - 1e-6 && calls.every((c, k) => k === 0 || c.t0 - calls[k - 1].t0 >= 20 - 1e-6), `the work songs ${calls.map((c) => c.t0)}`);
  assert.ok(calls.length < plain.items.filter((i) => i.kind === 'refrain' && /Bom, bom/.test(i.text)).length);
  // no long silence while the production runs (the groove alone at most ~25 s), and the end within 30 s
  const starts = sung.map((i) => i.t0).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((t, k) => t - starts[k]).filter((_, k) => starts[k] < prod);
  assert.ok(Math.max(...gaps) <= 26, `the longest wait ${Math.max(...gaps).toFixed(1)} s`);
  assert.ok(s.end >= prod - 1e-6 && s.end - prod <= 30, `${s.end.toFixed(1)} s for ${prod} s (was ${plain.end.toFixed(1)})`);
  assert.ok(s.end - prod < plain.end - prod, 'the end crunch eased');
  // every consultation is still a duet; the loading bar still by the beats as they landed
  for (const q of events.filter((e) => e.status === 'consulting' && e.consult?.length)) {
    assert.ok(s.items.some((i) => i.kind === 'question' && i.consultSeq === q.seq) && s.items.some((i) => i.kind === 'answer' && i.consultSeq === q.seq), `#${q.seq} sung as a duet`);
  }
  const landed = new Map();
  for (const e of events) if (!landed.has(e.beat)) landed.set(e.beat, e.t);
  for (const a of s.arrivals) assert.ok(Math.abs(a.t - landed.get(a.beat)) <= 1 + 1e-6, `${a.beat} arrives at ${a.t}, landed ${landed.get(a.beat)}`);
  assert.ok(s.sections[0].beat === beats.beats[0].id && s.sections.length === beats.beats.length, 'a section a beat, from the intro');
  // deterministic
  const again = scoreMakingOf(events, beats, { production: prod, activity: act });
  assert.deepEqual(again.items, s.items);
  console.log(`activity ok: ${act.length} entries, ${lines.length} lines, ${work.length} sung; ${s.end.toFixed(0)} s for ${prod} s (was ${plain.end.toFixed(0)} s); work songs ${calls.length} (was ${plain.items.filter((i) => i.kind === 'refrain' && /Bom, bom/.test(i.text)).length})`);
}

// 4. validate-bundle.js reads the log ------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'mb-activity-bundle-'));
  for (const f of ['beats.json', 'events.ndjson', 'director.json']) copyFileSync(join(FIX, f), join(dir, f));
  A.writeActivity(dir, act);
  const ok = spawnSync(process.execPath, [VALIDATE, dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\d+ activity entries/);
  writeFileSync(join(dir, 'activity.ndjson'), JSON.stringify({ t: 1, who: 'director', kind: 'read', detail: '/Users/x/secret.txt' }) + '\n');
  const bad = spawnSync(process.execPath, [VALIDATE, dir], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /a local path/);
  writeFileSync(join(dir, 'activity.ndjson'), JSON.stringify({ t: 1, who: 'nobody', kind: 'dance' }) + '\n');
  assert.match(spawnSync(process.execPath, [VALIDATE, dir], { encoding: 'utf8' }).stderr, /who .*kind/s);
}
{
  // the first rejection explains what the lyric gate is (owner, Nov 2: "What even does 'gate' mean?"); later ones advise
  const rej = (t) => ({ t, kind: 'reject', who: 'lyrics', reason: 'rhyme' });
  const ls = L.activityLines([rej(10), rej(200)]).filter((l) => l.kind === 'reject');
  assert.equal(ls.length, 2);
  assert.match(ls[0].reply.text, /lyric gate checks lines/);
  assert.match(ls[0].reply.then.text, /rhyme and beat/);
  assert.equal(ls[1].reply.then, undefined);
}
