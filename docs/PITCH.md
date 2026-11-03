# The pitch: why Musical Bots

The case for Musical Bots in the Meta Global AI Hackathon (Indie developer track, judged on
creativity, technical ambition and whether it works), for the submission text, the video and Q&A.
Every number has a source (the table in "Proof", the links in "Sources"). The hero episode sings the
same case: the prompt "Why should Musical Bots win the Meta Global AI Hackathon?" with its fact sheet,
`director/briefs/why-musical-bots.md`.

## In one line

> An original kids' sing-along cartoon from one typed line, for pocket change instead of
> thousands of dollars, written by an AI crew that sings its own making-of.
> (About ten cents of AI time on the Muse Spark tier we used; a few dollars at list price.)

In ten seconds (the video's opening): *A sing-along cartoon costs thousands of dollars a minute to
animate. Type one line, and our crew of Muse Code agents writes you one for pocket change,
singing every choice out loud. Then sixteen robots sing it, in 3D, in your browser.*

## The problem: one story in two parts

1. **Original sing-along cartoons are out of reach (the who and the why).** Little kids love
   sing-along cartoons: the biggest nursery-rhyme channel on YouTube (Cocomelon) has 203 million
   subscribers and about 1.4 billion views a month. Making your own is another matter: 2026 studio
   price guides start at about $5,000 per finished minute of 3D animation and charge $15,000-30,000
   a minute for character work; the median US animator earns $49 an hour. At the entry tier a
   four-minute song is about $20,000. A parent, a teacher or a small kids' channel with an idea of
   their own (brushing teeth, sharing a truck, a lost puppy) can't pay that.
2. **AI work is a black box, and a dull one (why us, and the wow).** A long AI job is a spinner
   and a scrolling log. You can't see what the agents chose or why, and when the content is for
   children, that is the first thing a grown-up wants to know.

**Why both, as one story:** the first problem names a real user and a real cost; the answer to the
second is what only Musical Bots does. The AI's ten minutes of work become the show: the crew sings
its thinking, its questions to each other and its reasons as it writes, so every choice the AI
makes for a child's cartoon is heard, checked by rules a grown-up can read, and fun to watch.

## Who it's for

- **Small creators, parents and teachers** who want an original kids' sing-along cartoon about
  their own idea and can't afford 3D animation. The grown-up types the line; the kids watch and
  sing along.
- **Anyone who wants to see AI agents work together** (students, developers, judges): the
  making-of is a real multi-agent run, performed as a song.

## What it does

Type a line and press **Make it**.

1. **The crew writes it, singing.** Muse Code (Meta's agentic coding CLI) directs on Muse Spark:
   it plans an 11-beat story song, then starts Muse's Workflow with eight role subagents at once,
   each its own agent definition and played by a bot: Green writes the lyrics, White the chords,
   Gray the dance, Blue the lights, Gold the deals (time and budget), Yellow the hype, Pink the
   comedy, Black the plot's trouble (he pitches problems; Green or Gold decides which the story
   takes). They write through one tool that checks every line and keeps eight agents in song
   order. As they work, the bots sing it a cappella: what each is doing, the lines Green tries, a
   question to a crewmate and the answer with its reasons, sealed with a hand play. The loading bar
   is the show.
2. **The cast sings it.** Sixteen robot heads with floating hands perform the finished episode in
   Blender-built sets: the lead's verses, the pal's answers, choruses in harmony over a sung bass,
   hand plays and face acts on cue, a camera that follows the singer. Every voice is synthesized
   live in the browser from the lyrics: no recordings, no TTS, no server.

### Who decides what

| Part | Decided by | Where |
|---|---|---|
| The plan: title, hook, irony, 11 beats, the set and cast of each beat, checked facts | the director (Muse Code) | `beats.json`; `director/prompts/director.md` |
| Every sung line, the pal's replies, face-act cues (`{Gold:gasp}`) | Green (lyrics) | `events.ndjson`; `prompts/lyrics.md` |
| The chords (4 or 8 a section) | White (chords); the arranger adds the cadence | `prompts/chords.md`; `web/src/sing-plan.js` |
| Entrances, walks, marches, huddles, group dances | Gray (dance) | `prompts/dance.md` |
| Light moods and spotlights | Blue (lighting) | `prompts/lighting.md`; `web/src/blocking.js` |
| Handshakes, promises, high-fives, gags | Gold, Yellow, Pink | `prompts/deals.md`, `hype.md`, `comedy.md` |
| The plot's two troubles, and whether the story takes them | Black pitches; Green or Gold decides | `prompts/trouble.md`; `web/src/plot-trouble.js` |
| The making-of's words: each bot's thinking, its questions and answers | each agent | `summary` / `move` of every event |
| The melodies, the tempo (132-136 bpm, from the seed), the harmony and the sung backing | our engine, deterministic | `web/src/song/` |
| The voices: formant singing synthesis, pronunciation, stress on the beat | our engine (Magna Vocalization) | `web/src/mv/` |
| Heads, hands, the 20 hand plays' choreography, staying clear of each other | our engine | `web/src/acting.js`, `plays/`, `swarm.js` |
| Blocking through the sets, the camera's shots and moves | our engine | `web/src/blocking.js`, `staging.js`, `framing.js` |
| The ten sets | built ahead in Blender; the director picks one per beat | `scripts/blender/` |
| The rules and the gate (rhyme, syllables, present tense, kid-safe words, song form) | code | `scripts/director/emit.js`, `craft.js` |

## Why it should win

**Creativity.** The making-of is the main show: a real multi-agent run, performed as an a cappella
musical. Each bot sings its thinking in the team's "we", a consultation is a duet (ask, context,
question, an ack at once or "let me think on that", reasoning, answer, agreement, thanks) sealed
with a hand play, and a plot-trouble agent pitches problems the crew takes and solves by the
finale. Then the same work premieres as the cartoon it wrote. In an unofficial public tracker's
snapshot of 791 entries (Nov 1), none describes a sung cartoon or agents that sing their work: a
couple show coding agents on a graph or a map, a handful are about music, none sings.

