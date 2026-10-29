// What a cartoon prompt is about: who is named, what they do (the verb) to what (the object noun
// phrase: "hot soup", not "cold" of "on a cold day"), where (the set and its place) and when. Pure.
import { NAMES } from './cast.js';
import { isClean } from './rules.js';
import { syllabify } from '../mv/voice/syllables.js';

const PREPS = new Set('on in at from before behind around for to with by near under over into onto across through after down up past beside inside outside downtown uptown today tonight'.split(' '));
const PARTICLES = new Set(['home', 'up', 'out', 'back', 'away', 'off', 'over', 'along']);
const DETS = new Set(['the', 'a', 'an', 'some', 'his', 'her', 'their', 'its', 'my', 'your', 'this', 'that']);
const TIME_NOUNS = new Set(['day', 'night', 'morning', 'evening', 'afternoon', 'dark', 'dawn', 'dusk', 'noon', 'bedtime', 'lunchtime', 'week', 'weekend', 'sunday', 'saturday', 'winter', 'summer']);
const WEATHER = new Set(['rain', 'snow', 'sun', 'sunshine', 'storm', 'wind', 'fog', 'puddles']);
const COLOURS = new Set(['bright', 'yellow', 'red', 'blue', 'green', 'pink', 'purple', 'orange', 'white', 'black', 'gold', 'silver', 'rainbow']);
/** Verbs that are their own noun: "races Dan" is about the race. */
const VERB_NOUNS = new Set(['race', 'dance', 'walk', 'swim', 'ride', 'picnic', 'party', 'game', 'parade', 'show', 'concert', 'contest']);
// adjectives the lines can leave out (the subject stays itself: "toy box", "birthday cake")
const DROP = /^(biggest|smallest|best|tallest|longest|giant|huge|tiny|very|really|brand|whole|entire)$/;
const MASS = new Set(['soup', 'syrup', 'tea', 'juice', 'paint', 'bread', 'rice', 'water', 'milk', 'honey', 'jam', 'snow', 'sand', 'lunch', 'breakfast', 'dinner', 'music']);
/** Verbs whose prize comes after "for" ("trades lunch for a dinosaur book"). */
const FOR_PRIZE = new Set(['trades', 'swaps', 'trade', 'swap', 'sells', 'buys']);

/** Set keywords (blocking.js sets: the diner, the big house, the street; else the studio). */
export const SET_WORDS = {
  diner: ['lou', 'diner', 'soup', 'pancake', 'pancakes', 'syrup', 'cook', 'cooks', 'cafe', 'waffle', 'waffles', 'pie', 'menu', 'breakfast', 'kitchen', 'chef', 'milkshake'],
  big_house: ['house', 'home', 'garden', 'rooftop', 'roof', 'birthday', 'cake', 'stars', 'star', 'bedroom', 'sleepover', 'backyard', 'yard', 'attic', 'party', 'bath'],
  street: ['street', 'parade', 'race', 'races', 'truck', 'puppy', 'fence', 'lamp', 'streetlamp', 'block', 'park', 'downtown', 'bike', 'road', 'corner', 'sidewalk', 'scooter', 'bus'],
};
/** A set's place when the prompt names none ("at the diner"). */
export const SET_PLACE = { diner: 'at the diner', big_house: 'at the big house', street: 'on the street', studio: 'on the stage' };

