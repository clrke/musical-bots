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
 * Green's stanzas, beat by beat (each sent as one batch). The summaries are the team's sung
 * thoughts in "we"; the first line's "Brr!" is not in the singer's dictionary and is bypassed (once: the word
 * is fine for the rest of the episode), and his chorus 1 opener answers White's question.
 */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'We paint the frosty street', { bypass: { dictionary: 'the shiver sound every child knows' } }),
    L('[And] {Gold} stirs a giant pot >> Yum!', 'We bring in Gold and his pot', { action: 'point' })],
  [L('I want a bowl of soup >> Me too!', 'We want a bowl of soup'), L('My hands are icy cold >> So cold!', 'We shiver in the line'),
    L('{Gold:harrumph} taps the price >> Uh-oh!', 'We show the price tag'), L("That's extra, good as gold! >> Aw, please?", 'We give Gold his own words', { singer: 'Gold' })],
  [L('{Purple:preen} rolls up next door >> So shiny!', 'We bring on the rival truck'), L('Ta-da! Free soup for you! >> Free soup!', 'We give Purple the free soup', { singer: 'Purple' }),
    L('The crowd hurries over >> Wait up!', 'We empty the diner'), L('[And] I sit with {Gold}, too >> Oh no!', 'We sit alone with Gold')],
  [L('Hot soup, hot soup! >> Slurp!', 'We land the hook on soup, White', { with: ['Navy'], consult: ['White'] }), L('[Oh,] A bowl to warm my nose >> So warm!', 'We rhyme the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'We sing the hook again', { with: ['Navy', 'Pink'] }), L('[And] Steam on my ten toes >> Toasty!', 'We land the chorus')],
  [L('{Gold} rings a little bell >> Ding!', 'We ring the empty diner'), L('I bring a cup or two', 'We let Navy bring a cup', { singer: 'Navy' }),
    L('{Purple:wink} pours some more >> Show-off!', 'We give Purple a wink'), L('The line goes out of view >> So long!', 'We stretch the long queue')],
  [L("I taste the truck's soup >> Well?", 'We take a sip'), L("It tastes like Grandpa's stew >> No way!", 'We spot the secret recipe'),
    L('{Gold} teaches me, you know >> Really?', 'We let Purple confess', { singer: 'Purple' }), L('{Gold:gasp} drops his spoon, too >> Clang!', 'We drop the spoon')],
  [L('Hot soup, hot soup! >> Slurp!', 'We bring back the hook'), L('[Oh,] A bowl to warm my nose >> So warm!', 'We sing the chorus again'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'We sing the hook once more'), L('[And] Steam on my ten toes >> Toasty!', 'We end the chorus')],
  [L('I see a boy at my sink', 'We give Gold the memory'), L('He scrubs the pans each day', "We write Gold's young helper"),
    L('I teach him how to stir', 'We write the lesson'), L('And now he sings his way', 'We close the memory')],
  [L('I lift my heavy pot', "We write Gold's decision"), L('I carry it outside', 'We walk Gold into the cold'),
    L('Grandpa, is that extra?', 'We ask the big question', { singer: 'Green' }), L('I smile, and pour it wide', 'We let Gold smile')],
  [L('Hot soup, hot soup! >> Slurp!', 'We start the last chorus'), L('[Oh,] A bowl to warm my nose >> So warm!', 'We keep the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'We sing the hook big'), L('Free soup, from me to those >> Thanks, Grandpa!', 'We turn the line for Gold', { singer: 'Gold' })],
  [L('Hot soup, hot soup! >> Slurp!', 'We sing the hook home'), L('Steam on a frosty street >> Warm now!', 'We call back the intro'),
    L('Two cooks share the corner >> High five!', 'We show the changed street'), L('[And] {Gold} pours a bowl for me >> For free!', 'We end on a free bowl')],
];

const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
/**
 * The other roles' cues (beat numbers 1-based), sung thoughts in "we" with hand plays: White asks Green
 * about the hook, Gray plans the finale with Yellow (his high-five answers her), Gold asks White.
 */
export const CUES = {
  chords: [
    W(1, 'We set a cozy key for the street', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    W(4, "We ask Green where the hook lands", 'chin-stroke', { chords: ['C', 'G', 'Am', 'F'], status: 'consulting', consult: ['Green'] }),
    W(8, 'We calm the band for the memory', 'count-beats', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [W(1, 'We paint the street frosty blue', 'lights-cool'), W(3, 'We put a spotlight on the truck', 'spot-Purple'),
    W(8, 'We dim the diner to one glow', 'lights-dim'), W(11, 'We turn the whole street gold', 'lights-gold')],
  dance: [W(1, 'We bring the cast onto the street', 'enter'), W(4, 'We start a dance line for the hook', 'conga-sway'),
    W(7, 'We march the crowd back inside', 'march'), W(10, 'We plan the finale with Yellow', 'huddle', { status: 'consulting', consult: ['Yellow'] })],
  deals: [W(2, 'We count the coins for one bowl', 'count-beats'), W(9, 'We ask White if the band plays free', 'chin-stroke', { status: 'consulting', consult: ['White'] }),
    W(10, 'We shake hands with Purple', 'handshake', { consult: ['Purple'], singer: 'Gold' })],
  hype: [W(3, "We call Purple's flashy entrance", 'cheer'), W(6, 'We spot the secret recipe', 'binoculars'), W(10, 'We seal the finale, Gray', 'high-five', { consult: ['Gray'] })],
  comedy: [W(5, 'We slip on an icy puddle', 'wobble'), W(7, 'We giggle into our soup', 'giggle'), W(11, 'We wink at the last free bowl', 'wink')],
};
