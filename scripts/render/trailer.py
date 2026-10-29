#!/usr/bin/env python3
"""Trailer cut of a captured episode (scripts/render/capture.mjs run dir), in the style of the Soothing Bots hype
video (~/Projects/unity/magna-vocalization/tools/trailer/assemble.py, same author): the app's own frames and audio,
cut on the sung lines into ~60-75 s, with the title over the opening, short captions (white on a soft dark band,
0.25 s fades), the end card over the finale, a 0.6 s fade out, and the mix mastered to -14 LUFS / -1 dBTP.

  python3 scripts/render/trailer.py <run-dir> <out.mp4> [--sheet] [--makingof <mo-run-dir> [--mo-seconds 8]]

The cut follows the arranged story song in meta.json (window.__mbSong): the typed prompt, the AI crew at work (an
optional making-of run: capture.mjs --makingof --skip S), the intro's first line, two verse lines, two chorus lines
(the harmony), a bridge line, chorus 3's turned line, and the outro's last line + the celebration. Each sung line
keeps the pal's answer: it is cut just before the next line's card comes up.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FFMPEG = "ffmpeg"
RATE = 48000
TARGET_LUFS, TP_MAX = -14.0, -1.0
CARD_LEAD = 0.45  # web/src/sing-plan.js: the card comes up this long before the voice
JOIN = 0.12  # audio crossfade at each cut (equal power), the picture cuts in its middle
TITLE_LINES = ["Musical Bots", "Type a cartoon episode. Sixteen bots sing it.", "Built for the Meta Global AI Hackathon"]
DISCLOSURE = "Every voice is synthesized in the browser from the lyrics. No recordings, no TTS."
CAPTIONS = ["Type a prompt", "Seven AI agents write it", "Every voice is synthesized live", "The cast sings in harmony",
            "A new episode every time"]

FONTS = ["/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
         "/System/Library/Fonts/Helvetica.ttc"]
FONTS_REG = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]


def font(size, bold=True):
    for p in (FONTS if bold else FONTS_REG):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def fit(text, px, bold, max_w):
    f = font(px, bold)
    while px > 10 and ImageDraw.Draw(Image.new("L", (1, 1))).textlength(text, font=f) > max_w:
        px = int(px * 0.94)
        f = font(px, bold)
    return f


def fade(t, t0, t1, f=0.3):
    if t < t0 or t > t1:
        return 0.0
    return max(0.0, min(1.0, (t - t0) / f, (t1 - t) / f))


def text_layer(size, lines, alpha, y_centre, scrim=0.0):
    """Centred lines (text, px, rgb, bold) with a soft drop shadow, over an optional dark scrim."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, int(255 * scrim * alpha)))
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    d, sd = ImageDraw.Draw(layer), ImageDraw.Draw(shadow)
    fonts = [fit(t, px, bold, int(w * 0.86)) for t, px, _, bold in lines]
    heights = [max(1, d.textbbox((0, 0), t or " ", font=f)[3] - d.textbbox((0, 0), t or " ", font=f)[1]) for (t, *_), f in zip(lines, fonts)]
    gap = int(h * 0.018)
    y = int(y_centre - (sum(heights) + gap * (len(lines) - 1)) / 2)
    for (t, px, fill, bold), f, lh in zip(lines, fonts, heights):
        if t:
            bb = d.textbbox((0, 0), t, font=f)
            x = (w - (bb[2] - bb[0])) // 2 - bb[0]
            sd.text((x, y - bb[1] + int(px * 0.05)), t, font=f, fill=(0, 0, 0, int(200 * alpha)))
            d.text((x, y - bb[1]), t, font=f, fill=fill + (int(255 * alpha),))
        y += lh + gap
    return Image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(6)), layer)


