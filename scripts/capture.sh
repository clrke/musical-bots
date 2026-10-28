#!/bin/sh
# Deterministic demo stills: scripts/capture.sh "<prompt>" <outdir> [base-url] [t ...]
# Needs `npm --prefix web run preview` (or any static server) already running.
# For video, screen-record the Premiere button run (headless Chrome has no audio).
# ENV=<set> (e.g. ENV=big_house) captures against that environment set.
PROMPT="$1"; OUT="${2:-demo}"; BASE="${3:-http://localhost:4173}"; shift 3 2>/dev/null
TIMES="${*:-0 12 30 52 80 110}"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ENC=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$PROMPT")
ENVQ=""; [ -n "$ENV" ] && ENVQ="&env=$ENV"
mkdir -p "$OUT"
for t in $TIMES; do
  "$CH" --headless=new --use-gl=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=3000 \
    --window-size=1280,720 --screenshot="$OUT/t$t.png" "$BASE/?prompt=$ENC&t=$t$ENVQ" >/dev/null 2>&1
  echo "$OUT/t$t.png"
done
