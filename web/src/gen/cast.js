// Canon cast (docs/CHARACTERS.md in magna-vocalization). Data only.
export const CAST = {
  Teddy: { voice: 'soprano', says: 'Actually', kind: 'hero' },
  Ivy: { voice: 'alto', says: 'Trust me', kind: 'hero' },
  Dan: { voice: 'coach', says: 'One more lap', kind: 'grownup' },
  Nora: { voice: 'alto', says: 'Let me take a look', kind: 'grownup' },
  Lou: { voice: 'old', says: 'That is extra', kind: 'grownup' },
  Pearl: { voice: 'alto', says: 'Of course, darling', kind: 'grownup' },
  Hattie: { voice: 'soprano', says: 'Hold my juice', kind: 'hero' },
  Ray: { voice: 'tenor', says: 'This one has potential', kind: 'grownup' },
  Gigi: { voice: 'soprano', says: 'Who wants a surprise', kind: 'grownup' },
  Vera: { voice: 'alto', says: 'What is the risk', kind: 'grownup' },
  Benny: { voice: 'soprano', says: 'Really? Wow', kind: 'hero' },
  Knox: { voice: 'soprano', says: 'Bet you cannot', kind: 'rival' },
  Constance: { voice: 'alto', says: 'There is a rule for that', kind: 'rival' },
  Sterling: { voice: 'crooner', says: 'Ta-da', kind: 'rival' },
  Murphy: { voice: 'basso', says: 'Just my luck', kind: 'rival' },
  Frankie: { voice: 'robo', says: 'And here it comes', kind: 'grownup' },
};
export const NAMES = Object.keys(CAST);

// Subagent responsibility -> embodying bot.
export const AGENT_BOT = {
  lyrics: 'Teddy', chords: 'Nora', dance: 'Vera', lighting: 'Gigi',
  deals: 'Lou', hype: 'Frankie', comedy: 'Pearl',
};
