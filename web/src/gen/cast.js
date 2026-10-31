// Canon cast (docs/CHARACTERS.md in magna-vocalization). Data only.
export const CAST = {
  Green: { voice: 'soprano', says: 'Actually', kind: 'hero' },
  Red: { voice: 'alto', says: 'Trust me', kind: 'hero' },
  Orange: { voice: 'coach', says: 'One more lap', kind: 'grownup' },
  White: { voice: 'alto', says: 'Let me take a look', kind: 'grownup' },
  Gold: { voice: 'old', says: 'That is extra', kind: 'grownup' },
  Pink: { voice: 'alto', says: 'Of course, darling', kind: 'grownup' },
  Jade: { voice: 'soprano', says: 'Hold my juice', kind: 'hero' },
  Copper: { voice: 'tenor', says: 'This one has potential', kind: 'grownup' },
  Blue: { voice: 'soprano', says: 'Who wants a surprise', kind: 'grownup' },
  Gray: { voice: 'alto', says: 'What is the risk', kind: 'grownup' },
  Navy: { voice: 'soprano', says: 'Really? Wow', kind: 'hero' },
  Black: { voice: 'soprano', says: 'Bet you cannot', kind: 'rival' },
  Lilac: { voice: 'alto', says: 'There is a rule for that', kind: 'rival' },
  Purple: { voice: 'crooner', says: 'Ta-da', kind: 'rival' },
  Silver: { voice: 'basso', says: 'Just my luck', kind: 'rival' },
  Yellow: { voice: 'robo', says: "And they're off!", kind: 'grownup' },
};
export const NAMES = Object.keys(CAST);

/** The children of the cast (docs/CHARACTERS.md: Green almost four, Navy six, Red nine, Jade, Black next door). */
export const KIDS = ['Green', 'Red', 'Jade', 'Navy', 'Black'];

// Subagent responsibility -> embodying bot. Black (the kid next door who schemes and dares) joined the crew on Nov 1
// as the plot's trouble: the problems that make the story interesting (web/src/plot-trouble.js).
export const AGENT_BOT = {
  lyrics: 'Green', chords: 'White', dance: 'Gray', lighting: 'Blue',
  deals: 'Gold', hype: 'Yellow', comedy: 'Pink', trouble: 'Black',
};
/** The crew of the director's runs before Nov 1 (beats.json without `crew`): the seven roles before Black joined. */
export const LEGACY_CREW = ['lyrics', 'chords', 'dance', 'lighting', 'deals', 'hype', 'comedy'];
