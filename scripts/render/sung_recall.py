"""Whisper recall of sung lines, each transcribed alone (its own clip, 0.3 s padding; no context from the line before).

  /opt/homebrew/opt/python@3.11/bin/python3.11 scripts/render/sung_recall.py <lines.wav> [<lines.wav> ...]

<lines.wav> and its <lines>.meta.json come from sung-lines.mjs. Writes <lines>.rec.json (per line: the target words, which
were heard, what Whisper heard) and prints the word recall, the crew names' recall (CREW: the eight crew bots, Black
included since he joined on Nov 1) and the worst lines. Model: mlx-community/whisper-large-v3-mlx (mlx_whisper).
"""
import collections, json, re, sys, wave
import numpy as np
import mlx_whisper

MODEL = 'mlx-community/whisper-large-v3-mlx'
# the crew of eight, by face colour (web/src/gen/cast.js AGENT_BOT): a name heard is scored apart from the other words
CREW = {'green', 'white', 'gray', 'blue', 'gold', 'yellow', 'pink', 'black'}
NUMBERS = {'4th': 'fourth', '16': 'sixteen', '3': 'three', '2': 'two', '1': 'one', '4': 'four'}
norm = lambda s: [NUMBERS.get(w, w) for w in re.findall(r"[a-z0-9']+", s.lower().replace('’', "'"))]

for path in sys.argv[1:]:
    L = json.load(open(path.replace('.wav', '.meta.json')))
    with wave.open(path) as w:
        sr = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if sr != 16000:
        n = int(len(pcm) * 16000 / sr)
        pcm = np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm).astype(np.float32)
        sr = 16000
    out, agg = [], collections.defaultdict(lambda: [0, 0])
    for l in L:
        a, b = max(0, int((l['at'] - 0.3) * sr)), int((l['end'] + 0.3) * sr)
        r = mlx_whisper.transcribe(pcm[a:b], path_or_hf_repo=MODEL, language='en', condition_on_previous_text=False, temperature=0.0)
        heard = collections.Counter(norm(r['text']))
        want = norm(l['text'])
        hits = []
        for x in want:
            ok = heard[x] > 0
            if ok: heard[x] -= 1
            hits.append(1 if ok else 0)
            name = x in CREW and re.search(r'\b' + x.capitalize() + r'\b', l['text'])
            for k in ('all', 'names' if name else 'other words'):
                agg[k][0] += ok; agg[k][1] += 1
        out.append(dict(l, words=want, hits=hits, heard=r['text'].strip()))
    json.dump(out, open(path.replace('.wav', '.rec.json'), 'w'), indent=1)
    for k in ('all', 'names', 'other words'):
        h, n = agg[k]
        print('%s %-11s %4d/%4d = %5.1f%%' % (path, k, h, n, 100 * h / max(n, 1)))
    for x in sorted(out, key=lambda x: sum(x['hits']) / max(1, len(x['hits'])))[:10]:
        print('  %d/%d %-36s heard: %s' % (sum(x['hits']), len(x['hits']), x['text'], x['heard']))
