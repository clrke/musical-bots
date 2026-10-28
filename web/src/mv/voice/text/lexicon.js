// Lexicon tables of mumble/text.py (port of csharp/Mumble/Text/Lexicon.cs).
import { dict } from '../phones.js';

/**
 * Exceptions: one token per letter. "-" = silent letter, "+" = same phone as the previous
 * letter, "a,b" = two phones on one letter.
 */
export const EXCEPTIONS = dict({
  the: 'dh + uh',
  a: 'schwa',
  an: 'schwa n',
  i: 'ah-ee',
  you: 'y oo +',
  your: 'y oh + r',
  yours: 'y oh + r z',
  youre: 'y oh + r -',
  to: 't oo',
  do: 'd oo',
  who: 'h - oo',
  whom: 'h - oo m',
  whose: 'h - oo z -',
  whole: 'h - oh l -',
  two: 't - oo',
  into: 'ih n t oo',
  onto: 'aw n t oo',
  one: 'w,uh n -',
  once: 'w,uh n s -',
  come: 'k uh m -',
  some: 's uh m -',
  done: 'd uh n -',
  none: 'n uh n -',
  love: 'l uh v -',
  glove: 'g l uh v -',
  above: 'schwa b uh v -',
  gone: 'g aw n -',
  move: 'm oo v -',
  prove: 'p r oo v -',
  lose: 'l oo z -',
  have: 'h ae v -',
  give: 'g ih v -',
  live: 'l ih v -',
  were: 'w er + -',
  there: 'dh + eh r -',
  theres: 'dh + eh r - z',
  their: 'dh + eh + r',
  theyre: 'dh + eh + r -',
  where: 'w + eh r -',
  wheres: 'w + eh r - z',
  here: 'h ee r -',
  are: 'ah r -',
  said: 's eh + d',
  says: 's eh + z',
  does: 'd uh + z',
  been: 'b ih + n',
  island: 'ah-ee - l schwa n d',
  isle: 'ah-ee - l -',
  was: 'w uh z',
  what: 'w + uh t',
  whats: 'w + uh t s',
  of: 'uh v',
  from: 'f r uh m',
  could: 'k uu + - d',
  would: 'w uu + - d',
  should: 'sh + uu + - d',
  eye: 'ah-ee - -',
  eyes: 'ah-ee - - z',
  bye: 'b ah-ee -',
  buy: 'b ah-ee +',
  laugh: 'l ae + f +',
  enough: 'ih n uh + f +',
  tough: 't uh + f +',
  rough: 'r uh + f +',
  cough: 'k aw + f +',
  people: 'p ee + p schwa,l -',
  again: 'schwa g eh + n',
  against: 'schwa g eh + n s t',
  any: 'eh n ee',
  many: 'm eh n ee',
  every: 'eh v - r ee',
  busy: 'b ih z ee',
  women: 'w ih m ih n',
  woman: 'w uu m schwa n',
  friend: 'f r eh - n d',
  friends: 'f r eh - n d z',
  oh: 'oh -',
  ah: 'ah -',
  aye: 'ah-ee + -',
  key: 'k ee +',
  great: 'g r eh-ee + t',
  break: 'b r eh-ee + k',
  bear: 'b eh + r',
  wear: 'w eh + r',
  pear: 'p eh + r',
  heart: 'h ah + r t',
  broad: 'b r aw + d',
  shoe: 'sh + oo +',
  food: 'f oo + d',
  mood: 'm oo + d',
  foot: 'f uu + t',
  blood: 'b l uh + d',
  flood: 'f l uh + d',
  four: 'f oh + r',
  pour: 'p oh + r',
  court: 'k oh + r t',
  course: 'k oh + r s -',
  through: 'th + r oo + - -',
  though: 'dh + oh + - -',
  although: 'aw l dh + oh + - -',
  touch: 't uh + ch +',
  young: 'y uh + ng +',
  double: 'd uh + b schwa,l -',
  trouble: 't r uh + b schwa,l -',
  country: 'k uh + n t r ee',
  cousin: 'k uh + z schwa n',
  group: 'g r oo + p',
  soup: 's oo + p',
  build: 'b - ih l d',
  built: 'b - ih l t',
  often: 'aw f - schwa n',
  listen: 'l ih s - schwa n',
  hour: '- ah-oo + r',
  honest: '- aw n schwa s t',
  put: 'p uu t',
  sugar: 'sh uu g er +',
  psst: 'p s + t',
  ok: 'oh k,eh-ee',
  okay: 'oh k eh-ee +',
  idea: 'ah-ee d ee schwa',
  area: 'eh r ee schwa',
  quiet: 'k w ah-ee schwa t',
  very: 'v eh r ee',
});

