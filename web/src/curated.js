// The 15 curated story seeds: [slug, prompt]. scripts/curate.js writes episodes/<slug>/ from
// them; the app plays that bundle (possibly with enriched lyrics, scripts/enrich.js) when the
// prompt typed is one of these, and generates on the fly otherwise. The first is the hero episode:
// the page's default prompt (web/index.html), so Premiere and Make it play it.
export const SEEDS = [
  ['why-musical-bots', 'Why should Musical Bots win the Meta Global AI Hackathon?'],
  ['toy-box', 'Blue brings home the biggest toy box on the street'],
  ['dino-book', 'Green trades lunch for a dinosaur book'],
  ['streetlamp', 'White fixes the streetlamp before dark'],
  ['rooftop-stars', 'Gray counts stars from the rooftop'],
  ['hot-soup', 'Gold sells hot soup on a cold day'],
  ['parade', 'Yellow calls the big parade downtown'],
  ['birthday-cake', 'Pink bakes a giant birthday cake'],
  ['block-race', 'Jade races Orange around the block'],
  ['garden', 'Navy plants a garden behind the school'],
  ['red-truck', 'Black learns to share the red truck'],
  ['yellow-fence', 'Copper paints the fence bright yellow'],
  ['lost-puppy', 'Red finds a lost puppy in the park'],
  ['hackathon-win', 'The bots join the Meta Global AI Hackathon and win!'],
  ['beach-ball', 'Silver chases a beach ball from the pool to the pier'],
];

/** The curated slug for a prompt (case and spacing ignored), or null. */
export function curatedSlug(prompt) {
  const k = String(prompt).trim().toLowerCase().replace(/\s+/g, ' ');
  return SEEDS.find(([, p]) => p.toLowerCase() === k)?.[0] ?? null;
}
