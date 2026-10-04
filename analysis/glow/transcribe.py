"""Free transcription of the vocal stem -> work/asr.json (+ a readable listing)

Parakeet TDT 0.6B v2 (NeMo, int8 ONNX from the sherpa-onnx releases on GitHub)
on vocal-active stretches of work/vocals.wav.  This is not the alignment: it
shows what is actually sung where (sung structure, repeats, ad-libs, chops),
which the lyric sheet does not say, and gives rough word times to seed and
check the forced alignment.

Run:  uv run python transcribe.py
"""
import json

import librosa
import numpy as np
import sherpa_onnx
import soundfile as sf

from common import MODELS, WORK

SR = 16000
M = MODELS / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"


def active_spans(v, hop=0.01, floor_db=-42.0, rel_db=28.0, min_gap=0.7, max_len=24.0, pad=0.25):
    """Vocal-active stretches: RMS above an absolute floor and within rel_db of
    the song's loud vocal level; short gaps merged; long spans split at their
    quietest frame."""
    h = int(hop * SR)
    rms = librosa.feature.rms(y=v, frame_length=4 * h, hop_length=h)[0]
    db = 20 * np.log10(rms + 1e-9)
    loud = np.percentile(db, 98)
    on = (db > floor_db) & (db > loud - rel_db)
    spans, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]:
                j += 1
            spans.append([i * hop, j * hop])
            i = j
        else:
            i += 1
    merged = []
    for s in spans:
        if merged and s[0] - merged[-1][1] < min_gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    out = []
    for a, b in merged:
        if b - a < 0.25:
            continue
        a, b = max(0.0, a - pad), b + pad
        while b - a > max_len:  # split at the quietest point in the last third of the window
            lo, hi = int((a + max_len * 0.6) / hop), int((a + max_len) / hop)
            k = lo + int(np.argmin(db[lo:hi]))
            out.append([a, k * hop])
            a = k * hop
        out.append([a, b])
    return out


def main():
    v, sr = sf.read(WORK / "vocals.wav", dtype="float32", always_2d=True)
    v = librosa.resample(v.mean(1), orig_sr=sr, target_sr=SR)
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(M / "encoder.int8.onnx"), decoder=str(M / "decoder.int8.onnx"),
        joiner=str(M / "joiner.int8.onnx"), tokens=str(M / "tokens.txt"),
        num_threads=4, sample_rate=SR, feature_dim=80, decoding_method="greedy_search",
        model_type="nemo_transducer")
    spans = active_spans(v)
    words = []
    for a, b in spans:
        s = rec.create_stream()
        s.accept_waveform(SR, v[int(a * SR):int(b * SR)])
        rec.decode_stream(s)
        r = s.result
        cur = None
        for tok, ts in zip(r.tokens, r.timestamps):
            t = a + ts
            if tok.startswith("▁") or tok.startswith(" ") or cur is None:
                if cur:
                    words.append(cur)
                cur = {"w": tok.lstrip("▁ "), "start": round(t, 3), "span": [round(a, 2), round(b, 2)]}
            else:
                cur["w"] += tok
        if cur:
            words.append(cur)
        print(f"[{a:7.2f} - {b:7.2f}] {r.text}")
    (WORK / "asr.json").write_text(json.dumps({"spans": spans, "words": words}, indent=0))


if __name__ == "__main__":
    main()
