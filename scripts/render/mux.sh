#!/bin/sh
# mux.sh <run-dir> <out.mp4>   frames/f%06d.png @30fps + audio.f32 (48k stereo f32le) -> H.264/AAC
D="$1"; OUT="${2:-$1/episode.mp4}"; FPS=$(python3 -c "import json;print(json.load(open('$D/meta.json'))['fps'])")
ffmpeg -y -hide_banner -loglevel error \
  -framerate "$FPS" -i "$D/frames/f%06d.$(ls "$D/frames" | head -1 | sed "s/.*\.//")" \
  -f f32le -ar 48000 -ac 2 -i "$D/audio.f32" \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -tune animation \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -vf "scale=out_color_matrix=bt709" \
  -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
