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

- An AI crew writes every episode. **Muse Code**, Meta's agentic coding CLI, runs headless as the
  director on Meta's Muse Spark model: it plans the story (11 beats in the Soothing Bots story-song
  form, one irony set up early and paid off in the last chorus), then launches a Muse **Workflow**
  of seven role subagents, one per job, each its own agent definition and embodied by a bot: Teddy
  writes the lyrics, Nora the chords, Vera the dance, Gigi the lights, Lou the deals, Frankie the
  hype, Pearl the comedy. They work at the same time and write through one tool
  (`scripts/director/emit.js`) that validates every event (the lyric rules, the singable-line
  limits, the song form, the action vocabulary), keeps the stream in song order while seven agents
  write at once, and shows each agent the beat in progress and who is consulting it. Every event is
  a short present-tense summary of the agent's thinking plus the line and the action the bot
  performs; at least two are consultations between agents.
- The making-of is real. Each event's `t` is when the crew wrote it: in `npm run dev`, Live sends a
  new prompt to the director and the role bots perform the crew's work as it lands (each sings the
  line it writes, or acts its summary), then the premiere plays the finished bundle, sung by the
  story's cast. Checked-in episodes premiere in the static app with zero keys and replay their
  recorded making-of; any other prompt is written on the spot by a seeded offline generator in the
  same bundle shape.
- One JSON event protocol (`director/protocol.md`) for both: the generator and the director write
  the same v2 story bundle, the stage plays both.
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

- **Muse Code + Muse Spark (the director and its crew).** Muse Code 1.4.14 runs headless
  (`muse exec --json`) with the seven role definitions as one `--agents` overlay and Muse's
  Workflow tool (`host.parallel`, `agentType` per role) for the crew; its default model on this
  account is `muse-spark-1.3-contributor` (Muse Spark 1.3, the contributor tier: discounted tokens,
  content may be used for product improvement; `--model muse-spark-1.3` for the standard tier).
  Measured on four trial episodes: 2.2-2.8 M input tokens each (about 87% served from the prompt
  cache), 33-42 K output tokens, 72-89 model calls, about $0.04-0.05 per episode at the contributor
  rate (about $0.8-0.9 at the standard rate), 2.5-3.6 minutes of wall time. Every bundle's
  `director.json` records the Muse version, model, efforts, tokens per agent, cost and time.
- **Muse Spark Open (optional lyric polish).** `npm run enrich` defaults to Meta's open-weights Muse
  Spark Open, serverless on Fireworks (`accounts/fireworks/models/muse-spark-open`, listed in the
  public Fireworks catalog on 2026-10-29), with a strict JSON schema; a rewrite is kept only if it
  passes the lyric rules, the syllable budget and the validator. Any OpenAI-compatible host works via
  `ENRICH_*` (Modal's shared endpoints also serve Muse Spark Open). Status: built and tested against
  a local stub; not run with a real key yet.

## Links (fill in)

- Repo: https://github.com/clrke/musical-bots (public from ~Nov 2)
- Demo video: TODO (upload `musical-bots-trailer-v3.mp4`, 67 s, 1080p)
- Live app: TODO (static build of `web/dist`, e.g. GitHub Pages)

## Run it

```
nvm use && cd web && npm install && npm run dev
```

Type a prompt, press Premiere. Curated prompts (see `web/src/curated.js`) play their checked-in
episodes; anything else is generated on the spot. With Muse Code logged in, Live directs a new
prompt with the AI crew in front of you (`director/README.md`); `npm run direct -- --all`
regenerates the curated episodes the same way.

## Sponsor credits (Modal + Fireworks)

Credits from both are for running Meta's open-weights models; no sponsor prizes. How each is
used (also the answers on their credit forms):

- **Fireworks:** serverless inference on a Llama model for `npm run enrich` (default host).
- **Modal:** an OpenAI-compatible Llama endpoint (Modal Endpoints) for the same pass and for
  author-time director runs, selected with `ENRICH_BASE_URL` / `ENRICH_API_KEY` /
  `ENRICH_MODEL`. The earlier idea of a Modal render farm is dropped: it uses no Meta model,
  and the local GPU capture already renders an episode in about 5 minutes.
- Status: the `modal` CLI is installed; `modal token new` and both keys are pending (on hold).

## Checklist before submitting (on hold, resume here)

- [ ] Re-check the dates and official rules (track, video limits, required fields).
- [ ] Apply for the Modal + Fireworks credits (answers in HANDOFF.md, private).
- [ ] `modal token new`; put the Fireworks (or Modal endpoint) key in `~/.zshenv` or a
      git-ignored `.env`.
- [ ] Run `npm run enrich`; re-score with Whisper; re-cut the trailer
      (`TYPING=1 RUN_DIR=/tmp/mb-render/final scripts/render/render-episode.sh "<prompt>" ep.mp4`,
      then `python3 scripts/render/trailer.py /tmp/mb-render/final trailer.mp4`).
- [ ] Flip the repo public (~Nov 2) after a final secrets check (`git log -p | grep -i key`).
- [ ] Deploy `web/dist` statically and fill in the links above.
- [ ] Watch the final trailer once with sound.