**Technical ambition.**
- Eight Muse Code subagents at once in Muse's Workflow, coordinated through one tool: it validates
  every event (lyric rules, line limits, the song form and its rhymes, the action vocabulary),
  keeps the stream in song order while eight agents write, shows each agent the beat in progress
  and who is consulting it, and gates the bundle; craft checks fitted on Whisper data reject lines
  a listener would not catch.
- Real singing synthesis in the browser (glottal source, formant articulation, consonants timed
  onto the beat, vibrato, per-voice profiles), arranged into melody that follows the crew's chords,
  with harmony and a sung backing.
- A 3D stage: 16 procedural robots, 20 choreographed hand plays with real contact, blocking through
  ten Blender sets, collision avoidance, a spring-damped camera.
- Deterministic end to end: the same prompt gives the same episode, frame for frame; the demo video
  is the app's own output, captured frame-exact at 1080p30.

**Whether it works.** Fourteen episodes written by the crew, every one through the director's gate
(all eight roles, 14-16 consultations, two plot troubles sung and solved); 29 headless test suites
plus the protocol validator and the build in CI; staging checks on every episode (faces in sight,
no unintended head collisions, no z-fighting); sung-word intelligibility measured with Whisper on
every release; the cost and time of every episode recorded. Of the 791 tracked entries, about one
in four had a live link and fewer than one in ten a demo video; this submission comes with both.

## Proof: the numbers and where they come from

| Claim | Number | Source |
|---|---|---|
| AI cost per episode | $0.09-0.13, median $0.11 (Muse Spark 1.3 contributor tier, this account's default); $2.36-3.01 at the standard list price | `episodes/*/director.json` (`cost.usd`; the token counts at Muse's catalog prices) |
| Crew time per episode | 7.7-14.1 min, median 10.7 | `director.json` `wallSeconds` |
| Work per episode | a director + 8 agents, 171-208 model calls, 8.2-10.6 M input tokens (91-94% cached), 110-148 K output; 42 sung lines; 14-16 consultations; 30-49 tries refused by the tool and fixed | `director.json` |
| Episode length | about 4 minutes (the hackathon episode: 4:10 with its typed opening) | `docs/SUBMISSION.md` (Links) |
| Rendering and singing cost | nothing per play: it all runs in the viewer's browser (a static app, no keys, no backend) | `README.md` |
| 3D animation prices | from about $5,000 per finished minute; character work $15,000-30,000; premium $30,000-50,000+ | Vidico, B2W, Frame Sixty price guides (2026) |
| Animator pay (US median) | $49.06 an hour, $102,030 a year (May 2025) | US Bureau of Labor Statistics |
| Kids' sing-along scale | Cocomelon: 203 M subscribers, about 1.4 B views a month, the 3rd most-subscribed YouTube channel (Oct-Nov 2026) | Wikipedia |
| Sung words heard (Whisper large-v3) | v23: 77.2% of the premiere lead's, 68.3% of the making-of's (v19, Oct 31: 70.5% and 53.3%); per-line test, hackathon episode: 63.6% (v21 bundle 52.4%) | `eval/README.md`; `docs/SUBMISSION.md` |
| Staging | faces hidden 0.7-2.1% of the singing time from the front, 1.1-4.8% in the wide; no unintended head overlap in 14 of 14 episodes; no z-fighting in 11 sets | `eval/README.md` |
| Tests | 29 suites, the validator and the build, in CI | `web/test-*.mjs`, `.github/workflows/test.yml` |
| Late nights | by Nov 1, 11:42 am (UTC+8): 224 commits since Oct 28, 10:03 am; 33 of them between midnight and 6 am, on three nights (Oct 29: 7; Oct 31: 3; Nov 1: 23, from 1:48 to 5:52 am); 48 between 10 pm and 6 am | `git log --date=iso` |
| The crew at dawn | 12 of the 14 episodes re-directed by the crew between 5:07 and 6:36 am on Nov 1 | `director.json` `startedAt` (UTC) + 8 h |
| The field | 791 entries tracked (Nov 1): 61 with a demo video (7.7%), 190 with a live link (24.0%), 39 both (4.9%); most common: developer tools (18%), business and commerce (16%), health, civic and green tech (12%), vision and video (10%), games and creative media (8%), education (8%); 31% mention agents; none describes a sung cartoon or singing agents | an unofficial public tracker of the entries' repos (keyword search of its summaries: a floor) |

