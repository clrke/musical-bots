// Mechanical lyric rules (mirrors scripts/validate-bundle.js, plus contractions). The cast sings
// together, so "we", "us" and "our" are welcome (banned until Oct 30; the crew now favours "we");
// the other rules stand: the plain present, no brands, nothing menacing.
const FUTURE = /\bwill\b|\bgoing to\b|'ll\b/i;
const BRANDS = /\b(disney|pixar|lego|nike|coca-cola|pepsi|mcdonald'?s|google|apple|netflix|barbie)\b/i;
const MENACE = /\b(kill|die|dead|blood|gun|knife|scary|monster|hurt|fight|war)\b/i;
export function lyricProblems(text) {
  const p = [];
  if (FUTURE.test(text)) p.push('future tense');
  if (BRANDS.test(text)) p.push('brand');
  if (MENACE.test(text)) p.push('menace');
  return p;
}
export const isClean = (text) => lyricProblems(text).length === 0;
