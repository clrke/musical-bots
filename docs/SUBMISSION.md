# Submission: Meta Global AI Hackathon (Indie developer track)

Due **Nov 4, 9:00 PM ET** (re-check https://dev.meta.ai/events/global-hackathon and the
official rules before submitting; the event page says dates may change). Indie track judging:
"creativity, technical ambition, and whether it works."

## One-liner

Type a cartoon episode; a choir of 16 robots writes it, stages it and *sings* it as a 3D musical
in your browser, with real synthesized singing, harmony and no recordings.

## Pitch (short description)

Musical Bots turns a one-line prompt ("Blue brings home the biggest toy box on the street") into
a sung 3D episode. An AI crew of seven agents, directed by Meta's Muse Code and each embodied by a
bot (lyrics, chords, dance, lighting, deals, hype, comedy), writes the story song while you watch
them work, consult each other and sing their ideas. Then the story's own cast performs it in
Blender-built sets, heads and floating hands gliding through a diner, a big house and a street:
the lead's verses, the pal's answers, choruses in harmony over a sung bass and pads, handshakes,
fist bumps and conga lines, face acts on cue, and a camera that follows the singer. Every voice is
a formant singing synthesizer running in the browser: the bots sing the actual words, in the
cast's own voices (soprano, alto, tenor, crooner, basso, robo...). No recordings, no TTS, no server.

## How it works

- An AI crew writes every episode. **Muse Code**, Meta's agentic coding CLI, runs headless as the
  director on Meta's Muse Spark model: it plans the story (11 beats in the Soothing Bots story-song
  form, one irony set up early and paid off in the last chorus), then launches a Muse **Workflow**
  of seven role subagents, one per job, each its own agent definition and embodied by a bot: Green
  writes the lyrics, White the chords, Gray the dance, Blue the lights, Gold the deals, Yellow the
  hype, Pink the comedy. They work at the same time and write through one tool
  (`scripts/director/emit.js`) that validates every event (the lyric rules, the singable-line
  limits, the song form, the action vocabulary), keeps the stream in song order while seven agents
  write at once, and shows each agent the beat in progress and who is consulting it. Every event is
  a short present-tense summary of the agent's thinking plus the line and the action the bot
  performs; at least two are consultations between agents.
