#!/bin/sh
# Frame-exact 1080p30 episode video with audio:
#   [TYPING=1] [RUN_DIR=dir] scripts/render/render-episode.sh "<prompt>" <out.mp4> [env]
# TYPING=1 opens on the prompt being typed (the trailer opening); RUN_DIR keeps the frames for trailer.py.
# Builds web/, serves it on :4180 (unless already up), records every frame on a virtual clock
# through headless GPU Chrome (scripts/render/capture.mjs), renders the Web Audio offline, muxes.
set -e
PROMPT="$1"; OUT="${2:-episode.mp4}"; ENVARG=""; [ -n "$3" ] && ENVARG="--env $3"
RUN="${RUN_DIR:-${TMPDIR:-/tmp}/mb-render/$(date +%s)}"
npm --prefix web run build >/dev/null
SERVER=""
if ! curl -s -o /dev/null http://localhost:4180/; then
  npx --prefix web vite preview web --port 4180 --strictPort >/dev/null 2>&1 & SERVER=$!
  trap '[ -n "$SERVER" ] && kill $SERVER' EXIT
  for i in $(seq 50); do curl -s -o /dev/null http://localhost:4180/ && break; sleep 0.2; done
fi
node scripts/render/capture.mjs --url http://localhost:4180 --prompt "$PROMPT" --out "$RUN" --fmt jpeg $ENVARG ${TYPING:+--typing}
sh scripts/render/mux.sh "$RUN" "$OUT"
echo "$OUT"
