# Musical Bots

Type a cartoon episode prompt; a choir of 16 bots performs it as a sung 3D
episode in your browser (Three.js) — a "making-of" musical where each
bot plays a production role (lyrics, chords, dance, lighting, deals, hype,
comedy) and the band plays along, all driven by a JSON event protocol.

Built for the Meta Global AI Hackathon 2026 (Indie developer track). Every
voice is synthesized in the browser from the lyrics: real sung words, solos
and choruses in harmony, no recordings, no TTS, no server.

## Watch / Try it

- **Try it live:** https://musical-bots.vercel.app — type a prompt and
  press **Make it** (the crew's making-of, then the premiere) or **Premiere**
  (straight to the episode). Turn the sound on; it works on phones too (on an
  iPhone, also flip off the ring / silent switch if you hear nothing).
- **Demo video:** https://youtu.be/IdHf7XYFG9Q (2:57 full cut; [self-hosted mirror](https://github.com/clrke/musical-bots/releases/download/demo-v29/musical-bots-why-we-win-v29.mp4); [2-min backup](https://youtu.be/wkG207to_mw))
- Try a curated prompt such as "Blue brings home the biggest toy box on the
  street" (the 15 are in `web/src/curated.js`): it replays at once. **Make it**
  on any other prompt runs the real Muse Code director live (about 10–12
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
nvm use                 # Node 22
npm ci --prefix web     # install the web app's dependencies (three, vite)
npm run dev             # Vite dev server (same as: npm --prefix web run dev)
npm test                # every headless suite, web/test-*.mjs (tests/run.mjs)
npm run validate        # the sample bundle against the event protocol
npm run build           # production build into web/dist/ (serve it statically)
```

`npm test -- voice sing` runs only the suites whose names match;
`npm test -- --skip swarm` leaves some out. Vercel builds and serves the live
site (`vercel.json`; deploy with `vercel deploy --prod`, see `docs/HOSTING.md`).

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

## How it works

- One event protocol (`director/protocol.md`), two producers, one player.
  Events stream as NDJSON bundles (`episodes/<id>/beats.json` +
  `events.ndjson`): LIVE generation (the "making-of") and deterministic
  REPLAY of a captured bundle (premieres, judge runs).
- An AI crew writes each episode: **Muse Code** (Meta's agentic coding CLI,
  headless, on Meta's Muse Spark) directs. It plans the story (11 beats in the
  Soothing Bots story-song form, one irony paid off in the last chorus), then
  launches a Muse Workflow of seven role subagents, each its own agent
  definition and embodied by a bot: Green writes the lyrics, White the chords,
  Gray the dance, Blue the lights, Gold the deals, Yellow the hype, Pink the
  comedy. They work at once through one tool (`scripts/director/emit.js`) that
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
  the diner, the big house and the night street. Each beat names its set
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
  (the lyric rules and line limits, the song form and its rhymes, ≥2 consultations, all seven
  roles, `npm run validate`) and carries its provenance in `director.json`.
- Episode video (frame-exact 1920x1080 @30fps with audio):
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
npm test                    # every headless suite (Node 22), about 2 min
npm run validate            # sample bundle against the protocol
npm run direct -- --all     # the Muse Code director writes the 15 curated episodes (about an hour)
npm run curate              # the offline generator's versions of the 15 (writes episodes/: they replace the director's)
npm run enrich              # optional OpenAI-compatible lyric pass (needs ENRICH_API_KEY and ENRICH_BASE_URL, the host)
```

License: MIT
