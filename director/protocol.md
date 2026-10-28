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
