#!/usr/bin/env python3
"""Trailer cut of a captured episode (scripts/render/capture.mjs run dir), in the style of the Soothing Bots hype
video (~/Projects/unity/magna-vocalization/tools/trailer/assemble.py, same author): the app's own frames and audio,
cut on whole song sections (their bar lines) into ~3 min (--lines: the old ~66 s cut on single lines), with the title over the opening, short captions (white on a soft dark band,
0.25 s fades), the end card over the finale, a 0.6 s fade out, and the mix mastered to -14 LUFS / -1 dBTP.

  python3 scripts/render/trailer.py <run-dir> <out.mp4> [--sheet] [--makingof <mo-run-dir> [--mo-budget 75 | --mo-seconds 8]]
    (a making-of run with meta.makingOf items is cut on whole sung phrases: thoughts, duets, lines)
    [--sections intro,verse1b,...] (whole sections, cut on their bar lines: the default, ~2:50) [--lines] (the old ~66 s cut)

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
# with the crew's sung making-of in front (the main show), the premiere keeps its story's peaks
SECTIONS_AFTER_MO = [("chorus1", "Then the cast sings the episode"), ("verse1b", "Then the cast sings the episode"),
                     ("verse2b", "Heads and hands act every line"), ("chorus3", "The cast sings in harmony"),
                     ("outro", "A new episode every time")]
MAX_TOTAL = 175.0  # seconds: a demo video under 3 minutes
# the default cut: whole song sections, cut on their bar lines (a section's own downbeat), ~2:50 with the
# typed prompt and the crew at work; the captions they carry (None: no caption)
SECTIONS = [("intro", None), ("verse1b", "Every voice is synthesized live"), ("verse2", "Heads and hands act every line"),
            ("verse2b", None), ("bridge2", None), ("chorus3", "The cast sings in harmony"), ("outro", "A new episode every time")]

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


def section_name(beat):
    m = re.match(r"beat-\d+-([a-z0-9]+)", beat or "")
    return m.group(1) if m else ""


def pick_sections(song, wanted):
    """Capture-time segments [((t0, t1), caption)]: whole sections, from a section's start to the next's (the
    outro to the song's end + the celebration). Consecutive sections join into one segment (no cut between)."""
    off = song.get("offset", 0.0)
    secs = song["sections"]
    segs = [((0.0, off), [(0.0, CAPTIONS[0])])]  # the prompt typed, Premiere pressed
    for name, cap in wanted:
        i = next((k for k, x in enumerate(secs) if section_name(x["beat"]) == name), None)
        if i is None:
            continue
        t0 = off + secs[i]["t"]
        t1 = off + (secs[i + 1]["t"] if i + 1 < len(secs) else song["end"] + 3.2)
        caps = [(0.0, cap)] if cap else []
        if len(segs) > 1 and abs(segs[-1][0][1] - t0) < 0.01:  # the next section: no cut, one segment
            (a, b), c = segs[-1]
            segs[-1] = ((a, t1), c + [(b - a + rel, x) for rel, x in caps])
            continue
        segs.append(((t0, t1), caps))
    return [x for x in segs if x[0][1] - x[0][0] > 1.0]


MO_CAPTIONS = {"thought": "Each AI agent sings its thinking", "duet": "They consult each other, in song",
               "line": "The song takes shape, line by line"}


CADENCE_REACH = 2.75  # s: a stretch ends on its section's cadence when one is this near its planned cut (~2 s: the one phrase
# left before it, 2.3-2.7 s in the double-time score, may join)


def cadence_end(t0, t1, items, sections, reach=None):
    """The end of a making-of section (its cadence: the score fits every section to end as its function set does, V7
    -> I or a half cadence on V) within `reach` s of a stretch's planned end t1, to cut there instead (QA v14: a cut
    mid-progression sounds chopped). Only where no sung phrase straddles it (whole phrases), at least 3 s after t0;
    a cadence home on I first, then the nearest. None when there is none."""
    reach = CADENCE_REACH if reach is None else reach
    best = None
    for sec in sections or []:
        e = sec.get("t1")
        if e is None or abs(e - t1) > reach or e - t0 < 3.0:
            continue
        # (a pickup into the next section, sung in its last beat, is the next section's: the cut comes before it)
        if any(it["t0"] < e - 0.6 and it["t1"] > e + 0.3 for it in items):
            continue
        # cutting earlier drops the phrases after it: never a part of a duet (its answer, its seal)
        if e < t1 and any(it["t0"] >= e - 0.05 and it["t1"] <= t1 + 0.01 and it["kind"] in ("question", "answer", "gesture") for it in items):
            continue
        home = (sec.get("romans") or [""])[-1] == "I"
        key = (0 if home else 1, abs(e - t1))
        if best is None or key < best[0]:
            best = (key, e)
    return best[1] if best else None


def pick_makingof(mo, budget=85.0, fps=30):
    """Making-of segments [((t0, t1), [(offset, caption)])] in capture time: whole stretches of the crew's sung
    work, cut between phrases (meta.makingOf.items: {t0, t1, bot, agent, beat, kind: thought|line|question|answer|
    gesture, consultSeq}). In priority order, within `budget` seconds: the opening (the first ~12 s), every
    consultation duet (its question, the answer, the hand play that seals it and the line that follows in its
    beat), then the fullest beats (most of Green's lines among the crew's thoughts); shown in time order. A stretch
    ends on its section's cadence when one is within CADENCE_REACH s of its cut (cadence_end)."""
    items = sorted(mo.get("items", []), key=lambda x: x["t0"])
    if not items:
        return []
    start = items[0]["t0"]
    cands = []
    opening = [it for it in items if it["t1"] - start <= 13.0] or items[:1]
    cands.append((opening[0]["t0"], opening[-1]["t1"]))
    duets = {}
    for it in items:
        if it.get("consultSeq") is not None:
            duets.setdefault(it["consultSeq"], []).append(it)
    for k in sorted(duets, key=lambda k: min(d["t0"] for d in duets[k])):
        ds = duets[k]
        if not any(d["kind"] == "question" for d in ds):
            continue
        t0, t1 = min(d["t0"] for d in ds), max(d["t1"] for d in ds)
        beat = ds[0].get("beat")
        after = [it for it in items if it["t0"] >= t1 - 0.05 and it.get("beat") == beat and it.get("consultSeq") is None]
        if after and after[0]["kind"] == "line" and after[0]["t0"] - t1 < 0.8:
            t1 = after[0]["t1"]  # what the duet leads to: the line it settles
        cands.append((t0, t1))
    beats = {}
    for it in items:
        beats.setdefault(it.get("beat"), []).append(it)
    full = sorted(beats.values(), key=lambda b: (-sum(1 for x in b if x["kind"] == "line"), -len(b), b[0]["t0"]))
    for b in full:
        cands.append((b[0]["t0"], b[-1]["t1"]))
    chosen = []
    used = 0.0

    def covered(t0, t1):
        return sum(max(0.0, min(t1, b) - max(t0, a)) for a, b in chosen)

    for t0, t1 in cands:
        extra = (t1 - t0) - covered(t0, t1)
        if extra <= 0.5:
            continue
        if used + extra > budget:
            # a beat too long for what is left: its first whole phrases that fit
            room = budget - used
            if room < 6.0:
                continue
            # the whole phrases from its start up to the first that does not fit, less any that overlaps that one
            # (a double-time score packs the phrases: a gesture can still be sealing when the next thought starts)
            limit = min(t0 + room, t1) + 1e-6
            run_ = [it for it in items if it["t0"] >= t0 - 1e-6 and it["t0"] < t1]
            k = next((i for i, it in enumerate(run_) if it["t1"] > limit), len(run_))
            fit, stop = run_[:k], (run_[k]["t0"] if k < len(run_) else float("inf"))
            while fit and max(it["t1"] for it in fit) > stop + 0.02:
                fit.pop()
            if not fit:
                continue
            t1 = max(it["t1"] for it in fit)
            extra = (t1 - t0) - covered(t0, t1)
        chosen.append((t0, t1))
        used += extra
    # union in time order (stretches that touch or nearly touch play as one)
    chosen.sort()
    spans = []
    for t0, t1 in chosen:
        # the card comes up before the voice; the last note rings; but never into a neighbouring phrase (at most to
        # the middle of the gap: the double-time score leaves ~0.5 s between phrases)
        while True:  # whole phrases: a phrase that straddles an end (a seal still ringing as a thought starts) joins
            out = [it for it in items if (it["t0"] < t0 - 0.01 < it["t1"] - 0.02) or (it["t0"] + 0.02 < t1 + 0.01 < it["t1"])]
            if not out:
                break
            t0, t1 = min([t0] + [it["t0"] for it in out]), max([t1] + [it["t1"] for it in out])
        prev = max((it["t1"] for it in items if it["t1"] <= t0 + 0.01), default=-1e9)
        # end on the section's cadence when one is near (the phrases up to it, whole; the chord rings to its bar line)
        e = cadence_end(t0, t1, items, mo.get("sections"))
        if e is not None:
            last = max([it["t1"] for it in items if it["t0"] >= t0 - 0.01 and it["t0"] < e - 0.6 and it["t1"] <= e + 0.3] or [t0])
            nxt = min((it["t0"] for it in items if it["t0"] >= e - 0.6), default=1e9)
            t0, t1 = max(0.0, t0 - 0.35, (prev + t0) / 2), max(last, min(e + 0.3, (last + nxt) / 2))
        else:
            nxt = min((it["t0"] for it in items if it["t0"] >= t1 - 0.01), default=1e9)
            t0, t1 = max(0.0, t0 - 0.35, (prev + t0) / 2), min(t1 + 0.45, (t1 + nxt) / 2)
        if spans and t0 <= spans[-1][1] + 0.6:
            spans[-1][1] = max(spans[-1][1], t1)
        else:
            spans.append([t0, t1])
    # captions: each over the first phrase it names, once each; a long stretch (the opening joined to a duet) can
    # carry several, in time order, at least 5 s apart. "line by line" waits for a stretch after the thinking's.
    segs, shown = [], set()
    for t0, t1 in spans:
        inside = [it for it in items if it["t0"] >= t0 - 0.01 and it["t1"] <= t1 + 0.01]
        kinds = [it["kind"] for it in inside]
        want = []
        if "thought" not in shown:
            want.append("thought")
        if "question" in kinds and "duet" not in shown:
            want.append("duet")
        if kinds.count("line") >= 2 and "line" not in shown and "thought" in shown:
            want.append("line")
        found = []
        for kind in want:
            name = {"duet": "question", "line": "line", "thought": "thought"}[kind]  # the caption over what it names
            first = next((it for it in inside if it["kind"] == name), None)
            if first or kind == "thought":
                found.append((max(0.0, (first["t0"] if first else t0) - t0), kind))
        caps = []
        for rel, kind in sorted(found):
            if caps and rel - caps[-1][0] < 5.0:
                continue
            shown.add(kind)
            caps.append((rel, MO_CAPTIONS[kind]))
        segs.append(((t0, t1), caps))
    return segs


def pick_after_mo(song, budget):
    """The premiere's peaks after a making-of: the finale (chorus3 + outro) always, then verse2b, verse1b, chorus1
    while they fit in `budget` seconds; in song order, each with its caption."""
    off, secs = song.get("offset", 0.0), song["sections"]
    def span(name):
        i = next((k for k, x in enumerate(secs) if section_name(x["beat"]) == name), None)
        if i is None:
            return None
        return (off + secs[i]["t"], off + (secs[i + 1]["t"] if i + 1 < len(secs) else song["end"] + 3.2))
    caps = dict(SECTIONS_AFTER_MO)
    picked, used = [], 0.0
    for name in ["chorus3", "outro", "verse2b", "verse1b", "chorus1"]:
        sp = span(name)
        if not sp:
            continue
        if name not in ("chorus3", "outro") and used + (sp[1] - sp[0]) > budget:
            continue
        picked.append((sp, name))
        used += sp[1] - sp[0]
    picked.sort()
    segs = [((0.0, off), [(0.0, CAPTIONS[0])])]
    for k, ((t0, t1), name) in enumerate(picked):
        text = "Then the cast sings the episode" if k == 0 else caps.get(name)  # the turn from the crew to the show
        cap = [(0.0, text)] if text else []
        if len(segs) > 1 and abs(segs[-1][0][1] - t0) < 0.01:
            (a, b), c = segs[-1]
            segs[-1] = ((a, t1), c + [(b - a + rel, x) for rel, x in cap])
        else:
            segs.append(((t0, t1), cap))
    return segs


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
    mo_segs, mo_meta = [], {}
    if "--makingof" in sys.argv:  # the crew at work, after the typed prompt
        mo = sys.argv[sys.argv.index("--makingof") + 1]
        runs["mo"] = load(mo)
        mo_meta = json.load(open(os.path.join(mo, "meta.json"))).get("makingOf") or {}
        budget = float(sys.argv[sys.argv.index("--mo-budget") + 1]) if "--mo-budget" in sys.argv else 85.0
        if mo_meta.get("items") and "--mo-seconds" not in sys.argv:
            mo_segs = pick_makingof(mo_meta, budget, fps)
    if "--lines" in sys.argv:  # the old ~66 s cut: one or two lines per section
        segs = [("show", t, cap) for t, cap in pick(song)]
    elif "--sections" in sys.argv:
        names = sys.argv[sys.argv.index("--sections") + 1].split(",")
        caps = {**dict(SECTIONS), **dict(SECTIONS_AFTER_MO)}
        segs = [("show", t, cap) for t, cap in pick_sections(song, [(n, caps.get(n)) for n in names])]
    elif mo_segs:  # the making-of leads: the premiere's peaks in what is left of MAX_TOTAL
        mo_len = sum(t1 - t0 for (t0, t1), _ in mo_segs) + float(mo_meta.get("offset", 0) or song.get("offset", 0))
        segs = [("show", t, cap) for t, cap in pick_after_mo(song, MAX_TOTAL - mo_len)]
    else:
        segs = [("show", t, cap) for t, cap in pick_sections(song, SECTIONS)]
    if "--makingof" in sys.argv:
        if mo_segs:  # the crew's sung thinking, whole stretches
            if mo_meta.get("offset", 0) > 0:  # the making-of run opens on the prompt typed and Make it pressed
                segs[0] = ("mo", (0.0, float(mo_meta["offset"])), segs[0][2])
            for k, (t, caps) in enumerate(mo_segs):
                segs.insert(1 + k, ("mo", t, caps))
        else:
            secs = float(sys.argv[sys.argv.index("--mo-seconds") + 1]) if "--mo-seconds" in sys.argv else 8.0
            segs.insert(1, ("mo", (0.0, min(secs, runs["mo"]["n"] / fps)), CAPTIONS[1]))

    # picture: frame indices per segment (frame f shows song time f/fps). Audio: each segment's slice, extended
    # JOIN/2 past both cut points and overlap-added with equal-power fades, so the join is centred on the picture cut.
    idx, captions, spans = [], [], []
    for key, (t0, t1), cap in segs:
        f0, f1 = int(round(t0 * fps)), min(runs[key]["n"], int(round(t1 * fps)))
        start = len(idx) / fps
        for rel, text in (cap if isinstance(cap, list) else [(0.0, cap)] if cap else []):  # a section cut: [(offset, text)]
            captions.append({"t0": start + rel + 0.4, "t1": start + rel + min(3.6, (f1 - f0) / fps - rel - 0.3), "text": text,
                             "end": start + (f1 - f0) / fps, "y": 0.125 if key == "mo" else 0.075})  # (mo: under the making-of banner, above the cards)
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
