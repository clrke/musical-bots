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
| `bot`     | string   | yes      | embodying bot, canon name (`Vera`, …)          |
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

`summary` and `lyric` obey the lyric rules: no `we`/`us`/`our`/`all`
(whole words), no future tense (`will`, `going to`), no brands, nothing
menacing. `scripts/validate-bundle.js` enforces the mechanical part; a
human checks brands and menace.

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
| `beats[].set` | string | where the beat plays: `studio`, `diner`, `big_house`, `street` (blocking.js marks). Missing: the previous beat's set, else `studio` |

### Events

| Field | Type | Notes |
|---|---|---|
| `singer` | string | who sings `lyric` in the premiere (canon name). Missing: `bot`. The making-of (LIVE) always has `bot` sing its own work |
| `with` | string[] | bots who sing the line together with the singer (harmony parts). The v1 form, consecutive events of one beat with the same lyric, still means the same |
| `action` | string | an id from `web/src/actions.js` (`ACTION_IDS`): a hand play (`fist-bump`, `conga-sway`…), a gesture (`wave`, `clap`…), a face act (`wink`, `gasp`…), a move (`march`, `huddle`, `walk-to-<mark\|Bot>`…) or a light cue (`lights-gold`, `spot-<Bot>`). v1 ids map through `LEGACY` |

### Lyric markup (`web/src/cues.js`)

The Soothing Bots story-line syntax, with names instead of robot indices:

```
[And] {Lou:gasp} counts every cent >> Twice!
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
- Only the lyrics agent (Teddy) writes `lyric`; every other role's event has `lyric: ""` and
  stages a cue: chords (Nora, `chords` set, first in a beat), a light cue (Gigi), a move or a hand
  play (Vera, Lou, Frankie, Pearl). In the making-of the role bot sings its `summary` instead.
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
| `summaries` | string | `"first-person"`: every event's `summary` is the bot's own sung thought ("I ask Teddy where the hook lands"): first person, present tense, 2-10 sung syllables. The making-of sings it. Missing: the older third-person summaries ("Nora sets the key") |

### Events

| Field | Type | Notes |
|---|---|---|
| `answers` | int | the `seq` of the consultation (`status: consulting`, earlier in the stream) this event answers: the consulted bot's first event after it that names the asker back in `consult` (it may have been sent ahead). The emit tool sets it (an agent never does), at most one answer per question and bot; a beat's questions land first. The making-of sings the question and the answer as a duet |
| `bypassed` | object[] | `[{ check, reason, words? }]`: craft checks (`scripts/director/craft.js`: `dictionary`, `rhyme`, `meter`, `balance`, `filler`, `inversion`, `repeat`) this line or summary failed and its agent passed anyway, with its reason (at least 4 words); `words`: the words a dictionary bypass accepted for the rest of the episode. At most 3 per agent per episode, never on a hook line |

An agent asks for a bypass by sending `"bypass": {"<check>": "<reason>"}` with the event; the tool
validates it and records what it bypassed as `bypassed`. The hard rules (`we`/`us`/`our`/`all`, the
plain present, brands, nothing menacing, the syllable limits, the song form and its rhymes, the
structure) are never bypassed.

### director.json

`craft`: the run's craft mode (`strict`: a failed check rejects unless bypassed, the default;
`warn`: notes only; `off`), `bypasses` (each: seq, agent, check, reason), `accepted` (the words the
episode sings that the singer does not know, and why: a bypass, or the premise's own word in the
hook), and per check how often it `rejected`, was `bypassed` or left a note (`noted`).
