// The chord readout (index.html #chords; owner, Nov 5: "Make the chord progression transparent"): the chord sounding now
// and the next one, each its name and its numeral in the key ("C I → Am vi"), and what plays them: the premiere's section,
// its progression, how it is varied (re-harmonized the second time, the last chorus up a step, the bar that pivots there);
// the making-of's warm-up vamp, section, consultation part, work song or filler. Pure (no DOM): main.js writes the html
// when it changes, a frame at most.
import { songChordAt } from './sing-plan.js';
import { romanLabel, sectionLabel, progressionLabel } from './song/form.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The premiere's readout at song time t (an arranged song: sing-plan.js arrange), or null (before the song, after its
 * last chord rang): { now: { name, roman, key }, next: { name, roman, key } | null, label, key }.
 */
export function songReadout(song, t) {
  const c = songChordAt(song, t);
  if (!c) return null;
  const s = c.section;
  const parts = [sectionLabel(s.section), progressionLabel(s.prog)];
  if (s.changed?.length) parts.push('re-harmonized');
  if (s.lift) parts.push(`up a step, in ${s.key}`);
  else if (s.pivot && c.bar >= s.bars - 1) parts.push(`pivot to ${s.pivot}`);
  else parts.push(`in ${s.key}`);
  return { now: c.now, next: c.next, label: parts.join(' · '), key: s.key };
}

/** The making-of's readout at transport time t (a MakingOfScore: its chordInfo a bar), or null past its end. */
export function scoreReadout(score, t) {
  if (!score || !(score.bar > 0) || t < 0 || (score.closed && t > score.end + 0.25)) return null;
  const info = score.chordInfo(Math.floor(t / score.bar + 1e-6));
  return { now: { name: info.name, roman: info.roman, key: 'C' }, next: { ...info.next, key: 'C' }, label: `${info.label} · in C`, key: 'C' };
}

/** The readout's markup (empty: nothing to show). A next chord in another key says so ("G IV in D"); one held on, none. */
export function readoutHtml(r) {
  if (!r?.now) return '';
  const chord = (c, key) => `<b>${esc(c.name)}</b><i>${esc(romanLabel(c.roman))}${c.key && c.key !== key ? ` in ${esc(c.key)}` : ''}</i>`;
  const held = r.next && r.next.name === r.now.name && r.next.roman === r.now.roman && (r.next.key ?? r.key) === (r.now.key ?? r.key);
  const next = r.next && !held ? `<span class="to" aria-hidden="true">→</span><span class="next">${chord(r.next, r.key)}</span>` : '';
  return `<span class="ch"><span class="now">${chord(r.now, r.key)}</span>${next}</span><small>${esc(r.label)}</small>`;
}
