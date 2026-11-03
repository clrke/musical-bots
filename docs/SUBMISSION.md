# Submission: Meta Global AI Hackathon (Indie developer track)

Due **Nov 4, 9:00 PM ET** (re-check https://dev.meta.ai/events/global-hackathon and the
official rules before submitting; the event page says dates may change). Indie track judging:
"creativity, technical ambition, and whether it works."

## One-liner

Kids' sing-along cartoons cost thousands of dollars a minute to animate. Type one line, and Musical
Bots' crew of AI agents writes an original one for pocket change, singing every choice it makes
as it works; then 16 robots *sing* the cartoon in 3D in your browser.

## Pitch (short description)

Little kids love sing-along cartoons, but an original one is out of reach for the people with the
best ideas for one: 2026 studio price guides start at about $5,000 per finished minute of 3D
animation, about $20,000 for a four-minute song. Musical Bots is for the parent, the teacher and the
small kids' channel with an idea of their own, and for anyone who wants to see AI agents at work.
Type one line ("Blue brings home the biggest toy box on the street") and press Make it: a crew of
eight AI agents, directed by Meta's Muse Code on Muse Spark and each embodied by a bot (lyrics,
chords, dance, lighting, deals, hype, comedy and the plot's trouble), writes the story song in about
ten minutes, for about ten cents of AI time on the tier we used (a few dollars at list price). AI work is usually a black box behind a spinner; here
it is the show: the crew sings its thinking a cappella as it writes, asks each other and answers
with its reasons, so every choice the AI makes for a child's cartoon is heard, and checked by rules
a grown-up can read. Then the story's own cast performs it in Blender-built sets: the lead's verses,
the pal's answers, choruses in harmony over a sung bass, handshakes and conga lines, face acts on
cue, a camera that follows the singer. Every voice is a formant singing synthesizer running in the
browser, singing the actual words in the cast's own voices: no recordings, no TTS, no server, and
nothing to pay per play. The full case, with its sources: `docs/PITCH.md`.

## How it works

- An AI crew writes every episode. **Muse Code**, Meta's agentic coding CLI, runs headless as the
  director on Meta's Muse Spark model: it plans the story (11 beats in the Soothing Bots story-song
  form, one irony set up early and paid off in the last chorus), then launches a Muse **Workflow**
  of eight role subagents, one per job, each its own agent definition and embodied by a bot: Green
  writes the lyrics, White the chords, Gray the dance, Blue the lights, Gold the deals, Yellow the
  hype, Pink the comedy, and Black brings the plot's trouble (problems he pitches; Green or Gold
  decides which the story takes). They work at the same time and write through one tool
  (`scripts/director/emit.js`) that validates every event (the lyric rules, the singable-line
  limits, the song form, the action vocabulary), keeps the stream in song order while eight agents
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
  shipped app on the same engine. Staging is checked too: sight lines, head collisions and
  z-fighting in every set (`npm test`).

## Use of Meta models

- **Muse Code + Muse Spark (the director and its crew).** Muse Code 1.4.14 runs headless
  (`muse exec --json`) with the eight role definitions as one `--agents` overlay and Muse's
  Workflow tool (`host.parallel`, `agentType` per role) for the crew; its default model on this
  account is `muse-spark-1.3-contributor` (Muse Spark 1.3, the contributor tier: discounted tokens,
  content may be used for product improvement; `--model muse-spark-1.3` for the standard tier).
  Measured on the 14 curated episodes as shipped (Nov 1, the director and all eight agents):
  8.2-10.6 M input tokens each (91-94% served from the prompt cache), 110-148 K output tokens,
  171-208 model calls, $0.09-0.13 per episode at the contributor rate (median $0.11; $2.36-3.01 at
  the standard rate), 7.7-14.1 minutes of wall time (median 10.7). Every bundle's `director.json`
  records the Muse version, model, efforts, tokens per agent, cost and time.
- **Muse Image (the episode's poster).** Each episode's poster is drawn by `muse-image-1.0` through the
  Meta Model API (`POST /v1/images/edits`, `scripts/director/poster.js`): a prompt built from the episode's
  plan (title, story, opening scene, cast by colour) plus a frame of our own 3D bots as the style reference, so
  the poster looks like the show. It is the premiere's title card and the link preview (`og:image`). The 15
  curated episodes' posters are checked in (15 calls, about $0.15 on the owner's key); a hosted run draws its own
  in its sandbox on the run's key ($0.01, ~30 s, in parallel with the crew). Verified end to end on the
  deployed site (Nov 4): a real sandbox run drew and served its poster.
- **Muse Spark Open (optional lyric polish).** `npm run enrich` is an optional OpenAI-compatible
  lyric pass (`ENRICH_BASE_URL` / `ENRICH_API_KEY` / `ENRICH_MODEL`) that defaults to Meta's
  open-weights Muse Spark Open, with a strict JSON schema; a rewrite is kept only if it passes the
  lyric rules, the syllable budget and the validator. Status: built and tested against a local
  stub; not run with a real key, so the curated episodes ship without it.

## Links (fill in)

