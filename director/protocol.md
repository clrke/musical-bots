# Event protocol (v1)

One NDJSON event stream drives both the making-of performance and the
premiere. Producers (the runtime generator, author-time subagents) append
events; the `web/` player renders them as concurrent singing/acting.

## Bundle layout

```
episodes/<id>/
  beats.json      # prompt, seed, story beats
  events.ndjson   # one JSON event per line, seq 0..n
```

## Event fields

| Field     | Type     | Required | Notes                                          |
|-----------|----------|----------|------------------------------------------------|
| `seq`     | int      | yes      | 0-based, increases by 1 per line               |
| `t`       | number   | yes      | seconds from episode start, non-decreasing     |
| `agent`   | string   | yes      | subagent id: `lyrics`, `chords`, `dance`, …    |
| `bot`     | string   | yes      | embodying bot, canon name (`Gray`, …)          |
| `status`  | string   | yes      | `working`, `proposing`, `done`, `consulting`   |
| `beat`    | string   | yes      | story beat id under construction               |
| `summary` | string   | yes      | short, present-tense, singable                 |
| `lyric`   | string   | yes      | what the bot sings now (may be `""`)           |
| `chords`  | string[] | yes      | what the band plays now (may be `[]`)          |
| `action`  | string   | yes      | animation/interaction id (may be `""`)         |
| `consult` | string[] | yes      | bots being consulted (may be `[]`)             |
| `dye`     | bool     | no       | `true` only on temporary dye-test markers      |

`status: consulting` with ≥2 bots total (`bot` + `consult`) stages an
on-screen consultation: approach, exchange, nod/handshake, resume.

## Text rules

`summary` and `lyric` obey the lyric rules: no future tense (`will`,
`going to`), no brands, nothing menacing. `we`/`us`/`our` are welcome:
the cast sings together (banned until Oct 30). `scripts/validate-bundle.js` enforces the mechanical part; a
human checks brands and menace.

## Names

The cast is called by its face colours (`web/src/cast16.js`: Green, White, Gray, Blue, Gold, Yellow,
Pink, Silver, Purple, Orange, Jade, Navy, Black, Copper, Lilac, Red), so the audience can tell the
bots apart. In text a name is the Capitalised word only: "a gold spot" or "paint it blue" names
nobody (`web/src/cues.js` `namesIn`). Bundles directed before Oct 30 use the old first names
(Teddy, Nora, Lou...): every reader (`parseNdjson`, the app, `emit.js`, `validate-bundle.js`) maps
them through `LEGACY_NAMES` / `modernBundle` in `cast16.js`, so they load and play unchanged.

## Playback

- LIVE: player polls the bundle and stages events as `t` arrives.
- REPLAY: player loads the whole bundle and plays deterministically.
- The premiere is a REPLAY of the finished bundle.

## v2 (2026-10-29): story songs, singers, sets, the action vocabulary

All v2 fields are optional; v1 bundles stay valid and play as before.

### beats.json