def caption_layer(size, text, alpha, y_frac=0.075):
    w, h = size
    px = int(h * 0.062)
    f = fit(text, px, True, int(w * 0.84) - 2 * int(px * 0.7))
    px = f.size
    band = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    bb = d.textbbox((0, 0), text, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x, y = (w - tw) // 2, int(h * y_frac)  # top: the app's own lyric cards sit low in close-ups
    pad_x, pad_y = int(px * 0.7), int(px * 0.38)
    d.rounded_rectangle((x - pad_x, y - pad_y, x + tw + pad_x, y + th + pad_y), radius=int(px * 0.6), fill=(10, 14, 24, int(150 * alpha)))
    band = band.filter(ImageFilter.GaussianBlur(3))
    ImageDraw.Draw(band).text((x - bb[0], y - bb[1]), text, font=f, fill=(255, 255, 255, int(255 * alpha)))
    return band


def section_of(beat):
    m = re.match(r"beat-\d+-([a-z]+)", beat or "")
    return m.group(1) if m else ""


def pick(song):
    """Capture-time segments [((t0, t1), caption)] of the premiere run: whole sung lines with the pal's answer."""
    off = song.get("offset", 0.0)  # a typed opening (capture --typing) plays before song time 0
    leads = sorted((l for l in song["lines"] if l["role"] == "lead"), key=lambda l: l["at"])
    uniq = []  # one per sung line (harmony copies share their lead's start)
    for l in leads:
        if not uniq or l["at"] - uniq[-1]["at"] > 0.05:
            uniq.append(l)
    by = {}
    for l in uniq:
        by.setdefault(l["beat"], []).append(l)
    order = [s["beat"] for s in song["sections"] if s["beat"] in by]
    starts = [l["at"] for l in uniq]

    def until_next(l):  # the line and its answer: up to just before the next line's card (at most 3 s on)
        nxt = [a for a in starts if a > l["at"] + 0.05]
        return min(nxt[0] - CARD_LEAD - 0.25 if nxt else l["end"] + 3.0, l["end"] + 3.0)

    def span(ls):
        return (max(0.0, off + ls[0]["at"] - CARD_LEAD - 0.25), off + until_next(ls[-1]))

    def section(kind, last=False):
        beats = [b for b in order if section_of(b) == kind]
        return by[beats[-1] if last else beats[0]] if beats else []

    segs = [((0.0, off + 1.0), CAPTIONS[0])]  # the prompt typed, Premiere pressed, the first beat
    for ls, cap in ((section("intro")[:1], None), (section("verse")[:2], CAPTIONS[2]), (section("chorus")[:2], CAPTIONS[3]),
                    (section("bridge")[:1], None), (section("chorus", last=True)[-1:], None)):
        if ls:
            segs.append((span(ls), cap))
    outro = section("outro")[-1:]
    if outro:
        segs.append(((span(outro)[0], off + song["end"] + 3.2), CAPTIONS[4]))
    # in song order, no overlaps
    out = []
    for (t0, t1), cap in sorted(segs, key=lambda x: x[0]):
        if out and t0 < out[-1][0][1]:
            t0 = out[-1][0][1]
        if t1 - t0 > 1.0:
            out.append(((t0, t1), cap))
    return out


def master(pcm, out_wav):
    """-> -14 LUFS, true peak <= -1 dBTP (two-pass loudnorm, linear), as the Soothing Bots trailer."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    peak = float(np.max(np.abs(pcm))) or 1.0
    with wave.open(tmp, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(pcm / peak * 0.5, -1, 1) * 32767).astype("<i2").tobytes())
    f = "loudnorm=I=%.1f:TP=%.2f:LRA=30" % (TARGET_LUFS, TP_MAX - 0.6)
    err = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", tmp, "-af", f + ":print_format=json", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    s = err[err.rfind("{"):]
    m = json.loads(s[:s.rfind("}") + 1])
    f2 = f + ":measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true" % (
        m["input_i"], m["input_tp"], m["input_lra"], m["input_thresh"], m["target_offset"])
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af",
                    f2 + ",alimiter=limit=%.4f:level=false" % (10 ** ((TP_MAX - 0.4) / 20)), "-ar", str(RATE), out_wav], check=True)
    os.unlink(tmp)


def main():
    run, out = sys.argv[1], sys.argv[2]
    meta = json.load(open(os.path.join(run, "meta.json")))
    fps, song = meta["fps"], meta.get("song")
    if not song:
        sys.exit("meta.json has no song (capture with a build that sets window.__mbSong)")

    def load(d):
        frames = os.path.join(d, "frames")
        names = sorted(os.listdir(frames))
        return {"frames": frames, "ext": names[0].rsplit(".", 1)[1], "n": len(names),
                "audio": np.fromfile(os.path.join(d, "audio.f32"), dtype="<f4").reshape(-1, 2)}
    runs = {"show": load(run)}
    segs = [("show", t, cap) for t, cap in pick(song)]
    if "--makingof" in sys.argv:  # the crew at work, after the typed prompt
        mo = sys.argv[sys.argv.index("--makingof") + 1]
        secs = float(sys.argv[sys.argv.index("--mo-seconds") + 1]) if "--mo-seconds" in sys.argv else 8.0
        runs["mo"] = load(mo)
        segs.insert(1, ("mo", (0.0, min(secs, runs["mo"]["n"] / fps)), CAPTIONS[1]))

    # picture: frame indices per segment (frame f shows song time f/fps). Audio: each segment's slice, extended
    # JOIN/2 past both cut points and overlap-added with equal-power fades, so the join is centred on the picture cut.
    idx, captions, spans = [], [], []
    for key, (t0, t1), cap in segs:
        f0, f1 = int(round(t0 * fps)), min(runs[key]["n"], int(round(t1 * fps)))
        start = len(idx) / fps
        if cap:
            captions.append({"t0": start + 0.4, "t1": start + min(3.6, (f1 - f0) / fps - 0.3), "text": cap,
                             "end": start + (f1 - f0) / fps, "y": 0.8 if key == "mo" else 0.075})  # the making-of banner owns the top
        idx.extend((key, f) for f in range(f0, f1))
        spans.append((key, int(f0 / fps * RATE), int(f1 / fps * RATE)))
    h = int(JOIN * RATE) // 2
    pcm = np.zeros((sum(b - a for _, a, b in spans) + 2 * h, 2), np.float32)
    pos = 0
    for k, (key, a0, a1) in enumerate(spans):
        audio = runs[key]["audio"]
        piece = np.zeros((a1 - a0 + 2 * h, 2), np.float32)
        lo, hi = max(0, a0 - h), min(len(audio), a1 + h)
        piece[lo - (a0 - h):hi - (a0 - h)] = audio[lo:hi]
        u = np.linspace(0, 1, 2 * h)[:, None]
        if k > 0:
            piece[:2 * h] *= np.sin(u * np.pi / 2)
        else:
            piece[:h] = 0
        if k < len(spans) - 1:
            piece[-2 * h:] *= np.cos(u * np.pi / 2)
        pcm[pos:pos + len(piece)] += piece
        pos += a1 - a0
    pcm = pcm[h:]
    total = len(idx) / fps
    n = int(total * RATE)
    pcm = pcm[:n] if len(pcm) >= n else np.vstack([pcm, np.zeros((n - len(pcm), 2), np.float32)])
    fn = int(0.6 * RATE)
    pcm[-fn:] *= np.linspace(1, 0, fn)[:, None]
    off = song.get("offset", 0.0)
    # with a typed opening the title comes after Premiere is pressed, over the first sung bar
    # the title comes after Premiere is pressed, over the next segment (the crew, else the first sung line)
    title = (off + 0.35, off + 4.55) if off > 0 else (0.0, 4.2)
    if off > 0:  # typed opening: "type a prompt" while it is typed
        captions[0].update(t0=0.6, t1=off - 0.4)
        for c in captions[1:]:  # no caption under the title: it follows it, still ~3 s long
            if c["t0"] < title[1] + 0.2:
                c["t0"] = title[1] + 0.2
                c["t1"] = max(c["t1"], min(c["t0"] + 3.0, c["end"] - 0.3))
    else:
        captions[0]["t0"] = title[1] + 0.2  # the first caption follows the title
    end_t0 = total - 4.0

    tmp = tempfile.mkdtemp(prefix="mb-trailer-")
    wav = os.path.join(tmp, "mix.wav")
    master(pcm, wav)
    print("trailer: %d segments, %.1f s" % (len(segs), total))
    for key, (t0, t1), cap in segs:
        print("  %-4s %6.1f - %6.1f  (%4.1f s)  %s" % (key, t0, t1, t1 - t0, cap or ""))

    enc = subprocess.Popen([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", "%dx%d" % (meta["w"], meta["h"]), "-r", str(fps), "-i", "-", "-i", wav,
                            "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
                            "-tune", "animation", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                            "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    for i, (key, f) in enumerate(idx):
        t = i / fps
        r = runs[key]
        img = Image.open(os.path.join(r["frames"], "f%06d.%s" % (f, r["ext"]))).convert("RGBA")
        size = img.size
        h = size[1]
        if title[0] <= t < title[1]:
            a = min(1.0 if t < title[1] - 0.5 else fade(t, -1, title[1], 0.5), (t - title[0]) / 0.4 if title[0] > 0 else 1.0)
            img = Image.alpha_composite(img, text_layer(size, [
                (TITLE_LINES[0], int(h * 0.11), (255, 255, 255), True),
                (TITLE_LINES[1], int(h * 0.035), (214, 226, 255), True),
                (TITLE_LINES[2], int(h * 0.035), (255, 236, 200), False)], a, h * 0.42, scrim=0.35))
        if t >= end_t0:
            a = min(1.0, (t - end_t0) / 0.6)
            img = Image.alpha_composite(img, text_layer(size, [
                (TITLE_LINES[0], int(h * 0.11), (255, 255, 255), True),
                (TITLE_LINES[1], int(h * 0.035), (214, 226, 255), True),
                (TITLE_LINES[2], int(h * 0.035), (255, 236, 200), False),
                ("", int(h * 0.02), (0, 0, 0), False),
                (DISCLOSURE, int(h * 0.022), (190, 196, 210), False)], a, h * 0.45, scrim=0.62))
        else:
            for c in captions:
                a = fade(t, c["t0"], c["t1"], 0.25)
                if a > 0:
                    img = Image.alpha_composite(img, caption_layer(size, c["text"].upper(), a, c.get("y", 0.075)))
        if t > total - 0.6:
            img = Image.blend(Image.new("RGBA", size, (0, 0, 0, 255)), img, max(0.0, (total - t) / 0.6))
        enc.stdin.write(img.convert("RGB").tobytes())
    enc.stdin.close()
    enc.wait()
    if "--sheet" in sys.argv:
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf",
                        "fps=1/%.3f,scale=480:270,tile=4x4" % (total / 16), "-frames:v", "1", out.rsplit(".", 1)[0] + "-sheet.jpg"])
    print(out)


if __name__ == "__main__":
    main()
