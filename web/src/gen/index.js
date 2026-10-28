import { makeRng } from './rng.js';
import { CAST, NAMES, AGENT_BOT } from './cast.js';
import { SECTIONS, TITLES, FORM_CHORDS, BASE_SETS, toChord } from './form.js';
import { composeLine, keywordOf, fill } from './lyrics.js';
import { isClean } from './rules.js';

const RIVALS = ['Knox', 'Constance', 'Sterling', 'Murphy'];
const HEROES = ['Teddy', 'Ivy', 'Hattie', 'Benny'];

// Summaries per responsibility; present tense, singable, rule-clean.
const SUMMARY = {
  lyrics: ['{bot} writes the line for {section}', '{bot} fits the words to the beat'],
  chords: ['{bot} picks the chords for {section}', '{bot} tunes the band to the key'],
  dance: ['{bot} draws the steps for {section}', '{bot} counts the moves in eights'],
  lighting: ['{bot} sets the glow for {section}', '{bot} warms the stage lights'],
  deals: ['{bot} trims the budget for {section}', '{bot} haggles for the props'],
  hype: ['{bot} calls the play for {section}', '{bot} rallies the crowd'],
  comedy: ['{bot} adds a gag to {section}', '{bot} tickles the room with a joke'],
};
const ACTIONS = {
  lyrics: ['point-at-gate', 'sing-solo'], chords: ['strum-air', 'conduct'], dance: ['march-parade', 'spin-step'],
  lighting: ['dim-lights-gold', 'spot-hero'], deals: ['count-coins', 'shake-hands'], hype: ['huddle-up', 'cheer-jump'],
  comedy: ['pratfall', 'wink'],
};
const ORDER = ['lyrics', 'chords', 'dance', 'lighting', 'deals', 'hype', 'comedy'];

function chordsFor(section, rng, tag) {
  if (section === 'verse1b' || section === 'verse2b') return pickSet(FORM_CHORDS['verse:build'], rng);
  if (section === 'bridge2') return pickSet(FORM_CHORDS[`bridge2:${tag}`], rng);
  const base = section.startsWith('chorus') ? 'chorus' : section.replace(/\d$/, '');
  return BASE_SETS[base] ?? BASE_SETS.verse1;
}
function pickSet(sets, rng) {
  return sets[rng.pick(Object.keys(sets))];
}

export function generate(prompt, { id } = {}) {
  const clean = String(prompt).trim() || 'A big day on the street';
  const rng = makeRng(clean);
  const mentioned = NAMES.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(clean));
  const hero = mentioned.find((n) => CAST[n].kind === 'hero') ?? rng.pick(HEROES);
  const rival = mentioned.find((n) => CAST[n].kind === 'rival') ?? rng.pick(RIVALS);
  const pal = rng.pick(NAMES.filter((n) => n !== hero && n !== rival && !Object.values(AGENT_BOT).includes(n)).concat(['Frankie']));
  const thing = keywordOf(clean, NAMES);
  const slots = { hero, pal, rival, thing };
  const tag = rng() < 0.5 ? 'suspense' : 'tender';
  const seed = `gen-${(id ?? clean).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;

  const beats = SECTIONS.map((section, i) => ({
    id: `beat-${i + 1}-${section}`,
    title: TITLES[section],
    section,
    cast: [...new Set([hero, pal, rival, ...(section.startsWith('chorus') ? NAMES.slice(0, 4) : [])])],
    summary: fill(`${hero} and the ${thing}: ${TITLES[section].toLowerCase()}`, slots),
  }));

  const events = [];
  let t = 0;
  SECTIONS.forEach((section, i) => {
    const beat = beats[i].id;
    const chords = chordsFor(section, rng, tag).map(toChord);
    // Each beat gets lyrics + chords, plus 1-2 rotating responsibilities.
    const extras = [ORDER[2 + (i % 5)], ORDER[2 + ((i + 2) % 5)]].slice(0, 1 + (i % 2));
    for (const agent of ['lyrics', 'chords', ...extras]) {
      const bot = AGENT_BOT[agent];
      const consulting = agent === 'chords' && i % 3 === 1;
      const status = consulting ? 'consulting' : agent === 'lyrics' ? 'proposing' : 'working';
      const lyric = composeLine(section, rng, slots);
      const summary = fill(rng.pick(SUMMARY[agent]).replace('{bot}', bot).replace('{section}', TITLES[section].toLowerCase()), slots);
      events.push({
        seq: events.length, t: Number(t.toFixed(1)), agent, bot, status, beat, summary,
        lyric: isClean(lyric) ? lyric : 'La la la!',
        chords: agent === 'lighting' || agent === 'deals' ? [] : chords,
        action: rng.pick(ACTIONS[agent]),
        consult: consulting ? [AGENT_BOT.lyrics] : [],
      });
      t += 2 + Math.floor(rng() * 2);
    }
    const lastBot = events[events.length - 1].bot;
    events[events.length - 1].status = i === SECTIONS.length - 1 ? 'done' : events[events.length - 1].status;
    void lastBot;
  });
  return { beats: { prompt: clean, seed, beats }, events };
}

export const toNdjson = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
