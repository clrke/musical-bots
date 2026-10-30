// The offline generator: a cartoon prompt -> a protocol v2 story bundle (beats.json + events), seeded
// by the prompt, zero keys. The seven role bots write the episode (each event's `bot` / `agent`: the
// making-of); the story cast sings it (`singer`): the lead the story, the pal the replies, the
// grown-up and the rival their own lines, the choruses together (`with`). Every action is an id of
// web/src/actions.js; every line passes the lyric rules.
import { makeRng } from './rng.js';
import { CAST, NAMES, AGENT_BOT, KIDS } from './cast.js';
import { SECTIONS, TITLES, chooseStyle, styleRomans, chordName } from './form.js';
import { writeStory, catchphrase, endsKs } from './lyrics.js';
import { parsePrompt, SET_PLACE, cap } from './prompt.js';
import { isClean } from './rules.js';
import { plainLyric } from '../cues.js';
import { resolveAction } from '../actions.js';

const LEADS = ['Green', 'Red', 'Jade', 'Navy'];
const GROWNUPS = NAMES.filter((n) => !KIDS.includes(n));
const RIVALS = ['Black', 'Purple', 'Lilac', 'Silver'];
/** Grown-ups who belong to a set (the diner is Gold's; Pink bakes; Copper and Orange are out on the street). */
const GROWN_BY_SET = { diner: ['Gold', 'Pink'], big_house: ['Pink', 'Blue', 'White', 'Gray'], street: ['Copper', 'Orange', 'Yellow', 'White'], studio: ['Blue', 'Copper', 'Pink', 'Orange'] };

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
/** Each responsibility's actions (web/src/actions.js ids). */
const ACTIONS = {
  lyrics: ['point', 'wave', 'chin-stroke', 'thumbs-up'],
  chords: ['conductor', 'count-beats'],
  dance: ['conga-sway', 'jazz-hands', 'spin', 'stadium-wave', 'march'],
  lighting: ['spot-hero', 'lights-warm', 'lights-gold'],
  deals: ['handshake', 'thumbs-up', 'pinky-promise', 'fist-bump'],
  hype: ['high-five', 'celebrate', 'cheer', 'hand-stack'],
  comedy: ['wink', 'giggle', 'peekaboo', 'boing'],
};
/** The lighting agent's cue by section (the bridges dim, chorus 3 is a party, the outro glows). */
const LIGHT_OF = { intro: 'lights-warm', bridge: 'lights-dim', bridge2: 'lights-night', chorus3: 'lights-party', outro: 'lights-gold' };
const ORDER = ['lyrics', 'chords', 'dance', 'lighting', 'deals', 'hype', 'comedy'];
/** What each section is, in a line (beats.json summaries). */
const STORY = {
  intro: 'The scene: {at}', verse1: '{L} wants {theT}', verse1b: '{R} shows off a bigger one', chorus1: 'The hook: {title}',
  verse2: '{R} tips the big one over', verse2b: '{L} has a plan: share it', chorus2: 'The hook again', bridge: '{G} remembers',
  bridge2: '{G} opens up', chorus3: 'The hook, turned: {G} shares', outro: 'Evening {at}',
};

/** The cast, the prompt's words and the sets an episode is told with. */
export function storyContext(prompt, rng) {
  const p = parsePrompt(prompt);
  const set = p.sets[0] ?? 'studio';
  const kidsNamed = p.names.filter((n) => KIDS.includes(n));
  const adultsNamed = p.names.filter((n) => !KIDS.includes(n));
  // a cast member the prompt names is the lead (a child) or the grown-up; the prompt's action is theirs
  const L = kidsNamed[0] ?? rng.pick(LEADS);
  const grownPool = (GROWN_BY_SET[set] ?? GROWNUPS).filter((n) => n !== L);
  const G = adultsNamed[0] ?? rng.pick(grownPool);
  const doerName = p.names[0] ?? G;
  const D = doerName === L ? L : G;
  const named = new Set([L, G]);
  // the rival is a show-off (Black next door, Purple the showman), else the neighbour or the unlucky one
  const showOffs = ['Black', 'Purple'].filter((n) => !named.has(n));
  const rivals = showOffs.length ? showOffs : RIVALS.filter((n) => !named.has(n));
  const R = p.names.find((n) => RIVALS.includes(n) && !named.has(n)) ?? kidsNamed.find((n) => !named.has(n)) ?? rng.pick(rivals);
  const pals = KIDS.filter((n) => n !== L && n !== R && n !== 'Black');
  const P = p.names.find((n) => KIDS.includes(n) && n !== L && n !== R) ?? rng.pick(pals.length ? pals : KIDS.filter((n) => n !== L && n !== R));
  // the choir: who sings the choruses with the lead (a voice that fits the tune: an alto, a soprano, the tenor)
  const roles = new Set([L, P, G, R]);
  const choir = NAMES.filter((n) => !roles.has(n) && ['alto', 'soprano', 'tenor'].includes(CAST[n].voice));
  const T = p.subject || 'big surprise';
  const theT = /^the /.test(T) ? T : `the ${T}`;
  const aT = p.det === 'a' || p.det === 'an' ? `${/^[aeiou]/.test(T) ? 'an' : 'a'} ${T}` : p.det ? `the ${T}` : T;
  return {
    prompt: p, set, sets: p.sets.length ? p.sets : ['studio'], L, P, G, R, D, doerIsLead: D === L && D !== G, doerIsGrown: D === G,
    object: p.object && p.object !== D ? p.object : null, given: p.given, T, theT, aT, ks: endsKs(T), plural: p.plural, mass: p.mass,
    verb: p.verb, verb0: p.verb0,
    at: p.atPlace ?? SET_PLACE[set], when: p.when, cL: catchphrase(L), cP: catchphrase(P), cG: catchphrase(G), cR: catchphrase(R),
    choir: [rng.pick(choir), ...choir].filter((n, i, a) => a.indexOf(n) === i), tag: null,
  };
}

