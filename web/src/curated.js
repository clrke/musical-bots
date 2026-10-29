// The 13 curated story seeds: [slug, prompt]. scripts/curate.js writes episodes/<slug>/ from
// them; the app plays that bundle (possibly Fireworks-enriched, scripts/enrich.js) when the
// prompt typed is one of these, and generates on the fly otherwise.
export const SEEDS = [
  ['toy-box', 'Gigi brings home the biggest toy box on the street'],
  ['dino-book', 'Teddy trades lunch for a dinosaur book'],
  ['streetlamp', 'Nora fixes the streetlamp before dark'],
  ['rooftop-stars', 'Vera counts stars from the rooftop'],
  ['hot-soup', 'Lou sells hot soup on a cold day'],
  ['parade', 'Frankie calls the big parade downtown'],
  ['birthday-cake', 'Pearl bakes a giant birthday cake'],
  ['block-race', 'Hattie races Dan around the block'],
  ['garden', 'Benny plants a garden behind the school'],
  ['red-truck', 'Knox learns to share the red truck'],
  ['yellow-fence', 'Ray paints the fence bright yellow'],
  ['lost-puppy', 'Ivy finds a lost puppy in the park'],
  ['hackathon-win', 'The bots join the Meta Global AI Hackathon and win!'],
];

/** The curated slug for a prompt (case and spacing ignored), or null. */
export function curatedSlug(prompt) {
  const k = String(prompt).trim().toLowerCase().replace(/\s+/g, ' ');
  return SEEDS.find(([, p]) => p.toLowerCase() === k)?.[0] ?? null;
}
