"""Reference track analysis for the montagem / Suno flow.

For every audio file given (or every file in song/refs/), prints a report and
writes song/refs/analysis/<name>.json + <name>.png:

  * tempo (constant-grid fit) and tempo drift over the track,
  * key (Krumhansl profile on the whole mix) and the sub root (strongest
    fundamental under 100 Hz),
  * first 2 seconds: time of the first attack, fade-in, silence "holes",
  * motif repetition: how similar each bar is to the bar 2 / 4 bars later
    (1.0 = one-to-one loop, the skill's criterion 4),
  * onset density (events per bar) and loudest-onset grid (cut points),
  * spectral balance: sub / low / low-mid / lead band (1-3 kHz) / air,
    plus how much energy survives a phone speaker (HPF 400 Hz),
  * loudness: integrated LUFS, true peak and LRA via ffmpeg ebur128,
  * sections: novelty boundaries snapped to bars.

Run:  python3 song/tools/ref_analyze.py [files...]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import librosa
import librosa.display

SR = 22050
HOP = 512
ROOT = Path(__file__).resolve().parents[1]
REFS = ROOT / "refs"
OUT = REFS / "analysis"
AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".opus", ".webm", ".mp4"}

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def fmt_t(t):
    return f"{int(t // 60)}:{t % 60:06.3f}"


def loudness(path):
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
           "-af", "ebur128=peak=true", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    summary = err[err.rfind("Summary:"):]

    def grab(label):
        m = re.search(label + r":\s+(-?[\d.]+|-inf)", summary)
        return None if not m or m.group(1) == "-inf" else float(m.group(1))

    return {"lufs_i": grab("I"), "lra": grab("LRA"), "true_peak_dbtp": grab("Peak")}


def key_estimate(y):
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(y), sr=SR, hop_length=HOP)
    prof = chroma.mean(axis=1)
    best = []
    for i in range(12):
        for mode, tmpl in (("major", MAJOR), ("minor", MINOR)):
            best.append((np.corrcoef(prof, np.roll(tmpl, i))[0, 1], f"{NOTES[i]} {mode}"))
    best.sort(reverse=True)
    return best[0][1], round(float(best[0][0]), 3), best[1][1], prof


def sub_root(y):
    S = np.abs(librosa.stft(y, n_fft=8192, hop_length=2048))
    f = librosa.fft_frequencies(sr=SR, n_fft=8192)
    band = (f >= 30) & (f <= 100)
    spec = S[band].mean(axis=1)
    f0 = float(f[band][np.argmax(spec)])
    return round(f0, 1), librosa.hz_to_note(f0)


def band_balance(y):
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)) ** 2
    f = librosa.fft_frequencies(sr=SR, n_fft=4096)
    p = S.mean(axis=1)
    total = p.sum()
    bands = {"sub_20_60": (20, 60), "low_60_250": (60, 250), "lowmid_250_1k": (250, 1000),
             "lead_1k_3k": (1000, 3000), "presence_3k_6k": (3000, 6000), "air_6k_plus": (6000, SR / 2)}
    out = {k: round(float(10 * np.log10(p[(f >= a) & (f < b)].sum() / total + 1e-12)), 1)
           for k, (a, b) in bands.items()}
    out["phone_survives_pct"] = round(float(100 * p[f >= 400].sum() / total), 1)
    return out


def first_seconds(y):
    head = y[: int(2.0 * SR)]
    env = np.abs(head)
    thr = max(1e-3, 0.1 * env.max())
    first = int(np.argmax(env > thr)) if (env > thr).any() else None
    rms = librosa.feature.rms(y=head, frame_length=512, hop_length=128)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=SR, hop_length=128)
    peak = rms.max() + 1e-12
    reach = t[np.argmax(rms > 0.5 * peak)]
    db = 20 * np.log10(rms / peak + 1e-12)
    holes, start = [], None
    for i, v in enumerate(db < -40):
        if v and start is None:
            start = i
        if not v and start is not None:
            if t[i] - t[start] >= 0.08 and t[start] > 0.05:
                holes.append([round(float(t[start]), 3), round(float(t[i] - t[start]), 3)])
            start = None
    return {"first_attack_ms": None if first is None else round(1000 * first / SR, 1),
            "half_level_ms": round(float(1000 * reach), 1),
            "fade_in": bool(reach > 0.2),
            "silence_holes_s": holes}


def tempo_grid(y, onset_env):
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    bt = np.asarray(beats)
    drift = None
    if len(bt) > 16:
        # local tempo per 8-beat window, spread = drift
        ibi = np.diff(bt)
        win = [60 / np.median(ibi[i:i + 8]) for i in range(0, len(ibi) - 8, 8)]
        if win:
            # fold half/double-time windows onto the global tempo
            win = [w * 2 if w < tempo * 0.75 else w / 2 if w > tempo * 1.5 else w for w in win]
            drift = round(float(np.percentile(win, 90) - np.percentile(win, 10)), 2)
        # refine with linear fit of beat index -> time
        k = np.arange(len(bt))
        slope, _ = np.polyfit(k, bt, 1)
        tempo = 60 / slope
    return round(tempo, 2), bt, drift


def bar_repetition(y, bt):
    """Cosine similarity of each bar's chroma+mfcc to the bar 2 and 4 bars later."""
    if len(bt) < 20:
        return None
    bars = bt[::4]
    C = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
    M = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=13)
    F = np.vstack([C, M / (np.abs(M).max() + 1e-9)])
    fr = librosa.time_to_frames(bars, sr=SR, hop_length=HOP)
    vecs = []
    for a, b in zip(fr[:-1], fr[1:]):
        seg = F[:, a:b]
        # 16 time slots per bar so rhythm/melody order counts, not just averages
        if seg.shape[1] < 16:
            continue
        slots = np.array_split(seg, 16, axis=1)
        vecs.append(np.concatenate([s.mean(axis=1) for s in slots]))
    V = np.array(vecs)
    V = V - V.mean(axis=0)
    V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9

    def lag(n):
        return [float(V[i] @ V[i + n]) for i in range(len(V) - n)]

    l2, l4 = lag(2), lag(4)
    return {"lag2_median": round(float(np.median(l2)), 3),
            "lag4_median": round(float(np.median(l4)), 3),
            "lag2_first8bars": [round(x, 2) for x in l2[:8]],
            "bar_times": [round(float(b), 3) for b in bars]}