## Where it came from: the pivot

It started as a toddler-video idea: use AI to make Cocomelon-style sing-alongs cheaply. Building
the AI crew that would write them, the builder noticed that the crew's own work was a show too:
Green trying a line and the gate stamping it "no", White picking a chord and saying why, Black
pitching trouble. Watching agents work is usually a log scrolling by; these agents could sing it.
So the making-of and the cartoon became one package: first the crew sings how it makes your
episode, then the cast sings the episode. The singing engine (Magna Vocalization) and the robots,
their voices and hand plays (the Soothing Bots app, ported from Unity to the browser) come from
the author's earlier work; the AI crew, the making-of, the browser stage, the sets and the evals
were built during the hackathon, from the first commit on Oct 28, and one commit in seven was made
between midnight and six in the morning.

## FAQ: the questions a fellow builder asked

**What problem are you solving, and how did you come up with the idea?**
An original kids' sing-along cartoon costs thousands of dollars a minute to animate, so the people
with the best ideas for one (parents, teachers, small creators) can't make it. Musical Bots makes
one from a typed line for about ten cents of AI time. The idea began as AI toddler videos; while
building the crew of AI agents that writes them, I realized the crew's own work (the lyrics, the
chords, their back-and-forth) could be sung too, so the making-of and the cartoon became one
package.

**So it's a cartoon with animation. What would I, the user, use it for?**
For a short, original sing-along about your own idea: a tidy-up song, a story about sharing, a
birthday, the week's topic in class. You get a four-minute 3D episode with a story, characters and
a hook kids can sing back, in about ten minutes, and you can hear every choice the AI made while
it made it.

**Where is the AI: the characters that sing?**
The characters are our sixteen robots (designed, not generated). The AI is the crew: eight Muse
Code agents on Muse Spark write the story, every lyric, the chords, the moves, the lights, the gags
and the plot's twists, and consult each other. Our engine composes the melodies from those chords
and words, synthesizes the voices, and animates and films it, all in the browser. The crew's
process is sung out loud, so the why of each choice is part of the show.

**Who are your target users, and why would they use it, not just like it?**
Small kids' creators, parents and teachers who want original sing-alongs and can't afford
animation. Studio 3D starts at about $5,000 per finished minute (a four-minute song: about
$20,000); our crew writes one for about $0.11 (up to about $3 at Muse Spark's standard price), and
the rendering and singing are free in the viewer's browser. They'd use it because it is the only
way they get an original sing-along about their own topic at all, and because every AI choice is
visible and checked by rules, which matters when the audience is a child.

**So if I'm a kid and want something like that, I use your app to make it, songs and all?**
Close: a grown-up types the idea, with the kid beside them; the app writes the song and the
cartoon together (story, lyrics, chords, staging, voices, 3D), and the kid watches and sings along.
It is guided: every line must rhyme, fit the beat, stay in the present tense, and carry nothing
scary or mean and no brands; every story follows the same 11-part song form to a happy ending.

**Show me your live preview.**
The link is in `docs/SUBMISSION.md` (Links): any browser, a phone too, with the sound on. Try a curated
prompt such as "Blue brings home the biggest toy box on the street" and press Make it.

## Honest limits

- **Robots, not a studio.** Heads with floating hands and a synthesized voice: Whisper catches
  about two thirds to four fifths of the sung words (63.6-77.2%, by test), and names and short
  hooks are the hardest ("White" is heard as "why"). The claim is not "as good as a studio"; it is
  that an original sing-along about your own idea becomes affordable. In writing, compare to
  "Cocomelon-style" sing-alongs; never in the lyrics.
- **"About ten cents" is a tier.** It is Muse Spark 1.3's contributor tier (this account's default:
  discounted tokens, content may be used for product improvement). The same tokens at the standard
  list price cost $2.36-3.01 an episode: still pocket money against animation, but don't say "under
  a dollar" without the tier.
