// Headless sight-line meter: plays a curated episode the way main.js stages it (collisions.mjs simulate: the blocking,
// the acting, the hand plays, the bots' own update) and, every frame, projects the heads from where the audience sees a
// singer: straight in front of it (its close-up, staging.js viewsOf) and the set's wide cameras. A singer's face (the
// story's line, a harmony, the pal's answers; not the backing hum) counts as hidden from a view when a nearer head covers
// HIDDEN of it (staging.js faceCover). Bots still coming in through a door are not counted (no shot frames them yet), nor a
// parade's marchers (a column on the march: the camera's parade shot tracks the line from its side, main.js).
//
//   node web/sightlines.mjs [slug ...] [--list]
//
// Deterministic (simulate's fixed dt).
import { fileURLToPath } from 'node:url';

const { simulate, headOf, headRadius } = await import('./collisions.mjs');
const { faceCover, viewsOf, HIDDEN } = await import('./src/staging.js');
const { SEEDS } = await import('./src/curated.js');
const THREE = await import('three');

/**
 * Plays one episode. Returns { slug, seconds, singing (singer-seconds), front (singer-seconds hidden from the front view),
 * wide (... from the set's main wide, its first), runs: [{ t0, t1, who, by, view, cover }] (hidden spells, longest first) }.
 */
export async function sightlines(slug, { seconds = Infinity } = {}) {
  const head = new Map();
  let singing = 0, front = 0, wide = 0, frames = 0;
  const open = new Map(), runs = [];
  const note = (now, who, by, view, cover) => {
    const k = `${who}/${view}`;
    const r = open.get(k);
    if (r && now - r.t1 < 0.2) { r.t1 = now; r.cover = Math.max(r.cover, cover); if (!r.by.includes(by)) r.by.push(by); return; }
    const n = { t0: +now.toFixed(2), t1: now, who, by: [by], view, cover };
    open.set(k, n);
    runs.push(n);
  };
  const r = await simulate(slug, {
    seconds,
    each: ({ now, bots, blocking }) => {
      frames++;
      const vis = [...bots.values()].filter((b) => b.group.visible);
      for (const b of vis) head.set(b, headOf(b, head.get(b) ?? new THREE.Vector3()));
      const def = blocking.def;
      const marching = blocking.marchers;
      for (const b of vis) {
        if (!(b.singing > 0) || b.part === 'backing' || blocking.entering(b) || !blocking.inSet || marching?.includes(b)) continue;
        singing += 1 / 30;
        const p = head.get(b), rb = headRadius(b);
        const views = viewsOf(p, def.audience ?? [0, 8], (def.camera?.wide ?? []).slice(0, 1));
        views.forEach((e, k) => {
          let worst = 0, by = null;
          for (const o of vis) {
            if (o === b) continue;
            const c = faceCover(e, p, rb, head.get(o), headRadius(o));
            if (c > worst) { worst = c; by = o.name; }
          }
          if (worst <= HIDDEN) return;
          if (k === 0) front += 1 / 30; else wide += 1 / 30;
          note(now, b.name, by, k === 0 ? 'front' : 'wide', worst);
        });
      }
    },
  });
  for (const x of runs) { x.t1 = +x.t1.toFixed(2); x.cover = +x.cover.toFixed(2); }
  runs.sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0));
  return { slug, seconds: r.seconds, singing: +singing.toFixed(1), front: +front.toFixed(2), wide: +wide.toFixed(2), runs };
}

// --- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const list = args.includes('--list');
  const slugs = args.filter((a) => !a.startsWith('--'));
  const rows = [];
  for (const slug of slugs.length ? slugs : SEEDS.map(([s]) => s)) {
    const s = await sightlines(slug);
    const long = s.runs.filter((x) => x.t1 - x.t0 >= 0.5);
    rows.push({ episode: slug, singing: s.singing, 'front hidden': s.front, 'wide hidden': s.wide, 'spells >= 0.5 s': long.length, longest: long[0] ? `${long[0].t0} ${long[0].who} ${long[0].view} by ${long[0].by.join('+')} ${(long[0].t1 - long[0].t0).toFixed(1)} s` : '' });
    if (list) for (const x of long) console.log(slug, x.t0, '-', x.t1, x.who, x.view, 'by', x.by.join('+'), x.cover);
  }
  console.table(rows);
}
