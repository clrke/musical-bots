# Musical Bots

A multi-agent workflow you can watch and hear. From a one-line prompt, a Muse
Code director plans an episode and launches eight autonomous role agents
(lyrics, chords, dance, lighting, deals, hype, comedy and the plot's trouble).
They work in parallel, consult each other in real conversations (ask, reason,
answer, agree), are checked by a validation gate and repaired when they stall,
and sing their reasoning as they work. The result is an original sung 3D
episode that a choir of 16 bots performs in your browser (Three.js), all driven
by a JSON event protocol.

Built with Meta's models through the Meta Model API: Muse Code directs the
crew, Muse Spark 1.3 is the model every agent thinks with (and, with vision,
checks each poster's spelling), and Muse Image (`muse-image-1.0`) draws each
episode's poster. [Details below.](#meta-ai-stack-meta-model-api-muse-code-muse-spark-muse-image)

Built for the [Meta Global AI Hackathon 2026](https://dev.meta.ai/events/global-hackathon) (Indie developer track). Every
voice is synthesized in the browser from the lyrics: real sung words, solos
and choruses in harmony, no recordings, no TTS, no server.

## Watch / Try it

- **Try it live:** https://musical-bots.vercel.app — type a prompt and
  press **Make it** (the crew's making-of, then the premiere) or **Premiere**
  (straight to the episode). Turn the sound on; it works on phones too (on an
  iPhone, also flip off the ring / silent switch if you hear nothing).
- **Demo video:** https://youtu.be/nn9xmv4NpYA (2:57 full cut; [self-hosted mirror](https://github.com/clrke/musical-bots/releases/download/demo-v30/musical-bots-why-we-win-v30.mp4); [2-min backup](https://youtu.be/tVJ0yzE8fgw))
- Try a curated prompt such as "Blue brings home the biggest toy box on the
  street" (click the prompt bar for all 15, or see `web/src/curated.js`): it
  replays at once, no key needed. **Stop** (or Esc) ends a run. **Make it**
  on any other prompt runs the real Muse Code director live (about 10–20
  minutes, sung as it writes) in its own Vercel Sandbox: paste your own Meta
  Model API key (it stays in your browser and goes only into that run's
  sandbox), or sign in with your email and request credits from the owner.
  Each run ends with a link to share (`/?run=<id>`). **Premiere** on a new
  prompt plays the offline generator's version at once. How it's hosted, the
  security model and the settings: `docs/HOSTING.md`.

## Setup

Node 22 (`.nvmrc`). The app is static (no keys); the hosted site adds one API
function for live director runs (`api/`, `server/`; `docs/HOSTING.md`).

```
nvm install             # Node 22 (.nvmrc)
npm ci --prefix web     # install the web app's dependencies (three, vite)
npm test                # every headless suite, web/test-*.mjs (tests/run.mjs)
npm run validate        # the sample bundle against the event protocol
npm run build           # production build into web/dist/ (serve it statically)
npm run dev             # Vite dev server on http://localhost:5173 (Ctrl-C to stop)
```

`npm test -- voice sing` runs only the suites whose names match;
`npm test -- --skip swarm` leaves some out. The root `package.json`
dependencies are only for the hosted API (`server/`), so a local setup needs no
root `npm ci`. Vercel builds and serves the live site (`vercel.json`; deploy
with `vercel deploy --prod`, see `docs/HOSTING.md`).

Or run the static build in Docker (the curated episodes replay, no keys; live
director runs need the Vercel deployment):

```
docker build -t musical-bots .
docker run --rm -p 8080:80 musical-bots    # then open http://localhost:8080
```

URL drivers:
`/?prompt=<text>` premieres a generated episode, `&t=<seconds>` seeks,
`&set=<diner|big_house|street|village|winter|haunted|beach|pool|pier|ocean>` plays every beat of the episode in
that set (overrides `beats.json` `beats[].set`; `&env=` is the older alias,
and `scripts/render/capture.mjs --env <set>` passes it), `&cinema` hides the
UI.

## The Muse Code director

The curated episodes are written by an AI crew directed by **Muse Code**
(Meta's agentic coding CLI) on Meta's Muse Spark. It needs Muse Code
installed and logged in (`muse` on the PATH, `--muse <bin>` or `$MUSE_BIN`):

```
npm run direct -- "Gold sells hot soup on a cold day" --out /tmp/x/hot-soup   # one episode
npm run direct -- --all                          # re-direct the 15 curated episodes into episodes/
npm run direct -- --all --only toy-box,garden    # some of them
npm run dev                                      # Make it with a new prompt: the crew writes it live
```

A run replaces its bundle only when the director's gate passes; each bundle's
`director.json` records the model, tokens, cost and time. Options (efforts,
`--no-web`, `--no-repo`, `--brief <file>`, `--craft`, `--dry-run`) are in
`director/README.md`.

## Meta AI stack: Meta Model API, Muse Code, Muse Spark, Muse Image

Every episode is written by Meta models through the Meta Model API, and its
poster is drawn by one; no other model writes or draws any of it (the singing is our own in-browser formant
synthesizer, `web/src/mv/`).

| Layer | What it does here | Where |
| --- | --- | --- |
| **Meta Model API** | Muse Code authenticates with a Meta Model API key, `META_API_KEY`. Hosted **Make it** runs install Muse Code from `https://api.meta.ai/muse-launcher.sh` into a per-run Vercel Sandbox and pass the key only into that run's environment: the visitor's own key (BYOK), or the owner's for approved credit runs. | [`server/runner.js`](server/runner.js), [`scripts/director/sandbox-run.js`](scripts/director/sandbox-run.js), [`docs/HOSTING.md`](docs/HOSTING.md) |
| **Muse Code** | Meta's agentic coding CLI is the director: `muse exec --json` plans the 11-beat story, then runs a Muse Workflow of role subagents (lyrics, chords, dance, lights, deals, hype, comedy, the plot's trouble), each its own agent definition, all writing through one validating tool. | [`scripts/director/direct.js`](scripts/director/direct.js), [`scripts/director/workflow.js`](scripts/director/workflow.js), [`scripts/director/emit.js`](scripts/director/emit.js), [`director/`](director/README.md) |
| **Muse Spark 1.3** | The model every crew member thinks with: `muse-spark-1.3-contributor` by default (the contributor tier), `--model muse-spark-1.3` for the standard tier. Each bundle's `director.json` records the model, tokens, cost and time of its run. | [`episodes/*/director.json`](episodes/), [`director/README.md`](director/README.md) |
| **Muse Image** (`muse-image-1.0`) | Draws each episode's poster: `POST /v1/images/edits` with a prompt built from the episode's plan (title, story, opening scene, cast by colour) and a frame of our own 3D bots as the style reference, so the poster looks like the show. **Muse Spark 1.3 then reads the drawing back with vision** (a chat call with the poster as an image): a misspelled or garbled title is drawn once more, and a poster with stray text was caught and redrawn this way. The app shows it as the premiere's title card and the link preview. A hosted run draws its own in its sandbox, on the run's key, while the crew works ($0.01, ~30 s); the 15 curated episodes' posters are checked in. | [`scripts/director/poster.js`](scripts/director/poster.js), [`episodes/*/poster.webp`](episodes/), [`server/app.js`](server/app.js) |
| **Muse Spark Open** (optional) | Default model of the optional `npm run enrich` lyric pass, for any OpenAI-compatible host of Meta's open-weight models; the curated episodes ship without it. | [`scripts/enrich.js`](scripts/enrich.js) |

The director's gate (`scripts/director/emit.js`, `scripts/director/craft.js`)
validates every event against the protocol before a bundle is kept, and
`npm test` runs the whole pipeline against a stub Muse
(`scripts/director/stub-muse.js`), so CI needs no key.

## How it works

- One event protocol (`director/protocol.md`), two producers, one player.
  Events stream as NDJSON bundles (`episodes/<id>/beats.json` +
  `events.ndjson`): LIVE generation (the "making-of") and deterministic
  REPLAY of a captured bundle (premieres, judge runs).
- An AI crew writes each episode: **Muse Code** (Meta's agentic coding CLI,
  headless, on Meta's Muse Spark) directs. It plans the story (11 beats in the
  Soothing Bots story-song form, one irony paid off in the last chorus), then
  launches a Muse Workflow of eight role subagents, each its own agent
  definition and embodied by a bot: Green writes the lyrics, White the chords,
  Gray the dance, Blue the lights, Gold the deals, Yellow the hype, Pink the
  comedy, and Black the plot's trouble (gentle problems pitched to Green or
  Gold as consultations). They work at once through one tool (`scripts/director/emit.js`) that
  validates every event, keeps the stream in song order and shows each agent
  the beat in progress and who is consulting it. `npm run direct -- "<prompt>"`
  (one episode), `npm run direct -- --all` (the 15 curated ones); see
  `director/README.md`. Every bundle's `director.json` records the model,
  tokens, cost and time.
- The making-of is real: each event's `t` is when the crew wrote it. In
  `npm run dev`, Make it sends a new prompt to the director and the role bots
  perform the crew's work as it lands, as a musical number
  (`web/src/making-of-score.js`): each sings its thinking (its summary, in the
  team's "we") on the bar grid, a cappella over the crew's sung backing (no
  instruments, no percussion), Green sings the lines he proposes
  on their tune, a consultation is a duet (question, answer, a hand play to
  seal it); once the episode is ready a Play button skips the rest of the
  making-of; then the premiere plays the finished bundle, sung by the story's
  cast. The static build has zero keys: curated prompts premiere their
  checked-in bundles (Make it replays their recorded making-of). On the hosted
  site Make it directs any other prompt live in a Vercel Sandbox, with the
  visitor's own Meta key or approved credits (`docs/HOSTING.md`); elsewhere it
  is written on the spot by a seeded offline generator in the same shape.
- Optional lyric polish: `npm run enrich` is an optional OpenAI-compatible
  lyric pass (`ENRICH_BASE_URL`, `ENRICH_API_KEY`, `ENRICH_MODEL`; Meta's
  open-weights Muse Spark Open by default): it sends a bundle's lines to the
  model and keeps a rewrite only if it passes the lyric rules. The curated
  episodes ship without it.
- Cast: 16 procedural robot heads + floating hands that really sing: every
  lyric is rendered by the Magna Vocalization formant singing engine
  (`web/src/mv/`, same author; plus the Soothing Bots app's basso, robo,
  crooner, tenor and soprano voices) as a Soothing Bots story song: eleven
  sections of eight bars in 6/4 at 132-136 bpm (felt in two; the episode's seed picks the tempo;
  the making-of's groove at 144), child tunes, the pal's replies in the gaps,
  harmonies and an a-cappella backing ("Bom" bass, "ooh" pads, "doo" groove,
  "la la" on top), with mouths and lyric highlights following the sung
  syllables. The bots act it: 20 Soothing Bots hand plays with their
  choreography (handshake, high-five, fist bump, hold-hands swing, conga,
  hand stack...; `web/src/plays/`), face acts on lyric cues (`{Gold:gasp}`),
  consultations and the choir's social life (`web/src/acting.js`).
- Sets: Blender-headless `.blend` → `.glb` pipeline (`scripts/blender/`):
  ten sets (diner, big house, night street, village, winter, haunted, beach,
  pool, pier, ocean). Each beat names its set
  (`beats[].set`); the bots move through it as heads and hands: named marks
  per set, the beat's cast on stage and the rest parked, entrances through
  the doors, parades, huddles, follow spots on whoever sings and lighting
  moods (`web/src/blocking.js`, `web/src/scene/environments/`). Every voice
  has its karaoke card (the harmonies, the pal's answers, the backing's "Bom"
  and "ooh"), kept clear of each other, and the camera stays on the story's
  core cast and its singers (`web/src/staging.js`, `web/src/framing.js`).

## Content & docs

- Fifteen curated episodes in `episodes/`, written by the Muse Code director and its crew
  (`npm run direct -- --all`, the seeds in `web/src/curated.js`); each passed the director's gate
  (the lyric rules and line limits, the song form and its rhymes, at least 8 complete
  consultations (the 15 have 11–16 each), all eight roles, `npm run validate`) and carries its
  provenance in `director.json`.
- Episode video (frame-exact 1920x1080 @30fps with audio; macOS with Google Chrome in
  `/Applications` and ffmpeg on the PATH, run from the repo root):
  `scripts/render/render-episode.sh "<prompt>" out.mp4 [set]`. Headless GPU
  Chrome steps a virtual clock one frame at a time, the Web Audio graph is
  rendered offline, and ffmpeg muxes both (about 4 min for a 90 s episode).
- Trailer cut (~3 min of whole song sections, in the Soothing Bots hype-video style: title, captions,
  end card, -14 LUFS): `RUN_DIR=<dir> scripts/render/render-episode.sh ...`
  then `python3 scripts/render/trailer.py <dir> trailer.mp4` (needs Pillow + numpy).
- `docs/SUBMISSION.md` – hackathon submission text, use of Meta models and the
  pre-submit checklist (the single place for what is left to do).
- `eval/README.md` – the evals: sung-lyric intelligibility (Whisper) per
  release, and the staging checks (sight lines, collisions, z-fighting).
- Sets: `scripts/blender/*.py` run in headless Blender and import
  `bpy_helpers.py` from Muse Code's bundled blender skill; set
  `MUSE_BLENDER_SCRIPTS` to its directory if Muse Code is not installed in
  the default place under your home directory.

## Layout

- `web/` – Vite + Three.js client (player, generator, headless `test-*.mjs`)
- `director/` – event protocol and author-time subagent prompt pack
- `environments/`, `episodes/` – Blender sets and curated bundles
- `scripts/` – bundle validator, generator, curator, capture
- `api/`, `server/` – the hosted director (one Vercel Function; `docs/HOSTING.md`)
- `tests/run.mjs` – runs every `web/test-*.mjs` (`npm test`)
- `eval/` – evaluation methods and results

## Tests and author-time tools

```
npm test                    # every headless suite (Node 22): 34 suites, about 5–6 min (longer on CI)
npm run validate            # sample bundle against the protocol
npm run direct -- --all     # the Muse Code director writes the 15 curated episodes (about an hour)
npm run curate              # the offline generator's versions of the 15 (writes episodes/: they replace the director's)
npm run enrich              # optional OpenAI-compatible lyric pass (needs ENRICH_API_KEY and ENRICH_BASE_URL, the host)
```

License: [MIT](LICENSE). Asset provenance: [credits/ASSETS.md](credits/ASSETS.md).
