// Shared vocabulary and data shapes for Magna Vocalization. Every module codes
// against these IDs and shapes (see ARCHITECTURE.md). Change them only together
// with every user.

export const SCHEMA_VERSION = 2; // 2: fixed song form, slot on/off, personalities, mechanical faces, no Sprite voice
export const ROBOT_COUNT = 16;
export const BARS_PER_BLOCK = 8;
export const BEATS_PER_BAR = 4;
export const SAMPLE_RATE = 24000; // mumble-speech renders 24 kHz mono

/** mumble-speech voice profiles (base f0 in Hz, used to pick a comfortable octave). */
export const VOICES = {
  guard: { label: 'Guard', f0: 92, low: 40, high: 64 }, // MIDI range the voice sings well
  pirate: { label: 'Pirate', f0: 100, low: 41, high: 65 },
  coach: { label: 'Coach', f0: 128, low: 45, high: 69 },
  old: { label: 'Elder', f0: 135, low: 46, high: 69 },
  woman: { label: 'Alto', f0: 205, low: 53, high: 77 },
  // the Unity VR app's added voices (Magna.Core/Model/Schema.cs)
  basso: { label: 'Basso', f0: 78, low: 36, high: 60 },
  robo: { label: 'Robo', f0: 110, low: 43, high: 67 },
  crooner: { label: 'Crooner', f0: 118, low: 43, high: 67 },
  tenor: { label: 'Tenor', f0: 155, low: 48, high: 72 },
  soprano: { label: 'Soprano', f0: 255, low: 57, high: 81 },
};
/** Voices removed in later versions -> what their robots sing with now (migrations). */
export const RETIRED_VOICES = { child: 'woman' };

/**
 * The song form is fixed (v2): five sections, one block each, in this order in project.blocks,
 * played as six song slots (the chorus twice). Each slot can be switched on or off; the song
 * loops over the slots that are on. No adding, deleting, renaming or moving blocks.
 */
export const SECTIONS = ['intro', 'verse', 'chorus', 'bridge', 'outro'];
export const SECTION_LABELS = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', outro: 'Outro' };
export const SONG_FORM = ['intro', 'verse', 'chorus', 'bridge', 'chorus', 'outro']; // slot -> section
export const SLOT_COUNT = SONG_FORM.length;

/** Which chord tone a robot anchors on. 'lead' follows the melody contour freely in the scale. */
export const PITCH_ROLES = ['lead', 'root', 'third', 'fifth', 'seventh', 'octave', 'bass'];
export const OCTAVE_RANGE = [-2, 2]; // octave shift on top of the voice's comfortable centre

export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** 8-bar chord progressions (roman numerals relative to the project key; lower case = minor). */
export const PROGRESSIONS = {
  pop: { label: 'Pop', chords: ['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV'] },
  doowop: { label: 'Doo-wop', chords: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'IV', 'V'] },
  canon: { label: 'Canon', chords: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
  ballad: { label: 'Ballad', chords: ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'I', 'V'] },
  lullaby: { label: 'Lullaby', chords: ['I', 'IV', 'V', 'I', 'I', 'IV', 'V', 'I'] },
  gospel: { label: 'Gospel', chords: ['I', 'IV', 'I', 'V', 'I', 'IV', 'V', 'I'] },
  jazzy: { label: 'Jazzy', chords: ['ii', 'V', 'I', 'vi', 'ii', 'V', 'I', 'I'] },
  royal: { label: 'Royal road', chords: ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'I', 'I'] },
  dreamy: { label: 'Dreamy', chords: ['I', 'iii', 'IV', 'iv', 'I', 'iii', 'IV', 'iv'] },
  minor: { label: 'Minor', chords: ['vi', 'IV', 'V', 'iii', 'vi', 'IV', 'V', 'V'] },
};

/** Melody presets: rhythm + contour templates that adapt to a line's syllable count. */
export const MELODIES = {
  steady: { label: 'Steady', hint: 'one syllable per beat' },
  lilting: { label: 'Lilting', hint: 'long-short swing' },
  rising: { label: 'Rising', hint: 'climbs through the chord' },
  falling: { label: 'Falling', hint: 'steps down to rest' },
  call: { label: 'Call', hint: 'sings the first half of each bar' },
  answer: { label: 'Answer', hint: 'sings the second half of each bar' },
  sustain: { label: 'Sustain', hint: 'long held notes, a pad' },
  syncopated: { label: 'Syncopated', hint: 'off-beat accents' },
  arpeggio: { label: 'Arpeggio', hint: 'quick chord climbs' },
  bassline: { label: 'Bass line', hint: 'roots on 1 and 3 with walks' },
};

/** Preset lines (custom text is also allowed). */
export const DIALOGS = [
  'I believe in you!',
  'You can do it!',
  'Relax and unwind',
  'Leave your worries behind',
  'Let the hours fly by',
  'Breathe in, breathe out',
  'One step at a time',
  'You are doing great',
  'Take it slow today',
  'Shine on, shine on',
  'We are here for you',
  'Every little thing',
  'Rest your weary mind',
  'Hold on, hold on',
  'Doo wop, doo wah',
  'Ooh, ooh, ooh',
  'Ah, ah, ah, ah',
  'Bom, bom, bom, bom',
  'La la la la la',
  'Mm, mm, mm',
];

/**
 * Appearance vocabulary (v2: realistic mechanical, hyper-expressive heads, see src/scene).
 * faceShape = the head shell, eyeShape = the eye mechanism (every eye has a mechanical iris
 * pupil and shutter lids), browShape = the mechanical eyebrows, mouthShape = the mechanical
 * mouth, finish = the shell's material (faceColor tints it).
 */
