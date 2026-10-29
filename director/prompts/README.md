# Director prompt pack

The prompts of the Muse Code director and its crew (see `director/README.md`). `scripts/director/
direct.js` renders them at run time: `{{...}}` placeholders take the emit command, the premise, the
11 sections (`web/src/gen/form.js`), the sets, the cast (`cast.md`), the example song
(`example.md`), each role's action menu (`web/src/actions.js`: the choreographed hand plays, the
gestures, the face acts, the moves, the light cues), the cue acts (`web/src/cues.js`), the song
form's progressions (`web/src/song/form.js`) and the line limits (`web/src/gen/lyrics.js`).

| File | Who |
|---|---|
| `director.md` | the director: plans `beats.json`, launches the crew, checks the gate |
| `rules.md` | every crew member: the emit command, the fields, the text rules, consultations |
| `lyrics.md` | Teddy (lyrics) |
| `chords.md` | Nora (chords) |
| `dance.md` | Vera (dance) |
| `lighting.md` | Gigi (lighting) |
| `deals.md` | Lou (deals) |
| `hype.md` | Frankie (hype) |
| `comedy.md` | Pearl (comedy) |
| `cast.md` | the cast bible (from Soothing Bots' docs/CHARACTERS.md) |
| `example.md` | a finished story song (Soothing Bots' "Just a Box"), rule-clean under the gates |

`npm run direct -- "<prompt>" --dry-run --live --out /tmp/x` writes the rendered prompts and the agent
overlay to `/tmp/x/.director/` without running anything.
