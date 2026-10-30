// The fixed cast of 16 (transcribed from CastData.cs in magna-vocalization-core:
// id, name, personality face, look, sparkles, panel label/role/catchphrase).
// Voices live in gen/cast.js (the audio engine's ids); this file is the looks. Each bot is called
// by its face colour (`name`: Green, White...) so the audience can tell them apart; `id` keeps its first name.
export const CAST16 = [
  { id: 'murphy', name: 'Silver', personality: 'nervous', label: 'Unlucky', role: 'Delivery driver', catchphrase: 'Just my luck.',
    look: { faceShape: 'box', eyeShape: 'goggle', browShape: 'segmented', mouthShape: 'grille', antenna: 'none', finish: 'brushed', faceColor: '#9aa7bb', eyeColor: '#ffd166', accentColor: '#4f8cff', scale: 1.2, floatStyle: 'bob' },
    fx: { preset: 'rain', color: null, rate: 0.8, size: 1.0, speed: 0.7 } },
  { id: 'sterling', name: 'Purple', personality: 'romantic', label: 'Showman', role: 'Food-truck chef', catchphrase: 'Ta-da!',
    look: { faceShape: 'hex', eyeShape: 'lens', browShape: 'blade', mouthShape: 'lips', antenna: 'dish', finish: 'chrome', faceColor: '#8a6bff', eyeColor: '#e8edf5', accentColor: '#ff9f43', scale: 1.1, floatStyle: 'sway' },
    fx: { preset: 'sparks', color: null, rate: 1.0, size: 1.0, speed: 1.0 } },
  { id: 'dan', name: 'Orange', personality: 'gentle', label: 'Sporty', role: 'Dad, the PE teacher', catchphrase: 'One more lap!',
    look: { faceShape: 'dome', eyeShape: 'visor', browShape: 'bar', mouthShape: 'jaw', antenna: 'none', finish: 'painted', faceColor: '#ff9f43', eyeColor: '#e8edf5', accentColor: '#e8edf5', scale: 1.1, floatStyle: 'bob' },
    fx: { preset: 'embers', color: null, rate: 0.8, size: 1.0, speed: 1.1 } },
  { id: 'vera', name: 'Gray', personality: 'wise', label: 'Careful', role: 'Auntie, the trader', catchphrase: "What's the risk?",
    look: { faceShape: 'capsule', eyeShape: 'monocle', browShape: 'bar', mouthShape: 'shutter', antenna: 'none', finish: 'gunmetal', faceColor: '#3a4456', eyeColor: '#7be07b', accentColor: '#2fa36b', scale: 1.0, floatStyle: 'still' },
    fx: { preset: 'notes', color: '#7be07b', rate: 0.6, size: 1.0, speed: 0.7 } },
  { id: 'nora', name: 'White', personality: 'stoic', label: 'Calm', role: 'Mum, the doctor', catchphrase: 'Let me take a look.',
    look: { faceShape: 'dome', eyeShape: 'lens', browShape: 'bar', mouthShape: 'iris', antenna: 'none', finish: 'enamel', faceColor: '#e8edf5', eyeColor: '#4f8cff', accentColor: '#ff6b6b', scale: 1.05, floatStyle: 'bob' },
    fx: { preset: 'glow', color: '#ff6b6b', rate: 0.8, size: 1.1, speed: 0.8 } },
  { id: 'pearl', name: 'Pink', personality: 'goofy', label: 'Funny', role: 'Grandma, front of house', catchphrase: 'Of course, darling!',
    look: { faceShape: 'bucket', eyeShape: 'bulb', browShape: 'comb', mouthShape: 'lips', antenna: 'single', finish: 'enamel', faceColor: '#e05297', eyeColor: '#ffd166', accentColor: '#e8edf5', scale: 1.0, floatStyle: 'sway' },
    fx: { preset: 'petals', color: null, rate: 0.9, size: 1.0, speed: 0.9 } },
  { id: 'gigi', name: 'Blue', personality: 'giddy', label: 'Playful', role: 'Auntie, the toy designer', catchphrase: 'Who wants a surprise?',
    look: { faceShape: 'capsule', eyeShape: 'goggle', browShape: 'comb', mouthShape: 'lips', antenna: 'coil', finish: 'chrome', faceColor: '#4fc3ff', eyeColor: '#ffd166', accentColor: '#e05297', scale: 1.0, floatStyle: 'bob' },
    fx: { preset: 'stardust', color: null, rate: 1.2, size: 1.0, speed: 1.2 } },
  { id: 'teddy', name: 'Green', personality: 'curious', label: 'Curious', role: 'Almost four, knows every dinosaur', catchphrase: 'Actually...',
    look: { faceShape: 'dome', eyeShape: 'bulb', browShape: 'comb', mouthShape: 'lips', antenna: 'dish', finish: 'painted', faceColor: '#7be07b', eyeColor: '#4f8cff', accentColor: '#ff9f43', scale: 0.85, floatStyle: 'bob' },
    fx: { preset: 'fireflies', color: null, rate: 1.0, size: 0.9, speed: 1.0 } },
  { id: 'hattie', name: 'Jade', personality: 'zany', label: 'Daring', role: "Green's best friend", catchphrase: 'Hold my juice!',
    look: { faceShape: 'tv', eyeShape: 'goggle', browShape: 'piston', mouthShape: 'jaw', antenna: 'coil', finish: 'enamel', faceColor: '#2fa36b', eyeColor: '#ffd166', accentColor: '#7be07b', scale: 0.85, floatStyle: 'bob' },
    fx: { preset: 'bubbles', color: null, rate: 1.2, size: 0.9, speed: 1.3 } },
  { id: 'benny', name: 'Navy', personality: 'starstruck', label: 'Kind', role: 'Six, the kindest kid', catchphrase: 'Really? Wow!',
    look: { faceShape: 'capsule', eyeShape: 'bulb', browShape: 'comb', mouthShape: 'lips', antenna: 'single', finish: 'painted', faceColor: '#2f4fb8', eyeColor: '#ffd166', accentColor: '#4fc3ff', scale: 0.9, floatStyle: 'sway' },
    fx: { preset: 'hearts', color: null, rate: 1.0, size: 0.9, speed: 1.0 } },
  { id: 'knox', name: 'Black', personality: 'dramatic', label: 'Show-off', role: 'The kid next door', catchphrase: "Bet you can't!",
    look: { faceShape: 'bullet', eyeShape: 'visor', browShape: 'piston', mouthShape: 'jaw', antenna: 'single', finish: 'gunmetal', faceColor: '#26282e', eyeColor: '#ffd166', accentColor: '#e8edf5', scale: 0.9, floatStyle: 'bob' },
    fx: { preset: 'burn', color: null, rate: 0.8, size: 0.9, speed: 1.2 } },
  { id: 'frankie', name: 'Yellow', personality: 'cheerful', label: 'Cheering', role: 'The commentator on the corner', catchphrase: "And they're off!",
    look: { faceShape: 'egg', eyeShape: 'bulb', browShape: 'comb', mouthShape: 'jaw', antenna: 'single', finish: 'painted', faceColor: '#ffd166', eyeColor: '#4f8cff', accentColor: '#ff6b6b', scale: 1.0, floatStyle: 'bob' },
    fx: { preset: 'confetti', color: null, rate: 1.2, size: 1.0, speed: 1.2 } },
  { id: 'ray', name: 'Copper', personality: 'hopeful', label: 'Hopeful', role: "Jade's dad, sells houses", catchphrase: "This one's got potential!",
    look: { faceShape: 'tv', eyeShape: 'bulb', browShape: 'bar', mouthShape: 'lips', antenna: 'double', finish: 'painted', faceColor: '#b87333', eyeColor: '#4fc3ff', accentColor: '#ffd166', scale: 1.05, floatStyle: 'bob' },
    fx: { preset: 'aurora', color: null, rate: 0.8, size: 1.1, speed: 0.8 } },
  { id: 'lou', name: 'Gold', personality: 'bored', label: 'Thrifty', role: 'Grandpa, owns the diner', catchphrase: "That's extra.",
    look: { faceShape: 'bucket', eyeShape: 'monocle', browShape: 'segmented', mouthShape: 'grille', antenna: 'none', finish: 'brass', faceColor: '#c9a227', eyeColor: '#7fb2ff', accentColor: '#b87333', scale: 1.0, floatStyle: 'drift' },
    fx: { preset: 'smoke', color: '#e8edf5', rate: 0.5, size: 1.2, speed: 0.5 } },
  { id: 'constance', name: 'Lilac', personality: 'proud', label: 'Orderly', role: "The neighbour, Black's mum", catchphrase: "There's a rule for that.",
    look: { faceShape: 'bullet', eyeShape: 'telescope', browShape: 'bar', mouthShape: 'shutter', antenna: 'none', finish: 'brushed', faceColor: '#c3a6ff', eyeColor: '#3a2a7a', accentColor: '#5b3fc4', scale: 1.05, floatStyle: 'still' },
    fx: { preset: 'snow', color: null, rate: 0.6, size: 1.0, speed: 0.6 } },
  { id: 'ivy', name: 'Red', personality: 'cheeky', label: 'Streetwise', role: 'Big sister, nine', catchphrase: 'Trust me.',
    look: { faceShape: 'dome', eyeShape: 'lens', browShape: 'blade', mouthShape: 'lips', antenna: 'single', finish: 'chrome', faceColor: '#ff6b6b', eyeColor: '#4fc3ff', accentColor: '#e8edf5', scale: 1.0, floatStyle: 'sway' },
    fx: { preset: 'charm', color: '#4fc3ff', rate: 1.0, size: 1.0, speed: 1.0 } },
];