export const FACE_SHAPES = ['dome', 'box', 'capsule', 'bucket', 'egg', 'hex', 'tv', 'bullet'];
export const EYE_SHAPES = ['lens', 'goggle', 'bulb', 'telescope', 'monocle', 'visor'];
export const BROW_SHAPES = ['bar', 'blade', 'comb', 'piston', 'segmented'];
export const MOUTH_SHAPES = ['jaw', 'lips', 'shutter', 'grille', 'iris'];
export const ANTENNAS = ['none', 'single', 'double', 'coil', 'dish'];
export const FINISHES = ['painted', 'chrome', 'brushed', 'gunmetal', 'brass', 'enamel'];
export const FLOAT_STYLES = ['bob', 'sway', 'drift', 'still'];
export const PALETTE = [
  '#e8edf5', '#9aa7bb', '#4f8cff', '#7fb2ff', '#2fa36b', '#7be07b', '#ffd166', '#ff9f43',
  '#ff6b6b', '#e05297', '#8a6bff', '#4fc3ff', '#3a4456', '#1c2230', '#c9a227', '#b87333',
];

/** Particle presets ported from Squatopia 2's own effects (see src/scene/particles). */
export const PARTICLE_PRESETS = [
  'none', 'burn', 'frostbite', 'chill', 'charm', 'paralyze', 'froth', 'fragile', 'slow', 'blind', 'embers', 'glow',
];

/**
 * Personalities (randomised with the robot): how a head emotes at rest, while singing and when
 * you pick it (src/scene/personality.js turns these ids into expressions and timing).
 */
export const PERSONALITIES = {
  cheerful: { label: 'Cheerful', blurb: 'Beams at everyone, eyebrows up' },
  grumpy: { label: 'Grumpy', blurb: 'Furrowed brow, sings anyway' },
  shy: { label: 'Shy', blurb: 'Glances away, blushes when picked' },
  dramatic: { label: 'Dramatic', blurb: 'Every note is the finale' },
  sleepy: { label: 'Sleepy', blurb: 'Heavy lids, slow blinks, big yawns' },
  cheeky: { label: 'Cheeky', blurb: 'Smirks and winks' },
  proud: { label: 'Proud', blurb: 'Chin up, half-closed eyes' },
  nervous: { label: 'Nervous', blurb: 'Darting eyes, twitchy brows' },
  dreamy: { label: 'Dreamy', blurb: 'Gazes upward, soft smile' },
  zany: { label: 'Zany', blurb: 'Mismatched brows, wild pupils' },
};
export const PERSONALITY_IDS = Object.keys(PERSONALITIES);

/**
 * @typedef {Object} Appearance
 * @property {string} faceShape   one of FACE_SHAPES (head shell)
 * @property {string} eyeShape    one of EYE_SHAPES (eye mechanism)
 * @property {string} browShape   one of BROW_SHAPES (mechanical eyebrows)
 * @property {string} mouthShape  one of MOUTH_SHAPES (mechanical mouth)
 * @property {string} antenna     one of ANTENNAS
 * @property {string} finish      one of FINISHES (shell material)
 * @property {string} faceColor   '#rrggbb'
 * @property {string} eyeColor    '#rrggbb'
 * @property {string} accentColor '#rrggbb'
 * @property {number} scale       0.8..1.25
 * @property {string} floatStyle  one of FLOAT_STYLES
 *
 * @typedef {Object} Particles
 * @property {string} preset  one of PARTICLE_PRESETS
 * @property {string|null} color '#rrggbb' tint override, or null for the preset's colours
 * @property {number} rate    0..2 (x preset emission)
 * @property {number} size    0.5..2
 * @property {number} speed   0.5..2
 *
 * @typedef {Object} Robot                    project-wide identity of one head
 * @property {string} id
 * @property {string} name
 * @property {string} voice                   key of VOICES
 * @property {string} personality             key of PERSONALITIES
 * @property {{rate:number, depth:number}} vibrato  Hz 4..7, cents 0..60
 * @property {number} volume                  0..1
 * @property {boolean} mute
 * @property {boolean} solo
 * @property {number} seed                    voice take (deterministic)
 * @property {Appearance} appearance
 * @property {Particles} particles
 *
 * @typedef {Object} Part                     what one robot sings in one block
 * @property {{preset:number|null, text:string}} dialog  preset index into DIALOGS, or null for custom text
 * @property {string} melody                  key of MELODIES
 * @property {{role:string, octave:number}} pitch  role from PITCH_ROLES, octave in OCTAVE_RANGE
 * @property {boolean[]} bars                 length BARS_PER_BLOCK; false = silent (cuts a line off)
 * @property {string|null} syllables          optional manual hyphenation, e.g. "be-lieve in you"
 *
 * @typedef {Object} Block
 * @property {string} id
 * @property {string} section                 one of SECTIONS (v2: blocks[k].section === SECTIONS[k])
 * @property {string} name                    SECTION_LABELS[section] (not editable in v2)
 * @property {{preset:string|null, chords:string[]}} progression  chords length BARS_PER_BLOCK
 * @property {Part[]} parts                   length ROBOT_COUNT, index = robot index
 *
 * @typedef {Object} Project
 * @property {number} version                 SCHEMA_VERSION
 * @property {string} id
 * @property {string} name
 * @property {number} created                 epoch ms
 * @property {number} updated
 * @property {string} key                     one of KEYS (major key; minor feel via progressions)
 * @property {number} tempo                   BPM 60..160
 * @property {Robot[]} robots                 length ROBOT_COUNT
 * @property {Block[]} blocks                 v2: exactly SECTIONS.length, in SECTIONS order
 * @property {string[]} song                  v2: fixed, SONG_FORM mapped to block ids (length SLOT_COUNT)
 * @property {boolean[]} songEnabled          v2: length SLOT_COUNT, slot on/off; at least one on
 */
