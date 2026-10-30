// A complete, rule-clean director episode for the tests and the stub Muse (stub-muse.js): the plan
// (beats.json input) and every role's work per beat, in the shape the crew sends it to emit.js.
// Not a showcase; just enough story to exercise the stanza form, the turnstile and the gate.
export const PLAN = {
  prompt: 'Lou sells hot soup on a cold day',
  title: 'Hot Soup',
  roles: { lead: 'Teddy', pal: 'Benny', grown: 'Lou', rival: 'Sterling' },
  tags: { bridge: 'tender' },
  hook: 'Hot soup, hot soup!',
  irony: 'The cook who charges for every spoon finds his warmest bowl is the one he gives away.',
  beats: [
    { set: 'street', cast: ['Teddy', 'Benny', 'Lou'], summary: 'Steam rises from a pot on a frosty street.' },
    { set: 'diner', cast: ['Teddy', 'Benny', 'Lou'], summary: 'Teddy wants soup, and Lou names a price.' },
    { set: 'diner', cast: ['Teddy', 'Benny', 'Lou', 'Sterling'], summary: 'Sterling parks his truck and gives soup away.' },
    { set: 'diner', cast: ['Teddy', 'Benny', 'Lou', 'Pearl'], summary: 'The hook: hot soup on a cold day.' },
    { set: 'street', cast: ['Teddy', 'Benny', 'Sterling'], summary: 'The crowd runs to the truck and the diner is empty.' },
    { set: 'street', cast: ['Teddy', 'Benny', 'Sterling', 'Lou'], summary: 'Teddy tastes the truck soup: it is Lou\'s recipe.' },
    { set: 'diner', cast: ['Teddy', 'Benny', 'Lou', 'Pearl'], summary: 'The hook again, the same words.' },
    { set: 'diner', cast: ['Lou', 'Teddy'], summary: 'Lou remembers teaching a young dishwasher to cook.' },
    { set: 'diner', cast: ['Lou', 'Teddy', 'Sterling'], summary: 'Lou carries his pot out into the cold.' },
    { set: 'street', cast: ['Teddy', 'Benny', 'Lou', 'Sterling', 'Pearl'], summary: 'Lou pours soup for free.' },
    { set: 'street', cast: ['Teddy', 'Benny', 'Lou', 'Sterling'], summary: 'Two cooks share one street at last.' },
  ],
};

