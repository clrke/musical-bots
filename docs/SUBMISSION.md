# Submission: Meta Global AI Hackathon (Indie developer track)

Due **Nov 4, 9:00 PM ET** (re-check https://dev.meta.ai/events/global-hackathon and the
official rules before submitting; the event page says dates may change). Indie track judging:
"creativity, technical ambition, and whether it works."

## One-liner

Type a cartoon episode; a choir of 16 robots writes it, stages it and *sings* it as a 3D musical
in your browser, with real synthesized singing, harmony and no recordings.

## Pitch (short description)

Musical Bots turns a one-line prompt ("Gigi brings home the biggest toy box on the street") into
a sung 3D episode. Seven production roles (lyrics, chords, dance, lighting, deals, hype, comedy)
are each embodied by a bot from the cast. You watch them propose lines, consult each other,
shake hands on deals and high-five on wins, and then perform the result as a song with solos,
choruses in harmony, a band pad and a camera that follows the singer. Every voice is a formant
singing synthesizer running in the browser: the bots sing the actual words, in the cast's own
voices (soprano, alto, tenor, crooner, basso, robo...). No recordings, no TTS, no server.

## How it works

- One JSON event protocol (`director/protocol.md`) and two producers: a seeded generator that
  works offline with zero keys, and an author-time director (prompt pack in `director/prompts/`,
  12 curated episodes, optional lyric enrichment by a Meta open-weights model).
- One player: events are arranged into a song (132 bpm, one solo at a time, repeated lines
  become harmony), sung by the Magna Vocalization voice engine in a worker pool, and staged in
  Three.js. Mouths and lyric highlights follow the sung syllables.
- 16 procedural robot heads with floating hands, a studio look that matches what the chrome
  reflects, and Blender-built sets (diner, big house, street) on `?env=`.
- Frame-exact video: a virtual clock drives headless GPU Chrome one frame at a time with the
  Web Audio rendered offline, so the demo video is the app's own output at 1080p30.

## What makes it ambitious

- Real singing synthesis in the browser (glottal source, formant articulation, consonants
  retimed onto the beat, vibrato, per-voice profiles), arranged into melody that follows the
  chords, with harmony parts.
- A whole pipeline from prompt to a sung, staged, filmed episode, deterministic end to end
  (the same prompt gives the same episode, frame for frame).
- Measured: sung-lyric intelligibility checked with Whisper large-v3 (about 51% of words
  recognized on the demo episode, on par with the author's shipped Quest app using the same
  engine).

## Use of Meta models and sponsor credits

- The hackathon's sponsor credits (Fireworks, Modal, Baseten) are for running Meta's
  open-weights models. `npm run enrich` sends each curated episode's lines to a Llama model
  (Fireworks by default; any OpenAI-compatible host via `ENRICH_*`, including a Modal or
  Baseten endpoint or the Meta Model API) with a strict JSON schema, and keeps a rewrite only
  if it passes the lyric rules, the syllable budget and the validator.
- Status: built and tested against a local stub; **TODO: run with a real key and record the
  model + counts here** (see `episodes/*/enrich.json`).

## Links (fill in)

- Repo: https://github.com/clrke/musical-bots (public from ~Nov 2)
- Demo video: TODO (upload `musical-bots-trailer-v3.mp4`, 67 s, 1080p)
- Live app: TODO (static build of `web/dist`, e.g. GitHub Pages)

## Run it

```
nvm use && cd web && npm install && npm run dev
```

Type a prompt, press Premiere. Curated prompts (see `web/src/curated.js`) play their checked-in
episodes; anything else is generated on the spot.

## Checklist before submitting

- [ ] Re-check the dates and official rules (track, video limits, required fields).
- [ ] Run `npm run enrich` with a real key; re-score with Whisper; re-cut the trailer.
- [ ] Flip the repo public (~Nov 2) after a final secrets check (`git log -p | grep -i key`).
- [ ] Deploy `web/dist` statically and fill in the links above.
- [ ] Watch the final trailer once with sound.
