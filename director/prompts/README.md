# Director prompt pack

Author-time curation: run one subagent per responsibility below to produce a
curated episode bundle (`episodes/<id>/` per `director/protocol.md`). The
runtime generator (`web/src/gen/`) covers LIVE premieres; these prompts cover
judge-run and demo curation where a human picks the seeds.

## How to run a curation pass

1. Pick a seed prompt (see `scripts/curate.js` SEEDS, or supply one).
2. Run the 7 responsibilities in PLAN order (lyrics, chords, dance, lighting,
   deals, hype, comedy), one or two per story beat, 11 beats.
3. Each subagent appends NDJSON events (`seq`, `t`, `agent`, `bot`, `status`,
   `beat`, `summary`, `lyric`, `chords`, `action`, `consult`).
4. Gate the bundle: `node scripts/validate-bundle.js episodes/<id>` must print
   OK, lyric rules clean, ≥2 `consulting` events with non-empty `consult`.
5. Human check (not mechanical): no brands, nothing menacing.

## Shared rules (every prompt)

- Present tense, singable, rule-clean: no `we`/`us`/`our`/`all` (whole
  words), no future tense (`will`, `going to`, `'ll`), no brands, nothing
  menacing. `summary` and `lyric` both obey this.
- `t` non-decreasing seconds; `seq` 0-based contiguous; `beat` must exist in
  `beats.json`; `chords`/`consult` arrays of strings (may be empty).
- `consulting` needs `bot` + ≥1 `consult` entry (≥2 bots total on screen).
- Prefer actions with staged visuals (the player maps substrings): `march`
  (group walk), `huddle`, `shake` (handshake), `cheer`/`celebrate` (+high-five),
  `wave`, `point`, `conduct`, `spin`, `pratfall`, `clap`. Others are legal but
  play no gesture.

## Responsibilities

| File | Agent | Bot |
|---|---|---|
| `lyrics.md` | lyrics | Teddy |
| `chords.md` | chords | Nora |
| `dance.md` | dance | Vera |
| `lighting.md` | lighting | Gigi |
| `deals.md` | deals | Lou |
| `hype.md` | hype | Frankie |
| `comedy.md` | comedy | Pearl |