const L = (lyric, summary, extra = {}) => ({ lyric, summary, ...extra });
/**
 * Teddy's stanzas, beat by beat (each sent as one batch). The summaries are his first-person sung
 * thoughts; the first line's "Brr!" is not in the singer's dictionary and is bypassed (once: the word
 * is fine for the rest of the episode), and his chorus 1 opener answers Nora's question.
 */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'I paint the frosty street', { bypass: { dictionary: 'the shiver sound every child knows' } }),
    L('[And] {Lou} stirs a giant pot >> Yum!', 'I bring in Lou and his pot', { action: 'point' })],
  [L('I want a bowl of soup >> Me too!', 'I want a bowl of soup'), L('My hands are icy cold >> So cold!', 'I shiver in the line'),
    L('{Lou:harrumph} taps the price >> Uh-oh!', 'I show the price tag'), L("That's extra, good as gold! >> Aw, please?", 'I give Lou his own words', { singer: 'Lou' })],
  [L('{Sterling:preen} rolls up next door >> So shiny!', 'I bring on the rival truck'), L('Ta-da! Free soup for you! >> Free soup!', 'I give Sterling the free soup', { singer: 'Sterling' }),
    L('The crowd hurries over >> Wait up!', 'I empty the diner'), L('[And] I sit with {Lou}, too >> Oh no!', 'I sit alone with Lou')],
  [L('Hot soup, hot soup! >> Slurp!', 'I land the hook on soup, Nora', { with: ['Benny'], consult: ['Nora'] }), L('[Oh,] A bowl to warm my nose >> So warm!', 'I rhyme the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'I sing the hook again', { with: ['Benny', 'Pearl'] }), L('[And] Steam on my ten toes >> Toasty!', 'I land the chorus')],
  [L('{Lou} rings a little bell >> Ding!', 'I ring the empty diner'), L('I bring a cup to Lou', 'I let Benny bring a cup', { singer: 'Benny' }),
    L('{Sterling:wink} pours some more >> Show-off!', 'I give Sterling a wink'), L('The line goes out of view >> So long!', 'I stretch the long queue')],
  [L("I taste the truck's soup >> Well?", 'I take a sip'), L("It tastes like Grandpa's stew >> No way!", 'I spot the secret recipe'),
    L('{Lou} teaches me, you know >> Really?', 'I let Sterling confess', { singer: 'Sterling' }), L('{Lou:gasp} drops his spoon, too >> Clang!', 'I drop the spoon')],
  [L('Hot soup, hot soup! >> Slurp!', 'I bring back the hook'), L('[Oh,] A bowl to warm my nose >> So warm!', 'I sing the chorus again'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'I sing the hook once more'), L('[And] Steam on my ten toes >> Toasty!', 'I end the chorus')],
  [L('I see a boy at my sink', 'I give Lou the memory'), L('He scrubs the pans each day', "I write Lou's young helper"),
    L('I teach him how to stir', 'I write the lesson'), L('And now he sings his way', 'I close the memory')],
  [L('I lift my heavy pot', "I write Lou's decision"), L('I carry it outside', 'I walk Lou into the cold'),
    L('Grandpa, is that extra?', 'I ask the big question', { singer: 'Teddy' }), L('I smile, and pour it wide', 'I let Lou smile')],
  [L('Hot soup, hot soup! >> Slurp!', 'I start the last chorus'), L('[Oh,] A bowl to warm my nose >> So warm!', 'I keep the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'I sing the hook big'), L('Free soup, from me to those >> Thanks, Grandpa!', 'I turn the line for Lou', { singer: 'Lou' })],
  [L('Hot soup, hot soup! >> Slurp!', 'I sing the hook home'), L('Steam on a frosty street >> Warm now!', 'I call back the intro'),
    L('Two cooks share the corner >> High five!', 'I show the changed street'), L('[And] {Lou} pours a bowl for me >> For free!', 'I end on a free bowl')],
];

const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
/**
 * The other roles' cues (beat numbers 1-based), first-person thoughts with hand plays: Nora asks Teddy
 * about the hook, Vera plans the finale with Frankie (his high-five answers her), Lou asks Nora.
 */
export const CUES = {
  chords: [
    W(1, 'I set a cozy key for the street', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    W(4, "I ask Teddy where the hook lands", 'chin-stroke', { chords: ['C', 'G', 'Am', 'F'], status: 'consulting', consult: ['Teddy'] }),
    W(8, 'I calm the band for the memory', 'count-beats', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [W(1, 'I paint the street frosty blue', 'lights-cool'), W(3, 'I put a spotlight on the truck', 'spot-Sterling'),
    W(8, 'I dim the diner to one glow', 'lights-dim'), W(11, 'I turn the whole street gold', 'lights-gold')],
  dance: [W(1, 'I bring the cast onto the street', 'enter'), W(4, 'I start a dance line for the hook', 'conga-sway'),
    W(7, 'I march the crowd back inside', 'march'), W(10, 'I plan the finale with Frankie', 'huddle', { status: 'consulting', consult: ['Frankie'] })],
  deals: [W(2, 'I count the coins for one bowl', 'count-beats'), W(9, 'I ask Nora if the band plays free', 'chin-stroke', { status: 'consulting', consult: ['Nora'] }),
    W(10, 'I shake hands with Sterling', 'handshake', { consult: ['Sterling'], singer: 'Lou' })],
  hype: [W(3, "I call Sterling's flashy entrance", 'cheer'), W(6, 'I spot the secret recipe', 'binoculars'), W(10, 'I seal the finale, Vera', 'high-five', { consult: ['Vera'] })],
  comedy: [W(5, 'I slip on an icy puddle', 'wobble'), W(7, 'I giggle into my soup', 'giggle'), W(11, 'I wink at the last free bowl', 'wink')],
};
