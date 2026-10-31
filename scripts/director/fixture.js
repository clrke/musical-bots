// A complete, rule-clean director episode for the tests and the stub Muse (stub-muse.js): the plan
// (beats.json input) and every role's work per beat, in the shape the crew sends it to emit.js.
// Not a showcase; just enough story to exercise the stanza form, the turnstile and the gate.
export const PLAN = {
  prompt: 'Gold sells hot soup on a cold day',
  title: 'Hot Soup',
  roles: { lead: 'Green', pal: 'Navy', grown: 'Gold', rival: 'Purple' },
  tags: { bridge: 'tender' },
  hook: 'Hot soup, hot soup!',
  irony: 'The cook who charges for every spoon finds his warmest bowl is the one he gives away.',
  beats: [
    { set: 'street', cast: ['Green', 'Navy', 'Gold'], summary: 'Steam rises from a pot on a frosty street.' },
    { set: 'diner', cast: ['Green', 'Navy', 'Gold'], summary: 'Green wants soup, and Gold names a price.' },
    { set: 'diner', cast: ['Green', 'Navy', 'Gold', 'Purple'], summary: 'Purple parks his truck and gives soup away.' },
    { set: 'diner', cast: ['Green', 'Navy', 'Gold', 'Pink'], summary: 'The hook: hot soup on a cold day.' },
    { set: 'street', cast: ['Green', 'Navy', 'Purple'], summary: 'The crowd runs to the truck and the diner is empty.' },
    { set: 'street', cast: ['Green', 'Navy', 'Purple', 'Gold'], summary: 'Green tastes the truck soup: it is Gold\'s recipe.' },
    { set: 'diner', cast: ['Green', 'Navy', 'Gold', 'Pink'], summary: 'The hook again, the same words.' },
    { set: 'diner', cast: ['Gold', 'Green'], summary: 'Gold remembers teaching a young dishwasher to cook.' },
    { set: 'diner', cast: ['Gold', 'Green', 'Purple'], summary: 'Gold carries his pot out into the cold.' },
    { set: 'street', cast: ['Green', 'Navy', 'Gold', 'Purple', 'Pink'], summary: 'Gold pours soup for free.' },
    { set: 'street', cast: ['Green', 'Navy', 'Gold', 'Purple'], summary: 'Two cooks share one street at last.' },
  ],
};