/** The set each section plays on: the prompt's first set; a second one it names from verse B on (the story moves). */
function setOf(c, i) {
  return c.sets.length > 1 && i >= SECTIONS.indexOf('verse2') ? c.sets[1] : c.sets[0];
}

const fillText = (tpl, slots) => tpl.replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? k);

export function generate(prompt, { id } = {}) {
  const clean = String(prompt).trim() || 'A big day on the street';
  const rng = makeRng(clean);
  const c = storyContext(clean, rng);
  const tag = rng() < 0.5 ? 'suspense' : 'tender';
  c.tag = tag;
  const outroTag = /\b(night|dark|stars?|moon|bedtime|sleep)\b/i.test(clean) ? 'soft' : 'conclusive';
  const seed = `gen-${(id ?? clean).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;
  const story = writeStory(c, rng);
  const style = chooseStyle(seed, { bridge: tag, outro: outroTag });
  const slots = { L: c.L, G: c.G, R: c.R, P: c.P, theT: c.theT, at: c.at, title: story.title };

  const beats = SECTIONS.map((section, i) => ({
    id: `beat-${i + 1}-${section}`,
    title: TITLES[section],
    section,
    set: setOf(c, i),
    cast: [...new Set([c.L, c.P, c.G, c.R, ...(section.startsWith('chorus') ? c.choir.slice(0, 1) : [])])],
    summary: fillText(STORY[section], slots),
  }));

  const events = [];
  let t = 0;
  SECTIONS.forEach((section, i) => {
    const beat = beats[i].id;
    const chords = styleRomans(style, section).map(chordName);
    const lines = story.sections[section];
    // each line is a role bot's work: the lyricist, the arranger, then two rotating responsibilities
    const agents = ['lyrics', 'chords', ORDER[2 + (i % 5)], ORDER[2 + ((i + 2) % 5)]];
    lines.forEach((line, k) => {
      const agent = agents[k % agents.length];
      const bot = AGENT_BOT[agent];
      const consulting = agent === 'chords' && i % 3 === 1;
      const status = consulting ? 'consulting' : agent === 'lyrics' ? 'proposing' : 'working';
      const summary = fillText(rng.pick(SUMMARY[agent]), { bot, section: TITLES[section].toLowerCase() });
      let action = agent === 'lighting' ? LIGHT_OF[section] ?? rng.pick(ACTIONS.lighting) : rng.pick(ACTIONS[agent]);
      if (resolveAction(action).kind === 'none') action = '';
      const lyric = isClean(plainLyric(line.lyric)) ? line.lyric : 'La, la, la, la, la!';
      const e = {
        seq: events.length, t: Number(t.toFixed(1)), agent, bot, status, beat, summary, lyric, chords, action,
        consult: consulting ? [AGENT_BOT.lyrics] : [], singer: line.singer,
      };
      if (line.with?.length) e.with = line.with;
      events.push(e);
      t += 2 + Math.floor(rng() * 2);
    });
  });
  events[events.length - 1].status = 'done';
  return {
    beats: {
      version: 2, prompt: clean, seed, title: cap(story.title),
      roles: { lead: c.L, pal: c.P, grown: c.G, rival: c.R }, tags: { bridge: tag, outro: outroTag }, beats,
    },
    events,
  };
}

export const toNdjson = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
