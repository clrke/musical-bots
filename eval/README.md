# Evals

Two kinds of measurement keep Musical Bots honest: **can a listener catch the sung words**
(intelligibility, scored with a speech recognizer), and **can a viewer see who sings** (staging
checks, run headless on every curated episode). The staging checks are part of `npm test`; the
intelligibility evals need a GPU-capable machine with Whisper and are run by hand on each release
of the demo video.

## 1. Sung-lyric intelligibility (Whisper large-v3)

The synthesized singers are a formant engine, not recordings, so the question is whether the sung
words come through. We use an automatic speech recognizer as a stand-in listener: Whisper
large-v3 (`mlx-community/whisper-large-v3-mlx` through `mlx_whisper`), English, temperature 0, no
context carried from the previous line. A word counts as recalled when the transcript contains it
(each heard word matches one target word at most; numbers are spelled out). Whisper is a strict
listener for singing, so the numbers are a floor and best read as trends between releases.

### Methods

- **Per-line (in the repo).** Every story line of the premiere, set by the arranger exactly as the
  app sings it, rendered alone by the voice engine, then transcribed one line per clip:

  ```
  node scripts/render/sung-lines.mjs /tmp/lines.wav hackathon-win   # one wav + lines.meta.json (default: every curated episode)
  python3 scripts/render/sung_recall.py /tmp/lines.wav              # needs Python 3.11 with mlx_whisper + numpy (Apple silicon)
  ```

  It writes `lines.rec.json` (per line: target words, which were heard, what Whisper heard) and
  prints the recall overall, for the crew's names and for the other words, plus the worst lines.
  `VOICE=woman` re-renders every line in one voice; `VARIANTS=<json>` A/B-tests a rewrite of a line.
  This method fitted the director's "singable" craft check (`scripts/director/craft.js`).
- **Full mix (the earlier method, used for v19-v22).** The episode's real audio, rendered offline
  by the frame-exact capture (`node scripts/render/capture.mjs ... --audio-only`, or the audio of a
  full capture), transcribed whole, with each sung word looked for in a window around the time it
  is sung. *Premiere lead*: the story's lead lines in the full mix (harmony and backing under them).
  *Making-of*: the making-of's audio, scored per sung segment and by segment kind (questions,
  answers, the lines Green proposes, activity, the refrain). The scoring scripts for this method were ad-hoc QA
  scripts and are not checked in; the per-line method above replaces it.

### Results by release of the demo video

| Release | Making-of, all words | Premiere lead | Notes |
|---|---:|---:|---|
| v19 (Oct 31) | 53.3% | 70.5% | structured consultations, new sets, 6/4 |
| v20 (Nov 1) | 64.0% | 74.8% | a cappella making-of |
| v21 (Nov 1) | 60.8% | 66.0% | all episodes re-directed with Black's plot trouble: new, untuned lyrics |
| v22 (Nov 1) | **65.9%** | **78.6%** | hackathon episode re-directed under the "we" and singable craft checks |

Making-of by segment kind (full-mix method):

| Release | Questions | Answers | Proposed lines | Activity | Refrain |
|---|---:|---:|---:|---:|---:|
| v19 | 55.6% | 64.5% | – | 41.7% | – |
| v20 | 67.3% | 66.2% | 65.4% | 45.8% | 68.4% |
| v21 | 63.7% | 66.0% | 37.8% | 47.4% | 15.8% |
| v22 | 71.1% | 69.2% | 66.0% | 32.0% | 29.0% |

Per-line method on the hackathon episode (`hackathon-win`), both bundles rendered with the same
`sung-lines.mjs`:

| Bundle | Words recalled |
|---|---:|
| v21 | 52.4% (108 / 206) |
| v22 | **63.6%** (143 / 225) |

Other data points: the beach-ball episode's premiere lead scored 70.6% (v20) and 61.3% (v21). An
early per-line check (Oct 29) on three episodes found the full mix within a point of the lead alone
(50.4% vs 51.2%), so the backing stays under the words; on the same notes, the web singer scored
60% against 56% for the author's shipped Quest app on the same engine.

What the evals found and fed back: crew names and short hooks are the hardest words ("White" is
heard as "why", "Our hackathon show!" as "Our Pegasonshow"); a cold open on a brand or a title is
lost. The director's craft checks now ask for lines a listener can catch (the "singable" check,
weighted from these results) and the episodes were re-directed under them (v22).

## 2. Staging checks (in `npm test`)

Each plays every curated episode headless, staged the way the app stages it (blocking, acting,
hand plays, the bots' own motion) at a fixed time step, so the results are deterministic.

| Check | What it measures | Pass rule | Suite |
|---|---|---|---|
| Sight lines (`web/sightlines.mjs`) | Share of singing time a singer's face is hidden by a nearer head, from the singer's close-up and from the set's main wide | front ≤ 4%, wide ≤ 6% of the singing, no hidden spell longer than 3 s | `web/test-sightlines.mjs` |
| Collisions (`web/collisions.mjs`) | Head volumes passing through each other that nobody directed (hand plays, consultations and directed touches are intended contact) | no unintended overlap in any curated episode; the same run twice is identical | `web/test-swarm.mjs` |
| Z-fighting (`web/overlaps.mjs`) | Coplanar overlapping faces (flicker) in every Blender set (`environments/*.glb`) | none | `web/test-overlaps.mjs` |

Current results (v22 bundles): faces hidden from the front / main wide, as a share of each
episode's singing time:

| Episode | Front | Wide |
|---|---:|---:|
| toy-box | 1.7% | 4.0% |
| dino-book | 1.0% | 1.1% |
| streetlamp | 1.6% | 2.8% |
| rooftop-stars | 1.8% | 3.5% |
| hot-soup | 2.0% | 3.4% |
| parade | 1.4% | 4.8% |
| birthday-cake | 2.1% | 4.3% |
| block-race | 1.5% | 4.0% |
| garden | 1.1% | 1.5% |
| red-truck | 0.8% | 2.9% |
| yellow-fence | 0.7% | 1.7% |
| lost-puppy | 1.4% | 2.5% |
| hackathon-win | 1.8% | 3.3% |
| beach-ball | 1.2% | 2.8% |

Collisions: 14 of 14 curated episodes with no unintended head overlap. Z-fighting: none in the 11
sets (from 16 triangles in the smoke room to 10,230 in the village).

Run one by hand for the details (the worst spells, who hides whom, every move and its arrival):

```
node web/sightlines.mjs hackathon-win
node web/collisions.mjs hackathon-win --json /tmp/hack.json
node web/overlaps.mjs diner
npm test -- sightlines swarm overlaps
```