- Repo: https://github.com/clrke/musical-bots (public from ~Nov 2)
- Demo video: https://youtu.be/nn9xmv4NpYA (`musical-bots-why-we-win-v30.mp4`, 2:57, 1080p: v29 with the opening provenance title, "Built during the Meta Global AI Hackathon, Oct 26 – Nov 4, 2026" / "New: the AI crew, its director and the app · from my earlier work: the singing engine, voices, hand plays and art"; self-hosted mirror: https://github.com/clrke/musical-bots/releases/download/demo-v30/musical-bots-why-we-win-v30.mp4; the portal entry submitted Nov 3 links v29, https://youtu.be/IdHf7XYFG9Q: "Why should Musical Bots win the Meta Global AI Hackathon?" typed (with key clacks) and Make it pressed; the director's homework (Meta's hackathon page); the lyric gate rejecting a line and the crewmate explaining it (Gold: "No! The lyric gate says copy", Green: "Gold, the lyric gate checks lines / It checks the rhyme and beat, Gold", captioned "The lyric gate says no, and they fix it"); Black's consultation with Green as the crew really had it (his two proposals, Green's reasoning and answers, his follow-up, Green's "Let me think on our doubt", the answer, the agreement, the thanks and the high five); then the premiere: verse 2 with CoComelon's two hundred million fans and Baby Shark's seventeen billion views, the bridge "Twenty friends take months with care / Studio clips cost thousands / We type one line for a dime / Your browser sings with warm sounds" and the outro "We sing the work we do / Our Musical Bots cost dimes / That's why we should win"; an end card with the one-liner and https://musical-bots.vercel.app. No 2-minute cap found (Nov 2 rules re-check: the requirement is a 3-minute demo video, and 2:57 fits); the backup cut `musical-bots-why-we-win-v29-2min.mp4` (1:58: https://youtu.be/wkG207to_mw, with the lyric gate too) is kept as backup only. The full making-of is `musical-bots-why-we-win-making-of-v29.mp4` (17:49, the filler songs included); the full episode is `musical-bots-why-we-win-premiere-v29.mp4`. v28 (2:56 / 1:44, with a filler instead of the lyric gate) is kept as the fallback.)
- Live app: https://musical-bots.vercel.app (Vercel; curated prompts replay instantly, Make it on a new
  prompt runs the Muse Code director live with your own Meta key or approved credits: `docs/HOSTING.md`)

### Portal paste list (exact URLs)

- Demo video: https://youtu.be/nn9xmv4NpYA (2:57 full cut, v30; the earlier v29 is https://youtu.be/IdHf7XYFG9Q)
- Repo: https://github.com/clrke/musical-bots
- Live app: https://musical-bots.vercel.app
- Optional description addition (one sentence, if the portal still allows edits): "Each episode also gets a poster drawn by Meta's Muse Image from the episode's plan, in our bots' own style."
- Do NOT use the 1:58 backup cuts (https://youtu.be/tVJ0yzE8fgw v30, https://youtu.be/wkG207to_mw v29) as the demo video.

## Run it

```
nvm use && npm ci --prefix web && npm run dev
```

Type a prompt, press Make it: the AI crew sings its thinking as it writes the episode (the making-of),
then the premiere. Premiere skips straight to the finished episode. Curated prompts (see
`web/src/curated.js`) replay their checked-in making-of and episode; anything else is generated on the spot. With Muse Code logged in, Make it directs a new
prompt with the AI crew in front of you (`director/README.md`); `npm run direct -- --all`
regenerates the curated episodes the same way. On https://musical-bots.vercel.app, Make it on a new
prompt runs the same director in a Vercel Sandbox, with your own Meta Model API key or credits the
owner approves (`docs/HOSTING.md`).

## Checklist before submitting

- [x] Re-check the dates and official rules (track, video limits, required fields). Done Nov 2:
  deadline Nov 4 9PM ET confirmed, 3-minute demo video, no 2-min cap → v29 full cut.
- [ ] Optional: put `ENRICH_API_KEY` / `ENRICH_BASE_URL` in `~/.zshenv` or a git-ignored `.env`, run
      `npm run enrich`; re-score with Whisper (`eval/README.md`); re-cut the trailer:
      `TYPING=1 RUN_DIR=/tmp/mb-render/v4 scripts/render/render-episode.sh "<prompt>" ep.mp4`;
      `node scripts/render/capture.mjs --url http://localhost:4180 --out /tmp/mb-render/mo --fmt jpeg --makingof --skip 44 --frames 330`;
      `python3 scripts/render/trailer.py /tmp/mb-render/v4 trailer.mp4 --makingof /tmp/mb-render/mo --mo-seconds 9`.
- [x] Upload the trailer; put its link in `README.md` (under "Watch / Try it") and in "Links"
  above. Done Nov 3: full cut (2:57) on YouTube https://youtu.be/IdHf7XYFG9Q (verified title +
  177s), self-hosted asset kept as mirror. https://youtu.be/wkG207to_mw is the 1:58 BACKUP —
  do NOT submit it as the demo video. Nov 3 evening: v30 (the provenance title) on YouTube
  https://youtu.be/nn9xmv4NpYA (2:57), backup https://youtu.be/tVJ0yzE8fgw (1:58); mirror release demo-v30.
- [x] Flip the repo public (~Nov 2) after a final secrets check (`git log -p | grep -i key`).
  Done Nov 2: public, topic set, secrets audit clean.
- [x] Repo settings: topic `meta-hackathon-2026`, a description that mentions the Meta Global AI
      Hackathon 2026, homepage https://musical-bots.vercel.app. Done Nov 2 via `gh repo edit`.
- [x] Live site (Vercel, `docs/HOSTING.md`): SMTP (Nov 1) + dedicated `META_API_KEY`, redeployed,
  rehearsal run green end to end (68s, exit 0, real bundle); site + health verified after deploy.
- [x] Watch the final trailer once with sound (owner — approved Nov 3: sounds good).
- [ ] Submit in the portal (owner, before Nov 4 9PM ET).
