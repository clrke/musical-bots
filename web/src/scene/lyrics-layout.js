// Lyrics panel text layout (pure: the caller passes a `measure(text, fontPx)` function, so the
// same code runs on a canvas in the browser and with a fake measure in the tests).

/**
 * Finds every syllable in the original line so the panel can show the text as written
 * ("I believe in you!") while highlighting syllable by syllable.
 * @param {string} text the line as written
 * @param {Array<{text:string, wordIndex?:number}>} syllables what the synthesizer sings, in order
 * @returns {{ display: string, ranges: Array<[number, number]> }} character ranges into `display`
 *   (end exclusive). Falls back to showing the syllables themselves when they cannot be matched.
 */
export function alignSyllables(text, syllables) {
  const src = typeof text === 'string' ? text.trim() : '';
  const syl = Array.isArray(syllables) ? syllables : [];
  if (!syl.length) return { display: src, ranges: [] };
  const lower = src.toLowerCase();
  const ranges = [];
  let pos = 0;
  let ok = src.length > 0;
  for (let i = 0; i < syl.length && ok; i++) {
    const letters = String(syl[i]?.text ?? '').toLowerCase().replace(/[^a-z0-9']/g, '');
    if (!letters) {
      ok = false;
      break;
    }
    let start = -1;
    let k = 0;
    let j = pos;
    // Match the syllable's letters in order, skipping anything that is not a letter or digit.
    for (; j < lower.length && k < letters.length; j++) {
      const c = lower[j];
      if (c === letters[k]) {
        if (start < 0) start = j;
        k++;
      } else if (/[a-z0-9']/.test(c)) {
        ok = false;
        break;
      }
    }
    if (!ok || k < letters.length) {
      ok = false;
      break;
    }
    ranges.push([start, j]);
    pos = j;
  }
  if (ok) {
    // Hand trailing punctuation to the syllable before it (so "you!" lights up as one).
    for (let i = 0; i < ranges.length; i++) {
      const next = i + 1 < ranges.length ? ranges[i + 1][0] : src.length;
      let end = ranges[i][1];
      while (end < next && /[^\s]/.test(src[end]) && !/[a-z0-9]/i.test(src[end])) end++;
      ranges[i][1] = end;
    }
    return { display: src, ranges };
  }
  // Fallback: rebuild the line from the syllables (words joined, syllables of a word run together).
  let display = '';
  const out = [];
  let lastWord = null;
  syl.forEach((s, i) => {
    const t = String(s?.text ?? '').trim() || '~';
    const word = Number.isInteger(s?.wordIndex) ? s.wordIndex : i;
    if (display && word !== lastWord) display += ' ';
    out.push([display.length, display.length + t.length]);
    display += t;
    lastWord = word;
  });
  return { display, ranges: out };
}

/**
 * Wraps `display` into at most `maxLines` lines no wider than `maxWidth` (px) at the largest font
 * size in [minPx, maxPx] that fits (steps of 1 px). Words are never split; a single word that is
 * too long simply overflows (the panel clips it).
 * @returns {{ fontPx:number, lines: Array<{start:number, end:number, width:number}>,
 *   boxes: Array<{line:number, x0:number, x1:number}> }} boxes are per syllable range, x relative
 *   to the line's left edge.
 */
export function layoutLyrics(display, ranges, measure, { maxWidth, minPx, maxPx, maxLines = 2 }) {
  let best = null;
  for (let px = maxPx; px >= minPx; px--) {
    const lines = wrap(display, measure, px, maxWidth);
    best = { fontPx: px, lines };
    if (lines.length <= maxLines && lines.every((l) => l.width <= maxWidth)) break;
  }
  const { fontPx, lines } = best;
  const boxes = ranges.map(([s, e]) => {
    let li = lines.findIndex((l) => s < l.end || l === lines[lines.length - 1]);
    if (li < 0) li = lines.length - 1;
    const line = lines[li];
    const a = Math.max(s, line.start);
    const b = Math.min(e, line.end);
    const x0 = measure(display.slice(line.start, a), fontPx);
    const x1 = measure(display.slice(line.start, Math.max(a, b)), fontPx);
    return { line: li, x0, x1 };
  });
  return { fontPx, lines, boxes };
}

function wrap(text, measure, px, maxWidth) {
  const lines = [];
  // word boundaries: [start, end) of each word, spaces between
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) words.push([m.index, m.index + m[0].length]);
  if (!words.length) return [{ start: 0, end: 0, width: 0 }];
  let start = words[0][0];
  let end = words[0][1];
  for (let i = 1; i < words.length; i++) {
    const candidateEnd = words[i][1];
    if (measure(text.slice(start, candidateEnd), px) <= maxWidth) {
      end = candidateEnd;
    } else {
      lines.push({ start, end, width: measure(text.slice(start, end), px) });
      start = words[i][0];
      end = words[i][1];
    }
  }
  lines.push({ start, end, width: measure(text.slice(start, end), px) });
  return lines;
}
