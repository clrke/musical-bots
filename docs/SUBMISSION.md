# Submission: Meta Global AI Hackathon (Indie developer track)

Due **Nov 4, 9:00 PM ET** (re-check https://dev.meta.ai/events/global-hackathon and the
official rules before submitting; the event page says dates may change). Indie track judging:
"creativity, technical ambition, and whether it works."

## Submission form: the answers (plain text, paste as-is)

Each block below is exactly what goes in that field of the portal form, which does not render markdown: plain sentences, no bullets, bold or code marks. The headings are the form's own labels. Character counts are in brackets after each heading. The one-liner, the pitch and the sections further down are reference notes.

### Project Description: Describe your project and what problem it solves... [1560 characters]

Little kids love sing-along cartoons, but an original one costs thousands of dollars to animate: studio price guides start around $5,000 per finished minute of 3D. Musical Bots lets anyone with an idea get one for pocket change, and lets you watch the AI make it.

Type one line, for example "Blue brings home the biggest toy box on the street", and press Make it. A crew of eight AI agents, directed by Meta's Muse Code, writes an original story song: one agent drafts the lyrics, one writes the chords, one the dance, one the lighting, one the deals, one the hype, one the comedy, and one brings the plot's trouble. They work at the same time, ask each other questions, answer with their reasons, and sing their thinking a cappella as they go, so every choice the AI makes for a child's cartoon is heard, not hidden behind a spinner. A rule-checking gate validates everything (singable lines, song form, gentle problems that get solved by the finale), and a repair run fixes what it rejects. Then Meta's Muse Wonder writes the final sung lyrics, through the same gates.

Then 16 robots perform the finished episode in 3D in your browser: real sung voices synthesized live from the lyrics (no recordings, no text-to-speech, no server audio), handshakes and high fives, and a poster drawn by Meta's Muse Image.

A live run takes 10 to 20 minutes and about 30 to 55 cents of AI time on the tiers we used (a few dollars at list price). 15 ready episodes replay instantly with no key.

Try it: https://musical-bots.vercel.app
Code: https://github.com/clrke/musical-bots

### Describe your use of Meta products to build the submitted project [2145 characters]