export const CAST16_BY_NAME = Object.fromEntries(CAST16.map((m) => [m.name, m]));
export const CAST16_BY_ID = Object.fromEntries(CAST16.map((m) => [m.id, m]));

/**
 * The cast's names before they became their face colours (Oct 30: the audience could not tell the
 * bots apart; now each is called by the colour it wears). Bundles directed before the rename still
 * say "Teddy"; legacyNames() reads them in today's names so they load and play.
 */
export const LEGACY_NAMES = {
  Murphy: 'Silver', Sterling: 'Purple', Dan: 'Orange', Vera: 'Gray', Nora: 'White', Pearl: 'Pink', Gigi: 'Blue',
  Teddy: 'Green', Hattie: 'Jade', Benny: 'Navy', Knox: 'Black', Frankie: 'Yellow', Ray: 'Copper', Lou: 'Gold',
  Constance: 'Lilac', Ivy: 'Red',
};
const LEGACY_RE = new RegExp(`\\b(${Object.keys(LEGACY_NAMES).join('|')})\\b`, 'g');

/**
 * `value` (a bundle's beats.json, an event, a list of events, a string) with every old cast name
 * (capitalised, a whole word: "Teddy", "Lou's", "{Nora:nod}", "spot-Gigi") in its colour name.
 * Returns a copy; a bundle already in today's names comes back equal.
 */
export function legacyNames(value) {
  if (typeof value === 'string') return value.replace(LEGACY_RE, (n) => LEGACY_NAMES[n]);
  if (Array.isArray(value)) return value.map(legacyNames);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[legacyNames(k)] = legacyNames(v);
    return out;
  }
  return value;
}

const OLD = Object.keys(LEGACY_NAMES).join('|');
const OLD_CAST = new RegExp(`"(?:bot|singer|lead|pal|grown|rival)":"(?:${OLD})"|"cast":\\[[^\\]]*"(?:${OLD})"`);
/** True when a bundle (events or beats.json) is in the old names: a bot, a singer, a role or a beat's cast says "Teddy". */
export const isLegacyBundle = (value) => OLD_CAST.test(JSON.stringify(value ?? null));
/**
 * A bundle (events or beats.json) in today's names: an old one renamed (legacyNames), a new one as it is
 * (so a new lyric's own "Ivy" or "Ray" of light is left alone).
 */
export const modernBundle = (value) => (isLegacyBundle(value) ? legacyNames(value) : value);
