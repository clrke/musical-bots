# Sponsor integrations: Fireworks + Modal

> **Update 2026-10-29:** the event pages (dev.meta.ai/events/global-hackathon,
> cerebralvalley.ai/e/meta-ai-developer-hackathon) list no sponsor prizes. Each
> sponsor's credits are "to use Meta's open-weights models" (Modal: "through
> Endpoints"). So the Fireworks enrichment (Llama) is on target, while the Modal
> render farm below (headless Chrome, no Meta model) is **not** what Modal's
> credits are for and is dropped. The local GPU capture already renders a 3-min
> episode in ~5 min. Instead, `scripts/enrich.js` accepts any OpenAI-compatible
> host via `ENRICH_BASE_URL`/`ENRICH_API_KEY`/`ENRICH_MODEL`, so a Modal or
> Baseten Llama endpoint (or the Meta Model API) can run the same pass.

Decision (2026-10-28): use **both**. Baseten evaluated and skipped — no
custom model to serve, and dedicated deployments start too expensive for
this project. Status: Fireworks enrichment built (`scripts/enrich.js`, `npm run enrich`),
tested against a local stub (`web/test-enrich.mjs`); waiting on a real key
for the first run. Modal farm: planned.

## Design rule

Both integrations are **author-time only**. The shipped app stays a static
Vite + Three.js site with zero API keys and zero backend. Sponsor tech
improves the bundles and assets we check in, never the runtime.

## Fireworks: lyric enrichment for curated bundles

- What: upgrade `scripts/curate.js` with an optional `--enrich` pass. For
  each generated bundle, send `{prompt, beat, agent}` triples to a
  Fireworks-hosted open model and ask for punchier lyric/summary
  candidates. Every candidate must re-pass the mechanical gates
  (`lyricProblems` + `validate-bundle.js`) or the original line stands.
- API: OpenAI-compatible chat completions with JSON-schema structured
  output (`response_format` + strict `json_schema`), so candidates parse
  without repair. Key from `FIREWORKS_API_KEY` env, never committed.
- Cost: serverless text rates (only $1 free credit — run enrichment
  sparingly, e.g. once per bundle, then check in results).
- Built: one structured-output request per bundle over its distinct sung
  lines (harmony lines stay identical); gates: lyric rules, +-2 syllables,
  60 chars, validator; provenance in `episodes/<slug>/enrich.json`. Curated
  prompts play their bundle in the app, so enriched lines reach the demo.
  Model: `FIREWORKS_MODEL` (default Llama 3.3 70B Instruct).
- Rejected alternative: live in-browser enrichment at premiere time —
  needs key handling in the client and breaks the static deploy.

## Modal: batch render farm for stills and video

- What: a Modal app (`render/farm.py`, new) that runs the deterministic
  capture pipeline at scale: given prompt × timestamp × environment sets,
  workers run headless Chromium stills and return PNGs; a finalizer
  stitches ffmpeg videos. Same `scripts/capture.sh` semantics, parallel.
- API: `@app.function()` with `modal.Image` pinning system Chrome +
  ffmpeg; `cls.map()` over the shot list; `modal.Volume` for frames in
  and videos out. Snapshot tests live here too (re-render goldens).
- Cost: Starter plan ($0 + $30/mo included compute); needs `modal`
  installed + `modal token new` login (human step).
- Effort: ~6-10h (image build, worker, volume plumbing, parity check
  against one local capture).
- Rejected alternative: Modal-hosted web service for the app — the app
  is static and needs no server.

## Setup (human steps, in order)

1. Create Fireworks + Modal accounts; confirm hackathon credits.
2. `export FIREWORKS_API_KEY=...` (local shell only) for enrichment runs.
3. `pip install modal && modal token new` for farm runs.
4. Keep both out of git: keys in env, runs on demand, results checked in.

## Sources

- [Fireworks docs](https://docs.fireworks.ai/getting-started/introduction)
- [Fireworks structured outputs](https://docs.fireworks.ai/structured-responses/structured-response-formatting.md)
- [Modal docs](https://modal.com/docs)
- [Modal pricing](https://modal.com/pricing)
- [Baseten pricing](https://www.baseten.co/pricing/?ref=saaspo.com) (evaluated, skipped)