Muse Code (Meta's agentic coding CLI) is the director. We run it headless (muse exec --json) with its Workflow tool: the director plans an 11-beat story, then launches eight role subagents in parallel, each its own custom agent definition passed in one --agents overlay. They all write through one validating tool that checks every event and keeps the stream in song order while eight agents write at once.

Muse Spark 1.3 (muse-spark-1.3-contributor by default, --model muse-spark-1.3 for the standard tier) is the model every crew agent thinks with. Its lyrics agent drafts the sung lines.

Muse Wonder (muse-wonder-1.0) writes the final sung lyrics. Once the gate passes, one chat call sends the whole song to Muse Wonder, beat by beat, with the crew's rules, the craft of a line that hits (pictures and strong verbs, varied openings, replies that answer the line, a chorus to shout back) and the story's facts. Every line it writes goes through the director's own checks (rhyme, singable length, words the singing voice knows, meter, kind present-tense wording, and the names and numbers its draft sings); a line that fails goes back to it with the problem, up to four more rounds, and a line that never passes keeps the crew's version. It writes 37 to 42 of an episode's 42 sung lines (the hook keeps its words; Muse Wonder writes its reply). We regenerated the lyrics of 14 of our 15 ready episodes with it on Nov 4 and re-directed the hero with it on Nov 5; after a rework of the pass for energy that day, five of them (the hero among them) were regenerated again.

Muse Image (muse-image-1.0, POST /v1/images/edits) draws each episode's poster from the episode's plan plus a frame of our own 3D bots as the style reference. Muse Spark 1.3 then reads the drawing back with vision and a misspelled title is drawn once more.

The Meta Model API powers live runs. A visitor pastes their own Meta Model API key, or signs in and requests credits from us. Each run happens in its own Vercel Sandbox that installs Muse Code from Meta's launcher and receives the key only in that run's environment; the key is never stored or logged.

Every episode's director.json records the models, tokens, cost and time. Measured on the 15 episodes: the crew used 8 to 11 million input tokens each (90 to 94 percent from the prompt cache), $0.09 to $0.17 at the contributor rate; Muse Wonder's lyrics took 12,000 to 25,000 tokens, $0.10 to $0.20 (it has no contributor tier).

### Why are Meta's models important to your solution? [1497 characters]

Four things in Meta's stack made this possible.

First, Muse Code's Workflow tool: eight custom agents running at once in one headless session, with one provenance trail and a shared prompt cache. The agents reuse the director's cached context (90%+ of their input), so an episode with its lyrics and poster costs about a quarter on our tiers. That price is what makes live generation for anyone, on their own key, realistic.

Second, Muse Spark follows a long rulebook. Each agent works under a rulebook of about 25 KB (voice rules, singable-line limits, consultation etiquette, the plot-trouble structure) and writes only through a tool that rejects anything off-rule. The agents answer rejections in character, and a gate plus one repair run finish the job, so the result is a validated, performable episode, not loose text.

Third, Muse Wonder gives the song its words. A different Meta model family writes the lyrics under the crew's own gates: it gets the story the crew planned, its facts and the crew's rules, and about one in nine of its first-draft lines (38 of 351 in our Nov 4 runs) are sent back with the exact problem until they sing. That adds 20 to 35 cents an episode.

Fourth, Muse Image keeps the poster on-model. It takes a frame of our own 3D bots as a reference and returns art of the same characters in the same style, and Muse Spark's vision then checks the spelling of the title it drew. One Meta key and one API run the writing, the crew, the lyrics, the poster and its proofreading.

### Provide feedback from your experience using partner technologies. [2608 characters]

We built on Muse Code, the Meta Model API and Vercel (Sandbox, Blob, Functions), with Brevo for sign-in emails.

What worked well: Muse Code's headless mode and Workflow tool were a strong fit for a multi-agent product: parallel custom agents in one session, with 85 to 94 percent of input tokens served from cache. Muse Image was the easiest integration of the project: an OpenAI-style images/edits call with a reference image, right on the first try, $0.01 and about 30 seconds an image. Vercel Sandbox gave every live run its own microVM, exactly the isolation needed to run an agent on a visitor's API key. Vercel Blob (private store, conditional writes) held the run records.

What was hard:
(1) In a Vercel Sandbox, Muse Code's own shell sandbox cannot run (bubblewrap is unavailable), so every bash call failed with "sandbox enforcement unavailable" and the director ended its turn with exit code 0 and no plan: a silent failure. We found --disable-sandbox and now detect and report that error. A non-zero exit would have made it obvious.
(2) Linux caps one command-line argument at 128 KiB and our full agents overlay is about 220 KB, so we had to give each role a slim definition that reads its rules from a file. Passing agent definitions by file would help.
(3) Without maxParallelAgents the Workflow ran seven agents at once and the eighth joined minutes late.
(4) Muse Wonder and Muse Spark 1.3 spend most of their output on hidden reasoning (about 90 percent of Muse Wonder's tokens in our lyric calls), so a small max_tokens returns an empty answer with finish_reason length. That deserves a line in the docs. Wonder's $20 per million output tokens and no contributor tier make it the largest line in our bill.
(5) About one in nine of Muse Wonder's first-draft lines (38 of 351) still broke our own rules even with the rulebook in its prompt (rhymes that did not rhyme, "I" where the cast says "we", words the singing voice cannot say). It fixed nearly all of them in the next round with the exact problem fed back, which says how much a strict gate is worth.
(6) We could not find the allowed image sizes or the response shape for Muse Image in the docs, so we probed the API to learn that it returns a base64 WebP.
(7) Vercel: a vercel.json rewrite never fires where a static index.html exists (we needed Routing Middleware for share-link previews); credential brokering needs Pro, so on Hobby the key goes in the environment of one command; a stopped non-persistent Sandbox cannot be resumed.
(8) We did not use Meta's inference partners: our stack is Meta's own API plus Vercel and Brevo.

## One-liner (reference)

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
eleven minutes, for about 30 to 55 cents of AI time on the tiers we used (a few dollars at list price), with Muse Wonder writing the sung words. AI work is usually a black box behind a spinner; here
it is the show: the crew sings its thinking a cappella as it writes, asks each other and answers
with its reasons, so every choice the AI makes for a child's cartoon is heard, and checked by rules
a grown-up can read. Then the story's own cast performs it in Blender-built sets: the lead's verses,
the pal's answers, choruses in harmony over a sung bass, handshakes and conga lines, face acts on
cue, a camera that follows the singer. Every voice is a formant singing synthesizer running in the
browser, singing the actual words in the cast's own voices: no recordings, no TTS, no server, and
nothing to pay per play. The full case, with its sources: `docs/PITCH.md`.

## How it works

- An AI crew writes every episode. **Muse Code**, Meta's agentic coding CLI, runs headless as the
  director on Meta's Muse Spark model (Muse Wonder then writes the sung lyrics): it plans the story (11 beats in the Soothing Bots story-song
  form, one irony set up early and paid off in the last chorus), then launches a Muse **Workflow**
  of eight role subagents, one per job, each its own agent definition and embodied by a bot: Green
  drafts the lyrics (Muse Wonder writes the final sung words), White the chords, Gray the dance, Blue the lights, Gold the deals, Yellow the
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
  (52.4% for the v21 bundle). These were measured on the crew-written lyrics; the episodes Muse Wonder
  has since rewritten (14 on Nov 4, five of them again on Nov 5) were not re-scored. The earliest check found the web singer on par with the author's
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
- **Muse Wonder (the sung lyrics).** Once the director's gate passes, `scripts/director/wonder-lyrics.js` sends the
  crew's lyric drafts to `muse-wonder-1.0` through the Meta Model API (the same `META_API_KEY`): one request for the
  whole song, story beat by beat, with the crew's own rules and (since Nov 5) the craft of a line that hits in the
  system prompt, the plan's facts and the premise's fact sheet, plus up to four repair rounds. Every line it writes
  goes through the director's own gates (`emit.js` `lineProblems` / `formProblems`, `craft.js` `lineCraft`: lyric
  rules, singable-line limits, rhymes, the singing voice's dictionary, meter, voice, singability) and a truth gate
  (the names and numbers a draft sings stay; no number or amount the story never gives); a failing line is sent back
  with its problems, and one that never passes keeps the crew's version (37 to 42 of an episode's 42 sung lines are
  Muse Wonder's since the Nov 5 rework, 11 to 29 before). The hook keeps its words (Muse Wonder writes its reply);
  then the full gate runs again and, if it finds anything new, the crew's lyrics are restored. It runs at the end of
  every live or hosted run (skip with `--no-wonder` or `MB_NO_WONDER=1`) and never fails a run; `director.json`
  records it under `lyrics` and `cost.lyricsUsd`. `npm run lyrics` does the same for existing bundles and writes
  `episodes/<slug>/lyrics.json` (every change). Done on Nov 4 for 14 of the 15 curated episodes; the hero episode was
  re-directed on Nov 5 (its old lines sang "a dime", no longer true with Muse Wonder's lyrics), so its Muse Wonder
  pass ran in the run itself ($0.20); after the rework (Nov 5, the owner: "still lacking oomph") five episodes were
  regenerated from the crew's drafts (the hero, toy-box, dino-book, hot-soup, hackathon-win). Cost at list price,
  standard mode (no contributor tier; $4.00 / $0.20 cached / $20.00 per M): the reworked pass $0.21 to $0.35 per
  episode (median $0.29), 24,000 to 36,000 tokens, 71 to 122 s, 2 to 3 rounds; the Nov 4 pass $0.10 to $0.16 (the 14:
  $1.87 in all, median $0.14). A live run is now about $0.30 to $0.55 on the tiers we used, about $2.6 to $3.4 with
  the crew at list price.

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
- [ ] Optional: re-score the Muse Wonder episodes with Whisper (`eval/README.md`; the five of Nov 5's rework first); re-cut the trailer:
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
