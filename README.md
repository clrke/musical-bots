# Musical Bots

Type a cartoon episode prompt; a choir of 16 bots performs it as a sung 3D
episode in your browser (Three.js, no VR), including a "making-of"
performance driven by a JSON event protocol.

Built for the Meta Global AI Hackathon. See `docs/PLAN.md` for the build plan.

## Develop

```
nvm use          # Node 22 (see .nvmrc)
cd web && npm install && npm run dev
```

## Layout

- `web/` – Vite + Three.js client (player, generator)
- `director/` – author-time subagent prompts and scripts
- `environments/`, `bots/`, `episodes/` – assets and curated bundles
- `director/protocol.md`, `episodes/sample/` – event protocol and sample bundle (`npm run validate`)

License: MIT
