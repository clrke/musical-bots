# Musical Bots

Type a cartoon episode prompt; a choir of 16 bots performs it as a sung 3D
episode in your browser (Three.js, no VR) — a "making-of" musical where each
bot plays a production role (lyrics, chords, dance, lighting, deals, hype,
comedy) and the band plays along, all driven by a JSON event protocol.

Built for the Meta Global AI Hackathon. Every voice is synthesized in the
browser from the lyrics: real sung words, solos and choruses in harmony, no
recordings, no TTS, no server.

- Live: https://clrke.github.io/musical-bots/ (once the repo is public)
- Demo video: 2:54 trailer cut from the app's own frame-exact capture (link
  in `docs/SUBMISSION.md`)

## Run it

```
nvm use          # Node 22 (see .nvmrc)
cd web && npm install && npm run dev
```

Open the dev server, type a prompt, and hit Premiere. URL drivers:
`/?prompt=<text>` premieres a generated episode, `&t=<seconds>` seeks,
`&set=<diner|big_house|street|village|winter|haunted|beach|pool|pier|ocean>` plays every beat of the episode in
that set (overrides `beats.json` `beats[].set`; `&env=` is the older alias,
and `scripts/render/capture.mjs --env <set>` passes it), `&cinema` hides the
UI. Production build: `npm run build` in `web/`, then serve `web/dist/`
statically.

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
  (one episode), `npm run direct -- --all` (the 14 curated ones); see
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
  checked-in bundles (Make it replays their recorded making-of), any other prompt
  is written on the spot by a seeded offline generator in the same shape.
- Optional lyric polish: `npm run enrich` sends a bundle's lines to Meta's
  open-weights Muse Spark Open (serverless on Fireworks, or any
  OpenAI-compatible host), every candidate gated by the lyric rules.
- Cast: 16 procedural robot heads + floating hands that really sing: every
  lyric is rendered by the Magna Vocalization formant singing engine
  (`web/src/mv/`, same author; plus the Soothing Bots VR app's basso, robo,
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

- Thirteen curated episodes in `episodes/`, written by the Muse Code director and its crew
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
- `docs/SUBMISSION.md` – hackathon submission text, sponsor use and the
  pre-submit checklist (the single place for what is left to do).

## Layout

- `web/` – Vite + Three.js client (player, generator, headless `test-*.mjs`)
- `director/` – event protocol and author-time subagent prompt pack
- `environments/`, `episodes/` – Blender sets and curated bundles
- `scripts/` – bundle validator, generator, curator, capture

## Tests

```
npm run validate            # sample bundle against the protocol
npm run direct -- --all     # the Muse Code director writes the 14 curated episodes (about an hour)
npm run curate              # the offline generator's versions of the 14 (writes episodes/: they replace the director's)
npm run enrich              # Fireworks lyric pass (needs FIREWORKS_API_KEY)
node web/test-*.mjs         # headless suites (Node 22), incl. test-voice
```

License: MIT