def sections(y, bt):
    if len(bt) < 32:
        return []
    bars = bt[::4]
    fr = librosa.time_to_frames(bars, sr=SR, hop_length=HOP)
    M = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=20)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    feats = np.array([np.concatenate([M[:, a:b].mean(axis=1), [20 * np.log10(rms[a:b].mean() + 1e-9)]])
                      for a, b in zip(fr[:-1], fr[1:]) if b > a])
    feats = (feats - feats.mean(0)) / (feats.std(0) + 1e-9)
    nov = np.r_[0, np.linalg.norm(np.diff(feats, axis=0), axis=1)]
    thr = np.mean(nov) + 1.0 * np.std(nov)
    out = []
    for i in range(1, len(nov)):
        if nov[i] > thr and (not out or i - out[-1]["bar"] >= 2):
            loud = feats[i, -1] - feats[i - 1, -1]
            out.append({"bar": i + 1, "time": round(float(bars[i]), 3),
                        "change": "louder" if loud > 0.3 else "quieter" if loud < -0.3 else "timbre"})
    return out


def onset_stats(onset_env, tempo, duration):
    on = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time")
    bar = 240 / tempo
    strength = onset_env[librosa.time_to_frames(on, sr=SR, hop_length=HOP)]
    top = on[np.argsort(strength)[::-1][:12]]
    return {"onsets_per_bar": round(len(on) / (duration / bar), 1),
            "strongest_hits_s": sorted(round(float(t), 3) for t in top)}


def plot(path, y, bt, rep, name):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    fig, ax = plt.subplots(3, 1, figsize=(14, 8), constrained_layout=True)
    t = np.arange(len(y)) / SR
    ax[0].plot(t, y, lw=0.3, color="#444")
    for b in bt[::4]:
        ax[0].axvline(b, color="#d33", lw=0.4, alpha=0.5)
    ax[0].set_title(f"{name} — waveform, red = bar lines")
    head = int(4 * SR)
    ax[1].plot(t[:head], y[:head], lw=0.4, color="#246")
    ax[1].set_title("first 4 s (attack / holes)")
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)), ref=np.max)
    librosa.display.specshow(S, sr=SR, hop_length=HOP, x_axis="time", y_axis="log", ax=ax[2], cmap="magma")
    ax[2].set_title("spectrogram")
    fig.savefig(path, dpi=90)
    plt.close(fig)


