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
