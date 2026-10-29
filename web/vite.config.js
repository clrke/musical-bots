// Vite config: the defaults, plus the Muse Code director's LIVE door in `vite dev` (POST /api/direct,
// scripts/director/live.js). `vite build` stays a static site: the plugin only serves in dev, and the
// build drops any local episodes/live runs from dist.
import { defineConfig } from 'vite';
import { directorDev } from '../scripts/director/live.js';

export default defineConfig({
  plugins: [directorDev()],
});
