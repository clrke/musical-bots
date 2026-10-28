import { isClean } from './rules.js';

// Lyric templates per section kind. Slots: {hero} {pal} {thing} {rival}.
// Rules: no we/us/our/all, present tense only, nothing menacing.
export const LINES = {
  intro: ['{thing} on the street today!', 'Morning comes to {hero} and {pal}!', 'Listen, {thing} is near!'],
  verse1: ['{hero} finds the {thing} by the gate.', '{pal} peeks and hums a little tune.', '{hero} counts the {thing} twice, then once more.'],
  verse1b: ['{pal} claps the beat, the {thing} bounces high.', '{hero} grins and the {thing} rolls along.', 'Every bot leans in to see the {thing}.'],
  chorus1: ['Sing for the {thing}, loud and bright!', '{thing}, {thing}, spin it round!', 'Hands up high for the {thing}!'],
  verse2: ['{rival} trips and the {thing} slips away.', 'A snag appears, and {hero} frowns.', '{rival} grumbles by the {thing}.'],
  verse2b: ['{pal} checks the plan, the plan is thin.', '{hero} takes a breath and looks around.', 'The {thing} wobbles, and the street holds still.'],
  chorus2: ['Sing for the {thing}, soft and slow!', '{thing}, {thing}, hold it near!', 'Hands in the air for the {thing}!'],
  bridge: ['{hero} stops and listens for one second.', 'Quiet now, the {thing} hums a song.', '{rival} peeks and wants to play.'],
  bridge2: ['{pal} says a kind word, and the air turns warm.', '{rival} steps in, and the {thing} shines.', 'A little help is a big help.'],
  chorus3: ['Sing for the {thing}, {rival} joins in!', '{thing}, {thing}, friends around!', 'Dance with the {thing}, {rival} too!'],
  outro: ['Sleepy {thing}, goodnight.', '{hero} waves, the street goes still.', 'Softly now, the {thing} rests.'],
};

const STOP = new Set('street day today morning the and for with that this from into over home brings bring takes take gets get makes make comes come goes going will have has had was were are his her their its our your you she him them they what when where who how why very just about than then there here some more most much many biggest big little small'.split(' '));

// Pull a singable keyword from the prompt; never lets a banned word through.
export function keywordOf(prompt, names) {
  const words = prompt.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const lowerNames = new Set(names.map((n) => n.toLowerCase()));
  for (const w of words.reverse()) {
    if (!STOP.has(w) && !lowerNames.has(w) && isClean(w)) return w;
  }
  return 'box';
}

export function fill(tpl, slots) {
  const text = tpl.replace(/\{(\w+)\}/g, (_, k) => slots[k]);
  return isClean(text) ? text : text.replace(/[^.!?]*$/, '') || 'La la la!';
}

export function composeLine(section, rng, slots) {
  const kind = LINES[section];
  return fill(rng.pick(kind), slots);
}
