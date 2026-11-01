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
 * Green's stanzas, beat by beat (each sent as one batch). The summaries are Green talking about the line he proposes
 * (summaries: "talk"): pitching it, asking for feedback, reacting; never to the viewers. Two questions of his own
 * (Gold's price face, Pink's gag) and his answers (White's big chord, Gold's pot). The first line's "Brr!" is not in
 * the singer's dictionary and is bypassed (once: the word is fine for the rest of the episode).
 */
export const LINES = [
  [L('Steam on a frosty street >> Brr!', 'Is a frosty street a good start?', { bypass: { dictionary: 'the shiver sound every child knows' } }),
    L('[And] {Gold} stirs a giant pot >> Yum!', 'Gold gets a giant pot here', { action: 'point' })],
  [
    L('The lid sticks on the pot >> Oh no!', "A stuck lid, Black! Too much?"), L('Our hands are icy cold >> So cold!', 'I can feel the cold in this one'),
    L('{Gold:harrumph} taps the price >> Uh-oh!', 'Here comes the price tap. Fun?'), L("That's extra, good as gold! >> Aw, please?", "This one's yours. Ready, Gold?", { singer: 'Gold' })],
  [L('{Purple:preen} rolls up next door >> So shiny!', 'What if Purple rolls up shiny?'), L('Ta-da! Free soup for you! >> Free soup!', 'Purple gets the big ta-da line', { singer: 'Purple' }),
    L('The crowd hurries over >> Wait up!', 'Does the rush feel fast enough, Gray?'), L('[And] We sit with {Gold}, too >> Oh no!', 'Aw. That one is a little sad')],
  [L('Hot soup, hot soup! >> Slurp!', "On 'soup'! Hit it hard, White", { with: ['Navy'], consult: ['White'] }), L('[Oh,] A bowl for every nose >> So warm!', 'A nose line! Too silly, Pink?'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Sing it again with me, Yellow!', { with: ['Navy', 'Pink'] }), L('[And] Steam on our ten toes >> Toasty!', 'Yes! Toes rhymes with nose')],
  [
    L('The lid pops off at last >> Hooray!', 'Can the pop land on the beat, White?'), L('We bring a cup or two', 'Navy brings cups. Cute, Pink?', { singer: 'Navy' }),
    L('{Purple:wink} pours some more >> Show-off!', 'Ha! Purple shows off'), L('The line goes out of view >> So long!', "Let's make the line super long")],
  [L("We taste the truck's soup >> Well?", 'Now the big sip. Slow it down, White'), L("It tastes like Grandpa's stew >> No way!", 'Ooh, here is the twist!'),
    L('{Gold} teaches us, you know >> Really?', 'Purple tells the secret. Too soon?', { singer: 'Purple' }), L('{Gold:gasp} drops his spoon, too >> Clang!', 'Can you gasp really big, Gold?')],
  [L('Hot soup, hot soup! >> Slurp!', 'The hook again, same words, okay?'), L('[Oh,] A bowl for every nose >> So warm!', 'Louder this time?'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'All of us now, Gray!'), L('[And] Steam on our ten toes >> Toasty!', 'Wiggle those toes, Pink!')],
  [L('We see a boy at our sink', 'Quiet now. Too sad, Gold?'), L('He scrubs the pans each day', 'I like this one. It is gentle'),
    L('We teach him how to stir', 'Can the strings come in here, White?'), L('And now he sings his way', 'Aw, that makes me smile')],
  [L('We lift our heavy pot', 'Heavy pot. Can you lift it slow?'), L('We carry it outside', 'Yes! Right out into the cold, Gold', { consult: ['Gold'] }),
    L('Grandpa, is that extra?', 'My big question. Does it land?', { singer: 'Green' }), L('We smile, and pour it wide', 'Perfect! A big smile to end it')],
  [L('Hot soup, hot soup! >> Slurp!', 'Last chorus! Ready, Yellow?'), L('[Oh,] A bowl for every nose >> So warm!', 'Keep this one the same'),
    L('Hot soup, hot soup! >> Slurp, slurp!', 'Biggest hook yet, Gray!'), L('Free soup, from us to those >> Thanks, Grandpa!', 'Gold turns the line. Is it sweet?', { singer: 'Gold' })],
  [L('Hot soup, hot soup! >> Slurp!', 'One more time, softly?'), L('Steam on a frosty street >> Warm now!', 'Back to the start. Nice, right?'),
    L('{Purple} lends {Gold} a spoon >> High five!', "Let's end with friends"), L('[And] {Gold} serves a dish for us >> For free!', 'Ooh, a free bowl to end on!')],
];


const W = (beat, summary, action = '', extra = {}) => ({ beat, summary, action, ...extra });
/**
 * The consultations (web/src/consultation.js): conversations, one event a line, each a move. A step of a role's
 * script: `open` (the asker's ask, context and question, sent at once), `reply` (the host's ok, ack, reasoning and
 * answer, once the opening shows on its blackboard; `extra` goes on its last answer: the work it changes), `close`
 * (the asker's follow-up, or its agree and thanks, once the reply shows). The stub Muse waits for each on the
 * blackboard, as a crew agent sees it on its next call. Ten consultations, one with a follow-up.
 */
const open = (to, beat, ask, context, question, problem) => ({ step: 'open', to, beat, moves: [['ask', ask], ...context.map((c) => ['context', c]), ...question.map((q) => ['question', q])], ...(problem ? { problem } : {}) });
const reply = (from, beat, moves, extra = {}) => ({ step: 'reply', from, beat, moves, extra });
const close = (to, beat, moves) => ({ step: 'close', to, beat, moves });
export const CONSULTATIONS = 12;

/**
 * The plot's trouble (web/src/plot-trouble.js): Black pitches two problems to Green, who accepts both; the lines that
 * sing and solve them, by beat index and stanza position -> [field, the n-th problem pitched]. The stub Muse puts the
 * problem's consultation id on those lines (known only when the run assigns it).
 */
export const TROUBLE_MARKS = { 1: { 0: ['trouble', 1] }, 4: { 0: ['resolves', 1] }, 5: { 3: ['trouble', 2] }, 10: { 2: ['resolves', 2] } };

/**
 * Green's script around his stanzas (beat index -> the steps he takes before that stanza): he answers White's hook
 * question (chorus1), asks Pink for the peak's gag (verse2) and closes it (verse2b), answers Gold about the pot.
 */
export const GREEN_STEPS = {
  1: [reply('Black', 2, [['ok', 'Sure, Black, go on'], ['ack', 'Ooh, sneaky. Let me think on it'], ['reasoning', 'A stuck lid slows the soup down'], ['reasoning', 'But we can pop it off later'], ['answer', 'Yes, the lid sticks in this verse']], { verdict: 'accept' }),
    open('Pink', 2, 'Pink, got a minute?', ['The line runs out of view later'], ['What gag tops the peak?'])],
  2: [open('Gray', 3, 'Hey Gray, a quick one?', ['The hook comes back three times'], ['Can the cast sway to it?'])],
  3: [reply('White', 4, [['ok', 'Yes, go on'], ['ack', 'Ooh, a fun question'], ['reasoning', 'Hot is quick and sharp'], ['reasoning', 'Soup is long and warm'], ['answer', 'Land the big chord on soup']])],
  5: [close('Pink', 6, [['agree', 'A puddle slip, yes!'], ['thanks', 'Thanks, Pink, that is funny']]),
    reply('Black', 6, [['ok', 'Go ahead, Black'], ['ack', 'Hmm, a splashy one'], ['reasoning', 'A dropped spoon is funny'], ['reasoning', 'And Purple can lend one back'], ['answer', 'Yes, the spoon falls in']], { verdict: 'accept' })],
  6: [close('Gray', 7, [['agree', 'A slow sway, I love it'], ['thanks', 'Thanks, Gray, my feet agree']])],
  8: [reply('Gold', 9, [['ok', 'Sure thing, Gold'], ['ack', 'Hmm, a big moment'], ['reasoning', 'Inside, nobody sees the soup'], ['reasoning', 'Outside, the whole street gets some'], ['answer', 'Carry it out to the street']])],
};

/**
 * The other roles' scripts (beat numbers 1-based): their work, talk with hand plays, and their consultations'
 * steps; the host's answer carries the work it decides (Blue's light cue, White's chords, Pink's gag).
 */
export const CUES = {
  chords: [
    W(1, 'C major for the street, Blue', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    open('Blue', 1, 'Hey Blue, can I ask?', ['The street is frosty in the plan'], ['Warm light or cool light here?']),
    reply('Gold', 2, [['ok', 'Sure, go ahead'], ['ack', 'Hmm, fair question'], ['reasoning', 'A big band costs a lot of soup'], ['reasoning', 'Two of us can play it soft'], ['answer', 'So the band plays for soup']],
      { chords: ['C', 'F', 'G', 'C'] }),
    close('Blue', 2, [['agree', 'Icy blue it is'], ['thanks', 'Thanks, Blue, that helps!']]),
    reply('Gold', 3, [['followup-answer', 'The bridge is free as well']]),
    open('Green', 4, 'Green, a word about the hook?', ['The hook sings hot soup twice'], ['Which word gets the big chord?']),
    W(4, 'Bright chords for the hook, Pink!', 'conductor', { chords: ['C', 'G', 'Am', 'F'] }),
    close('Green', 5, [['agree', 'Soup it is, then'], ['thanks', 'Thanks, Green, I love it']]),
    W(5, 'A little faster. Hold on, Yellow!', 'count-beats', { chords: ['F', 'G', 'C', 'Am'], consult: ['Yellow'] }),
    W(8, 'Soft minor chords for the memory', 'count-beats', { chords: ['Am', 'F', 'C', 'G'] }),
  ],
  lighting: [
    reply('White', 1, [['ok', 'Ooh, sure thing!'], ['ack', 'Good one, White'], ['reasoning', 'Warm feels cozy, but hides the cold'], ['reasoning', 'Cool shows the frost on the street'], ['answer', 'So icy blue to start']],
      { action: 'lights-cool' }),
    open('Yellow', 3, 'Yellow, help me place the truck?', ['Purple parks his truck here'], ['Where does the truck pull in?']),
    close('Yellow', 3, [['agree', 'Stage left, got it'], ['thanks', 'Thanks, Yellow, you rock']]),
    W(3, 'Ta-da, a gold spot for Purple', 'spot-Purple'), W(6, 'A spot for the slip, coming up!', 'spot-Pink', { consult: ['Pink'] }),
    W(8, 'Shh. Dim and warm for the memory', 'lights-dim'), W(11, 'Ooh, here comes the gold, Gray!', 'lights-gold')],
  dance: [
    W(1, 'Slow steps in, nice and easy', 'enter'),
    reply('Green', 3, [['ok', 'Of course, Green'], ['ack', 'Hmm, let me count it'], ['reasoning', 'A sway is easy on the feet'], ['reasoning', 'A spin would tire them out'], ['answer', 'So a slow sway it is']], { action: 'conga-sway' }),
    W(4, "Let's sway on the hook, side to side", 'conga-sway'),
    open('Yellow', 7, 'Hey Yellow, one thing?', ['The hook comes back here'], ['Is a march too much?']),
    close('Yellow', 7, [['agree', 'A small march works'], ['thanks', 'Thanks, Yellow, good call']]),
    W(11, 'Yes, gold! Then we all bow', 'high-five', { consult: ['Blue'] })],
  deals: [
    open('White', 2, 'White, can we talk money?', ['The diner pays for every bar'], ['Does the band cost us extra?']),
    close('White', 3, [['followup', 'Even in the bridge?']]),
    close('White', 3, [['agree', 'Deal, then'], ['thanks', 'Thank you, White']]),
    reply('Yellow', 8, [['ok', 'Ask away.'], ['ack', 'Fair question'], ['reasoning', 'Sad is too heavy for soup'], ['reasoning', 'Quiet is cheaper and kind']], {}),
    reply('Yellow', 8, [['answer', 'Quiet, not sad']], { action: 'pinky-promise' }),
    open('Green', 9, 'Hey Green, a question', ['The pot is heavy and hot'], ['Do I carry it outside?']),
    close('Green', 9, [['agree', 'Out it goes'], ['thanks', 'Thanks, Green. Good advice']]),
    W(10, 'Free soup? Deal. I shake on it', 'handshake', { consult: ['Purple'], singer: 'Gold' }),
    reply('Pink', 11, [['ok', 'Go on'], ['ack', 'Hmm, a wink'], ['reasoning', 'A wink is free'], ['reasoning', 'Two winks cost extra'], ['answer', 'One wink, no more']], { action: 'handshake' })],
  hype: [
    reply('Blue', 3, [['ok', 'Go for it, Blue!'], ['ack', 'Big question!'], ['reasoning', 'Stage left is close to the pot'], ['reasoning', 'Stage right is far from Gold'], ['answer', 'Stage left, by the diner']], { action: 'binoculars' }),
    W(6, 'Whoa, the secret recipe!', 'binoculars'),
    reply('Gray', 7, [['ok', 'Sure, Gray!'], ['ack', 'Ooh, march talk!'], ['reasoning', 'A march is loud and fun'], ['reasoning', 'But the cast is tired now'], ['answer', 'So a small march, then']], { action: 'stadium-wave' }),
    open('Gold', 8, 'Gold, is now a good time?', ['The bridge is the memory part'], ['Is this the sad bit?']),
    close('Gold', 8, [['agree', 'Quiet it is!'], ['thanks', 'Thanks, Gold!']]),
    W(10, 'Big as a stadium, Gray!', 'high-five', { consult: ['Gray'] })],
  comedy: [
    reply('Green', 5, [['ok', 'Of course, darling'], ['ack', 'A peak needs a big one'], ['reasoning', 'A pie is messy'], ['reasoning', 'A slip is silly and soft'], ['answer', 'I slip on a soup puddle']], { action: 'boing' }),
    W(7, 'Oops! Soup on my nose', 'giggle'),
    open('Gold', 11, 'Gold, one more thing?', ['The song ends with two cooks'], ['Can I wink at the end?']),
    close('Gold', 11, [['agree', 'One wink, deal'], ['thanks', 'Thanks, Gold, you are sweet']])],
  trouble: [
    open('Green', 2, 'Green, I have a soupy scheme', ['The street is cold and hungry'], ['Can the lid stick on the pot?'], 'The lid of the soup pot sticks'),
    close('Green', 3, [['agree', 'A stuck lid it is!'], ['thanks', 'Thanks, Green! You rock']]),
    open('Green', 5, 'Green, one more sneaky idea?', ['Gold is proud of his big spoon'], ['Can the spoon fall in the soup?'], 'Gold drops his spoon in the soup'),
    W(5, 'Ha! I bet nobody opens it, Gray', 'chin-stroke', { singer: 'Purple' }),
    close('Green', 7, [['agree', 'Splash! I love it'], ['thanks', 'Thank you, Green, that is fun']]),
    W(11, 'Fine, you win. Friends now, Gold?', 'pinky-promise', { consult: ['Gold'], singer: 'Purple' })],
};

/** The events of a step, as its role sends them for `beat` (a beat id): one a move, `consult` the other bot. */
export function stepEvents(step, agent, beat) {
  const other = step.to ?? step.from;
  const list = step.moves.map(([move, summary]) => ({ agent, beat, move, summary, consult: [other] }));
  if (step.extra && list.length) Object.assign(list.at(-1), step.extra);
  const q = list.filter((e) => e.move === 'question').at(-1);
  if (step.problem && q) q.problem = step.problem; // (Black's pitched problem on his question)
  return list;
}
/** Every event the fixture sends: Green's lines and steps, the roles' cues and steps. */
export const FIXTURE_EVENTS = LINES.flat().length + Object.values(GREEN_STEPS).flat().reduce((n, s) => n + s.moves.length, 0)
  + Object.values(CUES).flat().reduce((n, c) => n + (c.step ? c.moves.length : 1), 0);
