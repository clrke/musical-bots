# Musical Bots

Type a cartoon episode prompt; a choir of 16 bots performs it as a sung 3D
episode in your browser (Three.js, no VR) — a "making-of" musical where each
bot plays a production role (lyrics, chords, dance, lighting, deals, hype,
comedy) and the band plays along, all driven by a JSON event protocol.

Built for the Meta Global AI Hackathon. Every voice is synthesized in the
browser from the lyrics: real sung words, solos and choruses in harmony, no
recordings, no TTS, no server.

- Live: https://clrke.github.io/musical-bots/ (once the repo is public)
- Demo video: 67 s trailer cut from the app's own frame-exact capture (link
  in `docs/SUBMISSION.md`)

## Run it

```
nvm use          # Node 22 (see .nvmrc)
cd web && npm install && npm run dev
```

Open the dev server, type a prompt, and hit Premiere. URL drivers:
`/?prompt=<text>` premieres a generated episode, `&t=<seconds>` seeks,
`&set=<studio|diner|big_house|street>` plays every beat of the episode in
that set (overrides `beats.json` `beats[].set`; `&env=` is the older alias,
and `scripts/render/capture.mjs --env <set>` passes it), `&cinema` hides the
UI. Production build: `npm run build` in `web/`, then serve `web/dist/`
statically.

## How it works

- One event protocol (`director/protocol.md`), two producers, one player.
  Events stream as NDJSON bundles (`episodes/<id>/beats.json` +
  `events.ndjson`): LIVE generation (the "making-of") and deterministic
  REPLAY of a captured bundle (premieres, judge runs).
- Producers: (1) a seeded runtime generator (works offline, zero API keys)
  mirroring the 7 subagent responsibilities; (2) author-time direction via
  a Meta open-weights model (`npm run enrich`, Llama on Fireworks or any
  OpenAI-compatible host, every line gated by the lyric rules) and
  the prompt pack in `director/prompts/`.
- Cast: 16 procedural robot heads + floating hands that really sing: every
  lyric is rendered by the Magna Vocalization formant singing engine
  (`web/src/mv/`, same author; plus the Soothing Bots VR app's basso, robo,
  crooner, tenor and soprano voices) as a Soothing Bots story song: eleven
  sections of eight bars at 88-100 bpm (the episode's seed picks the tempo;
  the making-of runs at 96), child tunes, the pal's replies in the gaps,
  harmonies and an a-cappella backing ("Bom" bass, "ooh" pads, "doo" groove,
  "la la" on top), with mouths and lyric highlights following the sung
  syllables, and group staging (walk, handshake, high-five, huddle, celebration).
- Sets: Blender-headless `.blend` → `.glb` pipeline (`scripts/blender/`):
  the diner, the big house and the night street. Each beat names its set
  (`beats[].set`); the bots move through it as heads and hands: named marks
  per set, the beat's cast on stage and the rest parked, entrances through
  the doors, parades, huddles, a follow spot and lighting moods
  (`web/src/blocking.js`, `web/src/scene/environments/`).

## Content & docs

- Twelve curated episode bundles in `episodes/` (see `scripts/curate.js`;
  each gated on lyric rules, ≥2 consultations, and `npm run validate`).
- Episode video (frame-exact 1920x1080 @30fps with audio):
  `scripts/render/render-episode.sh "<prompt>" out.mp4 [set]`. Headless GPU
  Chrome steps a virtual clock one frame at a time, the Web Audio graph is
  rendered offline, and ffmpeg muxes both (about 4 min for a 90 s episode).
- Trailer cut (~60 s, in the Soothing Bots hype-video style: title, captions,
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
npm run curate              # regenerate + gate all 12 curated bundles
npm run enrich              # Fireworks lyric pass (needs FIREWORKS_API_KEY)
node web/test-*.mjs         # headless suites (Node 22), incl. test-voice
```

License: MIT