| Field | Type | Notes |
|---|---|---|
| `version` | number | `2`: strict checks (every `action` must resolve in `web/src/actions.js`) |
| `title` | string | the episode's title |
| `roles` | object | `{ lead, pal, grown, rival }`: canon names. The lead sings the story, the pal is the echo (sings the replies), the grown-up and the rival sing their own lines |
| `tags` | object | `{ bridge: "suspense"\|"tender" }` (Bridge 2's chords and tune) |
| `beats[].set` | string | where the beat plays: `diner`, `big_house`, `street`, `village`, `winter`, `haunted`, `beach`, `pool`, `pier`, `ocean` (web/src/scene/environments/sets.js, blocking.js marks; the outdoor sets' marks: director/prompts/director.md). Missing: the previous beat's set, else `diner`. An older bundle's `studio` (the retired grey stage) still validates and plays in the diner, on its stage mark |

### Events

| Field | Type | Notes |
|---|---|---|
| `singer` | string | who sings `lyric` in the premiere (canon name). Missing: `bot`. The making-of (LIVE) always has `bot` sing its own work |
| `with` | string[] | bots who sing the line together with the singer (harmony parts). The v1 form, consecutive events of one beat with the same lyric, still means the same |
| `action` | string | an id from `web/src/actions.js` (`ACTION_IDS`): a hand play (`fist-bump`, `conga-sway`…), a gesture (`wave`, `clap`…), a face act (`wink`, `gasp`…), a move (`march`, `huddle`, `walk-to-<mark\|Bot>`…) or a light cue (`lights-gold`, `spot-<Bot>`). v1 ids map through `LEGACY` |

### Lyric markup (`web/src/cues.js`)

The Soothing Bots story-line syntax, with names instead of robot indices:

```
[And] {Gold:gasp} counts every cent >> Twice!
```

- `{Name}` / `{Name:act}`: the named bot is sung and shown as its name, and reacts when the line
  starts (a hand cue `wave`/`clap`/`palm`/`loveyou`, else a face act; `{Name}` alone nods), and it
  and the singer glance at each other.
- `[Pickup]` at the start: words sung before the bar line, into the first downbeat.
- ` >> reply`: a short answer the episode's pal (the echo) sings right after the line.

Lyric rules apply to the line and the reply with the markup removed (`plainLyric`).

### Song form

Story songs follow Soothing Bots' 11 sections (StoryForm.cs): intro, verse1 (A1), verse1b (A2),
chorus1, verse2 (B1), verse2b (B2), chorus2, bridge, bridge2, chorus3, outro. A verse is a 4-line
stanza; a chorus sings `Hook X Hook Y` (chorus 3: `Hook X Hook Turn`, the hook turned by the
story's irony). The arranger (`web/src/sing-plan.js`) adds the backing parts (echo, harmony, bass,
pads) itself: producers write only the story's lines.

## The Muse Code director's bundles (additions, 2026-10-29)

All additive; every field below is optional for other producers. `scripts/director/emit.js` writes
them (`director/README.md`).

### beats.json

| Field | Type | Notes |
|---|---|---|
| `tags.outro` | string | `conclusive` (ends home) or `soft` (a night ending); the song form's outro progression. Missing: `conclusive` |
| `hook` | string | the chorus hook as planned: chorus lines 1 and 3, the outro's first line |
| `irony` | string | the one irony the story turns on, paid off by chorus 3's turned line and the outro |
| `director` | object | reserved for the director's notes (absent so far) |

### Events

- The stream is in beat order (the turnstile): every event of beat *k* comes before any of beat
  *k+1*, and `t` is the real making-of timeline (seconds since the director started).
- Only the lyrics agent (Green) writes `lyric`; every other role's event has `lyric: ""` and
  stages a cue: chords (White, `chords` set, first in a beat), a light cue (Blue), a move or a hand
  play (Gray, Gold, Yellow, Pink). In the making-of the role bot sings its `summary` instead.
- `singer` on an event without words: who performs its action in the premiere (a bot on stage in
  that beat). Missing: `bot`. `consult` on a non-consulting event: a duo action's partner.
- Line counts per section: intro 2; every verse, chorus and bridge 4; the outro 4 (the hook, the
  intro's first line again, two lines of the world changed). A line sings 2-7 syllables (names
  included, a `[pickup]` aside), a reply 1-5 (`web/src/gen/lyrics.js` `lineProblems`).

### director.json

The provenance of a director-made bundle: `muse` (version, provider, model, efforts),
`wallSeconds`, `makingOfSeconds`, `runs` (each `muse exec`: kind, exit, session id, subagents),
`usage` (director, crew and total tokens, from Muse's session logs), `cost` (an estimate from Muse's
model catalog), `perRole` (events, lines, tokens), `events`, `lines`, `consultations`, `turnstile`
(rejections, queued) and `gate` (ok, problems). The app does not need it; the making-of banner shows
the model and the time when it is there.

## Sung thoughts, answers, craft checks (additions, 2026-10-30)

All optional and additive; bundles before them stay valid.

### beats.json

| Field | Type | Notes |
|---|---|---|
| `facts` | string[] | the checked facts behind a premise about something real (the director's web research, or the fact sheet `director/briefs/<slug>.md`), one plain sentence each, at most 12; the crew writes from them |
| `summaries` | string | `"we"`: every event's `summary` is the team's sung thought ("We ask Green where the hook lands"): the crew as one, present tense, 2-10 sung syllables, never "I". The making-of sings it. `"first-person"`: the Oct 29-30 bundles, each bot's own "I" (the making-of sings them as "we"). Missing: the older third-person summaries ("White sets the key", sung "We set the key") |

### Events

| Field | Type | Notes |
|---|---|---|
| `answers` | int | the `seq` of the consultation (`status: consulting`, earlier in the stream) this event answers: the consulted bot's first event after it that names the asker back in `consult` (it may have been sent ahead). The emit tool sets it (an agent never does), at most one answer per question and bot; a beat's questions land first. The making-of sings the question and the answer as a duet |
| `bypassed` | object[] | `[{ check, reason, words? }]`: craft checks (`scripts/director/craft.js`: `dictionary`, `rhyme`, `meter`, `balance`, `filler`, `inversion`, `repeat`, `voice`, `singable`) this line or summary failed and its agent passed anyway, with its reason (at least 4 words); `words`: the words a dictionary bypass accepted for the rest of the episode. At most 3 per agent per episode, never on a hook line |

An agent asks for a bypass by sending `"bypass": {"<check>": "<reason>"}` with the event; the tool
validates it and records what it bypassed as `bypassed`. The hard rules (the
plain present, brands, nothing menacing, the syllable limits, the song form and its rhymes, the
structure) are never bypassed.

### director.json

`craft`: the run's craft mode (`strict`: a failed check rejects unless bypassed, the default;
`warn`: notes only; `off`), `bypasses` (each: seq, agent, check, reason), `accepted` (the words the
episode sings that the singer does not know, and why: a bypass, or the premise's own word in the
hook), and per check how often it `rejected`, was `bypassed` or left a note (`noted`).

## The production's activity log (addition, 2026-10-31)

Optional; bundles without it stay valid (the making-of then fills its waits with the crew's work song).

```
episodes/<id>/
  activity.ndjson # what the director and the crew really did while the production ran, one entry a line
```

Each entry: `{ t, who, kind, detail?, sing?, beat?, reason?, seqs?, n?, retry?, seconds? }`. `t`: seconds
since the production started (the events' clock), non-decreasing; `who`: `director` or a crew agent
(`lyrics`, `chords`, `dance`, `lighting`, `deals`, `hype`, `comedy`, `trouble`); `kind`: `search` | `fetch` |
`read` | `look` | `git` | `think` | `status` | `plan` | `write` | `queue` | `reject` | `retry` |
`launch` | `check` | `done`; `detail`: a short, sanitized note for the log (a query, a domain, a file's
base name, a commit subject; never a local path, a key, a token or an environment value); `sing`: the
detail in a few plain words the singer knows; `reason`: a rejection's kind
(`scripts/director/activity.js` `REASONS`); `seqs`: the events a `write` or `queue` sent (a queued
event was written at `t`, though it landed when its beat opened); `n`: a plan's beat count;
`seconds`: how long a `think` lasted. `scripts/director/direct.js` records it after a run from Muse's
session logs (the director's and each crew subagent's tool calls) and the emit tool's own log
(`.director/attempts.ndjson`); `scripts/validate-bundle.js` checks it. The making-of
(`web/src/activity-lines.js`) sings it as short crew lines where the production has no news (the
director's work by Gold, the producer), and sings each queued thought from when it was written.
`director.json` `activity`: its entry count, by `who` and by `kind`.

## Consultations as conversations (addition, 2026-10-31)

Optional and additive: bundles before it stay valid and play as before (their one-event questions and `answers`).
Every director run since Oct 31 writes its consultations this way (`web/src/consultation.js` is the protocol;
`scripts/director/emit.js` enforces it as the crew sends, `scripts/validate-bundle.js` and the gate check it).

### beats.json

| Field | Type | Notes |
|---|---|---|
| `consultations` | string | `"moves"`: the bundle's consultations are move threads (below). Missing: one-event questions (`status: consulting`) answered by one event (`answers`) |

### Events

A consultation is a conversation between two crew bots, the asker and the host (the bot it consults), one event
per sung line (at most 10 sung syllables), so the LIVE page and the loading bar show it unfolding as it is written:

| Field | Type | Notes |
|---|---|---|
| `move` | string | `ask`, `ok`, `context`, `question`, `ack`, `reasoning`, `answer`, `followup`, `followup-answer`, `agree`, `thanks` |
| `thread` | string | the consultation's id (`"c3"`), assigned by the emit tool when the `ask` is sent; every move of it carries it |
| `consult` | string[] | on a move: the other bot of the consultation (one crew bot) |

The order (`consultation.js` `nextMoves`): the asker's `ask` (it names the host), `context` x1-3 (real: the plan,
the facts, a crewmate's work), `question` x1-3 (each ends "?"); the host's `ok` once, any time after the ask; the
host's `ack`, `reasoning` x1-3 (the options and their trade-offs), `answer` x1-3 (the decision; the host's answer
event may carry the change itself: White's `chords`, Blue's light cue); optionally the asker's `followup` x1-3 and
the host's `followup-answer` x1-3; the asker's `agree` and `thanks`. The asker's moves have `status: consulting`,
the host's `working`. The stream keeps each thread's order (its moves are sent for the thread's last beat or a later
one, and land in the order sent). The first `answer` carries `answers` (the seq of the first `question`), so older
readers still pair them. A thread is complete with its `thanks`; the gate wants at least 8 complete ones an
episode, and every role opens at least 2.

The making-of (`web/src/making-of-score.js` `consult`) sings each consultation as a little song, in the canonical
order (`canonicalOrder`: the host's ok right after the ask), never before a line's own `t`: the opening and the
reply as one stretch when the reply has arrived (the permission a pickup couplet on `intro:scene`, the context a
verse on `verse:narrative`, the question and its acknowledgement a pre-chorus on `verse:build`, the host's reasoning
a verse on `bridge:<tag>`, the answer a chorus on `chorus:bright`), the follow-up a bridge on `bridge2:<tag>` when it
comes, the agreement and the thanks the outro tag on `outro:<tag>`, sealed by a hand play. Questions end open on V
(up to so), answers resolve V7 -> I (home to do). The asker goes over to the host for each stretch; the crew's
backing sings under it in the part's kind.

### director.json

`consult`: `{ threads, complete, followups, moves, applied, opened }` (`applied`: consultations whose answer shows in
the work: on the host's answer event or in the work that follows; `opened`: consultations opened by bot).

## Consultations taken at once, one at a time (addition, 2026-11-01)

No new fields; how the making-of sings the move threads, and two rules the emit tool adds for new runs (the owner,
Nov 1: "barrages of different questions that get answered waaaay after it was asked", "it's rude that the bots don't
acknowledge the question right after it's asked. If the bots need time to think, then they should say they'll get
back to them with it. Once they have the answer, they should remind the bot of their question").

The making-of (`web/src/making-of-score.js` `consult`) sings a consultation on from where it is, as far as it has been
written by the time each line comes (a recorded making-of knows when each was written; live, what has arrived):

- The host always takes the question right after it is asked, sung: its own `ack` when it is written by then (never
  only on the card), else a hold line of the making-of's own, naming the asker and the topic ("Let me think on the
  glow, Blue", "Pink, let me think. Back to you soon": `consultation.js` `holdLine`). While it holds a question the
  host thinks it over (a thinking pose now and then, a hummed "Hmm" in the backing: staged `kind: 'aside', think:
  true` events and a backing part of role `think`) and sings nothing else of the crew's songs.
- Taken up again after other talk (or a pause of 12 s), a stretch opens with a recall: the host's says the question
  back ("Blue, you asked: can I wink when they cheer?", "So, Gold, about the band": `recallLine`), the asker's coming
  back to close it names its topic ("So, Blue, about the big win": `resumeLine`). Its lines carry `about: { bot, text
  }` (the question), shown in the caption. The host's own ack after a hold line shows on the card with the recall; a
  host's `ok` written only with its reply, after the conversation went on, is let go (`dropped`).
- One at a time: a consultation taken up again goes first, then one whose answer is written by the time its question
  is sung (sung whole, ask to answer), then (no question on hold: `MAX_OPEN` 1) the oldest, put on hold.
- A stock ask the episode already had ("Hey Gold, got a sec?" again) is sung in other words (`ASK_POOL`).
- Side remarks stay off the banner while a consultation's stretch is on (moved after it, or let go when that is
  more than 45 s late); the caption of what follows a consultation waits for its seal to end.

The emit tool (`scripts/director/emit.js`): a role opens no consultation while a question of its own waits for its
answer (`linkMoves`); a host's call of other work is refused while a question put to it has no `ack` (`ackProblems`:
its ok and ack go first, "let me think" when it needs time, the rest in its next call); an ask the episode already had,
or a third stock one, is refused. Recorded bundles keep validating: these are send-time rules, not the gate's.

## The live making-of hears the run's queue and activity (addition, 2026-11-01)

No new bundle fields. A LIVE run (the dev server, `scripts/director/live.js`) also serves, as the run goes:

- `GET /api/direct/<slug>/queued.ndjson`: the events written and not landed yet (the turnstile holds an event sent for a
  later beat until that beat opens: emit.js `state.queue`), in the order sent, each with `n` (its emit call) and `t`
  (when it was written, s since the production started). No `seq` yet.
- `GET /api/direct/<slug>/activity.ndjson`: the activity log so far (`activity.js` `liveActivity`: the session logs noted
  in `.director/sessions.json` as Muse reports them, the gate's log), sanitized as the recorded one; the recorded log
  once the run wrote it.

The making-of (`web/src/live-feed.js` `LiveFeed`) feeds the live score what is new on each poll: an event heard ahead
(a provisional seq between the landed ones, in the order sent; Green's lines and a beat's first plain event with no line
of Green's known wait to land, as `writtenTimes` has it for a recorded run), its landing (the same event in the stream,
matched by its content: the loading bar's beat arrives then), and the activity lines. So a live run sings the real work
from when it is written, by the replay's rules; a recorded run replayed through the same feed (`snapshotAt`,
`web/test-live-feed.mjs`) sings the replay's lines. Live only (it cannot know a reply comes while the question is
sung): a question whose reply is not there waits while another is on hold (`waitsOnHold`), so at most `MAX_OPEN` are.

## The plot's trouble (addition, 2026-11-01)

Optional and additive: bundles before it stay valid and play as before. Black (the kid next door) joined the crew as
its eighth role, `trouble` (`scripts/director/emit.js`, `director/prompts/trouble.md`; `web/src/plot-trouble.js` is
the shared rule set): he pitches the problems that make the story interesting, and the problems the crew accepts
change the lyrics.

### beats.json

| Field | Type | Notes |
|---|---|---|
| `crew` | string[] | the roles of the run (`lyrics` ... `comedy`, `trouble`). Missing: the seven before Nov 1 (`LEGACY_CREW` in `web/src/gen/cast.js`) |

### Events

| Field | Type | Notes |
|---|---|---|
| `problem` | string | on Black's `question` move (a consultation with Green or Gold): the problem he pitches, one plain sentence (3-20 words, the text rules); at most two a consultation |
| `verdict` | string | on the host's `answer` of the same rank (the first answer for the first problem, the second for the second): `accept` (the story takes it) or `decline` |
| `trouble` | string | on Green's sung line in a verse (verse1, verse1b, verse2, verse2b) that brings an accepted problem into the story: its id (`"c4"`, a consultation's second `"c4.2"`), once a problem, at its pitch's beat or later |
| `resolves` | string | on a later sung line that solves it (a verse, a bridge, chorus 3's turned line, the outro's lines 3-4): the same id, in a later beat than the line that sang it |

`bypassed` may also name `trouble` (Black's reason the episode takes fewer problems). The gate (beats.json `crew` with
`trouble`, move threads) wants at least two accepted problems sung and solved, one sung in act 1 (intro to chorus 1)
and one in act 2 (verse 2 to chorus 2), unless a `trouble` bypass is recorded; every problem sung is solved whatever
the bypass (validate-bundle.js checks the shape and the solving). `director.json` `trouble`: `{ pitched, accepted,
declined, sung, resolved, acts, bypassed }`. The activity log's `who` may be `trouble`.
