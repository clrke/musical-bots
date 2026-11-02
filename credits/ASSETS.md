# Imported assets and their provenance

Everything in this repo's sets is either built by our own Blender scripts (`scripts/blender/*.py`) or imported from
**Squatopia 2**, the owner's own Unity game (`~/Projects/unity/Squatopia 2`, private repo, 944 of 946 commits by
Clarke Benedict Plumo). The imported files below were made by that project's own scripts, not bought or downloaded,
so they ship here under this repo's MIT licence. Squatopia 2's `LICENSES.md` lists them under "Everything else: ...
piers, boats, island terrain, skies ... Made by the owner in Blender and scripts (`tools/blender/`)".

Nothing from a Unity Asset Store pack, a Unity template or an unknown source is in this repo (see "Excluded").

## Sky panoramas (`environments/skies/*.jpg`)

These are painted by Squatopia 2's own sky painter: `Assets/Editor/Island/SkyPainter.cs`, with recipes in
`Assets/Squatopia/Scripts/World/IslandSkies.cs` and noise from `Scripts/World/Noise.cs`. Each is an
equirectangular panorama with a gradient, fBm clouds, stars, a sun or moon, and haze below the horizon. Squatopia
commits: `0a0ad0eb` (2026-10-04, StylizedSky), `d118ca47` and `9d072f50` (2026-10-07, Sky_NN), `aa2332bb` (2026-10-07, no
mountains). Our copies were converted to 2048x1024 JPEG (quality 82) with `sips`.

| File | Source in Squatopia 2 | Recipe |
|---|---|---|
| `village.jpg` | `Assets/Squatopia/Textures/Sky/StylizedSky.png` (4096x2048, downscaled) | 0, "Clear Day", seed 4242 |
| `winter.jpg` | `Assets/Squatopia/Resources/Skies/Sky_15.png` | "Arctic Dawn" |
| `haunted.jpg` | `Assets/Squatopia/Resources/Skies/Sky_23.png` | "Midnight Moon" |
| `beach.jpg` | `Assets/Squatopia/Resources/Skies/Sky_13.png` | "Tropical Teal" |
| `pool.jpg` | `Assets/Squatopia/Resources/Skies/Sky_21.png` | "Azure Noon" |
| `pier.jpg` | `Assets/Squatopia/Resources/Skies/Sky_01.png` | "Golden Hour" |
| `ocean.jpg` | `Assets/Squatopia/Resources/Skies/Sky_28.png` | "Mint Morning" |

## Props (`scripts/blender/props/squatopia/*.fbx`)

These are low-poly props with vertex colours and no textures, exported from Blender 5.2.2 by Squatopia 2's prop
generators in `tools/blender/props/`. Their last Squatopia commits are `153e08ab` (2026-10-08), plus `1b246d77` for the
trees and `b0f546db` for the rocks (2026-10-09). Our set scripts import them with `set_kit.prop()`. If two faces of a
prop overlap in one plane, `set_kit.separate_coplanar()` pushes the smaller one 4 mm out at import, so they don't
flicker. The original files are left unchanged.

| Generator (`tools/blender/props/`) | Files |
|---|---|
| `village.py` | Cottage |
| `landmarks.py` | Windmill, Windmill_Sails, Lighthouse |
| `trees.py` | TreeRound_A_LOD1, TreeRound_B_LOD1 |
| `plants.py` | Bush_A_LOD1, Flowers_A |
| `rocks.py` | Rock_A_LOD1, Rock_B_LOD1, Rock_C_LOD1 |
| `desert.py` | PalmTree_LOD1 |
| `coast.py` | Pier, SailBoat, Seagull |
| `boats.py` | Boat_Meadow_1, Boat_Meadow_3, Boat_Meadow_4 |
| `haunted.py` | HauntedChapel, Gravestone_A/B/C, DeadTree_A_LOD1, DeadTree_B_LOD1, SpookyTree_LOD1, IronFence, LanternPost |
| `poi_haunted.py` | Haunted_Cauldron, Haunted_JackOLantern, Haunted_Pumpkins |
| `poi_meadow.py` | Meadow_Stall_A, Meadow_Bunting, Meadow_FlowerBed, Meadow_Bench, Meadow_Barrel, Meadow_Crate |
| `poi_alpine.py` | Alpine_Chalet, Alpine_SnowPine_A/B, Alpine_FrozenPond, Alpine_Sledge, Alpine_Woodpile, Alpine_SnowRock_A/B, Alpine_LanternPole, Alpine_SnowDrift |
| `poi_shipwreckbay.py` | ShipwreckBay_Crates, ShipwreckBay_Barrels, ShipwreckBay_RopeCoil |

## Effect textures (`web/public/fx/*.png`)

Six particle textures (beam, burst, capsule, flamewisps, noisyglow, spark), byte-identical to the owner's
Squatopia 2 textures, which its own scripts draw from maths and seeded noise with no source images
(`tools/make_combat_vfx_textures.py` and `tools/make_element_vfx_textures.py` in that project). They
came here with the Soothing Bots head port. The owner's own work.

## Excluded (not copied, never to be copied)

| What (in Squatopia 2) | Why |
|---|---|
| `Assets/ThirdPartyAssetPacks/Nhance Studios/*` (creatures, dragons, NPCs) | Unity Asset Store, Standard EULA: no redistribution of the raw assets. It also has no skies or backdrops. |
| `Assets/VRMPAssets/Textures/SkyboxTextures/skybox01_openGL.png` and the rest of `Assets/VRMPAssets/` | From the Unity VR Multiplayer template, under the Unity Companion License (use with the Unity engine only), and the original image source is unknown |
| `Assets/VRMPAssets/Audio/MXClips/` | CC-BY music from the template: not visual, not needed |
| Dragonsan Studios skill icons, the `perk_*` buff icons | Asset Store / source not recorded |
| `Assets/Squatopia/Models/CharactersMH/` (MakeHuman CC0) | Allowed, but these are characters, not backdrops: not needed |
| `Art/Store/preview360/*` (in-game 360° render of island 1) | The owner's own work, but it bakes in the game's island. It doesn't fit a set backdrop, so we left it out. |

No Poly Haven, ambientCG, Kenney, Quaternius, Sketchfab or BlenderKit files are in either repo.

## Third-party code and data

| What | Where | Licence |
|---|---|---|
| The CMU Pronouncing Dictionary (trimmed tables built from cmusphinx/cmudict) | `web/src/mv/voice/text/cmudictData.js`, `scripts/director/knownWords.js` | BSD-style, Carnegie Mellon University; the notice is kept at the top of both files |
| compromise (natural-language parsing, vendored) | `web/src/vendor/compromise-two.mjs` | MIT, Spencer Kelly; the licence is kept in `web/src/vendor/compromise.LICENSE` |
| three.js | npm dependency (`web/package.json`), bundled into the build | MIT |
| Vite | npm dev dependency (build only) | MIT |
