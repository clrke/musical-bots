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
const Q = (summary, to, extra = {}) => ({ summary, status: 'consulting', consult: [to], action: 'chin-stroke', ...extra });
/**
 * Green's stanzas, beat by beat (each sent as one batch). The summaries are Green talking about the line he proposes
 * (summaries: "talk"): pitching it, asking for feedback, reacting; never to the viewers. Two questions of his own
 * (Gold's price face, Pink's gag) and his answers (White's big chord, Gold's pot). The first line's "Brr!" is not in
 * the singer's dictionary and is bypassed (once: the word is fine for the rest of the episode).
 */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'Is a frosty street a good start?', { bypass: { dictionary: 'the shiver sound every child knows' } }),
    L('[And] {Gold} stirs a giant pot >> Yum!', 'Gold gets a giant pot here', { action: 'point' })],
  [Q('Is this your grumpy price face, Gold?', 'Gold'),
    L('I want a bowl of soup >> Me too!', 'Simple and hungry. Too plain?'), L('My hands are icy cold >> So cold!', 'I can feel the cold in this one'),
    L('{Gold:harrumph} taps the price >> Uh-oh!', 'Here comes the price tap. Fun?'), L("That's extra, good as gold! >> Aw, please?", "This one's yours. Ready, Gold?", { singer: 'Gold' })],
  [L('{Purple:preen} rolls up next door >> So shiny!', 'What if Purple rolls up shiny?'), L('Ta-da! Free soup for you! >> Free soup!', 'Purple gets the big ta-da line', { singer: 'Purple' }),
    L('The crowd hurries over >> Wait up!', 'Does the rush feel fast enough, Gray?'), L('[And] I sit with {Gold}, too >> Oh no!', 'Aw. That one is a little sad')],
  [L('Hot soup, hot soup! >> Slurp!', "On 'soup'! Hit it hard, White", { with: ['Navy'], consult: ['White'] }), L('[Oh,] A bowl to warm my nose >> So warm!', 'A nose line! Too silly, Pink?'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Sing it again with me, Yellow!', { with: ['Navy', 'Pink'] }), L('[And] Steam on my ten toes >> Toasty!', 'Yes! Toes rhymes with nose')],
  [Q('Is the long line funny yet, Pink?', 'Pink'),
    L('{Gold} rings a little bell >> Ding!', 'Can the bell ring on the beat, White?'), L('I bring a cup or two', 'Navy brings cups. Cute, Pink?', { singer: 'Navy' }),
    L('{Purple:wink} pours some more >> Show-off!', 'Ha! Purple shows off'), L('The line goes out of view >> So long!', "Let's make the line super long")],
  [L("I taste the truck's soup >> Well?", 'Now the big sip. Slow it down, White'), L("It tastes like Grandpa's stew >> No way!", 'Ooh, here is the twist!'),
    L('{Gold} teaches me, you know >> Really?', 'Purple tells the secret. Too soon?', { singer: 'Purple' }), L('{Gold:gasp} drops his spoon, too >> Clang!', 'Can you gasp really big, Gold?')],
  [L('Hot soup, hot soup! >> Slurp!', 'The hook again, same words, okay?'), L('[Oh,] A bowl to warm my nose >> So warm!', 'Louder this time?'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'All of us now, Gray!'), L('[And] Steam on my ten toes >> Toasty!', 'Wiggle those toes, Pink!')],
  [L('I see a boy at my sink', 'Quiet now. Too sad, Gold?'), L('He scrubs the pans each day', 'I like this one. It is gentle'),
    L('I teach him how to stir', 'Can the strings come in here, White?'), L('And now he sings his way', 'Aw, that makes me smile')],
  [L('I lift my heavy pot', 'Heavy pot. Can you lift it slow?'), L('I carry it outside', 'Yes! Right out into the cold, Gold', { consult: ['Gold'] }),
    L('Grandpa, is that extra?', 'My big question. Does it land?', { singer: 'Green' }), L('I smile, and pour it wide', 'Perfect! A big smile to end it')],
  [L('Hot soup, hot soup! >> Slurp!', 'Last chorus! Ready, Yellow?'), L('[Oh,] A bowl to warm my nose >> So warm!', 'Keep this one the same'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Biggest hook yet, Gray!'), L('Free soup, from me to those >> Thanks, Grandpa!', 'Gold turns the line. Is it sweet?', { singer: 'Gold' })],
  [L('Hot soup, hot soup! >> Slurp!', 'One more time, softly?'), L('Steam on a frosty street >> Warm now!', 'Back to the start. Nice, right?'),
    L('Two cooks share the corner >> High five!', "Let's end with friends"), L('[And] {Gold} pours a bowl for me >> For free!', 'Ooh, a free bowl to end on!')],
];

const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
const WQ = (beat, summary, to, action = 'chin-stroke', extra = {}) => W(beat, summary, action, { status: 'consulting', consult: [to], ...extra });
/**
 * The other roles' cues (beat numbers 1-based), talk with hand plays: every role asks two questions and answers the
 * ones put to it (the asked bot's event names the asker back in consult): fourteen exchanges in all.
 */
export const CUES = {
  chords: [
    WQ(1, 'Warm or cool for a frosty street, Blue?', 'Blue', 'chin-stroke', { chords: ['C', 'G', 'Am', 'F'] }),
    W(2, 'Nothing, Gold. We play for soup', 'handshake', { chords: ['C', 'F', 'G', 'C'], consult: ['Gold'] }),
    WQ(4, 'Where does the big chord go, Green?', 'Green', 'chin-stroke', { chords: ['C', 'G', 'Am', 'F'] }),
    W(5, 'A little faster. Hold on, Yellow!', 'count-beats', { chords: ['F', 'G', 'C', 'Am'], consult: ['Yellow'] }),
    W(8, 'Soft minor chords for the memory', 'count-beats', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [W(1, 'Cool, White! Icy blue it is', 'lights-cool', { consult: ['White'] }), WQ(3, 'Where does the truck pull in, Yellow?', 'Yellow', 'binoculars'),
    W(3, 'Ta-da, a gold spot for Purple', 'spot-Purple'), W(6, 'A spot for your slip, coming up!', 'spot-Pink', { consult: ['Pink'] }),
    W(8, 'Shh. Dim and warm for the memory', 'lights-dim'), WQ(11, 'Gold light for the finish, Gray?', 'Gray'), W(11, 'Ooh, here comes the gold!', 'lights-gold')],
  dance: [W(1, 'Slow steps in, nice and easy', 'enter'), W(4, "Let's sway on the hook, side to side", 'conga-sway'),
    WQ(7, 'Is a march too much here, Yellow?', 'Yellow', 'march'), WQ(10, 'How big is the finale, Yellow?', 'Yellow', 'huddle'),
    W(11, 'Yes, gold! Then we all bow', 'high-five', { consult: ['Blue'] })],
  deals: [WQ(2, 'What does the band cost me, White?', 'White'), W(2, 'Yes. Very grumpy, Green', 'count-beats', { consult: ['Green'] }),
    W(8, 'Quiet, yes. Keep it soft, Yellow', 'pinky-promise', { consult: ['Yellow'] }), WQ(9, 'Do I carry the pot out, Green?', 'Green'),
    W(10, 'Free soup? Deal. I shake on it', 'handshake', { consult: ['Purple'], singer: 'Gold' }), W(11, 'One wink. Winks cost extra, Pink', 'count-beats', { consult: ['Pink'] })],
  hype: [W(3, 'Stage left, Blue! Here it comes!', 'cheer', { consult: ['Blue'] }), WQ(5, 'Can the drums go faster, White?', 'White', 'cheer'),
    W(6, 'Whoa, the secret recipe!', 'binoculars'), W(7, 'Never too much! March them in!', 'stadium-wave', { consult: ['Gray'] }),
    WQ(8, 'Is this the sad part, Gold?', 'Gold', 'binoculars'), W(10, 'Big as a stadium, Gray!', 'high-five', { consult: ['Gray'] })],
  comedy: [WQ(6, 'Can I get a spot for my slip, Blue?', 'Blue', 'scratch-head'), W(6, 'Ha! A puddle and a boing, Green', 'boing', { consult: ['Green'] }),
    W(7, 'Oops! Soup on my nose', 'giggle'), WQ(11, 'One last wink, Gold? Or two?', 'Gold', 'wink')],
};