const syll = (s) => syllabify(s).length;
const words = (s) => String(s).toLowerCase().match(/[a-z][a-z']*/g) ?? [];
const nameOf = (w) => NAMES.find((n) => n.toLowerCase() === w) ?? null;
const capName = (w) => { const m = /^([a-z]+)('s)?$/.exec(w); const n = m && nameOf(m[1]); return n ? n + (m[2] ?? '') : w; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The base form of a third-person verb ("fixes" -> "fix", "carries" -> "carry", "races" -> "race"). */
export function baseVerb(v) {
  if (!v) return v;
  if (/(ss|sh|ch|x|z)es$/.test(v)) return v.slice(0, -2);
  if (/[^aeiou]ies$/.test(v)) return v.slice(0, -3) + 'y';
  if (/s$/.test(v) && !/ss$/.test(v)) return v.slice(0, -1);
  return v;
}

/** The noun phrase starting at token i (determiner, adjectives, nouns) up to a preposition: [np, next index]. */
function phraseAt(tokens, i) {
  const np = [];
  let j = i;
  while (j < tokens.length && !PREPS.has(tokens[j])) { np.push(tokens[j]); j++; }
  return [np, j];
}

/** Trims a noun phrase to what the lines sing: no determiner, no superlatives, at most 4 syllables (adjectives go first). */
function subjectOf(np) {
  let w = np.filter((x) => !DETS.has(x) && !DROP.test(x) && !/est$/.test(x) && !nameOf(x) && !/^(has|get)$/.test(x)); // ("has" / "get": verbs, never the story's thing)
  while (w.length > 1 && syll(w.join(' ')) > 4) w = w.slice(1);
  return w.join(' ');
}

/**
 * Parse a prompt. Returns { names, verb, verb0, subject, det, plural, place, atPlace, when, sets }:
 *   names    cast members named, in order
 *   verb     the action ("sells"), verb0 its base form ("sell"); null when there is none
 *   subject  the object noun phrase the song is about ("hot soup", "toy box", "dinosaur book")
 *   object   the person acted on when it is a cast member ("races Dan": "Dan")
 *   place    where ("the street", "the rooftop") and atPlace its phrase ("on the street")
 *   when     a time phrase ("a cold day", "before dark") or null
 *   sets     the sets the prompt calls for, in the order it names them (blocking.js), [] for the studio
 */
export function parsePrompt(prompt) {
  const tokens = words(prompt);
  const names = [...new Set(tokens.map(nameOf).filter(Boolean))];
  let i = tokens.findIndex((t) => nameOf(t));
  let verb = null, actor = [];
  if (i >= 0) {
    // the verb: the first word after the name ("learns to share" -> "shares")
    i += 1;
    if (i < tokens.length && !PREPS.has(tokens[i]) && !DETS.has(tokens[i])) verb = tokens[i++];
  } else {
    // nobody named: "A dragon learns to dance" (the verb ends in -s before "to" / a determiner), "The bots build a sandcastle"
    i = 0;
    while (i < tokens.length && DETS.has(tokens[i])) i++;
    const v = tokens.findIndex((t, k) => k > i && /[^s]s$/.test(t) && (tokens[k + 1] === 'to' || DETS.has(tokens[k + 1]) || k === tokens.length - 1));
    const lastDet = tokens.reduce((m, t, k) => (DETS.has(t) && k > i ? k : m), -1);
    const at = v > 0 ? v : lastDet > i + 1 && !PREPS.has(tokens[lastDet - 1]) ? lastDet - 1 : -1;
    if (at > 0) {
      actor = tokens.slice(i, at).filter((t) => !DETS.has(t));
      verb = tokens[at];
      if (!/s$/.test(verb)) verb = `${verb}s`;
      i = at + 1;
    }
  }
  if (verb && tokens[i] === 'to' && tokens[i + 1] && !DETS.has(tokens[i + 1])) { verb = tokens[i + 1].replace(/([^s])$/, '$1s'); i += 2; }
  while (i < tokens.length && PARTICLES.has(tokens[i])) i++;
  let object = null;
  const [np, j] = verb ? phraseAt(tokens, i) : [[], i];
  if (np.length === 1 && nameOf(np[0])) object = nameOf(np[0]);
  let subjectNp = object ? [] : np;
  // a colour after the noun ("paints the fence bright yellow"): the colour is not the subject
  let colour = null;
  const c = subjectNp.findIndex((x, k) => k > 0 && COLOURS.has(x) && !DETS.has(subjectNp[k - 1]));
  if (c > 0 && !COLOURS.has(subjectNp[c - 1])) { colour = subjectNp.slice(c).join(' '); subjectNp = subjectNp.slice(0, c); }
  // the rest: prepositional phrases (a prize after "for", a place, a time, the weather)
  let place = null, atPlace = null, when = null, given = null;
  for (let k = j; k < tokens.length;) {
    const prep = tokens[k];
    if (prep === 'downtown' || prep === 'uptown') { place = prep; atPlace = prep; k++; continue; }
    if (prep === 'today' || prep === 'tonight') { when = when ?? prep; k++; continue; }
    if (!PREPS.has(prep)) { k++; continue; }
    const [pp, next] = phraseAt(tokens, k + 1);
    const head = pp.at(-1);
    if (prep === 'for' && FOR_PRIZE.has(verb) && pp.length) {
      // what is given for the prize ("trades lunch for ..."): the verb's own object
      given = subjectOf(subjectNp) || null;
      subjectNp = pp;
    }
    else if (head && WEATHER.has(head)) when = when ?? `${prep} ${pp.join(' ')}`;
    else if (head && TIME_NOUNS.has(head)) when = when ?? ((prep === 'on' || prep === 'in' || prep === 'at' ? '' : prep + ' ') + pp.join(' ')).trim();
    else if (pp.length && !place && prep !== 'for' && prep !== 'with' && prep !== 'to') {
      // a cast name keeps its capital ("at Lou's diner"), and a place it owns takes no article
      place = pp.filter((x) => !DETS.has(x) || x === 'the').map(capName).join(' ');
      if (!place.startsWith('the ') && !/^[A-Z]/.test(place)) place = `the ${place}`;
      const p = prep === 'from' ? 'on' : prep;
      atPlace = `${p} ${place}`;
    }
    k = Math.max(next, k + 1);
  }
  let subject = subjectOf(subjectNp);
  if (!subject && verb && VERB_NOUNS.has(baseVerb(verb))) subject = baseVerb(verb);
  if (!subject && actor.length) subject = subjectOf(actor);
  if (!subject || !isClean(subject)) subject = '';
  const det = subjectNp.find((x) => DETS.has(x)) ?? null;
  const head = subject.split(' ').at(-1) ?? '';
  const plural = /[^s]s$/.test(head), mass = MASS.has(head);
  const sets = [];
  tokens.forEach((t) => {
    for (const [set, list] of Object.entries(SET_WORDS)) if (list.includes(t) && !sets.includes(set)) sets.push(set);
  });
  const clean = (x) => (x && isClean(x) ? x : null);
  return {
    names, verb: clean(verb), verb0: clean(baseVerb(verb)), subject, det, plural, mass, object, colour: clean(colour), given: clean(given),
    place: clean(place), atPlace: clean(atPlace), when: clean(when), sets,
  };
}

/** A word or phrase with its first letter in capitals. */
export { cap };