/** Words ending in these keep the irregular vowel ("welcome", "become"). Ordered: first match wins. */
export const SUFFIX_EXCEPTIONS = Object.freeze([
  Object.freeze({ suffix: 'come', spec: 'k uh m -' }),
  Object.freeze({ suffix: 'some', spec: 's uh m -' }),
]);

/** ow read as oh. */
export const OW_OH = new Set([
  'blow', 'blown', 'bowl', 'crow', 'flow', 'glow', 'grow', 'grown',
  'grows', 'know', 'known', 'knows', 'low', 'lower', 'lowest', 'mow',
  'own', 'owned', 'owner', 'owns', 'row', 'show', 'shown', 'shows',
  'slow', 'slower', 'slowly', 'snow', 'sow', 'throw', 'thrown', 'throws',
  'tow',
]);

/** g stays hard before e/i/y. */
export const HARD_G = new Set([
  'anger', 'began', 'begin', 'beginning', 'begins', 'eager', 'finger', 'forget',
  'forgets', 'gear', 'gecko', 'geese', 'get', 'gets', 'getting', 'gift',
  'gifts', 'gig', 'giggle', 'girl', 'girls', 'give', 'given', 'gives',
  'giving', 'hunger', 'linger', 'longer', 'longest', 'stronger', 'strongest', 'target',
  'tiger', 'together', 'younger',
]);

/** ng + hard g. */
export const NG_HARD = new Set([
  'anger', 'angle', 'angry', 'finger', 'hunger', 'hungry', 'jungle', 'linger',
  'longer', 'longest', 'single', 'stronger', 'strongest', 'younger', 'youngest',
]);

/** th voiced. */
export const DH_WORDS = new Set([
  'although', 'another', 'bathe', 'bother', 'breathe', 'brother', 'clothe', 'clothes',
  'either', 'father', 'feather', 'further', 'mother', 'neither', 'other', 'others',
  'rather', 'smooth', 'than', 'that', 'thats', 'the', 'thee', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'therefore', 'theres', 'these',
  'they', 'theyll', 'theyre', 'thine', 'this', 'those', 'thou', 'though',
  'thus', 'thy', 'together', 'weather', 'whether', 'with', 'within', 'without',
]);

/** final s voiced. */
export const Z_AFTER_VOWEL = new Set([
  'as', 'does', 'goes', 'has', 'hers', 'his', 'is', 'ours',
  'says', 'theirs', 'these', 'those', 'was', 'whose', 'yours',
]);

/** s between vowels stays s. */
export const S_BETWEEN_VOWELS = new Set([
  'base', 'basic', 'blouse', 'case', 'cease', 'chase', 'close', 'crisis',
  'dose', 'geese', 'goose', 'grease', 'house', 'lease', 'loose', 'mouse',
  'promise', 'purpose', 'useful', 'usefully', 'vase',
]);

/** ch read as k. */
export const CH_AS_K = new Set([
  'ache', 'anchor', 'chaos', 'character', 'chemistry', 'choir', 'chorus', 'echo',
  'mechanic', 'orchestra', 'scheme', 'school', 'stomach', 'technical',
]);