const L = (lyric, summary, extra = {}) => ({ lyric, summary, ...extra });
/**
 * Green's stanzas, beat by beat (each sent as one batch). The summaries are what Green says to his crewmates as he
 * writes (summaries: "talk", never to the viewers); the first line's "Brr!" is not in the singer's dictionary and is
 * bypassed (once: the word is fine for the rest of the episode), and his chorus 1 opener answers White's question.
 */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'White, I start on a frosty street', { bypass: { dictionary: 'the shiver sound every child knows' } }),
    L('[And] {Gold} stirs a giant pot >> Yum!', 'Gold, you stir the giant pot', { action: 'point' })],
  [L('I want a bowl of soup >> Me too!', 'Pink, I want a bowl of soup'), L('My hands are icy cold >> So cold!', "Blue, it's cold in the line"),
    L('{Gold:harrumph} taps the price >> Uh-oh!', 'Gold, show the price tag'), L("That's extra, good as gold! >> Aw, please?", 'Gold, this line is all yours', { singer: 'Gold' })],
  [L('{Purple:preen} rolls up next door >> So shiny!', 'Yellow, here comes the rival truck'), L('Ta-da! Free soup for you! >> Free soup!', 'Purple gets the free soup, Gray', { singer: 'Purple' }),
    L('The crowd hurries over >> Wait up!', 'Blue, the diner empties out'), L('[And] I sit with {Gold}, too >> Oh no!', 'Pink, I sit alone with Gold')],
  [L('Hot soup, hot soup! >> Slurp!', 'White, the hook lands on soup!', { with: ['Navy'], consult: ['White'] }), L('[Oh,] A bowl to warm my nose >> So warm!', 'Gray, I rhyme the chorus now'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Sing the hook again, Yellow', { with: ['Navy', 'Pink'] }), L('[And] Steam on my ten toes >> Toasty!', 'Nice, the chorus lands, White')],
  [L('{Gold} rings a little bell >> Ding!', 'Gold, your bell rings for nobody'), L('I bring a cup or two', 'Navy brings a cup, Blue', { singer: 'Navy' }),
    L('{Purple:wink} pours some more >> Show-off!', 'Pink, Purple winks here'), L('The line goes out of view >> So long!', 'Gray, the queue goes on and on')],
  [L("I taste the truck's soup >> Well?", 'Yellow, I take a sip'), L("It tastes like Grandpa's stew >> No way!", 'Ooh, the secret recipe!'),
    L('{Gold} teaches me, you know >> Really?', 'Purple tells the truth, Pink', { singer: 'Purple' }), L('{Gold:gasp} drops his spoon, too >> Clang!', 'Gold, you drop the spoon here')],
  [L('Hot soup, hot soup! >> Slurp!', 'White, the hook comes back'), L('[Oh,] A bowl to warm my nose >> So warm!', 'Same chorus again, Gray'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'One more hook, Yellow!'), L('[And] Steam on my ten toes >> Toasty!', 'Okay, that ends the chorus')],
  [L('I see a boy at my sink', 'Gold, this memory is yours'), L('He scrubs the pans each day', 'Gold, your young helper scrubs'),
    L('I teach him how to stir', 'Blue, here comes the lesson'), L('And now he sings his way', 'Ooh, that closes the memory')],
  [L('I lift my heavy pot', 'Gold, you make up your mind'), L('I carry it outside', 'Blue, Gold walks into the cold'),
    L('Grandpa, is that extra?', 'Pink, now I ask the big question', { singer: 'Green' }), L('I smile, and pour it wide', 'Gold, you smile at last')],
  [L('Hot soup, hot soup! >> Slurp!', 'White, the last chorus starts'), L('[Oh,] A bowl to warm my nose >> So warm!', 'Yeah, we keep the chorus, Gray'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Sing the hook big, Yellow!'), L('Free soup, from me to those >> Thanks, Grandpa!', 'Gold, I turn this line for you', { singer: 'Gold' })],
  [L('Hot soup, hot soup! >> Slurp!', 'White, the hook comes home'), L('Steam on a frosty street >> Warm now!', 'Blue, I call back the intro'),
    L('Two cooks share the corner >> High five!', 'Gray, two cooks share the street'), L('[And] {Gold} pours a bowl for me >> For free!', 'Nice, we end on a free bowl')],
];

const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
/**
 * The other roles' cues (beat numbers 1-based), each said to a crewmate, with hand plays: White asks Green about the
 * hook, Gray plans the finale with Yellow (his high-five answers her), Gold asks White.
 */
export const CUES = {
  chords: [
    W(1, 'Blue, a cozy key for the street', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    W(4, 'Green, where does the hook land?', 'chin-stroke', { chords: ['C', 'G', 'Am', 'F'], status: 'consulting', consult: ['Green'] }),
    W(8, 'Gray, I calm the band down here', 'count-beats', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [W(1, 'Gold, the street goes frosty blue', 'lights-cool'), W(3, 'Yellow, a spotlight on the truck', 'spot-Purple'),
    W(8, 'White, I dim the diner low', 'lights-dim'), W(11, 'Look, Gray, the street turns gold!', 'lights-gold')],
  dance: [W(1, 'Yellow, bring the cast on in', 'enter'), W(4, 'Pink, a dance line for the hook', 'conga-sway'),
    W(7, 'Blue, I march the crowd inside', 'march'), W(10, 'Yellow, how big is the finale?', 'huddle', { status: 'consulting', consult: ['Yellow'] })],
  deals: [W(2, 'White, one bowl costs three coins', 'count-beats'), W(9, 'White, does the band play free?', 'chin-stroke', { status: 'consulting', consult: ['White'] }),
    W(10, 'Deal, Purple! We shake on it', 'handshake', { consult: ['Purple'], singer: 'Gold' })],
  hype: [W(3, "Pink, here comes Purple's flashy truck", 'cheer'), W(6, 'Wow, Gray, the secret recipe!', 'binoculars'), W(10, 'Big finish, Gray! High five!', 'high-five', { consult: ['Gray'] })],
  comedy: [W(5, 'Gold, I slip on an icy puddle', 'wobble'), W(7, 'Ooh, Blue, I giggle in my soup', 'giggle'), W(11, 'Gold, I wink at the last bowl', 'wink')],
};
