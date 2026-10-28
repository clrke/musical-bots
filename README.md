# Musical Bots

Type a cartoon episode prompt; a choir of 16 bots performs it as a sung 3D
episode in your browser (Three.js, no VR) — a "making-of" musical where each
bot plays a production role (lyrics, chords, dance, lighting, deals, hype,
comedy) and the band plays along, all driven by a JSON event protocol.

Built for the Meta Global AI Hackathon.

## Run it

```
nvm use          # Node 22 (see .nvmrc)
cd web && npm install && npm run dev
```

Open the dev server, type a prompt, and hit Premiere. URL drivers:
`/?prompt=<text>` premieres a generated episode, `&t=<seconds>` seeks,
`&env=<diner|big_house|street|smoke>` picks the set. Production build:
`npm run build` in `web/`, then serve `web/dist/` statically.

## How it works

- One event protocol (`director/protocol.md`), two producers, one player.
  Events stream as NDJSON bundles (`episodes/<id>/beats.json` +
  `events.ndjson`): LIVE generation (the "making-of") and deterministic
  REPLAY of a captured bundle (premieres, judge runs).
- Producers: (1) a seeded runtime generator (works offline, zero API keys)
  mirroring the 7 subagent responsibilities; (2) author-time direction via
  the prompt pack in `director/prompts/`.
- Cast: 16 procedural robot heads + floating hands, per-bot voice classes
  over raw Web Audio, lyric captions, and group staging (walk, handshake,
  high-five, huddle, celebration).
- Sets: Blender-headless `.blend` → `.glb` pipeline (`scripts/blender/`)
  with per-set lighting; the diner, the big house, and the night street.

## Content & docs

- Twelve curated episode bundles in `episodes/` (see `scripts/curate.js`;
  each gated on lyric rules, ≥2 consultations, and `npm run validate`).
- Deterministic stills: `scripts/capture.sh "<prompt>" <outdir> [base-url]
  [t ...]` with `ENV=<set>` for per-set captures.
- `docs/PLAN.md` – build plan and slice log.

## Layout

- `web/` – Vite + Three.js client (player, generator, headless `test-*.mjs`)
- `director/` – event protocol and author-time subagent prompt pack
- `environments/`, `episodes/` – Blender sets and curated bundles
- `scripts/` – bundle validator, generator, curator, capture

## Tests

```
npm run validate            # sample bundle against the protocol
npm run curate              # regenerate + gate all 12 curated bundles
node web/test-*.mjs         # headless suites (Node 22)
```

License: MIT
