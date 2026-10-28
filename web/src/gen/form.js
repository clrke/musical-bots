// Ported as data from StoryForm.cs: 11-section form and FORM_CHORDS sets.
export const SECTIONS = ['intro', 'verse1', 'verse1b', 'chorus1', 'verse2', 'verse2b', 'chorus2', 'bridge', 'bridge2', 'chorus3', 'outro'];
export const TITLES = {
  intro: 'The street wakes', verse1: 'The setup', verse1b: 'The setup builds', chorus1: 'The hook',
  verse2: 'The problem', verse2b: 'The problem builds', chorus2: 'The hook again', bridge: 'The turn',
  bridge2: 'The turn deepens', chorus3: 'The hook, grown', outro: 'Settle down',
};
export const FORM_CHORDS = {
  'verse:build': { 't-build': ['IV', 'I', 'IV', 'V', 'vi', 'IV', 'ii', 'V'], 't-ramp': ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'V', 'V'], 't-turnaround': ['I', 'vi', 'ii', 'V', 'I', 'vi', 'ii', 'V'], 't-climb': ['I', 'ii', 'iii', 'IV', 'I', 'IV', 'ii', 'V'] },
  'bridge2:suspense': { 't-mount': ['ii', 'iii', 'IV', 'V', 'vi', 'IV', 'II', 'V'], 't-hold': ['V', 'IV', 'V', 'vi', 'V', 'IV', 'II', 'V'], 't-edge': ['IV', 'iv', 'ii', 'V', 'IV', 'iv', 'V', 'V'], 't-false': ['IV', 'V', 'vi', 'IV', 'ii', 'V', 'vi', 'V'] },
  'bridge2:tender': { 't-glow': ['IV', 'V', 'iii', 'vi', 'ii', 'IV', 'I', 'V'], 't-embrace': ['I', 'iii', 'IV', 'I', 'vi', 'IV', 'ii', 'V'], 't-cradle': ['IV', 'I', 'IV', 'vi', 'IV', 'I', 'ii', 'V'], 't-lean': ['vi', 'ii', 'IV', 'I', 'vi', 'ii', 'IV', 'V'] },
};
// Simple sets for the sections the port does not carry (key of C).
export const BASE_SETS = {
  intro: ['I', 'V', 'vi', 'IV'], verse1: ['I', 'vi', 'IV', 'V'], verse2: ['I', 'iii', 'IV', 'V'],
  chorus: ['I', 'V', 'vi', 'IV'], bridge: ['vi', 'IV', 'I', 'V'], outro: ['IV', 'I', 'IV', 'I'],
};
const KEY_C = { I: 'C', ii: 'Dm', iii: 'Em', IV: 'F', V: 'G', vi: 'Am', II: 'D', iv: 'Fm' };
export const toChord = (roman) => KEY_C[roman] ?? 'C';