def load(path):
    """Decode anything ffmpeg reads (m4a/aac/opus too) to mono float32 at SR."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(SR),
           "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()


def contrast(y, tempo):
    """Drop power: loudest 10% of bars vs quietest 25% (full mix, sub < 80 Hz, 1-4 kHz)."""
    bar = 240 / tempo
    rows = []
    for i in range(int(len(y) / SR / bar)):
        seg = y[int(i * bar * SR):int((i + 1) * bar * SR)]
        S = np.abs(librosa.stft(seg, n_fft=2048))
        f = librosa.fft_frequencies(sr=SR, n_fft=2048)
        rows.append((20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9),
                     20 * np.log10(S[f < 80].mean() + 1e-9),
                     20 * np.log10(S[(f > 1000) & (f < 4000)].mean() + 1e-9)))
    if len(rows) < 8:
        return None
    r = np.array(rows)
    lo, hi = r[r[:, 0] <= np.percentile(r[:, 0], 25)], r[r[:, 0] >= np.percentile(r[:, 0], 90)]
    jump = hi.mean(axis=0) - lo.mean(axis=0)
    d = np.diff(r[:, 0])
    k = int(np.argmax(d))
    return {"mix_db": round(float(jump[0]), 1), "sub_db": round(float(jump[1]), 1),
            "mid_1k4k_db": round(float(jump[2]), 1),
            "biggest_jump_db": round(float(d[k]), 1), "biggest_jump_at_s": round((k + 1) * bar, 2)}


def analyze(path):
    y = load(path)
    duration = len(y) / SR
    onset_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    tempo, bt, drift = tempo_grid(y, onset_env)
    key, conf, key2, _ = key_estimate(y)
    rep = bar_repetition(y, bt)
    res = {
        "file": path.name,
        "duration_s": round(duration, 2),
        "tempo_bpm": tempo,
        "tempo_drift_bpm": drift,
        "bar_s": round(240 / tempo, 3),
        "key": key, "key_confidence": conf, "key_runner_up": key2,
        "sub_root": sub_root(y),
        "first_2s": first_seconds(y),
        "repetition": rep,
        "onsets": onset_stats(onset_env, tempo, duration),
        "bands_db_rel_total": band_balance(y),
        "loudness": loudness(path),
        "sections": sections(y, bt),
        "drop_contrast": contrast(y, tempo),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    stem = path.stem
    (OUT / f"{stem}.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    plot(OUT / f"{stem}.png", y, bt, rep, path.name)
    return res


def report(r):
    f2, b, ld, rep = r["first_2s"], r["bands_db_rel_total"], r["loudness"], r["repetition"]
    print(f"\n=== {r['file']}  ({fmt_t(r['duration_s'])})")
    print(f"tempo   {r['tempo_bpm']} BPM  (bar {r['bar_s']} s, drift {r['tempo_drift_bpm']} BPM)")
    print(f"key     {r['key']} (conf {r['key_confidence']}, then {r['key_runner_up']});"
          f" sub root {r['sub_root'][0]} Hz = {r['sub_root'][1]}")
    print(f"start   first attack {f2['first_attack_ms']} ms, half level at {f2['half_level_ms']} ms,"
          f" fade-in {'YES' if f2['fade_in'] else 'no'}, holes {f2['silence_holes_s']}")
    if rep:
        print(f"repeat  bar vs +2 bars {rep['lag2_median']}, vs +4 bars {rep['lag4_median']}"
              f"  (≥0.8 loop-like, <0.5 theme develops)")
    print(f"density {r['onsets']['onsets_per_bar']} onsets/bar")
    print("bands   " + "  ".join(f"{k} {v}" for k, v in b.items() if k != "phone_survives_pct")
          + f"  | phone speaker keeps {b['phone_survives_pct']}%")
    print(f"loud    {ld['lufs_i']} LUFS-I, TP {ld['true_peak_dbtp']} dBTP, LRA {ld['lra']} LU")
    c = r.get("drop_contrast")
    if c:
        print(f"drop    loud vs quiet bars: mix +{c['mix_db']} dB, sub +{c['sub_db']} dB, 1-4k +{c['mid_1k4k_db']} dB;"
              f" biggest jump +{c['biggest_jump_db']} dB at {fmt_t(c['biggest_jump_at_s'])}"
              "  (refs: mix +8..14, sub +20..30)")
    if r["sections"]:
        print("sects   " + ", ".join(f"bar {s['bar']} @{fmt_t(s['time'])} {s['change']}" for s in r["sections"]))


def main():
    args = [Path(a) for a in sys.argv[1:]]
    if not args:
        args = sorted(p for p in REFS.iterdir() if p.suffix.lower() in AUDIO_EXT)
    if not args:
        sys.exit(f"no audio given and none in {REFS}")
    for p in args:
        report(analyze(p))


if __name__ == "__main__":
    main()