- The making-of is real. Each event's `t` is when the crew wrote it: in `npm run dev`, Make it sends a
  new prompt to the director and the role bots perform the crew's work as it lands, as a musical
  number: each sings its thinking (its summary, in the team's "we") a cappella over the crew's sung
  backing, Green sings the lines he proposes on their tune, and a consultation is a duet sealed with
  a hand play; a Play button skips to the premiere once the episode is ready; then the premiere plays the finished bundle, sung by the story's cast. Checked-in episodes premiere in the static app with zero keys and replay their
  recorded making-of; any other prompt is written on the spot by a seeded offline generator in the
  same bundle shape.
- One JSON event protocol (`director/protocol.md`) for both: the generator and the director write
  the same v2 story bundle, the stage plays both.
- One player: events are arranged into a Soothing Bots story song (11 sections in 6/4 at 132-136 bpm:
  4-line verses, hook choruses, the pal's replies, harmony and low harmony, a sung "Bom" bass,
  pads and a chorus-3 counter-melody, mixed by layer so the story's words stay on top), sung by the
  Magna Vocalization voice engine (CMUdict pronunciation, stress fitted to the beat) in a worker
  pool, and staged in Three.js. Mouths and lyric highlights follow the sung syllables.
- 16 procedural robot heads with floating hands that act: 20 Soothing Bots hand plays ported with
  their choreography and real contact (handshake, high-five, fist bump, hold-hands swing, conga,
  hand stack, pinky promise...), 38 face acts on lyric cues (`{Gold:gasp}`), consultations that end
  in a nod or a handshake, and a choir's social life between lines (glances, sways, bumps).
- The bots move through Blender-built sets per beat (diner, big house, street) as heads and hands:
  marks, entrances, parades and huddles, the lighting agent's moods and spotlights, and shots
  framed inside each set.
- Frame-exact video: a virtual clock drives headless GPU Chrome one frame at a time with the
  Web Audio rendered offline, so the demo video is the app's own output at 1080p30.

## What makes it ambitious

- Real singing synthesis in the browser (glottal source, formant articulation, consonants
  retimed onto the beat, vibrato, per-voice profiles), arranged into melody that follows the
  chords, with harmony parts.
- A whole pipeline from prompt to a sung, staged, filmed episode, deterministic end to end
  (the same prompt gives the same episode, frame for frame).
- Measured: sung-lyric intelligibility checked with Whisper large-v3 on every release of the demo
  (`eval/README.md`): in v23, 77.2% of the premiere lead's sung words and 68.3% of the making-of's
  were recognized (v19: 70.5% and 53.3%); on the per-line check of the hackathon episode, 63.6%
  (52.4% for the v21 bundle). The earliest check found the web singer on par with the author's
  shipped Quest app on the same engine. Staging is checked too: sight lines, head collisions and
  z-fighting in every set (`npm test`).

## Use of Meta models

- **Muse Code + Muse Spark (the director and its crew).** Muse Code 1.4.14 runs headless
  (`muse exec --json`) with the seven role definitions as one `--agents` overlay and Muse's
  Workflow tool (`host.parallel`, `agentType` per role) for the crew; its default model on this
  account is `muse-spark-1.3-contributor` (Muse Spark 1.3, the contributor tier: discounted tokens,
  content may be used for product improvement; `--model muse-spark-1.3` for the standard tier).
  Measured on four trial episodes: 2.2-2.8 M input tokens each (about 87% served from the prompt
  cache), 33-42 K output tokens, 72-89 model calls, about $0.04-0.05 per episode at the contributor
  rate (about $0.8-0.9 at the standard rate), 2.5-3.6 minutes of wall time. Every bundle's
  `director.json` records the Muse version, model, efforts, tokens per agent, cost and time.
- **Muse Spark Open (optional lyric polish).** `npm run enrich` is an optional OpenAI-compatible
  lyric pass (`ENRICH_BASE_URL` / `ENRICH_API_KEY` / `ENRICH_MODEL`) that defaults to Meta's
  open-weights Muse Spark Open, with a strict JSON schema; a rewrite is kept only if it passes the
  lyric rules, the syllable budget and the validator. Status: built and tested against a local
  stub; not run with a real key, so the curated episodes ship without it.

## Links (fill in)

- Repo: https://github.com/clrke/musical-bots (public from ~Nov 2)
- Demo video: TODO (upload `musical-bots-trailer-v23.mp4`, 2:59, 1080p: the prompt typed (with key clacks) and Make it pressed, then ~87 s of the a cappella making-of as the loading bar, sung in the real sets: the director's homework (Meta's hackathon page, the notes read) and the plan sent ("Green, eleven beats: our story!") under the progress bar; then one whole consultation as the crew really has it, Black (the plot's trouble) asking Green what if sung words come out as mush and whether White rings out as Why: the ask, the context, both questions, Green's "Hmm, let me think on that, Black" at once; after other talk Green comes back to it ("Black, you asked: does White ring out as Why?") with its reasoning and both answers; later Black comes back, agrees and thanks, sealed with a handshake; then the hackathon premiere's verse about the late nights ("We code with Muse past midnight", the story sung as "we"), one chorus of another episode (Beach Ball Chase, on the beach), and the hackathon finale in the diner ("Our hackathon show!"). If the Official Rules cap videos at 2 minutes, upload the backup cut `musical-bots-trailer-v23-2min.mp4` (1:53: the typed prompt, the homework, the ask and the hold, the recall with its answers, the late-night verse, the finale's outro). The full making-of is `musical-bots-hackathon-making-of-v23.mp4` (16:09, as long as the real production), the full episode `musical-bots-hackathon-win-v23.mp4` (4:10))
- Live app: https://clrke.github.io/musical-bots/ (GitHub Pages via `.github/workflows/pages.yml`,
  once the repo is public)

## Run it

```
nvm use && npm ci --prefix web && npm run dev
```

Type a prompt, press Make it: the AI crew sings its thinking as it writes the episode (the making-of),
then the premiere. Premiere skips straight to the finished episode. Curated prompts (see
`web/src/curated.js`) replay their checked-in making-of and episode; anything else is generated on the spot. With Muse Code logged in, Make it directs a new
prompt with the AI crew in front of you (`director/README.md`); `npm run direct -- --all`
regenerates the curated episodes the same way.

## Checklist before submitting (on hold, resume here)

- [ ] Re-check the dates and official rules (track, video limits, required fields).
- [ ] Optional: put `ENRICH_API_KEY` / `ENRICH_BASE_URL` in `~/.zshenv` or a git-ignored `.env`, run
      `npm run enrich`; re-score with Whisper (`eval/README.md`); re-cut the trailer:
      `TYPING=1 RUN_DIR=/tmp/mb-render/v4 scripts/render/render-episode.sh "<prompt>" ep.mp4`;
      `node scripts/render/capture.mjs --url http://localhost:4180 --out /tmp/mb-render/mo --fmt jpeg --makingof --skip 44 --frames 330`;
      `python3 scripts/render/trailer.py /tmp/mb-render/v4 trailer.mp4 --makingof /tmp/mb-render/mo --mo-seconds 9`.
- [ ] Upload the trailer; put its link in `README.md` ("Demo video: <link added on upload>",
      under "Watch / Try it") and in "Links" above.
- [ ] Flip the repo public (~Nov 2) after a final secrets check (`git log -p | grep -i key`).
- [ ] Repo settings: topic `meta-hackathon-2026`, a description that mentions the Meta Global AI
      Hackathon 2026, homepage https://clrke.github.io/musical-bots/
      (`gh repo edit clrke/musical-bots --add-topic meta-hackathon-2026 --homepage
      https://clrke.github.io/musical-bots/ --description "..."`).
- [ ] Settings > Pages > Source: GitHub Actions; run the pages workflow and check the live link.
- [ ] Watch the final trailer once with sound.
