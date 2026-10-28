# Musical Bots — Build Plan

Non-VR, open-source, static Three.js web app: user types a cartoon episode
prompt, the 16-bot choir performs it as a sung 3D episode, including a
"making-of" performance driven by the HANDOFF §3 JSON event protocol.
Target: Meta Global AI Hackathon, submissions due **Nov 4, 9:00 PM ET**,
repo flipped public ~Nov 2 (re-check dates before flipping).

Source spec: `/Users/arke/Projects/unity/magna-vocalization/HANDOFF.md`.
Music/lyric engine spec (read, don't copy): `../magna-vocalization` package
`com.clrke.magna.core`, upstream repo at
`/Users/arke/Projects/unity/magna-core` (contains `Magna.Core`,
`Magna.Core.Tests`, dotnet-buildable). Never edit the embedded copy.

## Architecture

One event protocol, two producers, one player. The §3 JSON event
(`agent, bot, status, beat, summary, lyric, chords, action, consult`) is the
contract. `web/` plays timestamped NDJSON event bundles on a transport clock:

- LIVE: polls for newly appended events during generation (the "making-of").
- REPLAY: deterministic playback of a captured bundle (premiere, judge runs,
  shareable episode artifact).

Producers: (1) runtime deterministic generator (seeded PRNG from the prompt,
JS modules mirroring the 7 subagent responsibilities — works offline, zero
API keys); (2) author-time `director/` (real Muse Code subagents + scripts
producing curated bundles and content libraries).

## Key decisions

- Static client built with Vite; `dist/` static deploy.
- Raw Web Audio, no audio framework: lookahead chord scheduler + melody-
  following formant-ish oscillator voices per bot voice class; words as lyric
  captions on dark plates. Full C# formant port out of scope.
- Music content ports data, not code: 11-section form order and
  `FORM_CHORDS` sets from `StoryForm.cs`; episode lyrics newly composed per
  prompt under the lyric rules (no we/us/our/all, no future tense, no
  brands, nothing menacing).
- Bot rigs procedural in code (heads per CHARACTERS looks-by-household;
  cf. `Assets/Magna/Heads/`); animations procedural keyframes. No Blender
  rigging. Social vocabulary from `ChoirPlay.cs`/`ChoirSocial.cs`, extended
  to handshake/high-five/huddle/walk.
- Fonts: Nunito with OFL notice. No CMUdict reuse. License: MIT.
- Subagent→bot mapping: dance→Vera, lyrics→Teddy, chords→Nora,
  lighting→Gigi, deals→Lou, hype→Frankie, comedy→Pearl.

## Build order (vertical slices)

Build in vertical slices that each end in a playable, testable demo:

0. **Scaffold + repo (Oct 28).** Upgrade Node (env has v18; Vite needs
   20.19+). `git init`, MIT LICENSE, README, `.gitignore`; Vite + Three.js
   scaffold (`web/`); `director/`, `environments/`, `bots/`, `episodes/`;
   private GitHub repo; event-protocol schema + sample bundle.
1. **Player + shell (Oct 28–29).** Transport clock, NDJSON LIVE/Replay
   player, caption strip, prompt UI, one placeholder rig (idle + walk),
   staged camera, band scheduler. First playable: hand-written bundle.
2. **Runtime generator (Oct 29–30).** Seeded prompt→beats (CHARACTERS story
   recipe), lyric composer, chord/melody assigner, 7 responsibility modules
   emitting §3 events. Lyric-rule checker (`node` script) + golden
   seed→bundle tests.
3. **Voices + premiere (Oct 30).** Voice synth, consultation staging,
   premiere mode, demo capture script.
4. **Environments + cast (Oct 30–Nov 1).** Blender skill, headless: diner,
   big house, street minimum → `.blend` + `.glb` with lighting passes;
   all 16 rigs; group walk, handshake, high-five, huddle, celebration.
5. **Director + content (Nov 1–2).** Subagent prompt pack; curated bundles
   from the 12 story seeds; ≥2 consultations/episode; README + demo docs;
   repo hygiene; ~Nov 2 flip public.
6. **Submit (Nov 3–4).** Demo video, final README, submit. Nov 4 is buffer.

Cut list (in order): shareable links, >3 environments, full lyric-data
port, second demo episode.

## Testing: dye test per slice

Each slice's demo gets a temporary dye test before merge:

1. Pick the dye: a distinctive marker proving the new path ran (e.g. an
   event with `"dye": true`, a tinted caption, a log line).
2. Run it through the real path (player, generator, synth — not a mock).
3. Assert the dye is visible in the output, then remove the dye.

Plus: golden determinism test (fixed seed → byte-identical bundle);
lyric checker on every bundle; `npm run build` + static-serve parity each
phase. Highest-risk gate: Phase 1 end-to-end loop by Oct 29.

## Pointers

- `../magna-vocalization/README.md`, `docs/CHARACTERS.md` (canon),
  `docs/STACK.md` (behavior specs only, do NOT copy the Quest stack).
- `Packages/com.clrke.magna.core/{Model,Music}/` — form/theory/melody spec.
- `Assets/Magna/Scripts/App/ChoirPlay.cs`, `ChoirSocial.cs` — social spec.
- `tools/third-party-notices-app.md` — reuse with attribution as needed.