- **The live app and new prompts.** The public static app plays the 14 episodes the crew wrote,
  with their recorded making-of; a new line there is written on the spot by a seeded offline
  generator (no AI, no making-of). The crew writes a new line live with Muse Code (the dev server,
  or wherever the live director is set up).
- **Ten minutes, not instant;** one language (English), one key (C major), one song form, sixteen
  fixed characters and ten sets.
- **Guided means rules, not an editor.** You type one line; you can't change a lyric mid-run.
  Kid safety is the prompts' rules, word lists (brands, menace) and the gate, with no human review:
  a grown-up should watch a new episode first.
- **Built on earlier work.** The singing engine (copied in) and the robots, voices and hand plays
  (ported from the Soothing Bots app) come from the author's earlier projects.
- **The field numbers** come from an unofficial tracker and a keyword search of one-line
  summaries: a snapshot and a floor, not a census of every entry.

## Do we agree with the owner's answers?

Mostly, yes.

**Where they're right**
- **Cost is the right problem.** It's concrete, sourced and huge: studio 3D starts at about $5,000
  a minute, and an episode costs us about $0.11 of AI time.
- **The pivot is the best story we have.** Starting from toddler videos and noticing that the
  behind-the-scenes could be sung is honest, memorable, and exactly what the creativity criterion
  rewards.
- **Transparency is a real benefit, not a gimmick.** For kids' content, seeing and hearing every
  AI choice is what a parent wants, and no other tracked entry describes doing it.
- **"Guided" is true:** rules gate every line and every story follows one song form.

**What to sharpen**
- **Lead with the person, then the price.** "A parent, a teacher or a small creator with an idea
  for a sing-along" comes before "3D is expensive".
- **Say "kids' sing-along cartoons", not "toddler vids such as Cocomelon".** Naming the giant
  invites a quality comparison we lose. Keep "Cocomelon-style" as a reference in writing, and say
  plainly that the cast is robots with synthetic voices.
- **Give the cost with its tier.** "About ten cents of AI time (a few dollars at list price), and
  the rendering and singing are free in your browser", and give the other side a number too:
  "studio 3D starts at about $5,000 a finished minute, about $20,000 for a four-minute song".
- **Melodies are ours, not the AI's.** The crew writes the story, lyrics, chords and staging; our
  engine composes the melodies from them. Say so: it's also why every tune fits and sings.
- **The kid isn't the user; the grown-up is.** "A parent types it with their kid" is safer and
  more believable than "a kid generates it".
- **Join the two problems.** The making-of is how a grown-up can trust what the AI made, and it's
  what makes us different: say it in the same breath as the cost.
- **Answer "what would I use it for" with uses** (a tidy-up song, a sharing story, the week's
  topic in class), not with the product's features.
- **Have the link ready** (sound on, a curated prompt; it works on a phone too), and know that a new prompt in the
  static app comes from the offline generator, not the crew.

## Sources

- Vidico, "How much does animation cost?" (Sep 18, 2026): 3D $5,000-50,000+ per minute (basic
  $5,000-15,000, standard $15,000-30,000, premium $30,000-50,000+).
  https://vidico.com/news/how-much-does-animation-cost/
- B2W (Broadcast2World), "How Much Does Animation Cost in 2025? 2D & 3D Animation Prices Explained"
  (Aug 14, 2026): 3D from about $5,000 a minute (freelancers), $6,000-15,000+ a minute (agencies).
  https://b2w.tv/blog/how-much-does-animation-cost
- Frame Sixty, "How Much Does 3D Animation Cost? Per-Minute Pricing by Tier and Project Type"
  (Sep 10, 2026): $5,000-8,000 a finished minute (entry), $15,000-30,000 (character/VFX),
  $30,000-50,000+ (cinematic/broadcast). https://framesixty.com/how-much-does-3d-animation-cost/
- US Bureau of Labor Statistics, Occupational Outlook Handbook, "Special Effects Artists and
  Animators": median pay $102,030 a year, $49.06 an hour (May 2025).
  https://www.bls.gov/ooh/arts-and-design/multimedia-artists-and-animators.htm
- Wikipedia, "Cocomelon": 203 million subscribers and 1.4 billion monthly views as of October 2026;
  "List of most-subscribed YouTube channels" (November 2026): 3rd, 203 million.
  https://en.wikipedia.org/wiki/Cocomelon,
  https://en.wikipedia.org/wiki/List_of_most-subscribed_YouTube_channels
- The studio guides are published by studios selling animation, so read them as asking prices;
  they agree on the floor (about $5,000 a finished minute for 3D) and differ above it.
- The event: https://dev.meta.ai/events/global-hackathon (dates, tracks, judging criteria).
- The field: an unofficial public tracker of the entries' GitHub repos, snapshot of Nov 1, 2026
  (791 entries; kept out of this repo).