/** wh read as h. */
export const WH_AS_H = new Set(['who', 'whole', 'wholly', 'whom', 'whose']);

/** ei read as ee. */
export const EI_EE = new Set(['caffeine', 'either', 'neither', 'protein', 'seize', 'weird']);

/** initial h silent. */
export const H_SILENT = new Set(['heir', 'honest', 'honor', 'honour', 'hour', 'hours']);

/** Function words (unstressed, shorter). */
export const FUNCTION_WORDS = new Set([
  'a', 'am', 'an', 'and', 'are', 'as', 'at', 'be',
  'but', 'by', 'can', 'do', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'his', 'i', 'if', 'in', 'is',
  'it', 'its', 'me', 'my', 'not', 'of', 'on', 'or',
  'our', 'she', 'the', 'them', 'they', 'to', 'us', 'was',
  'we', 'were', 'will', 'with', 'you', 'your',
]);

/** Vowel digraphs. */
export const VOWEL_DIGRAPHS = new Set([
  'ai', 'au', 'aw', 'ay', 'ea', 'ee', 'ei', 'eu',
  'ew', 'ey', 'ie', 'oa', 'oe', 'oi', 'oo', 'ou',
  'ow', 'oy', 'ue', 'ui', 'uy',
]);

/** Consonant digraphs. */
export const CONS_DIGRAPHS = new Set(['ch', 'ph', 'sh', 'th']);

/** Legal onset clusters, phones joined with "|". */
export const LEGAL_ONSETS = new Set([
  'b|l', 'b|r', 'b|y', 'd|r', 'd|w', 'f|l', 'f|r', 'f|y',
  'g|l', 'g|r', 'g|w', 'h|y', 'k|l', 'k|r', 'k|w', 'k|y',
  'm|y', 'p|l', 'p|r', 'p|y', 'sh|r', 's|f', 's|k', 's|k|l',
  's|k|r', 's|k|w', 's|l', 's|m', 's|n', 's|p', 's|p|l', 's|p|r',
  's|t', 's|t|r', 's|w', 'th|r', 'th|w', 't|r', 't|w', 'v|y',
]);

/** Primary stress (1-based syllable) where the rules get common words wrong. */
export const STRESS_EXCEPTIONS = dict({
  hello: 2, okay: 2, today: 2, tonight: 2, tomorrow: 2, together: 2,
  toward: 2, towards: 2, because: 2, before: 2, begin: 2, behind: 2,
  believe: 2, between: 2, beyond: 2, below: 2, become: 2, suppose: 2,
  support: 2, supply: 2, until: 2, unless: 2, instead: 2, inside: 2,
  important: 2, computer: 2, complete: 2, correct: 2, forget: 2, forgive: 2,
  perhaps: 2, police: 2, hotel: 2, machine: 2, banana: 2, potato: 2,
  tomato: 2, idea: 2, enough: 2, upon: 2, alone: 2, understand: 3,
  afternoon: 3, engineer: 3, volunteer: 3, kangaroo: 3, guarantee: 3, magazine: 3,
  japanese: 3, chinese: 2, animal: 1, after: 1, able: 1, apple: 1,
  open: 1, other: 1, over: 1, every: 1, evening: 1, even: 1,
  ever: 1, agnes: 1, island: 1, devil: 1, being: 1, total: 1,
  welcome: 1, very: 1, money: 1, people: 1, region: 1, recent: 1,
  decent: 1, benefit: 1, regular: 1, record: 1, rescue: 1, relative: 1,
  remedy: 1, reference: 1, recipe: 1, register: 1, resident: 1, decade: 1,
  delicate: 1, demon: 1, previous: 1, precious: 1, present: 1, pregnant: 1,
  premium: 1, preface: 1, beverage: 1, beacon: 1, regal: 1, reptile: 1,
  pretty: 1, level: 1, medal: 1, relic: 1,
});
