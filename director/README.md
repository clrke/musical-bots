# The director: Muse Code and a crew of eight

An episode of Musical Bots is written by AI subagents, each embodied by a bot, while the audience
watches them work. The director is **Muse Code** (Meta's agentic coding CLI) running headless on a
Meta model (Muse Spark); the crew is eight Muse subagents, one per responsibility, each its own
agent definition with its own prompt from `director/prompts/`:

| Role | Bot | Prompt | What it adds to each beat |
|---|---|---|---|
| lyrics | Green | `lyrics.md` | every sung line of the story (the critical path) |
| chords | White | `chords.md` | the band's chords, first in each beat |
| dance | Gray | `dance.md` | entrances, walks, group dances, the finale |
| lighting | Blue | `lighting.md` | light cues and spotlights |
| deals | Gold | `deals.md` | handshakes, promises, the budget |
| hype | Yellow | `hype.md` | high-fives, waves, the huddle |
| comedy | Pink | `comedy.md` | one clean gag per appearance |
| trouble | Black | `trouble.md` | the plot's trouble: the problems that raise the stakes, pitched to Green or Gold (since Nov 1) |

The finished episode is a checked-in bundle (`episodes/<id>/`: `beats.json`, `events.ndjson`,
`director.json`) that premieres in the static app with zero keys at runtime. The same events are
the making-of: their `t` is when the crew wrote them.

## Run it

```
npm run direct -- "Gold sells hot soup on a cold day" --out /tmp/x/hot-soup   # one episode
npm run direct -- --all                                                     # the 12 curated seeds into episodes/
npm run direct -- --all --only toy-box,garden                               # some of them (or --skip)
npm --prefix web run dev   # then type a new prompt and press Make it: the making-of, live, then the premiere
```

Needs Muse Code logged in (`~/.local/bin/muse`, or `--muse <bin>` / `$MUSE_BIN`) and Node 22.
Options: `--effort` (the crew, default low), `--lyrics-effort` (Green, default high) and
`--director-effort` (the plan, default high), `--model`, `--timeout` (900 s), `--stall` (240 s), `--repairs` (1), `--keep`
(keep the scratch `.director/`: prompts, the agent overlay, Muse's JSONL), `--craft strict|warn|off`
(the craft checks below; default strict), `--no-web` (no web research), `--no-repo` (no read-only
look at this repository and its history; see "Homework" below), `--dry-run` (render the prompts and
the overlay only).
Without `--live` a run works in a temp dir and replaces `<out>` only when the gate passes; a failed
run never clobbers a good bundle.

## How a run goes (`scripts/director/`)

1. **`direct.js`** (the orchestrator) prepares the bundle's scratch: the clock (`t0`), a one-line
   emit command, the rendered prompts and the crew overlay. The prompts read the vocabulary at run
   time from `web/src/actions.js` (the action ids; the hand plays offered are the 20 choreographed
   ones, `PLAY_PRIORITY`), `web/src/cues.js` (the lyric markup), `web/src/gen/form.js` and
   `web/src/song/form.js` (the 11 sections, the song form's progressions) and `web/src/gen/cast.js`,
   so they never drift from the stage.
2. It runs **`muse exec --json`** with the director prompt (`prompts/director.md`) and the eight role
   definitions as one `--agents` overlay (`green-lyrics`, `white-chords`, ...). The director plans the
   story (`beats.json`: title, roles, tags, hook, irony, 11 beats with section, set, cast and a plot
   summary) through `emit.js --beats`, then calls Muse's **Workflow** tool with
   `scripts/director/workflow.js` (a per-run copy with its args baked in): `host.parallel` starts the
   eight agents at once, each with `agentType` = its definition.
3. The agents write through **`emit.js`**, the stage manager:
   - it validates every event: fields, names, the v2 markup (`{Name:act}`, `[Pickup]`, ` >> reply`),
     the actions (`resolveAction`), the lyric rules, the generator's own line gates
     (`web/src/gen/lyrics.js` `lineProblems`: 2-7 sung syllables, replies 1-5), the plain present (`rhyme.js` `pastTense`: the obvious pasts), a singer
     never naming themself, no verbatim copy of an example line, and the song form (chorus 1 =
     Hook X Hook Y, chorus 2 the same words, chorus 3 Hook X Hook Turn, the outro the hook then the
     intro's first line) with its rhymes (`rhyme.js`: lines 2 and 4 of verses and bridges, the
     chorus's Y and turned line against X, read with the voice engine's own letter-to-sound
     analyzer; it agrees with all 96 rhyme pairs of Soothing Bots' V5 songs); a bad event is
     rejected with a message that says exactly what to fix, and the agent retries. Hook lines
     without `with` get the pal and the grown-up on stage, so the hook is sung together;
   - it assigns `seq` and `t` (real seconds) and appends atomically (one write under a lock), so the
     bundle is valid NDJSON at every moment and the LIVE page can poll it;
   - **the turnstile** keeps the stream in beat order while eight agents work at once: a beat is open
     until Green's stanza is complete and every active agent has moved on (or 15 s after the stanza);
     events for a later beat are queued and land when it opens (White's chords and Blue's lights
     first), events for a closed beat are refused. Nothing blocks: Muse moves a long shell call to
     the background, and an agent waiting on one can lose its turn;
   - after every call it prints **the blackboard**: the open beat, its lines so far, who it waits on,
     and every **consultation** the caller is in, line by line, with what comes next (`YOUR TURN` or
     waiting). Since Oct 31 a consultation is a conversation, one event per sung line, each a typed
     `move` of a `thread` (`web/src/consultation.js`, `director/protocol.md`): the asker's ask,
     context and question; the host's ok, ack, reasoning and answer (the answer carries the change:
     White's chords, Blue's cue); a follow-up and its answer when the answer raises an issue; the
     asker's agree and thanks. The tool checks each move's order, side and line, and refuses a role's
     calls from its third on until it opens one; `--done` waits for the consultations it is in. A
     beat's moves land first, in the order sent, then the chords and lights, then the rest. (The
     bundles before it: one-event questions answered by one event, `answers`);
   - every summary is the team's **sung thought** (beats.json `summaries: "we"`): in "we", the crew
     as one (never "I"), present tense, 2-10 sung syllables ("We ask Green where the hook lands");
   - it runs **the craft checks** (below) on every sung line and summary.
4. **The gate** (`emit.js --check`, also run by the orchestrator): `scripts/validate-bundle.js`, every
   stanza complete and in form, at least eight complete consultations (ask to thanks, each in its
   order), every role of the run on the record (beats.json `crew`), and Black's plot trouble (below). A watchdog
   stops a crew that stops appending (and an idle one once the gate passes); a failed gate gets one
   repair run, in which the crew resumes at the open beat.
5. **`director.json`** records the provenance: Muse version, model, efforts, wall time, the making-of's
   length, tokens for the director and for every subagent (summed from Muse's session logs, which
   `run.usage` leaves out for children), an estimated cost from Muse's model catalog, per-role event
   counts, the answers, the craft record (the mode, every bypass with its reason, the words accepted,
   per check how often it rejected, was bypassed or left a note) and the gate.

## The plot's trouble (Black, since Nov 1)

The owner, Nov 1: "One of the rival bots should have the responsibility of making the plot interesting by
introducing problems." Black (the kid next door: schemes and dares, a sore loser who wants friends) is the crew's
eighth role, `trouble` (`black-trouble`, `prompts/trouble.md`; he may still be in the story as a character). For the
beats he works on he dreams up an obstacle, a complication or a twist, gently (rivals are rivals, not villains), and
pitches it to Green (lyrics) or Gold (deals) as a consultation: his `question` carries `"problem": "<one plain
sentence>"` (up to two in one consultation, one a question: Black pitches the act-1 and the act-2 problem in his
first call, under the one-open-question rule; the second's id is `<thread>.2`). The host weighs them and its
answers carry the verdicts in order, both in one call, `"verdict": "accept" | "decline"`. An accepted
problem changes the story: Green's line that sings it carries `"trouble": "<its thread>"` (in a verse: verse1,
verse1b, verse2, verse2b), and a later line of the song's own solves it, `"resolves": "<its thread>"` (a verse, a
bridge, chorus 3's turned line, the outro's lines 3-4). The shared rules are `web/src/plot-trouble.js`:

- at send time (emit.js `troubleSendProblems`): a problem goes to Green or Gold, pitched by verse2b at the latest; the
  host's first answer must carry the verdict, and "accept" only while Green has a verse left to sing it in; a verse
  stanza Green completes after an acceptance must sing the problem waiting (one an act: a second accepted in act 1
  waits for verse2); while fewer than two are accepted or being weighed and verse2b is unwritten, a call of Black's
  own work without a new pitch is refused; the Workflow runs the whole crew at once (`maxParallelAgents`, Green and
  Black launched first: measured Nov 1, a seventh-seat cap started Black minutes late); the outro is refused while a problem sung
  waits for its fix. The blackboard shows Green each PLOT TROUBLE to sing or solve, and Black his count;
- the gate (`troubleGate`, with beats.json `crew` listing `trouble`): at least `MIN_TROUBLES` (2) accepted problems
  sung and solved, one sung in act 1 (verse1, verse1b) and one in act 2 (verse2, verse2b). The count bends: Black (or
  the director, as Black, in a repair) sends `"bypass": {"trouble": "<why, at least 4 words>"}` on one of his events,
  recorded as `bypassed` (one of his 3 bypasses). The solving never bends (`troubleProblems`: every problem sung is
  solved, in a later beat); validate-bundle.js checks the record's shape.

`director.json` `trouble`: `{ pitched, accepted, declined, sung, resolved, acts, bypassed }`. Bundles before Nov 1 have
no `crew` (the seven roles, `LEGACY_CREW`): no trouble is wanted of them, and the making-of reads a "Black" in their
talk as the story's Black, not a crewmate addressed.

## Craft checks (bypassable)

The hard rules never bend (the plain present, brands, nothing menacing, the syllable
limits, the song form and its rhymes, the structure). On top of them, `scripts/director/craft.js`
measures how a line sings and reads; a measure can be wrong about a good line, so it bends:

| Check | A line fails when |
|---|---|
| `dictionary` | a sung word (line, reply or summary) is not one the singer is known to pronounce as the CMU dictionary does: its table (`cmudict.js`), `scripts/director/knownWords.js` (the dictionary's other 32,107 words its letter rules sing exactly right, generated by `web/src/mv/tools/build-cmudict.mjs --known`), the lexicon's exceptions, the overrides, or a regular form of those sung as stem + ending ("wobbles"); cast names are fine; digits, acronyms and non-ASCII letters fail |
| `rhyme` | a rhyme pair ends on the same word (day / day); a near rhyme (cup / cop) or the same last syllable (inside / outside) is a note |
| `meter` | 4 or more stressed syllables in a row in one phrase, by the singer's own stress (sungStress.js; light words like "through" skipped): the duple tunes can put only every other one on a beat ("Sun fills big kitchen") |
| `balance` | a rhyme pair differs by more than 2 sung syllables or 2 stresses |
| `filler` | so + adjective, very, really, just + verb, quite, kind of, thing, stuff, an emphatic do, a line-final "a lot" (catchphrases, pickups and replies aside) |
| `inversion` | an adjective after its noun ("earns the name strong"), "near" after its noun ("barks at pigeons near"), a fronted object or phrase before a final subject + verb ("Cake I eat", "Down the hill I run"), "Sweet is the cake" |
| `repeat` | a content word already sung in the stanza (the hook's words and lines that open alike aside) |
| `voice` | a story line sings "I" / "me" / "my" (the reply aside; "you and me" is "we"), unless it is a catchphrase ("Hold my juice!") or a dare ("Stay out late, I dare"). On a line that brings in or solves the plot's trouble (`trouble` / `resolves`) and in the bridges it never bends ("I tie the rope up tight", red-truck's fix). Calibrated: 21 of the 588 lines (3.6%; 18 after the hackathon-win and red-truck re-directs) |
| `singable` | a listener would not catch it as the voice sings it: the mean `heardChance` of its content words (a logistic model of each word's sounds: the synth fades a final "ng" and blurs "oh", "g", "l", "z", "uu"; cast names, names of things and the premise's and hook's words aside) is under 0.35, or it opens cold on a name of a thing (a brand, a title, the event: "Press Premiere, they sing", "Muse hums...", "Hackathon win!") whose first sound is lost. The message names the weakest words with clearer ones (`CLEARER`: glow -> shine, song -> tune). Fitted on Whisper large-v3 transcribing all 588 premiere story lines of the 14 bundles, each rendered alone as arrange() sets it, in two voices: a cross-validated word AUC 0.62, lines predicted under 0.35 heard 35% vs over 0.65 71%. It flagged 34 of the 588 lines of the v21 bundles (5.8%; 22, 3.7%, once hackathon-win and red-truck were re-directed under it); of the 528 distinct lines, the 41 it flags (7.8%) were heard 43% (both voices), the rest 61%, its 7 cold opens 13%. The plan's hook is checked too (never bypassed) |

In strict mode (the default) a failure rejects the event with how to fix it and how to bypass it:
the agent resends with `"bypass": {"<check>": "<why, at least 4 words>"}`; the tool records
`bypassed: [{ check, reason, words? }]` on the event. At most 3 bypasses per agent per episode, never
on a hook line; a dictionary bypass accepts its word for the rest of the episode. The plan's hook
is checked too and never bypassed (the premise's own words are accepted there, and reported, so a
lexicon entry can follow). `--craft warn` turns every failure into a note, `--craft off` skips them.

Calibrated on the 13 checked-in bundles (546 lines; `node scripts/director/craft.js --calibrate`):
dictionary 4.6% of the lines, meter 2.0%, filler 3.3%, repeat 3.3%, balance 0.7%, inversion 0.2%,
rhyme 0% (none rhymes a word with itself); 12.6% of the lines fail at least one. After the voice
engine's own stress fit the residual stress-vs-beat mismatch is zero for 96% of the lines, so the
meter check measures what the fit cannot fix: the pile-ups.

Measured live (2026-10-30, "The bots join the Meta Global AI Hackathon and win!", strict, two runs):
the checks refused 3 lines a run (meter: "Gold taps two blank screens", "stern gate blocks each
line", "big red stamp says"; dictionary: "whiteout") and one summary ("soften", whose t the singer
sings); the crew fixed every one without a bypass, every summary came out a first-person thought,
and the gate passed on the first run ($0.045 / $0.046, 6:12 / 5:32).

Why Muse's own Workflow and not eight `muse exec` processes: the Workflow tool runs custom agent
definitions in parallel (`agentType`, up to 14 children), headless, in one session with one
provenance trail and a shared prompt cache (the children reuse the director's cached context),
and the director stays the one deciding to launch, check and repair. The orchestrator keeps what a
model should not decide: the clock, the gate, the watchdog and the bundle on disk.

## LIVE

`web/vite.config.js` adds a dev-only middleware (`scripts/director/live.js`): `POST /api/direct`
starts `direct.js --live` writing to `episodes/live/<slug>/` (git-ignored; one run at a time), and
`GET /api/direct/<slug>[/events.ndjson|beats.json|director.json]` serves the run as it grows. The
page (`web/src/making-of.js`) polls the bundle with `player.live()`, which paces the crew's bursts so
they read as one performance: each role bot sings the line it writes, or acts its summary and sings
it while the stage is free; the caption shows the line and the agent's thinking. When the director
finishes, the premiere plays the finished bundle, sung by the story's cast. A curated prompt, and
any prompt in the static build, replays a recorded making-of instead (`?makingof&prompt=...` too;
shift-click Make it directs a curated prompt anew in dev). `vite build` stays static and drops
`dist/episodes/live`.

## Cost and time

Measured on Muse Code 1.4.14 with its default model, `muse-spark-1.3-contributor` (the contributor
tier: discounted tokens, content may be used for product improvement; `--model muse-spark-1.3` for
the standard tier at $1.25 / $4.25 per million input / output tokens):

- four trial episodes (2026-10-29), every one through the gate with all seven subagents:

  | Prompt | Efforts (plan / Green / crew) | Wall | Making-of | Events | Input tokens (cached) | Output | Calls | Cost |
  |---|---|---|---|---|---|---|---|---|
  | Gold sells hot soup on a cold day | low / low / low | 15:01* | 4:26 | 69 | 2.76 M (88%) | 35 K | 89 | $0.046 |
  | Gold sells hot soup on a cold day | medium / medium / low | 2:27 | 2:16 | 79 | 2.33 M (87%) | 34 K | 76 | $0.041 |
  | Yellow loses her voice before the big race | medium / high / low | 2:54 | 2:45 | 78 | 2.47 M (89%) | 42 K | 76 | $0.041 |
  | Silver delivers a giant cake in the rain (LIVE, dev server) | medium / high / low | 3:35 | 3:24 | 78 | 2.19 M (87%) | 33 K | 72 | $0.039 |

  \*the first run predates the non-blocking turnstile: an agent waiting on a blocked shell call lost
  its turn and the run sat until the timeout. Costs are at the contributor rate; at the standard
  `muse-spark-1.3` rate the same tokens cost about $0.8-0.9 an episode.
- the twelve curated episodes in `episodes/` (2026-10-29, `npm run direct -- --all`, efforts
  high / high / low): every one passed the gate on its first run, no repair runs. The toy box is a
  later single run (the sixth toy-box lyric trial, read against the fifth from `--all`). The twelve
  as shipped: 52 minutes and $0.51 in all.

  | Episode | Wall | Making-of | Events | Input tokens (cached) | Output | Calls | Cost |
  |---|---|---|---|---|---|---|---|
  | Big Toy Box Parade | 4:57 | 4:42 | 78 | 2.45 M (88%) | 38 K | 77 | $0.042 |
  | Dino Book Trade | 4:08 | 3:54 | 78 | 2.33 M (86%) | 39 K | 75 | $0.045 |
  | Streetlamp Glow | 4:04 | 3:52 | 76 | 2.29 M (87%) | 41 K | 72 | $0.041 |
  | Silver Rooftop Stars | 1:44 | 1:34 | 78 | 2.31 M (89%) | 37 K | 74 | $0.037 |
  | Hot Soup Day | 4:20 | 4:08 | 79 | 2.34 M (89%) | 38 K | 74 | $0.038 |
  | Big Parade | 3:48 | 3:36 | 81 | 2.39 M (85%) | 40 K | 76 | $0.048 |
  | Giant Birthday Cake | 5:07 | 4:56 | 78 | 2.36 M (88%) | 44 K | 75 | $0.042 |
  | Block Race | 4:39 | 4:22 | 77 | 2.51 M (88%) | 49 K | 76 | $0.044 |
  | School Garden Grow | 5:08 | 4:57 | 79 | 2.39 M (88%) | 39 K | 77 | $0.041 |
  | Share the Red Truck | 4:00 | 3:48 | 78 | 2.43 M (87%) | 44 K | 76 | $0.044 |
  | Bright Yellow Fence | 4:30 | 4:15 | 76 | 2.27 M (87%) | 40 K | 72 | $0.042 |
  | Lost Puppy | 5:36 | 5:15 | 77 | 2.39 M (85%) | 41 K | 75 | $0.048 |
- every Muse session starts with about 45 KB of context (its skills catalog and system prompt), so
  each subagent call is mostly cached prefix: cost scales with calls, not with lyrics. The tools are
  cut to `bash`, `read_file` and `workflow` plus `web_search` and `web_fetch` (`run.toolset`),
  personal rules are excluded (`--no-foreign-personal-context`), reminders are off.

## Homework: web research and fact sheets

- Web research (on by default, `--no-web` turns it off): for a premise about something real, the
  director's Step 0 runs up to 4 `web_search` and 4 `web_fetch` calls, then puts what it checked
  in the plan's `facts` (one sentence each, with its source's domain). The crew sees them on the
  blackboard, and the story is told through them. Measured on "The bots join the Meta Global AI
  Hackathon and win!" with no fact sheet: 8 facts, 6 of them from dev.meta.ai (the dates, the 20,000
  cap, the tracks, Muse Code and the Model API, the $1M pool), about $0.047 and 5.5 min.
- Fact sheet (`director/briefs/<slug>.md`, or `--brief <file>`): checked facts that win over the web.
  The web cannot know a story's private side: the hackathon episode's trial and error (Muse Code
  writing the code, the lyric gate, the missed
  high-fives) comes from `director/briefs/hackathon-win.md`.
- The project itself (on by default, `--no-repo` turns it off): the director and the crew may read
  this repository and its git history, read-only, so a premise about the project (the hackathon
  episode) is told from its real commits. Muse still works in its scratch workspace; `direct.js`
  passes the repo root as `$MB_REPO` (with `GIT_OPTIONAL_LOCKS=0`, so a `git log` never takes the
  index lock) and the director prompt's "The project itself" section (`repoText`) names the
  absolute path and the read-only commands it may run (`git -C "$MB_REPO" log ...`, `git show
  --stat`, `ls`, `read_file` on README.md or docs/), at most 6, with what it uses going into the
  plan's `facts` ("(git log)"). The crew gets one line offering a quick look (`rules.md`: the only
  exception to "never run other programs"). No write is ever asked for: the prompts forbid writes,
  commits and checkouts there. Verified Oct 30 with a real `muse exec` (Muse Code 1.4.14, the run's
  own flags: `--workspace <scratch> --approval-mode never`, toolset bash/read_file/workflow): `git -C
  "$MB_REPO" log --oneline -5`, `ls "$MB_REPO"` and `read_file` on `$MB_REPO/package.json` all
  returned the repo's content from outside the workspace (3 model calls, about 75 K input tokens,
  mostly cached). The stub Muse (`stub-muse.js`) checks the same in the tests: with the repo on,
  the prompt offers it and `git log` reads through `$MB_REPO`; with `--no-repo`, neither.
  `director.json` records it (`muse.repo`).

## Tests (no Muse, no cost)

`web/test-director.mjs`: the emit tool's validation, the turnstile and queue, the song form, each
craft check and its calibration, the bypass and its limits, the craft modes, the answers, the sung
thoughts, the plot's trouble, the orchestrator against `scripts/director/stub-muse.js` (a stand-in for `muse exec --json` that plays
the director and the eight agents with `fixture.js`, the crew as eight concurrent processes through
the real emit command), the watchdog and the repair run. `web/test-live.mjs`: the paced LIVE player,
the making-of transform and the dev middleware driving the stub.

## Files

- `prompts/director.md`: the director (plan, launch, check); `prompts/rules.md`: every crew member's
  rules (the emit command, the fields, the text rules, consultations); `prompts/<role>.md`: the
  roles; `prompts/cast.md`: the cast bible; `prompts/example.md`: a finished story song for the craft
  (Soothing Bots' "Just a Box").
- `protocol.md`: the event protocol (v2 and the director's additions).
- `../scripts/director/`: `direct.js`, `emit.js`, `craft.js` (the craft checks), `knownWords.js` (the
  dictionary check's word list, generated), `rhyme.js`, `vocab.js`, `workflow.js`, `live.js`,
  `stub-muse.js`, `fixture.js`.
