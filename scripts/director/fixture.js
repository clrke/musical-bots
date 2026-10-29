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
/** Teddy's stanzas, beat by beat (each sent as one batch). */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'Teddy paints the frosty street'), L('[And] {Lou} stirs a giant pot >> Yum!', 'Teddy brings in Lou and his pot', { action: 'point' })],
  [L('I want a bowl of soup >> Me too!', 'Teddy wants a bowl of soup'), L('My hands are icy cold >> So cold!', 'Teddy shivers in the line'),
    L('{Lou:harrumph} taps the price >> Uh-oh!', 'Teddy shows the price tag'), L("That's extra, good as gold! >> Aw, please?", 'Teddy gives Lou his catchphrase', { singer: 'Lou' })],
  [L('{Sterling:preen} parks his truck >> So shiny!', 'Teddy brings on the rival truck'), L('Ta-da! Free soup for you! >> Free soup!', 'Teddy gives Sterling the free soup', { singer: 'Sterling' }),
    L('The crowd runs out the door >> Wait up!', 'Teddy empties the diner'), L('[And] I sit with {Lou}, too >> Oh no!', 'Teddy sits alone with Lou')],
  [L('Hot soup, hot soup! >> Slurp!', 'Teddy sings the hook', { with: ['Benny'] }), L('[Oh,] A bowl to warm my nose >> Achoo!', 'Teddy rhymes the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Teddy sings the hook again', { with: ['Benny', 'Pearl'] }), L('[And] Steam on my ten toes >> Toasty!', 'Teddy lands the chorus')],
  [L('{Lou} rings a little bell >> Ding!', 'Teddy rings the empty diner'), L('I bring a cup to Lou', 'Benny brings Lou a cup', { singer: 'Benny' }),
    L('{Sterling:wink} ladles more >> Show-off!', 'Teddy gives Sterling a wink'), L('The line goes out of view >> So long!', 'Teddy stretches the queue')],
  [L("I taste the truck's soup >> Well?", 'Teddy takes a sip'), L("It tastes like Grandpa's stew >> No way!", 'Teddy spots the secret recipe'),
    L('{Lou} teaches me, you know >> Really?', 'Teddy lets Sterling confess', { singer: 'Sterling' }), L('{Lou:gasp} drops his spoon, too >> Clang!', 'Teddy drops the spoon')],
  [L('Hot soup, hot soup! >> Slurp!', 'Teddy brings back the hook'), L('[Oh,] A bowl to warm my nose >> Achoo!', 'Teddy repeats the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Teddy sings the hook once more'), L('[And] Steam on my ten toes >> Toasty!', 'Teddy ends the chorus')],
  [L('I see a boy at my sink', 'Teddy gives Lou the memory'), L('He scrubs the pans each day', 'Teddy writes the young dishwasher'),
    L('I teach him how to stir', 'Teddy writes the lesson'), L('And now he sings his way', 'Teddy closes the memory')],
  [L('I lift my heavy pot', 'Teddy writes the decision'), L('I carry it outside', 'Teddy walks Lou into the cold'),
    L('Grandpa, is that extra?', 'Teddy asks the big question', { singer: 'Teddy' }), L('I smile, and pour it wide', 'Teddy lets Lou smile')],
  [L('Hot soup, hot soup! >> Slurp!', 'Teddy starts the last chorus'), L('[Oh,] A bowl to warm my nose >> Achoo!', 'Teddy keeps the chorus'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Teddy sings the hook big'), L('Free soup, from me to those >> Thanks, Grandpa!', 'Teddy turns the line for Lou', { singer: 'Lou' })],
  [L('Hot soup, hot soup! >> Slurp!', 'Teddy sings the hook home'), L('Steam on a frosty street >> Warm now!', 'Teddy calls back the intro'),
    L('Two cooks on one street >> High five!', 'Teddy shows the changed street'), L('[And] {Lou} pours one more >> For free!', 'Teddy ends on a free bowl')],
];

const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
/** The other roles' cues (beat numbers 1-based). */
export const CUES = {
  chords: [
    W(1, 'Nora sets a cozy key for the street', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    W(4, "Nora checks the hook's key with Teddy", 'fist-bump', { chords: ['C', 'G', 'Am', 'F'], status: 'consulting', consult: ['Teddy'] }),
    W(8, 'Nora softens the band for the memory', 'conductor', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [W(1, 'Gigi paints the street frosty blue', 'lights-cool'), W(3, 'Gigi puts a spotlight on the truck', 'spot-Sterling'),
    W(8, 'Gigi dims the diner to one glow', 'lights-dim'), W(11, 'Gigi turns the whole street gold', 'lights-gold')],
  dance: [W(1, 'Vera brings the cast onto the street', 'enter'), W(4, 'Vera starts a conga for the hook', 'conga-sway'),
    W(7, 'Vera marches the crowd back inside', 'march'), W(10, 'Vera plans the finale with Frankie', 'huddle', { status: 'consulting', consult: ['Frankie'] })],
  deals: [W(2, 'Lou counts the coins for one bowl', 'count-beats'), W(9, 'Lou asks Nora if the band plays for free', 'handshake', { status: 'consulting', consult: ['Nora'] }),
    W(10, 'Lou shakes hands with Sterling', 'handshake', { consult: ['Sterling'], singer: 'Lou' })],
  hype: [W(3, "Frankie calls Sterling's flashy entrance", 'cheer'), W(6, 'Frankie spots the secret recipe', 'binoculars'), W(10, 'Frankie high-fives the cooks', 'high-five')],
  comedy: [W(5, 'Pearl slips on an icy puddle', 'wobble'), W(7, 'Pearl giggles into her soup', 'giggle'), W(11, 'Pearl winks at the last free bowl', 'wink')],
};
