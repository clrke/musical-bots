# The director: Muse Code and a crew of seven

An episode of Musical Bots is written by AI subagents, each embodied by a bot, while the audience
watches them work. The director is **Muse Code** (Meta's agentic coding CLI) running headless on a
Meta model (Muse Spark); the crew is seven Muse subagents, one per responsibility, each its own
agent definition with its own prompt from `director/prompts/`:

| Role | Bot | Prompt | What it adds to each beat |
|---|---|---|---|
| lyrics | Teddy | `lyrics.md` | every sung line of the story (the critical path) |
| chords | Nora | `chords.md` | the band's chords, first in each beat |
| dance | Vera | `dance.md` | entrances, walks, group dances, the finale |
| lighting | Gigi | `lighting.md` | light cues and spotlights |
| deals | Lou | `deals.md` | handshakes, promises, the budget |
| hype | Frankie | `hype.md` | high-fives, waves, the huddle |
| comedy | Pearl | `comedy.md` | one clean gag per appearance |

The finished episode is a checked-in bundle (`episodes/<id>/`: `beats.json`, `events.ndjson`,
`director.json`) that premieres in the static app with zero keys at runtime. The same events are
the making-of: their `t` is when the crew wrote them.

## Run it

```
npm run direct -- "Lou sells hot soup on a cold day" --out /tmp/x/hot-soup   # one episode
npm run direct -- --all                                                     # the 12 curated seeds into episodes/
npm --prefix web run dev   # then type a new prompt and press Live: the making-of, live, then the premiere
```

Needs Muse Code logged in (`~/.local/bin/muse`, or `--muse <bin>` / `$MUSE_BIN`) and Node 22.
Options: `--effort` (the crew, default low), `--lyrics-effort` (Teddy, default high) and
`--director-effort` (the plan, default medium), `--model`, `--timeout` (900 s), `--stall` (240 s), `--repairs` (1), `--keep`
(keep the scratch `.director/`: prompts, the agent overlay, Muse's JSONL), `--dry-run` (render the
prompts and the overlay only). Without `--live` a run works in a temp dir and replaces `<out>` only
when the gate passes; a failed run never clobbers a good bundle.

## How a run goes (`scripts/director/`)

1. **`direct.js`** (the orchestrator) prepares the bundle's scratch: the clock (`t0`), a one-line
   emit command, the rendered prompts and the crew overlay. The prompts read the vocabulary at run
   time from `web/src/actions.js` (the action ids; the hand plays offered are the 20 choreographed
   ones, `PLAY_PRIORITY`), `web/src/cues.js` (the lyric markup), `web/src/gen/form.js` and
   `web/src/song/form.js` (the 11 sections, the song form's progressions) and `web/src/gen/cast.js`,
   so they never drift from the stage.
2. It runs **`muse exec --json`** with the director prompt (`prompts/director.md`) and the seven role
   definitions as one `--agents` overlay (`teddy-lyrics`, `nora-chords`, ...). The director plans the
   story (`beats.json`: title, roles, tags, hook, irony, 11 beats with section, set, cast and a plot
   summary) through `emit.js --beats`, then calls Muse's **Workflow** tool with
   `scripts/director/workflow.js` (a per-run copy with its args baked in): `host.parallel` starts the
   seven agents at once, each with `agentType` = its definition.
3. The agents write through **`emit.js`**, the stage manager:
   - it validates every event: fields, names, the v2 markup (`{Name:act}`, `[Pickup]`, ` >> reply`),
     the actions (`resolveAction`), the lyric rules, the generator's own line gates
     (`web/src/gen/lyrics.js` `lineProblems`: 2-7 sung syllables, replies 1-5, the words the voice
     engine cannot sing), the plain present (`rhyme.js` `pastTense`: the obvious pasts), a singer
     never naming themself, no verbatim copy of an example line, and the song form (chorus 1 =
     Hook X Hook Y, chorus 2 the same words, chorus 3 Hook X Hook Turn, the outro the hook then the
     intro's first line) with its rhymes (`rhyme.js`: lines 2 and 4 of verses and bridges, the
     chorus's Y and turned line against X, read with the voice engine's own letter-to-sound
     analyzer; it agrees with all 96 rhyme pairs of Soothing Bots' V5 songs); a bad event is
     rejected with a message that says exactly what to fix, and the agent retries. Hook lines
     without `with` get the pal and the grown-up on stage, so the hook is sung together;
   - it assigns `seq` and `t` (real seconds) and appends atomically (one write under a lock), so the
     bundle is valid NDJSON at every moment and the LIVE page can poll it;
   - **the turnstile** keeps the stream in beat order while seven agents work at once: a beat is open
     until Teddy's stanza is complete and every active agent has moved on (or 15 s after the stanza);
     events for a later beat are queued and land when it opens (Nora's chords and Gigi's lights
     first), events for a closed beat are refused. Nothing blocks: Muse moves a long shell call to
     the background, and an agent waiting on one can lose its turn;
   - after every call it prints **the blackboard**: the open beat, its lines so far, who it waits on,
     the consultations addressed to the caller and the answers to its own.
4. **The gate** (`emit.js --check`, also run by the orchestrator): `scripts/validate-bundle.js`, every
   stanza complete and in form, at least two consultations, all seven roles on the record. A watchdog
   stops a crew that stops appending (and an idle one once the gate passes); a failed gate gets one
   repair run, in which the crew resumes at the open beat.
5. **`director.json`** records the provenance: Muse version, model, efforts, wall time, the making-of's
   length, tokens for the director and for every subagent (summed from Muse's session logs, which
   `run.usage` leaves out for children), an estimated cost from Muse's model catalog, per-role event
   counts and the gate.

Why Muse's own Workflow and not seven `muse exec` processes: the Workflow tool runs custom agent
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
shift-click Live directs a curated prompt anew in dev). `vite build` stays static and drops
`dist/episodes/live`.

## Cost and time

Measured on Muse Code 1.4.14 with its default model, `muse-spark-1.3-contributor` (the contributor
tier: discounted tokens, content may be used for product improvement; `--model muse-spark-1.3` for
the standard tier at $1.25 / $4.25 per million input / output tokens):

- four trial episodes (2026-10-29), every one through the gate with all seven subagents:

  | Prompt | Efforts (plan / Teddy / crew) | Wall | Making-of | Events | Input tokens (cached) | Output | Calls | Cost |
  |---|---|---|---|---|---|---|---|---|
  | Lou sells hot soup on a cold day | low / low / low | 15:01* | 4:26 | 69 | 2.76 M (88%) | 35 K | 89 | $0.046 |
  | Lou sells hot soup on a cold day | medium / medium / low | 2:27 | 2:16 | 79 | 2.33 M (87%) | 34 K | 76 | $0.041 |
  | Frankie loses her voice before the big race | medium / high / low | 2:54 | 2:45 | 78 | 2.47 M (89%) | 42 K | 76 | $0.041 |
  | Murphy delivers a giant cake in the rain (LIVE, dev server) | medium / high / low | 3:35 | 3:24 | 78 | 2.19 M (87%) | 33 K | 72 | $0.039 |

  \*the first run predates the non-blocking turnstile: an agent waiting on a blocked shell call lost
  its turn and the run sat until the timeout. Costs are at the contributor rate; at the standard
  `muse-spark-1.3` rate the same tokens cost about $0.8-0.9 an episode.
- every Muse session starts with about 45 KB of context (its skills catalog and system prompt), so
  each subagent call is mostly cached prefix: cost scales with calls, not with lyrics. The tools are
  cut to `bash`, `read_file` and `workflow` (`run.toolset`), personal rules are excluded
  (`--no-foreign-personal-context`), reminders and web tools are off.

## Tests (no Muse, no cost)

`web/test-director.mjs`: the emit tool's validation, the turnstile and queue, the song form, the
orchestrator against `scripts/director/stub-muse.js` (a stand-in for `muse exec --json` that plays
the director and the seven agents with `fixture.js`, the crew as seven concurrent processes through
the real emit command), the watchdog and the repair run. `web/test-live.mjs`: the paced LIVE player,
the making-of transform and the dev middleware driving the stub.

## Files

- `prompts/director.md`: the director (plan, launch, check); `prompts/rules.md`: every crew member's
  rules (the emit command, the fields, the text rules, consultations); `prompts/<role>.md`: the
  roles; `prompts/cast.md`: the cast bible; `prompts/example.md`: a finished story song for the craft
  (Soothing Bots' "Just a Box").
- `protocol.md`: the event protocol (v2 and the director's additions).
- `../scripts/director/`: `direct.js`, `emit.js`, `vocab.js`, `workflow.js`, `live.js`, `stub-muse.js`,
  `fixture.js`.
