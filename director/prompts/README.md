# Director prompt pack

The prompts of the Muse Code director and its crew (see `director/README.md`). `scripts/director/
direct.js` renders them at run time: `{{...}}` placeholders take the emit command, the premise, the
11 sections (`web/src/gen/form.js`), the sets, the cast (`cast.md`), the example song
(`example.md`), each role's action menu (`web/src/actions.js`: the choreographed hand plays, the
gestures, the face acts, the moves, the light cues), the cue acts (`web/src/cues.js`), the song
form's progressions (`web/src/song/form.js`), the line limits (`web/src/gen/lyrics.js`), the sung
thought's limit (`emit.js` `MAX_SUMMARY_SYLLABLES`) and the craft checks with their bypass limits
(`scripts/director/craft.js`). Every `"summary": "..."` example here, and every quoted example in a
role's `summary` bullet, must pass the tool's own "talk" and dictionary checks (`web/test-director.mjs`
reads them): a summary is what the bot says to a crewmate as it works, never to the audience. The
crew learns from them, and the tool refuses a verbatim copy (emit.js `borrowedSummaries`), so keep
them varied and about the hot-soup story, not the premise at hand.

| File | Who |
|---|---|
| `director.md` | the director: plans `beats.json`, launches the crew, checks the gate |
| `rules.md` | every crew member: the emit command, the fields, the text rules, consultations |
| `lyrics.md` | Green (lyrics) |
| `chords.md` | White (chords) |
| `dance.md` | Gray (dance) |
| `lighting.md` | Blue (lighting) |
| `deals.md` | Gold (deals) |
| `hype.md` | Yellow (hype) |
| `comedy.md` | Pink (comedy) |
| `cast.md` | the cast bible (from Soothing Bots' docs/CHARACTERS.md) |
| `example.md` | a finished story song (Soothing Bots' "Just a Box"), rule-clean under the gates |

`npm run direct -- "<prompt>" --dry-run --live --out /tmp/x` writes the rendered prompts and the agent
overlay to `/tmp/x/.director/` without running anything.
